"""Pack a 4x4 source brush atlas into a runtime sheet and its manifest entry.

Usage: python -I pack_runtime.py <family> <source.png> [--color-only]
       python -I pack_runtime.py --singles <family> <one.png> <two.png> ...

`--singles` packs large single-subject colour images (massifs, downs): each is cropped to its alpha bound and kept
at high resolution (colour cells up to SINGLE_WIDTH px wide, the derived ink half at half that), shelf-packed.

A regular atlas holds eight ink cells (rows 0-1) then eight colour cells (rows 2-3).
`--color-only` atlases (16 colour cells) get a derived ink half: grey, contrasted, on the same cells.
The runtime sheet is 8 columns of 192 px cells; each rect is the tight alpha bound of its cell.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

HERE = Path(__file__).resolve().parent
CELL = 192


def cells(source: Image.Image) -> list[Image.Image]:
    w, h = source.size
    out = []
    for j in range(4):
        for i in range(4):
            out.append(source.crop((i * w // 4, j * h // 4, (i + 1) * w // 4, (j + 1) * h // 4)))
    return out


def ink(cell: Image.Image) -> Image.Image:
    alpha = cell.getchannel('A')
    grey = ImageOps.autocontrast(ImageOps.grayscale(cell.convert('RGB')), cutoff=2)
    grey = ImageEnhance.Contrast(grey).enhance(1.35)
    grey = grey.point(lambda v: int(255 * (v / 255) ** 1.6))
    result = Image.merge('RGBA', (grey, grey, grey, alpha))
    return result


SINGLE_WIDTH = 1536


def singles(family: str, paths: list[Path]) -> None:
    colour = []
    for path in paths:
        image = Image.open(path).convert('RGBA')
        a = image.getchannel('A').point(lambda v: 0 if v < 10 else v)
        image.putalpha(a)
        image = image.crop(a.getbbox())
        if image.width > SINGLE_WIDTH:
            image = image.resize((SINGLE_WIDTH, round(image.height * SINGLE_WIDTH / image.width)), Image.LANCZOS)
        colour.append(image)
    inks = [ink(c).resize((c.width // 2, c.height // 2), Image.LANCZOS) for c in colour]
    parts = inks + colour
    limit, pad = 2 * SINGLE_WIDTH + 8, 4
    placed, x, y, shelf = [], 0, 0, 0
    for part in parts:
        if x + part.width > limit:
            x, y, shelf = 0, y + shelf + pad, 0
        placed.append((x, y))
        x += part.width + pad
        shelf = max(shelf, part.height)
    width, height = max(px + p.width for (px, _), p in zip(placed, parts)), y + shelf
    sheet = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    rects = []
    for (px, py), part in zip(placed, parts):
        sheet.alpha_composite(part, (px, py))
        rects.append([px, py, part.width, part.height])
    runtime = HERE / 'runtime'
    sheet.save(runtime / f'{family}.webp', 'WEBP', quality=90, method=6)
    manifest_path = runtime / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest[family] = {'file': f'{family}.webp', 'width': width, 'height': height, 'rows': [0, 1], 'rects': rects,
                        'variantsPerStyle': len(colour)}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(family, sheet.size, len(parts), (runtime / f'{family}.webp').stat().st_size)


def main() -> None:
    if sys.argv[1] == '--singles':
        singles(sys.argv[2], [Path(p) for p in sys.argv[3:]])
        return
    family, source_path = sys.argv[1], Path(sys.argv[2])
    color_only = '--color-only' in sys.argv
    source = Image.open(source_path).convert('RGBA')
    parts = cells(source)
    if color_only:
        parts = [ink(c) for c in parts] + parts
    count = len(parts)
    columns = 8
    rows = (count + columns - 1) // columns
    sheet = Image.new('RGBA', (columns * CELL, rows * CELL), (0, 0, 0, 0))
    rects = []
    for k, part in enumerate(parts):
        part = part.resize((CELL, CELL), Image.LANCZOS)
        # Clear faint halo noise from keyed backgrounds.
        a = part.getchannel('A').point(lambda v: 0 if v < 10 else v)
        part.putalpha(a)
        x, y = k % columns * CELL, k // columns * CELL
        sheet.alpha_composite(part, (x, y))
        box = a.getbbox() or (0, 0, CELL, CELL)
        rects.append([x + box[0], y + box[1], box[2] - box[0], box[3] - box[1]])
    runtime = HERE / 'runtime'
    sheet.save(runtime / f'{family}.webp', 'WEBP', quality=88, method=6)
    manifest_path = runtime / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest[family] = {'file': f'{family}.webp', 'width': sheet.width, 'height': sheet.height,
                        'rows': [r / rows for r in range(rows + 1)], 'rects': rects, 'variantsPerStyle': count // 2}
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(family, sheet.size, count, (runtime / f'{family}.webp').stat().st_size)


if __name__ == '__main__':
    main()
