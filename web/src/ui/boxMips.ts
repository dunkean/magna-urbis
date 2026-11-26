/** Box-filtered mip chain of an 8-bit image (all layers), as glGenerateMipmap: 2D map and 3D view (forest rasters, brush atlas). */
export function boxMips(data: Uint8Array, width: number, height: number, channels: number, layers = 1): { data: Uint8Array; width: number; height: number }[] {
  const levels = [{ data, width, height }];
  while (width > 1 || height > 1) {
    const w = Math.max(1, width >> 1),
      h = Math.max(1, height >> 1),
      previous = levels[levels.length - 1].data,
      next = new Uint8Array(w * h * channels * layers);
    // Same samples and integer rounding as before, with row offsets hoisted (no per-component closure).
    for (let l = 0; l < layers; l++)
      for (let y = 0; y < h; y++) {
        const row0 = (l * height + Math.min(height - 1, 2 * y)) * width,
          row1 = (l * height + Math.min(height - 1, 2 * y + 1)) * width;
        for (let x = 0; x < w; x++) {
          const x0 = Math.min(width - 1, 2 * x),
            x1 = Math.min(width - 1, 2 * x + 1);
          const a = (row0 + x0) * channels,
            b = (row0 + x1) * channels,
            d = (row1 + x0) * channels,
            e = (row1 + x1) * channels,
            o = ((l * h + y) * w + x) * channels;
          for (let c = 0; c < channels; c++) next[o + c] = (previous[a + c] + previous[b + c] + previous[d + c] + previous[e + c] + 2) >> 2;
        }
      }
    levels.push({ data: next, width: w, height: h });
    width = w;
    height = h;
  }
  return levels;
}
const chains = new WeakMap<Uint8Array, Map<string, Uint8Array[]>>();
/** boxMips of an immutable raster (forest field, occupation), computed once: the 2D map and the 3D view upload the same
 * textures, and the chain cost hundreds of milliseconds on an average machine when each built its own. */
export function rasterMips(data: Uint8Array, width: number, height: number, channels: number): Uint8Array[] {
  let entries = chains.get(data);
  if (!entries) {
    entries = new Map();
    chains.set(data, entries);
  }
  const key = `${width}x${height}x${channels}`;
  let levels = entries.get(key);
  if (!levels) {
    levels = boxMips(data, width, height, channels).map(level => level.data);
    entries.set(key, levels);
  }
  return levels;
}
/** Texels `x..x+width-1` by `y..y+height-1` of one level. */
export interface MipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** rasterMips of `data`, a raster that differs from `previous` only inside `rects` (level-0 texels): the previous
 * chain copied, its levels box-filtered again only above those rectangles, and kept for `data` like rasterMips. Also
 * gives, per level, the rectangles that changed (to upload them alone). Same texels as boxMips of `data`. */
export function patchedRasterMips(previous: Uint8Array, data: Uint8Array, width: number, height: number, channels: number, rects: readonly MipRect[]): { levels: Uint8Array[]; changed: MipRect[][] } {
  const before = rasterMips(previous, width, height, channels),
    levels = [data, ...before.slice(1).map(level => level.slice())],
    changed: MipRect[][] = [rects.filter(r => r.width > 0 && r.height > 0)];
  let w = width,
    h = height;
  for (let level = 1; level < levels.length; level++) {
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1),
      source = levels[level - 1],
      target = levels[level],
      out: MipRect[] = [];
    for (const r of changed[level - 1]) {
      const x0 = Math.min(nw - 1, r.x >> 1),
        y0 = Math.min(nh - 1, r.y >> 1),
        x1 = Math.min(nw - 1, (r.x + r.width - 1) >> 1),
        y1 = Math.min(nh - 1, (r.y + r.height - 1) >> 1);
      for (let y = y0; y <= y1; y++) {
        const row0 = Math.min(h - 1, 2 * y) * w,
          row1 = Math.min(h - 1, 2 * y + 1) * w;
        for (let x = x0; x <= x1; x++) {
          const a = (row0 + Math.min(w - 1, 2 * x)) * channels,
            b = (row0 + Math.min(w - 1, 2 * x + 1)) * channels,
            d = (row1 + Math.min(w - 1, 2 * x)) * channels,
            e = (row1 + Math.min(w - 1, 2 * x + 1)) * channels,
            o = (y * nw + x) * channels;
          for (let c = 0; c < channels; c++) target[o + c] = (source[a + c] + source[b + c] + source[d + c] + source[e + c] + 2) >> 2;
        }
      }
      out.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
    }
    changed.push(out);
    w = nw;
    h = nh;
  }
  let entries = chains.get(data);
  if (!entries) chains.set(data, (entries = new Map()));
  entries.set(`${width}x${height}x${channels}`, levels);
  return { levels, changed };
}
