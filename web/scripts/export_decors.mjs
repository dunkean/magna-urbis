// Batch export of Urban Bench decors: neural relief + Rust rivers, settlements and roads.
// covering reliefs, coasts, rivers, road networks and settlement sizes.
//
//   npm run dev:terrain                      (in another terminal)
//   npm run neural:serve                     (native neural service, in another terminal)
//   node scripts/export_decors.mjs [--count 100] [--from 0] [--force] [--headed] [--cpu]
//                                  [--url http://127.0.0.1:5173] [--out decors] [--only d004]
//                                  [--neural http://127.0.0.1:8792]
//   node scripts/export_decors.mjs --index   (rebuild decors/index.json only)
//   node scripts/export_decors.mjs --set city   (City Bench: 15 environments × 2 sizes,
//        one city at the map centre, neural relief from the Python/CUDA service on :8793)
//   node scripts/export_decors.mjs --set biome  (City Bench: 11 climate zones × coast/river × 2 sizes,
//        ids city-<zone>-<coast|river>-<s|l>; --only takes a comma list of id prefixes)
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
const set = option('set', 'urban'), biome = set === 'biome', city = set === 'city' || biome;
const neural = option('neural', city ? 'http://127.0.0.1:8793' : 'http://127.0.0.1:8792').replace(/\/$/, '');
const count = Number(option('count', biome ? 44 : city ? 30 : 100)), from = Number(option('from', 0)), only = option('only', '');
const neuralSource = city ? 'neural-python' : 'neural';
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

