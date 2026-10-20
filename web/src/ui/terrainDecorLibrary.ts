import { decodeDecor, type Decor, type DecorEntry } from './decor';
import { saveHistory } from './benchHistory';

/** Server catalogue complements the portable local export history. */
export function createTerrainDecorLibrary(options: { before: Element; onOpen(decor: Decor): void | Promise<void> }): void {
  const panel = document.createElement('details'); panel.className = 'stage'; panel.id = 'terrainLibrary'; panel.open = true;
  panel.innerHTML = '<summary>Terrain · charger un existant</summary><div class="stage-controls"><label>Terrain prégénéré<select data-catalogue><option value="">Choisir un terrain…</option></select></label><button type="button" data-load>Charger le terrain</button><label>Importer .decor<input type="file" accept=".decor" data-file></label><small role="status">Les exports conservés sont aussi disponibles dans l’historique.</small></div>';
  options.before.before(panel);
  const select = panel.querySelector('select')!, note = panel.querySelector('small')!, button = panel.querySelector('button')!;
  let entries: DecorEntry[] = [];
  const open = async (decor: Decor): Promise<void> => { const saved = await saveHistory(decor, false); await options.onOpen(saved); };
  button.onclick = async () => {
    const entry = entries.find(e => e.id === select.value); if (!entry) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { const response = await fetch(`decors/${entry.file}`); if (!response.ok) throw new Error('Terrain indisponible.'); await open(decodeDecor(new Uint8Array(await response.arrayBuffer()))); }
    catch (error) { note.textContent = String(error); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  };
  const file = panel.querySelector('input')!;
  file.onchange = async () => { try { if (file.files?.[0]) await open(decodeDecor(new Uint8Array(await file.files[0].arrayBuffer()))); } catch (error) { note.textContent = String(error); } file.value = ''; };
  void fetch('decors/index.json').then(async response => { if (!response.ok) return; entries = (await response.json()).decors; select.append(...entries.map(e => new Option(e.label, e.id))); }).catch(() => { note.textContent = 'Catalogue serveur indisponible. Importez un fichier .decor ou chargez un export de l’historique.'; });
}
