// Autosave of the current recipe (settings + manual modifications) and the 2D viewport, so a reload gets the page back.
// Stored as plain JSON in localStorage under one key. The tag is the engine version: any other tag is wiped, no migration.
import type { V2Settings } from './contracts';
import { V2_ENGINE_VERSION } from './cache';
import { validateSettings, validateModifications } from './project';
import { insertHTML, registerMessages, translate } from './i18n';

const KEY = 'magna-urbis.v2.autosave';
const TAG = `recipe:${V2_ENGINE_VERSION}`;
const DELAY_MS = 800;
export interface SavedUi { tab?: string; mode3d?: boolean; camera?: unknown }
export interface SavedRecipe { settings: V2Settings; mods: unknown[]; view?: unknown; ui?: SavedUi }
const DB = 'magna-urbis.v2.autosave', STORE = 'entries';
/** IndexedDB holds the full entry (typed arrays of a heightmap import) when localStorage cannot. Every access is optional. */
function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(undefined);
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => { try { open.result.createObjectStore(STORE); } catch { /* Optional. */ } };
      open.onerror = open.onblocked = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const db = open.result, tx = db.transaction(STORE, mode), req = run(tx.objectStore(STORE));
          let value: T | undefined;
          req.onsuccess = () => { value = req.result; };
          tx.oncomplete = () => { db.close(); resolve(value); };
          tx.onerror = tx.onabort = () => { db.close(); resolve(undefined); };
        } catch { resolve(undefined); }
      };
    } catch { resolve(undefined); }
  });
}
const idbPut = (value: unknown) => idb('readwrite', s => s.put(value, KEY));
const idbGet = () => idb<unknown>('readonly', s => s.get(KEY));
const idbDelete = () => idb('readwrite', s => s.delete(KEY));

let timer: ReturnType<typeof setTimeout> | undefined;
let armed = false;
let source: (() => SavedRecipe | undefined) | undefined;

function write(): void {
  if (!armed || !source) return;
  try {
    const recipe = source();
    if (!recipe) { localStorage.removeItem(KEY); void idbDelete(); return; }
    // A heightmap import holds typed arrays: the full entry goes to IndexedDB (structured clone), localStorage keeps a marker.
    if (recipe.settings.options.importedHeight || recipe.settings.decor) {
      localStorage.setItem(KEY, JSON.stringify({ tag: TAG, idb: true }));
      void idbPut({ tag: TAG, settings: recipe.settings, mods: recipe.mods, view: recipe.view, ui: recipe.ui });
      return;
    }
    void idbDelete();
    localStorage.setItem(KEY, JSON.stringify({ tag: TAG, settings: recipe.settings, mods: recipe.mods, view: recipe.view, ui: recipe.ui }));
  } catch { /* Storage unavailable or full: the app works without it. */ }
}
export function clearAutosave(): void {
  clearTimeout(timer); armed = false;
  try { localStorage.removeItem(KEY); } catch { /* Optional. */ }
  void idbDelete();
}
/** Read the entry and remove it at once: a broken state cannot lock the next reload. Incompatible entries are wiped. */
export async function takeAutosave(): Promise<SavedRecipe | undefined> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); localStorage.removeItem(KEY); } catch { return undefined; }
  if (!raw) return undefined;
  try {
    let value = JSON.parse(raw);
    if (value?.idb && value.tag === TAG) { value = await idbGet(); await idbDelete(); if (!value) return undefined; } // no IndexedDB: start empty
    if (!value || value.tag !== TAG) throw new Error(`tag ${String(value?.tag)} differs from ${TAG}`);
    validateSettings(value.settings); validateModifications(value.mods);
    return { settings: value.settings, mods: value.mods, view: value.view, ui: value.ui };
  } catch (e) { console.info('Autosave discarded:', e instanceof Error ? e.message : e); return undefined; }
}
/** Start saving (after the boot restore succeeded or was skipped). `read` returns the live recipe. */
export function armAutosave(read: () => SavedRecipe | undefined): void {
  source = read; armed = true;
  window.addEventListener('pagehide', write);
  write();
}
export function scheduleAutosave(): void {
  if (!armed) return;
  clearTimeout(timer); timer = setTimeout(write, DELAY_MS);
}
export function saveAutosaveNow(): void { write(); }

registerMessages({ 'New': { en: 'New', fr: 'Nouveau' }, 'Drop the restored state and start from an empty page': { en: 'Drop the restored state and start from an empty page', fr: 'Abandonner l’état restauré et repartir d’une page vide' } });
/** Header button that wipes the autosave and reloads the page without URL state. */
export function mountNewButton(before: HTMLElement): void {
  insertHTML(before, 'beforebegin', `<button id="autosave-new" title="${translate('Drop the restored state and start from an empty page')}">${translate('New')}</button>`);
  document.getElementById('autosave-new')!.onclick = () => { clearAutosave(); location.replace(location.pathname + location.search.replace(/[?&]test=1/, '')); };
}
