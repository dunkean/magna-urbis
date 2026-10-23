import { decorColdStates, decorEntry, encodeDecor, type Decor, type DecorEntry } from './decor';
import { encodeDecorFileBytes } from './decorFileBytes';
import type { DecorFileOptions } from './decorFile';

export type DecorCaptureExtra = Partial<Pick<Decor['meta'], 'id' | 'label' | 'tags' | 'query' | 'pipeline'>>;
function encoded(bytes: Uint8Array, meta: Decor['meta'], file: string): { base64: string; entry: DecorEntry } {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(text), entry: decorEntry(meta, file) };
}
/** Legacy synchronous automation remains synchronous and explicit about its
 * limits. Async capture/export carries every exact cold chunk, up to64MiB. */
export function createTerrainDecorExports(captureData: (extra?: DecorCaptureExtra) => Decor, options: DecorFileOptions = {}) {
  const capture = (extra?: DecorCaptureExtra) => {
    const snapshot = captureData(extra);
    if (decorColdStates(snapshot).length) throw new Error('Cette ville conserve ses plans à froid : utilisez captureAsync/exportAsync ou le partage .decor en flux.');
    return { bytes: encodeDecor(snapshot), meta: snapshot.meta };
  };
  const captureAsync = async (extra?: DecorCaptureExtra) => {
    const snapshot = captureData(extra);
    return { bytes: await encodeDecorFileBytes(snapshot, options), meta: snapshot.meta };
  };
  return {
    capture, captureAsync,
    export(file: string, extra?: DecorCaptureExtra) { const { bytes, meta } = capture(extra); return encoded(bytes, meta, file); },
    async exportAsync(file: string, extra?: DecorCaptureExtra) { const { bytes, meta } = await captureAsync(extra); return encoded(bytes, meta, file); },
  };
}
