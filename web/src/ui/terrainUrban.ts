import UrbanWorker from './urbanWorker?worker&inline';
import catalogueJson from '../../../rust/crates/core/src/urban/catalogue.json';
import { defaultLayoutConfig, defaultParcelConfig, layoutExtent, normalizeLayoutConfig, normalizeParcelConfig, regionalStreets, runUrbanRequest, type Layout, type LayoutConfig, type ParcelConfig, type Partition, type Point, type Shape, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';
import { settlementRaster, type RoadOutput, type SettlementOutput, type SettlementRaster } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { terrainGeography } from '../../../rust/bridge/urbanGeography';
import { streetSurfacePath } from '../../../rust/bridge/urbanStreetSurface';
import { createUrbanSceneClient } from './urbanScene';
import { createUrbanBuildingsPanel } from './urbanBuildingsPanel';
import { urbanBuildingsSvg } from '../render/urbanBuildings';
import { openUrbanHouseCase } from './urbanHouseTransfer';
import { parcelInspectionHtml } from './urbanInspector';
import { updateUrbanBuildingSelection } from './urbanBuildingSelection';
import { buildingSettings, workshopSettings, appliedWorkshopSnapshot, mergeCityWorkshop, mergeWorkshopCities } from './urbanSnapshot';
import { programmeSvg, refusalSvg } from '../render/urbanProgramme';
import { openMethodNote } from './methodNotes';
import { applySettlementStyle, installSettlementStyles } from './urbanSettlementStyles';

interface Catalogue { fields: Record<'quarters' | 'parcels', string[]>; presets: Record<string, { label: string; params: Record<string, unknown> }>; cultures: Record<string, { label: string; recipes: { id: string; label: string; zone: string; preset: string }[] }> }
const catalogue = catalogueJson as Catalogue;
const ns = 'http://www.w3.org/2000/svg';
const clone = <T>(v: T): T => structuredClone(v);
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const operators: Record<string, string[]> = { streetOp: ['organic', 'grid'], closeOp: ['closes', 'culDeSacTree', 'hutong', 'roji', 'none'], orientation: ['road', 'cardinal', 'terrain', 'water'], plotOp: ['burgage', 'courtyard', 'siheyuan', 'machiya', 'compound', 'garden', 'wholeBlock'] };
const labels: Record<string, string> = { streetOp: 'Rues', closeOp: 'Dessertes', orientation: 'Orientation', laneSpacing: 'Espacement des ruelles', wardArea: 'Surface des quartiers', accessDepth: 'Profondeur accessible', fieldTwist: 'Rotation du champ', curvature: 'Courbure', fieldNoise: 'Bruit du champ', fieldWavelength: 'Longueur du champ', fieldRandom: 'Variation du champ', gridSpacing: 'Espacement de grille', gridSkew: 'Obliquité de grille', blockSize: 'Taille des îlots', minBlock: 'Surface minimale des îlots', minWidth: 'Largeur minimale', widthByRank: 'Largeurs par rang', widthScale: 'Échelle des largeurs', widthJitter: 'Variation des largeurs', placeThreshold: 'Seuil des places', deadEndRatio: 'Impasse / longueur', slitDepth: 'Profondeur des passages', plotDepth: 'Profondeur des parcelles', contourFollow: 'Suivi des courbes de niveau', contourBlend: 'Influence du relief', longCut: 'Coupures longues', plotOp: 'Méthode de parcelles', houseArea: 'Surface de cour', coverage: 'Occupation', frontage: 'Largeur de façade', plotTilt: 'Inclinaison des parcelles', wideLotChance: 'Probabilité de grande parcelle', deepFill: 'Remplir les fonds' };
const path = (pts: Point[], close = false): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + (close ? 'Z' : '');
const shapePath = (s: Shape): string => [s.outer, ...(s.holes ?? [])].map(p => path(p, true)).join(' ');
const shapeArea = (s: Shape): number => {
  const ring = (r: Point[]): number => Math.abs(r.reduce((sum, p, i) => { const n = r[(i + 1) % r.length]; return sum + p.x * n.y - p.y * n.x; }, 0)) / 2;
  return ring(s.outer) - (s.holes ?? []).reduce((sum, h) => sum + ring(h), 0);
};
const configValue = (input: HTMLInputElement | HTMLSelectElement): string | number | boolean => input instanceof HTMLInputElement ? input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value : input.value;
/** The wall stroke stops at each gate, so roads and terrain remain visible through it. */
function enclosurePath(points: Point[], gates: Point[]): string {
  if (points.length < 2) return '';
  const closed = points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y ? points : [...points, points[0]];
  const pieces: string[] = [];
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1], b = closed[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const gaps = gates.flatMap(g => {
      const at = ((g.x - a.x) * dx + (g.y - a.y) * dy) / length;
      const across = Math.abs((g.x - a.x) * dy - (g.y - a.y) * dx) / length;
      if (across > 6 || at < -6 || at > length + 6) return [];
      const half = Math.sqrt(36 - across * across);
      return [[Math.max(0, at - half), Math.min(length, at + half)]];
    }).sort((a, b) => a[0] - b[0]);
    const at = (d: number): Point => ({ x: a.x + dx * d / length, y: a.y + dy * d / length });
    let start = 0;
    for (const [from, to] of gaps) { if (from > start) pieces.push(path([at(start), at(from)])); start = Math.max(start, to); }
    if (start < length) pieces.push(path([at(start), b]));
  }
  return pieces.join(' ');
}

function stairMarks(points: Point[], widths: number[]): string {
  const marks: string[] = []; let next = 1.25;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const half = Math.min(2, widths[i - 1] ?? 2) * 0.48;
    for (; next < length; next += 2.5) {
      const x = a.x + dx * next / length, y = a.y + dy * next / length;
      marks.push(path([{ x: x - dy * half / length, y: y + dx * half / length }, { x: x + dy * half / length, y: y - dx * half / length }]));
    }
    next -= length;
  }
  return marks.join(' ');
}
const mechanisms: Record<string, string> = { auto: 'Selon le relief et les accès', accessibility: 'Croissance par accessibilité', ribbon: 'Accrétion le long des voies', fusion: 'Fusion de noyaux', legacy: 'Contour historique du banc' };
const families: Record<string, string> = { auto: 'Selon culture, relief et accès', circle: 'Circulaire / ovalaire', rectangle: 'Carrée / rectangulaire', polygon: 'Polygonale', compact: 'Organique compacte', elongated: 'Allongée / fusiforme', linear: 'Linéaire / ruban', fan: 'Éventail / secteur', fingers: 'Radiale à bras', dendritic: 'Ramifiée / dendritique', lobed: 'Lobée / polynucléaire', archipelago: 'Discontinue / archipel', composite: 'Composite / asymétrique' };
const tissues: Record<string, string> = { culture: 'Recettes culturelles par phase', grid: 'Grille orthogonale', organic: 'Organique', radial: 'Radial', terraces: 'Topographique / terrasses', dendritic: 'Ramifié', clusters: 'Groupes autour de communs' };
const parcelOperators: Record<string, string> = { culture: 'Recettes culturelles par phase', strips: 'Bandes de façade', compact: 'Lots compacts', courtyard: 'Cours et enclos', inherited: 'Parcellaire hérité', oriented: 'Subdivision orientée', frontage: 'Territoires de façade', compound: 'Domaines / compounds', wholeBlock: 'Îlot entier', garden: 'Jardin' };
interface Render { view: 'tissue' | 'uses' | 'parcels' | 'buildings'; reserve: boolean; allocated: boolean; centers: boolean; domains: boolean; quarters: boolean; blocks: boolean; streets: boolean; enclosures: boolean; parcels: boolean; gardens: boolean; places: boolean; fronts: boolean; axes: boolean; access: boolean; opacity: number; width: number; palette: 'growth' | 'atlas' | 'ink' | 'terrain' }
type Kind = 'quarters' | 'parcels';

