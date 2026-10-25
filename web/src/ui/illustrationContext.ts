import { CULTURES } from '../gen/urban/culture';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import type { View } from '../render/view';

/** Compact factual descriptors, never complete world rasters or native building payloads. */
export function illustrationContext(options: {
  sourceStyle: string; seed: string; view?: View; width?: number; height?: number;
  terrain?: { relief?: string; climate?: string; biome?: string; environment?: string; temperature?: number; precipitation?: number; minHeight?: number; maxHeight?: number };
  settlements?: readonly { name?: string; culture?: string; population: number; center: { x: number; y: number }; radius: number; archetype?: string }[];
  buildings?: Building3dScene; architecture?: unknown;
  generation?: { culture?: string; population?: number; size?: string; workflow?: string; coast?: unknown; river?: unknown; biome?: string; recipe?: string };
}): Record<string, unknown> {
  const { view, width = 1, height = 1 } = options;
  const visible = options.settlements?.filter(s => !view || (Math.abs(s.center.x - view.cx) <= width / view.scale / 2 + s.radius && Math.abs(s.center.y - view.cy) <= height / view.scale / 2 + s.radius)).slice(0, 30) ?? [];
  const cultures = new Set<string>(), roofs = new Set<string>(), materialIds = new Set<string>(), storeys = new Set<number>();
  const useMaterials = (slots: unknown): void => {
    if (slots && typeof slots === 'object') for (const value of Object.values(slots)) if (typeof value === 'string') materialIds.add(value);
  };
  let described = 0;
  for (const building of options.buildings?.buildings ?? []) {
    const point = building.footprint[0]?.outer[0];
    if (view && point && (Math.abs(point.x - view.cx) > width / view.scale / 2 + 80 || Math.abs(point.y - view.cy) > height / view.scale / 2 + 80)) continue;
    if (building.culture?.culture) cultures.add(building.culture.culture);
    if ('materials' in building) useMaterials(building.materials);
    if ('volumes' in building) for (const volume of building.volumes ?? []) {
      if (volume.roof_system) roofs.add(volume.roof_system);
      useMaterials(volume.materials);
      if (volume.levels?.length) storeys.add(volume.levels.length);
      for (const level of volume.levels ?? []) useMaterials(level.materials);
    }
    if (++described >= 300) break;
  }
  const materials = options.buildings?.materials?.filter(material => materialIds.has(material.id)).slice(0, 24);
  return { application: 'magna-urbis', capturedAt: new Date().toISOString(), revision: 2, sourceId: options.seed,
    sourceStyle: options.sourceStyle, projection: 'orthographic', camera: view && { ...view },
    extentMetres: view ? { width: width / view.scale, height: height / view.scale } : undefined,
    environment: options.terrain,
    generation: options.generation && { ...options.generation, cultureDescription: options.generation.culture && CULTURES[options.generation.culture]?.label },
    settlements: visible.map(s => ({ name: s.name, population: s.population, urbanCulture: s.culture,
      cultureDescription: s.culture && CULTURES[s.culture]?.label, archetype: s.archetype,
      screen: view ? { x: (s.center.x - view.cx) * view.scale / width + .5, y: (s.center.y - view.cy) * view.scale / height + .5 } : undefined })),
    architecture: { settings: options.architecture, traditions: [...cultures], roofSystems: [...roofs], materials, storeys: [...storeys] },
  };
}
