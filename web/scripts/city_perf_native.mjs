// From web/: node scripts/city_perf_native.mjs --decor city-01-river-plain-l --request out/.../x-quarters-request.json
//   [--server http://127.0.0.1:8790] [--out out/city-perf] [--plans] [--scale 1]
// Measures the native city chain without the UI: server time (`ms` in the reply),
// wall time, request/response bytes, JSON.parse and structuredClone (≈ worker →
// main postMessage) of each reply, then the browser-side scene index
// (buildCityScene / buildCityBuildings of web/src/render/cityCanvas.ts) in Node V8.
// --scale N tiles the layout and partition N times (synthetic N×city) for the
// client-side measurements only (the native engine is not asked for a bigger city).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';
import http from 'node:http';
// node:http without timeouts: a 1M-inhabitant plan exceeds fetch's 300 s header timeout.
const httpPost = (url, body) => new Promise((ok, fail) => {
  const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => ok({ ok: res.statusCode < 300, text: Buffer.concat(chunks).toString('utf8') })); res.on('error', fail);
  });
  req.setTimeout(0); req.on('error', fail); req.end(body);
});

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const server = option('server', 'http://127.0.0.1:8790'), out = option('out', 'out/city-perf');
const decorId = option('decor'), request = JSON.parse(readFileSync(option('request'), 'utf8'));
const scale = Number(option('scale', '1'));
mkdirSync(out, { recursive: true });
const m = await tsImport('../src/ui/decor.ts', import.meta.url);
const { decodeDecor } = m.decodeDecor ? m : m.default;
const r = decodeDecor(new Uint8Array(readFileSync(`decors/${decorId}.decor`))).raster;
const session = randomUUID();
const header = new TextEncoder().encode(JSON.stringify({ session, width: r.width, n: r.n }));
const padded = new Uint8Array(Math.ceil(header.length / 4) * 4).fill(32); padded.set(header);
const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
let t = performance.now();
const rasterBody = new Blob([length, padded, bytes(r.height), bytes(r.waterLevel), bytes(r.riverWidth), bytes(r.riverIds), bytes(r.water)]);
let response = await fetch(`${server}/raster`, { method: 'POST', body: rasterBody });
if (!response.ok) throw new Error(`raster: ${await response.text()}`);
const report = { decor: decorId, server, population: request.sites?.map(s => s.population), stages: [] };
report.stages.push({ stage: 'raster upload', ms: performance.now() - t, requestBytes: rasterBody.size });

const ms = v => Math.round(v * 10) / 10;
async function stage(name, path, input) {
  const body = JSON.stringify(path === '/urban' ? { ...input, session } : input);
  const t0 = performance.now();
  const res = await httpPost(`${server}${path}`, body);
  const text = res.text; const wall = performance.now() - t0;
  const p0 = performance.now(); const parsed = JSON.parse(text); const parseMs = performance.now() - p0;
  if (!res.ok || parsed.ok === false || parsed.error) throw new Error(`${name}: ${JSON.stringify(parsed.error ?? parsed).slice(0, 800)}`);
  const data = parsed.data ?? parsed;
  const c0 = performance.now(); structuredClone(data); const cloneMs = performance.now() - c0;
  const s0 = performance.now(); JSON.stringify(data); const stringifyMs = performance.now() - s0;
  const row = { stage: name, serverMs: data.ms === undefined ? undefined : ms(data.ms), wallMs: ms(wall), requestBytes: body.length, responseBytes: text.length,
    parseMs: ms(parseMs), cloneMs: ms(cloneMs), stringifyMs: ms(stringifyMs) };
  report.stages.push(row); console.log(JSON.stringify(row));
  return data;
}
const { layouts } = await stage('quarters', '/urban', { ...request, kind: 'quarters' });
// The UI sends layoutsId (retained by the engine) when the plan is unchanged.
const { partitions } = await stage('parcels (layoutsId)', '/urban', { id: 2, seed: request.seed, runtime: request.runtime, kind: 'parcels', layoutsId: request.id ?? 1, parcelConfig: request.parcelConfig ?? {} })
  .catch(async error => { console.warn(String(error).slice(0, 200)); return stage('parcels (full layouts)', '/urban', { id: 2, seed: request.seed, runtime: request.runtime, kind: 'parcels', layouts, parcelConfig: request.parcelConfig ?? {} }); });
