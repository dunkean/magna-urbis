"""Pack the Codex parchment tree sheet (black ink on white, 6x6 cells) into a 2-channel mask atlas for canopy.ts.

ink  = darkness of the engraved strokes; fill = the crown area (inside the outline), found by filling the holes of the
slightly closed ink mask. RGB is dropped: the renderer tints both masks with the palette (wash, ink, shading).
Usage: python -I web/scripts/pack_parchment_trees.py <raw.png> <out.json> [<preview.png>]
"""
import base64, json, sys, zlib
import numpy as np
from PIL import Image
from scipy import ndimage

SIZE, GRID = 96, 6
raw, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(raw).convert('RGBA')).astype(np.float32)
alpha = im[..., 3] / 255
lum = (0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]) * alpha + 255 * (1 - alpha)
ink_all = np.clip((215 - lum) / 150, 0, 1)
h, w = lum.shape
cells, extents = [], []
for j in range(GRID):
    for i in range(GRID):
        y0, y1, x0, x1 = round(j * h / GRID), round((j + 1) * h / GRID), round(i * w / GRID), round((i + 1) * w / GRID)
        ink = ink_all[y0:y1, x0:x1].copy()
        solid = ink > .35
        # Keep the main symbol only: drop specks far from the largest connected strokes.
        lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=4))
        if n > 1:
            sizes = ndimage.sum(solid, lab, range(1, n + 1))
            keep = np.isin(lab, [k + 1 for k, s in enumerate(sizes) if s >= .08 * sizes.max()])
            ink[~keep] = 0; solid &= keep
        closed = ndimage.binary_closing(solid, iterations=3)
        fill = ndimage.binary_fill_holes(closed).astype(np.float32)
        fill = ndimage.gaussian_filter(fill, .8)
        ys, xs = np.nonzero(solid | (fill > .5))
        bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
        cx, cy, side = (bx0 + bx1) / 2, (by0 + by1) / 2, max(bx1 - bx0, by1 - by0) * 1.06 + 4
        pad = int(side)  # the square box may run past the cell: pad with empty pixels
        box = (cx - side / 2 + pad, cy - side / 2 + pad, cx + side / 2 + pad, cy + side / 2 + pad)
        pair = [np.asarray(Image.fromarray((np.pad(np.clip(ch, 0, 1), pad) * 255).astype(np.uint8)).resize((SIZE, SIZE), Image.LANCZOS, box=box)) for ch in (ink, fill)]
        cells.append(np.stack(pair, -1))
        extents.append([round(float((bx1 - bx0) / side), 3), round(float((by1 - by0) / side), 3)])
data = np.stack(cells).astype(np.uint8)
blob = base64.b64encode(zlib.compress(data.tobytes(), 9)).decode()
json.dump({'size': SIZE, 'cells': len(cells), 'channels': ['ink', 'fill'], 'extent': extents, 'zlib': blob}, open(out, 'w'))
print('bytes', len(blob))
if len(sys.argv) > 3:
    paper, inkc, washc = np.array([238, 226, 195.]), np.array([60, 58, 34.]), np.array([110, 120, 72.])
    sheet = np.zeros((SIZE * GRID, SIZE * GRID, 3))
    for k, c in enumerate(cells):
        a_i, a_f = c[..., 0:1] / 255, c[..., 1:2] / 255 * .85
        px = paper * (1 - a_f) + washc * a_f
        px = px * (1 - a_i) + inkc * a_i
        sheet[(k // GRID) * SIZE:(k // GRID + 1) * SIZE, (k % GRID) * SIZE:(k % GRID + 1) * SIZE] = px
    Image.fromarray(sheet.astype(np.uint8)).resize((SIZE * GRID * 2, SIZE * GRID * 2), Image.NEAREST).save(sys.argv[3])
