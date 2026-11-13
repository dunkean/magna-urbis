/** Decode vectors once into a bounded CPU bitmap. Drawing the decoded SVG directly
 * lets Chrome replay its entire vector display list at every destination scale. */
/** `svg` may be given as Blob parts: a large body encoded once (Uint8Array) is then never re-encoded per view. */
export async function rasterizeSvg(svg: string | readonly BlobPart[], maxSide = 8192): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob(typeof svg === 'string' ? [svg] : [...svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('SVG raster allocation failed');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}
