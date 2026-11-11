/** Readback belongs to a worker's private raster, never the display canvas/GPU queue. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>): void => {
  const { id, bitmap } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    scope.postMessage({ id, alpha }, [alpha.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  } finally { bitmap.close(); }
};
export {};
