/**
 * The painted brush images of the cartography (render/assets/brushAssets.ts), decoded once for the page and loaded
 * only when a painted look asks for them. Used by the cartography pass and by the page's Canvas renderer (v2/client.ts).
 */
import { decodeBrushes, type BrushImages } from '../../render/brushes';

let brushes: Promise<BrushImages | null> | undefined;

export async function paintedBrushes(): Promise<BrushImages | null> {
  return (brushes ??= import('../../render/assets/brushAssets').then(({ BRUSH_SOURCES }) => decodeBrushes(BRUSH_SOURCES)));
}
