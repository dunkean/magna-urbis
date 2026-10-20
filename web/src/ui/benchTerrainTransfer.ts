import { intersection } from '../gen/geo/bool';
import type { VectorGeography } from '../../../rust/bridge/urbanGeography';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { rasterStats, type Decor } from './decor';
import { cropWaterSvg } from './decorWater';

/** Crop on cell boundaries: FP32 elevations and every hydrological cell remain bit-identical. */
export function cropTerrain(decor: Decor, x: number, y: number, width: number): Decor {
  const r = decor.raster, cell = r.width / r.n;
  if (![x, y, width].every(Number.isFinite) || width <= 0 || x < 0 || y < 0 || x + width > r.width + .001 || y + width > r.width + .001) throw new Error('La sélection carrée doit rester dans le terrain.');
  const n = Math.max(2, Math.min(r.n, Math.round(width / cell)));
  const ix = Math.max(0, Math.min(r.n - n, Math.round(x / cell))), iy = Math.max(0, Math.min(r.n - n, Math.round(y / cell)));
  x = ix * cell; y = iy * cell; width = n * cell;
  const crop = <T extends Float32Array | Int32Array | Uint8Array>(source: T): T => {
    const out = source.slice(0, n * n);
    for (let row = 0; row < n; row++) out.set(source.subarray((iy + row) * r.n + ix, (iy + row) * r.n + ix + n), row * n);
    return out as T;
  };
  const box = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + width }, { x, y: y + width }];
  const clip = (rings: { x: number; y: number }[][]): { x: number; y: number }[][][] => {
    if (!rings.length) return [];
    return intersection({ outer: rings[0], holes: rings.slice(1) }, box).map(poly => [poly.outer, ...poly.holes].map(ring => ring.map(p => ({ x: p.x - x, y: p.y - y }))));
  };
  const geometry: VectorGeography | undefined = r.geometry ? { land: r.geometry.land.flatMap(ring => clip([ring]).flat()), water: r.geometry.water.flatMap(clip) } : undefined;
  const raster = { width, n, height: crop(r.height), water: crop(r.water), waterLevel: crop(r.waterLevel), riverWidth: crop(r.riverWidth), riverIds: crop(r.riverIds), geometry };
  return { raster, meta: { ...decor.meta, width, label: `${decor.meta.label} · portion ${(width / 1000).toFixed(2)} km`,
    regeneration: decor.meta.regeneration && { ...decor.meta.regeneration, crops: [...decor.meta.regeneration.crops, { x, y, width }] },
    settlements: [], roads: null, roadConfig: null,
    waterSvg: cropWaterSvg(decor.meta.waterSvg, x, y, width),
    waterMaterialSvg: decor.meta.waterMaterialSvg === undefined ? undefined : cropWaterSvg(decor.meta.waterMaterialSvg, x, y, width),
    stats: { ...decor.meta.stats, ...rasterStats(raster), roadKm: 0 },
    pipeline: { stage: 'terrain', parent: decor.meta.id, crop: { x, y, width, sourceWidth: r.width } } } };
}

