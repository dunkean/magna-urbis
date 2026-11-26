import type { View } from '../render/view';
import type { SavedCityView } from './cityEmbedCache';

/** A cached frame stays in map coordinates until the live renderer takes over on navigation. */
export async function savedCityRenderer(saved: SavedCityView) {
  const image = await createImageBitmap(saved.image);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
  return {
    element: canvas,
    drawLive(view: View, width: number, height: number, dpr: number) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d')!;
      const scale = view.scale / saved.view.scale;
      const w = saved.width * scale,
        h = saved.height * scale;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(image, (width - w) / 2 + (saved.view.cx - view.cx) * view.scale, (height - h) / 2 + (saved.view.cy - view.cy) * view.scale, w, h);
    },
    dispose() {
      image.close();
      canvas.remove();
    },
  };
}
