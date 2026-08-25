'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { BarChartVertical, BarChartHorizontal, DualAxisLine, ForecastChart, fmt, fmtT, toTonnes } from '@/components/Charts';

export default function MachinePage({ params }: { params: Promise<{ code: string }> | { code: string } }) {
  // Next.js 14 supports both — normalize.
  const p: any = (params as any).then ? use(params as any) : params;
  const code = p.code;

  const [data, setData] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/machine/${code}`).then(r => r.json()).then(setData);
  }, [code]);

  async function askLLM() {
    setLlmLoading(true);
    try {
      const res = await fetch(`/api/machine/${code}?llm=1`).then(r => r.json());
      setData(res);
    } finally {
      setLlmLoading(false);
    }
  }

  if (!data) return <div><span className="spinner" /> Loading...</div>;
  const s = data.summary;
  if (!s) {
    return <><Link href="/" style={{ color: 'var(--muted)', fontSize: 12 }}>&larr; back</Link><h1>{data.name} ({code})</h1><div className="insight-block">No production data recorded for this machine.</div></>;
  }

  const kpis = [
    { label: 'Net production', value: fmtT(s.net_kg), sub: `${s.rolls} rolls` },
    { label: 'Sq mtr', value: fmt(s.sqm), sub: '' },
    { label: 'Downtime', value: (s.downtime_hrs || 0).toFixed(1) + ' hrs', sub: `${((s.downtime_hrs || 0) / 744 * 100).toFixed(1)}% of month` },
    { label: 'Scrap', value: fmtT(s.scrap_kg), sub: s.scrap_pct_of_net != null ? `${s.scrap_pct_of_net}% of net` : '' },
    { label: 'Days active', value: s.days_active, sub: '' },
    { label: 'Throughput', value: s.throughput_kg_per_productive_hr ? fmtT(s.throughput_kg_per_productive_hr) + '/hr' : '-', sub: 'productive hrs' },
  ];

  const dtReasons = data.downtime_reasons.map((r: any) => ({ reason: (r.reason || 'Unclassified').slice(0, 30), hrs: r.hrs }));
  const scrapReasons = data.scrap_reasons.slice(0, 10).map((r: any) => ({ reason: (r.reason || '').slice(0, 42), tonnes: toTonnes(r.kg) }));

  // Combine daily production + downtime by date
  const prodMap = new Map(data.daily_production.map((r: any) => [r.d, r.v]));
  const dtMap = new Map(data.daily_downtime.map((r: any) => [r.d, r.v]));
  const dates = Array.from(new Set([...prodMap.keys(), ...dtMap.keys()] as string[])).sort();
  const dualData = dates.map(d => ({ d, prod: toTonnes(prodMap.get(d) as number || 0), dt: (dtMap.get(d) as number) || 0 }));

  // Forecast + actual data on one chart
  const scrapDates = data.daily_scrap.map((r: any) => r.d);
  const scrapVals = data.daily_scrap.map((r: any) => toTonnes(r.v));
  const fc = data.forecast_scrap?.forecast || [];
  const forecastRows = [
    ...scrapDates.map((d: string, i: number) => ({ d, actual: scrapVals[i], point: null, low: null, high: null })),
    ...fc.map((f: any) => ({ d: f.d, actual: null, point: toTonnes(f.point), low: toTonnes(f.low), high: toTonnes(f.high) })),
  ];

  const n = data.narrative || {};
  const llm = data.narrative_llm;

  return (
    <>
      <Link href="/" style={{ color: 'var(--muted)', fontSize: 12 }}>&larr; back to plant</Link>
      <h1>{data.name} <span className="badge">{code}</span></h1>

      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <div className="kpi" key={i}>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
            <div className="sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="chart-grid">
        <div className="chart">
          <div className="chart-title">Downtime reason breakdown (hrs)</div>
          <BarChartVertical data={dtReasons} xKey="reason" yKey="hrs" label="hrs" />
        </div>
        <div className="chart">
          <div className="chart-title">Top scrap categories (tonnes)</div>
          <BarChartHorizontal data={scrapReasons} xKey="reason" yKey="tonnes" label="tonnes" />
        </div>
        <div className="chart chart-full">
          <div className="chart-title">Daily production (tonnes) + downtime (hrs)</div>
          <DualAxisLine data={dualData} xKey="d" y1Key="prod" y2Key="dt" y1Label="Production tonnes" y2Label="Downtime hrs" />
        </div>
        <div className="chart chart-full">
          <div className="chart-title">Daily scrap (tonnes) + 7-day forecast</div>
          <ForecastChart data={forecastRows} />
        </div>
      </div>

      <h2>Top materials produced</h2>
      <table>
        <thead><tr><th>Material</th><th className="num">Tonnes</th><th className="num">Rolls</th></tr></thead>
        <tbody>
          {data.top_materials.map((m: any, i: number) => (
            <tr key={i}><td>{m.mat}</td><td className="num">{fmtT(m.kg)}</td><td className="num">{m.rolls}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>Insights
        <span className="badge">{llm ? 'LLM active' : 'deterministic only'}</span>
        <button className="btn secondary" style={{ float: 'right', fontSize: 12, padding: '4px 12px' }} onClick={askLLM} disabled={llmLoading}>
          {llmLoading ? 'Thinking...' : 'Ask LLM'}
        </button>
      </h2>

      <div className="insight-block">
        <h3>Deterministic insights</h3>
        <ul>{(n.bullets || []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
      </div>
      <div className="insight-block risk-block">
        <h3>Risks</h3>
        <ul>{(n.risks || []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
      </div>
      <div className="insight-block rec-block">
        <h3>Recommendations</h3>
        <ul>{(n.recommendations || []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
      </div>
      {llm && !llm.error && (
        <div className="insight-block" style={{ borderLeftColor: 'var(--accent-2)' }}>
          <h3>LLM (Claude) insights</h3>
          <ul>{(llm.bullets || []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
          <strong style={{ color: 'var(--warn)' }}>Risks</strong>
          <ul>{(llm.risks || []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
          <strong style={{ color: 'var(--danger)' }}>Recommendations</strong>
          <ul>{(llm.recommendations || []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {llm?.error && (
        <div className="insight-block risk-block"><h3>LLM error</h3><div>{llm.error}</div></div>
      )}

      <h2>Anomalies (MAD z-score &gt; 3.5)</h2>
      {data.scrap_anomalies?.length ? (
        <table>
          <thead><tr><th>Date</th><th className="num">Scrap</th><th className="num">z-score</th></tr></thead>
          <tbody>
            {data.scrap_anomalies.map((a: any, i: number) => (
              <tr key={i}><td>{a.d}</td><td className="num">{fmtT(a.v)}</td><td className="num"><span className="badge badge-warn">{a.z}</span></td></tr>
            ))}
          </tbody>
        </table>
      ) : <div style={{ color: 'var(--muted)' }}>No days above 3.5σ from median.</div>}
    </>
  );
}
