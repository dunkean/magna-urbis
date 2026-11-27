import type { View } from '../render/view';
import type { SavedCityView } from './cityEmbedCache';
import { positionCityPicture } from './cityEmbedFrame';

/** A cached frame stays in map coordinates until the live renderer takes over on navigation. */
export async function savedCityRenderer(saved: SavedCityView) {
  const image = await createImageBitmap(saved.image);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;width:${saved.width}px;height:${saved.height}px;pointer-events:none`;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  image.close();
  const frame = { view: saved.view, w: saved.width, h: saved.height, dpr: 1 };
  return {
    element: canvas,
    drawLive(view: View, width: number, height: number, dpr: number) {
      positionCityPicture(canvas, frame, { view, w: width, h: height, dpr });
    },
    dispose() {
      canvas.remove();
    },
  };
}
