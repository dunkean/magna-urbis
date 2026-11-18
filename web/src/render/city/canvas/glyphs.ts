/**
 * Landmark glyphs of the town as small vector marks (no font dependency in headless or offline browsers). Called by
 * the text layer and the legends.
 */
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { BUILDING_FAMILIES } from '../model/roles';

/** Small vector glyphs: no font dependency in headless or offline browsers. */
export function landmarkGlyph(ctx: CanvasRenderingContext2D, family: string, x: number, y: number, size = 7): void {
  const color = BUILDING_FAMILIES[family]?.color ?? '#3d3226';
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#fbf6ea';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, size + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const s = size * 0.62;
  switch (family) {
    case 'worship':
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.moveTo(-s * 0.6, -s * 0.35);
      ctx.lineTo(s * 0.6, -s * 0.35);
      ctx.stroke();
      break;
    case 'defence':
      ctx.fillRect(-s * 0.7, -s * 0.4, s * 1.4, s * 1.2);
      for (const dx of [-0.7, -0.1, 0.5]) ctx.fillRect(dx * s, -s * 0.8, s * 0.3, s * 0.45);
      break;
    case 'civic':
      ctx.moveTo(-s, -s * 0.15);
      ctx.lineTo(0, -s * 0.85);
      ctx.lineTo(s, -s * 0.15);
      ctx.fill();
      ctx.fillRect(-s * 0.75, -s * 0.05, s * 1.5, s * 0.85);
      break;
    case 'commerce':
      ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'craft':
      ctx.moveTo(0, -s * 0.8);
      ctx.lineTo(s * 0.8, 0);
      ctx.lineTo(0, s * 0.8);
      ctx.lineTo(-s * 0.8, 0);
      ctx.fill();
      break;
    case 'garden':
      ctx.arc(0, -s * 0.2, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-s * 0.1, 0, s * 0.2, s * 0.8);
      break;
    default:
      ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
  }
  ctx.restore();
}
