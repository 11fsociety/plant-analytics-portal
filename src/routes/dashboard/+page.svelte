<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import ChartOverlay from '$lib/components/ChartOverlay.svelte';
  import DateRangePicker from '$lib/components/DateRangePicker.svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import DonutChart from '$lib/components/DonutChart.svelte';
  import HorizontalBar from '$lib/components/HorizontalBar.svelte';
  import { fmt, fmtT, toTonnes } from '$lib/format';

  let data: any = null;
  let insights: any = null;
  let insightsError = '';
  let error = '';
  let shift: 'all' | 'A' | 'B' = 'all';
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let compareMode = false;
  let mounted = false;
  let showFilters = false;
  // Serialise concurrent refresh() calls. Rapid shift toggle (all→A→B) would
  // otherwise let slower requests clobber state after faster later ones.
  let fetchSeq = 0;

  $: plantSlug = $page.url.searchParams.get('plant') || 'navratan';

  async function refresh() {
    const token = ++fetchSeq;
    data = null;
    insights = null;
    insightsError = '';
    error = '';
    try {
      const p = new URLSearchParams({ shift, plant: plantSlug });
      if (dateFrom) p.set('from', dateFrom);
      if (dateTo) p.set('to', dateTo);
      if (compareMode) p.set('compare', 'prev-period');
      const [dataRes, predRes] = await Promise.all([
        fetch(`/api/data?${p}`),
        fetch(`/api/predict?${p}&horizon=7`),
      ]);
      if (token !== fetchSeq) return; // superseded by a later call
      if (!dataRes.ok) {
        if (dataRes.status === 401) { window.location.href = '/login'; return; }
        error = `Failed: ${dataRes.status}`;
        return;
      }
      if (token !== fetchSeq) return; // re-check before parsing
      const dataJson = await dataRes.json();
      if (token !== fetchSeq) return;
      data = dataJson;
      if (predRes.ok) {
        if (token !== fetchSeq) return; // re-check before parsing forecast
        const insightsJson = await predRes.json();
        if (token !== fetchSeq) return;
        insights = insightsJson;
      } else {
        insightsError = `Forecast unavailable (HTTP ${predRes.status})`;
        console.error('[dashboard] /api/predict failed:', predRes.status);
      }
    } catch (e) {
      if (token !== fetchSeq) return;
      error = String(e);
    }
  }

  // prevShift starts null so the first pass (mounted becomes true, shift is 'all')
  // triggers exactly one refresh; subsequent shift changes each trigger one more.
  // refresh() re-assigns `data`, not `shift` or `prevShift`, so no re-entry.
  let prevShift: 'all' | 'A' | 'B' | null = null;
  let prevPlant: string | null = null;
  let prevFrom: string | null = null;
  let prevTo: string | null = null;
  onMount(() => {
    // Read date range from URL params
    dateFrom = $page.url.searchParams.get('from');
    dateTo = $page.url.searchParams.get('to');
    compareMode = $page.url.searchParams.get('compare') === 'prev-period';
    mounted = true;
  });
  $: if (mounted && (shift !== prevShift || plantSlug !== prevPlant || dateFrom !== prevFrom || dateTo !== prevTo)) {
    prevShift = shift;
    prevPlant = plantSlug;
    prevFrom = dateFrom;
    prevTo = dateTo;
    refresh();
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

  function diagFor(m: any): string {
    const d = m?.diagnostics;
    if (!d) return '';
    const parts = [d.method];
    if (d.rmse != null) parts.push(`rmse=${d.rmse}`);
    parts.push(`n=${d.n_points}`);
    return parts.join(' · ');
  }
</script>

<svelte:head>
  <title>Dashboard · Plant Analytics Portal</title>
</svelte:head>

<h1>Dashboard</h1>
<p class="page-subtitle">Ops overview of production, downtime and scrap</p>

<button class="filters-toggle" on:click={() => (showFilters = !showFilters)}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"></line>
    <line x1="4" y1="10" x2="4" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12" y2="3"></line>
    <line x1="20" y1="21" x2="20" y2="16"></line>
    <line x1="20" y1="12" x2="20" y2="3"></line>
    <line x1="1" y1="14" x2="7" y2="14"></line>
    <line x1="9" y1="8" x2="15" y2="8"></line>
    <line x1="17" y1="16" x2="23" y2="16"></line>
  </svg>
  Filters
</button>

{#if showFilters}
  <DateRangePicker from={dateFrom} to={dateTo} compare={compareMode} allowCompare={true} on:change={handleDateChange} />
  <div class="chip-row">
    <button class="chip {shift === 'all' ? 'active' : ''}" on:click={() => (shift = 'all')}>All shifts</button>
    <button class="chip {shift === 'A' ? 'active' : ''}" on:click={() => (shift = 'A')}>Shift A · Day</button>
    <button class="chip {shift === 'B' ? 'active' : ''}" on:click={() => (shift = 'B')}>Shift B · Night</button>
  </div>
{/if}

{#if error}
  <div class="empty">Error: {error}</div>
{:else if !data}
  <div class="empty"><span class="spinner"></span> Loading…</div>
{:else if !data.plant || data.plant.rolls === 0}
  <div class="empty">
    <h3>No data yet</h3>
    <p>The warehouse is empty. Head to <a class="btn secondary" href="/upload">Upload</a> to ingest your first XLSX file.</p>
  </div>
{:else}
  {@const plant = data.plant}
  <div class="kpi-grid">
    <KpiCard label="Net production" value={fmtT(plant.net_kg)} sub={`${plant.rolls?.toLocaleString()} rolls`} tone="success" icon="cube" />
    <KpiCard label="Gross production" value={fmtT(plant.gross_kg)} tone="info" icon="scale" />
    <KpiCard label="Length" value={fmt(plant.total_length_m) + ' m'} tone="purple" icon="chart" />
    <KpiCard label="Downtime" value={`${plant.downtime_hrs?.toFixed(0)} hrs`} sub={`${plant.downtime_events} events`} tone="warn" icon="clock" />
    <KpiCard label="Scrap" value={fmtT(plant.scrap_kg)} sub={`${plant.scrap_events} events`} tone="danger" icon="trash" />
    <KpiCard label="Scrap % of net" value={plant.scrap_pct_of_net != null ? `${plant.scrap_pct_of_net}%` : '-'} tone="danger" icon="ratio" />
  </div>

  <h2>Machines</h2>
  <div class="machine-chips">
    {#each data.machines as m}
      <a class="machine-chip" href="/machine/{m.code}?plant={plantSlug}">
        {m.name}<span class="chip-code">{m.code}</span>
      </a>
    {/each}
  </div>

  {#if insights?.metrics?.production}
    <h2>Daily production trend</h2>
    <ChartOverlay
      title="Net production"
      subtitle="Daily tonnes with 7-day forecast + anomalies"
      series={toTonneSeries(insights.metrics.production.series)}
      forecast={toTonneForecast(insights.metrics.production.forecast)}
      anomalies={toTonneAnoms(insights.metrics.production.anomalies)}
      compareSeries={compareMode && insights.metrics.production.compare_series ? toTonneSeries(insights.metrics.production.compare_series) : null}
      unit="t"
      diagnostic={diagFor(insights.metrics.production)}
      compact={true}
    />
  {:else if insightsError}
    <h2>Daily production trend</h2>
    <div class="forecast-unavailable">{insightsError} — KPIs above still valid.</div>
  {/if}

  <h2>Analytics</h2>
  <div class="analytics-grid">
    <BarChart
      title="Downtime hours by machine"
      data={data.machines.filter(m=>m.downtime_hrs>0).map(m=>({label:m.name,value:m.downtime_hrs}))}
      unit="hrs"
      compact
    />
    <BarChart
      title="Downtime by reason (event count)"
      data={data.downtime_by_events_plant.slice(0,10).map(r=>({label:r.reason||'Unclassified',value:r.events}))}
      unit="events"
      compact
    />
    <BarChart
      title="Scrap by machine (tonnes)"
      data={data.machines.filter(m=>m.scrap_kg>0).map(m=>({label:m.name,value:m.scrap_kg/1000}))}
      unit="t"
      compact
    />
    <DonutChart
      title="Downtime reason mix (plant)"
      data={data.downtime_reasons_plant.map(r=>({label:r.reason||'Unclassified',value:r.hrs}))}
      unit="hrs"
      compact
    />
    <div class="analytics-full">
      <HorizontalBar
        title="Top 10 scrap categories (tonnes)"
        data={data.scrap_reasons_plant.slice(0,10).map(r=>({label:r.reason,value:r.kg/1000}))}
        unit="t"
      />
    </div>
    <ChartOverlay
      title="Daily net production"
      subtitle="Tonnes per day"
      series={toTonneSeries(data.daily_production_plant)}
      forecast={[]}
      anomalies={[]}
      unit="t"
      compact
    />
    <ChartOverlay
      title="Daily scrap"
      subtitle="Tonnes per day"
      series={toTonneSeries(data.daily_scrap_plant)}
      forecast={[]}
      anomalies={[]}
      unit="t"
      compact
    />
  </div>

  <h2>Warehouse</h2>
  <div class="warehouse-row">
    <div class="mini-card"><span class="mini-label">Production rows</span><span class="mini-value">{data.row_counts?.production?.toLocaleString?.() ?? '-'}</span></div>
    <div class="mini-card"><span class="mini-label">Downtime rows</span><span class="mini-value">{data.row_counts?.downtime?.toLocaleString?.() ?? '-'}</span></div>
    <div class="mini-card"><span class="mini-label">Scrap rows</span><span class="mini-value">{data.row_counts?.scrap?.toLocaleString?.() ?? '-'}</span></div>
    <div class="mini-card"><span class="mini-label">Date range</span><span class="mini-value small">{data.date_range?.min || '—'} → {data.date_range?.max || '—'}</span></div>
    <div class="mini-card"><span class="mini-label">Last update</span><span class="mini-value small">{data.updated_at?.slice(0, 19).replace('T', ' ') || '—'}</span></div>
  </div>
{/if}

<style>
  .filters-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    margin: 10px 0 12px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .filters-toggle:hover {
    background: var(--panel-2);
    border-color: var(--accent);
  }
  .filters-toggle svg {
    width: 14px;
    height: 14px;
    opacity: 0.7;
  }
  .chip-row { display: flex; gap: 8px; margin: 6px 0 18px; flex-wrap: wrap; }
  .warehouse-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .mini-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 14px 16px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: var(--shadow-sm);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .mini-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
  .mini-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .mini-value { color: var(--highlight); font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .mini-value.small { font-size: 13px; font-weight: 500; }
  .empty {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-left: 4px solid var(--accent);
    padding: 22px;
    border-radius: 14px;
    box-shadow: var(--shadow-sm);
    margin-bottom: 16px;
  }
  .code-pill {
    display: inline-block;
    padding: 3px 8px;
    background: var(--panel-2);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .kind-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; }
  .kind-lam_prod, .kind-cal_prod { background: var(--success-bg); color: var(--success); }
  .kind-scrap { background: var(--danger-bg); color: var(--danger); }
  .kind-downtime { background: var(--warn-bg); color: var(--warn); }
  .kind-sweep { background: var(--info-bg); color: var(--info); }
  .small { font-size: 12px; color: var(--muted); }
  .forecast-unavailable {
    color: var(--warn);
    background: var(--warn-bg);
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 13px;
    margin-bottom: 20px;
  }
  .machine-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  .machine-chip {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--panel-border);
    padding: 9px 14px;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.15s;
    box-shadow: var(--shadow-sm);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .machine-chip:hover { background: var(--panel-2); border-color: var(--accent); transform: translateY(-1px); }
  .chip-code { color: var(--muted); font-size: 11px; letter-spacing: 0.3px; }
  .analytics-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 24px; }
  @media (min-width: 900px) { .analytics-grid { grid-template-columns: repeat(2, 1fr); } }
  .analytics-full { grid-column: 1 / -1; }
</style>
