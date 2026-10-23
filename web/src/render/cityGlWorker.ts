/** City GPU renderer — triangulation worker. Receives a self-contained polygon slice
 * (cityGlBuild.slicePolygons), returns its triangles and outline edges with the
 * buffers transferred (no copy back). */
import { triangulatePolygons } from './cityGlBuild';

interface Job { id: number; coords: Float32Array; rings: Uint32Array; polys: Uint32Array }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = e => {
  const { id, coords, rings, polys } = e.data;
  const start = performance.now(), r = triangulatePolygons({ coords, rings, polys });
  scope.postMessage({ id, ms: performance.now() - start, ...r }, [r.triangles.buffer, r.lines.buffer, r.polyTriangles.buffer, r.polyLines.buffer]);
};
