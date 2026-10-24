import type { ParentContextVisual, ParentVisualRecords } from './urbanParentVisual';
import type { HouseMaterial } from '../../../rust/bridge/housesContract';
import { houseMaterialColor } from '../../../rust/bridge/houseRender';
export function paintParentContexts(ctx: CanvasRenderingContext2D, contexts: readonly ParentContextVisual[], materials: HouseMaterial[]): number {
  let vertices = 0; ctx.save();
  try { for (const context of contexts) {
    ctx.fillStyle = context.material ? houseMaterialColor({ materials }, context.material) : '#b1a18b'; ctx.globalAlpha = .55;
    ctx.beginPath(); for (const polygon of context.surface) for (const ring of [polygon.outer, ...polygon.holes]) {
      if (!ring.length) continue; ctx.moveTo(ring[0].x, ring[0].y); for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y); ctx.closePath(); vertices += ring.length;
    } ctx.fill('evenodd');
  } } finally { ctx.restore(); } return vertices;
}
