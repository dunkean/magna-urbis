import { createTerrainSettlements } from './terrainSettlements';
import { createTerrainDecorLibrary } from './terrainDecorLibrary';
import { createHistoryPanel, downloadHistory, openBench, readHistory, saveHistory, syncBenchUrl } from './benchHistory';
import { terrainFromDecor } from './benchTerrainTransfer';
import type { Decor } from './decor';
import { downloadDecorFile, readDecorFile } from './decorFile';
import { clampView, fitView, panBy, zoomAt, type View } from '../render/view';
import { applyExecutionProfile, installExecutionProfile } from './executionProfile';
import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import type {} from './benchContext';
import { decodeSituation, encodeSituation, type SituationPin } from './citySituation';
import { mountCity3d } from './city3d';

declare global { interface Window { magnaCityBackground?: { url(): string | undefined; style(): string } } }

/**
 * City Bench: one city on a prebuilt map. The terrain is never generated or rendered live:
 * the map shows the image pre-rendered with its .decor (web/scripts/render_city_maps.mjs),
 * and the settlement, road and urban stages run on the decor raster, as in Settlements.
 */
installExecutionProfile(document.querySelector('header')!);
const ns = 'http://www.w3.org/2000/svg';
const query = new URLSearchParams(location.search);
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const map = document.getElementById('map') as unknown as SVGSVGElement, viewport = el('viewport'), stages = document.querySelector('.stages')!;
let decor: Decor | undefined, terrain: TerrainData | undefined, ready = false, lastExport: Decor | undefined;
let view: View = { cx: 0, cy: 0, scale: 1 };
const status = (text: string): void => { el('status').textContent = text; };

// The background sits under every overlay the stages add to the map.
const background = document.createElementNS(ns, 'g'); background.id = 'cityBackground'; map.append(background);
// Situation pins stay above every stage overlay (re-appended after each view change).
const pinLayer = document.createElementNS(ns, 'g'); pinLayer.id = 'cityPins';
function showView(): void {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  map.setAttribute('viewBox', `${view.cx - w / 2 / view.scale} ${view.cy - h / 2 / view.scale} ${w / view.scale} ${h / view.scale}`);
  settlements.updateView();
  drawPins();
}
function setView(next: View): void { view = terrain ? clampView(next, terrain.width, viewport.clientWidth, viewport.clientHeight) : next; showView(); }
const fit = (): void => { if (terrain) setView(fitView(terrain.width, viewport.clientWidth, viewport.clientHeight)); };

/** Map background style: Relief is `decors/<id>.png` (atlas), Rendu and Parchemin are
 * `decors/<id>-render.png` / `-parchment.png` (render_city_maps.mjs --style), same pixels. */
type BackgroundStyle = 'relief' | 'render' | 'parchment';
const BACKGROUND_LABELS: Record<BackgroundStyle, string> = { relief: 'Relief', render: 'Rendu', parchment: 'Parchemin' };
const isBackgroundStyle = (v: string | null): v is BackgroundStyle => !!v && v in BACKGROUND_LABELS;
let backgroundStyle: BackgroundStyle = isBackgroundStyle(query.get('fond')) ? query.get('fond') as BackgroundStyle : 'relief';
let backgroundTicket = 0;
/** Current background image URL (pre-rendered PNG or computed hillshade data URL): what the 3D view drapes. */
const backgroundUrl = (): string | undefined => background.querySelector('image')?.getAttribute('href') ?? undefined;
window.magnaCityBackground = { url: backgroundUrl, style: () => backgroundStyle };

/** Pre-rendered map image of the chosen style, else the relief image, else a quick
 * hillshade of the raster (imported decors without image). */
