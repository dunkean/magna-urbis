/** City Bench inspector: what was clicked (quarter, lot, house), in French, with
 * the controls that edit that one item. It only reads the applied plan, the
 * programme and the retained building; edits go back through the hooks, which
 * re-run the right stage (plan, parcels or one native house). */
import type { Layout, Shape } from '../../../rust/bridge/urban';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { BuildingStyleEntry, BuildingStyleIndex } from '../../../rust/bridge/buildingStyles';
import services from '../../../rust/crates/core/src/urban/services.json';
import { describeUrbanBuilding } from '../render/buildingInspection';
import { programmeOutcomeRows } from '../render/programmeOutcome';
import { retainedBodyInventoryRows } from '../render/retainedBuildingInventory';
import { DISTRICT_ROLES, districtRoleLabel, type CityParcel, type CityPick, type CityScene } from '../render/cityCanvas';
import { functionLabel, lotRoleChoices, roleLabel, streetLabel } from '../render/cityRoles';
import type { CityEdits, HouseEdit, LotEdit, QuarterEdit } from './cityEdits';
import { ensureEditStyles, type Pt } from './cityShapeEditor';
import { localizeCityInspector } from './cityInspectorLocale';

export interface CityInspectorHooks {
  edits(): CityEdits;
  /** Culture id → French label, tissue id → French label. */
  cultures: Record<string, string>; tissues: Record<string, string>;
  /** Why this house cannot be restyled now (silhouette mode, no request…), or undefined. */
  houseLocked(building: PlacedBuilding): string | undefined;
  styles(): BuildingStyleIndex | undefined;
  loadStyles(): Promise<BuildingStyleIndex | undefined>;
  editQuarter(key: string, value: QuarterEdit | undefined): void;
  editLot(id: string, value: LotEdit | undefined): void;
  /** Resolves to a refusal message, or undefined once applied. */
  editHouse(id: string, value: HouseEdit | undefined): Promise<string | undefined>;
  /** Starts the shape editor on `ring` (world metres); `snap` adds neighbouring vertices to snap to. */
  editShape(scope: 'quarter' | 'lot', key: string, ring: Pt[], snap?: Pt[]): void;
  /** Why structural edits (shape, draw, delete) are unavailable now (several cities targeted…), or undefined. */
  structuralLocked(): string | undefined;
  /** Engine warnings of the displayed city (plan, partition, programme). */
  warnings(): string[];
  /** The override the engine echoed for this item (`config.overrides`), undefined when it echoed none for it,
   * null when the response carries no config at all. */
  echoed(scope: 'quarter' | 'lot', key: string): Record<string, unknown> | undefined | null;
}
export interface CityInspectorTarget extends CityPick { built?: PlacedBuilding }

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ring = (r: { x: number; y: number }[]): number => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j].x * r[i].y - r[i].x * r[j].y; return Math.abs(s) / 2; };
const area = (s: Shape): number => Math.max(0, ring(s.outer) - (s.holes ?? []).reduce((n, h) => n + ring(h), 0));
const m2 = (v: number): string => v >= 1e4 ? `${(v / 1e4).toFixed(2)} ha` : `${Math.round(v).toLocaleString('fr-FR')} m²`;
const pct = (v: number): string => `${Math.round(v * 100)} %`;
const occupancy = (services as unknown as { cultures: Record<string, string>; occupancy: Record<string, { householdSize?: number }> });
const householdSize = (culture: string): number => occupancy.occupancy[occupancy.cultures[culture] ?? 'european']?.householdSize ?? 4.5;
const USES: Record<string, string> = { plot: 'Parcelle bâtissable', garden: 'Jardin', place: 'Place', compound: 'Enclos / domaine', market: 'Marché', reserve: 'Réserve', common: 'Commun', residual: 'Résidu', court: 'Cour et circulation' };
const ACCESS: Record<string, string> = { public: 'rue publique', collective: 'accès collectif', private: 'accès privé', unserved: 'sans desserte', reserved: 'réservé', attached: 'arrière-fond rattaché' };
const VALIDATION: Record<string, string> = { preview: 'aperçu de la ville (silhouette)', plan_only: 'plan compact (sans intérieur)', native: 'bâtiment natif détaillé' };
const TYPOLOGY: Record<string, string> = { common: 'courante', row: 'en bande', courtyard: 'à cour', compound: 'enclos', detached: 'isolée' };
const SLOTS: Record<string, string> = { frame: 'structure', infill: 'remplissage', coating: 'enduit', cladding: 'bardage', base: 'soubassement', roof_frame: 'charpente' };
const TRADES = ['tanners', 'smiths', 'weavers', 'dyers', 'potters', 'masons', 'merchants'];

