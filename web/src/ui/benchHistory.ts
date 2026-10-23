import { decodeDecorAsync, decorEntry, encodeDecorAsync, type Decor, type DecorEntry } from './decor';
import { downloadDecorFile, readDecorFile } from './decorFile';
import { placeSketchInFragment, sketchQuery } from './terrainSketchSharing';

export interface HistoryEntry { entry: DecorEntry; created: string; stage: string }
interface Record extends HistoryEntry { bytes: Uint8Array }
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('magna-bench-exports', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('exports', { keyPath: 'entry.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Historique indisponible : stockage du navigateur refusé.'));
  });
}
async function access<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('exports', mode), request = run(transaction.objectStore('exports'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Échec du stockage de l’export.'));
  });
}
export async function listHistory(): Promise<HistoryEntry[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('exports', 'readonly'), request = transaction.objectStore('exports').openCursor();
    const entries: HistoryEntry[] = [];
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      const { entry, created, stage } = cursor.value as Record;
      entries.push({ entry, created, stage }); cursor.continue();
    };
    transaction.oncomplete = () => resolve(entries.sort((a, b) => b.created.localeCompare(a.created)));
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Historique indisponible.'));
  });
}
export async function readHistory(id: string): Promise<Decor> {
  const record = await access<Record | undefined>('readonly', store => store.get(id));
  if (!record) throw new Error('Export absent de ce navigateur. Importez le fichier .decor partagé.');
  return decodeDecorAsync(record.bytes);
}
/** Local history references become a complete portable file on download. The
 * saver enters before the DB lookup resolves, preserving picker activation. */
export function downloadHistory(id: string, fallback?: Decor): Promise<void> {
  const decor = access<Record | undefined>('readonly', store => store.get(id)).then(record => {
    if (record) return decodeDecorAsync(record.bytes);
    if (fallback) return fallback;
    throw new Error('Export absent de ce navigateur.');
  });
  return downloadDecorFile(decor, `${id}.decor`);
}
/** sourceBytes may be reused only for an unmodified decor decoded from those bytes. */
export async function saveHistory(decor: Decor, fresh = true, sourceBytes?: Uint8Array): Promise<Decor> {
  let bytes = sourceBytes;
  if (!fresh) {
    const existing = await access<Record | undefined>('readonly', store => store.get(decor.meta.id));
    if (existing) {
      const compared = bytes ??= await encodeDecorAsync(decor, { localReferences: true });
      if (existing.bytes.length === compared.length && existing.bytes.every((value, i) => value === compared[i])) return decor;
      fresh = true;
    }
  }
  const meta = { ...decor.meta, ...(fresh ? { id: `export-${crypto.randomUUID()}`, created: new Date().toISOString() } : {}) };
  const saved = { ...decor, meta }, record: Record = { bytes: !fresh && bytes ? bytes : await encodeDecorAsync(saved, { localReferences: true }), entry: decorEntry(meta, `${meta.id}.decor`), created: meta.created, stage: meta.pipeline?.stage ?? 'terrain' };
  await access('readwrite', store => store.put(record));
  return saved;
}

/** Links identify an immutable local export; the .decor file is the portable payload. */
export function openBench(stage: 'terrain' | 'settlements' | 'city' | 'urban' | 'houses', params: URLSearchParams): void {
  const runtimeUrl = applyExecutionProfile(new URL(`?${params}`, location.href));
  params = runtimeUrl.searchParams;
  if (window.parent !== window) {
    window.parent.postMessage({ channel: 'magna-bench-pipeline', stage, query: params.toString() }, location.protocol === 'file:' ? '*' : location.origin);
  } else {
    const page = stage === 'urban' ? 'urbanbench.html' : stage === 'houses' ? 'housebench.html' : stage === 'city' ? 'citybench.html' : 'terrainbench.html';
    if (stage === 'settlements') params.set('stage', stage);
    // A standalone atelier stays standalone instead of entering the shell.
    if (new URLSearchParams(location.search).get('standalone') === '1') params.set('standalone', '1');
    const url = new URL(page, location.href); url.search = params.toString();
    location.href = page === 'terrainbench.html' ? placeSketchInFragment(url).href : url.href;
  }
}

export function syncBenchUrl(): void {
  if (window.parent !== window) window.parent.postMessage({ channel: 'magna-bench-url', query: sketchQuery(new URL(location.href)).toString() }, location.protocol === 'file:' ? '*' : location.origin);
}

export function createHistoryPanel(options: { before: Element; onOpen(decor: Decor): void | Promise<void>; current(): Decor | undefined }) {
  const panel = document.createElement('details'); panel.className = 'stage'; panel.id = 'benchHistory'; panel.open = true;
  panel.innerHTML = '<summary>Historique des exports</summary><div class="stage-controls"><label>Carte conservée<select data-history><option value="">Choisir un export…</option></select></label><div class="settlement-actions"><button data-open>Charger</button><button data-download>Exporter .decor</button><label>Importer .decor<input data-import type="file" accept=".decor" multiple></label></div><small data-note role="status">Historique conservé dans ce navigateur. Le fichier .decor permet le partage entre machines.</small></div>';
  options.before.before(panel);
  const select = panel.querySelector('select')!, note = panel.querySelector<HTMLElement>('[data-note]')!;
  const error = (e: unknown): void => { note.textContent = e instanceof Error ? e.message : String(e); };
  async function refresh(id?: string): Promise<void> {
    try {
      const selected = id ?? select.value, items = await listHistory();
      select.replaceChildren(new Option('Choisir un export…', ''), ...items.map(({ entry, stage, created }) => new Option(`${stage} · ${entry.label} · ${new Date(created).toLocaleString('fr-FR')}`, entry.id)));
      select.value = selected;
    } catch (e) { error(e); }
  }
  panel.querySelector<HTMLButtonElement>('[data-open]')!.onclick = () => { if (select.value) void readHistory(select.value).then(options.onOpen).catch(error); };
  panel.querySelector<HTMLButtonElement>('[data-download]')!.onclick = () => {
    const current = options.current();
    if (current) void downloadHistory(current.meta.id, current).catch(error);
    else if (select.value) void downloadHistory(select.value).catch(error);
  };
  const input = panel.querySelector<HTMLInputElement>('[data-import]')!;
  input.onchange = async () => {
    try {
      let last: Decor | undefined;
      for (const file of Array.from(input.files ?? [])) {
        last = await saveHistory(await readDecorFile(file), false);
      }
      await refresh(last?.meta.id); if (last) await options.onOpen(last);
    } catch (e) { error(e); }
    input.value = '';
  };
  panel.addEventListener('toggle', () => { if (panel.open) void refresh(); });
  window.addEventListener('focus', () => void refresh());
  void refresh();
  return { refresh, note: (text: string): void => { note.textContent = text; } };
}
import { applyExecutionProfile } from './executionProfile';