async function drawBackground(d: Decor): Promise<void> {
  const width = d.raster.width, source = d.meta.id.startsWith('city-') ? d.meta.id : d.meta.pipeline?.parent, ticket = ++backgroundTicket;
  const image = document.createElementNS(ns, 'image');
  for (const [key, value] of Object.entries({ x: '0', y: '0', width: String(width), height: String(width), preserveAspectRatio: 'none' })) image.setAttribute(key, value);
  const exists = (url: string): Promise<boolean> => fetch(url, { method: 'HEAD' }).then(r => r.ok && !!r.headers.get('content-type')?.startsWith('image/'), () => false);
  const styled = source && backgroundStyle !== 'relief' ? `decors/${source}-${backgroundStyle}.png` : undefined, relief = source ? `decors/${source}.png` : undefined;
  let url: string | undefined;
  for (const candidate of [styled, relief]) if (candidate && await exists(candidate)) { url = candidate; break; }
  if (ticket !== backgroundTicket) return;
  image.setAttribute('href', url ?? hillshade(d));
  background.replaceChildren(image);
  city3d.refresh();
  if (!url) status('Image pré-rendue absente pour cette carte : ombrage calculé depuis le relief.');
  else if (styled && url !== styled) status(`Fond « ${BACKGROUND_LABELS[backgroundStyle]} » absent pour cette carte : relief affiché (node scripts/render_city_maps.mjs --style ${backgroundStyle}).`);
}
/** Parchemin background ⇒ parchment city palette; leaving it gives the previous palette back. */
let paletteBeforeParchment = 'growth';
function syncCityPalette(): void {
  const select = document.querySelector<HTMLSelectElement>('select[data-render="palette"]'); if (!select) return;
  if (!select.querySelector('option[value="parchment"]')) select.append(new Option('Parchemin · encre', 'parchment'));
  const current = select.value, set = (value: string): void => { select.value = value; select.dispatchEvent(new Event('change')); };
  if (backgroundStyle === 'parchment') { if (current !== 'parchment') { if (current) paletteBeforeParchment = current; set('parchment'); } }
  else if (current === 'parchment' || !current) set(paletteBeforeParchment);
}
/** Rendu background ⇒ painted road preset (casings, surfaces, stone bridges); leaving it gives the previous preset back. */
let presetBeforeRender = 'surface';
function syncRoadPreset(): void {
  const select = document.querySelector<HTMLSelectElement>('#roadPreset'); if (!select) return;
  const current = select.value, set = (value: string): void => { select.value = value; select.dispatchEvent(new Event('change')); };
  if (backgroundStyle === 'render') { if (current !== 'render') { presetBeforeRender = current || 'surface'; set('render'); } }
  else if (current === 'render') set(presetBeforeRender);
}
function hillshade(d: Decor): string {
  const { n, height, water, width } = d.raster, cell = width / n, canvas = document.createElement('canvas'); canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(n, n);
  let low = Infinity, high = -Infinity; for (let i = 0; i < height.length; i++) if (!water[i]) { low = Math.min(low, height[i]); high = Math.max(high, height[i]); }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, o = i * 4;
    if (water[i]) { pixels.data.set([143, 186, 215, 255], o); continue; }
    const dx = (height[y * n + Math.min(n - 1, x + 1)] - height[y * n + Math.max(0, x - 1)]) / (2 * cell), dy = (height[Math.min(n - 1, y + 1) * n + x] - height[Math.max(0, y - 1) * n + x]) / (2 * cell);
    const light = Math.max(0, Math.min(1, 0.75 + (-dx - dy) * 1.4)), t = (height[i] - low) / Math.max(1, high - low);
    pixels.data.set([(200 + 40 * t) * light, (205 + 10 * t) * light, (160 + 30 * t) * light, 255].map(Math.round), o);
  }
  ctx.putImageData(pixels, 0, 0); return canvas.toDataURL();
}

function shareQuery(): string {
  const params = new URLSearchParams(); if (decor) params.set('artifact', decor.meta.id);
  settlements.share(params);
  if (backgroundStyle !== 'relief') params.set('fond', backgroundStyle);
  return applyExecutionProfile(new URL(`?${params}`, location.href)).searchParams.toString();
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const url = new URL(location.href); url.search = shareQuery(); if (query.get('standalone') === '1') url.searchParams.set('standalone', '1');
    try { history.replaceState(null, '', url); syncBenchUrl(); } catch { /* file:// may refuse replaceState. */ }
  }, 150);
}

