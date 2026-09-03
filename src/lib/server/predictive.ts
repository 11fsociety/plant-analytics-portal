/** Predictive layer: rolling means, linear forecast, MAD anomalies, optional LLM. */

type Series = Array<{ d: string; v: number }>;
type Pair = [Date, number];

function parsePairs(series: Series): Pair[] {
  const out: Pair[] = [];
  for (const r of series) {
    const d = new Date(r.d);
    if (isNaN(d.getTime())) continue;
    if (r.v == null) continue;
    out.push([d, r.v]);
  }
  out.sort((a, b) => a[0].getTime() - b[0].getTime());
  return out;
}

export function rollingMean(series: Series, window = 7) {
  const pairs = parsePairs(series);
  return pairs.map((p, i) => {
    const lo = Math.max(0, i - window + 1);
    const win = pairs.slice(lo, i + 1).map(x => x[1]);
    return { d: p[0].toISOString().slice(0, 10), v: p[1], rolling: win.reduce((a, b) => a + b, 0) / win.length };
  });
}

type ForecastPoint = { d: string; point: number; low: number; high: number };
type ForecastResult = {
  slope_per_day: number | null;
  intercept: number | null;
  forecast: ForecastPoint[];
  method: 'holt-winters' | 'holt' | 'ses' | 'flat' | 'empty';
  params?: { alpha: number; beta?: number; gamma?: number; season?: number };
  rmse?: number;
};

/** Simple Exponential Smoothing forecast: level only. */
function fitSES(ys: number[], alpha: number): { levels: number[]; residuals: number[] } {
  const levels: number[] = [ys[0]];
  const residuals: number[] = [0];
  for (let t = 1; t < ys.length; t++) {
    const prevLevel = levels[t - 1];
    residuals.push(ys[t] - prevLevel);
    levels.push(alpha * ys[t] + (1 - alpha) * prevLevel);
  }
  return { levels, residuals };
}

/** Holt's Double Exponential Smoothing: level + additive trend, no seasonality. */
function fitHolt(ys: number[], alpha: number, beta: number) {
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
    levels.push(L); trends.push(T);
  }
  return { levels, trends, residuals };
}

/** Holt-Winters Additive: level + trend + weekly seasonality (period = 7). */
function fitHoltWinters(ys: number[], alpha: number, beta: number, gamma: number, period = 7) {
  const n = ys.length;
  // Initial level = average of first period, initial trend = slope across first 2 periods, initial seasonals = residuals from initial level in first period.
  const firstPeriodMean = ys.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let initTrend = 0;
  if (n >= 2 * period) {
    const secondPeriodMean = ys.slice(period, 2 * period).reduce((a, b) => a + b, 0) / period;
    initTrend = (secondPeriodMean - firstPeriodMean) / period;
  } else if (n >= 2) {
    initTrend = (ys[n - 1] - ys[0]) / (n - 1);
  }
  const seasonals: number[] = new Array(period).fill(0);
  for (let i = 0; i < period && i < n; i++) seasonals[i] = ys[i] - firstPeriodMean;

  const levels: number[] = [firstPeriodMean];
  const trends: number[] = [initTrend];
  const seasonal: number[] = seasonals.slice();
  const residuals: number[] = [];

  for (let t = 0; t < n; t++) {
    const s_idx = t % period;
    const prevL = levels[levels.length - 1];
    const prevT = trends[trends.length - 1];
    const prevS = seasonal[s_idx];
    const forecast_t = prevL + prevT + prevS;
    residuals.push(ys[t] - forecast_t);
    const L = alpha * (ys[t] - prevS) + (1 - alpha) * (prevL + prevT);
    const T = beta * (L - prevL) + (1 - beta) * prevT;
    const S = gamma * (ys[t] - L) + (1 - gamma) * prevS;
    levels.push(L); trends.push(T); seasonal[s_idx] = S;
  }
  return { levels, trends, seasonal, residuals };
}

function rmse(residuals: number[]): number {
  if (!residuals.length) return Infinity;
  const sq = residuals.reduce((s, r) => s + r * r, 0);
  return Math.sqrt(sq / residuals.length);
}

