import { CULTURE_LABELS, cultureEra } from '../gen/options';
import { contributorCultureBase } from '../gen/contributorCultures';
import { registerMessages, setText, translate } from './i18n';
import { handheldDevice } from '../../../rust/bridge/deviceClass';
import './cultureBrowser.css';

export const CULTURE_GROUPS = ['Medieval cultures', 'Ancient cultures', 'Fantasy cultures', 'Modern cultures', 'Futuristic cultures'] as const;

const ancientCultures = new Set(['barbarian', 'celtic-oppidum', 'egyptian-planned', 'indus-planned', 'levantine-tell', 'maya', 'mesopotamian', 'nubian-fortified', 'roman-core']);
const fantasyCultures = new Set(['drow-enclave', 'duergar-hold', 'dwarven', 'elven', 'giant-hold', 'gnomish', 'goblin-warren', 'halfling', 'lizardfolk-swamp', 'merfolk-tidal', 'myconid-colony', 'necropolis', 'orcish', 'stilt-town', 'wizard-city']);

registerMessages({
  'Choose a culture': { en: 'Choose a culture', fr: 'Choisir une culture' },
  'Search cultures': { en: 'Search cultures', fr: 'Rechercher une culture' },
  'No culture matches.': { en: 'No culture matches.', fr: 'Aucune culture ne correspond.' },
  'Follow the environment': { en: 'Follow the environment', fr: 'Suivre le milieu naturel' },
  ...Object.fromEntries(CULTURE_GROUPS.map((en, i) => [en, { en, fr: ['Cultures médiévales', 'Cultures antiques', 'Cultures fantastiques', 'Cultures modernes', 'Cultures futuristes'][i] }])),
});
const cultures = new Set(CULTURE_LABELS.map(([id]) => id));
export function cultureGroup(id: string): (typeof CULTURE_GROUPS)[number] | undefined {
  if (!cultures.has(id)) return undefined;
  const era = cultureEra(id);
  if (era) return era === 'modern' ? 'Modern cultures' : 'Futuristic cultures';
  const base = contributorCultureBase(id);
  if (fantasyCultures.has(base)) return 'Fantasy cultures';
  if (ancientCultures.has(base)) return 'Ancient cultures';
  return 'Medieval cultures';
}

/** Read the live options, including inheritance and environment restrictions. The original
 * select owns values, disabled state and change handlers in every form, including new inspectors. */
export function installCultureBrowser(root: HTMLElement, followEnvironment?: { source: HTMLSelectElement; get(): boolean; set(enabled: boolean): void }): void {
  const handheld = handheldDevice();
  const dialog = document.createElement('dialog');
  dialog.className = 'culture-browser';
  const header = document.createElement('header'),
    title = document.createElement('h2'),
    close = document.createElement('button');
  title.id = 'culture-browser-title';
  dialog.setAttribute('aria-labelledby', title.id);
  close.type = 'button';
  close.onclick = () => dialog.close();
  header.append(title, close);
  const automatic = document.createElement('label');
  automatic.className = 'culture-browser-environment checkline';
  automatic.hidden = true;
  const auto = document.createElement('input');
  auto.type = 'checkbox';
  auto.id = 'culture-browser-environment';
  const autoText = document.createElement('span');
  setText(autoText, 'Follow the environment');
  automatic.append(auto, autoText);
  const search = document.createElement('input');
  search.type = 'search';
  const grid = document.createElement('div');
  grid.className = 'culture-browser-grid';
  dialog.append(header, automatic, search, grid);
  document.body.append(dialog);
  let source: HTMLSelectElement | undefined;
  function render(): void {
    grid.replaceChildren();
    if (!source) return;
    automatic.hidden = source !== followEnvironment?.source;
    if (!automatic.hidden) auto.checked = followEnvironment!.get();
    const term = search.value.trim().toLocaleLowerCase();
    const options = Array.from(source.options).filter(o => !o.disabled && !o.hidden && !o.closest('optgroup')?.disabled && (!term || o.text.toLocaleLowerCase().includes(term)));
    for (const group of ['Automatic', ...CULTURE_GROUPS]) {
      const matches = options.filter(o => (cultureGroup(o.value) ?? 'Automatic') === group);
      if (!matches.length) continue;
      const section = document.createElement('section'),
        heading = document.createElement('h3');
      heading.textContent = translate(group);
      section.append(heading);
      if (matches.length > 18) section.className = 'culture-browser-wide';
      for (const option of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.text;
        button.dataset.cultureChoice = option.value;
        button.setAttribute('aria-pressed', String(option.value === source.value));
        button.onclick = () => {
          if (!source || !source.isConnected || source.disabled || source.closest('[inert]')) {
            dialog.close();
            return;
          }
          source.value = option.value;
          source.dispatchEvent(new Event('change', { bubbles: true }));
          dialog.close();
        };
        section.append(button);
      }
      grid.append(section);
    }
    if (!options.length) grid.textContent = translate('No culture matches.');
  }
  auto.onchange = () => {
    if (!source || source !== followEnvironment?.source || !source.isConnected || source.disabled || source.closest('[inert]')) return;
    followEnvironment.set(auto.checked);
    render();
  };
  function open(select: HTMLSelectElement): void {
    source = select;
    title.textContent = translate('Choose a culture');
    close.textContent = translate('Close');
    search.placeholder = translate('Search cultures');
    search.setAttribute('aria-label', search.placeholder);
    search.value = '';
    // Keep an advanced panel open while choosing one of its cultures.
    (select.closest('[popover]') ?? document.body).append(dialog);
    render();
    dialog.showModal();
    // On a handheld the focused search field would pop the keyboard over the list; the close button takes the focus.
    if (!handheld) search.focus();
  }
  const eligible = (target: EventTarget | null): target is HTMLSelectElement => {
    if (!(target instanceof HTMLSelectElement) || target.disabled || target.size > 1) return false;
    const count = Array.from(target.options).filter(o => cultures.has(o.value)).length;
    return count > 5 || (count > 0 && (target.dataset.option === 'culture' || target.id === 'local-culture' || /(^|\.)(culture|mixCulture|buildingCulture)$/i.test(target.dataset.settingPath ?? '')));
  };
  // A tap is a click: opening on the emulated mousedown would let the native picker open as well.
  root.addEventListener(handheld ? 'click' : 'mousedown', event => {
    if (event.button === 0 && eligible(event.target)) {
      event.preventDefault();
      open(event.target);
    }
  });
  root.addEventListener('keydown', event => {
    if (eligible(event.target) && (['Enter', ' ', 'F4'].includes(event.key) || (event.altKey && event.key === 'ArrowDown'))) {
      event.preventDefault();
      open(event.target);
    }
  });
  search.oninput = render;
  dialog.addEventListener('close', () => {
    if (source?.isConnected) source.focus();
  });
}
