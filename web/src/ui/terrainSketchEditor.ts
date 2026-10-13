import { coarseSurface, parseTerrainSketch, type TerrainSketch } from '../../../rust/bridge/terrainSketch';

export function createTerrainSketchEditor(host: HTMLElement, initial: TerrainSketch | undefined,
  surface: () => { height: Float32Array; resolution: number } | undefined, changed: () => void,
  preset?: () => Promise<TerrainSketch>, initialError?: string, onStrokeStart?: () => void): { snapshot: () => TerrainSketch | undefined } {
  host.innerHTML = `<details class="sketch-editor"><summary>Coarse terrain editor</summary>
    <p>Paint elevation before refinement. The grid covers the entire map; 0 m is sea level. The neural model follows the large land masses (about 7.7 km cells).</p>
    <div class="sketch-tools"><label><input data-id="enabled" type="checkbox">Use this sketch</label>
    <label>Brush <select data-id="tool"><option value="raise">Raise</option><option value="lower">Lower</option><option value="level">Elevation</option><option value="smooth">Smooth</option><option value="plateau">Plateau</option><option value="volcano">Volcano</option><option value="caldera">Caldera</option></select></label>
    <label>Radius % <input data-id="radius" type="number" min="2" max="50" value="15"></label>
    <label>Elevation / strength m <input data-id="height" type="number" min="-12000" max="12000" value="1000"></label>
    <button data-id="flat">Set all to elevation</button><button data-id="surface">From displayed terrain</button>
    ${preset ? '<button data-id="preset">From terrain sketch</button>' : ''}
    <button data-id="undo">Undo</button><button data-id="redo">Redo</button>
    <button data-id="import">Import JSON</button><button data-id="export">Export JSON</button>
    <input data-id="file" type="file" accept=".json,application/json" hidden></div>
    <canvas tabindex="0" width="512" height="512" aria-label="Paint coarse terrain"></canvas><output data-id="state" role="status"></output>
    <small>Blue: sea · green: low terrain · brown/white: high terrain. Edits are applied at the end of a stroke with Auto, or with Generate. Ctrl+Z: undo · Ctrl+Shift+Z: redo.</small></details>`;
  const get = <T extends HTMLElement>(id: string): T => host.querySelector(`[data-id="${id}"]`)! as T;
  const enabled = get<HTMLInputElement>('enabled'), canvas = host.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
  const toolControl = get<HTMLSelectElement>('tool'), radiusControl = get<HTMLInputElement>('radius'), heightControl = get<HTMLInputElement>('height');
  const state = get('state'), undoButton = get<HTMLButtonElement>('undo'), redoButton = get<HTMLButtonElement>('redo');
  const small = document.createElement('canvas'), smallContext = small.getContext('2d')!;
  let sketch = initial ? parseTerrainSketch(initial) : { version: 1 as const, resolution: 64, heights: new Array<number>(64 ** 2).fill(100) };
  let active = !!initial, revision = 0, loadToken = 0, cached: TerrainSketch | undefined;
  enabled.checked = active;
  type EditState = { sketch: TerrainSketch; active: boolean };
  const undo: EditState[] = [], redo: EditState[] = [];
  const clone = (): TerrainSketch => ({ ...sketch, heights: [...sketch.heights] });
  const editState = (): EditState => ({ sketch: clone(), active });
  const remember = (): void => { undo.push(editState()); if (undo.length > 30) undo.shift(); redo.length = 0; };
  const mutated = (): void => { revision++; cached = undefined; };
  const notify = (): void => { draw(); changed(); };
  let image: ImageData | undefined, drawFrame: number | undefined;
  function draw(): void {
    if (drawFrame !== undefined) { cancelAnimationFrame(drawFrame); drawFrame = undefined; }
    const n = sketch.resolution;
    if (!image || image.width !== n) { small.width = small.height = n; image = smallContext.createImageData(n, n); }
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < sketch.heights.length; i++) {
      const h = sketch.heights[i], p = i * 4;
      min = Math.min(min, h); max = Math.max(max, h);
      const t = Math.max(0, Math.min(1, h / 3500)), sea = Math.min(1, -h / 1000);
      if (h <= 0) { image.data[p] = 45 - 20 * sea; image.data[p + 1] = 140 - 60 * sea; image.data[p + 2] = 195 - 50 * sea; }
      else if (t < 0.5) { image.data[p] = 85 + 220 * t; image.data[p + 1] = 155 - 55 * t; image.data[p + 2] = 85 + 40 * t; }
      else { image.data[p] = 195 + 110 * (t - 0.5); image.data[p + 1] = 128 + 220 * (t - 0.5); image.data[p + 2] = 105 + 270 * (t - 0.5); }
      image.data[p + 3] = 255;
    }
    smallContext.putImageData(image, 0, 0); ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    state.textContent = `${n}² · ${Math.round(min)} to ${Math.round(max)} m${active ? ' · active' : ' · inactive'}`;
    undoButton.disabled = !undo.length; redoButton.disabled = !redo.length;
  }
  const deferDraw = (): void => { drawFrame ??= requestAnimationFrame(() => { drawFrame = undefined; draw(); }); };
  const numeric = (control: HTMLInputElement, min: number, max: number): number => Math.max(min, Math.min(max, Number(control.value) || 0));
  let pointer: number | undefined, previous: [number, number] | undefined, lastDab: [number, number] | undefined;
  let stampBase = 0, distanceToDab = 0;
  let brushTool = 'raise', brushRadius = 0.15, brushAltitude = 1000, scratch = new Float64Array(0);
  function brush(u: number, v: number): void {
    const n = sketch.resolution, radius = brushRadius, altitude = brushAltitude, tool = brushTool;
    const x0 = Math.max(0, Math.ceil((u - radius) * n - 0.5)), x1 = Math.min(n - 1, Math.floor((u + radius) * n - 0.5));
    const y0 = Math.max(0, Math.ceil((v - radius) * n - 0.5)), y1 = Math.min(n - 1, Math.floor((v + radius) * n - 0.5));
    if (x0 > x1 || y0 > y1) return;
    if (tool === 'smooth') {
      if (scratch.length !== n * n) scratch = new Float64Array(n * n);
      // Read only the affected patch and its halo, so smoothing never sees its own writes.
      for (let y = Math.max(0, y0 - 1); y <= Math.min(n - 1, y1 + 1); y++) {
        for (let x = Math.max(0, x0 - 1); x <= Math.min(n - 1, x1 + 1); x++) scratch[y * n + x] = sketch.heights[y * n + x];
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = ((x + 0.5) / n - u) / radius, dy = ((y + 0.5) / n - v) / radius, r2 = dx * dx + dy * dy;
      if (r2 >= 1) continue;
      const i = y * n + x, weight = (1 - r2) ** 2;
      let h = sketch.heights[i];
      if (tool === 'raise' || tool === 'lower') h += (tool === 'raise' ? 1 : -1) * Math.abs(altitude) * weight * 0.08;
      else if (tool === 'smooth') {
        let total = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(n - 1, x + dx)), yy = Math.max(0, Math.min(n - 1, y + dy));
          total += scratch[yy * n + xx];
        }
        h += (total / 9 - h) * weight * 0.5;
      } else {
        const r = Math.sqrt(r2);
        const shape = tool === 'plateau' ? Math.min(1, (1 - r) * 5) : tool === 'volcano' ? (1 - r) ** 1.5
          : tool === 'caldera' ? Math.exp(-(((r - 0.5) / 0.22) ** 2)) * Math.min(1, (1 - r) * 5) : 1;
        const edge = Math.min(1, (1 - r) * 5);
        const blend = tool === 'level' ? weight * 0.3 : edge * edge * (3 - 2 * edge);
        const target = tool === 'level' ? altitude : stampBase + (altitude - stampBase) * shape;
        h += (target - h) * blend;
      }
      sketch.heights[i] = Math.max(-12000, Math.min(12000, h));
    }
    lastDab = [u, v]; mutated();
  }
  const position = (event: PointerEvent): [number, number] => {
    const b = canvas.getBoundingClientRect();
    return [Math.max(-brushRadius, Math.min(1 + brushRadius, (event.clientX - b.left) / b.width)),
      Math.max(-brushRadius, Math.min(1 + brushRadius, (event.clientY - b.top) / b.height))];
  };
  const paint = (event: PointerEvent): void => {
    const p = position(event), start = previous!;
    const dx = p[0] - start[0], dy = p[1] - start[1], length = Math.hypot(dx, dy);
    if (length === 0) return;
    // Fixed spacing along the whole stroke: pointer event frequency does not change its strength.
    for (let d = distanceToDab; d <= length; d += 1 / (sketch.resolution * 2)) brush(start[0] + dx * d / length, start[1] + dy * d / length);
    const spacing = 1 / (sketch.resolution * 2);
    distanceToDab = ((distanceToDab - length) % spacing + spacing) % spacing;
    // An exact spacing endpoint belongs to this segment; the next dab is one step away.
    if (distanceToDab < 1e-12) distanceToDab = spacing;
    previous = p; deferDraw();
  };
  canvas.onpointerdown = event => {
    if (event.button !== 0 || pointer !== undefined) return;
    onStrokeStart?.();
    brushTool = toolControl.value; brushRadius = numeric(radiusControl, 2, 50) / 100; brushAltitude = numeric(heightControl, -12000, 12000);
    const p = position(event), n = sketch.resolution;
    const x = Math.max(0, Math.min(n - 1, Math.floor(p[0] * n))), y = Math.max(0, Math.min(n - 1, Math.floor(p[1] * n)));
    stampBase = sketch.heights[y * n + x];
    remember(); active = enabled.checked = true; pointer = event.pointerId; previous = p;
    distanceToDab = 1 / (n * 2); mutated();
    canvas.focus({ preventScroll: true }); canvas.setPointerCapture(pointer); brush(...p); deferDraw();
  };
  canvas.onpointermove = event => { if (event.pointerId === pointer) paint(event); };
  const stop = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    if (event.type === 'pointerup') paint(event);
    if (previous && lastDab && Math.hypot(previous[0] - lastDab[0], previous[1] - lastDab[1]) > 1e-12) brush(...previous);
    pointer = undefined; previous = undefined; lastDab = undefined; notify();
  };
  canvas.onpointerup = stop; canvas.onpointercancel = stop; canvas.onlostpointercapture = stop;
  enabled.onchange = () => { remember(); active = enabled.checked; mutated(); notify(); };
  get('flat').onclick = () => { remember(); sketch.heights.fill(numeric(heightControl, -12000, 12000)); active = enabled.checked = true; mutated(); notify(); };
  get('surface').onclick = () => {
    const s = surface(); if (!s) { state.textContent = 'Generate terrain first.'; return; }
    try { const next = parseTerrainSketch(coarseSurface(s.height, s.resolution)); remember(); sketch = next; active = enabled.checked = true; mutated(); notify(); }
    catch (e) { state.textContent = String(e); }
  };
  const load = async (read: () => Promise<unknown>, button?: HTMLButtonElement): Promise<void> => {
    const token = ++loadToken, expectedRevision = revision;
    if (button) button.disabled = true;
    state.textContent = 'Loading sketch…';
    try {
      const s = parseTerrainSketch(await read());
      if (token !== loadToken || expectedRevision !== revision || pointer !== undefined) return;
      remember(); sketch = s; active = enabled.checked = true; mutated(); notify();
    } catch (e) { if (token === loadToken && expectedRevision === revision) state.textContent = String(e); }
    finally { if (button) button.disabled = false; }
  };
  if (preset) get('preset').onclick = () => { void load(preset, get<HTMLButtonElement>('preset')); };
  const restore = (s: EditState): void => { sketch = s.sketch; active = enabled.checked = s.active; mutated(); notify(); };
  undoButton.onclick = () => { if (pointer !== undefined) return; const s = undo.pop(); if (s) { redo.push(editState()); restore(s); } };
  redoButton.onclick = () => { if (pointer !== undefined) return; const s = redo.pop(); if (s) { undo.push(editState()); restore(s); } };
  host.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || (event.target as HTMLElement).closest('input,select,textarea')) return;
    event.preventDefault(); (event.shiftKey ? redoButton : undoButton).click();
  });
  const fileInput = get<HTMLInputElement>('file');
  get('import').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files?.[0]; fileInput.value = ''; if (!file) return;
    void load(async () => { if (file.size > 1000000) throw new Error('File is too large.'); return JSON.parse(await file.text()); });
  };
  const snapshot = (): TerrainSketch => {
    if (!cached) {
      cached = { ...sketch, heights: sketch.heights.map(h => Math.round(h * 100) / 100) };
      Object.freeze(cached.heights); Object.freeze(cached);
    }
    return cached;
  };
  get('export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'terrain-sketch.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  draw();
  if (initialError) { state.textContent = initialError; host.querySelector('details')!.open = true; }
  return { snapshot: () => active ? snapshot() : undefined };
}
