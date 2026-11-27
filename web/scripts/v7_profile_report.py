"""Summarize a V7 capture and optionally compare a candidate against it."""

import argparse
from collections import Counter
import csv
import json
from pathlib import Path


def load(path):
    return json.loads(path.read_bytes())


def table(header, rows):
    return [f"| {' | '.join(header)} |", f"| {' | '.join('---' for _ in header)} |",
            *(f"| {' | '.join(map(str, row))} |" for row in rows)]


def millis(value):
    return f"{value:.1f}" if value is not None else "—"


def windows_of(folder):
    return load(folder / "timings.json")["windows"]


def render_report(folder):
    config, browser = map(load, (folder / "run.json", folder / "browser.json"))
    windows = windows_of(folder)
    engine = [json.loads(line) for line in (folder / "engine.ndjson").read_text(encoding="utf-8").splitlines()]
    lines = ["# Profilage V7 réduit", "", f"Campagne complète · **{bool(browser.get('complete'))}**", "",
             f"Affinité {config['affinity']} · 12 cœurs · {browser.get('gpu', {}).get('renderer', 'adaptateur indéterminé')}", "",
             f"Moteur {config['engineArtifact']['sha256']} · V2 {config['v2Build'].get('source', config['v2Build'].get('buildSource'))}", "",
             "Un passage par cas. Les fenêtres peuvent se chevaucher. Les compteurs CPU couvrent les intervalles observés à l’intérieur de chaque fenêtre.", ""]
    if browser.get("failure"):
        lines.extend([f"Échec de mesure · {browser['failure'].splitlines()[0]}", ""])
    cols = ["Étape", "Mur (ms)", "CPU natif (ms)", "Cycles natifs (M)", "CPU Chrome (ms)", "Cycles Chrome (M)"]

    def duration_row(row):
        cells = [row["name"], millis(row["wallMs"])]
        for process in ("native", "chrome"):
            sample = row["cpu"].get(process, {})
            if sample.get("observedPids", 0):
                cells.extend((millis(sample["cpuMsInside"]), millis(sample["cyclesInside"] / 1e6)))
            else:
                cells.extend(("—", "—"))
        return cells

    lines.extend(["## Démarrage", "", *table(cols, (duration_row(row) for row in windows if row["caseId"] is None)), ""])
    for case in browser["cases"]:
        ident = case["id"]
        parts = [row for row in windows if row["caseId"] == ident]
        case_logs = [row for row in engine if row["caseId"] == ident]
        summary = case.get("summary", {})
        town, shore = summary.get("town") or {}, summary.get("shore") or {}
        lines.extend([f"## {ident}", "",
                      f"{town.get('buildings', '—')} bâtiments · implantation {town.get('archetype', '—')} · bâti à {shore.get('builtToWaterM', '—')} m de l’eau.", "",
                      *table(cols, map(duration_row, (row for row in parts if not row["path"]))), "",
                      "### Requêtes", "", *table(cols, map(duration_row, (row for row in parts if row["path"]))), "",
                      "### Travail répété dans le moteur", ""])
        counters = Counter(row["probe"] for row in case_logs if "probe" in row)
        counts = [(key, counters[key]) for key in ("composition.plan", "quarters.planned", "parcels.probe.generate", "parcels.probe.allocate", "allocate.done", "tail.springs.reserve")]
        counts.append(("Passes de trim", sum("tail.trim.run.pass:" in row["line"] for row in case_logs)))
        lines.extend(table(["Sonde ou compteur", "Occurrences"], counts))
        lines.extend(["", "### Sondes Rust", "", "Les durées sont celles émises par le moteur. Les sous-étapes et les séries cumulées ne s’additionnent pas.", ""])
        lines.extend(table(["Sonde", "ms"], [(row["probe"], millis(row["reportedMs"])) for row in case_logs if "probe" in row]))
        measures = [x for x in case.get("performance", {}).get("entries", []) if x.get("entryType") == "measure"]
        lines.extend(["", "### Mesures V2", "", *table(["Mesure", "Début page (ms)", "Durée (ms)"],
                      [(x["name"], millis(x["startTime"]), millis(x["duration"])) for x in measures]), ""])
    (folder / "rapport.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    with (folder / "temps.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["case", "name", "request_path", "start_ms", "end_ms", "wall_ms", "process", "cycles_inside", "cpu_ms_inside", "pids", "max_edge_gap_ms"])
        for row in windows:
            for name, cpu in row["cpu"].items():
                writer.writerow([row["caseId"], row["name"], row["path"], row["startMs"], row["endMs"], row["wallMs"], name,
                                 cpu["cyclesInside"], cpu["cpuMsInside"], cpu["observedPids"], cpu["maxEdgeGapMs"]])


