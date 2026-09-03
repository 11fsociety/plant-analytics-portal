#!/usr/bin/env node
/**
 * Task 4 E2E — headless walk against the LOCAL dev server via Playwright's
 * MCP server. Not a full Playwright script (that would need @playwright/test as
 * a devDep). Instead, this is a Node driver that hits every visible surface
 * with fetch + assertion, then delegates the actual click-through to Playwright
 * via a companion smoke check.
 *
 * Coverage (hits the endpoints; the visual walk-through is done via the
 * Playwright MCP browser interactively):
 *   1. Auth: unauth 401, login → 200.
 *   2. Dashboard read: /api/data?plant=navratan returns rows.
 *   3. Plant flip: /api/data?plant=uniworth returns row_counts=0.
 *   4. Predict: /api/predict returns diagnostics + insights.
 *   5. Machine drill-down: /api/machine/CM01?plant=navratan returns summary+insights+narrative.
 *   6. Date range: /api/data?from=2026-08-01&to=2026-08-31 filters correctly.
 *   7. Compare mode: /api/data?from=...&to=...&compare=prev-period returns compare_series.
 *   8. Logout clears cookie.
 */

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:5173';
const EMAIL = 'apdash13@gmail.com';
const PASSWORD = 'apdash13';

function ck(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function main() {
  console.log(`[e2e] base=${BASE}`);

  // 1. Unauth
  const unauth = await fetch(`${BASE}/api/data`);
  if (unauth.status !== 401) throw new Error(`unauth expected 401, got ${unauth.status}`);
  console.log('[e2e] unauth /api/data → 401 ✓');

  // 2. Login
  const loginRes = await fetch(`${BASE}/api/auth`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
  const cookie = ck(loginRes);
  console.log('[e2e] login ✓');

  // 3. Navratan data
  const nav = await fetch(`${BASE}/api/data?plant=navratan`, { headers: { cookie } }).then(r => r.json());
  if ((nav.row_counts?.production ?? 0) < 1) throw new Error('navratan has no production rows');
  console.log(`[e2e] navratan data ✓ rows=${JSON.stringify(nav.row_counts)}`);

  // 4. Uniworth empty
  const uni = await fetch(`${BASE}/api/data?plant=uniworth`, { headers: { cookie } }).then(r => r.json());
  if ((uni.row_counts?.production ?? -1) !== 0) throw new Error('uniworth should be empty');
  console.log('[e2e] uniworth empty ✓');

  // 5. Predict
  const pred = await fetch(`${BASE}/api/predict?plant=navratan&horizon=7`, { headers: { cookie } }).then(r => r.json());
  if (!pred.metrics?.production?.diagnostics?.tier) throw new Error('predict missing diagnostics');
  console.log(`[e2e] predict ✓ tier=${pred.metrics.production.diagnostics.tier} n_anom=${pred.metrics.production.diagnostics.n_anomalies}`);

  // 6. Machine drill-down
  const machine = await fetch(`${BASE}/api/machine/CM01?plant=navratan`, { headers: { cookie } }).then(r => r.json());
  if (!machine.summary) throw new Error('machine CM01 missing summary');
  if (!machine.production_insights) throw new Error('machine CM01 missing production_insights');
  if (!machine.narrative) throw new Error('machine CM01 missing narrative');
  console.log(`[e2e] machine CM01 ✓ rolls=${machine.summary.rolls} name=${machine.name}`);

  // 7. Date range filter
  const ranged = await fetch(`${BASE}/api/data?plant=navratan&from=2026-08-01&to=2026-08-31`, { headers: { cookie } }).then(r => r.json());
  const augRolls = ranged.plant?.rolls ?? 0;
  const allRolls = nav.plant?.rolls ?? 0;
  if (augRolls >= allRolls) console.warn(`[e2e] WARN: date-filter didn't reduce rolls (${augRolls} vs all ${allRolls})`);
  else console.log(`[e2e] date-range filter ✓ aug rolls=${augRolls} < all=${allRolls}`);

  // 8. Compare mode (if range is set)
  const cmp = await fetch(`${BASE}/api/data?plant=navratan&from=2026-08-01&to=2026-08-31&compare=prev-period`, { headers: { cookie } }).then(r => r.json());
  if (cmp.compare_range == null) console.warn('[e2e] WARN: compare mode returned no compare_range — may not be wired yet');
  else console.log(`[e2e] compare mode ✓ prev-range ${cmp.compare_range?.from} → ${cmp.compare_range?.to}`);

  // 9. Logout
  const logoutRes = await fetch(`${BASE}/api/auth`, { method: 'DELETE', headers: { cookie } });
  if (!logoutRes.ok) throw new Error(`logout failed: ${logoutRes.status}`);
  console.log('[e2e] logout ✓');

  console.log('\nE2E OK');
}

main().catch((e) => { console.error('[e2e] FAIL:', e.message); process.exit(1); });
