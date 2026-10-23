// From web/: node scripts/city_metrics.mjs <replay dir> [<other replay dir>]
// Lot and building-form distributions per zone (core → edge) from a city_replay
// output (run it with --sites so building previews are included). With two
// directories, prints them side by side for before/after comparisons.
// Reference bands (medieval/early-modern European towns, order of magnitude):
//   core: frontage 4–8 m, depth 15–40 m, built cover of the lot 60–85 %
//   middle: frontage 6–12 m, cover 40–60 %; edge/faubourg: frontage 10–25 m, cover 15–35 %
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: node scripts/city_metrics.mjs <dir> [<dir>]'); process.exit(1); }
const ringArea = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
const area = s => ringArea(s.outer) - (s.holes ?? []).reduce((a, h) => a + ringArea(h), 0);
const q = (values, f) => { if (!values.length) return NaN; const v = [...values].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(f * v.length))]; };
const fmt = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '–';

function load(dir) {
  const file = suffix => readdirSync(dir).find(f => f.endsWith(suffix));
  const layout = JSON.parse(readFileSync(join(dir, file('-layout.json')), 'utf8'));
  const partition = JSON.parse(readFileSync(join(dir, file('-partition.json')), 'utf8'));
  const requestsFile = file('-placement-requests.json');
  const requests = requestsFile ? JSON.parse(readFileSync(join(dir, requestsFile), 'utf8')) : [];
  return { layout, partition, requests };
}
function metrics({ layout, partition, requests }) {
  const zoneOf = b => layout.blocks[b]?.zone ?? 'core';
  const allocation = new Map((partition.programme?.allocations ?? []).map(a => [a.parcelId, a]));
  const preview = new Map(requests.map(r => [r.parcel_id, (r.preview ?? []).reduce((s, sh) => s + area(sh), 0)]));
  const zones = {};
  const blockArea = {};
  layout.blocks.forEach((b, i) => { const z = zoneOf(i); blockArea[z] = (blockArea[z] ?? 0) + area(b.shape); });
  for (const p of partition.parcels) {
    const z = zoneOf(p.block), m = zones[z] ??= { plots: [], front: [], depth: [], cover: [], uses: {}, roles: {}, primeGardens: 0, lotArea: 0, built: 0 };
    const a = area(p.shape); m.uses[p.use] = (m.uses[p.use] ?? 0) + a; m.lotArea += a;
    const al = allocation.get(p.id), role = al?.role ?? '';
    if (role) { const fam = role.split('.')[0]; m.roles[fam] = (m.roles[fam] ?? 0) + 1; }
    if (role === 'open.garden' && (p.access?.kind === 'public') && (p.rank ?? 9) <= 1) m.primeGardens++;
    if (p.use !== 'plot' && p.use !== 'court' && p.use !== 'compound') continue;
    const f = p.access?.frontLength ?? 0;
    m.plots.push(a); if (f > 0) { m.front.push(f); m.depth.push(a / f); }
    const b = preview.get(p.id); if (b !== undefined) { m.built += b; if (a > 0) m.cover.push(b / a); }
  }
  return Object.fromEntries(Object.entries(zones).map(([z, m]) => [z, {
    lots: m.plots.length, blockHa: (blockArea[z] ?? 0) / 1e4,
    areaP50: q(m.plots, 0.5), areaP10: q(m.plots, 0.1), areaP90: q(m.plots, 0.9),
    frontP10: q(m.front, 0.1), frontP50: q(m.front, 0.5), frontP90: q(m.front, 0.9),
    depthP50: q(m.depth, 0.5), depthP90: q(m.depth, 0.9),
    coverP50: q(m.cover, 0.5), builtShare: m.built / Math.max(1, blockArea[z] ?? 1),
    plotShare: ((m.uses.plot ?? 0) + (m.uses.court ?? 0) + (m.uses.compound ?? 0)) / Math.max(1, blockArea[z] ?? 1),
    gardenShare: (m.uses.garden ?? 0) / Math.max(1, blockArea[z] ?? 1), residualShare: (m.uses.residual ?? 0) / Math.max(1, blockArea[z] ?? 1),
    primeGardens: m.primeGardens, roles: m.roles,
  }]));
}
const order = ['core', 'middle', 'ring', 'edge', 'faubourg', 'village'];
const results = dirs.map(d => ({ dir: d, m: metrics(load(d)) }));
const zones = [...new Set(results.flatMap(r => Object.keys(r.m)))].sort((a, b) => (order.indexOf(a) + 99 * (order.indexOf(a) < 0)) - (order.indexOf(b) + 99 * (order.indexOf(b) < 0)));
const rows = [['zone', 'run', 'lots', 'blocks ha', 'lot m² p10/50/90', 'front m p10/50/90', 'depth m p50/90', 'cover lot p50', 'built/block', 'plots/block', 'garden/block', 'residual/block', 'gardens on main street']];
for (const z of zones) for (const [i, r] of results.entries()) {
  const m = r.m[z]; if (!m) continue;
  rows.push([z, results.length > 1 ? (i ? 'after' : 'before') : '', m.lots, fmt(m.blockHa, 1), `${fmt(m.areaP10)}/${fmt(m.areaP50)}/${fmt(m.areaP90)}`, `${fmt(m.frontP10, 1)}/${fmt(m.frontP50, 1)}/${fmt(m.frontP90, 1)}`,
    `${fmt(m.depthP50)}/${fmt(m.depthP90)}`, fmt(m.coverP50 * 100) + ' %', fmt(m.builtShare * 100) + ' %', fmt(m.plotShare * 100) + ' %', fmt(m.gardenShare * 100) + ' %', fmt(m.residualShare * 100) + ' %', m.primeGardens]);
}
console.log(rows.map(r => `| ${r.join(' | ')} |`).join('\n').replace(/^(\|[^\n]*\|)/, `$1\n|${rows[0].map(() => '---').join('|')}|`));
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
