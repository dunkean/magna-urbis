/**
 * The camera of the 2D view across frames: moving, or at rest.
 *
 * The page asks for one frame per change of view. A gesture is a run of such frames; between two wheel steps, or just
 * after the last pan, the view has not moved but the gesture is not over. So the view counts as moving until SETTLE_MS
 * have passed without a change, and the picture at rest is made then: a callback armed during the gesture asks for
 * the frame that makes it, and that picture is owed (it counts as pending work) until the view says it is done.
 *
 * Used by the map view (v2/display/mapView.ts), which notes every frame, and by the composed and fallback views.
 */
import type { View } from '../../render/view';
import type { ViewFrame } from './contract';

/** A view stays `moving` this long after its last change. */
export const SETTLE_MS = 160;

export const sameFrame = (frame: ViewFrame | undefined, view: View, w: number, h: number, dpr: number): boolean => !!frame && frame.w === w && frame.h === h && frame.dpr === dpr && frame.view.cx === view.cx && frame.view.cy === view.cy && frame.view.scale === view.scale;

type MotionPhase = 'moving' | 'resting';

export class ViewMotion {
  /** The frame last asked for: one object, refilled in place. */
  private last?: ViewFrame;
  private movingUntil = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private owed = false;

  /** The frame last asked for (undefined before the first one). */
  get frame(): ViewFrame | undefined {
    return this.last;
  }
  /** Notes the frame asked for. True when it differs from the previous one: the camera moved or the view was resized. */
  note(view: View, w: number, h: number, dpr: number, now: number): boolean {
    const last = this.last;
    if (!last) {
      this.last = { view: { ...view }, w, h, dpr };
      return false;
    }
    if (sameFrame(last, view, w, h, dpr)) return false;
    last.view.cx = view.cx;
    last.view.cy = view.cy;
    last.view.scale = view.scale;
    last.w = w;
    last.h = h;
    last.dpr = dpr;
    this.movingUntil = now + SETTLE_MS;
    return true;
  }
  phase(now = performance.now()): MotionPhase {
    return now < this.movingUntil ? 'moving' : 'resting';
  }
  /** The picture at rest of the current view is still to be made. */
  get restOwed(): boolean {
    return this.owed;
  }
  /** Arms `rest` for the moment the view stops counting as moving. A frame that moved the view arms it again; the
   * other frames of the gesture (tiles arriving, layers reporting) leave the armed one alone. */
  awaitRest(now: number, moved: boolean, rest: () => void): void {
    if (this.owed && !moved && this.timer !== undefined) return;
    this.owed = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (this.owed) rest();
      },
      Math.max(1, this.movingUntil - now + 1),
    );
  }
  /** The picture at rest was made, or is no longer wanted (the view is hidden, a capture covers it). */
  restDone(): void {
    this.owed = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
