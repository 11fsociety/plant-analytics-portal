'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChartVertical, BarChartHorizontal, DonutChart, LineArea, fmt, fmtT, toTonnes } from '@/components/Charts';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/data').then(r => r.json()).then(setData).catch(e => setError(String(e)));
  }, []);

  if (error) return <div>Failed: {error}</div>;
  if (!data) return <div><span className="spinner" /> Loading...</div>;
  if (!data.plant || data.plant.rolls === 0) {
    return (
      <>
        <h1>Plant dashboard</h1>
        <div className="insight-block">
          <h3>No data yet</h3>
          <p>Warehouse is empty. Head to <Link href="/upload" className="btn secondary">Upload</Link> to ingest your first Excel file.</p>
        </div>
      </>
    );
  }

  const plant = data.plant;
  const machines = data.machines;
  const kpis = [
    { label: 'Net production', value: fmtT(plant.net_kg), sub: `${plant.rolls?.toLocaleString()} rolls` },
    { label: 'Sq mtr', value: fmt(plant.sqm), sub: '' },
    { label: 'Downtime', value: plant.downtime_hrs?.toFixed(0) + ' hrs', sub: `${plant.downtime_events} events` },
    { label: 'Scrap', value: fmtT(plant.scrap_kg), sub: `${plant.scrap_events} events` },
    { label: 'Scrap % net', value: plant.scrap_pct_of_net + '%', sub: '' },
    { label: 'Gross production', value: fmtT(plant.gross_kg), sub: '' },
  ];

  const dtByMachine = machines.filter((m: any) => m.downtime_hrs > 0).map((m: any) => ({ name: m.name, hrs: m.downtime_hrs }));
  const scrapByMachine = machines.filter((m: any) => m.scrap_kg > 0).map((m: any) => ({ name: m.name, tonnes: toTonnes(m.scrap_kg) }));
  const dtReasonPie = data.downtime_reasons_plant.map((r: any) => ({ name: r.reason || 'Unclassified', hrs: r.hrs }));
  const topScrap = data.scrap_reasons_plant.slice(0, 10).map((r: any) => ({ reason: (r.reason || '').slice(0, 40), tonnes: toTonnes(r.kg) }));
  const dailyProd = data.daily_production_plant.map((r: any) => ({ d: r.d, tonnes: toTonnes(r.v) }));
  const dailyScrap = data.daily_scrap_plant.map((r: any) => ({ d: r.d, tonnes: toTonnes(r.v) }));

  return (
    <>
      <h1>Plant dashboard <span className="badge">{data.date_range?.min || '?'} to {data.date_range?.max || '?'}</span></h1>

      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <div className="kpi" key={i}>
            <div className="label">{k.label}</div>
            <div className="value">{k.value}</div>
            <div className="sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <h2>Machines</h2>
      <div className="machine-picker">
        {machines.map((m: any) => (
          <Link key={m.code} href={`/machine/${m.code}`} className="machine-btn">
            {m.name}<span className="code">{m.code}</span>
          </Link>
        ))}
      </div>

      <div className="chart-grid">
        <div className="chart">
          <div className="chart-title">Downtime hours by machine</div>
          <BarChartVertical data={dtByMachine} xKey="name" yKey="hrs" label="hrs" />
        </div>
        <div className="chart">
          <div className="chart-title">Scrap by machine (tonnes)</div>
          <BarChartVertical data={scrapByMachine} xKey="name" yKey="tonnes" label="tonnes" />
        </div>
        <div className="chart">
          <div className="chart-title">Downtime reason mix (plant)</div>
          <DonutChart data={dtReasonPie} nameKey="name" valueKey="hrs" />
        </div>
        <div className="chart">
          <div className="chart-title">Top 10 scrap categories (tonnes)</div>
          <BarChartHorizontal data={topScrap} xKey="reason" yKey="tonnes" label="tonnes" />
        </div>
        <div className="chart chart-full">
          <div className="chart-title">Daily net production (tonnes)</div>
          <LineArea data={dailyProd} xKey="d" yKey="tonnes" label="tonnes" />
        </div>
        <div className="chart chart-full">
          <div className="chart-title">Daily scrap (tonnes)</div>
          <LineArea data={dailyScrap} xKey="d" yKey="tonnes" label="tonnes" />
        </div>
      </div>
    </>
  );
}
