// Manifest preparation only. Reads catalogues; never opens a browser or runtime.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const board = dirname(fileURLToPath(import.meta.url)), root = resolve(board, '..');
const entries = JSON.parse(readFileSync(resolve(root, 'web/decors/index.json'))).decors;
const cultures = JSON.parse(readFileSync(resolve(root, 'rust/crates/core/src/urban/catalogue.json'))).cultures;
const maps = new Map(entries.map(entry => [entry.id, entry]));
const fantasy = new Set(['halfling', 'elven', 'dwarven', 'duergar-hold']);
// slug, decor suffix, culture, population, visual question, programme override, gate, explicit position
const rows = [
  ['farm', '01-river-plain-s', 'european-organic', 8, 'Ferme isolée : corps habitables et dépendances lisibles sans réseau urbain artificiel.', { role: 'isolated-farm' }, 'specialized', [2000, 2000]],
  ['mill', '13-temperate-valley-s', 'european-organic', 6, 'Moulin isolé : atelier identifié par craft.mill, accès et relation à une eau courante réelle.', { role: 'isolated-mill' }, 'specialized'],
  ['norse-hamlet', '09-boreal-river-s', 'barbarian-norse', 40, 'Hameau boréal : groupes de maisons longues séparés et espace agricole.', {}, 'p0'],
  ['celtic-hamlet', '03-aegean-hills-s', 'barbarian-celtic', 60, 'Hameau à maisons rondes : cour centrale et taille des corps lisibles.', {}, 'p0', [2000, 2000]],
  ['kraal-village', '07-arid-shore-s', 'kraal', 300, 'Concessions et espace collectif : séparation des toits arrondis et du vide central.', {}, 'p0', [2000, 2000]],
  ['iroquoian-village', '09-boreal-river-s', 'native-iroquoian', 450, 'Village de maisons longues : orientation des corps, accès et espaces entre groupes.', {}, 'p0'],
  ['pueblo', '05-arid-plateau-s', 'native-pueblo', 900, 'Volumes compacts en terrasses : conserver retraits et cours sans aplat uniforme.', {}, 'p0', [2000, 2000]],
  ['plains-camp', '01-river-plain-s', 'native-plains', 150, 'Camp de plaine : unités rondes et organisation collective lisibles.', {}, 'p0', [2000, 2000]],
  ['nomad-camp', '06-desert-valley-s', 'nomad-camp', 500, 'Camp nomade : densité ouverte et variations de taille sans alignements domestiques imposés.', {}, 'p0'],
  ['halfling-hamlet', '13-temperate-valley-s', 'halfling', 80, 'Hameau fantasy : petites implantations espacées et adaptation à la vallée.', {}, 'p0'],
  ['byzantine-hills', '03-aegean-hills-s', 'byzantine-greek', 4000, 'Bourg sur collines : lots obliques, accès et corps architecturaux sans pointes.', {}, 'p0', [2000, 2000]],
  ['hanseatic-port', '02-atlantic-coast-s', 'hanseatic', 8000, 'Port atlantique : fronts bâtis, profondeur des maisons et places distingués.', { role: 'port' }, 'p0', [2000, 2000]],
  ['medina-courts', '05-arid-plateau-s', 'medina', 8000, 'Médina : cours ouvertes au ciel, ailes assez épaisses et ruelles accessibles.', {}, 'p0', [2000, 2000]],
  ['swahili-shore', '07-arid-shore-s', 'swahili-stone-town', 5000, 'Ville littorale swahilie : concessions et toitures adaptées à son catalogue.', { role: 'port' }, 'p0', [2000, 2000]],
  ['roman-mountain', '04-mountain-bay-s', 'roman-core', 5000, 'Cas montagneux du corpus : limiter les grands résiduels et préserver cours/corps rectilignes.', {}, 'p0', [2640, 2669]],
  ['javanese-island', '10-tropical-island-s', 'javanese-courts', 5000, 'Île tropicale : cours, enclos et composés à plusieurs corps.', {}, 'p0'],
  ['khmer-monsoon', '11-monsoon-plain-l', 'khmer', 30000, 'Grande implantation humide : trame des quartiers et espaces non bâtis entre composés.', {}, 'p0', [8000, 8000]],
  ['maya-ridges', '12-rainforest-ridges-l', 'maya', 12000, 'Ville forestière dispersée : continuité des accès entre noyaux sur relief.', {}, 'p0', [8000, 8000]],
  ['aztec-lake', '15-lake-plateau-s', 'aztec', 8000, 'Plateau lacustre : distinction parcelles, espaces publics et accès près de l’eau.', {}, 'p0', [2000, 2000]],
  ['inca-slopes', '08-cold-peaks-s', 'inca', 3000, 'Bourg andin : gradins, différences de niveau et escaliers sans corps écrasés.', {}, 'p0'],
  ['himalayan-terraces', '08-cold-peaks-s', 'himalayan-terraces', 1000, 'Village de haute montagne : terrasses et gabarits lisibles dans les pentes.', {}, 'p0'],
  ['newar-squares', '13-temperate-valley-s', 'newar', 6000, 'Bourg de vallée : places rituelles et fronts continus préservant les ouvertures.', {}, 'p0'],
  ['korean-city', '13-temperate-valley-l', 'korean', 30000, 'Ville coréenne : composés et axes visibles à l’échelle du quartier.', {}, 'p0'],
  ['japanese-archipelago', '14-oceanic-archipelago-l', 'japanese-jokamachi', 100000, 'Grande ville insulaire : maisons étroites et grands domaines restent distincts.', {}, 'p0'],
  ['european-100k', '01-river-plain-l', 'european-organic', 100000, 'Régression du corpus 100k : diversité de gabarits, faubourgs et premiers lots visibles rapidement.', {}, 'p0', [8000, 8000]],
  ['chinese-million', '01-river-plain-l', 'chinese', 1000000, 'Charge 1M sur terrain 16 km : affichage progressif et LOD, avec déficit spatial explicitement rapporté.', { role: 'capital' }, 'million', [8000, 8000]],
  ['persian-city', '06-desert-valley-l', 'persian', 100000, 'Grande ville de vallée aride : cours, places et axes sans uniformiser les volumes.', {}, 'p0'],
  ['ottoman-hills', '03-aegean-hills-l', 'ottoman', 30000, 'Ville ottomane vallonnée : parcelles obliques et silhouette cohérente des maisons.', {}, 'p0', [8000, 8000]],
  ['sahel-town', '06-desert-valley-s', 'sahel', 6000, 'Bourg sahélien : masses de terre, vides de cour et densité de rive.', {}, 'p0'],
  ['egyptian-river', '06-desert-valley-l', 'egyptian-planned', 30000, 'Trame planifiée fluviale : îlots et maisons étroites sans effets de coupe en éventail.', {}, 'p0'],
  ['nubian-fort', '05-arid-plateau-s', 'nubian-fortified', 3000, 'Bourg fortifié aride : relation entre enceinte, noyau et tissus domestiques.', {}, 'p0', [2000, 2000]],
  ['mesopotamian-courts', '06-desert-valley-l', 'mesopotamian', 100000, 'Quartiers de cours à grande échelle : préserver les trous des patios jusque dans les tuiles raster.', {}, 'p0'],
  ['oasis-caravan', '05-arid-plateau-s', 'oasis-caravan', 10000, 'Cité caravanière : cours/composés et réserves fonctionnelles distincts.', { role: 'crossroads' }, 'p0', [2000, 2000]],
  ['ksar-oasis', '05-arid-plateau-s', 'ksar-oasis', 1000, 'Petit ksar : compacte enceinte et parcelles irrégulières sans ailes en aiguilles.', {}, 'p0', [2000, 2000]],
  ['yoruba-compounds', '11-monsoon-plain-s', 'yoruba', 8000, 'Ville de concessions : groupes de corps autour de cours différenciées.', {}, 'p0', [2000, 2000]],
  ['indus-grid', '01-river-plain-l', 'indus-planned', 30000, 'Ville de trame planifiée : tailles de lots, fronts et accès réguliers.', {}, 'p0', [8000, 8000]],
  ['bastide', '01-river-plain-s', 'bastide', 3000, 'Bastide : place centrale et continuité du front bâti dans une trame régulière.', {}, 'p0', [2000, 2000]],
  ['elven-forest', '12-rainforest-ridges-s', 'elven', 5000, 'Ville forestière fantasy : dispersions et composés propres à la culture, sans substitution européenne silencieuse.', {}, 'p0'],
  ['dwarven-hold', '08-cold-peaks-s', 'dwarven', 5000, 'Forteresse de montagne fantasy : corps massifs, terrasses et cheminements.', {}, 'p0'],
  ['duergar-ruins', '08-cold-peaks-s', 'duergar-hold', 200, 'Établissement ruiné : statut ruine, absence d’occupation et géométrie manquante signalées.', { state: 'ruined' }, 'specialized'],
];
const commonExpectations = [
  'Capture de bâtiments réellement affichés ; un état vide/refusé doit rester explicite dans le rapport.',
  'Aucune génération native détaillée de toute la ville ; détails limités au visible ou à la sélection.',
  'Empreintes conservées entre plan compact et détail, cours ouvertes, absence de slivers et de masquage silencieux des refus.',
];
const baseLimits = [
  'Le nom de culture ne prouve pas sa couverture architecturale : relever pack, recette, profil, confiance et refus réels.',
  'Les plans compacts ne certifient ni intérieurs ni capacité habitée ; conserver une valeur inconnue explicite.',
  'Monuments et ateliers spécialisés peuvent rester des aperçus de programme ; ne pas les présenter comme modèles natifs certifiés.',
];
const sizeOf = n => n < 15 ? 'farmstead' : n < 150 ? 'hamlet' : n < 1000 ? 'village' : n < 20000 ? 'town' : n < 100000 ? 'city' : n < 1000000 ? 'metropolis' : 'megacity';
const cases = rows.map(([slug, suffix, culture, population, question, programme, gate, position], index) => {
  const artifact = `city-${suffix}`, map = maps.get(artifact);
  if (!map || !cultures[culture] || !existsSync(resolve(root, 'web/decors', map.file))) throw new Error(`Unknown catalogue input: ${artifact}/${culture}`);
  const limits = [...baseLimits];
  if (gate === 'specialized') limits.push('Attendre B2 publié dans le bridge/UI et le binaire utilisé ; un rôle de programme ne garantit pas une géométrie spécialisée.');
  if (gate === 'million') limits.push('Population demandée 1M dépasse le maximum 400000 annoncé par ce décor 16 km. Cas de stress explicitement hors capacité déclarée, pas preuve de logement de 1M personnes.');
  if (culture === 'duergar-hold') limits.push('Le décor est une montagne de surface : aucun terrain de caverne fourni. Comparaison du tissu fantasy uniquement. Ruine sémantique ≠ maillage effondré.');
  if (['kraal', 'native-plains', 'oasis-caravan', 'ksar-oasis', 'yoruba'].includes(culture)) limits.push('Décor de substitution géographique : mesure de contraste morphologique, pas reconstitution historique ni écologique.');
  const settlement = { kind: 'settlement', siteType: slug === 'mill' ? 'meander' : 'auto', sitePrefs: {}, ...(position ? { position: { x: position[0], y: position[1] } } : {}) };
  const seed = `visual50-v1-${String(index + 1).padStart(2, '0')}-${slug}`;
  return {
    id: `${String(index + 1).padStart(2, '0')}-${slug}`, title: question,
    artifact, culture, population, seed, settlement,
    urban: { quarterSeed: seed, parcelSeed: `${seed}:parcels`, layoutConfig: { programme: { mode: fantasy.has(culture) ? 'fantasy' : 'inspired', ...programme } }, buildingState: { seed: `${seed}:houses`, settings: { parcel_fit: true } } },
    architecture: gate === 'million' ? 'detailed' : 'compact', camera: { kind: 'overview' },
    tags: { biome: map.tags.climate, relief: map.tags.relief, size: sizeOf(population), culture, environment: map.tags.environment },
    expectations: [question, ...commonExpectations], limitations: limits, gate,
    source: { decorWidthM: map.width, decorSeed: map.tags.seed, declaredMaxPopulation: Number(map.tags.maxPopulation), cultureLabel: cultures[culture].label },
  };
});
// These cases derive their urban seeds/configuration from the captured native
// regressions. A fresh UI run still recalculates settlements and roads, so it
// must not be described as an exact replay of the complete frozen input.
for (const [id, folder] of [['15-roman-mountain', '04-mountain'], ['25-european-100k', '01-l']]) {
  const item = cases.find(candidate => candidate.id === id);
  const fixtureRoot = `_agents_blackboard/city-visual-audit/${folder}`;
  const input = `${fixtureRoot}/quarters-request.json`;
  const bytes = readFileSync(resolve(root, input));
  const request = JSON.parse(bytes);
  const partition = JSON.parse(readFileSync(resolve(root, `${fixtureRoot}/partition.json`)));
  const site = request.sites?.find(candidate => candidate.key === 'city');
  if (!item || !site || site.population !== item.population || site.culture !== item.culture || !request.seed || !partition.config) throw new Error(`Invalid frozen regression reference: ${id}`);
  item.seed = request.seed;
  item.settlement.position = { ...site.center };
  item.urban = {
    ...item.urban,
    // city_visual_audit.mjs used request.seed unchanged at all three stages.
    quarterSeed: request.seed, parcelSeed: request.seed,
    layoutConfig: structuredClone(request.layoutConfig),
    parcelConfig: structuredClone(partition.config),
    buildingState: { ...item.urban.buildingState, seed: request.seed },
  };
  item.regressionReference = {
    kind: 'fixture-derived-ui-scenario', input, inputSha256: createHash('sha256').update(bytes).digest('hex'),
    baseline: { layout: `${fixtureRoot}/layout.json`, partition: `${fixtureRoot}/partition.json`, buildingSites: `${fixtureRoot}/requests.json`, provenance: `${fixtureRoot}/source.json` },
    derivation: 'web/scripts/city_visual_audit.mjs: quarters uses the frozen request; parcels and buildingSites use its seed unchanged. parcelConfig is the captured resolved partition.config.',
    frozenSite: structuredClone(site), frozenRoadCount: request.roads?.length ?? 0,
    uiExactReplay: false,
    uiDifferences: [
      'The UI recalculates settlements/site radius and roads from the decor situation; frozen request.sites and request.roads are not injected by this manifest.',
      'Current UI normalization and architecture defaults may differ from the captured native pipeline. Record the actual requests and compare before claiming input identity.',
    ],
    exactComparison: 'Replay the referenced quarters input (including sites/roads) and the recorded parcel/buildingSites seeds against the coordinated new runtime. Frozen outputs are the before baseline only; replaying outputs would bypass the urban corrections.',
  };
  item.limitations.push('Cas dérivé des entrées figées du corpus, pas replay UI exact : sites/rayon et routes sont recalculés. Référence native complète dans regressionReference.');
}
const closeups = [
  [1, .12, 'Corps et dépendances de la ferme, même implantation.'],
  [11, .2, 'Corps sur parcelles obliques et angles des toits.'],
  [13, .15, 'Patios transparents et largeur des ailes.'],
  [15, .2, 'Zone montagneuse 2640,2669 du corpus régressif.'],
  [7, .15, 'Retraits et cours du composé pueblo.'],
  [19, .2, 'Accès et vides entre maisons près du plateau lacustre.'],
  [25, .2, 'Centre 100k conservé ; les deux défauts connus sont examinés dans les cadrages auxiliaires dédiés.'],
  [26, .25, 'Cœur 1M : seules les maisons proches sont réalisées ; vérifier mémoire/cache et files bornées.'],
  [37, .2, 'Fronts de bastide : continuité et diversité sans rétrécir les maisons en pointes.'],
  [17, .2, 'Cours et pavillons dans le tissu khmer.'],
];
for (const [original, mpp, question] of closeups) {
  const base = cases[original - 1], position = base.settlement.position;
  if (!position) throw new Error('Fixed close-up requires an explicit applied city position.');
  const item = structuredClone(base);
  item.id = `${String(cases.length + 1).padStart(2, '0')}-${base.id.slice(3)}-close`;
  item.title = question; item.pairedWith = base.id; item.architecture = 'detailed';
  item.camera = { kind: 'fixed', cx: position.x, cy: position.y, mpp };
  item.expectations = [question, ...commonExpectations, 'Mesurer appels physiques simultanés ≤2, caches bornés et refus sans disparition du plan.'];
  item.limitations.push('Le centre fixe peut tomber sur une place : enregistrer tout recentrage explicite dans le rapport, ne pas sélectionner discrètement une réussite.');
  cases.push(item);
}
// One auxiliary entry means one screenshot; three layers share each camera.
// Declare them only on the close view, so its paired overview does not duplicate
// the requested captures. Execution support is explicitly tracked separately.
const focused = JSON.parse(readFileSync(resolve(root, '_agents_blackboard/city-visual-audit/01-l/focused-cases.json')));
if (!focused.pair?.center?.every(Number.isFinite) || !focused.thinCourt?.center?.every(Number.isFinite) || focused.pair.ids?.length !== 2 || !focused.thinCourt.id) throw new Error('Missing focused 100k regression witnesses.');
function auxiliaryTriptych(item, group, camera, purpose, fixtureFeatures = []) {
  const layers = [
    ['parcels', 'parcels', 'compact'],
    ['silhouettes', 'buildings', 'silhouette'],
    ['plans', 'buildings', 'compact'],
  ];
  item.auxiliaryViews ??= [];
  for (const [layer, renderView, architecture] of layers) {
    const id = `${group}-${layer}`;
    item.auxiliaryViews.push({ id, comparisonGroup: group, camera: { ...camera }, renderView, architecture, image: `${item.id}--${id}.png`, countsTowardPrimary: false, purpose, fixtureFeatures });
  }
}
const mountainClose = cases.find(item => item.id === '44-roman-mountain-close');
const largeClose = cases.find(item => item.id === '47-european-100k-close');
auxiliaryTriptych(mountainClose, 'mountain-core', mountainClose.camera, 'Comparer parcelles, silhouettes et plans natifs au même point montagneux 2640,2669.');
auxiliaryTriptych(largeClose, '100k-core', largeClose.camera, 'Centre 8000,8000 : comparaison des trois couches ; les défauts connus sont hors de ce cadre proche.');
auxiliaryTriptych(largeClose, '100k-unequal-parcels', { kind: 'fixed', cx: focused.pair.center[0], cy: focused.pair.center[1], mpp: .15 }, `Paire de parcelles du corpus avec surfaces dans un rapport ${focused.pair.areaRatio.toFixed(2)} malgré des fronts voisins ; contrôler coupe et occupation.`, focused.pair.ids);
auxiliaryTriptych(largeClose, '100k-thin-court', { kind: 'fixed', cx: focused.thinCourt.center[0], cy: focused.thinCourt.center[1], mpp: .125 }, 'Cour du corpus avec aile quasi nulle : vérifier épaisseur des corps, angles et vide du patio sans recadrer vers une autre réussite. Cadrage UI à 0,125 m/px (plafond 8 px/m), distinct du canvas historique à 0,12.', [focused.thinCourt.id]);
const uniqueCultures = [...new Set(cases.map(item => item.culture))].sort();
const result = {
  version: 2, status: 'prepared_not_executed', created: '2026-10-22',
  scope: '50 primary screenshots: 40 distinct settlements and 10 close views, plus 12 declared auxiliary screenshots outside that count. This generator performs no run; execution reports are separate.',
  sources: ['web/decors/index.json', 'rust/crates/core/src/urban/catalogue.json', 'rust/crates/core/src/urban/services.json', 'rust/bridge/urbanConfig.ts', 'web/scripts/city_bench_check.mjs', 'web/scripts/city_visual_audit.mjs', '_agents_blackboard/city-visual-audit/01-l/quarters-request.json', '_agents_blackboard/city-visual-audit/04-mountain/quarters-request.json', '_agents_blackboard/city-visual-audit/01-l/focused-cases.json'],
  defaults: { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, executionProfile: 'local', background: 'atlas', primaryImage: '{id}.png', sequential: true, retryCount: 0 },
  gates: {
    p0: 'D2 progressive integration + A3 lot/body corrections visually reviewed. Run only on a coordinated binary; never rebuild/restart inside this suite.',
    specialized: 'All P0 gates plus B2 low-end/state bridge/UI/runtime capability verified. Report unsupported instead of silent substitution.',
    million: 'All P0 gates plus explicit resource/time budget after 100k completes. Uses compact base + bounded on-demand detail; never eager native city. Declared decor capacity exceeded.',
  },
  mergeRules: [
    'Start from the artifact saved query. Set one list entry key=city, then override culture/population/settlement. Absence of settlement.position deletes any saved position and selects deterministically with the seed.',
    'Deep merge urban nested overrides. Use the explicitly stored quarterSeed, parcelSeed and buildingState.seed verbatim, without adding suffixes; terrain seed stays the recorded decorSeed.',
    'regressionReference identifies frozen native inputs and baseline outputs. Fixture-derived UI cases are not exact input replays: the UI recalculates settlements and roads. Do not claim identical regression geometry without comparing actual input payloads.',
    'Generate/retain compact plans first for compact and detailed modes. Reuse pairedWith retained plans where available; only change camera/detail mode for the close shot.',
    'Overview is focusCity fitted to applied settlement. Fixed camera is metres; restore view.scale=1/mpp after generation. Save final map viewBox.',
    'Record actual server URL/version/binary timestamp and source revisions in report, never bake a port into shared situation content.',
    'Exactly one primary PNG per entry. Auxiliary before/after, parcel, parchment or 3D captures use separate names and do not inflate the 50 primary views.',
  ],
  auxiliaryContract: {
    status: 'declared_not_executed_runner_support_pending',
    unit: 'Each case.auxiliaryViews entry is one capture, excluded from primaryScreenshots. image is its explicit output filename.',
    fields: 'id, comparisonGroup, camera, renderView (parcels|buildings), architecture (compact|silhouette), image, countsTowardPrimary=false, purpose, fixtureFeatures',
    reuse: 'Keep the same retained urban layout/partition and seeds for every entry in a comparisonGroup. Reuse native compact plans; obtain silhouettes from the same urban inputs. Changing layers must not regenerate settlements, roads, quarters or parcels.',
    camera: 'All three entries of a group use exactly the same fixed world camera. Save actual map viewport/viewBox; a missing former witness after a fix is reported, not silently recentered.',
    provenance: 'fixtureFeatures are baseline identifiers, not promises of stable IDs after geometry changes. The two 100k witness cameras derive from city-visual-audit/01-l/focused-cases.json.',
    unsupported: 'Until the runner implements these captures, prepared/report must record them as pending/unsupported rather than count them as successful or omit them silently.',
  },
  measures: [
    'Runtime version, CPU/RAM/process load snapshot, browser/version, source revisions, exact request/situation and applied camera.',
    'Terrain ready; settlements, roads, quarters, parcels, buildingSites, first compact response, first visible building paint, complete compact scene timestamps separately.',
    'Per-route request/response bytes, JSON parse/worker-transfer time when observable, archives bytes and peak browser heap where available.',
    'Buildings accepted, refused by code/message, intended open spaces, requested/parcel/actual capacity with unknown kept null.',
    'Recipes, variants, packs, body counts, material IDs and their frequencies; fallback/unsupported culture or functional-profile provenance.',
    'Parcel area/frontage/depth/aspect quantiles, residual/unserved shares, invalid rings, overlap/outside lot, courtyard/min-wing-width examples.',
    'Actual site and footprint slope distributions from the decor raster, sampled elevations/grades, stairs/terrace/access outcomes and applicable configured slope thresholds; relief tags alone do not establish slope adaptation.',
    'Renderer queried/visible/drawn counts, LOD distribution, prepared vertices, roof mesh reads, raster tiles pending/cache bytes and warm-frame CPU.',
    'Detail queue/inFlight/globalInFlight/cached/refused/cacheBytes/cachedVertices; no overview realization and physical peak≤2.',
    'Browser errors, warning text, unfinished/chunk progress at deadline; image filenames and manual visual verdict with explicit reasons.',
  ],
  coverage: { primaryScreenshots: cases.length, distinctScenes: rows.length, closeViews: closeups.length, auxiliaryScreenshots: cases.reduce((total, item) => total + (item.auxiliaryViews?.length ?? 0), 0), auxiliaryCameraGroups: 4, catalogueCultureCount: Object.keys(cultures).length, coveredCultures: uniqueCultures, notCoveredCultures: Object.keys(cultures).filter(id => !uniqueCultures.includes(id)).sort(), decorCount: new Set(cases.map(item => item.artifact)).size, environmentCount: new Set(cases.map(item => item.tags.environment)).size, biomeTagMeaning: 'Existing decor climate tag, not a verified per-pixel ecological biome.' },
  cases,
};
if (cases.length !== 50 || new Set(cases.map(item => item.id)).size !== 50) throw new Error('Expected 50 unique primary cases.');
if (result.coverage.auxiliaryScreenshots !== 12) throw new Error('Expected 12 declared auxiliary captures outside the primary count.');
for (const item of cases) {
  if (item.pairedWith) {
    const base = cases.find(candidate => candidate.id === item.pairedWith);
    for (const key of ['artifact', 'culture', 'population', 'seed', 'settlement', 'urban', 'regressionReference']) {
      if (!base || JSON.stringify(base[key]) !== JSON.stringify(item[key])) throw new Error(`Paired scene input differs: ${item.id}/${key}`);
    }
  }
  const auxiliary = item.auxiliaryViews ?? [];
  for (const group of new Set(auxiliary.map(view => view.comparisonGroup))) {
    const views = auxiliary.filter(view => view.comparisonGroup === group);
    if (views.length !== 3 || new Set(views.map(view => JSON.stringify(view.camera))).size !== 1) throw new Error(`Invalid three-layer auxiliary camera: ${item.id}`);
  }
}
writeFileSync(resolve(board, 'CITY_VISUAL_BENCH_50.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.coverage, null, 2));