/** Retained raster for the provisional terrain renderer; generation reads the original raster directly. */
export function terrainFromDecor(decor: Decor): TerrainData {
  const r = decor.raster, size = r.n * r.n, cell = r.width / r.n;
  const normalX = new Float32Array(size), normalY = new Float32Array(size), normalZ = new Float32Array(size);
  for (let y = 0; y < r.n; y++) for (let x = 0; x < r.n; x++) {
    const i = y * r.n + x;
    const dx = (r.height[y * r.n + Math.min(r.n - 1, x + 1)] - r.height[y * r.n + Math.max(0, x - 1)]) / (2 * cell);
    const dy = (r.height[Math.min(r.n - 1, y + 1) * r.n + x] - r.height[Math.max(0, y - 1) * r.n + x]) / (2 * cell);
    const norm = Math.hypot(dx, dy, 1); normalX[i] = -dx / norm; normalY[i] = -dy / norm; normalZ[i] = 1 / norm;
  }
  const caveMask = decor.meta.tags.relief === 'cavern' ? Uint8Array.from(r.water, value => value === 2 ? 1 : 0) : new Uint8Array();
  return { x: 0, y: 0, width: r.width, resolution: r.n, height: r.height, caveMask, normalX, normalY, normalZ,
    minHeight: decor.meta.stats.minHeight, maxHeight: decor.meta.stats.maxHeight,
    globalMinHeight: decor.meta.terrainDisplay?.globalMinHeight ?? decor.meta.stats.minHeight, globalMaxHeight: decor.meta.terrainDisplay?.globalMaxHeight ?? decor.meta.stats.maxHeight,
    motifSize: decor.meta.terrainDisplay?.motifSize ?? r.width, generationMs: 0, field: { n: r.n, data: r.height, exact: true, floor: decor.meta.terrainDisplay?.floor ?? 0, cave: caveMask.length ? caveMask : undefined } };
}

/** A city workshop receives its local relief, water and regional approaches together. */
export function cropCityDecor(decor: Decor, key: string): Decor {
  const city = decor.meta.settlements.find(s => s.key === key), state = decor.meta.pipeline?.urban;
  if (!city || !state?.layouts?.length) throw new Error('Ville ou plan absent de cet export.');
  const layouts = state.layouts.filter(l => l.key === key), partitions = state.partitions?.filter(p => p.key === key);
  const points: { x: number; y: number }[] = [city.center];
  function collect(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const p = value as { x?: number; y?: number };
    if (typeof p.x === 'number' && typeof p.y === 'number') points.push(p as { x: number; y: number });
    else for (const [key, child] of Object.entries(value)) if (key !== 'axis') collect(child);
  }
  collect(layouts); collect(partitions);
  const cell = decor.raster.width / decor.raster.n, margin = Math.max(city.radius * .5, cell * 4, 150);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const width = Math.min(decor.raster.width, Math.ceil((Math.max(maxX - minX, maxY - minY) + margin * 2) / cell) * cell);
  const x = Math.max(0, Math.min(decor.raster.width - width, (minX + maxX - width) / 2));
  const y = Math.max(0, Math.min(decor.raster.width - width, (minY + maxY - width) / 2));
  const cropped = cropTerrain(decor, x, y, width), origin = cropped.meta.pipeline!.crop!;
  const move = <T>(value: T): T => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(move) as T;
    const obj = value as Record<string, unknown>;
    if (typeof obj.x === 'number' && typeof obj.y === 'number') return { ...obj, x: obj.x - origin.x, y: obj.y - origin.y } as T;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, k === 'axis' ? v : move(v)])) as T;
  };
  // Keep complete approach polylines crossing the local square. The engine clips
  // these against its raster; endpoints beyond the crop retain incoming direction.
  const inside = (p: { x: number; y: number }): boolean => p.x >= origin.x && p.y >= origin.y && p.x <= origin.x + origin.width && p.y <= origin.y + origin.width;
  const roads = decor.meta.roads ? move({ ...decor.meta.roads, segments: decor.meta.roads.segments.filter(s => s.path.some(inside) || s.path.some((p, i) => i > 0 && Math.max(p.x, s.path[i - 1].x) >= origin.x && Math.min(p.x, s.path[i - 1].x) <= origin.x + origin.width && Math.max(p.y, s.path[i - 1].y) >= origin.y && Math.min(p.y, s.path[i - 1].y) <= origin.y + origin.width)) }) : null;
  return { ...cropped, meta: { ...cropped.meta, label: `${city.name || key} · atelier`, settlements: [move(city)], roads, roadConfig: decor.meta.roadConfig,
    pipeline: { ...cropped.meta.pipeline, stage: 'urban', city: key, urbanDraft: decor.meta.pipeline?.urbanDraft, urban: { ...state, layouts: move(layouts), partitions: move(partitions) } } } };
}
