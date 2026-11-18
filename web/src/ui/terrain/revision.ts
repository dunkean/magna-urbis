/**
 * contentRevision() of a ground renderer (contract GroundTileRenderer, render/live/contract.ts): changes whenever
 * renderWorldTile would draw other pixels. Bumped by every input that changes the pixels, by the style pixel ratio
 * (the window moved to another screen), and when the look's own programs become complete (only when "complete"
 * flips: a speculative program finishing changes nothing). setView never bumps it.
 */
import { liveStyleRatio } from './redraw';

/** What an input setter changed: nothing, only the need to draw again, or the pixels (a revision bump). */
export type InputChange = 'none' | 'redraw' | 'content';

export class ContentRevision {
  private revision = 0;
  private ratio = 0;
  private complete = false;
  bump(): void {
    this.revision++;
  }
  /** The look's programs are all ready (`complete`), noted after a program finished compiling. */
  noteLookComplete(complete: boolean): void {
    if (complete === this.complete) return;
    this.complete = complete;
    this.revision++;
  }
  value(): number {
    const ratio = liveStyleRatio();
    if (ratio !== this.ratio) {
      this.ratio = ratio;
      this.revision++;
    }
    return this.revision;
  }
}
