/**
 * The canvas a replacement backend draws into (a canvas keeps its first context): laid exactly over the owner's,
 * which keeps the input, focus and status attributes. Used by the renderer host.
 */
/** A drawing canvas laid exactly over the owner's element (same offset parent, box and stacking), without
 * pointer events: the element underneath keeps the input. It follows the element's box and visibility. */
export class Overlay {
  readonly canvas = document.createElement('canvas');
  private readonly sizes = new ResizeObserver(() => this.sync());
  private readonly attributes = new MutationObserver(() => this.sync());
  constructor(private readonly element: HTMLElement) {
    const canvas = this.canvas;
    canvas.dataset.terrain3dSurface = '';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.tabIndex = -1;
    Object.assign(canvas.style, { position: 'absolute', right: 'auto', bottom: 'auto', margin: '0', padding: '0', border: '0', pointerEvents: 'none', visibility: 'hidden' });
    element.after(canvas);
    this.sizes.observe(element);
    this.attributes.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    // The owner may watch the restoration of a WebGL2 context on its element (terrainbench).
    canvas.addEventListener('webglcontextrestored', () => element.dispatchEvent(new Event('webglcontextrestored')));
    this.sync();
  }
  show(): void {
    this.canvas.style.visibility = '';
  }
  sync(): void {
    const element = this.element,
      style = this.canvas.style;
    if (!element.isConnected || !element.getClientRects().length) {
      style.display = 'none';
      return;
    }
    Object.assign(style, { display: 'block', left: `${element.offsetLeft + element.clientLeft}px`, top: `${element.offsetTop + element.clientTop}px`, width: `${element.clientWidth}px`, height: `${element.clientHeight}px`, zIndex: getComputedStyle(element).zIndex });
  }
  dispose(): void {
    this.sizes.disconnect();
    this.attributes.disconnect();
    this.canvas.remove();
  }
}
