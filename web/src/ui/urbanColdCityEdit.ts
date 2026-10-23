/** Transactional singleton edit against a bounded real native subset. Display
 * DTOs never enter admission. Unchanged cold chunks are copied byte-for-byte. */
import type { HouseMaterial, Surface } from '../../../rust/bridge/housesContract';
import type { PlacementBatch, PlacementBatchRequest, PlacementBatchSettings, PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import { editArchitectureScene } from '../../../rust/bridge/architectureEdits';
import { isArchivedPlan } from '../../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, iterateUrbanBuildingChunkRecords, BUILDING_CHUNK_MAX_BYTES,
  type BuildingChunkBackend, type BuildingChunkManifest, type BuildingChunkRead, type ChunkBounds } from './urbanBuildingChunkStore';
import type { ColdCitySession, ColdCityState } from './urbanColdCitySession';
import { projectNativeBuildingRecords, type NativeBuildingProjectionScene } from './urbanBuildingProjection';

export interface ColdCityEditOptions {
  backend: BuildingChunkBackend; session: ColdCitySession;
  original: PlacementRequest; edited: PlacementRequest; settings?: PlacementBatchSettings;
  sourceFingerprint: string; cancelled?(): boolean; signal?: AbortSignal;
  generate?(input: PlacementBatchRequest): Promise<PlacementBatch>;
  limits?: Partial<Parameters<ColdCitySession['readVisible']>[1]>;
  maxChunkBytes?: number;
}
export type ColdCityEditResult = { applied: true; state: ColdCityState; replacement: NativeBuildingProjectionScene } | { applied: false; message: string };
const DEFAULT_LIMITS = { maxTiles: 256, maxCandidates: 2048, maxBuildings: 512, maxChunks: 16, maxBytes: 16 * 1024 * 1024 };
const materialKey = (m: HouseMaterial) => JSON.stringify([m.label, m.roles, m.pattern, m.origin, m.source_ref]);
const stateKey = (s: ColdCityState) => JSON.stringify([s.store.format, s.store.sceneId, s.store.fingerprint, s.store.sourceFingerprint,
  s.counts.schema_version, s.counts.generator_version, s.counts.buildings, s.counts.refusals, s.counts.open_spaces,
  s.cityKey ?? null, s.offset?.x ?? 0, s.offset?.y ?? 0]);

/** Same request AABB as architectureEdits.occupationIndex: outer cadastral,
 * buildable and roof rings, plus both endpoints expanded by access half-width.
 * Accesses can reach neighbours outside the cadastral rectangle. */
export function coldArchitectureEditBounds(request: PlacementRequest): ChunkBounds {
  const box: ChunkBounds = [Infinity, Infinity, -Infinity, -Infinity];
  const extend = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Les limites de l’édition contiennent des coordonnées non finies.');
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  };
  const surface = (value: Surface) => { for (const shape of value) for (const p of shape.outer) extend(p.x, p.y); };
  [request.cadastral, request.buildable, request.roof_domain ?? []].forEach(surface);
  for (const access of request.accesses) for (const p of access.segment) {
    const half = Math.max(0, access.width_m / 2); extend(p.x - half, p.y - half); extend(p.x + half, p.y + half);
  }
  if (!box.every(Number.isFinite)) throw new Error('L’édition ne fournit aucun domaine spatial vérifiable.'); return box;
}
function assertManifest(manifest: BuildingChunkManifest | undefined, state: ColdCityState): asserts manifest is BuildingChunkManifest {
  if (!manifest || manifest.sceneId !== state.store.sceneId || manifest.fingerprint !== state.store.fingerprint
    || manifest.sourceFingerprint !== state.store.sourceFingerprint || manifest.format !== state.store.format
    || manifest.schema_version !== state.counts.schema_version || manifest.generator_version !== state.counts.generator_version
    || manifest.buildings !== state.counts.buildings || manifest.refusals !== state.counts.refusals || manifest.openSpaces !== state.counts.open_spaces)
    throw new Error('La génération bâtie stockée ne correspond plus à la ville sélectionnée.');
}
function mergeContext(into: PlacementBatch, value: BuildingChunkRead): void {
  if (value.scene.buildings.length !== 1 || value.scene.buildings[0] !== value.building)
    throw new Error('Un contexte natif de sélection contient un autre bâtiment.');
  for (const [id, source] of Object.entries(value.scene.plan_archives ?? {})) {
    const previous = into.plan_archives?.[id];
    if (previous !== undefined && previous !== source) throw new Error('Deux archives natives portent une identité contradictoire.');
    (into.plan_archives ??= {})[id] = source;
  }
  for (const material of value.scene.materials ?? []) {
    const previous = into.materials?.find(m => m.id === material.id);
    if (previous && materialKey(previous) !== materialKey(material)) throw new Error('Les contextes voisins divergent sur une matière native.');
    if (!previous) (into.materials ??= []).push(material);
  }
}
async function nativePlans(input: PlacementBatchRequest): Promise<PlacementBatch> {
  const [{ planUrbanBuildings }, { executionRuntime }] = await Promise.all([import('../../../rust/bridge/architecture'), import('./executionProfile')]);
  return planUrbanBuildings(input, executionRuntime);
}

