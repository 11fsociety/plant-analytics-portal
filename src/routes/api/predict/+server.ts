import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toPlant } from '$lib/server/warehouse';
import { loadCached } from '$lib/server/warehouse-cache';
import * as A from '$lib/server/analytics';
import type { ShiftFilter, DateRange } from '$lib/server/analytics';
import { insightsFor, type Insights } from '$lib/server/insights';

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
  const plant = toPlant(sp.get('plant'));
  const shift = parseShift(sp.get('shift'));
  const range = parseRange(sp);
  const horizon = Math.max(1, Math.min(30, parseInt(sp.get('horizon') || '7', 10) || 7));
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

  const dailyProduction = A.dailySeries(w, 'production', undefined, undefined, shift, range);
  const dailyScrap = A.dailySeries(w, 'scrap', undefined, undefined, shift, range);
  const dailyDowntime = A.dailySeries(w, 'downtime', undefined, undefined, shift, range);

  const production: Insights = insightsFor(dailyProduction, { horizonDays: horizon });
  const scrap: Insights = insightsFor(dailyScrap, { horizonDays: horizon });
  const downtime: Insights = insightsFor(dailyDowntime, { horizonDays: horizon });

  const dailyProductionCompare = compareRange ? A.dailySeries(w, 'production', undefined, undefined, shift, compareRange) : null;
  const dailyScrapCompare = compareRange ? A.dailySeries(w, 'scrap', undefined, undefined, shift, compareRange) : null;
  const dailyDowntimeCompare = compareRange ? A.dailySeries(w, 'downtime', undefined, undefined, shift, compareRange) : null;

  return json({
    plant_slug: plant,
    shift,
    range,
    compare,
    compare_range: compareRange,
    horizon_days: horizon,
    metrics: {
      production: { ...production, unit: 'kg', label: 'Net production', compare_series: dailyProductionCompare },
      scrap: { ...scrap, unit: 'kg', label: 'Scrap', compare_series: dailyScrapCompare },
      downtime: { ...downtime, unit: 'hrs', label: 'Downtime', compare_series: dailyDowntimeCompare },
    },
    updated_at: w.updated_at,
    date_range: A.dateRange(w),
  }, {
    headers: {
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=300',
    },
  });
};
