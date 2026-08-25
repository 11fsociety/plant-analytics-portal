/**
 * Alternate ingest path: for small files uploaded via multipart form (dev mode
 * without Blob token, or files < 4 MB). The main path is the Blob-direct route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ingestBuffer } from '@/lib/ingest';
import { loadWarehouse, saveWarehouse, mergeInto } from '@/lib/warehouse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'no file' }, { status: 400 });
  const buf = await file.arrayBuffer();
  const result = await ingestBuffer(buf, file.name);
  if (!result.kind) {
    return NextResponse.json({ error: 'unrecognized schema', filename: file.name });
  }
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
  w.ingest_log.push({ filename: file.name, kind: result.kind, inserted, skipped, at: new Date().toISOString() });
  await saveWarehouse(w);
  return NextResponse.json({ kind: result.kind, inserted, skipped });
}
