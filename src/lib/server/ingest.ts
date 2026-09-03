/** Ingest: parse an Excel file (from ArrayBuffer or URL) into normalized rows.
 *  MIRROR of plant-analytics/lib/ingest.ts. row_hash formula MUST stay in sync with
 *  the main app — dedup breaks otherwise. If you edit this file, edit both. */
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import type { ProductionRow, DowntimeRow, ScrapRow } from './warehouse';

export type IngestResult = {
  kind: 'lam_prod' | 'cal_prod' | 'scrap' | 'downtime' | null;
  production?: ProductionRow[];
  downtime?: DowntimeRow[];
  scrap?: ScrapRow[];
  error?: string;
  source_name: string;
};

const LAM_PROD_KEYS = ['Order', 'CreatDate', 'Material', 'Quantity', 'Gross wt.', 'Sq Mtr'];
const CAL_PROD_KEYS = ['Production date', 'Net Wt.', 'Gross wt.', 'Machine', 'Sq Mtr'];
const SCRAP_KEYS = ['Rejection Description', 'Machine Name', 'Quantity', 'Posting Date'];

function sha256(...parts: (string | number | null | undefined)[]): string {
  const s = parts.map(p => (p == null ? '' : String(p))).join('|');
  return crypto.createHash('sha256').update(s).digest('hex');
}

function fileSha(buf: ArrayBuffer): string {
  return crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

function toDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // Try native parse
  const p = new Date(s);
  if (!isNaN(p.getTime())) return p.toISOString().slice(0, 10);
  return s;
}

function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === 'nan' ? null : s;
}

/** Read a time-of-day cell.
 * Excel stores time-only cells as fractional days (0.75 = 18:00:00).
 * Some cells arrive as strings "18:48:25" - keep as-is.
 * Returns HH:MM:SS or null. */
function toTime(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v >= 0 && v < 2) {
    const frac = v - Math.floor(v);
    const secs = Math.round(frac * 86400);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (!s || s === 'nan') return null;
  return s;
}

/** Derive shift from HH:MM:SS string.
 * 07:00:00 ≤ t < 19:00:00 → A (day), else B (night).
 * Sharp boundaries: 07:00 is A, 19:00 is B (shift starts at the boundary). */
function deriveShift(timeStr: string | null): 'A' | 'B' | null {
  if (!timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  const totalMin = h * 60 + mi;
  return (totalMin >= 420 && totalMin < 1140) ? 'A' : 'B';
}

/** Prefer explicit Shift column value; fall back to derivation. */
function normalizeShift(rawShift: string | null, timeStr: string | null): 'A' | 'B' | null {
  const s = (rawShift || '').trim().toUpperCase();
  if (s === 'A') return 'A';
  if (s === 'B') return 'B';
  return deriveShift(timeStr);
}

export function detectKind(wb: XLSX.WorkBook): IngestResult['kind'] {
  // Downtime workbooks always have a REASON tab in both July'26 and Aug'26.
  // July also has 'Detail'; Aug renames it to 'Sheet'. Match on REASON (stable),
  // and fall back to 'Detail' for older files that might lack REASON.
  const lower = (s: string) => s.toLowerCase();
  const hasReason = wb.SheetNames.some(s => lower(s) === 'reason');
  const hasDetail = wb.SheetNames.some(s => lower(s) === 'detail');
  if (hasReason || hasDetail) return 'downtime';
  const first = wb.Sheets[wb.SheetNames[0]];
  if (!first) return null;
  const rows = XLSX.utils.sheet_to_json<any>(first, { header: 1, range: 0, defval: null });
  if (!rows.length) return null;
  const header = rows[0] as any[];
  const cols = new Set(header.map(c => String(c).trim()));
  if (SCRAP_KEYS.every(k => cols.has(k))) return 'scrap';
  if (CAL_PROD_KEYS.every(k => cols.has(k))) return 'cal_prod';
  if (LAM_PROD_KEYS.every(k => cols.has(k))) return 'lam_prod';
  // Relaxed LAM fallback: some months' exports drop `Quantity` and/or `Sq Mtr`
  // (e.g. FLOORING LAM JUNE 2026 lacks Quantity). Accept as LAM if the workbook
  // has the core LAM-shape markers even when strict LAM_PROD_KEYS misses.
  const LAM_CORE = ['Order', 'CreatDate', 'Material', 'Gross wt.'];
  if (LAM_CORE.every(k => cols.has(k))) return 'lam_prod';
  return null;
}

export async function ingestBuffer(buf: ArrayBuffer, sourceName: string): Promise<IngestResult> {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const kind = detectKind(wb);
  if (!kind) return { kind: null, error: 'unrecognized schema', source_name: sourceName };
  const fsha = fileSha(buf);
  switch (kind) {
    case 'lam_prod':
      return { kind, production: parseLamProd(wb, sourceName, fsha), source_name: sourceName };
    case 'cal_prod':
      return { kind, production: parseCalProd(wb, sourceName, fsha), source_name: sourceName };
    case 'scrap':
      return { kind, scrap: parseScrap(wb, sourceName, fsha), source_name: sourceName };
    case 'downtime':
      return { kind, downtime: parseDowntime(wb, sourceName, fsha), source_name: sourceName };
  }
}

function parseLamProd(wb: XLSX.WorkBook, source: string, fsha: string): ProductionRow[] {
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sh, { defval: null });
  return rows.map((r, i) => {
    const creatTime = toTime(r['CreatTime']);
    return {
      machine: toStr(r['Machine']) || 'UNKNOWN',
      prod_date: toDate(r['CreatDate'] ?? r['Posting Date']),
      creat_time: creatTime,
      shift: normalizeShift(toStr(r['Shift']), creatTime),
      roll_id: toStr(r['Batch']),
      order_no: toStr(r['Order']),
      material: toStr(r['Material']),
      material_desc: toStr(r['Material Description']),
      width: toNum(r['Width of Roll']),
      length: toNum(r['Length of Roll.']) ?? toNum(r['Length of Roll']),
      sqm: toNum(r['Sq Mtr']),
      net_kg: toNum(r['Quantity']),
      gross_kg: toNum(r['Gross wt.']),
      quality_name: toStr(r['Quality name']),                  // Lam-1&2 only
      group_name: toStr(r['Group']),                            // Lam-1&2 only
      packtype: toStr(r['PACKTYPE']),
      microns: toNum(r['MICRONS']),
      thickness_board: toNum(r['Thickness of Board']),
      gsm_micron: toStr(r['GSM//Micron']),
      gsm_name_micron: toStr(r['GSMNAME/Micron']),              // Lam-3 only
      grade: toStr(r['GRAD']) ?? toStr(r['Grade']),
      planned_gsm: null,
      actual_gsm_name: null,
      operator: null,
      color: toStr(r['COLOR']) ?? toStr(r['Colour']),
      design: toStr(r['Design']),
      source_file: source,
      row_hash: sha256('lam_prod', fsha, i),
    };
  });
}

