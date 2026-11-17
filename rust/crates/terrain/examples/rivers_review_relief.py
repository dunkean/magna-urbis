"""Ruled valleys and notches of the raw relief, from the dumps of rivers_review_probe without conditioning
(`<label>-relief`, or a `MODE=none` run such as `raw`).
usage: python rivers_review_relief.py <out-dir> <label> [<label>...]
The lines of such a dump are the thalwegs of the relief itself. Per map and label:
- ruled: share of thalweg length in straight runs longer than max(150 m, 10 channel widths), and the longest
  straight run (m); a run keeps its vertices within max(0.75 m, 0.15 width) of its chord (as the probe);
- notches: across each thalweg vertex (about one per cell), the ground from six cells on one side to six on the
  other. Depth = the lower of the two shoulders (highest ground within three cells of the axis on each side) less
  the axis; width = distance between the two points at half that depth. A notch is deeper than 5 m and narrower
  than four cells: its length (km), the depth quantiles of all vertices, and the three deepest notches;
- the median and the spread (standard deviation) of the land heights."""
import json, os, sys
import numpy as np
from rivers_review_ruled import runs


def sample(height, n, cell, x, y):
    fx = np.clip(x / cell - 0.5, 0, n - 1.000001)
    fy = np.clip(y / cell - 0.5, 0, n - 1.000001)
    i, j = fx.astype(int), fy.astype(int)
    u, v = fx - i, fy - j
    return (height[j, i] * (1 - u) + height[j, i + 1] * u) * (1 - v) + (height[j + 1, i] * (1 - u) + height[j + 1, i + 1] * u) * v


def notches(height, n, width, line):
    cell = width / n
    p = np.asarray(line["points"], dtype=np.float64).reshape(-1, 2)
    if len(p) < 9:
        return np.zeros((0, 5))
    step = np.hypot(*(p[1:] - p[:-1]).T)
    arc = np.concatenate([[0.0], np.cumsum(step)])
    # About one vertex per cell.
    keep = [0]
    for k in range(1, len(p)):
        if arc[k] - arc[keep[-1]] >= cell:
            keep.append(k)
    keep = np.array([k for k in keep if 4 <= k < len(p) - 4], dtype=int)
    if len(keep) == 0:
        return np.zeros((0, 5))
    tangent = p[keep + 4] - p[keep - 4]
    length = np.maximum(np.hypot(tangent[:, 0], tangent[:, 1]), 1e-9)
    nx, ny = -tangent[:, 1] / length, tangent[:, 0] / length
    offsets = np.arange(-6.0, 6.01, 0.25)
    z = np.stack([sample(height, n, cell, p[keep, 0] + nx * s * cell, p[keep, 1] + ny * s * cell) for s in offsets], axis=1)
    centre = np.abs(offsets) <= 0.5
    axis = z[:, centre].min(axis=1)
    left = z[:, (offsets < 0) & (offsets >= -3)].max(axis=1)
    right = z[:, (offsets > 0) & (offsets <= 3)].max(axis=1)
    depth = np.minimum(left, right) - axis
    half = axis + depth / 2
    wide = np.full(len(keep), 12.0)
    for row in range(len(keep)):
        above = z[row] >= half[row]
        a = offsets[(offsets < 0) & above]
        b = offsets[(offsets > 0) & above]
        if len(a) and len(b):
            wide[row] = b.min() - a.max()
    return np.stack([depth, wide * cell, p[keep, 0], p[keep, 1], np.full(len(keep), cell)], axis=1)


def main():
    out, labels = sys.argv[1], sys.argv[2:]
    for label in labels:
        folder = os.path.join(out, label)
        print(f"== relief of {label}")
        total = [0.0, 0.0, 0.0]
        for f in sorted(os.listdir(folder)):
            if not f.endswith("km.json"):
                continue
            with open(os.path.join(folder, f)) as h:
                meta = json.load(h)
            n, width = meta["n"], meta["width"]
            height = np.fromfile(os.path.join(folder, f[:-5] + ".height.f32"), dtype="<f4").reshape(n, n).astype(np.float64)
            length = ruled = longest = 0.0
            rows = []
            for line in meta["lines"]:
                p, w = line["points"], line["width"]
                for k in range(1, len(w)):
                    length += ((p[2 * k] - p[2 * k - 2]) ** 2 + (p[2 * k + 1] - p[2 * k - 1]) ** 2) ** 0.5
                for run, wide in runs(p, w):
                    if run > max(150.0, 10.0 * wide):
                        ruled += run
                    longest = max(longest, run)
                rows.append(notches(height, n, width, line))
            v = np.concatenate(rows) if rows else np.zeros((0, 5))
            cell = width / n
            notch = v[(v[:, 0] > 5.0) & (v[:, 1] < 4 * cell)] if len(v) else v
            deepest = notch[np.argsort(-notch[:, 0])[:3]] if len(notch) else notch
            q = np.percentile(v[:, 0], [50, 90, 100]) if len(v) else [0, 0, 0]
            total[0] += length; total[1] += ruled; total[2] += len(notch) * cell
            land = height[height > 0]
            spread = f" | land median {np.median(land):4.0f} m, spread (std) {land.std():4.0f} m" if land.size else ""
            print(f"   {f[:-5]:<24} thalwegs {length / 1000:6.1f} km | ruled {100 * ruled / max(length, 1):4.1f} %, longest straight {longest:5.0f} m{spread}"
                  f" | valley depth p50 {q[0]:5.1f} p90 {q[1]:5.1f} max {q[2]:5.1f} m | notches {len(notch) * cell / 1000:5.1f} km"
                  + "".join(f" | {d:.0f} m deep, {w:.0f} m wide at ({x:.0f}, {y:.0f})" for d, w, x, y, _ in deepest))
        print(f"   ALL: thalwegs {total[0] / 1000:.0f} km | ruled {100 * total[1] / max(total[0], 1):.1f} % | notches {total[2] / 1000:.1f} km")


if __name__ == "__main__":
    main()
