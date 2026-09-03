<script lang="ts">
  import { onDestroy } from 'svelte';

  export let title: string;
  export let subtitle: string | undefined = undefined;
  /** Array of {label, value} for each slice. */
  export let data: Array<{ label: string; value: number }> = [];
  /** Unit for tooltip, e.g. "hrs" or "t". */
  export let unit = '';
  /** Optional value formatter. */
  export let format: (v: number) => string = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  /** Compact mode reduces min-height 260 → 200. */
  export let compact = false;

  const PALETTE = ['#21b573', '#3d7de6', '#ff9500', '#e5484d', '#9068e0', '#22c896', '#60a5fa', '#ffb454'];

  let container: HTMLCanvasElement;
  let chart: any = null;
  let renderSeq = 0;

  $: total = data.reduce((sum, d) => sum + d.value, 0);

  async function render() {
    if (!container) return;
    const token = ++renderSeq;
    const { Chart, registerables } = await import('chart.js');
    if (token !== renderSeq) return;
    Chart.register(...registerables);

    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (token !== renderSeq) return;

    const labels = data.map((d) => d.label);
    const values = data.map((d) => d.value);
    const colors = data.map((_, i) => PALETTE[i % PALETTE.length]);

    chart = new Chart(container, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const val = ctx.parsed;
                const rawLabel = data[ctx.dataIndex]?.label ?? '';
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                return `${rawLabel}: ${format(val)}${unit ? ' ' + unit : ''} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  $: if (container && data) {
    render();
  }

  onDestroy(() => {
    if (chart) chart.destroy();
  });
</script>

<div class="chart-card" class:compact>
  <header>
    <div class="titles">
      <div class="chart-title">{title}</div>
      {#if subtitle}<div class="chart-subtitle">{subtitle}</div>{/if}
    </div>
  </header>

  <div class="chart-body">
    {#if data.length === 0}
      <div class="empty">No data</div>
    {:else}
      <div class="chart-container">
        <canvas bind:this={container}></canvas>
      </div>
      <div class="legend">
        {#each data as item, i}
          <div class="legend-item">
            <span class="legend-swatch" style="background-color: {PALETTE[i % PALETTE.length]};"></span>
            <span class="legend-label">{item.label}</span>
            <span class="legend-value">{format(item.value)}{unit}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .chart-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 22px;
    border-radius: var(--r-card);
    box-shadow: var(--shadow-sm);
    transition: box-shadow 0.15s ease-out, transform 0.15s ease-out;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 260px;
  }
  .chart-card.compact { min-height: 200px; }
  .chart-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .titles { min-width: 0; }
  .chart-title { color: var(--highlight); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
  .chart-subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .chart-body { position: relative; flex: 1; min-height: 180px; display: flex; align-items: center; gap: 20px; }
  .chart-container { flex: 0 0 60%; align-self: stretch; position: relative; }
  .chart-container canvas { width: 100% !important; height: 100% !important; }
  .legend { flex: 0 0 40%; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
  .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .legend-swatch { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
  .legend-label { flex: 1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend-value { color: var(--muted); font-weight: 500; flex-shrink: 0; }
  .empty { color: var(--muted); font-size: 12px; text-align: center; width: 100%; }
</style>
