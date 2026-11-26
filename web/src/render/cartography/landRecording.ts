import { RecordingContext, type RecordedSection } from '../gpu/recorder';
import { getLanduseForestTone } from '../landuseForestTone';
import { LAND_ORDER, type Scene } from '../scene';
import { SeasonColorTable, seasonSource } from '../seasonPalette';
import type { Palette } from '../styles';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';
import { paintLandUseSteps } from './landuse';

/** The land classes, washes and field strips of one live band. The backdrop, destination-in
 * mask, field network and stamps are outside this section. Its ops only draw into the soft
 * prefix, which the compositor finishes baking before showing a region. */
export class LandRecording {
  private entry?: { source: Palette; world: CartographyContext['world']; scene: Scene; brushes: CartographyContext['brushes']; key: string; colors: SeasonColorTable; section: RecordedSection; furrows: number };

  *paint(c: CartographyContext, f: VectorFrame): Generator<void> {
    const rec = f.ctx;
    if (!(rec instanceof RecordingContext) || !f.luOn) {
      yield* paintLandUseSteps(c, f);
      return;
    }
    const { world, scene, brushes, pal } = c,
      source = seasonSource(c.basePalette),
      r = f.budgetRect;
    // View and target size determine the recorded transform, budget rectangle bounds the field
    // detail. The scene and source determine the map clip, widths, paint margins and geometry.
    const kinds = !c.activeLight && c.deps.fullLanduse ? LAND_ORDER.filter(c.deps.fullLanduse).join(',') : '*';
    const key = `${f.view.cx}|${f.view.cy}|${f.sc}|${f.dpr}|${f.cssW}|${f.cssH}|${r.minX},${r.minY},${r.maxX},${r.maxY}|${c.activeLight}|${kinds}|${!!c.deps.groundTrees?.()}|${getLanduseForestTone()}`;
    const e = this.entry;
    if (e && e.source === source && e.scene === c.scene && e.world === c.world && e.brushes === c.brushes && e.key === key) {
      e.colors.update(c.pal);
      rec.appendSection(e.section);
      f.fs.furrowsDrawn = (f.fs.furrowsDrawn ?? 0) + e.furrows;
      return;
    }
    this.entry = undefined;
    const colors = new SeasonColorTable(pal),
      before = f.fs.furrowsDrawn ?? 0;
    const section = yield* rec.captureSection(paintLandUseSteps(c, f, colors.ink));
    if (section && c.pal === pal && c.scene === scene && c.world === world) this.entry = { source, world, scene, brushes, key, colors, section, furrows: (f.fs.furrowsDrawn ?? 0) - before };
  }
}
