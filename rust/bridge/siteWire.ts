// Wire format of the Rust site choice (framed binary, see rust/crates/core/src/site.rs). Pure: no WASM import.
import type { Options } from '../../web/src/gen/options';
import { SITE_ARCHETYPES } from '../../web/src/gen/options';
import type { SiteArchetype, SiteLayer, TerrainLayer } from '../../web/src/gen/types';
import type { Rng } from '../../web/src/gen/core/rng';

/** Request body: u32 header length, JSON header (padded to 4), then height f32, slope f32, water u8, river points f64, widths f64. */
export function encodeSiteRequest(terrain: TerrainLayer, opts: Options, mapSize: number, root: Rng, displayOnly = false): Uint8Array<ArrayBuffer> {
  const { w: n, cell } = terrain.height;
  const rivers = terrain.rivers;
  const header = {
    ...(displayOnly ? { displayOnly } : {}), seedKey: root.seedKey, n, cell, mapSize, seaFraction: terrain.seaFraction,
    size: opts.size, relief: opts.relief, siteType: opts.siteType ?? null, center: opts.center ?? null, sitePrefs: opts.sitePrefs ?? null,
    rivers: rivers.map(r => ({ len: r.path.length, wlen: r.width.length, main: !!r.main, mouth: r.mouth ?? null, id: r.id ?? null, host: r.host ?? null })),
  };
  const text = new TextEncoder().encode(JSON.stringify(header));
  const padded = Math.ceil(text.length / 4) * 4;
  const total = n * n;
  let np = 0, nw = 0;
  for (const r of rivers) { np += r.path.length; nw += r.width.length; }
  const out = new Uint8Array(4 + padded + total * 9 + np * 16 + nw * 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, padded, true);
  out.fill(32, 4 + text.length, 4 + padded); out.set(text, 4);
  let off = 4 + padded;
  const f32 = (a: Float32Array) => { out.set(new Uint8Array(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength), off); off += a.byteLength; };
  f32(terrain.height.data); f32(terrain.slope.data);
  out.set(terrain.water, off); off += total;
  for (const r of rivers) for (const p of r.path) { view.setFloat64(off, p.x, true); view.setFloat64(off + 8, p.y, true); off += 16; }
  for (const r of rivers) for (const v of r.width) { view.setFloat64(off, v, true); off += 8; }
  return out;
}

interface SiteHeader {
  center: { x: number; y: number }; crossing: { x: number; y: number } | null; harbor: { x: number; y: number } | null;
  citadelSpot: { x: number; y: number } | null; archetype: SiteArchetype; feature: { x: number; y: number } | null;
  offers: [SiteArchetype, number][]; reserveRadius: number; warning: string | null;
}

/** `displayOnly`: the reply holds dWater and hab only; the other fields are empty and `cost` has no data. */
export function decodeSiteReply(bytes: Uint8Array, n: number, cell: number, displayOnly = false): SiteLayer {
  const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hl))) as SiteHeader;
  const total = n * n;
  let off = bytes.byteOffset + 4 + hl;
  const f32 = () => { const a = new Float32Array(bytes.buffer.slice(off, off + total * 4)); off += total * 4; return a; };
  const none = new Float32Array(0), u8none = new Uint8Array(0);
  const dWater = f32(), dSea = displayOnly ? none : f32(), dMain = displayOnly ? none : f32(), hab = f32();
  const slopeS = displayOnly ? none : f32(), cost = displayOnly ? none : f32();
  const u8 = () => { const a = new Uint8Array(bytes.buffer.slice(off, off + total)); off += total; return a; };
  const riverMask = displayOnly ? u8none : u8(), bridgeZone = displayOnly ? u8none : u8(), wide = displayOnly ? u8none : u8();
  const offers: SiteLayer['offers'] = {};
  for (const a of SITE_ARCHETYPES) { const hit = h.offers.find(o => o[0] === a); if (hit) offers[a] = hit[1]; }
  return {
    center: h.center, ...(h.crossing ? { crossing: h.crossing } : {}), ...(h.harbor ? { harbor: h.harbor } : {}),
    ...(h.citadelSpot ? { citadelSpot: h.citadelSpot } : {}), archetype: h.archetype, feature: h.feature ?? undefined, offers,
    cost: { w: n, h: n, cell, data: cost }, reserveRadius: h.reserveRadius,
    fields: { dWater, dSea, dMain, hab, slopeS, riverMask, bridgeZone, wide },
    ...(h.warning ? { warning: h.warning } : {}),
  };
}

