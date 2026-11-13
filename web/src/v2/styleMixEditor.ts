/** Weighted culture mixes: one row editor shared by the house-style mixtures and the style sheet of hybrid
 * cities (`LayoutConfig.styleSheet`), on the V2 urban controls and on City Bench. */
import { STYLE_FACETS, type StyleFacet, type StyleMix, type StyleSheet } from '../../../rust/bridge/urbanConfig';
import { bindTree, registerMessages, setText, translate } from './i18n';
import { URBAN_ZONES, urbanCultureChoices } from './urbanControlSchema';
import './urbanControls.css';

export type MixSpread = NonNullable<StyleMix['spread']>;
const SPREADS: readonly MixSpread[] = ['lot', 'block', 'quarter'];
export type UrbanZone = typeof URBAN_ZONES[number];

/** Facet titles and one-line hints, English first, French second. */
export const STYLE_FACET_TEXT: Record<StyleFacet, { title: readonly [string, string]; hint: readonly [string, string] }> = {
  streets: { title: ['Streets', 'Rues'], hint: ['The heaviest culture of a zone’s mix gives that zone its street pattern.', 'La culture la plus lourde du mélange d’une zone donne à cette zone son tracé de rues.'] },
  plots: { title: ['Plots', 'Parcelles'], hint: ['Cultures of the cadastral cut: shape and size of the plots.', 'Cultures du découpage cadastral : forme et taille des parcelles.'] },
  houses: { title: ['Houses', 'Maisons'], hint: ['Cultures of the homes built on the plots.', 'Cultures des habitations bâties sur les parcelles.'] },
  monuments: { title: ['Monuments and utility buildings', 'Monuments et utilitaires'], hint: ['Cultures of singular and utility buildings: worship, power, markets, inns, mills.', 'Cultures des bâtiments singuliers et utilitaires : culte, pouvoir, marchés, auberges, moulins.'] },
  rural: { title: ['Farms', 'Fermes'], hint: ['Cultures of the farm types in the countryside.', 'Cultures des types de fermes à la campagne.'] },
};
export const URBAN_ZONE_TEXT: Record<UrbanZone, readonly [string, string]> = { core: ['Core', 'Cœur'], middle: ['Middle', 'Extension'], edge: ['Edge', 'Périphérie'], faubourg: ['Faubourg', 'Faubourg'], village: ['Village', 'Village'] };
const messages: Record<string, string> = {
  'Hybrid city': 'Ville hybride',
  'Each facet of the town draws from a weighted mix of cultures. An empty facet follows the place’s own culture.': 'Chaque facette de la ville puise dans un mélange pondéré de cultures. Une facette vide suit la culture du lieu.',
  'Whole place': 'Tout le lieu', 'By growth zone': 'Par zone de croissance', 'An empty zone uses the whole-place mix.': 'Une zone vide reprend le mélange de tout le lieu.',
  'Add a culture': 'Ajouter une culture', 'Remove culture': 'Retirer la culture', 'Follow the place’s culture': 'Suivre la culture du lieu',
  Weight: 'Poids', Spread: 'Répartition', 'Each lot draws one culture': 'Chaque lot tire une culture', 'Each block draws one culture': 'Chaque îlot tire une culture', 'Each quarter draws one culture': 'Chaque quartier tire une culture',
  Lot: 'Lot', Block: 'Îlot', Quarter: 'Quartier',
};
registerMessages(Object.fromEntries([
  ...Object.entries(messages).map(([en, fr]) => [en, { en, fr }] as const),
  ...Object.values(STYLE_FACET_TEXT).flatMap(({ title, hint }) => [[title[0], { en: title[0], fr: title[1] }], [hint[0], { en: hint[0], fr: hint[1] }]] as const),
  ...Object.values(URBAN_ZONE_TEXT).map(([en, fr]) => [en, { en, fr }] as const),
]));

const usable = (mix?: StyleMix): mix is StyleMix => !!mix?.styles?.some(s => s.culture && Number.isFinite(s.weight) && s.weight > 0);
function actionButton(root: HTMLElement, source: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; setText(b, source); b.onclick = onClick; root.append(b); return b;
}

