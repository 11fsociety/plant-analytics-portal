<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import ChartOverlay from '$lib/components/ChartOverlay.svelte';
  import HorizontalBar from '$lib/components/HorizontalBar.svelte';
  import DateRangePicker from '$lib/components/DateRangePicker.svelte';
  import { fmt, fmtT, toTonnes } from '$lib/format';

  let data: any = null;
  let error = '';
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let compareMode = false;
  let fetchSeq = 0;

  $: plantSlug = $page.url.searchParams.get('plant') || 'navratan';
  $: machineCode = $page.params.code;

  async function load() {
    const token = ++fetchSeq;
    error = '';
    data = null;
    try {
      const p = new URLSearchParams({ plant: plantSlug });
      if (dateFrom) p.set('from', dateFrom);
      if (dateTo) p.set('to', dateTo);
      if (compareMode) p.set('compare', 'prev-period');
      const res = await fetch(`/api/machine/${machineCode}?${p}`);
      if (token !== fetchSeq) return;
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        error = `Failed: ${res.status}`;
        return;
      }
      const parsed = await res.json();
      if (token !== fetchSeq) return;
      data = parsed;
    } catch (e) {
      if (token !== fetchSeq) return;
      error = String(e);
    }
  }

  let mounted = false;
  let prevPlant: string | null = null;
  let prevFrom: string | null = null;
  let prevTo: string | null = null;
  let prevCompare = false;
  onMount(() => {
    // Read date range from URL params
    dateFrom = $page.url.searchParams.get('from');
    dateTo = $page.url.searchParams.get('to');
    compareMode = $page.url.searchParams.get('compare') === 'prev-period';
    // Seed prev* to prevent reactive block from double-firing at mount.
    prevPlant = plantSlug;
    prevFrom = dateFrom;
    prevTo = dateTo;
    prevCompare = compareMode;
    mounted = true;
    load();
  });
  $: if (mounted && (plantSlug !== prevPlant || dateFrom !== prevFrom || dateTo !== prevTo || compareMode !== prevCompare)) {
    prevPlant = plantSlug;
    prevFrom = dateFrom;
    prevTo = dateTo;
    prevCompare = compareMode;
    load();
  }

  function handleDateChange(e: CustomEvent<{ from: string | null; to: string | null; compare: boolean; preset?: string }>) {
    dateFrom = e.detail.from;
    dateTo = e.detail.to;
    compareMode = e.detail.compare;
    // Update URL
    const params = new URLSearchParams($page.url.searchParams);
    if (dateFrom) params.set('from', dateFrom); else params.delete('from');
    if (dateTo) params.set('to', dateTo); else params.delete('to');
    if (compareMode) params.set('compare', 'prev-period'); else params.delete('compare');
    goto(`?${params}`, { replaceState: true, keepFocus: true });
  }

  function toTonneSeries(s: Array<{ d: string; v: number }>) {
    return s.map((p) => ({ d: p.d, v: (toTonnes(p.v) ?? 0) }));
  }
  function toTonneForecast(f: Array<{ d: string; point: number; low: number; high: number }>) {
    return f.map((p) => ({ d: p.d, point: (toTonnes(p.point) ?? 0), low: (toTonnes(p.low) ?? 0), high: (toTonnes(p.high) ?? 0) }));
  }
  function toTonneAnoms(a: Array<{ d: string; v: number; z: number }>) {
    return a.map((p) => ({ d: p.d, v: (toTonnes(p.v) ?? 0), z: p.z }));
  }
</script>

<svelte:head>
  <title>{data?.name || machineCode} · Plant Analytics Portal</title>
</svelte:head>

