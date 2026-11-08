import { isFantasyStyle, planPainting, paintingSvg, paintingCover, noise, paintSeed, isReliefBrush, isCultivatedLanduse, fantasyLod, reliefProminence, DEFAULT_FANTASY_OPTIONS, type FantasyOptions, type BrushLibrary, type FantasyStyle, type PaintLanduse, type PaintOptions, type PaintSample, type Stamp } from './fantasyPainting';
import type { TerrainData, TerrainSettings } from './terrain';
import { climateOf } from './terrain';
import type { ForestField, ForestOccupation } from './terrainForest';
import { urbanPaintingMask, type UrbanPaintingContext } from './urbanPaintingMask';
import { paintingRelief } from './paintingRelief';
export { isFantasyStyle, fantasyLod, DEFAULT_FANTASY_OPTIONS };
export type { FantasyOptions };
let libraries: Record<FantasyStyle, BrushLibrary> | undefined;
export function registerFantasyBrushes(value: Record<FantasyStyle, BrushLibrary>): void { libraries = value; }
export interface FantasyTerrainPainting { stamps: Stamp[]; lod: "overview" | "detail"; library: BrushLibrary; width: number; namespace: string; svg?: string; /** Placement time (ms). */ planMs?: number;
  /** Retained for the painted washes (fantasyGroundWash, fantasyFieldWash): the sampler, the V2 rasters and the terrain square. */
  sample?: (x: number, y: number) => PaintSample | undefined; ground?: FantasyGround; frame?: { x: number; y: number; width: number }; /** Painter noise seed and brush pitch, so the washes share the stamps' glades. */ noiseSeed?: number; brushPitch?: number;
  /** Single trees and ground plants of one region (world bounds), planned on demand at the same anchors as a whole-map plan. */
  fine?: (bounds: { x: number; y: number; width: number; height: number }) => Stamp[]; treeWidth?: number }
