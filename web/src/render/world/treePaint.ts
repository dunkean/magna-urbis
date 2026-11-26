/** Read the already styled colour of a tree's painted crown from a resident ground tile. */
export const TREE_PAINT_PAGES = 4;
export interface TreePaintPage {
  colour: WebGLTexture;
  crowns: WebGLTexture;
}
export interface TreePaintSource {
  revision(): number;
  /** Fill xy with texel coordinates and pack the crown radius in texels with its page and layer in z. */
  locate(x: number, y: number, radius: number, pages: TreePaintPage[], target: Float32Array, offset: number): boolean;
}
