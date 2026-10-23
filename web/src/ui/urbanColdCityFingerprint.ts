import type { Layout, Partition } from '../../../rust/bridge/urban';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';

async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
const textHash = (value: unknown) => hash(new TextEncoder().encode(JSON.stringify(value)));
/** Snapshot identity excludes ephemeral native session/revision handles. Hash
 * terrain fields and city partitions in series, not a second whole-city graph. */
export async function coldCityFingerprint(input: { layouts: readonly Layout[]; partitions: readonly Partition[];
  raster: SettlementRaster; seed: string; settings: PlacementBatchSettings; buildingOverrides?: unknown }): Promise<string> {
  const terrain: string[] = [];
  for (const field of [input.raster.height, input.raster.water, input.raster.waterLevel, input.raster.riverWidth, input.raster.riverIds])
    terrain.push(await hash(new Uint8Array(new Uint8Array(field.buffer, field.byteOffset, field.byteLength))));
  const layouts: string[] = [], partitions: string[] = [];
  for (const layout of input.layouts) layouts.push(await textHash(layout));
  for (const partition of input.partitions) partitions.push(await textHash(partition));
  const geometry = await textHash(input.raster.geometry ?? null);
  return textHash({ format: 'native-cold-city-source-1', width: input.raster.width, n: input.raster.n, terrain, geometry, layouts, partitions,
    seed: input.seed, settings: input.settings, buildingOverrides: input.buildingOverrides });
}
