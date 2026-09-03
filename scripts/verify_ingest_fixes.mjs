#!/usr/bin/env node
// Verify the two problem files now parse correctly with the fixed ingest logic.
// Uses tsx to import the real ingest module.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Run via tsx from a wrapper that imports ingest.ts.
const runner = `
import { readFileSync } from 'node:fs';
import { ingestBuffer } from './src/lib/server/ingest';

const FILES = [
  'F:/Downloads/Dash board/Dash board/FLOORING LAM JUNE.XLSX',
  'F:/Downloads/Dash board/Dash board/Machine wise-shift wise stoppage hrs for April = 26.xls',
];

for (const path of FILES) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const r = await ingestBuffer(ab, path.split(/[/\\\\]/).pop());
  const counts = {
    kind: r.kind,
    production: r.production?.length ?? 0,
    downtime: r.downtime?.length ?? 0,
    scrap: r.scrap?.length ?? 0,
    error: r.error ?? null,
  };
  console.log(path.split(/[/\\\\]/).pop(), JSON.stringify(counts));
}
`;
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/_ingest_probe.ts', runner);
const res = spawnSync('npx', ['tsx', '/tmp/_ingest_probe.ts'], {
  cwd: 'd:/codezzz/Claude/plant-analytics-portal',
  stdio: 'inherit',
  shell: true,
});
process.exit(res.status ?? 1);
