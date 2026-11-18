/**
 * When the vector rasterizers read the WebGL error flags. Reading them is a synchronous round trip: the page waits
 * until the graphics process has run everything queued, this replay and any other canvas's work. The flags are
 * sticky, so an error still reaches the caller when they are read later. Two policies:
 * - `SampledErrorRead` (tile rasterizer, tileRasterizer.ts): the first replays of a context read at once (a broken
 *   program or state shows at once), then at most once per interval: an error is thrown one interval late at most.
 * - `IdleErrorRead` (live rasterizer, liveRasterizer.ts): never in a frame. A live replay runs in every frame of a
 *   moving view and in the frames a view rests on, when the graphics process is busiest (the town plan, the ground):
 *   a read there waited for all of that, up to a second. A timer reads once the replays have stopped; an error it
 *   finds is thrown by the next replay.
 */
import { GpuRasterError } from './displayList';

/** Replays of a context that read the GL error flags at once, and the longest time between two reads afterwards (ms). */
const ERROR_READ_FIRST = 2,
  ERROR_READ_MS = 2000;
/** Live replays read the flags only once no replay has run for this long (the view rests, nothing repaints). */
const ERROR_IDLE_MS = 1500;

export class SampledErrorRead {
  private replays = 0;
  private lastRead = 0;
  /** After a replay that started at `start`: reads the flags when due and throws on an error. True when it read. */
  check(gl: WebGL2RenderingContext, start: number, lost: boolean): boolean {
    const first = this.replays++ < ERROR_READ_FIRST;
    if (!first && start - this.lastRead < ERROR_READ_MS) return false;
    this.lastRead = start;
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new GpuRasterError(`Vector WebGL2 error 0x${error.toString(16)}`, lost);
    return true;
  }
}

export class IdleErrorRead {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private found: string | undefined;
  /** Before a replay: throws the error the last idle read found. */
  throwFound(lost: boolean): void {
    if (!this.found) return;
    const message = this.found;
    this.found = undefined;
    throw new GpuRasterError(message, lost);
  }
  /** After a replay: reads the flags once no replay has run for a while. */
  schedule(gl: WebGL2RenderingContext, lost: () => boolean): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (lost()) return;
      const error = gl.getError();
      if (error !== gl.NO_ERROR) this.found = `Vector WebGL2 error 0x${error.toString(16)}`;
    }, ERROR_IDLE_MS);
  }
  /** Stops the pending read and forgets a found error (disposal, lost context). */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.found = undefined;
  }
}
