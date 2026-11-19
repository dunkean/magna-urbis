/**
 * Text-free map display lists for live overlay bands and world drape tiles (liveHost.ts). Names belong to the live
 * text layer: even a host's semantic painter must not bake Canvas text at a tile's scale. Other unsupported Canvas
 * calls still fail the recording normally. Exact captures and exports keep their ordinary recording context.
 */
import { RecordingCanvas } from '../gpu/recorder';

export function createMapRecording(width: number, height: number): RecordingCanvas {
  const canvas = new RecordingCanvas(width, height);
  const context = canvas.getContext('2d')!;
  context.fillText = context.strokeText = () => {};
  return canvas;
}
