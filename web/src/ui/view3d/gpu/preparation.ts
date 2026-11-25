/**
 * Prepares the page's WebGPU device once (hardware adapter and stand-in pipelines) and creates WebGPU views. Called through ui/terrain3dGpu.ts by the renderer host and the pages.
 */
import { Terrain3d, type Terrain3dOptions } from '../../terrain3d';
import { Gpu3d, PREVIEW_GROUND } from './device';
import { SAMPLES } from './layouts';
import { Terrain3dGpu } from './view';

let shared: Promise<Gpu3d | undefined> | undefined;

let ready: Gpu3d | undefined;

/** Devices this module destroyed itself (refused during preparation): their loss is expected. */
const destroyedHere = new WeakSet<GPUDevice>();

/** Prepares the device, the modules and the stand-in pipelines once per page, and again after a device loss;
 * resolves whether the WebGPU 3D view is usable (no context is taken: a failure keeps the WebGL2 path). */
export function prepareTerrain3dGpu(forced: boolean): Promise<boolean> {
  shared ??= (async () => {
    if (!navigator.gpu) return undefined;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || (adapter.info?.isFallbackAdapter && !forced)) return undefined;
    const device = await adapter.requestDevice({ label: 'terrain 3d', requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } });
    try {
      const gpu = new Gpu3d(device);
      // Any other loss (driver reset, device.destroy() from outside) is recovered by the views
      // (terrain3dRenderer.ts): the next preparation creates a new device.
      device.lost.then(info => {
        gpu.lost = true;
        if (destroyedHere.has(device)) return;
        if (ready === gpu) {
          ready = undefined;
          shared = undefined;
        }
        console.warn(`WebGPU 3D device lost (${info.reason}): ${info.message}`);
        for (const listener of [...gpu.lostListeners]) listener();
      });
      device.addEventListener('uncapturederror', event => console.error('WebGPU 3D:', (event as GPUUncapturedErrorEvent).error.message));
      for (const [key, module] of Object.entries(gpu.modules)) {
        const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
        if (errors.length) throw new Error(`WGSL ${key}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
      }
      // Throws (GPUPipelineError) if the translated shaders or the layouts are refused.
      await Promise.all([1, SAMPLES].flatMap(samples => ['sky', 'map', PREVIEW_GROUND, 'buildingColor', 'buildingTex', 'tree', 'billboard'].map(key => gpu.adopt(key, samples))));
      if (gpu.lost) throw new Error('WebGPU : appareil perdu pendant la préparation de la vue 3D.');
      return (ready = gpu);
    } catch (error) {
      destroyedHere.add(device);
      device.destroy();
      throw error;
    }
  })().catch(error => {
    shared = undefined;
    throw error;
  });
  return shared.then(gpu => !!gpu);
}

/** The WebGPU 3D view on `canvas`, or undefined while (or when) prepareTerrain3dGpu has no device.
 * `onDeviceLost` is called once if its device is lost (the view then stops drawing). */
export function createTerrain3dGpu(canvas: HTMLCanvasElement, onChange: () => void, onRender?: () => void, options: Terrain3dOptions = {}, onDeviceLost?: () => void): Terrain3d | undefined {
  return ready && !ready.lost ? new Terrain3dGpu(canvas, ready, onChange, onRender, options, onDeviceLost) : undefined;
}
