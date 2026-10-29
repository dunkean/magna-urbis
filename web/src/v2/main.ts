import { setHTML, insertHTML, setText, setUserText, setDynamicText, bindTree, translate, getLanguage, setLanguage, onLanguageChange, initializeLanguage, numberLocale, nameHTML, numberHTML, registerMessages } from './i18n';
import './ui.css';
import logo from '../ui/assets/logo-magna-urbis.png';
import { CULTURE_LABELS, SITE_ARCHETYPES, type Options } from '../gen/options';
import { STYLE_LIST, type MapStyle } from '../render/styles';
import { isMapStyle } from '../render/styles';
import { TERRAIN_STYLE_LIST, type TerrainStyle } from '../render/terrainStyle';
import { mountRenderControls } from './renderControls';
import { appearanceDisplayOptions } from './appearance';
import type { World, UrbanBuilding } from '../gen/types';
import { screenToWorld } from '../render/view';
import { EXPORT_LAYER_NAMES, type ExportLayers } from '../render/exportLayers';
import { chooseExportCrop } from '../ui/exportCrop';
import { exportPng } from '../ui/pngExport';
import { readHeightmap } from '../ui/heightmap';
import { StudioClient, type Action } from './client';
import { defaultSettings, adaptedExtent } from './settings';
import { validateSettings } from './project';
import type { V2Settings, V2Progress, V2TownStage } from './contracts';
import { type QuarterOverride, type ParcelOverride } from '../../../rust/bridge/urbanConfig';
import { pointInRing } from '../gen/geo/poly';
import { detectPlatform, runtimeOptions, loopbackServer, type PlatformCapabilities } from './platform';
import { applyBuildingEdits, buildingAt, nearestSettlement, townUrban, buildingSignature, validateBuildingPatch, type BuildingEdit } from './edits';
import ExportWorker from './export.worker?worker';
import ProjectWorker from './project.worker?worker';
import ComposeWorker from './compose.worker?worker';
import type { RustTownSnapshot } from './rustUrban';
import { mountTerrainControls } from './terrainControls';
import { mountUrbanControls, type UrbanControls } from './urbanControls';
import { mountRegionControls } from './regionControls';
import type { V2Urban3d } from './urban3d';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
registerMessages({'Cartographic maps':{en:'Cartographic maps',fr:'Cartes graphiques'},'Terrain materials':{en:'Terrain materials',fr:'Matériaux du terrain'},'Painted fantasy maps':{en:'Painted fantasy maps',fr:'Cartes fantasy peintes'},'Diagnostics':{en:'Diagnostics',fr:'Diagnostics'},'Fantasy · Encre N&B':{en:'Fantasy · Black & white ink',fr:'Fantasy · Encre N&B'},'Fantasy · Aquarelle':{en:'Fantasy · Watercolour',fr:'Fantasy · Aquarelle'},'Elevation · DEM':{en:'Elevation · DEM',fr:'Altitude · DEM'},'SVG · map / embedded render':{en:'SVG · map / embedded render',fr:'SVG · carte / rendu intégré'}});
registerMessages({'Render3D · Multiscale':{en:'Render3D · Multiscale',fr:'Render3D · Multi-échelle'},'Render v2 - Satellite':{en:'Render v2 - Satellite',fr:'Render v2 - Satellite'},'Render v2 - Substrate':{en:'Render v2 - Substrate',fr:'Render v2 - Substrat'},'Render v2 - Moisture':{en:'Render v2 - Moisture',fr:'Render v2 - Humidité'},'Render v2 - Vegetation':{en:'Render v2 - Vegetation',fr:'Render v2 - Végétation'},'Render v2 - Snow / ice':{en:'Render v2 - Snow / ice',fr:'Render v2 - Neige / glace'}});
const renderStyles = [...TERRAIN_STYLE_LIST, { id: 'copernicus', label: 'Elevation · DEM' }];
const renderStyleOptions = (): string => [['Cartographic maps',renderStyles.filter(style=>isMapStyle(style.id))],['Terrain materials',renderStyles.filter(style=>style.id.startsWith('render'))],['Painted fantasy maps',renderStyles.filter(style=>style.id.startsWith('fantasy'))],['Diagnostics',renderStyles.filter(style=>style.id==='copernicus')]].map(([label,styles])=>`<optgroup data-render-label="${label}" label="${translate(String(label))}">${(styles as typeof renderStyles).map(style=>`<option value="${style.id}">${esc(style.label)}</option>`).join('')}</optgroup>`).join('');
type Item = string | readonly [string, string];
function options(items: readonly Item[]): string { return items.map(item => { const [value,label] = typeof item === 'string' ? [item,item] : item; return `<option value="${esc(value)}">${esc(label)}</option>`; }).join(''); }
function field(label: string, key: string, items?: readonly Item[], attrs = ''): string { const id=`option-${key.replace(/\./g,'-')}`;return `<label class="label" for="${id}">${label}</label>${items ? `<select id="${id}" data-option="${key}">${options(items)}</select>` : `<input id="${id}" data-option="${key}" ${attrs || 'type="number"'}>`}`; }
const tri: Item[] = [['auto','Automatique'],['yes','Oui'],['no','Non']];
const BIOME_LABELS: readonly Item[] = [['temperate','Campagne tempérée'],['forest','Forêt tempérée'],['desert','Désert & oasis'],['steppe','Steppe'],['tropical','Forêt tropicale'],['tundra','Toundra'],['underdark','Outreterre'],['underdark-caverns','Outreterre & cavernes']];
const layerNames: Record<keyof ExportLayers,string> = { background:'Fond de carte', terrain:'Relief et courbes', water:'Hydrographie', landuse:'Végétation et cultures', city:'Bâtiments et terrains', streets:'Rues et ponts urbains', roads:'Routes régionales', labels:'Toponymes', decor:'Cadre et légende' };
let settings: V2Settings = defaultSettings();
let world: World | undefined;
let pristine: World | undefined;
let mods: unknown[] = [];
let selectedTown = 'main';
let selectedBuilding: { settlement: string; index: number; building: UrbanBuilding } | null = null;
let busy = false, cancelled = false, currentTab = 'terrain', toastTimer: ReturnType<typeof setTimeout>;
let capabilities: PlatformCapabilities | undefined;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
const logs: {time:Date;message:string}[] = [];
let projectRevision = 0;
const bootRuntime = runtimeOptions();
const localEdition = bootRuntime.profile === 'local';
let connectLocal = localEdition;
// The installed launcher already owns a ready native service; avoid loading WASM for the same CPU work.
if(localEdition)settings.runtime={...settings.runtime!,backend:'native',localServer:bootRuntime.localServer,pythonServer:bootRuntime.pythonServer};

