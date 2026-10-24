import { growthPhaseCultureHtml, growthStepLabel } from './urbanGrowthEvidence';
import { bindControlRelevance, controlRelevanceControlsHtml } from './urbanControlRelevance';
import { retainSelectValue } from './retainedSelectValue';
import { bindCityPlanCulture, withCityPlanCulture } from './cityPlanCulture';
import UrbanWorker from './urbanWorker?worker&inline';
import catalogueJson from '../../../rust/crates/core/src/urban/catalogue.json';
import { defaultLayoutConfig, defaultParcelConfig, layoutExtent, normalizeLayoutConfig, normalizeParcelConfig, regionalStreets, runUrbanRequest, type Layout, type LayoutConfig, type ParcelConfig, type Partition, type Point, type Shape, type Street, type UrbanRequest, type UrbanResponse } from '../../../rust/bridge/urban';
import type { FortificationStyle } from '../../../rust/bridge/urbanConfig';
import { settlementRaster, type RoadOutput, type SettlementOutput, type SettlementRaster } from '../../../rust/bridge/settlements';
import type { TerrainData } from '../../../rust/bridge/terrain';
import { terrainGeography } from '../../../rust/bridge/urbanGeography';
import { streetSurfacePath } from '../../../rust/bridge/urbanStreetSurface';
import { createUrbanSceneClient, type UrbanSceneMode } from './urbanScene';
import { publishParentUiTask } from './urbanParentUiTasks';
import { createUrbanParentSceneClient } from './urbanParentScene';
import { nativeParentApi, nativeParentSessionSupport } from '../../../rust/bridge/architecture';
import { parentGenerationIdentity } from './urbanParentIdentity';
import { openParentViewport } from './urbanParentViewport';
import { sameParentBuildingState, type UrbanParentBuildingState } from './urbanParentState';
import { createParentStreamWindow } from './urbanParentStreamWindow';
import type { ParentMemberVisual, ParentVisualRecords } from './urbanParentVisual';
import { paintParentContexts } from './urbanParentPaint';
import { nativeParentInspectionHtml } from './urbanParentInspector';
import { downloadParentBuildings, readParentBuildings } from './urbanParentFiles';
import { createIndexedDbBuildingChunkBackend } from './urbanBuildingChunkIndexedDb';
import { openColdCitySession, replaceColdProjection, type ColdCitySession, type ColdCityState } from './urbanColdCitySession';
import { coldCityFingerprint } from './urbanColdCityFingerprint';
import { openColdCityViewport, type ColdCityViewport } from './urbanColdCityViewport';
import { createColdStreamWindow } from './urbanColdStreamWindow';
import { createColdViewportSlot } from './urbanColdViewportSlot';
import { repairColdDerivedCache } from './urbanColdDerivedRepair';
import { urbanCapacityWarningText } from './urbanCapacityWording';
import { downloadColdBuildings } from './urbanColdDownloads';
import { waitForArchitectureInputs } from './urbanArchitectureInputs';
import type { NativeBuildingProjection, NativeBuildingProjectionScene } from './urbanBuildingProjection';
import { createUrbanSourceBinding } from './urbanSourceBinding';
import { createCityComparison } from './cityComparison';
import { siteVisualScene } from './urbanSilhouettes';
import { createNativeSiteStore, createLegacySiteStore, createUnboundSiteStore, type UrbanSiteStore, type UrbanSiteVisual } from './urbanSiteStore';
import { CityGlCanvasLayer, type CityGlHostFrame } from '../render/cityGlHost';
import { cityGlOverlayLayers } from '../render/cityGl';
import { cityWallSvg } from '../render/cityWalls'; // walls hook
import { BUILDING_FAMILIES, CityCanvasLayer, DISTRICT_ROLES, districtRoleKey, buildCityBuildings, buildCityScene, drawCity, pickCity, selectCityLod, type CityBuildings, type CityFrameStats, type CityLod, type CityPick, type CityScene } from '../render/cityCanvas';
import { UrbanBuildingLodRenderer } from '../render/urbanBuildingLod';
import { UrbanBuildingDetailController, type BuildingDetailView } from '../render/urbanBuildingDetails';
import type { ArchitectureBatchProgress } from '../../../rust/bridge/architectureBatch';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { createUrbanBuildingsPanel } from './urbanBuildingsPanel';
import { morphologyOptions, morphologyEvidenceHtml, resetMorphology, MORPHOLOGY_HINT } from './urbanMorphology';
import { urbanBuildingsSvg } from '../render/urbanBuildings';
import { openUrbanHouseCase } from './urbanHouseTransfer';
import { parcelInspectionHtml } from './urbanInspector';
import { updateUrbanBuildingSelection } from './urbanBuildingSelection';
import { buildingSettings, workshopSettings, appliedWorkshopSnapshot, mergeCityWorkshop, mergeWorkshopCities } from './urbanSnapshot';
import { programmeSvg, refusalSvg } from '../render/urbanProgramme';
import { openMethodNote } from './methodNotes';
import { applySettlementStyle, installSettlementStyles } from './urbanSettlementStyles';
import { editCount, emptyEdits, floorsFor, hasEdits, layoutWithEdits, normalizeEdits, packEdits, parcelWithEdits, setEdit, styledRequest, type CityEdits } from './cityEdits';
import { renderCityInspector, type CityInspectorHooks } from './cityInspector';
import { createShapeEditor, simplifyLotRing, simplifyRing, type Pt as ShapePt, type ShapeEditor } from './cityShapeEditor';
import type { BuildingStyleIndex } from '../../../rust/bridge/buildingStyles';
import type { PlacementBatchRequest } from '../../../rust/bridge/urbanArchitecture';

