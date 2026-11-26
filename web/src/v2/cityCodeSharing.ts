import { cityDebugText, codeBaseline, decodeCityCode, encodeCityCode, INVALID_CODE, UNRECOGNISED_INPUT, type BlockAddress, type DecodedCityCode } from './cityCode';
import { SHARE_CODE_TOO_LARGE } from './cityCodeExtras';
import { parseAzgaarBurg } from './externalCity/azgaar';
import { applyExternalCity } from './externalCity/apply';
import { FMG_EXPORT_SCRIPT } from './externalCity/fmgExport';
import type { V2Settings } from './contracts';
import { insertHTML, setText, registerMessages, translate } from './i18n';

interface CityCodeBindings {
  getSettings(): V2Settings;
  /** Names a saved block edit by its position in the plan on screen. */
  blockAddress: BlockAddress;
  load(recipe: DecodedCityCode, source?: 'Azgaar FMG'): Promise<void>;
  busy(): boolean;
  toast?(message: string): void;
}
const BUILD = `${import.meta.env.VITE_BUILD_COMMIT ?? 'local'} ${import.meta.env.VITE_BUILD_DATE ?? 'dev'}`;
const copy = (en: string, fr: string): string => {
  registerMessages({ [en]: { en, fr } });
  return en;
};
const text = {
  current: copy('Current city code', 'Code de la ville actuelle'),
  copyDebug: copy('Copy for debug', 'Copier pour le débogage'),
  copyCode: copy('Copy code', 'Copier le code'),
  open: copy('Open a code or link', 'Ouvrir un code ou un lien'),
  openHint: copy('Paste a Magna Urbis code, link or debug text, or a watabou city or village link.', 'Collez un code, un lien ou un texte de débogage Magna Urbis, ou un lien vers une ville ou un village watabou.'),
  load: copy('Load recipe', 'Charger la recette'),
  close: copy('Close', 'Fermer'),
  noCode: copy('No code for this recipe.', 'Pas de code pour cette recette.'),
  copied: copy('Copied.', 'Copié.'),
  clipboard: copy('Select and copy the text below.', 'Sélectionnez et copiez le texte ci-dessous.'),
  fmgScript: copy('Copy the Azgaar export script', 'Copier le script d’export Azgaar'),
  fmgShowScript: copy('View script', 'Voir le script'),
  fmgRun: copy('Open your map in Azgaar FMG. Open the browser console (F12), paste the script and press Enter.', 'Ouvrez votre carte dans Azgaar FMG. Ouvrez la console du navigateur (F12), collez le script et appuyez sur Entrée.'),
  fmgChoose: copy('Enter the burg’s name or ID. The script copies the JSON or prints it in the console for you to copy.', 'Saisissez le nom ou l’identifiant du bourg. Le script copie le JSON ou l’affiche dans la console pour que vous puissiez le copier.'),
  fmgPaste: copy('Paste the exported JSON here. A burg JSON object or a single row from the Azgaar Burgs CSV also works.', 'Collez ici le JSON exporté. Un objet JSON du bourg ou une seule ligne du CSV des bourgs Azgaar fonctionne aussi.'),
  fmgInput: copy('Azgaar burg data', 'Données du bourg Azgaar'),
  fmgImport: copy('Import & generate', 'Importer et générer'),
  fmgError: copy('Azgaar burg data was not recognized. Paste the script’s JSON or a single burg CSV row.', 'Données Azgaar non reconnues. Collez le JSON du script ou une seule ligne du CSV des bourgs.'),
};
copy(INVALID_CODE, 'Code incomplet ou corrompu.');
copy(SHARE_CODE_TOO_LARGE, 'Ces modifications sont trop volumineuses pour un code de partage. Exportez le projet pour les partager.');
copy('The root seed must be 6 characters of the code alphabet.', 'La graine racine doit compter 6 caractères de l’alphabet du code.');
copy(UNRECOGNISED_INPUT, 'Non reconnu : collez un code ou un lien Magna Urbis, un lien watabou, ou utilisez la fenêtre Azgaar FMG pour importer un bourg.');

