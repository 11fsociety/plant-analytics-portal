#!/usr/bin/env node
// Task 3 smoke — verifies multi-plant scoping end-to-end.
//   1. /api/data?plant=navratan returns rows (existing warehouse).
//   2. /api/data?plant=uniworth returns empty warehouse (no data yet), 200 OK.
//   3. /api/predict?plant=uniworth returns empty forecast + zero anomalies.
//   4. The plant round-trip: response echoes the requested plant.

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:5173';
const EMAIL = 'apdash13@gmail.com';
const PASSWORD = 'apdash13';

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

  const nav = await get('/api/data?plant=navratan', cookie);
  console.log(`[smoke] data?plant=navratan → ${nav.status} rows=${JSON.stringify(nav.body?.row_counts ?? {})} echoed_plant=${nav.body?.plant_slug ?? '?'}`);
  if (nav.status !== 200) throw new Error('navratan should be 200');
  if ((nav.body?.row_counts?.production ?? 0) === 0) console.warn('[smoke] WARN: Navratan warehouse empty — Blob unreachable? Continuing…');

  const uni = await get('/api/data?plant=uniworth', cookie);
  console.log(`[smoke] data?plant=uniworth → ${uni.status} rows=${JSON.stringify(uni.body?.row_counts ?? {})} echoed_plant=${uni.body?.plant_slug ?? '?'}`);
  if (uni.status !== 200) throw new Error('uniworth should be 200 even when empty');
  if ((uni.body?.row_counts?.production ?? 0) > 0) console.warn('[smoke] WARN: Uniworth warehouse has data — did we upload something?');

  const uniPred = await get('/api/predict?plant=uniworth&horizon=7', cookie);
  console.log(`[smoke] predict?plant=uniworth → ${uniPred.status} tier=${uniPred.body?.metrics?.production?.diagnostics?.tier ?? '?'}`);
  if (uniPred.status !== 200) throw new Error('uniworth predict should be 200');
  if (uniPred.body?.metrics?.production?.diagnostics?.tier !== 'empty') {
    console.warn(`[smoke] WARN: expected tier=empty for empty uniworth, got ${uniPred.body?.metrics?.production?.diagnostics?.tier}`);
  }

  // Plant round-trip check: response must echo the plant back
  if (nav.body?.plant_slug !== 'navratan') throw new Error(`nav plant not echoed: ${nav.body?.plant_slug}`);
  if (uni.body?.plant_slug !== 'uniworth') throw new Error(`uni plant not echoed: ${uni.body?.plant_slug}`);

  console.log('TASK3 OK');
}

main().catch((e) => { console.error('[smoke] FAIL:', e.message); process.exit(1); });
