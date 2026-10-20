/** Semantic operation masks, cell-centred over the map. No height samples. */
export const TERRAIN_ZONE_KINDS = ['sea', 'flat', 'hills', 'mountains', 'high-mountains'] as const;
export type TerrainZoneKind = typeof TERRAIN_ZONE_KINDS[number];
export interface TerrainZones { version: 1; resolution: number; weights: number[] }
export function parseTerrainZones(value: unknown): TerrainZones {
  const z = value as TerrainZones;
  if (!z || z.version !== 1 || !Number.isInteger(z.resolution) || z.resolution < 8 || z.resolution > 128
    || !Array.isArray(z.weights) || z.weights.length !== z.resolution ** 2 * 5) throw new Error('Zones invalides : cinq masques carrés 8–128² attendus.');
  for (let i = 0; i < z.weights.length; i += 5) {
    let total = 0;
    for (let k = 0; k < 5; k++) {
      const w = z.weights[i + k];
      if (!Number.isInteger(w) || w < 0 || w > 255) throw new Error('Poids de zone invalide.');
      total += w;
    }
    if (total > 255) throw new Error('Poids cumulés des zones supérieurs à 255.');
  }
  return { version: 1, resolution: z.resolution, weights: [...z.weights] };
}
