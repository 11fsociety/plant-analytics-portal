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

export function linearForecast(series: Series, daysAhead = 7) {
  const pairs = parsePairs(series);
  if (pairs.length < 3) return { slope_per_day: null, intercept: null, forecast: [] };
  const window = pairs.slice(-21);
  const x0 = window[0][0].getTime() / 86400000;
  const xs = window.map(p => p[0].getTime() / 86400000 - x0);
  const ys = window.map(p => p[1]);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const b = den > 0 ? num / den : 0;
  const a = meanY - b * meanX;
  const residuals = ys.map((y, i) => y - (a + b * xs[i]));
  const varr = residuals.reduce((s, r) => s + r * r, 0) / Math.max(residuals.length - 1, 1);
  const std = Math.sqrt(varr);
  const lastD = window[window.length - 1][0];
  const forecast: Array<{ d: string; point: number; low: number; high: number }> = [];
  for (let k = 1; k <= daysAhead; k++) {
    const d = new Date(lastD.getTime() + k * 86400000);
    const x = d.getTime() / 86400000 - x0;
    const y = a + b * x;
    forecast.push({
      d: d.toISOString().slice(0, 10),
      point: Math.max(0, y),
      low: Math.max(0, y - 1.96 * std),
      high: Math.max(0, y + 1.96 * std),
    });
  }
  return { slope_per_day: b, intercept: a, forecast };
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

export async function llmNarrative(payload: any): Promise<any | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  try {
    const prompt = `You are analysing a plant's monthly production, downtime and scrap data. Use ONLY the JSON below - no assumptions. Return strict JSON with keys: "bullets" (5 short insights), "risks" (3 concrete risks), "recommendations" (3 actionable, specific), each an array of strings. Be quantitative; cite numbers. Look for signals a deterministic layer might miss.\n\nDATA:\n${JSON.stringify(payload).slice(0, 12000)}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return { error: `LLM HTTP ${res.status}`, source: 'llm-failed' };
    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    return { ...JSON.parse(text.slice(start, end + 1)), source: 'llm' };
  } catch (e: any) {
    return { error: String(e), source: 'llm-failed' };
  }
}
