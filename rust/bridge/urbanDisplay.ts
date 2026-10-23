import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { nativeRequest } from './nativeEngine';
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
