import { renderSvg } from '../render/svg';
import type { World } from '../gen/types';
import type { RenderOptions } from '../render/svg';
import type { BrushSources } from '../render/brushes';
import { svgOptionsForDisplay, type V2ExportDisplay } from './appearance';
const ctx = self as unknown as Worker;
ctx.onmessage = ({ data }: MessageEvent<{ id: number; world: World; options: RenderOptions; display?: Partial<V2ExportDisplay>; brushes?: BrushSources }>) => {
  try { ctx.postMessage({ id: data.id, blob: new Blob([renderSvg(data.world, svgOptionsForDisplay(data.options, data.display, data.brushes))], { type: 'image/svg+xml' }) }); }
  catch (error) { ctx.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
