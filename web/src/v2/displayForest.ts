import { cityForestInput } from '../render/cityEnvironment';
import { retainedDecorOf } from './decorTerrain';
import { forestRetainedRiverSegments } from '../../../rust/bridge/terrainForestRiparian';
import type { ResolvedAppearance } from '../render/appearanceRecipe';
import { nativeTerrainLayer } from './nativeProducts';
import { buildForestField, type ForestField, type ForestOccupation, type LandDetail } from '../../../rust/bridge/terrainForest';
import type { LandUseLayer, World } from '../gen/types';
import type { V2Settings } from './contracts';
import { effectiveTerrainSettings } from './terrainSettings';
import { buildingOccupationShapes, forestOccupation, packOccupationShapes, withOccupationShapes } from '../ui/forestOccupation';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { landDetail, withLandDetail } from '../ui/landDetail';
import OccupationWorker from './occupation.worker?worker';
import { forestCorridors } from '../render/forestRoom';

const cache = new WeakMap<World, Map<string, ForestField>>();
const occupations = new WeakMap<LandUseLayer, ForestOccupation | undefined>();
/** Product identity is the land-use revision; neither appearance nor visibility is an input. */
export function v2ForestOccupation(world: World): ForestOccupation | undefined {
  const landuse = world.landuse; if (!landuse) return;
  if (!occupations.has(landuse)) occupations.set(landuse, withLandDetail(forestOccupation(landuse, undefined, undefined, forestCorridors(world, false)), landuse));
  return occupations.get(landuse);
}
type OccupationParts = { occupation: Promise<ForestOccupation | undefined>; detail: Promise<LandDetail | undefined> };
const computing = new WeakMap<LandUseLayer, OccupationParts>();
/** The two rasters of v2ForestOccupation, each in its own worker when called from the page (the occupation alone feeds the
 * building merge, so it never waits for the holdings detail). Same bytes as the sync version. */
export function v2ForestOccupationParts(world: World): OccupationParts {
  const landuse = world.landuse;
  if (!landuse || occupations.has(landuse) || typeof document === 'undefined') {
    const whole = v2ForestOccupation(world);
    return { occupation: Promise.resolve(whole && { ...whole, detail: undefined }), detail: Promise.resolve(whole?.detail) };
  }
  let parts = computing.get(landuse);
  if (!parts) {
    const run = <T>(name: 'occupation' | 'detail'): Promise<T | undefined> => new Promise<T | undefined>((resolve, reject) => {
      let worker: Worker;
      try { worker = new OccupationWorker(); } catch (error) { reject(error); return; }
      worker.onmessage = ({ data }) => { worker.terminate(); if (data.error) reject(new Error(data.error)); else resolve(data.result); };
      worker.onerror = event => { worker.terminate(); reject(event); };
      worker.postMessage({ landuse, part: name, ...(name === 'occupation' ? { corridors: forestCorridors(world, false) } : {}) });
    });
    const occupation = run<ForestOccupation>('occupation').catch(() => forestOccupation(landuse, undefined, undefined, forestCorridors(world, false)));
    const detail = run<LandDetail>('detail').catch(() => landDetail(landuse));
    parts = { occupation, detail };
    void Promise.all([occupation, detail]).then(([o, d]) => { occupations.set(landuse, o && { ...o, detail: d }); });
    computing.set(landuse, parts);
  }
  return parts;
}
/** Same product as v2ForestOccupation, rastered in two workers when called from the page. */
export async function v2ForestOccupationAsync(world: World): Promise<ForestOccupation | undefined> {
  const parts = v2ForestOccupationParts(world), [occupation, detail] = await Promise.all([parts.occupation, parts.detail]);
  return occupation && { ...occupation, detail };
}
/** withBuildingOccupation, rastered in the occupation worker when called from the page: only the packed
 * footprints and the base planes cross; the holdings detail stays here. Same bytes and key. */