/** The V2 display rasters: land-use classes (occupation) and the canopy field shared with the other styles. */
export interface FantasyGround { field?: ForestField; occupation?: ForestOccupation; parcels?: PaintOptions['parcels']; /** Corridors and isolated settlements kept clear of stamp anchors (roads, rivers, farms, hamlets). */ clear?: { key: string; test(x: number, y: number): boolean } }
type FantasySettings = Pick<TerrainSettings, 'seed' | 'width'> & Partial<Pick<TerrainSettings, 'climate' | 'climateValues'>> & { forest?: FantasyGround };
const scenes = new WeakMap<TerrainData, { water: TerrainData['water']; hydro: TerrainData['hydrology']; urban?: UrbanPaintingContext; ground?: FantasyGround; variants: Map<string, FantasyTerrainPainting>; reliefWidth?: number; relief?: ReturnType<typeof paintingRelief>; reliefRef?: number; heightRange?: [number, number] }>();
const OCCUPATION_LANDUSE: (PaintLanduse | undefined)[] = [undefined, 'field', 'meadow', 'pasture', 'orchard', 'garden', 'commons', undefined, undefined, undefined, 'marsh'];
/** Land use, built ground and canopy cover from the V2 rasters. Classes 7-9 (built reserve, construction, lanes) stay bare. */
function groundSampler(ground: FantasyGround): (x: number, y: number) => { landuse?: PaintLanduse; occupied: boolean; cleared: boolean; woods?: number } {
  const { occupation: o, field: f, clear } = ground;
  return (x, y) => {
    let landuse: PaintLanduse | undefined, occupied = false, woods: number | undefined;
    const cleared = !!clear?.test(x, y);
    if (o) {
      const i = Math.floor((x - o.x) / o.width * o.n), j = Math.floor((y - o.y) / o.width * o.n);
      if (i >= 0 && j >= 0 && i < o.n && j < o.n) {
        const at = (j * o.n + i) * 4, cls = o.rgba[at + 2];
        if (cls >= 7 && cls <= 9) occupied = true;
        else if (isCultivatedLanduse(OCCUPATION_LANDUSE[cls])) landuse = OCCUPATION_LANDUSE[cls];
        else if (o.rgba[at + 1] > 128) landuse = 'forest';
        else landuse = OCCUPATION_LANDUSE[cls];
      }
    }
    if (f) {
      const i = Math.min(f.n - 1, Math.max(0, Math.floor((x - f.x) / f.width * f.n))), j = Math.min(f.n - 1, Math.max(0, Math.floor((y - f.y) / f.width * f.n)));
      woods = f.rgba[(j * f.n + i) * 4] / 255;
    }
    return { landuse, occupied, cleared, woods };
  };
}
const smoothstep = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const WASH: Record<PaintLanduse, [number, number, number, number]> = {
  field: [214, 190, 112, .9], garden: [150, 163, 92, .7], orchard: [158, 172, 96, .7], vineyard: [158, 172, 96, .7], meadow: [156, 178, 98, .6],
  pasture: [168, 182, 108, .55], commons: [164, 154, 104, .55], marsh: [116, 146, 116, .62], forest: [86, 112, 62, .62],
};
const washHash = (i: number, j: number, seed: number) => { let h = Math.imul(i, 0x9e3779b9) ^ Math.imul(j, 0x85ebca6b) ^ seed; h = Math.imul(h ^ h >>> 15, 0x2c1b3c6d); return ((h ^ h >>> 13) >>> 0) / 4294967296; };
function washNoise(u: number, v: number, seed: number): number {
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = washHash(i, j, seed), b = washHash(i + 1, j, seed), c = washHash(i, j + 1, seed), d = washHash(i + 1, j + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
const put = (pixels: Uint8ClampedArray, at: number, r: number, g: number, b: number, a: number, ink: boolean) => {
  if (ink) { const grey = .3 * r + .59 * g + .11 * b; r = g = b = 255 - (255 - grey) * .55; }
  pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
};
/** Painted ground under the stamps (n x n over the terrain square): land-use colours, then a grass, heath, straw or scree
 * wash on uncultivated land, all with brushed noise, so the paper only shows on bare rock, sand, water and built ground.
 * Holdings (fields, gardens, orchards) are left to `fantasyFieldWash`. */
export function fantasyGroundWash(scene: FantasyTerrainPainting, n: number, ink: boolean): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(n * n * 4), { x: x0, y: y0, width } = scene.frame!, cell = width / n, sample = scene.sample!;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + .5) * cell, y = y0 + (j + .5) * cell, s = sample(x, y);
    if (!s || s.water || s.occupied || s.height <= 0) continue;
    const u = x / width * 90, v = y / width * 90;
    const brush = .6 * washNoise(u * 1.7 + v * .4, v * 4.5, 17) + .4 * washNoise(u * .35, v * .35, 91), at = (j * n + i) * 4;
    const lu = s.landuse;
    if (lu === 'field' || lu === 'garden' || lu === 'orchard') { const [r, g, b] = WASH[lu]; put(pixels, at, r, g, b, .75, ink); continue; }
    const c = paintingCover(s), shade = .9 + .2 * brush;
    if (lu) { const [r, g, b, a] = WASH[lu]; put(pixels, at, r * shade, g * shade, b * shade, a * (.75 + .35 * brush), ink); continue; }
    const woods = s.woods ?? c.woods;
    const glade = smoothstep(.28, .55, noise(x / (scene.brushPitch! * 11), y / (scene.brushPitch! * 11), scene.noiseSeed! ^ 1409));
    if (woods * glade > .4) { const [r, g, b, a] = WASH.forest; put(pixels, at, r * shade, g * shade, b * shade, a * Math.min(1, (woods * glade - .4) * 2.5) * (.7 + .4 * brush), ink); if (woods * glade > .7) continue; }
    const rock = Math.max(smoothstep(.25, .6, c.mountain), smoothstep(.4, .8, s.slope));
    const heath = washNoise(u * .8, v * .8, 313) > .62 ? 1 : 0, dry = smoothstep(.45, .9, c.dry), snow = smoothstep(.3, .7, c.snow);
    let r = 156 + 40 * dry + 8 * heath, g = 176 + 6 * dry - 22 * heath, b = 100 + 28 * dry + 16 * heath;
    r += (166 - r) * rock; g += (160 - g) * rock; b += (142 - b) * rock;
    r += (236 - r) * snow; g += (236 - g) * snow; b += (234 - b) * snow;
    if (pixels[at + 3]) continue;
    put(pixels, at, r * shade, g * shade, b * shade, (.42 + .26 * brush) * (1 - .35 * rock), ink);
  }
  return pixels;
}
const FIELD_RAMP: [number, number, number][] = [[176, 190, 112], [198, 200, 112], [224, 204, 120], [230, 190, 104], [210, 168, 92], [196, 178, 120], [150, 116, 78]];
/** Crop colour of a holding tone (land-detail R, 0..1): golden, ochre and green crops; ploughed brown only for the top tones. */
export function fantasyFieldColour(tone: number, landuse?: PaintLanduse): [number, number, number] {
  if (landuse === 'orchard') return [158, 172, 96];
  return FIELD_RAMP[Math.min(FIELD_RAMP.length - 1, Math.floor(tone < .9 ? tone / .9 * (FIELD_RAMP.length - 1) : FIELD_RAMP.length - 1))];
}
/** Holdings painted edge to edge from the land-detail raster: one crop colour per strip, furrows along the strip's
 * own direction, darker balks on the edges. Golden, ochre and green crops; ploughed brown stays a minority. */
