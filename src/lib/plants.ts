/**
 * plants.ts - browser-safe plant metadata.
 * Shared source of truth for plant list, types, and display metadata.
 * Both server (warehouse.ts) and client (Nav.svelte) import from here.
 */

export type PlantSlug = 'navratan' | 'uniworth';

export const PLANTS: readonly PlantSlug[] = ['navratan', 'uniworth'] as const;

export const PLANT_META: Record<PlantSlug, { name: string; color: string }> = {
  navratan: { name: 'Navratan', color: '#21b573' },
  uniworth: { name: 'Uniworth', color: '#3d7de6' },
};
