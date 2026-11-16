import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { contentType, nativeRequest } from './nativeEngine';
import { nativeFetch } from './nativeAvailability';
import { validateUrbanSource, type UrbanSourceHandle } from './urbanSource';

export interface UrbanDisplayRequest {
  source: UrbanSourceHandle;
  keys?: string[];
  ids?: boolean;
}

/** Read the binary drawing projection of an existing native snapshot. This
 * neither uploads terrain nor replaces the authoritative cadastral geometry. */
export async function readUrbanDisplayBuffers(input: UrbanDisplayRequest, runtime: ExecutionRuntime): Promise<ArrayBuffer> {
  if (runtime.profile !== 'local') throw new Error('Retained urban display buffers require the local runtime.');
  validateUrbanSource(input.source);
  if (input.keys && (input.keys.some(key => typeof key !== 'string' || !key) || new Set(input.keys).size !== input.keys.length)) {
    throw new Error('Invalid retained urban display keys.');
  }
  if (input.ids !== undefined && typeof input.ids !== 'boolean') throw new Error('Invalid urban display ids option.');
  // Whitelist fields: never pass caller geometry or runtime settings onto the wire.
  const response = await nativeRequest(runtime, '/urban', JSON.stringify({
    kind: 'displayBuffers', source: input.source, keys: input.keys, ids: input.ids,
  }));
  if (response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/octet-stream') {
    throw new Error('The local runtime did not return binary urban display buffers.');
  }
  return response.arrayBuffer();
}

export interface UrbanParcelPackOptions { keys?: string[]; groups?: string[] }
/** `magna-city-parcels` pack of a retained native snapshot (decode with `urbanParcelPack.ts`);
 * `keys` selects partitions, `groups` the columns (default: all). */
export async function readUrbanParcelPack(runtime: ExecutionRuntime, source: UrbanSourceHandle, options: UrbanParcelPackOptions = {}): Promise<ArrayBuffer> {
  if (runtime.profile !== 'local') throw new Error('Retained urban parcel packs require the local runtime.');
  validateUrbanSource(source);
  for (const list of [options.keys, options.groups]) {
    if (list && (list.some(item => typeof item !== 'string' || !item) || new Set(list).size !== list.length)) throw new Error('Invalid retained urban parcel pack keys or groups.');
  }
  const response = await nativeRequest(runtime, '/urban', JSON.stringify({ kind: 'parcelPack', source, keys: options.keys, groups: options.groups }));
  if (contentType(response) !== 'application/octet-stream') throw new Error('The local runtime did not return a binary urban parcel pack.');
  return response.arrayBuffer();
}

/** One retained parcel with its programme records: the exact serde of the engine's values. */
export interface UrbanParcelRecord {
  parcel: import('./urban').Parcel;
  allocations: import('./urban').UrbanAllocation[];
  adjacency: { a: string; b: string; sharedLength: number }[];
  environment: import('./urban').UrbanProgramme['environment'][number] | null;
}
/** Parcel `index` of the retained partition `key` (JSON). */
export async function readUrbanParcelRecord(runtime: ExecutionRuntime, source: UrbanSourceHandle, key: string, index: number): Promise<UrbanParcelRecord> {
  if (runtime.profile !== 'local') throw new Error('Retained urban parcel records require the local runtime.');
  validateUrbanSource(source);
  if (typeof key !== 'string' || !key || !Number.isInteger(index) || index < 0) throw new Error('Invalid retained urban parcel record.');
  const response = await nativeRequest(runtime, '/urban', JSON.stringify({ kind: 'parcelRecord', source, key, index }));
  return response.json() as Promise<UrbanParcelRecord>;
}

export interface UrbanSiteVisualsRequest { source: UrbanSourceHandle; seed: string; architectureCulture?: string }
/** Engines with `urban.site-visuals-v2` send per-site programme texts without the fields no display reads. */
const siteVisualsV2 = new Map<string, Promise<boolean>>();
function siteVisualsVersion(runtime: ExecutionRuntime): Promise<boolean> {
  let known = siteVisualsV2.get(runtime.server);
  if (!known) {
    known = nativeFetch(runtime, '/status', { cache: 'no-store' }, 1500).then(r => r.json())
      .then((s: { capabilities?: unknown }) => Array.isArray(s.capabilities) && s.capabilities.includes('urban.site-visuals-v2'), () => false);
    siteVisualsV2.set(runtime.server, known); void known.then(ok => { if (!ok) siteVisualsV2.delete(runtime.server); });
  }
  return known;
}
/** Binary display projection of every building site of a retained native snapshot. The complete
 * placement requests stay in the engine session; read one with `readUrbanBuildingSite`. */
export async function readUrbanSiteVisuals(input: UrbanSiteVisualsRequest, runtime: ExecutionRuntime): Promise<ArrayBuffer> {
  if (runtime.profile !== 'local') throw new Error('Retained urban site visuals require the local runtime.');
  validateUrbanSource(input.source);
  const version = await siteVisualsVersion(runtime) ? 2 : undefined;
  const response = await nativeRequest(runtime, '/urban', JSON.stringify({
    kind: 'buildingSiteVisuals', source: input.source, seed: input.seed, architectureCulture: input.architectureCulture, version,
  }));
  if (response.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/octet-stream') {
    throw new Error('The local runtime did not return binary urban site visuals.');
  }
  return response.arrayBuffer();
}
