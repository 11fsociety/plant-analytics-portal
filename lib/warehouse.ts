/**
 * Warehouse: a single JSON blob holding all production/downtime/scrap rows.
 * Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else falls back to a local
 * file for `npm run dev`.
 */
import { put, list, head } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

export type ProductionRow = {
  machine: string;
  prod_date: string | null;
  roll_id: string | null;
  order_no: string | null;
  material: string | null;
  material_desc: string | null;
  width: number | null;
  length: number | null;
  sqm: number | null;
  net_kg: number | null;
  gross_kg: number | null;
  source_file: string;
  row_hash: string;
};

export type DowntimeRow = {
  machine: string;
  event_date: string | null;
  from_time: string | null;
  to_time: string | null;
  minutes: number;
  shift: string | null;
  descriptive: string | null;
  concluded: string;
  source_file: string;
  row_hash: string;
};

export type ScrapRow = {
  machine: string;
  entry_date: string | null;
  posting_date: string | null;
  order_no: string | null;
  material: string | null;
  material_desc: string | null;
  rejection_desc: string | null;
  quantity_kg: number | null;
  source_file: string;
  row_hash: string;
};

export type Warehouse = {
  updated_at: string;
  ingest_log: Array<{ filename: string; kind: string; inserted: number; skipped: number; at: string }>;
  production: ProductionRow[];
  downtime: DowntimeRow[];
  scrap: ScrapRow[];
};

const BLOB_PATH = 'warehouse.json';
const LOCAL_PATH = path.join(process.cwd(), 'warehouse-local.json');

function isBlobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function emptyWarehouse(): Warehouse {
  return { updated_at: new Date().toISOString(), ingest_log: [], production: [], downtime: [], scrap: [] };
}

export async function loadWarehouse(): Promise<Warehouse> {
  if (isBlobEnabled()) {
    try {
      const listing = await list({ prefix: BLOB_PATH });
      const found = listing.blobs.find(b => b.pathname === BLOB_PATH);
      if (!found) return emptyWarehouse();
      const res = await fetch(found.url, { cache: 'no-store' });
      if (!res.ok) return emptyWarehouse();
      return await res.json();
    } catch (e) {
      console.warn('Warehouse blob load failed, returning empty:', e);
      return emptyWarehouse();
    }
  }
  if (fs.existsSync(LOCAL_PATH)) {
    return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf-8'));
  }
  return emptyWarehouse();
}

export async function saveWarehouse(w: Warehouse): Promise<void> {
  w.updated_at = new Date().toISOString();
  const body = JSON.stringify(w);
  if (isBlobEnabled()) {
    await put(BLOB_PATH, body, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    } as any);
    return;
  }
  fs.writeFileSync(LOCAL_PATH, body);
}

/** Insert rows with dedup by row_hash. Returns {inserted, skipped}. */
export function mergeInto(
  target: Array<{ row_hash: string }>,
  incoming: Array<{ row_hash: string }>,
): { inserted: number; skipped: number } {
  const seen = new Set(target.map(r => r.row_hash));
  let inserted = 0;
  let skipped = 0;
  for (const row of incoming) {
    if (seen.has(row.row_hash)) {
      skipped++;
    } else {
      target.push(row as any);
      seen.add(row.row_hash);
      inserted++;
    }
  }
  return { inserted, skipped };
}
