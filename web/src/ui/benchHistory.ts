import { decodeDecorAsync, decorEntry, encodeDecorAsync, type Decor, type DecorEntry } from './decor';
import { downloadDecorFile, readDecorFile } from './decorFile';
import { placeSketchInFragment, sketchQuery } from './terrainSketchSharing';
import { savedLocale, type Locale } from './shellLocale';

type HistoryWords = readonly [string, string, string, string, string];
const historyLanguages: Locale[] = ['fr', 'en', 'zh', 'es', 'pt'];
function historyText(words: HistoryWords): string {
  return words[historyLanguages.indexOf(typeof window === 'undefined' ? 'fr' : savedLocale())];
}
const historyWords = {
  title: ['Historique des exports', 'Export history', '导出历史', 'Historial de exportaciones', 'Histórico de exportações'],
  saved: ['Carte conservée', 'Saved map', '已保存的地图', 'Mapa guardado', 'Mapa salvo'],
  choose: ['Choisir un export…', 'Choose an export…', '选择导出记录…', 'Elegir una exportación…', 'Escolher uma exportação…'],
  open: ['Charger', 'Load', '加载', 'Cargar', 'Carregar'],
  download: ['Exporter .decor', 'Export .decor', '导出 .decor', 'Exportar .decor', 'Exportar .decor'],
  upload: ['Importer .decor', 'Import .decor', '导入 .decor', 'Importar .decor', 'Importar .decor'],
  hint: ['Historique conservé dans ce navigateur. Le fichier .decor permet le partage entre machines.', 'History is stored in this browser. A .decor file can be shared between machines.', '历史记录保存在此浏览器中。.decor 文件可在不同设备之间共享。', 'El historial se guarda en este navegador. El archivo .decor permite compartir entre equipos.', 'O histórico é salvo neste navegador. O arquivo .decor permite compartilhar entre máquinas.'],
  denied: ['Historique indisponible : stockage du navigateur refusé.', 'History unavailable: browser storage was denied.', '历史记录不可用：浏览器存储被拒绝。', 'Historial no disponible: se rechazó el almacenamiento del navegador.', 'Histórico indisponível: o armazenamento do navegador foi recusado.'],
  failed: ['Échec du stockage de l’export.', 'Could not store the export.', '无法保存导出记录。', 'No se pudo guardar la exportación.', 'Não foi possível salvar a exportação.'],
  unavailable: ['Historique indisponible.', 'History unavailable.', '历史记录不可用。', 'Historial no disponible.', 'Histórico indisponível.'],
  missing: ['Export absent de ce navigateur. Importez le fichier .decor partagé.', 'This export is not in this browser. Import the shared .decor file.', '此浏览器中没有该导出记录。请导入共享的 .decor 文件。', 'Esta exportación no está en este navegador. Importa el archivo .decor compartido.', 'Esta exportação não está neste navegador. Importe o arquivo .decor compartilhado.'],
  missingShort: ['Export absent de ce navigateur.', 'This export is not in this browser.', '此浏览器中没有该导出记录。', 'Esta exportación no está en este navegador.', 'Esta exportação não está neste navegador.'],
} satisfies { [key: string]: HistoryWords };

export interface HistoryEntry { entry: DecorEntry; created: string; stage: string }
interface Record extends HistoryEntry { bytes: Uint8Array }
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('magna-bench-exports', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('exports', { keyPath: 'entry.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(historyText(historyWords.denied)));
  });
}
async function access<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('exports', mode), request = run(transaction.objectStore('exports'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error(historyText(historyWords.failed)));
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
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error(historyText(historyWords.unavailable)));
  });
}
export async function readHistory(id: string): Promise<Decor> {
  const record = await access<Record | undefined>('readonly', store => store.get(id));
  if (!record) throw new Error(historyText(historyWords.missing));
  return decodeDecorAsync(record.bytes);
}
/** Local history references become a complete portable file on download. The
 * saver enters before the DB lookup resolves, preserving picker activation. */
export function downloadHistory(id: string, fallback?: Decor): Promise<void> {
  const decor = access<Record | undefined>('readonly', store => store.get(id)).then(record => {
    if (record) return decodeDecorAsync(record.bytes);
    if (fallback) return fallback;
    throw new Error(historyText(historyWords.missingShort));
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
  panel.innerHTML = '<summary></summary><div class="stage-controls"><label><span data-saved></span><select data-history></select></label><div class="settlement-actions"><button data-open></button><button data-download></button><label><span data-upload></span><input data-import type="file" accept=".decor" multiple></label></div><small data-note role="status"></small></div>';
  options.before.before(panel);
  const select = panel.querySelector('select')!, note = panel.querySelector<HTMLElement>('[data-note]')!;
  let items: HistoryEntry[] = [], defaultNote = true;
  const error = (e: unknown): void => { defaultNote = false; note.textContent = e instanceof Error ? e.message : String(e); };
  function paint(): void {
    const selected = select.value, locale = typeof window === 'undefined' ? 'fr' : savedLocale();
    panel.querySelector('summary')!.textContent = historyText(historyWords.title);
    panel.querySelector('[data-saved]')!.textContent = historyText(historyWords.saved);
    panel.querySelector('[data-open]')!.textContent = historyText(historyWords.open);
    panel.querySelector('[data-download]')!.textContent = historyText(historyWords.download);
    panel.querySelector('[data-upload]')!.textContent = historyText(historyWords.upload);
    if (defaultNote) note.textContent = historyText(historyWords.hint);
    const dateLocale: { [key in Locale]: string } = { fr: 'fr-FR', en: 'en', zh: 'zh-CN', es: 'es', pt: 'pt' };
    select.replaceChildren(new Option(historyText(historyWords.choose), ''), ...items.map(({ entry, stage, created }) => new Option(`${stage} · ${entry.label} · ${new Date(created).toLocaleString(dateLocale[locale])}`, entry.id)));
    select.value = selected;
  }
  async function refresh(id?: string): Promise<void> {
    try {
      const selected = id ?? select.value;
      items = await listHistory(); paint(); select.value = selected;
    } catch (e) { error(e); }
  }
  window.addEventListener('magna-locale-change', paint);
  paint();
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
  return { refresh, note: (text: string): void => { defaultNote = false; note.textContent = text; } };
}
import { applyExecutionProfile } from './executionProfile';