export async function editColdCityBuilding(options: ColdCityEditOptions): Promise<ColdCityEditResult> {
  const { backend, session, original, edited } = options;
  let stage: Awaited<ReturnType<typeof beginUrbanBuildingStage>> | undefined;
  try {
    const source = session.state, identity = stateKey(source), cityKey = source.cityKey;
    const check = () => {
      if (options.cancelled?.() || options.signal?.aborted || session.stats.disposed || stateKey(session.state) !== identity)
        throw new DOMException('L’édition de bâtiment a été remplacée.', 'AbortError');
    };
    check();
    if ((source.offset?.x ?? 0) !== 0 || (source.offset?.y ?? 0) !== 0)
      throw new Error('L’édition des villes translatées n’est pas encore prise en charge : les coordonnées du site original ne sont pas garanties.');
    if (!/^[a-f0-9]{64}$/.test(options.sourceFingerprint)) throw new Error('L’empreinte de la nouvelle source bâtie est invalide.');
    if (!original.id || original.id !== edited.id || original.parcel_id !== edited.parcel_id)
      throw new Error('L’édition doit conserver l’identité du bâtiment et de sa parcelle.');
    if (original.function === 'open_space' || edited.function === 'open_space')
      throw new Error('Cette édition froide doit remplacer un bâtiment par un bâtiment ; la conversion en espace libre n’est pas prise en charge.');
    const limits = { ...DEFAULT_LIMITS };
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      const value = options.limits?.[key] ?? limits[key];
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Le budget du voisinage de l’édition est invalide.'); limits[key] = value;
    }
    const maxChunkBytes = options.maxChunkBytes ?? BUILDING_CHUNK_MAX_BYTES;
    if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes <= 0 || maxChunkBytes > BUILDING_CHUNK_MAX_BYTES)
      throw new Error('Le budget de copie des chunks est invalide.');
    // Capture CAS before selected reads, neighbourhood IO and native generation.
    const active = await backend.active(); check(); const expectedActive = active?.sceneId ?? null;
    const targetManifest = await backend.manifest(source.store.sceneId); check(); assertManifest(targetManifest, source);
    const selected = await session.read(original.id); check();
    if (!selected || selected.building.id !== original.id || selected.building.parcel_id !== original.parcel_id)
      throw new Error('Le bâtiment demandé est absent ou son site d’origine est périmé.');
    const nearby = await session.readVisible(coldArchitectureEditBounds(edited), limits); check();
    if (nearby.truncated) throw new Error('Le voisinage natif dépasse le budget de lecture ; l’édition est refusée sans modifier la ville.');
    // Explicit bounded subset, composed solely of actual native records. Empty
    // refusals/open_spaces describe this subset, not a fabricated display scene.
    const scoped: PlacementBatch = { schema_version: targetManifest.schema_version, generator_version: targetManifest.generator_version,
      buildings: [], refusals: [], open_spaces: [] };
    const ids = new Set<string>(); let containsSelected = false;
    for (const value of nearby.buildings) {
      if (ids.has(value.building.id)) throw new Error('Le voisinage natif contient une identité dupliquée.'); ids.add(value.building.id);
      const record = value.building.id === original.id ? selected : value;
      containsSelected ||= record.building.id === original.id; scoped.buildings.push(record.building); mergeContext(scoped, record);
    }
    if (!containsSelected) { scoped.buildings.unshift(selected.building); mergeContext(scoped, selected); }
    const result = await editArchitectureScene(scoped, [edited], async input => {
      check(); const generated = await (options.generate ?? nativePlans)(input); check();
      // The scoped helper can permit generator changes when no local outsider
      // exists. A cold city may still have distant rows: enforce the full manifest.
      if (generated.generator_version !== targetManifest.generator_version || generated.schema_version !== targetManifest.schema_version)
        throw new Error('Changer de générateur exige de remplacer la ville entière, pas un seul bâtiment.');
      return generated;
    }, options.settings);
    check();
    if (!result.applied) return { applied: false, message: result.refusals.map(r => r.message).join(' · ') || 'L’édition native n’a pas été admise.' };
    const replacement = result.scene.buildings.find(b => b.id === original.id);
    if (!replacement || result.changedIds.length !== 1 || replacement.parcel_id !== original.parcel_id || replacement.simplification !== 'architectural_plan'
      || !isArchivedPlan(replacement.resolved)) throw new Error('La réponse native doit fournir un seul plan archivé pour le bâtiment sélectionné.');
    const newArchiveId = replacement.resolved.archive_id, newArchive = result.scene.plan_archives?.[newArchiveId];
    if (typeof newArchive !== 'string') throw new Error('Le plan remplacé ne possède pas son archive native.');
    // Preserve the complete native table: the retained compact plan can refer
    // to materials absent from its simplified display volumes/features.
    const definitions = new Map((result.scene.materials ?? []).map(m => [m.id, m]));
    // Prepare only this selected DTO before committing: projection validation
    // must not turn a durable success into a reported failure afterward.
    const projection = projectNativeBuildingRecords([replacement], result.scene.materials);
    // Recheck cancellation after the stage's async fingerprint, immediately
    // before the actual commit transaction. The optional signal also aborts it.
    const guardedBackend: BuildingChunkBackend = { begin: id => backend.begin(id), append: (id, chunk, entries) => backend.append(id, chunk, entries),
      active: () => backend.active(), manifest: id => backend.manifest(id), chunk: (id, index) => backend.chunk(id, index),
      building: (id, building) => backend.building(id, building), tile: (id, tile, limit) => backend.tile(id, tile, limit), discard: id => backend.discard(id),
      commit: (manifest, expected, commitOptions) => { check(); return backend.commit(manifest, expected, commitOptions); } };
    stage = await beginUrbanBuildingStage(guardedBackend, { sourceFingerprint: options.sourceFingerprint, totalRequests: targetManifest.totalRequests, expectedActive }); check();
    let replaced = 0;
    for await (const record of iterateUrbanBuildingChunkRecords(backend, targetManifest.sceneId, { maxChunkBytes, cancelled: () => {
      check(); return false;
    } })) {
      check(); const delta = record.delta;
      for (const material of delta.materials ?? []) {
        const next = definitions.get(material.id);
        if (next && materialKey(next) !== materialKey(material)) throw new Error('L’édition redéfinit une matière partagée par la ville ; elle nécessite une régénération globale.');
      }
      const archive = delta.plan_archives?.[newArchiveId];
      if (archive !== undefined && archive !== newArchive) throw new Error('La nouvelle archive contredit une archive conservée.');
      const at = delta.buildings.findIndex(b => b.id === original.id);
      if (at < 0) await stage.appendStored(record.stored);
      else {
        if (++replaced !== 1 || record.descriptor.index !== selected.chunkIndex || delta.buildings[at].parcel_id !== original.parcel_id)
          throw new Error('La position du bâtiment dans le stockage froid a changé.');
        const buildings = delta.buildings.map((building, index) => index === at ? replacement : building), archives: Record<string, string> = {};
        for (const building of buildings) {
          if (!isArchivedPlan(building.resolved)) throw new Error('Un plan conservé n’est pas archivé.');
          const id = building.resolved.archive_id, payload = id === newArchiveId ? newArchive : delta.plan_archives?.[id];
          if (typeof payload !== 'string') throw new Error('Une archive conservée est absente.'); archives[id] = payload;
        }
        const materials = new Map((delta.materials ?? []).map(m => [m.id, m]));
        for (const [id, material] of definitions) if (!materials.has(id)) materials.set(id, material);
        await stage.append({ ...delta, buildings, plan_archives: archives, ...(materials.size ? { materials: [...materials.values()] } : {}) }, record.descriptor.progress);
      }
    }
    if (replaced !== 1) throw new Error('Le bâtiment sélectionné a disparu du stockage froid.');
    check();
    const manifest = await stage.commit({ completion: source.counts, signal: options.signal });
    // Durable commit is the linearization point; a later UI cancellation cannot undo it.
    return { applied: true, state: { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint,
      sourceFingerprint: manifest.sourceFingerprint }, counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version,
      buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces }, ...(cityKey !== undefined ? { cityKey } : {}) }, replacement: projection };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (stage && !stage.progress.committed) {
      try { await stage.abort(); }
      catch (cleanup) { return { applied: false, message: `${message} · Nettoyage du staging ${stage.sceneId} impossible : ${String(cleanup)}` }; }
    }
    return { applied: false, message };
  }
}
