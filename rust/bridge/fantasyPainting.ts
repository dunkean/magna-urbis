/** Shared display-only painter. Coordinates and pitch are world metres; no engine rules. */
export type FantasyStyle = 'fantasy-ink' | 'fantasy-color';
export interface FantasyOptions { density: number; size: number; spacing: number }
export const DEFAULT_FANTASY_OPTIONS: FantasyOptions = { density: 1, size: 1, spacing: 1 };
export const isFantasyStyle = (style: string): style is FantasyStyle => style === 'fantasy-ink' || style === 'fantasy-color';
export interface PaintSample { height: number; slope: number; temperature: number; rain: number; water?: boolean; occupied?: boolean; /** Signed local prominence / sampling radius, as in Render. */ tpi?: number; relief?: number }
export interface PaintOptions { seed: string; pitch: number; density?: number; size?: number; maxStamps?: number; /** Size stays independent of spacing. */ brushPitch?: number }
export interface Stamp { x: number; y: number; width: number; height: number; brush: number; variant?: number; flip: boolean; opacity: number; heightScale?: number }
export interface PaintBounds { x: number; y: number; width: number; height: number }
export interface Atlas { url: string; width: number; height: number; rows: number[]; rects?: [number, number, number, number][]; variantsPerStyle?: number }
export const FAMILY_NAMES = ['pines', 'broadleaf', 'tropical', 'cypress', 'hills', 'mountains', 'snow-mountains', 'rocks', 'dunes', 'wetlands', 'crops', 'orchards', 'grasses'] as const;
export type BrushFamily = typeof FAMILY_NAMES[number];
const BRUSH_FAMILY: BrushFamily[] = ['pines', 'broadleaf', 'tropical', 'cypress', 'hills', 'mountains', 'snow-mountains', 'rocks', 'dunes', 'wetlands', 'crops', 'orchards', 'pines', 'broadleaf', 'tropical', 'grasses'];
export interface BrushFrame { atlas: Atlas; family: BrushFamily; index: number; token: string; rect: [number, number, number, number]; aspect: number }
export interface BrushLibrary { kind: 'families'; style: FantasyStyle; families: Record<BrushFamily, Atlas>; frames: BrushFrame[]; variants: number; offsets: number[] }
export function createBrushLibrary(style: FantasyStyle, families: Record<BrushFamily, Atlas>): BrushLibrary {
  const frames: BrushFrame[] = [], offsets: number[] = [];
  const variants = Math.max(...Object.values(families).map(a => a.variantsPerStyle ?? 8));
  for (let brush = 0; brush < 16; brush++) {
    offsets.push(frames.length);
    const family = BRUSH_FAMILY[brush], atlas = families[family];
    if (!atlas) throw new Error(`Missing fantasy brush sheet: ${family}`);
    const count = atlas.variantsPerStyle ?? 8;
    for (let v = 0; v < variants; v++) {
      // Five to eight tree silhouettes; never mix individual trees and giant clumps.
      const variant = v % (brush < 4 || brush >= 12 && brush <= 14 ? Math.min(6, count) : count);
      const index = variant + (style === 'fantasy-color' ? count : 0), rect = atlasRect(atlas, index);
      frames.push({ atlas, family, index, token: `${family}-${index}`, rect, aspect: rect[3] / rect[2] });
    }
  }
  return { kind: 'families', style, families, frames, variants, offsets };
}
export function brushFrame(library: BrushLibrary, stamp: Stamp): BrushFrame {
  return library.frames[library.offsets[stamp.brush] + (stamp.variant ?? 0) % library.variants];
}
// Per-subject source bounds exclude neighbouring silhouettes on the generated sheets.
export const ATLAS_GEOMETRY: Record<FantasyStyle, Omit<Atlas, 'url'>> = {
  'fantasy-ink': { width: 1254, height: 1254, rows: [0,.28,.52,.735,1], rects: [
    [35,0,265,346], [323,20,305,325], [651,20,286,322], [1075,0,130,346],
    [0,414,320,230], [325,350,305,294], [638,350,312,294], [958,399,296,245],
    [0,692,320,225], [328,665,310,250], [644,680,301,236], [962,647,292,272],
    [30,928,282,326], [325,928,300,326], [647,929,307,325], [973,975,281,279]
  ] },
  'fantasy-color': { width: 1295, height: 1214, rows: [0,.295,.54,.75,1], rects: [
    [40,0,245,358], [333,20,310,338], [677,15,290,343], [1039,0,222,358],
    [0,420,326,234], [328,357,325,300], [660,350,320,308], [993,395,302,254],
    [0,680,333,234], [338,663,310,252], [653,682,329,233], [995,657,300,245],
    [30,916,292,298], [328,916,312,298], [660,916,320,298], [999,970,266,244]
  ] }
};
export function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function paintSeed(value: string): number {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++) seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
  return seed;
}
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function smooth(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t);
}
/** Same climate, lapse, valley moisture and exposure controls as Render's material.
 * Biomes provide continuous coverage, never an exclusive choice of one icon. */
