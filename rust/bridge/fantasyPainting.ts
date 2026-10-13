/** Shared display-only painter. Coordinates and pitch are world metres; no engine rules. */
export type FantasyStyle = 'fantasy-ink' | 'fantasy-color';
export interface FantasyOptions { density: number; size: number; spacing: number }
export const DEFAULT_FANTASY_OPTIONS: FantasyOptions = { density: 1, size: 1, spacing: 1 };
export const isFantasyStyle = (style: string): style is FantasyStyle => style === 'fantasy-ink' || style === 'fantasy-color';
export interface PaintSample { height: number; slope: number; temperature: number; rain: number; water?: boolean; occupied?: boolean }
export interface PaintOptions { seed: string; pitch: number; density?: number; size?: number; maxStamps?: number }
export interface Stamp { x: number; y: number; width: number; height: number; brush: number; variant?: number; flip: boolean; opacity: number }
export interface PaintBounds { x: number; y: number; width: number; height: number }
export interface Atlas { url: string; width: number; height: number; rows: number[]; rects?: [number, number, number, number][] }
export const FAMILY_NAMES = ['pines', 'broadleaf', 'tropical', 'cypress', 'hills', 'mountains', 'snow-mountains', 'rocks', 'dunes', 'wetlands', 'crops', 'orchards', 'grasses'] as const;
export type BrushFamily = typeof FAMILY_NAMES[number];
const BRUSH_FAMILY: BrushFamily[] = ['pines', 'broadleaf', 'tropical', 'cypress', 'hills', 'mountains', 'snow-mountains', 'rocks', 'dunes', 'wetlands', 'crops', 'orchards', 'pines', 'broadleaf', 'tropical', 'grasses'];
export interface BrushFrame { atlas: Atlas; family: BrushFamily; index: number; token: string; rect: [number, number, number, number]; aspect: number }
export interface BrushLibrary { kind: 'families'; style: FantasyStyle; families: Record<BrushFamily, Atlas>; frames: BrushFrame[] }
export function createBrushLibrary(style: FantasyStyle, families: Record<BrushFamily, Atlas>): BrushLibrary {
  const frames: BrushFrame[] = [];
  for (let brush = 0; brush < 16; brush++) for (let v = 0; v < 8; v++) {
    const family = BRUSH_FAMILY[brush], atlas = families[family];
    if (!atlas) throw new Error(`Missing fantasy brush sheet: ${family}`);
    let variant = v;
    if (brush === 0 || brush === 1) variant %= 6;
    if (brush === 12 || brush === 13) variant = 6 + v % 2;
    if (brush === 2) variant = [0, 1, 2, 5][v % 4];
    if (brush === 14) variant = [3, 4, 6, 7][v % 4];
    const index = variant + (style === 'fantasy-color' ? 8 : 0), rect = atlasRect(atlas, index);
    frames.push({ atlas, family, index, token: `${family}-${index}`, rect, aspect: Math.max(.4, Math.min(1.8, rect[3] / rect[2])) });
  }
  return { kind: 'families', style, families, frames };
}
export function brushFrame(library: BrushLibrary, stamp: Stamp): BrushFrame { return library.frames[stamp.brush * 8 + (stamp.variant ?? 0) % 8]; }
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
/** World-anchored jittered lattice with two scales of correlated coverage.
 * Iterate only a padded visible region. Constant seed/pitch gives identical overlapping crops. */
