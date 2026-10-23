import { type Decor, type DecorEntry } from './decor';
import { readDecorFile } from './decorFile';
import { saveHistory } from './benchHistory';

const climates: Record<string, string> = { temperate: 'tempéré', oceanic: 'océanique', mediterranean: 'méditerranéen', arid: 'aride', cold: 'froid', tropical: 'tropical' };

/** Server catalogue complements the portable local export history.
 * `city`: City Bench maps only (tag kit=city), grouped by size. */
export function createTerrainDecorLibrary(options: { before: Element; city?: boolean; onOpen(decor: Decor): void | Promise<void> }): void {
  const panel = document.createElement('details'); panel.className = 'stage'; panel.id = 'terrainLibrary'; panel.open = true;
  panel.innerHTML = `<summary>${options.city ? 'Carte · environnement de la ville' : 'Terrain · charger un existant'}</summary><div class="stage-controls"><label>Terrain prégénéré<select data-catalogue><option value="">Choisir un terrain…</option></select></label><button type="button" data-load>Charger le terrain</button><label>Importer .decor<input type="file" accept=".decor" data-file></label><small role="status">${options.city ? 'Une ville au centre ; changez sa taille, sa culture et sa position dans « 1 · Ville ».' : 'Les exports conservés sont aussi disponibles dans l’historique.'}</small></div>`;
  options.before.before(panel);
  const select = panel.querySelector('select')!, note = panel.querySelector('small')!, button = panel.querySelector('button')!;
  let entries: DecorEntry[] = [];
  const open = async (decor: Decor): Promise<void> => { const saved = await saveHistory(decor, false); await options.onOpen(saved); };
  button.onclick = async () => {
    const entry = entries.find(e => e.id === select.value); if (!entry) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { const response = await fetch(`decors/${entry.file}`); if (!response.ok) throw new Error('Terrain indisponible.'); await open(await readDecorFile(await response.blob())); }
    catch (error) { note.textContent = String(error); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  };
  if (options.city) select.onchange = () => { if (select.value) button.click(); };
  const file = panel.querySelector('input')!;
  file.onchange = async () => { try { if (file.files?.[0]) await open(await readDecorFile(file.files[0])); } catch (error) { note.textContent = String(error); } file.value = ''; };
  void fetch('decors/index.json').then(async response => {
    if (!response.ok) return;
    entries = (await response.json()).decors;
    if (!options.city) { select.append(...entries.map(e => new Option(e.label, e.id))); return; }
    entries = entries.filter(e => e.tags.kit === 'city');
    for (const [size, title] of [['small', 'Petite ville · jusqu’à 10 000 hab. · 4 km'], ['large', 'Grande ville · jusqu’à 400 000 hab. · 16 km']]) {
      const group = document.createElement('optgroup'); group.label = title;
      group.append(...entries.filter(e => e.tags.size === size).map(e => new Option(`${e.label.split(' · ').slice(0, 2).join(' · ')} · ${climates[e.tags.climate] ?? e.tags.climate} · ${e.tags.culture}`, e.id)));
      select.append(group);
    }
    // Catalogue maps keep their id once opened: show which one is loaded.
    const loaded = new URLSearchParams(location.search).get('artifact');
    if (loaded && entries.some(e => e.id === loaded)) select.value = loaded;
    if (!entries.length) note.textContent = 'Aucune carte de ville : générez-les avec node scripts/export_decors.mjs --set city.';
  }).catch(() => { note.textContent = 'Catalogue serveur indisponible. Importez un fichier .decor ou chargez un export de l’historique.'; });
}
