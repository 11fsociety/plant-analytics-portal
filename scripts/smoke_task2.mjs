#!/usr/bin/env node
// Task 2 smoke — verifies /api/predict returns per-metric forecast + anomalies + diagnostics.
//
// Modes:
//   node scripts/smoke_task2.mjs --predict     → basic shape check
//   node scripts/smoke_task2.mjs --diagnostics → diagnostics-per-metric present

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

async function main() {
  const cookie = await login();
  const res = await fetch(`${BASE}/api/predict?horizon=7`, { headers: { cookie } });
  if (!res.ok) throw new Error(`predict failed: ${res.status} ${await res.text()}`);
  const j = await res.json();

  for (const k of ['production', 'scrap', 'downtime']) {
    const m = j.metrics?.[k];
    if (!m) throw new Error(`missing metric ${k}`);
    if (!Array.isArray(m.series)) throw new Error(`${k}: series not array`);
    if (!Array.isArray(m.forecast)) throw new Error(`${k}: forecast not array`);
    if (!Array.isArray(m.anomalies)) throw new Error(`${k}: anomalies not array`);
    if (!m.diagnostics) throw new Error(`${k}: no diagnostics`);
    console.log(`[smoke] ${k}: n=${m.diagnostics.n_points} tier=${m.diagnostics.tier} anom=${m.diagnostics.n_anomalies} rmse=${m.diagnostics.rmse ?? '?'}`);
  }

  if (args.has('--diagnostics')) {
    const dp = j.metrics.production.diagnostics;
    if (!dp.method) throw new Error('diagnostics.method missing');
    if (dp.n_points == null) throw new Error('diagnostics.n_points missing');
    console.log(`[smoke] diagnostics ok: method="${dp.method}" params=${JSON.stringify(dp.params ?? {})}`);
    console.log('DIAG OK');
    return;
  }

  console.log('PREDICT OK');
}

main().catch((e) => {
  console.error('[smoke] FAIL:', e.message);
  process.exit(1);
});
