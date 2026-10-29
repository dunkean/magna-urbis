"""One deterministic small native replay, never a service or a full-city run."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "web/out/work/city-visual-audit-p2/01-l/requests.json"
ROOT = REPO / "web/out/strip-initial-budget-proof"
EXE = REPO / "rust/target/debug/examples/plan_replay.exe"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare():
    request_path = ROOT / "requests.json"
    if request_path.exists():
        return
    source_bytes = SOURCE.read_bytes()
    source = json.loads(source_bytes)
    assert isinstance(source, list), "Expected exact frozen request array."
    eligible = [(i, r) for i, r in enumerate(source) if r["function"] in ("domestic", "mixed")]
    assert len(eligible) >= 128
    ranks = [i * (len(eligible) - 1) // 127 for i in range(128)]
    picked = [eligible[i] for i in ranks]
    assert len({r["id"] for _, r in picked}) == 128
    ROOT.mkdir(parents=True, exist_ok=True)
    payload = {"schema_version": "1", "requests": [r for _, r in picked]}
    # No settings, footprint override, pin, terrain, neighbour or programme edits.
    request_path.write_bytes(canonical(payload))
    save(ROOT / "selection.json", {
        "source": str(SOURCE.relative_to(REPO)), "sourceSha256": digest(source_bytes),
        "sourceRequests": len(source), "eligibleDomesticMixed": len(eligible),
        "sampleCount": 128,
        "rule": "eligible_rank = floor(i * (eligible_count - 1) / 127), i=0..127; original source order retained",
        "requestSha256": digest(request_path.read_bytes()),
        "individualHashEncoding": "JSON UTF-8, sorted object keys, compact separators, ensure_ascii=False",
        "sites": [{"sampleIndex": j, "eligibleRank": rank, "sourceIndex": source_index,
                   "id": request["id"], "function": request["function"],
                   "requestSha256": digest(canonical(request))}
                  for j, (rank, (source_index, request)) in enumerate(zip(ranks, picked))],
        "scope": "Deterministic spaced sample, not a random sample or a city acceptance-rate estimate. Existing neighbour fields are retained; omitted earlier-city buildings are not reconstructed."
    })


def ring_area(ring):
    if len(ring) < 3:
        return 0.
    x0, y0 = ring[0]["x"], ring[0]["y"]
    return abs(sum((a["x"] - x0) * (b["y"] - y0) - (b["x"] - x0) * (a["y"] - y0)
                   for a, b in zip(ring, ring[1:] + ring[:1]))) * .5


def area(surface):
    return sum(ring_area(p["outer"]) - sum(ring_area(h) for h in p["holes"]) for p in surface)


def distribution(values):
    values = sorted(values)
    def q(p):
        i = p * (len(values) - 1)
        lo, hi = math.floor(i), math.ceil(i)
        return values[lo] + (values[hi] - values[lo]) * (i - lo)
    return {"count": len(values), "min": values[0], "p10": q(.1), "median": q(.5),
            "p90": q(.9), "max": values[-1], "mean": sum(values) / len(values)} if values else {"count": 0}


def measure(phase_dir, runtime):
    payload = json.loads((ROOT / "requests.json").read_bytes())
    selection = json.loads((ROOT / "selection.json").read_bytes())
    plans = json.loads((phase_dir / "plans.json").read_bytes())
    buildings = {b["id"]: b for b in plans["buildings"]}
    refusals = {b["id"]: b for b in plans["refusals"]}
    assert len(buildings) + len(refusals) + len(plans["open_spaces"]) == 128
    budget = re.compile(r"Domestic footprint budget:.*?; (\d+)/8 dimension pairs, (\d+)/24 rigid poses, (\d+) admitted;")
    rows, ratios, style_counts, refusal_reasons = [], [], Counter(), Counter()
    for request, selected in zip(payload["requests"], selection["sites"]):
        assert request["id"] == selected["id"] and digest(canonical(request)) == selected["requestSha256"]
        row = dict(selected)
        target = (request.get("programme") or {}).get("built_area_m2")
        row["targetBodyAreaM2"] = target
        building = buildings.get(request["id"])
        if building:
            diagnostics = building.get("diagnostics", [])
            trace = [m for d in diagnostics if (m := budget.search(d))]
            values = tuple(map(int, trace[-1].groups())) if trace else None
            built = area(building["footprint"])
            ratio = built / target if target and math.isfinite(target) and target > 0 else None
            if ratio is not None:
                ratios.append(ratio)
            style = f'{building["recipe_id"]}/{building["variant_id"]}'
            style_counts[style] += 1
            row.update(status="accepted", recipe=building["recipe_id"], variant=building["variant_id"],
                       bodyAreaM2=built, footprintTargetRatio=ratio,
                       targetWithinTenPercent=ratio is not None and abs(ratio - 1) <= .1,
                       budgetDimensionPairs=values[0] if values else 0,
                       budgetPhysicalPoses=values[1] if values else 0,
                       budgetAdmittedPoses=values[2] if values else 0,
                       budgetSearchReported=bool(values),
                       initialStripBudgetApplied=any(d.startswith("Initial native strip programme:") for d in diagnostics),
                       budgetDiagnostics=[d for d in diagnostics if d.startswith("Domestic footprint budget:")])
        else:
            refusal = refusals[request["id"]]
            refusal_reasons[refusal["message"]] += 1
            row.update(status="refused", refusal=refusal)
        rows.append(row)
    accepted = [r for r in rows if r["status"] == "accepted"]
    report = {
        "phase": phase_dir.name, "requestSha256": selection["requestSha256"],
        "counts": {"requests": 128, "accepted": len(accepted), "refused": len(refusals),
                   "openSpaces": len(plans["open_spaces"]),
                   "functions": dict(Counter(r["function"] for r in rows))},
        "timing": runtime,
        "budget": {"acceptedWithSearchTrace": sum(r["budgetSearchReported"] for r in accepted),
                   "initialStripBudgetApplied": sum(r["initialStripBudgetApplied"] for r in accepted),
                   "dimensionPairs": sum(r["budgetDimensionPairs"] for r in accepted),
                   "physicalPoses": sum(r["budgetPhysicalPoses"] for r in accepted),
                   "admittedPoses": sum(r["budgetAdmittedPoses"] for r in accepted),
                   "physicalPosesPerAccepted": distribution([r["budgetPhysicalPoses"] for r in accepted]),
                   "scope": "Post-admission domestic budget trace only; initial source/adaptation attempts are not exposed by these diagnostics."},
        "footprintTargetRatio": distribution(ratios),
        "targetWithinTenPercent": sum(r["targetWithinTenPercent"] for r in accepted),
        "acceptedStyles": dict(sorted(style_counts.items())),
        "refusalReasons": dict(refusal_reasons), "sites": rows,
        "scope": selection["scope"] + " No details, render or city generation is included in this replay."
    }
    save(phase_dir / "metrics.json", report)
    print(json.dumps({k: report[k] for k in ["counts", "budget", "footprintTargetRatio", "targetWithinTenPercent", "acceptedStyles"]}, ensure_ascii=False))


def compare(phase_dir):
    if phase_dir.name == "before":
        return
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    requests = json.loads((ROOT / "requests.json").read_bytes())["requests"]
    metrics = {p: json.loads((ROOT / p / "metrics.json").read_bytes()) for p in ["before", phase_dir.name]}
    rows = {p: {s["id"]: s for s in m["sites"]} for p, m in metrics.items()}
    plans = {p: {b["id"]: b for b in json.loads((ROOT / p / "plans.json").read_bytes())["buildings"]}
             for p in metrics}
    def surface(shapes):
        return unary_union([Polygon([(v["x"], v["y"]) for v in s["outer"]],
                                   [[(v["x"], v["y"]) for v in h] for h in s["holes"]]) for s in shapes])
    changes, rights = [], {p: [] for p in metrics}
    for request in requests:
        rid = request["id"]
        a, b = rows["before"][rid], rows[phase_dir.name][rid]
        change = {"id": rid, "sourceIndex": a["sourceIndex"], "beforeStatus": a["status"], "afterStatus": b["status"]}
        if a["status"] == b["status"] == "accepted":
            change.update(beforeStyle=f'{a["recipe"]}/{a["variant"]}', afterStyle=f'{b["recipe"]}/{b["variant"]}',
                          styleChanged=(a["recipe"], a["variant"]) != (b["recipe"], b["variant"]),
                          beforeBodyAreaM2=a["bodyAreaM2"], afterBodyAreaM2=b["bodyAreaM2"],
                          beforeRatio=a["footprintTargetRatio"], afterRatio=b["footprintTargetRatio"],
                          beforePoses=a["budgetPhysicalPoses"], afterPoses=b["budgetPhysicalPoses"],
                          beforeBodies=len(plans["before"][rid]["volumes"]),
                          afterBodies=len(plans[phase_dir.name][rid]["volumes"]))
            if a["footprintTargetRatio"] and b["footprintTargetRatio"]:
                change["logAreaErrorImproved"] = abs(math.log(b["footprintTargetRatio"])) < abs(math.log(a["footprintTargetRatio"])) - 1e-8
                change["logAreaErrorWorsened"] = abs(math.log(b["footprintTargetRatio"])) > abs(math.log(a["footprintTargetRatio"])) + 1e-8
        changes.append(change)
        allowed_body, allowed_roof, reserve = surface(request["buildable"]), surface(request.get("roof_domain") or request["cadastral"]), surface(request["reserves"])
        for phase in metrics:
            building = plans[phase].get(rid)
            if not building:
                continue
            body, roof = surface(building["footprint"]), surface(building["roof_footprint"])
            rights[phase].append({"id": rid, "bodyOutsideBuildableM2": body.difference(allowed_body).area,
                                  "roofOutsideRightsM2": roof.difference(allowed_roof).area,
                                  "reserveOverlapM2": body.union(roof).intersection(reserve).area})
    before, after = metrics["before"], metrics[phase_dir.name]
    report = {
        "requestSha256": before["requestSha256"], "phase": phase_dir.name,
        "counts": {"before": before["counts"], "after": after["counts"],
                   "acceptedToRefused": sum(c["beforeStatus"] == "accepted" and c["afterStatus"] == "refused" for c in changes),
                   "refusedToAccepted": sum(c["beforeStatus"] == "refused" and c["afterStatus"] == "accepted" for c in changes),
                   "commonAcceptedStyleChanges": sum(c.get("styleChanged", False) for c in changes),
                   "commonAreaErrorImproved": sum(c.get("logAreaErrorImproved", False) for c in changes),
                   "commonAreaErrorWorsened": sum(c.get("logAreaErrorWorsened", False) for c in changes)},
        "nativePlanMs": {"before": before["timing"]["nativePlanCalculationMs"], "after": after["timing"]["nativePlanCalculationMs"]},
        "budgetPoses": {"before": before["budget"]["physicalPoses"], "after": after["budget"]["physicalPoses"]},
        "targetWithinTenPercent": {"before": before["targetWithinTenPercent"], "after": after["targetWithinTenPercent"]},
        "ratio": {"before": before["footprintTargetRatio"], "after": after["footprintTargetRatio"]},
        "rights": {phase: {"checkedBuildings": len(values),
                           "bodyOutsideAbove0001M2": sum(x["bodyOutsideBuildableM2"] > .0001 for x in values),
                           "roofOutsideAbove0001M2": sum(x["roofOutsideRightsM2"] > .0001 for x in values),
                           "reserveOverlapAbove0001M2": sum(x["reserveOverlapM2"] > .0001 for x in values),
                           "maximumBodyOutsideM2": max((x["bodyOutsideBuildableM2"] for x in values), default=0),
                           "maximumRoofOutsideM2": max((x["roofOutsideRightsM2"] for x in values), default=0),
                           "sites": values} for phase, values in rights.items()},
        "sites": changes,
        "scope": "Exact same 128 requests. Single run per phase, no city rate or scaling claim. Rights are independently measured with Shapely using a 0.0001 m2 reporting threshold. Terrain, access and native detail are not recertified here."
    }
    save(phase_dir / "comparison.json", report)
    print(json.dumps({k: report[k] for k in ["counts", "nativePlanMs", "budgetPoses", "targetWithinTenPercent"]}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    parser.add_argument("--exe", type=Path, default=EXE)
    args = parser.parse_args()
    assert re.fullmatch(r"[a-z0-9-]+", args.phase)
    prepare()
    phase_dir = ROOT / args.phase
    if phase_dir.exists():
        raise SystemExit("Phase already exists; refusing a second replay or overwrite.")
    phase_dir.mkdir()
    exe_bytes = args.exe.read_bytes()
    command = [str(args.exe.resolve()), str(ROOT / "requests.json"), str(phase_dir / "plans.json")]
    start = time.perf_counter()
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=120)
    elapsed = (time.perf_counter() - start) * 1000
    (phase_dir / "stdout.log").write_text(result.stdout, encoding="utf-8")
    (phase_dir / "stderr.log").write_text(result.stderr, encoding="utf-8")
    result.check_returncode()
    assert digest(args.exe.read_bytes()) == digest(exe_bytes), "Executable changed during replay."
    native = json.loads(result.stdout.strip().splitlines()[-1])
    runtime = {"capturedUtc": datetime.now(timezone.utc).isoformat(), "command": command,
               "executableSha256": digest(exe_bytes),
               "executableMtimeUtc": datetime.fromtimestamp(args.exe.stat().st_mtime, timezone.utc).isoformat(),
               "wallMsIncludingStartupReadWrite": elapsed, "nativePlanCalculationMs": native["ms"],
               "oneReplayOnly": True, "details": False, "exitCode": result.returncode}
    save(phase_dir / "runtime.json", runtime)
    measure(phase_dir, runtime)
    compare(phase_dir)


if __name__ == "__main__":
    main()
