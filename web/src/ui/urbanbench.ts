import { retainedWaterMaterial } from './decorWater';
import { urbanOptionSync } from './urbanOptionSync';
import { createTerrainUrban } from './terrainUrban';
import { createUrbanWorkshop } from './urbanWorkshop';
import { readHistory, saveHistory, downloadHistory, openBench, syncBenchUrl } from './benchHistory';
import { rasterStats, type Decor } from './decor';
import { defaultSettlementSpec, type Settlement } from '../../../rust/bridge/settlements';
import type { WorkshopState } from './testbenchUrban';
import { installRecipeSharing, portableRecipe } from './recipeSharing';
import type {} from './benchContext';
import { applyExecutionProfile, installExecutionProfile } from './executionProfile';
import { applyWorkshopPopulation, appliedWorkshopSnapshot, mergeCityWorkshop, translateWorkshopState, workshopSettings } from './urbanSnapshot';

installExecutionProfile(document.querySelector('header')!);

const query = new URLSearchParams(location.search);
let decor: Decor | undefined, ready = false;
const urban = createTerrainUrban({ map: document.getElementById('map') as unknown as SVGSVGElement, before: document.getElementById('status'),
  getTerrain: () => undefined, getRaster: () => decor?.raster, getSeed: () => decor?.meta.seed ?? '', getAuto: () => false, onChange: () => {} });
