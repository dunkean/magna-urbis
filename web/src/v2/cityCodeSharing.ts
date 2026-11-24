import { encodeCityCode, decodeCityCode, cityCodeUrl, cityDebugText, INVALID_CODE, UNRECOGNISED_INPUT, type BlockAddress, type DecodedCityCode } from './cityCode';
import { FMG_EXPORT_SCRIPT } from './externalCity/fmgExport';
import type { V2Settings } from './contracts';
import { insertHTML, setText, setDynamicText, registerMessages, translate } from './i18n';

interface CityCodeBindings {
  getRecipe(): { settings: V2Settings; mods: unknown[] };
  /** Names a saved block edit by its position in the plan on screen. */
  blockAddress: BlockAddress;
  load(recipe: DecodedCityCode): Promise<void>;
  /** Downloads a file of the export dialog. */
  exportFile(format: 'heightmap' | 'binary'): void;
  busy(): boolean;
  toast?(message: string): void;
  /** The recipe was changed in place (pin text or removal). */
  changed?(): void;
}
const BUILD = `${import.meta.env.VITE_BUILD_COMMIT ?? 'local'} ${import.meta.env.VITE_BUILD_DATE ?? 'dev'}`;
const copy = (en: string, fr: string): string => {
  registerMessages({ [en]: { en, fr } });
  return en;
};
const text = {
  share: copy('Share', 'Partager'),
  title: copy('Share a region', 'Partager une région'),
  hint: copy(
    'A 6-character seed, then only what differs from the default: engine, relief, biome, size, coast, parameters, rerolls, simple place edits and pins. Names, drawn coasts, painted relief and other manual edits need the project file.',
    'Une graine de 6 caractères, puis seulement ce qui diffère du défaut : moteur, relief, biome, taille, côte, paramètres, nouveaux tirages, retouches simples des lieux et épingles. Les noms, côtes dessinées, reliefs peints et autres retouches manuelles demandent le fichier de projet.',
  ),
  current: copy('Current city code', 'Code de la ville actuelle'),
  copyDebug: copy('Copy for debug', 'Copier pour le débogage'),
  pins: copy('Pins', 'Épingles'),
  pinText: copy('Pin text (kept in the project, not in the code)', 'Texte de l’épingle (gardé dans le projet, pas dans le code)'),
  removePin: copy('Remove pin', 'Supprimer l’épingle'),
  noPins: copy('No pins yet. Use Drop pin in the map toolbar.', 'Aucune épingle pour l’instant. Utilisez Poser une épingle dans la barre de la carte.'),
  showPin: copy('Show on the map', 'Afficher sur la carte'),
  code: copy('Generation code', 'Code de génération'),
  copyCode: copy('Copy code', 'Copier le code'),
  copyLink: copy('Copy link', 'Copier le lien'),
  open: copy('Open a code or link', 'Ouvrir un code ou un lien'),
  load: copy('Load recipe', 'Charger la recette'),
  close: copy('Close', 'Fermer'),
  size: copy('{count} characters', '{count} caractères'),
  reliefMissing: copy(
    'The imported or hand-drawn relief of this map is not in the code: send its heightmap or the whole project with it.',
    'Le relief importé ou dessiné de cette carte n’est pas dans le code : envoyez avec lui sa heightmap ou le projet complet.',
  ),
  exportHeightmap: copy('Export the heightmap', 'Exporter la heightmap'),
  exportProject: copy('Export the project', 'Exporter le projet'),
  noCode: copy('No code for this recipe.', 'Pas de code pour cette recette.'),
  copied: copy('Copied.', 'Copié.'),
  clipboard: copy('Select and copy the text below.', 'Sélectionnez et copiez le texte ci-dessous.'),
  openHint: copy(
    'Paste a Magna Urbis code or link (or its debug text), a watabou city or village generator URL, or an Azgaar burg (CSV row, burg JSON or the export script’s result).',
    'Collez un code ou un lien Magna Urbis (ou son texte de débogage), une URL du générateur de villes ou de villages de watabou, ou un bourg Azgaar (ligne CSV, JSON du bourg ou résultat du script d’export).',
  ),
  openPlaceholder: copy('magnas… · watabou URL · Azgaar burg', 'magnas… · URL watabou · bourg Azgaar'),
  fmgScript: copy('Copy the Azgaar export script', 'Copier le script d’export Azgaar'),
  fmgHint: copy('In Azgaar FMG, press F12, paste in the console, then paste the result here.', 'Dans Azgaar FMG, appuyez sur F12, collez dans la console, puis collez le résultat ici.'),
};
for (const [en, fr] of [
  [INVALID_CODE, 'Code incomplet ou corrompu.'],
  ['The root seed must be 6 characters of the code alphabet.', 'La graine racine doit compter 6 caractères de l’alphabet du code.'],
  [UNRECOGNISED_INPUT, 'Non reconnu : collez un code Magna Urbis, un lien de ville ou de village watabou, ou un bourg Azgaar (ligne CSV ou JSON du script d’export).'],
] as const)
  registerMessages({ [en]: { en, fr } });

