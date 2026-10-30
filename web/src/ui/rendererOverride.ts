/**
 * `?renderer=webgl|webgpu`: forces the map and 3D view backends (terrainRenderer.ts, terrain3dRenderer.ts).
 * Read once, when the page loads: the benches rewrite their query afterwards (saved state, decor loads),
 * and the override holds for the session. Reloads that rebuild the query (openBench, situations, the
 * benches' saved URL) put it back with keepRendererOverride.
 */
export type RendererOverride = 'webgl' | 'webgpu';

const initial = ((): RendererOverride | undefined => {
  const value = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('renderer');
  return value === 'webgl' || value === 'webgpu' ? value : undefined;
})();

/** The backend forced by the page URL at load, if any. */
export function rendererOverride(): RendererOverride | undefined { return initial; }

/** Carries the page's renderer override into a query built from scratch. */
export function keepRendererOverride(params: URLSearchParams): URLSearchParams {
  if (initial) params.set('renderer', initial);
  return params;
}