setHTML($('#app'), `
<header class="app-header">
  <img class="brand-icon" src="${logo}" alt=""><div class="brand"><h1>MAGNA URBIS</h1><p>L’atelier des régions</p></div><span class="version">V2 · ALPHA</span>
  <span class="header-divider"></span><span class="header-caption">Du relief à la dernière maison.</span>
  <div class="header-tools"><span class="edition">${localEdition ? 'Édition locale' : 'Édition web'}</span><a class="science-link" href="./scientific/index.html" target="_blank" rel="noopener">L’atlas scientifique ↗</a><button id="hardware-open" title="Moteurs et activité"><span class="status-dot" id="hardware-led"></span> <span id="hardware-caption">Moteurs</span></button><button id="import-open">Ouvrir</button><button id="export-open">Exporter ↗</button></div>
</header>
<button class="mobile-toggle" id="mobile-toggle" aria-expanded="false" aria-controls="sidebar">☰ Atelier</button>
<main class="workspace">
  <aside class="sidebar mobile-closed" id="sidebar">
    <div class="sidebar-intro"><span class="eyebrow">Une région à votre mesure</span><h2>Donnez forme à l’inconnu.</h2><p class="hint">Un clic pour commencer. Tous les détails pour aller plus loin.</p></div>
    <nav class="steps" role="tablist" aria-label="Étapes de création"><button class="step" id="tab-terrain" role="tab" aria-selected="true" aria-controls="panel-terrain"><span class="step-number">1</span> Topographie</button><button class="step" id="tab-settlements" role="tab" aria-selected="false" aria-controls="panel-settlements"><span class="step-number">2</span> Peuplements</button></nav>
    <div class="control-scroll">
      <section id="panel-terrain" role="tabpanel" aria-labelledby="tab-terrain">
        <div class="panel-title"><i class="art art-terrain" aria-hidden="true"></i><div><h3>Le territoire</h3><p class="hint">Relief, eau & milieux naturels</p></div></div>
        <label class="label" for="seed">Graine de la région</label><div class="row seed-row"><input id="seed" data-option="seed" type="text" maxlength="200" aria-label="Graine de la région"><button id="random-seed" title="Nouvelle graine" aria-label="Nouvelle graine"><i class="art art-dice"></i></button></div>
        <div id="terrain-controls"></div><p class="hint" id="extent-hint"></p>
        <details class="section"><summary>Heightmap · import</summary>${field('Hauteur du blanc importé (m)','heightScale',undefined,'type="number" min="1" max="20000"')}${field('Niveau marin importé (m)','importSea',undefined,'type="number" min="-20000" max="20000"')}<button id="heightmap-import-quick" class="quiet small">Importer une heightmap ↗</button></details>
        <details class="section"><summary>Comprendre cette étape</summary><ol class="pipeline-list"><li>Façonner le relief<span>Bruit procédural, terrain Rust ou modèle neuronal selon le moteur choisi.</span></li><li>Faire circuler l’eau<span>Dépressions, bassins versants, fleuves, lacs et rivages.</span></li><li>Installer les milieux<span>Climat, végétation et couverture naturelle.</span></li></ol><a class="hint" href="./scientific/index.html#terrain" target="_blank" rel="noopener">Méthodes, équations et limites ↗</a></details>
        <div class="section"><button id="terrain-only" class="grow" style="width:100%">Créer la topographie seulement</button><p class="hint">La carte est conservée pour construire vos villes ensuite.</p></div>
      </section>
      <section id="panel-settlements" role="tabpanel" aria-labelledby="tab-settlements" hidden>
        <div class="panel-title"><i class="art art-town" aria-hidden="true"></i><div><h3>Habiter la région</h3><p class="hint">Du réseau régional à la maison</p></div></div>
        <p class="hint">Le relief est conservé. Placez les lieux et leurs routes, puis donnez forme à chaque ville.</p>
        <div class="control-grid"><div><label class="label" for="town-count">Lieux demandés</label><input id="town-count" type="number" min="1" max="32" value="4"></div><div>${field('Population principale','population',undefined,'type="number" min="10" max="5000000" step="100"')}</div></div>
        ${field('Culture commune','culture',CULTURE_LABELS)}
        <div id="region-controls"></div>
        <details class="section" id="urban-settings-panel"><summary>Moteur urbain & étapes</summary><label class="label" for="urban-backend">Construction des villes</label><select id="urban-backend"><option value="typescript">Classique · TypeScript</option><option value="rust">Rust · navigateur WASM</option><option value="native">Rust · natif local</option></select><div id="urban-controls"></div></details>
        <details class="section"><summary>Forme urbaine & monuments</summary>${field('Étalement · 0,5 compact / 2 diffus','sprawl',undefined,'type="number" min="0.5" max="2" step="0.1"')}${field('Enceinte','walls',[['auto','Automatique'],['none','Ville ouverte'],['single','Simple enceinte'],['double','Double enceinte']])}<div class="control-grid">${[['moat','Douves'],['castle','Château'],['cathedral','Cathédrale'],['palace','Palais'],['monasteries','Monastères'],['port','Port'],['arena','Arène'],['activities','Artisanat']].map(([k,l])=>`<div>${field(l,k,tri)}</div>`).join('')}</div>${field('Faubourgs','suburbs',[['auto','Automatiques'],['none','Aucun'],['some','Quelques-uns'],['many','Nombreux']])}</details>
        <details class="section" open><summary>Deux opérations indépendantes</summary><ol class="pipeline-list"><li>Implanter & relier<span>Choisir les sites, réserver les emprises, tracer les routes régionales.</span></li><li>Construire les lieux<span>Plan urbain → quartiers → rues → îlots → parcelles → bâtiments.</span></li></ol><div class="row"><button id="region-only" class="grow">Implanter & relier</button><button id="towns-only" class="grow">Tout construire</button></div></details>
        <div class="section"><div class="row spread"><span class="eyebrow">Les lieux de votre carte</span><span class="count-badge" id="towns-count">0</span></div><div class="settlement-list" id="settlement-list"><p class="hint">Créez les implantations pour sélectionner un lieu.</p></div></div>
      </section>
      <details class="section"><summary>Paramètres experts</summary><p class="hint">Inspectez et modifiez les paramètres globaux exposés par le moteur, les recettes de croissance, les mélanges culturels ou une liste de lieux avec positions.</p><button id="expert-open" style="width:100%;margin-top:10px">Ouvrir la recette complète</button></details>
    </div>
    <div class="sidebar-footer"><button class="primary generate" id="generate-region"><i class="art art-terrain" aria-hidden="true"></i>Créer ma région <span aria-hidden="true">↗</span></button><div class="footer-note"><span class="status-dot"></span><span id="footer-status">Relief et eau, en un clic</span></div></div>
  </aside>
  <section class="map-area" aria-label="Carte interactive">
    <div class="canvas-wrap" id="map"><canvas id="map-canvas" aria-label="Carte générée : glisser pour déplacer, molette pour zoomer"></canvas></div>
    <div class="empty-map" id="empty-map"><div class="serif">Terra incognita</div><p>Votre prochaine région commence ici.</p></div>
    <div class="map-topbar"><div class="glass map-title"><div><div class="serif" id="map-name">Un nouveau territoire</div><p id="map-subtitle">Topographie · relief & milieux naturels</p></div><span class="tiny-divider"></span><span class="metric" id="map-size">—</span></div><div class="glass style-control"><span class="style-label">RENDU</span><select id="map-style" aria-label="Style de carte">${STYLE_LIST.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}</select></div></div>
    <div class="map-compass" aria-hidden="true"><small>N</small><b>✧</b></div>
    <label class="glass inspector-mode"><input id="inspect-mode" type="checkbox"> Inspecter une ville ou une maison</label>
    <aside id="inspector" class="glass inspector" hidden aria-label="Inspecteur du lieu"></aside>
    <div class="glass map-tools"><button id="zoom-in" aria-label="Zoom avant">+</button><button id="zoom-out" aria-label="Zoom arrière">−</button><button id="fit-map" aria-label="Recentrer la carte" title="Recentrer">⛶</button></div>
    <div class="map-hint" id="map-hint">Glissez pour explorer · Molette pour zoomer</div>
    <div class="glass progress-card" id="progress-card" hidden role="status" aria-live="polite"><div class="row"><i class="spinner"></i><strong class="grow small" id="progress-label">Préparation de la région…</strong><button id="cancel-job" class="quiet small">Annuler</button></div><progress id="progress" max="100" value="0"></progress><div class="row spread"><p id="progress-detail">CPU · worker de génération</p><p id="progress-time">0 s</p></div></div>
    <div class="map-bottom"><div class="glass map-caption"><span class="eyebrow" id="caption-title">La région avant les villes</span><p id="caption-text">Dessinez d’abord le paysage. Les routes et les villes viendront s’y inscrire, sans effacer votre terrain.</p></div><div class="glass mini-card"><canvas id="minimap" aria-label="Vue d’ensemble"></canvas><div class="map-scale"><span id="scale-label">—</span><div class="scale-line"></div><p id="map-metrics">Aucune carte</p></div></div></div><div class="legend-strip"></div>
  </section>
</main>
<dialog id="import-dialog"><div class="dialog-head"><div><span class="eyebrow">Reprendre une région</span><h2>Ouvrir & combiner</h2></div><button data-close="import-dialog" aria-label="Fermer">×</button></div><p class="hint">Un projet contient la carte, les paramètres et les modifications. Une recette permet de retrouver la même région avec la même version du moteur.</p><div class="file-card"><h3>Projet ou recette Magna Urbis V2</h3><p class="hint">JSON complet ou graines + paramètres. Les grilles d’altitude sont conservées dans les projets.</p><input id="project-file" type="file" accept=".json,application/json" aria-label="Importer un projet ou une recette V2"></div><div class="file-card"><h3>Heightmap → territoire</h3><p class="hint">PNG, JPEG ou WebP en niveaux de gris, cadrés au carré. Ajustez l’altitude et le niveau de mer avant de créer le terrain. Le relief importé remplace le relief actuel.</p><input id="heightmap-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Importer une heightmap"><button id="clear-heightmap" class="quiet small">Retirer le relief importé</button><p class="hint" id="import-height-info">Aucune heightmap importée.</p></div><div class="dialog-actions"><button data-close="import-dialog">Fermer</button></div></dialog>
<dialog id="export-dialog"><div class="dialog-head"><div><span class="eyebrow">Emporter votre région</span><h2>Exporter à votre façon</h2></div><button data-close="export-dialog" aria-label="Fermer">×</button></div><p class="hint">Une carte complète, un recadrage ou seulement les éléments utiles à votre table de jeu.</p><div class="control-grid"><div><label class="label" for="export-format">Format</label><select id="export-format"><option value="png">Image PNG</option><option value="svg">Carte vectorielle SVG</option><option value="project">Projet complet · JSON</option><option value="recipe">Graines + paramètres + modifications</option><option value="seed">Graine seule · JSON</option><option value="heightmap">Heightmap · PNG 8 bits</option></select></div><div><label class="label" for="export-style">Style</label><select id="export-style">${STYLE_LIST.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}</select></div></div><div id="export-map-options"><h3>Éléments à inclure</h3><div class="export-layers">${EXPORT_LAYER_NAMES.map(k=>`<label class="checkline"><input type="checkbox" data-layer="${k}" checked>${layerNames[k]}</label>`).join('')}</div><div class="control-grid"><div><label class="label" for="export-resolution">Bord le plus long</label><select id="export-resolution"><option value="1600">1 600 px · rapide</option><option value="3000" selected>3 000 px · standard</option><option value="4096">4 096 px · détaillé</option></select></div><label class="checkline"><input id="export-crop" type="checkbox" checked>Choisir la zone à exporter</label></div></div><p class="hint" id="export-note" style="margin-top:15px">Les exports visuels utilisent la carte actuelle, sans relancer la génération.</p><div class="dialog-actions"><button data-close="export-dialog">Annuler</button><button class="primary" id="export-go">Exporter</button></div></dialog>
<dialog id="expert-dialog"><div class="dialog-head"><div><span class="eyebrow">La recette de la région</span><h2>Paramètres experts</h2></div><button data-close="expert-dialog" aria-label="Fermer">×</button></div><p class="hint">Paramètres globaux, réglages locaux par clé stable, plans de croissance et préférences de site. Les données du terrain importé sont conservées séparément.</p><label class="label" for="expert-json">Recette JSON</label><textarea id="expert-json" spellcheck="false"></textarea><p class="warning" id="expert-error" role="alert"></p><div class="dialog-actions"><button data-close="expert-dialog">Annuler</button><button class="primary" id="expert-apply">Appliquer la recette</button></div></dialog>
<dialog id="hardware-dialog"><div class="dialog-head"><div><span class="eyebrow">L’atelier au travail</span><h2>Moteurs & activité</h2></div><button data-close="hardware-dialog" aria-label="Fermer">×</button></div><p class="hint">Capacités détectées sur cet appareil. Le moteur effectivement utilisé est indiqué dans le journal de chaque génération.</p><div id="hardware-details"></div><h3>Journal de génération</h3><pre class="job-log" id="job-log">L’atelier est prêt.</pre><div class="dialog-actions"><button id="hardware-refresh">Actualiser les connexions</button><button data-close="hardware-dialog">Fermer</button></div></dialog>
<div class="toast" id="toast" role="status" hidden></div>`);

