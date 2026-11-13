import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import type { TerrainSketch } from '../../../rust/bridge/terrainSketch';
import { parseTerrainZones } from '../../../rust/bridge/terrainZones';
import { readHeightmap, heightmapPng } from '../ui/terrainHeightmap';
import { importedHeightfield } from '../gen/terrain/import';
import { nativeTerrainOf } from './nativeProducts';
import { adaptedExtent } from './settings';
import { onLanguageChange, registerMessages, setHTML, setText } from './i18n';
import { paintHeight, paintZone, transformHeight, grayscaleHeight, type HeightBrush, type PaintBrush } from './reliefPaint';
import './terrainSketchControls.css';

export interface TerrainSketchContext { getWorld(): World | undefined; onApply(): void }
interface Bindings { getSettings(): V2Settings; onChange(): void; disabled?: () => boolean; context?: TerrainSketchContext }
type Mode = 'zones' | 'surface' | 'erosion';
type State = { heights: Float32Array; zones: Uint8Array; mode: Mode; dirty: boolean; n: number; original: Float32Array; range: { min: number; max: number }; hasTerrain: boolean; sourceWidth: number };
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
};
registerMessages(Object.fromEntries(Object.entries(words).map(([en, fr]) => [en, { en, fr }])));
const descriptions = [
  'Zones guide the next generation; colours are terrain types, not elevations. Unpainted areas remain automatic.',
  'Elevations are changed directly. Generation keeps the painted surface, then calculates water.',
  'Elevations are changed directly, then erosion reshapes them before water is calculated.',
];
const paths: Record<string, string> = {
  brush: 'm5 15 9-9 4 4-9 9H5v-4Zm8-8 4 4M4 21h16', pan: 'M9 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-3 7-7 7h-2l-7-7a2 2 0 0 1 3-3l2 2',
  raise: 'M12 20V4m-6 6 6-6 6 6M4 20h16', lower: 'M12 4v16m-6-6 6 6 6-6M4 4h16', level: 'M3 12h18M6 7h12M6 17h12',
  smooth: 'M2 16c4 0 3-10 7-10s3 10 7 10 3-5 6-5', restore: 'M4 10a8 8 0 1 1 1 9M4 3v7h7',
  erase: 'm4 14 9-10 8 7-9 10H8l-4-4v-3Zm5-5 8 7M12 21h9', undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14', redo: 'm16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', fit: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] ?? paths.brush}"/></svg>`;
const zoneColors = [[38,123,193],[124,190,111],[196,171,92],[161,109,73],[211,211,225]];

/** Dedicated V2 mini-paint. Only save/generate commits the dialog's draft to the recipe. */
export function mountTerrainSketchControls(root: HTMLElement, b: Bindings): { sync(): void; open(): void; dispose(): void } {
  root.classList.add('relief-paint-host');
  setHTML(root, `<button type="button" data-id="edit" hidden>Edit relief</button><input data-id="file" type="file" accept=".json,.png,application/json,image/png" hidden>
    <dialog class="relief-paint" id="relief-paint-dialog" aria-labelledby="relief-paint-title">
      <header class="relief-paint-head"><h2 id="relief-paint-title">Edit relief</h2><button type="button" data-action="help" class="paint-help-button" aria-label="How editing works" aria-expanded="false" aria-controls="relief-paint-help">?</button><button type="button" data-action="close" aria-label="Close">×</button></header>
      <div class="paint-modes" role="group" aria-label="Editing modes"><button type="button" data-mode="zones">${icon('brush')}<span>Paint zones</span></button><button type="button" data-mode="surface">${icon('raise')}<span>Sculpt elevations</span></button><button type="button" data-mode="erosion">${icon('smooth')}<span>Sculpt + erode</span></button></div>
      <section id="relief-paint-help" class="paint-help" hidden><h3>How editing works</h3>${['Paint zones','Sculpt elevations','Sculpt + erode'].map((name,i)=>`<p><strong>${name}</strong> — <span>${descriptions[i]}</span></p>`).join('')}<p>The eraser removes zone instructions. Restore returns sculpted cells to the terrain present when this window opened.</p><p>Changing modes does not paint or generate. Keep drawing saves the recipe; Generate relief applies it to the map. Cancel discards changes in this window.</p></section>
      <p class="paint-mode-description" data-description></p>
      <div class="relief-paint-body"><section class="paint-workspace"><div class="paint-view-toolbar"><button type="button" data-action="brush" aria-pressed="true">${icon('brush')}<span>Brush</span></button><button type="button" data-action="pan" aria-pressed="false">${icon('pan')}<span>Pan</span></button><span class="paint-toolbar-gap"></span><button type="button" data-action="undo" aria-label="Undo" title="Undo">${icon('undo')}</button><button type="button" data-action="redo" aria-label="Redo" title="Redo">${icon('redo')}</button><button type="button" data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button><output data-zoom>100%</output><button type="button" data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-action="fit" title="Fit">${icon('fit')}</button></div><div class="paint-viewport"><div class="paint-surface"><canvas class="paint-base" width="512" height="512"></canvas><canvas class="paint-overlay" width="512" height="512" tabindex="0" aria-label="Terrain paint canvas"></canvas></div><div class="paint-cursor" hidden></div><p class="paint-empty" hidden>No terrain yet · paint on an empty canvas.</p></div><div class="paint-readout"><span data-height-range></span><span>8-bit view · elevations are kept in metres.</span></div></section>
      <aside class="paint-toolbox"><h3>Tools</h3><div class="paint-zone-tools" role="group" aria-label="Paint zones"></div><div class="paint-height-tools" role="group" aria-label="Sculpt elevations"></div>
      <label>Radius (% of map)<span class="paint-slider"><input data-control="radius" type="range" min="1" max="30" value="8"><output>8</output></span></label><label>Soft edge (%)<span class="paint-slider"><input data-control="softness" type="range" min="1" max="100" value="60"><output>60</output></span></label>
      <label data-height-control>Height per dab (m)<span class="paint-slider"><input data-control="strength" type="range" min="1" max="500" value="50"><output>50</output></span></label><label data-target-control>Target elevation (m)<input data-control="target" type="number" min="-12000" max="12000" value="300"></label>
      <label data-zone-control>Overlay opacity (%)<span class="paint-slider"><input data-control="opacity" type="range" min="0" max="100" value="60"><output>60</output></span></label><label class="paint-check" data-zone-control><input data-control="underlay" type="checkbox" checked>Show terrain underneath</label>
      <button type="button" data-action="clear">Clear zones</button><button type="button" data-action="reset-height">Restore initial elevations</button>
      <details class="paint-transform"><summary>Adjust the whole heightmap</summary><label>Vertical scale ×<input data-control="scale" type="number" min=".05" max="10" step=".05" value="1"></label><label>Datum shift (m)<input data-control="datum" type="number" min="-5000" max="5000" value="0"></label><label>Central crop (%)<input data-control="crop" type="number" min="25" max="100" value="100"></label><button type="button" data-action="transform">Apply adjustment</button></details>
      <details class="paint-files"><summary>Files</summary><button type="button" data-action="import-zones">Import zones</button><button type="button" data-action="export-zones">Export zones</button><button type="button" data-action="export-png">Export PNG · 16 bits</button><input type="file" data-zones-file accept=".json,application/json" hidden></details></aside></div>
      <footer class="relief-paint-footer"><output data-id="state" role="status"></output><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="save">Keep drawing</button><button type="button" class="primary" data-id="apply">Generate relief</button></footer>
    </dialog>`);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const dialog = $<HTMLDialogElement>('dialog'), viewport = $('.paint-viewport'), surface = $('.paint-surface');
  const base = $<HTMLCanvasElement>('.paint-base'), overlay = $<HTMLCanvasElement>('.paint-overlay'), cursor = $('.paint-cursor');
  const baseCtx = base.getContext('2d')!, overlayCtx = overlay.getContext('2d')!, state = $('[data-id="state"]');
  let mode: Mode = 'zones', tool: HeightBrush = 'raise', zone = 3, pan = false, n = 128, original: Float32Array = new Float32Array(n * n), heights: Float32Array = original.slice(), zones: Uint8Array = new Uint8Array(128 * 128 * 5);
  let range = { min: -100, max: 1000 }, hasTerrain = false, dirty = false, available = true, zoom = 1, ox = 0, oy = 0, size = 512;
  let sourceWidth = adaptedExtent(b.getSettings());
  let lastFocus: HTMLElement | null = null, pointer: number | undefined, previous: [number, number] | undefined, dragging = false, strokeChanged = false;
  const past: State[] = [], future: State[] = [];
  const input = (key: string) => $<HTMLInputElement>(`[data-control="${key}"]`), numeric = (key: string) => Number(input(key).value);
  const brush = (): PaintBrush => ({ radius: numeric('radius') / 100, softness: numeric('softness') / 100, strength: numeric('strength'), target: numeric('target') });
  const capture = (): State => ({ heights: heights.slice(), zones: zones.slice(), mode, dirty, n, original, range, hasTerrain, sourceWidth });
  const remember = () => { past.push(capture()); future.length = 0; while (past.length > 1 && (past.length > 20 || past.reduce((sum,s)=>sum+s.heights.byteLength+s.zones.byteLength,0)>64*1048576)) past.shift(); };
  const restore = (s: State) => { heights=s.heights; zones=s.zones; mode=s.mode; dirty=s.dirty; n=s.n; original=s.original; range=s.range; hasTerrain=s.hasTerrain; sourceWidth=s.sourceWidth; setText(state, dirty?'Unsaved drawing':'Drawing saved'); draw(); };
  const mark = () => { dirty = true; setText(state, 'Unsaved drawing'); };
  const generatedSource = document.createElement('button'); generatedSource.type = 'button'; generatedSource.dataset.action = 'use-generated';
  setHTML(generatedSource, `${icon('restore')}<span>Use generated relief as global source</span>`); $('.paint-toolbox').prepend(generatedSource);
  ['Sea','Plain','Hills','Mountains','High mountains','Eraser'].forEach((name,index) => {
    const button=document.createElement('button'); button.type='button'; button.dataset.zone=String(index===5?-1:index);
    setHTML(button, `${index===5?icon('erase'):`<span class="paint-zone-art paint-zone-art-${index}" aria-hidden="true"></span>`}<span>${name}</span>`);
    button.onclick=()=>{zone=index===5?-1:index;pan=false;draw();}; $('.paint-zone-tools').append(button);
  });
  (['raise','lower','level','smooth','restore'] as const).forEach(name=>{
    const button=document.createElement('button');button.type='button';button.dataset.heightTool=name;
    setHTML(button,`${icon(name)}<span>${name[0].toUpperCase()+name.slice(1)}</span>`);button.onclick=()=>{tool=name;pan=false;draw();};$('.paint-height-tools').append(button);
  });
  const resampleZones = (saved: ReturnType<typeof parseTerrainZones>): Uint8Array => Uint8Array.from({length:128**2*5},(_,i)=>{
    const p=Math.floor(i/5),x=Math.floor((p%128+.5)*saved.resolution/128),y=Math.floor((Math.floor(p/128)+.5)*saved.resolution/128);
    return saved.weights[(y*saved.resolution+x)*5+i%5];
  });
  function load(): void {
    const settings=b.getSettings(),world=b.context?.getWorld(),physical=nativeTerrainOf(world)?.physical,sketch=settings.terrain?.sketch,image=settings.options.importedHeight;
    let values: ArrayLike<number>|undefined;
    sourceWidth=adaptedExtent(settings);
    if(sketch){n=sketch.resolution;values=sketch.heights;}
    else if(image){n=Math.min(image.w,image.h);values=importedHeightfield(image,sourceWidth,n,settings.options.heightScale??120,settings.options.importSea??0).height.data;}
    else if(physical){n=physical.n;values=physical.height;sourceWidth=world!.mapSize;}
    else if(world){n=world.terrain.height.w;values=world.terrain.height.data;sourceWidth=world.mapSize;}
    else n=Math.max(128,Math.ceil(sourceWidth/1000));
    hasTerrain=!!values;original=values?Float32Array.from(values):new Float32Array(n*n);heights=original.slice();
    const saved=settings.terrain?.zones;zones=saved?resampleZones(parseTerrainZones(saved)):new Uint8Array(128**2*5);
    mode=saved?'zones':sketch?.processing??(image?'surface':'zones');
    let min=Infinity,max=-Infinity;for(const h of original){min=Math.min(min,h);max=Math.max(max,h);}
    range=hasTerrain&&max>min?{min,max}:{min:Math.min(-100,min-100),max:Math.max(1000,max+100)};
    dirty=false;past.length=future.length=0;zoom=1;ox=oy=0;pan=false;pointer=undefined;setText(state,'Drawing saved');
  }
  function view(): void {
    size=Math.max(1,Math.min(viewport.clientWidth,viewport.clientHeight)-24);
    Object.assign(surface.style,{width:`${size}px`,height:`${size}px`,left:`${(viewport.clientWidth-size)/2+ox}px`,top:`${(viewport.clientHeight-size)/2+oy}px`,transform:`scale(${zoom})`});
    $('[data-zoom]').textContent=`${Math.round(zoom*100)}%`;
  }
  function draw(): void {
    if(!dialog.open)return;view();
    const gray=baseCtx.createImageData(512,512);gray.data.set(grayscaleHeight(mode==='zones'?original:heights,n,range.min,range.max,512));baseCtx.putImageData(gray,0,0);
    base.hidden=mode==='zones'&&!input('underlay').checked;overlayCtx.clearRect(0,0,512,512);
    if(mode==='zones'){
      const image=overlayCtx.createImageData(512,512),opacity=numeric('opacity')/100;
      for(let y=0;y<512;y++)for(let x=0;x<512;x++){
        const p=(Math.floor(y/4)*128+Math.floor(x/4))*5,at=(y*512+x)*4;let total=0;
        for(let k=0;k<5;k++)total+=zones[p+k];if(!total)continue;
        for(let c=0;c<3;c++){let color=0;for(let k=0;k<5;k++)color+=zoneColors[k][c]*zones[p+k]/total;image.data[at+c]=color;}
        image.data[at+3]=total*opacity;
      }
      overlayCtx.putImageData(image,0,0);
    }
    $('.paint-empty').hidden=hasTerrain||dirty;$('[data-height-range]').textContent=`${Math.round(range.min)} → ${Math.round(range.max)} m · ${n} × ${n}`;
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.mode===mode)));
    root.querySelectorAll<HTMLButtonElement>('[data-zone]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.zone)===zone)));
    root.querySelectorAll<HTMLButtonElement>('[data-height-tool]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.heightTool===tool)));
    $('.paint-zone-tools').hidden=mode!=='zones';$('.paint-height-tools').hidden=mode==='zones';
    root.querySelectorAll<HTMLElement>('[data-zone-control]').forEach(el=>{el.hidden=mode!=='zones';});
    $('[data-height-control]').hidden=mode==='zones'||!['raise','lower'].includes(tool);$('[data-target-control]').hidden=mode==='zones'||tool!=='level';
    $('.paint-transform').hidden=mode==='zones';$('[data-action="clear"]').hidden=mode!=='zones';$('[data-action="reset-height"]').hidden=mode==='zones';
    $<HTMLButtonElement>('[data-action="undo"]').disabled=!past.length;$<HTMLButtonElement>('[data-action="redo"]').disabled=!future.length;
    $<HTMLButtonElement>('[data-action="export-png"]').disabled=mode==='zones'&&!hasTerrain;
    generatedSource.disabled=!b.context?.getWorld();
    $('[data-action="brush"]').setAttribute('aria-pressed',String(!pan));$('[data-action="pan"]').setAttribute('aria-pressed',String(pan));overlay.style.cursor=pan?'grab':'crosshair';
    setText($('[data-description]'),descriptions[mode==='zones'?0:mode==='surface'?1:2]);
  }
  function commit(generate: boolean): void {
    if(!available)return;const settings=b.getSettings();
    if(dirty){settings.terrain??={};delete settings.options.importedHeight;
      if(mode==='zones'){delete settings.terrain.sketch;settings.terrain.zones=zones.some(v=>v!==0)?{version:1,resolution:128,weights:Array.from(zones)}:undefined;}
      else{delete settings.terrain.zones;settings.extent=sourceWidth;settings.terrain.sketch={version:1,resolution:n,heights:Array.from(heights),processing:mode};settings.terrain.sampleSpacing=Math.max(1,sourceWidth/n);}
      b.onChange();
    }
    close();if(generate)b.context?.onApply();
  }
  function open(): void {
    if(!available||dialog.open)return;lastFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    load();window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'relief-paint'}));dialog.showModal();draw();overlay.focus({preventScroll:true});
  }
  function close(): void {if(!dialog.open)return;pointer=undefined;cursor.hidden=true;dialog.close();lastFocus?.focus({preventScroll:true});}
  $('[data-id="edit"]').onclick=open;dialog.oncancel=event=>{event.preventDefault();close();};
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>{button.onclick=()=>{if(mode===button.dataset.mode)return;remember();mode=button.dataset.mode as Mode;mark();draw();};});
  const actions: Record<string,()=>void>={
    close,cancel:close,save:()=>commit(false),help:()=>{const help=$('#relief-paint-help');help.hidden=!help.hidden;$('[data-action="help"]').setAttribute('aria-expanded',String(!help.hidden));},
    brush:()=>{pan=false;draw();},pan:()=>{pan=true;draw();},
    undo:()=>{if(pointer!==undefined)return;const s=past.pop();if(s){future.push(capture());restore(s);}},redo:()=>{if(pointer!==undefined)return;const s=future.pop();if(s){past.push(capture());restore(s);}},
    fit:()=>{zoom=1;ox=oy=0;view();},'zoom-in':()=>changeZoom(zoom*1.25),'zoom-out':()=>changeZoom(zoom/1.25),
    clear:()=>{remember();zones.fill(0);mark();draw();},'reset-height':()=>{remember();heights=original.slice();mark();draw();},
    'use-generated':()=>{const world=b.context?.getWorld();if(!world)return;remember();const physical=nativeTerrainOf(world)?.physical;n=physical?.n??world.terrain.height.w;sourceWidth=world.mapSize;original=Float32Array.from(physical?.height??world.terrain.height.data);heights=original.slice();hasTerrain=true;let min=Infinity,max=-Infinity;for(const h of original){min=Math.min(min,h);max=Math.max(max,h);}range=max>min?{min,max}:{min:min-100,max:max+100};mode='surface';mark();draw();},
    transform:()=>{const scale=numeric('scale'),datum=numeric('datum'),crop=numeric('crop');if(!Number.isFinite(scale+datum+crop)||scale<.05||scale>10||Math.abs(datum)>5000||crop<25||crop>100)return;remember();heights=transformHeight(heights,n,scale,datum,crop);mark();draw();},
    'import-zones':()=>$<HTMLInputElement>('[data-zones-file]').click(),
    'export-zones':()=>download(new Blob([JSON.stringify({version:1,resolution:128,weights:Array.from(zones),width:adaptedExtent(b.getSettings())})],{type:'application/json'}),'terrain-zones.json'),
    'export-png':()=>{const s:TerrainSketch={version:1,resolution:n,heights:Array.from(mode==='zones'?original:heights),processing:'surface'};download(new Blob([new Uint8Array(heightmapPng(s,sourceWidth)).buffer],{type:'image/png'}),'terrain-heightmap.png');},
  };
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>{button.onclick=()=>actions[button.dataset.action!]?.();});$('[data-id="apply"]').onclick=()=>commit(true);
  function download(blob:Blob,name:string):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  for(const c of Array.from(root.querySelectorAll<HTMLInputElement>('[data-control]')))c.oninput=()=>{const output=c.parentElement?.querySelector('output');if(output)output.textContent=c.value;if(c.dataset.control==='opacity'||c.dataset.control==='underlay')draw();};
  function point(event:PointerEvent):[number,number]{const r=overlay.getBoundingClientRect();return[(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height];}
  function dab(u:number,v:number):void{if(mode==='zones')paintZone(zones,128,u,v,brush(),zone);else paintHeight(heights,original,n,u,v,brush(),tool);strokeChanged=true;}
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
    const imported=await readHeightmap(file,-1000,4000);if(b.disabled?.())return;const s=b.getSettings();s.terrain??={};s.terrain.sketch=imported.terrain;delete s.terrain.zones;delete s.options.importedHeight;if(imported.width)s.extent=imported.width;
    s.terrain.sampleSpacing=Math.max(s.terrain.sampleSpacing??30,adaptedExtent(s)/imported.terrain.resolution);b.onChange();if(dialog.open){load();draw();}
  }catch(error){if(!dialog.open)open();state.textContent=String(error);}};
  $<HTMLInputElement>('[data-zones-file]').onchange=async event=>{const target=event.target as HTMLInputElement,file=target.files?.[0];target.value='';if(!file)return;try{if(file.size>1000000)throw Error('Zone file is too large');const imported=parseTerrainZones(JSON.parse(await file.text()));remember();zones=resampleZones(imported);mode='zones';mark();draw();}catch(error){state.textContent=String(error);}};
  const observer=new ResizeObserver(()=>{if(dialog.open)view();});observer.observe(viewport);const unsubscribe=onLanguageChange(draw);
  function sync():void {const s=b.getSettings();available=!(b.disabled?.()??false)&&s.terrain?.relief!=='cavern'&&s.runtime?.backend!=='typescript';const trigger=document.getElementById('relief-editor-open') as HTMLButtonElement|null;if(trigger)trigger.disabled=!available;if(dialog.open&&!available)close();}
  sync();return{sync,open,dispose:()=>{close();observer.disconnect();unsubscribe();root.replaceChildren();}};
}
