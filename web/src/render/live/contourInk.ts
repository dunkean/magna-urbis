/** A retained contour plate, drawn as one world-space image between area and semantic overlays. */
import type { DisplayList, LivePart, LiveRasterizer } from '../gpu/contract';
import { createLiveRasterizer } from '../gpu/liveRasterizer';
import type { LiveFrame, LiveLayerStats } from './contract';
import { countWork } from '../workCount';

export interface ContourInkSource {
  terrain: object;
  /** One coverage sprite. Its tint can change while the sprite and texture stay ready. */
  list: DisplayList;
}
export interface OverlayInk {
  ready(): boolean;
  work(budgetMs: number, frame: LiveFrame): boolean;
  draw(frame: Pick<LiveFrame, 'view' | 'quality' | 'worldToPixel' | 'target' | 'width' | 'height'>): void;
  stats(): LiveLayerStats;
  contextLost(): void;
  dispose(): void;
}

export function createContourInk(gl: WebGL2RenderingContext, source: () => ContourInkSource | null | undefined): OverlayInk | undefined {
  let raster: LiveRasterizer | null = createLiveRasterizer(gl);
  if (!raster) return undefined;
  let terrain: object | undefined,
    shownList: DisplayList | undefined,
    current: ContourInkSource | undefined,
    pending = false;
  let prepared = false;
  let upload: Generator<void> | undefined;
  const post: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  const scissor: [number, number, number, number] = [0, 0, 0, 0];
  const parts: LivePart[] = [];
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, late: 0, bytes: 0, clips: 0, ops: 0, fanTriangles: 0, strokeTriangles: 0, spriteTriangles: 0 };
  return {
    ready: () => !pending,
    work(budgetMs, _frame) {
      const next = source();
      pending = next === null;
      if (!next) {
        current = undefined;
        return pending;
      }
      if ((terrain && terrain !== next.terrain) || (shownList && shownList !== next.list)) {
        raster!.dispose();
        raster = createLiveRasterizer(gl);
        if (!raster) throw new Error('Contour rasterizer unavailable');
        prepared = false;
        upload = undefined;
        parts.length = 0;
      }
      terrain = next.terrain;
      shownList = next.list;
      current = next;
      const warm = raster!.warm();
      if (!prepared) {
        upload ??= raster!.prepareSteps(next.list);
        const deadline = performance.now() + budgetMs;
        do {
          if (upload.next().done) {
            prepared = true;
            upload = undefined;
            countWork('contour.upload');
            break;
          }
        } while (performance.now() < deadline);
      }
      pending = !warm || !prepared;
      stats.bytes = raster!.bytes();
      return pending;
    },
    draw(frame) {
      stats.drawCalls = stats.triangles = stats.ms = stats.late = 0;
      stats.clips = stats.ops = stats.fanTriangles = stats.strokeTriangles = stats.spriteTriangles = 0;
      if (!current || pending) return;
      const [sx, sy, tx, ty] = frame.worldToPixel;
      post[0] = sx;
      post[3] = sy;
      post[4] = tx;
      post[5] = ty;
      scissor[2] = frame.width;
      scissor[3] = frame.height;
      if (parts[0]?.list !== current.list) parts[0] = { list: current.list, post, scissor };
      raster!.replayLive(parts, frame.target, frame.width, frame.height);
      const drawn = raster!.lastStats(),
        tally = raster!.liveTally();
      stats.drawCalls = drawn.drawCalls;
      stats.triangles = drawn.triangles;
      stats.ms = drawn.ms;
      stats.clips = drawn.clips;
      stats.ops = drawn.ops;
      stats.late = tally.late;
      stats.fanTriangles = tally.fan;
      stats.strokeTriangles = tally.stroke;
      stats.spriteTriangles = tally.sprite;
    },
    stats: () => stats,
    contextLost() {
      raster!.dropContext();
      prepared = false;
      upload = undefined;
      pending = true;
      stats.bytes = 0;
    },
    dispose() {
      raster!.dispose();
      current = shownList = terrain = undefined;
      parts.length = 0;
      prepared = false;
      upload = undefined;
    },
  };
}
