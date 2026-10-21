// From web/: node scripts/urban_occupation_native_check.mjs EXE [--population 50000] [--placements]
// Private process/port. The default replays exact retained medina streets/blocks;
// --population instead measures a complete population-budgeted native settlement.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const executable = args[0];
assert.ok(executable, 'Pass the current native release executable');
const executableSha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
const population = args.includes('--population') ? Number(args[args.indexOf('--population') + 1]) : undefined;
const role = args.includes('--role') ? args[args.indexOf('--role') + 1] : 'crossroads';
assert.ok(population === undefined || Number.isSafeInteger(population) && population > 0);
const placements = args.includes('--placements');
const reference = population === undefined ? JSON.parse(readFileSync('out/urban-buildings/courtyard.inputs.json', 'utf8')) : undefined;
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn(executable, ['--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stderr.on('data', b => { logs += b; });
const session = `occupation-${population ?? 'medina'}`;
let id = 0;
const timings = {};
async function post(path, input) {
  const start = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(240000),
  });
  assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  const output = await response.json();
  assert.notEqual(output.ok, false, JSON.stringify(output.error));
  timings[input.kind ?? path] = Math.round(performance.now() - start);
  return output.data ?? output;
}
const seed = 'urban-buildings-review-v1';
const urban = (kind, input) => post('/urban', { session, id: ++id, seed, kind, ...input });
function ringArea(ring) { return Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - p.y * q.x; }, 0)) * 0.5; }
function area(shape) { return ringArea(shape.outer) - shape.holes.reduce((sum, h) => sum + ringArea(h), 0); }
function describe(partitions, layouts, scene) {
  const reasons = {}, zones = {}, radial = {};
  const buildings = new Map((scene?.buildings ?? []).map(b => [b.parcel_id, b]));
  const refused = new Set((scene?.refusals ?? []).map(r => r.parcel_id));
  for (const partition of partitions) {
    const layout = layouts.find(l => l.key === partition.key);
    const allocations = new Set(partition.programme?.allocations.map(a => a.parcelId));
    const land = partition.parcels.reduce((n, p) => n + area(p.shape), 0), radius = Math.sqrt(land / Math.PI);
    for (const p of partition.parcels) {
      // Vertex mean is only a diagnostic station; it never drives admission.
      const center = p.shape.outer.reduce((a, b) => ({ x: a.x + b.x / p.shape.outer.length, y: a.y + b.y / p.shape.outer.length }), { x: 0, y: 0 });
      const r = Math.hypot(center.x - layout.center.x, center.y - layout.center.y) / radius;
      for (const [groups, key] of [[zones, layout.blocks[p.block].zone], [radial, r < .33 ? 'inner-third' : r < .66 ? 'middle-third' : 'outer']]) {
        const group = groups[key] ??= { parcels: 0, landM2: 0, allocated: 0, accepted: 0, refused: 0, footprintM2: 0 };
        group.parcels++; group.landM2 += area(p.shape); group.allocated += Number(allocations.has(p.id));
        group.accepted += Number(buildings.has(p.id)); group.refused += Number(refused.has(p.id));
        group.footprintM2 += buildings.get(p.id)?.footprint.reduce((n, s) => n + area(s), 0) ?? 0;
      }
    }
  }
  for (const p of partitions.flatMap(p => p.parcels)) {
    const value = reasons[p.reason] ??= { count: 0, areaM2: 0 }; value.count++; value.areaM2 += area(p.shape);
  }
  return { parcels: partitions.reduce((n, p) => n + p.parcels.length, 0), landM2: partitions.flatMap(p => p.parcels).reduce((n, p) => n + area(p.shape), 0), reasons,
    allocations: partitions.flatMap(p => p.programme?.allocations ?? []).length,
    demands: partitions.flatMap(p => p.programme?.demands ?? []).map(d => ({ function: d.function, requested: d.requested, parcelCapacity: d.parcelCapacity, builtCapacity: d.builtCapacity, openCapacity: d.openCapacity, deficit: d.deficit })), zones, radial };
}
function proofSvg(layouts, partitions, scene) {
  const points = partitions.flatMap(p => p.parcels.flatMap(p => p.shape.outer));
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  const width = Math.max(...points.map(p => p.x)) - x, height = Math.max(...points.map(p => p.y)) - y;
  const path = shape => [shape.outer, ...shape.holes].map(r => `M${r.map(p => `${p.x},${p.y}`).join('L')}Z`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000" viewBox="${x - 8} ${y - 8} ${width + 16} ${height + 16}"><rect x="${x - 8}" y="${y - 8}" width="${width + 16}" height="${height + 16}" fill="#eee9dc"/>`
    + partitions.flatMap(p => p.parcels.map(p => `<path d="${path(p.shape)}" fill="${p.use === 'residual' ? '#dfac7b' : p.use === 'garden' ? '#b8c6a2' : '#d9d2c1'}" stroke="#9a927f" stroke-width=".15" fill-rule="evenodd"/>`)).join('')
    + layouts.flatMap(l => l.streets.map(s => `<path d="M${s.path.map(p => `${p.x},${p.y}`).join('L')}" fill="none" stroke="#faf5e8" stroke-width="${Math.max(...s.widths)}"/>`)).join('')
    + (scene?.buildings ?? []).flatMap(b => b.footprint.map(s => `<path d="${path(s)}" fill="#775a46" stroke="#382f26" stroke-width=".12" fill-rule="evenodd"/>`)).join('') + '</svg>';
}
try {
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    const timer = setTimeout(() => reject(new Error(`Native startup timeout: ${logs}`)), 30000);
    child.stdout.on('data', b => { logs += b; if (logs.includes('"ready":true')) { clearTimeout(timer); resolve(); } });
  });
  const n = reference?.surface.n ?? 128;
  const width = reference?.surface.width ?? Math.max(3000, 6 * Math.sqrt(population * 10000 / 70 / Math.PI));
  let header = Buffer.from(JSON.stringify({ session, n, width }));
  header = Buffer.concat([header, Buffer.alloc((4 - header.length % 4) % 4, 32)]);
  const bytes = Buffer.alloc(4 + header.length + 17 * n * n); bytes.writeUInt32LE(header.length); header.copy(bytes, 4);
  const start = 4 + header.length, count = n * n;
  for (let i = 0; i < count; i++) {
    bytes.writeFloatLE(reference?.surface.height[i] ?? 20, start + i * 4);
    bytes.writeInt32LE(-1, start + count * 12 + i * 4);
  }
  const upload = await fetch(`http://127.0.0.1:${port}/raster`, { method: 'POST', body: bytes }); assert.ok(upload.ok);
  let layouts = reference?.layouts;
  if (!layouts) ({ layouts } = await urban('quarters', {
    sites: [{ key: 'native-metropolis', name: 'Native metropolis', population, culture: 'european-organic', center: { x: width * .5, y: width * .5 }, radius: 160 }], roads: [],
    layoutConfig: { composition: 'settlement', count: 12, fortification: 'none', programme: { role }, footprint: { mechanism: 'accessibility', budget: 'population' } },
  }));
  if (args.includes('--quarters-only')) {
    const report = { executable, executableSha256, seed, population, role, width, timings, stage: 'quarters-only',
      structure: layouts.map(l => l.structure?.metrics), blocks: layouts.reduce((n, l) => n + l.blocks.length, 0),
      streets: layouts.reduce((n, l) => n + l.streets.length, 0),
      reservations: layouts.flatMap(l => l.programme.reservations),
      demands: layouts.flatMap(l => l.programme.demands).map(d => ({function:d.function,requested:d.requested,reasons:d.reasons})) };
    const directory = `out/urban-occupation/${population}-quarters`; mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({...report,reservations:report.reservations.length}, null, 2));
    process.exitCode = 0;
  } else {
  let { partitions } = await urban('parcels', { layouts, parcelConfig: reference?.parcelConfig ?? {} });
  const { placementRequests } = await urban('buildingSites', { layouts, partitions });
  const recipes = {};
  for (const r of placementRequests) recipes[r.config.recipe] = (recipes[r.config.recipe] ?? 0) + 1;
  const report = { executable, executableSha256, seed, population: population ?? layouts[0].programme.population, role: reference?.layouts[0].programme.context.role ?? role, stage: placements ? 'built' : 'placement-requests', retainedGeometry: !!reference, width, timings, baseline: reference && describe(reference.partitions, reference.layouts), current: describe(partitions, layouts), requests: placementRequests.length, recipes,
    structure: layouts.map(l => l.structure?.metrics), blocks: layouts.reduce((n, l) => n + l.blocks.length, 0), streets: layouts.reduce((n, l) => n + l.streets.length, 0) };
  let scene;
  if (placements) {
    scene = await post('/houses/placement', { schema_version: '1', requests: placementRequests });
    ({ partitions } = await urban('builtCapacity', { partitions, scene }));
    report.current = describe(partitions, layouts, scene);
    report.accepted = scene.buildings.length; report.refused = scene.refusals.length;
    report.footprintM2 = scene.buildings.flatMap(b => b.footprint).reduce((n, s) => n + area(s), 0);
    report.footprintCoverage = report.footprintM2 / report.current.landM2;
    report.refusals = scene.refusals.reduce((counts, r) => { counts[r.code] = (counts[r.code] ?? 0) + 1; return counts; }, {});
  }
  const directory = `out/urban-occupation/${population ?? 'medina'}`; mkdirSync(directory, { recursive: true });
  if (reference && existsSync('out/urban-buildings/courtyard.hint.scene.json')) {
    const beforeScene = JSON.parse(readFileSync('out/urban-buildings/courtyard.hint.scene.json', 'utf8'));
    report.baseline = describe(reference.partitions, reference.layouts, beforeScene);
    report.baseline.accepted = beforeScene.buildings.length; report.baseline.refused = beforeScene.refusals.length;
    report.baseline.footprintM2 = beforeScene.buildings.flatMap(b => b.footprint).reduce((n, s) => n + area(s), 0);
    report.baseline.footprintCoverage = report.baseline.footprintM2 / report.baseline.landM2;
    writeFileSync(`${directory}/before.svg`, proofSvg(reference.layouts, reference.partitions, beforeScene));
  }
  // Local exact-geometry illustration, not a second product renderer.
  if (population === undefined) writeFileSync(`${directory}/after.svg`, proofSvg(layouts, partitions, scene));
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${directory}/inputs.json`, JSON.stringify({ layouts, partitions }));
  writeFileSync(`${directory}/requests.json`, JSON.stringify({ schema_version: '1', requests: placementRequests }));
  if (scene) writeFileSync(`${directory}/scene.json`, JSON.stringify(scene));
  console.log(JSON.stringify(report, null, 2));
  }
} finally {
  child.kill(); if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
