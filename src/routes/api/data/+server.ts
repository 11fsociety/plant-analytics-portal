import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toPlant } from '$lib/server/warehouse';
import { loadCached } from '$lib/server/warehouse-cache';
import * as A from '$lib/server/analytics';
import type { ShiftFilter, DateRange } from '$lib/server/analytics';

function parseShift(v: string | null): ShiftFilter {
  return v === 'A' || v === 'B' ? v : 'all';
}

function parseRange(sp: URLSearchParams): DateRange {
  const from = sp.get('from');
  const to = sp.get('to');
  const ok = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { from: ok(from) ? from : null, to: ok(to) ? to : null };
}

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  const sp = url.searchParams;
  const shift = parseShift(sp.get('shift'));
  const range = parseRange(sp);
  const plant = toPlant(sp.get('plant'));
  const compare = sp.get('compare') === 'prev-period';
  const w = await loadCached(plant);

  // Compute previous period if compare enabled and range is present
  let compareRange: DateRange | null = null;
  if (compare && range.from && range.to) {
    const from = new Date(range.from);
    const to = new Date(range.to);
    const duration = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - duration + 1);
    compareRange = {
      from: prevFrom.toISOString().split('T')[0],
      to: prevTo.toISOString().split('T')[0],
    };
  }

  return json({
    plant_slug: plant,
    shift,
    range,
    compare,
    compare_range: compareRange,
    plant: A.plantSummary(w, shift, range),
    machines: A.machines(w, shift, range, plant),
    downtime_reasons_plant: A.downtimeSortedByHours(w, undefined, shift, false, range),
    downtime_by_hours_plant: A.downtimeSortedByHours(w, undefined, shift, true, range),
    downtime_by_events_plant: A.downtimeSortedByEvents(w, undefined, shift, true, range),
    scrap_reasons_plant: A.scrapByReason(w, undefined, shift, range, 15),
    top_materials_plant: A.topMaterials(w, undefined, shift, range, 10),
    daily_production_plant: A.dailySeries(w, 'production', undefined, undefined, shift, range),
    daily_scrap_plant: A.dailySeries(w, 'scrap', undefined, undefined, shift, range),
    daily_downtime_plant: A.dailySeries(w, 'downtime', undefined, undefined, shift, range),
    daily_production_plant_compare: compareRange ? A.dailySeries(w, 'production', undefined, undefined, shift, compareRange) : null,
    daily_scrap_plant_compare: compareRange ? A.dailySeries(w, 'scrap', undefined, undefined, shift, compareRange) : null,
    daily_downtime_plant_compare: compareRange ? A.dailySeries(w, 'downtime', undefined, undefined, shift, compareRange) : null,
    date_range: A.dateRange(w),
    updated_at: w.updated_at,
    ingest_log: w.ingest_log.slice(-30).reverse(),
    row_counts: {
      production: w.production.length,
      downtime: w.downtime.length,
      scrap: w.scrap.length,
    },
  }, {
    headers: {
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=300',
    },
  });
};
