<script lang="ts">
  import { onDestroy } from 'svelte';

  /** One row per month in scope. All values are ABSOLUTE (kg / hours);
   *  percentages are computed inside this component. */
  export let rows: Array<{
    month: string;      // "YYYY-MM"
    net_kg: number;
    scrap_kg: number;
    downtime_hrs: number;
    days_in_month: number;
  }> = [];
  export let title = 'Month comparison';
  export let subtitle: string | undefined = undefined;

  let container: HTMLCanvasElement;
  let chart: any = null;
  let renderSeq = 0;

  async function render() {
    if (!container) return;
    const token = ++renderSeq;
    const { Chart, registerables } = await import('chart.js');
    if (token !== renderSeq) return;
    Chart.register(...registerables);

    if (chart) { chart.destroy(); chart = null; }
    if (token !== renderSeq) return;

    // Sort rows by month ascending for deterministic x-axis order.
    const sorted = rows.slice().sort((a, b) => a.month.localeCompare(b.month));
    const labels = sorted.map((r) => r.month);
    const productionTonnes = sorted.map((r) => r.net_kg / 1000);
    const scrapPct = sorted.map((r) => (r.net_kg > 0 ? (r.scrap_kg / r.net_kg) * 100 : 0));
    const downtimePct = sorted.map((r) => {
      const monthHrs = r.days_in_month * 24;
      return monthHrs > 0 ? (r.downtime_hrs / monthHrs) * 100 : 0;
    });

    chart = new Chart(container, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Net production',
            data: productionTonnes,
            backgroundColor: 'rgba(33, 181, 115, 0.85)',
            borderColor: 'rgba(33, 181, 115, 1)',
            borderWidth: 0,
            borderRadius: 6,
            yAxisID: 'yTonnes',
            order: 2,
          },
          {
            type: 'line',
            label: 'Scrap % of net',
            data: scrapPct,
            borderColor: 'rgba(255, 200, 0, 1)',
            backgroundColor: 'rgba(255, 200, 0, 1)',
            borderDash: [6, 4],
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0,
            yAxisID: 'yPct',
            order: 1,
          },
          {
            type: 'line',
            label: 'Downtime % of month',
            data: downtimePct,
            borderColor: 'rgba(229, 72, 77, 1)',
            backgroundColor: 'rgba(229, 72, 77, 1)',
            borderDash: [6, 4],
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0,
            yAxisID: 'yPct',
            order: 0,
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
            labels: { color: '#667085', font: { size: 11 }, usePointStyle: true, boxWidth: 8 },
          },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const dsLabel = ctx.dataset.label as string;
                const v = ctx.parsed.y;
                if (v == null) return '';
                if (dsLabel === 'Net production') return `${dsLabel}: ${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`;
                return `${dsLabel}: ${v.toFixed(2)}%`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { color: '#667085', font: { size: 11 } },
          },
          yTonnes: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: {
              color: 'rgba(33, 181, 115, 1)',
              font: { size: 10 },
              callback: (v: any) => `${v} t`,
            },
            beginAtZero: true,
            title: { display: true, text: 'Tonnes', color: 'rgba(33, 181, 115, 1)', font: { size: 11 } },
          },
          yPct: {
            type: 'linear',
            position: 'right',
            grid: { display: false },
            ticks: {
              color: 'rgba(229, 72, 77, 1)',
              font: { size: 10 },
              callback: (v: any) => `${v}%`,
            },
            beginAtZero: true,
            title: { display: true, text: '% (scrap / downtime)', color: 'rgba(229, 72, 77, 1)', font: { size: 11 } },
          },
        },
      },
    });
  }

  $: if (container && rows) render();
  onDestroy(() => { if (chart) chart.destroy(); });
</script>

<div class="chart-card">
  <header>
    <div class="titles">
      <div class="chart-title">{title}</div>
      {#if subtitle}<div class="chart-subtitle">{subtitle}</div>{/if}
    </div>
  </header>
  <div class="chart-body">
    {#if rows.length === 0}
      <div class="empty">No data for these months</div>
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
    transition: box-shadow 0.15s ease-out;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 340px;
    margin-bottom: 24px;
  }
  .chart-card:hover { box-shadow: var(--shadow-md); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .titles { min-width: 0; }
  .chart-title { color: var(--highlight); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
  .chart-subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .chart-body { position: relative; flex: 1; min-height: 300px; }
  .chart-body canvas { width: 100% !important; height: 100% !important; }
  .empty { color: var(--muted); font-size: 12px; text-align: center; padding: 40px 0; }
</style>