export function fantasyFieldWash(scene: FantasyTerrainPainting, n: number, ink: boolean): Uint8ClampedArray<ArrayBuffer> | undefined {
  const d = scene.ground?.occupation?.detail; if (!d) return;
  const groundAt = groundSampler(scene.ground!);
  const pixels = new Uint8ClampedArray(n * n * 4), { x: x0, y: y0, width } = scene.frame!, cell = width / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + .5) * cell, y = y0 + (j + .5) * cell;
    const di = Math.floor((x - d.x) / d.width * d.n), dj = Math.floor((y - d.y) / d.width * d.n);
    if (di < 0 || dj < 0 || di >= d.n || dj >= d.n) continue;
    const at = (dj * d.n + di) * 4, edge = d.rgba[at + 3]; if (!edge) continue;
    const tone = d.rgba[at] / 255, a = Math.atan2(d.rgba[at + 2] / 127.5 - 1, d.rgba[at + 1] / 127.5 - 1) / 2;
    const lu = groundAt(x, y).landuse, [r0, g0, b0] = fantasyFieldColour(tone, lu);
    const across = -x * Math.sin(a) + y * Math.cos(a), furrow = lu === 'orchard' ? 1 : .5 + .5 * Math.sin(across / 7 * Math.PI);
    const band = washNoise(across / 22, (x * Math.cos(a) + y * Math.sin(a)) / 140, 523);
    const shade = (.94 + .06 * furrow) * (.93 + .12 * band) * (edge < 40 ? .82 + .18 * edge / 40 : 1);
    put(pixels, (j * n + i) * 4, r0 * shade, g0 * shade, b0 * shade, .93, ink);
  }
  return pixels;
}
/** Whole-map overview owns brush positions; camera refinement never repaints stands. Each detail level is planned once per setting and cached:
 * `options.lod` "auto" takes the detail level for a small map; a zoomed export asks for `{ ...options, lod: "detail" }` (see `fantasyLod`).
 * `settings.forest` (V2 occupation and canopy field) is retained per terrain, so a later call without it (the 3D view) paints the same stamps. */