export function paintingCover(s: PaintSample): { woods: number; mountain: number; hill: number; dry: number; wet: number; snow: number; temperature: number } {
  const t = s.temperature - .0065 * s.height, hot = t + 6, cold = t - 6;
  const valley = smooth(0, -.12, s.tpi ?? 0), ridge = smooth(0, .12, s.tpi ?? 0);
  const humid = s.rain / Math.max(20 * t + 280, 120) * (1 + .7 * valley - .18 * ridge);
  const rockTan = Math.tan(40 * Math.PI / 180), rockEff = rockTan * (.55 + .45 * smooth(.3, 1.3, humid));
  const exposure = clamp(smooth(rockEff * .5, rockEff * 1.3, s.slope) + .35 * ridge - .3 * valley);
  const woods = clamp((smooth(.65, 2.1, humid) * smooth(5.5, 13.5, hot + .8 * valley)
    * (1 - smooth(rockTan * .9, rockTan * 1.6, s.slope)) * (1 - .22 * ridge)
    + .14 * valley * smooth(2, 10, hot) * smooth(.4, 1.2, humid)) * (1 - exposure));
  const high = smooth(850, 2600, s.height), rugged = smooth(100, 850, s.relief ?? s.slope * 1800);
  const mountain = clamp(Math.max(high * (.45 + .55 * rugged), smooth(.20, .65, s.slope) * rugged) * (1 - .94 * valley));
  const hill = clamp(Math.max(smooth(.07, .28, s.slope), smooth(70, 350, s.relief ?? 0)) * (1 - mountain) * (1 - .95 * valley) * smooth(-.035, .065, s.tpi ?? .065));
  return { woods, mountain, hill, dry: 1 - smooth(.35, 1, humid),
    wet: smooth(1.8, 3.5, humid) * (1 - smooth(.015, .08, s.slope)) * (1 - smooth(50, 250, s.height)),
    snow: smooth(2.5, -2.5, hot) * smooth(60, 400, s.rain), temperature: cold };
}
/** World anchored, tightly overlapping stamps. Noise cuts clearings into continuous
 * coverage; boundary thinning never changes tree width. No summit exclusion radius. */
