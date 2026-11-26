/**
 * WebGL context loss policy of the map renderer (TerrainGl). A context is lost when the driver resets the GPU
 * (Windows TDR during a long ANGLE/D3D shader compile or link), runs out of memory, or when the browser evicts
 * the oldest of too many contexts. The renderer keeps every CPU input, so a restored context is rebuilt in place:
 * - first loss: restore and retry the same look (a transient reset);
 * - second loss: restore in the light profile (no forest pass, simpler Render v2 variant, textures capped at
 *   LIGHT_TEXTURE_CAP) and tell the user once (MAP_GPU_LIGHTER_EVENT);
 * - third loss, or no `webglcontextrestored` within RESTORE_TIMEOUT_MS: failed. The renderer then throws
 *   MapContextLostError and the page leaves the GPU ground for a CPU-drawn cartographic map.
 * Pure state: no WebGL here, so the policy is unit tested (tests/glContextRecovery.test.ts).
 */
export type GlRecoveryStage = 'full' | 'retry' | 'light' | 'failed';

/** How long a lost context may wait for `webglcontextrestored` before the renderer gives up. */
export const RESTORE_TIMEOUT_MS = 6000;
/** Largest world raster side in the light profile and on low-end devices. */
export const LIGHT_TEXTURE_CAP = 2048;
/** Window event dispatched once when the map switches to the light profile (detail: { stage }). */
export const MAP_GPU_LIGHTER_EVENT = 'mu-map-gpu-lighter';
/** Window event dispatched when a live map context is lost for good (the page re-renders: MapContextLostError path). */
export const MAP_GPU_FAILED_EVENT = 'mu-map-gpu-failed';
export const MAP_GPU_LIGHTER_MESSAGE = 'Your graphics card ran out of resources for the satellite view; switched to a lighter view.';
export const MAP_GPU_FAILED_MESSAGE = 'Your graphics card could not keep the satellite view; switched to the parchment map.';

/** The map's WebGL context was lost for good (no restore, or lost again in the light profile). */
export class MapContextLostError extends Error {
  /** `final`: the GPU map is given up (the page switches to a CPU-drawn cartographic style). */
  constructor(
    message = MAP_GPU_FAILED_MESSAGE,
    readonly final = false,
    readonly preserveStyle = false,
  ) {
    super(message);
    this.name = 'MapContextLostError';
  }
}
export const isMapContextLost = (error: unknown): boolean => error instanceof Error && error.name === 'MapContextLostError';

export class GlContextRecovery {
  stage: GlRecoveryStage = 'full';
  /** Losses seen so far. */
  losses = 0;
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  waiting = false;
  private notified = false;
  constructor(startLight = false) {
    if (startLight) this.stage = 'light';
  }
  /** The light profile is active (after a second loss, or chosen up front). */
  get light(): boolean {
    return this.stage === 'light';
  }
  get failed(): boolean {
    return this.stage === 'failed';
  }
  /** On `webglcontextlost`. Returns whether to call preventDefault() and wait for a restore. */
  lost(): boolean {
    if (this.stage === 'failed') return false;
    this.losses++;
    this.waiting = true;
    this.stage = this.losses === 1 && this.stage === 'full' ? 'retry' : this.stage === 'light' && this.losses > 1 ? 'failed' : 'light';
    if (this.stage === 'failed') this.waiting = false;
    return this.stage !== 'failed';
  }
  /** On `webglcontextrestored`. Returns whether the renderer must now enter the light profile (once). */
  restored(): boolean {
    if (this.stage === 'failed') return false;
    this.waiting = false;
    if (this.stage === 'light' && !this.notified) {
      this.notified = true;
      return true;
    }
    return false;
  }
  /** No restore arrived in time. */
  expired(): void {
    if (this.waiting) {
      this.waiting = false;
      this.stage = 'failed';
    }
  }
}

/** Low-end GPU hints: little device memory, an integrated (memory shared with the system: Intel, Mesa) or
 * software renderer. A Mesa/Intel driver under Chrome runs with `exit_on_context_lost`: an out-of-memory or a
 * too-heavy shader makes the whole GPU process exit, every context of the page is lost at once. */
export function lowEndGpu(renderer: string, deviceMemory?: number): boolean {
  return (deviceMemory !== undefined && deviceMemory <= 4) || /swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa|intel(?!.*\barc\b)|mali|adreno|powervr/i.test(renderer);
}

/** Largest side of a world raster texture: the device limit, LIGHT_TEXTURE_CAP on low-end devices or in the light profile. */
export function textureCap(maxTextureSize: number, light: boolean): number {
  const limit = Math.max(1, maxTextureSize || LIGHT_TEXTURE_CAP);
  return light ? Math.min(limit, LIGHT_TEXTURE_CAP) : limit;
}

/** Page-wide map GPU profile, shared by the WebGL2 and WebGPU map renderers: a loss on one backend (often the
 * whole GPU process) makes the other start light too. */
const profile = { renderer: '', light: false };
/** The map context's renderer string (WEBGL_debug_renderer_info), once known. */
export function noteMapRenderer(name: string): void {
  if (name) profile.renderer = name;
}
export function mapGpuLowEnd(): boolean {
  const memory = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return lowEndGpu(profile.renderer, memory);
}
export function mapGpuLight(): boolean {
  return profile.light;
}
/** Switches the page's map renderers to the light profile; tells the page once (MAP_GPU_LIGHTER_EVENT). */
export function enterMapGpuLight(): void {
  if (profile.light) return;
  profile.light = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MAP_GPU_LIGHTER_EVENT, { detail: { stage: 'light' } }));
}
/** Tests only. */
export function resetMapGpuProfile(): void {
  profile.renderer = '';
  profile.light = false;
}
/** Raster texture cap of the map renderers: light profile or low-end GPU → LIGHT_TEXTURE_CAP. */
export function mapTextureCap(maxTextureSize: number): number {
  return textureCap(maxTextureSize, profile.light || mapGpuLowEnd());
}

/** A square RGBA8 raster (and same-grid companions) box-halved until its side fits `cap`. Rasters that already
 * fit are returned as is. Only for continuous fields (forest cover, height, tone), never for encoded classes. */
export function capRgbaRaster<T extends { n: number; rgba: Uint8Array }>(raster: T, cap: number, companions: (Uint8Array | undefined)[] = []): { raster: T; companions: (Uint8Array | undefined)[] } {
  let n = raster.n,
    rgba = raster.rgba,
    others = companions;
  while (n > cap && n % 2 === 0) {
    const half = n / 2,
      halve = (source: Uint8Array): Uint8Array => {
        const out = new Uint8Array(half * half * 4);
        for (let y = 0; y < half; y++)
          for (let x = 0; x < half; x++)
            for (let c = 0; c < 4; c++) {
              const a = (2 * y * n + 2 * x) * 4 + c,
                b = a + n * 4;
              out[(y * half + x) * 4 + c] = (source[a] + source[a + 4] + source[b] + source[b + 4] + 2) >> 2;
            }
        return out;
      };
    rgba = halve(rgba);
    others = others.map(o => o && halve(o));
    n = half;
  }
  if (n === raster.n) return { raster, companions };
  return { raster: { ...raster, n, rgba }, companions: others };
}
