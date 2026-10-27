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
import { urbanText } from './urbanPanelLocale';

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
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(urbanText(['Les limites de l’édition contiennent des coordonnées non finies.','The edit bounds contain non-finite coordinates.','编辑范围包含非有限坐标。','Los límites de la edición contienen coordenadas no finitas.','Os limites da edição contêm coordenadas não finitas.']));
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  };
  const surface = (value: Surface) => { for (const shape of value) for (const p of shape.outer) extend(p.x, p.y); };
  [request.cadastral, request.buildable, request.roof_domain ?? []].forEach(surface);
  for (const access of request.accesses) for (const p of access.segment) {
    const half = Math.max(0, access.width_m / 2); extend(p.x - half, p.y - half); extend(p.x + half, p.y + half);
  }
  if (!box.every(Number.isFinite)) throw new Error(urbanText(['L’édition ne fournit aucun domaine spatial vérifiable.','The edit provides no verifiable spatial bounds.','编辑未提供可验证的空间范围。','La edición no proporciona límites espaciales verificables.','A edição não fornece limites espaciais verificáveis.'])); return box;
}
function assertManifest(manifest: BuildingChunkManifest | undefined, state: ColdCityState): asserts manifest is BuildingChunkManifest {
  if (!manifest || manifest.sceneId !== state.store.sceneId || manifest.fingerprint !== state.store.fingerprint
    || manifest.sourceFingerprint !== state.store.sourceFingerprint || manifest.format !== state.store.format
    || manifest.schema_version !== state.counts.schema_version || manifest.generator_version !== state.counts.generator_version
    || manifest.buildings !== state.counts.buildings || manifest.refusals !== state.counts.refusals || manifest.openSpaces !== state.counts.open_spaces)
    throw new Error(urbanText(['La génération bâtie stockée ne correspond plus à la ville sélectionnée.','The stored building generation no longer matches the selected city.','已存储的建筑生成结果不再与所选城市匹配。','La generación construida almacenada ya no coincide con la ciudad seleccionada.','A geração construída armazenada não corresponde mais à cidade selecionada.']));
}
function mergeContext(into: PlacementBatch, value: BuildingChunkRead): void {
  if (value.scene.buildings.length !== 1 || value.scene.buildings[0] !== value.building)
    throw new Error(urbanText(['Un contexte natif de sélection contient un autre bâtiment.','A native selection context contains a different building.','原生选择上下文包含其他建筑。','Un contexto nativo de selección contiene otro edificio.','Um contexto nativo de seleção contém outro edifício.']));
  for (const [id, source] of Object.entries(value.scene.plan_archives ?? {})) {
    const previous = into.plan_archives?.[id];
    if (previous !== undefined && previous !== source) throw new Error(urbanText(['Deux archives natives portent une identité contradictoire.','Two native archives have conflicting identities.','两个原生档案的身份相互冲突。','Dos archivos nativos tienen identidades contradictorias.','Dois arquivos nativos têm identidades contraditórias.']));
    (into.plan_archives ??= {})[id] = source;
  }
  for (const material of value.scene.materials ?? []) {
    const previous = into.materials?.find(m => m.id === material.id);
    if (previous && materialKey(previous) !== materialKey(material)) throw new Error(urbanText(['Les contextes voisins divergent sur une matière native.','Neighboring contexts disagree on a native material.','相邻上下文中的原生材料不一致。','Los contextos vecinos discrepan sobre un material nativo.','Os contextos vizinhos divergem sobre um material nativo.']));
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
      throw new Error(urbanText(['L’édition des villes translatées n’est pas encore prise en charge : les coordonnées du site original ne sont pas garanties.','Editing translated cities is not yet supported: original site coordinates are not guaranteed.','尚不支持编辑平移后的城市：无法保证原场地坐标。','Aún no se admite editar ciudades trasladadas: no se garantizan las coordenadas del sitio original.','A edição de cidades transladadas ainda não é suportada: as coordenadas do local original não são garantidas.']));
    if (!/^[a-f0-9]{64}$/.test(options.sourceFingerprint)) throw new Error(urbanText(['L’empreinte de la nouvelle source bâtie est invalide.','The new building source fingerprint is invalid.','新的建筑源指纹无效。','La huella de la nueva fuente construida no es válida.','A impressão da nova fonte construída é inválida.']));
    if (!original.id || original.id !== edited.id || original.parcel_id !== edited.parcel_id)
      throw new Error(urbanText(['L’édition doit conserver l’identité du bâtiment et de sa parcelle.','The edit must preserve the building and parcel identities.','编辑必须保留建筑和地块的身份。','La edición debe conservar la identidad del edificio y su parcela.','A edição deve preservar a identidade do edifício e do lote.']));
    if (original.function === 'open_space' || edited.function === 'open_space')
      throw new Error(urbanText(['Cette édition froide doit remplacer un bâtiment par un bâtiment ; la conversion en espace libre n’est pas prise en charge.','This cold edit must replace a building with a building; conversion to open space is not supported.','此冷存储编辑必须用建筑替换建筑；不支持转换为开放空间。','Esta edición en frío debe sustituir un edificio por otro; no se admite convertirlo en espacio libre.','Esta edição a frio deve substituir um edifício por outro; a conversão em espaço livre não é suportada.']));
    const limits = { ...DEFAULT_LIMITS };
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      const value = options.limits?.[key] ?? limits[key];
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(urbanText(['Le budget du voisinage de l’édition est invalide.','The edit neighborhood budget is invalid.','编辑邻域预算无效。','El presupuesto del entorno de edición no es válido.','O orçamento da vizinhança da edição é inválido.'])); limits[key] = value;
    }
    const maxChunkBytes = options.maxChunkBytes ?? BUILDING_CHUNK_MAX_BYTES;
    if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes <= 0 || maxChunkBytes > BUILDING_CHUNK_MAX_BYTES)
      throw new Error(urbanText(['Le budget de copie des chunks est invalide.','The chunk-copy budget is invalid.','数据块复制预算无效。','El presupuesto de copia de bloques no es válido.','O orçamento de cópia de blocos é inválido.']));
    // Capture CAS before selected reads, neighbourhood IO and native generation.
    const active = await backend.active(); check(); const expectedActive = active?.sceneId ?? null;
    const targetManifest = await backend.manifest(source.store.sceneId); check(); assertManifest(targetManifest, source);
    const selected = await session.read(original.id); check();
    if (!selected || selected.building.id !== original.id || selected.building.parcel_id !== original.parcel_id)
      throw new Error(urbanText(['Le bâtiment demandé est absent ou son site d’origine est périmé.','The requested building is missing or its original site is stale.','请求的建筑不存在或其原场地已过期。','Falta el edificio solicitado o su sitio de origen está desactualizado.','O edifício solicitado está ausente ou seu local de origem está desatualizado.']));
    const nearby = await session.readVisible(coldArchitectureEditBounds(edited), limits); check();
    if (nearby.truncated) throw new Error(urbanText(['Le voisinage natif dépasse le budget de lecture ; l’édition est refusée sans modifier la ville.','The native neighborhood exceeds the read budget; the edit is refused without changing the city.','原生邻域超出读取预算；编辑被拒绝，城市未更改。','El entorno nativo supera el presupuesto de lectura; la edición se rechaza sin modificar la ciudad.','A vizinhança nativa excede o orçamento de leitura; a edição é recusada sem alterar a cidade.']));
    // Explicit bounded subset, composed solely of actual native records. Empty
    // refusals/open_spaces describe this subset, not a fabricated display scene.
    const scoped: PlacementBatch = { schema_version: targetManifest.schema_version, generator_version: targetManifest.generator_version,
      buildings: [], refusals: [], open_spaces: [] };
    const ids = new Set<string>(); let containsSelected = false;
    for (const value of nearby.buildings) {
      if (ids.has(value.building.id)) throw new Error(urbanText(['Le voisinage natif contient une identité dupliquée.','The native neighborhood contains a duplicate identity.','原生邻域包含重复身份。','El entorno nativo contiene una identidad duplicada.','A vizinhança nativa contém uma identidade duplicada.'])); ids.add(value.building.id);
      const record = value.building.id === original.id ? selected : value;
      containsSelected ||= record.building.id === original.id; scoped.buildings.push(record.building); mergeContext(scoped, record);
    }
    if (!containsSelected) { scoped.buildings.unshift(selected.building); mergeContext(scoped, selected); }
    const result = await editArchitectureScene(scoped, [edited], async input => {
      check(); const generated = await (options.generate ?? nativePlans)(input); check();
      // The scoped helper can permit generator changes when no local outsider
      // exists. A cold city may still have distant rows: enforce the full manifest.
      if (generated.generator_version !== targetManifest.generator_version || generated.schema_version !== targetManifest.schema_version)
        throw new Error(urbanText(['Changer de générateur exige de remplacer la ville entière, pas un seul bâtiment.','Changing generator requires replacing the entire city, not one building.','更换生成器需要替换整个城市，不能只替换一栋建筑。','Cambiar de generador exige reemplazar toda la ciudad, no un solo edificio.','Mudar de gerador exige substituir a cidade inteira, não apenas um edifício.']));
      return generated;
    }, options.settings);
    check();
    if (!result.applied) return { applied: false, message: result.refusals.map(r => r.message).join(' · ') || urbanText(['L’édition native n’a pas été admise.','The native edit was not admitted.','原生编辑未获接纳。','La edición nativa no fue admitida.','A edição nativa não foi admitida.']) };
    const replacement = result.scene.buildings.find(b => b.id === original.id);
    if (!replacement || result.changedIds.length !== 1 || replacement.parcel_id !== original.parcel_id || replacement.simplification !== 'architectural_plan'
      || !isArchivedPlan(replacement.resolved)) throw new Error(urbanText(['La réponse native doit fournir un seul plan archivé pour le bâtiment sélectionné.','The native response must provide one archived plan for the selected building.','原生响应必须为所选建筑提供一个已归档规划。','La respuesta nativa debe proporcionar un único plano archivado para el edificio seleccionado.','A resposta nativa deve fornecer um único plano arquivado para o edifício selecionado.']));
    const newArchiveId = replacement.resolved.archive_id, newArchive = result.scene.plan_archives?.[newArchiveId];
    if (typeof newArchive !== 'string') throw new Error(urbanText(['Le plan remplacé ne possède pas son archive native.','The replacement plan has no native archive.','替换规划没有原生档案。','El plano reemplazado no tiene su archivo nativo.','O plano substituído não possui seu arquivo nativo.']));
    // Preserve the complete native table: the retained compact plan can refer
    // to materials absent from its simplified display volumes/features.
    const definitions = new Map((result.scene.materials ?? []).map(m => [m.id, m]));
    // Prepare only this selected DTO before committing: projection validation
    // must not turn a durable success into a reported failure afterward.
    const projection = projectNativeBuildingRecords([replacement], result.scene.materials);
    // Recheck cancellation after the stage's async fingerprint, immediately
    // before the actual commit transaction. The optional signal also aborts it.
    const guardedBackend: BuildingChunkBackend = { ...(backend.derived ? { derived: backend.derived } : {}),
      begin: id => backend.begin(id), append: (id, chunk, entries) => backend.append(id, chunk, entries),
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
        if (next && materialKey(next) !== materialKey(material)) throw new Error(urbanText(['L’édition redéfinit une matière partagée par la ville ; elle nécessite une régénération globale.','The edit redefines a material shared by the city; a full regeneration is required.','编辑重新定义了城市共用材料；需要整体重新生成。','La edición redefine un material compartido por la ciudad; requiere una regeneración completa.','A edição redefine um material compartilhado pela cidade; é necessária uma regeneração completa.']));
      }
      const archive = delta.plan_archives?.[newArchiveId];
      if (archive !== undefined && archive !== newArchive) throw new Error(urbanText(['La nouvelle archive contredit une archive conservée.','The new archive conflicts with a retained archive.','新档案与保留的档案冲突。','El nuevo archivo contradice un archivo conservado.','O novo arquivo contradiz um arquivo mantido.']));
      const at = delta.buildings.findIndex(b => b.id === original.id);
      const originalSites = session.siteVisuals?.slice(record.descriptor.progress.start, record.descriptor.progress.completed);
      if (at < 0) await stage.appendStored(record.stored, originalSites);
      else {
        if (++replaced !== 1 || record.descriptor.index !== selected.chunkIndex || delta.buildings[at].parcel_id !== original.parcel_id)
          throw new Error(urbanText(['La position du bâtiment dans le stockage froid a changé.','The building position in cold storage has changed.','建筑在冷存储中的位置已改变。','La posición del edificio en el almacenamiento en frío ha cambiado.','A posição do edifício no armazenamento a frio mudou.']));
        const buildings = delta.buildings.map((building, index) => index === at ? replacement : building), archives: Record<string, string> = {};
        for (const building of buildings) {
          if (!isArchivedPlan(building.resolved)) throw new Error(urbanText(['Un plan conservé n’est pas archivé.','A retained plan is not archived.','保留的规划未归档。','Un plano conservado no está archivado.','Um plano mantido não está arquivado.']));
          const id = building.resolved.archive_id, payload = id === newArchiveId ? newArchive : delta.plan_archives?.[id];
          if (typeof payload !== 'string') throw new Error(urbanText(['Une archive conservée est absente.','A retained archive is missing.','缺少保留的档案。','Falta un archivo conservado.','Um arquivo mantido está ausente.'])); archives[id] = payload;
        }
        const materials = new Map((delta.materials ?? []).map(m => [m.id, m]));
        for (const [id, material] of definitions) if (!materials.has(id)) materials.set(id, material);
        await stage.append({ ...delta, buildings, plan_archives: archives, ...(materials.size ? { materials: [...materials.values()] } : {}) }, record.descriptor.progress, originalSites);
      }
    }
    if (replaced !== 1) throw new Error(urbanText(['Le bâtiment sélectionné a disparu du stockage froid.','The selected building disappeared from cold storage.','所选建筑已从冷存储中消失。','El edificio seleccionado ha desaparecido del almacenamiento en frío.','O edifício selecionado desapareceu do armazenamento a frio.']));
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
