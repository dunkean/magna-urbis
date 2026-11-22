/**
 * Special-building counts of one settlement (`layout.programme.counts`): the engine's default draw as a list of
 * building types and numbers, each editable, plus rows added from the catalogue. One mode per town: "Suggest"
 * (targets the programme may reduce silently) or "Force" (exact counts placed first, warned when short).
 * Shared by the V2 town inspector and any page that edits a settlement's programme.
 */
import servicesJson from '../../../rust/crates/core/src/urban/services.json';
import { MAX_ROLE_COUNT, normalizeProgrammeCounts, type ProgrammeCountMode } from '../../../rust/bridge/urbanConfig';
import type { ProgrammeCountOutcome, UrbanProgramme } from '../../../rust/bridge/urban';
import { roleLabel, uiRoleLocale } from '../render/cityRoles';
import type { V2Settings } from './contracts';
import { registerMessages, setText, translate } from './i18n';

registerMessages({
  'Special buildings': { en: 'Special buildings', fr: 'Bâtiments particuliers' },
  'Default draw of this settlement. Change a number, or add a building type; other types stay automatic. Applied on Regenerate.': {
    en: 'Default draw of this settlement. Change a number, or add a building type; other types stay automatic. Applied on Regenerate.',
    fr: 'Tirage par défaut de ce lieu. Modifiez un nombre ou ajoutez un type de bâtiment ; les autres types restent automatiques. Appliqué à la régénération.',
  },
  'Build the settlement to see its default draw.': { en: 'Build the settlement to see its default draw.', fr: 'Construisez le lieu pour voir son tirage par défaut.' },
  'Counts mode': { en: 'Counts mode', fr: 'Mode des nombres' },
  Suggest: { en: 'Suggest', fr: 'Suggérer' },
  Force: { en: 'Force', fr: 'Imposer' },
  'Suggest: targets the programme may lower for the town’s size and sites. Force: exact counts placed before the automatic buildings, with a warning when a site is missing.': {
    en: 'Suggest: targets the programme may lower for the town’s size and sites. Force: exact counts placed before the automatic buildings, with a warning when a site is missing.',
    fr: 'Suggérer : des cibles que le programme peut réduire selon la taille et les sites. Imposer : des nombres exacts placés avant les bâtiments automatiques, avec un avertissement quand un site manque.',
  },
  'Back to automatic': { en: 'Back to automatic', fr: 'Revenir à l’automatique' },
  'Reset all to automatic': { en: 'Reset all to automatic', fr: 'Tout remettre en automatique' },
  '+ Add a building type': { en: '+ Add a building type', fr: '+ Ajouter un type de bâtiment' },
  Add: { en: 'Add', fr: 'Ajouter' },
  'This culture': { en: 'This culture', fr: 'Cette culture' },
  'Other building types': { en: 'Other building types', fr: 'Autres types de bâtiments' },
  'Placed / requested in the last build': { en: 'Placed / requested in the last build', fr: 'Placés / demandés au dernier calcul' },
  'Not every requested building could be placed: no suitable site.': { en: 'Not every requested building could be placed: no suitable site.', fr: 'Tous les bâtiments demandés n’ont pas pu être placés : aucun site adapté.' },
  'Number of buildings': { en: 'Number of buildings', fr: 'Nombre de bâtiments' },
});

type Service = { role: string };
const services = servicesJson as unknown as { cultures: Record<string, string>; families: Record<string, Service[]>; cultureServices?: Record<string, Service[]>; rural?: Service[]; harbour?: Service[] };
/** Roles with a catalogue row: the only ones a count can build (Rust `roles::countable_role`). */
export const COUNTABLE = [...new Set([...Object.values(services.families).flat(), ...Object.values(services.cultureServices ?? {}).flat(), ...(services.rural ?? []), ...(services.harbour ?? [])].map(e => e.role))];

/** A culture's own building types first (its entries, its family's, rural), then every other countable type. */
export function countableRoles(culture: string): { own: string[]; other: string[] } {
  const own = [...new Set([...(services.cultureServices?.[culture] ?? []), ...(services.families[services.cultures[culture] ?? 'fantasy'] ?? []), ...(services.rural ?? [])].map(e => e.role))];
  const mine = new Set(own);
  return { own, other: COUNTABLE.filter(role => !mine.has(role)) };
}

