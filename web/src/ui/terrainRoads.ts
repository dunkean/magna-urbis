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

/** How one road is drawn: fill, optional casing (drawn 1.6 px wider underneath), width, dash. */
interface RoadPaint { fill: string; casing: string | null; width: number; dash?: string }
export type RoadPreset = 'surface' | 'atlas' | 'topographic' | 'ink' | 'minimal';
/** Display only: changing it redraws the network without routing it again. */
export interface RoadStyle { preset: RoadPreset; width: number; opacity: number; curves: boolean; casing: boolean; crossings: boolean }
export const defaultRoadStyle = (): RoadStyle => ({ preset: 'surface', width: 1, opacity: 1, curves: true, casing: true, crossings: true });
const byClass = (colors: Record<RoadClass, [string, string | null]>, widths: Record<RoadClass, number> = CLASS_PX, dash = DASH) =>
  (c: RoadClass): RoadPaint => ({ fill: colors[c][0], casing: colors[c][1], width: widths[c], dash: dash[c] });
const PRESETS: Record<RoadPreset, { label: string; paint(c: RoadClass, s: RoadSurface): RoadPaint }> = {
  surface: { label: 'By surface', paint: (c, s) => ({ fill: SURFACE_COLOR[s][0], casing: SURFACE_COLOR[s][1], width: CLASS_PX[c], dash: DASH[c] }) },
  atlas: {
    label: 'Road atlas',
    paint: byClass({ highway: ['#d8342c', '#7a1d18'], main: ['#f2a33a', '#7a4a12'], local: ['#fff8e6', '#6b5a45'], track: ['#8a6a45', null], trail: ['#8a6a45', null] }),
  },
  topographic: {
    label: 'Topographic',
    paint: byClass({ highway: ['#e8412f', '#262626'], main: ['#f7d54c', '#262626'], local: ['#ffffff', '#303030'], track: ['#303030', null], trail: ['#303030', null] },
      { highway: 3.4, main: 2.8, local: 2.0, track: 1.1, trail: 0.9 }, { track: '6 2.5', trail: '2.5 2.5' }),
  },
  ink: {
    label: 'Ink on parchment',
    paint: byClass({ highway: ['#3f2a1c', null], main: ['#4a3222', null], local: ['#56392a', null], track: ['#5f4334', null], trail: ['#6a4d3c', null] },
      { highway: 2.4, main: 1.9, local: 1.4, track: 1.1, trail: 0.9 }, { track: '6 3', trail: '1 2.6' }),
  },
  minimal: {
    label: 'Minimal',
    paint: byClass({ highway: ['#4d463e', null], main: ['#4d463e', null], local: ['#5d554b', null], track: ['#6e655a', null], trail: ['#6e655a', null] },
      { highway: 2.0, main: 1.6, local: 1.2, track: 1.0, trail: 0.8 }, { trail: '3 3' }),
  },
};
const PRESET_IDS = Object.keys(PRESETS) as RoadPreset[];
/** The paint of a road under a style: the preset scaled by the width setting, casing optional. */
function paintOf(style: RoadStyle, c: RoadClass, s: RoadSurface): RoadPaint {
  const p = PRESETS[style.preset].paint(c, s);
  return { ...p, width: p.width * style.width, casing: style.casing ? p.casing : null };
}
const pathData = (points: Point[]): string => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
/** Douglas-Peucker: drops the vertices within `tolerance` metres of the line, the small jogs
 *  a route keeps from its grid, so the curve through the rest bends only where the road does. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!, pa = points[a], pb = points[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy);
    let far = -1, worst = tolerance;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const d = len > 1e-9 ? Math.abs((p.x - pa.x) * dy - (p.y - pa.y) * dx) / len : Math.hypot(p.x - pa.x, p.y - pa.y);
      if (d > worst) { worst = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** A centripetal Catmull-Rom curve through the points, as cubic Béziers: no corners at any zoom,
 *  and no overshoot where the vertices are unevenly spaced. */
