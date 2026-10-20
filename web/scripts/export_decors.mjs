// Batch export of Urban Bench decors: neural relief + Rust rivers, settlements and roads.
// covering reliefs, coasts, rivers, road networks and settlement sizes.
//
//   npm run dev:terrain                      (in another terminal)
//   npm run neural:serve                     (native neural service, in another terminal)
//   node scripts/export_decors.mjs [--count 100] [--from 0] [--force] [--headed] [--cpu]
//                                  [--url http://127.0.0.1:5173] [--out decors] [--only d004]
//                                  [--neural http://127.0.0.1:8792]
//   node scripts/export_decors.mjs --index   (rebuild decors/index.json only)
//
// Decors land in web/decors/ (ignored by git) with an index.json read by urbanbench.html.
// The variation list is deterministic: the same --count gives the same decors.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'fflate';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const web = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(web, option('out', 'decors'));
const base = option('url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const neural = option('neural', 'http://127.0.0.1:8792').replace(/\/$/, '');
const count = Number(option('count', 100)), from = Number(option('from', 0)), only = option('only', '');
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- variations
function prng(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Neural-supported families only: the bench silently maps the other families to mixed.
const RELIEFS = ['flat', 'hills', 'valley', 'mountains', 'mixed', 'plateau', 'high-mountains'];
const COASTS = [
  { id: 'inland', coasts: [] }, { id: 'inland', coasts: [] }, { id: 'inland', coasts: [] },
  { id: 'coast-S', coasts: ['S'] }, { id: 'coast-E', coasts: ['E'] }, { id: 'coast-N', coasts: ['N'] }, { id: 'coast-W', coasts: ['W'] },
  { id: 'bay-NE', coasts: ['N', 'NE', 'E'] }, { id: 'bay-SW', coasts: ['S', 'SW', 'W'] }, { id: 'corner-SE', coasts: ['SE'] },
  { id: 'island', coasts: 'all', islands: 'island' }, { id: 'archipelago', coasts: 'all', islands: 'archipelago' },
];
const RIVERS = ['auto', 'auto', 'river', 'major', 'stream', 'none'];
const MEANDERS = ['natural', 'natural', 'reduced', 'none'];
const LAKES = ['auto', 'auto', 'none', 'some'];
const ROAD_LEVELS = ['primitive', 'rural', 'rural', 'developed', 'imperial'];
const ROAD_CULTURES = ['auto', 'auto', 'auto', 'medieval', 'roman', 'east-asian', 'caravan', 'andean', 'mesoamerican', 'tribal', 'elven', 'dwarven'];
const SIZES = [
  // Explicit neighbours: automatic composition asks for the main place alone on small or steep maps.
  { size: 'hamlet', population: 150, width: 2400, counts: { hamlet: 3, farmstead: 3 } },
  { size: 'village', population: 600, width: 2400, counts: { village: 1, hamlet: 3, farmstead: 2 } },
  { size: 'town', population: 3000, width: 3600, counts: { village: 3, hamlet: 3, farmstead: 2 } },
  { size: 'city', population: 12000, width: 6000, counts: { town: 2, village: 4, hamlet: 3 } },
  { size: 'metropolis', population: 40000, width: 10000, counts: { city: 1, town: 3, village: 6, hamlet: 4 } },
];
const CULTURES = ['european-organic', 'european-organic', 'european-organic', 'bastide', 'hanseatic', 'roman-core', 'byzantine-greek', 'venetian-lagoon',
  'medina', 'ottoman', 'persian', 'chinese', 'japanese-jokamachi', 'korean', 'indian-temple', 'russian-kremlin', 'aztec', 'maya', 'inca',
  'swahili-stone-town', 'sahel', 'khmer', 'celtic-oppidum', 'elven', 'dwarven', 'halfling', 'gnomish', 'stilt-town'];

function variation(i, attempt = 0) {
  const r = prng(2026 + i * 7919), pick = list => list[Math.floor(r() * list.length)];
  const relief = RELIEFS[i % RELIEFS.length], size = SIZES[Math.floor(i / 10) % SIZES.length];
  const coast = pick(COASTS), river = pick(RIVERS), meanders = pick(MEANDERS), lakes = pick(LAKES);
  const level = pick(ROAD_LEVELS), roadCulture = pick(ROAD_CULTURES), culture = pick(CULTURES);
  const density = Math.round((0.15 + 0.8 * r()) * 20) / 20, exits = Math.floor(r() * 5);
  // Retries change the neural seed while preserving the catalogue classification.
  const seed = attempt ? `decor-${i}-${attempt}` : `decor-${i}`, width = size.width, motif = Math.max(1500, Math.min(6000, Math.round(width * (0.6 + 0.6 * r()) / 250) * 250)) * (1 + attempt);
  const params = new URLSearchParams({
    engine: 'rust', source: 'neural', neural, v: '4', seed, width: String(width), motif: String(motif), relief, erosion: String(Math.round((0.6 + 0.8 * r()) * 20) / 20),
    auto: '1', style: 'atlas', hydro_main: river, hydro_meanders: meanders, hydro_lakes: lakes,
    compute: flag('cpu') ? 'wasm' : 'gpu-f32', generation: flag('cpu') ? 'cpu' : 'gpu-erosion',
    hydro_engine: 'rust', hydro_enabled: '1', hydro_compute: flag('cpu') ? 'cpu' : 'auto',
    fit: 'scale', slopes: '1',
  });
  if (relief === 'mixed') params.set('mix', String(Math.round(r() * 100) / 100));
  // On steep neural families, retries also soften local relief through the existing controls.
  if (attempt && !['flat', 'hills', 'plateau'].includes(relief)) {
    params.set('n_reliefMode', 'scale'); params.set('n_reliefScale', String(0.7 ** attempt));
  }
  if (coast.coasts === 'all') { params.set('coasts', 'N,NE,E,SE,S,SW,W,NW'); params.set('islands', coast.islands); }
  else if (coast.coasts.length) { params.set('coasts', coast.coasts.join(',')); params.set('islands', 'island'); }
  params.set('settlements', JSON.stringify({ config: { mode: 'counts', counts: size.counts, main: { population: size.population, culture } }, enabled: true, showPoints: true }));
  params.set('roads', JSON.stringify({ config: { level, culture: roadCulture, density, exits }, enabled: true, show: true }));
  // The urban stages are what the decor is for: they stay off while exporting.
  params.set('urban', JSON.stringify({ enabled: false, parcelEnabled: false }));
  const id = `d${String(i).padStart(3, '0')}-${relief}-${coast.id}-${size.size}`;
  const label = `${String(i).padStart(3, '0')} · ${relief} · ${coast.id} · ${size.size} · ${culture}`;
  const tags = { source: 'neural', hydrology: 'rust', relief, coast: coast.id, river, meanders, lakes, roads: `${level}/${roadCulture}`, culture, size: size.size, seed };
  return { id, label, tags, query: params.toString() };
}

// ---------------------------------------------------------------- index
function readHeader(file) {
  const raw = gunzipSync(readFileSync(file)), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint32(0, true) !== 0x4344554d) throw new Error('not a decor');
  return JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + view.getUint32(8, true)))).meta;
}
function writeIndex() {
  const decors = [];
  for (const file of readdirSync(out).filter(f => f.endsWith('.decor')).sort()) {
    try {
      const m = readHeader(join(out, file));
      decors.push({ id: m.id, label: m.label, file, tags: m.tags, width: m.width, settlements: m.settlements.length, roadKm: m.stats.roadKm, riverKm: m.stats.riverKm });
    } catch (error) { console.warn(`index: ${file} skipped (${error.message})`); }
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify({ version: 1, decors }, null, 1));
  console.log(`index.json: ${decors.length} decors in ${out}`);
}
if (flag('index')) { writeIndex(); process.exit(0); }