interface Catalogue { fields: Record<'quarters' | 'parcels', string[]>; presets: Record<string, { label: string; params: Record<string, unknown> }>; cultures: Record<string, { label: string; recipes: { id: string; label: string; zone: string; preset: string }[] }> }
const catalogue = catalogueJson as Catalogue;
const ns = 'http://www.w3.org/2000/svg';
const clone = <T>(v: T): T => structuredClone(v);
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const operators: Record<string, string[]> = { streetOp: ['organic', 'grid'], closeOp: ['closes', 'culDeSacTree', 'hutong', 'roji', 'none'], orientation: ['road', 'cardinal', 'terrain', 'water'], plotOp: ['burgage', 'courtyard', 'siheyuan', 'machiya', 'compound', 'garden', 'wholeBlock'] };
const fortificationStyles: Record<FortificationStyle, string> = { auto: 'Selon la culture', palisade: 'Palissade', gord: 'Gord · rempart de terre et de bois', hedge: 'Haie défensive', curtain: 'Courtine simple', flanked: 'Muraille flanquée de tours', concentric: 'Enceintes concentriques', 'rammed-earth': 'Muraille en terre compactée', wengcheng: 'Wengcheng · cour devant les portes', bastioned: 'Enceinte bastionnée' };
const labels: Record<string, string> = { streetOp: 'Rues', closeOp: 'Dessertes', orientation: 'Orientation', laneSpacing: 'Espacement des ruelles', wardArea: 'Surface des quartiers', accessDepth: 'Profondeur accessible', fieldTwist: 'Rotation du champ', curvature: 'Courbure', fieldNoise: 'Bruit du champ', fieldWavelength: 'Longueur du champ', fieldRandom: 'Variation du champ', gridSpacing: 'Espacement de grille', gridSkew: 'Obliquité de grille', blockSize: 'Taille des îlots', minBlock: 'Surface minimale des îlots', minWidth: 'Largeur minimale', widthByRank: 'Largeurs par rang', widthScale: 'Échelle des largeurs', widthJitter: 'Variation des largeurs', placeThreshold: 'Seuil des places', deadEndRatio: 'Impasse / longueur', slitDepth: 'Profondeur des passages', plotDepth: 'Profondeur des parcelles', contourFollow: 'Suivi des courbes de niveau', contourBlend: 'Influence du relief', longCut: 'Coupures longues', plotOp: 'Méthode de parcelles', houseArea: 'Surface de cour', coverage: 'Occupation', frontage: 'Largeur de façade', plotTilt: 'Inclinaison des parcelles', wideLotChance: 'Probabilité de grande parcelle', deepFill: 'Remplir les fonds' };
const path = (pts: Point[], close = false): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ') + (close ? 'Z' : '');
const shapePath = (s: Shape): string => [s.outer, ...(s.holes ?? [])].map(p => path(p, true)).join(' ');
const shapeArea = (s: Shape): number => {
  const ring = (r: Point[]): number => Math.abs(r.reduce((sum, p, i) => { const n = r[(i + 1) % r.length]; return sum + p.x * n.y - p.y * n.x; }, 0)) / 2;
  return ring(s.outer) - (s.holes ?? []).reduce((sum, h) => sum + ring(h), 0);
};
/** Identical native warnings are listed once, with their count. */
const warningText = (lines: string[]): string => {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return Array.from(counts, ([line, n]) => n > 1 ? `${line} (×${n})` : line).join('\n');
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
interface Render { view: 'tissue' | 'uses' | 'parcels' | 'buildings' | 'roles'; reserve: boolean; allocated: boolean; centers: boolean; domains: boolean; quarters: boolean; blocks: boolean; streets: boolean; enclosures: boolean; parcels: boolean; gardens: boolean; places: boolean; fronts: boolean; axes: boolean; access: boolean; opacity: number; width: number; palette: 'growth' | 'atlas' | 'ink' | 'terrain' }
type Kind = 'quarters' | 'parcels';

/** `getRaster` replaces `getTerrain` where the raster is already adapted (Urban Bench decors). */
export function createTerrainUrban(options: { map: SVGSVGElement; before: Element | null; getTerrain(): TerrainData | undefined; getRaster?(): SettlementRaster | undefined; getSeed(): string; getAuto?(): boolean; parcelDefault?: boolean; onChange(): void; onPlanChange?(): void; onFocus?(center: Point, radius: number): void; onProjection?(active: boolean, camera?: import('./terrain3d').Terrain3dCamera): boolean | void;
  /** City Bench: one city, the same controls regrouped by theme and shown once, building silhouettes. */
  city?: boolean;
  /** Upstream stages (placement, regional roads) still answering: buildings wait for them. */
  upstreamPending?(): boolean }) {
  let settlements: SettlementOutput | undefined, roads: RoadOutput | undefined;
  let regionalOf: RoadOutput | undefined, regional: Street[] = [];
  let layouts: Layout[] | undefined, partitions: Partition[] | undefined;
  let initialBuildingState: import('./urbanBuildingsPanel').UrbanBuildingState | undefined;
  // Retained quarter layouts: parcels reuse them by id instead of resending the plan.
  let layoutsId: number | undefined, retainedLayouts: Layout[] | undefined, parcelsById = false;
  const urbanSource = createUrbanSourceBinding();
  let parcelSourceInput: { id: number; layouts: Layout[]; terrain: object; runtime: typeof executionRuntime } | undefined;
  /** City Bench architecture of the building pass. */
  let architectureMode: UrbanSceneMode = 'silhouette';
  /** City Bench per-item edits (quarter, lot, house); `editsBefore` is restored if the engine refuses them. */
  let edits: CityEdits = emptyEdits(), editsBefore: CityEdits | undefined;
  // edits hook (cityShapeEditor.ts): shape editor session and the plan the edits box last described.
  let shapeEditor: ShapeEditor | undefined, shapeEditOf: [Layout[] | undefined, Partition[] | undefined] | undefined, editsReportOf: CityScene | undefined;
  /** Full constraints are read only for a selected edit on capable native servers. */
  let sceneSites: UrbanSiteStore | undefined;
  /** Exact original previews in native order; stable comparison identity. */
  let sceneRequestList: UrbanSiteVisual[] = [];
  /** An ID can recur after history/import; only this exact scene owns the sites. */
  let sceneRequestScene: PlacementBatch | ColdCityState | undefined;
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
      if (['silhouette', 'compact', 'detailed'].includes(s.architecture)) architectureMode = s.architecture;
      edits = normalizeEdits(s.edits);
      return true;
    } catch { return false; }
  }
  restoreState(new URLSearchParams(location.search).get('urban'));
  // Missing profiles already default to 'site' in normalizeLayoutConfig.
  // CityBench enables its stages without changing an explicit restored override.
  if (options.city) { enabled = parcelEnabled = true; }
  const stages = document.querySelector('.stages')!;
  const common = (kind: Kind): string => `<label>Profil culturel urbain<select data-config="culture"><option value="site">Culture de chaque settlement</option>${Object.entries(catalogue.cultures).map(([id, c]) => `<option value="${esc(id)}">${esc(c.label)}</option>`).join('')}</select></label>
    <label>Recette de plan / parcellaire<select data-config="recipe"></select></label><label>Préréglage<select data-config="preset"><option value="culture">Recettes culturelles</option>${Object.entries(catalogue.presets).map(([id, p]) => `<option value="${esc(id)}">${esc(p.label)}</option>`).join('')}</select></label>
    <label>Zones<select data-config="zone"><option value="auto">Du centre vers la campagne</option>${Object.entries({ core: 'Cœur', middle: 'Quartiers intermédiaires', edge: 'Périphérie', faubourg: 'Faubourgs', village: 'Village' }).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><label>Multiplicateur de densité<input data-config="density" type="number" min="0.1" max="10" step="any"></label>`;
  const number = (key: string, label: string, min: number, max: number, step = 1): string => `<label>${label}<input data-config="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  const select = (key: string, label: string, values: Record<string, string>, footprint = false): string => `<label>${label}<select data-${footprint ? 'footprint' : 'config'}="${key}">${Object.entries(values).map(([id, text]) => `<option value="${id}">${esc(text)}</option>`).join('')}</select></label>`;
  const footprintNumber = (key: string, label: string, min: number, max: number, step = 1): string => number(key, label, min, max, step).replace('data-config=', 'data-footprint=');
  const footprintControls = `<div class="urban-footprint-controls"><div class="control-group">${select('family', 'Forme de ville', families, true)}${select('mechanism', 'Croissance', mechanisms, true)}</div><details class="advanced"><summary>Dimensions et budget</summary><div class="control-group">${select('budget', 'Budget spatial', { population: 'Population / densité brute', radius: 'Rayon artistique' }, true)}${footprintNumber('grossDensity', 'Densité brute (hab./ha · 0 = culture)', 0, 1000, 1)}${footprintNumber('aspect', 'Allongement', 1, 6, 0.1)}${footprintNumber('orientation', 'Orientation (°)', -180, 180, 5)}${footprintNumber('nuclei', 'Noyaux de croissance', 1, 6)}${footprintNumber('irregularity', 'Irrégularité', 0, 1, 0.05)}${footprintNumber('anisotropy', 'Attraction des axes', 0, 1, 0.05)}${footprintNumber('separation', 'Écartement des noyaux', 0.4, 3, 0.1)}${footprintNumber('epochs', 'Étapes de croissance', 1, 5)}</div></details><details class="advanced" data-sparse-growth><summary>Dispersion et coupures</summary><div class="control-group">${footprintNumber('cohesion', 'Cohésion', 0, 1, 0.05)}${footprintNumber('satellites', 'Propension aux satellites', 0, 1, 0.05)}${footprintNumber('branchDepth', 'Profondeur des branches', 0, 1, 0.05)}${footprintNumber('gapSize', 'Taille des coupures (m)', 10, 500, 10)}</div><small>Baisser la cohésion laisse plus de terrain libre ; les chemins peuvent le traverser. Les formes géométriques imposées conservent leur contour.</small></details></div>`;
  const tissueControls = `<div class="urban-tissue-controls"><div class="control-group">${select('tissue', 'Maillage des rues', tissues)}${select('accessMode', 'Accessibilité des îlots', { adaptive: 'Adaptative selon le parcellaire', cultural: 'Dessertes culturelles', none: 'Conserver les accès existants' })}</div><details class="advanced"><summary>Réglages des accès</summary><div class="control-group">${number('accessDepth', 'Profondeur accessible (m · 0 = culture)', 0, 200, 5)}${number('accessBudget', 'Accès ajoutés au plus par îlot', 0, 12)}</div></details></div>`;
  const influenceControls = `<details class="advanced"><summary>Influences et sorties</summary><div class="control-group">${select('mixCulture', 'Seconde influence', { '': 'Aucune', ...Object.fromEntries(Object.entries(catalogue.cultures).map(([id, c]) => [id, c.label])) })}${select('mixMode', 'Répartition', { phases: 'Chronologique · extensions plus récentes', sectors: 'Géométrique · secteurs' })}${number('mixShare', 'Part de la seconde influence', 0, 1, 0.05)}${number('mixAngle', 'Orientation des secteurs (°)', -180, 180, 5)}${select('exitTreatment', 'Sorties de rues', { adaptive: 'Raccordements, chemins et impasses', closed: 'Impasses fermées', legacy: 'Ancien comportement' })}${select('peripheralRoad', 'Chemin périphérique', { auto: 'Selon les accès', none: 'Aucun', partial: 'Partiel', full: 'Complet si le terrain le permet' })}${select('axisAlignment', 'Orientation des axes urbains', { regional: 'Routes régionales principales', culture: 'Orientation culturelle' })}${number('siteAdaptation', 'Adaptation au relief et aux berges', 0, 2, 0.1)}</div><small>Les influences suivent les rues et les parcelles. Les sorties et le périphérique respectent l’eau et les pentes ; une enceinte conserve ses portes.</small></details>`;
  const enclosureControls = `<details class="advanced urban-enclosure-controls"><summary>Enceinte</summary><label>Enceinte du noyau<select data-config="fortification"><option value="culture">Selon la culture</option><option value="none">Sans enceinte</option><option value="wall">Muraille</option><option value="palisade">Palissade</option></select></label>${select('fortificationStyle', 'Style de l’enceinte', fortificationStyles)}<small data-enclosure-style-hint>Le style doit correspondre au type d’enceinte ; sinon le choix culturel est conservé.</small><button data-remove-enclosure type="button">Retirer l’enceinte</button><small>Retirer recalcule immédiatement le plan ouvert. Les autres choix s’appliquent avec « Régénérer la ville ».</small></details>`;
  function panel(kind: Kind, title: string): HTMLDetailsElement {
    const p = document.createElement('details'); p.className = 'stage urban-stage'; p.id = kind === 'quarters' ? 'urbanQuarterStage' : 'urbanParcelStage'; p.open = true;
    p.innerHTML = `<summary>${title}<span data-state></span></summary><div class="stage-controls">
      <div class="urban-actions"><button data-apply type="button">${kind === 'quarters' ? 'Régénérer la ville' : 'Régénérer les parcelles'}</button><small data-status role="status">En attente des settlements…</small></div>
      <small data-draft-state role="status" hidden></small>
      <label><input data-enabled type="checkbox">Générer ${kind === 'quarters' ? 'les quartiers' : 'les parcelles'}</label>
      ${kind === 'quarters' ? '<label>Settlement ciblé<select id="urbanTarget"></select></label><button type="button" id="urbanFocus">Centrer sur la sélection</button>' : '<small>Les parcelles utilisent les îlots du bloc 6, sans régénérer les rues.</small>'}
      <details class="advanced"><summary>Graine</summary><label>Graine ${kind === 'quarters' ? 'quartiers' : 'parcelles'}<input data-seed type="text" placeholder="Graine de la carte"></label></details>
      ${kind === 'quarters' ? `<div class="urban-composition-controls"><label>Génération<select data-config="composition"><option value="settlement">Agglomération complète</option><option value="district">Secteur isolé · ancien banc</option></select></label><small data-mode-hint></small><div data-settlement-resolution aria-live="polite"></div><div data-settlement-settings><label>Grammaire morphologique<select data-config="settlementForm">${morphologyOptions()}</select></label><button type="button" data-morphology-auto>Grammaire automatique</button><small>${MORPHOLOGY_HINT}</small>${footprintControls}<details class="advanced" data-legacy-settings><summary>Composition historique</summary><label>Faubourgs<select data-config="suburbs"><option value="auto">Croissance variable</option><option value="none">Aucun</option><option value="few">Quelques faubourgs</option><option value="many">Faubourgs étendus</option></select></label>${number('phases', 'Phases du noyau (0 = culture)', 0, 5)}</details></div>${tissueControls}</div>${enclosureControls}${influenceControls}<details class="advanced"><summary>Diagnostic du plan</summary><div data-composition class="urban-composition" aria-live="polite"></div></details>` : `${select('operator', 'Opérateur parcellaire', parcelOperators)}<small>« Par phase » conserve les recettes du noyau, des extensions et des faubourgs du plan affiché.</small><div data-parcel-diagnostics class="urban-diagnostics" aria-live="polite"></div>`}
      <details class="advanced"><summary>Recettes et dimensions avancées</summary><div class="control-group">${common(kind)}${kind === 'quarters' ? number('count', 'Secteurs de calcul visés', 3, 8) + `<div data-fixture-settings>${number('rings', 'Anneaux de la scène', 1, 2)}<label>Disposition<select data-config="placement"><option value="center">Plan culturel adapté au terrain</option><option value="rectangle">Rectangle</option><option value="skew">Oblique</option><option value="notched">Avec encoche</option></select></label></div>` + number('radius', 'Rayon d’emprise (m · 0 = lieu)', 0, 25000) + number('radiusScale', 'Échelle de l’emprise', 0.1, 5, 0.1) + '<label>Réservation monument<input data-config="monument" type="text" list="urbanMonuments"></label><datalist id="urbanMonuments"><option value="none"><option value="cathedral"><option value="great-mosque"><option value="temple"><option value="castle"><option value="palace"></datalist>' : ''}</div></details>
      ${kind === 'quarters' ? `<details class="advanced"><summary>Rues et relief</summary><div class="control-group">${number('maxStreetGrade', 'Pente maximale des rues (m/m)', 0.02, 0.3, 0.01)}${number('maxLaneGrade', 'Pente maximale des ruelles (m/m)', 0.02, 0.4, 0.01)}<label><input data-config="allowStairs" type="checkbox">Autoriser les escaliers piétons</label>${number('maxStairGrade', 'Pente maximale des escaliers (m/m)', 0.02, 1, 0.01)}</div><small>0,12 = 12 % : 12 m de montée pour 100 m au sol. Les rues cherchent un passage praticable ; les escaliers sont dessinés avec des marches. Les ponts régionaux conservent leur franchissement.</small></details>` : ''}
      <details class="advanced"><summary>Tous les paramètres natifs</summary><div data-fields class="urban-fields"></div><label>Overrides JSON<textarea data-json rows="4" spellcheck="false" placeholder="{}"></textarea></label><small>Les valeurs modifiées remplacent la recette. Les mesures géométriques sont en mètres (surfaces en m²).${kind === 'quarters' ? ' En progression automatique, les valeurs par zone affichées sont celles du cœur ; sélectionnez une zone pour modifier ses valeurs, puis revenez à la progression automatique.' : ''}</small><button data-reset type="button">Réinitialiser les paramètres</button></details>
      ${kind === 'quarters' ? '<small>Relief, rivières et lacs viennent du terrain réel. Les réglages de relief synthétique de l’ancien bench sont remplacés par les blocs 1–3.</small>' : ''}
      <div data-warnings role="status"></div></div>`;
    stages.insertBefore(p, options.before); return p;
  }
  const quarterPanel = panel('quarters', '6 · Empreinte, quartiers et îlots '), parcelPanel = panel('parcels', '7 · Parcelles ');
  const targetSelect = quarterPanel.querySelector<HTMLSelectElement>('#urbanTarget')!;
  const getConfig = (kind: Kind): LayoutConfig | ParcelConfig => kind === 'quarters' ? layoutConfig : parcelConfig;
  // The controls of one calculation may span several themed sections (City Bench).
  const roots: Record<Kind, HTMLElement[]> = { quarters: [quarterPanel], parcels: [parcelPanel] };
  const one = <T extends HTMLElement>(kind: Kind, selector: string): T => { for (const root of roots[kind]) { const found = root.querySelector<T>(selector); if (found) return found; } return null as unknown as T; };
  const all = <T extends Element>(kind: Kind, selector: string): T[] => roots[kind].flatMap(root => Array.from(root.querySelectorAll<T>(selector)));
  let styleHost: Element = quarterPanel.querySelector('.stage-controls')!, displayHost: Element = parcelPanel.querySelector('.stage-controls')!;
  let displaySection: HTMLElement | undefined;
  let cityPlanCulture: ReturnType<typeof bindCityPlanCulture> | undefined;
  let controlRelevance: ReturnType<typeof bindControlRelevance> | undefined;
  // Native keys read by both stages are edited once, on the plan, and applied to both.
  const sharedFields = options.city ? catalogue.fields.quarters.filter(key => catalogue.fields.parcels.includes(key)) : [];
  const hiddenFields: Record<Kind, string[]> = options.city ? { quarters: ['accessDepth'], parcels: sharedFields } : { quarters: [], parcels: [] };
  if (options.city) ({ styleHost, displayHost, displaySection } = cityLayout());
  /** Move the existing controls into themed sections; ids and data attributes are unchanged. */
  function cityLayout(): { styleHost: Element; displayHost: Element; displaySection: HTMLElement } {
    const section = (id: string, title: string, state = false, open = true): { box: HTMLDetailsElement; controls: HTMLElement } => {
      const box = document.createElement('details'); box.className = 'stage urban-stage city-stage'; box.id = id; box.open = open;
      box.innerHTML = `<summary>${title}${state ? '<span data-state></span>' : ''}</summary><div class="stage-controls"></div>`;
      return { box, controls: box.querySelector<HTMLElement>('.stage-controls')! };
    };
    const from = <T extends Element>(selector: string, root: Element = quarterPanel): T => root.querySelector<T>(selector)!;
    const label = (selector: string, root: Element = quarterPanel): HTMLElement => from(selector, root).closest('label')!;
    const group = (...items: Element[]): HTMLElement => { const div = document.createElement('div'); div.className = 'control-group'; div.append(...items); return div; };
    const advanced = (title: string, items: Element[], open = false): HTMLDetailsElement => {
      const box = document.createElement('details'); box.className = 'advanced'; box.open = open; box.innerHTML = `<summary>${title}</summary>`; box.append(group(...items)); return box;
    };
    const retitle = (details: Element, title: string): void => { details.querySelector(':scope > summary')!.textContent = title; };
    quarterPanel.id = '';
    const plan = section('urbanQuarterStage', '3 · Plan urbain ', true), footprint = section('cityFootprintStage', '4 · Emprise et croissance '),
      streets = section('cityStreetStage', '5 · Rues et îlots '), edges = section('cityEdgeStage', '6 · Enceinte, sorties et influences '),
      display = section('cityDisplayStage', '10 · Affichage et diagnostics ');
    // 3 · Plan: actions, seed, composition, exploration and diagnostics.
    const seed = label('[data-seed]'), seedBox = seed.closest('details')!;
    const target = label('#urbanTarget'); target.hidden = true;
    const focus = from<HTMLButtonElement>('#urbanFocus'); focus.textContent = 'Centrer sur la ville';
    const composition = from('.urban-composition-controls');
    const diagnostic = from('[data-composition]').closest('details')!; retitle(diagnostic, 'Diagnostic du plan');
    plan.controls.append(from('.urban-actions'), from('[data-draft-state]'), label('[data-enabled]'), target, group(seed, focus), explorerControls(),
      label('[data-config="composition"]'), from('[data-mode-hint]'), from('[data-settlement-resolution]'), diagnostic, from('[data-warnings]'));
    const planCulture = advanced('Profil culturel du plan · surcharge', [label('[data-config="culture"]')]);
    planCulture.dataset.planCultureOverride = '';
    planCulture.insertAdjacentHTML('beforeend', '<button type="button" data-plan-culture-site>Plan : comme le lieu</button><small data-plan-culture-note role="status"></small>');
    from<HTMLSelectElement>('[data-config="culture"]', planCulture).options[0].textContent = 'Comme le profil du lieu';
    plan.controls.append(planCulture);
    plan.controls.insertAdjacentHTML('beforeend', controlRelevanceControlsHtml());
    seedBox.remove();
    // 4 · Footprint and growth, then the isolated-sector scene of the former bench.
    const fixture = from('[data-fixture-settings]');
    footprint.controls.append(from('[data-settlement-settings]'), group(label('[data-config="radius"]'), label('[data-config="radiusScale"]')),
      advanced('Secteur isolé · ancien banc', [label('[data-config="count"]'), fixture]));
    // 5 · Streets and blocks: mesh, access, recipes, grades and the native street parameters.
    const natives = from('[data-fields]').closest('details')!; retitle(natives, 'Paramètres natifs des rues et îlots');
    const relief = from('[data-config="maxStreetGrade"]').closest('details')!; retitle(relief, 'Pentes et escaliers');
    streets.controls.append(from('.urban-tissue-controls'),
      advanced('Recettes du plan', ['recipe', 'preset', 'zone', 'density'].map(key => label(`[data-config="${key}"]`)), true), relief, natives);
    composition.remove();
    // 6 · Enclosure, exits and a second influence.
    const monuments = from('#urbanMonuments');
    edges.controls.append(group(label('[data-config="fortification"]'), label('[data-config="fortificationStyle"]'), label('[data-config="monument"]'), monuments), from('[data-enclosure-style-hint]'),
      advanced('Sorties et axes', ['exitTreatment', 'peripheralRoad', 'axisAlignment', 'siteAdaptation'].map(key => label(`[data-config="${key}"]`)), true),
      advanced('Seconde influence', ['mixCulture', 'mixMode', 'mixShare', 'mixAngle'].map(key => label(`[data-config="${key}"]`)), true));
    quarterPanel.before(plan.box, footprint.box, streets.box, edges.box);
    quarterPanel.remove();
    roots.quarters = [plan.box, footprint.box, streets.box, edges.box];
    // 7 · Parcels keep their panel; recipes are named for the parcel stage.
    parcelPanel.querySelector('summary')!.firstChild!.textContent = '7 · Parcelles ';
    const parcelSeed = label('[data-seed]', parcelPanel), parcelSeedBox = parcelSeed.closest('details')!;
    label('[data-enabled]', parcelPanel).after(parcelSeed); parcelSeedBox.remove();
    const parcelNote = parcelPanel.querySelector('.stage-controls > small:not([data-draft-state])'); if (parcelNote) parcelNote.textContent = 'Les parcelles découpent les îlots du plan sans régénérer les rues.';
    for (const [key, text] of [['culture', 'Profil culturel du parcellaire'], ['recipe', 'Recette du parcellaire'], ['preset', 'Préréglage du parcellaire'], ['zone', 'Zones du parcellaire'], ['density', 'Densité du parcellaire']]) label(`[data-config="${key}"]`, parcelPanel).firstChild!.textContent = text;
    from<HTMLSelectElement>('[data-config="culture"]', parcelPanel).options[0].textContent = 'Comme le plan · cultures des phases';
    retitle(from('[data-config="recipe"]', parcelPanel).closest('details')!, 'Recettes du parcellaire');
    retitle(from('[data-fields]', parcelPanel).closest('details')!, 'Paramètres natifs du parcellaire');
    label('[data-json]', streets.box).firstChild!.textContent = 'Surcharges JSON des rues et îlots';
    label('[data-json]', parcelPanel).firstChild!.textContent = 'Surcharges JSON du parcellaire';
    display.controls.dataset.cityDisplay = '';
    return { styleHost: plan.controls, displayHost: display.controls, displaySection: display.box };
  }
  /** Pattern exploration: new seeds or a random plan, and a way back. */
  function explorerControls(): HTMLElement {
    const box = document.createElement('div'); box.className = 'urban-explorer';
    box.innerHTML = '<div class="urban-actions"><button type="button" data-explore="seed" title="Nouvelle graine des rues et des parcelles, réglages conservés">Nouvelle graine</button><button type="button" data-explore="plan" title="Tire une forme, une croissance, un maillage, une enceinte, des sorties, une seconde influence et un parcellaire">Motif au hasard</button><button type="button" data-explore="back" disabled title="Rétablit les réglages appliqués avant le dernier tirage">Tirage précédent</button></div><small data-explore-note role="status"></small>';
    return box;
  }
  function siteCulture(kind: Kind = 'quarters'): string {
    const site = settlements?.settlements.find(s => s.key === target) ?? settlements?.settlements.slice().sort((a, b) => b.population - a.population)[0];
    return (kind === 'parcels' ? layouts?.find(l => l.key === site?.key)?.culture : undefined) ?? site?.culture ?? 'european-organic';
  }
  function syncCityPlanCulture(): void {
    if (!cityPlanCulture) return;
    const site = settlements?.settlements.find(s => s.key === target);
    const retained = layouts?.find(l => l.key === target);
    cityPlanCulture.sync({ requested: layoutConfig.culture, place: site?.culture,
      ...(retained ? { retained: { key: retained.key, culture: retained.culture } } : {}) });
  }
  function baseline(config: Omit<ParcelConfig, 'operator'>): Record<string, unknown> {
    const c = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(config === parcelConfig ? 'parcels' : 'quarters')];
    const recipe = c?.recipes.find(r => r.id === config.recipe) ?? c?.recipes[0];
    return catalogue.presets[config.preset === 'culture' ? recipe?.preset ?? 'morph/european-organic' : config.preset]?.params ?? {};
  }
  function generationControls(): void {
    const complete = layoutConfig.composition === 'settlement';
    const legacy = layoutConfig.footprint.mechanism === 'legacy';
    one<HTMLButtonElement>('quarters', '[data-morphology-auto]').disabled = !complete;
    for (const [selector, active] of [['[data-settlement-settings]', complete], ['[data-fixture-settings]', !complete], ['[data-legacy-settings]', complete && legacy]] as const) {
      const group = one<HTMLElement>('quarters', selector); group.hidden = !active;
      for (const e of Array.from(group.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select'))) e.disabled = !active;
    }
    for (const e of Array.from(all<HTMLInputElement | HTMLSelectElement>('quarters', '[data-footprint]'))) {
      const inactive = legacy && e.dataset.footprint !== 'mechanism';
      e.closest('label')!.hidden = inactive;
      const geometric = ['circle', 'rectangle', 'polygon'].includes(layoutConfig.footprint.family);
      const sparse = ['cohesion', 'satellites', 'branchDepth', 'gapSize'].includes(e.dataset.footprint!);
      e.disabled = !complete || inactive || geometric && sparse || e.dataset.footprint === 'grossDensity' && layoutConfig.footprint.budget !== 'population';
    }
    one<HTMLElement>('quarters', '[data-sparse-growth]').hidden = legacy;
    one<HTMLInputElement>('quarters', '[data-config="radius"]').disabled = complete && !legacy && layoutConfig.footprint.budget !== 'radius';
    one<HTMLInputElement>('quarters', '[data-config="radiusScale"]').disabled = complete && !legacy && layoutConfig.footprint.budget !== 'radius';
    for (const key of ['accessDepth', 'accessBudget']) one<HTMLInputElement>('quarters', `[data-config="${key}"]`).disabled = layoutConfig.accessMode !== 'adaptive';
    const hint = complete ? '' : 'Secteur isolé : sa disposition impose le contour, indépendamment de la culture et du maillage des rues. Choisissez « Agglomération complète » pour une ville adaptée au site.';
    const preset = layoutConfig.preset === 'culture' ? '' : ` Préréglage imposé : ${catalogue.presets[layoutConfig.preset]?.label ?? layoutConfig.preset}. Il remplace les recettes culturelles.`;
    one('quarters', '[data-mode-hint]').textContent = hint + preset;
    controlRelevance?.sync(layoutConfig, layouts);
  }
  function populate(kind: Kind): void {
    const config = getConfig(kind);
    one<HTMLInputElement>(kind, '[data-enabled]').checked = kind === 'quarters' ? enabled : parcelEnabled;
    one<HTMLInputElement>(kind, '[data-seed]').value = kind === 'quarters' ? quarterSeed : parcelSeed;
    const culture = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(kind)];
    const recipe = one<HTMLSelectElement>(kind, '[data-config="recipe"]');
    recipe.replaceChildren(new Option(kind === 'quarters' ? 'Par phase · profil du plan' : 'Par phase · plan conservé', 'auto'), ...(culture?.recipes ?? [{ id: 'core', label: 'Cœur', zone: 'core', preset: '' }]).map(r => new Option(r.label, r.id)));
    // A shared recipe may be valid for another settlement culture; Rust validates it per site.
    if (!Array.from(recipe.options).some(o => o.value === config.recipe)) retainSelectValue(recipe, config.recipe, 'Recette conservée hors du profil courant');
    if (kind === 'quarters') one<HTMLSelectElement>(kind, '[data-config="settlementForm"]').innerHTML = morphologyOptions(layoutConfig.settlementForm);
    for (const c of Array.from(all<HTMLInputElement | HTMLSelectElement>(kind, '[data-config]'))) {
      const value = (config as unknown as Record<string, unknown>)[c.dataset.config!];
      if (c instanceof HTMLInputElement && c.type === 'checkbox') c.checked = Boolean(value);
      else if (c instanceof HTMLSelectElement) retainSelectValue(c, String(value ?? ''), 'Choix conservé hors du catalogue UI');
      else c.value = String(value ?? '');
    }
    if (kind === 'quarters') {
      for (const c of Array.from(all<HTMLInputElement | HTMLSelectElement>(kind, '[data-footprint]'))) c.value = String(layoutConfig.footprint[c.dataset.footprint as keyof LayoutConfig['footprint']]);
      generationControls(); syncCityPlanCulture();
    }
    const base = baseline(config), fields = one<HTMLElement>(kind, '[data-fields]'); fields.replaceChildren();
    for (const key of catalogue.fields[kind]) {
      if (hiddenFields[kind].includes(key)) continue;
      const set = (value: unknown): void => {
        config.params[key] = value;
        if (kind === 'quarters' && sharedFields.includes(key)) { parcelConfig.params[key] = clone(value); changed('parcels'); }
      };
      const raw = config.params[key] ?? base[key] ?? (key === 'deepFill' ? false : 0);
      const zoned = base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key]);
      const overrides = config.params[key] && typeof config.params[key] === 'object' && !Array.isArray(config.params[key]) ? config.params[key] as Record<string, unknown> : {};
      const zone = config.zone === 'auto' ? 'core' : config.zone;
      const value = zoned ? overrides[zone] ?? (base[key] as Record<string, unknown>)[zone] ?? [0, 0] : raw;
      const label = document.createElement('label'); label.title = key;
      const title = document.createElement('span'); title.textContent = labels[key] ?? key; label.append(title);
      if (operators[key]) {
        const select = document.createElement('select'); select.replaceChildren(...operators[key].map(v => new Option(v, v))); select.value = String(value);
        select.onchange = () => set(select.value); label.append(select);
      } else if (Array.isArray(value)) {
        const pair = document.createElement('span'); pair.className = 'urban-array';
        value.forEach((v, i) => {
          const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = String(v); input.title = `${key}${zoned ? `.${zone}` : ''}[${i}]`;
          input.onchange = () => {
            const values = Array.from(pair.querySelectorAll('input')).map(e => Number(e.value));
            const previous = config.params[key];
            const zones = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
            if (values.every(Number.isFinite)) set(zoned ? { ...zones, [zone]: values } : values);
          }; pair.append(input);
        }); label.append(pair);
      } else {
        const input = document.createElement('input'); input.type = typeof value === 'boolean' ? 'checkbox' : 'number'; input.step = 'any';
        if (typeof value === 'boolean') input.checked = value; else input.value = String(value);
        input.onchange = () => set(input.type === 'checkbox' ? input.checked : Number(input.value)); label.append(input);
      }
      fields.append(label);
    }
  }
  const rendering = document.createElement('details'); rendering.className = 'advanced';
  rendering.innerHTML = `<summary>Rendu · empreinte, quartiers et parcelles</summary><div class="control-group">${Object.entries({ reserve: 'Réserve de croissance', allocated: 'Terre urbaine attribuée', centers: 'Noyaux et identités de quartier', domains: 'Domaines réservés', quarters: 'Secteurs de calcul', blocks: 'Îlots', streets: 'Rues urbaines', enclosures: 'Enceintes et portes', parcels: 'Parcelles', gardens: 'Jardins', places: 'Places et communs', fronts: 'Façades accessibles', axes: 'Axes des parcelles', access: 'Statut de desserte des parcelles' }).map(([key, label]) => `<label><input data-render="${key}" type="checkbox">${label}</label>`).join('')}<label>Palette<select data-render="palette"><option value="growth">Phases de croissance</option><option value="atlas">Atlas · quartiers</option><option value="ink">Encre</option><option value="terrain">Terrain</option></select></label><label>Opacité<input data-render="opacity" type="number" min="0" max="1" step="0.05"></label><label>Épaisseur des traits (px)<input data-render="width" type="number" min="0" max="5" step="0.1"></label></div><small>Ces réglages redessinent les résultats conservés, sans appel de génération. La réserve, la terre attribuée et les enceintes sont trois objets différents.</small>`;
  displayHost.append(rendering);
  if (options.city) rendering.open = true;
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
    return mergeWorkshopCities(state, { ...state, citySettings, layouts: incoming, partitions: next, buildingState: { ...buildingPanel.state, cold: undefined, scene } });
  }
  let lastBuildingAppearance = '';
  let lastBuiltScene: import('../../../rust/bridge/urbanArchitecture').PlacementBatch | undefined;
  let lastBuiltCold: ColdCityState | undefined;
  const sceneClient = createUrbanSceneClient();
  const parentClient = createUrbanParentSceneClient();
  const frameInfo = document.createElement('small'); frameInfo.className = 'city-frame'; frameInfo.dataset.cityFrame = '';
  let lastBuiltParent: UrbanParentBuildingState | undefined;
  type ParentView = Awaited<ReturnType<typeof openParentViewport>>;
  let parentView: ParentView | undefined, parentOpening: Promise<ParentView> | undefined, parentFailed = '', parentGenerationAbort: AbortController | undefined;
  const parentKey = (state: UrbanParentBuildingState) => JSON.stringify([state.store, state.cityKey, state.offset, executionRuntime]);
  const parentSlot = createColdViewportSlot<UrbanParentBuildingState, ParentView>(parentKey, async (state, signal) => {
    const backend = (await getColdBackend()).parents; signal.throwIfAborted();
    return openParentViewport(backend, state, nativeParentApi(executionRuntime), { signal, changed: () => { cityLayer?.request(); buildingPanel.refreshReport(); } });
  });
  const boundedParent = () => sameParentBuildingState(parentView?.state, buildingPanel.state.parent) ? parentView : undefined;
  function clearParentView() { parentSlot.clear(); parentView = undefined; parentOpening = undefined; parentFailed = ''; }
  async function ensureParentView(state: UrbanParentBuildingState): Promise<ParentView> {
    const task = parentSlot.ensure(state); parentOpening = task;
    try { const view = await task; if (parentSlot.current !== view) throw new DOMException('Parent source replaced', 'AbortError'); parentView = view; parentFailed = ''; return view; }
    catch (e) { if (parentOpening === task && (e as Error).name !== 'AbortError') parentFailed = parentKey(state); throw e; }
    finally { if (parentOpening === task) parentOpening = undefined; }
  }
  let coldBackend: ReturnType<typeof createIndexedDbBuildingChunkBackend> | undefined;
  const getColdBackend = () => {
    if (coldBackend) return coldBackend;
    const opening = createIndexedDbBuildingChunkBackend(); coldBackend = opening;
    void opening.catch(() => { if (coldBackend === opening) coldBackend = undefined; });
    return opening;
  };
  const sameCold = (a?: ColdCityState, b?: ColdCityState) => !!a && !!b
    && a.store.sceneId === b.store.sceneId && a.store.fingerprint === b.store.fingerprint && a.cityKey === b.cityKey
    && (a.offset?.x ?? 0) === (b.offset?.x ?? 0) && (a.offset?.y ?? 0) === (b.offset?.y ?? 0)
    && a.store.sourceFingerprint === b.store.sourceFingerprint && JSON.stringify(a.counts) === JSON.stringify(b.counts);
  const coldKey = (state: ColdCityState) => JSON.stringify([state.store, state.counts, state.cityKey, state.offset?.x ?? 0, state.offset?.y ?? 0]);
  let coldSession: ColdCitySession | undefined, coldLoadKey = '', coldFailedKey = '', coldLoadEpoch = 0;
  let coldView: ColdCityViewport | undefined, coldViewLoad: Promise<ColdCityViewport> | undefined, coldViewKey = '', coldViewEpoch = 0;
  let coldRepairAbort: AbortController | undefined, coldRepairState: ColdCityState | undefined;
  const boundedCold = () => sameCold(coldView?.state, buildingPanel.state.cold) ? coldView : undefined;
  const coldViewportSlot = createColdViewportSlot<ColdCityState, ColdCityViewport>(coldKey, async (state, signal) => {
    const backend = await getColdBackend(); signal.throwIfAborted();
    return openColdCityViewport(backend, state, { signal,
      realize: async (building, context) => { const { realizeUrbanBuilding } = await import('../../../rust/bridge/architecture');
        return realizeUrbanBuilding(building, executionRuntime, false, context.scene); },
      onChange: () => { if (sameCold(coldView?.state, state)) { cityLayer?.request(); reportSelectedDetail(); for (const listener of detailListeners) listener(); } },
    });
  });
  function clearColdView(): void { ++coldViewEpoch; coldViewLoad = undefined; coldViewKey = ''; coldViewportSlot.clear(); coldView = undefined; }
  async function ensureColdView(state: ColdCityState): Promise<ColdCityViewport> {
    if (coldRepairAbort && !coldRepairAbort.signal.aborted && sameCold(coldRepairState, state)) throw new Error('Reconstruction de l’aperçu en cours.');
    const key = coldKey(state);
    if (sameCold(coldView?.state, state)) {
      if (coldViewLoad && coldViewKey !== key) { ++coldViewEpoch; coldViewLoad = undefined; coldViewKey = ''; }
      await coldViewportSlot.ensure(state); return coldView!;
    }
    if (coldViewKey === key && coldViewLoad) return coldViewLoad;
    const epoch = ++coldViewEpoch; coldViewKey = key; const task = coldViewportSlot.ensure(state); coldViewLoad = task;
    try { const next = await task; if (epoch !== coldViewEpoch || coldViewportSlot.current !== next) throw new DOMException('Ville remplacée', 'AbortError');
      coldView = next; coldFailedKey = ''; return next;
    } catch (e) { if (epoch === coldViewEpoch && (e as Error).name !== 'AbortError') coldFailedKey = key; throw e; }
    finally { if (coldViewLoad === task) { coldViewLoad = undefined; coldViewKey = ''; } }
  }
  let coldEditAbort: AbortController | undefined;
  let coldLoad: Promise<ColdCitySession> | undefined;
  async function ensureColdSession(state: ColdCityState): Promise<ColdCitySession> {
    if (coldRepairAbort && !coldRepairAbort.signal.aborted && sameCold(coldRepairState, state)) throw new Error('Reconstruction de l’aperçu en cours.');
    if (sameCold(coldSession?.state, state)) return coldSession!;
    const key = coldKey(state);
    if (coldLoadKey === key && coldLoad) return coldLoad;
    const epoch = ++coldLoadEpoch; coldLoadKey = key;
    const task = getColdBackend().then(backend => openColdCitySession(backend, state, { ...(sitesCurrent() ? { sites: sceneRequestList } : {}), cancelled: () => epoch !== coldLoadEpoch }));
    coldLoad = task;
    try {
      const next = await task;
      if (epoch !== coldLoadEpoch) { next.dispose(); throw new DOMException('Ville remplacée', 'AbortError'); }
      coldSession?.dispose(); coldSession = next; coldFailedKey = '';
      if (next.siteVisuals && !sitesCurrent()) {
        sceneSites?.dispose(); sceneSites = createUnboundSiteStore(next.siteVisuals);
        sceneRequestList = next.siteVisuals; sceneRequestScene = state;
      }
      return next;
    } catch (error) { if (epoch === coldLoadEpoch) coldFailedKey = key; throw error; }
    finally { if (coldLoad === task) { coldLoad = undefined; coldLoadKey = ''; } }
  }
  function sitesCurrent(): boolean {
    return !!sceneRequestScene && (sceneRequestScene === buildingPanel.state.scene
      || 'store' in sceneRequestScene && sameCold(sceneRequestScene, buildingPanel.state.cold));
  }
  // A progressive prefix is display-only. History, exports and scoped edits keep
  // the last completed scene until the worker validates the complete stream.
  type ArchitecturePreview = { layouts: Layout[]; partitions: Partition[]; scene?: PlacementBatch;
    parent?: { records: ParentVisualRecords; renderer: UrbanBuildingLodRenderer<ParentMemberVisual>; counts: import('../../../rust/bridge/nativeParentContract').NativeParentCounts;
      source: import('../../../rust/bridge/nativeParentSessionContract').ParentSessionSource; sessionId: string; durableCompleted: number; nativeAckedCompleted: number };
    coldProjection?: NativeBuildingProjectionScene; buildings?: number; refusals?: number; openSpaces?: number;
    completed: number; total: number; errors: number; selected?: string };
  let architecturePreview: ArchitecturePreview | undefined, architectureEpoch = 0;
  function deactivateParentPaint(): void {
    // An invalidated marker is intentionally not an attestation of a new paint.
    if (frameInfo.dataset.parentEvidence) frameInfo.dataset.parentEvidence = JSON.stringify({ version: 'parent-city-viewport-evidence-1', phase: 'invalidated', active: false, complete: false });
  }
  function invalidateArchitecture(): void {
    deactivateParentPaint();
    ++architectureEpoch; architecturePreview?.parent?.renderer.clearCaches(); architecturePreview = undefined; sceneClient.invalidate();
    parentClient.invalidate(); parentGenerationAbort?.abort(new DOMException('Plan remplacé', 'AbortError')); clearParentView(); coldRepairAbort?.abort(new DOMException('Plan remplacé', 'AbortError'));
    ++coldLoadEpoch; coldLoad = undefined; coldLoadKey = ''; coldFailedKey = '';
    coldEditAbort?.abort(new DOMException('Plan remplacé', 'AbortError'));
    coldSession?.dispose(); coldSession = undefined; clearColdView();
    sceneRequestScene = undefined; sceneRequestList = []; sceneSites?.dispose(); sceneSites = undefined;
  }
  const buildingPanel = createUrbanBuildingsPanel({ host: stages, silhouettes: options.city,
    getProgramme: () => appliedLayout.programme,
    applyProgramme: programme => { layoutConfig.programme = clone(programme); controlRelevance?.sync(layoutConfig, layouts); appliedLayout = { ...clone(appliedLayout), programme: clone(programme) }; request('quarters'); options.onChange(); },
    generate: async (seed, settings, onProgress) => {
      coldRepairAbort?.abort(new DOMException('Nouveau calcul', 'AbortError'));
      const epoch = ++architectureEpoch, active = () => epoch === architectureEpoch;
      // Roads, plan and parcels must be applied first: a late regional road result
      // would re-run the plan and invalidate architecture already in progress.
      const settling = (): boolean => !!options.upstreamPending?.() || (['quarters', 'parcels'] as const).some(kind => one(kind, '[data-apply]').getAttribute('aria-busy') === 'true');
      await waitForArchitectureInputs({ pending: settling, current: active });
      if (!layouts || !partitions) throw new Error('Générez les parcelles avant les bâtiments.');
      if (target === 'all' && layouts.length > 1) throw new Error('Choisissez une ville avant d’implanter ses bâtiments.');
      const inputLayouts = layouts, inputPartitions = partitions;
      const selectedLayouts = layouts.filter(layout => target === 'all' || layout.key === target), selectedPartitions = partitions.filter(partition => selectedLayouts.some(layout => layout.key === partition.key));
      if (!selectedLayouts.length) throw new Error('Le plan de la ville sélectionnée est absent.');
      const source = options.getRaster?.() ?? options.getTerrain();
      if (!source) throw new Error('Le terrain d’appui est absent.');
      const retained = options.city ? urbanSource.select({ layouts, partitions, terrain: source, runtime: executionRuntime,
        keys: selectedLayouts.map(layout => layout.key) }) : undefined;
      const raster = retained ? undefined : 'n' in source ? source : { ...settlementRaster(source, 1024), geometry: terrainGeography(source) };
      const preview: ArchitecturePreview | undefined = options.city && architectureMode !== 'silhouette'
        ? { layouts: inputLayouts, partitions: inputPartitions, completed: 0, total: 0, errors: 0 } : undefined;
      architecturePreview = preview;
      try {
        let generationNote: string | undefined;
        if (preview) {
          const support = await nativeParentSessionSupport(executionRuntime);
          if (!support.supported && buildingPanel.state.architectureContract === 'parent-session-1') throw new Error(`Ce replay exige le flux parents natifs : ${support.reason}`);
          if (!support.supported) generationNote = `Ancien moteur, flux de plans historiques : ${support.reason}`;
          if (support.supported) {
            if (typeof indexedDB === 'undefined') throw new Error('Le flux parents natifs nécessite le stockage transactionnel IndexedDB.');
            const stillCurrent = () => active() && architecturePreview === preview && layouts === inputLayouts && partitions === inputPartitions;
            const actualSeed = seed || appliedParcelSeed || options.getSeed(), backend = (await getColdBackend()).parents;
            const residentFingerprint = retained ? undefined : await coldCityFingerprint({ layouts: selectedLayouts, partitions: selectedPartitions,
              raster: 'n' in source ? source : settlementRaster(source, 1024), seed: actualSeed, settings, buildingOverrides: edits.buildings });
            const identity = await parentGenerationIdentity({ source: retained?.source, residentFingerprint, keys: selectedLayouts.map(l => l.key), seed: actualSeed,
              settings, buildingOverrides: edits.buildings, runtime: executionRuntime });
            if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
            comparison.api.end(); architectureView = '2d';
            const abort = new AbortController(); parentGenerationAbort?.abort(); parentGenerationAbort = abort;
            const sample = createParentStreamWindow(), renderer = new UrbanBuildingLodRenderer<ParentMemberVisual>({ buildings: [] }, { raster: false });
            const response = await parentClient.run({ raster, layouts: selectedLayouts, partitions: selectedPartitions, ...retained, seed: actualSeed, settings,
              runtime: executionRuntime, mode: architectureMode === 'detailed' ? 'detailed' : 'compact', buildingOverrides: edits.buildings, parentSession: identity },
              { backend, sourceFingerprint: identity.fingerprint, signal: abort.signal, progress: onProgress,
                // Scene client invokes this only in a guarded, coalesced RAF, never on durable ACK.
                onBatch: (batch, message, counts) => {
                  if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
                  const box = options.map.viewBox.baseVal, records = sample.append(batch, [box.x, box.y, box.x + box.width, box.y + box.height]);
                  renderer.replaceScene({ buildings: records.members, materials: records.materials });
                  preview.parent = { records, renderer, counts: { ...counts }, source: identity, sessionId: message.sessionId,
                    durableCompleted: message.progress.completed, nativeAckedCompleted: preview.parent?.nativeAckedCompleted ?? 0 };
                  preview.completed = message.progress.completed; preview.total = message.progress.total; draw();
                }, onAcknowledged: value => {
                  if (!stillCurrent() || !preview.parent || preview.parent.sessionId !== value.receipt.session_id) throw new DOMException('Préfixe remplacé', 'AbortError');
                  preview.parent.nativeAckedCompleted = value.reply.completed; cityLayer?.request();
                } });
            if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
            const state: UrbanParentBuildingState = { store: response.store, counts: response.counts, generation: response.generation, cityKey: selectedLayouts[0].key, binding: 'generated' };
            // Publication comes only after source/index/cache CAS and native release.
            await ensureParentView(state); if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
            sample.clear(); renderer.clearCaches(); architecturePreview = undefined; parentGenerationAbort = undefined;
            return { parent: state, timing: response.timing };
          }
        }
        if (preview && retained && executionRuntime.profile === 'local' && layouts.length === 1 && typeof indexedDB !== 'undefined') {
          const stillCurrent = () => active() && architecturePreview === preview && layouts === inputLayouts && partitions === inputPartitions;
          const actualSeed = seed || appliedParcelSeed || options.getSeed(), backend = await getColdBackend();
          const fingerprint = await coldCityFingerprint({ layouts: selectedLayouts, partitions: selectedPartitions,
            raster: 'n' in source ? source : settlementRaster(source, 1024), seed: actualSeed, settings, buildingOverrides: edits.buildings });
          if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
          const streamWindow = createColdStreamWindow();
          const response = await sceneClient.runCold({ ...retained, seed: actualSeed, settings,
            runtime: { ...executionRuntime, profile: 'local' }, mode: architectureMode === 'detailed' ? 'detailed' : 'compact', buildingOverrides: edits.buildings },
          { backend, sourceFingerprint: fingerprint, progress: onProgress, onProjection: (chunk, progress) => {
            if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
            const box = options.map.viewBox.baseVal;
            preview.coldProjection = streamWindow.append(chunk, [box.x, box.y, box.x + box.width, box.y + box.height]);
            publishColdArchitectureBatch(preview, chunk, progress);
          } });
          if (!stillCurrent()) throw new DOMException('Plan remplacé', 'AbortError');
          const state: ColdCityState = { store: response.store, counts: response.counts, cityKey: selectedLayouts[0].key };
          const view = await ensureColdView(state);
          if (!stillCurrent()) { view.dispose(); throw new DOMException('Plan remplacé', 'AbortError'); }
          const nextSites = response.siteData.kind === 'native-sites'
            ? createNativeSiteStore(response.siteData.visuals, response.siteData.query, executionRuntime, { originLookup: id => view.readOrigin(id) }) : undefined;
          ++coldLoadEpoch; coldSession?.dispose(); coldSession = undefined; coldFailedKey = '';
          sceneSites?.dispose(); sceneSites = nextSites; sceneRequestList = nextSites?.visuals ?? []; sceneRequestScene = state;
          streamWindow.clear(); cityRenderer?.clearCaches(); cityRenderer = undefined; cityProjectionOf = undefined;
          architecturePreview = undefined;
          return { cold: state, timing: response.timing, generationNote };
        }
        const response = await sceneClient.run({ raster, layouts: selectedLayouts, partitions: selectedPartitions, ...retained, seed: seed || appliedParcelSeed || options.getSeed(), settings, runtime: executionRuntime, silhouettes: options.city, mode: options.city ? architectureMode : undefined, buildingOverrides: options.city ? edits.buildings : undefined }, onProgress,
          preview ? (delta, progress, scene) => {
            if (!active() || architecturePreview !== preview || layouts !== inputLayouts || partitions !== inputPartitions) throw new DOMException('Plan remplacé', 'AbortError');
            publishArchitectureBatch(preview, delta, progress, scene);
          } : undefined);
        if (!active() || layouts !== inputLayouts || partitions !== inputPartitions) throw new DOMException('Plan remplacé', 'AbortError');
        if (!response.scene) throw new Error('La scène bâtie est absente.');
        const merged = replaceCities(selectedLayouts, response.partitions ?? selectedPartitions, response.scene), scene = merged.buildingState!.scene!;
        const nextSites = response.sites !== undefined
          ? createNativeSiteStore(response.sites, response.siteQuery!, executionRuntime)
          : createLegacySiteStore(response.requests ?? []);
        // Plan-only generation does not change parcel capacities or identities.
        if (response.partitions) { urbanSource.clear(); partitions = merged.partitions; }
        if (preview?.scene === cityBuiltOf && cityRenderer && scene.buildings.length === response.scene.buildings.length
          && scene.buildings.every((building, index) => building === response.scene!.buildings[index])) {
          cityBuiltOf = scene; cityBuilt = buildCityBuildings(scene, cityPlan); cityDetails?.appendScene(scene);
        }
        sceneSites?.dispose(); sceneSites = nextSites; sceneRequestList = nextSites.visuals; sceneRequestScene = scene;
        if (architecturePreview === preview) architecturePreview = undefined;
        return { scene, timing: response.timing, generationNote };
      } catch (error) {
        if (architecturePreview === preview) { preview?.parent?.renderer.clearCaches(); architecturePreview = undefined; draw(); }
        throw error;
      }
    },
    onChange: state => {
      const coldChanged = !sameCold(state.cold, lastBuiltCold) && (state.cold !== undefined || lastBuiltCold !== undefined);
      const parentChanged = !sameParentBuildingState(state.parent, lastBuiltParent) && (!!state.parent || !!lastBuiltParent);
      if (parentChanged && !sameParentBuildingState(parentView?.state, state.parent)) clearParentView();
      const changedScene = state.scene !== lastBuiltScene || coldChanged || parentChanged;
      if (parentChanged) deactivateParentPaint();
      if (coldChanged && !sameCold(coldView?.state, state.cold)) clearColdView();
      if (coldChanged && !sameCold(coldSession?.state, state.cold)) {
        ++coldLoadEpoch; coldLoad = undefined; coldLoadKey = ''; coldFailedKey = '';
        coldSession?.dispose(); coldSession = undefined;
      }
      const appearance = JSON.stringify({ visible: state.visible, appearance: state.appearance });
      if ((state.scene || state.cold || state.parent) && changedScene && render.view !== 'roles') render.view = 'buildings';
      const changedAppearance = appearance !== lastBuildingAppearance;
      lastBuiltScene = state.scene; lastBuiltCold = state.cold; lastBuiltParent = state.parent; lastBuildingAppearance = appearance;
      if (target !== 'all') rememberCities([target]); draw(); options.onChange();
      if (changedScene || changedAppearance) options.onPlanChange?.();
    }, onOpen: (building, context) => openUrbanHouseCase(building, context ?? buildingPanel.state.scene),
    ...(options.city ? { onAssembly: openSelectedAssembly } : {}),
    readColdBuilding: async (state, id) => (await ensureColdView(state)).read(id, 'selection'),
    loadColdRefusals: async state => { await ensureColdSession(state); },
    getColdRefusals: state => sameCold(coldSession?.state, state) ? coldSession?.projection.refusals : undefined,
    exportCold: state => downloadColdBuildings(getColdBackend(), state),
    readParentBuilding: async (state, id) => (await ensureParentView(state)).read(id),
    exportParent: state => downloadParentBuildings(getColdBackend().then(b => b.parents), state),
    importParent: async file => { if (buildingPanel.busy) throw new Error('Attendez la génération en cours.');
      const state = await readParentBuildings(file, (await getColdBackend()).parents, nativeParentApi(executionRuntime), { expectedCityKey: target === 'all' ? undefined : target });
      invalidateArchitecture(); await ensureParentView(state); return state; },
    onProjection: active => { if (active && buildingPanel.state.parent) { inspectorNote('La vue 3D des parents natifs n’est pas encore prise en charge.'); return; } const applied = options.onProjection?.(active, buildingPanel.state.camera); if (typeof applied === 'boolean') buildingPanel.state.projection = applied; },
  });
  if (options.before) options.before.before(buildingPanel.programme, buildingPanel.panel, ...(displaySection ? [displaySection] : []));
  // City Bench has no backend anchor: the display section follows the building panel.
  else if (displaySection) buildingPanel.panel.after(displaySection);
  const architectureNames: Record<UrbanSceneMode, string> = { silhouette: 'Volumes de la ville', compact: 'Plan compact (générateur houses)', detailed: 'Détaillé (générateur houses)' };
  const architectureActions: Record<UrbanSceneMode, string> = { silhouette: 'Tracer les silhouettes', compact: 'Planifier les bâtiments', detailed: 'Planifier et détailler la vue' };
  const architectureLabel = document.createElement('label'), cityCounts = document.createElement('small');
  const cacheRepair = document.createElement('details'); cacheRepair.className = 'advanced'; cacheRepair.dataset.coldRepair = ''; cacheRepair.hidden = true;
  cacheRepair.innerHTML = '<summary>Reconstruire l’aperçu</summary><small>Les plans sont conservés. Reconstruit seulement leur affichage, sans modifier les bâtiments.</small><button type="button" data-cold-repair-start>Reconstruire l’aperçu</button><button type="button" data-cold-repair-cancel hidden>Annuler</button><small data-cold-repair-status role="status"></small>';
  const repairStart = cacheRepair.querySelector<HTMLButtonElement>('[data-cold-repair-start]')!, repairCancel = cacheRepair.querySelector<HTMLButtonElement>('[data-cold-repair-cancel]')!;
  const repairStatus = cacheRepair.querySelector<HTMLElement>('[data-cold-repair-status]')!;
  repairCancel.onclick = () => { coldRepairAbort?.abort(new DOMException('Réparation annulée', 'AbortError')); repairCancel.disabled = true; repairStatus.textContent = 'Annulation : attente de la lecture déjà engagée…'; };
  repairStart.onclick = () => { void (async () => {
    const parent = buildingPanel.state.parent;
    if (parent) { if (coldRepairAbort) return; const abort = new AbortController(); coldRepairAbort = abort;
      repairStart.disabled = true; repairCancel.disabled = false; repairCancel.hidden = false; repairStatus.textContent = 'Relecture native des seules archives pour reconstruire les affichages…';
      try { await (await ensureParentView(parent)).repair(abort.signal); repairStatus.textContent = 'Affichage reconstruit, plans inchangés.'; draw(); }
      catch (e) { repairStatus.textContent = String(e); }
      finally { if (coldRepairAbort === abort) coldRepairAbort = undefined; repairStart.disabled = false; repairCancel.hidden = true; }
      return;
    }
    const state = buildingPanel.state.cold; if (!state || coldRepairAbort) return;
    const abort = new AbortController(), epoch = architectureEpoch; coldRepairAbort = abort; coldRepairState = state;
    clearColdView(); ++coldLoadEpoch; coldLoad = undefined; coldLoadKey = ''; coldSession?.dispose(); coldSession = undefined; coldFailedKey = coldKey(state);
    repairStart.disabled = true; repairCancel.disabled = false; repairCancel.hidden = false; cacheRepair.setAttribute('aria-busy', 'true');
    const current = () => epoch === architectureEpoch && sameCold(state, buildingPanel.state.cold);
    repairStatus.textContent = 'Préparation de l’aperçu des plans conservés…'; draw();
    try {
      const backend = await getColdBackend();
      await repairColdDerivedCache(backend, state, { signal: abort.signal, current,
        progress: p => { if (current()) repairStatus.textContent = `${p.phase === 'complete' ? 'Aperçu préparé' : 'Reconstruction de l’aperçu'} : ${p.completed.toLocaleString()}/${p.total.toLocaleString()} lots`; } });
      if (!current()) throw new DOMException('Plan remplacé', 'AbortError');
      coldFailedKey = ''; coldRepairAbort = undefined; coldRepairState = undefined; repairCancel.hidden = true; repairCancel.disabled = true;
      await ensureColdView(state); repairStatus.textContent = 'Affichage proche disponible. L’aperçu global continue de se préparer.';
      buildingPanel.refreshReport(); draw(); options.onChange();
    } catch (e) {
      if (current()) { coldFailedKey = coldKey(state); cacheRepair.dataset.diagnostic = String(e);
        repairStatus.textContent = abort.signal.aborted ? 'Reconstruction annulée. Les plans n’ont pas été modifiés ; vous pouvez réessayer.'
          : /quota/i.test(String(e)) ? 'Espace disponible insuffisant pour reconstruire l’aperçu. Les plans sont conservés ; libérez du stockage puis réessayez.'
          : 'L’aperçu n’a pas pu être reconstruit. Les archives n’ont pas été modifiées ; vous pouvez réessayer.'; }
    } finally {
      if (coldRepairAbort === abort) { coldRepairAbort = undefined; coldRepairState = undefined; }
      repairStart.disabled = !buildingPanel.state.cold; repairCancel.hidden = true; cacheRepair.removeAttribute('aria-busy');
    }
  })(); };

  function architectureTitles(): void {
    if (!options.city) return;
    buildingPanel.panel.querySelector('summary')!.textContent = `9 · Bâtiments · ${architectureNames[architectureMode].toLowerCase()}`;
    buildingPanel.panel.querySelector('[data-buildings-generate]')!.textContent = architectureActions[architectureMode];
  }
  if (options.city) {
    // Silhouettes: city footprints only. Compact: native plans drawn by the LOD renderer.
    // Detailed enriches these same native plans only in the visible close-up.
    architectureLabel.innerHTML = `Architecture<select data-city-architecture>${Object.entries(architectureNames).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>`;
    const select = architectureLabel.querySelector('select')!; select.value = architectureMode;
    cityCounts.dataset.cityBuildingCounts = ''; cityCounts.setAttribute('role', 'status');
    buildingPanel.panel.querySelector('.urban-actions')!.after(architectureLabel, cityCounts, cacheRepair);
    select.onchange = () => {
      const previous = architectureMode;
      architectureMode = select.value as UrbanSceneMode; architectureTitles(); options.onChange();
      // Compact/detail is a display choice, including while plans are streaming.
      if (previous !== 'silhouette' && architectureMode !== 'silhouette') { draw(); return; }
      const regenerate = buildingPanel.state.generated || buildingPanel.busy;
      if (buildingPanel.busy) { invalidateArchitecture(); buildingPanel.restore(buildingPanel.state); }
      draw();
      if (layouts && partitions && regenerate) void buildingPanel.generate({ seed: buildingPanel.state.seed, settings: buildingPanel.state.settings });
    };
    architectureTitles();
  }
  buildingPanel.restore(initialBuildingState);
  let completeGeneration = false;
  let resetBuildingDefaults = false;
  installSettlementStyles(styleHost, style => {
    const next = applySettlementStyle(style, layoutConfig);
    layoutConfig = next.layout; parcelConfig = next.parcels;
    for (const kind of ['quarters', 'parcels'] as const) { one<HTMLTextAreaElement>(kind, '[data-json]').value = ''; populate(kind); }
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
  for (const [view, label] of Object.entries({ tissue: 'Tissu', uses: 'Usages', parcels: 'Parcelles', buildings: 'Bâtiments', ...(options.city ? { roles: 'Rôles' } : {}) })) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.urbanView = view;
    button.onclick = () => { render.view = view as Render['view']; draw(); options.onChange(); options.onPlanChange?.(); }; views.append(button);
  }
  displayHost.prepend(views);
  const help = document.createElement('button'); help.type = 'button'; help.textContent = '?'; help.title = 'Méthode du parcellaire et des accès'; help.onclick = () => openMethodNote('urban-parcels'); views.append(help);
  const inspection = document.createElement('section'); inspection.className = 'urban-parcel-inspection';
  inspection.setAttribute('aria-live', 'polite'); displayHost.append(inspection);
  const editsBox = document.createElement('div'); editsBox.className = 'city-edits'; editsBox.dataset.cityEdits = '';
  // City Bench: legend of the roles view and frame statistics of the canvas.
  const legend = document.createElement('div'); legend.className = 'city-legend'; legend.dataset.cityLegend = '';

  if (options.city) { views.after(legend); inspection.before(editsBox); displayHost.append(frameInfo); }
  options.map.addEventListener('click', event => {
    if (options.city) { cityClick(event); return; }
    const building = (event.target as Element).closest('[data-urban-building]');
    if (building) { buildingPanel.select(building.getAttribute('data-urban-building')!); return; }
    // Silhouettes are drawn as a few merged paths: find the clicked footprint geometrically.
    const scene = buildingPanel.state.scene;
    if (buildingPanel.state.appearance.style === 'silhouette' && render.view === 'buildings' && scene) {
      const matrix = options.map.getScreenCTM()?.inverse();
      const p = matrix && new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
      const inside = (ring: Point[]): boolean => { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].y > p!.y) !== (ring[j].y > p!.y) && p!.x < (ring[j].x - ring[i].x) * (p!.y - ring[i].y) / (ring[j].y - ring[i].y) + ring[i].x) hit = !hit; return hit; };
      const found = p && scene.buildings.find(b => b.roof_footprint.some(shape => inside(shape.outer)));
      if (found) buildingPanel.select(found.id);
    }
    const path = (event.target as Element).closest<SVGPathElement>('[data-inspect-parcel]');
    if (!path) return;
    const layout = layouts?.find(l => l.key === path.dataset.layoutKey);
    const parcel = partitions?.find(p => p.key === layout?.key)?.parcels[Number(path.dataset.inspectParcel)];
    if (layout && parcel) inspection.innerHTML = parcelInspectionHtml(parcel, layout, Number(path.dataset.inspectParcel));
  });
  function read(kind: Kind, commit = true): void {
    const config = getConfig(kind);
    for (const c of Array.from(all<HTMLInputElement | HTMLSelectElement>(kind, '[data-config]'))) {
      if (c.disabled) continue;
      if (!c.checkValidity()) { c.reportValidity(); throw new Error('Corrigez les paramètres signalés.'); }
      (config as unknown as Record<string, unknown>)[c.dataset.config!] = configValue(c);
    }
    if (kind === 'quarters') for (const c of Array.from(all<HTMLInputElement | HTMLSelectElement>(kind, '[data-footprint]'))) {
      if (c.disabled) continue;
      if (!c.checkValidity()) { c.reportValidity(); throw new Error('Corrigez les paramètres d’empreinte signalés.'); }
      (layoutConfig.footprint as unknown as Record<string, unknown>)[c.dataset.footprint!] = configValue(c);
    }
    const json = one<HTMLTextAreaElement>(kind, '[data-json]').value.trim();
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
    if (kind === 'quarters') { quarterSeed = one<HTMLInputElement>(kind, '[data-seed]').value; appliedLayout = clone(layoutConfig); appliedQuarterSeed = quarterSeed; }
    else { parcelSeed = one<HTMLInputElement>(kind, '[data-seed]').value; appliedParcel = clone(parcelConfig); appliedParcelSeed = parcelSeed; }
    dirty[kind] = false;
    one(kind, '[data-draft-state]').hidden = true;
  }
  function apply(kind: Kind): void {
    clearTimeout(draftTimers[kind]);
    try {
      // Shared native keys also change the parcel draft: the plan applies it with them.
      if (kind === 'quarters' && sharedFields.length && dirty.parcels) { clearTimeout(draftTimers.parcels); read('parcels'); populate('parcels'); }
      read(kind); populate(kind); request(kind); options.onChange();
    }
    catch (error) { status(kind, String(error)); }
  }
  function changed(kind: Kind): void {
    dirty[kind] = true;
    const hint = one(kind, '[data-draft-state]'); hint.hidden = false;
    hint.textContent = options.getAuto?.() ? 'Modifications en attente · application automatique…' : `Modifications non appliquées · cliquez sur « ${kind === 'quarters' ? 'Régénérer la ville' : 'Régénérer les parcelles'} ».`;
    clearTimeout(draftTimers[kind]);
    try { read(kind, false); if (kind === 'quarters') controlRelevance?.sync(layoutConfig, layouts); options.map.dispatchEvent(new CustomEvent('urban:settings', { detail: { layoutConfig: clone(layoutConfig), parcelConfig: clone(parcelConfig), quarterSeed: one<HTMLInputElement>('quarters', '[data-seed]').value, parcelSeed: one<HTMLInputElement>('parcels', '[data-seed]').value } })); } catch { /* Keep invalid drafts local. */ }
    if (options.getAuto?.()) draftTimers[kind] = setTimeout(() => {
      if (options.getAuto?.()) apply(kind);
    }, 220);
  }
  function status(kind: Kind, text: string, busy = false): void {
    one(kind, '[data-status]').textContent = text;
    one<HTMLButtonElement>(kind, '[data-apply]').setAttribute('aria-busy', String(busy));
  }
  function request(kind: Kind): void {
    clearTimeout(timer);
    const source = options.getRaster ? options.getRaster() : options.getTerrain();
    if (!ready || !source || !settlements) return;
    if (kind === 'quarters' && !enabled || kind === 'parcels' && !parcelEnabled) return;
    if (kind === 'parcels' && !layouts) { status(kind, 'Générez d’abord les quartiers (bloc 6).'); return; }
    // A new applied computation may mutate the native revisions even if the
    // previous displayed plan survives a refusal. Do not keep its old handle.
    urbanSource.clear(); parcelSourceInput = undefined;
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
      message.layoutConfig = layoutWithEdits(clone(appliedLayout), edits); message.sites = selected.map(s => ({ key: s.key, population: s.population, culture: s.culture, center: s.center, radius: s.radius }));
      message.roads = regionalStreets(roads);
    } else {
      // The engine retains the exact serialized layouts of its last quarter response:
      // when they are still the applied plan, only their id is sent. A restarted
      // engine or another plan receives the full layouts.
      const selected = layouts!.filter(layout => target === 'all' || layout.key === target);
      parcelSourceInput = { id: message.id, layouts: selected, terrain: source, runtime: { ...executionRuntime } };
      parcelsById = layoutsId !== undefined && !!retainedLayouts && selected.length === retainedLayouts.length && selected.every((layout, i) => layout === retainedLayouts![i]);
      if (parcelsById) message.layoutsId = layoutsId; else message.layouts = selected;
      message.parcelConfig = parcelWithEdits(clone(appliedParcel), edits);
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
      // Retained layouts lost (engine restarted): resend the full plan once.
      if (appliedKind === 'parcels' && parcelsById) { layoutsId = undefined; retainedLayouts = undefined; request('parcels'); return; }
      completeGeneration = false;
      cachedTerrain = undefined;
      if (appliedKind === 'quarters') { appliedLayout = clone(successfulLayout); appliedQuarterSeed = successfulQuarterSeed; }
      else { appliedParcel = clone(successfulParcel); appliedParcelSeed = successfulParcelSeed; }
      dirty[appliedKind] = true; one(appliedKind, '[data-draft-state]').hidden = false;
      one(appliedKind, '[data-draft-state]').textContent = 'Calcul refusé · le dernier plan appliqué est conservé.';
      // A refused item edit is withdrawn: the kept plan does not carry it.
      if (editsBefore) { edits = editsBefore; editsBefore = undefined; editsReport(); inspectorNote(`Modification refusée par le moteur : ${response.error}`); }
      status(appliedKind, response.error); options.onChange(); return;
    }
    if (response.layouts || response.partitions) editsBefore = undefined;
    if (response.layouts) {
      if (resetBuildingDefaults) { buildingPanel.resetAppliedSettings(); resetBuildingDefaults = false; }
      successfulLayout = clone(appliedLayout); successfulQuarterSeed = appliedQuarterSeed;
      const merged = replaceCities(response.layouts, undefined);
      invalidateArchitecture(); buildingPanel.invalidate();
      layouts = merged.layouts; layoutsId = response.id; retainedLayouts = response.layouts; partitions = merged.partitions; buildingPanel.replaceScene(merged.buildingState?.scene); lastBuiltScene = buildingPanel.state.scene;
      rememberCities(response.layouts.map(layout => layout.key));
      populate('parcels'); syncCityPlanCulture();
      const count = (layouts ?? []).reduce((n, l) => n + l.blocks.length, 0);
      status('quarters', `Rust · ${layouts?.length ?? 0} settlement(s) · ${count} îlots · ${response.ms?.toFixed(0)} ms`);
      one('quarters', '[data-state]').textContent = `${count} îlots`;
      one('quarters', '[data-warnings]').textContent = warningText((layouts ?? []).flatMap(l => l.warnings.map(w => `${l.key} : ${w}`)));
      if (parcelEnabled) request('parcels'); else status('parcels', 'Génération des parcelles désactivée.');
    }
    if (response.partitions) {
      successfulParcel = clone(appliedParcel); successfulParcelSeed = appliedParcelSeed;
      const incoming = layouts!.filter(layout => response.partitions!.some(partition => partition.key === layout.key));
      const merged = replaceCities(incoming, response.partitions);
      invalidateArchitecture(); buildingPanel.invalidate();
      partitions = merged.partitions; buildingPanel.replaceScene(merged.buildingState?.scene); lastBuiltScene = buildingPanel.state.scene;
      if (parcelSourceInput?.id === response.id) {
        try {
          urbanSource.bind({ source: response.urbanSource, layouts, partitions, terrain: parcelSourceInput.terrain,
            nativeLayouts: parcelSourceInput.layouts, nativePartitions: response.partitions, runtime: parcelSourceInput.runtime });
        } catch (error) {
          completeGeneration = false; status('parcels', `Source urbaine retenue invalide : ${String(error)}`); draw(); options.onChange(); return;
        }
      }
      rememberCities(incoming.map(layout => layout.key));
      const count = (partitions ?? []).reduce((n, p) => n + p.parcels.length, 0);
      status('parcels', `Rust · ${count} parcelles · ${response.ms?.toFixed(0)} ms`);
      one('parcels', '[data-state]').textContent = `${count} parcelles`;
      one('parcels', '[data-warnings]').textContent = warningText((partitions ?? []).flatMap(p => p.warnings.map(w => `${p.key} : ${urbanCapacityWarningText(w)}`)));
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
    const box = one<HTMLElement>('quarters', '[data-composition]');
    one<HTMLElement>('quarters', '[data-settlement-resolution]').innerHTML = morphologyEvidenceHtml(enabled ? layouts : undefined);
    if (!enabled || !layouts) { box.replaceChildren(); return; }
    const names: Record<string, string> = { town: 'Bourg / ville', 'nucleated-village': 'Village groupé', 'street-village': 'Village-rue', hamlet: 'Hameau', district: 'Secteur isolé' };
    const hectares = (a: number): string => `${(a / 1e4).toFixed(2)} ha`;
    const historyNames: Record<string, string> = { foundation: 'Fondation', growth: 'Croissance', extension: 'Extension', absorption: 'Absorption d’un noyau', merge: 'Fusion de noyaux', enclosure: 'Agrandissement d’enceinte', access: 'Ouverture d’un accès', 'planned-extension': 'Extension planifiée', 'nucleus-absorption': 'Absorption d’un noyau', 'nucleus-growth': 'Croissance d’un noyau', 'nucleus-merger': 'Fusion de noyaux', 'road-accretion': 'Accrétion le long d’une voie', 'accessible-extension': 'Extension par accessibilité' };
    box.innerHTML = layouts.map(l => {
      const structure = l.structure, metrics = structure?.metrics;
      return `<article><strong>${esc(names[l.archetype ?? 'district'] ?? l.archetype ?? 'Lieu')}${layouts!.length > 1 ? ` · ${esc(l.key)}` : ''}</strong>${structure ? `<small data-growth-method>${esc(mechanisms[structure.mechanism] ?? structure.mechanism)} · ${esc(families[structure.family] ?? structure.family)}</small>` : ''}${metrics ? `<dl class="urban-metrics" data-urban-metrics><dt>Surface cible</dt><dd>${hectares(metrics.targetArea)}</dd><dt>Terre attribuée</dt><dd>${hectares(metrics.allocatedArea)}</dd><dt>Voirie et limites</dt><dd>${hectares(metrics.streetArea)}</dd><dt>Réserves et espaces communs</dt><dd>${hectares(metrics.reservedArea)}</dd><dt>Densité brute appliquée</dt><dd>${metrics.grossDensity.toFixed(1)} hab./ha</dd><dt>Population de planification</dt><dd>${Math.round(metrics.plannedPopulation).toLocaleString()} hab.</dd><dt>Déficit de surface</dt><dd>${hectares(metrics.shortfallArea)}</dd><dt>Noyaux / composantes</dt><dd>${structure!.centers.length} / ${metrics.components}</dd><dt>Accès ajoutés</dt><dd>${metrics.accessAdded}</dd></dl><small>Ces budgets précèdent les bâtiments ; ils ne mesurent pas une capacité d’hébergement.</small>` : ''}${l.phases?.length ? `<table><caption>Composition appliquée · population prévue et emprise sèche</caption><thead><tr><th>Phase</th><th>Hab.</th><th>ha</th></tr></thead><tbody>${l.phases.map((p, i) => `<tr data-phase="${i}" data-kind="${esc(p.kind)}"><th><span class="urban-swatch" style="background:${p.kind === 'faubourg' ? zoneColors.faubourg : zoneColors[p.zone] ?? '#a0bc84'}"></span>${phaseLabel(p.kind, p.zone)}${growthPhaseCultureHtml(p)}<small>${esc(p.recipe)} · ${l.quarters.filter(q => q.phase === i).length} secteurs</small></th><td>${Math.round(p.population).toLocaleString()}</td><td title="Emprise prévue : ${hectares(p.targetArea)}">${(p.shapes.reduce((sum, s) => sum + shapeArea(s), 0) / 1e4).toFixed(1)}</td></tr>`).join('')}</tbody></table>` : '<small>Une seule recette dans une emprise de travail. Choisissez « Agglomération complète » pour évaluer un lieu entier.</small>'}${structure ? `<details class="advanced"><summary>Identités et étapes de croissance appliquées</summary><small>Étapes ordinales de croissance, sans datation historique enregistrée ; elles sont distinctes du filtre d’époque des sources architecturales.</small><ul>${structure.districts.map(d => `<li data-district="${esc(String(d.id))}">Q${d.id + 1} · noyau ${d.center + 1} · ${esc(tissues[d.tissue] ?? d.tissue)} · phase ${d.phase + 1} · ${d.quarters.length} secteurs</li>`).join('')}</ul><ol>${structure.history.map(h => `<li data-epoch="${h.epoch}">${esc(growthStepLabel(h.epoch))} · ${esc(historyNames[h.kind] ?? h.kind)} · noyau ${h.center + 1} · ${hectares(h.area)}</li>`).join('')}</ol></details>` : ''}</article>`;
    }).join('');
  }
  function parcelReport(): void {
    const active = enabled && parcelEnabled;
    if (reportedPartitions === partitions && diagnosticsEnabled === active) return;
    reportedPartitions = partitions; diagnosticsEnabled = active;
    const box = one<HTMLElement>('parcels', '[data-parcel-diagnostics]');
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
  let programmesOf: object | undefined = {};
  function draw(): void {
    for (const button of Array.from(views.querySelectorAll<HTMLButtonElement>('[data-urban-view]'))) button.setAttribute('aria-pressed', String(button.dataset.urbanView === render.view));
    // Camera changes call draw(): the programme table is rebuilt only for a new plan.
    if (programmesOf !== (partitions ?? layouts)) { programmesOf = partitions ?? layouts; buildingPanel.updateProgrammes((partitions ?? layouts ?? []).flatMap(p => p.programme ? [p.programme] : [])); }
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
    if (options.city) { drawCityLayer(layer); return; }
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
        const detailed = cityWallSvg(enclosure, render.palette); // walls hook (cityWalls.ts): styled curtain, towers, gates, ditch
        if (detailed) { for (const part of detailed) { const p = add(part.d, part.fill, part.stroke, part.width, true); p.dataset.enclosure = enclosure.kind; if (part.dash) p.setAttribute('stroke-dasharray', part.dash); if (part.opacity !== undefined && part.opacity < 1) p.setAttribute('opacity', String(part.opacity)); } continue; }
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
  // ------------------------------------------------------------ City Bench canvas
  // The plan is indexed once per applied result; camera changes only repaint.
  let cityLayer: CityCanvasLayer | CityGlCanvasLayer | undefined, cityPlan: CityScene | undefined, cityPlanOf: [Layout[] | undefined, Partition[] | undefined] | undefined;
  type CityVisual = PlacedBuilding | NativeBuildingProjection;
  let cityBuilt: CityBuildings | undefined, cityBuiltOf: PlacementBatch | undefined | null = null;
  let cityRenderer: UrbanBuildingLodRenderer<CityVisual> | undefined, cityProjectionOf: NativeBuildingProjectionScene | undefined;
  let cityDetails: UrbanBuildingDetailController<CityVisual> | undefined;
  let architectureView: '2d' | '3d' = '2d';
  const detailListeners = new Set<() => void>();
  let cityLod: CityLod | undefined, cityFrame: CityFrameStats | undefined, selectedParcel: number | undefined, refusedParcels: Set<string> | undefined;
  let legendOf: [string, CityScene | undefined] = ['', undefined];
  let inspectedOf: [CityScene | undefined, CityBuildings | undefined] = [undefined, undefined];
  let inspectedProjection: NativeBuildingProjectionScene | undefined;
  let countsKey = '', countsScene: PlacementBatch | undefined;
  const lodNames: Record<CityLod, string> = { far: 'lointaine · emprise', mid: 'moyenne · îlots et quartiers', near: 'proche · parcelles et bâtiments', close: 'rapprochée · tout le détail' };
  // Landmarks have no certified native recipe yet: in plan modes the city-side
  // massing (nave and tower, minaret, keep…) is drawn over the native plan,
  // labelled by programme, never a house standing in for a church.
  let landmarkBuilt: [UrbanSiteVisual[], CityScene | undefined, CityBuildings | undefined] | undefined;
  function landmarkOverlay(): CityBuildings | undefined {
    if (architecturePreview || !sitesCurrent()) return undefined;
    if (landmarkBuilt?.[0] !== sceneRequestList || landmarkBuilt[1] !== cityPlan) {
      const landmarks = sceneRequestList.filter(r => r.programme?.landmark && r.preview);
      landmarkBuilt = [sceneRequestList, cityPlan, landmarks.length ? buildCityBuildings(siteVisualScene(landmarks), cityPlan) : undefined];
    }
    return landmarkBuilt[2];
  }
  // Same-input comparison (Visual50 runner): transient paint override, no native call.
  let comparisonBuilt: [PlacementBatch, CityScene | undefined, CityBuildings | undefined] | undefined;
  const comparison = createCityComparison({
    current: () => {
      if (buildingPanel.state.parent || architecturePreview?.parent) throw new Error('La comparaison legacy des parents natifs n’est pas encore prise en charge.');
      const scene = buildingPanel.state.scene;
      if (!architecturePreview && layouts && partitions && sitesCurrent() && sceneRequestList.length
        && sameCold(coldSession?.state, buildingPanel.state.cold)) return { layouts, partitions, scene: coldSession!.projection, requests: sceneRequestList };
      return !architecturePreview && layouts && partitions && scene && sceneRequestScene === scene && scene.generator_version !== 'silhouette' && sceneRequestList.length ? { layouts, partitions, scene, requests: sceneRequestList } : undefined;
    },
    silhouette: requests => siteVisualScene(requests as UrbanSiteVisual[]),
    // A comparison never asks for native work: details are suspended (cache kept,
    // Codex `suspend()`) before any frame, including begin() and camera moves.
    repaint: () => {
      if (comparison.state()) cityDetails?.suspend();
      draw(); cityLayer?.request();
    },
  });
  function displayedArchitecture(): PlacementBatch | undefined {
    return architecturePreview && architecturePreview.layouts === layouts && architecturePreview.partitions === partitions
      ? architecturePreview.scene ?? buildingPanel.state.scene : buildingPanel.state.scene;
  }
  function replaceCityRenderer(scene?: PlacementBatch): void {
    cityRenderer?.clearCaches();
    cityProjectionOf = undefined;
    cityRenderer = scene && scene.generator_version !== 'silhouette' ? new UrbanBuildingLodRenderer<CityVisual>(scene) : undefined;
    if (!scene || !cityRenderer) { cityDetails?.dispose(); cityDetails = undefined; return; }
    cityDetails?.dispose();
    cityDetails = new UrbanBuildingDetailController<CityVisual>({ scene, renderer: cityRenderer,
      realize: async (building, context) => {
        const { realizeUrbanBuilding } = await import('../../../rust/bridge/architecture');
        return realizeUrbanBuilding(building, executionRuntime, false, context.scene);
      },
      onChange: () => { if (architectureView === '2d') cityLayer?.request(); reportSelectedDetail(); for (const listener of detailListeners) listener(); },
    });
  }
  function displayedColdProjection(): NativeBuildingProjectionScene | undefined {
    if (architecturePreview?.coldProjection && architecturePreview.layouts === layouts && architecturePreview.partitions === partitions)
      return architecturePreview.coldProjection;
    return (architectureView === '3d' || render.view === 'roles' || !!comparison.state()) && sameCold(coldSession?.state, buildingPanel.state.cold) ? coldSession?.projection : undefined;
  }
  function configureColdDetails(session: ColdCitySession): void {
    cityDetails?.dispose(); cityDetails = undefined;
    refusedParcels = new Set((session.projection.refusals ?? []).map(refusal => refusal.parcel_id));
    if (!cityRenderer) return;
    cityDetails = new UrbanBuildingDetailController<CityVisual>({ renderer: cityRenderer,
      canRealize: visual => 'projection' in visual && visual.nativeRealization === false,
      load: visual => session.read(visual.id),
      realize: async (building, context) => {
        const { realizeUrbanBuilding } = await import('../../../rust/bridge/architecture');
        return realizeUrbanBuilding(building, executionRuntime, false, context.scene);
      },
      onChange: () => { if (architectureView === '2d') cityLayer?.request(); reportSelectedDetail(); for (const listener of detailListeners) listener(); },
    });
  }
  function publishColdArchitectureBatch(preview: ArchitecturePreview, chunk: NativeBuildingProjectionScene, progress: ArchitectureBatchProgress): void {
    if (render.view !== 'roles') render.view = 'buildings';
    preview.completed = progress.completed; preview.total = progress.total;
    preview.buildings = (preview.buildings ?? 0) + chunk.metrics.buildings;
    preview.refusals = (preview.refusals ?? 0) + chunk.metrics.refusals;
    preview.openSpaces = (preview.openSpaces ?? 0) + chunk.metrics.openSpaces; preview.errors += chunk.metrics.errors;
    if (!cityRenderer || cityProjectionOf !== preview.coldProjection) {
      cityRenderer?.clearCaches(); cityDetails?.dispose(); cityDetails = undefined;
      cityRenderer = new UrbanBuildingLodRenderer<CityVisual>(preview.coldProjection!); cityProjectionOf = preview.coldProjection;
      refusedParcels = new Set();
    } else cityRenderer.replaceScene(preview.coldProjection!);
    refusedParcels = new Set((chunk.refusals ?? []).map(r => r.parcel_id));
    cityBuilt = undefined; cityBuiltOf = undefined;
    draw(); cityLayer?.request();
  }
  function publishArchitectureBatch(preview: ArchitecturePreview, delta: PlacementBatch, progress: ArchitectureBatchProgress, scene: PlacementBatch): void {
    const first = !preview.scene;
    preview.scene = scene; preview.completed = progress.completed; preview.total = progress.total;
    preview.errors += delta.refusals.filter(r => /error|erreur|invalid/i.test(r.code)).length;
    if (first || !cityRenderer || cityBuiltOf !== scene) {
      replaceCityRenderer(scene); cityBuiltOf = scene; cityBuilt = undefined; refusedParcels = new Set();
    } else { cityRenderer.appendScene(delta); cityDetails?.appendScene(scene); }
    for (const refusal of delta.refusals) refusedParcels!.add(refusal.parcel_id);
    if (first) { render.view = 'buildings'; draw(); }
    else { cityCountsReport(); cityLayer?.request(); }
  }
  function drawCityLayer(layer: SVGGElement): void {
    const scene = displayedArchitecture();
    compositionReport(); parcelReport(); controlRelevance?.sync(layoutConfig, layouts);
    if (drawnLayouts !== layouts || drawnPartitions !== partitions || drawnScene !== scene) {
      drawnLayouts = layouts; drawnPartitions = partitions; drawnScene = scene; drawnLayer = layer; selectedParcel = undefined;
      if (!architecturePreview) options.onPlanChange?.();
    }
    // Only the canvas host lives in the overlay; interactive markers stay in their own SVG layers.
    for (const child of Array.from(layer.children)) if (child.tagName !== 'foreignObject') child.remove();
    // WebGL2 draws the plan and silhouettes (one upload per plan, a few draw calls per
    // frame); the 2D canvas above keeps labels, glyphs, diagnostics and native roofs.
    cityLayer ??= new CityGlCanvasLayer(options.map, layer, paintCity); cityLayer.attach(layer);
    const visiblePartitions = parcelEnabled ? partitions : undefined;
    if (!enabled || !layouts) { cityPlan = undefined; cityPlanOf = undefined; }
    else if (!cityPlanOf || cityPlanOf[0] !== layouts || cityPlanOf[1] !== visiblePartitions) {
      cityPlan = buildCityScene(layouts, visiblePartitions ?? []); cityPlanOf = [layouts, visiblePartitions];
      if (!architecturePreview?.scene) cityBuiltOf = null;
    }
    const parentState = buildingPanel.state.parent;
    cacheRepair.hidden = !parentState && !buildingPanel.state.cold;
    if (!architecturePreview && parentState && !boundedParent() && !parentOpening && parentFailed !== parentKey(parentState))
      void publishParentUiTask(ensureParentView(parentState), () => !architecturePreview && sameParentBuildingState(parentState, buildingPanel.state.parent),
        () => { draw(); options.onPlanChange?.(); }, e => { inspectorNote(String(e)); cityCounts.textContent = String(e); });
    const coldState = buildingPanel.state.cold;
    if (!architecturePreview && coldState && !sameCold(coldView?.state, coldState)) {
      const key = coldKey(coldState);
      if (!coldRepairAbort && coldFailedKey !== key && coldViewKey !== key) {
        const loading = ensureColdView(coldState), epoch = coldViewEpoch;
        void loading.then(() => {
          if (epoch === coldViewEpoch && sameCold(coldState, buildingPanel.state.cold)) { draw(); buildingPanel.refreshReport(); options.onChange(); options.onPlanChange?.(); }
        }, error => { if (epoch === coldViewEpoch && sameCold(coldState, buildingPanel.state.cold)) { cacheRepair.dataset.diagnostic = String(error); cityCounts.textContent = /derived|cache/i.test(String(error))
          ? 'Plans conservés, aperçu à reconstruire. Utilisez « Reconstruire l’aperçu » ci-dessous.'
          : 'Lecture de l’affichage conservé indisponible. Vous pouvez tenter « Reconstruire l’aperçu » ci-dessous.'; } });
      }
    }
    if (!architecturePreview && coldState && (architectureView === '3d' || render.view === 'roles') && !sameCold(coldSession?.state, coldState) && !coldLoad) {
      void ensureColdSession(coldState).then(() => { draw(); options.onPlanChange?.(); }, e => inspectorNote(String(e)));
    }
    const parentSource = !!parentState || !!architecturePreview?.parent;
    const bounded = parentSource || !architecturePreview && architectureView === '2d' && render.view === 'buildings' && !!coldState && !comparison.state();
    const projection = displayedColdProjection();
    if (bounded) { cityBuilt = undefined; cityBuiltOf = undefined; cityDetails?.dispose(); cityDetails = undefined;
      cityRenderer?.replaceScene({ buildings: [] }); cityRenderer = undefined; cityProjectionOf = undefined; }
    else if (projection) {
      cityBuiltOf = undefined; cityBuilt = undefined;
      if (cityProjectionOf !== projection || !cityRenderer) {
        cityRenderer?.clearCaches(); cityRenderer = new UrbanBuildingLodRenderer<CityVisual>(projection); cityProjectionOf = projection;
        if (!architecturePreview && coldSession) configureColdDetails(coldSession);
      }
    } else if (cityBuiltOf !== scene || cityProjectionOf) {
      cityBuiltOf = scene; cityBuilt = scene ? buildCityBuildings(scene, cityPlan) : undefined;
      refusedParcels = scene?.refusals.length ? new Set(scene.refusals.map(r => r.parcel_id)) : undefined;
      try { replaceCityRenderer(scene); } catch (error) { console.warn('Rendu des bâtiments natifs indisponible', error); }
    }
    const gl = 'gl' in cityLayer ? cityLayer.gl : undefined;
    if (gl && cityPlan && glOf?.[0] !== cityPlan) {
      const plan = cityPlan; glOf = [plan, cityBuilt]; glReady = undefined;
      void gl.setScene(plan, cityBuilt).then(() => { if (glOf?.[0] === plan) { glReady = plan; cityLayer?.request(); } }, error => console.warn('Plan WebGL indisponible', error));
    } else if (gl && cityPlan && glOf?.[1] !== cityBuilt) {
      glOf = [cityPlan, cityBuilt];
      void gl.setBuildings(cityBuilt).then(() => cityLayer?.request(), error => console.warn('Bâtiments WebGL indisponibles', error));
    }
    cityCountsReport(); cityLegend();
    // edits hook (cityShapeEditor.ts): a replaced plan cancels the shape editor; view changes rescale it.
    if (shapeEditor?.active && (shapeEditOf?.[0] !== layouts || shapeEditOf?.[1] !== partitions)) shapeEditor.stop();
    shapeEditor?.update(); if (editsReportOf !== cityPlan) editsReport();
    // A new plan or scene (after an edit): the inspector re-reads the same place.
    if (inspected && (inspectedOf[0] !== cityPlan || inspectedOf[1] !== cityBuilt || inspectedProjection !== cityProjectionOf)) {
      inspectedOf = [cityPlan, cityBuilt]; inspectedProjection = cityProjectionOf; inspectAt(inspected);
    }
    cityLayer.request();
  }
  /** Plan uploaded to WebGL, and the plan whose upload has completed. */
  let glOf: [CityScene, CityBuildings | undefined] | undefined, glReady: CityScene | undefined;
  function paintCity(ctx: CanvasRenderingContext2D, frame: CityGlHostFrame): boolean {
    if (!cityPlan || !enabled) {
      if (architectureView === '2d') cityDetails?.update({ viewport: frame.viewport, metresPerPixel: frame.mpp, enabled: false });
      frameInfo.textContent = ''; return false;
    }
    const start = performance.now(), selected = architecturePreview?.selected ?? buildingPanel.state.selected;
    cityLod = selectCityLod(frame.mpp, cityLod);
    const compare = comparison.state(), silhouetteCompare = compare?.architecture === 'silhouette';
    const view = compare ? compare.renderView : render.view;
    if (compare && silhouetteCompare && (comparisonBuilt?.[0] !== compare.silhouette || comparisonBuilt[1] !== cityPlan)) comparisonBuilt = [compare.silhouette, cityPlan, buildCityBuildings(compare.silhouette, cityPlan)];
    const appearance = { style: (compare ? silhouetteCompare : architectureMode === 'silhouette') ? 'silhouette' as const : 'cartographic' as const, diagnostic: buildingPanel.state.appearance.diagnostic };
    const viewport = !compare && !architecturePreview && architectureView === '2d' && view === 'buildings' && buildingPanel.state.visible ? boundedCold() : undefined;
    viewport?.ensureViewport([frame.viewport.minX, frame.viewport.minY, frame.viewport.maxX, frame.viewport.maxY]);
    const parent = !compare && !architecturePreview && architectureView === '2d' && view === 'buildings' && buildingPanel.state.visible ? boundedParent() : undefined;
    const parentPreview = !compare && buildingPanel.state.visible && view === 'buildings' ? architecturePreview?.parent : undefined;
    const parentOwned = !!buildingPanel.state.parent || !!architecturePreview?.parent;
    const native = viewport ?? ((compare ? !silhouetteCompare && view === 'buildings' : buildingPanel.state.visible && render.view === 'buildings') ? cityRenderer : undefined);
    const detail = viewport ? viewport.details?.stats : architectureView === '2d' ? cityDetails?.update({ viewport: frame.viewport, metresPerPixel: frame.mpp, selectedId: selected,
      enabled: !compare && architectureMode === 'detailed' && !!native }) : cityDetails?.stats;
    // WebGL once its upload is done; comparisons and the parchment ink (hatching) keep Canvas 2D.
    const drawGl = !compare && glReady === cityPlan && (render.palette as string) !== 'parchment' ? frame.drawGl : undefined;
    const refused = appearance.diagnostic === 'access' ? refusedParcels : undefined;
    const glFrame = drawGl?.({ viewport: frame.viewport, metresPerPixel: frame.mpp, lod: cityLod, view, palette: render.palette, layers: render, selectedId: selected, selectedParcel,
      buildingsVisible: buildingPanel.state.visible && !native && !parentOwned, diagnostic: appearance.diagnostic, refusedParcels: refused });
    cityFrame = drawCity(ctx, cityPlan, { ...frame, lod: cityLod, view, palette: render.palette, width: render.width, layers: glFrame ? cityGlOverlayLayers(render) : render,
      buildings: compare ? (silhouetteCompare ? comparisonBuilt?.[2] : native ? landmarkOverlay() : cityBuilt) : native ? landmarkOverlay() : cityBuilt,
      buildingsVisible: !parentOwned && (compare ? view === 'buildings' : buildingPanel.state.visible && (!glFrame || !!native)), appearance,
      selectedBuilding: selected, selectedParcel, refusedParcels: refused });
    // Native plans have their own screen-size LOD and bounded overview tiles.
    // They must remain visible while the first chunks arrive, even at city scale.
    if (native) {
      // A comparison shows the retained compact plans only, never cached native exteriors.
      if (viewport) {
        const result = viewport.draw(ctx, { viewport: frame.viewport, metresPerPixel: frame.mpp, appearance, selectedId: selected }, architectureMode === 'detailed');
        cityFrame.buildings = result.visibleBuildings ?? 0;
        frameInfo.dataset.coldCoverage = result.coverage; frameInfo.dataset.coldTotal = String(viewport.totals.buildings);
        frameInfo.dataset.coldResident = String(viewport.stats.residentBuildings);
      } else {
        const metrics = (native as UrbanBuildingLodRenderer<CityVisual>).draw(ctx, { viewport: frame.viewport, metresPerPixel: frame.mpp, appearance, selectedId: selected, useDetails: !compare });
        cityFrame.pending ||= metrics.rasterTilesPending > 0; cityFrame.buildings = metrics.visibleBuildings;
      }
    }
    if (parent) {
      const result = parent.draw(ctx, { viewport: frame.viewport, metresPerPixel: frame.mpp, appearance }, architectureMode === 'detailed');
      cityFrame.buildings = result.visibleMembers ?? 0; cityFrame.pending ||= result.pending;
      frameInfo.dataset.parentEvidence = JSON.stringify({ ...parent.evidence(), active: sameParentBuildingState(parent.state, buildingPanel.state.parent) && !architecturePreview, cityPalette: render.palette });
    } else if (parentPreview) {
      paintParentContexts(ctx, parentPreview.records.contexts, parentPreview.records.materials);
      const metrics = parentPreview.renderer.draw(ctx, { viewport: frame.viewport, metresPerPixel: frame.mpp, appearance, useDetails: false });
      cityFrame.buildings = metrics.visibleBuildings; cityFrame.pending = true;
      frameInfo.dataset.parentEvidence = JSON.stringify({ version: 'parent-city-viewport-evidence-1', phase: 'staging', active: false, complete: false, coverage: 'partial',
        sourceFingerprint: parentPreview.source.fingerprint, sourceRevision: parentPreview.source.revision, nativeSession: parentPreview.sessionId,
        durableCompleted: parentPreview.durableCompleted, nativeAckedCompleted: parentPreview.nativeAckedCompleted, counts: parentPreview.counts });
    } else if (parentOwned) frameInfo.dataset.parentEvidence = JSON.stringify({ version: 'parent-city-viewport-evidence-1', phase: 'loading', active: false, complete: false });
    else delete frameInfo.dataset.parentEvidence;
    cityFrame.ms = performance.now() - start;
    comparison.painted(cityFrame.pending, { blocks: cityFrame.blocks, parcels: cityFrame.parcels, streets: cityFrame.streets, buildings: cityFrame.buildings });
    frameInfo.dataset.detailCached = String(detail?.cached ?? 0); frameInfo.dataset.detailInFlight = String(detail?.globalInFlight ?? 0);
    frameInfo.dataset.detailCacheBytes = String(detail?.cacheBytes ?? 0);
    frameInfo.dataset.buildingsPainted = viewport?.stats.coverage === 'complete-native-contours' ? 'unknown' : String(cityFrame.buildings);
    frameInfo.dataset.renderer = glFrame ? 'webgl2' : 'canvas2d';
    frameInfo.textContent = `Vue ${lodNames[cityFrame.lod]} · ${frame.mpp < 1 ? frame.mpp.toFixed(2) : frame.mpp.toFixed(1)} m/px · ${glFrame ? `WebGL2 · ${glFrame.drawCalls} appels, ${(glFrame.triangles / 1000).toFixed(0)} k triangles` : `${cityFrame.blocks} îlots, ${cityFrame.parcels} parcelles, ${cityFrame.streets} rues`}${cityFrame.buildings ? `, ${cityFrame.buildings} bâtiments` : ''} · ${cityFrame.ms.toFixed(1)} ms${architectureMode === 'detailed' && detail ? ` · ${detail.cached} extérieurs détaillés, ${detail.inFlight} en calcul` : ''}`;
    if (viewport) frameInfo.textContent += ` · ${viewport.statusText}`;
    else if (architecturePreview?.coldProjection) { frameInfo.textContent += ' · contours partiels pendant l’implantation'; frameInfo.dataset.coldCoverage = 'partial-native-contours'; }
    return cityFrame.pending;
  }
  /** Real buildings, refusals and errors, never mixed with the population target. */
  function cityCountsReport(): void {
    if (!options.city) return;
    const scene = displayedArchitecture(), site = settlements?.settlements.find(s => s.key === target);
    const parentPreview = architecturePreview?.parent, parent = buildingPanel.state.parent;
    if (parentPreview || parent) {
      const c = parentPreview?.counts ?? parent!.counts;
      cityCounts.dataset.planning = String(!!parentPreview); cityCounts.dataset.completed = String(parentPreview?.durableCompleted ?? c.requests); cityCounts.dataset.total = String(architecturePreview?.total ?? c.requests);
      cityCounts.textContent = `${c.admitted_parents.toLocaleString()} résultats parents · ${c.physical_members.toLocaleString()} membres natifs · ${c.assembly_parents} assemblages · ${c.refusals} refus · ${c.open_spaces} espaces libres · capacité résidentielle inconnue${parentPreview ? ` · aperçu provisoire ${parentPreview.durableCompleted}/${architecturePreview!.total}, acquitté ${parentPreview.nativeAckedCompleted}` : ''}${site ? ` — population cible ${site.population.toLocaleString()} hab.` : ''}`;
      return;
    }
    const coldPreview = architecturePreview?.coldProjection ? architecturePreview : undefined, cold = buildingPanel.state.cold;
    if (coldPreview || cold) {
      const buildings = coldPreview?.buildings ?? cold!.counts.buildings, refused = coldPreview?.refusals ?? cold!.counts.refusals;
      const open = coldPreview?.openSpaces ?? cold!.counts.open_spaces, errors = coldPreview?.errors ?? coldSession?.projection.metrics.errors;
      const key = `cold/${cold?.store.sceneId}/${buildings}/${refused}/${open}/${errors}/${coldPreview?.completed}/${site?.population}`;
      if (countsKey === key && countsScene === undefined) return;
      countsKey = key; countsScene = undefined;
      const total = cold ? cold.counts.buildings + cold.counts.refusals + cold.counts.open_spaces : 0;
      cityCounts.dataset.planning = String(!!coldPreview); cityCounts.dataset.completed = String(coldPreview?.completed ?? total);
      cityCounts.dataset.total = String(coldPreview?.total ?? total);
      cityCounts.textContent = `${buildings.toLocaleString()} plans de bâtiments${coldPreview ? ` · affichage progressif ${coldPreview.completed.toLocaleString()}/${coldPreview.total.toLocaleString()} lots` : ''} · ${errors === undefined ? `${refused} refus et erreurs (détail conservé)` : `${Math.max(0, refused - errors)} refus · ${errors} erreurs`} · ${open} espaces libres · capacité habitante non évaluée${site ? ` — population cible ${site.population.toLocaleString()} hab.` : ''}`;
      return;
    }
    const preview = architecturePreview?.scene === scene ? architecturePreview : undefined;
    const key = `${target}/${scene?.buildings.length}/${scene?.refusals.length}/${preview?.completed}`;
    if (countsScene === scene && countsKey === key) return;
    countsScene = scene; countsKey = key;
    cityCounts.dataset.planning = String(!!preview); cityCounts.dataset.completed = String(preview?.completed ?? 0); cityCounts.dataset.total = String(preview?.total ?? 0);
    const errors = preview?.errors ?? scene?.refusals.filter(r => /error|erreur|invalid/i.test(r.code)).length ?? 0, refusals = (scene?.refusals.length ?? 0) - errors;
    const households = cityBuilt?.items.reduce((n, b) => n + ((b.building as { programme?: { households?: number } }).programme?.households ?? 0), 0) ?? 0;
    const landmarks = cityPlan?.landmarks.length ?? 0;
    cityCounts.textContent = scene ? `${scene.buildings.length.toLocaleString()} ${scene.generator_version === 'silhouette' ? 'silhouettes' : 'plans de bâtiments'}${preview ? ` · affichage progressif ${preview.completed.toLocaleString()}/${preview.total.toLocaleString()} lots` : ''} · ${refusals} refus · ${errors} erreurs · ${scene.open_spaces.length} espaces libres${landmarks ? ` · ${landmarks} monuments` : ''}${households ? ` · ${Math.round(households).toLocaleString()} ménages prévus` : ''}${site ? ` — population cible ${site.population.toLocaleString()} hab.` : ''}`
      : site ? `Population cible ${site.population.toLocaleString()} hab. · aucun bâtiment tracé.` : '';
  }
  function cityLegend(): void {
    if (!options.city || legendOf[0] === render.view && legendOf[1] === cityPlan) return;
    legendOf = [render.view, cityPlan];
    if (render.view !== 'roles') { legend.replaceChildren(); return; }
    const used = new Set(cityPlan?.districts.flatMap(d => d.role ? [districtRoleKey(d.role)] : []) ?? []);
    const swatch = (color: string, text: string): string => `<span><i class="urban-swatch" style="background:${color}"></i>${esc(text)}</span>`;
    const districtRoles = Object.entries(DISTRICT_ROLES).filter(([id]) => used.has(id));
    legend.innerHTML = `<strong>Quartiers</strong><div>${districtRoles.length ? districtRoles.map(([, r]) => swatch(r.color, r.label)).join('') : '<small>Rôles de quartier absents de ce plan · couleurs des phases.</small>'}</div><strong>Bâtiments et lots</strong><div>${Object.values(BUILDING_FAMILIES).map(f => swatch(f.color, f.label)).join('')}</div><small>Teinte claire : quartier modeste, soutenue : quartier aisé. Les monuments portent un pictogramme.</small>`;
  }
  /** Last inspected world point: after an edit round trip the inspector re-reads the same place. */
  let inspected: { x: number; y: number } | undefined, styleIndex: BuildingStyleIndex | undefined, styleLoad: Promise<BuildingStyleIndex | undefined> | undefined;
  const cultureLabels = Object.fromEntries(Object.entries(catalogue.cultures).map(([id, c]) => [id, c.label]));
  function cityClick(event: MouseEvent): void {
    const matrix = options.map.getScreenCTM()?.inverse();
    if (!matrix || !cityPlan) return;
    const world = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    inspected = { x: world.x, y: world.y };
    const buildingId = inspectAt(inspected);
    if (buildingId) {
      if (architecturePreview?.scene || architecturePreview?.coldProjection) architecturePreview.selected = buildingId;
      else buildingPanel.select(buildingId);
      reportSelectedDetail();
    }
    cityLayer?.request();
  }
  /** Picks the quarter, lot and house at `p` and renders the inspector; returns the house id. */
  function inspectAt(p: Point): string | undefined {
    if (!cityPlan) { inspection.replaceChildren(); return undefined; }
    if (architecturePreview?.parent) { inspection.textContent = 'Aperçu provisoire du préfixe conservé ; sélection disponible après validation complète.'; return undefined; }
    if (buildingPanel.state.parent && buildingPanel.state.visible && render.view === 'buildings') {
      const view = boundedParent(); if (!view) { inspection.textContent = 'Lecture des archives natives en cours…'; return undefined; }
      const show = (found: import('./urbanParentColdWindow').ParentMapPick) => {
        if (boundedParent() !== view || inspected?.x !== p.x || inspected?.y !== p.y) return;
        if (found.status !== 'exact') { inspection.textContent = 'Lecture partielle : aucun vide ne peut être conclu.'; return; }
        view.select(found.selection); if (!found.selection) { inspection.textContent = 'Aucun membre ni contexte natif à cet endroit.'; return; }
        buildingPanel.selectParent(found.selection); inspection.textContent = 'Lecture du parent natif…';
        const pick = found.selection;
        void publishParentUiTask(view.read(pick.parent_id), () => boundedParent() === view && !architecturePreview
          && inspected?.x === p.x && inspected?.y === p.y && JSON.stringify(buildingPanel.state.parentSelected) === JSON.stringify(pick),
          value => { inspection.innerHTML = nativeParentInspectionHtml(value, pick); }, e => { inspection.textContent = String(e); });
      };
      const picked = view.pick(p); if (picked.status === 'pending') { inspection.textContent = 'Lecture exacte du parent à cet endroit…';
        void publishParentUiTask(view.pickAt(p), () => boundedParent() === view && !architecturePreview && inspected?.x === p.x && inspected?.y === p.y,
          show, e => { inspection.textContent = String(e); }); }
      else show(picked);
      return undefined;
    }
    const buildingsShown = buildingPanel.state.visible && (render.view === 'buildings' || render.view === 'roles') && (cityLod === 'near' || cityLod === 'close');
    const viewport = !architecturePreview && !comparison.state() && render.view === 'buildings' ? boundedCold() : undefined;
    const native = buildingsShown && render.view === 'buildings' ? viewport?.renderer ?? cityRenderer : undefined;
    const hit = pickCity(cityPlan, buildingsShown && !native ? cityBuilt : undefined, p);
    const boundedHit = viewport?.pick(p);
    if (viewport && boundedHit?.status === 'pending') {
      renderCityInspector(inspection, hit, cityPlan, inspectorHooks); const pending = document.createElement('small');
      pending.textContent = 'Lecture exacte du bâtiment à cet endroit…'; pending.setAttribute('role', 'status'); inspection.append(pending);
      void viewport.pickAt(p).then(found => { if (boundedCold() === viewport && inspected?.x === p.x && inspected?.y === p.y) {
        if (found.status === 'exact') { const id = inspectAt(p); if (id) buildingPanel.select(id); } else pending.textContent = 'Lecture exacte encore partielle : aucun vide ne peut être conclu.';
      } }, e => { pending.textContent = String(e); }); return undefined;
    }
    const buildingId = boundedHit?.status === 'exact' ? boundedHit.building?.id : native?.pick(p)?.id ?? hit.building?.id;
    const built = buildingId !== undefined ? native?.getBuilding(buildingId) ?? cityBuilt?.items[cityBuilt.byId.get(buildingId) ?? -1]?.building : undefined;
    selectedParcel = hit.parcel ? cityPlan.parcels.indexOf(hit.parcel) : undefined;
    if (built && 'projection' in built) {
      const session = viewport ?? coldSession, point = { ...p }, plan = cityPlan;
      renderCityInspector(inspection, hit, plan, inspectorHooks);
      const pending = document.createElement('small'); pending.textContent = 'Lecture du plan natif…'; pending.setAttribute('role', 'status'); inspection.append(pending);
      if (!architecturePreview && session && sameCold(session.state, buildingPanel.state.cold)) void (viewport ? viewport.read(built.id, 'inspector', built as NativeBuildingProjection) : session.read(built.id, 'inspector')).then(value => {
        if (!value || (viewport ? boundedCold() !== viewport : coldSession !== session) || cityPlan !== plan || inspected?.x !== point.x || inspected?.y !== point.y) return;
        renderCityInspector(inspection, { ...hit, built: value.building }, plan, inspectorHooks);
        appendArchitectureOutcome(hit.parcel?.source.id, value.building);
        inspection.insertAdjacentHTML('beforeend', '<div data-city-realized></div>'); reportSelectedDetail();
      }, error => { if ((viewport ? boundedCold() === viewport : coldSession === session) && inspected?.x === point.x && inspected?.y === point.y) pending.textContent = String(error); });
      return buildingId;
    }
    renderCityInspector(inspection, { ...hit, built }, cityPlan, inspectorHooks);
    appendArchitectureOutcome(hit.parcel?.source.id, built);
    if (built) inspection.insertAdjacentHTML('beforeend', '<div data-city-realized></div>');
    const layout = hit.parcel && layouts?.[hit.parcel.layout];
    if (layout && hit.parcel) inspection.insertAdjacentHTML('beforeend', `<details class="advanced"><summary>Détails cadastraux</summary>${parcelInspectionHtml(hit.parcel.source, layout, hit.parcel.index)}</details>`);
    return buildingId;
  }
  function appendArchitectureOutcome(parcelId?: string, building?: PlacedBuilding): void {
    const refusal = parcelId && displayedColdProjection()?.refusals?.find(value => value.parcel_id === parcelId);
    if (refusal) {
      const note = document.createElement('small'); note.setAttribute('role', 'status'); note.textContent = `Implantation refusée : ${refusal.message}`; inspection.append(note);
    }
    if (!building || building.simplification !== 'architectural_plan') return;
    const target = sceneRequestList.find(site => site.id === building.id)?.programme?.built_area_m2;
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return;
    const actual = building.footprint.reduce((sum, polygon) => sum + shapeArea(polygon), 0), note = document.createElement('small');
    const targetScope = sceneSites?.matchesRuntime(executionRuntime) ? 'demande actuelle du site' : 'demande de site conservée (origine native non liée)';
    note.textContent = `Emprise du plan : ${actual.toFixed(1)} m²; ${targetScope} : ${target.toFixed(1)} m² (${(actual / target * 100).toFixed(1)} %). La capacité habitante reste non évaluée.`;
    inspection.append(note);
  }
  function inspectorNote(text: string): void { if (!options.city) return; const note = document.createElement('small'); note.setAttribute('role', 'status'); note.className = 'city-edit-refusal'; note.textContent = text; inspection.prepend(note); }
  /** Edited items count and a global reset; edits persist in the share query. */
  function editsReport(): void {
    if (!options.city) return;
    const n = editCount(edits);
    editsBox.innerHTML = n ? `<span>${n} élément(s) modifié(s) · ${Object.keys(edits.quarters).length} quartier(s), ${Object.keys(edits.parcels).length} parcelle(s), ${Object.keys(edits.buildings).length} bâtiment(s)</span><button type="button" data-edits-reset>Tout réinitialiser</button>` : '';
    structuralEditsReport(); // edits hook (cityShapeEditor.ts)
    editsBox.querySelector('[data-edits-reset]')?.addEventListener('click', () => {
      const replan = Object.keys(edits.quarters).length > 0, reparcel = Object.keys(edits.parcels).length > 0, rebuild = Object.keys(edits.buildings).length > 0;
      urbanSource.clear(); editsBefore = edits; edits = emptyEdits(); editsReport(); options.onChange();
      if (replan) request('quarters'); else if (reparcel) request('parcels');
      else if (rebuild && buildingPanel.state.generated) void buildingPanel.generate({ seed: buildingPanel.state.seed, settings: buildingPanel.state.settings });
    });
  }
  // ---- edits hook (cityShapeEditor.ts): shape editor, deleted items, dormant edits, engine echo.
  function startShapeEdit(scope: 'quarter' | 'lot', key: string, ring: ShapePt[], snap?: ShapePt[]): void {
    if (buildingPanel.state.parent) { inspectorNote('L’édition partielle des parents natifs n’est pas encore prise en charge. Régénérez le plan complet.'); return; }
    shapeEditor ??= createShapeEditor(options.map, options.map.closest<HTMLElement>('#viewport') ?? options.map.parentElement!);
    shapeEditOf = [layouts, partitions];
    const commit = (outer: ShapePt[]): void => { const shape = { outer, holes: [] }; if (scope === 'quarter') inspectorHooks.editQuarter(key, { shape }); else inspectorHooks.editLot(key, { shape }); };
    shapeEditor.start({ ring: scope === 'quarter' ? simplifyRing(ring) : simplifyLotRing(ring), original: ring, snap, title: scope === 'quarter' ? `Forme du quartier Q${Number(key) + 1}` : 'Forme de la parcelle',
      onCommit: commit, onCancel: () => { if (inspected) inspectAt(inspected); } });
  }
  const targetLayout = (): Layout | undefined => target === 'all' ? undefined : layouts?.find(l => l.key === target);
  const targetPartition = (): Partition | undefined => target === 'all' ? undefined : partitions?.find(p => p.key === target);
  function cityWarnings(): string[] {
    const l = targetLayout(), p = targetPartition();
    return [...l?.warnings ?? [], ...l?.programme?.warnings ?? [], ...p?.warnings ?? [], ...p?.programme?.warnings ?? []];
  }
  function echoedEdit(scope: 'quarter' | 'lot', key: string): Record<string, unknown> | undefined | null {
    if (editsBefore) return null; // a request is in flight: the echo is not for these edits yet
    const config = scope === 'quarter' ? targetLayout()?.config : targetPartition()?.config;
    if (!config) return null;
    return (scope === 'quarter' ? config.overrides?.quarters?.[key] : config.overrides?.parcels?.[key]) as Record<string, unknown> | undefined;
  }
  /** Deleted items (not clickable any more) with « Restaurer », and edits keyed on items absent from the plan. */
  function structuralEditsReport(): void {
    editsReportOf = cityPlan;
    const rows: string[] = [];
    for (const [k, e] of Object.entries(edits.quarters)) if (e.deleted) rows.push(`<div><span>Quartier Q${Number(k) + 1} supprimé</span><button type="button" data-restore-quarter="${esc(k)}">Restaurer</button></div>`);
    for (const [k, e] of Object.entries(edits.parcels)) if (e.deleted) rows.push(`<div><span>Parcelle ${esc(k)} ${e.deleted === 'garden' ? 'en jardin' : cityPlan?.parcelById.has(k) ? 'en jardin (fusion impossible)' : 'fusionnée'}</span><button type="button" data-restore-parcel="${esc(k)}">Restaurer</button></div>`);
    // Dormant: lot / house edits whose lot is absent (quarter redrawn), quarter keys beyond the plan.
    const plan = cityPlan, layout = targetLayout(), lotsKnown = !!plan && !!targetPartition() && !editsBefore;
    const dormant = {
      quarters: layout && !editsBefore ? Object.keys(edits.quarters).filter(k => !layout.quarters[Number(k)]) : [],
      parcels: lotsKnown ? Object.keys(edits.parcels).filter(k => !edits.parcels[k].deleted && !plan!.parcelById.has(k)) : [],
      buildings: lotsKnown ? Object.keys(edits.buildings).filter(k => !plan!.parcelById.has(k.replace(/\/building$/, ''))) : [],
    };
    const inactive = dormant.quarters.length + dormant.parcels.length + dormant.buildings.length;
    if (inactive) rows.push(`<div data-dormant-edits="${inactive}"><span>${inactive} retouche(s) inactive(s) (élément absent du plan actuel)</span><button type="button" data-purge-dormant>Purger les retouches inactives</button></div>`);
    if (!rows.length) return;
    editsBox.insertAdjacentHTML('beforeend', `<div class="city-edits-list">${rows.join('')}</div>`);
    for (const b of Array.from(editsBox.querySelectorAll<HTMLButtonElement>('[data-restore-quarter]'))) b.onclick = () => inspectorHooks.editQuarter(b.dataset.restoreQuarter!, { deleted: undefined });
    for (const b of Array.from(editsBox.querySelectorAll<HTMLButtonElement>('[data-restore-parcel]'))) b.onclick = () => inspectorHooks.editLot(b.dataset.restoreParcel!, { deleted: undefined });
    const purge = editsBox.querySelector<HTMLButtonElement>('[data-purge-dormant]');
    if (purge) purge.onclick = () => {
      let next = edits;
      for (const scope of ['quarters', 'parcels', 'buildings'] as const) for (const k of dormant[scope]) next = setEdit(next, scope, k, undefined);
      edits = next; editsReport(); options.onChange();
      if (dormant.quarters.length) request('quarters'); else if (dormant.parcels.length) request('parcels');
    };
  }
  const inspectorHooks: CityInspectorHooks = {
    edits: () => edits, cultures: cultureLabels, tissues,
    editShape: startShapeEdit,
    structuralLocked: () => target === 'all' ? 'Une seule ville ciblée requise pour modifier la forme, tirer au sort ou supprimer.' : undefined,
    warnings: cityWarnings, echoed: echoedEdit,
    houseLocked: building => architecturePreview ? 'La planification est en cours ; les styles seront éditables à la fin.'
      : architectureMode === 'silhouette' ? 'Les silhouettes sont un aperçu de la ville : passez l’architecture en « Plan compact » ou « Détaillé » pour choisir un style.'
      : !sitesCurrent() || !sceneSites?.has(building.id) || !sceneSites.matchesRuntime(executionRuntime) ? 'Site d’implantation absent ou périmé : relancez les bâtiments pour éditer leur style.' : undefined,
    styles: () => styleIndex,
    loadStyles: () => styleLoad ??= import('../../../rust/bridge/architecture').then(m => m.architecturalStyleIndex(executionRuntime)).then(index => (styleIndex = index), error => { console.warn('Index des styles indisponible', error); styleLoad = undefined; return undefined; }),
    editQuarter: (key, value) => { editsBefore = edits; edits = setEdit(edits, 'quarters', key, value); editsReport(); options.onChange(); request('quarters'); },
    editLot: (key, value) => { editsBefore = edits; edits = setEdit(edits, 'parcels', key, value); editsReport(); options.onChange(); request('parcels'); },
    editHouse: restyleHouse,
  };
  /** Native replan of one house from its authoritative site; the whole edit is
   * atomic and a refusal keeps the previous scene (Codex `editArchitectureScene`). */
  async function restyleHouse(id: string, value: CityEdits['buildings'][string] | undefined): Promise<string | undefined> {
    if (buildingPanel.state.parent) { inspectorNote('L’édition partielle des parents natifs n’est pas encore prise en charge.'); return undefined; }
    if (buildingPanel.state.cold) return restyleColdHouse(id, value);
    const sites = sceneSites, previous = buildingPanel.state.scene;
    if (!sites?.has(id) || !sites.matchesRuntime(executionRuntime) || !previous || sceneRequestScene !== previous || architecturePreview) return 'site d’implantation absent ou remplacé';
    const mode = architectureMode;
    try {
      const [original, { editArchitectureScene }, { planUrbanBuildings, placeUrbanBuildings }] = await Promise.all([
        sites.read(id), import('../../../rust/bridge/architectureEdits'), import('../../../rust/bridge/architecture')]);
      if (buildingPanel.state.scene !== previous || sceneRequestScene !== previous || sceneSites !== sites || architectureMode !== mode
        || architecturePreview || !sites.matchesRuntime(executionRuntime)) return 'scène remplacée pendant la lecture du site';
      // A scene holding retained compact plans (compact mode, and the City detailed mode
      // that plans first) is edited through plans; only an eager native scene replaces houses.
      const plans = previous.buildings.some(b => b.simplification === 'architectural_plan');
      const generate = (input: PlacementBatchRequest) => plans ? planUrbanBuildings(input, executionRuntime) : placeUrbanBuildings(input, executionRuntime);
      // A chosen style keeps the city's floor wish when it fits, else the nearest floor count of that style.
      const chosen = value, range = chosen && styleIndex?.entries.find(e => e.recipe_id === chosen.recipe && e.variant_id === chosen.variant)?.constraints.floors;
      if (chosen && chosen.floors === undefined) value = { ...chosen, floors: floorsFor(original, range) };
      const result = await editArchitectureScene(previous, [styledRequest(original, value)], generate, buildingPanel.state.settings);
      if (buildingPanel.state.scene !== previous || sceneRequestScene !== previous || sceneSites !== sites || architectureMode !== mode
        || architecturePreview || !sites.matchesRuntime(executionRuntime)) return 'scène remplacée pendant le calcul';
      if (!result.applied) return result.refusals.map(r => r.message || r.code).join(' · ') || 'refus du moteur';
      // A house-only replan does not mutate the retained terrain or parcels.
      // Keep their source so the next city replan still avoids a full upload.
      edits = setEdit(edits, 'buildings', id, value); editsReport();
      sceneRequestScene = result.scene;
      buildingPanel.replaceScene(result.scene); lastBuiltScene = result.scene; buildingPanel.select(id);
      draw(); options.onChange(); options.onPlanChange?.();
      return undefined;
    } catch (error) { return String(error); }
  }
  /** Selected-parent experiment. Native assembly storage is separate; this never
   * inserts group members into the Single city scene or changes its programme. */
  async function openSelectedAssembly(building: PlacedBuilding, context?: import('../../../rust/bridge/compactPlanArchive').PlanArchiveScene): Promise<void> {
    const { openNativeAssemblyBench } = await import('./nativeAssemblyBench');
    const sites = sceneSites, warm = buildingPanel.state.scene, cold = buildingPanel.state.cold, epoch = architectureEpoch;
    const current = () => epoch === architectureEpoch && sceneSites === sites && buildingPanel.state.scene === warm
      && buildingPanel.state.cold === cold && buildingPanel.state.selected === building.id && !architecturePreview && sitesCurrent() && sites?.matchesRuntime(executionRuntime);
    await openNativeAssemblyBench({ runtime: executionRuntime, parentId: building.id, isCurrent: () => Boolean(current()), async load() {
      if (!current() || !sites?.has(building.id) || building.simplification !== 'architectural_plan')
        throw new Error('Site natif absent ou périmé ; aucun assemblage ne peut être inféré depuis un aperçu.');
      if (cold && ((cold.offset?.x ?? 0) !== 0 || (cold.offset?.y ?? 0) !== 0))
        throw new Error('L’essai d’assemblage des villes translatées exige un site natif dans les mêmes coordonnées.');
      const [{ resolveArchivedPlan }, { coldArchitectureEditBounds }, { assemblyNeighborParts, readBoundedAssemblyNeighbors }, original] = await Promise.all([
        import('../../../rust/bridge/compactPlanArchive'), import('./urbanColdCityEdit'), import('./nativeAssemblyNeighbors'), sites.read(building.id),
      ]);
      if (!current()) throw new DOMException('Scène remplacée', 'AbortError');
      const site = styledRequest(original, edits.buildings[building.id]), bounds = coldArchitectureEditBounds(site);
      let neighbors: PlacedBuilding[];
      if (cold) {
        neighbors = await readBoundedAssemblyNeighbors(await getColdBackend(), cold, bounds);
      } else {
        if (!warm || sceneRequestScene !== warm) throw new Error('Scène native remplacée.');
        // Roof-only display bins cannot prove absence of an external circulation
        // surface. Scan the already retained native list under a strict bound.
        neighbors = warm.buildings;
      }
      const { occupied_parts, occupied_roof_parts } = assemblyNeighborParts(neighbors, building.id, bounds);
      const resolved = await resolveArchivedPlan(building, context ?? warm);
      if (!current()) throw new DOMException('Scène remplacée', 'AbortError');
      return { site, occupied_parts, occupied_roof_parts, incumbent: { ...building, resolved } };
    } });
  }
  async function restyleColdHouse(id: string, value: CityEdits['buildings'][string] | undefined): Promise<string | undefined> {
    const previous = buildingPanel.state.cold, sites = sceneSites;
    let session = coldSession;
    if (previous && !sameCold(session?.state, previous) && sites?.matchesRuntime(executionRuntime)) {
      try { session = await ensureColdSession(previous); } catch (e) { return String(e); }
    }
    if (!previous || !session || !sameCold(session.state, previous) || !sitesCurrent() || !sites?.has(id)
      || !sites.matchesRuntime(executionRuntime) || architecturePreview) return 'site d’implantation absent ou remplacé';
    if (coldEditAbort) return 'Une modification de maison est déjà en cours.';
    const abort = new AbortController(); coldEditAbort = abort;
    const epoch = architectureEpoch, mode = architectureMode;
    const current = () => !abort.signal.aborted && epoch === architectureEpoch && coldSession === session
      && sameCold(previous, buildingPanel.state.cold) && sceneSites === sites && sites.matchesRuntime(executionRuntime)
      && architectureMode === mode && !architecturePreview;
    try {
      const [original, { editColdCityBuilding }, { planUrbanBuildings }] = await Promise.all([
        sites.read(id), import('./urbanColdCityEdit'), import('../../../rust/bridge/architecture')]);
      if (!current()) return 'scène remplacée pendant la lecture du site';
      const chosen = value, range = chosen && styleIndex?.entries.find(e => e.recipe_id === chosen.recipe && e.variant_id === chosen.variant)?.constraints.floors;
      if (chosen && chosen.floors === undefined) value = { ...chosen, floors: floorsFor(original, range) };
      const nextEdits = setEdit(edits, 'buildings', id, value), terrain = options.getRaster?.() ?? options.getTerrain();
      if (!terrain || !layouts || !partitions) return 'terrain ou parcelles remplacés';
      const sourceFingerprint = await coldCityFingerprint({ layouts, partitions, raster: 'n' in terrain ? terrain : settlementRaster(terrain, 1024),
        seed: buildingPanel.state.seed || appliedParcelSeed || options.getSeed(), settings: buildingPanel.state.settings ?? {}, buildingOverrides: nextEdits.buildings });
      if (!current()) return 'scène remplacée avant la modification';
      const backend = await getColdBackend(), result = await editColdCityBuilding({ backend, session, original,
        edited: styledRequest(original, value), settings: buildingPanel.state.settings, sourceFingerprint,
        cancelled: () => !current(), signal: abort.signal, generate: input => planUrbanBuildings(input, executionRuntime) });
      if (!current()) return 'scène remplacée pendant le calcul';
      if (!result.applied) return result.message;
      const projection = replaceColdProjection(session.projection, result.replacement);
      const next = await openColdCitySession(backend, result.state, { projection, sites: session.siteVisuals, cancelled: () => !current() });
      if (!current()) { next.dispose(); return 'scène remplacée pendant la publication'; }
      ++coldLoadEpoch; session.dispose(); coldSession = next; coldFailedKey = ''; sceneRequestScene = result.state;
      edits = nextEdits; editsReport(); buildingPanel.replaceCold(result.state); lastBuiltScene = undefined; lastBuiltCold = result.state;
      buildingPanel.select(id); draw(); options.onChange(); options.onPlanChange?.(); return undefined;
    } catch (error) { return String(error); }
    finally { if (coldEditAbort === abort) coldEditAbort = undefined; }
  }
  /** Inspector and camera share the same bounded native queue/cache. */
  function reportSelectedDetail(): void {
    const id = architecturePreview?.selected ?? buildingPanel.state.selected;
    const box = inspection.querySelector<HTMLElement>('[data-city-realized]');
    if (!box || !id || architectureMode !== 'detailed') { if (box) box.textContent = ''; return; }
    const view = boundedCold(), building = view?.selected(id) ?? cityRenderer?.getBuilding(id), status = view?.details?.status(id) ?? cityDetails?.status(id);
    if (!building || !status) return;
    const text = status.state === 'ready' ? 'Extérieur natif réalisé.' : status.state === 'refused' ? `Extérieur non réalisé : ${status.message}. Le plan est conservé.`
      : status.state === 'loading' ? 'Calcul de l’extérieur…' : status.state === 'queued' ? 'Extérieur en attente…' : 'Plan conservé ; détail selon la vue.';
    const key = `${id}/${status.state}/${text}`;
    if (box.dataset.detailStatus === key) return;
    box.dataset.detailStatus = key;
    box.textContent = text;
    const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Ouvrir dans Maisons';
    open.onclick = () => { void (async () => {
      if ('projection' in building) {
        const value = await (boundedCold()?.read(building.id, 'open') ?? coldSession?.read(building.id, 'open')); if (!value) throw new Error('Plan natif absent ou remplacé.');
        await openUrbanHouseCase(value.building, value.scene);
      } else await openUrbanHouseCase(building, displayedArchitecture());
    })().catch(error => { box.textContent = String(error); }); };
    box.append(' ', open);
  }
  function schedule(): void { clearTimeout(timer); timer = setTimeout(() => request('quarters'), 120); }
  const removeEnclosure = one<HTMLButtonElement>('quarters', '[data-remove-enclosure]');
  if (removeEnclosure) removeEnclosure.onclick = () => {
    layoutConfig.fortification = 'none';
    appliedLayout = { ...appliedLayout, fortification: 'none' };
    one<HTMLSelectElement>('quarters', '[data-config="fortification"]').value = 'none';
    request('quarters'); options.onChange();
  };
  for (const kind of ['quarters', 'parcels'] as const) {
    one<HTMLButtonElement>(kind, '[data-apply]').onclick = () => apply(kind);
    one<HTMLInputElement>(kind, '[data-enabled]').onchange = e => {
      const checked = (e.target as HTMLInputElement).checked;
      if (!checked) { urbanSource.clear(); invalidateArchitecture(); buildingPanel.invalidate(); }
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
    for (const c of Array.from(all<HTMLInputElement | HTMLSelectElement>(kind, '[data-config]'))) c.onchange = () => {
      (getConfig(kind) as unknown as Record<string, unknown>)[c.dataset.config!] = configValue(c);
      if (c.dataset.config === 'composition') {
        if (layoutConfig.composition === 'settlement') { layoutConfig.placement = 'center'; layoutConfig.recipe = 'auto'; layoutConfig.zone = 'auto'; }
        else if (layoutConfig.recipe === 'auto') layoutConfig.recipe = 'core';
      }
      if (['zone', 'composition', 'placement'].includes(c.dataset.config!)) populate(kind);
      if (kind === 'quarters' && c.dataset.config === 'accessMode') generationControls();
    };
    for (const c of Array.from(all<HTMLInputElement | HTMLSelectElement>(kind, '[data-footprint]'))) c.onchange = () => {
      (layoutConfig.footprint as unknown as Record<string, unknown>)[c.dataset.footprint!] = configValue(c);
      if (['mechanism', 'budget', 'family'].includes(c.dataset.footprint!)) generationControls();
    };
    one<HTMLInputElement>(kind, '[data-seed]').oninput = e => {
      if (kind === 'quarters') quarterSeed = (e.target as HTMLInputElement).value;
      else parcelSeed = (e.target as HTMLInputElement).value;
    };
    for (const c of Array.from(all<HTMLSelectElement>(kind, '[data-config="culture"], [data-config="preset"], [data-config="recipe"]'))) c.onchange = () => {
      const config = getConfig(kind); (config as unknown as Record<string, unknown>)[c.dataset.config!] = c.value;
      config.params = {}; one<HTMLTextAreaElement>(kind, '[data-json]').value = '';
      if (c.dataset.config === 'culture') {
        config.recipe = 'auto'; config.zone = 'auto'; config.preset = 'culture';
        if (kind === 'quarters') {
          const next = applySettlementStyle('culture', layoutConfig, c.value);
          layoutConfig = next.layout; parcelConfig = next.parcels;
          one<HTMLTextAreaElement>('parcels', '[data-json]').value = ''; populate('parcels'); changed('parcels');
          buildingPanel.setBuildingDraft({ ...buildingPanel.state, settings: undefined });
          resetBuildingDefaults = true;
        }
      }
      if (c.dataset.config === 'recipe' && config.zone !== 'auto') config.zone = catalogue.cultures[config.culture && config.culture !== 'site' ? config.culture : siteCulture(kind)]?.recipes.find(r => r.id === config.recipe)?.zone ?? config.zone;
      populate(kind);
    };
    if (kind === 'quarters') one<HTMLButtonElement>(kind, '[data-morphology-auto]').onclick = () => { layoutConfig = resetMorphology(layoutConfig); populate(kind); changed(kind); };
    one<HTMLButtonElement>(kind, '[data-reset]').onclick = () => { getConfig(kind).params = {}; one<HTMLTextAreaElement>(kind, '[data-json]').value = ''; populate(kind); changed(kind); };
    for (const root of roots[kind]) {
      root.addEventListener('change', event => {
        const control = event.target as Element;
        // This select's own binding already records the independent plan draft.
        if (options.city && kind === 'quarters' && control.matches('[data-config="culture"]')) return;
        if (control.closest('[data-config], [data-footprint], [data-fields], [data-json], [data-seed]')) changed(kind);
      });
      root.addEventListener('input', event => {
        if ((event.target as Element).matches('[data-json], [data-seed]')) changed(kind);
      });
    }
  }
  if (options.city) controlRelevance = bindControlRelevance(one<HTMLElement>('quarters', '[data-control-relevance]'));
  if (options.city) cityPlanCulture = bindCityPlanCulture(
    one<HTMLDetailsElement>('quarters', '[data-plan-culture-override]'), one<HTMLSelectElement>('quarters', '[data-config="culture"]'),
    value => { layoutConfig = withCityPlanCulture(layoutConfig, value); populate('quarters'); changed('quarters'); });
  // Exploration draws replace the applied plan settings; each draw can be undone.
  const draws: { layout: LayoutConfig; parcels: ParcelConfig; quarterSeed: string; parcelSeed: string }[] = [];
  function explore(action: 'seed' | 'plan' | 'back'): void {
    const note = one<HTMLElement>('quarters', '[data-explore-note]'), back = one<HTMLButtonElement>('quarters', '[data-explore="back"]');
    const pick = <T>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)];
    const between = (min: number, max: number, step: number): number => Math.round((min + Math.random() * (max - min)) / step) * step;
    if (action === 'back') {
      const previous = draws.pop(); if (!previous) return;
      layoutConfig = previous.layout; parcelConfig = previous.parcels; quarterSeed = previous.quarterSeed; parcelSeed = previous.parcelSeed;
      note.textContent = 'Réglages du tirage précédent rétablis.';
    } else {
      draws.push(clone({ layout: appliedLayout, parcels: appliedParcel, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed }));
      quarterSeed = parcelSeed = Math.random().toString(36).slice(2, 8);
      if (action === 'plan') {
        const mix = Math.random() < 0.3 ? pick(Object.keys(catalogue.cultures)) : '';
        layoutConfig = { ...layoutConfig, preset: 'culture', recipe: 'auto', zone: 'auto', params: {},
          tissue: pick(Object.keys(tissues)) as LayoutConfig['tissue'], fortification: pick(['culture', 'none', 'wall', 'palisade'] as const),
          suburbs: pick(['auto', 'none', 'few', 'many'] as const), exitTreatment: pick(['adaptive', 'closed'] as const), peripheralRoad: pick(['auto', 'none', 'partial', 'full'] as const),
          axisAlignment: pick(['regional', 'culture'] as const), mixCulture: mix, mixMode: pick(['phases', 'sectors'] as const), mixShare: between(0.2, 0.8, 0.05),
          footprint: { ...layoutConfig.footprint, family: pick(Object.keys(families)) as LayoutConfig['footprint']['family'], mechanism: pick(['auto', 'accessibility', 'ribbon', 'fusion'] as const),
            nuclei: between(1, 4, 1), epochs: between(1, 4, 1), aspect: between(1, 3, 0.1), irregularity: between(0, 0.6, 0.05), anisotropy: between(0.2, 0.9, 0.05) } };
        parcelConfig = { ...parcelConfig, preset: 'culture', recipe: 'auto', zone: 'auto', params: {}, operator: pick(Object.keys(parcelOperators)) as ParcelConfig['operator'] };
        const f = layoutConfig.footprint;
        note.textContent = `${families[f.family]} · ${mechanisms[f.mechanism]} · ${tissues[layoutConfig.tissue]} · enceinte ${layoutConfig.fortification} · parcelles ${parcelOperators[parcelConfig.operator]}${mix ? ` · influence ${catalogue.cultures[mix].label}` : ''} · graine ${quarterSeed}`;
      } else note.textContent = `Graine ${quarterSeed}`;
    }
    back.disabled = !draws.length;
    try {
      for (const kind of ['quarters', 'parcels'] as const) { clearTimeout(draftTimers[kind]); one<HTMLTextAreaElement>(kind, '[data-json]').value = ''; populate(kind); read(kind); }
      enabled = parcelEnabled = true; populate('quarters'); populate('parcels'); request('quarters'); options.onChange();
    } catch (error) { status('quarters', String(error)); }
  }
  for (const action of ['seed', 'plan', 'back'] as const) { const button = one<HTMLButtonElement>('quarters', `[data-explore="${action}"]`); if (button) button.onclick = () => explore(action); }
  targetSelect.onchange = () => {
    if (target) cityDrafts.set(target, clone({ layoutConfig, parcelConfig, quarterSeed, parcelSeed, dirty, building: buildingPanel.captureDraft() }));
    target = targetSelect.value; clearTimeout(timer); ++id; layoutsId = undefined; invalidateArchitecture();
    const saved = citySettings[target], draft = cityDrafts.get(target);
    if (saved) {
      appliedLayout = successfulLayout = clone(saved.layoutConfig); appliedParcel = successfulParcel = clone(saved.parcelConfig);
      appliedQuarterSeed = successfulQuarterSeed = saved.quarterSeed; appliedParcelSeed = successfulParcelSeed = saved.parcelSeed;
      layoutConfig = clone(draft?.layoutConfig ?? appliedLayout); parcelConfig = clone(draft?.parcelConfig ?? appliedParcel);
      quarterSeed = draft?.quarterSeed ?? saved.quarterSeed; parcelSeed = draft?.parcelSeed ?? saved.parcelSeed;
      dirty.quarters = draft?.dirty.quarters ?? false; dirty.parcels = draft?.dirty.parcels ?? false;
    }
    if (buildingPanel.state.parent && buildingPanel.state.parent.cityKey !== target) buildingPanel.replaceParent(undefined);
    buildingPanel.restore({ ...buildingPanel.state, ...(saved?.building ?? { seed: '', settings: undefined, generated: false }), selected: undefined });
    buildingPanel.restoreDraft(draft?.building);
    for (const kind of ['quarters', 'parcels'] as const) { status(kind, layouts?.some(layout => target === 'all' || layout.key === target) ? 'Plan conservé · sélection seule.' : 'Plan absent pour cette sélection.'); populate(kind); }
    draw(); options.onChange();
  };
  one<HTMLButtonElement>('quarters', '#urbanFocus').onclick = () => {
    const selection = settlements?.settlements.filter(s => target === 'all' || s.key === target) ?? [];
    if (!selection.length || !options.onFocus) return;
    const extent = layoutExtent(layouts?.filter(l => target === 'all' || l.key === target));
    if (extent) { options.onFocus(extent.center, extent.radius); return; }
    const minX = Math.min(...selection.map(s => s.center.x - s.radius)), maxX = Math.max(...selection.map(s => s.center.x + s.radius)), minY = Math.min(...selection.map(s => s.center.y - s.radius)), maxY = Math.max(...selection.map(s => s.center.y + s.radius));
    options.onFocus({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, Math.max(maxX - minX, maxY - minY) / 2);
  };
  populate('quarters'); populate('parcels'); editsReport();
  // Plan layers hidden together (map toggle "Plan de ville"): buildings,
  // streets and walls stay. The previous choices come back when shown again.
  const PLAN_LAYERS = ['blocks', 'parcels', 'gardens', 'places', 'domains', 'allocated', 'reserve'] as const;
  let planSaved: Partial<Record<(typeof PLAN_LAYERS)[number], boolean>> | undefined;
  return {
    get planVisible(): boolean { return !planSaved; },
    setPlanVisible(visible: boolean): void {
      if (visible === !planSaved) return;
      if (!visible) { planSaved = Object.fromEntries(PLAN_LAYERS.map(k => [k, render[k]])); for (const k of PLAN_LAYERS) render[k] = false; }
      else { for (const k of PLAN_LAYERS) render[k] = planSaved?.[k] ?? render[k]; planSaved = undefined; }
      for (const e of Array.from(rendering.querySelectorAll<HTMLInputElement>('input[data-render]'))) if (e.type === 'checkbox') e.checked = Boolean(render[e.dataset.render as keyof Render]);
      draw(); options.onChange();
    },
    captureContext: () => clone({ layoutConfig, parcelConfig, quarterSeed, parcelSeed, dirty }),
    restoreContext(saved: { layoutConfig: LayoutConfig; parcelConfig: ParcelConfig; quarterSeed: string; parcelSeed: string; dirty: Record<Kind, boolean> }): void {
      layoutConfig = normalizeLayoutConfig(saved.layoutConfig, true); parcelConfig = normalizeParcelConfig(saved.parcelConfig);
      quarterSeed = saved.quarterSeed; parcelSeed = saved.parcelSeed;
      for (const kind of ['quarters', 'parcels'] as const) {
        dirty[kind] = saved.dirty[kind]; populate(kind);
        const hint = one(kind, '[data-draft-state]'); hint.hidden = !dirty[kind];
        if (dirty[kind]) hint.textContent = 'Modifications non appliquées · utilisez le bouton de régénération.';
      }
    },
    get target(): string { return target; },
    get generationPending(): boolean { return buildingPanel.busy || (['quarters', 'parcels'] as const).some(kind => one(kind, '[data-apply]').getAttribute('aria-busy') === 'true'); },
    selectCity(key: string): void { if (target !== key) { targetSelect.value = key; targetSelect.dispatchEvent(new Event('change')); } },
    restoreSnapshot(state: import('./testbenchUrban').WorkshopState): void {
      urbanSource.clear(); invalidateArchitecture(); buildingPanel.invalidate();
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
      buildingPanel.restore(state.buildingState && { ...clone(buildingSettings(state.buildingState)!), scene: state.buildingState.scene, cold: state.buildingState.cold, parent: state.buildingState.parent });
      for (const layout of layouts ?? []) if (!citySettings[layout.key]) rememberCities([layout.key]);
      render.view = state.view ?? (state.buildingState?.scene || state.buildingState?.cold || state.buildingState?.parent ? 'buildings' : 'parcels'); lastBuiltScene = state.buildingState?.scene; lastBuiltCold = state.buildingState?.cold;
      for (const kind of ['quarters', 'parcels'] as const) { clearTimeout(draftTimers[kind]); dirty[kind] = false; populate(kind); }
      status('quarters', `Plan conservé · ${layouts?.length ?? 0} ville(s)`);
      status('parcels', partitions ? 'Parcelles conservées.' : 'Parcelles non calculées.');
      draw(); options.onPlanChange?.();
    },
    restoreFromQuery(params: URLSearchParams, activate = false): boolean {
      if (!restoreState(params.get('urban'))) return false;
      urbanSource.clear(); invalidateArchitecture(); buildingPanel.restore(initialBuildingState);
      if (activate) { enabled = true; parcelEnabled = true; }
      clearTimeout(timer); ++id; layouts = undefined; partitions = undefined;
      appliedLayout = clone(layoutConfig); appliedParcel = clone(parcelConfig); appliedQuarterSeed = quarterSeed; appliedParcelSeed = parcelSeed;
      for (const kind of ['quarters', 'parcels'] as const) {
        clearTimeout(draftTimers[kind]); dirty[kind] = false; one(kind, '[data-draft-state]').hidden = true; populate(kind);
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
    get partitions(): Partition[] | undefined { return partitions; },
    /** Regional road pieces (with their bridge/ford/causeway roles), memoized per road output. */
    get regionalStreets(): Street[] { if (regionalOf !== roads) { regionalOf = roads; regional = regionalStreets(roads); } return regional; },
    get buildingState() { return buildingPanel.state; },
    get parentViewportEvidence() { return architecturePreview?.parent ? { phase: 'staging', complete: false, source: architecturePreview.parent.source, counts: architecturePreview.parent.counts, durableCompleted: architecturePreview.parent.durableCompleted, nativeAckedCompleted: architecturePreview.parent.nativeAckedCompleted } : boundedParent()?.evidence(); },
    get coldViewportEvidence() { return boundedCold()?.evidence; },
    get buildingProjection(): NativeBuildingProjectionScene | undefined {
      return sameCold(coldSession?.state, buildingPanel.state.cold) ? coldSession?.projection : undefined;
    },
    /** Both cameras share native work and the bounded exterior cache. Changing
     * the active camera prevents background 2D paints from replacing 3D demand. */
    buildingDetails: {
      setActiveView(view: '2d' | '3d'): void { if (view === '3d' && buildingPanel.state.parent) throw new Error('La vue 3D des parents natifs n’est pas encore prise en charge.'); architectureView = view;
        const state = buildingPanel.state.cold; if (view === '3d' && state) void ensureColdSession(state).then(() => { draw(); options.onPlanChange?.(); }, e => inspectorNote(String(e)));
        cityLayer?.request(); },
      // A comparison never asks for native work, from either camera.
      update(view: BuildingDetailView) { return architectureView === '3d' && !comparison.state() ? cityDetails?.update(view) : cityDetails?.stats; },
      getDetail(id: string) { return cityDetails?.getDetail(id); },
      status(id: string) { return cityDetails?.status(id); },
      cached() { return cityDetails?.cachedDetails() ?? []; },
      subscribe(listener: () => void): () => void { detailListeners.add(listener); return () => { detailListeners.delete(listener); }; },
      get scene() { if (buildingPanel.state.parent) throw new Error('Le consommateur Single n’accepte pas les parents natifs.'); return displayedColdProjection() ?? cityBuiltOf ?? undefined; },
      get stats() { return cityDetails?.stats; },
    },
    get buildingView(): boolean { return render.view === 'buildings'; },
    /** Same-input lots / silhouettes / compact plans comparison (Visual50 runner). */
    comparison: { ...comparison.api, async prepare() { if (buildingPanel.state.parent) throw new Error('La comparaison legacy des parents natifs n’est pas encore prise en charge.'); const state = buildingPanel.state.cold; if (state) await ensureColdSession(state); draw(); } },
    /** Map clicks belong to the inspector (City Bench roles view too), not to settlement markers. */
    get inspecting(): boolean { return render.view === 'buildings' || !!options.city && render.view === 'roles'; },
    get buildingVisible(): boolean { return buildingPanel.state.visible && render.view === 'buildings'; },
    selectBuilding: (id: string): void => { if (buildingPanel.state.parent) throw new Error('Utilisez une sélection parent/membre explicite.'); buildingPanel.select(id); },
    selectParent: (pick: import('./urbanParentColdWindow').ParentMapSelection): void => { boundedParent()?.select(pick); buildingPanel.selectParent(pick); },
    get extent() { return layoutExtent(layouts); },
    workshopDraft(): Omit<import('./testbenchUrban').WorkshopState, 'layouts' | 'partitions'> | undefined {
      if (!dirty.quarters && !dirty.parcels) return undefined;
      return clone({ layoutConfig, parcelConfig, quarterSeed: one<HTMLInputElement>('quarters', '[data-seed]').value, parcelSeed: one<HTMLInputElement>('parcels', '[data-seed]').value });
    },
    workshopSettings() { const site = settlements?.settlements.find(site => site.key === target); return clone(workshopSettings({ population: site?.population, siteKey: site?.key, citySettings, layoutConfig: appliedLayout, parcelConfig: appliedParcel, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, buildingState: buildingPanel.state, view: render.view as 'buildings' })); },
    workshopState() { const site = settlements?.settlements.find(s => s.key === target); return appliedWorkshopSnapshot({ citySettings, population: site?.population, siteKey: site?.key, layoutConfig: appliedLayout, parcelConfig: appliedParcel, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, layouts, partitions, buildingState: buildingPanel.state, view: render.view as 'buildings' }); },
    applyWorkshopDraft(state: Partial<import('./testbenchUrban').WorkshopState>): void {
      if (state.layoutConfig) layoutConfig = normalizeLayoutConfig({ ...clone(state.layoutConfig), programme: clone(appliedLayout.programme) }, true);
      if (state.parcelConfig) parcelConfig = normalizeParcelConfig(clone(state.parcelConfig));
      if (state.quarterSeed !== undefined) quarterSeed = state.quarterSeed;
      if (state.parcelSeed !== undefined) parcelSeed = state.parcelSeed;
      if (state.layoutConfig?.programme) buildingPanel.setProgrammeDraft(state.layoutConfig.programme);
      buildingPanel.setBuildingDraft(state.buildingState);
      for (const kind of ['quarters', 'parcels'] as const) { dirty[kind] = true; populate(kind); one(kind, '[data-draft-state]').hidden = false; one(kind, '[data-draft-state]').textContent = 'Réglages synchronisés · appliquer pour recalculer.'; }
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
          clearTimeout(draftTimers[kind]); dirty[kind] = false; one(kind, '[data-draft-state]').hidden = true;
        }
      }
      populate('quarters'); populate('parcels');
      if (quartersChanged || !layouts) void request('quarters'); else void request('parcels');
      options.onChange();
    },
    get layoutPending(): boolean { return enabled && ready && !!settlements?.settlements.length && !layouts; },
    setSettlements(output?: SettlementOutput, roadOutput?: RoadOutput): void {
      if (settlements === output && roads === roadOutput && ready) return;
      urbanSource.clear(); invalidateArchitecture(); buildingPanel.invalidate();
      ++id; settlements = output; roads = roadOutput; ready = !!output;
      layouts = undefined; partitions = undefined;
      const sorted = output?.settlements.slice().sort((a, b) => b.population - a.population || a.key.localeCompare(b.key)) ?? [];
      if (target !== 'all' && !sorted.some(s => s.key === target)) target = sorted[0]?.key ?? '';
      targetSelect.replaceChildren(new Option('All · tous les settlements', 'all'), ...sorted.map(s => new Option(`${s.name || s.key} · ${s.population.toLocaleString()} hab. · ${Math.round(s.radius)} m`, s.key)));
      targetSelect.value = target; targetSelect.disabled = !sorted.length;
      populate('quarters'); populate('parcels'); draw();
      if (ready && sorted.length && enabled) schedule(); else { status('quarters', 'En attente des settlements…'); status('parcels', 'En attente des quartiers…'); }
    },
    terrainPending(): void { urbanSource.clear(); invalidateArchitecture(); buildingPanel.invalidate(); ++id; ready = false; clearTimeout(timer); layouts = undefined; partitions = undefined; cachedTerrain = undefined; draw(); status('quarters', 'En attente du terrain et des settlements…'); status('parcels', 'En attente des quartiers…'); },
    terrainFailed(message: string): void {
      urbanSource.clear(); ++id; ready = false; clearTimeout(timer);
      status('quarters', `Génération du terrain échouée : ${message}`);
      status('parcels', `Génération du terrain échouée : ${message}`);
    },
    updateView: draw,
    share(params: URLSearchParams): void { params.set('urban', JSON.stringify({ enabled, parcelEnabled, target, quarterSeed: appliedQuarterSeed, parcelSeed: appliedParcelSeed, layoutConfig: appliedLayout, parcelConfig: appliedParcel, render, buildingState: buildingSettings(buildingPanel.state), ...(options.city ? { architecture: architectureMode } : {}), ...(hasEdits(edits) ? { edits: packEdits(edits) } : {}) })); }, // edits hook (cityEdits.ts): outlines packed in links
  };
}
import { executionRuntime } from './executionProfile';
