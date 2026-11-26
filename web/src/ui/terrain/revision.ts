/**
 * contentRevision() of a ground renderer (contract GroundTileRenderer, render/live/contract.ts): changes whenever
 * renderWorldTile would draw other pixels. Bumped by every input that changes the pixels, by the style pixel ratio
 * (the window moved to another screen), and when the look's own programs become complete (only when "complete"
 * flips: a speculative program finishing changes nothing). setView never bumps it.
 */
import { liveStyleRatio } from './redraw';
import type { Rect4 } from '../../render/view';

/** What an input setter changed: nothing, only the need to draw again, or the pixels (a revision bump). */
export type InputChange = 'none' | 'redraw' | 'content';

/** Revisions whose changed region is remembered (changesSince); older ones count as whole-map changes. */
const KEPT = 16;

export class RegionalRevision {
  private revision = 0;
  /** The world boxes (map metres) each recent revision changed, by revision; undefined: the whole map. */
  private readonly regions = new Map<number, readonly Rect4[] | undefined>();
  /** `region`: the world boxes whose pixels changed (a local forest edit); undefined: any pixel may have changed. */
  bump(region?: readonly Rect4[]): void {
    this.revision++;
    this.regions.set(this.revision, region);
    this.regions.delete(this.revision - KEPT);
  }
  value(): number {
    return this.revision;
  }
  /** The world boxes changed after `since`, or undefined when a whole-map change intervened or the history expired. */
  changesSince(since: number): readonly Rect4[] | undefined {
    const current = this.value();
    if (!(since <= current) || current - since > KEPT - 1) return undefined;
    const out: Rect4[] = [];
    for (let r = since + 1; r <= current; r++) {
      const region = this.regions.get(r);
      if (!region) return undefined;
      out.push(...region);
    }
    return out;
  }
}

export class ContentRevision extends RegionalRevision {
  private ratio = 0;
  private complete = false;
  /** The look's programs are all ready (`complete`), noted after a program finished compiling. */
  noteLookComplete(complete: boolean): void {
    if (complete === this.complete) return;
    this.complete = complete;
    this.bump();
  }
  override value(): number {
    const ratio = liveStyleRatio();
    if (ratio !== this.ratio) {
      this.ratio = ratio;
      this.bump();
    }
    return super.value();
  }
}
