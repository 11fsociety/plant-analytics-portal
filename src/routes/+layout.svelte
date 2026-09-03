<script lang="ts">
  import '$lib/styles/tokens.css';
  import '$lib/styles/global.css';
  import { page } from '$app/stores';
  import Nav from '$lib/components/Nav.svelte';

  $: showNav = $page.url.pathname !== '/login';
</script>

{#if showNav}
  <Nav user={$page.data.user} />
{/if}
<main>
  <slot />
</main>
{#if showNav}
  <footer><small>Plant Analytics Portal · ops console</small></footer>
{/if}
