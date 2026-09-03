<script lang="ts">
  import { onDestroy } from 'svelte';

  export let title: string;
  export let subtitle: string | undefined = undefined;
  /** X-axis labels, typically dates. */
  export let xLabels: string[] = [];
  /** Left-axis series (e.g., production in tonnes). */
  export let seriesA: number[] = [];
  export let seriesA_label: string = 'Series A';
  export let seriesA_unit: string = '';
  /** Right-axis series (e.g., downtime in hours). */
  export let seriesB: number[] = [];
  export let seriesB_label: string = 'Series B';
  export let seriesB_unit: string = '';

  let container: HTMLDivElement;
  let chart: any = null;
  let renderSeq = 0;

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

    chart = new Chart(container, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          {
            label: seriesA_label,
            data: seriesA,
            borderColor: '#21b573',
            backgroundColor: 'rgba(33, 181, 115, 0.1)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            fill: false,
            yAxisID: 'yA',
          },
          {
            label: seriesB_label,
            data: seriesB,
            borderColor: '#ff9500',
            borderDash: [4, 4],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
            fill: false,
            yAxisID: 'yB',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#667085',
              font: { size: 11 },
              usePointStyle: true,
              pointStyle: 'rect',
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const label = ctx.dataset.label || '';
                const val = ctx.parsed.y;
                const unit = ctx.dataset.yAxisID === 'yA' ? seriesA_unit : seriesB_unit;
                return `${label}: ${val.toFixed(2)}${unit ? ' ' + unit : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#667085',
              font: { size: 10 },
              maxRotation: 0,
              autoSkipPadding: 16,
            },
          },
          yA: {
            type: 'linear',
            position: 'left',
            title: {
              display: true,
              text: `${seriesA_label} (${seriesA_unit})`,
              color: '#21b573',
              font: { size: 11, weight: '600' },
            },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              color: '#667085',
              font: { size: 10 },
            },
            beginAtZero: true,
          },
          yB: {
            type: 'linear',
            position: 'right',
            title: {
              display: true,
              text: `${seriesB_label} (${seriesB_unit})`,
              color: '#ff9500',
              font: { size: 11, weight: '600' },
            },
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#667085',
              font: { size: 10 },
            },
            beginAtZero: true,
          },
        },
      },
    });
  }

  $: if (container && xLabels && seriesA && seriesB) {
    render();
  }

  onDestroy(() => {
    if (chart) chart.destroy();
  });
</script>

<div class="chart-card compact">
  <header>
    <div class="titles">
      <div class="chart-title">{title}</div>
      {#if subtitle}<div class="chart-subtitle">{subtitle}</div>{/if}
    </div>
  </header>

  <div class="chart-body">
    {#if xLabels.length === 0 || seriesA.length === 0}
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
  .chart-card.compact {
    min-height: 240px;
    padding: 18px;
  }
  .chart-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .titles { min-width: 0; }
  .chart-title { color: var(--highlight); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
  .chart-subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .chart-body { position: relative; flex: 1; min-height: 180px; display: flex; align-items: center; justify-content: center; }
  .chart-body canvas { width: 100% !important; height: 100% !important; }
  .empty { color: var(--muted); font-size: 12px; text-align: center; }
</style>
