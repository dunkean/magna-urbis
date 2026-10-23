// From web/: node scripts/city_replay.mjs --decor city-04-mountain-bay-s --request out/.../x-quarters-request.json
//   [--server http://127.0.0.1:8791] [--out out/city-replay] [--svg minX,minY,maxX,maxY] [--plans]
// --sites writes the building-site requests (with `preview` footprints) for city_metrics.mjs.
// --plans also requests the building sites and the native compact plans (/houses/plans),
// and writes both with the refusal reasons, for house-side review.
// Replays a captured City Bench quarters request (sites, roads, configs) on a native
// Rust engine, then the parcels stage, without the browser UI. Writes the layout,
// the partition and an SVG of blocks, parcels and streets for the chosen window.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const server = option('server', 'http://127.0.0.1:8791'), out = option('out', 'out/city-replay');
const decorId = option('decor'), request = JSON.parse(readFileSync(option('request'), 'utf8'));
mkdirSync(out, { recursive: true });
const m = await tsImport('../src/ui/decor.ts', import.meta.url);
const { decodeDecor } = m.decodeDecor ? m : m.default;
const r = decodeDecor(new Uint8Array(readFileSync(`decors/${decorId}.decor`))).raster;
const session = randomUUID();
const header = new TextEncoder().encode(JSON.stringify({ session, width: r.width, n: r.n }));
const padded = new Uint8Array(Math.ceil(header.length / 4) * 4).fill(32); padded.set(header);
const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
let response = await fetch(`${server}/raster`, { method: 'POST', body: new Blob([length, padded, bytes(r.height), bytes(r.waterLevel), bytes(r.riverWidth), bytes(r.riverIds), bytes(r.water)]) });
if (!response.ok) throw new Error(`raster: ${await response.text()}`);
const post = async (input) => {
  const res = await fetch(`${server}/urban`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, session }) });
  const body = await res.json(); if (!res.ok || body.ok === false || body.error) throw new Error(JSON.stringify(body.error ?? body).slice(0, 2000));
  return body.data ?? body;
};
let t = performance.now();
const { layouts } = await post({ ...request, kind: 'quarters' });
const quartersMs = performance.now() - t; t = performance.now();
const { partitions } = await post({ id: 2, seed: request.seed, runtime: request.runtime, kind: 'parcels', layouts, parcelConfig: request.parcelConfig ?? {} });
const parcelsMs = performance.now() - t;
const layout = layouts[0], partition = partitions[0];
if (args.includes('--sites') && !args.includes('--plans')) {
  const { placementRequests } = await post({ id: 3, seed: request.seed, kind: 'buildingSites', layouts, partitions });
  writeFileSync(`${out}/${decorId}-placement-requests.json`, JSON.stringify(placementRequests));
}
if (args.includes('--plans')) {
  const status = await (await fetch(`${server}/status`)).json();
  const { placementRequests } = await post({ id: 3, seed: request.seed, kind: 'buildingSites', layouts, partitions });
  t = performance.now();
  const res = await fetch(`${server}/houses/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schema_version: '1', requests: placementRequests }) });
  const scene = await res.json(), plansMs = performance.now() - t, data = scene.data ?? scene;
  writeFileSync(`${out}/${decorId}-placement-requests.json`, JSON.stringify(placementRequests));
  writeFileSync(`${out}/${decorId}-plans.json`, JSON.stringify(data));
  const reasons = {}; for (const r of data.refusals ?? []) { const k = String(r.message ?? r.reason ?? '').replace(/[0-9.]+/g, '#').slice(0, 140); reasons[k] = (reasons[k] ?? 0) + 1; }
  console.log(JSON.stringify({ server, status: { version: status.version, capabilities: status.capabilities?.length }, requests: placementRequests.length, accepted: data.buildings?.length, refused: data.refusals?.length, plansMs: Math.round(plansMs), reasons }, null, 1));
}
writeFileSync(`${out}/${decorId}-layout.json`, JSON.stringify(layout));
writeFileSync(`${out}/${decorId}-partition.json`, JSON.stringify(partition));
const uses = {}; for (const p of partition.parcels) uses[p.use] = (uses[p.use] ?? 0) + 1;
console.log(JSON.stringify({ quartersMs: Math.round(quartersMs), parcelsMs: Math.round(parcelsMs), blocks: layout.blocks.length, streets: layout.streets.length, parcels: partition.parcels.length, uses, diagnostics: partition.diagnostics, warnings: [...new Set([...layout.warnings, ...partition.warnings])].slice(0, 12) }, null, 1));

// SVG: blocks by zone, parcels by use, streets by rank.
const box = option('svg', '')?.split(',').map(Number);
const all = layout.blocks.flatMap(b => b.shape.outer);
const [x0, y0, x1, y1] = box?.length === 4 ? box : [Math.min(...all.map(p => p.x)), Math.min(...all.map(p => p.y)), Math.max(...all.map(p => p.x)), Math.max(...all.map(p => p.y))];
const ring = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z';
const shape = s => ring(s.outer) + (s.holes ?? []).map(ring).join('');
const inBox = s => s.outer.some(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
const useColour = { plot: '#e9c98f', compound: '#d9a66b', court: '#c9b27a', residual: '#f2a0a0', field: '#b7d39a', garden: '#9fc98a', place: '#ddd', reserve: '#cfc' };
const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="1600" height="${Math.round(1600 * (y1 - y0) / (x1 - x0))}" style="background:#f4f1e6">`,
  ...layout.blocks.filter(b => inBox(b.shape)).map(b => `<path d="${shape(b.shape)}" fill="#e8e0cc" stroke="#7a6a50" stroke-width="${(x1 - x0) / 1600}" fill-rule="evenodd"/>`),
  ...partition.parcels.filter(p => inBox(p.shape)).map(p => `<path d="${shape(p.shape)}" fill="${useColour[p.use] ?? '#bbb'}" stroke="#5a4a30" stroke-width="${(x1 - x0) / 2400}" fill-rule="evenodd"><title>${p.use}/${p.family} ${p.reason ?? ''}</title></path>`),
  ...layout.streets.map(s => `<polyline points="${s.path.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${s.role === 'regional' ? '#a33' : s.rank <= 1 ? '#555' : '#888'}" stroke-width="${Math.max(s.widths[0] ?? 3, (x1 - x0) / 800)}" stroke-linecap="round" opacity="0.8"/>`),
  '</svg>'].join('\n');
writeFileSync(`${out}/${decorId}.svg`, svg);
const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: Math.round(1600 * (y1 - y0) / (x1 - x0)) } });
await page.setContent(svg); await page.screenshot({ path: `${out}/${decorId}.png` }); await browser.close();
console.log(`${out}/${decorId}.png`);
