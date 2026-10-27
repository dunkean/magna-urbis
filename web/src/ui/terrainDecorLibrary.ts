import { type Decor, type DecorEntry } from './decor';
import { readDecorFile } from './decorFile';
import { saveHistory } from './benchHistory';
import { bindGear, gearButton } from './mapGroup';
import { urbanText } from './urbanPanelLocale';

const climates: Record<string, [string,string,string,string,string]> = { temperate: ['tempéré','temperate','温带','templado','temperado'], oceanic: ['océanique','oceanic','海洋性','oceánico','oceânico'], mediterranean: ['méditerranéen','Mediterranean','地中海','mediterráneo','mediterrâneo'], arid: ['aride','arid','干旱','árido','árido'], cold: ['froid','cold','寒冷','frío','frio'], tropical: ['tropical','tropical','热带','tropical','tropical'] };

/** Server catalogue complements the portable local export history.
 * `city`: City Bench maps only (tag kit=city), grouped by size. */
export function createTerrainDecorLibrary(options: { before: Element; city?: boolean; onOpen(decor: Decor): void | Promise<void> }): void {
  const panel = document.createElement('details'); panel.className = 'stage'; panel.id = 'terrainLibrary'; panel.open = true;
  panel.innerHTML = options.city
    ? `<summary>Terrain</summary><div class="stage-controls" data-map-body><div class="map-line"><span class="map-icon" role="img" aria-label="Terrain" title="Terrain">⛰</span><label class="map-field map-grow"><select data-catalogue aria-label="Terrain prégénéré" title="Terrain prégénéré : le choisir le charge"><option value="">Choisir un terrain…</option></select></label>${gearButton()}</div><div class="map-detail" hidden><button type="button" data-load>Charger le terrain</button><label>Importer .decor<input type="file" accept=".decor" data-file></label><small role="status">Une ville au centre ; changez sa taille, sa culture et sa position dans l’inspecteur Ville.</small></div></div>`
    : `<summary>Terrain · charger un existant</summary><div class="stage-controls"><label>Terrain prégénéré<select data-catalogue><option value="">Choisir un terrain…</option></select></label><button type="button" data-load>Charger le terrain</button><label>Importer .decor<input type="file" accept=".decor" data-file></label><small role="status">Les exports conservés sont aussi disponibles dans l’historique.</small></div>`;
  if (options.city) { panel.classList.add('map-group'); bindGear(panel); }
  options.before.before(panel);
  const select = panel.querySelector('select')!, note = panel.querySelector('small')!, button = panel.querySelector<HTMLButtonElement>('[data-load]')!;
  let entries: DecorEntry[] = [];
  let noteState: 'default' | 'empty' | 'unavailable' | 'error' = 'default';
  const localize = (): void => {
    panel.querySelector('summary')!.textContent = options.city ? urbanText(['Terrain','Terrain','地形','Terreno','Terreno']) : urbanText(['Terrain · charger un existant','Terrain · load existing','地形 · 加载现有地形','Terreno · cargar uno existente','Terreno · carregar existente']);
    const placeholder=select.querySelector<HTMLOptionElement>('option[value=""]'); if(placeholder)placeholder.textContent=urbanText(['Choisir un terrain…','Choose terrain…','选择地形…','Elegir terreno…','Escolher terreno…']);
    const terrainLabel=urbanText(['Terrain prégénéré','Pregenerated terrain','预生成地形','Terreno pregenerado','Terreno pré-gerado']); select.setAttribute('aria-label',terrainLabel);
    if(!options.city){const label=select.closest('label')!;if(label.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent=terrainLabel;}
    else {select.title=urbanText(['Terrain prégénéré : le choisir le charge','Pregenerated terrain: selecting it loads it','预生成地形：选择即加载','Terreno pregenerado: selecciónalo para cargarlo','Terreno pré-gerado: selecione para carregar']);}
    button.textContent=urbanText(['Charger le terrain','Load terrain','加载地形','Cargar terreno','Carregar terreno']);
    const fileLabel=panel.querySelector<HTMLInputElement>('[data-file]')!.closest('label')!;if(fileLabel.firstChild?.nodeType===Node.TEXT_NODE)fileLabel.firstChild.textContent=urbanText(['Importer .decor','Import .decor','导入 .decor','Importar .decor','Importar .decor']);
    if(noteState==='default')note.textContent=options.city?urbanText(['Une ville au centre ; changez sa taille, sa culture et sa position dans l’inspecteur Ville.','One city in the centre; change its size, culture and position in the City inspector.','中央有一座城市；可在城市检查器中更改其规模、文化和位置。','Una ciudad en el centro; cambia su tamaño, cultura y posición en el inspector Ciudad.','Uma cidade no centro; altere tamanho, cultura e posição no inspetor Cidade.']):urbanText(['Les exports conservés sont aussi disponibles dans l’historique.','Saved exports are also available in history.','已保存的导出文件也可在历史记录中找到。','Las exportaciones guardadas también están disponibles en el historial.','As exportações salvas também estão disponíveis no histórico.']);
    if(noteState==='empty')note.textContent=urbanText(['Aucune carte de ville : générez-les avec node scripts/export_decors.mjs --set city.','No city maps: generate them with node scripts/export_decors.mjs --set city.','没有城市地图：请使用 node scripts/export_decors.mjs --set city 生成。','No hay mapas de ciudad: genéralos con node scripts/export_decors.mjs --set city.','Nenhum mapa de cidade: gere com node scripts/export_decors.mjs --set city.']);
    if(noteState==='unavailable')note.textContent=urbanText(['Catalogue serveur indisponible. Importez un fichier .decor ou chargez un export de l’historique.','Server catalogue unavailable. Import a .decor file or load an export from history.','服务器目录不可用。请导入 .decor 文件或从历史记录加载导出文件。','Catálogo del servidor no disponible. Importa un archivo .decor o carga una exportación del historial.','Catálogo do servidor indisponível. Importe um arquivo .decor ou carregue uma exportação do histórico.']);
    for(const group of Array.from(select.querySelectorAll('optgroup'))){group.label=group.dataset.size==='small'?urbanText(['Petite carte · 4 km · 5 000 hab. au départ','Small map · 4 km · initial population 5,000','小地图 · 4 公里 · 初始人口 5,000','Mapa pequeño · 4 km · población inicial 5.000','Mapa pequeno · 4 km · população inicial 5.000']):urbanText(['Grande carte · 16 km · 100 000 hab. au départ','Large map · 16 km · initial population 100,000','大地图 · 16 公里 · 初始人口 100,000','Mapa grande · 16 km · población inicial 100.000','Mapa grande · 16 km · população inicial 100.000']);}
    if(options.city)for(const option of Array.from(select.options)){const entry=entries.find(e=>e.id===option.value);if(entry){const climate=climates[entry.tags.climate];option.textContent=`${entry.label.split(' · ').slice(0,2).join(' · ')} · ${climate?urbanText(climate):entry.tags.climate} · ${entry.tags.culture}`;}}
  };
  const onLocale=():void=>{if(!panel.isConnected){window.removeEventListener('magna-locale-change',onLocale);return;}localize();}; window.addEventListener('magna-locale-change',onLocale);localize();
  const open = async (decor: Decor): Promise<void> => { const saved = await saveHistory(decor, false); await options.onOpen(saved); };
  button.onclick = async () => {
    const entry = entries.find(e => e.id === select.value); if (!entry) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { const response = await fetch(`decors/${entry.file}`); if (!response.ok) throw new Error(urbanText(['Terrain indisponible.','Terrain unavailable.','地形不可用。','Terreno no disponible.','Terreno indisponível.'])); await open(await readDecorFile(await response.blob())); }
    catch (error) { noteState='error'; note.textContent = String(error); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  };
  if (options.city) select.onchange = () => { if (select.value) button.click(); };
  const file = panel.querySelector('input')!;
  file.onchange = async () => { try { if (file.files?.[0]) await open(await readDecorFile(file.files[0])); } catch (error) { noteState='error'; note.textContent = String(error); } file.value = ''; };
  void fetch('decors/index.json').then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    entries = (await response.json()).decors;
    if (!options.city) { select.append(...entries.map(e => new Option(e.label, e.id))); return; }
    entries = entries.filter(e => e.tags.kit === 'city');
    for (const [size, title] of [['small', 'Petite carte · 4 km · 5 000 hab. au départ'], ['large', 'Grande carte · 16 km · 100 000 hab. au départ']]) {
      const group = document.createElement('optgroup'); group.label = title; group.dataset.size=size;
      group.append(...entries.filter(e => e.tags.size === size).map(e => new Option(`${e.label.split(' · ').slice(0, 2).join(' · ')} · ${climates[e.tags.climate] ? urbanText(climates[e.tags.climate]) : e.tags.climate} · ${e.tags.culture}`, e.id)));
      select.append(group);
    }
    // Catalogue maps keep their id once opened: show which one is loaded.
    const loaded = new URLSearchParams(location.search).get('artifact');
    if (loaded && entries.some(e => e.id === loaded)) select.value = loaded;
    if (!entries.length) noteState='empty'; localize();
  }).catch(() => { noteState='unavailable'; localize(); });
}
