<script lang="ts">
  export let title: string;
  export let subtitle: string | undefined = undefined;
</script>

<div class="chart-card">
  <div class="chart-title">{title}</div>
  {#if subtitle}<div class="chart-subtitle">{subtitle}</div>{/if}
  <div class="chart-body">
    <slot />
  </div>
</div>

<style>
  .chart-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 22px;
    border-radius: var(--r-card);
    min-height: 280px;
    box-shadow: var(--shadow-sm);
    transition: box-shadow 0.15s ease-out, transform 0.15s ease-out;
  }
  .chart-card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
  .chart-title { color: var(--highlight); font-size: 13px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
  .chart-subtitle { color: var(--muted); font-size: 12px; margin: 4px 0 14px; }
  .chart-body { position: relative; }
</style>
