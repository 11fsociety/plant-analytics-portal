/** Deterministic aggregations with shift filter + dynamic per-machine breakdowns. */
import type { Warehouse, ProductionRow, DowntimeRow, ScrapRow, Shift, Plant, MachineEntry } from './warehouse';

type MachineMeta = { name: string; dt_aliases: string[] };

export const MACHINE_MAPS: Record<Plant, Record<string, MachineMeta>> = {
  navratan: {
    CM01: { name: 'Calender-1', dt_aliases: ['Calender - 1', 'Calender - I'] },
    CM02: { name: 'Calender-2', dt_aliases: ['Calender - 2', 'Calender - II'] },
    IM01: { name: 'Lam-1', dt_aliases: ['Lam -1', 'LAMINATION - I'] },
    IM02: { name: 'Lam-2', dt_aliases: ['Lam -2', 'LAMINATION - II'] },
    IM03: { name: 'Lam-3', dt_aliases: ['Lam -3', 'LAMINATION - III'] },
    IM04: { name: 'Lam-4', dt_aliases: ['Lam -4', 'LAMINATION - IV'] },
    RP01: { name: 'Printing', dt_aliases: ['Printing', 'PRINTING'] },
    BU01: { name: 'Blown-U1', dt_aliases: ['Blown', 'BLOWN'] },
    BM01: { name: 'Blown-M1', dt_aliases: ['Blown', 'BLOWN'] },
  },
  uniworth: {},
};

/** Legacy export for backwards compatibility. Points to Navratan's machine map. */
export const MACHINE_MAP = MACHINE_MAPS.navratan;

export type ShiftFilter = 'A' | 'B' | 'all';
export type DateRange = { from: string | null; to: string | null };
export const NO_RANGE: DateRange = { from: null, to: null };

function safeNum(x: number | null | undefined): number { return typeof x === 'number' ? x : 0; }
function sum<T>(arr: T[], f: (x: T) => number): number { let s = 0; for (const x of arr) s += f(x) || 0; return s; }
function round(n: number, d: number): number { const p = 10 ** d; return Math.round(n * p) / p; }

/** Normalise a source date to ISO YYYY-MM-DD for range comparison. */
function isoDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = String(d).split(' ')[0];
  if (s.includes('.')) {
    const [dd, mm, yy] = s.split('.');
    if (dd && mm && yy) return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return s;
}

function inRange(dateStr: string | null | undefined, range: DateRange): boolean {
  if (!range || (!range.from && !range.to)) return true;
  const iso = isoDate(dateStr);
  if (!iso) return false;
  if (range.from && iso < range.from) return false;
  if (range.to && iso > range.to) return false;
  return true;
}

/** Filter helpers. Downtime shift can be 'a+b' (whole-day rows) — treat as both. */
function prodMatchesShift(r: ProductionRow, s: ShiftFilter): boolean { return s === 'all' || r.shift === s; }
function scrapMatchesShift(r: ScrapRow, s: ShiftFilter): boolean { return s === 'all' || r.shift === s; }
function dtMatchesShift(r: DowntimeRow, s: ShiftFilter): boolean {
  if (s === 'all') return true;
  const raw = (r.shift || '').trim().toUpperCase();
  if (raw === s) return true;
  if (raw === 'A+B' || raw === 'AB') return true; // whole-day event applies to both shifts
  return false;
}
function prodMatches(r: ProductionRow, s: ShiftFilter, range: DateRange): boolean { return prodMatchesShift(r, s) && inRange(r.prod_date, range); }
function scrapMatches(r: ScrapRow, s: ShiftFilter, range: DateRange): boolean { return scrapMatchesShift(r, s) && inRange(r.posting_date, range); }
function dtMatches(r: DowntimeRow, s: ShiftFilter, range: DateRange): boolean { return dtMatchesShift(r, s) && inRange(r.event_date, range); }

