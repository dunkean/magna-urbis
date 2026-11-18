/**
 * The CPU inputs a TerrainGpu retains to rebuild its GPU state after a device loss, or to hand it to the TerrainGl it
 * falls back to after a definitive loss; replayed through the public setters.
 */
import type { ForestField, ForestOccupation } from '../../../../../rust/bridge/terrainForest';
import type { TerrainRenderer } from '../../terrainRenderer';
import type { HeightLayer, OverlayLayer, RetainedWaterOptions, TerrainLook, ViewState, WaterLayer } from '../types';

export interface RendererInputs {
  look?: TerrainLook;
  view?: ViewState;
  base?: HeightLayer;
  details: HeightLayer[];
  enhanced: HeightLayer[];
  retainedWater?: { svg: string; width: number; options?: RetainedWaterOptions };
  water?: WaterLayer;
  overlay?: OverlayLayer;
  forest?: ForestField;
  occupation?: ForestOccupation;
}

/** Replays retained inputs through the public setters (look first: setWater reads its map width). */
export function replayInputs(target: TerrainRenderer, inputs: RendererInputs): void {
  if (inputs.look) target.setLook(inputs.look);
  if (inputs.base) target.setBase(inputs.base);
  for (const layer of inputs.details) target.setDetail(layer);
  for (const layer of inputs.enhanced) target.setEnhancedDetail(layer);
  target.setRetainedWater(inputs.retainedWater?.svg, inputs.retainedWater?.width, inputs.retainedWater?.options);
  target.setWater(inputs.water);
  target.setOverlay(inputs.overlay);
  target.setForest(inputs.forest, inputs.occupation);
  if (inputs.view) target.setView(inputs.view.view, inputs.view.width, inputs.view.height);
}
