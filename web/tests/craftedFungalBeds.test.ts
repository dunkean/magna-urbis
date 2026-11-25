import { expect, it } from 'vitest';
import { FUNGUS_FORM as F } from '../src/render/fungusForms';
import { cavernField } from '../src/render/underdarkCavern';
import { FUNGUS_BED } from '../src/ui/forestOccupation';
import { buildFungi, FUNGUS_STRIDE, type FungusInputs } from '../src/ui/terrain3dFungi';

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
