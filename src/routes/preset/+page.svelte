<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import ChartOverlay from '$lib/components/ChartOverlay.svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  import DateRangePicker from '$lib/components/DateRangePicker.svelte';
  import { toTonnes } from '$lib/format';

  type PresetType = 'side' | 'topbottom' | 'multi' | 'machine';
  type Slot = {
    id: number;
    metric: string;
    from: string | null;
    to: string | null;
    shift: 'all' | 'A' | 'B';
  };
  type MetricKey = 'net_kg' | 'scrap_kg' | 'downtime_hrs' | 'rolls' | 'scrap_pct_of_net';
  type Metric = {
    key: MetricKey;
    label: string;
    unit: string;
    format: (v: number) => string;
    series: string | null;
  };
  type FetchedSlot = Slot & {
    data: any;
    series: Array<{ d: string; v: number }>;
  };
  type MachineData = {
    code: string;
    name: string;
    net_kg: number;
    scrap_kg: number;
    downtime_hrs: number;
    rolls: number;
    scrap_pct_of_net: number;
    daily_production: Array<{ d: string; v: number }>;
    daily_scrap: Array<{ d: string; v: number }>;
    daily_downtime: Array<{ d: string; v: number }>;
  };

  const METRICS: Metric[] = [
    { key: 'net_kg', label: 'Net production', unit: 't', format: (v) => (v / 1000).toFixed(2), series: 'daily_production_plant' },
    { key: 'scrap_kg', label: 'Scrap', unit: 't', format: (v) => (v / 1000).toFixed(2), series: 'daily_scrap_plant' },
    { key: 'downtime_hrs', label: 'Downtime', unit: 'hrs', format: (v) => v.toFixed(1), series: 'daily_downtime_plant' },
    { key: 'rolls', label: 'Rolls', unit: '', format: (v) => v.toLocaleString(), series: null },
    { key: 'scrap_pct_of_net', label: 'Scrap %', unit: '%', format: (v) => v.toFixed(1), series: null },
  ];

  $: plantSlug = $page.url.searchParams.get('plant') || 'navratan';

  let selectedPreset: PresetType | null = null;
  let slots: Slot[] = [];
  let nextSlotId = 1;
  let selectedMachines: string[] = [];
  let selectedMetrics: string[] = [];
  let machineViewMode: 'matrix' | 'bars' = 'matrix';
  let comparing = false;
  let fetchSeq = 0;
  let error = '';
  let loading = false;
  let result: any = null;
  let availableMachines: Array<{ code: string; name: string }> = [];
  let mounted = false;

  onMount(() => {
    mounted = true;
    loadMachines();
  });

  async function loadMachines() {
    try {
      const res = await fetch(`/api/data?plant=${plantSlug}`);
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        return;
      }
      const data = await res.json();
      availableMachines = data.machines || [];
    } catch (e) {
      console.error('Failed to load machines:', e);
    }
  }

  function selectPreset(preset: PresetType) {
    selectedPreset = preset;
    comparing = false;
    result = null;
    error = '';
    if (preset === 'side') {
      slots = [
        { id: nextSlotId++, metric: 'net_kg', from: null, to: null, shift: 'all' },
        { id: nextSlotId++, metric: 'scrap_kg', from: null, to: null, shift: 'all' },
      ];
    } else if (preset === 'topbottom') {
      slots = [
        { id: nextSlotId++, metric: 'net_kg', from: null, to: null, shift: 'all' },
        { id: nextSlotId++, metric: 'downtime_hrs', from: null, to: null, shift: 'all' },
      ];
    } else if (preset === 'multi') {
      slots = [
        { id: nextSlotId++, metric: 'net_kg', from: null, to: null, shift: 'all' },
        { id: nextSlotId++, metric: 'scrap_kg', from: null, to: null, shift: 'all' },
      ];
    } else if (preset === 'machine') {
      slots = [];
      selectedMachines = availableMachines.slice(0, 3).map((m) => m.code);
      selectedMetrics = ['net_kg', 'scrap_kg', 'downtime_hrs'];
    }
  }

  function addSlot() {
    if (slots.length >= 10) return;
    slots = [...slots, { id: nextSlotId++, metric: 'net_kg', from: null, to: null, shift: 'all' }];
  }

  function removeSlot(id: number) {
    if (slots.length <= 2 && selectedPreset !== 'multi') return;
    if (slots.length <= 1 && selectedPreset === 'multi') return;
    slots = slots.filter((s) => s.id !== id);
  }

  function handleDateChange(slotId: number, e: CustomEvent<{ from: string | null; to: string | null; compare: boolean; preset?: string }>) {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    slot.from = e.detail.from;
    slot.to = e.detail.to;
    slots = slots;
  }

  async function compare() {
    const token = ++fetchSeq;
    error = '';
    loading = true;
    comparing = false;
    result = null;

    try {
      if (selectedPreset === 'machine') {
        await compareMachines(token);
      } else {
        await compareSlots(token);
      }
    } catch (e) {
      if (token !== fetchSeq) return;
      error = String(e);
      loading = false;
    }
  }

  async function compareSlots(token: number) {
    const fetched: FetchedSlot[] = [];
    for (const slot of slots) {
      const p = new URLSearchParams({ shift: slot.shift, plant: plantSlug });
      if (slot.from) p.set('from', slot.from);
      if (slot.to) p.set('to', slot.to);
      const res = await fetch(`/api/data?${p}`);
      if (token !== fetchSeq) return;
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`Fetch failed: ${res.status}`);
      }
      const data = await res.json();
      if (token !== fetchSeq) return;
      const metric = METRICS.find((m) => m.key === slot.metric);
      const seriesKey = metric?.series;
      const series = seriesKey ? (data[seriesKey] || []) : [];
      fetched.push({ ...slot, data, series });
    }
    if (token !== fetchSeq) return;
    result = { type: selectedPreset, slots: fetched };
    comparing = true;
    loading = false;
  }

  async function compareMachines(token: number) {
    const machineData: MachineData[] = [];
    for (const code of selectedMachines) {
      const p = new URLSearchParams({ plant: plantSlug });
      const res = await fetch(`/api/machine/${code}?${p}`);
      if (token !== fetchSeq) return;
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`Fetch failed: ${res.status}`);
      }
      const data = await res.json();
      if (token !== fetchSeq) return;
      const summary = data.summary || {};
      machineData.push({
        code,
        name: summary.name || code,
        net_kg: summary.net_kg || 0,
        scrap_kg: summary.scrap_kg || 0,
        downtime_hrs: summary.downtime_hrs || 0,
        rolls: summary.rolls || 0,
        scrap_pct_of_net: summary.scrap_pct_of_net || 0,
        daily_production: data.daily_production || [],
        daily_scrap: data.daily_scrap || [],
        daily_downtime: data.daily_downtime || [],
      });
    }
    if (token !== fetchSeq) return;
    result = { type: 'machine', machines: machineData, metrics: selectedMetrics };
    comparing = true;
    loading = false;
  }

  function toTonneSeries(s: Array<{ d: string; v: number }>) {
    return s.map((p) => ({ d: p.d, v: toTonnes(p.v) ?? 0 }));
  }

  function toggleMachine(code: string) {
    if (selectedMachines.includes(code)) {
      selectedMachines = selectedMachines.filter((c) => c !== code);
    } else {
      selectedMachines = [...selectedMachines, code];
    }
  }

  function toggleMetric(key: string) {
    if (selectedMetrics.includes(key)) {
      selectedMetrics = selectedMetrics.filter((k) => k !== key);
    } else {
      selectedMetrics = [...selectedMetrics, key];
    }
  }

  function metricValue(machine: MachineData, metricKey: string): number {
    return (machine as any)[metricKey] ?? 0;
  }

  function sparklineData(machine: MachineData, metricKey: string): Array<{ d: string; v: number }> {
    if (metricKey === 'net_kg') return machine.daily_production;
    if (metricKey === 'scrap_kg') return machine.daily_scrap;
    if (metricKey === 'downtime_hrs') return machine.daily_downtime;
    return [];
  }

  $: if (mounted && plantSlug) {
    loadMachines();
  }