const canvas = $<HTMLCanvasElement>('#map-canvas');
const client = new StudioClient(canvas, $('#map'), $<HTMLCanvasElement>('#minimap'), updateProgress, e => toast(e.message, true), () => {
  const view = client.viewer.getView();
  setText($('#scale-label'), `${Math.round(80 / view.scale).toLocaleString(numberLocale())} m`);
});
let city3d:V2Urban3d|undefined;
let renderTimer:ReturnType<typeof setTimeout>|undefined,renderRevision=0;
insertHTML($('.style-control'),'beforeend','<span id="render-status" class="hint" role="status" aria-live="polite" hidden></span><div id="render-controls"></div>');
const renderControls=mountRenderControls($('#render-controls'),{getSettings:()=>settings,getWorld:()=>world,getStyleSelectors:()=>[$<HTMLSelectElement>('#map-style'),$<HTMLSelectElement>('#export-style')],onChange:()=>{projectRevision++;clearTimeout(renderTimer);renderTimer=setTimeout(()=>void refreshAppearance(),120);}});
async function refreshAppearance():Promise<void>{
  const revision=++renderRevision;
  renderControls.sync();
  const status=$('#render-status');delete status.dataset.error;status.hidden=false;setText(status,getLanguage()==='fr'?'Préparation du rendu…':'Preparing the renderer…');
  try{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));await client.setAppearance(settings);
    if(revision===renderRevision){
      const style=settings.appearance?.renderer==='classic'?settings.appearance.style:settings.appearance?.terrainStyle??settings.appearance?.style??settings.options.style;
      $<HTMLSelectElement>('#map-style').value=style;$<HTMLSelectElement>('#export-style').value=style;
      for(const key of ['contours','landuse','labels'] as const)$<HTMLInputElement>(`#display-${key}`).checked=settings.appearance?.[key]??(key==='labels'?true:settings.options[key]);
      if(city3d?.active)await client.prepare3dBackground();city3d?.refresh();renderControls.sync();
    }
  }
  catch(error){if(revision===renderRevision)reportAppearanceError(error);}finally{if(revision===renderRevision&&status.dataset.error!=='true')status.hidden=true;}
}
function reportAppearanceError(error:unknown):void{
  const message=error instanceof Error?error.message:String(error);
  if(error instanceof Error&&error.name==='MaterialRasterUnavailableError'){
    const status=$('#render-status');status.dataset.error='true';status.hidden=false;
    setText(status,getLanguage()==='fr'?'Render indisponible : WebGL2 n’a pas pu démarrer. Choisissez un style cartographique.':'Render unavailable: WebGL2 could not start. Choose a cartographic style.');
  }
  toast(message,true);
}
for(const selector of ['#map-style','#export-style'])setHTML($(selector),renderStyleOptions());
setText($('#export-format option[value="svg"]'),'SVG · map / embedded render');
insertHTML($('.style-control'),'beforeend','<button id="view3d" type="button" aria-pressed="false">3D</button><button id="capture3d" type="button" hidden>PNG 3D ↗</button>');
$('#view3d').onclick=async()=>{
  if(!world){toast(getLanguage()==='fr'?'Créez d’abord le territoire.':'Create the terrain first.');return;}
  if(city3d?.active){city3d.hide();setText($('#view3d'),'3D');$('#view3d').setAttribute('aria-pressed','false');$('#capture3d').hidden=true;return;}
  $<HTMLButtonElement>('#view3d').disabled=true;
  try{
    await client.prepare3dBackground();
    if(!city3d){toast(getLanguage()==='fr'?'Chargement de la vue 3D…':'Loading the 3D view…');city3d=await(await import('./urban3d')).mountV2Urban3d({host:$('.map-area'),getWorld:()=>world,getSettings:()=>settings,getBackground:()=>client.backgroundUrl(),onAppearanceChange:()=>{projectRevision++;void refreshAppearance();},getTextured:()=>settings.appearance?.textured??true,setTextured:value=>{settings.appearance={style:settings.options.style,...settings.appearance,textured:value};projectRevision++;void refreshAppearance();},getSelected:()=>selectedBuilding?(selectedBuilding.building as UrbanBuilding&{nativeId?:string}).nativeId:undefined,onSelect:id=>{
      for(const settlement of world?.settlements??[]){const urban=townUrban(world!,settlement.key),index=urban?.buildings.findIndex(b=>(b as UrbanBuilding&{nativeId?:string}).nativeId===id)??-1;if(urban&&index>=0){showBuilding({settlement:settlement.key,index,building:urban.buildings[index]});break;}}
    }});}
    city3d.show();setText($('#view3d'),'2D');$('#view3d').setAttribute('aria-pressed','true');$('#capture3d').hidden=false;
  }catch(error){toast(String(error),true);}finally{$<HTMLButtonElement>('#view3d').disabled=false;}
};
$('#capture3d').onclick=async()=>{try{if(city3d?.active)download(await city3d.capture(),`magna-urbis-${settings.options.seed}.3d.png`);}catch(error){toast(String(error),true);}};
const terrainControls=mountTerrainControls($('#terrain-controls'),{getSettings:()=>settings,onChange:()=>{touchRecipe();regionControls?.sync();syncUrbanBackend();},disabled:()=>busy,context:{getWorld:()=>world,onApply:()=>void generate('terrain')}});
const urbanControls=mountUrbanControls($('#urban-controls'),()=>settings,()=>{touchRecipe();syncUrbanBackend();});
let pendingRegionPosition:string|undefined;
const regionControls=mountRegionControls($('#region-controls'),{getSettings:()=>settings,onChange:touchRecipe,getWorld:()=>world,disabled:()=>busy,onReroute:()=>void generate('roads'),onPickPosition:key=>{pendingRegionPosition=key;toast(translate('Choose a position on the map'));}});
let inspectorForms:UrbanControls[]=[];
function disposeInspectorForms():void{inspectorForms.forEach(form=>form.dispose());inspectorForms=[];}
function syncUrbanBackend():void{const backend=settings.urban?.backend??settings.runtime?.backend??'typescript';$<HTMLSelectElement>('#urban-backend').value=backend;$('#urban-controls').hidden=backend==='typescript';}
$<HTMLSelectElement>('#urban-backend').onchange=()=>{settings.urban={...settings.urban,backend:$<HTMLSelectElement>('#urban-backend').value as 'typescript'|'rust'|'native'};touchRecipe();syncUrbanBackend();urbanControls.sync();};
insertHTML($('#inspect-mode').parentElement!, 'beforeend', `<select id="inspect-target" aria-label="Niveau à inspecter" style="width:90px;padding:3px 5px;font-size:10px"><option value="auto">Auto</option><option value="quarter">Quartier</option><option value="parcel">Parcelle</option><option value="house">Maison</option></select>`);
insertHTML($('#map-style'), 'afterend', `<details class="display-menu"><summary>Couches ▾</summary><div><label class="checkline"><input id="display-contours" type="checkbox" checked>Courbes de niveau</label><label class="checkline"><input id="display-landuse" type="checkbox" checked>Milieux & cultures</label><label class="checkline"><input id="display-labels" type="checkbox" checked>Toponymes</label></div></details>`);
insertHTML($('#hardware-details'), 'afterend', `<details class="section"><summary>Adresses des services locaux</summary><p class="hint">L’édition installable lance Rust automatiquement. Python peut utiliser le service local existant. Les adresses restent sur votre machine.</p><label class="label" for="rust-server">Rust natif</label><input id="rust-server" type="url" value="${esc(bootRuntime.localServer)}"><label class="label" for="python-server">Python neuronal</label><input id="python-server" type="url" value="${esc(bootRuntime.pythonServer)}"><button id="services-apply" class="small" style="margin-top:12px">Enregistrer & vérifier</button><p class="hint">Configuration de Python et des modèles : <a href="./scientific/index.html#calcul" target="_blank" rel="noopener">lire l’atlas ↗</a></p></details>`);
insertHTML($('#project-file'), 'beforebegin', `<label class="label" for="import-scope">Que reprendre dans ce fichier ?</label><select id="import-scope"><option value="complete">Le projet complet · carte + recette + modifications</option><option value="terrain">Le territoire · garder ma recette de villes</option><option value="urban">La recette des villes · garder mon territoire</option></select><p class="hint" style="margin:8px 0 14px">Les compositions conservent le terrain exact et réinitialisent les géométries urbaines : reconstruisez les lieux avec la recette choisie.</p>`);
function toast(message: string, error = false): void { clearTimeout(toastTimer); setText($('#toast'), message); $('#toast').dataset.error = String(error); $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 12000 : 5000); }
function renderLog():void{$('#job-log').textContent=logs.map(entry=>`${entry.time.toLocaleTimeString(numberLocale())}  ${translate(entry.message)}`).join('\n');$('#job-log').scrollTop=$('#job-log').scrollHeight;}
function log(message: string): void {logs.push({time:new Date(),message});if(logs.length>150)logs.shift();renderLog();}
function dialog(id: string): void { $<HTMLDialogElement>(id).showModal(); }
function touchRecipe(): void { projectRevision++; updateExtent(); setText($('#footer-status'), world ? 'Réglages modifiés · prêts à générer' : 'Relief et eau, en un clic'); }
function updateExtent(): void { setDynamicText($('#extent-hint'), ()=>`${(adaptedExtent(settings)/1000).toLocaleString(numberLocale())} km de côté · ${settings.extent === 'auto' ? settings.generation==='neural'?'fenêtre native du modèle':'selon les peuplements demandés' : 'étendue imposée'}`); }
function syncControls(): Promise<void> {
  document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-option]').forEach(input => { const key = input.dataset.option!; const value = key.startsWith('center.') ? settings.options.center?.[key.endsWith('x') ? 'x' : 'y'] : (settings.options as unknown as Record<string,unknown>)[key]; input.value = String(value ?? (input.tagName === 'SELECT' ? 'auto' : '')); });
  $<HTMLInputElement>('#town-count').value=String(settings.settlementCount);
  $<HTMLInputElement>('#rust-server').value=settings.runtime?.localServer??bootRuntime.localServer??'';
  $<HTMLInputElement>('#python-server').value=settings.runtime?.pythonServer??bootRuntime.pythonServer??'';
  terrainControls.sync();regionControls.sync();urbanControls.sync();syncUrbanBackend();updateExtent();
  const appearance={style:settings.options.style,contours:settings.options.contours,landuse:settings.options.landuse,labels:settings.options.labels??true,...settings.appearance};
  $<HTMLSelectElement>('#map-style').value=appearance.terrainStyle??appearance.style;$<HTMLSelectElement>('#export-style').value=appearance.terrainStyle??appearance.style;
  for(const key of ['contours','landuse','labels'] as const)$<HTMLInputElement>(`#display-${key}`).checked=appearance[key]??true;
  renderControls.sync();return client.setAppearance(settings).catch(reportAppearanceError);
}
function selectTab(tab: string): void { currentTab = tab; for (const key of ['terrain','settlements']) { $(`#tab-${key}`).setAttribute('aria-selected',String(key===tab)); $(`#panel-${key}`).hidden = key !== tab; } }
function updateProgress(p: V2Progress): void {
  setText($('#progress-label'), p.label);
  const meter=$<HTMLProgressElement>('#progress');
  if(p.total>0)meter.value=Math.max(0,Math.min(100,100*p.completed/p.total));else meter.removeAttribute('value');
  meter.setAttribute('aria-labelledby','progress-label');meter.setAttribute('aria-describedby','progress-detail');
  const cache = p.cache === 'memory' ? 'Cache mémoire réutilisé' : p.cache === 'disk' ? 'Terrain restauré depuis le disque' : 'Calcul dans un worker';
  setText($('#progress-detail'), p.detail??cache); log(p.label + (p.cache ? ` · ${p.cache}` : ''));
}
function setBusy(value: boolean): void {
  busy = value; $('#progress-card').hidden = !value; $('#hardware-led').classList.toggle('busy-led',value); $('#app').setAttribute('aria-busy',String(value));
  for(const selector of ['#terrain-controls','#urban-settings-panel','#inspector'])$(selector).inert=value;
  for (const id of ['generate-region','terrain-only','region-only','towns-only','random-seed','expert-apply','export-go','clear-heightmap']) $<HTMLButtonElement>(`#${id}`).disabled = value;
  document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-option],#town-count,#project-file,#heightmap-file,#terrain-controls input,#terrain-controls select,#terrain-controls button,#urban-settings-panel input,#urban-settings-panel select,#urban-settings-panel button').forEach(e=>e.disabled=value);
  document.querySelectorAll<HTMLButtonElement>('[data-relief],#inspector button').forEach(e=>e.disabled=value);
  if (!value && elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = undefined; }
  terrainControls.sync();regionControls.sync();urbanControls.sync();inspectorForms.forEach(form=>form.sync());if(!value)syncUrbanBackend();
  $<HTMLButtonElement>('#cancel-job').disabled=false;
}
async function generate(action: Action, key?: string, townStage?:V2TownStage): Promise<void> {
  if (busy) return; cancelled = false;
  if (action !== 'terrain' && action !== 'all' && !world) { toast('Créez d’abord le territoire.'); selectTab('terrain'); return; }
  setBusy(true); const started = performance.now(); const revision = projectRevision;
  setText($('#progress-label'), 'Préparation du calcul…'); setText($('#progress-time'), '0 s');
  elapsedTimer = setInterval(()=>{ setText($('#progress-time'), `${Math.round((performance.now()-started)/1000)} s`); },500);
  log(`Début : ${action} · graine ${settings.options.seed}`);
  try {
    const result = await client.run(action,settings, pristine ?? world,key,townStage);
    if (cancelled) return;
    pristine = result;
    const edited = applyBuildingEdits(result, mods); world = edited.world;
    if (edited.skipped) log(`${edited.skipped} modification(s) ne correspondent plus à leur bâtiment d’origine.`);
    setText($('#progress-label'), 'Dessin de la carte…');$<HTMLButtonElement>('#cancel-job').disabled=true;log('Préparation de la scène et dessin dans le worker de rendu…');
    await client.show(world,action === 'town' || action === 'towns');canvas.hidden=false; $('#empty-map').hidden = true;
    updateWorld(); if (action === 'all' || action === 'region' || action === 'towns') selectTab('settlements');
    setText($('#footer-status'), `Carte prête · ${((performance.now()-started)/1000).toFixed(1)} s`);
    const completion = `Terminé en ${((performance.now()-started)/1000).toFixed(2)} s · relief ${String(world.stats.backend ?? 'typescript-cpu')}`;
    const hasBuiltTowns = !!world.urban || world.settlements?.some(place => !!place.urban);
    log(hasBuiltTowns ? `${completion} · villes ${String(world.stats['v2.urbanBackend'] ?? 'typescript-cpu')}` : completion);
    const refused=Object.entries(world.stats).filter(([name])=>name.startsWith('v2.urbanRefusals:')).reduce((count,[,value])=>count+Number(value||0),0);
    if(refused){log(`${refused} demande(s) de construction refusée(s) par le moteur : consultez le rapport du lieu.`);toast(`${refused} construction(s) refusée(s). Le rapport de chaque lieu explique les contraintes.`,true);}
    if(world.stats['settlements.warning']){log(String(world.stats['settlements.warning']));if(!refused)toast(String(world.stats['settlements.warning']));}
    if (key) showInspector(key);
  } catch (e) { if (!cancelled) { const message = e instanceof Error ? e.message : String(e); log(`Échec : ${message}`); toast(message,true); } }
  finally { setBusy(false); if (projectRevision !== revision) setText($('#footer-status'), 'Nouveaux réglages à générer'); }
}
function updateWorld(): void {
  if (!world) return;
  disposeInspectorForms();regionControls.sync();terrainControls.sync();city3d?.refresh();
  setUserText($('#map-name'), world.names?.town, 'Le territoire des possibles');
  const towns = world.settlements ?? [], detailed = towns.filter(s=>s.main ? !!world?.urban : !!s.urban).length;
  setText($('#map-subtitle'), towns.length ? `${towns.length} lieux implantés · ${detailed} construits` : 'Topographie · relief & milieux naturels');
  setText($('#map-size'), `${(world.mapSize/1000).toLocaleString(numberLocale())} × ${(world.mapSize/1000).toLocaleString(numberLocale())} km`);
  setText($('#map-metrics'), `${world.terrain.rivers.length} cours d’eau\n${towns.length} peuplements`);
  setText($('#caption-title'), towns.length ? 'Du territoire à ses habitants' : 'La région avant les villes');
  setText($('#caption-text'), towns.length ? 'Sélectionnez un lieu pour le construire ou affiner ses paramètres. Activez l’inspection et zoomez pour choisir une maison.' : 'Le paysage est prêt. Passez aux peuplements pour implanter les lieux et tracer leurs routes.');
  setText($('#towns-count'), String(towns.length));
  setHTML($('#settlement-list'), towns.length ? towns.map(s=>`<button class="settlement-item" data-town="${esc(s.key)}" aria-pressed="${selectedTown===s.key}"><span class="settlement-dot ${(s.main ? world?.urban : s.urban)?'ready':''}"></span><span class="grow"><strong>${nameHTML(s.name,s.main?'Ville principale':s.key)}</strong><small>${numberHTML(s.population)} hab. · <span>${esc(s.archetype)}</span></small></span><span class="count-badge">${(s.main ? world?.urban : s.urban)?'↗':'＋'}</span></button>`).join('') : '<p class="hint">Créez les implantations pour sélectionner un lieu.</p>');
  document.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b=>b.onclick=()=>showInspector(b.dataset.town!,true));
  $('#inspector').hidden = true; selectedBuilding = null;
}
function showInspector(key: string, focus = false): void {
  if (!world) return; const s = world.settlements?.find(s=>s.key===key); if (!s) return;
  disposeInspectorForms();selectedTown = key; selectedBuilding = null;
  const urban = townUrban(world,key), local = settings.local[key] ?? {};
  $('#inspector').hidden = false;
  setHTML($('#inspector'), `<button class="close" aria-label="Fermer l’inspecteur">×</button><span class="eyebrow">Réglages locaux</span><h2>${nameHTML(s.name,s.main?'Ville principale':s.key)}</h2><p class="hint">${numberHTML(s.population)} habitants · <span>${esc(s.archetype)}</span></p><div class="breadcrumbs">Territoire › ${nameHTML(s.name,s.key)}</div><p class="inspect-note">Les valeurs vides héritent des paramètres globaux. Seul ce lieu est reconstruit ; son terrain et ses voisins sont conservés.</p><label class="label">Culture</label><select id="local-culture"><option value="">Hériter · ${esc(s.culture)}</option>${options(CULTURE_LABELS)}</select><div class="control-grid"><div><label class="label">Population</label><input id="local-population" type="number" min="10" max="5000000" placeholder="${s.population}"></div><div><label class="label">Étalement</label><input id="local-sprawl" type="number" min="0.5" max="2" step="0.1" placeholder="Hériter"></div></div><label class="label">Enceinte</label><select id="local-walls"><option value="">Hériter</option>${options([['none','Aucune'],['single','Simple'],['double','Double'],['auto','Automatique']])}</select><button class="primary" id="build-town">${urban?'Reconstruire ce lieu':'Construire ce lieu'}</button><p class="hint" style="margin-top:8px">${urban ? `${urban.quarters.length} quartiers · ${urban.parcels.length} parcelles · ${urban.buildings.length} bâtiments` : 'Implantation réservée · construction à la demande'}</p><details class="section"><summary>Étapes de cette ville</summary><ol class="pipeline-list"><li>Plan & emprise<span>Population, culture et site.</span></li><li>Quartiers & rues<span>Croissance, tracé, hiérarchie.</span></li><li>Îlots & parcelles<span>Foncier, accès et occupations.</span></li><li>Édifices & maisons<span>Typologies, enveloppes et monuments.</span></li></ol></details><details class="section"><summary>Recette locale complète</summary><p class="hint">Tous les paramètres urbains exposés : plan de croissance, monuments, défenses, préférences. Les paramètres de relief sont globaux.</p><textarea id="local-json" spellcheck="false">${esc(JSON.stringify(local,null,2))}</textarea><button id="local-apply" class="small">Appliquer</button><button id="local-reset" class="quiet small">Revenir à l’héritage</button></details><div class="section"><label class="checkline"><input type="checkbox" id="inspect-house" ${$<HTMLInputElement>('#inspect-mode').checked?'checked':''}>Choisir une maison sur la carte</label><p class="hint">Zoomez, puis cliquez sur une emprise de bâtiment pour éditer son toit, sa hauteur ou sa géométrie.</p></div><div id="building-inspector"></div>`);
  $('#inspector .close').onclick = ()=>{ $('#inspector').hidden=true; };
  for (const name of ['culture','population','sprawl','walls']) { const input = $<HTMLInputElement|HTMLSelectElement>(`#local-${name}`); input.value = String((local as Record<string,unknown>)[name] ?? ''); input.onchange=()=>{ const next = { ...settings.local[key] } as Record<string,unknown>; if (input.value==='') delete next[name]; else next[name]=name==='population'||name==='sprawl'?Number(input.value):input.value; settings.local[key]=next; touchRecipe(); }; }
  $('#build-town').onclick=()=>void generate('town',key);
  const backend=settings.urban?.backend??settings.runtime?.backend??'typescript';
  if(backend!=='typescript'){
    insertHTML($('#build-town'), 'afterend', `<div class="section"><span class="eyebrow">Avancer étape par étape</span><div class="urban-stage-buttons">${[['layout','1 · Plan & quartiers'],['parcels','2 · Îlots & parcelles'],['programme','3 · Programme'],['buildings','4 · Maisons']].map(([stage,label])=>`<button class="small" data-town-stage="${stage}">${label}</button>`).join('')}</div><p class="hint">Les étapes sont de vrais arrêts du moteur Rust. La carte affiche seulement les couches déjà construites.</p></div><details class="section"><summary>Réglages Rust de ce lieu</summary><p class="hint">Héritage global, puis paramètres de ce lieu. Plan, parcellation et maisons ont chacun leur configuration.</p><textarea id="local-rust-json" spellcheck="false">${esc(JSON.stringify(settings.urban?.local?.[key]??{},null,2))}</textarea><button id="local-rust-apply" class="small">Appliquer au lieu</button></details>`);
    document.querySelectorAll<HTMLButtonElement>('[data-town-stage]').forEach(button=>button.onclick=()=>void generate('town',key,button.dataset.townStage as V2TownStage));
    $('#local-rust-apply').onclick=()=>{try{const value=JSON.parse($<HTMLTextAreaElement>('#local-rust-json').value);const candidate={...settings,urban:{...settings.urban,backend,local:{...settings.urban?.local,[key]:value}}};validateSettings(candidate);settings=candidate;touchRecipe();toast('Paramètres Rust locaux enregistrés. Choisissez l’étape à reconstruire.');}catch(e){toast(String(e),true);}};
    insertHTML($('#build-town'),'afterend','<div class="section" id="local-urban-controls"></div>');
    inspectorForms.push(mountUrbanControls($('#local-urban-controls'),()=>settings,()=>{touchRecipe();$<HTMLTextAreaElement>('#local-rust-json').value=JSON.stringify(settings.urban?.local?.[key]??{},null,2);},{kind:'settlement',key}));
    const native=(world.debug?.v2RustCities as Record<string,RustTownSnapshot>|undefined)?.[key];
    if(native){
      const refusals=native.stage==='buildings'?native.scene?.refusals??[]:[],warnings=native.warnings??[];
      insertHTML($('#inspector'), 'beforeend', `<details class="section" ${refusals.length?'open':''}><summary>Rapport du moteur · ${refusals.length} refus</summary><p class="hint">Étape : ${esc(native.stage)} · ${esc(native.backend)}. ${native.lastBuildingRequests??0} demande(s) de maison recalculée(s) au dernier passage.</p>${warnings.length?`<pre class="job-log">${esc(warnings.join('\n'))}</pre>`:'<p class="hint">Aucun avertissement de génération.</p>'}${refusals.slice(0,20).map(refusal=>{const id=native.requests?.find(r=>r.id===refusal.id||r.parcel_id===refusal.parcel_id)?.id??refusal.id;return `<details class="section"><summary>Maison ${esc(id)}</summary><p class="warning">${esc(refusal.message)}</p><textarea class="refusal-json" spellcheck="false">${esc(JSON.stringify(settings.urban?.buildings?.[`${key}/${id}`]??{},null,2))}</textarea><button class="small" data-retry-house="${esc(id)}">Réessayer avec ces paramètres</button><p class="hint">Saisir {} rétablit l’héritage du lieu. Les bornes des recettes restent celles du moteur.</p></details>`;}).join('')}</details>`);
      document.querySelectorAll<HTMLButtonElement>('[data-retry-house]').forEach(button=>button.onclick=()=>{try{const value=JSON.parse(button.parentElement!.querySelector('textarea')!.value),id=button.dataset.retryHouse!,next={...settings,urban:{...settings.urban,backend,buildings:{...settings.urban?.buildings,[`${key}/${id}`]:value}}};validateSettings(next);settings=next;touchRecipe();void generate('town',key,'buildings');}catch(e){toast(String(e),true);}});
    }
  }
  $('#local-apply').onclick=()=>{ try { const patch=JSON.parse($<HTMLTextAreaElement>('#local-json').value); const candidate={...settings,local:{...settings.local,[key]:patch}}; validateSettings(candidate); settings=candidate; touchRecipe(); toast('Recette locale enregistrée. Reconstruisez ce lieu pour l’appliquer.'); }catch(e){toast(String(e),true);} };
  $('#local-reset').onclick=()=>{delete settings.local[key];touchRecipe();showInspector(key);};
  $<HTMLInputElement>('#inspect-house').onchange=e=>{$<HTMLInputElement>('#inspect-mode').checked=(e.target as HTMLInputElement).checked;};
  if (focus) client.viewer.setView({cx:s.center.x,cy:s.center.y,scale:Math.min(3,Math.min($('#map').clientHeight,$('#map').clientWidth)/Math.max(600,s.radius*3))});
}
function showBuilding(hit: NonNullable<ReturnType<typeof buildingAt>>): void {
  showInspector(hit.settlement); selectedBuilding = hit;
  const b=hit.building;
  setHTML($('#building-inspector'), `<div class="edit-building"><span class="eyebrow">Maison ${hit.index+1}</span><h3>Le dernier détail</h3><p class="hint">${esc(b.kind)} · ${esc(b.arch || 'typologie générée')}</p><div class="control-grid"><div><label class="label">Étages</label><input id="house-storeys" type="number" min="1" max="100" value="${b.storeys??1}"></div><div><label class="label">Hauteur (m)</label><input id="house-height" type="number" min="0.5" max="1000" step="0.5" value="${b.height??3}"></div></div><label class="label">Toit</label><select id="house-roof">${options(['gable','hip','flat','dome','pyramidal','pagoda','thatch-round','none','tiled-hip','conical','barrel','terraced'])}</select><label class="label">Matériau</label><input id="house-material" type="text" maxlength="100" value="${esc(b.material??'')}"><details class="section"><summary>Emprise & métadonnées</summary><textarea id="house-json" spellcheck="false">${esc(JSON.stringify(b,null,2))}</textarea><p class="hint">Coordonnées de l’emprise en mètres. Les métadonnées architecturales sont exportées ; leur apparence dépend du rendu.</p></details><button id="house-apply">Enregistrer la maison</button><button id="house-undo" class="quiet small">Annuler la dernière modification</button></div>`);
  $<HTMLSelectElement>('#house-roof').value=b.roof??'gable';
  $('#house-apply').onclick=()=>{
    try {
      if (!selectedBuilding || !pristine) return;
      const source=townUrban(pristine,hit.settlement)?.buildings[hit.index]; if (!source) throw new Error('Bâtiment source introuvable.');
      const json=JSON.parse($<HTMLTextAreaElement>('#house-json').value);
      const patch=validateBuildingPatch({...json,storeys:Number($<HTMLInputElement>('#house-storeys').value),height:Number($<HTMLInputElement>('#house-height').value),roof:$<HTMLSelectElement>('#house-roof').value,material:$<HTMLInputElement>('#house-material').value});
      const ids=source as UrbanBuilding&{nativeId?:string;nativeRequestId?:string};
      const edit:BuildingEdit={type:'building',settlement:hit.settlement,index:hit.index,nativeId:ids.nativeId,nativeRequestId:ids.nativeRequestId,signature:buildingSignature(source),patch};
      mods=mods.filter(m=>!(m&&typeof m==='object'&&(m as BuildingEdit).type==='building'&&(m as BuildingEdit).settlement===hit.settlement&&(m as BuildingEdit).index===hit.index)); mods.push(edit);
      world=applyBuildingEdits(pristine,mods).world; client.show(world,true); touchRecipe(); toast('Maison modifiée et conservée dans le projet.');
    }catch(e){toast(String(e),true);}
  };
  $('#house-undo').onclick=()=>{if(!pristine)return;mods.pop();world=applyBuildingEdits(pristine,mods).world;client.show(world,true);touchRecipe();showInspector(hit.settlement);toast('Dernière modification annulée.');};
  const requestId=(b as UrbanBuilding & {nativeRequestId?:string}).nativeRequestId;
  if(requestId){
    const scopedId=`${hit.settlement}/${requestId}`,saved=settings.urban?.buildings?.[scopedId]??{};
    insertHTML($('#building-inspector'), 'beforeend', `<div class="edit-building"><span class="eyebrow">Générateur de maisons Rust</span><p class="hint">Identifiant : <code>${esc(requestId)}</code>. Réglez la recette, les matériaux, le toit, les étages, les pièces ou la variation. Les étapes du terrain et du cadastre sont conservées.</p><label class="label" for="house-native-json">Paramètres de génération de cette maison</label><textarea id="house-native-json" spellcheck="false">${esc(JSON.stringify(saved,null,2))}</textarea><p class="hint">HouseConfig : seed, recipe, pack, mode, era, size, variation, wealth, overrides (roof, floors, frame, infill, coating, cladding, courtyard_ratio, roof_pitch_deg…). Les valeurs absentes héritent de la recette du lieu. Le placement natif détermine son orientation depuis les accès de la parcelle.</p><button id="house-native-apply">Régénérer avec ces paramètres</button><button id="house-native-reset" class="quiet small">Hériter de la ville</button></div>`);
    const apply=(value:unknown)=>{const next={...settings,urban:{...settings.urban,backend:settings.urban?.backend??'rust' as const,buildings:{...settings.urban?.buildings,[scopedId]:value}}};validateSettings(next);settings=next;touchRecipe();void generate('town',hit.settlement,'buildings');};
    insertHTML($('#house-native-json'),'beforebegin','<div id="house-native-controls"></div>');
    const nativeRequest=(world?.debug?.v2RustCities as Record<string,RustTownSnapshot>|undefined)?.[hit.settlement]?.requests?.find(request=>request.id===requestId);
    inspectorForms.push(mountUrbanControls($('#house-native-controls'),()=>settings,()=>{touchRecipe();$<HTMLTextAreaElement>('#house-native-json').value=JSON.stringify(settings.urban?.buildings?.[scopedId]??{},null,2);},{kind:'building',key:hit.settlement,id:requestId,defaults:nativeRequest?.config}));
    $('#house-native-apply').onclick=()=>{try{apply(JSON.parse($<HTMLTextAreaElement>('#house-native-json').value));}catch(e){toast(String(e),true);}};
    $('#house-native-reset').onclick=()=>{try{const buildings={...settings.urban?.buildings};delete buildings[scopedId];settings.urban={...settings.urban,backend:settings.urban?.backend??'rust',buildings};touchRecipe();void generate('town',hit.settlement,'buildings');}catch(e){toast(String(e),true);}};
  }
  $('#building-inspector').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function inspectSubdivision(kind:'quarter'|'parcel',p:{x:number;y:number}):boolean {
  if(!world)return false;
  for(const settlement of world.settlements??[]){
    const urban=townUrban(world,settlement.key);if(!urban)continue;
    const items=kind==='quarter'?urban.quarters:urban.parcels;
    const index=items.findIndex(item=>{const geometry=kind==='quarter'?(item as typeof urban.quarters[number]).poly.outer:(item as typeof urban.parcels[number]).poly;return pointInRing(geometry,p);});
    if(index<0)continue;
    const item=items[index] as typeof items[number]&{nativeId?:string},nativeId=item.nativeId;
    showInspector(settlement.key);
    const mapKey=kind==='quarter'?'quarters':'parcels', controls=settings.urban?.local?.[settlement.key],saved=kind==='quarter'?controls?.layout?.overrides?.quarters?.[nativeId??String(index)]:controls?.parcels?.overrides?.parcels?.[nativeId??String(index)];
    const placeholder=kind==='quarter'?{density:1,wealth:0.5,salt:0}: {salt:0};
    setHTML($('#building-inspector'), `<div class="edit-building"><span class="eyebrow">${kind==='quarter'?'Quartier':'Parcelle'} ${index+1}</span><h3>${kind==='quarter'?'Un morceau de ville':'Une pièce du foncier'}</h3><p class="hint">${nativeId?`Identifiant du moteur : <code>${esc(nativeId)}</code>`:'Géométrie du moteur classique. Les réglages de génération par quartier et parcelle sont disponibles avec le moteur Rust.'}</p>${nativeId?`<label class="label" for="subdivision-json">${kind==='quarter'?'Densité, trame, richesse, culture, forme et graine locale':'Fonction, ménages, forme, jardin, fusion et graine locale'}</label><textarea id="subdivision-json" spellcheck="false">${esc(JSON.stringify(saved??placeholder,null,2))}</textarea><p class="hint">${kind==='quarter'?'Clés : culture, tissue, density, role, wealth, shape, deleted, salt.':'Clés : role, function, households, shape, deleted (merge ou garden), salt.'} Les coordonnées de shape sont en mètres.</p><button id="subdivision-apply">Appliquer & reconstruire le lieu</button><button id="subdivision-reset" class="quiet small">Hériter à nouveau</button>`:''}</div>`);
    if(nativeId){
      const apply=(value:QuarterOverride|ParcelOverride|undefined)=>{
        const backend=settings.urban?.backend??'rust',local={...settings.urban?.local},scope={...local[settlement.key]};
        if(mapKey==='quarters'){scope.layout={...scope.layout,overrides:{...scope.layout?.overrides,quarters:{...scope.layout?.overrides?.quarters,[nativeId]:value as QuarterOverride}}};}
        else{scope.parcels={...scope.parcels,overrides:{...scope.parcels?.overrides,parcels:{...scope.parcels?.overrides?.parcels,[nativeId]:value as ParcelOverride}}};}
        local[settlement.key]=scope;const next={...settings,urban:{...settings.urban,backend,local}};validateSettings(next);settings=next;touchRecipe();const stage=world?.stats[`v2.urbanStage:${settlement.key}`] as V2TownStage|undefined;void generate('town',settlement.key,stage??(kind==='parcel'?'parcels':'layout'));
      };
      insertHTML($('#subdivision-json'),'beforebegin','<div id="subdivision-controls"></div>');
      inspectorForms.push(mountUrbanControls($('#subdivision-controls'),()=>settings,()=>{touchRecipe();const local=settings.urban?.local?.[settlement.key];$<HTMLTextAreaElement>('#subdivision-json').value=JSON.stringify(kind==='quarter'?local?.layout?.overrides?.quarters?.[nativeId]:local?.parcels?.overrides?.parcels?.[nativeId],null,2);},{kind,key:settlement.key,id:nativeId,defaults:{shape:kind==='quarter'?(item as typeof urban.quarters[number]).poly:{outer:(item as typeof urban.parcels[number]).poly,holes:[]}}}));
      $('#subdivision-apply').onclick=()=>{try{apply(JSON.parse($<HTMLTextAreaElement>('#subdivision-json').value));}catch(e){toast(String(e),true);}};
      $('#subdivision-reset').onclick=()=>{try{apply(undefined);}catch(e){toast(String(e),true);}};
    }
    $('#building-inspector').scrollIntoView({block:'nearest',behavior:'smooth'});return true;
  }
  return false;
}

document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-option]').forEach(input=>input.addEventListener('change',()=>{
  const key=input.dataset.option!, value=input instanceof HTMLInputElement && input.type==='number' ? (input.value===''?undefined:input.valueAsNumber):input.value;
  if (typeof value==='number'&&!Number.isFinite(value)) return;
  if (key.startsWith('center.')) { const axis=key.endsWith('x')?'x':'y'; if(value===undefined)delete settings.options.center;else settings.options.center={...(settings.options.center??{x:adaptedExtent(settings)/2,y:adaptedExtent(settings)/2}),[axis]:value}; }
  else (settings.options as unknown as Record<string,unknown>)[key]=value;
  touchRecipe();
}));
$('#random-seed').onclick=()=>{settings.options.seed=Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(36)).join('-');mods=[];touchRecipe();syncControls();};
$<HTMLInputElement>('#town-count').onchange=e=>{settings.settlementCount=Number((e.target as HTMLInputElement).value);if(settings.region?.placement){delete settings.region.placement.counts;settings.region.placement.mode='counts';}touchRecipe();regionControls.sync();};
$('#tab-terrain').onclick=()=>selectTab('terrain');$('#tab-settlements').onclick=()=>selectTab('settlements');
$('#generate-region').onclick=()=>void generate('terrain');$('#terrain-only').onclick=()=>void generate('terrain');$('#region-only').onclick=()=>void generate('region');$('#towns-only').onclick=()=>void generate('towns');
$('#cancel-job').onclick=()=>{cancelled=true;client.cancel();const local=settings.runtime?.backend==='native'||settings.runtime?.source==='neural-python'||settings.urban?.backend==='native';const message=local?'Attente annulée. La carte précédente est conservée ; le service local peut terminer son calcul en arrière-plan.':'Calcul annulé. La carte précédente est conservée.';log(message);setBusy(false);toast(message);};
$('#zoom-in').onclick=()=>client.viewer.zoomBy(1.5);$('#zoom-out').onclick=()=>client.viewer.zoomBy(1/1.5);$('#fit-map').onclick=()=>client.viewer.fit();
$<HTMLSelectElement>('#map-style').onchange=e=>{const style=(e.target as HTMLSelectElement).value as TerrainStyle;settings.appearance={...settings.appearance,style:isMapStyle(style)?style:settings.appearance?.style??settings.options.style,terrainStyle:style,...(!isMapStyle(style)?{renderer:'bench' as const}:{})};if(settings.appearance.city)delete settings.appearance.city.ground;projectRevision++;$<HTMLSelectElement>('#export-style').value=style;void refreshAppearance();};
for(const key of ['contours','landuse','labels'] as const)$<HTMLInputElement>(`#display-${key}`).onchange=e=>{const value=(e.target as HTMLInputElement).checked;settings.appearance={style:settings.options.style,...settings.appearance,[key]:value};projectRevision++;void refreshAppearance();};
$('#mobile-toggle').onclick=()=>{const closed=$('#sidebar').classList.toggle('mobile-closed');$('#mobile-toggle').setAttribute('aria-expanded',String(!closed));};
let pointerStart={x:0,y:0};$('#map').addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};});
$('#map').addEventListener('click',e=>{
  if(!world || busy || (!pendingRegionPosition&&!$<HTMLInputElement>('#inspect-mode').checked) || Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5)return;
  const rect=$('#map').getBoundingClientRect(),[x,y]=screenToWorld(client.viewer.getView(),rect.width,rect.height,e.clientX-rect.left,e.clientY-rect.top),p={x,y};
  if(pendingRegionPosition){const spec=settings.region?.placement?.list?.find(spec=>spec.key===pendingRegionPosition);if(spec){spec.position={x:Math.max(0,Math.min(world.mapSize,x)),y:Math.max(0,Math.min(world.mapSize,y))};touchRecipe();regionControls.sync();}pendingRegionPosition=undefined;toast(getLanguage()==='fr'?'Position enregistrée. Relancez les implantations.':'Position saved. Run placement to apply it.');return;}
  const target=$<HTMLSelectElement>('#inspect-target').value;
  if(target==='quarter'||target==='parcel'){if(!inspectSubdivision(target,p))toast('Aucune géométrie à cet endroit. Construisez d’abord cette étape.');return;}
  const hit=buildingAt(world,p); if(hit){showBuilding(hit);return;} const town=nearestSettlement(world,p);if(town)showInspector(town.key);else toast('Sélectionnez un lieu ou une maison. Zoomez pour accéder aux bâtiments.');
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>{$<HTMLDialogElement>(`#${b.dataset.close}`).close();});
$('#import-open').onclick=()=>dialog('#import-dialog');$('#heightmap-import-quick').onclick=()=>dialog('#import-dialog');$('#export-open').onclick=()=>{dialog('#export-dialog');};
$('#expert-open').onclick=()=>{ const clone=structuredClone(settings);delete clone.options.importedHeight;$<HTMLTextAreaElement>('#expert-json').value=JSON.stringify(clone,null,2);setText($('#expert-error'), '');dialog('#expert-dialog'); };
$('#expert-apply').onclick=()=>{try{const next=JSON.parse($<HTMLTextAreaElement>('#expert-json').value);if(settings.options.importedHeight)next.options.importedHeight=settings.options.importedHeight;validateSettings(next);settings=next;touchRecipe();syncControls();$<HTMLDialogElement>('#expert-dialog').close();toast('Recette appliquée. Lancez la génération souhaitée.');}catch(e){setText($('#expert-error'), String(e));}};
$<HTMLInputElement>('#project-file').onchange=async e=>{
  const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file||busy)return;
  setBusy(true);$<HTMLButtonElement>('#cancel-job').disabled=true;setText($('#progress-label'), 'Lecture & préparation du projet…');setText($('#progress-time'), '');
  try{
    if(file.size>200*1024*1024)throw new Error('Projet trop volumineux (maximum 200 Mio).');
    const text=await file.text(),scope=$<HTMLSelectElement>('#import-scope').value;
    const project=scope==='complete'?await projectJob<{settings:V2Settings;world?:World;mods:unknown[]}>({action:'parse',text}):await composeJob({scope,text,current:settings,world:pristine??world,mods});
    const connections={localServer:settings.runtime?.localServer??bootRuntime.localServer,pythonServer:settings.runtime?.pythonServer??bootRuntime.pythonServer};
    if(connectLocal&&project.settings.runtime)project.settings.runtime={...project.settings.runtime,...connections};
    client.invalidateRetained();settings=project.settings;mods=project.mods;pristine=project.world;world=pristine?applyBuildingEdits(pristine,mods).world:undefined;
    touchRecipe();await syncControls();
    if(world){await client.show(world);canvas.hidden=false;$('#empty-map').hidden=true;updateWorld();const notice=world.stats['v2.compositionNotice'];if(notice)toast(String(notice));}
    else {await client.clear();city3d?.dispose();city3d=undefined;setText($('#view3d'),'3D');$('#view3d').setAttribute('aria-pressed','false');$('#capture3d').hidden=true;canvas.hidden=true;$('#empty-map').hidden=false;setText($('#map-name'), 'Une nouvelle recette');setText($('#map-subtitle'), 'Génération du territoire à lancer');setText($('#map-size'), '—');setHTML($('#settlement-list'), '<p class="hint">Créez la région pour retrouver les lieux de cette recette.</p>');$('#inspector').hidden=true;toast('Recette chargée. Créez la région pour la reconstruire.');}
    $<HTMLDialogElement>('#import-dialog').close();log(`Import ${scope} : ${file.name}`);
  }catch(e){reportAppearanceError(e);}finally{input.value='';setBusy(false);}
};
$<HTMLInputElement>('#heightmap-file').onchange=async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{const image=await readHeightmap(file);settings.options.importedHeight=image;if(settings.terrain){delete settings.terrain.sketch;delete settings.terrain.zones;}settings.options.heightScale??=120;settings.options.importSea??=0;setText($('#import-height-info'), `${file.name} · ${image.w} × ${image.h} px`);touchRecipe();syncControls();toast('Heightmap prête. Ajustez les altitudes puis créez la topographie.');}catch(e){toast(String(e),true);}finally{input.value='';}};
$('#clear-heightmap').onclick=()=>{delete settings.options.importedHeight;if(settings.terrain){delete settings.terrain.sketch;delete settings.terrain.zones;}terrainControls.sync();setText($('#import-height-info'), 'Aucune heightmap importée.');touchRecipe();};

