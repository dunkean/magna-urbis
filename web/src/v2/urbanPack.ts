// Transport form of the native town partitions (`world.debug.v2RustCities[*]`) for postMessage hops
// between the engine worker and the page. Partitions that came from an engine pack
// (`magna-city-parcels`, rust/bridge/urbanParcelPack.ts) travel as a copy of that pack, transferred,
// and the receiver materialises the very same plain objects: a large town never goes through a
// structured clone of millions of parcel objects. Arrays without a pack (merged on the page, empty
// markers, moved towns, loaded projects) are left in place and cloned as before.
// The building sites decoded from the engine's binary site visuals travel the same way (their buffer,
// transferred), and an unedited silhouette scene built from them is rebuilt on the receiver: a town of
// 1,000,000 inhabitants (173k sites) otherwise exceeded the structured clone ("Data cannot be cloned, out of memory").
import type { World } from '../gen/types';
import type { Partition } from '../../../rust/bridge/urban';
import { packOf, partitionsFromPack } from '../../../rust/bridge/urbanParcelPack';
import { decodeCitySiteVisuals, siteVisualsPackOf } from '../render/cityDisplayBuffers';
import { siteVisualScene, siteVisualSceneSource } from '../ui/urbanSilhouettes';
import type { UrbanSiteVisual } from '../ui/urbanSiteStore';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { UrbanLayer } from '../gen/types';
import { lastProjection, projectRustTown } from './rustTownProjection';
import type { RustTownSnapshot } from './rustUrban';

/** Town packs above this size (parcels + site visuals) make a result "heavy": the page replaces the engine worker before it
 * unpacks them (client.ts), because a renderer's workers and page share one ~4 GB JS heap. A 20k town moves a few MB,
 * a 1M town about 460 MB. */
export const HEAVY_RESULT_BYTES = 128 * 2 ** 20;
interface PackedPartitions { packedPartitions: 1; buffer: ArrayBuffer }
interface PackedSites { packedSites: 1; buffer: ArrayBuffer }
interface SceneFromSites { sceneFromSites: 1 }
/** The snapshot fields that hold partitions; they often share one array. */
const FIELDS = ['partitions', 'cadastralPartitions', 'programmePartitions'] as const;
type Snapshot = Partial<Record<(typeof FIELDS)[number] | 'sites' | 'scene', unknown>>;
const isPacked = (value: unknown): value is PackedPartitions => !!value && typeof value === 'object' && (value as PackedPartitions).packedPartitions === 1;
const isPackedSites = (value: unknown): value is PackedSites => !!value && typeof value === 'object' && (value as PackedSites).packedSites === 1;
const isSceneFromSites = (value: unknown): value is SceneFromSites => !!value && typeof value === 'object' && (value as SceneFromSites).sceneFromSites === 1;
/** A heavy town's urban layer (or a naming copy of it): sent without the arrays it shares with the last projection of its
 * snapshot (rustTownProjection.ts); the receiver projects the unpacked snapshot again and puts those arrays back, so their
 * rings stay shared with the parcels and the scene there instead of arriving as a second, cloned copy. */
interface ProjectedUrban { projectedUrban: { key: string; population: number; culture: string; shared: string[] } }
const isProjectedUrban = (value: unknown): value is ProjectedUrban => !!value && typeof value === 'object' && typeof (value as ProjectedUrban).projectedUrban === 'object';

/** A shallow copy of `world` whose registered town partitions and site visuals are packed, and the buffers to transfer.
 * `world` is untouched; the sender keeps its pack (each placeholder carries a copy) and its objects.
 * One placeholder per distinct array, so arrays shared between the fields stay shared after unpacking. */
