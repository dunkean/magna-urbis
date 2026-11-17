import { encodeCityCode, decodeCityCode, cityCodeUrl, resolveCityCodeDecor, UNRECOGNISED_INPUT } from './cityCode';
import { FMG_EXPORT_SCRIPT } from './externalCity/fmgExport';
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
  openHint: copy('Paste a Magna Urbis code (MU3.…) or link, a watabou city or village generator URL, or an Azgaar burg (CSV row, burg JSON or the export script’s result).',
    'Collez un code (MU3.…) ou un lien Magna Urbis, une URL du générateur de villes ou de villages de watabou, ou un bourg Azgaar (ligne CSV, JSON du bourg ou résultat du script d’export).'),
  openPlaceholder: copy('MU3.… · watabou URL · Azgaar burg', 'MU3.… · URL watabou · bourg Azgaar'),
  fmgScript: copy('Copy the Azgaar export script', 'Copier le script d’export Azgaar'),
  fmgHint: copy('In Azgaar FMG, press F12, paste in the console, then paste the result here.',
    'Dans Azgaar FMG, appuyez sur F12, collez dans la console, puis collez le résultat ici.'),
};
for (const [en, fr] of [
  ['An imported heightmap requires a complete project.', 'Une heightmap importée nécessite un projet complet.'],
  ['Incomplete, corrupt or oversized code.', 'Code incomplet, corrompu ou trop volumineux.'],
  ['Unknown preset.', 'Préréglage inconnu.'],
  ['Calculated data requires a complete project.', 'Les données calculées nécessitent un projet complet.'],
  ['Not recognised: paste an MU3 code, a watabou city/village link or an Azgaar burg (CSV row or export-script JSON).', UNRECOGNISED_INPUT],
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
    <p class="hint">${text.openHint}</p>
    <textarea id="city-code-input" rows="3" spellcheck="false" placeholder="${text.openPlaceholder}"></textarea>
    <div class="dialog-actions"><button id="city-code-fmg-script">${text.fmgScript}</button></div>
    <p class="hint" id="city-code-fmg-hint" aria-live="polite">${text.fmgHint}</p>
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
    setText(error, ''); code = ''; output.value = ''; setText(find('city-code-fmg-hint'), text.fmgHint);
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
  find('city-code-fmg-script').onclick = async () => {
    try { await navigator.clipboard.writeText(FMG_EXPORT_SCRIPT); setText(find('city-code-fmg-hint'), text.copied); }
    catch { input.value = FMG_EXPORT_SCRIPT; input.focus(); input.select(); setText(find('city-code-fmg-hint'), text.clipboard); }
  };
  find('city-code-load').onclick = async () => {
    if (bindings.busy()) return;
    setText(error, '');
    try { await bindings.load(await resolveCityCodeDecor(decodeCityCode(input.value))); dialog.close(); }
    catch (e) { showError(e); }
  };
  return { async restoreFromLocation() {
    const shared = new URLSearchParams(location.hash.slice(1)).get('city');
    if (!shared) return;
    try { await bindings.load(await resolveCityCodeDecor(decodeCityCode(shared))); }
    catch (e) { open(); input.value = shared; showError(e); }
  } };
}
