/**
 * Warehouse: a single JSON blob (per plant) holding all production/downtime/scrap rows.
 * Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else falls back to a local
 * file for `npm run dev`.
 *
 * Multi-plant note: Navratan uses the historical `warehouse.json` key so the
 * MAIN app (which still writes to that key) keeps working. Uniworth (and any
 * future plant) uses `warehouse-<slug>.json`. Never rename Navratan.
 */
import { put, list, head } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { PLANTS, type PlantSlug } from '../plants';

export type Shift = 'A' | 'B' | null;

export type ProductionRow = {
  machine: string;
  prod_date: string | null;
  creat_time: string | null;
  shift: Shift;
  roll_id: string | null;
  order_no: string | null;
  material: string | null;
  material_desc: string | null;
  width: number | null;
  length: number | null;
  sqm: number | null;
  net_kg: number | null;
  gross_kg: number | null;
  quality_name: string | null;
  group_name: string | null;
  packtype: string | null;
  microns: number | null;
  thickness_board: number | null;
  gsm_micron: string | null;
  gsm_name_micron: string | null;
  grade: string | null;
  planned_gsm: string | null;
  actual_gsm_name: string | null;
  operator: string | null;
  color: string | null;
  design: string | null;
  source_file: string;
  row_hash: string;
};

export type DowntimeRow = {
  machine: string;
  event_date: string | null;
  from_time: string | null;
  to_time: string | null;
  minutes: number;
  shift: string | null;        // A / B / a+b / null
  descriptive: string | null;
  brief_sub_reason: string | null;  // granular (~10 categories) - matches Sheet1 pivot
  concluded: string;                 // broad (3 buckets)
  source_file: string;
  row_hash: string;
};

export type ScrapRow = {
  machine: string;
  entry_date: string | null;
  entry_time: string | null;     // Time of Entry
  posting_date: string | null;
  shift: Shift;                  // derived from entry_time
  order_no: string | null;
  material: string | null;
  material_desc: string | null;
  rejection_desc: string | null;
  quantity_kg: number | null;
  source_file: string;
  row_hash: string;
};

/** Auto-populated machine registry per plant. Grows as new codes appear in
 *  ingest rows. Persisted inside warehouse.json so it survives across sessions. */
export type MachineEntry = { name: string; dt_aliases: string[]; first_seen: string };

export type Warehouse = {
  updated_at: string;
  ingest_log: Array<{ filename: string; kind: string; inserted: number; skipped: number; at: string }>;
  production: ProductionRow[];
  downtime: DowntimeRow[];
  scrap: ScrapRow[];
  /** Present in warehouses written by the portal. Older main-app-written warehouses
   *  may lack this — treat missing as empty {} on read. */
  machine_map?: Record<string, MachineEntry>;
};

/* ---------------- Plant scope ---------------- */

export type Plant = PlantSlug;
export { PLANTS };
export const DEFAULT_PLANT: Plant = 'navratan';

export function isPlant(v: unknown): v is Plant {
  return typeof v === 'string' && (PLANTS as readonly string[]).includes(v);
}

/** Coerce arbitrary input to a valid plant, falling back to DEFAULT_PLANT. */
export function toPlant(v: unknown): Plant {
  return isPlant(v) ? v : DEFAULT_PLANT;
}

/** Blob pathname per plant. Navratan keeps the legacy filename so the main app
 *  keeps working; other plants get `warehouse-<slug>.json`. */
function blobPathFor(plant: Plant): string {
  return plant === 'navratan' ? 'warehouse.json' : `warehouse-${plant}.json`;
}

function localPathFor(plant: Plant): string {
  return path.join(
    process.cwd(),
    plant === 'navratan' ? 'warehouse-local.json' : `warehouse-local-${plant}.json`,
  );
}

/** Raw-file archive prefix per plant. Used by sweep.ts + /api/upload. */
export function rawPrefixFor(plant: Plant): string {
  return `raw/${plant}/`;
}

/** Look up the Blob RW token under either the default var name or the V2 prefix. */
function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_ID_V2_READ_WRITE_TOKEN;
}

function isBlobEnabled(): boolean {
  return !!blobToken();
}

export function emptyWarehouse(): Warehouse {
  return {
    updated_at: new Date().toISOString(),
    ingest_log: [],
    production: [],
    downtime: [],
    scrap: [],
    machine_map: {},
  };
}

function loadLocalFallback(plant: Plant): Warehouse | null {
  const localPath = localPathFor(plant);
  const gzPath = localPath + '.gz';
  if (fs.existsSync(gzPath)) {
    const buf = fs.readFileSync(gzPath);
    const raw = zlib.gunzipSync(buf).toString('utf-8');
    return JSON.parse(raw);
  }
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
  }
  return null;
}

