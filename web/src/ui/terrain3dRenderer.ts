/**
 * 3D view backend selection: WebGPU (terrain3dGpu.ts) when the browser gives a hardware adapter, a device
 * and the stand-in pipelines, otherwise WebGL2 (Terrain3d). Same rationale and URL override as the map
 * (terrainRenderer.ts): `?renderer=webgl` forces WebGL2, `?renderer=webgpu` forces WebGPU.
 * The construction sites are synchronous and a canvas keeps its first context, so the WebGPU device is
 * prepared when this module loads; a view created before it is ready uses WebGL2 (unless forced).
 */
import { Terrain3d, type Terrain3dOptions } from './terrain3d';

export type Terrain3dBackend = 'webgl' | 'webgpu';
type GpuModule = typeof import('./terrain3dGpu');

/** The backend forced by the page URL, if any (the map's `renderer` parameter), read once: pages rewrite
 * their query later (decor loads) and the choice holds for the session. */
const forcedBackend = ((): Terrain3dBackend | undefined => {
  const value = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('renderer');
  return value === 'webgl' || value === 'webgpu' ? value : undefined;
})();
const requested = (): Terrain3dBackend | undefined => forcedBackend;

let gpuModule: GpuModule | undefined;
let state: 'off' | 'pending' | 'ready' | 'failed' = 'off';
let preparing: Promise<void> = Promise.resolve();
if (requested() !== 'webgl' && typeof navigator !== 'undefined' && navigator.gpu) {
  state = 'pending';
  preparing = import('./terrain3dGpu')
    .then(async module => { if (await module.prepareTerrain3dGpu(requested() === 'webgpu')) { gpuModule = module; state = 'ready'; } else state = 'failed'; })
    .catch(error => { state = 'failed'; console.warn('WebGPU 3D view unavailable, using WebGL2:', error); });
}

/** Resolves once the WebGPU device is prepared or refused (for pages that can wait before creating a view). */
export function terrain3dBackendReady(): Promise<void> { return preparing; }

/** A 3D view on `canvas` (Terrain3d's constructor arguments), WebGPU when prepared, else WebGL2. */
export function createTerrain3d(canvas: HTMLCanvasElement, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}): Terrain3d {
  const forced = requested();
  const view = forced !== 'webgl' ? gpuModule?.createTerrain3dGpu(canvas, onChange, onRender, options) : undefined;
  if (view) return view;
  if (forced === 'webgpu') throw new Error(state === 'pending' ? 'WebGPU 3D en préparation : réessayez dans un instant.' : 'WebGPU indisponible pour la vue 3D (?renderer=webgpu).');
  const fallback = new Terrain3d(canvas, onChange, onRender, options);
  canvas.dataset.renderer = 'webgl';
  return fallback;
}
