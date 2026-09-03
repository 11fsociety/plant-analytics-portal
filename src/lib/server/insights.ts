/**
 * Portal-only forecasting + anomaly detection extensions.
 *
 * Builds on the mirrored `predictive.ts` (from the main app) without modifying
 * it — the ingest.ts/row_hash mirror invariant must not be endangered. All
 * new logic lives here so `verify_mirror.mjs` stays green on predictive.ts.
 *
 * Public surface:
 *   - tieredForecast(series, horizonDays)  → picks the right model for the data volume
 *   - residualAnomalies(series, k)         → MAD on the residual after seasonal decomposition
 *   - stlDecompose(series, period)         → simple STL: trend (moving avg) + seasonal + residual
 *   - insightsFor(series, opts)            → single call returning {forecast, anomalies, diagnostics}
 *
 * Model tiers by series length (points):
 *   <  3   → flat mean (naive baseline)
 *   3–6    → Simple Exponential Smoothing
 *   7–13   → Holt (level + trend)
 *   14–89  → Holt-Winters (weekly seasonality)   ← where 60-day data lives today
 *   90+    → STL + Holt-Winters on residual      ← multi-seasonal, weekly + monthly
 *
 * The tier auto-upgrades every request — no manual retraining, no persisted
 * model state; just refit-on-latest-data each call.
 */

import { linearForecast, madAnomalies } from './predictive';

export type SeriesPoint = { d: string; v: number };
export type Series = SeriesPoint[];

export type ForecastPoint = { d: string; point: number; low: number; high: number };

export type ForecastTier =
  | 'flat'
  | 'ses'
  | 'holt'
  | 'holt-winters'
  | 'stl+holt-winters'
  | 'empty';

export type Diagnostics = {
  tier: ForecastTier;
  method: string;
  params?: Record<string, number | string>;
  rmse?: number;
  n_points: number;
  n_anomalies: number;
  residual_std?: number;
  monthly_seasonality_used?: boolean;
};

export type Insights = {
  series: SeriesPoint[];
  forecast: ForecastPoint[];
  anomalies: Array<{ d: string; v: number; z: number }>;
  diagnostics: Diagnostics;
};

/* ---------------------------------------------------------------------- *
 * Utilities
 * ---------------------------------------------------------------------- */

function parsePairs(series: Series): Array<[Date, number]> {
  const out: Array<[Date, number]> = [];
  for (const r of series) {
    const d = new Date(r.d);
    if (Number.isNaN(d.getTime())) continue;
    if (r.v == null) continue;
    out.push([d, r.v]);
  }
  out.sort((a, b) => a[0].getTime() - b[0].getTime());
  return out;
}

function movingAverage(ys: number[], window: number): number[] {
  const out: number[] = [];
  const half = Math.floor(window / 2);
  for (let i = 0; i < ys.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(ys.length, i + half + 1);
    let s = 0;
    for (let j = lo; j < hi; j++) s += ys[j];
    out.push(s / (hi - lo));
  }
  return out;
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(v);
}

/* ---------------------------------------------------------------------- *
 * STL-style decomposition (trend + seasonal + residual)
 *
 * Not full LOESS-based STL — a lightweight version that's plenty for
 * daily ops data:
 *   1. Trend  = centered moving average of window ≈ 2 * period
 *   2. Detrended = y - trend
 *   3. Seasonal = for each phase (day-of-period), take median of detrended values
 *   4. Residual = y - trend - seasonal
 * ---------------------------------------------------------------------- */

export type STLResult = {
  trend: number[];
  seasonal: number[];
  residual: number[];
  period: number;
};

export function stlDecompose(ys: number[], period = 7): STLResult {
  const n = ys.length;
  if (n < period * 2) {
    // Not enough data for a seasonal cycle to be estimable — return trivial split.
    const trend = movingAverage(ys, Math.min(n, period));
    const residual = ys.map((y, i) => y - trend[i]);
    return { trend, seasonal: new Array(n).fill(0), residual, period };
  }
  const trendWindow = Math.max(3, period * 2 + 1);
  const trend = movingAverage(ys, trendWindow);
  const detrended = ys.map((y, i) => y - trend[i]);

  // Seasonal component: median per phase (0..period-1). Median beats mean here
  // for robustness against outliers.
  const phaseGroups: number[][] = Array.from({ length: period }, () => []);
  for (let i = 0; i < n; i++) phaseGroups[i % period].push(detrended[i]);
  const phaseMeds = phaseGroups.map((g) => (g.length ? median(g) : 0));

  // Zero-mean the seasonal component so it doesn't leak into the trend.
  const phaseMean = phaseMeds.reduce((a, b) => a + b, 0) / period;
  const seasonalPhases = phaseMeds.map((p) => p - phaseMean);

  const seasonal = ys.map((_, i) => seasonalPhases[i % period]);
  const residual = ys.map((y, i) => y - trend[i] - seasonal[i]);
  return { trend, seasonal, residual, period };
}

