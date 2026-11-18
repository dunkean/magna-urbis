import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCityDisplayBuffers, decodeCitySiteVisuals, polygonRings, siteVisualsPackOf } from '../src/render/cityDisplayBuffers';

// Written by the Rust test `urban::display::tests::site_display_buffers_v2_split_programmes_and_drop_housing_need`.
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const load = (name: string): ArrayBuffer => {
  const b = readFileSync(fixture(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
describe('city site visuals', () => {
  const v1 = 'site-visuals-v1.bin',
    v2 = 'site-visuals-v2.bin';
  it.skipIf(!existsSync(fixture(v1)) || !existsSync(fixture(v2)))('decodes version 2 to version 1 without the housing need', () => {
    const old = decodeCitySiteVisuals(load(v1)),
      buffer = load(v2),
      sites = decodeCitySiteVisuals(buffer);
    expect(siteVisualsPackOf(sites)).toBe(buffer);
    expect(sites.length).toBe(2);
    expect(old[0].programme?.housing_floor_need).toEqual({ requested_m2: 99 });
    const { housing_floor_need: _need, ...display } = old[0].programme!;
    expect(sites[0].programme).toEqual(display);
    expect(Object.keys(sites[0].programme!)).toEqual(Object.keys(display));
    expect(sites[0].programme?.label).toBe('Fontaine Saint-Éloi');
    expect(sites[1].programme).toBeUndefined();
    expect(sites.map(({ programme: _p, ...rest }) => rest)).toEqual(old.map(({ programme: _p, ...rest }) => rest));
  });
});

// Blob written by `cargo run --example city_display` on the 01-l (100k) replay, when present.
const sample = 'out/city-replay/display-01l/display.bin';
describe('city display buffers', () => {
  it.skipIf(!existsSync(sample))('decodes the 100k plan without copies and keeps world coordinates', () => {
    const bytes = readFileSync(sample);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const d = decodeCityDisplayBuffers(buffer);
    const parcels = d.parcels.polys.length - 1,
      blocks = d.blocks.polys.length - 1;
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
