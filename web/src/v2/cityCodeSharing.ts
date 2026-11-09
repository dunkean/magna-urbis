import { encodeCityCode, decodeCityCode, cityCodeUrl } from './cityCode';
import type { V2Settings } from './contracts';
import { insertHTML, setText, setDynamicText, registerMessages, translate } from './i18n';

interface CityCodeBindings {
  getRecipe(): { settings: V2Settings; mods: unknown[] };
  load(recipe: { settings: V2Settings; mods: unknown[] }): Promise<void>;
  busy(): boolean;
}
const copy = (en: string, fr: string): string => { registerMessages({ [en]: { en, fr } }); return en; };
const text = {
  share: copy('Share', 'Partager'), title: copy('Share a region', 'Partager une région'),
  hint: copy('Seed, biome, culture, relief and region size. Only customisations add to the code.', 'Graine, biome, culture, relief et taille de région. Seules les personnalisations s’ajoutent au code.'),
  code: copy('Generation code', 'Code de génération'), copyCode: copy('Copy code', 'Copier le code'),
  copyLink: copy('Copy link', 'Copier le lien'), open: copy('Open a code or link', 'Ouvrir un code ou un lien'),
  load: copy('Load recipe', 'Charger la recette'), close: copy('Close', 'Fermer'),
  size: copy('{count} characters', '{count} caractères'), copied: copy('Copied.', 'Copié.'),
  clipboard: copy('Select and copy the text below.', 'Sélectionnez et copiez le texte ci-dessous.'),
};
for (const [en, fr] of [
  ['An imported heightmap requires a complete project.', 'Une heightmap importée nécessite un projet complet.'],
  ['Incomplete, corrupt or oversized code.', 'Code incomplet, corrompu ou trop volumineux.'],
  ['Unknown preset.', 'Préréglage inconnu.'],
  ['Calculated data requires a complete project.', 'Les données calculées nécessitent un projet complet.'],
] as const) registerMessages({ [fr]: { en, fr } });

export function mountCityCodeSharing(bindings: CityCodeBindings): { restoreFromLocation(): Promise<void> } {
  const find = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  insertHTML(find('import-open'), 'beforebegin', `<button id="city-code-open">${text.share}</button>`);
  insertHTML(find('toast'), 'beforebegin', `<dialog id="city-code-dialog">
    <div class="dialog-head"><h2>${text.title}</h2><button id="city-code-close" aria-label="${text.close}">×</button></div>
    <p class="hint">${text.hint}</p>
    <label class="label" for="city-code-output">${text.code}</label>
    <textarea id="city-code-output" readonly rows="3" spellcheck="false"></textarea>
    <p class="hint" id="city-code-size" aria-live="polite"></p>
    <div class="dialog-actions"><button id="city-code-copy">${text.copyCode}</button><button id="city-code-link">${text.copyLink}</button></div>
    <label class="label" for="city-code-input">${text.open}</label>
    <textarea id="city-code-input" rows="3" spellcheck="false" placeholder="MU3.…"></textarea>
    <p class="warning" id="city-code-error" role="alert"></p>
    <div class="dialog-actions"><button id="city-code-load" class="primary">${text.load}</button></div>
  </dialog>`);
  insertHTML(find('project-file'), 'beforebegin', `<button id="city-code-import">${text.open}</button>`);
  const dialog = find<HTMLDialogElement>('city-code-dialog');
  const output = find<HTMLTextAreaElement>('city-code-output'), input = find<HTMLTextAreaElement>('city-code-input');
  const error = find('city-code-error');
  let code = '';
  const showError = (value: unknown) => setText(error, value instanceof Error ? value.message : String(value));
  const open = () => {
    if (bindings.busy()) return;
    setText(error, ''); code = ''; output.value = '';
    try {
      const recipe = bindings.getRecipe(); code = encodeCityCode(recipe.settings, recipe.mods); output.value = code;
      setDynamicText(find('city-code-size'), () => translate(text.size).replace('{count}', String(code.length)));
    } catch (e) { setText(find('city-code-size'), ''); showError(e); }
    find<HTMLButtonElement>('city-code-copy').disabled = !code;
    find<HTMLButtonElement>('city-code-link').disabled = !code;
    dialog.showModal();
  };
  find('city-code-open').onclick = open;
  find('city-code-import').onclick = () => { find<HTMLDialogElement>('import-dialog').close(); open(); input.focus(); };
  find('city-code-close').onclick = () => dialog.close();
  async function copyValue(value: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setText(error, ''); setText(find('city-code-size'), text.copied); }
    catch { output.value = value; output.focus(); output.select(); setText(find('city-code-size'), text.clipboard); }
  }
  find('city-code-copy').onclick = () => void copyValue(code);
  find('city-code-link').onclick = () => void copyValue(cityCodeUrl(code, location.href));
  find('city-code-load').onclick = async () => {
    if (bindings.busy()) return;
    setText(error, '');
    try { await bindings.load(decodeCityCode(input.value)); dialog.close(); }
    catch (e) { showError(e); }
  };
  return { async restoreFromLocation() {
    const shared = new URLSearchParams(location.hash.slice(1)).get('city');
    if (!shared) return;
    try { await bindings.load(decodeCityCode(shared)); }
    catch (e) { open(); input.value = shared; showError(e); }
  } };
}
