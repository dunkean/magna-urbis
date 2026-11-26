import { RecordingContext, type RecordedSection } from '../gpu/recorder';
import { forestLandPaint, getLanduseForestTone } from '../landuseForestTone';
import { LAND_ORDER, type Scene } from '../scene';
import { SeasonColorTable } from '../seasonPalette';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';
import { paintLandUseSteps } from './landuse';
import { literalPalette } from './bandRecording';
import type { Palette } from '../styles';

/** The op and blending choices of a land pass; its actual pigments are all colour slots. */
export function landRecordingLook(p: Palette): string {
  return JSON.stringify([p.name === 'parchment', p.landBlend, p.landOpacity, forestLandPaint(p).alpha, p.furrowAlpha, p.stripAlpha, p.furlongAlpha, !!p.tex.garden]);
}

/** The land classes, washes and field strips of one live band. The backdrop, destination-in
 * mask, field network and stamps are outside this section. Its ops only draw into the soft
 * prefix, which the compositor finishes baking before showing a region. */
export class LandRecording {
  private entry?: { world: CartographyContext['world']; scene: Scene; brushes: CartographyContext['brushes']; key: string; colors: SeasonColorTable; section: RecordedSection; furrows: number };

  *paint(c: CartographyContext, f: VectorFrame): Generator<void> {
    const rec = f.ctx;
    if (!(rec instanceof RecordingContext) || !f.luOn) {
      yield* paintLandUseSteps(c, f);
      return;
    }
    const { world, scene, brushes, pal } = c,
      r = f.budgetRect;
    // View and target size determine the recorded transform, budget rectangle bounds the field
    // detail. The scene and source determine the map clip, widths, paint margins and geometry.
    const kinds = !c.activeLight && c.deps.fullLanduse ? LAND_ORDER.filter(c.deps.fullLanduse).join(',') : '*';
    const key = JSON.stringify([f.view.cx, f.view.cy, f.sc, f.dpr, f.cssW, f.cssH, f.rect, r, c.activeLight, kinds, !!c.deps.groundTrees?.(), getLanduseForestTone(), landRecordingLook(literalPalette(pal))]);
    const e = this.entry;
    if (e && e.scene === c.scene && e.world === c.world && e.brushes === c.brushes && e.key === key) {
      e.colors.update(literalPalette(c.pal));
      rec.appendSection(e.section);
      f.fs.furrowsDrawn = (f.fs.furrowsDrawn ?? 0) + e.furrows;
      return;
    }
    this.entry = undefined;
    const colors = new SeasonColorTable(literalPalette(pal)),
      before = f.fs.furrowsDrawn ?? 0;
    const section = yield* rec.captureSection(paintLandUseSteps(c, f, colors.ink));
    if (section && c.pal === pal && c.scene === scene && c.world === world) this.entry = { world, scene, brushes, key, colors, section, furrows: (f.fs.furrowsDrawn ?? 0) - before };
  }
}