export function prepareFantasyTerrain(terrain: TerrainData, style: FantasyStyle, settings: FantasySettings, options = DEFAULT_FANTASY_OPTIONS, urban?: UrbanPaintingContext): FantasyTerrainPainting | undefined {
  if (terrain.caveMask.length) return;
  let entry = scenes.get(terrain);
  if (!entry || entry.water !== terrain.water || entry.hydro !== terrain.hydrology || urban && entry.urban !== urban) {
    entry = { water: terrain.water, hydro: terrain.hydrology, urban, ground: entry?.ground, variants: new Map() }; scenes.set(terrain, entry);
  }
  if (settings.forest?.occupation || settings.forest?.field) {
    if (settings.forest.parcels && settings.forest.parcels !== entry.ground?.parcels) entry.variants.clear();
    entry.ground = { field: settings.forest.field, occupation: settings.forest.occupation, clear: settings.forest.clear, parcels: settings.forest.parcels ?? entry.ground?.parcels };
  }
  const ground = entry.ground;
  const lod = options.lod && options.lod !== "auto" ? options.lod : fantasyLod(settings.width);
  // The resolved level enters the key: an explicit `lod` equal to the automatic one reuses the same plan (2D then 3D).
  const key = JSON.stringify([style, settings.seed, settings.width, settings.climate, settings.climateValues, { ...options, lod, svgStamps: undefined }, ground?.field?.key, ground?.occupation?.key, ground?.clear?.key]);
  const cache = entry.variants;
  const cached = cache.get(key); if (cached !== undefined) return cached;
  const started = performance.now();
  const n = terrain.resolution, climate = climateOf(settings as TerrainSettings), hydro = terrain.hydrology;
  const occupied = urban && urbanPaintingMask(settings.width, n, { layouts: urban.layouts, cities: urban.cities });
  const groundAt = ground && groundSampler(ground);
  if (!entry.relief || entry.reliefWidth !== settings.width) {
    entry.relief = paintingRelief(terrain.height, n, terrain.width, settings.width / 65 * 3); entry.reliefWidth = settings.width;
    // Tallest relief of the map (97th percentile on a coarse grid) tops the size hierarchy, whatever the region size.
    const g = 48, values: number[] = [];
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
      const r = entry.relief((i + .5) / g * terrain.width, (j + .5) / g * terrain.width);
      if (r.height > 0) values.push(reliefProminence({ ...r, temperature: 0, rain: 0 }));
    }
    values.sort((a, b) => a - b); entry.reliefRef = values.length ? values[Math.min(values.length - 1, Math.floor(values.length * .97))] : undefined;
    // Lowlands and summits of the land: relief tiers are relative to the map's own range.
    const heights: number[] = [];
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) { const h = entry.relief((i + .5) / g * terrain.width, (j + .5) / g * terrain.width).height; if (h > 0) heights.push(h); }
    heights.sort((a, b) => a - b);
    entry.heightRange = heights.length ? [heights[Math.floor(heights.length * .1)], heights[Math.min(heights.length - 1, Math.floor(heights.length * .98))]] : undefined;
  }
  const relief = entry.relief;
  const sample = (x: number, y: number): PaintSample | undefined => {
    const u = (x - terrain.x) / terrain.width, v = (y - terrain.y) / terrain.width;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return;
    const vector = terrain.water;
    const vectorN = vector?.hydro.n ?? 0;
    const vectorWater = vector && vector.lake[Math.min(vectorN - 1, Math.floor(v * vectorN)) * vectorN + Math.min(vectorN - 1, Math.floor(u * vectorN))] !== 0;
    const water = hydro && hydro.waterField[Math.min(hydro.resolution - 1, Math.floor(v * hydro.resolution)) * hydro.resolution + Math.min(hydro.resolution - 1, Math.floor(u * hydro.resolution))] > 0;
    const g = groundAt?.(x, y);
    return { ...relief(x - terrain.x, y - terrain.y), temperature: climate.temperature, rain: climate.precipitation, water: !!water || !!vectorWater,
      occupied: occupied?.(x, y) || g?.occupied, landuse: (options.followLanduse ? urban?.landuse?.(x, y) : undefined) ?? g?.landuse, woods: g?.woods, cleared: g?.cleared, landuseDetail: !!ground?.occupation?.detail };
  };
  const paint: PaintOptions = { seed: settings.seed, pitch: settings.width / 65 * options.spacing, brushPitch: settings.width / 65, mapWidth: settings.width, lod, raster: options.raster, reliefRef: entry.reliefRef, heightRange: entry.heightRange, density: options.density, size: options.size, followLanduse: options.followLanduse, forests: options.forests, forestsOnly: options.forestsOnly };
  paint.cultivated = (x, y) => isCultivatedLanduse(urban?.landuse?.(x, y)) || isCultivatedLanduse(groundAt?.(x, y).landuse);
  paint.parcels = ground?.parcels;
  // Retain orchard rows with relief and woodland clumps, including on the 3D drape; wild trees and plants use fine view tiles.
  const stamps = planPainting({ x: terrain.x, y: terrain.y, width: terrain.width, height: terrain.width }, sample, { ...paint, vegetation: 'coarse' });
  const summits = stamps.filter(stamp => isReliefBrush(stamp.brush));
  const fine = (bounds: { x: number; y: number; width: number; height: number }) => planPainting(bounds, sample, { ...paint, vegetation: 'fine', summits, maxStamps: 400000 });
  const planMs = performance.now() - started;
  if (!libraries) throw new Error('Fantasy brush sheets have not been registered by the page.');
  const scene: FantasyTerrainPainting = { stamps, lod, library: libraries[style], width: terrain.width, namespace: `fantasy-${style}-${terrain.x}-${terrain.y}`, planMs,
    sample, ground, frame: { x: terrain.x, y: terrain.y, width: terrain.width }, noiseSeed: paintSeed(settings.seed), brushPitch: settings.width / 65, fine, treeWidth: 11 * (options.size ?? 1) };
  if (cache.size >= 6) cache.delete(cache.keys().next().value!);
  cache.set(key, scene); return scene;
}
/** Vector export stays independent of the screen's disposable raster tiles. */
export function renderFantasyTerrain(terrain: TerrainData, style: FantasyStyle, settings: FantasySettings, options = DEFAULT_FANTASY_OPTIONS, urban?: UrbanPaintingContext): string {
  const scene = prepareFantasyTerrain(terrain, style, settings, options, urban);
  // `svgStamps: false`: the page paints the stamps on canvas (web/src/ui/fantasyRaster.ts); the SVG keeps the ground only.
  return scene && options.svgStamps !== false ? scene.svg ??= paintingSvg(scene.stamps, scene.library, scene.namespace) : '';
}
