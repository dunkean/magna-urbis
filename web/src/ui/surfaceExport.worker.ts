import { exportSurfacePacket } from '../surface/adapters/export';
import { encodeSurfaceBinary } from '../surface/binary';
import { SURFACE_MEMORY_BUDGET_BYTES, SURFACE_PACKET_MAX_BYTES } from '../surface/limits';
import { validateSurfacePacket } from '../surface/packet';
import { resolveSurfaceFrame } from '../surface/adapters/frame';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = event => {
  try {
    const { decor, scene } = event.data;
    const frame=resolveSurfaceFrame(decor);
    const packet = exportSurfacePacket(decor, scene, { terrainOriginX:frame.terrainSourceOrigin.x,terrainOriginZ:frame.terrainSourceOrigin.z, encoding: 'binary', memoryBudgetBytes: SURFACE_MEMORY_BUDGET_BYTES });
    validateSurfacePacket(packet);
    const bytes = encodeSurfaceBinary(packet, { maxBytes: SURFACE_PACKET_MAX_BYTES });
    scope.postMessage({ binary: bytes.buffer }, [bytes.buffer]);
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