{#if error}
  <div class="empty">Error: {error}</div>
{:else if !data}
  <div class="empty"><span class="spinner"></span> Loading machine data…</div>
{:else if !data.summary}
  <div class="empty">
    No data for this machine yet.
    <br />
    <a href="/dashboard?plant={plantSlug}">← Back to Dashboard</a>
  </div>
{:else}
  <div class="breadcrumb">
    <a href="/dashboard?plant={plantSlug}">← Dashboard</a>
    <span class="sep">·</span>
    <span>{data.name}</span>
  </div>

  <h1>{data.name}</h1>

  <DateRangePicker from={dateFrom} to={dateTo} compare={compareMode} allowCompare={true} on:change={handleDateChange} />

  <div class="kpi-grid">
    <KpiCard label="Rolls" value={fmt(data.summary.rolls)} icon="cube" tone="info" />
    <KpiCard label="Net production" value={fmtT(data.summary.net_kg)} icon="scale" tone="success" />
    <KpiCard label="Scrap" value={fmtT(data.summary.scrap_kg)} icon="trash" tone="danger" />
    <KpiCard label="Scrap %" value={data.summary.scrap_pct_of_net.toFixed(1) + '%'} icon="ratio" tone="warn" />
    <KpiCard label="Downtime" value={data.summary.downtime_hrs.toFixed(1) + ' hrs'} icon="clock" tone="warn" />
    <KpiCard label="Throughput" value={fmt(data.summary.throughput_kg_per_productive_hr) + ' kg/hr'} icon="chart" tone="purple" />
  </div>

  <section class="shift-section">
    <h2>Shift breakdown</h2>
    <div class="shift-grid">
      <div class="shift-card">
        <div class="shift-header">Shift A</div>
        <div class="shift-stats">
          <div class="stat"><span class="label">Rolls:</span> {fmt(data.shift_split.A.rolls)}</div>
          <div class="stat"><span class="label">Net:</span> {fmtT(data.shift_split.A.net_kg)}</div>
          <div class="stat"><span class="label">Scrap:</span> {fmtT(data.shift_split.A.scrap_kg)}</div>
          <div class="stat"><span class="label">Downtime:</span> {data.shift_split.A.downtime_hrs.toFixed(1)} hrs</div>
        </div>
      </div>
      <div class="shift-card">
        <div class="shift-header">Shift B</div>
        <div class="shift-stats">
          <div class="stat"><span class="label">Rolls:</span> {fmt(data.shift_split.B.rolls)}</div>
          <div class="stat"><span class="label">Net:</span> {fmtT(data.shift_split.B.net_kg)}</div>
          <div class="stat"><span class="label">Scrap:</span> {fmtT(data.shift_split.B.scrap_kg)}</div>
          <div class="stat"><span class="label">Downtime:</span> {data.shift_split.B.downtime_hrs.toFixed(1)} hrs</div>
        </div>
      </div>
    </div>
  </section>

  <section class="charts-section">
    <h2>Trends & forecasts</h2>
    <div class="charts-grid">
      <ChartOverlay
        title="Daily production"
        subtitle="Net production, tonnes"
        series={toTonneSeries(data.production_insights.series)}
        forecast={toTonneForecast(data.production_insights.forecast)}
        anomalies={toTonneAnoms(data.production_insights.anomalies)}
        unit="t"
        compareSeries={data.daily_production_compare ? toTonneSeries(data.daily_production_compare) : null}
      />
      <ChartOverlay
        title="Daily scrap"
        subtitle="Rejected material, tonnes"
        series={toTonneSeries(data.scrap_insights.series)}
        forecast={toTonneForecast(data.scrap_insights.forecast)}
        anomalies={toTonneAnoms(data.scrap_insights.anomalies)}
        unit="t"
        compareSeries={data.daily_scrap_compare ? toTonneSeries(data.daily_scrap_compare) : null}
      />
      <ChartOverlay
        title="Daily downtime"
        subtitle="Hours offline"
        series={data.downtime_insights.series}
        forecast={data.downtime_insights.forecast}
        anomalies={data.downtime_insights.anomalies}
        unit="hrs"
        compareSeries={data.daily_downtime_compare || null}
      />
    </div>
  </section>

  <section class="bars-section">
    <h2>Top contributors</h2>
    <div class="bars-grid">
      <HorizontalBar
        title="Downtime reasons"
        subtitle="Top causes, hours"
        data={data.downtime_by_hours.slice(0, 8).map(r => ({ label: r.reason, value: r.hrs }))}
        unit="hrs"
        accent="var(--warn)"
      />
      <HorizontalBar
        title="Scrap reasons"
        subtitle="Top defects, tonnes"
        data={data.scrap_reasons.slice(0, 8).map(r => ({ label: r.reason, value: r.kg / 1000 }))}
        unit="t"
        accent="var(--danger)"
      />
    </div>
  </section>

  <section class="insights-section">
    <h2>Insights</h2>
    <div class="insights-grid">
      <div class="insight-block">
        <h3>Bullets</h3>
        <ul>
          {#each data.narrative.bullets as bullet}
            <li>{bullet}</li>
          {/each}
        </ul>
      </div>
      <div class="insight-block">
        <h3>Risks</h3>
        <ul>
          {#each data.narrative.risks as risk}
            <li>{risk}</li>
          {/each}
        </ul>
      </div>
      <div class="insight-block">
        <h3>Recommendations</h3>
        <ul>
          {#each data.narrative.recommendations as rec}
            <li>{rec}</li>
          {/each}
        </ul>
      </div>
    </div>
  </section>
{/if}

<style>
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--muted);
  }
  .breadcrumb a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  .breadcrumb a:hover { text-decoration: underline; }
  .sep { color: var(--muted); }

  h1 { margin: 0 0 24px; }
  h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 16px;
    color: var(--highlight);
    letter-spacing: -0.2px;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 40px;
  }

  .shift-section { margin-bottom: 40px; }
  .shift-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .shift-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    padding: 20px;
    box-shadow: var(--shadow-sm);
  }
  .shift-header {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .shift-stats {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stat {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text);
  }
  .stat .label {
    color: var(--muted);
    font-weight: 500;
    min-width: 70px;
  }

  .charts-section { margin-bottom: 40px; }
  .charts-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .bars-section { margin-bottom: 40px; }
  .bars-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }
  @media (min-width: 900px) {
    .bars-grid { grid-template-columns: 1fr 1fr; }
  }

  .insights-section { margin-bottom: 40px; }
  .insights-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }
  @media (min-width: 900px) {
    .insights-grid { grid-template-columns: repeat(3, 1fr); }
  }
  .insight-block {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    padding: 20px;
    box-shadow: var(--shadow-sm);
  }
  .insight-block h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    margin: 0 0 12px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .insight-block ul {
    margin: 0;
    padding-left: 20px;
    color: var(--text);
    font-size: 14px;
    line-height: 1.6;
  }
  .insight-block li { margin-bottom: 8px; }

  .empty {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-left: 4px solid var(--accent);
    padding: 22px;
    border-radius: 14px;
    box-shadow: var(--shadow-sm);
  }
</style>
