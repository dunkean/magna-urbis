"""Lakes of the dumps of rivers_review_probe: per map and label, the number of lakes (8-connected groups of lake
cells), their share of the map and the largest one (ha).
usage: python rivers_review_lakes.py <out-dir> <label> [<label>...]"""
import json, os, sys
import numpy as np


def lakes(mask, n):
    seen = np.zeros(n * n, dtype=bool)
    flat = mask.reshape(-1) != 0
    sizes = []
    for start in np.flatnonzero(flat):
        if seen[start]:
            continue
        seen[start] = True
        stack, size = [int(start)], 0
        while stack:
            c = stack.pop()
            size += 1
            x, y = c % n, c // n
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < n and 0 <= yy < n:
                        q = yy * n + xx
                        if flat[q] and not seen[q]:
                            seen[q] = True
                            stack.append(q)
        sizes.append(size)
    return sizes


def main():
    out, labels = sys.argv[1], sys.argv[2:]
    names = sorted(f[:-5] for f in os.listdir(os.path.join(out, labels[0])) if f.endswith("km.json"))
    print("map".ljust(26) + " | ".join(label.rjust(30) for label in labels))
    totals = [[0, 0.0] for _ in labels]
    for name in names:
        cells = []
        for k, label in enumerate(labels):
            folder = os.path.join(out, label)
            if not os.path.exists(os.path.join(folder, name + ".json")):
                cells.append("-".rjust(30))
                continue
            with open(os.path.join(folder, name + ".json")) as h:
                meta = json.load(h)
            n, width = meta["n"], meta["width"]
            mask = np.fromfile(os.path.join(folder, name + ".lake.u8"), dtype=np.uint8)
            sizes = lakes(mask, n)
            cell_ha = (width / n) ** 2 / 1e4
            totals[k][0] += len(sizes); totals[k][1] += sum(sizes) * cell_ha
            cells.append(f"{len(sizes):3d} lakes {100 * sum(sizes) / (n * n):4.1f} % max {max(sizes, default=0) * cell_ha:6.0f} ha".rjust(30))
        print(name.ljust(26) + " | ".join(cells))
    print("ALL".ljust(26) + " | ".join(f"{t[0]:3d} lakes {t[1] / 100:8.1f} km2".rjust(30) for t in totals))


if __name__ == "__main__":
    main()