const curveData = (path: Point[]): string => {
  const points = simplify(path, 2);
  if (points.length < 3) return pathData(points);
  const f = (v: number): string => v.toFixed(2);
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const d1 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)), d2 = Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y)), d3 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y));
    const c1 = d1 < 1e-6 ? p1 : {
      x: (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) / (3 * d1 * (d1 + d2)),
      y: (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) / (3 * d1 * (d1 + d2)),
    };
    const c2 = d3 < 1e-6 ? p2 : {
      x: (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) / (3 * d3 * (d3 + d2)),
      y: (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) / (3 * d3 * (d3 + d2)),
    };
    d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  return d;
};
const esc = (text: string): string => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The "Roads" stage: its own options, status and drawing; placement never runs from here. */
export function createTerrainRoads(options: { map: SVGSVGElement; before: Element | null; onConfigChange(): void; onDisplayChange(): void }) {
  let config = defaultRoadConfig(), style = defaultRoadStyle(), enabled = true, show = true, output: RoadOutput | undefined;
  let drawnLayer: SVGGElement | undefined, drawnState = '', drawn: RoadOutput | undefined;
  const saved = new URLSearchParams(location.search).get('roads');
  if (saved) try {
    const s = JSON.parse(saved);
    for (const key of Object.keys(config) as (keyof RoadConfig)[]) if (s.config?.[key] !== undefined) (config as unknown as Record<string, unknown>)[key] = s.config[key];
    for (const key of Object.keys(style) as (keyof RoadStyle)[]) if (typeof s.style?.[key] === typeof style[key]) (style as unknown as Record<string, unknown>)[key] = s.style[key];
    if (!PRESETS[style.preset]) style.preset = 'surface';
    enabled = s.enabled !== false; show = s.show !== false;
  } catch { config = defaultRoadConfig(); style = defaultRoadStyle(); }
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
    <details class="advanced" id="roadRendering"><summary>Rendering</summary><div class="control-group">
    <label title="Colours, casings and dashes of the road classes">Style <select id="roadPreset">${PRESET_IDS.map(id => `<option value="${id}">${esc(PRESETS[id].label)}</option>`).join('')}</select></label>
    <label title="Multiplies the line widths">Width × <input data-road-style="width" type="range" min="0.4" max="3" step="0.1"><output id="roadWidthValue"></output></label>
    <label>Opacity <input data-road-style="opacity" type="range" min="0.2" max="1" step="0.05"><output id="roadOpacityValue"></output></label>
    <label title="Draw the roads as smooth curves rather than straight pieces"><input data-road-style="curves" type="checkbox">Smooth curves</label>
    <label title="Dark edge under the paved and gravel roads"><input data-road-style="casing" type="checkbox">Casing</label>
    <label><input data-road-style="crossings" type="checkbox">Bridges &amp; fords</label>
    </div></details>
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
    select('roadPreset').value = style.preset;
    for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-road-style]'))) {
      const value = style[c.dataset.roadStyle as keyof RoadStyle];
      if (c.type === 'checkbox') c.checked = value as boolean; else c.value = String(value);
    }
    q('#roadWidthValue').textContent = `${style.width.toFixed(1)}`;
    q('#roadOpacityValue').textContent = `${Math.round(style.opacity * 100)} %`;
    panel.querySelectorAll<HTMLElement>('.stage-controls > :not(:first-child)').forEach(e => { if (e.id !== 'roadStatus') e.toggleAttribute('inert', !enabled); });
  }
  function changed(): void { controls(); options.onConfigChange(); }
  input('roadEnabled').onchange = () => { enabled = input('roadEnabled').checked; changed(); };
  input('roadShow').onchange = () => { show = input('roadShow').checked; draw(); options.onDisplayChange(); };
  /** Rendering settings redraw only; the URL follows on release of a slider. */
  function restyle(commit: boolean): void { controls(); legend(); draw(); if (commit) options.onDisplayChange(); }
  select('roadPreset').onchange = () => { style.preset = select('roadPreset').value as RoadPreset; restyle(true); };
  for (const c of Array.from(panel.querySelectorAll<HTMLInputElement>('[data-road-style]'))) {
    const key = c.dataset.roadStyle as keyof RoadStyle;
    const apply = (commit: boolean): void => {
      (style as unknown as Record<string, unknown>)[key] = c.type === 'checkbox' ? c.checked : Number(c.value);
      restyle(commit);
    };
    if (c.type === 'range') c.oninput = () => apply(false);
    c.onchange = () => apply(true);
  }
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
      const { fill, casing, width, dash } = paintOf(style, cls, surface), w = Math.min(width, 7), d = dash ? ` stroke-dasharray="${dash}"` : '';
      return `<svg width="26" height="10" aria-hidden="true" opacity="${style.opacity}">${casing ? `<line x1="2" y1="5" x2="24" y2="5" stroke="${casing}" stroke-width="${w + 1.6}" stroke-linecap="round"${d}/>` : ''}<line x1="2" y1="5" x2="24" y2="5" stroke="${fill}" stroke-width="${w}" stroke-linecap="round"${d}/></svg>`;
    };
    const km = (v = 0): string => `${(v / 1000).toFixed(1)} km`;
    q('#roadLegend').innerHTML = `<div>${classes.map(c => {
      const surface = surfaces.find(s => used.has(`${c}|${s}`)) ?? (c === 'trail' || c === 'track' ? 'dirt' : 'paved');
      return `<span>${sample(c, surface)}${CLASS_LABEL[c]}${output ? ` · ${km(output.lengthByClass[c])}` : ''}</span>`;
    }).join('')}</div><div>${surfaces.map(s => {
      const swatch = style.preset === 'surface' ? `<i style="background:${SURFACE_COLOR[s][0]};border-color:${SURFACE_COLOR[s][1] ?? SURFACE_COLOR[s][0]}"></i>` : '';
      return `<span>${swatch}${SURFACE_LABEL[s]}${output ? ` · ${km(output.lengthBySurface[s])}` : ''}</span>`;
    }).join('')}</div>`;
  }
  /** Minor roads first, casings under all fills, so junctions merge cleanly. */
  function draw(): void {
    let layer = options.map.querySelector<SVGGElement>('#roadOverlay');
    if (!layer) {
      layer = document.createElementNS(ns, 'g'); layer.id = 'roadOverlay';
      const markers = options.map.querySelector('#settlementOverlay');
      if (markers) options.map.insertBefore(layer, markers); else options.map.append(layer);
    }
    const state = `${enabled}|${show}|${JSON.stringify(style)}`;
    if (layer === drawnLayer && drawn === output && state === drawnState) return;
    drawnLayer = layer; drawn = output; drawnState = state; layer.replaceChildren();
    if (!output || !show || !enabled) return;
    const order = [...output.segments].sort((a, b) => ROAD_CLASSES.indexOf(b.class) - ROAD_CLASSES.indexOf(a.class));
    const line = (d: string, stroke: string, width: number, extra: Record<string, string> = {}): SVGPathElement => {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', String(+width.toFixed(2))); p.setAttribute('vector-effect', 'non-scaling-stroke'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
      for (const [k, v] of Object.entries(extra)) p.setAttribute(k, v);
      return p;
    };
    const casings = document.createElementNS(ns, 'g'), fills = document.createElementNS(ns, 'g'), crossings = document.createElementNS(ns, 'g'), hits = document.createElementNS(ns, 'g');
    casings.style.pointerEvents = fills.style.pointerEvents = crossings.style.pointerEvents = 'none';
    // One group opacity, so casings and overlapping roads do not show through each other.
    const painted = document.createElementNS(ns, 'g');
    if (style.opacity < 1) painted.setAttribute('opacity', String(style.opacity));
    for (const s of order) {
      const d = style.curves ? curveData(s.path) : pathData(s.path), { fill, casing, width: w, dash } = paintOf(style, s.class, s.surface);
      const extra: Record<string, string> = dash ? { 'stroke-dasharray': dash } : {};
      if (casing) casings.append(line(d, casing, w + 1.6, extra));
      fills.append(line(d, fill, w, extra));
      if (style.crossings) for (const c of s.crossings) {
        const cd = pathData(c.path);
        if (c.kind === 'bridge') { crossings.append(line(cd, '#4f3c2a', w + 3.4, { 'stroke-linecap': 'butt' }), line(cd, '#e8d8b8', w + 1.2, { 'stroke-linecap': 'butt' })); }
        else if (c.kind === 'causeway') { crossings.append(line(cd, '#5d5446', w + 2.6), line(cd, '#cfc3a5', w + 0.8)); }
        else crossings.append(line(cd, '#3f7fa6', w + 0.6, { 'stroke-dasharray': '1 2.5' }));
      }
      const hit = line(d, 'transparent', Math.max(8, w + 6)); hit.style.pointerEvents = 'stroke'; hit.dataset.road = '';
      const title = document.createElementNS(ns, 'title'); title.textContent = describe(s); hit.append(title); hits.append(hit);
    }
    painted.append(casings, fills, crossings);
    layer.append(painted, hits);
  }
  function describe(s: RoadSegment): string {
    const profile = ROAD_PROFILES.find(p => p.id === s.profile)?.label ?? s.profile;
    const bridges = s.crossings.length ? ` · ${s.crossings.map(c => c.kind).join(', ')}` : '';
    return `${CLASS_LABEL[s.class]} · ${SURFACE_LABEL[s.surface]} · ${profile}\n${(s.length / 1000).toFixed(2)} km · steepest ${(s.grade * 100).toFixed(1)} % · width ${s.width.toFixed(1)} m${bridges}`;
  }
  controls(); legend();
  return {
    get config(): RoadConfig { return config; },
    /** Replace the routing options (a loaded decor's), without routing. */
    setConfig(next: RoadConfig): void { config = { ...defaultRoadConfig(), ...next }; controls(); },
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
    share(): string { return JSON.stringify({ config, style, enabled, show }); },
  };
}
