/**
 * Delete raw XLSX archived under raw/YYYY-MM/ that are older than N days.
 * Never touches warehouse.json (it's not under raw/).
 * Called piggy-back on every successful /api/ingest so no cron is needed.
 */
import { list, del } from '@vercel/blob';
import type { Plant } from './warehouse';
import { rawPrefixFor } from './warehouse';

export type SweepResult = { deleted: string[]; scanned: number };

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_ID_V2_READ_WRITE_TOKEN;
}

export async function sweepRawFiles(plant: Plant, daysOld = 7): Promise<SweepResult> {
  const token = blobToken();
  if (!token) return { deleted: [], scanned: 0 };
  const cutoffMs = Date.now() - daysOld * 86_400_000;

  // Paginate through the full `raw/` listing so > 1000 blobs don't silently leak.
  let cursor: string | undefined;
  let scanned = 0;
  const stale: { url: string; pathname: string }[] = [];
  do {
    const page = await list({ prefix: rawPrefixFor(plant), token, limit: 1000, cursor } as any);
    scanned += page.blobs.length;
    for (const b of page.blobs) {
      const t = new Date(b.uploadedAt).getTime();
      if (Number.isFinite(t) && t < cutoffMs) stale.push({ url: b.url, pathname: b.pathname });
    }
    cursor = (page as any).cursor;
    // Belt-and-braces: cap total pages we walk in one sweep so a runaway listing
    // can't stall the whole ingest. 20 pages × 1000 = up to 20k blobs per call.
    if (scanned >= 20_000) break;
  } while (cursor);

  await Promise.all(stale.map((b) => del(b.url, { token } as any)));
  return { deleted: stale.map((b) => b.pathname), scanned };
}
