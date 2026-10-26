import type { SurfaceLiveRegion } from '../../scripts/surface_live_plugin';
import { encodeSurfaceBinary } from '../surface/binary';
import { SURFACE_PACKET_MAX_BYTES } from '../surface/limits';
import { postSurfaceBinary } from './surfaceLiveUpload';
/** Development bridge: source generation remains separate from display state. */
export function installSurfaceLive(handler: (region: SurfaceLiveRegion, signal: AbortSignal) => Promise<unknown>, onStatus?: (message: string) => void): () => void {
  const events = new EventSource('/surface-live/events'), requests = new Map<string, AbortController>();
  let sessionId = '';
  events.onerror = () => { for (const controller of requests.values()) controller.abort(); requests.clear(); sessionId = ''; };
  events.addEventListener('ready', event => { sessionId = JSON.parse((event as MessageEvent).data).sessionId; });
  events.addEventListener('cancel', event => {
    const { id } = JSON.parse((event as MessageEvent).data); requests.get(id)?.abort(); requests.delete(id);
  });
  events.addEventListener('terrain', event => {
    const { id, region } = JSON.parse((event as MessageEvent).data) as { id: string; region: SurfaceLiveRegion };
    const controller = new AbortController(); requests.set(id, controller);
    void (async () => {
      try {
        onStatus?.('Préparation de la surface pour le visualiseur local…');
        const packet = await handler(region, controller.signal);
        if (controller.signal.aborted) return;
        const binary = packet instanceof ArrayBuffer ? packet : encodeSurfaceBinary(packet, { maxBytes: SURFACE_PACKET_MAX_BYTES }).buffer as ArrayBuffer;
        await postSurfaceBinary(`/surface-live/reply/${id}`,binary,sessionId,controller.signal);
        onStatus?.('Surface transmise au visualiseur local.');
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          const cancelled = error instanceof Error && error.name === 'AbortError';
          await fetch(`/surface-live/reply/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, error: message, cancelled }) }).catch(() => {});
          if (!cancelled) onStatus?.(message);
        }
      } finally { requests.delete(id); }
    })();
  });
  return () => { events.close(); for (const controller of requests.values()) controller.abort(); requests.clear(); };
}
