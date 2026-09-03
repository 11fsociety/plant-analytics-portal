<script lang="ts">
  import { onDestroy } from 'svelte';

  export let title: string;
  export let subtitle: string | undefined = undefined;
  /** Array of {label, value} — value goes to the right, label on the y-axis. */
  export let data: Array<{ label: string; value: number }> = [];
  /** Unit for tooltip, e.g. "hrs" or "t". */
  export let unit = '';
  /** Accent CSS color. Defaults to the CSS var --accent. Callers can pass another for scrap vs downtime differentiation. */
  export let accent = 'var(--accent)';
  /** Optional value formatter for the axis + tooltip. */
  export let format: (v: number) => string = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  let container: HTMLDivElement;
  let chart: any = null;
  // Serialise concurrent render() invocations. Rapid prop changes would
  // otherwise let multiple async imports race past the `if (chart)` guard
  // and orphan Chart.js instances.
  let renderSeq = 0;

  async function render() {
    if (!container) return;
    const token = ++renderSeq;
    const { Chart, registerables } = await import('chart.js');
    if (token !== renderSeq) return; // superseded by a later call
    Chart.register(...registerables);

    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (token !== renderSeq) return; // re-check after destroy

    // Truncate long labels to 30 chars + ellipsis
    const labels = data.map((d) => d.label.length > 30 ? d.label.slice(0, 30) + '…' : d.label);
    const values = data.map((d) => d.value);

    chart = new Chart(container, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: accent,
          borderColor: accent,
          borderRadius: 6,
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const val = ctx.parsed.x;
                const rawLabel = data[ctx.dataIndex]?.label ?? '';
                return `${rawLabel}: ${format(val)}${unit ? ' ' + unit : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              color: '#667085',
              font: { size: 10 },
              callback: (val: any) => format(+val),
            },
            beginAtZero: true,
          },
          y: {
            grid: { display: false },
            ticks: {
              color: '#667085',
              font: { size: 10 },
            },
          },
        },
      },
    });
  }

  // The reactive statement below fires once when `container` binds after mount,
  // then again on every prop change. Do NOT also call render() in onMount —
  // that would double-fire on the initial paint.
  $: if (container && data) {
    render();
  }

  onDestroy(() => {
    if (chart) chart.destroy();
  });
</script>

<div class="chart-card">
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
      <canvas bind:this={container}></canvas>
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
  .chart-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .titles { min-width: 0; }
  .chart-title { color: var(--highlight); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
  .chart-subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .chart-body { position: relative; flex: 1; min-height: 220px; display: flex; align-items: center; justify-content: center; }
  .chart-body canvas { width: 100% !important; height: 100% !important; }
  .empty { color: var(--muted); font-size: 12px; text-align: center; }
</style>
