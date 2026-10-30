/**
 * Map renderer selection: WebGPU (terrainGpu.ts) when the browser gives a hardware adapter, a device and
 * the preview pipeline, otherwise WebGL2 (TerrainGl). On Windows, Chrome and Edge run WebGL on
 * ANGLE/D3D11, whose HLSL compiler takes 10 to 40 s on the natural looks; WGSL skips that step.
 * `?renderer=webgl` forces WebGL2, `?renderer=webgpu` forces WebGPU (an error if it is unavailable).
 * The decision is taken before any context is created on the canvas: a canvas keeps its first context.
 * A lost WebGPU device is recreated by the renderer itself; if that fails it continues on WebGL2
 * (terrainGpu.ts).
 */
import { TerrainGl } from './terrainGl';

/** Public surface shared by both map renderers (TerrainGl's). */
export type TerrainRenderer = Pick<TerrainGl,
  'setBase' | 'setDetail' | 'setRenderV2Season' | 'setLook' | 'setEnhancedDetail' | 'setRetainedWater' | 'setWater' | 'setOverlay'
  | 'setView' | 'setForest' | 'captureMap' | 'redrawForCapture' | 'captureRegion' | 'captureWaterMask' | 'createSurfaceSampler'
  | 'heightAt' | 'variantReady' | 'dispose' | 'drawMs'>;

export type TerrainBackend = 'webgl' | 'webgpu';

/** The backend forced by the page URL, if any. */
export function requestedTerrainBackend(): TerrainBackend | undefined {
  const value = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('renderer');
  return value === 'webgl' || value === 'webgpu' ? value : undefined;
}

/** A map renderer drawing into `canvas`. When `canvas` already carries a WebGL2 context (shared with
 * another user), pass a fresh `webgpuCanvas`: the WebGPU renderer then draws there (terrainRendererCanvas). */
export async function createTerrainRenderer(canvas: HTMLCanvasElement, webgpuCanvas: HTMLCanvasElement = canvas): Promise<TerrainRenderer> {
  const requested = requestedTerrainBackend();
  if (requested !== 'webgl' && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const { createTerrainGpu } = await import('./terrainGpu');
      const renderer = await createTerrainGpu(webgpuCanvas, requested === 'webgpu', canvas);
      if (renderer) return renderer;
    } catch (error) {
      if (requested === 'webgpu') throw error;
      console.warn('WebGPU map renderer unavailable, using WebGL2:', error);
    }
  }
  if (requested === 'webgpu') throw new Error('WebGPU indisponible pour la carte (?renderer=webgpu).');
  return new TerrainGl(canvas);
}

/** The canvas a renderer draws into: TerrainGl's own, or the WebGPU renderer's. */
export function terrainRendererCanvas(renderer: TerrainRenderer, glCanvas: HTMLCanvasElement): HTMLCanvasElement {
  return renderer instanceof TerrainGl ? glCanvas : (renderer as { canvas?: HTMLCanvasElement }).canvas ?? glCanvas;
}

/** Which backend a renderer uses (for status lines); a WebGPU renderer reports WebGL2 after a definitive
 * device loss, when it forwards to a TerrainGl. */
export function terrainRendererBackend(renderer: TerrainRenderer): TerrainBackend {
  return renderer instanceof TerrainGl ? 'webgl' : (renderer as { backend?: TerrainBackend }).backend ?? 'webgpu';
}
