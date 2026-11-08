"""Pack the Codex parchment symbol sheet into a 2-channel mask atlas (ink, wash) for canvas.ts.

The generated sheet has colour fringes in its soft alpha, so only masks are kept: ink = dark strokes, wash = pale fill.
RGB is dropped; the renderer tints both masks with the palette at draw time (seasons and biomes follow).
Usage: python -I web/scripts/pack_parchment_symbols.py <raw.png> <out.json> [<preview.png>]
"""
import base64, json, sys, zlib
import numpy as np
from PIL import Image

SIZE, GRID = 64, 4
raw, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(raw).convert('RGBA')).astype(np.float32)
h, w = im.shape[:2]
alpha = im[..., 3] / 255
lum = 0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]
ink = alpha * np.clip((150 - lum) / 70, 0, 1)
wash = np.clip(alpha - ink, 0, 1) * np.clip((lum - 120) / 50, 0, 1)
# Drop the faint speckle the generator scattered around some cells.
ink[ink < .08] = 0; wash[wash < .12] = 0
cells, boxes = [], []
for j in range(GRID):
    for i in range(GRID):
        y0, y1, x0, x1 = round(j * h / GRID), round((j + 1) * h / GRID), round(i * w / GRID), round((i + 1) * w / GRID)
        ci, cw = ink[y0:y1, x0:x1], wash[y0:y1, x0:x1]
        ys, xs = np.nonzero((ci > .25) | (cw > .35))
        # Bounding box from robust percentiles: stray specks do not widen the symbol.
        bx0, bx1 = np.percentile(xs, [.5, 99.5]); by0, by1 = np.percentile(ys, [.5, 99.5])
        cx, cy, side = (bx0 + bx1) / 2, (by0 + by1) / 2, max(bx1 - bx0, by1 - by0) * 1.08 + 4
        box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
        pair = []
        for ch in (ci, cw):
            pair.append(np.asarray(Image.fromarray((ch * 255).astype(np.uint8)).resize((SIZE, SIZE), Image.LANCZOS, box=box)))
        cells.append(np.stack(pair, -1))
        boxes.append(round(side / ((x1 - x0)), 3))
data = np.stack(cells).astype(np.uint8)  # cells, y, x, (ink, wash)
blob = base64.b64encode(zlib.compress(data.tobytes(), 9)).decode()
json.dump({'size': SIZE, 'cells': len(cells), 'channels': ['ink', 'wash'], 'extent': boxes, 'zlib': blob}, open(out, 'w'))
print('bytes', len(blob), 'extent', boxes)
if len(sys.argv) > 3:
    paper, inkc, washc = np.array([238, 226, 195.]), np.array([78, 59, 40.]), np.array([150, 150, 100.])
    sheet = np.zeros((SIZE * GRID, SIZE * GRID, 3))
    for k, c in enumerate(cells):
        a_i, a_w = c[..., 0:1] / 255, c[..., 1:2] / 255 * .55
        px = paper * (1 - a_w) + washc * a_w
        px = px * (1 - a_i) + inkc * a_i
        sheet[(k // GRID) * SIZE:(k // GRID + 1) * SIZE, (k % GRID) * SIZE:(k % GRID + 1) * SIZE] = px
    Image.fromarray(sheet.astype(np.uint8)).resize((SIZE * GRID * 3, SIZE * GRID * 3), Image.NEAREST).save(sys.argv[3])
