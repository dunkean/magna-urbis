import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { ArchitectureRequestSource } from './architectureBatch';
import type { PlacementRequest } from './urbanArchitecture';
import { nativeRequest } from './nativeEngine';
import { validateUrbanSource, type UrbanSourceHandle } from './urbanSource';

export const URBAN_BUILDING_PAGE_LIMIT = 64;
export const URBAN_BUILDING_PAGE_BYTES = 24 * 1024 * 1024;
export interface UrbanBuildingPagesInput {
  source: UrbanSourceHandle;
  keys?: string[];
  seed: string;
  architectureCulture?: string;
}
export interface UrbanBuildingPages extends ArchitectureRequestSource {
  /** Only present when single-site reads independent of the page query are supported. */
  readonly siteQuery?: UrbanBuildingPagesInput;
  /** Wall-clock HTTP/decoding time, excluding houses and consumer ACK waits. */
  readonly timing: { prepareMs: number; readMs: number; pages: number };
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const checkCancelled = (cancelled?: () => boolean): void => {
  if (cancelled?.()) throw new DOMException('Calcul remplacé', 'AbortError');
};

/** Bound the response before decoding, including a small allowance for the JSON
 * envelope. A bad server cannot turn a small requested page into a full scene. */
export async function boundedSiteJson(response: Response, maxBytes: number): Promise<Record<string, unknown>> {
  const cap = maxBytes + 64 * 1024, reader = response.body?.getReader();
  if (!reader) throw new Error('Empty retained building-site response.');
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > cap) { await reader.cancel(); throw new Error('Retained building-site response exceeds its byte budget.'); }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const decoded: unknown = JSON.parse(text);
  if (!record(decoded)) throw new Error('Invalid retained building-site response.');
  if (decoded.ok === false || decoded.error) throw new Error(String(decoded.error ?? 'Retained building-site read failed.'));
  const result = decoded.data ?? decoded;
  if (!record(result) || result.ok === false || result.error) throw new Error(String(record(result) ? result.error ?? 'Retained building-site read failed.' : 'Invalid retained building-site response.'));
  return result;
}

/** Undefined means only that a legacy caller's server lacks pagination.
 * requireSiteRead checks both capabilities before Begin and forbids that fallback.
 * Once begin is attempted, every error propagates: never silently fetch a whole
 * city or re-upload its source. One active page index is native/session-owned. */