export interface MixEditorOptions {
  get(): StyleMix | undefined;
  /** `undefined` clears the mix (the scope then inherits). */
  set(mix: StyleMix | undefined): void;
  /** Culture of a newly added row. */
  defaultCulture(): string;
  /** Written as `data-setting-path` prefix on the inputs (inspector lookups). */
  path?: string;
  /** Weight as a 0–100 slider; otherwise a free non-negative number. */
  slider?: boolean;
  /** Spread captions: short (`Lot`) or explicit (`Each lot draws one culture`). */
  spreadText?: 'short' | 'explicit';
  labels?: { add: string; remove: string; reset: string };
}
export interface MixEditor { sync(): void }

/** Rows of `{culture, weight}`, a spread select, "add" and "reset" actions. The caller runs `sync` (first render
 * included); it re-renders only when the value changes. */
export function mountMixEditor(area: HTMLElement, o: MixEditorOptions): MixEditor {
  const labels = o.labels ?? { add: 'Add a culture', remove: 'Remove culture', reset: 'Follow the place’s culture' };
  const rows = document.createElement('div'); rows.className = 'urban-mix-rows'; area.append(rows);
  const actions = document.createElement('div'); actions.className = 'urban-mix-actions'; area.append(actions);
  actionButton(actions, labels.add, () => { const current = o.get(); o.set({ ...current, spread: current?.spread ?? 'lot', styles: [...current?.styles ?? [], { culture: o.defaultCulture(), weight: 100 }] }); });
  actionButton(actions, labels.reset, () => o.set(undefined));
  const spreadText = (id: MixSpread) => o.spreadText === 'explicit' ? `Each ${id} draws one culture` : id[0].toUpperCase() + id.slice(1);
  let identity: string | undefined;
  function sync(): void {
    const value = o.get(), next = JSON.stringify(value ?? null);
    if (next === identity) return; identity = next; rows.replaceChildren();
    if (!value) return;
    const spread = document.createElement('label'); spread.className = 'urban-mix-spread'; const caption = document.createElement('span'); setText(caption, 'Spread');
    const select = document.createElement('select'); if (o.path) select.dataset.settingPath = `${o.path}.spread`;
    for (const id of SPREADS) { const option = document.createElement('option'); option.value = id; setText(option, spreadText(id)); select.append(option); }
    select.value = value.spread ?? 'lot';
    select.onchange = () => o.set({ ...value, spread: select.value as MixSpread }); spread.append(caption, select); rows.append(spread);
    const cultures = urbanCultureChoices();
    value.styles.forEach((style, i) => {
      const row = document.createElement('div'); row.className = 'urban-mix-row';
      const culture = document.createElement('select'); culture.setAttribute('aria-label', translate('Culture')); if (o.path) culture.dataset.settingPath = `${o.path}.styles.${i}.culture`;
      for (const c of cultures) culture.append(new Option(c.label, c.value));
      if (!cultures.some(c => c.value === style.culture)) culture.append(new Option(style.culture, style.culture));
      culture.value = style.culture;
      const weight = document.createElement('input'); weight.setAttribute('aria-label', translate('Weight')); if (o.path) weight.dataset.settingPath = `${o.path}.styles.${i}.weight`;
      if (o.slider) { weight.type = 'range'; weight.min = '0'; weight.max = '100'; weight.step = '1'; weight.className = 'urban-mix-weight'; }
      else { weight.type = 'number'; weight.min = '0'; weight.step = 'any'; }
      weight.value = String(style.weight);
      const shown = document.createElement('output'); shown.textContent = String(style.weight); shown.dataset.l10nKeep = '';
      weight.oninput = () => { shown.textContent = weight.value; };
      const update = () => { const n = Number(weight.value); if (!Number.isFinite(n) || n < 0) return; const styles = value.styles.map(s => ({ ...s })); styles[i] = { culture: culture.value, weight: n }; o.set({ ...value, styles }); };
      culture.onchange = update; weight.onchange = update; row.append(culture, weight);
      if (o.slider) row.append(shown);
      actionButton(row, labels.remove, () => { const styles = value.styles.filter((_, j) => i !== j); o.set(styles.length ? { ...value, styles } : undefined); }); rows.append(row);
    });
    bindTree(rows);
  }
  return { sync };
}

