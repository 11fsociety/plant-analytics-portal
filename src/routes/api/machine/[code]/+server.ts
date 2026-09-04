import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toPlant } from '$lib/server/warehouse';
import { loadCached } from '$lib/server/warehouse-cache';
import * as A from '$lib/server/analytics';
import { resolveMachineMeta } from '$lib/server/analytics';
import * as P from '$lib/server/predictive';
import type { ShiftFilter, DateRange } from '$lib/server/analytics';
import { insightsFor } from '$lib/server/insights';

function parseShift(v: string | null): ShiftFilter {
  return v === 'A' || v === 'B' ? v : 'all';
}

function parseRange(sp: URLSearchParams): DateRange {
  const from = sp.get('from');
  const to = sp.get('to');
  const ok = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { from: ok(from) ? from : null, to: ok(to) ? to : null };
}

export const GET: RequestHandler = async ({ url, params, locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  const plant = toPlant(url.searchParams.get('plant'));
  const shift = parseShift(url.searchParams.get('shift'));
  const range = parseRange(url.searchParams);
  const compare = url.searchParams.get('compare') === 'prev-period';
  const code = params.code!;
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

  const detail = A.machineDetail(w, code, shift, range, plant);

  // Get machine meta for downtime aliases
  const meta = resolveMachineMeta(w, code, plant);

  // Compute compare series for each metric if enabled
  const daily_production_compare = compareRange ? A.dailySeries(w, 'production', code, undefined, shift, compareRange) : null;
  const daily_scrap_compare = compareRange ? A.dailySeries(w, 'scrap', code, undefined, shift, compareRange) : null;
  const daily_downtime_compare = compareRange ? A.dailySeries(w, 'downtime', undefined, meta.dt_aliases, shift, compareRange) : null;

  // Layered insights (forecast + anomalies + diagnostics) for each daily series.
  const production_insights = insightsFor(detail.daily_production, { horizonDays: 7 });
  const scrap_insights = insightsFor(detail.daily_scrap, { horizonDays: 7 });
  const downtime_insights = insightsFor(detail.daily_downtime, { horizonDays: 7 });
  const narrative = P.deterministicNarrative(
    A.plantSummary(w, shift, range),
    detail.summary ? [detail.summary] : [],
    detail.scrap_reasons,
  );
  return json({
    plant_slug: plant,
    shift,
    range,
    compare,
    compare_range: compareRange,
    ...detail,
    daily_production_compare,
    daily_scrap_compare,
    daily_downtime_compare,
    production_insights,
    scrap_insights,
    downtime_insights,
    narrative,
  }, {
    headers: {
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=300',
    },
  });
};
