/**
 * Handles Vercel Blob client-direct uploads (bypasses 4.5 MB function body cap).
 * The client requests a token, uploads directly to Blob, then Vercel calls this
 * endpoint back with `onUploadCompleted`. That's when we ingest.
 */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { loadWarehouse, saveWarehouse, mergeInto } from '@/lib/warehouse';
import { ingestBuffer } from '@/lib/ingest';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'application/octet-stream',
        ],
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ originalName: pathname }),
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Fetch blob content, parse, merge into warehouse
        const meta = tokenPayload ? JSON.parse(tokenPayload) : {};
        const sourceName = meta.originalName || blob.pathname;
        try {
          const res = await fetch(blob.url);
          const buf = await res.arrayBuffer();
          const result = await ingestBuffer(buf, sourceName);
          if (!result.kind) return;
          const w = await loadWarehouse();
          let inserted = 0, skipped = 0;
          if (result.production) {
            const r = mergeInto(w.production, result.production);
            inserted += r.inserted; skipped += r.skipped;
          }
          if (result.downtime) {
            const r = mergeInto(w.downtime, result.downtime);
            inserted += r.inserted; skipped += r.skipped;
          }
          if (result.scrap) {
            const r = mergeInto(w.scrap, result.scrap);
            inserted += r.inserted; skipped += r.skipped;
          }
          w.ingest_log.push({ filename: sourceName, kind: result.kind, inserted, skipped, at: new Date().toISOString() });
          await saveWarehouse(w);
        } catch (e: any) {
          console.error('onUploadCompleted ingest error:', e);
        }
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
