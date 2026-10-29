import type { Layout, Partition } from '../../../rust/bridge/urban';
import { buildMapLabels, estimateWidth, nativeLandmarkLabels, placeMapLabels, RPG_PIN_KINDS, type RpgPin } from '../render/mapLabels';
import { placedMapLabelsSvg } from '../render/svgLabels';
import { PALETTES } from '../render/styles';
import type { View } from '../render/view';

export interface RpgPinsState { enabled: boolean; pins: RpgPin[] }
const validPin = (p: unknown): p is RpgPin => {
  if (!p || typeof p !== 'object') return false;
  const pin = p as RpgPin;
  return typeof pin.id === 'string' && typeof pin.kind === 'string' && Object.hasOwn(RPG_PIN_KINDS, pin.kind)
    && typeof pin.text === 'string' && Number.isFinite(pin.x) && Number.isFinite(pin.y);
};
export function readRpgPins(query: URLSearchParams): RpgPinsState {
  let pins: RpgPin[] = [];
  try { const value: unknown = JSON.parse(query.get('rpgPins') ?? '[]'); if (Array.isArray(value)) pins = value.filter(validPin); } catch { /* Malformed annotations do not prevent opening a city. */ }
  return { enabled: query.get('rpgLabels') === '1', pins };
}
export function shareRpgPins(query: URLSearchParams, state: RpgPinsState): void {
  query.delete('rpgLabels'); query.delete('rpgPins');
  if (state.enabled) query.set('rpgLabels', '1');
  if (state.pins.length) query.set('rpgPins', JSON.stringify(state.pins));
}

/** City Bench backgrounds are catalogue URLs; downloaded SVGs need retained pixels. */
export async function prepareCityMapExport(copy: SVGSVGElement): Promise<void> {
  await Promise.all(Array.from(copy.querySelectorAll('image')).map(async image => {
    const href = image.getAttribute('href'); if (!href || href.startsWith('data:') || href.startsWith('#')) return;
    const response = await fetch(new URL(href, document.baseURI));
    if (!response.ok) throw new Error(`Fond de carte indisponible (${response.status}).`);
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
    image.setAttribute('href', data);
  }));
}

