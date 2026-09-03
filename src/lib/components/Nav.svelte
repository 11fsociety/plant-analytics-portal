<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { PLANTS, PLANT_META } from '$lib/plants';

  export let user: { email: string } | null = null;

  let theme: 'light' | 'dark' = 'light';
  let dropdownOpen = false;
  let dropdownRef: HTMLDivElement | null = null;

  const plants = PLANTS.map(slug => ({ slug, ...PLANT_META[slug] }));

  $: currentPlantSlug = $page.url.searchParams.get('plant') || 'navratan';
  $: currentPlant = plants.find(p => p.slug === currentPlantSlug) || plants[0];

  onMount(() => {
    const t = (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
    theme = t;
    document.documentElement.setAttribute('data-theme', t);

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
  });

  onDestroy(() => {
    // Svelte runs onDestroy even during SSR teardown; guard the document
    // access so the page doesn't 500 on server-render.
    if (typeof document === 'undefined') return;
    document.removeEventListener('click', handleOutsideClick);
    document.removeEventListener('keydown', handleEscape);
  });

  function handleOutsideClick(e: MouseEvent) {
    if (dropdownOpen && dropdownRef && !dropdownRef.contains(e.target as Node)) {
      dropdownOpen = false;
    }
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key === 'Escape' && dropdownOpen) {
      dropdownOpen = false;
    }
  }

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function selectPlant(slug: string) {
    const url = new URL($page.url);
    url.searchParams.set('plant', slug);
    goto(url.pathname + url.search);
    dropdownOpen = false;
  }

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    goto('/login');
  }

  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/predict', label: 'Predict' },
    { href: '/preset', label: 'Preset' },
    { href: '/upload', label: 'Upload' },
  ];

  $: pathname = $page.url.pathname;
</script>

<header>
  <div class="brand">
    <a href="/dashboard" class="brand-wordmark" aria-label="Plant Portal home">
      Plant <span class="brand-accent">Portal</span>
    </a>
    <span class="brand-separator">·</span>
    <div class="plant-switcher" bind:this={dropdownRef}>
      <button class="plant-switcher-btn" on:click={toggleDropdown} aria-label="Switch plant">
        <span class="plant-dot" style="background-color: {currentPlant.color};"></span>
        <span class="plant-name">{currentPlant.name}</span>
        <svg class="chevron" class:open={dropdownOpen} viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 8L2 4h8z"/>
        </svg>
      </button>
      {#if dropdownOpen}
        <div class="plant-dropdown">
          {#each plants as plant}
            <button
              class="plant-option"
              class:active={plant.slug === currentPlantSlug}
              on:click={() => selectPlant(plant.slug)}
            >
              <span class="plant-dot" style="background-color: {plant.color};"></span>
              <span class="plant-option-name">{plant.name}</span>
              {#if plant.slug === currentPlantSlug}
                <svg class="checkmark" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="2,6 5,9 10,3"/>
                </svg>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <nav>
    {#each links as l}
      <a href={l.href} class:active={pathname === l.href || pathname.startsWith(l.href + '/')}>{l.label}</a>
    {/each}
  </nav>
  <div class="header-right">
    {#if user}<span class="user-pill">{user.email}</span>{/if}
    <button class="icon-btn" on:click={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
      {#if theme === 'light'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      {/if}
    </button>
    <button class="logout-btn" on:click={logout}>Logout</button>
  </div>
</header>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-wordmark {
    font-weight: 600;
    font-size: 18px;
    color: var(--fg);
    text-decoration: none;
    white-space: nowrap;
  }

  .brand-wordmark:hover {
    opacity: 0.8;
  }

  .brand-accent {
    color: var(--accent);
  }

  .brand-separator {
    color: var(--muted);
    font-size: 18px;
    line-height: 1;
  }

  .plant-switcher {
    position: relative;
  }

  .plant-switcher-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
    transition: background 0.15s ease;
    color: var(--fg);
    font-size: 14px;
    font-weight: 500;
  }

  .plant-switcher-btn:hover {
    background: var(--panel-2);
  }

  .plant-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .plant-name {
    white-space: nowrap;
  }

  .chevron {
    width: 12px;
    height: 12px;
    color: var(--muted);
    transition: transform 0.15s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .plant-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    padding: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    z-index: 100;
  }

  [data-theme="dark"] .plant-dropdown {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .plant-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
    transition: background 0.15s ease;
    color: var(--fg);
    font-size: 14px;
    text-align: left;
  }

  .plant-option:hover {
    background: var(--panel-2);
  }

  .plant-option-name {
    flex: 1;
  }

  .checkmark {
    width: 14px;
    height: 14px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .user-pill {
    background: var(--panel-2);
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--panel-border);
  }
</style>
