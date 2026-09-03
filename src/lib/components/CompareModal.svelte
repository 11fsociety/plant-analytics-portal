<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let open = false;
  export let availableMonths: string[] = [];

  const dispatch = createEventDispatcher<{
    submit: { months: string[] };
    close: void;
  }>();

  let selectedMonths: string[] = [];

  $: canCompare = selectedMonths.length >= 2;

  function toggleMonth(month: string) {
    if (selectedMonths.includes(month)) {
      selectedMonths = selectedMonths.filter((m) => m !== month);
    } else {
      selectedMonths = [...selectedMonths, month];
    }
  }

  function handleSubmit() {
    if (!canCompare) return;
    dispatch('submit', { months: selectedMonths });
    close();
  }

  function close() {
    open = false;
    dispatch('close');
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close();
  }

  onMount(() => {
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeydown);
  });
  onDestroy(() => {
    if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown);
  });
</script>

{#if open}
  <div class="backdrop" on:click={close} role="presentation">
    <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>Compare months</h3>
        <p class="subtitle">Pick 2+ months. Chart shows production (bars) + scrap% + downtime% (lines).</p>
      </div>

      <div class="modal-body">
        <div class="section">
          <h4>Months</h4>
          <div class="checkbox-list">
            {#each availableMonths as month}
              <label class="checkbox-item">
                <input
                  type="checkbox"
                  checked={selectedMonths.includes(month)}
                  on:change={() => toggleMonth(month)}
                />
                <span>{month}</span>
              </label>
            {/each}
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn secondary" on:click={close}>Cancel</button>
        <button class="btn" disabled={!canCompare} on:click={handleSubmit}>Compare</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    padding: 24px;
    min-width: 380px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .modal-header h3 {
    color: var(--highlight);
    font-weight: 600;
    font-size: 16px;
    margin: 0 0 4px;
  }
  .modal-header .subtitle {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }
  .section h4 {
    color: var(--text);
    font-weight: 600;
    font-size: 13px;
    margin: 0 0 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .checkbox-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 6px;
  }
  .checkbox-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    color: var(--text);
    font-size: 13px;
  }
  .checkbox-item:hover {
    background: var(--panel-2);
  }
  .checkbox-item input[type='checkbox'] {
    cursor: pointer;
  }
  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid var(--panel-border);
  }
</style>
