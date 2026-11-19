/**
 * Text-free map display lists for live overlay bands and world drape tiles (liveHost.ts). Names belong to the live
 * text layer: even a host's semantic painter must not bake Canvas text at a tile's scale. Other unsupported Canvas
 * calls still fail the recording normally. Exact captures and exports keep their ordinary recording context.
 */
import { RecordingCanvas } from '../gpu/recorder';

const retainedInk = new WeakSet<object>();
export const hasRetainedInk = (context: object): boolean => retainedInk.has(context);

export function createMapRecording(width: number, height: number, ink = false): RecordingCanvas {
  const canvas = new RecordingCanvas(width, height);
  const context = canvas.getContext('2d')!;
  if (ink) retainedInk.add(context);
  context.fillText = context.strokeText = () => {};
  return canvas;
}
