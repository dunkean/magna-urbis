import { Delaunay } from 'd3-delaunay';
import { FMG_POPULATION_SCALE, FMG_URBANIZATION_RATE, fmgBaseOf, fmgNameBase, pickMuCulture } from '../externalCity/azgaarTables';

type Point = [number, number];
type RecordData = Record<string, unknown>;

export interface FmgBurg {
  id: number;
  x: number;
  y: number;
  name: string;
  population: number;
  culture?: string;
}
export interface FmgMap {
  width: number;
  height: number;
  spacing: number;
  seed: string;
  name: string | undefined;
  metresPerPixel: number | undefined;
  burgs: FmgBurg[];
  // Delaunay's point lookup also handles FMG's jittered and non-square sample lattices.
  elevationAt(x: number, y: number): number;
}

export const FMG_MAP_MAX_BYTES = 64 * 1024 * 1024;
export const FMG_MAP_INVALID = 'This file is not a supported Azgaar .map save.';
export const FMG_MAP_TOO_LARGE = 'The Azgaar map exceeds the 64 MiB file limit.';

const DISTANCE_UNITS = new Map([
  ['km', 1000],
  ['mi', 1609.344],
  ['lg', 4828.032],
  ['vr', 1066.8],
  ['nmi', 1852],
  ['nlg', 5556],
  ['m', 1],
]);
const object = (value: unknown): RecordData => (value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordData) : {});
const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);
const positive = (value: unknown, fallback: number): number => (number(value) > 0 ? number(value) : fallback);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function readRecords(source: string): FmgMap {
  if (!/^\d+\.\d+(?:\.\d+)?\|[^\r\n]*azgaar\.github\.io\/Fantasy-Map-Generator/i.test(source)) throw new Error(FMG_MAP_INVALID);
  // The legacy SVG record can contain literal newlines. Find the structured grid record and
  // use the stable record offsets that follow it. Never parse or attach the stored SVG.
  const records = source.split(/\r?\n/);
  const gridIndex = records.findIndex((line, index) => index >= 5 && /^\{\s*"(?:spacing|cellsX|cellsY|sampling|points)"\s*:/.test(line) && /"points"\s*:\s*\[/.test(line) && /"boundary"\s*:\s*\[/.test(line));
  if (gridIndex < 5 || records.length <= gridIndex + 9) throw new Error(FMG_MAP_INVALID);
  const [, , , seed = '', savedWidth, savedHeight] = records[0].split('|');
  const width = Number(savedWidth);
  const height = Number(savedHeight);
  const grid = object(JSON.parse(records[gridIndex]));
  const spacing = number(grid.spacing);
  const points: Point[] = Array.isArray(grid.points) ? grid.points : [];
  const heights = records[gridIndex + 1].split(',');
  if (
    !Number.isFinite(width) ||
    width < 1 ||
    !Number.isFinite(height) ||
    height < 1 ||
    !(spacing > 0) ||
    spacing > Math.max(width, height) ||
    points.length < 3 ||
    points.length > 500000 ||
    points.length !== heights.length ||
    points.some(point => !Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < -spacing || point[0] > width + spacing || point[1] < -spacing || point[1] > height + spacing)
  )
    throw new Error(FMG_MAP_INVALID);

  // The JSON options layout replaced the pipe-delimited units record in newer FMG saves.
  const optionsText = records[1].trim();
  const options = object(optionsText.startsWith('{') ? JSON.parse(optionsText) : {});
  const units = object(options.units);
  const distance = object(units.distance);
  const population = object(units.population);
  const legacy = optionsText.split('|');
  const distanceUnit = text(distance.unit ?? legacy[0]).toLowerCase();
  const distanceScale = positive(distance.scale ?? Number(legacy[1]), NaN);
  const unitMetres = DISTANCE_UNITS.get(distanceUnit);
  const scale = unitMetres === undefined ? NaN : unitMetres * distanceScale;
  const exponent = positive(object(units.height).exponent ?? Number(legacy[4]), 1.8);
  const populationScale = positive(population.scale ?? Number(legacy[12]), FMG_POPULATION_SCALE);
  const rawUrbanization = number(object(population.urbanization).rate ?? (legacy[13] ? Number(legacy[13]) : undefined));
  const urbanization = rawUrbanization >= 0 ? rawUrbanization : FMG_URBANIZATION_RATE;
  const elevations = Float32Array.from(heights, raw => {
    const h = Number(raw);
    if (!raw.trim() || !Number.isInteger(h) || h < 0 || h > 100) throw new Error(FMG_MAP_INVALID);
    return h >= 20 ? Math.min(12000, (h - 18) ** exponent) : h ? ((h - 20) / h) * 50 : -990;
  });

  const cultures: unknown = JSON.parse(records[gridIndex + 7]);
  const towns: unknown = JSON.parse(records[gridIndex + 9]);
  if (!Array.isArray(cultures) || !Array.isArray(towns)) throw new Error(FMG_MAP_INVALID);
  const cultureById = new Map(
    cultures.map(data => {
      const culture = object(data);
      return [number(culture.i), culture] as const;
    }),
  );
  const burgs: FmgBurg[] = [];
  const ids = new Set<number>();
  for (const data of towns) {
    const burg = object(data);
    const id = number(burg.i);
    const x = number(burg.x);
    const y = number(burg.y);
    const name = text(burg.name).slice(0, 300);
    if (burg.removed || !Number.isSafeInteger(id) || id <= 0 || ids.has(id) || !name || !(x >= 0 && x < width && y >= 0 && y < height)) continue;
    ids.add(id);
    const sourceCulture = cultureById.get(number(burg.culture));
    const base = sourceCulture?.base;
    const cultureNameBase = fmgNameBase(text(sourceCulture?.name));
    const nameBase = cultureNameBase ?? (typeof base === 'string' || typeof base === 'number' ? fmgBaseOf(base) : undefined);
    const culture = pickMuCulture(nameBase, text(sourceCulture?.type), `${seed}:${id}`);
    const people = Math.max(1, Math.round(positive(burg.population, 0) * populationScale * urbanization));
    burgs.push({ id, x, y, name, population: Math.min(5000000, people || 1), culture });
  }

  const mesh = Delaunay.from(points);
  let previous = 0;
  function elevationAt(x: number, y: number): number {
    const index = mesh.find(x, y, previous);
    previous = index;
    const centre = elevations[index];
    const [px, py] = points[index];
    const distanceSq = (px - x) ** 2 + (py - y) ** 2;
    if (distanceSq < 1e-8) return centre;
    let weightSum = 1 / distanceSq;
    let elevationSum = centre * weightSum;
    // Interpolate slopes within the nearest cell's land/water class. This retains
    // the coast at the join between FMG's land and water cells.
    for (const neighbor of mesh.neighbors(index)) {
      const elevation = elevations[neighbor];
      if (elevation >= 0 !== centre >= 0) continue;
      const [nx, ny] = points[neighbor];
      const weight = 1 / Math.max(1e-8, (nx - x) ** 2 + (ny - y) ** 2);
      weightSum += weight;
      elevationSum += elevation * weight;
    }
    return elevationSum / weightSum;
  }

  return { width, height, spacing, seed: seed.slice(0, 400), name: text(object(options.lore).name).slice(0, 240) || undefined, metresPerPixel: Number.isFinite(scale) ? scale : undefined, burgs, elevationAt };
}

export function parseFmgMap(source: string): FmgMap {
  if (source.length > FMG_MAP_MAX_BYTES) throw new Error(FMG_MAP_TOO_LARGE);
  try {
    const raw = source.replace(/^\ufeff/, '').trimStart();
    // FMG also accepts legacy base64 of URI-encoded text.
    return readRecords(/^\d+\.\d+(?:\.\d+)?\|/.test(raw) ? raw : decodeURIComponent(atob(raw)));
  } catch {
    throw new Error(FMG_MAP_INVALID);
  }
}

export async function readFmgMapFile(file: Blob): Promise<FmgMap> {
  if (file.size > FMG_MAP_MAX_BYTES) throw new Error(FMG_MAP_TOO_LARGE);
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (signature[0] !== 0x1f || signature[1] !== 0x8b) return parseFmgMap(await file.text());
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let source = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > FMG_MAP_MAX_BYTES) {
        await reader.cancel();
        throw new Error(FMG_MAP_TOO_LARGE);
      }
      source += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return parseFmgMap(source + decoder.decode());
}

export interface FmgCrop {
  x: number;
  y: number;
  side: number;
}

export function fitFmgCrop(map: Pick<FmgMap, 'width' | 'height'>, crop: FmgCrop): FmgCrop {
  const side = clamp(crop.side, Math.min(0.01, map.width, map.height), Math.min(map.width, map.height));
  return { x: clamp(crop.x, 0, map.width - side), y: clamp(crop.y, 0, map.height - side), side };
}

export function dragFmgCrop(map: Pick<FmgMap, 'width' | 'height'>, start: Point, end: Point): FmgCrop {
  const [sx, sy] = start;
  const [x, y] = end;
  const left = x < sx;
  const up = y < sy;
  const side = Math.min(Math.max(Math.abs(x - sx), Math.abs(y - sy)), left ? sx : map.width - sx, up ? sy : map.height - sy);
  return fitFmgCrop(map, { x: left ? sx - side : sx, y: up ? sy - side : sy, side });
}

export function fmgBurgsInCrop(map: Pick<FmgMap, 'burgs'>, { x, y, side }: FmgCrop): FmgBurg[] {
  return map.burgs.filter(burg => burg.x >= x && burg.y >= y && burg.x < x + side && burg.y < y + side);
}
