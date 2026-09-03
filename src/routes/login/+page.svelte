<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  let email = '';
  let password = '';
  let error = '';
  let loading = false;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        error = j.error || 'Login failed';
        return;
      }
      const next = $page.url.searchParams.get('next') || '/dashboard';
      goto(next);
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in · Plant Analytics Portal</title>
</svelte:head>

<div class="login-shell">
  <form class="login-card" on:submit={submit}>
    <div class="brand-row">
      <div class="logo-dot"></div>
      <h1>Plant Portal</h1>
    </div>
    <div class="subtitle">Ops sign-in</div>
    {#if error}<div class="error-msg">{error}</div>{/if}
    <label for="email">Email</label>
    <input id="email" type="email" bind:value={email} required autocomplete="username" autofocus />
    <label for="password">Password</label>
    <input id="password" type="password" bind:value={password} required autocomplete="current-password" />
    <button class="btn" type="submit" disabled={loading}>
      {loading ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>

<style>
  .login-shell {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
  }
  .login-card {
    background: var(--panel);
    border: 1px solid var(--panel-border);
    padding: 36px;
    border-radius: 16px;
    width: 100%;
    max-width: 400px;
    box-shadow: var(--shadow-lg);
  }
  .brand-row { display: flex; align-items: center; gap: 10px; justify-content: center; margin-bottom: 4px; }
  .logo-dot {
    width: 22px; height: 22px; border-radius: 6px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
  }
  .login-card h1 { color: var(--highlight); font-size: 22px; margin: 0; }
  .subtitle { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  .login-card label { display: block; color: var(--muted); font-size: 12px; font-weight: 500; margin-bottom: 6px; }
  .login-card input {
    width: 100%;
    background: var(--panel-2);
    border: 1px solid var(--panel-border);
    color: var(--text);
    padding: 11px 14px;
    border-radius: 10px;
    margin-bottom: 16px;
    font-size: 14px;
    transition: border 0.15s, background 0.15s;
  }
  .login-card input:focus { outline: none; border-color: var(--accent); background: var(--panel); }
  .login-card .btn { width: 100%; margin-top: 8px; }
  .error-msg {
    color: var(--danger);
    background: var(--danger-bg);
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 12px;
    margin-bottom: 12px;
  }
</style>
