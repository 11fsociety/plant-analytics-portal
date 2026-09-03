#!/usr/bin/env node
// Probe the two files that failed ingest:
//   1. FLOORING LAM JUNE.XLSX — "unrecognized schema"
//   2. Machine wise-shift wise stoppage hrs for April = 26.xls — kind=downtime, inserted=0
// Reports sheet names + row-0 headers + spot-checks the downtime layout.
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const FILES = [
  { path: 'F:/Downloads/Dash board/Dash board/FLOORING LAM JUNE.XLSX', mode: 'lam_prod' },
  { path: 'F:/Downloads/Dash board/Dash board/FLOORING LAM MAY.XLSX', mode: 'lam_prod-ok' },
  { path: 'F:/Downloads/Dash board/Dash board/Machine wise-shift wise stoppage hrs for April = 26.xls', mode: 'downtime' },
  { path: 'F:/Downloads/Dash board/Dash board/Machine wise-shift wise stoppage hrs for June = 26.xls', mode: 'downtime-ok' },
];

const LAM_KEYS = ['Order', 'CreatDate', 'Material', 'Quantity', 'Gross wt.', 'Sq Mtr'];
const CAL_KEYS = ['Production date', 'Net Wt.', 'Gross wt.', 'Machine', 'Sq Mtr'];
const SCRAP_KEYS = ['Rejection Description', 'Machine Name', 'Quantity', 'Posting Date'];

for (const f of FILES) {
  console.log(`\n=== ${f.path} (${f.mode}) ===`);
  const buf = readFileSync(f.path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const wb = XLSX.read(ab, { type: 'array', cellDates: false });
  console.log(`sheets: ${wb.SheetNames.map(s => JSON.stringify(s)).join(', ')}`);
  if (f.mode.startsWith('lam_prod')) {
    const sh = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, range: 0, defval: null });
    const header0 = (rows[0] || []).map(String);
    console.log(`row0 headers (${header0.length}): ${header0.slice(0, 30).join(' | ')}`);
    console.log(`  LAM required: ${LAM_KEYS.map(k => `${k}=${header0.includes(k) ? 'YES' : 'NO'}`).join(', ')}`);
    console.log(`  CAL required: ${CAL_KEYS.map(k => `${k}=${header0.includes(k) ? 'YES' : 'NO'}`).join(', ')}`);
    console.log(`  SCRAP required: ${SCRAP_KEYS.map(k => `${k}=${header0.includes(k) ? 'YES' : 'NO'}`).join(', ')}`);
    console.log(`  total rows in sheet: ${rows.length}`);
  } else if (f.mode.startsWith('downtime')) {
    // Downtime parser reads row 12 (block header) + row 13 (subheaders)
    const detailName = wb.SheetNames.find(s => s.toLowerCase() === 'detail')
      || wb.SheetNames.find(s => s.toLowerCase() === 'sheet')
      || wb.SheetNames.find(s => s.toLowerCase() !== 'reason' && s.toLowerCase() !== 'sheet1');
    console.log(`detail sheet chosen: ${detailName || '(NONE)'}`);
    if (!detailName) continue;
    const sh = wb.Sheets[detailName];
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: null });
    console.log(`  detail total rows: ${rows.length}`);
    for (const rIdx of [10, 11, 12, 13, 14]) {
      const r = (rows[rIdx] || []).slice(0, 16).map(v => v == null ? '·' : String(v).slice(0, 20));
      console.log(`  row ${rIdx}: ${r.join(' | ')}`);
    }
    // Try to find where "Min" appears — that's the marker of the event table
    for (let ri = 0; ri < Math.min(rows.length, 30); ri++) {
      const r = rows[ri] || [];
      for (let ci = 0; ci < r.length; ci++) {
        if (r[ci] && String(r[ci]).trim().toLowerCase() === 'min') {
          console.log(`  'Min' subheader found at row ${ri}, col ${ci}`);
          break;
        }
      }
    }
  }
}
