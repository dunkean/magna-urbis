import { measureDisplayProduct, productKey } from './displayProduct';

const pyramids = new WeakMap<Float32Array, Map<string, Float32Array[]>>();
/** Immutable square FP32 grid, box-filtered exactly as the original heightPyramid.
 * Channels are interleaved; odd dimensions stop the chain rather than changing its filter. */
export function floatPyramid(data: Float32Array, n: number, channels = 1): Float32Array[] {
  let entries = pyramids.get(data);
  if (!entries) { entries = new Map(); pyramids.set(data, entries); }
  const key = productKey('box-f32', n, channels), retained = entries.get(key);
  if (retained) return retained;
  const levels = measureDisplayProduct('mips', () => {
    const out = [data];
    let size = n;
    while (size > 1 && size % 2 === 0) {
      const previous = out[out.length - 1], half = size / 2, next = new Float32Array(half * half * channels);
      for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) for (let c = 0; c < channels; c++) {
        const i = (2 * y * size + 2 * x) * channels + c;
        next[(y * half + x) * channels + c] = (previous[i] + previous[i + channels] + previous[i + size * channels] + previous[i + (size + 1) * channels]) * .25;
      }
      out.push(next); size = half;
    }
    return out;
  });
  entries.set(key, levels); return levels;
}
/** Worker replies omit level zero: preserve the live source array and avoid sending it back.
 * Never replace a synchronous fallback another renderer may already be reading. */
export function retainFloatPyramid(data: Float32Array, n: number, mips: readonly Float32Array[], channels = 1): void {
  let size = n, count = 0;
  while (size > 1 && size % 2 === 0) {
    size /= 2;
    if (mips[count]?.length !== size * size * channels) return;
    count++;
  }
  if (mips.length !== count) return;
  let entries = pyramids.get(data);
  if (!entries) { entries = new Map(); pyramids.set(data, entries); }
  const key = productKey('box-f32', n, channels);
  if (!entries.has(key)) entries.set(key, [data, ...mips]);
}
