<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import ChartOverlay from '$lib/components/ChartOverlay.svelte';
  import HorizontalBar from '$lib/components/HorizontalBar.svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import DualAxisChart from '$lib/components/DualAxisChart.svelte';
  import DateRangePicker from '$lib/components/DateRangePicker.svelte';
  import CompareModal from '$lib/components/CompareModal.svelte';
  import MonthCompareResult from '$lib/components/MonthCompareResult.svelte';
  import { fmt, fmtT, toTonnes } from '$lib/format';

  let data: any = null;
  let error = '';
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let compareMode = false;
  let showFilters = false;
  let fetchSeq = 0;

  // Month comparison state — new shape: one combined chart with month rows.
  let showCompareModal = false;
  let compareRows: Array<{
    month: string;
    net_kg: number;
    scrap_kg: number;
    downtime_hrs: number;
    days_in_month: number;
    total_length_m: number;
  }> = [];
  let compareFetchSeq = 0;

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

  function enumerateMonths(dailyData: Array<{ d: string; v: number }>): string[] {
    const months = new Set<string>();
    for (const point of dailyData) {
      const month = point.d.slice(0, 7);
      months.add(month);
    }
    return Array.from(months).sort();
  }

  function lastDayOfMonth(yyyyMm: string): string {
    const [y, m] = yyyyMm.split('-').map(Number);
    const d = new Date(y, m, 0);
    return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function daysInMonth(yyyyMm: string): number {
    const [y, m] = yyyyMm.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  async function handleCompareSubmit(e: CustomEvent<{ months: string[] }>) {
    const { months } = e.detail;
    const token = ++compareFetchSeq;
    compareRows = [];

    const rows: typeof compareRows = [];
    for (const month of months) {
      const from = `${month}-01`;
      const to = lastDayOfMonth(month);
      const p = new URLSearchParams({ plant: plantSlug, from, to });
      try {
        const res = await fetch(`/api/machine/${machineCode}?${p}`);
        if (token !== compareFetchSeq) return;
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          console.error(`compare fetch ${month} failed:`, res.status);
          continue;
        }
        const monthData = await res.json();
        if (token !== compareFetchSeq) return;
        rows.push({
          month,
          net_kg: monthData?.summary?.net_kg ?? 0,
          scrap_kg: monthData?.summary?.scrap_kg ?? 0,
          downtime_hrs: monthData?.summary?.downtime_hrs ?? 0,
          days_in_month: daysInMonth(month),
          total_length_m: monthData?.summary?.total_length_m ?? 0,
        });
      } catch (err) {
        if (token !== compareFetchSeq) return;
        console.error(`compare fetch ${month} err:`, err);
      }
    }
    if (token !== compareFetchSeq) return;
    compareRows = rows;
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

  <div class="action-bar">
    <button class="btn secondary filters-toggle" on:click={() => (showFilters = !showFilters)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      Filters {showFilters ? '▲' : '▼'}
    </button>

    {#if data.production_insights?.series}
      {@const availableMonths = enumerateMonths(data.production_insights.series)}
      {#if availableMonths.length >= 2}
      <button class="btn secondary compare-btn" on:click={() => (showCompareModal = true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        Compare months
      </button>
      <CompareModal
        open={showCompareModal}
        availableMonths={availableMonths}
        on:submit={handleCompareSubmit}
        on:close={() => (showCompareModal = false)}
      />
      {/if}
    {/if}
  </div>

  {#if showFilters}
    <div class="filters-panel">
      <DateRangePicker from={dateFrom} to={dateTo} compare={compareMode} allowCompare={true} on:change={handleDateChange} />
    </div>
  {/if}

  {#if compareRows.length > 0}
    {@const isPrinting = machineCode === 'RP01'}
    <section class="compare-results">
      <h2>Month comparison - {data.name}</h2>
      <MonthCompareResult
        title={isPrinting ? 'Length produced, scrap %, downtime %' : 'Production, scrap %, downtime %'}
        subtitle={isPrinting
          ? 'Bars = metres (left axis). Dashed lines = % (right axis).'
          : 'Bars = tonnes (left axis). Dashed lines = % (right axis).'}
        rows={compareRows}
        productionUnit={isPrinting ? 'meters' : 'tonnes'}
      />
    </section>
  {/if}

  <div class="kpi-grid">
    <KpiCard
      label="Net production"
      value={fmtT(data.summary.net_kg)}
      sub={`${fmt(data.summary.rolls)} rolls`}
      tone="success"
      icon="cube"
    />
    <KpiCard
      label="Square metres"
      value={fmt(data.summary.sqm)}
      tone="purple"
      icon="chart"
    />
    <KpiCard
      label="Downtime"
      value={`${data.summary.downtime_hrs.toFixed(0)} hrs`}
      sub={`${((data.summary.downtime_hrs / 744) * 100).toFixed(1)}% of month`}
      tone="warn"
      icon="clock"
    />
    <KpiCard
      label="Scrap"
      value={fmtT(data.summary.scrap_kg)}
      sub={data.summary.scrap_pct_of_net != null ? `${data.summary.scrap_pct_of_net.toFixed(1)}% of net` : undefined}
      tone="danger"
      icon="trash"
    />
    <KpiCard
      label="Days active"
      value={fmt(data.summary.days_active)}
      tone="info"
      icon="chart"
    />
    <KpiCard
      label="Throughput"
      value={data.summary.throughput_kg_per_productive_hr != null ? (data.summary.throughput_kg_per_productive_hr / 1000).toFixed(2) + ' t/hr' : '-'}
      sub="kg per productive hr"
      tone="success"
      icon="chart"
    />
    <KpiCard
      label="Speed"
      value={data.summary.speed_metres_per_min != null ? data.summary.speed_metres_per_min.toFixed(2) + ' m/min' : '-'}
      sub={data.summary.total_length_m ? `${(data.summary.total_length_m / 1e6).toFixed(2)}M m run` : undefined}
      tone="info"
      icon="chart"
    />
    <KpiCard
      label="Distinct orders"
      value={fmt(data.summary.distinct_orders)}
      sub="unique jobs run"
      tone="purple"
      icon="cube"
    />
    <KpiCard
      label="Job changes"
      value={fmt(data.summary.job_changes)}
      sub="sequential order switches"
      tone="warn"
      icon="ratio"
    />
  </div>

  <h2>Downtime analysis</h2>
  <div class="two-col">
    <BarChart
      title="Downtime by reason (by hours)"
      data={data.downtime_by_hours.slice(0, 8).map(r => ({ label: r.reason || 'Unclassified', value: r.hrs }))}
      unit="hrs"
    />
    <BarChart
      title="Downtime by reason (by event count)"
      data={data.downtime_by_events.slice(0, 8).map(r => ({ label: r.reason || 'Unclassified', value: r.events }))}
      unit="events"
    />
  </div>

  <h2>Scrap categories</h2>
  <HorizontalBar
    title="Top scrap reasons"
    subtitle="Defects by weight, tonnes"
    data={data.scrap_reasons.slice(0, 8).map(r => ({ label: r.reason || 'Unclassified', value: r.kg / 1000 }))}
    unit="t"
    accent="var(--danger)"
    compact
  />

  {@const xLabels = data.daily_production.map(p => p.d)}
  {@const seriesA = data.daily_production.map(p => p.v / 1000)}
  {@const downtimeMap = new Map(data.daily_downtime.map(d => [d.d, d.v]))}
  {@const seriesB = xLabels.map(d => downtimeMap.get(d) || 0)}
  <DualAxisChart
    title="Daily production + Downtime"
    xLabels={xLabels}
    seriesA={seriesA}
    seriesA_label="Production"
    seriesA_unit="t"
    seriesB={seriesB}
    seriesB_label="Downtime"
    seriesB_unit="hrs"
  />

  <ChartOverlay
    title="Daily scrap with forecast"
    subtitle="Rejected material, tonnes"
    series={toTonneSeries(data.scrap_insights.series)}
    forecast={toTonneForecast(data.scrap_insights.forecast)}
    anomalies={toTonneAnoms(data.scrap_insights.anomalies)}
    unit="t"
    compact={true}
    compareSeries={data.daily_scrap_compare ? toTonneSeries(data.daily_scrap_compare) : null}
  />

  <h2>Shift split</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Shift</th>
          <th class="num">Rolls</th>
          <th class="num">Net (t)</th>
          <th class="num">Scrap (t)</th>
          <th class="num">Downtime (hrs)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>A (Day)</td>
          <td class="num">{fmt(data.shift_split.A.rolls)}</td>
          <td class="num">{fmtT(data.shift_split.A.net_kg)}</td>
          <td class="num">{fmtT(data.shift_split.A.scrap_kg)}</td>
          <td class="num">{data.shift_split.A.downtime_hrs.toFixed(1)}</td>
        </tr>
        <tr>
          <td>B (Night)</td>
          <td class="num">{fmt(data.shift_split.B.rolls)}</td>
          <td class="num">{fmtT(data.shift_split.B.net_kg)}</td>
          <td class="num">{fmtT(data.shift_split.B.scrap_kg)}</td>
          <td class="num">{data.shift_split.B.downtime_hrs.toFixed(1)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  {#if data.breakdowns && Object.keys(data.breakdowns).length > 0}
    <h2>Product breakdowns</h2>
    <div class="two-col">
      {#if data.breakdowns.by_group}
        <BarChart
          title="Production by group"
          data={data.breakdowns.by_group.slice(0, 15).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_quality}
        <BarChart
          title="Production by quality"
          data={data.breakdowns.by_quality.slice(0, 15).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_grade}
        <BarChart
          title="Production by grade"
          data={data.breakdowns.by_grade.slice(0, 15).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_packtype}
        <BarChart
          title="Production by pack type"
          data={data.breakdowns.by_packtype.slice(0, 15).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_gsm_micron}
        <BarChart
          title="Production by GSM/Micron"
          data={data.breakdowns.by_gsm_micron.slice(0, 15).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_actual_gsm}
        <BarChart
          title="Production by actual GSM"
          data={data.breakdowns.by_actual_gsm.slice(0, 15).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_microns}
        <BarChart
          title="Production by microns"
          data={data.breakdowns.by_microns.slice(0, 15).map(r => ({ label: String(r.key), value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_thickness}
        <BarChart
          title="Production by thickness"
          data={data.breakdowns.by_thickness.slice(0, 15).map(r => ({ label: String(r.key), value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_operator}
        <BarChart
          title="Production by operator"
          data={data.breakdowns.by_operator.slice(0, 20).map(r => ({ label: r.key, value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
      {#if data.breakdowns.by_width}
        <BarChart
          title="Production by width of roll (m)"
          data={data.breakdowns.by_width.slice(0, 15).map(r => ({ label: String(r.key), value: r.kg / 1000 }))}
          unit="t"
        />
      {/if}
    </div>
  {/if}

  {#if data.top_materials?.length}
    <h2>Top materials produced</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th class="num">Tonnes</th>
            <th class="num">Rolls</th>
          </tr>
        </thead>
        <tbody>
          {#each data.top_materials.slice(0, 15) as m}
            <tr>
              <td>{m.mat}</td>
              <td class="num">{fmtT(m.kg)}</td>
              <td class="num">{fmt(m.rolls)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if data.scrap_insights?.anomalies?.length}
    <h2>Anomalies (MAD z-score &gt; 3.5)</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th class="num">Scrap</th>
            <th class="num">Z-score</th>
          </tr>
        </thead>
        <tbody>
          {#each data.scrap_insights.anomalies as a}
            <tr>
              <td>{a.d}</td>
              <td class="num">{fmtT(a.v)}</td>
              <td class="num"><span class="z-pill">{a.z.toFixed(2)}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

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
  .action-bar {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .filters-toggle,
  .compare-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .filters-toggle svg,
  .compare-btn svg {
    width: 14px;
    height: 14px;
  }
  .filters-panel {
    margin-bottom: 20px;
  }
  .compare-results {
    margin-bottom: 32px;
  }
  .compare-results h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--highlight);
    margin: 0 0 16px;
  }
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

  .two-col {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    margin-bottom: 28px;
  }
  @media (min-width: 900px) {
    .two-col { grid-template-columns: repeat(2, 1fr); }
  }

  /* Add breathing room between consecutive chart cards + tables so they
     don't crowd each other. ~24 px = ~0.6 cm on standard screens. */
  main > :global(.chart-card),
  :global(.chart-card) + :global(.chart-card) { margin-bottom: 24px; }
  h2 + :global(.chart-card) { margin-top: 8px; }

  .table-wrap {
    margin-bottom: 40px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    overflow: hidden;
  }
  thead {
    background: var(--panel-2);
  }
  th {
    padding: 12px 16px;
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    color: var(--highlight);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border-bottom: 1px solid var(--panel-border);
  }
  th.num {
    text-align: right;
  }
  td {
    padding: 10px 16px;
    font-size: 14px;
    color: var(--text);
    border-bottom: 1px solid var(--panel-border);
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .z-pill {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 12px;
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
