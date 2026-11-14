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

interface PackedPartitions { packedPartitions: 1; buffer: ArrayBuffer }
interface PackedSites { packedSites: 1; buffer: ArrayBuffer }
interface SceneFromSites { sceneFromSites: 1 }
/** The snapshot fields that hold partitions; they often share one array. */
const FIELDS = ['partitions', 'cadastralPartitions', 'programmePartitions'] as const;
type Snapshot = Partial<Record<(typeof FIELDS)[number] | 'sites' | 'scene', unknown>>;
const isPacked = (value: unknown): value is PackedPartitions => !!value && typeof value === 'object' && (value as PackedPartitions).packedPartitions === 1;
const isPackedSites = (value: unknown): value is PackedSites => !!value && typeof value === 'object' && (value as PackedSites).packedSites === 1;
const isSceneFromSites = (value: unknown): value is SceneFromSites => !!value && typeof value === 'object' && (value as SceneFromSites).sceneFromSites === 1;

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
  return { world: { ...world, debug: { ...world.debug, v2RustCities: packedCities } }, transfer };
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
  return world;
}
