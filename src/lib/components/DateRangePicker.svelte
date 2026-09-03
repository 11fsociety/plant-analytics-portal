<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let from: string | null = null;
  export let to: string | null = null;
  export let compare = false;
  export let allowCompare = true;

  const dispatch = createEventDispatcher<{
    change: { from: string | null; to: string | null; compare: boolean; preset: string };
  }>();

  type Preset = {
    key: string;
    label: string;
    days: number | null | 'today' | 'yesterday' | 'day-before' | 'this-week' | 'last-week' | 'this-month' | 'last-month';
  };
  const PRESETS: Preset[] = [
    { key: 'today', label: 'Today', days: 'today' },
    { key: 'yesterday', label: 'Yesterday', days: 'yesterday' },
    { key: 'day-before', label: 'Day before', days: 'day-before' },
    { key: '7', label: 'Last 7 days', days: 7 },
    { key: '30', label: 'Last 30 days', days: 30 },
    { key: 'this-week', label: 'This week', days: 'this-week' },
    { key: 'last-week', label: 'Last week', days: 'last-week' },
    { key: 'this-month', label: 'This month', days: 'this-month' },
    { key: 'last-month', label: 'Last month', days: 'last-month' },
    { key: '90', label: 'Last 3 months', days: 90 },
    { key: '180', label: 'Last 6 months', days: 180 },
    { key: 'all', label: 'All time', days: null },
  ];

  let showCustom = false;
  let customFrom = from ?? '';
  let customTo = to ?? '';

  function iso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function computeRange(days: number | null | string): { from: string | null; to: string | null } {
    if (days == null) return { from: null, to: null };
    if (typeof window === 'undefined') return { from: null, to: null };

    const today = new Date();

    // Handle numeric days (existing behavior)
    if (typeof days === 'number') {
      const start = new Date(today);
      start.setDate(start.getDate() - (days - 1));
      return { from: iso(start), to: iso(today) };
    }

    // Handle string discriminators
    switch (days) {
      case 'today': {
        return { from: iso(today), to: iso(today) };
      }
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { from: iso(yesterday), to: iso(yesterday) };
      }
      case 'day-before': {
        const dayBefore = new Date(today);
        dayBefore.setDate(dayBefore.getDate() - 2);
        return { from: iso(dayBefore), to: iso(dayBefore) };
      }
      case 'this-week': {
        const day = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        const daysToMonday = (day + 6) % 7; // Monday = 0 days back, Tuesday = 1 day back, ..., Sunday = 6 days back
        const monday = new Date(today);
        monday.setDate(monday.getDate() - daysToMonday);
        return { from: iso(monday), to: iso(today) };
      }
      case 'last-week': {
        const day = today.getDay();
        const daysToMonday = (day + 6) % 7;
        const thisMonday = new Date(today);
        thisMonday.setDate(thisMonday.getDate() - daysToMonday);
        const lastMonday = new Date(thisMonday);
        lastMonday.setDate(lastMonday.getDate() - 7);
        const lastSunday = new Date(lastMonday);
        lastSunday.setDate(lastSunday.getDate() + 6);
        return { from: iso(lastMonday), to: iso(lastSunday) };
      }
      case 'this-month': {
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: iso(firstOfMonth), to: iso(today) };
      }
      case 'last-month': {
        const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0); // Day 0 = last day of previous month
        return { from: iso(firstOfLastMonth), to: iso(lastOfLastMonth) };
      }
      default:
        return { from: null, to: null };
    }
  }

  function dateMatch(a: string | null, b: string | null): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof window === 'undefined') return a === b;
    const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
    return ms / 86400000 <= 1; // ±1 day tolerance
  }

  function activePreset(): string {
    if (from == null && to == null) return 'all';
    for (const p of PRESETS) {
      if (p.days == null) continue;
      const range = computeRange(p.days);
      if (dateMatch(range.from, from) && dateMatch(range.to, to)) return p.key;
    }
    return 'custom';
  }

  function applyPreset(preset: Preset) {
    const range = computeRange(preset.days);
    from = range.from;
    to = range.to;
    showCustom = false;
    dispatch('change', { from, to, compare, preset: preset.key });
  }

  function toggleCompare() {
    if (!allowCompare) return;
    compare = !compare;
    dispatch('change', { from, to, compare, preset: activePreset() });
  }

  function openCustom() {
    customFrom = from ?? '';
    customTo = to ?? '';
    showCustom = true;
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    from = customFrom;
    to = customTo;
    showCustom = false;
    dispatch('change', { from, to, compare, preset: 'custom' });
  }

  function cancelCustom() {
    showCustom = false;
  }

  function onEscape(e: KeyboardEvent) {
    if (e.key === 'Escape' && showCustom) showCustom = false;
  }

  onMount(() => {
    if (typeof document !== 'undefined') document.addEventListener('keydown', onEscape);
  });
  onDestroy(() => {
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onEscape);
  });

  // Svelte only re-runs a reactive statement when it sees tracked dependencies
  // in its body — a bare `activePreset()` call doesn't reveal that it reads
  // `from` and `to` internally. Reference them explicitly so the highlight
  // updates when the parent re-passes new `from`/`to` props.
  $: current = (from, to, activePreset());
