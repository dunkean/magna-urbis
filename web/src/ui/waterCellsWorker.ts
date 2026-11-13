/// <reference lib="webworker" />
const sources = new Map<number, ImageBitmap>();
let bytes = 0;
const scratch = new OffscreenCanvas(1, 1), output = new OffscreenCanvas(1, 1);
const lc = scratch.getContext('2d', { willReadFrequently: true })!, oc = output.getContext('2d', { willReadFrequently: true })!;
self.onmessage = ({ data: m }: MessageEvent<{ id?: number; sourceId: number; bitmap?: ImageBitmap; sx: number; sy: number; sw: number; size: number }>): void => {
  if (m.bitmap) {
    sources.set(m.sourceId, m.bitmap); bytes += m.bitmap.width * m.bitmap.height * 4;
    while (bytes > 64 * 1024 * 1024 && sources.size > 1) {
      const [id, old] = sources.entries().next().value!; sources.delete(id); bytes -= old.width * old.height * 4; old.close();
    }
    return;
  }
  try {
    const source = sources.get(m.sourceId); if (!source) throw new Error('Source evicted');
    sources.delete(m.sourceId); sources.set(m.sourceId, source);
    const { sx, sy, sw, size } = m, cellPx = size / sw, q = Math.min(4, cellPx), margin = 2, low = Math.ceil((sw + 2 * margin) * q);
    scratch.width = scratch.height = low;
    lc.imageSmoothingEnabled = true; lc.filter = `blur(${(q * .5).toFixed(2)}px)`;
    lc.drawImage(source, sx - margin, sy - margin, sw + 2 * margin, sw + 2 * margin, 0, 0, low, low); lc.filter = 'none';
    const probe = lc.getImageData(0, 0, low, low).data;
    let wet = false; for (let i = 3; i < probe.length; i += 4) if (probe[i]) { wet = true; break; }
    const result = new OffscreenCanvas(size, size), ctx = result.getContext('2d')!;
    if (wet) {
      const full = Math.round((sw + 2 * margin) * cellPx), offset = Math.round(margin * cellPx);
      output.width = output.height = full;
      oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high'; oc.drawImage(scratch, 0, 0, full, full);
      const image = oc.getImageData(offset, offset, size, size), p = image.data, gain = Math.max(1, cellPx * 1.25);
      for (let i = 3; i < p.length; i += 4) { const a = p[i]; if (a !== 0 && a !== 255) p[i] = Math.max(0, Math.min(255, Math.round((a - 102) * gain + 128))); }
      ctx.putImageData(image, 0, 0);
    }
    const image = result.transferToImageBitmap(); self.postMessage({ id: m.id, image }, { transfer: [image] });
  } catch (error) { self.postMessage({ id: m.id, error: String(error instanceof Error ? error.message : error) }); }
};
export {};
