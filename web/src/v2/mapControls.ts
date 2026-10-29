import { NAME_FAMILIES } from '../gen/names/types';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { registerMessages, setText, translate } from './i18n';
import { mountParameterForm } from './parameterForm';

const copy = (en: string, fr: string) => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  title: copy('Map title', 'Titre de la carte'), language: copy('Naming language', 'Langue des toponymes'),
  auto: copy('Follow the culture', 'Selon la culture'), apply: copy('Apply names', 'Appliquer les noms'),
  places: copy('Place names', 'Noms des lieux'), generated: copy('Generated name', 'Nom généré'),
  empty: copy('Place settlements to edit their names.', 'Implantez les peuplements pour modifier leurs noms.'),
  main: copy('Main settlement', 'Lieu principal'),
  export: copy('Choose format and export…', 'Choisir le format et exporter…'),
};
const languages = [
  ['French', 'Français'], ['English', 'Anglais'], ['German', 'Allemand'], ['Italian', 'Italien'],
  ['Arabic', 'Arabe'], ['Chinese', 'Chinois'], ['Japanese', 'Japonais'], ['Sanskrit', 'Sanskrit'],
  ['Norse', 'Nordique'], ['Elven', 'Elfique'], ['Dwarven', 'Nain'], ['Orcish', 'Orque'], ['Halfling', 'Halfelin'],
];

export function mountMapControls(namingHost: HTMLElement, exportHost: HTMLElement, b: {
  getSettings(): V2Settings; getWorld(): World | undefined; busy(): boolean; onNames(): void; onExport(): void;
}): { sync(): void } {
  const formHost = document.createElement('div'); namingHost.append(formHost);
  const form = mountParameterForm(formHost, [
    { path: 'title', id: 'map-title-input', type: 'text', label: T.title, optional: true, placeholder: T.generated },
    { path: 'language', id: 'map-naming-language', type: 'select', label: T.language,
      options: [{ value: 'auto', label: T.auto }, ...NAME_FAMILIES.map((value, i) => ({ value, label: copy(languages[i][0], languages[i][1]) }))] },
  ], {
    getValue: path => path === 'title' ? b.getSettings().naming?.title ?? '' : b.getSettings().options.language ?? 'auto',
    setValue: (path, value) => {
      const settings = b.getSettings();
      if (path === 'language') settings.options.language = value as V2Settings['options']['language'];
      else { settings.naming ??= {}; settings.naming.title = String(value ?? '').trim().slice(0, 200); }
      b.onNames();
    }, disabled: b.busy,
  });
  formHost.querySelector<HTMLInputElement>('#map-title-input')!.maxLength = 200;
  const heading = document.createElement('p'); heading.className = 'hint'; setText(heading, T.places); namingHost.append(heading);
  const places = document.createElement('div'); places.className = 'map-place-names'; namingHost.append(places);
  const apply = document.createElement('button'); apply.type = 'button'; apply.id = 'map-names-apply'; setText(apply, T.apply); apply.onclick = b.onNames; namingHost.append(apply);
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.id = 'map-export-open'; exportButton.className = 'primary'; setText(exportButton, T.export); exportButton.onclick = b.onExport; exportHost.append(exportButton);
  let keys = '', inputs: { key: string; input: HTMLInputElement }[] = [];
  function sync(): void {
    form.sync();
    const settlements = b.getWorld()?.settlements ?? [], nextKeys = JSON.stringify(settlements.map(place => place.key));
    if (nextKeys !== keys) {
      keys = nextKeys; places.replaceChildren(); inputs = [];
      if (!settlements.length) { const empty = document.createElement('p'); empty.className = 'hint'; setText(empty, T.empty); places.append(empty); }
      for (const place of settlements) {
        const label = document.createElement('label'); label.className = 'parameter-field';
        const caption = document.createElement('span'); caption.className = 'parameter-caption';
        if (place.main) setText(caption, T.main); else { caption.dataset.l10nKeep = ''; caption.textContent = place.name ?? place.key; }
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 200; input.dataset.placeName = place.key;
        input.onchange = () => {
          const settings = b.getSettings(); settings.naming ??= {}; settings.naming.places ??= {};
          if (input.value.trim()) settings.naming.places[place.key] = input.value.trim(); else delete settings.naming.places[place.key];
          b.onNames();
        };
        label.append(caption, input); places.append(label); inputs.push({ key: place.key, input });
      }
    }
    for (const { key, input } of inputs) {
      if (document.activeElement !== input) input.value = b.getSettings().naming?.places?.[key] ?? '';
      const generated = settlements.find(place => place.key === key)?.name;
      input.placeholder = generated ?? translate(T.generated); input.setAttribute('aria-label', generated ?? key); input.disabled = b.busy();
    }
    apply.disabled = b.busy() || !b.getWorld(); exportButton.disabled = b.busy();
  }
  sync(); return { sync };
}
