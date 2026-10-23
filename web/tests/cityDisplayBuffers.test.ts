import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCityDisplayBuffers, polygonRings } from '../src/render/cityDisplayBuffers';

// Blob written by `cargo run --example city_display` on the 01-l (100k) replay, when present.
const sample = 'out/city-replay/display-01l/display.bin';
describe('city display buffers', () => {
  it.skipIf(!existsSync(sample))('decodes the 100k plan without copies and keeps world coordinates', () => {
    const bytes = readFileSync(sample);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const d = decodeCityDisplayBuffers(buffer);
    const parcels = d.parcels.polys.length - 1, blocks = d.blocks.polys.length - 1;
    expect(parcels).toBeGreaterThan(10000);
    expect(blocks).toBeGreaterThan(1000);
    expect(d.parcels.use.length).toBe(parcels);
    expect(d.parcels.coords.buffer).toBe(buffer);
    const ring = polygonRings(d.parcels, 0, d.origin)[0];
    expect(ring.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(ring[0].x - d.origin.x)).toBeLessThan(8000);
    expect(d.tables.use[0]).toBe('');
  });
});
