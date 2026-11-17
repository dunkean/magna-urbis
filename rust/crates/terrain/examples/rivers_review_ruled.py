"""Width-relative straightness of the rivers dumped by rivers_review_probe, for any label (old dumps included).
usage: python rivers_review_ruled.py <out-dir> <label> [<label>...]
A straight run is a stretch whose vertices all lie within max(0.75 m, 0.15 width) of its chord (as the probe). The
probe counts runs of 150 m or more whatever the river; on a 40 km map a 60 m wide river that curves gently has many
of those. Here a run is `ruled` when it is longer than max(150 m, 10 channel widths): per map size and label, the
share of river length in ruled runs and the longest run in channel widths."""
import json, os, sys


def runs(points, width):
    m = len(width)
    i, out = 0, []
    while i + 1 < m:
        j = i + 1
        ax, ay = points[2 * i], points[2 * i + 1]
        tol = max(0.75, 0.15 * width[i])
        while j + 1 < m:
            bx, by = points[2 * j + 2], points[2 * j + 3]
            dx, dy = bx - ax, by - ay
            l = max((dx * dx + dy * dy) ** 0.5, 1e-9)
            if any(abs((points[2 * k] - ax) * dy - (points[2 * k + 1] - ay) * dx) > tol * l for k in range(i + 1, j + 1)):
                break
            j += 1
        out.append((((points[2 * j] - ax) ** 2 + (points[2 * j + 1] - ay) ** 2) ** 0.5, width[(i + j) // 2]))
        i = j
    return out


def main():
    out, labels = sys.argv[1], sys.argv[2:]
    for label in labels:
        folder = os.path.join(out, label)
        groups = {}
        for f in sorted(os.listdir(folder)):
            if not f.endswith("km.json"):
                continue
            with open(os.path.join(folder, f)) as h:
                meta = json.load(h)
            key = f[:-5].split("-")[0] + " " + f[:-5].rsplit("-", 1)[1]
            g = groups.setdefault(key, [0.0, 0.0, 0.0, 0.0])
            for line in meta["lines"]:
                p, w = line["points"], line["width"]
                for k in range(1, len(w)):
                    g[0] += ((p[2 * k] - p[2 * k - 2]) ** 2 + (p[2 * k + 1] - p[2 * k - 1]) ** 2) ** 0.5
                for run, wide in runs(p, w):
                    if run > max(150.0, 10.0 * wide):
                        g[1] += run
                    g[2] = max(g[2], run / max(wide, 1.0))
                    g[3] = max(g[3], run)
        total = [sum(g[k] for g in groups.values()) for k in range(2)]
        print(f"{label}: ruled {100 * total[1] / max(total[0], 1):.1f} % of {total[0] / 1000:.0f} km | " + " | ".join(
            f"{key}: {100 * g[1] / max(g[0], 1):.0f} % (longest {g[3]:.0f} m = {g[2]:.0f} widths)" for key, g in groups.items()))


if __name__ == "__main__":
    main()