function parseCalProd(wb: XLSX.WorkBook, source: string, fsha: string): ProductionRow[] {
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sh, { defval: null });
  return rows.map((r, i) => {
    const creatTime = toTime(r['CreatTime']);
    // Actual GSM label lives under 3 possible column names across the Cal files
    const actualGsm = toStr(r['Actual GSM Name']) ?? toStr(r['Actual GSM/Micron']) ?? toStr(r['Actual Avg. GSM Value']) ?? toStr(r['Actual Avg Gsm']);
    return {
      machine: toStr(r['Machine']) || 'UNKNOWN',
      prod_date: toDate(r['Production date']),
      creat_time: creatTime,
      shift: normalizeShift(toStr(r['Shift']), creatTime),
      roll_id: toStr(r['Roll No']),
      order_no: toStr(r['Order']),
      material: toStr(r['Material']),
      material_desc: toStr(r['Material Description']),
      width: toNum(r['Width of Roll']),
      length: toNum(r['Length of Roll']),
      sqm: toNum(r['Sq Mtr']),
      net_kg: toNum(r['Net Wt.']),
      gross_kg: toNum(r['Gross wt.']),
      quality_name: null,
      group_name: null,
      packtype: null,
      microns: null,
      thickness_board: null,
      gsm_micron: null,
      gsm_name_micron: null,
      grade: toStr(r['Grade']),
      planned_gsm: toStr(r['Planned GSM']),
      actual_gsm_name: actualGsm,
      operator: toStr(r['Operator']),
      color: toStr(r['Colour']) ?? toStr(r['COLOR']),
      design: toStr(r['Design']),
      source_file: source,
      row_hash: sha256('cal_prod', fsha, i),
    };
  });
}

function parseScrap(wb: XLSX.WorkBook, source: string, fsha: string): ScrapRow[] {
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sh, { defval: null });
  return rows.map((r, i) => {
    const entryTime = toTime(r['Time of Entry']);
    return {
      machine: toStr(r['Machine Name']) || 'UNKNOWN',
      entry_date: toDate(r['Entry Date']),
      entry_time: entryTime,
      posting_date: toDate(r['Posting Date']),
      shift: deriveShift(entryTime),
      order_no: toStr(r['Order']),
      material: toStr(r['Material']),
      material_desc: toStr(r['Material Description']),
      rejection_desc: toStr(r['Rejection Description']),
      quantity_kg: toNum(r['Quantity']),
      source_file: source,
      row_hash: sha256('scrap', fsha, i),
    };
  });
}