</script>

<div class="range-bar">
  {#each PRESETS as p}
    <button class="chip" class:active={current === p.key} on:click={() => applyPreset(p)}>{p.label}</button>
  {/each}
  <button class="chip" class:active={current === 'custom'} on:click={openCustom}>Custom…</button>

  {#if allowCompare}
    <span class="sep"></span>
    {@const compareDisabled = from == null || to == null}
    <button
      class="chip compare"
      class:on={compare && !compareDisabled}
      class:disabled={compareDisabled}
      disabled={compareDisabled}
      on:click={toggleCompare}
      aria-pressed={compare}
      title={compareDisabled ? 'Pick a date range first — there is no previous period for All time' : 'Compare with previous same-length period'}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M21 7H9"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h12"/></svg>
      Compare
    </button>
  {/if}
</div>

<!-- Resolved-range readout: shows what actual dates are currently in scope. -->
<div class="range-readout">
  {#if from == null && to == null}
    <span class="range-label">Range:</span> <span class="range-value">All time</span>
  {:else}
    <span class="range-label">Range:</span>
    <span class="range-value">{from ?? '—'} <span class="range-arrow">→</span> {to ?? '—'}</span>
  {/if}
</div>

{#if showCustom}
  <div class="custom-backdrop" on:click={cancelCustom} role="presentation">
    <div class="custom-popover" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="custom-title">Custom date range</div>
      <label>From <input type="date" bind:value={customFrom} /></label>
      <label>To <input type="date" bind:value={customTo} /></label>
      <div class="custom-actions">
        <button class="btn secondary" on:click={cancelCustom}>Cancel</button>
        <button class="btn" on:click={applyCustom} disabled={!customFrom || !customTo}>Apply</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .range-bar {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    margin: 8px 0 8px;
  }
  .range-readout {
    color: var(--muted);
    font-size: 11px;
    margin: 0 0 20px;
    padding-left: 2px;
    letter-spacing: 0.2px;
  }
  .range-readout .range-label { text-transform: uppercase; letter-spacing: 0.4px; margin-right: 4px; }
  .range-readout .range-value { color: var(--text); font-weight: 500; font-variant-numeric: tabular-nums; }
  .range-readout .range-arrow { color: var(--muted); margin: 0 4px; }
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
  .chip:hover { background: var(--panel-2); color: var(--text); transform: translateY(-1px); }
  .chip.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .chip.active:hover { background: var(--accent-2); }
  .sep { width: 1px; height: 20px; background: var(--panel-border); margin: 0 4px; }
  .chip.compare { display: inline-flex; align-items: center; gap: 6px; }
  .chip.compare.on { background: var(--info-bg); color: var(--info); border-color: var(--info); }
  .chip.compare svg { width: 12px; height: 12px; }

  .custom-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.35);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .custom-popover {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    padding: 22px;
    min-width: 280px;
    box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column; gap: 10px;
  }
  .custom-title { color: var(--highlight); font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .custom-popover label { color: var(--muted); font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
  .custom-popover input {
    background: var(--panel-2); border: 1px solid var(--panel-border); color: var(--text);
    padding: 8px 10px; border-radius: 8px; font-size: 13px;
  }
  .custom-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
</style>
