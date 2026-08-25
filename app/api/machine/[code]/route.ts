import { NextRequest, NextResponse } from 'next/server';
import { loadWarehouse } from '@/lib/warehouse';
import * as A from '@/lib/analytics';
import * as P from '@/lib/predictive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const w = await loadWarehouse();
  const detail = A.machineDetail(w, params.code);
  const forecast = P.linearForecast(detail.daily_scrap, 7);
  const anomalies = P.madAnomalies(detail.daily_scrap);
  const narrative = P.deterministicNarrative(A.plantSummary(w), detail.summary ? [detail.summary] : [], detail.scrap_reasons);
  let narrative_llm = null;
  if (req.nextUrl.searchParams.get('llm') === '1') {
    narrative_llm = await P.llmNarrative({
      machine: detail.name,
      summary: detail.summary,
      scrap_reasons: detail.scrap_reasons.slice(0, 10),
      downtime_reasons: detail.downtime_reasons,
    });
  }
  return NextResponse.json({ ...detail, forecast_scrap: forecast, scrap_anomalies: anomalies, narrative, narrative_llm });
}