/** Rows of the last build, summed by role over the settlement's partitions. */
export function programmeCountRows(programmes: readonly (UrbanProgramme | undefined)[]): ProgrammeCountOutcome[] {
  const rows = new Map<string, ProgrammeCountOutcome>();
  for (const programme of programmes)
    for (const row of programme?.counts ?? []) {
      const sum = rows.get(row.role);
      if (sum) {
        sum.auto += row.auto;
        sum.placed += row.placed;
      } else rows.set(row.role, { ...row });
    }
  return [...rows.values()];
}

/** The settlement's own programme overrides (`settings.urban.local[key].layout.programme`). */
function ownProgramme(settings: V2Settings, key: string, create: boolean): Record<string, unknown> | undefined {
  if (!create) return settings.urban?.local?.[key]?.layout?.programme as Record<string, unknown> | undefined;
  settings.urban ??= {};
  settings.urban.local ??= {};
  const local = (settings.urban.local[key] ??= {});
  const layout = (local.layout ??= {}) as Record<string, unknown>;
  return (layout.programme ??= {}) as Record<string, unknown>;
}
export function requestedCounts(settings: V2Settings, key: string): Record<string, number> {
  return normalizeProgrammeCounts(ownProgramme(settings, key, false)?.counts);
}
export function countMode(settings: V2Settings, key: string): ProgrammeCountMode {
  return ownProgramme(settings, key, false)?.countMode === 'force' ? 'force' : 'suggest';
}
/** Writes the whole `counts` object at once (role ids hold dots, so no path-based field may address them). */
export function writeRequestedCounts(settings: V2Settings, key: string, counts: Record<string, number>, mode: ProgrammeCountMode): void {
  const clean = normalizeProgrammeCounts(counts);
  const programme = ownProgramme(settings, key, Object.keys(clean).length > 0);
  if (!programme) return;
  if (Object.keys(clean).length) programme.counts = clean;
  else delete programme.counts;
  if (mode === 'force' && programme.counts) programme.countMode = 'force';
  else delete programme.countMode;
  const local = settings.urban?.local?.[key];
  if (local?.layout && !Object.keys(programme).length) delete (local.layout as Record<string, unknown>).programme;
}

export interface ProgrammeCountsOptions {
  key: string;
  getSettings: () => V2Settings;
  culture: () => string;
  /** Count rows of the last build (empty before the programme stage ran). */
  rows: () => readonly ProgrammeCountOutcome[];
  changed: () => void;
}

