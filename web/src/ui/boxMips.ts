/** Box-filtered mip chain of an 8-bit image (all layers), as glGenerateMipmap: 2D map and 3D view (forest rasters, brush atlas). */
export function boxMips(data: Uint8Array, width: number, height: number, channels: number, layers = 1): { data: Uint8Array; width: number; height: number }[] {
  const levels = [{ data, width, height }];
  while (width > 1 || height > 1) {
    const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), previous = levels[levels.length - 1].data, next = new Uint8Array(w * h * channels * layers);
    // Same samples and integer rounding as before, with row offsets hoisted (no per-component closure).
    for (let l = 0; l < layers; l++) for (let y = 0; y < h; y++) {
      const row0 = (l * height + Math.min(height - 1, 2 * y)) * width, row1 = (l * height + Math.min(height - 1, 2 * y + 1)) * width;
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(width - 1, 2 * x), x1 = Math.min(width - 1, 2 * x + 1);
        const a = (row0 + x0) * channels, b = (row0 + x1) * channels, d = (row1 + x0) * channels, e = (row1 + x1) * channels, o = ((l * h + y) * w + x) * channels;
        for (let c = 0; c < channels; c++) next[o + c] = (previous[a + c] + previous[b + c] + previous[d + c] + previous[e + c] + 2) >> 2;
      }
    }
    levels.push({ data: next, width: w, height: h }); width = w; height = h;
  }
  return levels;
}
const chains = new WeakMap<Uint8Array, Map<string, Uint8Array[]>>();
/** boxMips of an immutable raster (forest field, occupation), computed once: the 2D map and the 3D view upload the same
 * textures, and the chain cost hundreds of milliseconds on an average machine when each built its own. */
export function rasterMips(data: Uint8Array, width: number, height: number, channels: number): Uint8Array[] {
  let entries = chains.get(data);
  if (!entries) { entries = new Map(); chains.set(data, entries); }
  const key = `${width}x${height}x${channels}`;
  let levels = entries.get(key);
  if (!levels) { levels = boxMips(data, width, height, channels).map(level => level.data); entries.set(key, levels); }
  return levels;
}