export function planPainting(bounds: PaintBounds, sample: (x: number, y: number) => PaintSample | undefined, options: PaintOptions): Stamp[] {
  const pitch = options.pitch, density = Math.max(0, Math.min(2, options.density ?? 1)), size = Math.max(.3, Math.min(2, options.size ?? 1));
  if (!Number.isFinite(pitch) || pitch <= 0 || ![bounds.x, bounds.y, bounds.width, bounds.height, density, size].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return [];
  const seed = paintSeed(options.seed), result: Stamp[] = [], budget = Number.isFinite(options.maxStamps ?? 80000) ? Math.max(0, Math.min(80000, Math.floor(options.maxStamps ?? 80000))) : 80000;
  // Separate scales: prominent summits, ordinary ground marks, fine dense woodland.
  // Coverage noise remains at the map scale so finer trees still form whole forests.
  for (const pass of ['summits', 'ground', 'forest'] as const) {
    const pad = pitch * (pass === 'summits' ? 12 : pass === 'forest' ? 2 : 4) * size;
    const step = pitch * (pass === 'summits' ? 2 : pass === 'forest' ? 1 / 4 : 1);
    const x0 = Math.floor((bounds.x - pad) / step), x1 = Math.ceil((bounds.x + bounds.width + pad) / step);
    const y0 = Math.floor((bounds.y - pad) / step), y1 = Math.ceil((bounds.y + bounds.height + pad) / step);
    // A bounded stride protects tools from accidentally painting a planetary extent at metre pitch.
    const stride = Math.max(1, Math.ceil(Math.sqrt((x1 - x0 + 1) * (y1 - y0 + 1) / 240000)));
    if (![x0, x1, y0, y1, stride].every(Number.isSafeInteger)) return [];
    for (let gy = y0; gy <= y1; gy += stride) for (let gx = x0; gx <= x1; gx += stride) {
      const r = hash(gx, gy, seed), x = (gx + .18 + hash(gx, gy, seed ^ 71) * .64) * step;
      const y = (gy + .18 + hash(gx, gy, seed ^ 191) * .64) * step, s = sample(x, y);
      if (!s || ![s.height, s.slope, s.temperature, s.rain].every(Number.isFinite) || s.height <= 0 || s.water || s.occupied) continue;
      const patch = noise(x / (pitch * 11), y / (pitch * 11), seed ^ 891);
      const detail = noise(x / (pitch * 3), y / (pitch * 3), seed ^ 421);
      const temp = s.temperature - s.height * .006, arid = s.rain < 350;
      let brush: number, cover: number, scale = 1;
      if (s.height > 1850 || s.slope > .48) { brush = temp < 0 || s.height > 2900 ? 6 : 5; cover = .46 + .25 * detail; scale = 5.6; }
      else if (s.slope > .22) { brush = s.slope > .36 ? 7 : 4; cover = .32 + .32 * patch; scale = 2.1; }
      else if (arid) { brush = 8; cover = .16 + .48 * patch; scale = 1.35; }
      else if (s.height < 70 && s.rain > 1600 && s.slope < .04 && patch > .66) { brush = 9; cover = .22 + patch * .36; }
      else {
        // Rain and correlated noise create stands and clearings, not independent confetti.
        cover = Math.max(0, Math.min(1, (s.rain - 250) / 1300)) * Math.max(0, Math.min(1, (patch * .75 + detail * .25 - .40) * 4.5));
        const conifer = temp < 9 || s.height > 1000, tropical = temp > 22 && s.rain > 1100;
        brush = tropical ? (r < .18 ? 2 : 14) : conifer ? (r < .22 ? 12 : 0) : (r < .22 ? 13 : 1);
        if (!tropical && !conifer && temp > 14 && s.rain < 850 && r < .14) brush = 3;
        scale = .48;
        if (cover < .16) {
          // Small cultivated patches remain separated by broad quiet ground.
          brush = patch > .18 && patch < .28 && s.slope < .05 && temp > 5 && temp < 24 ? (detail > .6 ? 11 : 10) : 15;
          cover = brush === 15 ? .035 : .13; scale = brush === 15 ? .65 : 1.05;
        }
      }
      const tree = brush < 4 || brush >= 12 && brush <= 14;
      if (pass !== (brush === 5 || brush === 6 ? 'summits' : tree ? 'forest' : 'ground')) continue;
      if (hash(gx, gy, seed ^ 9811) > cover * density) continue;
      if (brush === 5 || brush === 6 || brush === 7) {
        // Stable local priority suppresses competing summits; large overlapping
        // silhouettes form chains instead of a carpet of identical mountain icons.
        let crowded = false;
        for (let oy = -1; oy <= 1 && !crowded; oy++) for (let ox = -1; ox <= 1; ox++) {
          if ((!ox && !oy) || hash(gx + ox, gy + oy, seed) >= r) continue;
          const neighbour = sample(x + ox * step, y + oy * step);
          if (neighbour && !neighbour.water && (neighbour.height > 1850 || neighbour.slope > .36)) { crowded = true; break; }
        }
        if (crowded) continue;
      }
      const w = pitch * scale * size * (.85 + .3 * hash(gx, gy, seed ^ 319));
      // Peaks are exaggerated cartographically; their physical anchor footprint
      // stays local so a large silhouette does not erase coastal mountain ranges.
      const margin = (brush === 5 || brush === 6 ? Math.min(w, pitch * 2.8 * size) : w) * .36;
      if ([-1, 1].some(d => [-1, 1].some(e => { const edge = sample(x + d * margin, y + e * margin * .25); return !edge || edge.height <= 0 || edge.water || edge.occupied; }))) continue;
      result.push({ x, y, width: w, height: w * (brush >= 4 && brush <= 11 ? .78 : 1.15), brush, variant: Math.floor(hash(gx, gy, seed ^ 6317) * 8), flip: hash(gx, gy, seed ^ 97) > .5, opacity: brush === 15 ? .65 : 1 });
    }
  }
  // Ground anchors determine occlusion; mountains behind trees, rear stands behind front stands.
  result.sort((a, b) => a.y - b.y || a.x - b.x);
  if (result.length > budget) {
    // Uniform thinning within each category, never truncation to the north.
    // Preserve the relief hierarchy when woodland reaches the draw-call budget.
    const relief = result.filter(s => s.brush >= 4 && s.brush <= 8);
    const ground = result.filter(s => s.brush < 4 || s.brush > 8);
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
    const frame = brushFrame(library, s), h = s.width * frame.aspect;
    svg += `<use class="${s.brush >= 4 && s.brush <= 8 ? 'fantasy-relief' : 'fantasy-landuse'}" data-brush="${frame.family}" data-variant="${frame.index % 8}" href="#${id}-${frame.token}" x="${f(-s.width / 2)}" y="${f(-h * .95)}" width="${f(s.width)}" height="${f(h)}" opacity="${s.opacity}" transform="translate(${f(s.x)} ${f(s.y)}) scale(${s.flip ? -1 : 1} 1)"/>`;
  }
  return svg + '</g>';
}
function familyPaintingCanvas(ctx: CanvasRenderingContext2D, stamps: Stamp[], images: ReadonlyMap<string, CanvasImageSource>, library: BrushLibrary, camera: { x: number; y: number; scale: number }): void {
  ctx.save();
  for (const s of stamps) {
    const frame = brushFrame(library, s), image = images.get(frame.family); if (!image) continue;
    const [sx, sy, sw, sh] = frame.rect, w = s.width * camera.scale, h = w * frame.aspect;
    const x = (s.x - camera.x) * camera.scale, y = (s.y - camera.y) * camera.scale; ctx.globalAlpha = s.opacity;
    if (s.flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h * .95, w, h); ctx.restore(); }
    else ctx.drawImage(image, sx, sy, sw, sh, x - w / 2, y - h * .95, w, h);
  }
  ctx.restore();
}
