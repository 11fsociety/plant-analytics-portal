#!/usr/bin/env node
/**
 * Verify the 5 mirrored TypeScript modules in this repo have not drifted from
 * their sources in ../plant-analytics/lib/. Ignores documented header banners
 * added on this side (marked "MIRROR of ...").
 *
 * Exits 0 if in-sync, 1 with a unified diff if drift detected. Wire into
 * pre-commit or CI to catch row_hash-formula drift before it silently breaks
 * cross-portal dedup.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAIN = resolve(ROOT, '..', 'plant-analytics', 'lib');

// Files that MUST stay byte-equivalent (modulo comments). Drift → fail.
const STRICT_MIRRORS = ['auth.ts', 'predictive.ts'];
// Files with a documented, expected divergence. Drift → warn only.
const KNOWN_DIVERGENCES = {
  'analytics.ts': 'MACHINE_MAPS keyed by plant + machines(w, shift, range, plant) accepts plant arg + total_length_m in plantSummary (portal multi-plant refactor)',
  'warehouse.ts': 'saveWarehouse multipart:true + multi-plant refactor (Plant type, loadWarehouse/saveWarehouse take plant arg, blob key per plant, MachineEntry + extendMachineMap for auto-populated machine map)',
  'ingest.ts': 'relaxed LAM sniffer (accepts files missing Quantity like FLOORING LAM JUNE) + dynamic downtime SUBHEADER_ROW detection (handles April 2026 shift-by-1 layout). Fixes silent 0-row ingests.',
};
const MIRRORS = [
  ...STRICT_MIRRORS.map((name) => ({ name, strict: true })),
  ...Object.keys(KNOWN_DIVERGENCES).map((name) => ({ name, strict: false })),
];

function stripCommentLines(text) {
  // Very coarse: drop pure-comment lines so mirror banners/reformatting don't false-alarm.
  return text
    .split(/\r?\n/)
    .filter((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith('//')) return false;
      if (trimmed.startsWith('*') && !trimmed.startsWith('*/')) return false;
      if (trimmed.startsWith('/*') || trimmed === '*/' || trimmed.startsWith('/**')) return false;
      return true;
    })
    .join('\n');
}

function diffSummary(a, b, name) {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const changed = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) changed.push({ line: i + 1, main: aLines[i] ?? '(missing)', portal: bLines[i] ?? '(missing)' });
    if (changed.length >= 6) break;
  }
  return changed.map((c) => `  L${c.line}\n    main:   ${c.main}\n    portal: ${c.portal}`).join('\n');
}

let failures = 0;
let warnings = 0;
console.log(`[verify-mirror] comparing against ${MAIN}`);
for (const { name, strict } of MIRRORS) {
  const mainPath = resolve(MAIN, name);
  const portalPath = resolve(ROOT, 'src', 'lib', 'server', name);
  if (!existsSync(mainPath)) {
    console.error(`  MISSING SOURCE: ${mainPath}`);
    failures++;
    continue;
  }
  if (!existsSync(portalPath)) {
    console.error(`  MISSING MIRROR: ${portalPath}`);
    failures++;
    continue;
  }
  const a = stripCommentLines(readFileSync(mainPath, 'utf-8')).trim();
  const b = stripCommentLines(readFileSync(portalPath, 'utf-8')).trim();
  if (a === b) {
    console.log(`  OK    ${name}`);
    continue;
  }
  if (strict) {
    console.error(`  DRIFT ${name}`);
    console.error(diffSummary(a, b, name));
    failures++;
  } else {
    console.log(`  WARN  ${name} — documented divergence: ${KNOWN_DIVERGENCES[name]}`);
    warnings++;
  }
}

if (failures > 0) {
  console.error(`\n[verify-mirror] FAIL — ${failures} strict mirror(s) drifted.`);
  console.error(`If the divergence is intentional, move the file to KNOWN_DIVERGENCES and document why.`);
  console.error(`Otherwise re-sync BOTH copies so row_hash interop stays intact.`);
  process.exit(1);
}
console.log(`\n[verify-mirror] OK — ${STRICT_MIRRORS.length} strict mirror(s) in sync${warnings ? `; ${warnings} documented divergence(s)` : ''}.`);
