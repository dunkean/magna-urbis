import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { TerrainSketch } from '../../../rust/bridge/terrainSketch';
import { applyTerrainModification } from '../../../rust/bridge/terrainModification';
import { readHeightmap, heightmapPng } from '../ui/terrainHeightmap';
import { nativeTerrainOf, nativeTerrainLayer } from './nativeProducts';
import { adaptedExtent } from './settings';
import { onLanguageChange, registerMessages, setHTML, setText } from './i18n';
import { paintHeight, transformHeight, grayscaleHeight, terrainPaintDetail, type HeightBrush, type PaintBrush } from './reliefPaint';
import './terrainSketchControls.css';

export interface TerrainSketchContext { getWorld(): World | undefined; onApply(): void }
export type ReliefEditorKind = 'draw' | 'modify';
interface Bindings { getSettings(): V2Settings; onChange(): void; disabled?: () => boolean; context?: TerrainSketchContext }
type State = { heights: Float32Array; dirty: boolean; n: number; original: Float32Array; range: { min: number; max: number }; hasTerrain: boolean; sourceWidth: number; resetLayer: boolean };
const words: Record<string, string> = {
  'Edit relief': 'Éditer le relief', 'Close': 'Fermer', 'Editing modes': 'Modes d’édition', 'How editing works': 'Comment fonctionne l’édition',
  'Paint zones': 'Peindre des zones', 'Sculpt elevations': 'Sculpter les altitudes', 'Sculpt + erode': 'Sculpter + éroder',
  'Brush': 'Pinceau', 'Pan': 'Déplacer la vue', 'Undo': 'Annuler', 'Redo': 'Rétablir', 'Fit': 'Cadrer',
  'Zoom in': 'Zoom avant', 'Zoom out': 'Zoom arrière', 'Tools': 'Outils', 'Sea': 'Mer', 'Plain': 'Plaine', 'Hills': 'Collines',
  'Mountains': 'Montagnes', 'High mountains': 'Hautes montagnes', 'Eraser': 'Gomme',
  'Raise': 'Monter', 'Lower': 'Creuser', 'Level': 'Altitude fixe', 'Smooth': 'Adoucir', 'Restore': 'Restaurer',
  'Radius (% of map)': 'Rayon (% de la carte)', 'Soft edge (%)': 'Bord doux (%)', 'Height per dab (m)': 'Hauteur par touche (m)',
  'Target elevation (m)': 'Altitude visée (m)', 'Overlay opacity (%)': 'Opacité du masque (%)', 'Show terrain underneath': 'Afficher le relief en dessous',
  'Clear zones': 'Effacer les zones', 'Restore initial elevations': 'Restaurer les altitudes initiales',
  'Adjust the whole heightmap': 'Ajuster toute la heightmap', 'Vertical scale ×': 'Échelle verticale ×', 'Datum shift (m)': 'Décalage du datum (m)',
  'Central crop (%)': 'Recadrage central (%)', 'Apply adjustment': 'Appliquer l’ajustement',
  'Files': 'Fichiers', 'Import zones': 'Importer des zones', 'Export zones': 'Exporter les zones', 'Export PNG · 16 bits': 'Exporter PNG · 16 bits',
  'Cancel': 'Annuler', 'Keep drawing': 'Conserver le dessin', 'Generate relief': 'Générer le relief',
  'Terrain paint canvas': 'Plan de travail du relief', 'Unsaved drawing': 'Dessin à conserver', 'Drawing saved': 'Dessin conservé',
  'No terrain yet · paint on an empty canvas.': 'Aucun relief pour le moment · peignez sur une feuille vide.',
  '8-bit view · elevations are kept in metres.': 'Vue 8 bits · les altitudes sont conservées en mètres.',
  'Zones guide the next generation; colours are terrain types, not elevations. Unpainted areas remain automatic.': 'Les zones guident la prochaine génération : les couleurs sont des types de terrain, pas des altitudes. Les zones non peintes restent automatiques.',
  'Elevations are changed directly. Generation keeps the painted surface, then calculates water.': 'Les altitudes sont modifiées directement. La génération conserve la surface peinte, puis calcule l’eau.',
  'Elevations are changed directly, then erosion reshapes them before water is calculated.': 'Les altitudes sont modifiées directement, puis l’érosion les retravaille avant le calcul de l’eau.',
  'The eraser removes zone instructions. Restore returns sculpted cells to the terrain present when this window opened.': 'La gomme retire les instructions de zone. Restaurer remet les cellules sculptées à l’altitude présente à l’ouverture de cette fenêtre.',
  'Changing modes does not paint or generate. Keep drawing saves the recipe; Generate relief applies it to the map. Cancel discards changes in this window.': 'Changer de mode ne peint ni ne génère. Conserver le dessin enregistre la recette ; Générer le relief l’applique à la carte. Annuler abandonne les changements de cette fenêtre.',
  'Zone file is too large': 'Fichier de zones trop volumineux',
  'Use generated relief as global source': 'Utiliser le relief généré comme source globale',
  'Draw relief': 'Dessiner le relief', 'Modify relief': 'Modifier le relief', 'Reset': 'Réinitialiser',
  'Drawing base': 'Dessin de base', 'Relief modifications': 'Retouches du relief',
  'Draw a broad shape. Procedural noise and erosion create the final natural terrain from this base.': 'Dessinez les grandes formes. Le bruit procédural et l’érosion créent le relief naturel final à partir de cette base.',
  'Modify the generated terrain. Fine noise is preserved; changes are stored in a separate removable layer.': 'Retouchez le terrain généré. Le bruit fin est conservé ; les changements sont enregistrés dans un calque séparé que vous pouvez supprimer.',
  'Reset clears this drawing and its dependent modifications. Save or generate to return to automatic procedural terrain.': 'Réinitialiser efface ce dessin et les retouches qui en dépendent. Conservez ou générez pour retrouver le terrain procédural automatique.',
  'Reset clears the modification layer and restores the generated terrain underneath. Save or generate to remove all saved edits.': 'Réinitialiser met le calque de retouches à zéro et retrouve le terrain généré en dessous. Conservez ou générez pour supprimer les retouches enregistrées.',
  'Keep drawing saves your changes. Generate relief applies them to the map. Cancel discards this draft.': 'Conserver le dessin enregistre les changements. Générer le relief les applique à la carte. Annuler abandonne ce brouillon.',
  'Reset drawing': 'Réinitialiser le dessin', 'Clear modifications': 'Effacer les retouches',
  'Keep modifications': 'Conserver les retouches', 'Modifications to save': 'Retouches à conserver', 'Modifications saved': 'Retouches enregistrées',
};
registerMessages(Object.fromEntries(Object.entries(words).map(([en, fr]) => [en, { en, fr }])));
const paths: Record<string, string> = {
  brush: 'm5 15 9-9 4 4-9 9H5v-4Zm8-8 4 4M4 21h16', pan: 'M9 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-3 7-7 7h-2l-7-7a2 2 0 0 1 3-3l2 2',
  raise: 'M12 20V4m-6 6 6-6 6 6M4 20h16', lower: 'M12 4v16m-6-6 6 6 6-6M4 4h16', level: 'M3 12h18M6 7h12M6 17h12',
  smooth: 'M2 16c4 0 3-10 7-10s3 10 7 10 3-5 6-5', restore: 'M4 10a8 8 0 1 1 1 9M4 3v7h7',
  erase: 'm4 14 9-10 8 7-9 10H8l-4-4v-3Zm5-5 8 7M12 21h9', undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14', redo: 'm16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', fit: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] ?? paths.brush}"/></svg>`;

/** Dedicated V2 mini-paint. Only save/generate commits the dialog's draft to the recipe. */
export function mountTerrainSketchControls(root: HTMLElement, b: Bindings): { sync(): void; open(kind?: ReliefEditorKind): void; dispose(): void } {
  root.classList.add('relief-paint-host');
  setHTML(root, `<button type="button" data-id="edit" hidden>Edit relief</button><input data-id="file" type="file" accept=".json,.png,application/json,image/png" hidden>
    <dialog class="relief-paint" id="relief-paint-dialog" aria-labelledby="relief-paint-title">
      <header class="relief-paint-head"><h2 id="relief-paint-title">Edit relief</h2><button type="button" data-action="help" class="paint-help-button" aria-label="How editing works" aria-expanded="false" aria-controls="relief-paint-help">?</button><button type="button" data-action="close" aria-label="Close">×</button></header>
      <section id="relief-paint-help" class="paint-help" hidden><h3>How editing works</h3><p><strong>Draw relief</strong> — <span>Draw a broad shape. Procedural noise and erosion create the final natural terrain from this base.</span></p><p><strong>Modify relief</strong> — <span>Modify the generated terrain. Fine noise is preserved; changes are stored in a separate removable layer.</span></p><p data-reset-help></p><p>Keep drawing saves your changes. Generate relief applies them to the map. Cancel discards this draft.</p></section>
      <p class="paint-mode-description" data-description></p>
      <div class="relief-paint-body"><section class="paint-workspace"><div class="paint-view-toolbar"><button type="button" data-action="brush" aria-pressed="true">${icon('brush')}<span>Brush</span></button><button type="button" data-action="pan" aria-pressed="false">${icon('pan')}<span>Pan</span></button><span class="paint-toolbar-gap"></span><button type="button" data-action="undo" aria-label="Undo" title="Undo">${icon('undo')}</button><button type="button" data-action="redo" aria-label="Redo" title="Redo">${icon('redo')}</button><button type="button" data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button><output data-zoom>100%</output><button type="button" data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-action="fit" title="Fit">${icon('fit')}</button></div><div class="paint-viewport"><div class="paint-surface"><canvas class="paint-base" width="512" height="512"></canvas><canvas class="paint-overlay" width="512" height="512" tabindex="0" aria-label="Terrain paint canvas"></canvas></div><div class="paint-cursor" hidden></div><p class="paint-empty" hidden>No terrain yet · paint on an empty canvas.</p></div><div class="paint-readout"><span data-height-range></span><span>8-bit view · elevations are kept in metres.</span></div></section>
      <aside class="paint-toolbox"><h3>Tools</h3><div class="paint-zone-tools" role="group" aria-label="Drawing base"></div><div class="paint-height-tools" role="group" aria-label="Modify relief"></div>
      <label>Radius (% of map)<span class="paint-slider"><input data-control="radius" type="range" min="1" max="30" value="8"><output>8</output></span></label><label>Soft edge (%)<span class="paint-slider"><input data-control="softness" type="range" min="1" max="100" value="60"><output>60</output></span></label>
      <label data-height-control>Height per dab (m)<span class="paint-slider"><input data-control="strength" type="range" min="1" max="500" value="50"><output>50</output></span></label><label data-target-control>Target elevation (m)<input data-control="target" type="number" min="-12000" max="12000" value="300"></label>
      <button type="button" data-action="reset-height">${icon('restore')}<span>Reset</span></button>
      <details class="paint-transform"><summary>Adjust the whole heightmap</summary><label>Vertical scale ×<input data-control="scale" type="number" min=".05" max="10" step=".05" value="1"></label><label>Datum shift (m)<input data-control="datum" type="number" min="-5000" max="5000" value="0"></label><label>Central crop (%)<input data-control="crop" type="number" min="25" max="100" value="100"></label><button type="button" data-action="transform">Apply adjustment</button></details>
      <details class="paint-files"><summary>Files</summary><button type="button" data-action="export-png">Export PNG · 16 bits</button></details></aside></div>
      <footer class="relief-paint-footer"><output data-id="state" role="status"></output><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save">Keep drawing</button><button type="button" class="primary" data-id="apply">Generate relief</button></footer>
    </dialog>`);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const dialog = $<HTMLDialogElement>('dialog'), viewport = $('.paint-viewport'), surface = $('.paint-surface');
  const base = $<HTMLCanvasElement>('.paint-base'), overlay = $<HTMLCanvasElement>('.paint-overlay'), cursor = $('.paint-cursor');
  const baseCtx = base.getContext('2d')!, overlayCtx = overlay.getContext('2d')!, state = $('[data-id="state"]');
  let tool: HeightBrush = 'raise', zone = 3, pan = false, n = 128, original: Float32Array = new Float32Array(n * n), heights: Float32Array = original.slice();
  let range = { min: -100, max: 1000 }, hasTerrain = false, dirty = false, available = true, zoom = 1, ox = 0, oy = 0, size = 512;
  let sourceWidth = adaptedExtent(b.getSettings());
  let kind: ReliefEditorKind='modify', resetLayer=false, detail:Float32Array|undefined;
  let lastFocus: HTMLElement | null = null, pointer: number | undefined, previous: [number, number] | undefined, dragging = false, strokeChanged = false;
  const past: State[] = [], future: State[] = [];
  const input = (key: string) => $<HTMLInputElement>(`[data-control="${key}"]`), numeric = (key: string) => Number(input(key).value);
  const brush = (): PaintBrush => ({ radius: numeric('radius') / 100, softness: numeric('softness') / 100, strength: numeric('strength'), target: numeric('target') });
  const capture = (): State => ({ heights: heights.slice(), dirty, n, original, range, hasTerrain, sourceWidth, resetLayer });
  const remember = () => { past.push(capture()); future.length = 0; while (past.length > 1 && (past.length > 20 || past.reduce((sum,s)=>sum+s.heights.byteLength,0)>64*1048576)) past.shift(); };
  const statusLabel=()=>kind==='draw'?(dirty?'Unsaved drawing':'Drawing saved'):(dirty?'Modifications to save':'Modifications saved');
  const restore = (s: State) => { heights=s.heights; dirty=s.dirty; n=s.n; original=s.original; range=s.range; hasTerrain=s.hasTerrain; sourceWidth=s.sourceWidth; resetLayer=s.resetLayer; setText(state,statusLabel()); draw(); };
  const mark = () => { dirty = true; setText(state,statusLabel()); };
  ['Sea','Plain','Hills','Mountains','High mountains','Eraser'].forEach((name,index) => {
    const button=document.createElement('button'); button.type='button'; button.dataset.zone=String(index===5?-1:index);
    setHTML(button, `${index===5?icon('erase'):`<span class="paint-zone-art paint-zone-art-${index}" aria-hidden="true"></span>`}<span>${name}</span>`);
    button.onclick=()=>{zone=index===5?-1:index;tool='level';input('target').value=String([-50,10,120,600,1400,0][index]);pan=false;draw();}; $('.paint-zone-tools').append(button);
  });
  (['raise','lower','level','smooth','restore'] as const).forEach(name=>{
    const button=document.createElement('button');button.type='button';button.dataset.heightTool=name;
    setHTML(button,`${icon(name)}<span>${name[0].toUpperCase()+name.slice(1)}</span>`);button.onclick=()=>{tool=name;pan=false;draw();};$('.paint-height-tools').append(button);
  });
  function load(): void {
    const settings=b.getSettings(),world=b.context?.getWorld(),native=nativeTerrainOf(world),physical=native?.modificationBase??nativeTerrainLayer(world)?.v2ModificationBase??native?.physical;
    let values: ArrayLike<number>|undefined;
    sourceWidth=adaptedExtent(settings);
    if(kind==='draw'){const drawing=settings.terrain?.drawing;n=drawing?.resolution??128;values=drawing?.heights;}
    else if(physical){n=physical.n;values=physical.height;sourceWidth=world!.mapSize;}
    else if(world){n=world.terrain.height.w;values=world.terrain.height.data;sourceWidth=world.mapSize;}
    else n=128;
    hasTerrain=!!values;original=values?Float32Array.from(values):new Float32Array(n*n);heights=original.slice();
    if(kind==='modify'&&settings.terrain?.modification)heights=applyTerrainModification(original,n,settings.terrain.modification);
    detail=kind==='modify'?terrainPaintDetail(original,n):undefined;
    resetLayer=false;tool='raise';
    let min=Infinity,max=-Infinity;for(const h of original){min=Math.min(min,h);max=Math.max(max,h);}
    range=hasTerrain&&max>min?{min,max}:{min:Math.min(-100,min-100),max:Math.max(1000,max+100)};
    dirty=false;past.length=future.length=0;zoom=1;ox=oy=0;pan=false;pointer=undefined;setText(state,statusLabel());
    setText($('#relief-paint-title'),kind==='draw'?'Draw relief':'Modify relief');
    setText($('[data-action="reset-height"] span'),kind==='draw'?'Reset drawing':'Clear modifications');
    setText($('[data-action="save"]'),kind==='draw'?'Keep drawing':'Keep modifications');
    setText($('[data-reset-help]'),kind==='draw'?'Reset clears this drawing and its dependent modifications. Save or generate to return to automatic procedural terrain.':'Reset clears the modification layer and restores the generated terrain underneath. Save or generate to remove all saved edits.');
  }
  function view(): void {
    size=Math.max(1,Math.min(viewport.clientWidth,viewport.clientHeight)-24);
    Object.assign(surface.style,{width:`${size}px`,height:`${size}px`,left:`${(viewport.clientWidth-size)/2+ox}px`,top:`${(viewport.clientHeight-size)/2+oy}px`,transform:`scale(${zoom})`});
    $('[data-zoom]').textContent=`${Math.round(zoom*100)}%`;
  }
  function draw(): void {
    if(!dialog.open)return;view();
    const gray=baseCtx.createImageData(512,512);gray.data.set(grayscaleHeight(heights,n,range.min,range.max,512));baseCtx.putImageData(gray,0,0);
    overlayCtx.clearRect(0,0,512,512);
    $('.paint-empty').hidden=hasTerrain||dirty;$('[data-height-range]').textContent=`${Math.round(range.min)} → ${Math.round(range.max)} m · ${n} × ${n}`;
    root.querySelectorAll<HTMLButtonElement>('[data-zone]').forEach(el=>el.setAttribute('aria-pressed',String(tool==='level'&&Number(el.dataset.zone)===zone)));
    root.querySelectorAll<HTMLButtonElement>('[data-height-tool]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.heightTool===tool)));
    $('.paint-zone-tools').hidden=kind!=='draw';$('.paint-height-tools').hidden=false;
    $('[data-height-control]').hidden=!['raise','lower'].includes(tool);$('[data-target-control]').hidden=tool!=='level';
    $<HTMLButtonElement>('[data-action="undo"]').disabled=!past.length;$<HTMLButtonElement>('[data-action="redo"]').disabled=!future.length;
    $('[data-action="brush"]').setAttribute('aria-pressed',String(!pan));$('[data-action="pan"]').setAttribute('aria-pressed',String(pan));overlay.style.cursor=pan?'grab':'crosshair';
    setText($('[data-description]'),kind==='draw'?'Draw a broad shape. Procedural noise and erosion create the final natural terrain from this base.':'Modify the generated terrain. Fine noise is preserved; changes are stored in a separate removable layer.');
  }
  function commit(generate: boolean): void {
    if(!available)return;const settings=b.getSettings();
    if(dirty){settings.terrain??={};
      if(kind==='draw'){
        delete settings.terrain.sketch;delete settings.terrain.zones;delete settings.terrain.modification;delete settings.options.importedHeight;delete settings.decor;
        if(heights.some(h=>h!==0))settings.terrain.drawing={version:1,resolution:n,heights:Array.from(heights)};else delete settings.terrain.drawing;
        settings.generation='procedural';settings.runtime={backend:'rust',compute:'auto',...settings.runtime,source:'procedural'};
      }else{
        const delta=Array.from(heights,(h,i)=>Math.fround(h-original[i]));
        if(delta.some(h=>h!==0))settings.terrain.modification={version:1,resolution:n,width:sourceWidth,delta};else delete settings.terrain.modification;
        // Old mini-paint versions saved edits as a replacement source. Reset also clears those residues.
        if(resetLayer&&!settings.terrain.drawing){delete settings.terrain.sketch;delete settings.terrain.zones;delete settings.options.importedHeight;}
      }
      b.onChange();
      if(kind==='draw'||resetLayer)root.dispatchEvent(new CustomEvent('relief-source-changed',{bubbles:true,detail:kind}));
    }
    close();if(generate)b.context?.onApply();
  }
  function open(entry:ReliefEditorKind='modify'): void {
    if(!available||dialog.open||entry==='modify'&&!b.context?.getWorld())return;kind=entry;lastFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    load();window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'relief-paint'}));dialog.showModal();draw();overlay.focus({preventScroll:true});
  }
  function close(): void {if(!dialog.open)return;pointer=undefined;cursor.hidden=true;dialog.close();lastFocus?.focus({preventScroll:true});}
  $('[data-id="edit"]').onclick=()=>open('draw');dialog.oncancel=event=>{event.preventDefault();close();};
  const actions: Record<string,()=>void>={
    close,cancel:close,save:()=>commit(false),help:()=>{const help=$('#relief-paint-help');help.hidden=!help.hidden;$('[data-action="help"]').setAttribute('aria-expanded',String(!help.hidden));},
    brush:()=>{pan=false;draw();},pan:()=>{pan=true;draw();},
    undo:()=>{if(pointer!==undefined)return;const s=past.pop();if(s){future.push(capture());restore(s);}},redo:()=>{if(pointer!==undefined)return;const s=future.pop();if(s){past.push(capture());restore(s);}},
    fit:()=>{zoom=1;ox=oy=0;view();},'zoom-in':()=>changeZoom(zoom*1.25),'zoom-out':()=>changeZoom(zoom/1.25),
    'reset-height':()=>{remember();heights=kind==='draw'?new Float32Array(n*n):original.slice();resetLayer=true;mark();draw();},
    transform:()=>{const scale=numeric('scale'),datum=numeric('datum'),crop=numeric('crop');if(!Number.isFinite(scale+datum+crop)||scale<.05||scale>10||Math.abs(datum)>5000||crop<25||crop>100)return;remember();heights=transformHeight(heights,n,scale,datum,crop);mark();draw();},
    'export-png':()=>{const s:TerrainSketch={version:1,resolution:n,heights:Array.from(heights),processing:'surface'};download(new Blob([new Uint8Array(heightmapPng(s,sourceWidth)).buffer],{type:'image/png'}),'terrain-heightmap.png');},
  };
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>{button.onclick=()=>actions[button.dataset.action!]?.();});$('[data-id="apply"]').onclick=()=>commit(true);
  function download(blob:Blob,name:string):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  for(const c of Array.from(root.querySelectorAll<HTMLInputElement>('[data-control]')))c.oninput=()=>{const output=c.parentElement?.querySelector('output');if(output)output.textContent=c.value;if(c.dataset.control==='opacity'||c.dataset.control==='underlay')draw();};
  function point(event:PointerEvent):[number,number]{const r=overlay.getBoundingClientRect();return[(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height];}
  function dab(u:number,v:number):void{paintHeight(heights,original,n,u,v,brush(),tool,detail);strokeChanged=true;}
  overlay.onpointerdown=event=>{if(!available||pointer!==undefined||![0,1].includes(event.button))return;event.preventDefault();pointer=event.pointerId;dragging=pan||event.button===1;strokeChanged=false;overlay.setPointerCapture(pointer);overlay.focus({preventScroll:true});if(dragging)previous=[event.clientX,event.clientY];else{remember();previous=point(event);dab(...previous);draw();}};
  overlay.onpointermove=event=>{
    const rect=viewport.getBoundingClientRect(),diameter=size*zoom*brush().radius*2;
    Object.assign(cursor.style,{left:`${event.clientX-rect.left}px`,top:`${event.clientY-rect.top}px`,width:`${diameter}px`,height:`${diameter}px`});cursor.hidden=pan||dragging;
    if(pointer!==event.pointerId||!previous)return;
    if(dragging){ox+=event.clientX-previous[0];oy+=event.clientY-previous[1];previous=[event.clientX,event.clientY];view();return;}
    const p=point(event),dx=p[0]-previous[0],dy=p[1]-previous[1],steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/Math.max(.002,brush().radius/3)));
    for(let k=1;k<=steps;k++)dab(previous[0]+dx*k/steps,previous[1]+dy*k/steps);previous=p;draw();
  };
  const finishStroke=(event:PointerEvent)=>{if(pointer!==event.pointerId)return;pointer=undefined;previous=undefined;dragging=false;if(strokeChanged){mark();draw();}};
  overlay.onpointerup=finishStroke;overlay.onpointercancel=finishStroke;overlay.onlostpointercapture=finishStroke;overlay.onpointerleave=()=>{cursor.hidden=true;};
  function changeZoom(next:number):void{zoom=Math.max(.5,Math.min(8,next));view();}
  viewport.addEventListener('wheel',event=>{event.preventDefault();changeZoom(zoom*(event.deltaY<0?1.15:1/1.15));},{passive:false});
  dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!(event.target as Element).closest('input')){event.preventDefault();actions[event.shiftKey?'redo':'undo']();}});
  const fileInput=$<HTMLInputElement>('[data-id="file"]');
  fileInput.onchange=async()=>{const file=fileInput.files?.[0];fileInput.value='';if(!file||b.disabled?.())return;try{
    const imported=await readHeightmap(file,-1000,4000);if(b.disabled?.())return;const s=b.getSettings();s.terrain??={};s.terrain.sketch=imported.terrain;delete s.terrain.drawing;delete s.terrain.modification;delete s.terrain.zones;delete s.options.importedHeight;delete s.decor;if(imported.width)s.extent=imported.width;
    s.terrain.sampleSpacing=Math.max(s.terrain.sampleSpacing??30,adaptedExtent(s)/imported.terrain.resolution);b.onChange();root.dispatchEvent(new CustomEvent('relief-source-changed',{bubbles:true,detail:'import'}));if(dialog.open){load();draw();}
  }catch(error){if(!dialog.open)open('draw');state.textContent=String(error);}};
  const observer=new ResizeObserver(()=>{if(dialog.open)view();});observer.observe(viewport);const unsubscribe=onLanguageChange(draw);
  function sync():void {const s=b.getSettings();available=!(b.disabled?.()??false)&&s.runtime?.backend!=='typescript';for(const id of ['relief-draw-open','relief-modify-open']){const trigger=document.getElementById(id) as HTMLButtonElement|null;if(trigger)trigger.disabled=!available||id==='relief-modify-open'&&!b.context?.getWorld();}if(dialog.open&&!available)close();}
  sync();return{sync,open,dispose:()=>{close();observer.disconnect();unsubscribe();root.replaceChildren();}};
}