def compare(reference, candidate):
    from PIL import Image, ImageChops

    before, after = (load(folder / "browser.json") for folder in (reference, candidate))
    if not before.get("complete") or not after.get("complete"):
        raise ValueError("Comparison requires two completed campaigns")
    if [case["id"] for case in before["cases"]] != [case["id"] for case in after["cases"]]:
        raise ValueError("Campaign case order changed")
    configs = [load(folder / "run.json") for folder in (reference, candidate)]
    conditions = [(cfg["affinity"], cfg["pmu"], cfg["engineArtifact"]["profile"],
                   [(row["id"], row["sha256"], row["season"]) for row in cfg["cases"]]) for cfg in configs]
    if conditions[0] != conditions[1] or before["gpu"]["renderer"] != after["gpu"]["renderer"]:
        raise ValueError("The two campaigns used different inputs or measurement conditions")
    lines = ["# Comparaison V7", "", "Un passage par version. Les requêtes qui se chevauchent ne s’additionnent pas.", ""]
    comparisons = []
    for old, new in zip(before["cases"], after["cases"]):
        case = old["id"]
        if old["request"] != new["request"] or old["views"] != new["views"]:
            raise ValueError(f"{case}: different requests or views")
        hashes = old["products"]
        if hashes.keys() != new["products"].keys():
            raise ValueError(f"{case}: different products")
        products = {name: digest == new["products"][name] for name, digest in hashes.items()}
        pictures = {}
        for view in old["views"]:
            name = f"{case}-{view}.png"
            with Image.open(reference / name) as x, Image.open(candidate / name) as y:
                if x.size != y.size:
                    raise ValueError(f"{name}: different dimensions")
                diff = ImageChops.difference(x.convert("RGB"), y.convert("RGB"))
                count = sum(r != 0 or g != 0 or b != 0 for r, g, b in diff.getdata())
                pictures[view] = {"changedPixels": count, "pixels": x.width * x.height,
                                  "maxDifference": max(v[1] for v in diff.getextrema())}
        groups = []
        for folder in (reference, candidate):
            spans = {}
            for row in windows_of(folder):
                if row["caseId"] == case:
                    key = (row["name"], row["path"])
                    spans[key] = spans.get(key, 0.0) + row["wallMs"]
            groups.append(spans)
        times = []
        for name, path in groups[0].keys() | groups[1].keys():
            x, y = (group.get((name, path)) for group in groups)
            times.append(dict(name=name, path=path, referenceMs=x, candidateMs=y, ratio=x / y if x and y else None))
        times.sort(key=lambda row: -(row["referenceMs"] or 0.0))
        lines.extend([f"## {case}", "", *table(["Produit", "Empreinte identique"],
                      [(name, "oui" if equal else "non") for name, equal in products.items()]), "",
                      *table(["Vue", "Pixels différents", "Amplitude maximale"],
                       [(name, f"{diff['changedPixels']}/{diff['pixels']}", diff["maxDifference"]) for name, diff in pictures.items()]), "",
                      *table(["Étape ou requête", "Référence (ms)", "Candidat (ms)", "Accélération"],
                       [(t["name"], millis(t["referenceMs"]), millis(t["candidateMs"]), f"{t['ratio']:.3f}×" if t["ratio"] else "—") for t in times]), ""])
        comparisons.append(dict(case=case, products=products, images=pictures, observedTimes=times))
    (candidate / "comparaison.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (candidate / "comparison.json").write_text(json.dumps(comparisons, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    render_report(args.output)
    if args.reference:
        compare(args.reference, args.output)