export function mountCityCodeSharing(bindings: CityCodeBindings): { restoreFromLocation(): Promise<void> } {
  const find = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  insertHTML(
    find('import-open'),
    'beforebegin',
    `<span class="city-code-chip" id="city-code-chip"><code id="city-code-current" aria-label="${text.current}"></code><button id="city-code-chip-copy" class="quiet" title="${text.copyCode}" aria-label="${text.copyCode}">⧉</button><button id="city-code-chip-debug" class="quiet" title="${text.copyDebug}" aria-label="${text.copyDebug}">⧉+</button></span><button id="city-code-open" type="button" class="primary" aria-haspopup="dialog" aria-controls="fmg-dialog">Azgaar FMG</button>`,
  );
  insertHTML(
    find('toast'),
    'beforebegin',
    `<dialog id="fmg-dialog" aria-labelledby="fmg-title">
      <div class="dialog-head"><h2 id="fmg-title">Azgaar FMG</h2><button id="fmg-close" type="button" aria-label="${text.close}">×</button></div>
      <ol class="hint"><li>${text.fmgRun}</li><li>${text.fmgChoose}</li></ol>
      <div class="dialog-actions"><button id="fmg-copy-script" type="button">${text.fmgScript}</button></div>
      <details id="fmg-script-details">
        <summary>${text.fmgShowScript}</summary>
        <textarea id="fmg-script" aria-labelledby="fmg-copy-script" readonly rows="5" spellcheck="false"></textarea>
      </details>
      <p id="fmg-copy-status" class="hint" role="status"></p>
      <label class="label" for="fmg-input">${text.fmgInput}</label>
      <p id="fmg-input-hint" class="hint">${text.fmgPaste}</p>
      <textarea id="fmg-input" aria-describedby="fmg-input-hint" rows="3" spellcheck="false"></textarea>
      <p class="warning" id="fmg-error" role="alert"></p>
      <div class="dialog-actions"><button id="fmg-import" class="primary" type="button">${text.fmgImport}</button></div>
    </dialog>
    <dialog id="city-code-dialog" aria-labelledby="city-code-title">
      <div class="dialog-head"><h2 id="city-code-title">${text.open}</h2><button id="city-code-close" type="button" aria-label="${text.close}">×</button></div>
      <p id="city-code-hint" class="hint">${text.openHint}</p>
      <textarea id="city-code-input" aria-labelledby="city-code-title" aria-describedby="city-code-hint" rows="3" spellcheck="false"></textarea>
      <p class="warning" id="city-code-error" role="alert"></p>
      <div class="dialog-actions"><button id="city-code-load" class="primary" type="button">${text.load}</button></div>
    </dialog>
    <dialog id="city-code-copy-dialog" aria-labelledby="city-code-copy-title">
      <div class="dialog-head"><h2 id="city-code-copy-title">${text.copyCode}</h2><button id="city-code-copy-close" type="button" aria-label="${text.close}">×</button></div>
      <p id="city-code-copy-hint" class="hint">${text.clipboard}</p>
      <textarea id="city-code-copy-value" aria-labelledby="city-code-copy-title" aria-describedby="city-code-copy-hint" readonly rows="3" spellcheck="false"></textarea>
    </dialog>`,
  );
  insertHTML(find('project-file'), 'beforebegin', `<button id="city-code-import" type="button" aria-haspopup="dialog" aria-controls="city-code-dialog">${text.open}</button>`);
  const codeDialog = find<HTMLDialogElement>('city-code-dialog');
  const codeInput = find<HTMLTextAreaElement>('city-code-input');
  const codeError = find('city-code-error');
  const fmgDialog = find<HTMLDialogElement>('fmg-dialog');
  const fmgInput = find<HTMLTextAreaElement>('fmg-input');
  const fmgError = find('fmg-error');
  const script = find<HTMLTextAreaElement>('fmg-script');
  const scriptStatus = find('fmg-copy-status');
  script.value = FMG_EXPORT_SCRIPT;

  function openCode() {
    setText(codeError, '');
    codeDialog.showModal();
    codeInput.focus();
  }
  find('city-code-import').onclick = () => {
    if (bindings.busy()) return;
    find<HTMLDialogElement>('import-dialog').close();
    openCode();
  };
  find('city-code-close').onclick = () => codeDialog.close();
  find('city-code-open').onclick = () => {
    if (bindings.busy()) return;
    setText(fmgError, '');
    setText(scriptStatus, '');
    fmgDialog.showModal();
  };
  find('fmg-close').onclick = () => fmgDialog.close();
  find('fmg-copy-script').onclick = async () => {
    try {
      await navigator.clipboard.writeText(FMG_EXPORT_SCRIPT);
      setText(scriptStatus, text.copied);
    } catch {
      find<HTMLDetailsElement>('fmg-script-details').open = true;
      script.focus();
      script.select();
      setText(scriptStatus, text.clipboard);
    }
  };

  function bindLoad(button: string, dialog: HTMLDialogElement, input: HTMLTextAreaElement, error: HTMLElement, load: (value: string) => Promise<void>) {
    input.addEventListener('input', () => setText(error, ''));
    find(button).onclick = async () => {
      if (bindings.busy()) return;
      setText(error, '');
      try {
        await load(input.value);
        dialog.close();
      } catch (e) {
        setText(error, e instanceof Error ? e.message : String(e));
      }
    };
  }
  bindLoad('city-code-load', codeDialog, codeInput, codeError, value => bindings.load(decodeCityCode(value)));
  bindLoad('fmg-import', fmgDialog, fmgInput, fmgError, value => {
    const hints = parseAzgaarBurg(value);
    if (!hints) throw new Error(text.fmgError);
    return bindings.load({ settings: applyExternalCity(hints, codeBaseline()), mods: [] }, 'Azgaar FMG');
  });

  // Refresh the visible code while the recipe changes, including project loads.
  const chip = find('city-code-current');
  let shown = '';
  const refreshChip = () => {
    let next = '',
      problem = '';
    try {
      next = encodeCityCode(bindings.getSettings(), bindings.blockAddress);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    if (next === shown && !problem) return;
    shown = next;
    chip.textContent = !next ? '—' : next.length > 18 ? `${next.slice(0, 17)}…` : next;
    chip.title = next || `${translate(text.noCode)} ${translate(problem)}`;
    for (const id of ['city-code-chip-copy', 'city-code-chip-debug']) find<HTMLButtonElement>(id).disabled = !next;
  };
  refreshChip();
  window.addEventListener('v2-recipe-change', refreshChip);
  const copyDialog = find<HTMLDialogElement>('city-code-copy-dialog');
  const copyInput = find<HTMLTextAreaElement>('city-code-copy-value');
  find('city-code-copy-close').onclick = () => copyDialog.close();
  const copyChip = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      bindings.toast?.(text.copied);
    } catch {
      copyInput.value = value;
      copyDialog.showModal();
      copyInput.focus();
      copyInput.select();
    }
  };
  find('city-code-chip-copy').onclick = () => void copyChip(shown);
  find('city-code-chip-debug').onclick = () => void copyChip(cityDebugText(bindings.getSettings(), BUILD, bindings.blockAddress));
  return {
    async restoreFromLocation() {
      const shared = new URLSearchParams(location.hash.slice(1)).get('city');
      if (!shared) return;
      try {
        await bindings.load(decodeCityCode(shared));
      } catch (e) {
        openCode();
        codeInput.value = shared;
        setText(codeError, e instanceof Error ? e.message : String(e));
      }
    },
  };
}
