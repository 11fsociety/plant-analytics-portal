/** Deterministic aggregations - TypeScript port of portal/analytics.py */
import type { Warehouse, ProductionRow, DowntimeRow, ScrapRow } from './warehouse';

export const MACHINE_MAP: Record<string, { name: string; dt_aliases: string[] }> = {
  CM01: { name: 'Calender-1', dt_aliases: ['Calender - 1', 'Calender - I'] },
  CM02: { name: 'Calender-2', dt_aliases: ['Calender - 2', 'Calender - II'] },
  IM01: { name: 'Lam-1', dt_aliases: ['Lam -1', 'LAMINATION - I'] },
  IM02: { name: 'Lam-2', dt_aliases: ['Lam -2', 'LAMINATION - II'] },
  IM03: { name: 'Lam-3', dt_aliases: ['Lam -3', 'LAMINATION - III'] },
  IM04: { name: 'Lam-4', dt_aliases: ['Lam -4', 'LAMINATION - IV'] },
  PR01: { name: 'Printing', dt_aliases: ['Printing', 'PRINTING'] },
  BL01: { name: 'Blown', dt_aliases: ['Blown', 'BLOWN'] },
};

function sum<T>(arr: T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of arr) s += f(x) || 0;
  return s;
}

function safeNum(x: number | null | undefined): number { return typeof x === 'number' ? x : 0; }

export function dateRange(w: Warehouse) {
  const dates = w.production.map(r => r.prod_date).filter(Boolean) as string[];
  if (dates.length === 0) return { min: null, max: null };
  return { min: dates.slice().sort()[0], max: dates.slice().sort().slice(-1)[0] };
}

export function plantSummary(w: Warehouse) {
  const netKg = sum(w.production, r => safeNum(r.net_kg));
  const grossKg = sum(w.production, r => safeNum(r.gross_kg));
  const sqm = sum(w.production, r => safeNum(r.sqm));
  const scrapKg = sum(w.scrap, r => safeNum(r.quantity_kg));
  const downMin = sum(w.downtime, r => safeNum(r.minutes));
  return {
    rolls: w.production.length,
    net_kg: round(netKg, 1),
    gross_kg: round(grossKg, 1),
    sqm: round(sqm, 1),
    downtime_hrs: round(downMin / 60, 2),
    downtime_events: w.downtime.length,
    scrap_kg: round(scrapKg, 1),
    scrap_events: w.scrap.length,
    scrap_pct_of_net: netKg > 0 ? round(scrapKg / netKg * 100, 2) : null,
  };
}

export function machines(w: Warehouse) {
  const codes = Object.keys(MACHINE_MAP);
  return codes.map(code => {
    const meta = MACHINE_MAP[code];
    const prodRows = w.production.filter(r => r.machine === code);
    const dtRows = w.downtime.filter(r => meta.dt_aliases.includes(r.machine));
    const scrapRows = w.scrap.filter(r => r.machine === code);

    const netKg = sum(prodRows, r => safeNum(r.net_kg));
    const grossKg = sum(prodRows, r => safeNum(r.gross_kg));
    const sqm = sum(prodRows, r => safeNum(r.sqm));
    const daysActive = new Set(prodRows.map(r => r.prod_date).filter(Boolean)).size;
    const downHrs = sum(dtRows, r => safeNum(r.minutes)) / 60;
    const scrapKg = sum(scrapRows, r => safeNum(r.quantity_kg));
    return {
      code,
      name: meta.name,
      rolls: prodRows.length,
      days_active: daysActive,
      net_kg: round(netKg, 1),
      gross_kg: round(grossKg, 1),
      sqm: round(sqm, 1),
      downtime_hrs: round(downHrs, 2),
      downtime_events: dtRows.length,
      scrap_kg: round(scrapKg, 1),
      scrap_events: scrapRows.length,
      scrap_pct_of_net: netKg > 0 ? round(scrapKg / netKg * 100, 2) : null,
      throughput_kg_per_productive_hr: netKg > 0 ? round(netKg / Math.max(744 - downHrs, 1), 1) : null,
    };
  });
}

