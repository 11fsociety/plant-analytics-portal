#!/usr/bin/env node
// Task 1 smoke test — dev server on http://localhost:5173.
//
// Modes:
//   node scripts/smoke_task1.mjs         → G3+G4: unauth 401, login, /api/data 200
//   node scripts/smoke_task1.mjs --token → G5:   authed POST /api/upload returns a client token
//   node scripts/smoke_task1.mjs --pwa   → G8:   /manifest.webmanifest valid JSON with icons

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:5173';
const EMAIL = 'apdash13@gmail.com';
const PASSWORD = 'apdash13';

const args = new Set(process.argv.slice(2));

function collectCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function unauth() {
  const res = await fetch(`${BASE}/api/data`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  console.log('[smoke] unauth /api/data → 401 (correct)');
}

async function login() {
  const res = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = collectCookies(res);
  if (!cookie.startsWith('session=')) throw new Error('no session cookie');
  return cookie;
}

async function fetchData(cookie) {
  const res = await fetch(`${BASE}/api/data`, { headers: { cookie } });
  if (!res.ok) throw new Error(`data failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function tokenRequest(cookie) {
  const body = {
    type: 'blob.generate-client-token',
    payload: {
      pathname: 'raw/2026-09/_smoke.xlsx',
      callbackUrl: `${BASE}/api/upload`,
      clientPayload: null,
      multipart: false,
    },
  };
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${JSON.stringify(j)}`);
  if (!j.clientToken) throw new Error(`no clientToken in response: ${JSON.stringify(j)}`);
  return j;
}

async function manifest() {
  const res = await fetch(`${BASE}/manifest.webmanifest`);
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const m = await res.json();
  if (!m.name || !Array.isArray(m.icons) || m.icons.length === 0) {
    throw new Error(`manifest invalid: ${JSON.stringify(m)}`);
  }
  return m;
}

async function main() {
  console.log(`[smoke] base=${BASE}`);

  if (args.has('--pwa')) {
    const m = await manifest();
    console.log(`[smoke] manifest ok: name="${m.name}" icons=${m.icons.length}`);
    console.log('MANIFEST OK');
    return;
  }

  await unauth();
  const cookie = await login();
  console.log('[smoke] login ok');
  const d = await fetchData(cookie);
  console.log(`[smoke] /api/data rows=${JSON.stringify(d.row_counts)} updated_at=${d.updated_at}`);

  if (args.has('--token')) {
    const t = await tokenRequest(cookie);
    console.log(`[smoke] /api/upload token ok — type=${t.type} pathname includes: ${JSON.stringify(t).includes('raw/2026-09')}`);
    console.log('TOKEN OK');
    return;
  }

  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('[smoke] FAIL:', e.message);
  process.exit(1);
});
