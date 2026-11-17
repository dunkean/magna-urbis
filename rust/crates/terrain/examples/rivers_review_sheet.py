"""Image sheets for rivers_review_probe: hillshade, contours and rivers at true width.
usage: python rivers_review_sheet.py <out-dir> <label> [<label>...]
Per map: one row per label (overview, plain zoom, canyon zoom) in <out-dir>/sheets/<map>.png, and one sheet per map
size, <out-dir>/sheet-10km.png and sheet-40km.png. Zoom panels are the places the probe stored in panels/<map>.json.
SHEET_NAME=x writes to sheets-x/ and sheet-x-10km.png instead (e.g. `relief` for the raw-relief labels)."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

PX = 640
SS = 2  # supersampling of the vector drawing


def panel(height, lake, meta, cx, cy, size, title):
    n, width = meta["n"], meta["width"]
    cell = width / n
    x0 = min(max(cx - size / 2, 0), width - size)
    y0 = min(max(cy - size / 2, 0), width - size)
    box = (x0 / cell, y0 / cell, (x0 + size) / cell, (y0 + size) / cell)
    h = np.asarray(Image.fromarray(height).resize((PX, PX), Image.BICUBIC, box=box), dtype=np.float32)
    wet = np.asarray(Image.fromarray(lake).resize((PX, PX), Image.NEAREST, box=box)) > 0
    step = size / PX
    gy, gx = np.gradient(h, step)
    slope = np.hypot(gx, gy)
    gain = float(np.clip(0.55 / max(np.percentile(slope, 95), 1e-4), 1.0, 60.0))
    shade = np.clip(0.62 - gain * (gx * -0.6 + gy * -0.6) * 0.75, 0.15, 1.0)
    lo, hi = float(h.min()), float(h.max())
    t = np.clip((h - lo) / max(hi - lo, 1e-3), 0, 1)[..., None]
    low, mid, top = np.array([150, 176, 120.0]), np.array([196, 190, 140.0]), np.array([186, 160, 132.0])
    rgb = np.where(t < 0.5, low + (mid - low) * (t * 2), mid + (top - mid) * (t * 2 - 1)) * shade[..., None]
    # Contours: about twenty over the panel, on a round interval.
    raw = max(hi - lo, 0.2) / 20
    interval = next(v for v in [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200] if v >= raw)
    band = np.floor(h / interval)
    line = np.zeros_like(h, dtype=bool)
    line[:, 1:] |= band[:, 1:] != band[:, :-1]
    line[1:, :] |= band[1:, :] != band[:-1, :]
    rgb[line] *= 0.78
    rgb[h <= 0] = [120, 160, 200]
    rgb[wet] = [110, 150, 205]
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).resize((PX * SS, PX * SS), Image.BILINEAR)
    draw = ImageDraw.Draw(image)
    scale = PX * SS / size
    for river in meta["lines"] + meta.get("oxbows", []):
        p, w, kind = river["points"], river["width"], river["kind"]
        xs = [(p[2 * k] - x0) * scale for k in range(len(w))]
        ys = [(p[2 * k + 1] - y0) * scale for k in range(len(w))]
        if max(xs) < 0 or max(ys) < 0 or min(xs) > PX * SS or min(ys) > PX * SS:
            continue
        for k in range(1, len(w)):
            if not (-50 < xs[k] < PX * SS + 50 and -50 < ys[k] < PX * SS + 50):
                continue
            thick = max(w[k] * scale, 1.3 * SS)
            colour = (190, 30, 150) if kind[k] == 9 else (24, 84, 190) if kind[k] == 1 else (10, 50, 150) if kind[k] == 0 else (0, 110, 150)
            draw.line([xs[k - 1], ys[k - 1], xs[k], ys[k]], fill=colour, width=int(round(thick)))
            if thick > 3 * SS:
                r = thick / 2
                draw.ellipse([xs[k] - r, ys[k] - r, xs[k] + r, ys[k] + r], fill=colour)
    image = image.resize((PX, PX), Image.LANCZOS)
    draw = ImageDraw.Draw(image)
    bar = next(v for v in [50, 100, 200, 500, 1000, 2000, 5000, 10000] if v >= size / 6)
    draw.rectangle([12, PX - 20, 12 + bar / step, PX - 15], fill=(255, 255, 255), outline=(0, 0, 0))
    draw.text((14, PX - 36), f"{bar} m | contours {interval:g} m | relief x{gain:.0f}", fill=(0, 0, 0))
    draw.rectangle([0, 0, PX, 16], fill=(255, 255, 255))
    draw.text((4, 2), title, fill=(0, 0, 0))
    return image


def row(out, label, name, worst=None):
    folder = os.path.join(out, label)
    with open(os.path.join(folder, name + ".json")) as f:
        meta = json.load(f)
    n = meta["n"]
    height = np.fromfile(os.path.join(folder, name + ".height.f32"), dtype="<f4").reshape(n, n)
    lake = np.fromfile(os.path.join(folder, name + ".lake.u8"), dtype=np.uint8).reshape(n, n)
    width = meta["width"]
    zoom = 1200 if width <= 10000 else 3600
    plain, canyon = meta["panels"]["plain"], meta["panels"]["canyon"]
    c = meta["classes"].get("plain") or meta["classes"].get("low") or {}
    note = f"plain: sinuosity {c.get('sinuosity', 0):.2f}, longest straight {c.get('straightLongestM', 0):.0f} m" if c else ""
    panels = [
        panel(height, lake, meta, width / 2, width / 2, width, f"{label} | {name} | whole map | {note}"),
        panel(height, lake, meta, plain[0], plain[1], zoom, f"{label} | {name} | low-slope reach ({plain[0]:.0f}, {plain[1]:.0f})"),
        panel(height, lake, meta, canyon[0], canyon[1], zoom, f"{label} | {name} | deepest valley reach ({canyon[0]:.0f}, {canyon[1]:.0f})"),
    ]
    if worst:
        panels.append(panel(height, lake, meta, worst[0], worst[1], zoom, f"{label} | {name} | longest straight low-slope run left: {worst[2]:.0f} m"))
    box = meta.get("oxbowAt")
    if box and box[2] > 0:
        panels.append(panel(height, lake, meta, box[0], box[1], zoom / 2, f"{label} | {name} | longest oxbow (magenta), {box[2]:.0f} m"))
    image = Image.new("RGB", (PX * len(panels) + 4 * (len(panels) - 1), PX), (255, 255, 255))
    for k, p in enumerate(panels):
        image.paste(p, (k * (PX + 4), 0))
    return image


def main():
    out, labels = sys.argv[1], sys.argv[2:]
    suffix = os.environ.get("SHEET_NAME", "")
    target = "sheets-" + suffix if suffix else "sheets"
    os.makedirs(os.path.join(out, target), exist_ok=True)
    names = sorted(f[:-5] for f in os.listdir(os.path.join(out, labels[0])) if f.endswith("km.json"))
    by_size = {}
    for name in names:
        present = [label for label in labels if os.path.exists(os.path.join(out, label, name + ".json"))]
        with open(os.path.join(out, present[-1], name + ".json")) as f:
            worst = json.load(f).get("worst")
        rows = [row(out, label, name, worst if worst and worst[2] > 0 else None) for label in present]
        sheet = Image.new("RGB", (max(r.width for r in rows), sum(r.height + 4 for r in rows)), (255, 255, 255))
        for k, r in enumerate(rows):
            sheet.paste(r, (0, k * (PX + 4)))
        sheet.save(os.path.join(out, target, name + ".png"))
        by_size.setdefault(name.rsplit("-", 1)[1], []).append(sheet)
    for size, sheets in by_size.items():
        full = Image.new("RGB", (max(s.width for s in sheets), sum(s.height + 12 for s in sheets)), (60, 60, 60))
        y = 0
        for s in sheets:
            full.paste(s, (0, y))
            y += s.height + 12
        full.save(os.path.join(out, f"sheet-{suffix}-{size}.png" if suffix else f"sheet-{size}.png"))
    print("sheets:", os.path.join(out, target), list(by_size))


if __name__ == "__main__":
    main()