function projectJob<T>(request:unknown):Promise<T>{const worker=new ProjectWorker();return new Promise<T>((resolve,reject)=>{worker.onmessage=({data})=>{worker.terminate();if(data.error)reject(new Error(data.error));else resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage(request);});}
function composeJob(request:unknown):Promise<{settings:V2Settings;world?:World;mods:unknown[]}>{const worker=new ComposeWorker();return new Promise((resolve,reject)=>{worker.onmessage=({data})=>{worker.terminate();if(data.error)reject(new Error(data.error));else resolve(data.result);};worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage(request);});}
function download(blob: Blob,name: string): void { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
async function svgExport(): Promise<Blob> {
  const layers=Object.fromEntries(Array.from(document.querySelectorAll<HTMLInputElement>('[data-layer]')).map(c=>[c.dataset.layer,c.checked]));
  const style=$<HTMLSelectElement>('#export-style').value as TerrainStyle,width=Number($<HTMLSelectElement>('#export-resolution').value);
  const appearance={style:settings.options.style,...settings.appearance,terrainStyle:style};
  if(isMapStyle(style))appearance.style=style;
  if(appearance.renderer!=='classic'&&(appearance.renderer==='bench'||!isMapStyle(style)||world?.debug?.v2RustCities)){
    const image=await client.exportBench({...settings,appearance},width,layers);
    return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}" data-style="${style}" data-rendering="embedded-raster"><image width="${width}" height="${width}" href="${image.toDataURL('image/png')}"/></svg>`],{type:'image/svg+xml'});
  }
  const display=appearanceDisplayOptions({...settings,appearance});
  const brushes=appearance.painted?(await import('../render/assets/brushAssets')).BRUSH_SOURCES:undefined;
  const worker=new ExportWorker();
  try { return await new Promise<Blob>((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.blob);worker.onerror=e=>reject(new Error(e.message));worker.postMessage({id:1,world,options:{width,style:appearance.style,layers},display,brushes});}); }finally{worker.terminate();}
}
function heightmapBlob(): Promise<Blob> {
  if(!world)throw new Error('Créez d’abord une carte.');const grid=world.terrain.height,c=document.createElement('canvas');c.width=grid.w;c.height=grid.h;
  const ctx=c.getContext('2d')!,pixels=ctx.createImageData(grid.w,grid.h);let lo=Infinity,hi=-Infinity;for(const value of grid.data){lo=Math.min(lo,value);hi=Math.max(hi,value);}
  for(let i=0;i<grid.data.length;i++){const value=Math.round(255*(grid.data[i]-lo)/Math.max(1e-9,hi-lo));pixels.data.set([value,value,value,255],i*4);}ctx.putImageData(pixels,0,0);log(`Heightmap 8 bits : noir ${lo.toFixed(3)} m, blanc ${hi.toFixed(3)} m. Projet JSON pour conserver FP32.`);
  download(new Blob([JSON.stringify({format:'magna-urbis-heightmap',version:1,width:grid.w,height:grid.h,mapSize:world.mapSize,minHeight:lo,maxHeight:hi,seed:world.seed},null,2)],{type:'application/json'}),'magna-urbis-heightmap.metadata.json');
  return new Promise((resolve,reject)=>c.toBlob(blob=>blob?resolve(blob):reject(new Error('Échec de l’encodage heightmap.')),'image/png'));
}
$<HTMLSelectElement>('#export-format').onchange=e=>{const format=(e.target as HTMLSelectElement).value;$('#export-map-options').hidden=!['png','svg'].includes(format);setText($('#export-note'), format==='heightmap'?'PNG en 256 niveaux, accompagné des altitudes min/max. Le projet JSON conserve les grilles FP32 exactes.':format==='recipe'?'La recette conserve paramètres et modifications. Même version du moteur nécessaire pour une reproduction fidèle.':format==='seed'?'La graine seule ne contient ni vos paramètres ni vos modifications.':'Les exports visuels utilisent la carte actuelle, sans relancer la génération.');};
$('#export-go').onclick=async()=>{
  if(busy)return;const format=$<HTMLSelectElement>('#export-format').value;
  if(!world&&!['recipe','seed'].includes(format)){toast('Créez d’abord une carte.');return;}
  $<HTMLButtonElement>('#export-go').disabled=true;
  try {
    const name=`magna-urbis-${settings.options.seed.replace(/[^\w-]/g,'_').slice(0,45)}`;
    if(format==='project'||format==='recipe'){download(await projectJob<Blob>({action:'serialize',settings:format==='recipe'&&world?{...settings,extent:world.mapSize,options:{...settings.options,mapSize:world.mapSize}}:settings,world:format==='project'?(pristine??world):undefined,mods}),`${name}.${format}.json`);}
    else if(format==='seed'){download(new Blob([JSON.stringify({format:'magna-urbis-v2-seed',version:1,seed:settings.options.seed})],{type:'application/json'}),`${name}.seed.json`);}
    else if(format==='heightmap')download(await heightmapBlob(),`${name}.heightmap.png`);
    else {toast('Préparation des couches de la carte…');let blob=await svgExport();let dimensions:{width:number;height:number}|number=Number($<HTMLSelectElement>('#export-resolution').value);if($<HTMLInputElement>('#export-crop').checked){const cropped=await chooseExportCrop(blob,Number(dimensions),bindTree);if(!cropped)return;blob=cropped.blob;dimensions={width:cropped.width,height:cropped.height};}if(format==='png')blob=await exportPng(blob,dimensions,phase=>log(`Export PNG : ${phase}`));download(blob,`${name}.${format}`);}
    log(`Export : ${format}`);toast('Export téléchargé.');$<HTMLDialogElement>('#export-dialog').close();
  }catch(e){toast(String(e),true);}finally{$<HTMLButtonElement>('#export-go').disabled=false;}
};
async function inspectHardware():Promise<void>{
  setText($('#hardware-details'), 'Détection des moteurs…');
  try {capabilities=await detectPlatform({...runtimeOptions(),profile:connectLocal?'local':'web',localServer:settings.runtime?.localServer??bootRuntime.localServer,pythonServer:settings.runtime?.pythonServer??bootRuntime.pythonServer,onProgress:p=>log(p.message)});const caps=capabilities;
    setText($('#hardware-caption'), caps.local.available?'Rust local':caps.webgpu?'CPU / GPU':'CPU');
    setHTML($('#hardware-details'), `<div class="hardware-row row spread"><div>CPU · navigateur<small>Génération dans un worker dédié</small></div><span class="capability-state">Disponible</span></div><div class="hardware-row row spread"><div>GPU · WebGPU<small>${esc(caps.adapterName??'Accélération des étapes compatibles')}</small></div><span class="capability-state">${caps.webgpu?'Détecté':'Indisponible'}</span></div><div class="hardware-row row spread"><div>Rust natif<small>${esc(caps.local.server)}</small></div><span class="capability-state">${caps.local.available?'Connecté':localEdition?'Hors ligne':'Édition locale'}</span></div><div class="hardware-row row spread"><div>Python · modèles neuronaux<small>${esc(caps.python.backend??'Modèle local externe')}</small></div><span class="capability-state">${caps.python.available?(caps.python.loaded?'Modèle chargé':'Connecté'):localEdition?'Hors ligne':'Édition locale'}</span></div><p class="hint" style="margin-top:13px">CPU procédural disponible dans les deux éditions. Les modèles neuronaux actuels exigent WebGPU ou CUDA. Les téléchargements et chargements sont signalés dans le journal.</p>`);
  }catch(e){setText($('#hardware-details'), String(e));}
}
$('#hardware-open').onclick=()=>{dialog('#hardware-dialog');if(!capabilities)void inspectHardware();};$('#hardware-refresh').onclick=()=>void inspectHardware();
$('#services-apply').onclick=()=>{try{const localServer=loopbackServer($<HTMLInputElement>('#rust-server').value),pythonServer=loopbackServer($<HTMLInputElement>('#python-server').value);settings.runtime={compute:'auto',backend:'rust',source:'procedural',...settings.runtime,localServer,pythonServer};connectLocal=true;touchRecipe();syncControls();void inspectHardware();}catch(e){toast(String(e),true);}};
window.addEventListener('beforeunload',()=>{clearTimeout(renderTimer);renderControls.dispose();city3d?.dispose();terrainControls.dispose();urbanControls.dispose();regionControls.dispose();disposeInspectorForms();client.destroy();});
insertHTML($('.header-tools'),'afterbegin',`<label class="language-control"><span class="sr-only">Language</span><select id="language-select" aria-label="Language"><option value="en">English</option><option value="fr">Français</option></select></label>`);
$<HTMLSelectElement>('#language-select').onchange=event=>setLanguage((event.target as HTMLSelectElement).value as 'en'|'fr');
onLanguageChange(()=>{renderLog();document.querySelectorAll<HTMLOptGroupElement>('optgroup[data-render-label]').forEach(group=>group.label=translate(group.dataset.renderLabel!));renderControls.sync();});
initializeLanguage();
syncControls();
await client.init();
void inspectHardware();
// Keep source, dimensions and coasts editable before the first generation.
