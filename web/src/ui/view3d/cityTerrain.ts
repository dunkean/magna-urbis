/**
 * Lazy city terrain backend creation, called by the mounted API.
 * Reads/writes: Reads canvas/options; writes terrain, software-material capability and error state on the supplied context, installing camera/render callbacks once.
 */
import { type Terrain3d } from '../terrain3d';
import { createTerrain3d } from '../terrain3dRenderer';
import type { City3dContext } from './cityContext';

export function ensureTerrain(cityContext: City3dContext): Terrain3d | undefined {
  if (cityContext.terrain || cityContext.error) return cityContext.terrain;
  try {
    cityContext.terrain = createTerrain3d(
      cityContext.canvas,
      () => {
        cityContext.updateInfo();
        cityContext.textOverlay.invalidate();
        cityContext.options.onCamera?.(cityContext.terrain!.getCamera());
        if (cityContext.options.details && !cityContext.detailFrame)
          cityContext.detailFrame = requestAnimationFrame(() => {
            cityContext.detailFrame = 0;
            cityContext.driveDetails();
          });
      },
      () => {
        cityContext.placeMarker();
        if (cityContext.waterShownDue && cityContext.active) {
          cityContext.waterShownDue = false;
          performance.mark('mu:water-3d-shown');
        }
      },
      { fastMapShader: cityContext.options.fastTerrain, navigation: cityContext.options.navigation, tileJobsPerFrame: 1, tileJobsConcurrent: 4, mergeOccupation: cityContext.options.mergeOccupation },
    );
    if (cityContext.options.softwareMaterialFallback) {
      const gl = cityContext.canvas.getContext('webgl2'),
        debug = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl && String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      cityContext.softwareMaterial = !!renderer && /swiftshader|llvmpipe|softpipe|software|warp|microsoft basic render/i.test(renderer);
    }
  } catch (e) {
    cityContext.error = e instanceof Error ? e.message : String(e);
    cityContext.info.textContent = cityContext.error;
  }
  return cityContext.terrain;
}
