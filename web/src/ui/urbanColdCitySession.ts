import type { NativeBuildingProjectionScene, NativeBuildingProjectionRefusal } from './urbanBuildingProjection';
import { projectNativeBuildingChunk } from './urbanBuildingProjection';
import { iterateUrbanBuildingChunks, openUrbanBuildingChunks, type BuildingChunkBackend } from './urbanBuildingChunkStore';
import type { UrbanColdSceneResponse } from './urbanScene';
import type { UrbanColdBuildingState } from './urbanBuildingsPanel';
import { translateBuilding } from './urbanSnapshot';
import type { BuildingChunkRead } from './urbanBuildingChunkStore';
import { beginDerivedWrite, openDerivedCache } from './urbanBuildingDerivedCache';
import { translateSiteVisuals, type UrbanSiteVisual } from './urbanSiteStore';

export type ColdCityState = UrbanColdBuildingState;

export function translateColdProjection(scene: NativeBuildingProjectionScene, dx: number, dy: number): NativeBuildingProjectionScene {
  if (!dx && !dy) return scene;
  const surfaces = new WeakMap<object, NativeBuildingProjectionScene['buildings'][number]['footprint']>();
  const point = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  const surface = (input: NativeBuildingProjectionScene['buildings'][number]['footprint']) => {
    const found = surfaces.get(input); if (found) return found;
    const result = input.map(p => ({ outer: p.outer.map(point), holes: p.holes.map(ring => ring.map(point)) }));
    surfaces.set(input, result); return result;
  };
  return { ...scene, buildings: scene.buildings.map(building => ({ ...building,
    footprint: surface(building.footprint), roof_footprint: surface(building.roof_footprint),
    ...(building.entrance ? { entrance: point(building.entrance) } : {}),
    ...(building.cartographic ? { cartographic: { ...building.cartographic, ridges: building.cartographic.ridges.map(([a, b]) => [point(a), point(b)] as const) } } : {}),
    occupation_surfaces: building.occupation_surfaces.map(surface),
    ground_constraints: building.ground_constraints.map(c => ({ footprint: surface(c.footprint), height_m: c.height_m })),
  })) };
}

/** The complete lightweight cartography is retained for an accurate overview.
 * Native plans, levels, features and archives never enter this accumulator.
 * This is not a claim that the visual index itself is memory bounded. */
export function createColdProjectionAccumulator() {
  const buildings: NativeBuildingProjectionScene['buildings'][number][] = [];
  const refusals: NativeBuildingProjectionRefusal[] = [];
  const materials = new Map<string, NonNullable<NativeBuildingProjectionScene['materials']>[number]>();
  const metrics: NativeBuildingProjectionScene['metrics'] = { scope: 'provided-records', buildings: 0, refusals: 0,
    openSpaces: 0, errors: 0, usefulAreaM2: 0, domesticUnits: 0 };
  return {
    append(scene: NativeBuildingProjectionScene): void {
      for (const material of scene.materials ?? []) {
        const previous = materials.get(material.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(material)) throw new Error('Cold cartography material changed.');
        materials.set(material.id, material);
      }
      buildings.push(...scene.buildings);
      refusals.push(...scene.refusals ?? []);
      for (const key of ['buildings', 'refusals', 'openSpaces', 'errors', 'usefulAreaM2', 'domesticUnits'] as const) metrics[key] += scene.metrics[key];
    },
    get scene(): NativeBuildingProjectionScene {
      return { projection: 'native-building-visual-scene-1', buildings, refusals, materials: [...materials.values()], metrics: { ...metrics } };
    },
  };
}

/** One admitted edit replaces one visual; untouched DTOs/contours retain identity. */
export function replaceColdProjection(previous: NativeBuildingProjectionScene, replacement: NativeBuildingProjectionScene): NativeBuildingProjectionScene {
  if (replacement.buildings.length !== 1) throw new Error('A cold house edit must replace exactly one accepted visual.');
  const next = replacement.buildings[0], old = previous.buildings.find(building => building.id === next.id);
  if (!old || previous.buildings.filter(building => building.id === next.id).length !== 1) throw new Error('Edited native visual identity is absent or duplicated.');
  const materials = new Map((previous.materials ?? []).map(material => [material.id, material]));
  for (const material of replacement.materials ?? []) {
    const prior = materials.get(material.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(material)) throw new Error('Edited native material changed meaning.');
    materials.set(material.id, material);
  }
  return { ...previous, buildings: previous.buildings.map(building => building.id === next.id ? next : building), materials: [...materials.values()],
    metrics: { ...previous.metrics, usefulAreaM2: previous.metrics.usefulAreaM2 - old.useful_area_m2 + next.useful_area_m2,
      domesticUnits: previous.metrics.domesticUnits - old.domestic_units + next.domestic_units } };
}

/** One committed city's real native records, with serial IO and a latest-only
 * pending selection. The renderer owns only the separate visual projection. */
