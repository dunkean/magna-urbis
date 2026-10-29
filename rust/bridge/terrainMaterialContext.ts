/** Material rasters run both in workers and in the page (viewer and exports).
 * Some webviews expose WebGL2 only on HTMLCanvasElement, not OffscreenCanvas. */
export interface MaterialRasterContext {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}
export class MaterialRasterUnavailableError extends Error {
  constructor() {
    super('Le rendu des matériaux nécessite WebGL2, indisponible sur les canvas de ce navigateur. Les styles cartographiques restent disponibles.');
    this.name = 'MaterialRasterUnavailableError';
  }
}
const attributes: WebGLContextAttributes = { alpha: true, premultipliedAlpha: false, antialias: false };
export function createMaterialRasterContext(): MaterialRasterContext {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(1, 1), gl = canvas.getContext('webgl2', attributes);
      if (gl && !gl.isContextLost()) return { canvas, gl };
    } catch { /* WebGL may be available only on a page canvas. */ }
  }
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const gl = canvas.getContext('webgl2', attributes);
      if (gl && !gl.isContextLost()) return { canvas, gl };
    } catch { /* Report one capability error after both supported paths. */ }
  }
  throw new MaterialRasterUnavailableError();
}
