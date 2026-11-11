/** Asynchronous alpha extraction for both render backends and CPU tree placement. */
export class TileWaterMask {
  private worker?: Worker;
  private serial = 0;
  private disposed = false;
  private pending = new Map<number, { resolve(alpha: Uint8Array): void; reject(error: Error): void }>();

  async read(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    if (this.disposed) throw new DOMException('Tile preparation cancelled', 'AbortError');
    if (!this.worker) {
      const worker = this.worker = new Worker(new URL('./tileWaterWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: number; alpha?: Uint8Array; error?: string }>): void => {
        const reply = event.data, request = this.pending.get(reply.id);
        this.pending.delete(reply.id);
        if (reply.alpha) request?.resolve(reply.alpha); else request?.reject(new Error(reply.error));
      };
      worker.onerror = (event): void => {
        for (const request of this.pending.values()) request.reject(new Error(event.message));
        this.pending.clear(); worker.terminate(); this.worker = undefined;
      };
    }
    // Snapshot before yielding: the caller may reuse its scratch canvas for the next tile.
    const bitmap = await createImageBitmap(canvas);
    if (this.disposed || !this.worker) { bitmap.close(); throw new DOMException('Tile preparation cancelled', 'AbortError'); }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ id, bitmap }, [bitmap]); }
      catch (error) { this.pending.delete(id); bitmap.close(); reject(error); }
    });
  }

  dispose(): void {
    this.disposed = true; this.worker?.terminate(); this.worker = undefined;
    for (const request of this.pending.values()) request.reject(new DOMException('Tile preparation cancelled', 'AbortError'));
    this.pending.clear();
  }
}
