import { expect, it } from 'vitest';
import { FUNGUS_FORM as F, FUNGUS_PROFILES } from '../src/render/fungusForms';
import { cavernField } from '../src/render/underdarkCavern';
import { FUNGUS_BED } from '../src/ui/forestOccupation';
import { buildFungi, FUNGUS_STRIDE, type FungusInputs } from '../src/ui/terrain3dFungi';

it('keeps the full footprint of mushrooms, stalactites and stalagmites inside the map', () => {
  const n = 24,
    x = -160,
    y = 75,
    width = 420;
  const cavern = cavernField({ n, x, y, width, data: new Float32Array(n * n), cave: new Uint8Array(n * n) }, 40)!;
  const { values } = buildFungi({ cavern, seed: 82, abundance: 2, raw: () => 0, height: () => 0, water: () => 0 }, { x: x + 10, y: y + 10 });

  const kinds = new Set<string>();
  for (let i = 0; i < values.length; i += FUNGUS_STRIDE) {
    const [px, py, , cap, height, stem, form] = values.subarray(i, i + FUNGUS_STRIDE);
    const radius = Math.max(...FUNGUS_PROFILES[form].map(([a, b]) => a * stem + b * cap));
    const lean = form <= F.funnel || form === F.bracket ? 0.1 * cap : 0;
    expect(Math.min(px - x, py - y, x + width - px, y + width - py)).toBeGreaterThanOrEqual(radius + lean);
    kinds.add(form !== F.stalactite ? 'mushroom' : height < 0 ? 'stalagmite' : 'stalactite');
  }
  expect(kinds).toEqual(new Set(['mushroom', 'stalactite', 'stalagmite']));
});

it('grows unlit shelf clusters only on dry cultivated ground in the detailed appearance', () => {
  const n = 32,
    width = 64;
  const cavern = cavernField({ n, width, x: 0, y: 0, data: new Float32Array(n * n), cave: new Uint8Array(n * n) }, 40)!;
  const rgba = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n / 2; x++) rgba[(y * n + x) * 4 + 2] = FUNGUS_BED;
  const inputs: FungusInputs = {
    cavern,
    seed: 82,
    abundance: 1,
    raw: () => 0,
    water: (_x, y) => (y < 16 ? 1 : 0),
    height: (x, y) => (x >= 0 && y >= 0 && x < width && y < width ? 0 : undefined),
    occupation: { n, width, x: 0, y: 0, rgba, key: 'garden' },
    towns: Float32Array.of(32, 32, 1800),
  };
  const view = { x: 22, y: 32 };
  const ground = (v: Float32Array, i: number) => v[i + 2] < 1 && v[i + 2] >= -0.04;
  const standard = buildFungi(inputs, view).values;
  for (let i = 0; i < standard.length; i += FUNGUS_STRIDE) expect(ground(standard, i)).toBe(false);
  const { values } = buildFungi({ ...inputs, craftedBeds: true }, view);
  const forms = new Set<number>();
  for (let i = 0; i < values.length; i += FUNGUS_STRIDE) {
    if (!ground(values, i)) continue;
    forms.add(values[i + 6]);
    expect(values[i]).toBeLessThan(32);
    expect(values[i + 1]).toBeGreaterThanOrEqual(15.92);
    expect(values[i + 11]).toBe(0);
  }
  expect(forms).toEqual(new Set([F.dome, F.bracket, F.puffball]));
});