</script>

<svelte:head>
  <title>Preset · Plant Analytics Portal</title>
</svelte:head>

<h1>Preset</h1>
<p class="page-subtitle">Side-by-side comparisons of periods, metrics, and machines</p>

{#if !selectedPreset}
  <div class="preset-grid">
    <button class="preset-tile" on:click={() => selectPreset('side')}>
      <svg class="preset-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="12" width="18" height="24" rx="2"/>
        <rect x="26" y="12" width="18" height="24" rx="2"/>
      </svg>
      <div class="preset-title">Side by Side</div>
      <div class="preset-desc">Two metrics side-by-side</div>
    </button>

    <button class="preset-tile" on:click={() => selectPreset('topbottom')}>
      <svg class="preset-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="8" y="4" width="32" height="18" rx="2"/>
        <rect x="8" y="26" width="32" height="18" rx="2"/>
      </svg>
      <div class="preset-title">Top and Bottom</div>
      <div class="preset-desc">Two metrics stacked vertically</div>
    </button>

    <button class="preset-tile" on:click={() => selectPreset('multi')}>
      <svg class="preset-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="4" width="18" height="18" rx="2"/>
        <rect x="26" y="4" width="18" height="18" rx="2"/>
        <rect x="4" y="26" width="18" height="18" rx="2"/>
        <rect x="26" y="26" width="18" height="18" rx="2"/>
      </svg>
      <div class="preset-title">Multiple cards</div>
      <div class="preset-desc">Flexible grid of 2-10 cards</div>
    </button>

    <button class="preset-tile" on:click={() => selectPreset('machine')}>
      <svg class="preset-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="8" y="34" width="6" height="10"/>
        <rect x="16" y="24" width="6" height="20"/>
        <rect x="24" y="18" width="6" height="26"/>
        <rect x="32" y="28" width="6" height="16"/>
      </svg>
      <div class="preset-title">Machine comparison</div>
      <div class="preset-desc">Compare metrics across machines</div>
    </button>
  </div>
{:else}
  <button class="back-btn" on:click={() => (selectedPreset = null, comparing = false, result = null)}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
    Back to presets
  </button>

  {#if selectedPreset === 'machine'}
    <div class="param-card">
      <h3>Select machines</h3>
      <div class="checkbox-group">
        {#each availableMachines as m}
          <label class="checkbox-label">
            <input type="checkbox" checked={selectedMachines.includes(m.code)} on:change={() => toggleMachine(m.code)} />
            <span>{m.name} <span class="code-hint">{m.code}</span></span>
          </label>
        {/each}
      </div>

      <h3>Select metrics</h3>
      <div class="checkbox-group">
        {#each METRICS as m}
          <label class="checkbox-label">
            <input type="checkbox" checked={selectedMetrics.includes(m.key)} on:change={() => toggleMetric(m.key)} />
            <span>{m.label}</span>
          </label>
        {/each}
      </div>

      <button class="btn" on:click={compare} disabled={selectedMachines.length === 0 || selectedMetrics.length === 0 || loading}>
        {loading ? 'Loading…' : 'Compare'}
      </button>
    </div>
  {:else}
    <div class="param-card">
      <div class="slots-container">
        {#each slots as slot (slot.id)}
          <div class="slot-card">
            <div class="slot-row">
              <label>
                Metric
                <select bind:value={slot.metric}>
                  {#each METRICS.filter(m => m.series) as m}
                    <option value={m.key}>{m.label}</option>
                  {/each}
                </select>
              </label>

              <label>
                Shift
                <select bind:value={slot.shift}>
                  <option value="all">All shifts</option>
                  <option value="A">Shift A (Day)</option>
                  <option value="B">Shift B (Night)</option>
                </select>
              </label>

              {#if selectedPreset === 'multi' && slots.length > 1}
                <button class="remove-btn" on:click={() => removeSlot(slot.id)} title="Remove slot">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              {/if}
            </div>

            <DateRangePicker from={slot.from} to={slot.to} allowCompare={false} on:change={(e) => handleDateChange(slot.id, e)} />
          </div>
        {/each}
      </div>

      {#if selectedPreset === 'multi'}
        <button class="btn secondary" on:click={addSlot} disabled={slots.length >= 10}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add slot
        </button>
      {/if}

      <button class="btn" on:click={compare} disabled={loading}>
        {loading ? 'Loading…' : 'Compare'}
      </button>
    </div>
  {/if}

  {#if error}
    <div class="error-box">Error: {error}</div>
  {/if}

  {#if loading}
    <div class="loading-box">
      <span class="spinner"></span> Loading comparison…
    </div>
  {/if}

  {#if comparing && result}
    {#if result.type === 'side'}
      <div class="result-side">
        {#each result.slots as slot}
          {@const metric = METRICS.find((m) => m.key === slot.metric)}
          {@const series = metric?.key === 'net_kg' || metric?.key === 'scrap_kg' ? toTonneSeries(slot.series) : slot.series}
          <ChartOverlay
            title={metric?.label || 'Unknown'}
            subtitle="Daily trend"
            series={series}
            forecast={[]}
            anomalies={[]}
            unit={metric?.unit || ''}
            compact
          />
        {/each}
      </div>
    {:else if result.type === 'topbottom'}
      <div class="result-stack">
        {#each result.slots as slot}
          {@const metric = METRICS.find((m) => m.key === slot.metric)}
          {@const series = metric?.key === 'net_kg' || metric?.key === 'scrap_kg' ? toTonneSeries(slot.series) : slot.series}
          <ChartOverlay
            title={metric?.label || 'Unknown'}
            subtitle="Daily trend"
            series={series}
            forecast={[]}
            anomalies={[]}
            unit={metric?.unit || ''}
          />
        {/each}
      </div>
    {:else if result.type === 'multi'}
      <div class="result-grid">
        {#each result.slots as slot}
          {@const metric = METRICS.find((m) => m.key === slot.metric)}
          {@const series = metric?.key === 'net_kg' || metric?.key === 'scrap_kg' ? toTonneSeries(slot.series) : slot.series}
          <ChartOverlay
            title={metric?.label || 'Unknown'}
            subtitle="Daily trend"
            series={series}
            forecast={[]}
            anomalies={[]}
            unit={metric?.unit || ''}
            compact
          />
        {/each}
      </div>
    {:else if result.type === 'machine'}
      <div class="view-toggle">
        <button class="chip {machineViewMode === 'matrix' ? 'active' : ''}" on:click={() => (machineViewMode = 'matrix')}>Matrix</button>
        <button class="chip {machineViewMode === 'bars' ? 'active' : ''}" on:click={() => (machineViewMode = 'bars')}>Bars</button>
      </div>

      {#if machineViewMode === 'matrix'}
        <div class="matrix-container">
          <table class="matrix-table">
            <thead>
              <tr>
                <th>Machine</th>
                {#each result.metrics as metricKey}
                  {@const metric = METRICS.find((m) => m.key === metricKey)}
                  <th>{metric?.label || metricKey}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each result.machines as machine}
                <tr>
                  <td class="machine-name">{machine.name}</td>
                  {#each result.metrics as metricKey}
                    {@const metric = METRICS.find((m) => m.key === metricKey)}
                    {@const value = metricValue(machine, metricKey)}
                    {@const spark = sparklineData(machine, metricKey)}
                    <td>
                      <div class="cell-value">{metric?.format(value) || value.toFixed(1)}{metric?.unit || ''}</div>
                      {#if spark.length > 0}
                        <div class="mini-sparkline">
                          {#each spark.slice(-14) as pt, i}
                            {@const max = Math.max(...spark.slice(-14).map((p) => p.v), 1)}
                            {@const h = (pt.v / max) * 100}
                            <div class="spark-bar" style="height: {h}%"></div>
                          {/each}
                        </div>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="bars-container">
          {#each result.metrics as metricKey}
            {@const metric = METRICS.find((m) => m.key === metricKey)}
            {@const barData = result.machines.map((m) => ({ label: m.name, value: metricValue(m, metricKey) }))}
            <BarChart
              title={metric?.label || metricKey}
              data={barData}
              unit={metric?.unit || ''}
              format={metric?.format || ((v) => v.toFixed(1))}
              compact
            />
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
{/if}

<style>
  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  @media (min-width: 900px) {
    .preset-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }
  .preset-tile {
    background: var(--panel);
    border: 2px solid var(--panel-border);
    padding: 24px;
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-height: 140px;
    text-align: center;
  }
  .preset-tile:hover {
    background: var(--panel-2);
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  .preset-icon {
    width: 48px;
    height: 48px;
    color: var(--accent);
    flex-shrink: 0;
  }
  .preset-title {
    color: var(--highlight);
    font-size: 14px;
    font-weight: 600;
  }
  .preset-desc {
    color: var(--muted);
    font-size: 12px;
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    margin: 10px 0 16px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .back-btn:hover {
    background: var(--panel-2);
    border-color: var(--accent);
  }
  .param-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 22px;
    border-radius: 14px;
    box-shadow: var(--shadow-sm);
    margin: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .slots-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .slot-card {
    background: var(--panel-2);
    border: 1px solid var(--panel-border);
    padding: 16px;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .slot-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .slot-row label {
    flex: 1;
    min-width: 140px;
    color: var(--muted);
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .slot-row select {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 13px;
  }
  .remove-btn {
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid var(--danger);
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .remove-btn:hover {
    background: var(--danger);
    color: #fff;
  }
  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .checkbox-label input {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .code-hint {
    color: var(--muted);
    font-size: 11px;
    font-weight: 500;
  }
  h3 {
    color: var(--highlight);
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin: 0;
  }
  .error-box {
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid var(--danger);
    padding: 16px;
    border-radius: 10px;
    margin: 16px 0;
  }
  .loading-box {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 22px;
    border-radius: 14px;
    box-shadow: var(--shadow-sm);
    margin: 16px 0;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
  }
  .result-side {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin: 24px 0;
  }
  .result-side > :global(*) {
    flex: 1;
    min-width: 340px;
  }
  .result-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 24px 0;
  }
  .result-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .view-toggle {
    display: flex;
    gap: 8px;
    margin: 16px 0;
  }
  .chip {
    background: var(--panel);
    color: var(--soft);
    border: 1px solid var(--panel-border);
    padding: 8px 14px;
    border-radius: 999px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
  }
  .chip:hover {
    background: var(--panel-2);
    color: var(--text);
  }
  .chip.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .matrix-container {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 22px;
    border-radius: 14px;
    box-shadow: var(--shadow-sm);
    overflow-x: auto;
    margin: 16px 0;
  }
  .matrix-table {
    width: 100%;
    border-collapse: collapse;
  }
  .matrix-table th {
    background: var(--panel-2);
    color: var(--highlight);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 12px 16px;
    text-align: left;
    border-bottom: 2px solid var(--panel-border);
  }
  .matrix-table td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--panel-border);
    color: var(--text);
    font-size: 13px;
  }
  .machine-name {
    font-weight: 600;
    color: var(--highlight);
  }
  .cell-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .mini-sparkline {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 24px;
    margin-top: 6px;
  }
  .spark-bar {
    flex: 1;
    background: var(--accent);
    opacity: 0.6;
    min-height: 2px;
    border-radius: 1px;
  }
  .bars-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 16px 0;
  }
</style>
