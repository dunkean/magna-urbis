import { underdarkFarmBeds } from '../../../rust/bridge/terrainRenderUnderdark';

/** Display-only inhabited period: underground, day means lamps on; the cave never gets sunlight. */
export const underdarkLightsOn = (ambience: 'day' | 'night' = 'day'): boolean => ambience === 'day';

/** Surface lamps follow night; underground lamps follow the inhabited period. */
export const settlementLightsOn = (ambience: 'day' | 'night' = 'day', underdark = false): boolean => (underdark ? underdarkLightsOn(ambience) : ambience === 'night');

/** Keep physical town sites and farm beds stable when only the lamp uniforms change. */
export function underdarkLightingLook<T extends { underdark?: boolean; townGlow?: Float32Array; townSites?: Float32Array }>(source: T, ambience: 'day' | 'night' = 'day'): T & { townSites?: Float32Array } {
  return source.underdark ? { ...source, townSites: source.townSites ?? source.townGlow, townGlow: underdarkLightsOn(ambience) ? (source.townSites ?? source.townGlow) : undefined } : source;
}

/** The same physical lamp/farm inputs feed 2D, 3D and retained City Bench scenes. */
export function underdarkSceneLook(biome: string | undefined, ambience: 'day' | 'night', towns: readonly { center: { x: number; y: number }; radius?: number }[] = [], farms?: Parameters<typeof underdarkFarmBeds>[0]) {
  const underdark = biome === 'underdark';
  return underdarkLightingLook({ underdark, townGlow: underdark ? Float32Array.from(towns.slice(0, 16).flatMap(s => [s.center.x, s.center.y, Math.max(120, (s.radius ?? 200) * 1.6)])) : undefined, farmBeds: underdark ? underdarkFarmBeds(farms, towns) : undefined }, ambience);
}
