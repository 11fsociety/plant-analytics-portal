/** Ingest: parse an Excel file (from ArrayBuffer or URL) into normalized rows. */
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

export function detectKind(wb: XLSX.WorkBook): IngestResult['kind'] {
  if (wb.SheetNames.some(s => s.toLowerCase() === 'detail')) {
    return 'downtime';
  }
  const first = wb.Sheets[wb.SheetNames[0]];
  if (!first) return null;
  const rows = XLSX.utils.sheet_to_json<any>(first, { header: 1, range: 0, defval: null });
  if (!rows.length) return null;
  const header = rows[0] as any[];
  const cols = new Set(header.map(c => String(c).trim()));
  if (SCRAP_KEYS.every(k => cols.has(k))) return 'scrap';
  if (CAL_PROD_KEYS.every(k => cols.has(k))) return 'cal_prod';
  if (LAM_PROD_KEYS.every(k => cols.has(k))) return 'lam_prod';
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
  return rows.map((r, i) => ({
    machine: toStr(r['Machine']) || 'UNKNOWN',
    prod_date: toDate(r['CreatDate'] ?? r['Posting Date']),
    roll_id: toStr(r['Batch']),
    order_no: toStr(r['Order']),
    material: toStr(r['Material']),
    material_desc: toStr(r['Material Description']),
    width: toNum(r['Width of Roll']),
    length: toNum(r['Length of Roll.']) ?? toNum(r['Length of Roll']),
    sqm: toNum(r['Sq Mtr']),
    net_kg: toNum(r['Quantity']),
    gross_kg: toNum(r['Gross wt.']),
    source_file: source,
    row_hash: sha256('lam_prod', fsha, i),
  }));
}

function parseCalProd(wb: XLSX.WorkBook, source: string, fsha: string): ProductionRow[] {
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sh, { defval: null });
  return rows.map((r, i) => ({
    machine: toStr(r['Machine']) || 'UNKNOWN',
    prod_date: toDate(r['Production date']),
    roll_id: toStr(r['Roll No']),
    order_no: toStr(r['Order']),
    material: toStr(r['Material']),
    material_desc: toStr(r['Material Description']),
    width: toNum(r['Width of Roll']),
    length: toNum(r['Length of Roll']),
    sqm: toNum(r['Sq Mtr']),
    net_kg: toNum(r['Net Wt.']),
    gross_kg: toNum(r['Gross wt.']),
    source_file: source,
    row_hash: sha256('cal_prod', fsha, i),
  }));
}

function parseScrap(wb: XLSX.WorkBook, source: string, fsha: string): ScrapRow[] {
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sh, { defval: null });
  return rows.map((r, i) => ({
    machine: toStr(r['Machine Name']) || 'UNKNOWN',
    entry_date: toDate(r['Entry Date']),
    posting_date: toDate(r['Posting Date']),
    order_no: toStr(r['Order']),
    material: toStr(r['Material']),
    material_desc: toStr(r['Material Description']),
    rejection_desc: toStr(r['Rejection Description']),
    quantity_kg: toNum(r['Quantity']),
    source_file: source,
    row_hash: sha256('scrap', fsha, i),
  }));
}

function parseDowntime(wb: XLSX.WorkBook, source: string, fsha: string): DowntimeRow[] {
  const detailName = wb.SheetNames.find(s => s.toLowerCase() === 'detail');
  if (!detailName) return [];
  const sh = wb.Sheets[detailName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
  const out: DowntimeRow[] = [];
  // Row 12 (index) has machine block labels; row 13 has subheaders per block.
  const HEADER_ROW = 12;
  const SUBHEADER_ROW = 13;
  const DATA_START = 14;
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
      out.push({
        machine: machineLabel,
        event_date: toStr(rows[r]?.[dateC]) ?? null,
        from_time: toStr(rows[r]?.[fromC]) ?? null,
        to_time: toStr(rows[r]?.[toC]) ?? null,
        minutes: mins,
        shift: toStr(rows[r]?.[shiftC]) ?? null,
        descriptive: desc,
        concluded: concl!,
        source_file: source,
        row_hash: sha256('downtime', fsha, col, r),
      });
    }
  }
  return out;
}