export function packWorldPartitions<T extends World | undefined>(world: T): { world: T; transfer: ArrayBuffer[] } {
  const cities = world?.debug?.v2RustCities as Record<string, Snapshot | undefined> | undefined;
  if (!world || !cities) return { world, transfer: [] };
  const placeholders = new Map<Partition[], PackedPartitions>(), transfer: ArrayBuffer[] = [];
  let packedCities: Record<string, Snapshot | undefined> | undefined;
  for (const [key, snapshot] of Object.entries(cities)) {
    let packed: Snapshot | undefined;
    for (const field of FIELDS) {
      const partitions = snapshot?.[field] as Partition[] | undefined;
      if (!Array.isArray(partitions)) continue;
      let placeholder = placeholders.get(partitions);
      if (!placeholder) {
        const pack = packOf(partitions);
        if (!pack) continue;
        placeholder = { packedPartitions: 1, buffer: pack.slice(0) };
        placeholders.set(partitions, placeholder); transfer.push(placeholder.buffer);
      }
      (packed ??= { ...snapshot })[field] = placeholder;
    }
    const sites = snapshot?.sites, sitesPack = Array.isArray(sites) ? siteVisualsPackOf(sites) : undefined;
    if (sitesPack) {
      const placeholder: PackedSites = { packedSites: 1, buffer: sitesPack.slice(0) };
      (packed ??= { ...snapshot }).sites = placeholder; transfer.push(placeholder.buffer);
      const scene = snapshot?.scene as PlacementBatch | undefined;
      if (scene && siteVisualSceneSource(scene) === sites) packed.scene = { sceneFromSites: 1 } satisfies SceneFromSites;
    }
    if (packed) (packedCities ??= { ...cities })[key] = packed;
  }
  if (!packedCities) return { world, transfer: [] };
  let out: World = { ...world, debug: { ...world.debug, v2RustCities: packedCities } };
  // Heavy towns: the urban layers projected from these very snapshots are rebuilt on the receiver.
  if (transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0) > HEAVY_RESULT_BYTES) {
    const marker = (urban: UrbanLayer | undefined, key: string): UrbanLayer | undefined => {
      const source = urban && lastProjection(cities[key] as unknown as RustTownSnapshot);
      if (!urban || !source) return undefined;
      const shared = Object.keys(source.urban).filter(field => Array.isArray((urban as unknown as Record<string, unknown>)[field]) && (urban as unknown as Record<string, unknown>)[field] === (source.urban as unknown as Record<string, unknown>)[field]);
      if (!shared.length) return undefined;
      const rest: Record<string, unknown> = { ...urban }; for (const field of shared) delete rest[field];
      return { ...rest, projectedUrban: { key, population: source.population, culture: source.culture, shared } } as unknown as UrbanLayer;
    };
    const markers = new Map<UrbanLayer, UrbanLayer>();
    const settlements = world.settlements?.map(place => {
      const m = marker(place.urban, place.key); if (!m || !place.urban) return place;
      markers.set(place.urban, m); return { ...place, urban: m };
    });
    // The main town's own urban layer: the same object as its settlement's, or a naming copy of it.
    const mainKey = world.settlements?.find(place => place.main)?.key;
    const main = world.urban && (markers.get(world.urban) ?? (mainKey ? marker(world.urban, mainKey) : undefined));
    if (markers.size || main) out = { ...out, settlements, ...(main ? { urban: main } : {}) };
  }
  return { world: out as T, transfer };
}

/** Receiver side: materialises packed town partitions and site visuals in place (no-op on an ordinary world).
 * `partitionsFromPack` is memoised per buffer, so a placeholder shared by several fields gives one array. */
export function unpackWorldPartitions<T extends World | undefined>(world: T): T {
  const cities = world?.debug?.v2RustCities as Record<string, Snapshot | undefined> | undefined;
  if (!cities) return world;
  for (const snapshot of Object.values(cities)) {
    if (!snapshot) continue;
    for (const field of FIELDS) {
      const value = snapshot[field];
      if (isPacked(value)) snapshot[field] = partitionsFromPack(value.buffer);
    }
    if (isPackedSites(snapshot.sites)) snapshot.sites = decodeCitySiteVisuals(snapshot.sites.buffer);
    if (isSceneFromSites(snapshot.scene)) snapshot.scene = siteVisualScene(snapshot.sites as UrbanSiteVisual[]);
  }
  const projected = new Map<string, UrbanLayer>();
  const project = (m: ProjectedUrban): UrbanLayer => {
    const { projectedUrban: { key, population, culture, shared }, ...rest } = m;
    let urban = projected.get(key);
    if (!urban) { urban = projectRustTown(cities[key] as unknown as RustTownSnapshot, population, culture); projected.set(key, urban); }
    const out: Record<string, unknown> = { ...rest };
    for (const field of shared) out[field] = (urban as unknown as Record<string, unknown>)[field];
    return out as unknown as UrbanLayer;
  };
  for (const place of world!.settlements ?? []) if (isProjectedUrban(place.urban)) place.urban = project(place.urban);
  if (isProjectedUrban(world!.urban)) world!.urban = project(world!.urban);
  return world;
}