export async function loadWarehouse(plant: Plant = DEFAULT_PLANT): Promise<Warehouse> {
  const blobPath = blobPathFor(plant);
  // In dev, if a local file exists prefer it over Blob — avoids 10 s connect
  // timeouts on flaky links. Production ignores this shortcut; Blob is authoritative.
  if (process.env.NODE_ENV !== 'production') {
    const baked = loadLocalFallback(plant);
    if (baked) return baked;
  }
  if (isBlobEnabled()) {
    try {
      const listing = await list({ prefix: blobPath, token: blobToken() } as any);
      const found = listing.blobs.find((b) => b.pathname === blobPath);
      if (found) {
        const res = await fetch(found.url, { cache: 'no-store' });
        if (res.ok) return await res.json();
      }
      // Blob store empty for this plant → fall through to any baked-in warehouse.
      const baked = loadLocalFallback(plant);
      if (baked) return baked;
      return emptyWarehouse();
    } catch (e) {
      console.warn(`Warehouse blob load failed for plant=${plant}, trying local fallback:`, e);
      return loadLocalFallback(plant) || emptyWarehouse();
    }
  }
  return loadLocalFallback(plant) || emptyWarehouse();
}

export async function saveWarehouse(w: Warehouse, plant: Plant = DEFAULT_PLANT): Promise<void> {
  w.updated_at = new Date().toISOString();
  const body = JSON.stringify(w);
  const blobPath = blobPathFor(plant);
  if (isBlobEnabled()) {
    // Multipart chunks the body so a flaky link doesn't kill the whole PUT;
    // Vercel Blob handles retries per chunk. Essential for the 20-30 MB warehouse.json.
    await put(blobPath, body, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      token: blobToken(),
      allowOverwrite: true,
      multipart: true,
    } as any);
    return;
  }
  fs.writeFileSync(localPathFor(plant), body);
}

/** Insert rows with dedup by row_hash. Returns {inserted, skipped}. */
export function mergeInto(
  target: Array<{ row_hash: string }>,
  incoming: Array<{ row_hash: string }>,
): { inserted: number; skipped: number } {
  const seen = new Set(target.map((r) => r.row_hash));
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

/**
 * Ensure every machine code seen in `rows` exists in `w.machine_map`.
 * Auto-populates unknown machines with a best-effort display name (the code
 * itself, until an operator gives it a proper alias) and no downtime aliases.
 * Returns the list of newly-added codes so callers can log them.
 */
/** Codes that should never enter machine_map (they are downtime-format aliases
 *  of static machines, or explicit placeholders). Kept in sync with dt_aliases
 *  from analytics.MACHINE_MAPS. */
const ALIAS_BLOCKLIST = new Set([
  'UNKNOWN',
  // Calender aliases (map to CM01 / CM02)
  'Calender - 1', 'Calender - I', 'Calender - 2', 'Calender - II',
  // Lamination aliases (map to IM01-04)
  'Lam -1', 'LAMINATION - I', 'Lam -2', 'LAMINATION - II',
  'Lam -3', 'LAMINATION - III', 'Lam -4', 'LAMINATION - IV',
  // Printing (RP01)
  'Printing', 'PRINTING',
  // Blown (BU01 / BM01)
  'Blown', 'BLOWN',
]);

export function extendMachineMap(
  w: Warehouse,
  rows: Array<{ machine: string }>,
  when: string = new Date().toISOString(),
): string[] {
  if (!w.machine_map) w.machine_map = {};
  const added: string[] = [];
  for (const r of rows) {
    const code = (r.machine || '').trim();
    if (!code) continue;
    if (ALIAS_BLOCKLIST.has(code)) continue;   // downtime alias / UNKNOWN — do not auto-register
    if (!w.machine_map[code]) {
      w.machine_map[code] = { name: code, dt_aliases: [code], first_seen: when };
      added.push(code);
    }
  }
  return added;
}

/** Purge previously-auto-registered entries that match ALIAS_BLOCKLIST.
 *  Idempotent; call from /api/upload after every ingest so warehouses cleaned
 *  up over time. Returns list of pathnames removed. */
export function cleanupMachineMap(w: Warehouse): string[] {
  if (!w.machine_map) return [];
  const removed: string[] = [];
  for (const code of Object.keys(w.machine_map)) {
    if (ALIAS_BLOCKLIST.has(code)) {
      delete w.machine_map[code];
      removed.push(code);
    }
  }
  return removed;
}