// Fail before starting a batch when the required native service is unavailable.
const service = await fetch(`${neural}/status`, { signal: AbortSignal.timeout(10000) });
if (!service.ok) throw new Error(`Neural service: HTTP ${service.status}. Run npm run neural:serve.`);

// ---------------------------------------------------------------- export
const browser = await chromium.launch({ headless: !flag('headed'), args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', error => console.warn(`  page error: ${error.message}`));
let done = 0, failed = 0;
for (let i = from; i < from + count; i++) {
  const first = variation(i), file = `${first.id}.decor`;
  if (only && !first.id.startsWith(only)) continue;
  if (!flag('force') && existsSync(join(out, file))) {
    const previous = readHeader(join(out, file));
    if (previous.tags?.source === 'neural' && previous.tags?.hydrology === 'rust') { console.log(`${first.id}: exists (neural + Rust)`); continue; }
    console.log(`${first.id}: replacing old generators`);
  }
  // Another terrain seed when placement fails (steep or drowned maps) or generation stalls.
  for (let attempt = 0; attempt < 4; attempt++) {
  const v = variation(i, attempt), start = Date.now();
  try {
    await page.goto(`${base}/terrainbench.html?${v.query}&pipeline=legacy`);
    // Ready twice in a row: placement answered and roads routed for the latest request.
    let stable = 0;
    while (stable < 2) {
      if (Date.now() - start > 300000) throw new Error('timeout');
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({ ready: !!window.magnaDecor?.ready(), error: document.getElementById('status')?.dataset.error === 'true' ? document.getElementById('status').textContent : '' }));
      if (state.error) throw new Error(state.error);
      stable = state.ready ? stable + 1 : 0;
    }
    const { base64, entry } = await page.evaluate(([file, extra]) => window.magnaDecor.export(file, extra), [file, { id: v.id, label: v.label, tags: v.tags, query: v.query }]);
    if (entry.tags.source !== 'neural' || entry.tags.hydrology !== 'rust') throw new Error('Unexpected terrain or hydrology generator');
    if (entry.settlements < 2 && attempt < 3) { console.log(`${v.id}: ${entry.settlements} place(s) with seed ${v.tags.seed}, retrying`); continue; }
    if (entry.settlements < 2) throw new Error('Fewer than two settlements after all retries');
    const bytes = Buffer.from(base64, 'base64');
    writeFileSync(join(out, file), bytes);
    done++;
    console.log(`${v.id}: ${entry.settlements} places · ${entry.roadKm.toFixed(1)} km roads · ${entry.riverKm.toFixed(1)} km rivers · ${(bytes.length / 1e6).toFixed(2)} MB · ${((Date.now() - start) / 1000).toFixed(0)} s · seed ${v.tags.seed}`);
    break;
  } catch (error) {
    console.warn(`${v.id}: FAILED ${String(error.message ?? error).split('\n')[0]}`);
    if (attempt === 3) failed++;
  }
  }
}
await browser.close();
writeIndex();
console.log(`${done} exported, ${failed} failed`);
if (failed) process.exitCode = 1;
