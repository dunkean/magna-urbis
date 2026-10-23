// Focused replay of real retained city parcels; no city regeneration or UI.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const server = option('server', 'http://127.0.0.1:8794');
const source = option('source', 'out/city-bench/b');
const out = option('out', '../_agents_blackboard/compact-refusals');
const decor = 'city-01-river-plain-s';
mkdirSync(out, { recursive: true });
const post = async (path, input) => {
  const response = await fetch(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = await response.json();
  if (!response.ok || body.ok === false || body.error) throw new Error(JSON.stringify(body.error ?? body).slice(0, 2000));
  return body.data ?? body;
};
let input;
if (option('request')) input = JSON.parse(readFileSync(option('request'), 'utf8'));
else {
  const module = await tsImport('../src/ui/decor.ts', import.meta.url);
  const { decodeDecor } = module.decodeDecor ? module : module.default;
  const raster = decodeDecor(new Uint8Array(readFileSync(`decors/${decor}.decor`))).raster;
  const session = randomUUID();
  const header = new TextEncoder().encode(JSON.stringify({ session, width: raster.width, n: raster.n }));
  const padded = new Uint8Array(Math.ceil(header.length / 4) * 4).fill(32); padded.set(header);
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
  const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const response = await fetch(`${server}/raster`, { method: 'POST', body: new Blob([length, padded, bytes(raster.height), bytes(raster.waterLevel), bytes(raster.riverWidth), bytes(raster.riverIds), bytes(raster.water)]) });
  if (!response.ok) throw new Error(`raster: ${await response.text()}`);
  const quarterRequest = JSON.parse(readFileSync(`${source}/${decor}-quarters-request.json`, 'utf8'));
  const sites = await post('/urban', { session, id: 15, kind: 'buildingSites', seed: quarterRequest.seed,
    layouts: [JSON.parse(readFileSync(`${source}/${decor}-layout.json`, 'utf8'))],
    partitions: [JSON.parse(readFileSync(`${source}/${decor}-partition.json`, 'utf8'))] });
  input = { schema_version: '1', requests: sites.placementRequests };
}
if (args.includes('--auto-recipes')) for (const request of input.requests) {
  if (['domestic', 'mixed'].includes(request.function)) request.config.recipe = null;
}
writeFileSync(`${out}/requests.json`, JSON.stringify(input));
const started = performance.now();
const result = await post('/houses/plans', input);
writeFileSync(`${out}/results.json`, JSON.stringify(result));
const counts = values => Object.fromEntries(Object.entries(values.reduce((out, v) => (out[v] = (out[v] ?? 0) + 1, out), {})).sort((a, b) => b[1] - a[1]));
const report = { server, source, ms: performance.now() - started, requests: input.requests.length,
  buildings: result.buildings.length, refused: result.refusals.length, openSpaces: result.open_spaces.length,
  requestedRecipes: counts(input.requests.map(r => r.config?.recipe ?? 'auto')),
  acceptedRecipes: counts(result.buildings.map(r => r.recipe_id)),
  functions: counts(input.requests.map(r => r.function)),
  reasons: counts(result.refusals.map(r => r.message ?? r.reason ?? JSON.stringify(r))) };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
