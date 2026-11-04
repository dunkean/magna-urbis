/** Map-tinted roads and city ground (always on; callers keep their own colours when no map is sampled).
 *
 * Roads and the washed city ground take their colour from the map they sit on: the local mean of the background
 * image (decor PNG, or the V1 landscape canvas), a little darker and greyer for roads, almost the same for the
 * ground. Without a background (V2 app, image not loaded yet) every caller keeps its own colours. The sampler is a
 * 256² mean-colour grid of the image, read synchronously once loaded; loading notifies the listeners so the colour
 * tables are rebuilt. */
import { STRUCTURE_ROLES, groundWash, type BlendTone, type WashKind } from './groundBlend';
export type Rgb = readonly [number, number, number];
const isOn = (): boolean => true;
const listeners = new Set<() => void>();
/** Called when a map finishes loading (the switch itself is observed through onSwitch). */
export function onToneReady(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

const N = 256;
interface Grid { data: Uint8ClampedArray; size: number; key: string }
let grid: Grid | undefined, loadingKey = '', failedKey = '';
const source = (): { href: string; size: number } | undefined => {
  const doc = globalThis.document; if (!doc) return undefined;
  const image = doc.querySelector('#v1Landscape') ?? doc.querySelector('#cityBackground image');
  const href = image?.getAttribute('href'), size = Number(image?.getAttribute('width'));
  return href && size > 0 ? { href, size } : undefined;
};
const keyOf = (s: { href: string; size: number }): string => `${s.size}|${s.href.length}|${s.href.slice(-48)}`;
async function load(s: { href: string; size: number }, key: string): Promise<void> {
  loadingKey = key;
  try {
    const blob = await (await fetch(s.href)).blob();
    const bitmap = await createImageBitmap(blob, { resizeWidth: N, resizeHeight: N, resizeQuality: 'high' });
    const canvas = Object.assign(document.createElement('canvas'), { width: N, height: N }), ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    grid = { data: ctx.getImageData(0, 0, N, N).data, size: s.size, key };
  } catch { failedKey = key; }
  if (loadingKey === key) { loadingKey = ''; if (lastFeed) feedLanduse(...lastFeed); else for (const f of [...listeners]) f(); }
}
/** The map as seen is the decor image under the land-use layer, and the land use leaves the town footprint empty (the decor shows
 * through there, darker): the tone comes from the land-use pixels around the town (`feedLanduse`, every landuse draw), filled to the
 * footprint by nearest cell. The decor image is only the fallback when no land use was drawn. */
let land: { rgb: Float32Array; valid: Uint8Array; filled: Uint8Array } | undefined, landCount = 0, countAtVersion = 0, version = 0, landSize = 0;
function fillLand(): void {
  if (!land) return;
  const { rgb, valid, filled } = land, queue = new Int32Array(N * N), seen = new Uint8Array(N * N);
  let head = 0, tail = 0;
  for (let i = 0; i < N * N; i++) if (valid[i]) { seen[i] = 1; queue[tail++] = i; filled[i * 3] = rgb[i * 3]; filled[i * 3 + 1] = rgb[i * 3 + 1]; filled[i * 3 + 2] = rgb[i * 3 + 2]; }
  while (head < tail) {
    const i = queue[head++], x = i % N, y = (i / N) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) {
      if (j < 0 || seen[j]) continue;
      seen[j] = 1; queue[tail++] = j; filled[j * 3] = filled[i * 3]; filled[j * 3 + 1] = filled[i * 3 + 1]; filled[j * 3 + 2] = filled[i * 3 + 2];
    }
  }
}
let scratch: HTMLCanvasElement | undefined;
/** Record the opaque pixels of a land-use canvas covering the world rectangle (x0, y0, w, h); `size` is the map width in metres. */
let lastFeed: [HTMLCanvasElement, number, number, number, number, number] | undefined;
export function feedLanduse(canvas: HTMLCanvasElement, x0: number, y0: number, w: number, h: number, size: number): void {
  if (!isOn() || !(w > 0) || !(h > 0) || !(size > 0) || !canvas.width || !canvas.height) return;
  lastFeed = [canvas, x0, y0, w, h, size];
  toneKey();   // starts the decor load: land use is translucent, it is composited over the decor colour
  const base = grid && grid.size === size ? grid : undefined;
  if (!base) return;
  const sw = 128, sh = Math.max(1, Math.round(128 * h / w));
  scratch ??= document.createElement('canvas'); scratch.width = sw; scratch.height = sh;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, sw, sh); ctx.drawImage(canvas, 0, 0, sw, sh);
  let data: Uint8ClampedArray; try { data = ctx.getImageData(0, 0, sw, sh).data; } catch { return; }
  if (!land || landSize !== size) { land = { rgb: new Float32Array(N * N * 3), valid: new Uint8Array(N * N), filled: new Uint8Array(N * N * 3) }; landCount = 0; countAtVersion = 0; landSize = size; }
  const sum = new Float32Array(N * N * 3), count = new Uint16Array(N * N);
  for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
    const k = (j * sw + i) * 4, a = data[k + 3] / 255; if (a < 0.3) continue;
    const cx = Math.floor((x0 + (i + 0.5) / sw * w) * N / size), cy = Math.floor((y0 + (j + 0.5) / sh * h) * N / size);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
    const c = cy * N + cx, b = c * 4;   // the pixel as displayed: land use over the decor
    sum[c * 3] += data[k] * a + base.data[b] * (1 - a); sum[c * 3 + 1] += data[k + 1] * a + base.data[b + 1] * (1 - a); sum[c * 3 + 2] += data[k + 2] * a + base.data[b + 2] * (1 - a); count[c]++;
  }
  for (let c = 0; c < N * N; c++) if (count[c]) {
    for (let q = 0; q < 3; q++) land.rgb[c * 3 + q] = sum[c * 3 + q] / count[c];
    if (!land.valid[c]) { land.valid[c] = 1; landCount++; }
  }
  if (landCount <= countAtVersion * 1.15 + 1) return;   // new colours only count with new coverage: no redraw loop
  countAtVersion = landCount; version++; fillLand();
  for (const f of [...listeners]) f();
}
/** Identifier of the sampler state: part of the colour-table cache keys ('' when the switch is off). */
export function toneKey(): string {
  if (!isOn()) return '';
  if (landCount > 0) return `land${version}`;
  const s = source();
  if (!s) return 'none';
  const key = keyOf(s);
  if (grid?.key !== key && loadingKey !== key && failedKey !== key) void load(s, key);
  return grid?.key === key ? key : 'pending';
}
/** Cheap stamp of the sampler state (no DOM access): changes when the sampled ground does. */
export const toneStamp = (): number => landCount > 0 ? version : grid ? -1 : -2;
/** Mean map colour within `radius` cells (default 1) of a world point; undefined when off or not loaded. */
export function groundAt(x: number, y: number, radius = 1): Rgb | undefined {
  if (!isOn() || toneKey() === 'pending') return undefined;
  const source = landCount > 0 ? land!.filled : grid?.data, size = landCount > 0 ? landSize : grid?.size, stride = landCount > 0 ? 3 : 4;
  if (!source || !size) return undefined;
  const cx = Math.floor(x * N / size), cy = Math.floor(y * N / size);
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = Math.max(0, cy - radius); j <= Math.min(N - 1, cy + radius); j++) for (let i = Math.max(0, cx - radius); i <= Math.min(N - 1, cx + radius); i++) {
    const k = (j * N + i) * stride; r += source[k]; g += source[k + 1]; b += source[k + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : undefined;
}
const hex = (c: readonly number[]): string => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const grey = (c: Rgb, keep: number): Rgb => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [l + (c[0] - l) * keep, l + (c[1] - l) * keep, l + (c[2] - l) * keep]; };
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Road: a darker, greyer tone of the ground; main streets darker than lanes; soft casing. Tracks stay lighter. */
const ROAD_K = [0.84, 0.86, 0.88, 0.9, 0.92];
export function toneStreet(ground: Rgb, role: string, rank: number): { fill: string; alpha: number; edge: string; edgeAlpha: number; ground: string } {
  const r = Math.min(4, Math.max(0, Math.round(rank))), fill = scale(grey(ground, 0.65), role === 'track' ? 0.94 : ROAD_K[r]);
  return { fill: hex(fill), alpha: role === 'track' ? 0.55 : 0.85, edge: hex(scale(fill, 0.85)), edgeAlpha: 0.22, ground: hex(scale(grey(ground, 1), 0.97)) };
}
/** City ground wash by kind: nearly the map colour (plazas a touch lighter). [factor, alpha] */
const WASH_K: Record<string, readonly [number, number]> = { block: [0.92, 0.8], parcel: [0.9, 0.45], garden: [0.9, 0.5], place: [1.07, 0.7], market: [1.05, 0.7], common: [0.95, 0.5], reserve: [0.94, 0.45], footprint: [0.9, 0.85] };
export function toneWash(ground: Rgb, kind: string): { color: string; alpha: number } {
  const [k, alpha] = WASH_K[kind] ?? WASH_K.block;
  return { color: hex(scale(grey(ground, 1), k)), alpha };
}
/** A world point representative of a polygon / polyline (bounding-box centre). */
export function centreOf(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}
/** Ground wash of a feature: the map-tinted one when the switch is on and the map is sampled, else the fixed tone. */
export function washAt(kind: WashKind, tone: BlendTone, shape: { outer: readonly { x: number; y: number }[] }): { color: string; alpha: number } {
  const c = shape.outer.length ? centreOf(shape.outer) : undefined, g = c && groundAt(c.x, c.y, 2);
  return g ? toneWash(g, kind) : groundWash(kind, tone);
}
/** Map-tinted street paint of a street path, or undefined (switch off, no map, structures). */
const TONED_STRUCTURES = new Set(['causeway']);   // a causeway is an ordinary raised road; bridges, quays, fords, stairs keep their paint
export function streetToneAt(path: readonly { x: number; y: number }[], role: string, rank: number): ReturnType<typeof toneStreet> | undefined {
  if (STRUCTURE_ROLES.has(role) && !TONED_STRUCTURES.has(role)) return undefined;
  const m = path.length ? path[path.length >> 1] : undefined, g = m && groundAt(m.x, m.y, 2);
  return g ? toneStreet(g, role, rank) : undefined;
}
/** Debug handle for the shot harness (read-only state). */
(globalThis as { __magnaTone?: unknown }).__magnaTone = { key: () => toneKey(), at: (x: number, y: number) => groundAt(x, y, 2), landCount: () => landCount, version: () => version };
