import { buildForestField, type ForestField, type ForestFieldInput, type ForestSettings } from '../../../rust/bridge/terrainForest';

/** Builds the canonical Render3D forest field off the UI thread.
 * Inputs arrive as copies, so the bench keeps its retained heights and water; the RGBA is transferred back. */
export interface ForestRequest { input: ForestFieldInput; settings: ForestSettings }
export type ForestReply = { field: ForestField; ms: number } | { error: string };

self.onmessage = (event: MessageEvent<ForestRequest>) => {
  const { input, settings } = event.data, started = performance.now();
  try {
    const field = buildForestField(input, settings);
    self.postMessage({ field, ms: performance.now() - started } satisfies ForestReply, { transfer: [field.rgba.buffer as ArrayBuffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies ForestReply); }
};
