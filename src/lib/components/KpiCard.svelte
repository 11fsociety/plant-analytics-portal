<script lang="ts">
  export let label: string;
  export let value: string | number;
  export let sub: string | undefined = undefined;
  export let tone: 'success' | 'warn' | 'danger' | 'info' | 'purple' = 'success';
  export let icon: 'cube' | 'scale' | 'chart' | 'clock' | 'trash' | 'ratio' = 'cube';

  const ICONS: Record<string, string> = {
    cube: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7L12 12l8.7-5M12 22V12',
    scale: 'M12 3v18M5 8h14M4 8l3 8h4l-3-8M20 8l-3 8h-4l3-8',
    chart: 'M3 3v18h18M7 15l4-4 4 3 5-6',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6',
    ratio: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 16l8-8',
  };
</script>

<div class="kpi">
  <div class="kpi-icon {tone}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d={ICONS[icon]} />
    </svg>
  </div>
  <div class="kpi-body">
    <div class="label">{label}</div>
    <div class="value">{value}</div>
    {#if sub}<div class="sub">{sub}</div>{/if}
  </div>
</div>

<style>
  .kpi {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 22px;
    border-radius: var(--r-card);
    display: flex;
    align-items: center;
    gap: 16px;
    box-shadow: var(--shadow-sm);
    transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
  }
  .kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  .kpi-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kpi-icon svg { width: 22px; height: 22px; }
  .kpi-icon.success { background: var(--success-bg); color: var(--success); }
  .kpi-icon.warn { background: var(--warn-bg); color: var(--warn); }
  .kpi-icon.danger { background: var(--danger-bg); color: var(--danger); }
  .kpi-icon.info { background: var(--info-bg); color: var(--info); }
  .kpi-icon.purple { background: var(--purple-bg); color: var(--purple); }
  .kpi-body { flex: 1; min-width: 0; }
  .label { color: var(--muted); font-size: 12px; font-weight: 500; letter-spacing: 0.2px; }
  .value { color: var(--highlight); font-size: 26px; margin-top: 2px; font-weight: 700; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; }
  .sub { color: var(--success); font-size: 11px; margin-top: 2px; font-weight: 500; }
</style>