const { placementRequests } = await stage('buildingSites', '/urban', { id: 3, seed: request.seed, kind: 'buildingSites', layouts, partitions });
let plans;
if (args.includes('--plans')) plans = await stage('houses/plans (compact)', '/houses/plans', { schema_version: '1', requests: placementRequests });

const layout = layouts[0], partition = partitions[0];
const count = (shapes) => shapes.reduce((n, s) => n + s.outer.length + (s.holes ?? []).reduce((k, h) => k + h.length, 0), 0);
report.counts = {
  blocks: layout.blocks.length, blockVertices: count(layout.blocks.map(b => b.shape)),
  streets: layout.streets.length, streetVertices: layout.streets.reduce((n, s) => n + s.path.length, 0),
  parcels: partition.parcels.length, parcelVertices: count(partition.parcels.map(p => p.shape)),
  allocations: partition.programme?.allocations?.length,
  placementRequests: placementRequests.length,
  previewVertices: placementRequests.reduce((n, q) => n + (q.preview ? count(Array.isArray(q.preview) ? q.preview : [q.preview]) : 0), 0),
  plansAccepted: plans?.buildings?.length, plansRefused: plans?.refusals?.length,
};
console.log(JSON.stringify(report.counts));
writeFileSync(`${out}/${decorId}-layout.json`, JSON.stringify(layout));
writeFileSync(`${out}/${decorId}-partition.json`, JSON.stringify(partition));
writeFileSync(`${out}/${decorId}-placement-requests.json`, JSON.stringify(placementRequests));
if (plans) writeFileSync(`${out}/${decorId}-plans.json`, JSON.stringify(plans));

// Client side: scene index and silhouettes in Node V8 (same engine as Chrome; no Canvas).
const cc = await tsImport('../src/render/cityCanvas.ts', import.meta.url);
const { buildCityScene, buildCityBuildings } = cc.buildCityScene ? cc : cc.default;
const sil = await tsImport('../src/ui/urbanSilhouettes.ts', import.meta.url);
const { silhouetteScene } = sil.silhouetteScene ? sil : sil.default;
const tile = (n) => {
  if (n <= 1) return { layouts, partitions, placementRequests };
  // n copies side by side (offset by the city extent); keys differ so partitions pair with layouts.
  const pts = layout.blocks.flatMap(b => b.shape.outer); const w = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)) + 200;
  const side = Math.ceil(Math.sqrt(n)), L = [], P = [], Q = [];
  const move = (v, dx, dy) => JSON.parse(JSON.stringify(v), (k, x) => x && typeof x === 'object' && typeof x.x === 'number' && typeof x.y === 'number' && Object.keys(x).length === 2 ? { x: x.x + dx, y: x.y + dy } : x);
  for (let i = 0; i < n; i++) {
    const dx = (i % side) * w, dy = Math.floor(i / side) * w, key = `${layout.key}#${i}`;
    L.push({ ...move(layout, dx, dy), key }); P.push({ ...move(partition, dx, dy), key });
    Q.push(...move(placementRequests, dx, dy).map(q => ({ ...q, id: `${q.id}#${i}`, parcel_id: `${q.parcel_id}#${i}` })));
  }
  return { layouts: L, partitions: P, placementRequests: Q };
};
const T = tile(scale);
let s0 = performance.now(); const scene = buildCityScene(T.layouts, T.partitions); const sceneMs = performance.now() - s0;
s0 = performance.now(); const silhouettes = silhouetteScene(T.placementRequests); const silhouetteMs = performance.now() - s0;
s0 = performance.now(); const built = buildCityBuildings(silhouettes, scene); const buildingsMs = performance.now() - s0;
s0 = performance.now(); structuredClone(silhouettes); const silCloneMs = performance.now() - s0;
const silBytes = JSON.stringify(silhouettes).length;
report.client = { scale, blocks: scene.blocks.length, parcels: scene.parcels.length, streets: scene.streets.length, buildings: built.items.length,
  buildCitySceneMs: ms(sceneMs), silhouetteSceneMs: ms(silhouetteMs), buildCityBuildingsMs: ms(buildingsMs), silhouetteCloneMs: ms(silCloneMs), silhouetteJsonBytes: silBytes,
  heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576) };
console.log(JSON.stringify(report.client));
writeFileSync(`${out}/${decorId}-native${scale > 1 ? `-x${scale}` : ''}.json`, JSON.stringify(report, null, 1));