export function dateRange(w: Warehouse) {
  const dates = w.production.map(r => r.prod_date).filter(Boolean) as string[];
  if (dates.length === 0) return { min: null, max: null };
  const sorted = dates.slice().sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

export function plantSummary(w: Warehouse, shift: ShiftFilter = 'all', range: DateRange = NO_RANGE) {
  const prod = w.production.filter(r => prodMatches(r, shift, range));
  const scrap = w.scrap.filter(r => scrapMatches(r, shift, range));
  const dt = w.downtime.filter(r => dtMatches(r, shift, range));
  const netKg = sum(prod, r => safeNum(r.net_kg));
  const grossKg = sum(prod, r => safeNum(r.gross_kg));
  const sqm = sum(prod, r => safeNum(r.sqm));
  const scrapKg = sum(scrap, r => safeNum(r.quantity_kg));
  const downMin = sum(dt, r => safeNum(r.minutes));
  return {
    rolls: prod.length,
    net_kg: round(netKg, 1),
    gross_kg: round(grossKg, 1),
    sqm: round(sqm, 1),
    downtime_hrs: round(downMin / 60, 2),
    downtime_events: dt.length,
    scrap_kg: round(scrapKg, 1),
    scrap_events: scrap.length,
    scrap_pct_of_net: netKg > 0 ? round(scrapKg / netKg * 100, 2) : null,
  };
}

/** Total hours in the (filtered or full-data) window. Date-range aware. */
function windowHours(w: Warehouse, range: DateRange): number {
  let from = range.from;
  let to = range.to;
  if (!from || !to) {
    // No filter → span full data window from the warehouse
    const dates = w.production.map(r => isoDate(r.prod_date)).filter(Boolean) as string[];
    if (dates.length === 0) return 744; // sensible default (July)
    const sorted = dates.slice().sort();
    from = from || sorted[0];
    to = to || sorted[sorted.length - 1];
  }
  const f = new Date(from as string);
  const t = new Date(to as string);
  const days = Math.floor((t.getTime() - f.getTime()) / 86400000) + 1;
  return Math.max(days * 24, 1);
}

/** Count sequential job transitions on a machine.
 * Sort rows by (prod_date, creat_time), count every time order_no changes. */
function jobTransitions(rows: ProductionRow[]): number {
  const sorted = rows.slice().sort((a, b) => {
    const da = a.prod_date || '';
    const db = b.prod_date || '';
    if (da !== db) return da < db ? -1 : 1;
    const ta = a.creat_time || '';
    const tb = b.creat_time || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  let transitions = 0;
  let prev: string | null = null;
  for (const r of sorted) {
    const o = (r.order_no || '').trim();
    if (!o) continue;
    if (prev !== null && o !== prev) transitions++;
    prev = o;
  }
  return transitions;
}

export function machines(w: Warehouse, shift: ShiftFilter = 'all', range: DateRange = NO_RANGE, plant: Plant = 'navratan') {
  const totalHrs = windowHours(w, range);
  const staticMap = MACHINE_MAPS[plant] || {};
  const dynamicMap = w.machine_map || {};

  // Union of static and dynamic codes
  const allCodes = Array.from(new Set([...Object.keys(staticMap), ...Object.keys(dynamicMap)]));

  return allCodes.map(code => {
    // Prefer static metadata, fallback to dynamic
    const meta = staticMap[code] || dynamicMap[code] || { name: code, dt_aliases: [code] };
    const prod = w.production.filter(r => r.machine === code && prodMatches(r, shift, range));
    const dt = w.downtime.filter(r => meta.dt_aliases.includes(r.machine) && dtMatches(r, shift, range));
    const scrap = w.scrap.filter(r => r.machine === code && scrapMatches(r, shift, range));
    const netKg = sum(prod, r => safeNum(r.net_kg));
    const grossKg = sum(prod, r => safeNum(r.gross_kg));
    const sqm = sum(prod, r => safeNum(r.sqm));
    const totalLengthM = sum(prod, r => safeNum(r.length));
    const daysActive = new Set(prod.map(r => r.prod_date).filter(Boolean)).size;
    const downHrs = sum(dt, r => safeNum(r.minutes)) / 60;
    const scrapKg = sum(scrap, r => safeNum(r.quantity_kg));
    const productiveHrs = Math.max(totalHrs - downHrs, 1);
    const productiveMin = productiveHrs * 60;
    // Job stats
    const distinctOrders = new Set(prod.map(r => (r.order_no || '').trim()).filter(Boolean)).size;
    const jobChanges = jobTransitions(prod);
    return {
      code,
      name: meta.name,
      rolls: prod.length,
      days_active: daysActive,
      net_kg: round(netKg, 1),
      gross_kg: round(grossKg, 1),
      sqm: round(sqm, 1),
      total_length_m: round(totalLengthM, 1),
      downtime_hrs: round(downHrs, 2),
      downtime_events: dt.length,
      scrap_kg: round(scrapKg, 1),
      scrap_events: scrap.length,
      scrap_pct_of_net: netKg > 0 ? round(scrapKg / netKg * 100, 2) : null,
      throughput_kg_per_productive_hr: netKg > 0 ? round(netKg / productiveHrs, 1) : null,
      // Line speed: metres of film per minute. Correct industrial semantic.
      speed_metres_per_min: totalLengthM > 0 ? round(totalLengthM / productiveMin, 2) : null,
      // Retained for reference / anyone who wants area-per-hour instead
      speed_sqm_per_productive_hr: sqm > 0 ? round(sqm / productiveHrs, 1) : null,
      window_hrs: round(totalHrs, 2),
      productive_hrs: round(productiveHrs, 2),
      distinct_orders: distinctOrders,
      job_changes: jobChanges,
    };
  });
}

export function downtimeByReason(w: Warehouse, aliases: string[] | undefined, shift: ShiftFilter, granular: boolean = false, range: DateRange = NO_RANGE) {
  const rows = w.downtime.filter(r => (!aliases || aliases.includes(r.machine)) && dtMatches(r, shift, range));
  const acc = new Map<string, { hrs: number; events: number }>();
  for (const r of rows) {
    const k = granular ? (r.brief_sub_reason || r.concluded || 'Unclassified') : (r.concluded || 'Unclassified');
    const cur = acc.get(k) || { hrs: 0, events: 0 };
    cur.hrs += safeNum(r.minutes) / 60;
    cur.events += 1;
    acc.set(k, cur);
  }
  return Array.from(acc.entries())
    .map(([reason, v]) => ({ reason, hrs: round(v.hrs, 2), events: v.events }));
}

export function downtimeSortedByHours(w: Warehouse, aliases: string[] | undefined, shift: ShiftFilter, granular = true, range: DateRange = NO_RANGE) {
  return downtimeByReason(w, aliases, shift, granular, range).sort((a, b) => b.hrs - a.hrs);
}

export function downtimeSortedByEvents(w: Warehouse, aliases: string[] | undefined, shift: ShiftFilter, granular = true, range: DateRange = NO_RANGE) {
  return downtimeByReason(w, aliases, shift, granular, range).sort((a, b) => b.events - a.events);
}

function fallbackReason(mat: string | null): string {
  if (!mat) return '(no reason logged)';
  let md = mat.trim();
  if (md.toUpperCase().startsWith('SCRAP ')) md = md.slice(6);
  return `(no reason) ${md}`;
}

export function scrapByReason(w: Warehouse, machine: string | undefined, shift: ShiftFilter, range: DateRange = NO_RANGE, limit = 15) {
  const rows = w.scrap.filter(r => (!machine || r.machine === machine) && scrapMatches(r, shift, range));
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

export function topMaterials(w: Warehouse, machine: string | undefined, shift: ShiftFilter, range: DateRange = NO_RANGE, limit = 10) {
  const rows = w.production.filter(r => (!machine || r.machine === machine) && prodMatches(r, shift, range));
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

/** Generic breakdown of production kg + rolls by any string/number field. */
export function productionByField(
  w: Warehouse,
  machine: string | undefined,
  field: keyof ProductionRow,
  shift: ShiftFilter,
  binningForNumbers?: 'width' | 'microns' | 'thickness',
  limit = 20,
  range: DateRange = NO_RANGE,
) {
  const rows = w.production.filter(r => (!machine || r.machine === machine) && prodMatches(r, shift, range));
  const acc = new Map<string, { kg: number; rolls: number; sqm: number }>();
  for (const r of rows) {
    const raw = (r as any)[field];
    let key: string;
    if (raw == null || raw === '' || raw === 0) continue;
    if (typeof raw === 'number' && binningForNumbers) {
      key = String(raw);
    } else {
      key = String(raw).trim();
      if (!key) continue;
    }
    const cur = acc.get(key) || { kg: 0, rolls: 0, sqm: 0 };
    cur.kg += safeNum(r.net_kg);
    cur.rolls += 1;
    cur.sqm += safeNum(r.sqm);
    acc.set(key, cur);
  }
  return Array.from(acc.entries())
    .map(([k, v]) => ({ key: k, kg: round(v.kg, 1), rolls: v.rolls, sqm: round(v.sqm, 1) }))
    .sort((a, b) => b.kg - a.kg)
    .slice(0, limit);
}

/** Production/scrap/downtime split A vs B for a machine. */
export function shiftSplit(w: Warehouse, machine: string | undefined, aliases: string[] | undefined, range: DateRange = NO_RANGE) {
  const prod = w.production.filter(r => (!machine || r.machine === machine) && inRange(r.prod_date, range));
  const scrap = w.scrap.filter(r => (!machine || r.machine === machine) && inRange(r.posting_date, range));
  const dt = w.downtime.filter(r => (!aliases || aliases.includes(r.machine)) && inRange(r.event_date, range));
  const out = {
    A: { rolls: 0, net_kg: 0, scrap_kg: 0, downtime_hrs: 0, downtime_events: 0 },
    B: { rolls: 0, net_kg: 0, scrap_kg: 0, downtime_hrs: 0, downtime_events: 0 },
    unknown: { rolls: 0, net_kg: 0, scrap_kg: 0, downtime_hrs: 0, downtime_events: 0 },
  };
  for (const r of prod) {
    const s = r.shift as ('A' | 'B' | null);
    const bucket = s === 'A' ? out.A : s === 'B' ? out.B : out.unknown;
    bucket.rolls += 1;
    bucket.net_kg += safeNum(r.net_kg);
  }
  for (const r of scrap) {
    const s = r.shift as ('A' | 'B' | null);
    const bucket = s === 'A' ? out.A : s === 'B' ? out.B : out.unknown;
    bucket.scrap_kg += safeNum(r.quantity_kg);
  }
  for (const r of dt) {
    const rawShift = (r.shift || '').trim().toUpperCase();
    if (rawShift === 'A') { out.A.downtime_hrs += r.minutes / 60; out.A.downtime_events += 1; }
    else if (rawShift === 'B') { out.B.downtime_hrs += r.minutes / 60; out.B.downtime_events += 1; }
    else if (rawShift === 'A+B' || rawShift === 'AB') {
      out.A.downtime_hrs += r.minutes / 120; out.B.downtime_hrs += r.minutes / 120;
      out.A.downtime_events += 1; out.B.downtime_events += 1;
    } else { out.unknown.downtime_hrs += r.minutes / 60; out.unknown.downtime_events += 1; }
  }
  for (const k of Object.keys(out) as Array<'A' | 'B' | 'unknown'>) {
    const v = out[k];
    (v as any).net_kg = round(v.net_kg, 1);
    (v as any).scrap_kg = round(v.scrap_kg, 1);
    (v as any).downtime_hrs = round(v.downtime_hrs, 2);
  }
  return out;
}

export function dailySeries(w: Warehouse, kind: 'production' | 'downtime' | 'scrap', machine: string | undefined, aliases: string[] | undefined, shift: ShiftFilter, range: DateRange = NO_RANGE) {
  const acc = new Map<string, number>();
  if (kind === 'production') {
    for (const r of w.production) {
      if (machine && r.machine !== machine) continue;
      if (!prodMatches(r, shift, range)) continue;
      if (!r.prod_date) continue;
      const d = normalizeDate(r.prod_date);
      acc.set(d, (acc.get(d) || 0) + safeNum(r.net_kg));
    }
  } else if (kind === 'scrap') {
    for (const r of w.scrap) {
      if (machine && r.machine !== machine) continue;
      if (!scrapMatches(r, shift, range)) continue;
      if (!r.posting_date) continue;
      const d = normalizeDate(r.posting_date);
      acc.set(d, (acc.get(d) || 0) + safeNum(r.quantity_kg));
    }
  } else {
    for (const r of w.downtime) {
      if (aliases && !aliases.includes(r.machine)) continue;
      if (!dtMatches(r, shift, range)) continue;
      if (!r.event_date) continue;
      const d = normalizeDate(r.event_date);
      acc.set(d, (acc.get(d) || 0) + safeNum(r.minutes) / 60);
    }
  }
  return Array.from(acc.entries())
    .map(([d, v]) => ({ d, v: round(v, 2) }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

/** Which dynamic sections should be shown for this machine? Based on non-null coverage of source columns. */
export function columnAvailability(w: Warehouse, machine: string) {
  const rows = w.production.filter(r => r.machine === machine);
  const has = (field: keyof ProductionRow) => rows.some(r => (r as any)[field] != null && (r as any)[field] !== '');
  return {
    quality_name: has('quality_name'),
    group_name: has('group_name'),
    packtype: has('packtype'),
    microns: has('microns'),
    thickness_board: has('thickness_board'),
    gsm_micron: has('gsm_micron'),
    gsm_name_micron: has('gsm_name_micron'),
    grade: has('grade'),
    planned_gsm: has('planned_gsm'),
    actual_gsm_name: has('actual_gsm_name'),
    operator: has('operator'),
    color: has('color'),
    design: has('design'),
    width: has('width'),
    shift: has('shift'),
  };
}

/** Resolve machine metadata from static or dynamic maps, fallback to code itself. */
export function resolveMachineMeta(
  w: Warehouse,
  code: string,
  plant: Plant = 'navratan',
): { name: string; dt_aliases: string[] } {
  const staticEntry = MACHINE_MAPS[plant]?.[code];
  const dynamicEntry = w.machine_map?.[code];
  if (staticEntry) return staticEntry;
  if (dynamicEntry) return { name: dynamicEntry.name, dt_aliases: dynamicEntry.dt_aliases };
  return { name: code, dt_aliases: [code] };
}

export function machineDetail(w: Warehouse, code: string, shift: ShiftFilter = 'all', range: DateRange = NO_RANGE, plant: Plant = 'navratan') {
  const meta = resolveMachineMeta(w, code, plant);

  const summary = machines(w, shift, range, plant).find(m => m.code === code) || null;
  const availability = columnAvailability(w, code);

  // Only compute breakdowns for columns that actually have data on this machine
  const breakdowns: Record<string, Array<{ key: string; kg: number; rolls: number; sqm: number }>> = {};
  if (availability.group_name) breakdowns.by_group = productionByField(w, code, 'group_name', shift, undefined, 20, range);
  if (availability.quality_name) breakdowns.by_quality = productionByField(w, code, 'quality_name', shift, undefined, 20, range);
  if (availability.grade) breakdowns.by_grade = productionByField(w, code, 'grade', shift, undefined, 20, range);
  if (availability.packtype) breakdowns.by_packtype = productionByField(w, code, 'packtype', shift, undefined, 20, range);
  if (availability.gsm_micron) breakdowns.by_gsm_micron = productionByField(w, code, 'gsm_micron', shift, undefined, 20, range);
  if (availability.gsm_name_micron) breakdowns.by_gsm_name = productionByField(w, code, 'gsm_name_micron', shift, undefined, 20, range);
  if (availability.actual_gsm_name) breakdowns.by_actual_gsm = productionByField(w, code, 'actual_gsm_name', shift, undefined, 20, range);
  if (availability.microns) breakdowns.by_microns = productionByField(w, code, 'microns', shift, 'microns', 20, range);
  if (availability.thickness_board) breakdowns.by_thickness = productionByField(w, code, 'thickness_board', shift, 'thickness', 20, range);
  if (availability.operator) breakdowns.by_operator = productionByField(w, code, 'operator', shift, undefined, 20, range);
  if (availability.width) breakdowns.by_width = productionByField(w, code, 'width', shift, 'width', 20, range);

  return {
    code,
    name: meta.name,
    summary,
    downtime_by_hours: downtimeSortedByHours(w, meta.dt_aliases, shift, true, range),
    downtime_by_events: downtimeSortedByEvents(w, meta.dt_aliases, shift, true, range),
    downtime_broad: downtimeSortedByHours(w, meta.dt_aliases, shift, false, range),
    scrap_reasons: scrapByReason(w, code, shift, range, 15),
    top_materials: topMaterials(w, code, shift, range, 10),
    daily_production: dailySeries(w, 'production', code, undefined, shift, range),
    daily_scrap: dailySeries(w, 'scrap', code, undefined, shift, range),
    daily_downtime: dailySeries(w, 'downtime', undefined, meta.dt_aliases, shift, range),
    shift_split: shiftSplit(w, code, meta.dt_aliases, range),
    availability,
    breakdowns,
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