/** `getRaster` replaces `getTerrain` where the raster is already adapted (Urban Bench decors). */
export function createTerrainUrban(options: { map: SVGSVGElement; before: Element | null; getTerrain(): TerrainData | undefined; getRaster?(): SettlementRaster | undefined; getSeed(): string; getAuto?(): boolean; parcelDefault?: boolean; onChange(): void; onPlanChange?(): void; onFocus?(center: Point, radius: number): void; onProjection?(active: boolean, camera?: import('./terrain3d').Terrain3dCamera): boolean | void }) {
  let settlements: SettlementOutput | undefined, roads: RoadOutput | undefined;
  let layouts: Layout[] | undefined, partitions: Partition[] | undefined;
  let initialBuildingState: import('./urbanBuildingsPanel').UrbanBuildingState | undefined;
  let layoutsId: number | undefined;
  let layoutConfig = defaultLayoutConfig(), parcelConfig = defaultParcelConfig();
  let quarterSeed = '', parcelSeed = '', target = '', ready = false;
  let enabled = true, parcelEnabled = options.parcelDefault ?? true, appliedKind: Kind = 'quarters';
  let worker: Worker | undefined, fallback = false, cachedTerrain: TerrainData | SettlementRaster | undefined, id = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const draftTimers: Partial<Record<Kind, ReturnType<typeof setTimeout>>> = {};
  const dirty: Record<Kind, boolean> = { quarters: false, parcels: false };
  let drawnLayer: SVGGElement | undefined, drawnLayouts: Layout[] | undefined, drawnPartitions: Partition[] | undefined, drawnState = '', drawnOpacity = NaN;
  let drawnScene: import('../../../rust/bridge/urbanArchitecture').PlacementBatch | undefined, drawnBuildingAppearance = '';
  // Worker results are immutable snapshots. Weak keys release superseded geometry
  // and retain exact path strings while parcel and display settings are changed.
  const paths = new WeakMap<object, string>(), steps = new WeakMap<object, string>();
  const retainedPath = <T extends object>(source: T, prepare: (source: T) => string): string => {
    let d = paths.get(source);
    if (d === undefined) { d = prepare(source); paths.set(source, d); }
    return d;
  };
  let render: Render = { view: 'parcels', reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false, opacity: 0.8, width: 0.6, palette: 'growth' };
  function restoreState(saved: string | null): boolean {
    if (!saved) return false;
    try {
      const s = JSON.parse(saved);
      const layout = normalizeLayoutConfig(s.layoutConfig, true), parcels = normalizeParcelConfig(s.parcelConfig);
      layoutConfig = layout; parcelConfig = parcels;
      quarterSeed = s.quarterSeed ?? ''; parcelSeed = s.parcelSeed ?? ''; target = s.target ?? '';
      enabled = s.enabled !== false; parcelEnabled = s.parcelEnabled !== false; render = { ...render, ...s.render };
      initialBuildingState = s.buildingState;
      return true;
    } catch { return false; }
  }
  restoreState(new URLSearchParams(location.search).get('urban'));
  const stages = document.querySelector('.stages')!;
  const common = (kind: Kind): string => `<label>Culture<select data-config="culture"><option value="site">Culture de chaque settlement</option>${Object.entries(catalogue.cultures).map(([id, c]) => `<option value="${esc(id)}">${esc(c.label)}</option>`).join('')}</select></label>
    <label>Recettes<select data-config="recipe"></select></label><label>Préréglage<select data-config="preset"><option value="culture">Recettes culturelles</option>${Object.entries(catalogue.presets).map(([id, p]) => `<option value="${esc(id)}">${esc(p.label)}</option>`).join('')}</select></label>
    <label>Zones<select data-config="zone"><option value="auto">Du centre vers la campagne</option>${Object.entries({ core: 'Cœur', middle: 'Quartiers intermédiaires', edge: 'Périphérie', faubourg: 'Faubourgs', village: 'Village' }).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><label>Multiplicateur de densité<input data-config="density" type="number" min="0.1" max="10" step="any"></label>`;
  const number = (key: string, label: string, min: number, max: number, step = 1): string => `<label>${label}<input data-config="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  const select = (key: string, label: string, values: Record<string, string>, footprint = false): string => `<label>${label}<select data-${footprint ? 'footprint' : 'config'}="${key}">${Object.entries(values).map(([id, text]) => `<option value="${id}">${esc(text)}</option>`).join('')}</select></label>`;
  const footprintNumber = (key: string, label: string, min: number, max: number, step = 1): string => number(key, label, min, max, step).replace('data-config=', 'data-footprint=');
  const footprintControls = `<div class="urban-footprint-controls"><div class="control-group">${select('family', 'Forme de ville', families, true)}${select('mechanism', 'Croissance', mechanisms, true)}</div><details class="advanced"><summary>Dimensions et budget</summary><div class="control-group">${select('budget', 'Budget spatial', { population: 'Population / densité brute', radius: 'Rayon artistique' }, true)}${footprintNumber('grossDensity', 'Densité brute (hab./ha · 0 = culture)', 0, 1000, 1)}${footprintNumber('aspect', 'Allongement', 1, 6, 0.1)}${footprintNumber('orientation', 'Orientation (°)', -180, 180, 5)}${footprintNumber('nuclei', 'Noyaux de croissance', 1, 6)}${footprintNumber('irregularity', 'Irrégularité', 0, 1, 0.05)}${footprintNumber('anisotropy', 'Attraction des axes', 0, 1, 0.05)}${footprintNumber('separation', 'Écartement des noyaux', 0.4, 3, 0.1)}${footprintNumber('epochs', 'Époques de croissance', 1, 5)}</div></details><details class="advanced" data-sparse-growth><summary>Dispersion et coupures</summary><div class="control-group">${footprintNumber('cohesion', 'Cohésion', 0, 1, 0.05)}${footprintNumber('satellites', 'Propension aux satellites', 0, 1, 0.05)}${footprintNumber('branchDepth', 'Profondeur des branches', 0, 1, 0.05)}${footprintNumber('gapSize', 'Taille des coupures (m)', 10, 500, 10)}</div><small>Baisser la cohésion laisse plus de terrain libre ; les chemins peuvent le traverser. Les formes géométriques imposées conservent leur contour.</small></details></div>`;
  const tissueControls = `<div class="urban-tissue-controls"><div class="control-group">${select('tissue', 'Maillage des rues', tissues)}${select('accessMode', 'Accessibilité des îlots', { adaptive: 'Adaptative selon le parcellaire', cultural: 'Dessertes culturelles', none: 'Conserver les accès existants' })}</div><details class="advanced"><summary>Réglages des accès</summary><div class="control-group">${number('accessDepth', 'Profondeur accessible (m · 0 = culture)', 0, 200, 5)}${number('accessBudget', 'Accès ajoutés au plus par îlot', 0, 12)}</div></details></div>`;
  const influenceControls = `<details class="advanced"><summary>Influences et sorties</summary><div class="control-group">${select('mixCulture', 'Seconde influence', { '': 'Aucune', ...Object.fromEntries(Object.entries(catalogue.cultures).map(([id, c]) => [id, c.label])) })}${select('mixMode', 'Répartition', { phases: 'Chronologique · extensions plus récentes', sectors: 'Géométrique · secteurs' })}${number('mixShare', 'Part de la seconde influence', 0, 1, 0.05)}${number('mixAngle', 'Orientation des secteurs (°)', -180, 180, 5)}${select('exitTreatment', 'Sorties de rues', { adaptive: 'Raccordements, chemins et impasses', closed: 'Impasses fermées', legacy: 'Ancien comportement' })}${select('peripheralRoad', 'Chemin périphérique', { auto: 'Selon les accès', none: 'Aucun', partial: 'Partiel', full: 'Complet si le terrain le permet' })}${select('axisAlignment', 'Orientation des axes urbains', { regional: 'Routes régionales principales', culture: 'Orientation culturelle' })}${number('siteAdaptation', 'Adaptation au relief et aux berges', 0, 2, 0.1)}</div><small>Les influences suivent les rues et les parcelles. Les sorties et le périphérique respectent l’eau et les pentes ; une enceinte conserve ses portes.</small></details>`;
  const enclosureControls = '<details class="advanced urban-enclosure-controls"><summary>Enceinte</summary><label>Enceinte du noyau<select data-config="fortification"><option value="culture">Selon la culture</option><option value="none">Sans enceinte</option><option value="wall">Muraille</option><option value="palisade">Palissade</option></select></label><button data-remove-enclosure type="button">Retirer l’enceinte</button><small>Retirer recalcule immédiatement le plan ouvert. Les autres choix s’appliquent avec « Régénérer la ville ».</small></details>';
  function panel(kind: Kind, title: string): HTMLDetailsElement {
    const p = document.createElement('details'); p.className = 'stage urban-stage'; p.id = kind === 'quarters' ? 'urbanQuarterStage' : 'urbanParcelStage'; p.open = true;
    p.innerHTML = `<summary>${title}<span data-state></span></summary><div class="stage-controls">
      <div class="urban-actions"><button data-apply type="button">${kind === 'quarters' ? 'Régénérer la ville' : 'Régénérer les parcelles'}</button><small data-status role="status">En attente des settlements…</small></div>
      <small data-draft-state role="status" hidden></small>
      <label><input data-enabled type="checkbox">Générer ${kind === 'quarters' ? 'les quartiers' : 'les parcelles'}</label>
      ${kind === 'quarters' ? '<label>Settlement ciblé<select id="urbanTarget"></select></label><button type="button" id="urbanFocus">Centrer sur la sélection</button>' : '<small>Les parcelles utilisent les îlots du bloc 6, sans régénérer les rues.</small>'}
      <details class="advanced"><summary>Graine</summary><label>Graine ${kind === 'quarters' ? 'quartiers' : 'parcelles'}<input data-seed type="text" placeholder="Graine de la carte"></label></details>
      ${kind === 'quarters' ? `<div class="urban-composition-controls"><label>Génération<select data-config="composition"><option value="settlement">Agglomération complète</option><option value="district">Secteur isolé · ancien banc</option></select></label><small data-mode-hint></small><div data-settlement-settings>${footprintControls}<details class="advanced" data-legacy-settings><summary>Composition historique</summary><label>Composition du lieu<select data-config="settlementForm"><option value="auto">Selon population, culture et accès</option><option value="nucleated">Noyau groupé et faubourgs</option><option value="ribbon">Village-rue</option></select></label><label>Faubourgs<select data-config="suburbs"><option value="auto">Croissance variable</option><option value="none">Aucun</option><option value="few">Quelques faubourgs</option><option value="many">Faubourgs étendus</option></select></label>${number('phases', 'Phases du noyau (0 = culture)', 0, 5)}</details></div>${tissueControls}</div>${enclosureControls}${influenceControls}<details class="advanced"><summary>Diagnostic du plan</summary><div data-composition class="urban-composition" aria-live="polite"></div></details>` : `${select('operator', 'Opérateur parcellaire', parcelOperators)}<small>« Par phase » conserve les recettes du noyau, des extensions et des faubourgs du plan affiché.</small><div data-parcel-diagnostics class="urban-diagnostics" aria-live="polite"></div>`}
      <details class="advanced"><summary>Recettes et dimensions avancées</summary><div class="control-group">${common(kind)}${kind === 'quarters' ? number('count', 'Secteurs de calcul visés', 3, 8) + `<div data-fixture-settings>${number('rings', 'Anneaux de la scène', 1, 2)}<label>Disposition<select data-config="placement"><option value="center">Plan culturel adapté au terrain</option><option value="rectangle">Rectangle</option><option value="skew">Oblique</option><option value="notched">Avec encoche</option></select></label></div>` + number('radius', 'Rayon d’emprise (m · 0 = lieu)', 0, 25000) + number('radiusScale', 'Échelle de l’emprise', 0.1, 5, 0.1) + '<label>Réservation monument<input data-config="monument" type="text" list="urbanMonuments"></label><datalist id="urbanMonuments"><option value="none"><option value="cathedral"><option value="great-mosque"><option value="temple"><option value="castle"><option value="palace"></datalist>' : ''}</div></details>
      ${kind === 'quarters' ? `<details class="advanced"><summary>Rues et relief</summary><div class="control-group">${number('maxStreetGrade', 'Pente maximale des rues (m/m)', 0.02, 0.3, 0.01)}${number('maxLaneGrade', 'Pente maximale des ruelles (m/m)', 0.02, 0.4, 0.01)}<label><input data-config="allowStairs" type="checkbox">Autoriser les escaliers piétons</label>${number('maxStairGrade', 'Pente maximale des escaliers (m/m)', 0.02, 1, 0.01)}</div><small>0,12 = 12 % : 12 m de montée pour 100 m au sol. Les rues cherchent un passage praticable ; les escaliers sont dessinés avec des marches. Les ponts régionaux conservent leur franchissement.</small></details>` : ''}
      <details class="advanced"><summary>Tous les paramètres natifs</summary><div data-fields class="urban-fields"></div><label>Overrides JSON<textarea data-json rows="4" spellcheck="false" placeholder="{}"></textarea></label><small>Les valeurs modifiées remplacent la recette. Les mesures géométriques sont en mètres (surfaces en m²).${kind === 'quarters' ? ' En progression automatique, les valeurs par zone affichées sont celles du cœur ; sélectionnez une zone pour modifier ses valeurs, puis revenez à la progression automatique.' : ''}</small><button data-reset type="button">Réinitialiser les paramètres</button></details>
      ${kind === 'quarters' ? '<small>Relief, rivières et lacs viennent du terrain réel. Les réglages de relief synthétique de l’ancien bench sont remplacés par les blocs 1–3.</small>' : ''}
      <div data-warnings role="status"></div></div>`;
    stages.insertBefore(p, options.before); return p;
  }
  const quarterPanel = panel('quarters', '6 · Empreinte, quartiers et îlots '), parcelPanel = panel('parcels', '7 · Parcelles ');
  const targetSelect = quarterPanel.querySelector<HTMLSelectElement>('#urbanTarget')!;
  const q = <T extends HTMLElement>(p: HTMLElement, selector: string): T => p.querySelector(selector) as T;
  const getConfig = (kind: Kind): LayoutConfig | ParcelConfig => kind === 'quarters' ? layoutConfig : parcelConfig;
  const getPanel = (kind: Kind): HTMLElement => kind === 'quarters' ? quarterPanel : parcelPanel;
  function siteCulture(kind: Kind = 'quarters'): string {
    const site = settlements?.settlements.find(s => s.key === target) ?? settlements?.settlements.slice().sort((a, b) => b.population - a.population)[0];
    return (kind === 'parcels' ? layouts?.find(l => l.key === site?.key)?.culture : undefined) ?? site?.culture ?? 'european-organic';
  }
  function baseline(config: Omit<ParcelConfig, 'operator'>): Record<string, unknown> {
    const c = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(config === parcelConfig ? 'parcels' : 'quarters')];
    const recipe = c?.recipes.find(r => r.id === config.recipe) ?? c?.recipes[0];
    return catalogue.presets[config.preset === 'culture' ? recipe?.preset ?? 'morph/european-organic' : config.preset]?.params ?? {};
  }
  function generationControls(): void {
    const complete = layoutConfig.composition === 'settlement';
    const legacy = layoutConfig.footprint.mechanism === 'legacy';
    for (const [selector, active] of [['[data-settlement-settings]', complete], ['[data-fixture-settings]', !complete], ['[data-legacy-settings]', complete && legacy]] as const) {
      const group = q<HTMLElement>(quarterPanel, selector); group.hidden = !active;
      for (const e of Array.from(group.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select'))) e.disabled = !active;
    }
    for (const e of Array.from(quarterPanel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-footprint]'))) {
      const inactive = legacy && e.dataset.footprint !== 'mechanism';
      e.closest('label')!.hidden = inactive;
      const geometric = ['circle', 'rectangle', 'polygon'].includes(layoutConfig.footprint.family);
      const sparse = ['cohesion', 'satellites', 'branchDepth', 'gapSize'].includes(e.dataset.footprint!);
      e.disabled = !complete || inactive || geometric && sparse || e.dataset.footprint === 'grossDensity' && layoutConfig.footprint.budget !== 'population';
    }
    q<HTMLElement>(quarterPanel, '[data-sparse-growth]').hidden = legacy;
    q<HTMLInputElement>(getPanel('quarters'), '[data-config="radius"]').disabled = complete && !legacy && layoutConfig.footprint.budget !== 'radius';
    q<HTMLInputElement>(getPanel('quarters'), '[data-config="radiusScale"]').disabled = complete && !legacy && layoutConfig.footprint.budget !== 'radius';
    for (const key of ['accessDepth', 'accessBudget']) q<HTMLInputElement>(getPanel('quarters'), `[data-config="${key}"]`).disabled = layoutConfig.accessMode !== 'adaptive';
    const hint = complete ? '' : 'Secteur isolé : sa disposition impose le contour, indépendamment de la culture et du maillage des rues. Choisissez « Agglomération complète » pour une ville adaptée au site.';
    const preset = layoutConfig.preset === 'culture' ? '' : ` Préréglage imposé : ${catalogue.presets[layoutConfig.preset]?.label ?? layoutConfig.preset}. Il remplace les recettes culturelles.`;
    q(quarterPanel, '[data-mode-hint]').textContent = hint + preset;
  }
  function populate(kind: Kind): void {
    const p = getPanel(kind), config = getConfig(kind);
    q<HTMLInputElement>(p, '[data-enabled]').checked = kind === 'quarters' ? enabled : parcelEnabled;
    q<HTMLInputElement>(p, '[data-seed]').value = kind === 'quarters' ? quarterSeed : parcelSeed;
    const culture = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(kind)];
    const recipe = q<HTMLSelectElement>(p, '[data-config="recipe"]');
    recipe.replaceChildren(new Option('Par phase · culture du lieu', 'auto'), ...(culture?.recipes ?? [{ id: 'core', label: 'Cœur', zone: 'core', preset: '' }]).map(r => new Option(r.label, r.id)));
    // A shared recipe may be valid for another settlement culture; Rust validates it per site.
    if (!Array.from(recipe.options).some(o => o.value === config.recipe)) recipe.add(new Option(config.recipe, config.recipe));
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]'))) {
      const value = (config as unknown as Record<string, unknown>)[c.dataset.config!];
      if (c instanceof HTMLInputElement && c.type === 'checkbox') c.checked = Boolean(value); else c.value = String(value ?? '');
    }
    if (kind === 'quarters') {
      for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-footprint]'))) c.value = String(layoutConfig.footprint[c.dataset.footprint as keyof LayoutConfig['footprint']]);
      generationControls();
    }
    const base = baseline(config), fields = q<HTMLElement>(p, '[data-fields]'); fields.replaceChildren();
    for (const key of catalogue.fields[kind]) {
      const raw = config.params[key] ?? base[key] ?? (key === 'deepFill' ? false : 0);
      const zoned = base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key]);
      const overrides = config.params[key] && typeof config.params[key] === 'object' && !Array.isArray(config.params[key]) ? config.params[key] as Record<string, unknown> : {};
      const zone = config.zone === 'auto' ? 'core' : config.zone;
      const value = zoned ? overrides[zone] ?? (base[key] as Record<string, unknown>)[zone] ?? [0, 0] : raw;
      const label = document.createElement('label'); label.title = key;
      const title = document.createElement('span'); title.textContent = labels[key] ?? key; label.append(title);
      if (operators[key]) {
        const select = document.createElement('select'); select.replaceChildren(...operators[key].map(v => new Option(v, v))); select.value = String(value);
        select.onchange = () => { config.params[key] = select.value; }; label.append(select);
      } else if (Array.isArray(value)) {
        const pair = document.createElement('span'); pair.className = 'urban-array';
        value.forEach((v, i) => {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(v); input.title = `${key}${zoned ? `.${zone}` : ''}[${i}]`;
          input.onchange = () => {
            const values = Array.from(pair.querySelectorAll('input')).map(e => Number(e.value));
            const previous = config.params[key];
            const zones = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
            if (values.every(Number.isFinite)) config.params[key] = zoned ? { ...zones, [zone]: values } : values;
          }; pair.append(input);
        }); label.append(pair);
      } else {
        const input = document.createElement('input'); input.type = typeof value === 'boolean' ? 'checkbox' : 'number'; input.step = 'any';
        if (typeof value === 'boolean') input.checked = value; else input.value = String(value);
        input.onchange = () => { config.params[key] = input.type === 'checkbox' ? input.checked : Number(input.value); }; label.append(input);
      }
      fields.append(label);
    }
  }
  const rendering = document.createElement('details'); rendering.className = 'advanced';
  rendering.innerHTML = `<summary>Rendu · empreinte, quartiers et parcelles</summary><div class="control-group">${Object.entries({ reserve: 'Réserve de croissance', allocated: 'Terre urbaine attribuée', centers: 'Noyaux et identités de quartier', domains: 'Domaines réservés', quarters: 'Secteurs de calcul', blocks: 'Îlots', streets: 'Rues urbaines', enclosures: 'Enceintes et portes', parcels: 'Parcelles', gardens: 'Jardins', places: 'Places et communs', fronts: 'Façades accessibles', axes: 'Axes des parcelles', access: 'Statut de desserte des parcelles' }).map(([key, label]) => `<label><input data-render="${key}" type="checkbox">${label}</label>`).join('')}<label>Palette<select data-render="palette"><option value="growth">Phases de croissance</option><option value="atlas">Atlas · quartiers</option><option value="ink">Encre</option><option value="terrain">Terrain</option></select></label><label>Opacité<input data-render="opacity" type="number" min="0" max="1" step="0.05"></label><label>Épaisseur des traits (px)<input data-render="width" type="number" min="0" max="5" step="0.1"></label></div><small>Ces réglages redessinent les résultats conservés, sans appel de génération. La réserve, la terre attribuée et les enceintes sont trois objets différents.</small>`;
  parcelPanel.querySelector('.stage-controls')!.append(rendering);
  for (const e of Array.from(rendering.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-render]'))) {
    const key = e.dataset.render as keyof Render;
    if (e instanceof HTMLInputElement && e.type === 'checkbox') e.checked = Boolean(render[key]); else e.value = String(render[key]);
    e.onchange = () => { (render as unknown as Record<string, unknown>)[key] = e instanceof HTMLInputElement && e.type === 'checkbox' ? e.checked : key === 'palette' ? e.value : Number(e.value); draw(); options.onChange(); };
  }
  let appliedLayout = clone(layoutConfig), appliedParcel = clone(parcelConfig), appliedQuarterSeed = quarterSeed, appliedParcelSeed = parcelSeed;
  let successfulLayout = clone(appliedLayout), successfulParcel = clone(appliedParcel), successfulQuarterSeed = appliedQuarterSeed, successfulParcelSeed = appliedParcelSeed;
  let citySettings: NonNullable<import('./testbenchUrban').WorkshopState['citySettings']> = {};
  const cityDrafts = new Map<string, { layoutConfig: LayoutConfig; parcelConfig: ParcelConfig; quarterSeed: string; parcelSeed: string; dirty: Record<Kind, boolean>; building?: import('./urbanBuildingsPanel').UrbanBuildingDraft }>();
  function rememberCities(keys: string[]): void { for (const key of keys) citySettings[key] = { layoutConfig: clone(successfulLayout), parcelConfig: clone(successfulParcel), quarterSeed: successfulQuarterSeed, parcelSeed: successfulParcelSeed, building: clone({ seed: buildingPanel.state.seed, settings: buildingPanel.state.settings, generated: buildingPanel.state.generated }) }; }
  function retainedState(): import('./testbenchUrban').WorkshopState { return { citySettings, layoutConfig: appliedLayout, parcelConfig: appliedParcel, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, layouts, partitions, buildingState: buildingPanel.state }; }
  function replaceCities(incoming: Layout[], next: Partition[] | undefined, scene?: import('../../../rust/bridge/urbanArchitecture').PlacementBatch): import('./testbenchUrban').WorkshopState {
    const state = retainedState();
    return mergeWorkshopCities(state, { ...state, citySettings, layouts: incoming, partitions: next, buildingState: { ...buildingPanel.state, scene } });
  }
  let lastBuildingAppearance = '';
  let lastBuiltScene: import('../../../rust/bridge/urbanArchitecture').PlacementBatch | undefined;
  const sceneClient = createUrbanSceneClient();
  const buildingPanel = createUrbanBuildingsPanel({ host: stages,
    getProgramme: () => appliedLayout.programme,
    applyProgramme: programme => { layoutConfig.programme = clone(programme); appliedLayout = { ...clone(appliedLayout), programme: clone(programme) }; request('quarters'); options.onChange(); },
    generate: async (seed, settings, onProgress) => {
      if (!layouts || !partitions) throw new Error('Générez les parcelles avant les bâtiments.');
      if (target === 'all' && layouts.length > 1) throw new Error('Choisissez une ville avant d’implanter ses bâtiments.');
      const inputLayouts = layouts, inputPartitions = partitions;
      const selectedLayouts = layouts.filter(layout => target === 'all' || layout.key === target), selectedPartitions = partitions.filter(partition => selectedLayouts.some(layout => layout.key === partition.key));
      if (!selectedLayouts.length) throw new Error('Le plan de la ville sélectionnée est absent.');
      const source = options.getRaster?.() ?? options.getTerrain();
      if (!source) throw new Error('Le terrain d’appui est absent.');
      const raster = 'n' in source ? source : { ...settlementRaster(source, 1024), geometry: terrainGeography(source) };
      const response = await sceneClient.run({ raster, layouts: selectedLayouts, partitions: selectedPartitions, seed: seed || appliedParcelSeed || options.getSeed(), settings, runtime: executionRuntime }, onProgress);
      if (layouts !== inputLayouts || partitions !== inputPartitions) throw new DOMException('Plan remplacé', 'AbortError');
      if (!response.scene) throw new Error('La scène bâtie est absente.');
      const merged = replaceCities(selectedLayouts, response.partitions ?? selectedPartitions, response.scene);
      partitions = merged.partitions;
      return { scene: merged.buildingState!.scene!, timing: response.timing };
    },
    onChange: state => { const changedScene = state.scene !== lastBuiltScene, appearance = JSON.stringify({ visible: state.visible, appearance: state.appearance }); if (state.scene && changedScene) render.view = 'buildings'; const changedAppearance = appearance !== lastBuildingAppearance; lastBuiltScene = state.scene; lastBuildingAppearance = appearance; if (target !== 'all') rememberCities([target]); draw(); options.onChange(); if (changedScene || changedAppearance) options.onPlanChange?.(); }, onOpen: openUrbanHouseCase,
    onProjection: active => { const applied = options.onProjection?.(active, buildingPanel.state.camera); if (typeof applied === 'boolean') buildingPanel.state.projection = applied; },
  });
  if (options.before) options.before.before(buildingPanel.programme, buildingPanel.panel);
  buildingPanel.restore(initialBuildingState);
  let completeGeneration = false;
  let resetBuildingDefaults = false;
  installSettlementStyles(quarterPanel.querySelector('.stage-controls')!, style => {
    const next = applySettlementStyle(style, layoutConfig);
    layoutConfig = next.layout; parcelConfig = next.parcels;
    for (const kind of ['quarters', 'parcels'] as const) { q<HTMLTextAreaElement>(getPanel(kind), '[data-json]').value = ''; populate(kind); }
    buildingPanel.setBuildingDraft({ ...buildingPanel.state, settings: undefined });
    resetBuildingDefaults = true;
    changed('quarters'); changed('parcels');
  }, () => {
    try {
      for (const kind of ['quarters', 'parcels'] as const) { clearTimeout(draftTimers[kind]); read(kind); }
      enabled = parcelEnabled = true; completeGeneration = true;
      populate('quarters'); populate('parcels'); request('quarters'); options.onChange();
    } catch (error) { completeGeneration = false; status('quarters', String(error)); }
  });
  const views = document.createElement('nav'); views.className = 'urban-view-tabs'; views.setAttribute('aria-label', 'Vue du plan urbain');
  for (const [view, label] of Object.entries({ tissue: 'Tissu', uses: 'Usages', parcels: 'Parcelles', buildings: 'Bâtiments' })) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.urbanView = view;
    button.onclick = () => { render.view = view as Render['view']; draw(); options.onChange(); options.onPlanChange?.(); }; views.append(button);
  }
  parcelPanel.querySelector('.stage-controls')!.prepend(views);
  const help = document.createElement('button'); help.type = 'button'; help.textContent = '?'; help.title = 'Méthode du parcellaire et des accès'; help.onclick = () => openMethodNote('urban-parcels'); views.append(help);
  const inspection = document.createElement('section'); inspection.className = 'urban-parcel-inspection';
  inspection.setAttribute('aria-live', 'polite'); parcelPanel.querySelector('.stage-controls')!.append(inspection);
  options.map.addEventListener('click', event => {
    const building = (event.target as Element).closest('[data-urban-building]');
    if (building) { buildingPanel.select(building.getAttribute('data-urban-building')!); return; }
    const path = (event.target as Element).closest<SVGPathElement>('[data-inspect-parcel]');
    if (!path) return;
    const layout = layouts?.find(l => l.key === path.dataset.layoutKey);
    const parcel = partitions?.find(p => p.key === layout?.key)?.parcels[Number(path.dataset.inspectParcel)];
    if (layout && parcel) inspection.innerHTML = parcelInspectionHtml(parcel, layout, Number(path.dataset.inspectParcel));
  });
  function read(kind: Kind, commit = true): void {
    const p = getPanel(kind), config = getConfig(kind);
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]'))) {
      if (c.disabled) continue;
      if (!c.checkValidity()) { c.reportValidity(); throw new Error('Corrigez les paramètres signalés.'); }
      (config as unknown as Record<string, unknown>)[c.dataset.config!] = configValue(c);
    }
    if (kind === 'quarters') for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-footprint]'))) {
      if (c.disabled) continue;
      if (!c.checkValidity()) { c.reportValidity(); throw new Error('Corrigez les paramètres d’empreinte signalés.'); }
      (layoutConfig.footprint as unknown as Record<string, unknown>)[c.dataset.footprint!] = configValue(c);
    }
    const json = q<HTMLTextAreaElement>(p, '[data-json]').value.trim();
    if (json) {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Les overrides doivent être un objet JSON.');
      for (const key of Object.keys(parsed)) if (!catalogue.fields[kind].includes(key)) throw new Error(`Paramètre inconnu à cette étape : ${key}`);
      for (const [key, value] of Object.entries(parsed)) {
        const previous = config.params[key];
        config.params[key] = value && typeof value === 'object' && !Array.isArray(value) && previous && typeof previous === 'object' && !Array.isArray(previous)
          ? { ...previous, ...value } : value;
      }
    }
    if (!commit) return;
    if (kind === 'quarters') { quarterSeed = q<HTMLInputElement>(p, '[data-seed]').value; appliedLayout = clone(layoutConfig); appliedQuarterSeed = quarterSeed; }
    else { parcelSeed = q<HTMLInputElement>(p, '[data-seed]').value; appliedParcel = clone(parcelConfig); appliedParcelSeed = parcelSeed; }
    dirty[kind] = false;
    q(getPanel(kind), '[data-draft-state]').hidden = true;
  }
  function apply(kind: Kind): void {
    clearTimeout(draftTimers[kind]);
    try { read(kind); populate(kind); request(kind); options.onChange(); }
    catch (error) { status(kind, String(error)); }
  }
  function changed(kind: Kind): void {
    dirty[kind] = true;
    const hint = q(getPanel(kind), '[data-draft-state]'); hint.hidden = false;
    hint.textContent = options.getAuto?.() ? 'Modifications en attente · application automatique…' : `Modifications non appliquées · cliquez sur « ${kind === 'quarters' ? 'Régénérer la ville' : 'Régénérer les parcelles'} ».`;
    clearTimeout(draftTimers[kind]);
    try { read(kind, false); options.map.dispatchEvent(new CustomEvent('urban:settings', { detail: { layoutConfig: clone(layoutConfig), parcelConfig: clone(parcelConfig), quarterSeed: q<HTMLInputElement>(getPanel('quarters'), '[data-seed]').value, parcelSeed: q<HTMLInputElement>(getPanel('parcels'), '[data-seed]').value } })); } catch { /* Keep invalid drafts local. */ }
    if (options.getAuto?.()) draftTimers[kind] = setTimeout(() => {
      if (options.getAuto?.()) apply(kind);
    }, 220);
  }
  function status(kind: Kind, text: string, busy = false): void {
    const p = getPanel(kind); q(p, '[data-status]').textContent = text;
    q<HTMLButtonElement>(p, '[data-apply]').setAttribute('aria-busy', String(busy));
  }
  function request(kind: Kind): void {
    clearTimeout(timer);
    const source = options.getRaster ? options.getRaster() : options.getTerrain();
    if (!ready || !source || !settlements) return;
    if (kind === 'quarters' && !enabled || kind === 'parcels' && !parcelEnabled) return;
    if (kind === 'parcels' && !layouts) { status(kind, 'Générez d’abord les quartiers (bloc 6).'); return; }
    if (!worker && !fallback) {
      try { worker = new UrbanWorker(); worker.onmessage = (e: MessageEvent<UrbanResponse>) => receive(e.data); worker.onerror = e => { e.preventDefault(); useFallback(); }; }
      catch { fallback = true; }
    }
    const selected = settlements.settlements.filter(s => target === 'all' || s.key === target);
    const message: UrbanRequest = { id: ++id, kind, seed: kind === 'quarters' ? appliedQuarterSeed || options.getSeed() : appliedParcelSeed || options.getSeed(), runtime: executionRuntime };
    if (cachedTerrain !== source) {
      // The worker takes ownership of the buffers: a retained raster is copied.
      const r = 'n' in source ? source : { ...settlementRaster(source, 1024), geometry: terrainGeography(source) };
      message.raster = r === source ? { ...r, height: r.height.slice(), water: r.water.slice(), waterLevel: r.waterLevel.slice(), riverWidth: r.riverWidth.slice(), riverIds: r.riverIds.slice() } : r;
      cachedTerrain = source;
    }
    if (kind === 'quarters') {
      message.layoutConfig = clone(appliedLayout); message.sites = selected.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));
      message.roads = regionalStreets(roads);
    } else {
      // The worker retains the exact serialized layout of its quarter response.
      // A restarted engine receives the full plan to recover independently.
      message.layouts = layouts!.filter(layout => target === 'all' || layout.key === target);
      message.parcelConfig = clone(appliedParcel);
    }
    appliedKind = kind;
    status(kind, `Rust · génération ${kind === 'quarters' ? 'des quartiers' : 'des parcelles'}…`, true);
    if (fallback) void runUrbanRequest(message).then(receive, error => receive({ id: message.id, error: String(error) }));
    else try { const r = message.raster; worker!.postMessage(message, r ? [r.height.buffer, r.water.buffer, r.waterLevel.buffer, r.riverWidth.buffer, r.riverIds.buffer] : []); } catch { useFallback(); }
  }
  function useFallback(): void { worker?.terminate(); worker = undefined; fallback = true; cachedTerrain = undefined; request(appliedKind); }
  function receive(response: UrbanResponse): void {
    if (response.id !== id) return;
    if (response.error) {
      completeGeneration = false;
      cachedTerrain = undefined;
      if (appliedKind === 'quarters') { appliedLayout = clone(successfulLayout); appliedQuarterSeed = successfulQuarterSeed; }
      else { appliedParcel = clone(successfulParcel); appliedParcelSeed = successfulParcelSeed; }
      dirty[appliedKind] = true; q(getPanel(appliedKind), '[data-draft-state]').hidden = false;
      q(getPanel(appliedKind), '[data-draft-state]').textContent = 'Calcul refusé · le dernier plan appliqué est conservé.';
      status(appliedKind, response.error); options.onChange(); return;
    }
    if (response.layouts) {
      if (resetBuildingDefaults) { buildingPanel.resetAppliedSettings(); resetBuildingDefaults = false; }
      successfulLayout = clone(appliedLayout); successfulQuarterSeed = appliedQuarterSeed;
      const merged = replaceCities(response.layouts, undefined);
      sceneClient.invalidate(); buildingPanel.invalidate();
      layouts = merged.layouts; layoutsId = undefined; partitions = merged.partitions; buildingPanel.replaceScene(merged.buildingState?.scene); lastBuiltScene = buildingPanel.state.scene;
      rememberCities(response.layouts.map(layout => layout.key));
      populate('parcels');
      const count = (layouts ?? []).reduce((n, l) => n + l.blocks.length, 0);
      status('quarters', `Rust · ${layouts?.length ?? 0} settlement(s) · ${count} îlots · ${response.ms?.toFixed(0)} ms`);
      q(quarterPanel, '[data-state]').textContent = `${count} îlots`;
      q(quarterPanel, '[data-warnings]').textContent = (layouts ?? []).flatMap(l => l.warnings.map(w => `${l.key} : ${w}`)).join('\n');
      if (parcelEnabled) request('parcels'); else status('parcels', 'Génération des parcelles désactivée.');
    }
    if (response.partitions) {
      successfulParcel = clone(appliedParcel); successfulParcelSeed = appliedParcelSeed;
      const incoming = layouts!.filter(layout => response.partitions!.some(partition => partition.key === layout.key));
      const merged = replaceCities(incoming, response.partitions);
      sceneClient.invalidate(); buildingPanel.invalidate();
      partitions = merged.partitions; buildingPanel.replaceScene(merged.buildingState?.scene); lastBuiltScene = buildingPanel.state.scene;
      rememberCities(incoming.map(layout => layout.key));
      const count = (partitions ?? []).reduce((n, p) => n + p.parcels.length, 0);
      status('parcels', `Rust · ${count} parcelles · ${response.ms?.toFixed(0)} ms`);
      q(parcelPanel, '[data-state]').textContent = `${count} parcelles`;
      q(parcelPanel, '[data-warnings]').textContent = (partitions ?? []).flatMap(p => p.warnings.map(w => `${p.key} : ${w}`)).join('\n');
      if (completeGeneration) {
        completeGeneration = false; initialBuildingState = undefined;
        if (target === 'all' && layouts!.length > 1) status('parcels', 'Plan prêt · choisissez une ville pour implanter ses bâtiments.');
        else void buildingPanel.generate();
      } else if (initialBuildingState?.generated || buildingPanel.state.generated) { initialBuildingState = undefined; void buildingPanel.generate({ seed: buildingPanel.state.seed, settings: buildingPanel.state.settings }); }
    }
    draw(); options.onChange();
  }
  const palette = ['#dfb973', '#90bdc7', '#c5a3ce', '#a0bc84', '#d29c8e', '#bdc4d5'];
  const zoneColors: Record<string, string> = { core: '#dfb973', middle: '#bfa4ca', edge: '#91bdc5', faubourg: '#a0bc84', village: '#dfb973' };
  const phaseLabel = (kind: string, zone: string): string => kind === 'faubourg' ? 'Faubourgs' : kind === 'hamlet' ? 'Hameau' : kind === 'village' ? 'Noyau villageois' : zone === 'core' ? 'Cœur' : zone === 'middle' ? 'Extension' : 'Périphérie';
  let reportedLayouts: Layout[] | undefined, reportedPartitions: Partition[] | undefined;
  let compositionEnabled: boolean | undefined, diagnosticsEnabled: boolean | undefined;
  function compositionReport(): void {
    if (reportedLayouts === layouts && compositionEnabled === enabled) return;
    reportedLayouts = layouts; compositionEnabled = enabled;
    const box = q<HTMLElement>(quarterPanel, '[data-composition]');
    if (!enabled || !layouts) { box.replaceChildren(); return; }
    const names: Record<string, string> = { town: 'Bourg / ville', 'nucleated-village': 'Village groupé', 'street-village': 'Village-rue', hamlet: 'Hameau', district: 'Secteur isolé' };
    const hectares = (a: number): string => `${(a / 1e4).toFixed(2)} ha`;
    const historyNames: Record<string, string> = { foundation: 'Fondation', growth: 'Croissance', extension: 'Extension', absorption: 'Absorption d’un noyau', merge: 'Fusion de noyaux', enclosure: 'Agrandissement d’enceinte', access: 'Ouverture d’un accès', 'planned-extension': 'Extension planifiée', 'nucleus-absorption': 'Absorption d’un noyau', 'nucleus-growth': 'Croissance d’un noyau', 'nucleus-merger': 'Fusion de noyaux', 'road-accretion': 'Accrétion le long d’une voie', 'accessible-extension': 'Extension par accessibilité' };
    box.innerHTML = layouts.map(l => {
      const structure = l.structure, metrics = structure?.metrics;
      return `<article><strong>${esc(names[l.archetype ?? 'district'] ?? l.archetype ?? 'Lieu')}${layouts!.length > 1 ? ` · ${esc(l.key)}` : ''}</strong>${structure ? `<small data-growth-method>${esc(mechanisms[structure.mechanism] ?? structure.mechanism)} · ${esc(families[structure.family] ?? structure.family)}</small>` : ''}${metrics ? `<dl class="urban-metrics" data-urban-metrics><dt>Surface cible</dt><dd>${hectares(metrics.targetArea)}</dd><dt>Terre attribuée</dt><dd>${hectares(metrics.allocatedArea)}</dd><dt>Voirie et limites</dt><dd>${hectares(metrics.streetArea)}</dd><dt>Réserves et espaces communs</dt><dd>${hectares(metrics.reservedArea)}</dd><dt>Densité brute appliquée</dt><dd>${metrics.grossDensity.toFixed(1)} hab./ha</dd><dt>Population de planification</dt><dd>${Math.round(metrics.plannedPopulation).toLocaleString()} hab.</dd><dt>Déficit de surface</dt><dd>${hectares(metrics.shortfallArea)}</dd><dt>Noyaux / composantes</dt><dd>${structure!.centers.length} / ${metrics.components}</dd><dt>Accès ajoutés</dt><dd>${metrics.accessAdded}</dd></dl><small>Ces budgets précèdent les bâtiments ; ils ne mesurent pas une capacité d’hébergement.</small>` : ''}${l.phases?.length ? `<table><caption>Composition appliquée · population prévue et emprise sèche</caption><thead><tr><th>Phase</th><th>Hab.</th><th>ha</th></tr></thead><tbody>${l.phases.map((p, i) => `<tr data-phase="${i}" data-kind="${esc(p.kind)}"><th><span class="urban-swatch" style="background:${p.kind === 'faubourg' ? zoneColors.faubourg : zoneColors[p.zone] ?? '#a0bc84'}"></span>${phaseLabel(p.kind, p.zone)}<small>${esc(p.recipe)} · ${l.quarters.filter(q => q.phase === i).length} secteurs</small></th><td>${Math.round(p.population).toLocaleString()}</td><td title="Emprise prévue : ${hectares(p.targetArea)}">${(p.shapes.reduce((sum, s) => sum + shapeArea(s), 0) / 1e4).toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '<small>Une seule recette dans une emprise de travail. Choisissez « Agglomération complète » pour évaluer un lieu entier.</small>'}${structure ? `<details class="advanced"><summary>Identités et histoire appliquées</summary><ul>${structure.districts.map(d => `<li data-district="${esc(String(d.id))}">Q${d.id + 1} · noyau ${d.center + 1} · ${esc(tissues[d.tissue] ?? d.tissue)} · phase ${d.phase + 1} · ${d.quarters.length} secteurs</li>`).join('')}</ul><ol>${structure.history.map(h => `<li data-epoch="${h.epoch}">Époque ${h.epoch + 1} · ${esc(historyNames[h.kind] ?? h.kind)} · noyau ${h.center + 1} · ${hectares(h.area)}</li>`).join('')}</ol></details>` : ''}</article>`;
    }).join('');
  }
  function parcelReport(): void {
    const active = enabled && parcelEnabled;
    if (reportedPartitions === partitions && diagnosticsEnabled === active) return;
    reportedPartitions = partitions; diagnosticsEnabled = active;
    const box = q<HTMLElement>(parcelPanel, '[data-parcel-diagnostics]');
    if (!enabled || !parcelEnabled || !partitions) { box.replaceChildren(); return; }
    const accessNames: Record<string, string> = { public: 'public', collective: 'collectif', private: 'privé', unserved: 'sans desserte', reserved: 'réservé' };
    box.innerHTML = partitions.map(p => {
      const d = p.diagnostics;
      const counts = p.parcels.reduce<Record<string, number>>((result, parcel) => { if (parcel.access) result[parcel.access.kind] = (result[parcel.access.kind] ?? 0) + 1; return result; }, {});
      return `<article>${partitions!.length > 1 ? `<strong>${esc(p.key)}</strong>` : ''}${Object.keys(counts).length ? `<small data-access-summary>Accès : ${Object.entries(counts).map(([kind, n]) => `${n} ${accessNames[kind] ?? kind}`).join(' · ')}</small>` : ''}${d ? `<dl class="urban-metrics" data-parcel-metrics><dt>Surface couverte</dt><dd>${(d.coveredArea / 1e4).toFixed(2)} ha</dd><dt>Résidu non attribué</dt><dd>${d.residualArea.toFixed(2)} m²</dd><dt>Chevauchement</dt><dd>${d.overlapArea.toFixed(2)} m²</dd><dt>Terre sans desserte</dt><dd>${(d.unservedArea / 1e4).toFixed(2)} ha</dd></dl>` : ''}</article>`;
    }).join('');
  }
  function identityScale(layer: SVGGElement): void {
    const pixel = options.map.viewBox.baseVal.width / Math.max(1, options.map.getBoundingClientRect().width);
    for (const p of Array.from(layer.querySelectorAll<SVGPathElement>('[data-urban-center]'))) {
      const x = Number(p.dataset.centerX), y = Number(p.dataset.centerY), half = pixel * 5;
      p.setAttribute('d', path([{ x: x - half, y }, { x: x + half, y }]) + ' ' + path([{ x, y: y - half }, { x, y: y + half }]));
    }
    for (const text of Array.from(layer.querySelectorAll<SVGTextElement>('[data-urban-district]'))) {
      text.setAttribute('x', String(Number(text.dataset.centerX) + pixel * 8));
      text.setAttribute('y', String(Number(text.dataset.centerY) + pixel * 13 * (Number(text.dataset.phase) + 1)));
      text.setAttribute('font-size', String(pixel * 11));
    }
  }
  function draw(): void {
    for (const button of Array.from(views.querySelectorAll<HTMLButtonElement>('[data-urban-view]'))) button.setAttribute('aria-pressed', String(button.dataset.urbanView === render.view));
    buildingPanel.updateProgrammes((partitions ?? layouts ?? []).flatMap(p => p.programme ? [p.programme] : []));
    // Regional pieces are clipped before smoothing so their rendered endpoints
    // meet the retained native junctions, including at water crossings.
    options.map.dispatchEvent(new CustomEvent('urban:road-ownership', {
      detail: enabled && render.streets ? layouts : undefined,
    }));
    let layer = options.map.querySelector<SVGGElement>('#urbanOverlay');
    if (!layer) { layer = document.createElementNS(ns, 'g'); layer.id = 'urbanOverlay'; layer.style.pointerEvents = 'none'; options.map.insertBefore(layer, options.map.querySelector('#roadOverlay, #settlementOverlay')); }
    const { opacity, ...appearance } = render;
    const state = JSON.stringify({ enabled, parcelEnabled, render: appearance });
    if (layer !== drawnLayer || opacity !== drawnOpacity) { layer.setAttribute('opacity', String(opacity)); drawnOpacity = opacity; }
    updateUrbanBuildingSelection(layer, buildingPanel.state.scene, buildingPanel.state.selected);
    const buildingAppearance = JSON.stringify({ visible: buildingPanel.state.visible, appearance: buildingPanel.state.appearance });
    if (layer === drawnLayer && layouts === drawnLayouts && partitions === drawnPartitions && state === drawnState && drawnScene === buildingPanel.state.scene && drawnBuildingAppearance === buildingAppearance) { if (render.centers) identityScale(layer); return; }
    const planChanged = drawnLayouts !== layouts || drawnPartitions !== partitions || drawnScene !== buildingPanel.state.scene;
    drawnScene = buildingPanel.state.scene; drawnBuildingAppearance = buildingAppearance;
    compositionReport();
    parcelReport();
    drawnLayer = layer; drawnLayouts = layouts; drawnPartitions = partitions; drawnState = state; layer.replaceChildren();
    if (planChanged) options.onPlanChange?.();
    if (!enabled || !layouts) return;
    const content = document.createDocumentFragment();
    const add = (d: string, fill: string, stroke: string, width: number, scalable = false): SVGPathElement => {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', String(width)); p.setAttribute('fill-rule', 'evenodd');
      if (!scalable) p.setAttribute('vector-effect', 'non-scaling-stroke'); p.setAttribute('stroke-linejoin', 'round'); content.append(p); return p;
    };
    const stroke = render.palette === 'ink' ? '#3c3024' : '#655847';
    for (const l of layouts) {
      const growthColor = (quarter: number, phase?: number): string => { const q = l.quarters[quarter], p = l.phases?.[phase ?? q?.phase]; return p?.kind === 'faubourg' ? zoneColors.faubourg : zoneColors[p?.zone ?? q?.zone ?? 'core'] ?? zoneColors.core; };
      if (render.reserve) for (const shape of l.structure?.reserve ?? []) {
        const p = add(retainedPath(shape, shapePath), '#6a8eb1', '#416784', render.width * 2);
        p.dataset.urbanSurface = 'reserve'; p.setAttribute('fill-opacity', '0.08'); p.setAttribute('stroke-dasharray', '7 4');
      }
      if (render.allocated) for (const shape of l.structure?.allocated ?? []) {
        const p = add(retainedPath(shape, shapePath), '#c0a366', '#8a632d', render.width * 2);
        p.dataset.urbanSurface = 'allocated'; p.setAttribute('fill-opacity', '0.12');
      }
      if (render.quarters) for (const [i, quarter] of l.quarters.entries()) add(retainedPath(quarter.shape, shapePath), 'none', render.palette === 'growth' ? growthColor(i) : palette[i % palette.length], render.width * 2).setAttribute('stroke-dasharray', '4 3');
      const peripheral = (quarter: number, zone?: string, phase?: number): boolean => { const p = l.phases?.[phase ?? l.quarters[quarter]?.phase]; return p?.kind === 'faubourg' || ['edge', 'faubourg', 'village'].includes(p?.zone ?? zone ?? l.quarters[quarter]?.zone ?? 'core') && !(l.enclosures?.length); };
      if (['tissue', 'parcels'].includes(render.view) && (render.blocks || render.domains)) for (const block of l.blocks) {
        if (block.kind.startsWith('reserve') ? !render.domains : !render.blocks) continue;
        const p = add(retainedPath(block.shape, shapePath), render.palette === 'terrain' ? 'none' : render.palette === 'ink' ? '#e3d1b5' : block.kind.startsWith('reserve') ? '#cbc2a8' : block.kind === 'common' ? '#adc5bf' : render.palette === 'growth' ? growthColor(block.quarter, block.phase) : palette[block.quarter % palette.length], stroke, render.width);
        p.dataset.phase = String(block.phase ?? l.quarters[block.quarter]?.phase ?? 0);
        p.dataset.blockKind = block.kind;
        if (block.kind.startsWith('reserve')) p.setAttribute('stroke-dasharray', '3 2');
        if (peripheral(block.quarter, block.zone, block.phase)) { p.setAttribute('fill-opacity', '0.55'); p.setAttribute('stroke-opacity', '0.35'); }
      }
      const partition = parcelEnabled ? partitions?.find(p => p.key === l.key) : undefined;
      for (const [i, parcel] of (partition?.parcels ?? []).entries()) {
        if (render.view !== 'tissue' && ((['plot', 'compound', 'residual', 'court'].includes(parcel.use) && render.parcels) || (parcel.use === 'garden' && render.gardens) || (['place', 'market', 'common'].includes(parcel.use) && render.places) || parcel.use === 'reserve' && render.domains)) {
          const fill = render.palette === 'terrain' ? 'none' : render.palette === 'ink' ? '#eee0c9' : parcel.use === 'garden' ? '#a8bc89' : parcel.use === 'reserve' ? '#cbc2a8' : parcel.use === 'common' ? '#adc5bf' : parcel.use === 'place' ? '#e6d1a5' : render.palette === 'growth' ? growthColor(l.blocks[parcel.block]?.quarter ?? -1, l.blocks[parcel.block]?.phase) : palette[i % palette.length];
          const p = add(retainedPath(parcel.shape, shapePath), render.view === 'parcels' ? fill : 'transparent', render.view === 'parcels' ? stroke : 'none', render.width);
          p.dataset.parcelUse = parcel.use;
          p.dataset.inspectParcel = String(i); p.dataset.layoutKey = l.key; p.style.pointerEvents = 'all';
          if (peripheral(l.blocks[parcel.block]?.quarter ?? -1, l.blocks[parcel.block]?.zone, l.blocks[parcel.block]?.phase)) { p.setAttribute('fill-opacity', '0.65'); p.setAttribute('stroke-opacity', '0.5'); }
        }
        if (render.fronts && parcel.front) add(path(parcel.front), 'none', '#a92d34', render.width * 2);
        if (render.access && parcel.access) {
          const colors = { public: '#26815d', collective: '#456fba', private: '#aa6dad', unserved: '#cc383c', reserved: '#81725b', attached: '#91a36d' };
          const p = add(retainedPath(parcel.shape, shapePath), colors[parcel.access.kind], colors[parcel.access.kind], render.width * 1.5);
          p.dataset.parcelAccess = parcel.access.kind; p.setAttribute('fill-opacity', '0.25');
        }
        if (render.axes && parcel.shape.outer.length) {
          const vertices = parcel.shape.outer, center = vertices.reduce((c, p) => ({ x: c.x + p.x / vertices.length, y: c.y + p.y / vertices.length }), { x: 0, y: 0 });
          add(path([{ x: center.x - parcel.axis.x * 4, y: center.y - parcel.axis.y * 4 }, { x: center.x + parcel.axis.x * 4, y: center.y + parcel.axis.y * 4 }]), 'none', '#396781', render.width);
        }
      }
      if (render.streets) for (const street of l.streets) {
        const p = add(retainedPath(street, streetSurfacePath), render.palette === 'ink' ? '#6b5640' : street.role === 'collective' ? '#ccdacf' : street.role === 'private' ? '#d9cddf' : '#f3dfb3', 'none', 0, true);
        p.setAttribute('fill-rule', 'nonzero');
        p.dataset.streetRole = street.role;
        if (street.role === 'stairs') {
          let d = steps.get(street);
          if (d === undefined) { d = stairMarks(street.path, street.widths); steps.set(street, d); }
          add(d, 'none', '#705d45', 0.3, true).dataset.streetRole = 'steps';
        }
      }
      if (render.enclosures) for (const enclosure of l.enclosures ?? []) {
        const d = retainedPath(enclosure, e => enclosurePath(e.path, e.gates)), palisade = enclosure.kind === 'palisade';
        const wall = add(d, 'none', palisade ? '#72533a' : '#544d43', palisade ? 2 : 3.5, true);
        wall.dataset.enclosure = enclosure.kind;
        if (palisade) wall.setAttribute('stroke-dasharray', '1.3 0.5');
        else add(d, 'none', '#b6a793', 1.7, true);
      }
      if (render.centers && l.structure) {
        for (const center of l.structure.centers) {
          const p = center.point;
          const marker = add('', 'none', '#a43526', Math.max(1, render.width * 2));
          marker.dataset.urbanCenter = String(center.id); marker.dataset.centerX = String(p.x); marker.dataset.centerY = String(p.y);
        }
        for (const district of l.structure.districts) {
          const center = l.structure.centers.find(c => c.id === district.center)?.point;
          if (!center) continue;
          const text = document.createElementNS(ns, 'text'); text.setAttribute('x', String(center.x + 12)); text.setAttribute('y', String(center.y + 12 * (district.phase + 1))); text.setAttribute('font-size', '8'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('fill', '#534235');
          text.textContent = `Q${district.id + 1}`; text.dataset.urbanDistrict = String(district.id); content.append(text);
          text.dataset.centerX = String(center.x); text.dataset.centerY = String(center.y); text.dataset.phase = String(district.phase);
        }
      }
    }
    layer.append(content);
    if (render.view === 'uses') layer.insertAdjacentHTML('beforeend', programmeSvg(partitions));
    if (buildingPanel.state.appearance.diagnostic === 'access') layer.insertAdjacentHTML('beforeend', refusalSvg(partitions, buildingPanel.state.scene));
    if (render.view === 'buildings' && buildingPanel.state.visible) {
      layer.insertAdjacentHTML('beforeend', urbanBuildingsSvg(buildingPanel.state.scene, buildingPanel.state.appearance));
      for (const item of Array.from(layer.querySelectorAll<SVGElement>('[data-urban-building]'))) item.style.pointerEvents = 'all';
    }
    updateUrbanBuildingSelection(layer, buildingPanel.state.scene, buildingPanel.state.selected);
    if (render.centers) identityScale(layer);
  }
  function schedule(): void { clearTimeout(timer); timer = setTimeout(() => request('quarters'), 120); }
  q<HTMLButtonElement>(quarterPanel, '[data-remove-enclosure]').onclick = () => {
    layoutConfig.fortification = 'none';
    appliedLayout = { ...appliedLayout, fortification: 'none' };
    q<HTMLSelectElement>(quarterPanel, '[data-config="fortification"]').value = 'none';
    request('quarters'); options.onChange();
  };
  for (const kind of ['quarters', 'parcels'] as const) {
    const p = getPanel(kind);
    q<HTMLButtonElement>(p, '[data-apply]').onclick = () => apply(kind);
    q<HTMLInputElement>(p, '[data-enabled]').onchange = e => {
      const checked = (e.target as HTMLInputElement).checked;
      if (!checked) { sceneClient.invalidate(); buildingPanel.invalidate(); }
      if (kind === 'quarters') {
        ++id; enabled = checked;
        if (!enabled) { layouts = undefined; partitions = undefined; status('quarters', 'Génération des quartiers désactivée.'); status('parcels', 'En attente des quartiers…'); }
        else schedule();
      } else {
        if (appliedKind === 'parcels') ++id;
        parcelEnabled = checked; partitions = undefined;
        if (checked) { if (layouts) request('parcels'); else if (enabled) schedule(); }
        else status('parcels', 'Génération des parcelles désactivée.');
      }
      draw(); options.onChange();
    };
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]'))) c.onchange = () => {
      (getConfig(kind) as unknown as Record<string, unknown>)[c.dataset.config!] = configValue(c);
      if (c.dataset.config === 'composition') {
        if (layoutConfig.composition === 'settlement') { layoutConfig.placement = 'center'; layoutConfig.recipe = 'auto'; layoutConfig.zone = 'auto'; }
        else if (layoutConfig.recipe === 'auto') layoutConfig.recipe = 'core';
      }
      if (['zone', 'composition', 'placement'].includes(c.dataset.config!)) populate(kind);
      if (kind === 'quarters' && c.dataset.config === 'accessMode') generationControls();
    };
    for (const c of Array.from(p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-footprint]'))) c.onchange = () => {
      (layoutConfig.footprint as unknown as Record<string, unknown>)[c.dataset.footprint!] = configValue(c);
      if (['mechanism', 'budget', 'family'].includes(c.dataset.footprint!)) generationControls();
    };
    q<HTMLInputElement>(p, '[data-seed]').oninput = e => {
      if (kind === 'quarters') quarterSeed = (e.target as HTMLInputElement).value;
      else parcelSeed = (e.target as HTMLInputElement).value;
    };
    for (const c of Array.from(p.querySelectorAll<HTMLSelectElement>('[data-config="culture"], [data-config="preset"], [data-config="recipe"]'))) c.onchange = () => {
      const config = getConfig(kind); (config as unknown as Record<string, unknown>)[c.dataset.config!] = c.value;
      config.params = {}; q<HTMLTextAreaElement>(p, '[data-json]').value = '';
      if (c.dataset.config === 'culture') {
        config.recipe = 'auto'; config.zone = 'auto'; config.preset = 'culture';
        if (kind === 'quarters') {
          const next = applySettlementStyle('culture', layoutConfig, c.value);
          layoutConfig = next.layout; parcelConfig = next.parcels;
          q<HTMLTextAreaElement>(parcelPanel, '[data-json]').value = ''; populate('parcels'); changed('parcels');
          buildingPanel.setBuildingDraft({ ...buildingPanel.state, settings: undefined });
          resetBuildingDefaults = true;
        }
      }
      if (c.dataset.config === 'recipe' && config.zone !== 'auto') config.zone = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(kind)]?.recipes.find(r => r.id === config.recipe)?.zone ?? config.zone;
      populate(kind);
    };
    q<HTMLButtonElement>(p, '[data-reset]').onclick = () => { getConfig(kind).params = {}; q<HTMLTextAreaElement>(p, '[data-json]').value = ''; populate(kind); changed(kind); };
    p.addEventListener('change', event => {
      if ((event.target as Element).closest('[data-config], [data-footprint], [data-fields], [data-json], [data-seed]')) changed(kind);
    });
    p.addEventListener('input', event => {
      if ((event.target as Element).matches('[data-json], [data-seed]')) changed(kind);
    });
  }
  targetSelect.onchange = () => {
    if (target) cityDrafts.set(target, clone({ layoutConfig, parcelConfig, quarterSeed, parcelSeed, dirty, building: buildingPanel.captureDraft() }));
    target = targetSelect.value; clearTimeout(timer); ++id; layoutsId = undefined; sceneClient.invalidate();
    const saved = citySettings[target], draft = cityDrafts.get(target);
    if (saved) {
      appliedLayout = successfulLayout = clone(saved.layoutConfig); appliedParcel = successfulParcel = clone(saved.parcelConfig);
      appliedQuarterSeed = successfulQuarterSeed = saved.quarterSeed; appliedParcelSeed = successfulParcelSeed = saved.parcelSeed;
      layoutConfig = clone(draft?.layoutConfig ?? appliedLayout); parcelConfig = clone(draft?.parcelConfig ?? appliedParcel);
      quarterSeed = draft?.quarterSeed ?? saved.quarterSeed; parcelSeed = draft?.parcelSeed ?? saved.parcelSeed;
      dirty.quarters = draft?.dirty.quarters ?? false; dirty.parcels = draft?.dirty.parcels ?? false;
    }
    buildingPanel.restore({ ...buildingPanel.state, ...(saved?.building ?? { seed: '', settings: undefined, generated: false }), selected: undefined });
    buildingPanel.restoreDraft(draft?.building);
    for (const kind of ['quarters', 'parcels'] as const) { status(kind, layouts?.some(layout => target === 'all' || layout.key === target) ? 'Plan conservé · sélection seule.' : 'Plan absent pour cette sélection.'); populate(kind); }
    draw(); options.onChange();
  };
  q<HTMLButtonElement>(quarterPanel, '#urbanFocus').onclick = () => {
    const selection = settlements?.settlements.filter(s => target === 'all' || s.key === target) ?? [];
    if (!selection.length || !options.onFocus) return;
    const extent = layoutExtent(layouts?.filter(l => target === 'all' || l.key === target));
    if (extent) { options.onFocus(extent.center, extent.radius); return; }
    const minX = Math.min(...selection.map(s => s.center.x - s.radius)), maxX = Math.max(...selection.map(s => s.center.x + s.radius)), minY = Math.min(...selection.map(s => s.center.y - s.radius)), maxY = Math.max(...selection.map(s => s.center.y + s.radius));
    options.onFocus({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, Math.max(maxX - minX, maxY - minY) / 2);
  };
  populate('quarters'); populate('parcels');
  return {
    captureContext: () => clone({ layoutConfig, parcelConfig, quarterSeed, parcelSeed, dirty }),
    restoreContext(saved: { layoutConfig: LayoutConfig; parcelConfig: ParcelConfig; quarterSeed: string; parcelSeed: string; dirty: Record<Kind, boolean> }): void {
      layoutConfig = normalizeLayoutConfig(saved.layoutConfig, true); parcelConfig = normalizeParcelConfig(saved.parcelConfig);
      quarterSeed = saved.quarterSeed; parcelSeed = saved.parcelSeed;
      for (const kind of ['quarters', 'parcels'] as const) {
        dirty[kind] = saved.dirty[kind]; populate(kind);
        const hint = q(getPanel(kind), '[data-draft-state]'); hint.hidden = !dirty[kind];
        if (dirty[kind]) hint.textContent = 'Modifications non appliquées · utilisez le bouton de régénération.';
      }
    },
    get target(): string { return target; },
    get generationPending(): boolean { return buildingPanel.busy || (['quarters', 'parcels'] as const).some(kind => q(getPanel(kind), '[data-apply]').getAttribute('aria-busy') === 'true'); },
    selectCity(key: string): void { if (target !== key) { targetSelect.value = key; targetSelect.dispatchEvent(new Event('change')); } },
    restoreSnapshot(state: import('./testbenchUrban').WorkshopState): void {
      sceneClient.invalidate(); buildingPanel.invalidate();
      clearTimeout(timer); ++id; layoutsId = undefined;
      layoutConfig = normalizeLayoutConfig(clone(state.layoutConfig), true); appliedLayout = clone(layoutConfig);
      parcelConfig = normalizeParcelConfig(clone(state.parcelConfig)); appliedParcel = clone(parcelConfig);
      quarterSeed = appliedQuarterSeed = state.quarterSeed; parcelSeed = appliedParcelSeed = state.parcelSeed;
      successfulLayout = clone(appliedLayout); successfulParcel = clone(appliedParcel); successfulQuarterSeed = appliedQuarterSeed; successfulParcelSeed = appliedParcelSeed;
      layouts = state.layouts?.slice(); partitions = state.partitions?.slice();
      citySettings = clone(state.citySettings ?? {}); cityDrafts.clear();
      // The imported geometries are already applied. Enable their stages so
      // the default Settlements parcel toggle cannot hide or discard them.
      enabled = !!layouts?.length; parcelEnabled = partitions !== undefined;
      buildingPanel.restore(state.buildingState && { ...clone(buildingSettings(state.buildingState)!), scene: state.buildingState.scene });
      for (const layout of layouts ?? []) if (!citySettings[layout.key]) rememberCities([layout.key]);
      render.view = state.view ?? (state.buildingState?.scene ? 'buildings' : 'parcels'); lastBuiltScene = state.buildingState?.scene;
      for (const kind of ['quarters', 'parcels'] as const) { clearTimeout(draftTimers[kind]); dirty[kind] = false; populate(kind); }
      status('quarters', `Plan conservé · ${layouts?.length ?? 0} ville(s)`);
      status('parcels', partitions ? 'Parcelles conservées.' : 'Parcelles non calculées.');
      draw(); options.onPlanChange?.();
    },
    restoreFromQuery(params: URLSearchParams, activate = false): boolean {
      if (!restoreState(params.get('urban'))) return false;
      sceneClient.invalidate(); buildingPanel.restore(initialBuildingState);
      if (activate) { enabled = true; parcelEnabled = true; }
      clearTimeout(timer); ++id; layouts = undefined; partitions = undefined;
      appliedLayout = clone(layoutConfig); appliedParcel = clone(parcelConfig); appliedQuarterSeed = quarterSeed; appliedParcelSeed = parcelSeed;
      for (const kind of ['quarters', 'parcels'] as const) {
        clearTimeout(draftTimers[kind]); dirty[kind] = false; q(getPanel(kind), '[data-draft-state]').hidden = true; populate(kind);
      }
      for (const e of Array.from(rendering.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-render]'))) {
        const value = render[e.dataset.render as keyof Render];
        if (e instanceof HTMLInputElement && e.type === 'checkbox') e.checked = Boolean(value); else e.value = String(value);
      }
      draw(); return true;
    },
    applyPending(): void {
      for (const kind of ['quarters', 'parcels'] as const) if (dirty[kind]) read(kind, false);
      for (const kind of ['quarters', 'parcels'] as const) if (dirty[kind]) { clearTimeout(draftTimers[kind]); read(kind); populate(kind); }
    },
    get layouts(): Layout[] | undefined { return layouts; },
    get buildingState() { return buildingPanel.state; },
    get buildingView(): boolean { return render.view === 'buildings'; },
    get buildingVisible(): boolean { return buildingPanel.state.visible && render.view === 'buildings'; },
    selectBuilding: (id: string): void => buildingPanel.select(id),
    get extent() { return layoutExtent(layouts); },
    workshopDraft(): Omit<import('./testbenchUrban').WorkshopState, 'layouts' | 'partitions'> | undefined {
      if (!dirty.quarters && !dirty.parcels) return undefined;
      return clone({ layoutConfig, parcelConfig, quarterSeed: q<HTMLInputElement>(getPanel('quarters'), '[data-seed]').value, parcelSeed: q<HTMLInputElement>(getPanel('parcels'), '[data-seed]').value });
    },
    workshopSettings() { const site = settlements?.settlements.find(site => site.key === target); return clone(workshopSettings({ population: site?.population, siteKey: site?.key, citySettings, layoutConfig: appliedLayout, parcelConfig: appliedParcel, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, buildingState: buildingPanel.state, view: render.view })); },
    workshopState() { const site = settlements?.settlements.find(s => s.key === target); return appliedWorkshopSnapshot({ citySettings, population: site?.population, siteKey: site?.key, layoutConfig: appliedLayout, parcelConfig: appliedParcel, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, layouts, partitions, buildingState: buildingPanel.state, view: render.view }); },
    applyWorkshopDraft(state: Partial<import('./testbenchUrban').WorkshopState>): void {
      if (state.layoutConfig) layoutConfig = normalizeLayoutConfig({ ...clone(state.layoutConfig), programme: clone(appliedLayout.programme) }, true);
      if (state.parcelConfig) parcelConfig = normalizeParcelConfig(clone(state.parcelConfig));
      if (state.quarterSeed !== undefined) quarterSeed = state.quarterSeed;
      if (state.parcelSeed !== undefined) parcelSeed = state.parcelSeed;
      if (state.layoutConfig?.programme) buildingPanel.setProgrammeDraft(state.layoutConfig.programme);
      buildingPanel.setBuildingDraft(state.buildingState);
      for (const kind of ['quarters', 'parcels'] as const) { dirty[kind] = true; populate(kind); q(getPanel(kind), '[data-draft-state]').hidden = false; q(getPanel(kind), '[data-draft-state]').textContent = 'Réglages synchronisés · appliquer pour recalculer.'; }
    },
    applyWorkshop(state: { layoutConfig?: LayoutConfig; parcelConfig?: ParcelConfig; quarterSeed?: string; parcelSeed?: string }): void {
      const quartersChanged = state.layoutConfig !== undefined && JSON.stringify(state.layoutConfig) !== JSON.stringify(appliedLayout)
        || state.quarterSeed !== undefined && state.quarterSeed !== appliedQuarterSeed;
      if (state.layoutConfig) { layoutConfig = normalizeLayoutConfig(clone(state.layoutConfig), true); appliedLayout = clone(layoutConfig); }
      if (state.parcelConfig) { parcelConfig = normalizeParcelConfig(clone(state.parcelConfig)); appliedParcel = clone(parcelConfig); }
      if (state.quarterSeed !== undefined) quarterSeed = appliedQuarterSeed = state.quarterSeed;
      if (state.parcelSeed !== undefined) parcelSeed = appliedParcelSeed = state.parcelSeed;
      for (const kind of ['quarters', 'parcels'] as const) {
        if (kind === 'quarters' ? state.layoutConfig !== undefined || state.quarterSeed !== undefined : state.parcelConfig !== undefined || state.parcelSeed !== undefined) {
          clearTimeout(draftTimers[kind]); dirty[kind] = false; q(getPanel(kind), '[data-draft-state]').hidden = true;
        }
      }
      populate('quarters'); populate('parcels');
      if (quartersChanged || !layouts) void request('quarters'); else void request('parcels');
      options.onChange();
    },
    get layoutPending(): boolean { return enabled && ready && !!settlements?.settlements.length && !layouts; },
    setSettlements(output?: SettlementOutput, roadOutput?: RoadOutput): void {
      if (settlements === output && roads === roadOutput && ready) return;
      sceneClient.invalidate(); buildingPanel.invalidate();
      ++id; settlements = output; roads = roadOutput; ready = !!output;
      layouts = undefined; partitions = undefined;
      const sorted = output?.settlements.slice().sort((a, b) => b.population - a.population || a.key.localeCompare(b.key)) ?? [];
      if (target !== 'all' && !sorted.some(s => s.key === target)) target = sorted[0]?.key ?? '';
      targetSelect.replaceChildren(new Option('All · tous les settlements', 'all'), ...sorted.map(s => new Option(`${s.name || s.key} · ${s.population.toLocaleString()} hab. · ${Math.round(s.radius)} m`, s.key)));
      targetSelect.value = target; targetSelect.disabled = !sorted.length;
      populate('quarters'); populate('parcels'); draw();
      if (ready && sorted.length && enabled) schedule(); else { status('quarters', 'En attente des settlements…'); status('parcels', 'En attente des quartiers…'); }
    },
    terrainPending(): void { sceneClient.invalidate(); buildingPanel.invalidate(); ++id; ready = false; clearTimeout(timer); layouts = undefined; partitions = undefined; cachedTerrain = undefined; draw(); status('quarters', 'En attente du terrain et des settlements…'); status('parcels', 'En attente des quartiers…'); },
    terrainFailed(message: string): void {
      ++id; ready = false; clearTimeout(timer);
      status('quarters', `Génération du terrain échouée : ${message}`);
      status('parcels', `Génération du terrain échouée : ${message}`);
    },
    updateView: draw,
    share(params: URLSearchParams): void { params.set('urban', JSON.stringify({ enabled, parcelEnabled, target, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, layoutConfig: appliedLayout, parcelConfig: appliedParcel, render, buildingState: buildingSettings(buildingPanel.state) })); },
  };
}
import { executionRuntime } from './executionProfile';
