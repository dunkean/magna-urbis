import type { Pt } from '../ui/cityShapeEditor';
import { CULTURE_LABELS } from '../gen/options';
import type { View } from '../render/view';
import type { QuarterOverride, BlockOverride, ParcelOverride } from '../../../rust/bridge/urbanConfig';
import { setText } from './i18n';

type Edit = QuarterOverride | BlockOverride | ParcelOverride;
type Kind = 'quarter' | 'block' | 'parcel';
const label = (fr: boolean, en: string, french: string): string => (fr ? french : en);
const button = (host: HTMLElement, text: string, action: () => void): void => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'small';
  setText(b, text);
  b.onclick = action;
  host.append(b);
};

/** Direct actions preserve the other fields of the selected native override. */
export function mountSubdivisionActions(
  host: HTMLElement,
  opts: { kind: Kind; french: boolean; actionsOnly?: boolean; get: () => Edit | undefined; apply: (value: Edit) => void; rerollBuildings?: () => void; shape: { outer: Pt[]; holes?: Pt[][] }; map: HTMLElement; getView: () => View },
): void {
  const { kind, french, get, apply } = opts;
  host.classList.add('v2-edit-actions');
  const act = (patch: Edit): void => apply({ ...get(), ...patch });
  if (kind === 'quarter' && !opts.actionsOnly) {
    const select = (key: 'culture' | 'tissue' | 'role', title: string, choices: [string, string][]): void => {
      const row = document.createElement('label');
      row.className = 'label';
      row.textContent = title;
      const input = document.createElement('select');
      for (const [value, text] of [['', label(french, 'Inherited', 'Hérité')], ...choices]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
      input.value = (get() as QuarterOverride | undefined)?.[key] ?? '';
      input.onchange = () => {
        const next = { ...get() } as QuarterOverride;
        if (input.value) next[key] = input.value;
        else delete next[key];
        apply(next);
      };
      row.append(input);
      host.append(row);
    };
    select('culture', 'Culture', CULTURE_LABELS);
    select('role', label(french, 'District role', 'Fonction du quartier'), [
      ['civic', label(french, 'Civic', 'Civique')],
      ['market', label(french, 'Market', 'Marché')],
      ['religious', label(french, 'Religious', 'Religieux')],
      ['port', label(french, 'Port', 'Port')],
      ['elite', label(french, 'Elite', 'Patricien')],
      ['commoner', label(french, 'Residential', 'Populaire')],
      ['poor', label(french, 'Poor', 'Pauvre')],
      ['garrison', label(french, 'Garrison', 'Garnison')],
      ['gardens', label(french, 'Gardens', 'Jardins')],
      ['foreign', label(french, 'Foreign', 'Étranger')],
      ['craft', label(french, 'Craft', 'Artisanat')],
    ]);
    select('tissue', label(french, 'Street pattern', 'Trame'), [
      ['culture', label(french, 'Cultural', 'Culturelle')],
      ['grid', label(french, 'Grid', 'Grille')],
      ['organic', label(french, 'Organic', 'Organique')],
      ['radial', label(french, 'Radial', 'Radiale')],
      ['terraces', label(french, 'Terraces', 'Terrasses')],
      ['dendritic', label(french, 'Branching', 'Ramifiée')],
      ['clusters', label(french, 'Clusters', 'Groupée')],
    ]);
  }
  const dice = document.createElement('button');
  dice.type = 'button';
  dice.className = 'settlement-reroll subdivision-reroll';
  dice.innerHTML = '<i class="art art-dice" aria-hidden="true"></i>';
  const title = label(french, 'New random layout and descendants', 'Nouveau plan aléatoire et descendants');
  dice.title = title;
  dice.setAttribute('aria-label', title);
  dice.onclick = () => {
    const salt = (crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647) + 1;
    act({ salt: salt === get()?.salt ? (salt % 2147483647) + 1 : salt });
  };
  host.append(dice);
}

/** Deleted items cannot be picked from the map, so expose their saved IDs in the place inspector. */
export function mountDeletedSubdivisions(host: HTMLElement, french: boolean, entries: { kind: Kind; id: string }[], restore: (kind: Kind, id: string) => void): void {
  if (!entries.length) return;
  const details = document.createElement('details');
  details.className = 'section';
  const summary = document.createElement('summary');
  summary.textContent = label(french, 'Restore deleted areas', 'Restaurer les zones supprimées');
  details.append(summary);
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'control-grid';
    const name = document.createElement('span');
    name.textContent = `${entry.kind === 'quarter' ? label(french, 'Quarter', 'Quartier') : label(french, 'Parcel', 'Parcelle')} · ${entry.id}`;
    row.append(name);
    button(row, label(french, 'Restore', 'Restaurer'), () => restore(entry.kind, entry.id));
    details.append(row);
  }
  host.append(details);
}