// ---------------------------------------------------------------- quarter statistics
interface QuarterStats { area: number; blocks: number; lots: number; households: number }
const statsOf = new WeakMap<CityScene, Map<string, QuarterStats>>();
/** One pass over blocks and lots per applied plan, then constant-time lookups. */
function quarterStats(plan: CityScene, layout: number, quarter: number): QuarterStats {
  let all = statsOf.get(plan);
  if (!all) {
    all = new Map();
    const get = (li: number, q: number): QuarterStats => { const key = `${li}:${q}`; let s = all!.get(key); if (!s) { s = { area: area(plan.layouts[li]?.quarters[q]?.shape ?? { outer: [], holes: [] }), blocks: 0, lots: 0, households: 0 }; all!.set(key, s); } return s; };
    for (const b of plan.blocks) if (!b.kind.startsWith('reserve')) get(b.layout, b.quarter).blocks++;
    for (const p of plan.parcels) { const q = plan.layouts[p.layout]?.blocks[p.block]?.quarter; if (q === undefined) continue; const s = get(p.layout, q); s.lots++; s.households += p.allocation?.households ?? 0; }
    statsOf.set(plan, all);
  }
  return all.get(`${layout}:${quarter}`) ?? { area: 0, blocks: 0, lots: 0, households: 0 };
}
/** Frontage on the access, and depth measured perpendicular to the front. */
function lotDimensions(parcel: CityParcel): { frontage?: number; depth?: number } {
  const src = parcel.source, front = src.front;
  const frontage = src.access?.frontLength ?? (front ? Math.hypot(front[1].x - front[0].x, front[1].y - front[0].y) : undefined);
  let nx = src.axis?.x ?? 0, ny = src.axis?.y ?? 0;
  if (front) { const dx = front[1].x - front[0].x, dy = front[1].y - front[0].y, l = Math.hypot(dx, dy); if (l > 1e-6) { nx = -dy / l; ny = dx / l; } }
  const n = Math.hypot(nx, ny); if (n < 1e-9 || !src.shape.outer.length) return { frontage };
  let min = Infinity, max = -Infinity;
  for (const p of src.shape.outer) { const d = (p.x * nx + p.y * ny) / n; if (d < min) min = d; if (d > max) max = d; }
  return { frontage, depth: max - min };
}

