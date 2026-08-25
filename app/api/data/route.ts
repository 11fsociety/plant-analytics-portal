import { NextResponse } from 'next/server';
import { loadWarehouse } from '@/lib/warehouse';
import * as A from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const w = await loadWarehouse();
  return NextResponse.json({
    plant: A.plantSummary(w),
    machines: A.machines(w),
    downtime_reasons_plant: A.downtimeByReason(w),
    scrap_reasons_plant: A.scrapByReason(w, undefined, 15),
    top_materials_plant: A.topMaterials(w, undefined, 10),
    daily_production_plant: A.dailySeries(w, 'production'),
    daily_scrap_plant: A.dailySeries(w, 'scrap'),
    daily_downtime_plant: A.dailySeries(w, 'downtime'),
    date_range: A.dateRange(w),
    updated_at: w.updated_at,
    ingest_log: w.ingest_log.slice(-30).reverse(),
  });
}
