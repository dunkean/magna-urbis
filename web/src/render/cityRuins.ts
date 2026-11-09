/** Cartographic treatment of native broken walls and rubble. Never close their
 * gaps or replace a roofless shell with a filled building envelope. */
import type { Surface } from '../../../rust/bridge/housesContract';
import { pieceVolumes, readMassing } from './cityMassing';

export const RUIN_PAPER = '#d8d0bd';
export const RUIN_INK = '#463b2d';

export function ruinFootprint(footprint: Surface, programme: unknown, massing = readMassing(programme, footprint)): Surface {
  if (!massing) return (programme as { role?: string } | undefined)?.role?.endsWith('.ruin') ? footprint : [];
  return footprint.flatMap((shape, i) => pieceVolumes(shape, massing[i])
    .filter(v => v.cover === 'ruin').map(v => v.shape));
}

/** Real stubs provide the broken outline; hatching marks exposed masonry.
 * A screen-sized hairline keeps subpixel wall strips readable in map overviews. */
export function drawRuinPlan(ctx: CanvasRenderingContext2D, surface: Surface, mpp: number): number {
  if (!surface.length) return 0;
  const outline = () => {
    ctx.beginPath();
    for (const s of surface) for (const ring of [s.outer, ...s.holes]) {
      ring.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
    }
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of surface) for (const p of s.outer) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  ctx.save();
  outline(); ctx.fillStyle = RUIN_PAPER; ctx.fill('evenodd');
  ctx.save(); ctx.clip('evenodd'); ctx.beginPath();
  const spacing = 3 * mpp, height = maxY - minY;
  for (let x = Math.floor((minX - height) / spacing) * spacing; x <= maxX; x += spacing) {
    ctx.moveTo(x, minY); ctx.lineTo(x + height, maxY);
  }
  ctx.strokeStyle = RUIN_INK; ctx.lineWidth = .45 * mpp; ctx.stroke(); ctx.restore();
  outline(); ctx.strokeStyle = RUIN_INK; ctx.lineWidth = .9 * mpp; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
  return 3;
}