// ---------------------------------------------------------------- rendering
const rows = (items: [string, string | undefined][]): string => `<dl class="urban-inspection">${items.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v!)}</dd>`).join('')}</dl>`;
const options = (values: Record<string, string>, current?: string, none = '— inchangé —'): string => `<option value="">${none}</option>${Object.entries(values).map(([id, label]) => `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
const section = (scope: string, title: string, edited: boolean, body: string, editor: string, actions = ''): string =>
  `<section class="city-inspect" data-scope="${scope}"><header><strong>${esc(title)}</strong>${edited ? '<span class="city-edited" title="Cet élément a une modification enregistrée">modifié</span>' : ''}</header>${body}${editor}${actions}<small data-edit-status role="status"></small></section>`;

// ---------------------------------------------------------------- structural edits (shape, draw, delete)
const HELP = {
  quarter: 'Redessine rues, îlots et parcelles de ce quartier ; sa forme et le reste de la ville sont conservés.',
  lot: 'Nouveau tirage de l’usage parmi les usages admissibles, et du bâtiment.',
};
/** Fields the engine must echo back when it supports structural edits. */
const STRUCTURAL = ['shape', 'salt', 'deleted'] as const;
/** Action row under a quarter or lot section: always visible, outside the `<details>`. */
/** `prefix`: the engine's warning prefix for this item (quarters by index); `shown`: the same prefix as the UI numbers it. */
/** `service`: the lot hosts a service or a public space (no draw nor deletion: the engine refuses them). */
function structuralRow(scope: 'quarter' | 'lot', key: string, edit: QuarterEdit | LotEdit | undefined, hooks: CityInspectorHooks, prefix: string, extra = '', shown = prefix, service = false): string {
  const locked = hooks.structuralLocked();
  if (locked) return `<small class="city-structural-help" data-structural-locked>${esc(locked)}</small>`;
  const salt = edit?.salt, deleted = edit?.deleted;
  const del = deleted
    ? '<button type="button" data-restore title="Annule la suppression">Restaurer</button>'
    : service ? '<button type="button" data-delete disabled>Supprimer</button>'
    : `${scope === 'lot' ? '<select data-delete-mode aria-label="Mode de suppression"><option value="merge">Fusionner avec la voisine</option><option value="garden">Laisser en jardin</option></select>' : ''}<button type="button" data-delete>Supprimer</button>`;
  const help = service && !deleted ? 'Parcelle d’un service ou d’un espace public : tirage et suppression indisponibles (retouchez plutôt le quartier).' : deleted ? (scope === 'quarter' ? 'Quartier supprimé : ses îlots et parcelles sont retirés, les rues principales restent.' : deleted === 'garden' ? 'Parcelle laissée en jardin.' : 'Fusion impossible (aucune voisine admissible) : parcelle laissée en jardin.') : HELP[scope];
  const row = `<div class="city-structural" data-structural>`
    + `<button type="button" data-shape-edit${deleted ? ' disabled' : ''}>Modifier la forme</button>${edit?.shape ? '<button type="button" data-shape-reset title="Retire la retouche de forme">Forme d’origine</button>' : ''}`
    + `<button type="button" data-salt-next${deleted || service && !salt ? ' disabled' : ''}>Tirer au sort</button>${salt ? `<span class="city-salt" data-salt="${salt}">tirage n° ${salt}</span><button type="button" data-salt-back title="Tirage précédent">↶</button>` : ''}`
    + `${del}</div><small class="city-structural-help">${esc(help)}</small>`;
  // Engine warnings about this item, and an engine that ignored the new fields.
  const mine = hooks.warnings().filter(w => w.includes(prefix)).map(w => w.replace(prefix, shown));
  const echo = edit && STRUCTURAL.some(f => edit[f] !== undefined) ? hooks.echoed(scope, key) : null;
  const ignored = echo !== null && STRUCTURAL.some(f => edit?.[f] !== undefined && (echo === undefined || echo[f] === undefined || echo[f] === null));
  return row + extra + (mine.length ? `<ul class="city-edit-warnings">${mine.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '')
    + (ignored ? '<small class="city-edit-refusal" data-engine-stale>Moteur sans retouche de forme : reconstruire le serveur natif.</small>' : '');
}
const editorBox = (title: string, fields: string, edited: boolean): string =>
  `<details class="city-edit"${edited ? ' open' : ''}><summary>${esc(title)}</summary><div class="control-group">${fields}</div><div class="city-edit-actions"><button type="button" data-edit-apply>Appliquer</button><button type="button" data-edit-reset${edited ? '' : ' disabled'}>Réinitialiser</button></div></details>`;

function quarterSection(target: CityInspectorTarget, plan: CityScene, hooks: CityInspectorHooks): string {
  const block = target.parcel ? plan.layouts[target.parcel.layout]?.blocks[target.parcel.block] : target.block ? plan.layouts[target.block.layout]?.blocks[target.block.index] : undefined;
  const li = target.parcel?.layout ?? target.block?.layout, layout: Layout | undefined = li === undefined ? undefined : plan.layouts[li];
  if (!block || !layout || li === undefined) return '';
  const q = block.quarter, quarter = layout.quarters[q], phase = layout.phases?.[block.phase ?? quarter?.phase ?? 0];
  const district = target.parcel?.district ?? target.block?.district, edit = hooks.edits().quarters[String(q)];
  const culture = phase?.culture ?? layout.culture, stats = quarterStats(plan, li, q);
  const population = stats.households * householdSize(culture), ha = stats.area / 1e4;
  const body = rows([
    ['Rôle', district?.role ? districtRoleLabel(district.role, district.label) : 'non attribué'],
    ['Richesse', district?.wealth !== undefined ? pct(district.wealth) : undefined],
    ['Culture', hooks.cultures[culture] ?? culture],
    ['Tissu', district ? hooks.tissues[district.tissue] ?? district.tissue : undefined],
    ['Recette', phase ? `${phase.recipe}${phase.kind === 'faubourg' ? ' · faubourg' : ''}` : undefined],
    ['Surface', m2(stats.area)],
    ['Population prévue', stats.households ? `≈ ${Math.round(population).toLocaleString('fr-FR')} hab. · ${stats.households.toFixed(0)} ménages` : 'aucun ménage attribué'],
    ['Densité', ha > 0 && stats.households ? `${(population / ha).toFixed(0)} hab./ha` : undefined],
    ['Îlots / parcelles', `${stats.blocks} / ${stats.lots}`],
    ...(district ? [['Groupe de quartiers', `Q${district.id + 1} · ${layout.structure?.districts.find(d => d.id === district.id)?.quarters.length ?? 1} secteur(s)`] as [string, string]] : []),
  ]);
  const roles = { ...Object.fromEntries(Object.entries(DISTRICT_ROLES).map(([id, r]) => [id, r.label])), ...Object.fromEntries(TRADES.map(t => [`craft:${t}`, districtRoleLabel(`craft:${t}`)])) };
  const fields = `<label>Rôle<select data-field="role">${options(roles, edit?.role)}</select></label>
    <label>Richesse (0–1)<input data-field="wealth" type="number" min="0" max="1" step="0.05" value="${edit?.wealth ?? ''}" placeholder="${district?.wealth?.toFixed(2) ?? ''}"></label>
    <label>Culture<select data-field="culture">${options(hooks.cultures, edit?.culture)}</select></label>
    <label>Tissu<select data-field="tissue">${options(Object.fromEntries(Object.entries(hooks.tissues).filter(([id]) => id !== 'culture')), edit?.tissue)}</select></label>
    <label>Densité (×)<input data-field="density" type="number" min="0.1" max="10" step="0.1" value="${edit?.density ?? ''}" placeholder="1"></label>
    <small>Recalcule le plan ; les autres quartiers gardent leur numéro.</small>`;
  return section(`quarter:${q}`, `Quartier Q${q + 1}`, !!edit, body, editorBox('Modifier ce quartier', fields, !!edit), structuralRow('quarter', String(q), edit, hooks, `Retouche Q${q} :`, '', `Retouche Q${q + 1} :`));
}

function lotSection(target: CityInspectorTarget, plan: CityScene, hooks: CityInspectorHooks): string {
  const parcel = target.parcel; if (!parcel) return '';
  const layout = plan.layouts[parcel.layout], a = parcel.allocation, src = parcel.source, { frontage, depth } = lotDimensions(parcel);
  const edit = parcel.id ? hooks.edits().parcels[parcel.id] : undefined;
  const body = rows([
    ['Usage', `${USES[parcel.use] ?? parcel.use}${src.family ? ` · ${src.family}` : ''}`],
    ['Rôle', a ? `${roleLabel(a.role, a.label)}${a.landmark ? ' · monument' : ''}` : undefined],
    ['Fonction', a ? functionLabel(a.function) : undefined],
    ['Surface', m2(area(src.shape))],
    ['Façade × profondeur', frontage !== undefined || depth !== undefined ? `${frontage?.toFixed(1) ?? '?'} × ${depth?.toFixed(1) ?? '?'} m` : undefined],
    ['Ménages', a?.households !== undefined ? a.households.toFixed(1) : undefined],
    ['Pression / richesse', src.pressure !== undefined || a?.wealth !== undefined ? `${src.pressure !== undefined ? pct(src.pressure) : '—'} / ${a?.wealth !== undefined ? pct(a.wealth) : '—'}` : undefined],
    ['Desserte', src.access ? `${ACCESS[src.access.kind] ?? src.access.kind}${src.access.street !== undefined && src.access.street !== null && layout?.streets[src.access.street] ? ` · ${streetLabel(layout.streets[src.access.street].role)}` : ''}` : undefined],
    ['Identité', parcel.id],
  ]);
  if (!parcel.id) return section('lot', 'Parcelle', false, body, '');
  const choices = lotRoleChoices(a?.culture ?? layout?.culture);
  const fields = `<label>Rôle<select data-field="role">${options(Object.fromEntries(choices.map(c => [c.role, c.label])), edit?.role)}</select></label>
    <label>Ménages<input data-field="households" type="number" min="0" max="500" step="1" value="${edit?.households ?? ''}" placeholder="${a?.households?.toFixed(0) ?? ''}"></label>
    <small>Recalcule les parcelles, le programme et les bâtiments.</small>`;
  // A merge survivor names the lots it absorbed (engine `parentIds`), each restorable.
  const all = hooks.edits().parcels;
  const absorbed = (src.parentIds ?? []).filter(id => id !== parcel.id && all[id]?.deleted === 'merge');
  const extra = absorbed.map(id => `<small class="city-structural-help">Contient la parcelle supprimée ${esc(id)} · <button type="button" data-restore-lot="${esc(id)}">Restaurer</button></small>`).join('');
  // Same rule as the engine (`edits.rs` service_lot): a place, a reserve, a reserved access or a block kept for a service.
  const service = parcel.use === 'place' || parcel.use === 'reserve' || src.access?.kind === 'reserved' || !!a?.landmark || (layout?.blocks[parcel.block]?.kind ?? 'block') !== 'block';
  return section(`lot:${parcel.id}`, 'Parcelle', !!edit, body, editorBox('Changer l’activité de la parcelle', fields, !!edit), structuralRow('lot', parcel.id, edit, hooks, `Retouche parcelle ${parcel.id} :`, extra, undefined, service));
}

const STYLE_ROLES: Record<string, string[]> = { domestic: ['dwelling', 'residential_ensemble', 'communal_dwelling', 'mixed_residential'], mixed: ['mixed_residential', 'dwelling'] };
/** Styles of the building's pack; function-compatible roles first. */
export function styleChoices(index: BuildingStyleIndex | undefined, building: PlacedBuilding): BuildingStyleEntry[] {
  const preferred = STYLE_ROLES[building.function] ?? ['non_domestic', 'mixed_residential', 'dwelling'];
  return (index?.entries ?? []).filter(e => e.pack_id === building.culture.pack && e.capabilities.native_plan && !['landscape', 'spatial_component', 'domestic_annex'].includes(e.role))
    .sort((a, b) => Number(!preferred.includes(a.role)) - Number(!preferred.includes(b.role)) || a.label.localeCompare(b.label, 'fr'));
}

function houseSection(target: CityInspectorTarget, hooks: CityInspectorHooks): string {
  const building = target.built; if (!building) return '';
  const info = describeUrbanBuilding(building, hooks.styles()), g = info.geometry, edit = hooks.edits().buildings[building.id];
  const programme = info.programme, style = info.style;
  const materials = Object.entries(info.materials.bySlot).filter(([, ids]) => ids.length).map(([slot, ids]) => `${SLOTS[slot] ?? slot} : ${ids.join(', ')}`).join(' · ');
  const capacity = info.capacity.status === 'native' ? `${info.capacity.domesticUnits} logement(s) · ${Math.round(info.capacity.usefulAreaM2 ?? 0)} m² utiles` : 'inconnue (plan sans intérieur)';
  const body = rows([
    ['Rôle', programme?.role ? `${roleLabel(programme.role)}${programme.landmark ? ' · monument' : ''}` : functionLabel(info.function)],
    ['Validation', VALIDATION[info.validation] ?? info.validation],
    ['Modèle', info.validation === 'preview' ? undefined : `${info.label ?? info.recipeId}${info.variantLabel ? ` · ${info.variantLabel}` : info.variantId !== 'default' ? ` · ${info.variantId}` : ''}`],
    ['Culture / pack', `${hooks.cultures[info.culture.culture] ?? info.culture.culture} · ${info.culture.pack}`],
    ['Typologie du catalogue (référence)', style ? `${TYPOLOGY[style.typology] ?? style.typology} · ${style.morphology} · ${style.profile}` : undefined],
    ['Toiture', info.roofSystems.join(', ') || undefined],
    ['Matériaux', materials || undefined],
    ['Niveaux / hauteur', g.floors !== null || g.heightM !== null ? `${g.floors ?? '?'} niveau(x) · ${g.heightM !== null ? `${g.heightM.toFixed(1)} m` : 'hauteur inconnue'}` : undefined],
    ['Emprise', `${m2(g.footprintAreaM2)}${g.widthM !== null && g.depthM !== null ? ` · ${g.widthM.toFixed(1)} × ${g.depthM.toFixed(1)} m` : ''}`],
    ['Toit projeté / cours', info.validation === 'preview' ? undefined : `${m2(g.roofAreaM2)} / ${g.courtyardAreaM2 > 0 ? m2(g.courtyardAreaM2) : 'aucune'}`],
    ['Corps', info.validation === 'preview' ? undefined : String(g.bodies)],
    ['Capacité', capacity],
    ...programmeOutcomeRows(info.programmeOutcome),
    ...retainedBodyInventoryRows(building),
  ]);
  const locked = hooks.houseLocked(building);
  let fields: string;
  if (locked) fields = `<small>${esc(locked)}</small>`;
  else if (!hooks.styles()) fields = '<small data-styles-loading>Chargement de l’index des styles…</small>';
  else {
    const current = edit ? `${edit.recipe}::${edit.variant}` : '';
    const choices = styleChoices(hooks.styles(), building);
    fields = `<label>Style<select data-field="style"><option value="">— automatique —</option>${choices.map(e => `<option value="${esc(e.recipe_id)}::${esc(e.variant_id)}"${e.id === current ? ' selected' : ''}>${esc(`${e.label} · ${e.variant_label}`)}</option>`).join('')}</select></label><small>${choices.length} styles du pack ${esc(building.culture.pack)} · seul ce bâtiment est replanifié.</small>`;
  }
  return section(`house:${building.id}`, 'Bâtiment', !!edit, body, editorBox('Changer le style du bâtiment', fields, !!edit));
}

/** Fills `host` and binds its edit controls. */
export function renderCityInspector(host: HTMLElement, target: CityInspectorTarget, plan: CityScene, hooks: CityInspectorHooks): void {
  ensureEditStyles();
  host.innerHTML = houseSection(target, hooks) + lotSection(target, plan, hooks) + quarterSection(target, plan, hooks) || '<small>Rien d’inspectable ici.</small>';
  localizeCityInspector(host);
  if (target.built && !hooks.styles() && !hooks.houseLocked(target.built)) void hooks.loadStyles().then(index => { if (index && host.isConnected && host.querySelector('[data-styles-loading]')) renderCityInspector(host, target, plan, hooks); });
  for (const box of Array.from(host.querySelectorAll<HTMLElement>('.city-inspect'))) {
    const [scope, ...rest] = box.dataset.scope!.split(':'), key = rest.join(':');
    const status = box.querySelector<HTMLElement>('[data-edit-status]')!;
    const value = (field: string): string => box.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)?.value ?? '';
    const number = (field: string): number | undefined => value(field) === '' ? undefined : Number(value(field));
    const run = async (reset: boolean): Promise<void> => {
      if (scope === 'quarter') hooks.editQuarter(key, reset ? undefined : { role: value('role') || undefined, wealth: number('wealth'), culture: value('culture') || undefined, tissue: value('tissue') || undefined, density: number('density') });
      else if (scope === 'lot') {
        const role = value('role'), choice = role ? lotRoleChoices(target.parcel?.allocation?.culture ?? plan.layouts[target.parcel!.layout]?.culture).find(c => c.role === role) : undefined;
        hooks.editLot(key, reset ? undefined : { role: role || undefined, function: choice?.function, households: number('households') });
      } else if (scope === 'house') {
        const [recipe, variant] = value('style').split('::');
        status.textContent = 'Replanification du bâtiment…';
        const refusal = await hooks.editHouse(key, reset || !recipe ? undefined : { recipe, variant: variant || 'default' });
        status.textContent = refusal ? `Refusé, bâtiment précédent conservé : ${refusal}` : '';
        return;
      }
      status.textContent = 'Recalcul en cours…';
    };
    box.querySelector('[data-edit-apply]')?.addEventListener('click', () => void run(false));
    box.querySelector('[data-edit-reset]')?.addEventListener('click', () => void run(true));
    if (scope === 'quarter' || scope === 'lot') bindStructural(box, scope, key, target, plan, hooks, status);
  }
}