/** A copy of `sheet` with the mix of one facet (whole place, or one growth zone) replaced; empty levels are dropped. */
export function withStyleMix(sheet: StyleSheet | undefined, facet: StyleFacet, zone: UrbanZone | undefined, mix: StyleMix | undefined): StyleSheet | undefined {
  const next: StyleSheet = structuredClone(sheet ?? {}), entry = next[facet] ?? {};
  if (zone) { const zones = { ...entry.zones }; if (mix) zones[zone] = mix; else delete zones[zone]; if (Object.keys(zones).length) entry.zones = zones; else delete entry.zones; }
  else if (mix) entry.city = mix; else delete entry.city;
  if (Object.keys(entry).length) next[facet] = entry; else delete next[facet];
  return Object.keys(next).length ? next : undefined;
}

export interface StyleSheetEditorOptions {
  /** Mix of one facet for the whole place (`zone` absent) or one growth zone. */
  getMix(facet: StyleFacet, zone?: UrbanZone): StyleMix | undefined;
  setMix(facet: StyleFacet, zone: UrbanZone | undefined, mix: StyleMix | undefined): void;
  defaultCulture(): string;
  /** `data-setting-path` prefix of the sheet (V2: `layout.styleSheet`). */
  path?: string;
}
export interface StyleSheetEditor extends MixEditor { root: HTMLDetailsElement }

/** "Hybrid city" section: per facet, a whole-place mix and an expandable per-zone override. */
export function mountStyleSheetEditor(parent: HTMLElement, o: StyleSheetEditorOptions): StyleSheetEditor {
  const root = document.createElement('details'); root.className = 'urban-control-section urban-style-sheet';
  const summary = document.createElement('summary'); setText(summary, 'Hybrid city'); root.append(summary); parent.append(root);
  const intro = document.createElement('small'); setText(intro, 'Each facet of the town draws from a weighted mix of cultures. An empty facet follows the place’s own culture.'); root.append(intro);
  const editors: MixEditor[] = [], facetStates: (() => void)[] = [];
  for (const facet of STYLE_FACETS) {
    const text = STYLE_FACET_TEXT[facet];
    const box = document.createElement('details'); box.className = 'urban-control-section urban-style-facet'; box.dataset.styleFacet = facet;
    const title = document.createElement('summary'); setText(title, text.title[0]); box.append(title);
    const hint = document.createElement('small'); setText(hint, text.hint[0]); box.append(hint);
    const whole = document.createElement('div'); whole.className = 'urban-style-mix'; box.append(whole);
    const caption = document.createElement('h4'); setText(caption, 'Whole place'); whole.append(caption);
    const base = o.path ? `${o.path}.${facet}` : undefined;
    editors.push(mountMixEditor(whole, { get: () => o.getMix(facet), set: mix => o.setMix(facet, undefined, mix), defaultCulture: o.defaultCulture, slider: true, spreadText: 'explicit', path: base && `${base}.city` }));
    const zones = document.createElement('details'); zones.className = 'urban-style-zones';
    const zonesTitle = document.createElement('summary'); setText(zonesTitle, 'By growth zone'); zones.append(zonesTitle);
    const zonesHint = document.createElement('small'); setText(zonesHint, 'An empty zone uses the whole-place mix.'); zones.append(zonesHint);
    for (const zone of URBAN_ZONES) {
      const area = document.createElement('div'); area.className = 'urban-style-mix'; area.dataset.styleZone = zone;
      const heading = document.createElement('h4'); setText(heading, URBAN_ZONE_TEXT[zone][0]); area.append(heading); zones.append(area);
      editors.push(mountMixEditor(area, { get: () => o.getMix(facet, zone), set: mix => o.setMix(facet, zone, mix), defaultCulture: o.defaultCulture, slider: true, spreadText: 'explicit', path: base && `${base}.zones.${zone}` }));
    }
    box.append(zones);
    // A facet or its zone list opens by itself when it holds a choice; the user's own toggles are kept afterwards.
    let shown = false;
    facetStates.push(() => {
      const zoned = URBAN_ZONES.some(zone => usable(o.getMix(facet, zone)));
      box.classList.toggle('urban-style-set', zoned || usable(o.getMix(facet)));
      if (!shown && (zoned || usable(o.getMix(facet)))) { box.open = true; zones.open ||= zoned; shown = true; }
    });
    root.append(box);
  }
  const sync = () => { editors.forEach(e => e.sync()); facetStates.forEach(f => f()); };
  bindTree(root);
  return { root, sync };
}
