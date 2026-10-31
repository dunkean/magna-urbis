import type { CityLod, CityPalette, CityScene } from './cityCanvas';

/** Walls, hedges and fences round lots (Rust `urban::enclosure`, `Partition.lotEnclosures`), thin lines under the buildings. */
export interface LotEnclosureDraw { mpp: number; lod: CityLod; palette: CityPalette }
type Material = 'wall' | 'hedge' | 'fence';
const MATERIALS: Material[] = ['wall', 'hedge', 'fence'];
const PATHS = new WeakMap<object, Map<Material, Path2D>>();

function pathsOf(scene: CityScene): Map<Material, Path2D> {
  const key = scene.lotEnclosures!;
  let paths = PATHS.get(key);
  if (paths) return paths;
  paths = new Map();
  for (const e of key) {
    if (e.path.length < 2) continue;
    const path = paths.get(e.material) ?? paths.set(e.material, new Path2D()).get(e.material)!;
    path.moveTo(e.path[0].x, e.path[0].y);
    for (let i = 1; i < e.path.length; i++) path.lineTo(e.path[i].x, e.path[i].y);
  }
  PATHS.set(key, paths);
  return paths;
}

/** Hook of drawCity: one stroke per material, styled by material and palette. */
export function drawLotEnclosures(ctx: CanvasRenderingContext2D, scene: CityScene, o: LotEnclosureDraw): void {
  if (!scene.lotEnclosures?.length || o.lod === 'far') return;
  const px = o.mpp, paths = pathsOf(scene), mono = o.palette === 'parchment' || o.palette === 'ink';
  ctx.save(); ctx.lineJoin = 'round'; ctx.setLineDash([]);
  // Continuous thin strokes (a dash pattern reads as broken fences at village scale), in the same ink family as the field hedges.
  for (const material of MATERIALS) {
    const path = paths.get(material);
    if (!path) continue;
    if (material === 'wall') { ctx.strokeStyle = mono ? '#4b3f30' : '#6f6254'; ctx.lineWidth = Math.max(0.5, px * 0.9); ctx.lineCap = 'butt'; ctx.globalAlpha = 0.85; }
    else if (material === 'hedge') { ctx.strokeStyle = mono ? '#5d6b3a' : '#5f7a3c'; ctx.lineWidth = Math.max(0.6, px * 0.9); ctx.lineCap = 'butt'; ctx.globalAlpha = 0.75; }
    else { ctx.strokeStyle = mono ? '#6a5236' : '#8a6a43'; ctx.lineWidth = Math.max(0.25, px * 0.6); ctx.lineCap = 'butt'; ctx.globalAlpha = 0.8; }
    ctx.stroke(path);
  }
  ctx.restore();
}
