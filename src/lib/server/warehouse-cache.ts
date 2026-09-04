import { loadWarehouse, type Plant, type Warehouse } from './warehouse';

type Entry = { data: Warehouse; ts: number };
const cache = new Map<Plant, Entry>();
const inflight = new Map<Plant, Promise<Warehouse>>();
const TTL_MS = 600_000;

export async function loadCached(plant: Plant): Promise<Warehouse> {
  const hit = cache.get(plant);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  // Coalesce concurrent misses so parallel /api/data + /api/predict on cold
  // instance hit Blob once, not twice.
  const pending = inflight.get(plant);
  if (pending) return pending;

  const p = loadWarehouse(plant).then((data) => {
    cache.set(plant, { data, ts: Date.now() });
    inflight.delete(plant);
    return data;
  }).catch((e) => {
    inflight.delete(plant);
    throw e;
  });
  inflight.set(plant, p);
  return p;
}

export function invalidate(plant: Plant): void {
  cache.delete(plant);
}
