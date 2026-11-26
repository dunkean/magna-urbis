import { selectLod, WAY_SCALE } from './lod';
import type { LineLayer } from './scene';
import type { Rect4 } from './view';
import { lookRoadWidth, regionalRank, roadGroundKey, strokeNaturalRoad, type RoadStyle } from './roadStyle';
import { mapLandSnowKey } from './seasonPalette';

/** Roads in ground coordinates. Request the paint context only when this view contains a way. */
export type GroundRoadPaint = (context: () => CanvasRenderingContext2D, rect: Rect4, scale: number) => void;

export function regionalGroundRoads(layers: LineLayer[], style: () => RoadStyle): GroundRoadPaint {
  const paths = new WeakMap<LineLayer['lines'][number], Path2D>();
  return (context, rect, scale) => {
    const look = style();
    const lod = selectLod(scale);
    for (const layer of layers) {
      const field = layer.name === 'field-ways',
        drive = layer.role === 'drive';
      if ((field && (!lod.strips || scale < WAY_SCALE)) || (drive && !lod.farmsteads) || (layer.kind === 'minor' && !lod.minorRoads) || (layer.kind === 'track' && lod.band < 1)) continue;
      const metres = field ? layer.width * 0.7 : layer.width;
      const rank = field || (layer.kind === 'track' && metres < 2) ? 'path' : drive ? 'track' : regionalRank(layer.kind);
      const w = lookRoadWidth('rendered', rank, metres, scale);
      const pad = w + 2 / scale;
      const ids = layer.index.query({ minX: rect.minX - pad, minY: rect.minY - pad, maxX: rect.maxX + pad, maxY: rect.maxY + pad });
      if (!ids.length) continue;
      const ways = new Path2D();
      for (const i of ids) {
        const pts = layer.lines[i];
        if (pts.length < 2) continue;
        let path = paths.get(pts);
        if (!path) {
          path = new Path2D();
          path.moveTo(pts[0].x, pts[0].y);
          for (let j = 1; j < pts.length; j++) path.lineTo(pts[j].x, pts[j].y);
          paths.set(pts, path);
        }
        ways.addPath(path);
      }
      strokeNaturalRoad(context(), ways, rank, w, scale, { ...look, pavement: layer.pavement }, 0, metres);
    }
  };
}

/** One screen or world tile, shared by its colour and forest-floor passes. */
export class GroundRoadRaster {
  private canvas?: HTMLCanvasElement;
  private paint?: GroundRoadPaint;
  private key = '';
  private painted = false;
  revision = 0;

  draw(paint: GroundRoadPaint, frame: { origin: [number, number]; width: number; height: number; px: number }): HTMLCanvasElement | undefined {
    const {
      origin: [x, y],
      width,
      height,
      px,
    } = frame;
    const key = [x, y, width, height, px, roadGroundKey(), mapLandSnowKey()].join('|');
    if (this.paint !== paint || this.key !== key) {
      let ctx: CanvasRenderingContext2D | undefined;
      paint(
        () => {
          if (ctx) return ctx;
          const canvas = (this.canvas ??= document.createElement('canvas'));
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          ctx = canvas.getContext('2d')!;
          ctx.resetTransform();
          ctx.clearRect(0, 0, width, height);
          ctx.setTransform(1 / px, 0, 0, 1 / px, -x / px, -y / px);
          return ctx;
        },
        { minX: x, minY: y, maxX: x + width * px, maxY: y + height * px },
        1 / px,
      );
      this.painted = !!ctx;
      this.paint = paint;
      this.key = key;
      this.revision++;
    }
    return this.painted ? this.canvas : undefined;
  }
}
