import type { SurfaceLiveRegion } from '../../scripts/surface_live_plugin';
/** Development bridge: source generation remains separate from display state. */
export function installSurfaceLive(handler: (region: SurfaceLiveRegion, signal: AbortSignal) => Promise<unknown>, onStatus?: (message: string) => void): () => void {
  const events = new EventSource('/surface-live/events'), requests = new Map<string, AbortController>();
  let sessionId = '';
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
        await fetch(`/surface-live/reply/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, packet }), signal: controller.signal });
        onStatus?.('Surface transmise au visualiseur local.');
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          await fetch(`/surface-live/reply/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, error: message }) }).catch(() => {});
          onStatus?.(message);
        }
      } finally { requests.delete(id); }
    })();
  });
  return () => { events.close(); for (const controller of requests.values()) controller.abort(); requests.clear(); };
}