export function withBuildingOccupationAsync(base: ForestOccupation | undefined, scene: Building3dScene): Promise<ForestOccupation | undefined> {
  const shapes = buildingOccupationShapes(scene);
  if (!shapes) return Promise.resolve(base);
  if (typeof document === 'undefined') return Promise.resolve(withOccupationShapes(base, shapes));
  return new Promise(resolve => {
    const local = (): void => resolve(withOccupationShapes(base, shapes));
    let worker: Worker;
    try { worker = new OccupationWorker(); } catch { local(); return; }
    worker.onmessage = ({ data }) => { worker.terminate(); if (data.error) local(); else resolve({ ...data.result, detail: base?.detail }); };
    worker.onerror = () => { worker.terminate(); local(); };
    const packed = packOccupationShapes(shapes);
    worker.postMessage({ source: base && { x: base.x, y: base.y, width: base.width, n: base.n, rgba: base.rgba, key: base.key }, shapes: packed }, [packed.buffer]);
  });
}
const pending = new WeakMap<World, Map<string, Promise<ForestField | undefined>>>();
function displayForestRequest(world: World, settings: V2Settings, resolved: ResolvedAppearance): { key: string; build: () => Promise<ForestField> } | ForestField | undefined {
  if (!resolved.composition.vegetation.procedural) return;
  const configuration = effectiveTerrainSettings(settings, world.mapSize), overrides = resolved.vegetation.forest;
  const { enabled: _enabled, ...parameters } = overrides, forest = { ...configuration.forest, ...parameters, enabled: true };
  const decor = retainedDecorOf(world.terrain);
  if (!decor && !Object.keys(parameters).length) return nativeTerrainLayer(world)?.v2ForestField;
  const climate = configuration.climateValues!, clearingProfile = resolved.traits.forestClearingProfile;
  const key = JSON.stringify([forest, climate, world.seed, clearingProfile]);
  const raster = decor?.raster;
  return { key, build: () => buildForestField(cityForestInput(world.seed, climate,
    raster ? { x: 0, y: 0, width: raster.width, n: raster.n, data: raster.height }
      : { x: 0, y: 0, width: world.mapSize, n: world.terrain.height.w, data: world.terrain.height.data },
    raster?.water ?? world.terrain.water, { clearingProfile,
      ...(decor ? { riverSegments: forestRetainedRiverSegments(decor.meta.waterSvg, decor.raster.width) } : {}) }), forest) };
}
const isField = (v: unknown): v is ForestField => !!v && typeof (v as ForestField).rgba !== 'undefined';
/** Repaint the forest over retained heights (Rust: native or WASM, hence async). Never call terrain or settlement generation. */
export async function v2DisplayForestAsync(world: World, settings: V2Settings, resolved: ResolvedAppearance): Promise<ForestField | undefined> {
  const request = displayForestRequest(world, settings, resolved);
  if (!request || isField(request)) return request;
  let fields = cache.get(world); if (!fields) { fields = new Map(); cache.set(world, fields); }
  const found = fields.get(request.key); if (found) return found;
  let jobs = pending.get(world); if (!jobs) { jobs = new Map(); pending.set(world, jobs); }
  let job = jobs.get(request.key);
  if (!job) {
    job = request.build().then(field => {
      fields!.set(request.key, field); if (fields!.size > 3) fields!.delete(fields!.keys().next().value!);
      return field;
    }).finally(() => jobs!.delete(request.key));
    jobs.set(request.key, job);
  }
  return job;
}
/** Cached field for render callbacks that cannot wait: on a miss it starts the build and calls `onReady` once it is cached. */
export function v2DisplayForest(world: World, settings: V2Settings, resolved: ResolvedAppearance, onReady?: () => void): ForestField | undefined {
  const request = displayForestRequest(world, settings, resolved);
  if (!request || isField(request)) return request;
  const found = cache.get(world)?.get(request.key); if (found) return found;
  if (!pending.get(world)?.has(request.key)) void v2DisplayForestAsync(world, settings, resolved).then(() => onReady?.(), error => console.warn('Forest field failed:', error));
  return undefined;
}
