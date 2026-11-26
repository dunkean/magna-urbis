/**
 * Urban layers of the cartography (drawVector, after the regional roads), in draw order: the density image, then far
 * away the main streets alone, closer the town grounds (urban/grounds.ts), the country fringe and the restored natural
 * ground (urban/fringe.ts), the planned grounds (urban/planGrounds.ts), the buildings (urban/buildings.ts) and the plan
 * lines (urban/planLines.ts), over one urban frame (urban/frame.ts).
 * Reads: world, scene, palette, the density image.
 */
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';
import { urbanFrame } from './urban/frame';
import { paintPavedGrounds, paintStreetSpace } from './urban/grounds';
import { paintCountryFringe, paintRestoredGround } from './urban/fringe';
import { paintPlanGrounds } from './urban/planGrounds';
import { paintBuildings } from './urban/buildings';
import { paintPlanLines } from './urban/planLines';

export function paintUrban(c: CartographyContext, f: VectorFrame): void {
  // buildScene emits the urban layers and density only for a rendered world with an urban plan.
  if (!c.world.urban) return;
  const { S, getDensity, linesOf } = c;
  const { ctx, lod, land, roadGroup } = f;
  if (lod.densityAlpha > 0) {
    const dimg = getDensity();
    if (dimg) {
      ctx.globalAlpha = 0.9 * lod.densityAlpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(dimg, 0, 0, S, S);
      ctx.globalAlpha = 1;
    }
  }
  if (!lod.blocks) {
    const uStreets = linesOf(l => l.role === 'street');
    // far: arterial and primary streets only, as thin cased lines (village and hamlet streets, 'vstreet-*', excepted)
    ctx.save();
    if (land) ctx.clip(land, 'evenodd');
    roadGroup(
      uStreets.filter(l => Number(l.kind.slice(1, 2)) <= 1 && !l.kind.endsWith('c') && !l.name.startsWith('vstreet-')),
      l => (l.kind.startsWith('r0') ? 1.8 : 1.2),
    );
    ctx.restore();
    return;
  }
  // street space = the quarters; blocks, places and masses are laid on top
  const u = urbanFrame(c, f);
  paintStreetSpace(c, f, u);
  paintPavedGrounds(c, f, u);
  paintCountryFringe(c, f, u);
  paintRestoredGround(c, f, u);
  paintPlanGrounds(c, f, u);
  paintBuildings(c, f, u);
  paintPlanLines(c, f, u);
}