export function planPainting(bounds: PaintBounds, sample: (x: number, y: number) => PaintSample | undefined, options: PaintOptions): Stamp[] {
  const pitch = options.pitch, density = Math.max(0, Math.min(2, options.density ?? 1)), size = Math.max(.3, Math.min(2, options.size ?? 1));
  const brushPitch = options.brushPitch ?? pitch;
  if (![pitch, brushPitch, bounds.x, bounds.y, bounds.width, bounds.height, density, size].every(Number.isFinite) || pitch <= 0 || brushPitch <= 0 || bounds.width <= 0 || bounds.height <= 0 || density === 0) return [];
  const seed = paintSeed(options.seed), result: Stamp[] = [], budget = Number.isFinite(options.maxStamps ?? 80000) ? Math.max(0, Math.min(80000, Math.floor(options.maxStamps ?? 80000))) : 80000;
  for (const pass of ['relief', 'ground', 'forest'] as const) {
    const pad = brushPitch * (pass === 'relief' ? 8 : 2) * size;
    const step = pitch * (pass === 'relief' ? .85 : pass === 'forest' ? .24 : .9);
    const x0 = Math.floor((bounds.x - pad) / step), x1 = Math.ceil((bounds.x + bounds.width + pad) / step);
    const y0 = Math.floor((bounds.y - pad) / step), y1 = Math.ceil((bounds.y + bounds.height + pad) / step);
    const stride = Math.max(1, Math.ceil(Math.sqrt((x1 - x0 + 1) * (y1 - y0 + 1) / 280000)));
    if (![x0, x1, y0, y1, stride].every(Number.isSafeInteger)) return [];
    // Align coarse safety sampling to the world, including when cropping.
    for (let gy = Math.ceil(y0 / stride) * stride; gy <= y1; gy += stride) for (let gx = Math.ceil(x0 / stride) * stride; gx <= x1; gx += stride) {
      const salt = seed ^ (pass === 'relief' ? 181 : pass === 'forest' ? 719 : 1231);
      const x = (gx + .1 + hash(gx, gy, salt ^ 71) * .8) * step;
      const y = (gy + .1 + hash(gx, gy, salt ^ 191) * .8) * step, s = sample(x, y);
      if (!s || ![s.height, s.slope, s.temperature, s.rain].every(Number.isFinite) || s.height <= 0 || s.water || s.occupied) continue;
      const c = paintingCover(s), patch = noise(x / (brushPitch * 7), y / (brushPitch * 7), seed ^ 891);
      const detail = noise(x / (brushPitch * 1.8), y / (brushPitch * 1.8), seed ^ 421);
      let brush: number, cover: number, scale: number;
      if (pass === 'relief') {
        const mountain = c.mountain > .16;
        if (!mountain && c.hill < .12) continue;
        if (mountain) {
          let support = 0;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const neighbour = sample(x + dx * step, y + dy * step);
            if (neighbour && !neighbour.water && neighbour.height > 0 && paintingCover(neighbour).mountain > .16) support++;
          }
          if (support < 2) continue;
        }
        brush = mountain ? (c.snow > .45 ? 6 : 5) : 4;
        // A continuous factor of three from foothills to the highest ridges.
        scale = mountain ? 2.2 + 4.4 * smooth(650, 2800, s.height) * (.65 + .35 * smooth(0, .12, s.tpi ?? .12)) : .9 + 1.8 * c.hill;
        cover = smooth(.12, .65, mountain ? c.mountain : c.hill) * (.88 + .12 * detail);
      } else if (pass === 'forest') {
        if (c.woods < .015) continue;
        const tropical = c.temperature > 13 && s.rain > 1100, conifer = c.temperature < 3 || s.height > 1100;
        brush = tropical ? 2 : conifer ? 0 : c.temperature > 8 && s.rain < 850 ? 3 : 1;
        // Thresholded masks carve groves and holes, with soft, sparse edges.
        const mask = smooth(.24, .43, .72 * patch + .28 * detail + .16 * c.woods);
        cover = c.woods * mask * (1 - .45 * c.wet);
        scale = .48;
      } else {
        if (c.dry > .2) { brush = 8; cover = c.dry * .16 * smooth(.2, .65, patch); scale = 1.25; }
        else if (c.wet > .3) { brush = 9; cover = c.wet * .16 * smooth(.3, .7, detail); scale = .85; }
        else if (c.woods < .35 && s.slope < .05 && c.temperature > -1 && c.temperature < 18 && patch > .20 && patch < .33) { brush = detail > .6 ? 11 : 10; cover = .13; scale = 1.05; }
        else { brush = 15; cover = (1 - c.woods) * (1 - c.mountain) * .025; scale = .55; }
      }
      if (hash(gx, gy, salt ^ 9811) > clamp(cover * density)) continue;
      const tree = pass === 'forest', variation = tree ? 1 : .95 + .1 * hash(gx, gy, salt ^ 319);
      const w = brushPitch * scale * size * variation;
      // Land anchors stay on land; silhouettes intentionally overhang lakes/roads.
      result.push({ x, y, width: w, height: w * (tree ? 1.15 : .78), heightScale: tree ? .95 + .1 * hash(gx, gy, salt ^ 519) : .95 + .1 * hash(gx, gy, salt ^ 619),
        brush, variant: Math.floor(hash(gx, gy, salt ^ 6317) * 32), flip: hash(gx, gy, salt ^ 97) > .5, opacity: brush === 15 ? .65 : 1 });
    }
  }
  result.sort((a, b) => a.y - b.y || a.x - b.x);
  if (result.length > budget) {
    const relief = result.filter(s => s.brush >= 4 && s.brush <= 8), ground = result.filter(s => s.brush < 4 || s.brush > 8);
    const thin = (items: Stamp[], count: number) => items.filter((_, i) => Math.floor(i * count / items.length) !== Math.floor((i - 1) * count / items.length)).slice(0, count);
    const reliefBudget = Math.min(relief.length, budget);
    return [...thin(relief, reliefBudget), ...thin(ground, budget - reliefBudget)].sort((a, b) => a.y - b.y || a.x - b.x);
  }
  return result;
}
export function atlasRect(atlas: Atlas, brush: number): [number, number, number, number] {
  if (atlas.rects?.[brush]) return atlas.rects[brush];
  const row = Math.floor(brush / 4), x = brush % 4 * atlas.width / 4, y = atlas.rows[row] * atlas.height;
  return [x, y, atlas.width / 4, (atlas.rows[row + 1] - atlas.rows[row]) * atlas.height];
}
/** One atlas embedded per scene; symbols reference it instead of duplicating bitmap data. */
export function paintingSvg(stamps: Stamp[], atlas: Atlas | BrushLibrary, namespace: string, ink = false): string {
  if (!stamps.length) return '';
  const id = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
  if ('kind' in atlas) return familyPaintingSvg(stamps, atlas, id);
  let svg = `<defs><image id="${id}-atlas" width="${atlas.width}" height="${atlas.height}" href="${atlas.url}"/>`;
  for (let i = 0; i < 16; i++) {
    const [x, y, w, h] = atlasRect(atlas, i);
    svg += `<symbol id="${id}-${i}" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none" overflow="hidden"><use href="#${id}-atlas"/></symbol>`;
  }
  svg += '</defs>';
  if (ink) svg += `<defs><filter id="${id}-gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs>`;
  svg += `<g class="fantasy-brushes"${ink ? ` filter="url(#${id}-gray)"` : ''}>`;
  const f = (n: number) => n.toFixed(2);
  for (const s of stamps) svg += `<use href="#${id}-${s.brush}" x="${f(-s.width / 2)}" y="${f(-s.height * .93)}" width="${f(s.width)}" height="${f(s.height)}" opacity="${s.opacity}" transform="translate(${f(s.x)} ${f(s.y)}) scale(${s.flip ? -1 : 1} 1)"/>`;
  return svg + '</g>';
}
/** Atlas draw calls only: no per-stamp images, filters, allocation or transforms. */
export function paintingCanvas(ctx: CanvasRenderingContext2D, stamps: Stamp[], image: CanvasImageSource | ReadonlyMap<string, CanvasImageSource>, atlas: Atlas | BrushLibrary, camera: { x: number; y: number; scale: number }, ink = false): void {
  if ('kind' in atlas) { familyPaintingCanvas(ctx, stamps, image as ReadonlyMap<string, CanvasImageSource>, atlas, camera); return; }
  ctx.save(); if (ink) ctx.filter = 'grayscale(1)';
  for (const s of stamps) {
    const [sx, sy, sw, sh] = atlasRect(atlas, s.brush), w = s.width * camera.scale, h = s.height * camera.scale;
    const x = (s.x - camera.x) * camera.scale, y = (s.y - camera.y) * camera.scale;
    ctx.globalAlpha = s.opacity;
    if (s.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(image as CanvasImageSource, sx, sy, sw, sh, -w / 2, -h * .93, w, h); ctx.restore(); }
    else ctx.drawImage(image as CanvasImageSource, sx, sy, sw, sh, x - w / 2, y - h * .93, w, h);
  }
  ctx.restore();
}
function stampHeight(stamp: Stamp, frame: BrushFrame): number {
  const tree = stamp.brush < 4 || stamp.brush >= 12 && stamp.brush <= 14;
  const aspect = tree ? (frame.family === 'pines' || frame.family === 'cypress' ? 1.8 : 1.25) : frame.aspect;
  return stamp.width * aspect * (stamp.heightScale ?? 1);
}
function familyPaintingSvg(stamps: Stamp[], library: BrushLibrary, id: string): string {
  const frames = new Map<string, BrushFrame>(), families = new Map<string, Atlas>();
  for (const stamp of stamps) { const f = brushFrame(library, stamp); frames.set(f.token, f); families.set(f.family, f.atlas); }
  let svg = '<defs>';
  for (const [family, atlas] of families) svg += `<image id="${id}-sheet-${family}" width="${atlas.width}" height="${atlas.height}" href="${atlas.url}"/>`;
  for (const frame of frames.values()) {
    const [x, y, w, h] = frame.rect;
    svg += `<symbol id="${id}-${frame.token}" viewBox="${x} ${y} ${w} ${h}" overflow="hidden" preserveAspectRatio="none"><use href="#${id}-sheet-${frame.family}"/></symbol>`;
  }
  svg += '</defs><g class="fantasy-brushes">';
  const f = (n: number) => n.toFixed(2);
  for (const s of stamps) {
    const frame = brushFrame(library, s), h = stampHeight(s, frame);
    svg += `<use class="${s.brush >= 4 && s.brush <= 8 ? 'fantasy-relief' : 'fantasy-landuse'}" data-brush="${frame.family}" data-variant="${frame.index % (frame.atlas.variantsPerStyle ?? 8)}" href="#${id}-${frame.token}" x="${f(-s.width / 2)}" y="${f(-h * .95)}" width="${f(s.width)}" height="${f(h)}" opacity="${s.opacity}" transform="translate(${f(s.x)} ${f(s.y)}) scale(${s.flip ? -1 : 1} 1)"/>`;
  }
  return svg + '</g>';
}
function familyPaintingCanvas(ctx: CanvasRenderingContext2D, stamps: Stamp[], images: ReadonlyMap<string, CanvasImageSource>, library: BrushLibrary, camera: { x: number; y: number; scale: number }): void {
  ctx.save();
  for (const s of stamps) {
    const frame = brushFrame(library, s), image = images.get(frame.family); if (!image) continue;
    const [sx, sy, sw, sh] = frame.rect, w = s.width * camera.scale, h = stampHeight(s, frame) * camera.scale;
    const x = (s.x - camera.x) * camera.scale, y = (s.y - camera.y) * camera.scale; ctx.globalAlpha = s.opacity;
    if (s.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h * .95, w, h); ctx.restore(); }
    else ctx.drawImage(image, sx, sy, sw, sh, x - w / 2, y - h * .95, w, h);
  }
  ctx.restore();
}
