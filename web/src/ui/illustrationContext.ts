import { CULTURES } from '../gen/urban/culture';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import type { View } from '../render/view';
import type { Terrain3dCamera } from './terrain3d';

/** Retained decor queries contain climate/relief even when their free-form tags do not. */
export function illustrationTerrainFromDecor(meta: { query: string; tags: Record<string, string>; stats: { minHeight: number; maxHeight: number } }) {
  const query = new URLSearchParams(meta.query);
  return { ...meta.tags, relief: query.get('relief') ?? meta.tags.relief, climate: query.get('climate') ?? meta.tags.climate,
    biome: query.get('biome') ?? meta.tags.biome, environment: query.get('environment') ?? meta.tags.environment,
    minHeight: meta.stats.minHeight, maxHeight: meta.stats.maxHeight };
}

/** Compact factual descriptors, never complete world rasters or native building payloads. */
export function illustrationContext(options: {
  sourceStyle: string; seed: string; view?: View; width?: number; height?: number;
  camera?: Terrain3dCamera;
  terrain?: { relief?: string; climate?: string; biome?: string; environment?: string; temperature?: number; precipitation?: number; minHeight?: number; maxHeight?: number };
  settlements?: readonly { name?: string; culture?: string; population: number; center: { x: number; y: number }; radius: number; archetype?: string }[];
  buildings?: Building3dScene; architecture?: unknown;
  generation?: { culture?: string; era?: string; population?: number; size?: string; workflow?: string; coast?: unknown; river?: unknown; biome?: string; recipe?: string };
}): Record<string, unknown> {
  const { view, camera, width = 1, height = 1 } = options;
  // Perspective framing follows the captured camera, independently of the last
  // 2D pan/zoom. Centres are projected on the target plane for coarse culling.
  const screen = (point: { x: number; y: number }, radius = 0) => {
    if (camera) {
      const { yaw, pitch, distance } = camera, above = camera.heightAboveTargetMetres ?? Math.sin(pitch) * distance;
      const horizontal = Math.cos(pitch) * distance, length = Math.hypot(horizontal, above), sin = above / length, cos = horizontal / length;
      const dx = point.x - camera.x, dy = point.y - camera.y;
      const along = dx * Math.sin(yaw) + dy * Math.cos(yaw), depth = length - along * cos;
      if (depth <= 0) return { x: Infinity, y: Infinity, radius: 0 };
      const span = 2 * depth * Math.tan((camera.verticalFovDegrees ?? 180 / 3.7) * Math.PI / 360);
      return { x: .5 + (dx * Math.cos(yaw) - dy * Math.sin(yaw)) / (span * width / height), y: .5 + along * sin / span,
        radius: radius / (span * Math.min(1, width / height)) };
    }
    return view ? { x: (point.x - view.cx) * view.scale / width + .5, y: (point.y - view.cy) * view.scale / height + .5,
      radius: radius * view.scale / Math.min(width, height) } : { x: .5, y: .5, radius: 1 };
  };
  const inFrame = (point: { x: number; y: number }, radius: number) => { const p = screen(point, radius); return p.x >= -p.radius && p.x <= 1 + p.radius && p.y >= -p.radius && p.y <= 1 + p.radius; };
  const visible = options.settlements?.filter(s => inFrame(s.center, s.radius)).slice(0, 30) ?? [];
  const cultures = new Set<string>(), roofs = new Set<string>(), materialIds = new Set<string>(), storeys = new Set<number>();
  const useMaterials = (slots: unknown): void => {
    if (slots && typeof slots === 'object') for (const value of Object.values(slots)) if (typeof value === 'string') materialIds.add(value);
  };
  let described = 0;
  for (const building of options.buildings?.buildings ?? []) {
    const point = building.footprint[0]?.outer[0];
    if (point && !inFrame(point, 80)) continue;
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
  return { application: 'magna-urbis', capturedAt: new Date().toISOString(), revision: 3, sourceId: options.seed,
    sourceStyle: options.sourceStyle, projection: camera ? 'perspective' : 'orthographic', camera: camera ? { ...camera } : view && { ...view },
    extentMetres: !camera && view ? { width: width / view.scale, height: height / view.scale } : undefined,
    environment: options.terrain,
    generation: options.generation && { ...options.generation, cultureDescription: options.generation.culture && CULTURES[options.generation.culture]?.label },
    settlements: visible.map(s => ({ name: s.name, population: s.population, urbanCulture: s.culture,
      cultureDescription: s.culture && CULTURES[s.culture]?.label, archetype: s.archetype,
      screen: camera || view ? { x: screen(s.center).x, y: screen(s.center).y } : undefined })),
    architecture: { settings: options.architecture, traditions: [...cultures], roofSystems: [...roofs], materials, storeys: [...storeys] },
  };
}
