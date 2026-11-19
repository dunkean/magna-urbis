/** Source-level coast ABI used by the terrain bridges. Keep calls typed independently of generated WASM declarations, which are refreshed only when the engine is rebuilt. */
import type { CoastProfile } from './terrainCoastProfile';

interface CoastEngine {
  set_coast(mask: number, mode: string, profile?: string): void;
  configure_coast(mask: number, mode: string, profile?: string): void;
}
interface CoastPipeline {
  cut_coast(mask: number, mode: string, profile?: string): void;
}
interface CoastFieldCutter {
  cut_field(seed: string, width: number, motif: number, amplitude: number, mask: number, mode: string, n: number, origin: number, cell: number, heights: Float32Array, profile?: string): Float32Array;
}

export function setEngineCoast(engine: CoastEngine, mask: number, mode: string, profile: CoastProfile): void {
  engine.set_coast(mask, mode, JSON.stringify(profile));
}
export function configureEngineCoast(engine: CoastEngine, mask: number, mode: string, profile: CoastProfile): void {
  engine.configure_coast(mask, mode, JSON.stringify(profile));
}
export function cutPipelineCoast(pipeline: CoastPipeline, mask: number, mode: string, profile: CoastProfile): void {
  pipeline.cut_coast(mask, mode, JSON.stringify(profile));
}
export function cutCoastField(cutter: CoastFieldCutter, seed: string, width: number, motif: number, amplitude: number, mask: number, mode: string, n: number, origin: number, cell: number, heights: Float32Array, profile: CoastProfile): Float32Array {
  return cutter.cut_field(seed, width, motif, amplitude, mask, mode, n, origin, cell, heights, JSON.stringify(profile));
}
