#!/usr/bin/env node
// Task 3.5 smoke — verifies /api/machine/[code] returns machineDetail + insights + narrative.
//
//   node scripts/smoke_task35.mjs           → hit /api/machine/CM01?plant=navratan
//   node scripts/smoke_task35.mjs --machine → same, structured assertions
//   node scripts/smoke_task35.mjs --empty   → hit /api/machine/CM01?plant=uniworth (empty)

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:5173';
const EMAIL = 'apdash13@gmail.com';
const PASSWORD = 'apdash13';
const args = new Set(process.argv.slice(2));

function collectCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function login() {
  const res = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return collectCookies(res);
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const cookie = await login();
  console.log('[smoke] login ok');

  const nav = await get('/api/machine/CM01?plant=navratan', cookie);
  console.log(`[smoke] machine/CM01?plant=navratan → ${nav.status} name=${nav.body?.name ?? '?'} rolls=${nav.body?.summary?.rolls ?? '?'}`);
  if (nav.status !== 200) throw new Error('CM01 navratan should be 200');
  if (!nav.body?.summary) console.warn('[smoke] WARN: no summary for CM01 (data missing?)');
  if (!nav.body?.production_insights) throw new Error('missing production_insights');
  if (!nav.body?.scrap_insights) throw new Error('missing scrap_insights');
  if (!nav.body?.downtime_insights) throw new Error('missing downtime_insights');
  if (!nav.body?.narrative) throw new Error('missing narrative');
  console.log('MACHINE OK');

  if (args.has('--empty')) {
    const empty = await get('/api/machine/CM01?plant=uniworth', cookie);
    console.log(`[smoke] machine/CM01?plant=uniworth → ${empty.status} summary=${empty.body?.summary ? 'has-data' : 'empty'}`);
    if (empty.status !== 200) throw new Error('uniworth machine should be 200 (empty state)');
    console.log('EMPTY OK');
  }
}

main().catch((e) => { console.error('[smoke] FAIL:', e.message); process.exit(1); });
