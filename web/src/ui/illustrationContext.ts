import { CULTURES } from '../gen/urban/culture';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import type { View } from '../render/view';
import type { Terrain3dCamera } from './terrain3d';
import { groundFrame } from '../../../illustration/web/framing.mjs';
import type { TerrainLayer } from '../gen/types';

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
  terrain?: { relief?: string; climate?: string; biome?: string; environment?: string; temperature?: number; precipitation?: number; minHeight?: number; maxHeight?: number; ambience?: string };
  settlements?: readonly { name?: string; culture?: string; population: number; center: { x: number; y: number }; radius: number; archetype?: string }[];
  buildings?: Building3dScene; architecture?: unknown;
  terrainLayer?: TerrainLayer;
  generation?: { culture?: string; era?: string; population?: number; size?: string; workflow?: string; coast?: unknown; river?: unknown; biome?: string; recipe?: string };
}): Record<string, unknown> {
  const { view, camera, width = 1, height = 1 } = options;
  const framing = { projection: camera ? 'perspective' : 'orthographic', camera, viewport: { width, height },
    extentMetres: !camera && view && view.scale > 0 ? { width: width / view.scale, height: height / view.scale } : undefined };
  const frame = groundFrame(framing);
  // Perspective framing follows the captured camera, independently of the last
  // 2D pan/zoom. Centres are projected on the target plane for coarse culling.
  const screen = (point: { x: number; y: number }, radius = 0) => {
    if (camera) {
      const { yaw, pitch, distance } = camera, above = camera.heightAboveTargetMetres ?? Math.sin(pitch) * distance;
      const walking = camera.navigation === 'walk';
      const horizontal = Math.cos(pitch) * distance, length = Math.hypot(horizontal, above);
      const sin = walking ? Math.sin(pitch) : above / length, cos = walking ? Math.cos(pitch) : horizontal / length;
      const dx = point.x - camera.x, dy = point.y - camera.y;
      const along = dx * Math.sin(yaw) + dy * Math.cos(yaw), depth = (walking ? above * sin : length) - along * cos;
      if (depth <= 0) return { x: Infinity, y: Infinity, radius: 0 };
      const span = 2 * depth * Math.tan((camera.verticalFovDegrees ?? 180 / 3.7) * Math.PI / 360);
      return { x: .5 + (dx * Math.cos(yaw) - dy * Math.sin(yaw)) / (span * width / height), y: .5 + (along * sin + (walking ? above * cos : 0)) / span,
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
  const buildingWidths: number[] = [];
  for (const building of options.buildings?.buildings ?? []) {
    const points = building.footprint.flatMap(part => part.outer);
    if (!points.length) continue;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (!inFrame({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, Math.hypot(maxX - minX, maxY - minY) / 2)) continue;
    buildingWidths.push(Math.max(maxX - minX, maxY - minY));
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
  // Sample only visible terrain cells. Never send full rasters to the connector.
  const layer = options.terrainLayer, water: Record<string, number> = {}, elevations: number[] = [];
  if (layer?.height) {
    const grid = layer.height, indices = new Set<number>();
    if (frame) for (let row = 0; row < 25; row++) for (let col = 0; col < 25; col++) {
      let x: number, y: number;
      if (camera && frame.perspective) {
        const v = ((row + .5) / 25 - .5) * 2 * frame.tan!;
        const along = v * frame.distance! / (frame.sin! + v * frame.cos!);
        const across = ((col + .5) / 25 - .5) * 2 * frame.tan! * frame.aspect! * (frame.distance! - along * frame.cos!);
        x = camera.x + across * Math.cos(camera.yaw) + along * Math.sin(camera.yaw);
        y = camera.y - across * Math.sin(camera.yaw) + along * Math.cos(camera.yaw);
      } else if (view) {
        x = view.cx + ((col + .5) / 25 - .5) * frame.width;
        y = view.cy + ((row + .5) / 25 - .5) * frame.height;
      } else continue;
      const gx = Math.floor(x / grid.cell), gy = Math.floor(y / grid.cell);
      if (gx >= 0 && gx < grid.w && gy >= 0 && gy < grid.h) indices.add(gy * grid.w + gx);
    }
    for (const index of indices) {
      const elevation = grid.data[index];
      if (Number.isFinite(elevation)) elevations.push(elevation);
      const kind = ['land', 'sea', 'lake', 'river'][layer.water[index]];
      if (kind) water[kind] = (water[kind] ?? 0) + 1;
    }
  }
  buildingWidths.sort((a, b) => a - b);
  return { application: 'magna-urbis', capturedAt: new Date().toISOString(), revision: 4, sourceId: options.seed,
    sourceStyle: options.sourceStyle, projection: camera ? 'perspective' : 'orthographic', camera: camera ? { ...camera } : view && { ...view },
    viewport: { width, height }, extentMetres: frame && { width: frame.width, height: frame.height, approximate: !!camera },
    visibleScene: { measured: true, sampledBuildings: described, sampledTerrainCells: elevations.length, water,
      elevationMetres: elevations.length ? { min: Math.min(...elevations), max: Math.max(...elevations) } : undefined,
      medianBuildingSpanMetres: buildingWidths.length ? buildingWidths[Math.floor(buildingWidths.length / 2)] : undefined },
    environment: options.terrain,
    generation: options.generation && { ...options.generation, cultureDescription: options.generation.culture && CULTURES[options.generation.culture]?.label },
    settlements: visible.map(s => ({ name: s.name, population: s.population, urbanCulture: s.culture,
      cultureDescription: s.culture && CULTURES[s.culture]?.label, archetype: s.archetype, radiusMetres: s.radius,
      screen: camera || view ? { x: screen(s.center).x, y: screen(s.center).y } : undefined })),
    architecture: { settings: options.architecture, traditions: [...cultures], roofSystems: [...roofs], materials, storeys: [...storeys] },
  };
}
