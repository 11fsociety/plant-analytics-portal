<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import ChartOverlay from '$lib/components/ChartOverlay.svelte';
  import DateRangePicker from '$lib/components/DateRangePicker.svelte';
  import { toTonnes } from '$lib/format';

  type Diagnostics = {
    tier: string;
    method: string;
    params?: Record<string, number | string>;
    rmse?: number;
    n_points: number;
    n_anomalies: number;
    residual_std?: number;
    monthly_seasonality_used?: boolean;
  };
  type Insight = {
    series: Array<{ d: string; v: number }>;
    forecast: Array<{ d: string; point: number; low: number; high: number }>;
    anomalies: Array<{ d: string; v: number; z: number }>;
    diagnostics: Diagnostics;
    unit: string;
    label: string;
  };

  let data: {
    metrics?: { production: Insight; scrap: Insight; downtime: Insight };
    horizon_days?: number;
    updated_at?: string;
  } | null = null;
  let error = '';
  let horizon = 7;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  $: plantSlug = $page.url.searchParams.get('plant') || 'navratan';
  // Serialize concurrent load() invocations. Rapid horizon changes (7 → 14 → 30)
  // would otherwise race; a slower early fetch could resolve after a faster late one
  // and show selector=30 with data for horizon=14.
  let fetchSeq = 0;

  async function load() {
    const token = ++fetchSeq;
    error = '';
    try {
      const p = new URLSearchParams({ horizon: String(horizon), plant: plantSlug });
      if (dateFrom) p.set('from', dateFrom);
      if (dateTo) p.set('to', dateTo);
      const res = await fetch(`/api/predict?${p}`);
      if (token !== fetchSeq) return; // superseded by a later call
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        error = `Failed: ${res.status}`;
        return;
      }
      const parsed = await res.json();
      if (token !== fetchSeq) return; // re-check after JSON parse
      data = parsed;
    } catch (e) {
      if (token !== fetchSeq) return; // don't overwrite error from newer call
      error = String(e);
    }
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

  function diagFor(m: Insight): string {
    const d = m.diagnostics;
    const parts = [d.method];
    if (d.params) {
      for (const [k, v] of Object.entries(d.params)) {
        if (typeof v === 'number') parts.push(`${k}=${v}`);
      }
    }
    if (d.rmse != null) parts.push(`rmse=${d.rmse}`);
    parts.push(`n=${d.n_points}`);
    return parts.join(' · ');
  }

  let mounted = false;
  let prevHorizon = horizon;
  let prevPlant: string | null = null;
  let prevFrom: string | null = null;
  let prevTo: string | null = null;
  onMount(() => {
    // Read date range from URL params
    dateFrom = $page.url.searchParams.get('from');
    dateTo = $page.url.searchParams.get('to');
    // Seed prev* before mounted=true to prevent reactive block from firing on mount
    prevHorizon = horizon;
    prevPlant = plantSlug;
    prevFrom = dateFrom;
    prevTo = dateTo;
    mounted = true;
    load();
  });
  // Fire load() only when horizon actually changes — NOT every time `data` mutates.
  // The previous shape (`$: horizon && data && load()`) formed an infinite loop
  // because load() re-assigned `data`, which re-triggered the reactive block.
  $: if (mounted && (horizon !== prevHorizon || plantSlug !== prevPlant || dateFrom !== prevFrom || dateTo !== prevTo)) {
    prevHorizon = horizon;
    prevPlant = plantSlug;
    prevFrom = dateFrom;
    prevTo = dateTo;
    load();
  }

  function handleDateChange(e: CustomEvent<{ from: string | null; to: string | null; compare: boolean; preset?: string }>) {
    dateFrom = e.detail.from;
    dateTo = e.detail.to;
    // Update URL
    const params = new URLSearchParams($page.url.searchParams);
    if (dateFrom) params.set('from', dateFrom); else params.delete('from');
    if (dateTo) params.set('to', dateTo); else params.delete('to');
    goto(`?${params}`, { replaceState: true, keepFocus: true });
  }
</script>

<svelte:head>
  <title>Predict · Plant Analytics Portal</title>
</svelte:head>

<h1>Predict</h1>
<p class="page-subtitle">
  Forecast and anomaly overlays on daily plant metrics. Model adapts to data volume automatically.
</p>

<DateRangePicker from={dateFrom} to={dateTo} allowCompare={false} on:change={handleDateChange} />

<div class="chip-row">
  <span class="chip-label">Horizon</span>
  {#each [7, 14, 30] as h}
    <button class="chip {horizon === h ? 'active' : ''}" on:click={() => (horizon = h)}>{h} days</button>
  {/each}
</div>

{#if error}
  <div class="empty">Error: {error}</div>
{:else if !data || !data.metrics}
  <div class="empty"><span class="spinner"></span> Loading forecasts…</div>
{:else}
  {@const m = data.metrics}
  <div class="grid">
    <ChartOverlay
      title="Net production"
      subtitle="Daily net kg, tonnes"
      series={toTonneSeries(m.production.series)}
      forecast={toTonneForecast(m.production.forecast)}
      anomalies={toTonneAnoms(m.production.anomalies)}
      unit="t"
      diagnostic={diagFor(m.production)}
    />
    <ChartOverlay
      title="Scrap"
      subtitle="Daily rejected kg, tonnes"
      series={toTonneSeries(m.scrap.series)}
      forecast={toTonneForecast(m.scrap.forecast)}
      anomalies={toTonneAnoms(m.scrap.anomalies)}
      unit="t"
      diagnostic={diagFor(m.scrap)}
    />
    <ChartOverlay
      title="Downtime"
      subtitle="Daily downtime hours"
      series={m.downtime.series}
      forecast={m.downtime.forecast}
      anomalies={m.downtime.anomalies}
      unit="hrs"
      diagnostic={diagFor(m.downtime)}
    />
  </div>
{/if}

<style>
  .chip-row { display: flex; gap: 8px; margin: 6px 0 18px; flex-wrap: wrap; align-items: center; }
  .chip-label { color: var(--muted); font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.4px; margin-right: 4px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
  @media (min-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .empty {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-left: 4px solid var(--accent);
    padding: 22px;
    border-radius: 14px;
    box-shadow: var(--shadow-sm);
  }
</style>
