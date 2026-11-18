/**
 * Material dimensions, memory accounting and edge padding for tile uploads in both backends.
 * Reads/writes: Reads image dimensions/pixels; creates local padded canvases and writes no shared state.
 */
export function materialSize(source: TexImageSource): { width: number; height: number } {
  const dimensions = source as { width?: number; naturalWidth?: number; videoWidth?: number; height?: number; naturalHeight?: number; videoHeight?: number };
  const width = dimensions.videoWidth || dimensions.naturalWidth || dimensions.width || 1;
  const height = dimensions.videoHeight || dimensions.naturalHeight || dimensions.height || width;
  return { width, height };
}

export function materialBytes(source: TexImageSource): number {
  const size = materialSize(source);
  let width = size.width + 2,
    height = size.height + 2,
    bytes = 0;
  for (;;) {
    bytes += width * height * 4;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
}

/** A material image with a duplicated one-texel border: every mip keeps a continuous edge; UVs
 * address the inner world rectangle rather than the added gutter. */
export function paddedMaterial(source: TexImageSource): HTMLCanvasElement {
  const { width, height } = materialSize(source);
  let drawable = source as CanvasImageSource;
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    const bitmap = document.createElement('canvas');
    bitmap.width = width;
    bitmap.height = height;
    bitmap.getContext('2d')!.putImageData(source, 0, 0);
    drawable = bitmap;
  }
  const padded = document.createElement('canvas');
  padded.width = width + 2;
  padded.height = height + 2;
  const context = padded.getContext('2d')!;
  context.drawImage(drawable, 1, 1, width, height);
  context.drawImage(drawable, 0, 0, width, 1, 1, 0, width, 1);
  context.drawImage(drawable, 0, height - 1, width, 1, 1, height + 1, width, 1);
  context.drawImage(padded, 1, 0, 1, height + 2, 0, 0, 1, height + 2);
  context.drawImage(padded, width, 0, 1, height + 2, width + 1, 0, 1, height + 2);
  return padded;
}