/** A retained SVG layer: both existing plan exports include the same placed labels. */
export function mountCityRpgPins(options: {
  map: SVGSVGElement; viewport: HTMLElement; host: Element; query: URLSearchParams; labels: boolean;
  getView(): View; getLayouts(): Layout[] | undefined; getPartitions(): Partition[] | undefined;
  focus(view: View): void; onChange(): void; onPinning(): void;
}) {
  const ns = 'http://www.w3.org/2000/svg', state = readRpgPins(options.query);
  const layer = document.createElementNS(ns, 'g'); layer.id = 'cityRpgPins'; layer.setAttribute('pointer-events', 'none');
  const controls = document.createElement('div'); controls.dataset.rpgControls = '';
  controls.innerHTML = `<label title="Affiche les épingles JDR et les noms des monuments générés, y compris dans les exports."><input data-rpg-enabled type="checkbox">Épingles et étiquettes JDR</label>
    <div data-rpg-editor><small>Ces repères font partie de la carte ; les épingles de signalement restent dans « Situation à signaler ».</small>
    <label>Type de repère<select data-rpg-kind>${Object.entries(RPG_PIN_KINDS).map(([k, text]) => `<option value="${k}">${text}</option>`).join('')}</select></label>
    <label>Étiquette<input data-rpg-text type="text" maxlength="120" placeholder="Nom du lieu…"></label>
    <button data-rpg-place type="button" aria-pressed="false">Placer sur la carte</button><ol data-rpg-list></ol></div><small data-rpg-status role="status"></small>`;
  const group = options.host.querySelector('[data-reddit-walls], [data-reddit-options]');
  if (group) group.append(controls);
  else {
    const existing = Array.from(options.host.querySelectorAll('details')).find(d => d.querySelector('summary')?.textContent === 'Options Reddit (27/10)');
    if (existing) existing.append(controls);
    else { const details = document.createElement('details'); details.className = 'advanced'; details.dataset.redditOptions = ''; details.innerHTML = '<summary>Options Reddit (27/10)</summary>'; details.append(controls); options.host.append(details); }
  }
  const find = <T extends HTMLElement>(selector: string): T => controls.querySelector<T>(selector)!;
  const enabled = find<HTMLInputElement>('[data-rpg-enabled]'), editor = find<HTMLElement>('[data-rpg-editor]');
  const picker = find<HTMLSelectElement>('[data-rpg-kind]'), text = find<HTMLInputElement>('[data-rpg-text]'), place = find<HTMLButtonElement>('[data-rpg-place]');
  const status = find<HTMLElement>('[data-rpg-status]');
  let pinning = false, layouts: Layout[] | undefined, partitions: Partition[] | undefined, landmarks: ReturnType<typeof nativeLandmarkLabels> = [];
  const cancel = (): void => { pinning = false; place.setAttribute('aria-pressed', 'false'); };
  function draw(): void {
    if (!state.enabled || !options.labels) { layer.remove(); return; }
    const nextLayouts = options.getLayouts(), nextPartitions = options.getPartitions();
    if (layouts !== nextLayouts || partitions !== nextPartitions) { layouts = nextLayouts; partitions = nextPartitions; landmarks = nativeLandmarkLabels(layouts, partitions); }
    const view = options.getView(), w = options.viewport.clientWidth, h = options.viewport.clientHeight;
    const palette = PALETTES[document.querySelector<HTMLSelectElement>('#backgroundStyle')?.value === 'parchment' ? 'parchment' : 'atlas'];
    const labels = buildMapLabels({ mapAnnotations: { ...state, landmarks } }, palette.name, palette);
    const placed = placeMapLabels(labels, view, w, h, estimateWidth);
    layer.setAttribute('transform', `translate(${view.cx - w / 2 / view.scale} ${view.cy - h / 2 / view.scale})`);
    layer.innerHTML = placedMapLabelsSvg(placed, palette, view.scale);
    const bugPins = options.map.querySelector('#cityPins');
    if (bugPins) options.map.insertBefore(layer, bugPins); else if (options.map.lastChild !== layer) options.map.append(layer);
  }
  function list(): void {
    const items = find<HTMLOListElement>('[data-rpg-list]');
    items.replaceChildren(...state.pins.map(p => {
      const li = document.createElement('li'), name = document.createElement('input'), focus = document.createElement('button'), remove = document.createElement('button');
      name.value = p.text; name.maxLength = 120; name.setAttribute('aria-label', `Étiquette · ${RPG_PIN_KINDS[p.kind]}`);
      name.oninput = () => { p.text = name.value.trim() || RPG_PIN_KINDS[p.kind]; draw(); options.onChange(); };
      focus.type = remove.type = 'button'; focus.textContent = '◎'; focus.title = `Cadrer · ${RPG_PIN_KINDS[p.kind]}`; remove.textContent = '×'; remove.title = 'Supprimer le repère';
      focus.onclick = () => options.focus({ ...options.getView(), cx: p.x, cy: p.y });
      remove.onclick = () => { state.pins.splice(state.pins.indexOf(p), 1); list(); draw(); options.onChange(); };
      li.append(name, focus, remove); return li;
    }));
  }
  function sync(): void {
    enabled.checked = state.enabled; editor.hidden = !state.enabled;
    if (!options.labels) status.textContent = 'labels=0 : les repères sont conservés mais masqués sur la carte et dans les exports.';
    draw();
  }
  enabled.onchange = () => { state.enabled = enabled.checked; cancel(); sync(); options.onChange(); };
  place.onclick = () => { pinning = !pinning; place.setAttribute('aria-pressed', String(pinning)); if (pinning) options.onPinning(); status.textContent = pinning ? 'Cliquez sur la carte pour poser le repère.' : ''; };
  list(); sync();
  return {
    draw, cancel,
    share: (query: URLSearchParams): void => shareRpgPins(query, state),
    click(event: MouseEvent): boolean {
      if (!pinning || !state.enabled) return false;
      const rect = options.viewport.getBoundingClientRect(), view = options.getView(), kind = picker.value as RpgPin['kind'];
      state.pins.push({ id: crypto.randomUUID(), kind, text: text.value.trim() || RPG_PIN_KINDS[kind],
        x: view.cx + (event.clientX - rect.left - rect.width / 2) / view.scale, y: view.cy + (event.clientY - rect.top - rect.height / 2) / view.scale });
      cancel(); list(); draw(); options.onChange(); status.textContent = 'Repère posé.'; return true;
    },
  };
}