export async function beginUrbanBuildingPages(input: UrbanBuildingPagesInput, runtime: ExecutionRuntime,
  options: { cancelled?(): boolean; requireSiteRead?: boolean } = {},
): Promise<UrbanBuildingPages | undefined> {
  if (runtime.profile !== 'local') throw new Error('Retained building-site pages require the local runtime.');
  validateUrbanSource(input.source);
  if (typeof input.seed !== 'string' || (input.architectureCulture !== undefined && typeof input.architectureCulture !== 'string')) throw new Error('Invalid retained building-site seed or culture.');
  if (input.keys !== undefined && (!Array.isArray(input.keys) || input.keys.some(key => typeof key !== 'string' || !key)
    || new Set(input.keys).size !== input.keys.length)) throw new Error('Invalid retained building-site keys.');
  // Copy only scalar handle fields, so later caller mutations or extra snapshot
  // properties cannot change page identity or leak geometry onto the wire.
  const { version, session, terrainRevision, layoutsRevision, partitionsRevision } = input.source;
  const source = { version, session, terrainRevision, layoutsRevision, partitionsRevision };
  const begin = { kind: 'buildingSitesBegin', source, keys: input.keys?.slice(), seed: input.seed, architectureCulture: input.architectureCulture };
  const local = { ...runtime, server: runtime.server.replace(/\/+$/, '') };
  const start = performance.now();
  checkCancelled(options.cancelled);
  const response = await fetch(`${local.server}/status`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error('Moteur Rust local inaccessible pour les sites paginés.');
  const status = await response.json() as { service?: string; capabilities?: string[] };
  checkCancelled(options.cancelled);
  if (status.service !== 'magna-urbis-local' || (status.capabilities !== undefined && !Array.isArray(status.capabilities))) throw new Error('Invalid local runtime status for retained building-site pages.');
  if (options.requireSiteRead && (!status.capabilities?.includes('urban.building-site-pages') || !status.capabilities.includes('urban.building-site-read')))
    throw new Error('Projected site stream requires urban.building-site-pages and urban.building-site-read capabilities; full-site fallback is forbidden.');
  if (!status.capabilities?.includes('urban.building-site-pages')) return undefined;
  const opened = await boundedSiteJson(await nativeRequest(local, '/urban', JSON.stringify(begin)), 1024);
  checkCancelled(options.cancelled);
  if (typeof opened.sourceId !== 'string' || !opened.sourceId.length || opened.sourceId.length > 128 || !integer(opened.total)) throw new Error('Invalid retained building-site index.');
  const sourceId = opened.sourceId, total = opened.total;
  const timing = { prepareMs: performance.now() - start, readMs: 0, pages: 0 };
  const siteQuery = status.capabilities.includes('urban.building-site-read')
    ? { source, keys: begin.keys, seed: begin.seed, architectureCulture: begin.architectureCulture } : undefined;
  return { total, timing, siteQuery, async read(offset, limit, maxBytes) {
    if (!integer(offset) || offset > total || !integer(limit) || limit < 1 || limit > URBAN_BUILDING_PAGE_LIMIT
      || !integer(maxBytes) || maxBytes < 1 || maxBytes > URBAN_BUILDING_PAGE_BYTES) throw new Error('Invalid retained building-site page bounds.');
    checkCancelled(options.cancelled);
    // The array envelope itself needs two bytes. Flush the pending architecture
    // prefix locally instead of asking native code for an impossible budget.
    if (maxBytes < 2) return [];
    const readStart = performance.now();
    try {
      const page = await boundedSiteJson(await nativeRequest(local, '/urban', JSON.stringify({ kind: 'buildingSitesPage', source, sourceId, offset, limit, maxBytes })), maxBytes);
      checkCancelled(options.cancelled);
      const requests = page.placementRequests;
      if (page.offset !== offset || page.total !== total || !Array.isArray(requests) || requests.length > limit
        || page.next !== offset + requests.length || (page.next as number) > total) throw new Error('Non-contiguous or inconsistent retained building-site page.');
      const ids = new Set<string>();
      for (const request of requests) {
        if (!record(request) || typeof request.id !== 'string' || !request.id || ids.has(request.id)) throw new Error('Invalid or duplicate retained building-site id.');
        ids.add(request.id);
      }
      // Core budgets JSON([requests]), including separators. The architecture
      // adapter budgets individual objects, then enriched native input itself.
      const payloadBytes = 2 + Math.max(0, requests.length - 1)
        + requests.reduce((sum, request) => sum + new TextEncoder().encode(JSON.stringify(request)).byteLength, 0);
      if (payloadBytes > maxBytes) throw new Error('Retained building-site page exceeds its request byte budget.');
      if (page.requiredBytes !== undefined && (!integer(page.requiredBytes) || page.requiredBytes < 1)) throw new Error('Invalid retained building-site required byte count.');
      if (!requests.length && offset < total) {
        if (!integer(page.requiredBytes) || page.requiredBytes <= maxBytes) throw new Error('Retained building-site page made no progress.');
        if (maxBytes === URBAN_BUILDING_PAGE_BYTES || page.requiredBytes > URBAN_BUILDING_PAGE_BYTES) throw new Error('A retained building site exceeds the native transport budget.');
      }
      timing.pages++;
      return requests as PlacementRequest[];
    } finally { timing.readMs += performance.now() - readStart; }
  } };
}