/** Grid-search parameters for the given fitter. Returns best params + fit quality. */
function tuneParams(ys: number[], mode: 'ses' | 'holt' | 'hw'): { alpha: number; beta?: number; gamma?: number; rmse: number } {
  const grid = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
  let best: any = { alpha: 0.3, beta: 0.1, gamma: 0.1, rmse: Infinity };
  if (mode === 'ses') {
    for (const a of grid) {
      const { residuals } = fitSES(ys, a);
      const r = rmse(residuals.slice(1));
      if (r < best.rmse) best = { alpha: a, rmse: r };
    }
  } else if (mode === 'holt') {
    for (const a of grid) for (const b of grid) {
      const { residuals } = fitHolt(ys, a, b);
      const r = rmse(residuals.slice(2));
      if (r < best.rmse) best = { alpha: a, beta: b, rmse: r };
    }
  } else {
    for (const a of grid) for (const b of grid) for (const g of grid) {
      const { residuals } = fitHoltWinters(ys, a, b, g, 7);
      const r = rmse(residuals.slice(7)); // skip first period (init effect)
      if (r < best.rmse) best = { alpha: a, beta: b, gamma: g, rmse: r };
    }
  }
  return best;
}

/**
 * Robust forecast that adapts to available data.
 * - ≥14 points: Holt-Winters additive (level + trend + weekly seasonality). Auto-tunes α/β/γ.
 * - 7-13 points: Holt's double exponential smoothing. Auto-tunes α/β.
 * - 3-6 points: Simple exponential smoothing. Auto-tunes α.
 * - <3 points: flat mean (or empty if 0).
 *
 * Returns same shape as the old linearForecast for backward compatibility.
 */
export function linearForecast(series: Series, daysAhead = 7): ForecastResult {
  const pairs = parsePairs(series);
  const n = pairs.length;
  if (n === 0) return { slope_per_day: null, intercept: null, forecast: [], method: 'empty' };
  const ys = pairs.map(p => p[1]);
  const lastD = pairs[n - 1][0];
  const dayOut = (k: number) => new Date(lastD.getTime() + k * 86400000).toISOString().slice(0, 10);

  if (n < 3) {
    const mean = ys.reduce((a, b) => a + b, 0) / n;
    const forecast: ForecastPoint[] = [];
    for (let k = 1; k <= daysAhead; k++) {
      forecast.push({ d: dayOut(k), point: Math.max(0, mean), low: Math.max(0, mean), high: Math.max(0, mean) });
    }
    return { slope_per_day: 0, intercept: mean, forecast, method: 'flat' };
  }

  if (n >= 14) {
    // Holt-Winters with weekly seasonality
    const { alpha, beta, gamma, rmse: err } = tuneParams(ys, 'hw') as any;
    const { levels, trends, seasonal, residuals } = fitHoltWinters(ys, alpha, beta, gamma, 7);
    const finalL = levels[levels.length - 1];
    const finalT = trends[trends.length - 1];
    const std = Math.sqrt(residuals.slice(7).reduce((s, r) => s + r * r, 0) / Math.max(residuals.length - 7, 1));
    const forecast: ForecastPoint[] = [];
    for (let k = 1; k <= daysAhead; k++) {
      const s_idx = (n + k - 1) % 7;
      const yhat = finalL + k * finalT + seasonal[s_idx];
      const band = 1.96 * std * Math.sqrt(k); // widening confidence with horizon
      forecast.push({ d: dayOut(k), point: Math.max(0, yhat), low: Math.max(0, yhat - band), high: Math.max(0, yhat + band) });
    }
    return { slope_per_day: finalT, intercept: finalL, forecast, method: 'holt-winters', params: { alpha, beta, gamma, season: 7 }, rmse: err };
  }

  if (n >= 7) {
    // Holt's double exponential (no seasonality)
    const { alpha, beta, rmse: err } = tuneParams(ys, 'holt') as any;
    const { levels, trends, residuals } = fitHolt(ys, alpha, beta);
    const finalL = levels[levels.length - 1];
    const finalT = trends[trends.length - 1];
    const std = Math.sqrt(residuals.slice(2).reduce((s, r) => s + r * r, 0) / Math.max(residuals.length - 2, 1));
    const forecast: ForecastPoint[] = [];
    for (let k = 1; k <= daysAhead; k++) {
      const yhat = finalL + k * finalT;
      const band = 1.96 * std * Math.sqrt(k);
      forecast.push({ d: dayOut(k), point: Math.max(0, yhat), low: Math.max(0, yhat - band), high: Math.max(0, yhat + band) });
    }
    return { slope_per_day: finalT, intercept: finalL, forecast, method: 'holt', params: { alpha, beta }, rmse: err };
  }

  // 3-6 points: SES
  const { alpha, rmse: err } = tuneParams(ys, 'ses') as any;
  const { levels, residuals } = fitSES(ys, alpha);
  const finalL = levels[levels.length - 1];
  const std = Math.sqrt(residuals.slice(1).reduce((s, r) => s + r * r, 0) / Math.max(residuals.length - 1, 1));
  const forecast: ForecastPoint[] = [];
  for (let k = 1; k <= daysAhead; k++) {
    const band = 1.96 * std * Math.sqrt(k);
    forecast.push({ d: dayOut(k), point: Math.max(0, finalL), low: Math.max(0, finalL - band), high: Math.max(0, finalL + band) });
  }
  return { slope_per_day: 0, intercept: finalL, forecast, method: 'ses', params: { alpha }, rmse: err };
}

