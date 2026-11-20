import { createRoadRouter } from './roadRoute';
import type { World, Vec2 } from '../gen/types';
import type { V2Settings } from './contracts';
import type { RoadClass } from '../../../rust/bridge/settlements';
type RouteRequest = { type?: 'route'; id: number; world: World; settings: V2Settings; points: Vec2[]; cls?: RoadClass; terrainToken?: string; variant?: number };
type Request = RouteRequest | { type: 'cancel'; id: number } | { type: 'dispose' };
const router = createRoadRouter();
let pending: RouteRequest | undefined,
  running = false,
  current: number | undefined,
  cancelled = false,
  disposing = false;

async function dispose(): Promise<void> {
  await router.dispose();
  self.postMessage({ type: 'disposed' });
  self.close();
}
/** At most the active calculation and one replacement wait: pointer previews cannot form a backlog. */
async function drain(): Promise<void> {
  running = true;
  try {
    while (pending && !disposing) {
      const request = pending;
      pending = undefined;
      current = request.id;
      cancelled = false;
      try {
        const result = await router.route(request.world, request.settings, request.points, request.cls, request.terrainToken, request.variant);
        if (!cancelled && !disposing) {
          const segment = result.segments[0];
          self.postMessage({ id: request.id, ...result, cls: segment?.class, width: segment?.width });
        }
      } catch (error) {
        if (!cancelled && !disposing) self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
      } finally {
        current = undefined;
      }
    }
  } finally {
    running = false;
    if (disposing) await dispose();
  }
}
self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.type === 'dispose') {
    disposing = true;
    pending = undefined;
    cancelled = true;
    if (!running) void dispose();
    return;
  }
  if (data.type === 'cancel') {
    if (pending?.id === data.id) pending = undefined;
    if (current === data.id) cancelled = true;
    return;
  }
  if (disposing) return;
  pending = data;
  if (!running) void drain();
};