export function mountCityCodeSharing(bindings: CityCodeBindings): { restoreFromLocation(): Promise<void> } {
  const find = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  insertHTML(
    find('import-open'),
    'beforebegin',
    `<span class="city-code-chip" id="city-code-chip"><code id="city-code-current" aria-label="${text.current}"></code><button id="city-code-chip-copy" class="quiet" title="${text.copyCode}" aria-label="${text.copyCode}">⧉</button><button id="city-code-chip-debug" class="quiet" title="${text.copyDebug}" aria-label="${text.copyDebug}">⧉+</button></span><button id="city-code-open">${text.share}</button>`,
  );
  insertHTML(
    find('toast'),
    'beforebegin',
    `<dialog id="city-code-dialog">
    <div class="dialog-head"><h2>${text.title}</h2><button id="city-code-close" aria-label="${text.close}">×</button></div>
    <p class="hint">${text.hint}</p>
    <label class="label" for="city-code-output">${text.code}</label>
    <textarea id="city-code-output" readonly rows="3" spellcheck="false"></textarea>
    <p class="hint" id="city-code-size" aria-live="polite"></p>
    <div id="city-code-relief" hidden><p class="hint">${text.reliefMissing}</p><div class="dialog-actions"><button id="city-code-heightmap">${text.exportHeightmap}</button><button id="city-code-project">${text.exportProject}</button></div></div>
    <div class="dialog-actions"><button id="city-code-copy">${text.copyCode}</button><button id="city-code-link">${text.copyLink}</button><button id="city-code-debug">${text.copyDebug}</button></div>
    <h3>${text.pins}</h3>
    <ol id="city-code-pins" class="city-code-pins"></ol>
    <label class="label" for="city-code-input">${text.open}</label>
    <p class="hint">${text.openHint}</p>
    <textarea id="city-code-input" rows="3" spellcheck="false" placeholder="${text.openPlaceholder}"></textarea>
    <div class="dialog-actions"><button id="city-code-fmg-script">${text.fmgScript}</button></div>
    <p class="hint" id="city-code-fmg-hint" aria-live="polite">${text.fmgHint}</p>
    <p class="warning" id="city-code-error" role="alert"></p>
    <div class="dialog-actions"><button id="city-code-load" class="primary">${text.load}</button></div>
  </dialog>`,
  );
  insertHTML(find('project-file'), 'beforebegin', `<button id="city-code-import">${text.open}</button>`);
  const dialog = find<HTMLDialogElement>('city-code-dialog');
  const output = find<HTMLTextAreaElement>('city-code-output'),
    input = find<HTMLTextAreaElement>('city-code-input');
  const error = find('city-code-error');
  let code = '';
  const encode = () => encodeCityCode(bindings.getRecipe().settings, bindings.blockAddress),
    debugText = () => cityDebugText(bindings.getRecipe().settings, BUILD, bindings.blockAddress);
  const showError = (value: unknown) => setText(error, value instanceof Error ? value.message : String(value));
  const open = () => {
    if (bindings.busy()) return;
    setText(error, '');
    code = '';
    output.value = '';
    setText(find('city-code-fmg-hint'), text.fmgHint);
    try {
      code = encode();
      renderPins();
      output.value = code;
      setDynamicText(find('city-code-size'), () => translate(text.size).replace('{count}', String(code.length)));
    } catch (e) {
      setText(find('city-code-size'), '');
      showError(e);
    }
    find('city-code-relief').hidden = !code.includes('*');
    find<HTMLButtonElement>('city-code-copy').disabled = !code;
    find<HTMLButtonElement>('city-code-link').disabled = !code;
    dialog.showModal();
  };
  find('city-code-open').onclick = open;
  find('city-code-import').onclick = () => {
    find<HTMLDialogElement>('import-dialog').close();
    open();
    input.focus();
  };
  find('city-code-close').onclick = () => dialog.close();
  for (const [id, format] of [['city-code-heightmap', 'heightmap'], ['city-code-project', 'binary']] as const)
    find(id).onclick = () => {
      dialog.close();
      bindings.exportFile(format);
    };
  async function copyValue(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setText(error, '');
      setText(find('city-code-size'), text.copied);
    } catch {
      output.value = value;
      output.focus();
      output.select();
      setText(find('city-code-size'), text.clipboard);
    }
  }
  find('city-code-copy').onclick = () => void copyValue(code);
  find('city-code-debug').onclick = () => void copyValue(debugText());
  // The current code stays visible in the top bar: cheap to encode, refreshed while the recipe changes.
  const chip = find('city-code-current');
  let shown = '';
  const refreshChip = () => {
    let next = '',
      problem = '';
    try {
      next = encode();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    if (next === shown && !problem) return;
    shown = next;
    // The chip stays in the bar: the code, shortened when long, or why this recipe has none.
    chip.textContent = !next ? '—' : next.length > 18 ? `${next.slice(0, 17)}…` : next;
    chip.title = next || `${translate(text.noCode)} ${translate(problem)}`;
    for (const id of ['city-code-chip-copy', 'city-code-chip-debug']) find<HTMLButtonElement>(id).disabled = !next;
  };
  refreshChip();
  // touchRecipe and syncControls (page/settings.ts) announce every recipe change, project load included.
  window.addEventListener('v2-recipe-change', refreshChip);
  const copyChip = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      bindings.toast?.(text.copied);
    } catch {
      open();
    }
  };
  find('city-code-chip-copy').onclick = () => void copyChip(shown);
  find('city-code-chip-debug').onclick = () => void copyChip(debugText());
  function renderPins(): void {
    const list = find('city-code-pins'),
      pins = bindings.getRecipe().settings.pins ?? [];
    list.replaceChildren();
    if (!pins.length) {
      const empty = document.createElement('li');
      setText(empty, text.noPins);
      list.append(empty);
    }
    pins.forEach((pin, index) => {
      const item = document.createElement('li'),
        label = document.createElement('input'),
        remove = document.createElement('button');
      const locate = document.createElement('button');
      locate.className = 'quiet';
      locate.textContent = `#${index + 1} x=${Math.round(pin.x)} y=${Math.round(pin.y)}`;
      locate.setAttribute('aria-label', translate(text.showPin));
      locate.title = translate(text.showPin);
      locate.onclick = () => {
        dialog.close();
        window.dispatchEvent(new CustomEvent('v2-pin-focus', { detail: index }));
      };
      item.append(locate, ' ', label, remove);
      label.value = pin.text ?? '';
      label.maxLength = 80;
      label.setAttribute('aria-label', translate(text.pinText));
      label.placeholder = translate(text.pinText);
      label.onchange = () => {
        if (label.value.trim()) pin.text = label.value.trim();
        else delete pin.text;
        bindings.changed?.();
      };
      remove.textContent = '×';
      remove.setAttribute('aria-label', translate(text.removePin));
      remove.onclick = () => {
        pins.splice(index, 1);
        if (!pins.length) delete bindings.getRecipe().settings.pins;
        bindings.changed?.();
        code = encode();
        output.value = code;
        renderPins();
      };
      list.append(item);
    });
  }
  find('city-code-link').onclick = () => void copyValue(cityCodeUrl(code, location.href));
  find('city-code-fmg-script').onclick = async () => {
    try {
      await navigator.clipboard.writeText(FMG_EXPORT_SCRIPT);
      setText(find('city-code-fmg-hint'), text.copied);
    } catch {
      input.value = FMG_EXPORT_SCRIPT;
      input.focus();
      input.select();
      setText(find('city-code-fmg-hint'), text.clipboard);
    }
  };
  find('city-code-load').onclick = async () => {
    if (bindings.busy()) return;
    setText(error, '');
    try {
      await bindings.load(decodeCityCode(input.value));
      dialog.close();
    } catch (e) {
      showError(e);
    }
  };
  return {
    async restoreFromLocation() {
      const shared = new URLSearchParams(location.hash.slice(1)).get('city');
      if (!shared) return;
      try {
        await bindings.load(decodeCityCode(shared));
      } catch (e) {
        open();
        input.value = shared;
        showError(e);
      }
    },
  };
}