/* ---------------------------------------------------------------------- *
 * Residual-based MAD anomalies
 *
 * Flags points where the residual (after removing trend + seasonal) is
 * extreme, using the modified Z-score formula (0.6745 * (r - median) / MAD).
 *
 * Better than raw MAD because:
 *   - "Production dip on Sunday" is expected (weekly seasonal), not anomalous.
 *   - "Production spike on a Wednesday that's usually average" IS anomalous.
 * ---------------------------------------------------------------------- */

export function residualAnomalies(
  series: Series,
  k = 3.5,
  period = 7,
): Array<{ d: string; v: number; z: number }> {
  const pairs = parsePairs(series);
  if (pairs.length < Math.max(30, period * 4)) {
    // Not enough data to trust decomposition — fall back to raw MAD.
    return madAnomalies(series, k);
  }
  const ys = pairs.map((p) => p[1]);
  const { residual } = stlDecompose(ys, period);
  const med = median(residual);
  const mad = median(residual.map((r) => Math.abs(r - med))) || 1;
  const out: Array<{ d: string; v: number; z: number }> = [];
  for (let i = 0; i < pairs.length; i++) {
    const z = 0.6745 * (residual[i] - med) / mad;
    if (Math.abs(z) > k) {
      out.push({
        d: pairs[i][0].toISOString().slice(0, 10),
        v: pairs[i][1],
        z: Math.round(z * 100) / 100,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- *
 * Tiered forecast
 *
 * For < 90 points: delegates to the mirrored linearForecast (SES/Holt/HW).
 * For 90+ points: runs STL decomposition, forecasts the trend via Holt,
 * projects the seasonal by phase, sums back for the forecast, and uses
 * residual std for the 95% band. If a monthly cycle (period=30) shows
 * meaningful signal in the detrended series, layer it on top.
 * ---------------------------------------------------------------------- */

function fitHoltTrend(ys: number[], alpha: number, beta: number) {
  const levels: number[] = [ys[0]];
  const trends: number[] = [ys.length >= 2 ? ys[1] - ys[0] : 0];
  const residuals: number[] = [0];
  for (let t = 1; t < ys.length; t++) {
    const prevL = levels[t - 1];
    const prevT = trends[t - 1];
    const forecast_t = prevL + prevT;
    residuals.push(ys[t] - forecast_t);
    const L = alpha * ys[t] + (1 - alpha) * (prevL + prevT);
    const T = beta * (L - prevL) + (1 - beta) * prevT;
    levels.push(L);
    trends.push(T);
  }
  return { levels, trends, residuals };
}

function rmse(rs: number[]): number {
  if (rs.length === 0) return Infinity;
  return Math.sqrt(rs.reduce((s, r) => s + r * r, 0) / rs.length);
}

function tuneHolt(ys: number[]): { alpha: number; beta: number; rmse: number } {
  const grid = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
  let best = { alpha: 0.3, beta: 0.1, rmse: Infinity };
  for (const a of grid) {
    for (const b of grid) {
      const { residuals } = fitHoltTrend(ys, a, b);
      const r = rmse(residuals.slice(2));
      if (r < best.rmse) best = { alpha: a, beta: b, rmse: r };
    }
  }
  return best;
}

/** Detect if a candidate period P has enough seasonal signal to be worth adding.
 *  Signal ratio = variance(seasonal) / variance(detrended). > 0.15 → keep. */
function hasSeasonalSignal(ys: number[], period: number): boolean {
  if (ys.length < period * 3) return false;
  const dec = stlDecompose(ys, period);
  const detrendedVar = variance(ys.map((y, i) => y - dec.trend[i]));
  const seasonalVar = variance(dec.seasonal);
  if (detrendedVar <= 0) return false;
  return seasonalVar / detrendedVar > 0.15;
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
}

function stlHoltForecast(
  ys: number[],
  daysAhead: number,
  useMonthly: boolean,
): { forecast: ForecastPoint[]; diagnostics: Diagnostics } {
  const n = ys.length;
  const period = 7;
  const dec = stlDecompose(ys, period);
  const detrended = ys.map((y, i) => y - dec.seasonal[i]);
  const holt = tuneHolt(detrended);
  const fit = fitHoltTrend(detrended, holt.alpha, holt.beta);
  const finalL = fit.levels[fit.levels.length - 1];
  const finalT = fit.trends[fit.trends.length - 1];
  const residStd = Math.sqrt(
    fit.residuals.slice(2).reduce((s, r) => s + r * r, 0) / Math.max(fit.residuals.length - 2, 1),
  );

  // Optional monthly overlay: only if the signal is genuinely there.
  let monthlySeasonal: number[] | null = null;
  if (useMonthly) {
    const monthlyDec = stlDecompose(ys, 30);
    monthlySeasonal = new Array(30);
    for (let i = 0; i < 30; i++) monthlySeasonal[i] = monthlyDec.seasonal[i] ?? 0;
  }

  const forecast: ForecastPoint[] = [];
  for (let k = 1; k <= daysAhead; k++) {
    const weeklyPhase = (n + k - 1) % period;
    const yhat_trend = finalL + k * finalT;
    const yhat_weekly = dec.seasonal[weeklyPhase] ?? 0;
    const yhat_monthly = monthlySeasonal ? monthlySeasonal[(n + k - 1) % 30] : 0;
    const yhat = yhat_trend + yhat_weekly + yhat_monthly;
    const band = 1.96 * residStd * Math.sqrt(k);
    // The `d` field is filled in by the caller (tieredForecast), which knows
    // the last historical date and computes future ISO dates from it.
    forecast.push({
      d: '',
      point: Math.max(0, yhat),
      low: Math.max(0, yhat - band),
      high: Math.max(0, yhat + band),
    });
  }

  const diagnostics: Diagnostics = {
    tier: 'stl+holt-winters',
    method: monthlySeasonal
      ? 'STL(period=7) + Holt trend + monthly overlay(period=30)'
      : 'STL(period=7) + Holt trend',
    params: {
      alpha: holt.alpha,
      beta: holt.beta,
      trend_window: Math.max(3, period * 2 + 1),
    },
    rmse: Math.round(holt.rmse * 100) / 100,
    n_points: n,
    n_anomalies: 0, // caller fills in
    residual_std: Math.round(residStd * 100) / 100,
    monthly_seasonality_used: !!monthlySeasonal,
  };

  return { forecast, diagnostics };
}

/* ---------------------------------------------------------------------- *
 * Public entry: tieredForecast + insightsFor
 * ---------------------------------------------------------------------- */

export function tieredForecast(series: Series, daysAhead = 7): {
  forecast: ForecastPoint[];
  diagnostics: Diagnostics;
} {
  const pairs = parsePairs(series);
  const n = pairs.length;
  if (n === 0) {
    return {
      forecast: [],
      diagnostics: {
        tier: 'empty',
        method: 'no data',
        n_points: 0,
        n_anomalies: 0,
      },
    };
  }
  const lastD = pairs[n - 1][0];
  const dayOut = (k: number) =>
    new Date(lastD.getTime() + k * 86400000).toISOString().slice(0, 10);

  if (n < 90) {
    // Delegate to mirrored linearForecast for lower tiers.
    const lf = linearForecast(series, daysAhead);
    return {
      forecast: lf.forecast,
      diagnostics: {
        tier: lf.method as ForecastTier,
        method: lf.method,
        params: lf.params as Record<string, number> | undefined,
        rmse: lf.rmse != null ? Math.round(lf.rmse * 100) / 100 : undefined,
        n_points: n,
        n_anomalies: 0,
      },
    };
  }

  const ys = pairs.map((p) => p[1]);
  const useMonthly = n >= 90 && hasSeasonalSignal(ys, 30);
  const { forecast, diagnostics } = stlHoltForecast(ys, daysAhead, useMonthly);
  // Fill dates on the forecast points now that we have lastD available.
  for (let k = 0; k < forecast.length; k++) forecast[k].d = dayOut(k + 1);
  return { forecast, diagnostics };
}

export type InsightsOptions = {
  horizonDays?: number;
  anomalyK?: number;
  seasonalPeriod?: number;
};

export function insightsFor(series: Series, opts: InsightsOptions = {}): Insights {
  const horizonDays = opts.horizonDays ?? 7;
  const anomalyK = opts.anomalyK ?? 3.5;
  const period = opts.seasonalPeriod ?? 7;

  const { forecast, diagnostics } = tieredForecast(series, horizonDays);
  const anomalies = residualAnomalies(series, anomalyK, period);
  diagnostics.n_anomalies = anomalies.length;

  return {
    series,
    forecast,
    anomalies,
    diagnostics,
  };
}