function parseDowntime(wb: XLSX.WorkBook, source: string, fsha: string): DowntimeRow[] {
  // The event-level sheet has been variously named "Detail" (July'26) or "Sheet" (Aug'26).
  // Prefer an exact match; otherwise take any tab that looks like an event grid
  // (i.e. row 13 has a 'Min' subheader — that's the marker of the event table).
  const lower = (s: string) => s.toLowerCase();
  let detailName = wb.SheetNames.find(s => lower(s) === 'detail')
                || wb.SheetNames.find(s => lower(s) === 'sheet')
                || wb.SheetNames.find(s => lower(s) !== 'reason' && lower(s) !== 'sheet1');
  if (!detailName) return [];
  const sh = wb.Sheets[detailName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  const out: DowntimeRow[] = [];
  // Dynamically locate the subheader row (the one containing 'Min' as a column
  // header) so we handle month-to-month layout drift. Historically:
  //   July/Aug/June/May 2026: SUBHEADER=13, so HEADER=12, DATA_START=14.
  //   April 2026: SUBHEADER=14, so HEADER=13, DATA_START=15 (one row shifted).
  // Scan rows 5..25 for a row that contains a cell whose trimmed lowercase value
  // is exactly 'min'. Fall back to the historical 13 if none found.
  let SUBHEADER_ROW = 13;
  for (let ri = 5; ri < Math.min(rows.length, 25); ri++) {
    const r = rows[ri] || [];
    const hasMin = r.some((v) => v && String(v).trim().toLowerCase() === 'min');
    if (hasMin) { SUBHEADER_ROW = ri; break; }
  }
  const HEADER_ROW = SUBHEADER_ROW - 1;
  const DATA_START = SUBHEADER_ROW + 1;
  if (rows.length <= DATA_START) return out;
  const blockStarts: Array<{ col: number; name: string }> = [];
  for (let c = 0; c < (rows[HEADER_ROW]?.length || 0); c++) {
    const v = rows[HEADER_ROW]?.[c];
    if (v && String(v).trim() && String(v).trim().toLowerCase() !== 'nan') {
      blockStarts.push({ col: c, name: String(v).trim() });
    }
  }
  for (const { col, name: machineLabel } of blockStarts) {
    const subCols: Record<string, number> = {};
    for (let c = col; c < Math.min(col + 12, (rows[SUBHEADER_ROW]?.length || 0)); c++) {
      const h = rows[SUBHEADER_ROW]?.[c];
      if (h && String(h).trim()) subCols[String(h).trim().toLowerCase()] = c;
    }
    const minC = subCols['min'];
    if (minC == null) continue;
    const dateC = subCols['date'];
    const fromC = subCols['from'] ?? subCols['from '];
    const toC = subCols['to'];
    const shiftC = subCols['shift'];
    const descC = subCols['descriptive reasons'];
    const briefC = subCols['brief sub reason'];
    const conclC = subCols['concluded reason'];

    for (let r = DATA_START; r < rows.length; r++) {
      const mins = toNum(rows[r]?.[minC]);
      if (mins == null || mins <= 0) continue;
      const desc = toStr(rows[r]?.[descC]);
      let concl = toStr(rows[r]?.[conclC]);
      const cLow = (concl || '').toLowerCase();
      if (cLow === 'management loss' || cLow === 'management loss ') concl = 'Management Loss';
      else if (cLow === 'production process') concl = 'Production Process';
      else if (cLow.includes('maintenance')) concl = 'Maintenance - Mechanical / Electrical';
      else if (!concl || cLow === 'nan') {
        const d = (desc || '').toLowerCase();
        if (d.includes('maintenance')) concl = 'Maintenance - Mechanical / Electrical';
        else if (d.includes('management')) concl = 'Management Loss';
        else concl = 'Production Process';
      }
      const briefRaw = toStr(rows[r]?.[briefC]);
      // Normalise variants seen in Sheet1 pivot: casing, trailing spaces, misspellings.
      let brief: string | null = briefRaw;
      if (brief) {
        const bl = brief.toLowerCase().trim();
        if (bl === 'management loss' || bl === 'management loss ') brief = 'Management Loss';
        else if (bl.startsWith('maintenance - mechanical') || bl === 'maintenance-mechanical') brief = 'Maintenance - Mechanical';
        else if (bl.startsWith('maintenance - electrical') || bl.startsWith('maintenance-elctrical') || bl.startsWith('maintenance-electrical')) brief = 'Maintenance - Electrical';
        else if (bl === 'maintenance-elctrical/mech.' || bl === 'maintenance - mech./electrical') brief = 'Maintenance - Mech./Elec.';
        else if (bl.startsWith('unavailability') || bl === 'unavailability of  rm / sfg') brief = 'Unavailability of RM/SFG';
        else if (bl === 'no sales planned') brief = 'No Sales Planned';
        else if (bl === 'manpower issue') brief = 'Manpower Issue';
        else if (bl === 'boiler issue') brief = 'Boiler Issue';
        else if (bl === 'change over') brief = 'Change Over';
        else if (bl === 'preventive maintenance') brief = 'Preventive Maintenance';
        else if (bl === 'production process') brief = 'Production Process';
        else brief = brief.trim();
      }
      out.push({
        machine: machineLabel,
        event_date: toDate(rows[r]?.[dateC]),
        from_time: toTime(rows[r]?.[fromC]),
        to_time: toTime(rows[r]?.[toC]),
        minutes: mins,
        shift: toStr(rows[r]?.[shiftC]) ?? null,
        descriptive: desc,
        brief_sub_reason: brief,
        concluded: concl!,
        source_file: source,
        row_hash: sha256('downtime', fsha, col, r),
      });
    }
  }
  return out;
}
