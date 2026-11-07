import './vectorWaterWasm';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { conditionRelief } from '../../rust/bridge/waterNative';
import type { ConditioningSettings } from '../src/ui/reliefConditioning';
const directory = new URL('../../rust/crates/terrain/tests/fixtures/vector-water/', import.meta.url);
describe('Rust conditioning bridge', () => {
  it('reconstructs the TS golden height and hydrology and preserves stats:false heights', async () => {
    const bytes = readFileSync(new URL('height.f32', directory));
    const height = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const fixture = JSON.parse(readFileSync(new URL('humid.json', directory), 'utf8'));
    const settings = fixture.conditioning as ConditioningSettings;
    const result = await conditionRelief(height, 64, 6400, settings);
    const fast = await conditionRelief(height, 64, 6400, settings, { stats: false });
    const wantBytes = readFileSync(new URL('conditioned.f32', directory));
    const want = new Float32Array(wantBytes.buffer.slice(wantBytes.byteOffset, wantBytes.byteOffset + wantBytes.byteLength));
    expect(result.height).toEqual(fast.height);
    expect(result.hydrology.receiver.length).toBe(64 * 64);
    expect(fast.hydrology).toBeUndefined();
    expect(Math.max(...result.height.map((h, i) => Math.abs(h - want[i])))).toBeLessThan(0.0002);
  });
});