// City Bench: contrasted climates, reliefs and coasts, each in a small and a large frame.
// Neural families only (see RELIEFS); one listed settlement at the centre of the map.
const ENVIRONMENTS = [
  { id: 'river-plain', label: 'Plaine fluviale tempérée', climate: 'temperate', relief: 'flat', coast: 'inland', river: 'major', lakes: 'auto', culture: 'european-organic', level: 'rural' },
  { id: 'atlantic-coast', label: 'Côte atlantique vallonnée', climate: 'oceanic', relief: 'hills', coast: 'coast-W', river: 'river', lakes: 'auto', culture: 'hanseatic', level: 'developed' },
  { id: 'aegean-hills', label: 'Collines méditerranéennes littorales', climate: 'mediterranean', relief: 'hills', coast: 'coast-S', river: 'stream', lakes: 'none', culture: 'byzantine-greek', level: 'developed' },
  { id: 'mountain-bay', label: 'Baie montagneuse méditerranéenne', climate: 'mediterranean', relief: 'mountains', coast: 'bay-NE', river: 'auto', lakes: 'auto', culture: 'roman-core', level: 'imperial' },
  { id: 'arid-plateau', label: 'Plateau aride', climate: 'arid', relief: 'plateau', coast: 'inland', river: 'none', lakes: 'auto', culture: 'medina', level: 'rural' },
  { id: 'desert-valley', label: 'Vallée fluviale désertique', climate: 'arid', relief: 'valley', coast: 'inland', river: 'major', lakes: 'none', culture: 'egyptian-planned', level: 'developed' },
  { id: 'arid-shore', label: 'Littoral aride', climate: 'arid', relief: 'flat', coast: 'coast-E', river: 'none', lakes: 'none', culture: 'swahili-stone-town', level: 'rural' },
  { id: 'cold-peaks', label: 'Haute montagne froide', climate: 'cold', relief: 'high-mountains', coast: 'inland', river: 'stream', lakes: 'auto', culture: 'himalayan-terraces', level: 'primitive' },
  { id: 'boreal-river', label: 'Collines boréales et rivière', climate: 'cold', relief: 'mixed', coast: 'inland', river: 'river', lakes: 'some', culture: 'russian-kremlin', level: 'rural' },
  { id: 'tropical-island', label: 'Île tropicale', climate: 'tropical', relief: 'hills', coast: 'island', river: 'auto', lakes: 'none', culture: 'javanese-courts', level: 'rural' },
  { id: 'monsoon-plain', label: 'Plaine tropicale humide', climate: 'tropical', relief: 'flat', coast: 'inland', river: 'major', lakes: 'some', culture: 'khmer', level: 'developed' },
  { id: 'rainforest-ridges', label: 'Reliefs tropicaux forestiers', climate: 'tropical', relief: 'mountains', coast: 'inland', river: 'river', lakes: 'auto', culture: 'maya', level: 'primitive' },
  { id: 'temperate-valley', label: 'Vallée tempérée', climate: 'temperate', relief: 'valley', coast: 'inland', river: 'river', lakes: 'auto', culture: 'chinese', level: 'imperial' },
  { id: 'oceanic-archipelago', label: 'Archipel océanique', climate: 'oceanic', relief: 'mixed', coast: 'archipelago', river: 'auto', lakes: 'none', culture: 'japanese-jokamachi', level: 'rural' },
  { id: 'lake-plateau', label: 'Haut plateau lacustre', climate: 'temperate', relief: 'plateau', coast: 'inland', river: 'auto', lakes: 'some', culture: 'aztec', level: 'developed' },
];
// Biome set: every V2 climate zone with a coast and a river site (sent as custom climate values;
// the zone name stays in the tags). Values mirror CLIMATE_ZONE_VALUES in rust/bridge/terrainClimate.ts.
const ZONE_CLIMATE = {
  temperate: [11, 520, 800, 18, 'oceanic'], mediterranean: [15.5, 620, 620, 55, 'mediterranean'], continental: [8, 850, 620, 32, 'cold'],
  nordic: [4.5, 720, 850, 22, 'cold'], alpine: [9, 650, 1500, 20, 'oceanic'], arctic: [-2, 850, 550, 25, 'cold'], steppe: [9.5, 1050, 380, 42, 'arid'],
  desert: [24, 780, 70, 95, 'arid'], savanna: [28, 380, 600, 115, 'arid'], tropical: [27, 130, 2500, 55, 'tropical'], wetland: [10.5, 560, 750, 16, 'oceanic'],
};
const BIOMES = [
  ['temperate', 'coast', 'Côte tempérée vallonnée', 'hills', 'coast-W', 'river', 'auto', 'hanseatic', 'developed'],
  ['temperate', 'river', 'Plaine fluviale tempérée', 'flat', 'inland', 'major', 'auto', 'european-organic', 'rural'],
  ['mediterranean', 'coast', 'Collines méditerranéennes littorales', 'hills', 'coast-S', 'stream', 'none', 'byzantine-greek', 'developed'],
  ['mediterranean', 'river', 'Vallée méditerranéenne', 'valley', 'inland', 'river', 'none', 'roman-core', 'imperial'],
  ['continental', 'coast', 'Littoral continental plat', 'flat', 'coast-N', 'river', 'some', 'rynek-town', 'developed'],
  ['continental', 'river', 'Plaine continentale et grand fleuve', 'mixed', 'inland', 'major', 'some', 'russian-kremlin', 'rural'],
  ['nordic', 'coast', 'Fjord nordique', 'mountains', 'coast-W', 'stream', 'auto', 'barbarian-norse', 'primitive'],
  ['nordic', 'river', 'Collines boréales et rivière', 'hills', 'inland', 'river', 'some', 'slavic-gord', 'rural'],
  ['alpine', 'coast', 'Baie montagneuse alpine', 'mixed', 'bay-NE', 'auto', 'auto', 'dwarven', 'rural'],
  ['alpine', 'river', 'Haute vallée alpine', 'valley', 'inland', 'river', 'auto', 'himalayan-terraces', 'primitive'],
  ['arctic', 'coast', 'Côte arctique', 'flat', 'coast-N', 'stream', 'some', 'inuit-camp', 'primitive'],
  ['arctic', 'river', 'Toundra et rivière', 'hills', 'inland', 'river', 'some', 'siberian-camp', 'primitive'],
  ['steppe', 'coast', 'Rivage de steppe', 'flat', 'coast-E', 'stream', 'none', 'nomad-camp', 'rural'],
  ['steppe', 'river', 'Steppe et grand fleuve', 'flat', 'inland', 'major', 'auto', 'mongol-ordu', 'primitive'],
  ['desert', 'coast', 'Littoral désertique', 'flat', 'coast-E', 'none', 'none', 'hadhrami-tower', 'rural'],
  ['desert', 'river', 'Vallée fluviale désertique', 'valley', 'inland', 'major', 'none', 'egyptian-planned', 'developed'],
  ['savanna', 'coast', 'Côte de savane', 'hills', 'coast-S', 'river', 'none', 'swahili-stone-town', 'rural'],
  ['savanna', 'river', 'Savane et fleuve', 'flat', 'inland', 'major', 'auto', 'sahel', 'rural'],
  ['tropical', 'coast', 'Île tropicale', 'hills', 'island', 'auto', 'none', 'javanese-courts', 'rural'],
  ['tropical', 'river', 'Plaine tropicale humide', 'flat', 'inland', 'major', 'some', 'khmer', 'developed'],
  ['wetland', 'coast', 'Lagune et marais littoraux', 'flat', 'corner-SE', 'river', 'some', 'venetian-lagoon', 'rural'],
  ['wetland', 'river', 'Delta et marais', 'flat', 'inland', 'major', 'some', 'mississippian', 'rural'],
].map(([zone, site, label, relief, coast, river, lakes, culture, level]) => ({ id: `${zone}-${site}`, zone, label, climate: zone, relief, coast, river, lakes, culture, level }));
const CITY_SIZES = [
  { id: 's', size: 'small', label: 'petite carte', width: 4000, population: 5000, exits: 3 },
  { id: 'l', size: 'large', label: 'grande carte', width: 16000, population: 100000, exits: 4 },
];
/** `central`: the exact centre is too steep or wet; placement picks the best site of the central area instead. */
function cityVariation(i, attempt = 0, central = false) {
  const ENVS = biome ? BIOMES : ENVIRONMENTS;
  const env = ENVS[i % ENVS.length], size = CITY_SIZES[Math.floor(i / ENVS.length) % CITY_SIZES.length];
  const coast = COASTS.find(c => c.id === env.coast);
  // Retries change the neural seed; the last one lets placement choose the best site of the central area.
  const seed = attempt ? `city-${env.id}-${size.id}-${attempt}` : `city-${env.id}-${size.id}`, width = size.width, centred = attempt < 3 && !central;
  const params = new URLSearchParams({
    // Biome set on the fastest engines: neural relief on the CUDA service, hydrology and settlements on the native Rust engine.
    engine: 'rust', profile: biome ? 'local' : 'web', source: neuralSource, neural, v: '4', seed, width: String(width), relief: env.relief, climate: env.zone ? 'custom' : env.climate, erosion: '1',
    auto: '1', style: 'atlas', hydro_main: env.river, hydro_meanders: 'natural', hydro_lakes: env.lakes,
    compute: flag('cpu') ? 'wasm' : 'gpu-f32', generation: flag('cpu') ? 'cpu' : 'gpu-erosion',
    hydro_engine: 'rust', hydro_enabled: '1', hydro_compute: flag('cpu') ? 'cpu' : 'auto',
    fit: 'scale', slopes: '1',
  });
  if (env.relief === 'mixed') params.set('mix', '0.5');
  if (env.zone) { const [temperature, temperatureStd, precipitation, precipitationCv, base] = ZONE_CLIMATE[env.zone]; for (const [k, v] of Object.entries({ temperature, temperatureStd, precipitation, precipitationCv, climateBase: base })) params.set(k, String(v)); }
  if (coast.coasts === 'all') { params.set('coasts', 'N,NE,E,SE,S,SW,W,NW'); params.set('islands', coast.islands); }
  else if (coast.coasts.length) { params.set('coasts', coast.coasts.join(',')); params.set('islands', 'island'); }
  const place = { key: 'city', name: env.label, population: size.population, culture: env.culture, kind: 'settlement', siteType: 'auto', sitePrefs: {}, ...(centred ? { position: { x: width / 2, y: width / 2 } } : {}) };
  // Without a position the site stays in the central 60 % of the map (edge margin 0.2, plus the city's own extent);
  // the last retry accepts the best site of the whole map.
  params.set('settlements', JSON.stringify({ config: { mode: 'list', list: [place], edgeMargin: centred || attempt >= 3 ? 0.03 : 0.2, counts: { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 }, main: { population: size.population, culture: env.culture } }, enabled: true, showPoints: true }));
  params.set('roads', JSON.stringify({ config: { level: env.level, culture: 'auto', density: 0.6, exits: size.exits }, enabled: true, show: true }));
  params.set('urban', JSON.stringify({ enabled: false, parcelEnabled: false }));
  const n = String(i % ENVS.length + 1).padStart(2, '0');
  const id = biome ? `city-${env.id}-${size.id}` : `city-${n}-${env.id}-${size.id}`;
  const label = biome ? `${env.zone} · ${env.label} · ${size.label}` : `${n} · ${env.label} · ${size.label}`;
  const tags = { kit: 'city', environment: env.id, size: size.size, climate: env.climate, relief: env.relief, coast: coast.id, river: env.river, lakes: env.lakes, culture: env.culture, roads: env.level, placement: centred ? 'centre' : 'central-best', source: neuralSource, hydrology: 'rust', seed };
  return { id, label, tags, query: params.toString() };
}