function share(): string {
  const params = new URLSearchParams(); if (decor) params.set('artifact', decor.meta.id);
  workshop.share(params); return applyExecutionProfile(new URL(`?${params}`, location.href)).searchParams.toString();
}
const publishOptions = urbanOptionSync(() => workshop.currentSource() === 'map' && decor?.meta.pipeline?.parent && decor.meta.pipeline.city ? `${decor.meta.pipeline.syncSource ?? decor.meta.pipeline.parent}:${decor.meta.pipeline.city}` : undefined, state => workshop.applySettings(state));
function save(): void { const state = workshop.draftSettings() ?? workshop.currentState(); if (state) publishOptions(state); const url = new URL(location.href); url.search = share(); if (query.get('standalone') === '1') url.searchParams.set('standalone', '1'); history.replaceState(null, '', url); syncBenchUrl(); }
async function snapshot(state: WorkshopState): Promise<Decor> {
  state = appliedWorkshopSnapshot(state);
  const context = workshop.currentContext();
  if (!context) throw new Error('Générez un plan avant de conserver son décor.');
  let base = decor;
  if (workshop.currentSource() === 'fixture') {
    const waterSvg = (context.raster.geometry?.water ?? []).map(rings => `<path d="${rings.map(ring => ring.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('') + 'Z').join(' ')}" fill="#9ebabb" fill-rule="evenodd"/>`).join('');
    const settlements: Settlement[] = context.sites.map(site => ({ ...defaultSettlementSpec(site.key, site.population), ...site, name: 'Scène de l’atelier', cls: site.population >= 2000 ? 'town' : 'village', archetype: 'settlement',
      scores: { total: 0, flatness: 0, buildable: 0, freshWater: 0, river: 0, harbor: 0, flood: 0, culture: 0, site: 0, defense: 0, elevation: 0, cluster: 0, variation: 0, buildableFraction: 0, waterDistance: 0, slope: 0, heightAboveWater: 0, spacingRelaxation: 0, manual: true, rankingScore: null, candidateRank: null, rankingPopulation: null } }));
    base = { raster: context.raster, meta: { format: 'magna-decor', version: 1, id: 'urban-fixture', label: 'Scène urbaine isolée', tags: { source: 'urban-fixture' }, seed: context.seed, width: context.raster.width, query: '', created: new Date().toISOString(), settlements, roads: null, roadConfig: null, waterSvg, stats: { ...rasterStats(context.raster), riverKm: 0, roadKm: 0 } } };
  }
  if (!base) throw new Error('Le décor appliqué est absent.');
  const displayQuery = new URLSearchParams(base.meta.query); if (state.style) displayQuery.set('style', state.style);
  return saveHistory({ ...base, raster: context.raster, meta: { ...base.meta, settlements: applyWorkshopPopulation(base.meta.settlements, state), query: displayQuery.toString(), pipeline: { ...base.meta.pipeline, stage: 'urban', urban: state, urbanDraft: workshop.draftSettings() && workshopSettings(workshop.draftSettings()!) } } });
}
const workshop = createUrbanWorkshop({ urban, workshopOnly: true,
  getStyle: () => new URLSearchParams(decor?.meta.query ?? location.search).get('style') ?? 'parchment',
  getContext: () => decor && { waterAppearance: { geometry: decor.meta.waterSvg, material: retainedWaterMaterial(decor) }, raster: decor.raster, sites: decor.meta.settlements, roads: decor.meta.roads ?? undefined, seed: decor.meta.seed },
  onChange: save,
  onReturn: async state => {
    state = appliedWorkshopSnapshot(state);
    if (workshop.currentSource() === 'fixture' || decor?.meta.tags.source === 'urban-fixture') throw new Error('Cette scène est isolée. Chargez une ville depuis Settlements pour y renvoyer son plan.');
    let saved: Decor;
    const parent = decor?.meta.pipeline?.parent, crop = decor?.meta.pipeline?.crop, key = decor?.meta.pipeline?.city;
    if (parent && crop && key) {
      const source = await readHistory(parent).catch(() => undefined);
      if (source) {
        const previous = source.meta.pipeline?.urban;
        saved = await saveHistory({ ...source, meta: { ...source.meta, settlements: applyWorkshopPopulation(source.meta.settlements, state), pipeline: { ...source.meta.pipeline, stage: 'settlements', city: key, syncSource: decor?.meta.pipeline?.syncSource ?? source.meta.pipeline?.syncSource ?? source.meta.id, urbanDraft: workshop.draftSettings() && workshopSettings(translateWorkshopState(workshop.draftSettings()!, crop.x, crop.y)), urban: mergeCityWorkshop(previous, state, key, crop.x, crop.y) } } });
      } else {
        const local = await snapshot(state);
        saved = await saveHistory({ ...local, meta: { ...local.meta, label: `${local.meta.label} · extrait conservé`, pipeline: { ...local.meta.pipeline, stage: 'settlements', parent: undefined, crop: undefined } } });
      }
    } else saved = await snapshot(state);
    const params = new URLSearchParams(saved.meta.query);
    if (state.style) params.set('style', state.style);
    params.set('artifact', saved.meta.id); params.set('stage', 'settlements'); params.delete('space'); params.delete('workshop');
    // Applied settings travel with the exact raster and plan in either direction.
    const settings = workshopSettings(saved.meta.pipeline?.urban ?? state);
    params.set('urban', JSON.stringify({ ...settings, enabled: true, parcelEnabled: !!state.partitions, target: saved.meta.pipeline?.city }));
    openBench('settlements', params);
  },
  onExport: async (state, download = true) => { decor = await snapshot(state); save(); if (download) await downloadHistory(decor.meta.id); },
});
const artifact = query.get('artifact') ?? query.get('decor');
if (artifact) void readHistory(artifact).then(d => {
  decor = d;
  const state = d.meta.pipeline?.urban;
  if (!state?.layouts?.length) throw new Error('Cet export ne contient pas de ville. Ouvrez-le dans Settlements pour calculer ses quartiers.');
  urban.restoreSnapshot(state); if (!query.has('workshop')) workshop.openMap(); if (d.meta.pipeline?.urbanDraft) workshop.applySettings(d.meta.pipeline.urbanDraft);
}).catch(error => { document.querySelector<HTMLElement>('[data-workshop-status]')!.textContent = String(error); }).finally(() => { ready = true; });
else ready = true;
installRecipeSharing({ host: document.querySelector('header')!, capture: async () => {
  const state = workshop.currentState();
  if (!state) throw new Error('Attendez le chargement du plan appliqué avant de le partager.');
  const applied = await snapshot(state);
  return portableRecipe('urban', share(), applied);
} });
window.magnaBenchContext = { ready: () => ready, capture: () => ({ query: share() }), restore: () => {} };