// Catalogue first, then the stages, then the local history of kept exports.
const anchor = document.createElement('div'); stages.append(anchor);
createTerrainDecorLibrary({ before: anchor, city: true, onOpen: d => openBench('city', new URLSearchParams({ artifact: d.meta.id })) });
const settlements = createTerrainSettlements({ map, viewport, city: true, active: true, parcelDefault: false,
  getTerrain: () => terrain,
  getSettings: () => ({ seed: decor?.meta.seed ?? '', width: decor?.raster.width ?? 0, relief: new URLSearchParams(decor?.meta.query).get('relief') ?? 'flat' }) as TerrainSettings,
  getRaster: () => decor?.raster, getDecor: () => decor, getView: () => view, getAuto: () => false, getQuery: shareQuery,
  onChange: () => { save(); city3d.refresh(); }, onPicking: () => {},
  onFocus: (center, radius) => city3d.active ? city3d.focus(center, radius) : setView({ cx: center.x, cy: center.y, scale: Math.min(viewport.clientWidth, viewport.clientHeight) / Math.max(200, 2.4 * radius) }),
  onProjection: active => { setProjection(active); return city3d.active; },
});
// 3D view (city3d.ts): the decor relief draped with the map image, the plan and the buildings in volume.
const city3d = mountCity3d({ host: viewport, getDecor: () => decor, getScene: () => settlements.urban.buildingState.scene,
  getProjection: () => settlements.urban.buildingProjection,
  getLayouts: () => settlements.urban.layouts, getRegionalStreets: () => settlements.urban.regionalStreets, getPartitions: () => settlements.urban.partitions, getSelected: () => settlements.urban.buildingState.selected,
  details: settlements.urban.buildingDetails,
  getBackground: () => background.querySelector('image')?.getAttribute('href') ?? undefined,
  onSelect: id => settlements.urban.selectBuilding(id) });
const view3d = document.createElement('button'); view3d.type = 'button'; view3d.id = 'view3d'; view3d.setAttribute('aria-pressed', 'false');
el('focusCity').after(view3d);
function setProjection(active: boolean): void {
  if (active) city3d.show(); else city3d.hide();
  view3d.setAttribute('aria-pressed', String(city3d.active)); view3d.textContent = city3d.active ? 'Vue 2D' : 'Vue 3D';
  view3d.title = city3d.active ? 'Revenir à la carte 2D' : 'Voir la ville et ses maisons en 3D';
}
setProjection(false);
view3d.onclick = () => setProjection(!city3d.active);
(window as Window & { magnaCity3d?: typeof city3d }).magnaCity3d = city3d; // Automated checks (stats, capture).
document.querySelector('#roadStage summary')!.childNodes[0].textContent = '2 · Routes ';
const historyAnchor = document.createElement('div'); stages.append(historyAnchor);
const historyPanel = createHistoryPanel({ before: historyAnchor, current: () => lastExport ?? decor, onOpen: d => openBench('city', new URLSearchParams({ artifact: d.meta.id })) });
anchor.remove(); historyAnchor.remove();
document.querySelector('#benchHistory [data-import]')?.closest('label')?.setAttribute('hidden', '');

// Keep and share the applied city; the footer is docked by benchPanels.
const transfer = document.createElement('details'); transfer.className = 'stage'; transfer.id = 'pipelineTransfer'; transfer.open = true;
transfer.innerHTML = '<summary>Conserver et partager</summary><div class="stage-controls"><button id="pipelineSave" type="button">Conserver cet export</button><button id="pipelineDownload" type="button">Partager .decor</button><small id="pipelineStatus" role="status"></small></div>';
stages.append(transfer);
async function keep(download: boolean): Promise<void> {
  try {
    if (settlements.urban.layoutPending || settlements.urban.generationPending) throw new Error('Attendez la fin du calcul du plan et des parcelles.');
    const snapshot = settlements.captureData();
    // Start the browser picker in the button's user activation, before history IO.
    const downloading = download ? downloadDecorFile(snapshot, `${snapshot.meta.id}.decor`).then(() => undefined, error => ({ error })) : undefined;
    const d = await saveHistory(snapshot); lastExport = d; await historyPanel.refresh(d.meta.id);
    const result = await downloading; if (result) throw result.error;
    el('pipelineStatus').textContent = download ? 'Export conservé et téléchargé.' : 'Export conservé dans ce navigateur.';
  } catch (error) { el('pipelineStatus').textContent = error instanceof Error ? error.message : String(error); }
}
el('pipelineSave').onclick = () => void keep(false);
el('pipelineDownload').onclick = () => void keep(true);

// Situation: map, options, camera and pins in one copyable code (or link), to hand
// a reproducible case to someone else or to an agent (web/scripts/city_situation.mjs).
let pins: SituationPin[] = [], pinning = false, situationNote = '';
const situation = document.createElement('details'); situation.className = 'stage'; situation.id = 'citySituation'; situation.open = true;
situation.innerHTML = `<summary>Situation à signaler</summary><div class="stage-controls">
  <small>Copiez un code (ou un lien) qui rouvre exactement cette ville, ce cadrage et vos épingles.</small>
  <div class="settlement-actions"><button id="situationPin" type="button" aria-pressed="false" title="Puis cliquez sur la carte">Épingler un point</button><button id="situationCopy" type="button">Copier le code</button><button id="situationLink" type="button">Copier le lien</button></div>
  <label>Note générale <textarea id="situationNote" rows="2" placeholder="Ce qui ne va pas…"></textarea></label>
  <ol id="situationPins"></ol>
  <label>Coller un code <input id="situationInput" type="text" placeholder="MU1.…" spellcheck="false"></label>
  <div class="settlement-actions"><button id="situationOpen" type="button">Ouvrir ce code</button></div>
  <small id="situationStatus" role="status"></small></div>`;
