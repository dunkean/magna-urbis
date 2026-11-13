/** Worker-owned smoothing/thresholding. Sources are immutable display products, registered
 * once; only a tile-sized bitmap returns to the page. No main-thread pixel readbacks. */
export class WaterCellPainter {
  private worker?: Worker;
  private sources = new WeakMap<object, Promise<number>>();
  private serial = 0;
  private disposed = false;
  private pending = new Map<number, { resolve(value: ImageBitmap): void; reject(error: Error): void }>();
  private ensure(): Worker {
    if (this.disposed) throw new DOMException('Water painting cancelled', 'AbortError');
    if (this.worker) return this.worker;
    const worker = this.worker = new Worker(new URL('./waterCellsWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; image?: ImageBitmap; error?: string }>) => {
      const request = this.pending.get(data.id); this.pending.delete(data.id);
      if (data.image) { if (request) request.resolve(data.image); else data.image.close(); }
      else request?.reject(new Error(data.error));
    };
    worker.onerror = event => {
      for (const request of this.pending.values()) request.reject(new Error(event.message));
      this.pending.clear(); worker.terminate(); this.worker = undefined; this.sources = new WeakMap();
    };
    return worker;
  }
  async draw(target: CanvasRenderingContext2D, source: CanvasImageSource & { width: number }, sx: number, sy: number, sw: number, size: number): Promise<void> {
    if (size / sw < 1.5) { target.drawImage(source, sx, sy, sw, sw, 0, 0, size, size); return; }
    const worker = this.ensure();
    let registration = this.sources.get(source);
    if (!registration) {
      const sourceId = ++this.serial;
      registration = createImageBitmap(source).then(bitmap => {
        if (this.disposed || this.worker !== worker) { bitmap.close(); throw new DOMException('Water painting cancelled', 'AbortError'); }
        worker.postMessage({ sourceId, bitmap }, [bitmap]); return sourceId;
      });
      this.sources.set(source, registration);
      void registration.catch(() => this.sources.delete(source));
    }
    const sourceId = await registration, id = ++this.serial;
    if (this.disposed) throw new DOMException('Water painting cancelled', 'AbortError');
    let image: ImageBitmap;
    try {
      image = await new Promise<ImageBitmap>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.postMessage({ id, sourceId, sx, sy, sw, size });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Source evicted') {
        this.sources.delete(source); return this.draw(target, source, sx, sy, sw, size);
      }
      throw error;
    }
    try { const smooth = target.imageSmoothingEnabled; target.imageSmoothingEnabled = false; target.drawImage(image, 0, 0); target.imageSmoothingEnabled = smooth; }
    finally { image.close(); }
  }
  dispose(): void {
    this.disposed = true; this.worker?.terminate(); this.worker = undefined;
    for (const request of this.pending.values()) request.reject(new DOMException('Water painting cancelled', 'AbortError'));
    this.pending.clear(); this.sources = new WeakMap();
  }
}
