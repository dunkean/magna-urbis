import type { Vec2 } from '../gen/core/geom';
import { PALETTES } from '../render/styles';
import type { View } from '../render/view';
import type { CityPreviewDetail, CityPreviewPlan } from './cityPreviewPlan';

const palette = PALETTES.minimal;
const ink = palette.urban;
const blockColors = [ink.yard, '#e7dac7', '#e2d3bd'];

function paths(lines: readonly (readonly Vec2[])[], closed = false): Path2D {
  const path = new Path2D();
  for (const [a, ...points] of lines) {
    path.moveTo(a.x, a.y);
    for (const p of points) path.lineTo(p.x, p.y);
    if (closed) path.closePath();
  }
  return path;
}

/** Canvas batches are built once per phase. Pan and zoom only change their transform. */
export class CityPreviewCanvas {
  private layers: { water: Path2D; banks: Path2D; blocks: Path2D[]; roads: Path2D; walls: Path2D; gates: Path2D[]; bridges: Path2D; docks: Path2D; landmarks: Path2D; squares: Path2D };
  private lanes?: Path2D;
  private roofs?: Path2D;
  private context: CanvasRenderingContext2D;

  constructor(
    readonly element: HTMLCanvasElement,
    plan: CityPreviewPlan,
  ) {
    const context = element.getContext('2d', { alpha: false });
    if (!context) throw new Error('The city map could not be drawn.');
    this.context = context;
    this.layers = {
      water: paths(plan.water, true),
      banks: paths(plan.banks),
      blocks: blockColors.map((_, tone) =>
        paths(
          plan.blocks.filter(block => block.tone === tone).map(block => block.ring),
          true,
        ),
      ),
      roads: paths(plan.roads),
      walls: paths(plan.walls),
      gates: plan.gates.map(line => paths([line])),
      bridges: paths(plan.bridges),
      docks: paths(plan.docks),
      landmarks: paths(plan.landmarks, true),
      squares: paths(plan.squares, true),
    };
  }

  setDetail(detail: CityPreviewDetail): void {
    this.lanes = paths(detail.lanes);
    this.roofs = paths(detail.roofs, true);
  }

  draw(view: View, width: number, height: number, deviceRatio: number): void {
    const { element, context: ctx, layers } = this;
    const dpr = Math.min(2, deviceRatio, Math.sqrt(2_000_000 / (width * height)));
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    if (element.width !== w) element.width = w;
    if (element.height !== h) element.height = h;
    ctx.resetTransform();
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, w, h);
    const scale = view.scale * dpr;
    ctx.setTransform(scale, 0, 0, scale, w / 2 - view.cx * scale, h / 2 - view.cy * scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const fill = (path: Path2D, color: string) => {
      ctx.fillStyle = color;
      ctx.fill(path);
    };
    const stroke = (path: Path2D, color: string, size: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.stroke(path);
    };

    fill(layers.water, palette.seaFill);
    stroke(layers.banks, palette.waterEdge, 0.9);
    for (const [i, path] of layers.blocks.entries()) fill(path, blockColors[i]);
    fill(layers.squares, ink.street);
    stroke(layers.squares, ink.streetEdge, 0.65);
    stroke(layers.roads, ink.streetEdge, 3.8);
    stroke(layers.roads, ink.street, 2.8);
    if (this.lanes) stroke(this.lanes, ink.street, 1.3);
    if (this.roofs) {
      fill(this.roofs, ink.mass);
      stroke(this.roofs, ink.massEdge, 0.29);
    }
    fill(layers.landmarks, ink.landmark);
    stroke(layers.landmarks, ink.landmarkEdge, 0.75);
    stroke(layers.walls, ink.wall, 1.9);
    for (const gate of layers.gates) stroke(gate, ink.street, 2.65);
    stroke(layers.bridges, ink.wall, 4.5);
    stroke(layers.bridges, ink.street, 2.85);
    stroke(layers.docks, ink.massEdge, 1.7);
    stroke(layers.docks, ink.mass, 0.9);
  }
}