export function downtimeByReason(w: Warehouse, aliases?: string[]) {
  const rows = aliases ? w.downtime.filter(r => aliases.includes(r.machine)) : w.downtime;
  const acc = new Map<string, { hrs: number; events: number }>();
  for (const r of rows) {
    const k = r.concluded || 'Unclassified';
    const cur = acc.get(k) || { hrs: 0, events: 0 };
    cur.hrs += safeNum(r.minutes) / 60;
    cur.events += 1;
    acc.set(k, cur);
  }
  return Array.from(acc.entries())
    .map(([reason, v]) => ({ reason, hrs: round(v.hrs, 2), events: v.events }))
    .sort((a, b) => b.hrs - a.hrs);
}

function fallbackReason(mat: string | null): string {
  if (!mat) return '(no reason logged)';
  let md = mat.trim();
  if (md.toUpperCase().startsWith('SCRAP ')) md = md.slice(6);
  return `(no reason) ${md}`;
}

export function scrapByReason(w: Warehouse, machine?: string, limit = 15) {
  const rows = machine ? w.scrap.filter(r => r.machine === machine) : w.scrap;
  const acc = new Map<string, { kg: number; events: number }>();
  for (const r of rows) {
    const rd = (r.rejection_desc || '').trim();
    const label = rd || fallbackReason(r.material_desc);
    const cur = acc.get(label) || { kg: 0, events: 0 };
    cur.kg += safeNum(r.quantity_kg);
    cur.events += 1;
    acc.set(label, cur);
  }
  return Array.from(acc.entries())
    .map(([reason, v]) => ({ reason, kg: round(v.kg, 1), events: v.events }))
    .sort((a, b) => b.kg - a.kg)
    .slice(0, limit);
}

export function topMaterials(w: Warehouse, machine?: string, limit = 10) {
  const rows = machine ? w.production.filter(r => r.machine === machine) : w.production;
  const acc = new Map<string, { kg: number; rolls: number }>();
  for (const r of rows) {
    const k = r.material_desc || '(unknown)';
    const cur = acc.get(k) || { kg: 0, rolls: 0 };
    cur.kg += safeNum(r.net_kg);
    cur.rolls += 1;
    acc.set(k, cur);
  }
  return Array.from(acc.entries())
    .map(([mat, v]) => ({ mat, kg: round(v.kg, 1), rolls: v.rolls }))
    .sort((a, b) => b.kg - a.kg)
    .slice(0, limit);
}

export function dailySeries(w: Warehouse, kind: 'production' | 'downtime' | 'scrap', machine?: string, aliases?: string[]) {
  const acc = new Map<string, number>();
  if (kind === 'production') {
    for (const r of w.production) {
      if (machine && r.machine !== machine) continue;
      if (!r.prod_date) continue;
      const d = normalizeDate(r.prod_date);
      acc.set(d, (acc.get(d) || 0) + safeNum(r.net_kg));
    }
  } else if (kind === 'scrap') {
    for (const r of w.scrap) {
      if (machine && r.machine !== machine) continue;
      if (!r.posting_date) continue;
      const d = normalizeDate(r.posting_date);
      acc.set(d, (acc.get(d) || 0) + safeNum(r.quantity_kg));
    }
  } else {
    for (const r of w.downtime) {
      if (aliases && !aliases.includes(r.machine)) continue;
      if (!r.event_date) continue;
      const d = normalizeDate(r.event_date);
      acc.set(d, (acc.get(d) || 0) + safeNum(r.minutes) / 60);
    }
  }
  return Array.from(acc.entries())
    .map(([d, v]) => ({ d, v: round(v, 2) }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

export function machineDetail(w: Warehouse, code: string) {
  const meta = MACHINE_MAP[code] || { name: code, dt_aliases: [code] };
  const summary = machines(w).find(m => m.code === code) || null;
  return {
    code,
    name: meta.name,
    summary,
    downtime_reasons: downtimeByReason(w, meta.dt_aliases),
    scrap_reasons: scrapByReason(w, code, 15),
    top_materials: topMaterials(w, code, 10),
    daily_production: dailySeries(w, 'production', code),
    daily_scrap: dailySeries(w, 'scrap', code),
    daily_downtime: dailySeries(w, 'downtime', undefined, meta.dt_aliases),
  };
}

function normalizeDate(d: string): string {
  const s = String(d).split(' ')[0];
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length === 3) {
      const [dd, mm, yy] = parts;
      return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }
  return s;
}

function round(n: number, decimals: number): number {
  const p = Math.pow(10, decimals);
  return Math.round(n * p) / p;
}