// ---------------------------------------------------------------- index
function readHeader(file) { return headerOf(readFileSync(file)); }
function headerOf(bytes) {
  const raw = gunzipSync(bytes), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
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
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: !flag('headed'), args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', `--use-angle=${process.env.ANGLE ?? 'd3d11'}`] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', error => console.warn(`  page error: ${error.message}`));
let done = 0, failed = 0;
for (let i = from; i < from + count; i++) {
  const make = city ? cityVariation : variation;
  const first = make(i), file = `${first.id}.decor`;
  if (only && !only.split(',').some(o => first.id.startsWith(o))) continue;
  if (!flag('force') && existsSync(join(out, file))) {
    const previous = readHeader(join(out, file));
    if (previous.tags?.source?.startsWith('neural') && previous.tags?.hydrology === 'rust') { console.log(`${first.id}: exists (neural + Rust)`); continue; }
    console.log(`${first.id}: replacing old generators`);
  }
  // Another terrain seed when placement fails (steep or drowned maps) or generation stalls.
  // A steep centre is kept when no central site passes the placement rules.
  let central = false, steepCentre;
  for (let attempt = 0; attempt < 4; attempt++) {
  const v = make(i, attempt, central), start = Date.now();
  try {
    // standalone=1: benchEntry otherwise moves direct links into the rustbench.html shell.
    await page.goto(`${base}/terrainbench.html?${v.query}&pipeline=legacy&standalone=1`, { timeout: 240000 });
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
    if (!entry.tags.source?.startsWith('neural') || entry.tags.hydrology !== 'rust') throw new Error('Unexpected terrain or hydrology generator');
    const wanted = city ? 1 : 2;
    if (entry.settlements < wanted && steepCentre && attempt === 3) {
      writeFileSync(join(out, file), steepCentre); done++;
      console.log(`${v.id}: no central site passes the placement rules; keeping the steep centre`); break;
    }
    if (entry.settlements < wanted && attempt < 3) { console.log(`${v.id}: ${entry.settlements} place(s) with seed ${v.tags.seed}, retrying`); continue; }
    if (entry.settlements < wanted) throw new Error(`Fewer than ${wanted} settlement(s) after all retries`);
    const bytes = Buffer.from(base64, 'base64');
    // A city map must start on buildable land: same terrain, best site of the central area.
    const site = city && headerOf(bytes).settlements[0];
    if (site && !central && site.scores.buildableFraction < 0.6) {
      console.log(`${v.id}: centre ${(site.scores.buildableFraction * 100).toFixed(0)} % buildable, placing in the central area`);
      steepCentre ??= bytes; central = true; attempt--; continue;
    }
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