/** Mounts the editor in `root`; `sync` re-renders it after external changes. */
export function mountProgrammeCounts(root: HTMLElement, options: ProgrammeCountsOptions): { sync: () => void; dispose: () => void } {
  root.classList.add('programme-counts');
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) setText(node, text);
    return node;
  };
  function save(counts: Record<string, number>, mode: ProgrammeCountMode): void {
    writeRequestedCounts(options.getSettings(), options.key, counts, mode);
    options.changed();
    render();
  }
  function render(): void {
    root.replaceChildren();
    const settings = options.getSettings(),
      requested = requestedCounts(settings, options.key),
      mode = countMode(settings, options.key),
      built = new Map(options.rows().map(row => [row.role, row])),
      culture = options.culture(),
      locale = uiRoleLocale();
    const head = element('div', 'programme-counts-head');
    head.append(element('span', 'eyebrow', 'Special buildings'));
    if (Object.keys(requested).length) {
      const reset = element('button', 'quiet small', 'Reset all to automatic');
      reset.type = 'button';
      reset.onclick = () => save({}, mode);
      head.append(reset);
    }
    root.append(head, element('p', 'hint', built.size ? 'Default draw of this settlement. Change a number, or add a building type; other types stay automatic. Applied on Regenerate.' : 'Build the settlement to see its default draw.'));
    const modeLabel = element('label', 'label', 'Counts mode'),
      modeSelect = element('select');
    modeSelect.id = `programme-count-mode-${options.key.replace(/[^a-z0-9-]/gi, '-')}`;
    modeLabel.htmlFor = modeSelect.id;
    for (const [value, label] of [
      ['suggest', 'Suggest'],
      ['force', 'Force'],
    ] as const) {
      const option = element('option', undefined, label);
      option.value = value;
      modeSelect.append(option);
    }
    modeSelect.value = mode;
    modeSelect.title = translate('Suggest: targets the programme may lower for the town’s size and sites. Force: exact counts placed before the automatic buildings, with a warning when a site is missing.');
    modeSelect.onchange = () => save(requested, modeSelect.value === 'force' ? 'force' : 'suggest');
    root.append(modeLabel, modeSelect);
    // The default draw (auto > 0), then every requested type, in the order of the catalogue roles.
    const roles = [...new Set([...[...built.values()].filter(row => row.auto > 0).map(row => row.role), ...Object.keys(requested)])].sort();
    const list = element('ul', 'programme-counts-list');
    for (const role of roles) {
      const row = built.get(role),
        own = requested[role],
        item = element('li', own === undefined ? 'programme-count' : 'programme-count overridden');
      const name = element('span', 'programme-count-name');
      name.textContent = roleLabel(role, locale, culture);
      name.title = role;
      const input = element('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(MAX_ROLE_COUNT);
      input.step = '1';
      input.value = String(own ?? row?.auto ?? 0);
      input.setAttribute('aria-label', `${name.textContent} · ${translate('Number of buildings')}`);
      input.onchange = () => {
        if (!input.checkValidity()) return input.reportValidity();
        save({ ...requested, [role]: Number(input.value) }, mode);
      };
      item.append(name, input);
      if (own !== undefined) {
        // Placed/requested once a build used this very request.
        if (row?.requested === own) {
          const short = mode === 'force' && row.placed < own,
            result = element('span', short ? 'programme-count-result warning' : 'programme-count-result');
          result.textContent = `${short ? '⚠ ' : ''}${row.placed}/${own}`;
          result.title = translate(short ? 'Not every requested building could be placed: no suitable site.' : 'Placed / requested in the last build');
          item.append(result);
        }
        const auto = element('button', 'quiet small programme-count-auto');
        auto.type = 'button';
        auto.textContent = '✕';
        auto.title = translate('Back to automatic');
        auto.setAttribute('aria-label', auto.title);
        auto.onclick = () => {
          const next = { ...requested };
          delete next[role];
          save(next, mode);
        };
        item.append(auto);
      }
      list.append(item);
    }
    root.append(list);
    // '+': a new building type from the catalogue (the culture's types first) and its number.
    const add = element('div', 'programme-count-add'),
      picker = element('select'),
      count = element('input'),
      confirm = element('button', 'small', 'Add');
    const { own, other } = countableRoles(culture);
    for (const [group, ids] of [
      ['This culture', own],
      ['Other building types', other],
    ] as const) {
      const optgroup = element('optgroup');
      optgroup.label = translate(group);
      for (const role of ids.filter(id => !roles.includes(id))) {
        const option = element('option');
        option.value = role;
        option.textContent = roleLabel(role, locale, culture);
        optgroup.append(option);
      }
      if (optgroup.children.length) picker.append(optgroup);
    }
    picker.setAttribute('aria-label', translate('+ Add a building type'));
    count.type = 'number';
    count.min = '0';
    count.max = String(MAX_ROLE_COUNT);
    count.step = '1';
    count.value = '1';
    count.setAttribute('aria-label', translate('Number of buildings'));
    confirm.type = 'button';
    confirm.onclick = () => {
      if (!picker.value || !count.checkValidity()) return count.reportValidity();
      save({ ...requested, [picker.value]: Number(count.value) }, mode);
    };
    add.hidden = true;
    add.append(picker, count, confirm);
    const open = element('button', 'quiet small', '+ Add a building type');
    open.type = 'button';
    open.onclick = () => {
      add.hidden = false;
      open.hidden = true;
      picker.focus();
    };
    root.append(open, add);
  }
  render();
  return { sync: render, dispose: () => root.replaceChildren() };
}
