import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { PlacementRequest } from './urbanArchitecture';
import { nativeRequest } from './nativeEngine';
import { validateUrbanSource } from './urbanSource';
import { boundedSiteJson, URBAN_BUILDING_PAGE_BYTES, type UrbanBuildingPagesInput } from './urbanBuildingPages';

/** Runtime-only immutable descriptor. It deliberately contains no pagination sourceId. */
export type UrbanBuildingSiteQuery = UrbanBuildingPagesInput;
export function copyBuildingSiteQuery(input: UrbanBuildingSiteQuery): UrbanBuildingSiteQuery {
  validateUrbanSource(input.source);
  if (typeof input.seed !== 'string' || (input.architectureCulture !== undefined && typeof input.architectureCulture !== 'string')
    || (input.keys !== undefined && (!Array.isArray(input.keys) || input.keys.some(key => typeof key !== 'string' || !key)
      || new Set(input.keys).size !== input.keys.length))) throw new Error('Invalid retained building-site descriptor.');
  const { version, session, terrainRevision, layoutsRevision, partitionsRevision } = input.source;
  return { source: { version, session, terrainRevision, layoutsRevision, partitionsRevision }, seed: input.seed,
    ...(input.keys !== undefined ? { keys: input.keys.slice() } : {}),
    ...(input.architectureCulture !== undefined ? { architectureCulture: input.architectureCulture } : {}) };
}

/** Reads one original site from the exact snapshot/descriptor, never begins or
 * replaces the active pagination query. Errors must not fall back to generation. */
export async function readUrbanBuildingSite(input: UrbanBuildingSiteQuery, runtime: ExecutionRuntime,
  offset: number, expectedId: string, total: number, maxBytes = URBAN_BUILDING_PAGE_BYTES): Promise<PlacementRequest> {
  if (runtime.profile !== 'local' || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(total) || offset >= total
    || typeof expectedId !== 'string' || !expectedId || !Number.isSafeInteger(maxBytes) || maxBytes < 2 || maxBytes > URBAN_BUILDING_PAGE_BYTES) {
    throw new Error('Invalid retained building-site read.');
  }
  const query = copyBuildingSiteQuery(input);
  const result = await boundedSiteJson(await nativeRequest(runtime, '/urban', JSON.stringify({ kind: 'buildingSite', ...query,
    offset, expectedId, maxBytes })), maxBytes);
  const request = result.placementRequest as PlacementRequest | undefined;
  if (result.offset !== offset || result.total !== total || !request || typeof request !== 'object'
    || request.id !== expectedId || typeof request.parcel_id !== 'string') throw new Error('Retained building-site identity changed.');
  if (new TextEncoder().encode(JSON.stringify([request])).byteLength > maxBytes) throw new Error('Retained building-site read exceeds its byte budget.');
  return request;
}