export function madAnomalies(series: Series, k = 3.5) {
  const pairs = parsePairs(series);
  if (pairs.length === 0) return [];
  const vals = pairs.map(p => p[1]);
  const med = median(vals);
  const mad = median(vals.map(v => Math.abs(v - med))) || 1;
  const out: Array<{ d: string; v: number; z: number }> = [];
  for (const [d, v] of pairs) {
    const z = 0.6745 * (v - med) / mad;
    if (Math.abs(z) > k) out.push({ d: d.toISOString().slice(0, 10), v, z: Math.round(z * 100) / 100 });
  }
  return out;
}

function median(xs: number[]): number {
  const sorted = xs.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function deterministicNarrative(plant: any, machinesList: any[], scrapTop: any[]) {
  const bullets: string[] = [];
  const risks: string[] = [];
  const recs: string[] = [];

  const dtSorted = machinesList.slice().sort((a, b) => (b.downtime_hrs || 0) - (a.downtime_hrs || 0));
  if (dtSorted.length > 0) {
    const top = dtSorted[0];
    bullets.push(`${top.name} is the most-down machine at ${(top.downtime_hrs || 0).toFixed(0)} hrs (${((top.downtime_hrs || 0) / 744 * 100).toFixed(0)}% of the month).`);
  }
  const scrapSorted = machinesList.filter(m => m.scrap_kg).sort((a, b) => (b.scrap_kg || 0) - (a.scrap_kg || 0));
  if (scrapSorted.length > 0) {
    const top = scrapSorted[0];
    bullets.push(`${top.name} generates the most scrap absolutely (${(top.scrap_kg / 1000).toFixed(1)} t, ${top.scrap_pct_of_net}% of its net output).`);
  }
  const rateSorted = machinesList.filter(m => m.scrap_pct_of_net != null).sort((a, b) => b.scrap_pct_of_net - a.scrap_pct_of_net);
  if (rateSorted.length > 0) {
    bullets.push(`Highest scrap ratio: ${rateSorted[0].name} at ${rateSorted[0].scrap_pct_of_net}% of net.`);
  }
  bullets.push(`Plant produced ${(plant.net_kg / 1000).toFixed(1)} t net over ${plant.rolls?.toLocaleString()} rolls; downtime ${plant.downtime_hrs?.toFixed(0)} hrs; scrap ${(plant.scrap_kg / 1000).toFixed(1)} t (${plant.scrap_pct_of_net}% of net).`);

  for (const m of machinesList) {
    if ((m.downtime_hrs || 0) / 744 * 100 > 80) {
      risks.push(`${m.name} was down for ${((m.downtime_hrs || 0) / 744 * 100).toFixed(0)}% of the window - is it required at all this month?`);
    }
    if (m.scrap_pct_of_net != null && m.scrap_pct_of_net > 25) {
      risks.push(`${m.name} scrap ratio ${m.scrap_pct_of_net}% is well above typical (< 15% for lamination is a common benchmark).`);
    }
  }
  if (risks.length === 0) risks.push('No red-line machine metrics detected in the current window.');

  const focus = scrapTop.slice(0, 3).map(r => (r.reason || '').slice(0, 40)).filter(Boolean).join(', ');
  if (focus) recs.push(`Attack the top three scrap categories first: ${focus}.`);
  recs.push('Split downtime KPI into Management Loss vs Maintenance vs Process - headline number under-represents equipment picture.');
  recs.push('Instrument a per-day scrap MAD alert: any day above 3.5-sigma from median triggers a shift-lead review.');

  return { bullets, risks, recommendations: recs, source: 'deterministic' };
}

