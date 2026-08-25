/**
 * Seed: pre-populate the local warehouse from the July-26 Excel folder.
 *
 * Run:  npx tsx scripts/seed.ts
 *
 * Without BLOB_READ_WRITE_TOKEN in env, warehouse.ts falls back to
 * ./warehouse-local.json in the project cwd.
 */
import fs from 'fs';
import path from 'path';
import { ingestBuffer } from '../lib/ingest';
import {
  emptyWarehouse,
  loadWarehouse,
  saveWarehouse,
  mergeInto,
  type Warehouse,
} from '../lib/warehouse';

const SOURCE_DIR = 'D:\\codezzz\\Claude\\Prod. Wastage Down time for July-26';

const FILES = [
  'Machine wise-Break down hrs for July = 26.xls',
  'Prod. - Lam - 1 & 2.XLSX',
  'Prod. - Lam - 3.XLSX',
  'Prod. Cal - 2  Flex.XLSX',
  'Prod. Cal -1  Flooring ( Opaque + Top + Clear ran on Cal - 2 ).XLSX',
  'Scrap Generation for all Machines.XLSX',
];

function bufToArrayBuffer(buf: Buffer): ArrayBuffer {
  // Slice so we get a fresh ArrayBuffer aligned to this Buffer's view,
  // not the (potentially larger) pooled underlying buffer.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function main() {
  console.log('[seed] loading warehouse...');
  let w: Warehouse;
  try {
    w = await loadWarehouse();
  } catch (e) {
    console.warn('[seed] loadWarehouse failed, starting empty:', e);
    w = emptyWarehouse();
  }

  const startCounts = {
    production: w.production.length,
    downtime: w.downtime.length,
    scrap: w.scrap.length,
  };
  console.log('[seed] starting row counts:', startCounts);

  for (const filename of FILES) {
    const full = path.join(SOURCE_DIR, filename);
    if (!fs.existsSync(full)) {
      console.error(`[seed]   MISSING: ${full}`);
      continue;
    }
    const raw = fs.readFileSync(full);
    const ab = bufToArrayBuffer(raw);
    const result = await ingestBuffer(ab, filename);

    if (result.error || !result.kind) {
      console.error(`[seed]   FAIL ${filename}: ${result.error ?? 'no kind detected'}`);
      w.ingest_log.push({
        filename,
        kind: result.kind ?? 'unknown',
        inserted: 0,
        skipped: 0,
        at: new Date().toISOString(),
      });
      continue;
    }

    let inserted = 0;
    let skipped = 0;
    if (result.production && result.production.length) {
      const r = mergeInto(w.production, result.production);
      inserted += r.inserted;
      skipped += r.skipped;
    }
    if (result.downtime && result.downtime.length) {
      const r = mergeInto(w.downtime, result.downtime);
      inserted += r.inserted;
      skipped += r.skipped;
    }
    if (result.scrap && result.scrap.length) {
      const r = mergeInto(w.scrap, result.scrap);
      inserted += r.inserted;
      skipped += r.skipped;
    }

    w.ingest_log.push({
      filename,
      kind: result.kind,
      inserted,
      skipped,
      at: new Date().toISOString(),
    });
    console.log(`[seed]   ${filename}  kind=${result.kind}  +${inserted}  =${skipped}`);
  }

  console.log('[seed] saving warehouse...');
  await saveWarehouse(w);

  const endCounts = {
    production: w.production.length,
    downtime: w.downtime.length,
    scrap: w.scrap.length,
  };

  const localPath = path.join(process.cwd(), 'warehouse-local.json');
  let sizeKb: string | null = null;
  if (fs.existsSync(localPath)) {
    const bytes = fs.statSync(localPath).size;
    sizeKb = (bytes / 1024).toFixed(1);
  }

  console.log('\n[seed] DONE');
  console.log('  final rowcounts:', endCounts);
  console.log('  ingest_log entries:', w.ingest_log.length);
  if (sizeKb) console.log(`  warehouse-local.json: ${sizeKb} KB`);
  else console.log('  warehouse-local.json: not written (blob mode active)');
}

main().catch(e => {
  console.error('[seed] FATAL', e);
  process.exit(1);
});
