import { ROAD_CLASSES, ROAD_LEVELS, ROAD_PROFILES, ROAD_SURFACES, defaultRoadConfig, type Point, type RoadClass, type RoadConfig, type RoadOutput, type RoadSegment, type RoadSurface } from '../../../rust/bridge/settlements';

const ns = 'http://www.w3.org/2000/svg';
const CLASS_LABEL: Record<RoadClass, string> = { highway: 'Highway', main: 'Main road', local: 'Local road', track: 'Track', trail: 'Trail' };
/** Screen widths (px): roads keep their weight at every zoom. */
const CLASS_PX: Record<RoadClass, number> = { highway: 3.6, main: 2.8, local: 2.1, track: 1.5, trail: 1.2 };
const SURFACE_LABEL: Record<RoadSurface, string> = { dirt: 'Dirt', gravel: 'Gravel', paved: 'Paved', flagstone: 'Flagstone' };
/** Fill and casing; dirt has no casing. */
const SURFACE_COLOR: Record<RoadSurface, [string, string | null]> = {
  dirt: ['#8b6840', null], gravel: ['#f2ead6', '#8b7c63'], paved: ['#eeb465', '#6b4527'], flagstone: ['#d9c8a1', '#463729'],
};
const DASH: Partial<Record<RoadClass, string>> = { track: '5 3', trail: '1.2 3' };
const pathData = (points: Point[]): string => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
const esc = (text: string): string => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The "Roads" stage: its own options, status and drawing; placement never runs from here. */
export function createTerrainRoads(options: { map: SVGSVGElement; before: Element | null; onConfigChange(): void; onDisplayChange(): void }) {
  let config = defaultRoadConfig(), enabled = true, show = true, output: RoadOutput | undefined;
  let drawnLayer: SVGGElement | undefined, drawnState = '', drawn: RoadOutput | undefined;
  const saved = new URLSearchParams(location.search).get('roads');
  if (saved) try {
    const s = JSON.parse(saved);
    for (const key of Object.keys(config) as (keyof RoadConfig)[]) if (s.config?.[key] !== undefined) (config as unknown as Record<string, unknown>)[key] = s.config[key];
    enabled = s.enabled !== false; show = s.show !== false;
  } catch { config = defaultRoadConfig(); }
  const panel = document.createElement('details'); panel.className = 'stage road-stage'; panel.open = true; panel.id = 'roadStage';
  const number = (key: keyof RoadConfig, label: string, min: number, max: number, step: number, title = ''): string =>
    `<label title="${esc(title)}">${label}<input data-road="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`;
  panel.innerHTML = `<summary>5 · Roads <span id="roadState"></span></summary><div class="stage-controls">
    <label><input id="roadEnabled" type="checkbox">Generate roads</label>
    <label title="Sets the road classes and their surfaces">Development <select id="roadLevel">${ROAD_LEVELS.map(l => `<option value="${l.id}">${esc(l.label)}</option>`).join('')}</select></label>
    <label title="Force one surface on the whole network">Surfaces <select id="roadSurface"><option value="auto">By level &amp; culture</option>${ROAD_SURFACES.map(s => `<option value="${s}">${SURFACE_LABEL[s]} only</option>`).join('')}</select></label>
    <label title="Road-building culture: grades, straightness, bridges, causeways">Road culture <select id="roadCulture"><option value="auto">From the settlements</option>${ROAD_PROFILES.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select></label>
    <label title="0: spanning tree only · 1: many loops and shortcuts">Network density <input data-road="density" type="range" min="0" max="1" step="0.05"><output id="roadDensityValue"></output></label>
    ${number('exits', 'Map exits', 0, 4, 1, 'Roads leaving the map from the main settlement')}
    <details class="advanced"><summary>Routing</summary><div class="control-group">
    ${number('gradeWeight', 'Slope aversion', 0, 10, 0.1, '0 ignores the relief entirely')}
    ${number('maxGrade', 'Max grade of main roads (%)', 0, 100, 1, '0 keeps the culture value; local roads ×1.2, tracks ×1.5, trails steeper')}
    ${number('crossingCost', 'River crossing cost', 0.05, 10, 0.1)}
    ${number('wobble', 'Winding × culture', 0, 5, 0.05)}
    ${number('sharing', 'Trunk sharing', 0, 1, 0.05, 'How strongly routes merge onto existing roads')}
    </div></details>
    <label><input id="roadShow" type="checkbox">Show roads</label>
    <small id="roadStatus" role="status">Waiting for settlements…</small>
    <div class="road-legend" id="roadLegend"></div>
    <div id="roadWarnings" role="status"></div></div>`;
  const stages = document.querySelector('.stages')!;
  stages.insertBefore(panel, options.before);
  const q = <T extends Element>(selector: string): T => panel.querySelector(selector) as T;
  const select = (id: string): HTMLSelectElement => q<HTMLSelectElement>(`#${id}`);
  const input = (id: string): HTMLInputElement => q<HTMLInputElement>(`#${id}`);
  function controls(): void {
    input('roadEnabled').checked = enabled; input('roadShow').checked = show;
    select('roadLevel').value = config.level; select('roadSurface').value = config.surface; select('roadCulture').value = config.culture;
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-road]'))) {
      const key = c.dataset.road as keyof RoadConfig, value = config[key] as number;
      c.value = String(key === 'maxGrade' ? Math.round(value * 100) : value);
    }
    q('#roadDensityValue').textContent = config.density.toFixed(2);
    panel.querySelectorAll<HTMLElement>('.stage-controls > :not(:first-child)').forEach(e => { if (e.id !== 'roadStatus') e.toggleAttribute('inert', !enabled); });
  }
  function changed(): void { controls(); options.onConfigChange(); }
  input('roadEnabled').onchange = () => { enabled = input('roadEnabled').checked; changed(); };
  input('roadShow').onchange = () => { show = input('roadShow').checked; draw(); options.onDisplayChange(); };
  select('roadLevel').onchange = () => { config.level = select('roadLevel').value as RoadConfig['level']; changed(); };
  select('roadSurface').onchange = () => { config.surface = select('roadSurface').value as RoadConfig['surface']; changed(); };
  select('roadCulture').onchange = () => { config.culture = select('roadCulture').value; changed(); };
  for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-road]'))) {
    const key = c.dataset.road as keyof RoadConfig;
    if (c.type === 'range') c.oninput = () => { q('#roadDensityValue').textContent = Number(c.value).toFixed(2); };
    c.onchange = () => {
      if (!c.reportValidity()) return;
      (config as unknown as Record<string, number>)[key] = key === 'maxGrade' ? Number(c.value) / 100 : Number(c.value);
      changed();
    };
  }
  function legend(): void {
    const used = new Set(output?.segments.map(s => `${s.class}|${s.surface}`));
    const classes = ROAD_CLASSES.filter(c => output ? output.segments.some(s => s.class === c) : true);
    const surfaces = ROAD_SURFACES.filter(s => output ? output.segments.some(r => r.surface === s) : true);
    const sample = (cls: RoadClass, surface: RoadSurface): string => {
      const [fill, casing] = SURFACE_COLOR[surface], w = CLASS_PX[cls], dash = DASH[cls] ? ` stroke-dasharray="${DASH[cls]}"` : '';
      return `<svg width="26" height="10" aria-hidden="true">${casing ? `<line x1="2" y1="5" x2="24" y2="5" stroke="${casing}" stroke-width="${w + 1.6}" stroke-linecap="round"${dash}/>` : ''}<line x1="2" y1="5" x2="24" y2="5" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"${dash}/></svg>`;
    };
    const km = (v = 0): string => `${(v / 1000).toFixed(1)} km`;
    q('#roadLegend').innerHTML = `<div>${classes.map(c => {
      const surface = surfaces.find(s => used.has(`${c}|${s}`)) ?? (c === 'trail' || c === 'track' ? 'dirt' : 'paved');
      return `<span>${sample(c, surface)}${CLASS_LABEL[c]}${output ? ` · ${km(output.lengthByClass[c])}` : ''}</span>`;
    }).join('')}</div><div>${surfaces.map(s => `<span><i style="background:${SURFACE_COLOR[s][0]};border-color:${SURFACE_COLOR[s][1] ?? SURFACE_COLOR[s][0]}"></i>${SURFACE_LABEL[s]}${output ? ` · ${km(output.lengthBySurface[s])}` : ''}</span>`).join('')}</div>`;
  }
  /** Minor roads first, casings under all fills, so junctions merge cleanly. */
  function draw(): void {
    let layer = options.map.querySelector<SVGGElement>('#roadOverlay');
    if (!layer) {
      layer = document.createElementNS(ns, 'g'); layer.id = 'roadOverlay';
      const markers = options.map.querySelector('#settlementOverlay');
      if (markers) options.map.insertBefore(layer, markers); else options.map.append(layer);
    }
    const state = `${enabled}|${show}`;
    if (layer === drawnLayer && drawn === output && state === drawnState) return;
    drawnLayer = layer; drawn = output; drawnState = state; layer.replaceChildren();
    if (!output || !show || !enabled) return;
    const order = [...output.segments].sort((a, b) => ROAD_CLASSES.indexOf(b.class) - ROAD_CLASSES.indexOf(a.class));
    const line = (d: string, stroke: string, width: number, extra: Record<string, string> = {}): SVGPathElement => {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', String(width)); p.setAttribute('vector-effect', 'non-scaling-stroke'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
      for (const [k, v] of Object.entries(extra)) p.setAttribute(k, v);
      return p;
    };
    const casings = document.createElementNS(ns, 'g'), fills = document.createElementNS(ns, 'g'), crossings = document.createElementNS(ns, 'g'), hits = document.createElementNS(ns, 'g');
    casings.style.pointerEvents = fills.style.pointerEvents = crossings.style.pointerEvents = 'none';
    for (const s of order) {
      const d = pathData(s.path), w = CLASS_PX[s.class], [fill, casing] = SURFACE_COLOR[s.surface], dash = DASH[s.class];
      const extra: Record<string, string> = dash ? { 'stroke-dasharray': dash } : {};
      if (casing) casings.append(line(d, casing, w + 1.6, extra));
      fills.append(line(d, fill, w, extra));
      for (const c of s.crossings) {
        const cd = pathData(c.path);
        if (c.kind === 'bridge') { crossings.append(line(cd, '#4f3c2a', w + 3.4, { 'stroke-linecap': 'butt' }), line(cd, '#e8d8b8', w + 1.2, { 'stroke-linecap': 'butt' })); }
        else if (c.kind === 'causeway') { crossings.append(line(cd, '#5d5446', w + 2.6), line(cd, '#cfc3a5', w + 0.8)); }
        else crossings.append(line(cd, '#3f7fa6', w + 0.6, { 'stroke-dasharray': '1 2.5' }));
      }
      const hit = line(d, 'transparent', Math.max(8, w + 6)); hit.style.pointerEvents = 'stroke'; hit.dataset.road = '';
      const title = document.createElementNS(ns, 'title'); title.textContent = describe(s); hit.append(title); hits.append(hit);
    }
    layer.append(casings, fills, crossings, hits);
  }
  function describe(s: RoadSegment): string {
    const profile = ROAD_PROFILES.find(p => p.id === s.profile)?.label ?? s.profile;
    const bridges = s.crossings.length ? ` · ${s.crossings.map(c => c.kind).join(', ')}` : '';
    return `${CLASS_LABEL[s.class]} · ${SURFACE_LABEL[s.surface]} · ${profile}\n${(s.length / 1000).toFixed(2)} km · steepest ${(s.grade * 100).toFixed(1)} % · width ${s.width.toFixed(1)} m${bridges}`;
  }
  controls(); legend();
  return {
    get config(): RoadConfig { return config; },
    get enabled(): boolean { return enabled; },
    pending(text = 'Routing in Rust…'): void { q('#roadStatus').textContent = text; panel.setAttribute('aria-busy', 'true'); },
    error(text: string): void { q('#roadStatus').textContent = `Roads: ${text}`; panel.removeAttribute('aria-busy'); },
    set(next: RoadOutput | undefined): void {
      output = next; panel.removeAttribute('aria-busy');
      const km = next ? next.segments.reduce((sum, s) => sum + s.length, 0) / 1000 : 0;
      q('#roadState').textContent = next ? `${km.toFixed(0)} km` : '';
      q('#roadStatus').textContent = !enabled ? 'Road generation disabled.' : next
        ? `Rust · ${next.segments.length} segments · ${next.junctions.length} junctions · ${km.toFixed(1)} km from ${next.routes} routes · ${next.ms.toFixed(0)} ms`
        : 'Waiting for settlements…';
      q('#roadWarnings').textContent = next?.warnings.join('\n') ?? '';
      window.dispatchEvent(new CustomEvent('roads:generated', { detail: next }));
      legend(); draw();
    },
    get output(): RoadOutput | undefined { return output; },
    draw,
    share(): string { return JSON.stringify({ config, enabled, show }); },
  };
}
