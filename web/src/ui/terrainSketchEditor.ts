import { parseTerrainSketch, type TerrainSketch } from '../../../rust/bridge/terrainSketch';
import { parseTerrainZones, TERRAIN_ZONE_KINDS, type TerrainZones } from '../../../rust/bridge/terrainZones';
import { heightmapPng, readHeightmap } from './terrainHeightmap';

interface MapEditing {
  viewport: HTMLElement; surface: SVGSVGElement;
  bounds: () => { left: number; top: number; size: number };
  width: () => number; setWidth: (width: number) => void;
  onEnable: () => void; apply: () => void;
}
const names = ['Mer', 'Plaine', 'Collines', 'Montagnes', 'Hautes montagnes'];
const colours = [[38, 123, 193], [124, 190, 111], [196, 171, 92], [161, 109, 73], [211, 211, 225]];

export function createTerrainSketchEditor(host: HTMLElement, initial: TerrainSketch | undefined,
  surface: () => { height: Float32Array; resolution: number; width?: number } | undefined, changed: () => void,
  initialError?: string, onStrokeStart?: () => void, map?: MapEditing, initialZones?: TerrainZones) {
  host.innerHTML = `<details class="sketch-editor" open><summary>Zones de génération</summary>
    <div class="sketch-tools"><label>Entrée <select data-id="input"><option value="generated">Relief automatique</option><option value="zones">Zones peintes → génération</option><option value="surface">Heightmap importée → conserver</option><option value="erosion">Heightmap importée → éroder</option>${initial && !initial.processing ? '<option value="sketch">Ancienne esquisse d’altitude</option>' : ''}</select></label>
    <p data-id="flow" class="terrain-flow"></p>
    <div class="sketch-actions"><button data-id="edit" aria-pressed="false">Dessiner les zones</button><button data-id="apply">Générer le relief</button></div>
    <label>Zone <select data-id="tool">${TERRAIN_ZONE_KINDS.map((k, i) => `<option value="${k}" ${k === 'mountains' ? 'selected' : ''}>${names[i]}</option>`).join('')}<option value="erase">Gomme · relief automatique</option></select></label>
    <label>Rayon % carte <input data-id="radius" type="number" min="1" max="50" step="1" value="16"></label>
    <label>Transition % rayon <input data-id="feather" type="number" min="5" max="100" step="5" value="40"></label>
    <div data-id="legend" class="zone-legend">${names.map((name, i) => `<span style="--zone-colour:rgb(${colours[i].join(',')})">${name}</span>`).join('')}</div>
    <div class="sketch-actions"><button data-id="example">Exemple : côte et massifs</button><button data-id="fill">Toute la carte : cette zone</button><button data-id="clear">Effacer les zones</button><button data-id="undo">Annuler</button><button data-id="redo">Rétablir</button></div>
    <div class="sketch-actions"><button data-id="importZones">Importer les zones</button><button data-id="exportZones">Exporter les zones</button></div>
    <input data-id="zonesFile" type="file" accept=".json,application/json" hidden>
    <small>Les couleurs sont des masques d’opération. Le moteur génère les bruits, le soulèvement, les crêtes et l’érosion dans ces zones. La gomme retrouve le relief automatique. Auto applique en fin de trait ; sinon « Générer le relief ». Molette : zoom · Échap : quitter · Ctrl+Z / Ctrl+Maj+Z : annuler / rétablir.</small>
    <details class="heightmap-tools"><summary>Heightmap · import / export</summary>
    <p>Échange d’un raster existant. Les pinceaux de zones restent des instructions de génération.</p>
    <div class="sketch-actions"><button data-id="surface">Utiliser le terrain affiché comme heightmap</button><button data-id="import">Importer JSON / PNG</button></div>
    <label>Exporter <select data-id="exportSource"><option value="displayed">Terrain affiché (après traitement)</option><option value="draft">Heightmap importée (avant traitement)</option></select></label>
    <div class="sketch-actions"><button data-id="export">Exporter JSON</button><button data-id="png">Exporter PNG 16 bits</button></div>
    <label>Noir = m <input data-id="min" type="number" min="-12000" max="12000" value="-1000"></label>
    <label>Blanc = m <input data-id="max" type="number" min="-12000" max="12000" value="4000"></label>
    <small>PNG gris 8/16 bits, carré 8–1024². Les exports conservent la plage d’altitude et la largeur de carte. Les zones s’exportent séparément, sans altitudes.</small>
    <input data-id="file" type="file" accept=".json,.png,application/json,image/png" hidden></details></div>
    <output data-id="state" role="status"></output></details>`;
  const get = <T extends HTMLElement>(id: string): T => host.querySelector(`[data-id="${id}"]`)! as T;
  const mode = get<HTMLSelectElement>('input'), tool = get<HTMLSelectElement>('tool');
  const radiusInput = get<HTMLInputElement>('radius'), featherInput = get<HTMLInputElement>('feather');
  const state = get('state'), undoButton = get<HTMLButtonElement>('undo'), redoButton = get<HTMLButtonElement>('redo');
  let mask = initialZones ? parseTerrainZones(initialZones) : { version: 1 as const, resolution: 128, weights: new Array<number>(128 ** 2 * 5).fill(0) };
  let heightmap = initial ? parseTerrainSketch(initial) : undefined;
  let cachedZones: TerrainZones | undefined, cachedHeightmap: TerrainSketch | undefined;
  let appliedZones = initialZones, appliedHeightmap = initial;
  mode.value = initialZones ? 'zones' : initial ? initial.processing ?? 'sketch' : 'generated';
  let previousMode = mode.value, available = true, editing = false, revision = 0;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  canvas.width = canvas.height = 512; canvas.tabIndex = 0; canvas.className = 'terrain-paint-overlay'; canvas.hidden = true;
  canvas.setAttribute('aria-label', 'Dessiner les masques de génération du relief');
  const brushCursor = document.createElement('div'); brushCursor.className = 'terrain-brush-cursor'; brushCursor.hidden = true; brushCursor.setAttribute('aria-hidden', 'true');
  map?.viewport.append(canvas, brushCursor);
  const small = document.createElement('canvas'), smallContext = small.getContext('2d')!;
  type EditState = { mask: TerrainZones; heightmap?: TerrainSketch; mode: string; cachedZones?: TerrainZones; cachedHeightmap?: TerrainSketch };
  const undo: EditState[] = [], redo: EditState[] = [];
  const saveState = (): EditState => ({ mask: { ...mask, weights: [...mask.weights] }, heightmap, mode: previousMode, cachedZones, cachedHeightmap });
  const remember = (): void => { undo.push(saveState()); if (undo.length > 30) undo.shift(); redo.length = 0; };
  const mutated = (): void => { revision++; cachedZones = undefined; cachedHeightmap = undefined; };
  const numeric = (input: HTMLInputElement, min: number, max: number): number => Math.max(min, Math.min(max, Number(input.value) || min));
  const updateView = (): void => {
    if (!map) return;
    const b = map.bounds(); Object.assign(canvas.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.size}px`, height: `${b.size}px` });
  };
  function setEditing(value: boolean): void {
    editing = value && available; canvas.hidden = !editing;
    get('edit').setAttribute('aria-pressed', String(editing)); get('edit').textContent = editing ? 'Quitter les zones' : 'Dessiner les zones';
    document.getElementById('editTerrain')?.setAttribute('aria-pressed', String(editing));
    if (!editing) brushCursor.hidden = true;
    map?.viewport.classList.toggle('terrain-editing', editing);
    if (editing) map?.onEnable(); updateView();
  }
  function draw(): void {
    const n = mask.resolution; small.width = small.height = n;
    const image = smallContext.createImageData(n, n), coverage = new Array<number>(5).fill(0);
    for (let p = 0; p < n*n; p++) {
      let total = 0; const rgb = [0, 0, 0];
      for (let k = 0; k < 5; k++) {
        const w = mask.weights[p*5+k]; total += w; coverage[k] += w;
        for (let c = 0; c < 3; c++) rgb[c] += colours[k][c] * w;
      }
      for (let c = 0; c < 3; c++) image.data[p*4+c] = total ? rgb[c]/total : 0;
      image.data[p*4+3] = total * 0.67;
    }
    smallContext.putImageData(image, 0, 0); ctx.clearRect(0, 0, 512, 512); ctx.drawImage(small, 0, 0, 512, 512);
    const pending = mode.value === 'zones' ? !cachedZones || cachedZones !== appliedZones : mode.value !== 'generated' && (!cachedHeightmap || cachedHeightmap !== appliedHeightmap);
    state.dataset.pending = String(pending);
    state.textContent = mode.value === 'zones'
      ? `${coverage.map((w, i) => w > 0 ? `${names[i]} ${Math.round(w/(n*n*255)*100)} %` : '').filter(Boolean).join(' · ') || 'Aucune zone : relief automatique'} · ${pending ? 'à générer' : 'appliquées'}`
      : mode.value === 'generated' ? 'Relief automatique, sans masque manuel.' : `${heightmap?.resolution ?? '—'}² · ${pending ? 'à appliquer' : 'appliquée'}`;
    const source = (document.getElementById('terrainSource') as HTMLSelectElement | null)?.value;
    get('flow').textContent = !available ? 'Les cavernes ne sont pas un relief de surface.' : mode.value === 'zones'
      ? source?.startsWith('neural') ? 'Zones → conditionnement régional + relief local → réseaux coarse / base / decoder. Dessinez de grandes régions : le réseau lit environ 5 cellules sur les 40 km.' : 'Zones → paramètres locaux des bruits, soulèvement et crêtes → érosion → côtes → eau. Les régions non peintes gardent le relief automatique.'
      : mode.value === 'surface' ? 'Heightmap importée → conserver ses altitudes → eau. Pour créer des reliefs par zones, choisissez « Zones peintes ».'
      : mode.value === 'erosion' ? 'Heightmap importée → érosion Rust → eau.' : mode.value === 'sketch' ? 'Ancienne esquisse d’altitude. Pour dessiner les opérations, choisissez les zones.' : 'Choisissez la source et le relief de fond, puis dessinez les zones pour placer la mer, les plaines et les massifs.';
    undoButton.disabled = !available || !undo.length; redoButton.disabled = !available || !redo.length;
    get<HTMLButtonElement>('export').disabled = !available || (get<HTMLSelectElement>('exportSource').value === 'draft' ? !heightmap : !surface());
    get<HTMLButtonElement>('png').disabled = get<HTMLButtonElement>('export').disabled; get<HTMLSelectElement>('exportSource').options[1].disabled = !heightmap;
    for (const option of Array.from(mode.options)) if (option.value === 'surface' || option.value === 'erosion') option.disabled = !heightmap;
  }
  const notify = (): void => { previousMode = mode.value; draw(); changed(); };
  const selectZones = (): void => { if (mode.value !== 'zones') { mode.value = 'zones'; mutated(); } };
  get('edit').onclick = () => { if (!editing) { if (mode.value !== 'zones') { remember(); selectZones(); notify(); } setEditing(true); } else setEditing(false); };
  get('apply').onclick = () => { setEditing(false); map?.apply(); };
  mode.onchange = () => { const next = mode.value; mode.value = previousMode; remember(); mode.value = next; mutated(); if (next !== 'zones') setEditing(false); notify(); };
  for (const input of [radiusInput, featherInput]) input.oninput = () => { brushCursor.hidden = true; };
  let pointer: number | undefined, previous: [number, number] | undefined;
  let radius = .16, feather = .4, selected = 3, distanceToDab = 0;
  const spacing = (): number => Math.max(1/(mask.resolution*2), radius/6);
  function dab(u: number, v: number): void {
    const n = mask.resolution;
    const x0 = Math.max(0, Math.ceil((u-radius)*n-.5)), x1 = Math.min(n-1, Math.floor((u+radius)*n-.5));
    const y0 = Math.max(0, Math.ceil((v-radius)*n-.5)), y1 = Math.min(n-1, Math.floor((v+radius)*n-.5));
    for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
      const r = Math.hypot(((x+.5)/n-u)/radius, ((y+.5)/n-v)/radius); if (r >= 1) continue;
      const t = Math.min(1, (1-r)/feather), alpha = t*t*(3-2*t), p = (y*n+x)*5;
      let total = 0;
      for (let k=0; k<5; k++) { mask.weights[p+k] = Math.floor(mask.weights[p+k]*(1-alpha)); total += mask.weights[p+k]; }
      if (selected >= 0) mask.weights[p+selected] += Math.min(255-total, Math.round(255*alpha));
    }
    mutated();
  }
  const position = (event: PointerEvent): [number, number] => { const b = canvas.getBoundingClientRect(); return [(event.clientX-b.left)/b.width, (event.clientY-b.top)/b.height]; };
  function paint(event: PointerEvent): void {
    const p = position(event), start = previous!, dx=p[0]-start[0], dy=p[1]-start[1], length=Math.hypot(dx,dy), step=spacing();
    if (length > 0) { for (let d=distanceToDab; d<=length; d+=step) dab(start[0]+dx*d/length, start[1]+dy*d/length); distanceToDab = ((distanceToDab-length)%step+step)%step || step; }
    previous = p; draw();
  }
  canvas.onpointerdown = event => {
    if (!available || event.button !== 0 || pointer !== undefined) return;
    event.preventDefault(); onStrokeStart?.(); remember(); selectZones();
    radius = Math.max(.75/mask.resolution, numeric(radiusInput, 1, 50)/100); feather = numeric(featherInput, 5, 100)/100;
    selected = TERRAIN_ZONE_KINDS.indexOf(tool.value as typeof TERRAIN_ZONE_KINDS[number]); pointer = event.pointerId; previous = position(event); distanceToDab = spacing();
    canvas.focus({preventScroll:true}); canvas.setPointerCapture(pointer); dab(...previous); draw();
  };
  canvas.onpointermove = event => { if (map) { const b=map.viewport.getBoundingClientRect(), diameter=canvas.getBoundingClientRect().width*numeric(radiusInput,1,50)/50; Object.assign(brushCursor.style,{left:`${event.clientX-b.left}px`,top:`${event.clientY-b.top}px`,width:`${diameter}px`,height:`${diameter}px`}); brushCursor.hidden=!editing; } if (pointer === event.pointerId) paint(event); };
  const stop = (event: PointerEvent): void => { if (pointer !== event.pointerId) return; if (event.type === 'pointerup') paint(event); pointer=undefined; previous=undefined; notify(); };
  canvas.onpointerup=stop; canvas.onpointercancel=stop; canvas.onlostpointercapture=stop; canvas.onpointerleave=()=>{brushCursor.hidden=true;};
  canvas.addEventListener('wheel', event => { event.preventDefault(); map?.surface.dispatchEvent(new WheelEvent('wheel',{clientX:event.clientX,clientY:event.clientY,deltaY:event.deltaY,deltaMode:event.deltaMode,bubbles:true,cancelable:true})); }, {passive:false});
  get('fill').onclick = () => { remember(); selectZones(); const k=TERRAIN_ZONE_KINDS.indexOf(tool.value as typeof TERRAIN_ZONE_KINDS[number]); mask.weights.fill(0); if(k>=0)for(let i=k;i<mask.weights.length;i+=5)mask.weights[i]=255; mutated(); setEditing(true); notify(); };
  get('example').onclick = () => {
    remember(); selectZones();
    const smooth = (t: number): number => { t=Math.max(0,Math.min(1,t));return t*t*(3-2*t); };
    const n=mask.resolution;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const u=(x+.5)/n,v=(y+.5)/n;
      const sea=1-smooth((u-.12-.055*Math.sin(v*9))/.10);
      const massA=smooth((1-Math.hypot((u-.68)/.27,(v-.35)/.36))/.35);
      const massB=smooth((1-Math.hypot((u-.72)/.23,(v-.82)/.23))/.35);
      const hills=smooth((1-Math.hypot((u-.62)/.40,(v-.48)/.65))/.35);
      const mountains=Math.max(massA,massB),land=1-sea;
      const weights=[sea,land*(1-hills),land*hills*(1-mountains),land*hills*mountains,0];
      for(let k=0;k<5;k++)mask.weights[(y*n+x)*5+k]=Math.floor(weights[k]*255);
    }
    mutated();setEditing(true);notify();
  };
  get('clear').onclick = () => { remember(); selectZones(); mask.weights.fill(0); mutated(); notify(); };
  const restore = (value: EditState): void => { mask=value.mask; heightmap=value.heightmap; mode.value=value.mode; mutated(); cachedZones=value.cachedZones; cachedHeightmap=value.cachedHeightmap; if(mode.value!=='zones')setEditing(false); notify(); };
  undoButton.onclick=()=>{if(pointer!==undefined)return;const s=undo.pop();if(s){redo.push(saveState());restore(s);}};
  redoButton.onclick=()=>{if(pointer!==undefined)return;const s=redo.pop();if(s){undo.push(saveState());restore(s);}};
  const keyboard=(event:KeyboardEvent):void=>{if(event.key==='Escape'){setEditing(false);return;}if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z'||(event.target as HTMLElement).closest('input,select,textarea'))return;event.preventDefault();(event.shiftKey?redoButton:undoButton).click();};
  host.addEventListener('keydown',keyboard); canvas.addEventListener('keydown',keyboard);
  const zones = (): TerrainZones | undefined => { if(mode.value!=='zones')return; if(!cachedZones){cachedZones={...mask,weights:[...mask.weights]};Object.freeze(cachedZones.weights);Object.freeze(cachedZones);}return cachedZones; };
  const snapshot=():TerrainSketch|undefined=>{ if(!heightmap||!['surface','erosion','sketch'].includes(mode.value))return; if(!cachedHeightmap){cachedHeightmap={...heightmap,heights:heightmap.heights.map(Math.fround),processing:mode.value==='sketch'?undefined:mode.value as 'surface'|'erosion'};Object.freeze(cachedHeightmap.heights);Object.freeze(cachedHeightmap);}return cachedHeightmap; };
  const download=(data:BlobPart,type:string,name:string):void=>{const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  get('exportZones').onclick=()=>download(JSON.stringify({...mask,kind:'terrain-zones',width:map?.width()}),'application/json','terrain-zones.json');
  const zonesFile=get<HTMLInputElement>('zonesFile'); get('importZones').onclick=()=>zonesFile.click();
  zonesFile.onchange=()=>{const file=zonesFile.files?.[0];zonesFile.value='';if(!file)return;const expected=revision;void(async()=>{try{if(file.size>1000000)throw Error('Fichier de zones trop volumineux.');const data=JSON.parse(await file.text()),next=parseTerrainZones(data);if(expected!==revision)return;remember();mask=next;if(Number.isFinite(data.width)&&data.width>=500&&data.width<=100000)map?.setWidth(data.width);selectZones();mutated();notify();setEditing(true);}catch(error){state.textContent=String(error);}})();};
  function displayed(): TerrainSketch { const s=surface();if(!s)throw Error('Générez un terrain d’abord.');return parseTerrainSketch({version:1,resolution:s.resolution,heights:Array.from(s.height),processing:'surface'}); }
  get('surface').onclick=()=>{try{const next=displayed();remember();heightmap=next;mode.value='surface';mutated();setEditing(false);notify();}catch(error){state.textContent=String(error);}};
  const fileInput=get<HTMLInputElement>('file');get('import').onclick=()=>fileInput.click();
  fileInput.onchange=()=>{const file=fileInput.files?.[0];fileInput.value='';if(!file)return;const expected=revision;void(async()=>{try{const data=await readHeightmap(file,numeric(get('min'),-12000,12000),numeric(get('max'),-12000,12000));if(expected!==revision)return;remember();heightmap=data.terrain;if(data.width)map?.setWidth(data.width);mode.value='surface';mutated();setEditing(false);notify();}catch(error){state.textContent=String(error);}})();};
  const exportHeightmap=(png:boolean):void=>{try{const fromDisplay=get<HTMLSelectElement>('exportSource').value==='displayed';const s=fromDisplay?displayed():heightmap;if(!s)throw Error('Aucune heightmap importée.');const width=fromDisplay?surface()?.width??map?.width():map?.width();if(png)download(new Uint8Array(heightmapPng(s,width??40000)).buffer,'image/png','terrain-heightmap.png');else download(JSON.stringify({...s,width,kind:s.processing?'heightmap':'sketch',units:'m',seaLevel:0}),'application/json','terrain-heightmap.json');}catch(error){state.textContent=String(error);}};
  get('export').onclick=()=>exportHeightmap(false);get('png').onclick=()=>exportHeightmap(true);get('exportSource').onchange=draw;
  const setAvailable=(value:boolean):void=>{if(value===available)return;available=value;if(!value)setEditing(false);for(const c of Array.from(host.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('[data-id]')))if(c.matches('button,input,select'))c.disabled=!value;draw();};
  draw();if(initialError)state.textContent=initialError;
  return {snapshot,zones,setEditing,updateView,setAvailable,
    captureContext:()=>({mask,heightmap,mode:mode.value,editing}),
    restoreContext:(saved:{mask:TerrainZones;heightmap?:TerrainSketch;mode:string;editing:boolean})=>{
      mask=parseTerrainZones(saved.mask);heightmap=saved.heightmap?parseTerrainSketch(saved.heightmap):undefined;
      mode.value=saved.mode;previousMode=saved.mode;mutated();draw();setEditing(saved.editing);
    },
    refresh:(height?:TerrainSketch,zone?:TerrainZones)=>{appliedHeightmap=height;appliedZones=zone;draw();}};
}
