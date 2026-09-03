/**
 * SvelteKit loads .env into $env/dynamic/private but not into process.env.
 * The ported lib/* modules (auth.ts, warehouse.ts, ingest.ts, ...) all read
 * process.env directly. Mirror the private env into process.env at startup so
 * those modules work without modification.
 */
import { env } from '$env/dynamic/private';

for (const [k, v] of Object.entries(env)) {
  if (v !== undefined && process.env[k] === undefined) {
    process.env[k] = v;
  }
}
