<script lang="ts">
  import { onDestroy } from 'svelte';

  export let title: string;
  export let unit: string;
  export let monthTotals: Array<{ month: string; total: number }> = [];
  export let monthDaily: Record<string, Array<{ d: number; v: number }>> = {};
  export let format: ((v: number) => string) | undefined = undefined;

  let barContainer: HTMLCanvasElement;
  let lineContainer: HTMLCanvasElement;
  let barChart: any = null;
  let lineChart: any = null;
  let renderSeq = 0;

  const COLORS = ['#21b573', '#3d7de6', '#ff9500', '#e5484d', '#9068e0', '#22c896', '#60a5fa', '#ffb454'];

  async function render() {
    if (!barContainer || !lineContainer) return;
    const token = ++renderSeq;

    const { Chart, registerables } = await import('chart.js');
    if (token !== renderSeq) return;
    Chart.register(...registerables);

    // Destroy existing charts
    if (barChart) {
      barChart.destroy();
      barChart = null;
    }
    if (lineChart) {
      lineChart.destroy();
      lineChart = null;
    }
    if (token !== renderSeq) return;

    // Bar chart: month totals
    barChart = new Chart(barContainer, {
      type: 'bar',
      data: {
        labels: monthTotals.map((m) => m.month),
        datasets: [
          {
            label: title,
            data: monthTotals.map((m) => m.total),
            backgroundColor: COLORS[0],
            borderColor: COLORS[0],
            borderWidth: 0,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const val = ctx.parsed.y;
                const formatted = format ? format(val) : `${val.toLocaleString()} ${unit}`;
                return `${title}: ${formatted}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#667085', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { color: '#667085', font: { size: 10 } },
            beginAtZero: true,
          },
        },
      },
    });

    // Line chart: day-of-month overlay
    const months = Object.keys(monthDaily);
    const datasets = months.map((month, i) => {
      const dailyData = monthDaily[month] || [];
      return {
        label: month,
        data: dailyData.map((d) => ({ x: d.d, y: d.v })),
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: COLORS[i % COLORS.length],
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
      };
    });

    lineChart = new Chart(lineContainer, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: (items: any) => {
                if (items.length === 0) return '';
                return `Day ${items[0].parsed.x}`;
              },
              label: (ctx: any) => {
                const val = ctx.parsed.y;
                const formatted = format ? format(val) : `${val.toLocaleString()} ${unit}`;
                return `${ctx.dataset.label}: ${formatted}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: 1,
            max: 31,
            ticks: { stepSize: 5, color: '#667085', font: { size: 10 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
            title: { display: true, text: 'Day of month', color: '#667085', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { color: '#667085', font: { size: 10 } },
            beginAtZero: true,
          },
        },
      },
    });
  }

  $: if (barContainer && lineContainer && (monthTotals || monthDaily)) {
    render();
  }

  onDestroy(() => {
    if (barChart) barChart.destroy();
    if (lineChart) lineChart.destroy();
  });

  $: isEmpty = monthTotals.length === 0 || monthTotals.every((m) => m.total === 0);
</script>

<div class="result-card">
  <h3>{title}</h3>

  {#if isEmpty}
    <div class="empty-message">No data for these months on this metric</div>
  {:else}
    <div class="charts-row">
      <div class="chart-block">
        <div class="chart-label">Month totals</div>
        <div class="chart-canvas">
          <canvas bind:this={barContainer}></canvas>
        </div>
      </div>

      <div class="chart-block">
        <div class="chart-label">Day-of-month overlay</div>
        <div class="chart-canvas">
          <canvas bind:this={lineContainer}></canvas>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .result-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: var(--r-card);
    padding: 20px;
    box-shadow: var(--shadow-sm);
    transition: box-shadow 0.15s ease-out, transform 0.15s ease-out;
    margin-bottom: 16px;
  }
  .result-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }
  .result-card h3 {
    color: var(--highlight);
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin: 0 0 16px;
  }
  .empty-message {
    color: var(--muted);
    font-size: 13px;
    padding: 20px;
    text-align: center;
    background: var(--panel-2);
    border-radius: 8px;
  }
  .charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  @media (max-width: 900px) {
    .charts-row {
      grid-template-columns: 1fr;
    }
  }
  .chart-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .chart-label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
  }
  .chart-canvas {
    position: relative;
    min-height: 200px;
  }
  .chart-canvas canvas {
    width: 100% !important;
    height: 100% !important;
  }
</style>
