import type { Scene } from '../scene';
import type { StrokeOp } from '../gpu/contract';
import { RecordingContext, type RecordedSection } from '../gpu/recorder';
import { mapLandSnowKey, mapGroundSnow, seasonInkOf, type SeasonInk } from '../seasonPalette';
import { roadGroundKey, roadCanopyRevision } from '../roadStyle';
import type { CartographyContext } from './context';
import type { VectorFrame } from './frame';
import { materialBedSlot, paintRegionalRoads, trackSlot } from './roads';

type Stroke = { op: StrokeOp; name?: SeasonInk };

/** The road suffix remains reusable even if another layer contains baked tree or material pixels.
 * Previously shown roads keep the slot bindings that match their own baked prefix. */
export class RoadRecording {
  private held?: { scene: Scene; key: string; section: RecordedSection; strokes: Stroke[] };
  *paint(c: CartographyContext, f: VectorFrame): Generator<void> {
    const rec = f.ctx;
    if (!(rec instanceof RecordingContext) || f.cavernFloor || c.deps.regionalRoadsOnGround?.()) {
      paintRegionalRoads(c, f);
      return;
    }
    const style = f.roadStyle;
    // Surface textures, snow marks and the presence of a manual bed change the stroke recipe.
    // Two manual bed pigments use the same geometry and differ only in their colour slot.
    const material = f.natural
      ? [roadGroundKey(), mapLandSnowKey(), style.snow ?? mapGroundSnow(), style.night, style.simple, style.urban, style.pavement, materialBedSlot(c, style, false) ? true : style.colors?.road, materialBedSlot(c, style, true) ? true : style.colors?.track]
      : undefined;
    const key = JSON.stringify([f.view, f.rect, f.cssW, f.cssH, f.dpr, style.look, style.emphasis, c.pal.rural.track, trackSlot(c.pal), roadCanopyRevision(), material]);
    const held = this.held;
    if (held && held.scene === c.scene && held.key === key && held.strokes.every(s => !s.name || c.ink(s.name).valid)) {
      const ops = held.strokes.map(({ op, name }) => {
        if (!name) return op;
        const slot = c.ink(name);
        return { ...op, paint: slot };
      });
      rec.appendSection({ ...held.section, ops });
      return;
    }
    const section = yield* rec.captureSection(
      (function* () {
        paintRegionalRoads(c, f);
      })(),
    );
    if (!section) return;
    const strokes: Stroke[] = [];
    for (const op of section.ops) {
      if (op.type !== 'stroke') return;
      const slot = op.paint.kind !== 'pattern' ? op.paint.slot : undefined;
      const name = slot && seasonInkOf(slot);
      if (slot && !name) return;
      strokes.push({ op, name });
    }
    this.held = { scene: c.scene, key, section, strokes };
  }
}
