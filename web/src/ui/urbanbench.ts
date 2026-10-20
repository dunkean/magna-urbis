import { retainedWaterMaterial } from './decorWater';
import { urbanOptionSync } from './urbanOptionSync';
import { createTerrainUrban } from './terrainUrban';
import { createUrbanWorkshop } from './urbanWorkshop';
import { readHistory, saveHistory, openBench, syncBenchUrl } from './benchHistory';
import { encodeDecor, type Decor } from './decor';
import { downloadBytes } from './decorCapture';
import type { WorkshopState } from './testbenchUrban';
import { installRecipeSharing, portableRecipe } from './recipeSharing';
import type {} from './benchContext';
import { applyExecutionProfile, installExecutionProfile } from './executionProfile';

installExecutionProfile(document.querySelector('header')!);

const query = new URLSearchParams(location.search);
let decor: Decor | undefined, ready = false;
const urban = createTerrainUrban({ map: document.getElementById('map') as unknown as SVGSVGElement, before: document.getElementById('status'),
  getTerrain: () => undefined, getRaster: () => decor?.raster, getSeed: () => decor?.meta.seed ?? '', getAuto: () => false, onChange: () => {} });
function share(): string {
  const params = new URLSearchParams(); if (decor) params.set('artifact', decor.meta.id);
  workshop.share(params); return applyExecutionProfile(new URL(`?${params}`, location.href)).searchParams.toString();
}
const publishOptions = urbanOptionSync(() => decor?.meta.pipeline?.parent && decor.meta.pipeline.city ? `${decor.meta.pipeline.syncSource ?? decor.meta.pipeline.parent}:${decor.meta.pipeline.city}` : undefined, state => workshop.applySettings(state));
function save(): void { const state = workshop.currentState(); if (state) publishOptions(state); const url = new URL(location.href); url.search = share(); if (query.get('standalone') === '1') url.searchParams.set('standalone', '1'); history.replaceState(null, '', url); syncBenchUrl(); }
async function snapshot(state: WorkshopState): Promise<Decor> {
  if (!decor) throw new Error('Chargez une ville depuis Settlements avant de la renvoyer.');
  const displayQuery = new URLSearchParams(decor.meta.query); if (state.style) displayQuery.set('style', state.style);
  return saveHistory({ ...decor, meta: { ...decor.meta, query: displayQuery.toString(), pipeline: { ...decor.meta.pipeline, stage: 'urban', urban: state, urbanDraft: workshop.draftSettings() } } });
}
const workshop = createUrbanWorkshop({ urban, workshopOnly: true,
  getStyle: () => new URLSearchParams(decor?.meta.query ?? location.search).get('style') ?? 'parchment',
  getContext: () => decor && { waterAppearance: { geometry: decor.meta.waterSvg, material: retainedWaterMaterial(decor) }, raster: decor.raster, sites: decor.meta.settlements, roads: decor.meta.roads ?? undefined, seed: decor.meta.seed },
  onChange: save,
  onReturn: async state => {
    let saved: Decor;
    const parent = decor?.meta.pipeline?.parent, crop = decor?.meta.pipeline?.crop, key = decor?.meta.pipeline?.city;
    if (parent && crop && key) {
      const source = await readHistory(parent);
      const move = <T>(value: T): T => {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(move) as T;
        const obj = value as Record<string, unknown>;
        if (typeof obj.x === 'number' && typeof obj.y === 'number') return { ...obj, x: obj.x + crop.x, y: obj.y + crop.y } as T;
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, k === 'axis' ? v : move(v)])) as T;
      };
      const previous = source.meta.pipeline?.urban;
      saved = await saveHistory({ ...source, meta: { ...source.meta, pipeline: { ...source.meta.pipeline, stage: 'settlements', city: key, syncSource: decor?.meta.pipeline?.syncSource ?? source.meta.pipeline?.syncSource ?? source.meta.id, urbanDraft: workshop.draftSettings(), urban: { ...state,
        layouts: [...(previous?.layouts ?? []).filter(l => l.key !== key), ...move(state.layouts ?? [])],
        partitions: state.partitions ? [...(previous?.partitions ?? []).filter(p => p.key !== key), ...move(state.partitions)] : undefined } } } });
    } else saved = await snapshot(state);
    const params = new URLSearchParams(saved.meta.query);
    if (state.style) params.set('style', state.style);
    params.set('artifact', saved.meta.id); params.set('stage', 'settlements'); params.delete('space'); params.delete('workshop');
    // Applied settings travel with the exact raster and plan in either direction.
    const { layouts: _layouts, partitions: _partitions, ...settings } = state;
    params.set('urban', JSON.stringify({ ...settings, enabled: true, parcelEnabled: !!state.partitions, target: saved.meta.pipeline?.city }));
    openBench('settlements', params);
  },
  onExport: async (state, download = true) => { decor = await snapshot(state); save(); if (download) downloadBytes(encodeDecor(decor), `${decor.meta.id}.decor`); },
});
const artifact = query.get('artifact') ?? query.get('decor');
if (artifact) void readHistory(artifact).then(d => {
  decor = d;
  const state = d.meta.pipeline?.urban;
  if (!state?.layouts?.length) throw new Error('Cet export ne contient pas de ville. Ouvrez-le dans Settlements pour calculer ses quartiers.');
  urban.restoreSnapshot(state); if (!query.has('workshop')) workshop.openMap(); if (d.meta.pipeline?.urbanDraft) workshop.applySettings(d.meta.pipeline.urbanDraft);
}).catch(error => { document.querySelector<HTMLElement>('[data-workshop-status]')!.textContent = String(error); }).finally(() => { ready = true; });
else ready = true;
installRecipeSharing({ host: document.querySelector('header')!, capture: () => portableRecipe('urban', share(), decor) });
window.magnaBenchContext = { ready: () => ready, capture: () => ({ query: share() }), restore: () => {} };