stages.append(situation);
const situationStatus = (text: string): void => { el('situationStatus').textContent = text; };
function drawPins(): void {
  const k = 1 / view.scale;
  pinLayer.replaceChildren(...pins.map((p, i) => {
    const g = document.createElementNS(ns, 'g'); g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${k})`);
    g.innerHTML = `<path d="M0 0 C -6 -10 -11 -14 -11 -21 A 11 11 0 1 1 11 -21 C 11 -14 6 -10 0 0 Z" fill="#c0392b" stroke="#fff" stroke-width="2"/><text y="-17" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${i + 1}</text>`;
    const title = document.createElementNS(ns, 'title'); title.textContent = p.note || `Épingle ${i + 1}`; g.append(title);
    return g;
  }));
  if (map.lastChild !== pinLayer) map.append(pinLayer);
}
function listPins(): void {
  const list = el('situationPins'); list.replaceChildren(...pins.map((p, i) => {
    const item = document.createElement('li');
    item.innerHTML = `<small>${Math.round(p.x)}, ${Math.round(p.y)} m</small> <input type="text" placeholder="Note de l’épingle"> <button type="button" title="Cadrer">◎</button> <button type="button" title="Supprimer">×</button>`;
    const note = item.querySelector('input')!, [focus, remove] = Array.from(item.querySelectorAll('button'));
    note.value = p.note; note.oninput = () => { p.note = note.value; drawPins(); };
    focus.onclick = () => setView({ cx: p.x, cy: p.y, scale: Math.max(view.scale, 1.5) });
    remove.onclick = () => { pins.splice(i, 1); listPins(); drawPins(); };
    return item;
  }));
}
async function situationCode(): Promise<string> {
  // Execution belongs to whoever reopens the code: never carry a profile or a local port.
  const q = new URLSearchParams(shareQuery()); for (const key of ['profile', 'localServer', 'compute', 'generation']) q.delete(key);
  return encodeSituation({ v: 1, q: q.toString(), view, pins, note: situationNote || undefined, created: new Date().toISOString() });
}
async function copy(text: string, done: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); situationStatus(done); }
  catch { el<HTMLInputElement>('situationInput').value = text; situationStatus('Presse-papiers refusé : le code est dans le champ ci-dessous.'); }
}
const localMap = (): boolean => !!decor && !decor.meta.id.startsWith('city-');
el('situationPin').onclick = () => { pinning = !pinning; el('situationPin').setAttribute('aria-pressed', String(pinning)); situationStatus(pinning ? 'Cliquez sur la carte pour poser l’épingle.' : ''); };
el('situationCopy').onclick = async () => copy(await situationCode(), localMap() ? 'Code copié. Carte locale : joignez aussi son .decor.' : 'Code copié.');
el('situationLink').onclick = async () => {
  const url = new URL(location.pathname, location.href); url.searchParams.set('situation', await situationCode());
  if (query.get('standalone') === '1') url.searchParams.set('standalone', '1');
  await copy(url.href, 'Lien copié.');
};
el<HTMLTextAreaElement>('situationNote').oninput = event => { situationNote = (event.target as HTMLTextAreaElement).value; };
el('situationOpen').onclick = async () => {
  try { await openSituation(el<HTMLInputElement>('situationInput').value); } catch (error) { situationStatus(error instanceof Error ? error.message : String(error)); }
};
/** Reload the bench on the situation's query; camera and pins follow through session storage. */
async function openSituation(code: string): Promise<void> {
  const s = await decodeSituation(code);
  try { sessionStorage.setItem('magna-city-situation', JSON.stringify({ view: s.view, pins: s.pins, note: s.note })); } catch { /* Private mode: the options still open. */ }
  const url = new URL(location.pathname, location.href); url.search = s.q;
  if (query.get('standalone') === '1') url.searchParams.set('standalone', '1');
  location.replace(url.href);
}
function restoreSituation(): void {
  let saved: { view?: View; pins?: SituationPin[]; note?: string } | undefined;
  try { saved = JSON.parse(sessionStorage.getItem('magna-city-situation') ?? 'null') ?? undefined; sessionStorage.removeItem('magna-city-situation'); } catch { return; }
  if (!saved) return;
  pins = saved.pins ?? []; situationNote = saved.note ?? ''; el<HTMLTextAreaElement>('situationNote').value = situationNote;
  listPins(); if (saved.view) setView(saved.view); drawPins();
  situationStatus(`Situation ouverte · ${pins.length} épingle(s).`);
}

// Navigation: wheel zoom, drag pan; markers and picking are handled by the settlement stage first.
let drag: { x: number; y: number; moved: boolean; pointer: number } | undefined, suppressClick = false;
viewport.addEventListener('wheel', event => {
  event.preventDefault(); const rect = viewport.getBoundingClientRect();
  setView(zoomAt(view, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height));
}, { passive: false });
viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 || settlements.isPicking()) return;
  drag = { x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
});
window.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true; map.classList.add('drag'); drag.x = event.clientX; drag.y = event.clientY; setView(panBy(view, dx, dy));
});
window.addEventListener('pointerup', event => { if (drag?.pointer !== event.pointerId) return; suppressClick = drag.moved; drag = undefined; map.classList.remove('drag'); });
map.addEventListener('click', event => {
  if (suppressClick) { suppressClick = false; event.stopImmediatePropagation(); return; }
  if (pinning) {
    const rect = viewport.getBoundingClientRect();
    pins.push({ x: view.cx + (event.clientX - rect.left - rect.width / 2) / view.scale, y: view.cy + (event.clientY - rect.top - rect.height / 2) / view.scale, note: '' });
    pinning = false; el('situationPin').setAttribute('aria-pressed', 'false'); situationStatus('Épingle posée : ajoutez une note.');
    listPins(); drawPins(); event.stopImmediatePropagation(); return;
  }
  if (settlements.click(event)) event.stopImmediatePropagation();
}, true);
new ResizeObserver(() => showView()).observe(viewport);
el('fit').onclick = fit;
el('focusCity').onclick = () => { const e = settlements.urban.extent; if (e && city3d.active) city3d.focus(e.center, e.radius); else if (e) setView({ cx: e.center.x, cy: e.center.y, scale: Math.min(viewport.clientWidth, viewport.clientHeight) / Math.max(200, 2.4 * e.radius) }); else fit(); };
el<HTMLInputElement>('showBackground').onchange = event => { background.style.display = (event.target as HTMLInputElement).checked ? '' : 'none'; };
el<HTMLSelectElement>('backgroundStyle').value = backgroundStyle;
el<HTMLSelectElement>('backgroundStyle').onchange = event => {
  const value = (event.target as HTMLSelectElement).value; if (!isBackgroundStyle(value)) return;
  backgroundStyle = value; syncCityPalette(); syncRoadPreset(); save();
  // The city layer reads it for its bridges (stone decks on the Rendu background).
  document.documentElement.dataset.cityBackground = backgroundStyle; settlements.updateView();
  if (decor) void drawBackground(decor);
};
syncCityPalette(); syncRoadPreset(); document.documentElement.dataset.cityBackground = backgroundStyle;
el<HTMLInputElement>('backgroundOpacity').oninput = event => { background.setAttribute('opacity', (event.target as HTMLInputElement).value); };

/** An export of this browser, otherwise the catalogue file of the same id. */
async function load(id: string): Promise<Decor> {
  try { return await readHistory(id); } catch {
    const response = await fetch(`decors/${id}.decor`); if (!response.ok) throw new Error(`Carte introuvable : ${id}`);
    return saveHistory(await readDecorFile(await response.blob()), false);
  }
}
const artifact = query.get('artifact'), sharedSituation = query.get('situation');
if (sharedSituation) void openSituation(sharedSituation).catch(error => { status(String(error)); ready = true; });
else if (artifact) {
  status('Chargement de la carte…');
  void load(artifact).then(async d => {
    decor = d; lastExport = d; terrain = terrainFromDecor(d);
    fit(); await drawBackground(d);
    settlements.restoreDecor(d);
    if (el('status').textContent === 'Chargement de la carte…') status(`${d.meta.label} · ${(d.raster.width / 1000).toFixed(0)} km`);
    save(); restoreSituation();
  }).catch(error => status(String(error))).finally(() => { ready = true; });
} else { ready = true; showView(); }
window.magnaBenchContext = { ready: () => ready, capture: () => ({ view }), restore: saved => { if (saved?.view) setView(saved.view); }, comparison: settlements.urban.comparison };
