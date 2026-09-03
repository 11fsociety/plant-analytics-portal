<script lang="ts">
  import { onDestroy } from 'svelte';

  export let title: string;
  export let subtitle: string | undefined = undefined;
  /** Historical points; d = YYYY-MM-DD, v = value. */
  export let series: Array<{ d: string; v: number }> = [];
  /** Forecast tail after the last historical point. */
  export let forecast: Array<{ d: string; point: number; low: number; high: number }> = [];
  /** Anomaly markers on historical points. */
  export let anomalies: Array<{ d: string; v: number; z: number }> = [];
  /** Compare series from previous period, same length as current series. */
  export let compareSeries: Array<{ d: string; v: number }> | null = null;
  /** Unit for the y-axis label + tooltip. */
  export let unit = '';
  /** Optional single-line diagnostic footnote — e.g. "holt-winters · α=0.3 · rmse=142". */
  export let diagnostic: string | undefined = undefined;
  /** Compact mode reduces the card + chart height. Use for dashboard where the
   *  chart is context, not the primary content. */
  export let compact = false;

  let container: HTMLDivElement;
  let chart: any = null;
  let showOverlays = true;
  // Serialise concurrent render() invocations. Rapid prop changes (e.g. horizon
  // 7 → 14 → 30 in quick succession) would otherwise let multiple async imports
  // race past the `if (chart)` guard and orphan Chart.js instances.
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

    const labels = [
      ...series.map((p) => p.d),
      ...forecast.map((p) => p.d),
    ];

    const historyValues = series.map((p) => p.v);
    const forecastValues = new Array(series.length).fill(null).concat(forecast.map((p) => p.point));
    const forecastLow = new Array(series.length).fill(null).concat(forecast.map((p) => p.low));
    const forecastHigh = new Array(series.length).fill(null).concat(forecast.map((p) => p.high));
    const anomalyByD = new Map(anomalies.map((a) => [a.d, a] as const));
    const anomalyValues = series.map((p) => (anomalyByD.has(p.d) ? p.v : null));

    // Bridge the gap between history and forecast so the eye visually reads them
    // as a continuation, not two disjoint lines. Duplicate the last historical
    // point at the start of the forecast band.
    if (series.length > 0 && forecast.length > 0) {
      const bridgeIdx = series.length - 1;
      forecastValues[bridgeIdx] = series[series.length - 1].v;
      forecastLow[bridgeIdx] = series[series.length - 1].v;
      forecastHigh[bridgeIdx] = series[series.length - 1].v;
    }

    const historyDataset = {
      label: 'History',
      data: [...historyValues, ...new Array(forecast.length).fill(null)],
      borderColor: 'rgba(33, 181, 115, 1)',
      backgroundColor: 'rgba(33, 181, 115, 0.08)',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      fill: false,
      spanGaps: false,
    };

    const forecastDataset = {
      label: 'Forecast',
      data: forecastValues,
      borderColor: 'rgba(61, 125, 230, 0.9)',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      fill: false,
      hidden: !showOverlays,
    };

    const forecastLowDataset = {
      label: 'Forecast low',
      data: forecastLow,
      borderColor: 'transparent',
      backgroundColor: 'rgba(61, 125, 230, 0.14)',
      pointRadius: 0,
      fill: '+1',
      hidden: !showOverlays,
    };

    const forecastHighDataset = {
      label: 'Forecast high',
      data: forecastHigh,
      borderColor: 'transparent',
      backgroundColor: 'rgba(61, 125, 230, 0.14)',
      pointRadius: 0,
      fill: false,
      hidden: !showOverlays,
    };

    const anomalyDataset = {
      label: 'Anomaly',
      type: 'scatter' as const,
      data: series.map((p, i) => ({ x: p.d, y: anomalyValues[i] })).filter((pt) => pt.y != null),
      backgroundColor: 'rgba(229, 72, 77, 0.9)',
      borderColor: 'rgba(229, 72, 77, 1)',
      pointRadius: 5,
      pointHoverRadius: 7,
      showLine: false,
      hidden: !showOverlays,
    };

    const compareDataset = compareSeries
      ? {
          label: 'Previous period',
          data: [
            ...compareSeries.slice(0, series.length).map((p) => p.v),
            ...new Array(forecast.length).fill(null),
          ],
          borderColor: 'rgba(102, 112, 133, 0.55)',
          borderDash: [2, 2],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: false,
          hidden: !showOverlays,
        }
      : null;

    const datasets = [
      historyDataset,
      forecastLowDataset,
      forecastHighDataset,
      forecastDataset,
      anomalyDataset,
      compareDataset,
    ].filter(Boolean);

    chart = new Chart(container, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            // Filter out the low/high band datasets — they're just visual shading,
            // not distinct data points, and duplicate the point-forecast value in the tooltip.
            filter: (item: any) => {
              const l = item.dataset?.label as string | undefined;
              return l !== 'Forecast low' && l !== 'Forecast high';
            },
            callbacks: {
              // Show a color square that matches the actual line color (borderColor)
              // rather than the transparent backgroundColor that Chart.js picks by default.
              labelColor: (ctx: any) => ({
                borderColor: ctx.dataset.borderColor,
                backgroundColor: ctx.dataset.borderColor,
                borderWidth: 0,
                borderRadius: 2,
              }),
              label: (ctx: any) => {
                const dsLabel = ctx.dataset.label as string;
                const val = ctx.parsed.y;
                if (val == null) return '';
                if (dsLabel === 'Anomaly') {
                  const d = ctx.parsed.x || labels[ctx.dataIndex];
                  const a = anomalyByD.get(d);
                  return `Anomaly ${val.toFixed(1)}${unit ? ' ' + unit : ''}  (z=${a?.z ?? '?'})`;
                }
                if (dsLabel === 'Previous period') {
                  return `Prev period: ${val.toFixed(2)}${unit ? ' ' + unit : ''}`;
                }
                return `${dsLabel}: ${val.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ' ' + unit : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { maxRotation: 0, autoSkipPadding: 24, color: '#667085', font: { size: 10 } },
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

  // The reactive statement below fires once when `container` binds after mount,
  // then again on every prop change. Do NOT also call render() in onMount —
  // that would double-fire on the initial paint.
  // Reference every reactive-tracked prop so Svelte re-runs render() when any
  // of them changes (including compareSeries flipping null ↔ non-null).
  $: if (container && (series || forecast || anomalies || compareSeries || compareSeries === null)) {
    render();
  }

  onDestroy(() => {
    if (chart) chart.destroy();
  });

  function toggleOverlays() {
    showOverlays = !showOverlays;
    render();
  }
</script>

<div class="chart-card" class:compact>
  <header>
    <div class="titles">
      <div class="chart-title">{title}</div>
      {#if subtitle}<div class="chart-subtitle">{subtitle}</div>{/if}
    </div>
    <button
      class="eye-btn"
      class:muted={!showOverlays}
      on:click={toggleOverlays}
      aria-label="Toggle forecast and anomaly overlays"
      title={showOverlays ? 'Hide forecast + anomalies' : 'Show forecast + anomalies'}
    >
      {#if showOverlays}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-7 0-11-8-11-8a17.7 17.7 0 0 1 4.16-5.31M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a17.9 17.9 0 0 1-1.94 2.94M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      {/if}
    </button>
  </header>

  <div class="chart-body">
    <canvas bind:this={container}></canvas>
  </div>

  {#if diagnostic}
    <footer class="diag">
      {diagnostic}
      {#if anomalies.length}<span class="anom-count">· {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'}</span>{/if}
      {#if compareSeries}<span class="compare-label">· vs prev</span>{/if}
    </footer>
  {/if}
</div>

<style>
  .chart-card.compact { min-height: 200px; padding: 16px; }
  .chart-card.compact .chart-body { min-height: 140px; }
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
    min-height: 320px;
  }
  .chart-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .titles { min-width: 0; }
  .chart-title { color: var(--highlight); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
  .chart-subtitle { color: var(--muted); font-size: 12px; margin-top: 3px; }
  .eye-btn {
    background: var(--panel-2);
    border: 1px solid var(--panel-border);
    color: var(--muted);
    width: 30px; height: 30px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: color 0.15s, background 0.15s, transform 0.1s;
    flex-shrink: 0;
  }
  .eye-btn:hover { background: var(--panel); color: var(--text); transform: translateY(-1px); }
  .eye-btn.muted { color: var(--panel-border); }
  .eye-btn svg { width: 15px; height: 15px; }
  .chart-body { position: relative; flex: 1; min-height: 220px; }
  .chart-body canvas { width: 100% !important; height: 100% !important; }
  .diag { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding-top: 4px; border-top: 1px solid var(--panel-border); }
  .anom-count { color: var(--danger); margin-left: 6px; }
  .compare-label { color: rgba(102, 112, 133, 0.75); margin-left: 6px; }
</style>