/** Outline of the item being reshaped, and the neighbouring vertices worth snapping to. */
function outlineOf(scope: 'quarter' | 'lot', key: string, target: CityInspectorTarget, plan: CityScene): { ring: Pt[]; snap: Pt[] } | undefined {
  if (scope === 'lot') {
    const parcel = target.parcel; if (!parcel) return undefined;
    const block = plan.layouts[parcel.layout]?.blocks[parcel.block];
    const snap = [...block?.shape.outer ?? [], ...plan.parcels.filter(p => p !== parcel && p.layout === parcel.layout && p.block === parcel.block).flatMap(p => p.shape.outer)];
    return { ring: parcel.source.shape.outer, snap };
  }
  const li = target.parcel?.layout ?? target.block?.layout, layout = li === undefined ? undefined : plan.layouts[li];
  const q = Number(key), quarter = layout?.quarters[q];
  if (!layout || !quarter) return undefined;
  return { ring: quarter.shape.outer, snap: layout.quarters.filter((_, i) => i !== q).flatMap(o => o.shape.outer).slice(0, 20000) };
}
function bindStructural(box: HTMLElement, scope: 'quarter' | 'lot', key: string, target: CityInspectorTarget, plan: CityScene, hooks: CityInspectorHooks, status: HTMLElement): void {
  const edit = (): QuarterEdit | LotEdit | undefined => scope === 'quarter' ? hooks.edits().quarters[key] : hooks.edits().parcels[key];
  const apply = (value: QuarterEdit | LotEdit, note: string): void => {
    status.textContent = note;
    if (scope === 'quarter') hooks.editQuarter(key, value as QuarterEdit); else hooks.editLot(key, value as LotEdit);
  };
  const on = (selector: string, handler: (button: HTMLButtonElement) => void): void => { const b = box.querySelector<HTMLButtonElement>(selector); b?.addEventListener('click', () => handler(b)); };
  on('[data-shape-edit]', () => {
    const outline = outlineOf(scope, key, target, plan); if (!outline) return;
    status.textContent = 'Édition de la forme : glissez les sommets, puis « Valider ».';
    hooks.editShape(scope, key, outline.ring, outline.snap);
  });
  on('[data-shape-reset]', () => apply({ shape: undefined }, 'Forme d’origine…'));
  on('[data-salt-next]', () => apply({ salt: (edit()?.salt ?? 0) + 1 }, 'Nouveau tirage…'));
  on('[data-salt-back]', () => { const s = (edit()?.salt ?? 0) - 1; apply({ salt: s > 0 ? s : undefined }, 'Tirage précédent…'); });
  on('[data-restore]', () => apply({ deleted: undefined }, 'Restauration…'));
  for (const b of Array.from(box.querySelectorAll<HTMLButtonElement>('[data-restore-lot]'))) b.addEventListener('click', () => { status.textContent = 'Restauration…'; hooks.editLot(b.dataset.restoreLot!, { deleted: undefined }); });
  // Two-step inline confirm (a confirm() dialog would block headless checks).
  let timer: ReturnType<typeof setTimeout> | undefined;
  on('[data-delete]', button => {
    if (!button.dataset.confirming) {
      button.dataset.confirming = '1'; button.textContent = 'Confirmer la suppression';
      timer = setTimeout(() => { delete button.dataset.confirming; button.textContent = 'Supprimer'; }, 4000);
      return;
    }
    clearTimeout(timer);
    const mode = box.querySelector<HTMLSelectElement>('[data-delete-mode]')?.value === 'garden' ? 'garden' : 'merge';
    apply(scope === 'quarter' ? { deleted: true } : { deleted: mode }, 'Suppression…');
  });
}