export async function openColdCitySession(backend: BuildingChunkBackend, state: ColdCityState,
  options: { projection?: NativeBuildingProjectionScene; sites?: UrbanSiteVisual[]; cancelled?(): boolean } = {}) {
  const reader = await openUrbanBuildingChunks(backend, state.store.sceneId);
  const manifest = reader.manifest, counts = state.counts;
  if (manifest.fingerprint !== state.store.fingerprint || manifest.sourceFingerprint !== state.store.sourceFingerprint
    || manifest.format !== state.store.format || manifest.schema_version !== counts.schema_version
    || manifest.generator_version !== counts.generator_version || manifest.buildings !== counts.buildings
    || manifest.refusals !== counts.refusals || manifest.openSpaces !== counts.open_spaces) throw new Error('Cold city identity or counts changed.');
  let projection = options.projection;
  let siteVisuals = options.sites, derived: Awaited<ReturnType<typeof openDerivedCache>> | undefined;
  let derivedStatus = options.projection ? 'provided' : 'miss', derivedReason = '';
  const check = () => { if (options.cancelled?.()) throw new DOMException('Ville remplacée', 'AbortError'); };
  try {
    check(); derived = await openDerivedCache(backend, manifest); check();
    if (!projection) {
      const accumulator = createColdProjectionAccumulator(), restoredSites: UrbanSiteVisual[] = [];
      for await (const chunk of derived.chunks()) {
        check(); accumulator.append(chunk.projection);
        if (derived.manifest.origins === 'complete') restoredSites.push(...chunk.sites!);
      }
      projection = accumulator.scene; siteVisuals = derived.manifest.origins === 'complete' ? restoredSites : undefined;
      derivedStatus = 'hit';
    }
  } catch (error) { check(); derived = undefined; derivedReason = String(error); }
  if (!projection) {
    const accumulator = createColdProjectionAccumulator();
    let writer: Awaited<ReturnType<typeof beginDerivedWrite>>;
    try { writer = await beginDerivedWrite(backend, manifest.sceneId, manifest.sourceFingerprint, manifest.totalRequests); }
    catch (error) { derivedReason = String(error); }
    let index = 0;
    try {
      for await (const chunk of iterateUrbanBuildingChunks(backend, manifest.sceneId, { cancelled: options.cancelled })) {
        check(); const visual = projectNativeBuildingChunk(chunk), native = manifest.chunks[index++]; accumulator.append(visual);
        if (writer) {
          try { await writer.append(visual, native, options.sites?.slice(native.progress.start, native.progress.completed)); }
          catch (error) { derivedReason = String(error); try { await writer.abort(); } catch {} writer = undefined; }
        }
      }
      check(); if (writer) {
        try { await writer.commit(manifest); derived = await openDerivedCache(backend, manifest); }
        catch (error) { check(); derivedReason = String(error); try { await writer.abort(); } catch {} derived = undefined; }
      }
      derivedStatus = derived ? 'rebuilt' : 'rebuilt-uncached';
    } catch (error) { try { await writer?.abort(); } catch {} throw error; }
    projection = accumulator.scene;
  }
  if (options.cancelled?.()) throw new DOMException('Ville remplacée', 'AbortError');
  if (projection.metrics.buildings !== counts.buildings || projection.metrics.refusals !== counts.refusals
    || projection.metrics.openSpaces !== counts.open_spaces || projection.buildings.length !== counts.buildings)
    throw new Error('Cold city cartography does not match its committed counts.');
  const dx = state.offset?.x ?? 0, dy = state.offset?.y ?? 0;
  if (![dx, dy].every(Number.isFinite)) throw new Error('Invalid cold city translation.');
  projection = translateColdProjection(projection, dx, dy);
  if (siteVisuals) siteVisuals = translateSiteVisuals(siteVisuals, dx, dy);
  function translated(value: BuildingChunkRead): BuildingChunkRead {
    if (!dx && !dy) return value;
    const building = translateBuilding(value.building, dx, dy);
    return { ...value, building, scene: { ...value.scene, buildings: [building] } };
  }

  type Task = { channel: string; run(): Promise<void>; reject(error: Error): void };
  const pending: Task[] = [];
  let disposed = false, active = false;
  const replaced = () => new DOMException('Lecture de ville remplacée', 'AbortError');
  function pump(): void {
    if (active || disposed) return;
    const task = pending.shift(); if (!task) return;
    active = true;
    void task.run().finally(() => {
      active = false;
      if (disposed) reader.clearCache(); else pump();
    });
  }
  function enqueue<T>(channel: string, operation: () => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(replaced());
    if (channel !== 'detail' && channel !== 'edit') {
      const previous = pending.findIndex(task => task.channel === channel);
      if (previous >= 0) pending.splice(previous, 1)[0].reject(replaced());
    }
    if (pending.length >= 6) return Promise.reject(new Error('Trop de lectures de plans en attente.'));
    return new Promise<T>((resolve, reject) => {
      pending.push({ channel, reject, async run() {
        try { const value = await operation(); if (disposed) reject(replaced()); else resolve(value); }
        catch (error) { reject(error); }
      } });
      pump();
    });
  }
  return {
    state, projection, siteVisuals,
    /** No native query/runtime is persisted or reactivated by this cache. */
    originBinding: 'unbound' as const,
    readOrigin(id: string) { return enqueue('edit', async () => derived?.origin(id)); },
    read(id: string, channel: 'detail' | 'selection' | 'inspector' | 'open' = 'detail') { return enqueue(channel, async () => {
      const value = await reader.readBuilding(id); return value && translated(value);
    }); },
    readVisible(viewport: Parameters<typeof reader.readVisible>[0], limits: Parameters<typeof reader.readVisible>[1]) {
      return enqueue('edit', async () => {
        const result = await reader.readVisible([viewport[0] - dx, viewport[1] - dy, viewport[2] - dx, viewport[3] - dy], limits);
        return { ...result, buildings: result.buildings.map(translated) };
      });
    },
    dispose(): void {
      if (disposed) return; disposed = true;
      for (const task of pending.splice(0)) task.reject(replaced());
      if (!active) reader.clearCache();
    },
    get stats() { return { disposed, activeReads: active ? 1 : 0, queuedReads: pending.length, nativeCache: reader.stats,
      derivedStatus, derivedReason, origins: siteVisuals ? 'complete' : 'unknown' }; },
  };
}
export type ColdCitySession = Awaited<ReturnType<typeof openColdCitySession>>;
