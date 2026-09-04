/**
 * Direct-to-Blob upload with server-side parse trigger.
 *
 * Two phases in a single route (both handled by @vercel/blob/client.handleUpload):
 *   Phase 1 — client requests a client-token. Cookie present. Auth check runs here.
 *   Phase 2 — Blob storage calls back server-to-server ("upload-completed"). NO cookie.
 *             handleUpload verifies the callback's own signature (via the RW token). We
 *             MUST NOT auth-gate the top of this handler, or Phase 2 gets 401'd and
 *             the ingest silently never happens.
 *
 * Client polls /api/data to see the ingest_log entry appear.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { ingestBuffer } from '$lib/server/ingest';
import { loadWarehouse, saveWarehouse, mergeInto, toPlant, rawPrefixFor, extendMachineMap, cleanupMachineMap } from '$lib/server/warehouse';
import { invalidate as invalidateWarehouseCache } from '$lib/server/warehouse-cache';
import { sweepRawFiles } from '$lib/server/sweep';
import { withMutex } from '$lib/server/mutex';

// 300s (Fluid Compute) so the load+parse+save round-trip has headroom even on
// the biggest Lam workbook (~3.8 MB, ~30 MB warehouse.json round-trip). Client
// polls /api/data with a matching horizon.
export const config = { maxDuration: 300 };

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_ID_V2_READ_WRITE_TOKEN;
}

function yyyymm(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function processCompletedUpload(blobUrl: string, sourceName: string, plant: string) {
  const t0 = Date.now();
  const res = await fetch(blobUrl);
  const buf = await res.arrayBuffer();
  console.log(`[upload] ${sourceName} fetched from Blob (${(buf.byteLength / 1024).toFixed(0)} KB) — ${Date.now() - t0}ms`);

  const tParse = Date.now();
  const result = await ingestBuffer(buf, sourceName);
  console.log(`[upload] parse ${Date.now() - tParse}ms → kind=${result.kind}`);

  // The load-modify-save sequence needs to be serialised per-plant: two callbacks
  // hitting the same plant's warehouse.json at once would overwrite each other.
  await withMutex(`warehouse-${plant}`, async () => {
    const tLoad = Date.now();
    const w = await loadWarehouse(plant);
    console.log(`[upload] loadWarehouse(${plant}) ${Date.now() - tLoad}ms → P/D/S=${w.production.length}/${w.downtime.length}/${w.scrap.length}`);

    if (!result.kind) {
      w.ingest_log.push({
        filename: sourceName,
        kind: 'unrecognized',
        inserted: 0,
        skipped: 0,
        at: new Date().toISOString(),
      });
      await saveWarehouse(w, plant);
      invalidateWarehouseCache(toPlant(plant));
      return;
    }

    let inserted = 0;
    let skipped = 0;
    if (result.production) {
      const r = mergeInto(w.production, result.production);
      inserted += r.inserted;
      skipped += r.skipped;
    }
    if (result.downtime) {
      const r = mergeInto(w.downtime, result.downtime);
      inserted += r.inserted;
      skipped += r.skipped;
    }
    if (result.scrap) {
      const r = mergeInto(w.scrap, result.scrap);
      inserted += r.inserted;
      skipped += r.skipped;
    }

    // Auto-populate machine_map with any new machines seen in this upload.
    // extendMachineMap already skips known dt_aliases + UNKNOWN.
    const addedMachines: string[] = [];
    if (result.production) addedMachines.push(...extendMachineMap(w, result.production));
    if (result.downtime) addedMachines.push(...extendMachineMap(w, result.downtime));
    if (result.scrap) addedMachines.push(...extendMachineMap(w, result.scrap));
    if (addedMachines.length) {
      console.log(`[upload] auto-registered ${addedMachines.length} new machine(s):`, addedMachines);
      w.ingest_log.push({
        filename: `[auto-register] ${addedMachines.join(', ')}`,
        kind: 'auto-register',
        inserted: addedMachines.length,
        skipped: 0,
        at: new Date().toISOString(),
      });
    }
    // Purge historical machine_map noise from prior ingests that ran before
    // the alias filter was added.
    const purged = cleanupMachineMap(w);
    if (purged.length) {
      console.log(`[upload] cleaned up ${purged.length} historical alias entries from machine_map:`, purged);
    }

    w.ingest_log.push({
      filename: sourceName,
      kind: result.kind,
      inserted,
      skipped,
      at: new Date().toISOString(),
    });

    // Piggy-back sweep of raw files older than 7 days.
    try {
      const s = await sweepRawFiles(plant, 7);
      if (s.deleted.length > 0) {
        w.ingest_log.push({
          filename: `[sweep] ${s.deleted.length} raw file(s) > 7 days`,
          kind: 'sweep',
          inserted: 0,
          skipped: s.deleted.length,
          at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('[upload] sweep failed:', e);
    }

    const tSave = Date.now();
    await saveWarehouse(w, plant);
    invalidateWarehouseCache(plant as any);
    console.log(`[upload] saveWarehouse(${plant}) ${Date.now() - tSave}ms; total ${Date.now() - t0}ms; inserted=${inserted}, skipped=${skipped}`);
  });
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: request as unknown as Request,
      token: blobToken(),
      onBeforeGenerateToken: async (pathname) => {
        // Phase 1 only — this fires on the client's token request. Auth check
        // belongs here, NOT at the top of the handler, or Phase 2 (Blob's
        // server-to-server upload-completed callback) would 401 and ingest
        // would silently never run.
        if (!locals.user) {
          throw new Error('Unauthorized');
        }

        // Parse plant from clientPayload (JSON string like '{"plant":"uniworth"}').
        let plant = 'navratan';
        try {
          if (body.payload?.clientPayload) {
            const clientPayload = JSON.parse(body.payload.clientPayload);
            plant = toPlant(clientPayload.plant);
          }
        } catch {
          // Fall back to navratan if clientPayload is missing or malformed.
        }

        // Override pathname to use plant-specific raw prefix: raw/<plant>/YYYY-MM/basename.
        const basename = pathname.split('/').pop() || pathname;
        const newPathname = `${rawPrefixFor(plant)}${yyyymm(new Date())}/${basename}`;

        return {
          allowedContentTypes: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'application/octet-stream',
          ],
          addRandomSuffix: false,
          allowOverwrite: true,
          pathname: newPathname,
          tokenPayload: JSON.stringify({ originalName: pathname, plant }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const meta = tokenPayload ? JSON.parse(tokenPayload) : {};
        const sourceName: string = meta.originalName || blob.pathname;
        const plant: string = meta.plant || 'navratan';
        try {
          await processCompletedUpload(blob.url, sourceName, plant);
        } catch (e) {
          console.error('[upload] onUploadCompleted error:', e);
        }
      },
    });
    return json(jsonResponse);
  } catch (e: any) {
    // Do not leak internal error text to the client in prod. Log server-side.
    console.error('[upload] handleUpload error:', e);
    const message =
      process.env.NODE_ENV === 'production'
        ? 'upload rejected'
        : String(e?.message || e);
    // Preserve 401 vs 400 so the browser can prompt re-login on session expiry.
    const status = /unauthor/i.test(String(e?.message || '')) ? 401 : 400;
    return json({ error: message }, { status });
  }
};
