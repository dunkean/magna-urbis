import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { conditionRelief, setErodeKernel } from '../src/ui/reliefConditioning';
import { setFloodKernel } from '../src/ui/simpleHydrology';

// The compiled kernels (Rust flood + stream-power erosion in WASM) must reproduce the TypeScript
// conditioning bit for bit. Needs the built package (npm run wasm:terrain:release).
const wasm = fileURLToPath(new URL('../../rust/pkg/wasm/magna_urbis_wasm_bg.wasm', import.meta.url));
const n = 256, width = 5000, cell = width / n;
const hash = (x: number, y: number): number => {
  let v = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  v ^= v >>> 13;
  return (Math.imul(v, 1103515245) >>> 0) / 4294967296;
};
const relief = new Float32Array(n * n);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const r = Math.hypot(x - 150, y - 128) * cell;
  relief[y * n + x] = x < 12 ? -5 : 30 + 0.004 * x * cell - 25 * Math.exp(-((r / 900) ** 2)) + 3 * (hash(x >> 1, y >> 1) - 0.5) + 8 * Math.sin(x / 9) * Math.cos(y / 13);
}

describe.skipIf(!existsSync(wasm))('compiled relief conditioning', () => {
  it('Rust erode_relief + flood_hydrology equal the TypeScript conditioning', async () => {
    const settings = { strength: 2, maxDepth: 30, maxLength: 3000 };
    const expected = (['erosion', 'both'] as const).map(mode => conditionRelief(relief, n, width, { ...settings, mode }).height);
    const pkg = await import('../../rust/pkg/wasm/magna_urbis_wasm.js') as unknown as {
      initSync(options: { module: BufferSource }): unknown;
      flood_hydrology: Parameters<typeof setFloodKernel>[0]; erode_relief: Parameters<typeof setErodeKernel>[0];
    };
    pkg.initSync({ module: readFileSync(wasm) });
    setFloodKernel(pkg.flood_hydrology); setErodeKernel(pkg.erode_relief);
    try {
      (['erosion', 'both'] as const).forEach((mode, k) => {
        const compiled = conditionRelief(relief, n, width, { ...settings, mode }).height;
        let mismatches = 0;
        for (let c = 0; c < n * n; c++) if (compiled[c] !== expected[k][c]) mismatches++;
        expect(mismatches).toBe(0);
      });
    } finally { setFloodKernel(undefined); setErodeKernel(undefined); }
  });
});
