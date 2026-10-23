"""Offline replay audit; no native execution.

Legacy nativeFoundation* fields continue to describe Strip only. Single uses
its explicit marker and separate totals; preparedFoundation* covers both.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct

from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1] / "out/strip-initial-budget-proof"
AREA_TOLERANCE = 0.0001
TERRAIN_TOLERANCE = 0.000001
NATIVE_MARKER = "Native ground-strip foundation:"
NATIVE_SINGLE_MARKER = "Native ground-single foundation:"


def foundation_family(diagnostics):
    strip = any(d.startswith(NATIVE_MARKER) for d in diagnostics)
    single = any(d.startswith(NATIVE_SINGLE_MARKER) for d in diagnostics)
    if strip and single:
        raise ValueError("Conflicting native foundation families")
    return "strip" if strip else "single" if single else None


def load(path):
    return json.loads(path.read_bytes())


def surface(value):
    return unary_union([Polygon([(v["x"], v["y"]) for v in p["outer"]],
                                [[(v["x"], v["y"]) for v in h] for h in p["holes"]])
                        for p in value])


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for child in geometry.geoms:
            yield from polygons(child)


def float_bits(value):
    if isinstance(value, dict):
        if list(value) == ["$f64"]:
            return struct.unpack(">d", bytes.fromhex(value["$f64"]))[0]
        return {k: float_bits(v) for k, v in value.items()}
    if isinstance(value, list):
        return [float_bits(v) for v in value]
    return value


def retained_domain(building):
    """Old local plan domain, excluding the external path added after grounding."""
    compact = float_bits(building["resolved"])
    shapes = compact["surfaces"]
    parts = [surface(shapes[i]) for body in compact["bodies"] for i in body["levels"]]
    parts += [surface(shapes[compact[k]]) for k in ("courts", "paths")]
    parts += [surface(f["surface"]) for f in compact["features"]]
    local = unary_union(parts)
    transform = building["transform"]
    world = affinity.rotate(local, transform["orientation_deg"], origin=(0, 0))
    return affinity.translate(world, transform["origin"]["x"], transform["origin"]["y"])


def terrain_bounds(terrain, geometry):
    """Independent GEOS clipping, bilinear edge extrema and gradient bounds."""
    if geometry.is_empty:
        raise ValueError("No physical footprint")
    grid = terrain.get("grid")
    if not grid:
        gx, gy = terrain["gradient"]
        origin = terrain["origin"]
        heights = [terrain["ground_z_m"] + (x - origin["x"]) * gx + (y - origin["y"]) * gy
                   for p in polygons(geometry) for x, y in p.exterior.coords]
        return min(heights), max(heights), math.degrees(math.atan(math.hypot(gx, gy)))
    ox, oy = grid["origin"]["x"], grid["origin"]["y"]
    step, width, height = grid["step_m"], grid["width"], grid["height"]
    xmin, ymin, xmax, ymax = geometry.bounds
    if xmin < ox - 1e-7 or ymin < oy - 1e-7 or xmax > ox + (width - 1) * step + 1e-7 or ymax > oy + (height - 1) * step + 1e-7:
        raise ValueError("Physical footprint leaves supplied terrain patch")
    index = lambda value, start, count: min(count - 2, max(0, math.floor((value - start) / step)))
    low, high, gradient = math.inf, -math.inf, 0.0
    zs = grid["elevations_m"]
    for y in range(index(ymin, oy, height), index(ymax, oy, height) + 1):
        for x in range(index(xmin, ox, width), index(xmax, ox, width) + 1):
            cx, cy = ox + x * step, oy + y * step
            clipped = geometry.intersection(box(cx, cy, cx + step, cy + step))
            if clipped.area < 1e-9:
                continue
            z00, z10 = zs[y * width + x], zs[y * width + x + 1]
            z01, z11 = zs[(y + 1) * width + x], zs[(y + 1) * width + x + 1]
            bu, bv, cross = z10 - z00, z01 - z00, z11 - z10 - z01 + z00
            sample = lambda u, v: z00 + bu * u + bv * v + cross * u * v
            for polygon in polygons(clipped):
                for ring in [polygon.exterior, *polygon.interiors]:
                    points = list(ring.coords)
                    for a, b in zip(points, points[1:]):
                        u, v = (a[0] - cx) / step, (a[1] - cy) / step
                        du, dv = (b[0] - a[0]) / step, (b[1] - a[1]) / step
                        z = sample(u, v)
                        low, high = min(low, z), max(high, z)
                        gradient = max(gradient, math.hypot((bu + cross * v) / step, (bv + cross * u) / step))
                        qa = cross * du * dv
                        qb = bu * du + bv * dv + cross * (u * dv + v * du)
                        if abs(qa) > 1e-14:
                            t = -qb / (2 * qa)
                            if 0 < t < 1:
                                z = sample(u + du * t, v + dv * t)
                                low, high = min(low, z), max(high, z)
    if not math.isfinite(low) or not math.isfinite(high):
        raise ValueError("No physical terrain coverage")
    return low, high, math.degrees(math.atan(gradient))


def audit_phase(requests, plans):
    buildings = {b["id"]: b for b in plans["buildings"]}
    occupied = []
    results = []
    for request in requests:
        b = buildings.get(request["id"])
        if not b:
            continue
        body, roof = surface(b["footprint"]), surface(b["roof_footprint"])
        structures = unary_union([surface(f["surface"]) for f in b["structural_features"]])
        courts, paths = surface(b["courtyards"]), surface(b["circulation"])
        occupation = unary_union([body, structures, courts, paths])
        neighbors = unary_union([surface(n["footprint"]) for n in request["neighbors"]] + occupied)
        cadastral, reserve = surface(request["cadastral"]), surface(request["reserves"])
        rights = {
            "bodyOutsideBuildableM2": body.difference(surface(request["buildable"])).area,
            "roofOutsideRightsM2": roof.difference(surface(request.get("roof_domain") or request["cadastral"])).area,
            "occupationOutsideCadastralM2": occupation.difference(cadastral).area,
            "structuresOutsideCadastralM2": structures.difference(cadastral).area,
            "reserveOverlapM2": occupation.union(roof).intersection(reserve).area,
            "neighborOccupationOverlapM2": occupation.intersection(neighbors).area,
        }
        family = foundation_family(b["diagnostics"])
        row = {"id": b["id"], "nativeFoundation": family == "strip",
               "nativeFoundationFamily": family, "preparedFoundation": family is not None,
               "rights": rights, "rightsAboveTolerance": [k for k, v in rights.items() if v > AREA_TOLERANCE]}
        if family is not None:
            bearing = body.union(structures)
            low, high, slope = terrain_bounds(request["terrain"], bearing)
            old_error = None
            try:
                old_low, old_high, old_slope = terrain_bounds(request["terrain"], retained_domain(b))
            except ValueError as error:
                # An unused bare court can leave the sampled terrain patch.
                # Record that old proxy failure separately from real supports.
                old_low = old_high = old_slope = None
                old_error = str(error)
            limit = request["terrain"]["max_foundation_step_m"]
            water = request["terrain"].get("water_z_m")
            violations = []
            if high - low > limit + TERRAIN_TOLERANCE:
                violations.append("foundation_step")
            if slope > 12.0 + TERRAIN_TOLERANCE:
                violations.append("slope")
            if abs(high - b["ground_z_m"]) > TERRAIN_TOLERANCE:
                violations.append("ground_z")
            if water is not None and low < water - .01 - TERRAIN_TOLERANCE:
                violations.append("submerged_ground_support")
            row["terrain"] = {
                "bearingAreaM2": bearing.area, "structureAreaM2": structures.area,
                "nativeFeatureKinds": dict(Counter(f["kind"] for f in b["structural_features"])),
                "lowM": low, "highM": high, "stepM": high - low, "stepLimitM": limit,
                "slopeDeg": slope, "slopeLimitDeg": 12.0,
                "groundZDifferenceM": high - b["ground_z_m"],
                "retainedPlanStepMAtSamePose": old_high - old_low if old_error is None else None,
                "retainedPlanSlopeDegAtSamePose": old_slope,
                "retainedPlanTerrainError": old_error,
                "retainedPlanWouldExceedStep": old_error is None and old_high - old_low > limit + TERRAIN_TOLERANCE,
                "violations": violations,
            }
        results.append(row)
        occupied.append(occupation)
    native = [r for r in results if r["nativeFoundation"]]
    single = [r for r in results if r["nativeFoundationFamily"] == "single"]
    prepared = native + single
    return {
        "checkedBuildings": len(results), "nativeFoundationBuildings": len(native),
        "legacyNativeFoundationMetricsScope": "strip",
        "preparedFoundationBuildings": len(prepared),
        "allPreparedTerrainViolationBuildings": [r["id"] for r in prepared if r["terrain"]["violations"]],
        "singleFoundation": {
            "buildings": len(single),
            "terrainViolationBuildings": [r["id"] for r in single if r["terrain"]["violations"]],
            "groundMaxErrorM": max((abs(r["terrain"]["groundZDifferenceM"]) for r in single), default=0),
            "retainedPlanWouldExceedStepCount": sum(r["terrain"]["retainedPlanWouldExceedStep"] for r in single),
            "retainedPlanTerrainErrorCount": sum(r["terrain"]["retainedPlanTerrainError"] is not None for r in single),
        },
        "rightsViolationBuildings": [r["id"] for r in results if r["rightsAboveTolerance"]],
        "nativeTerrainViolationBuildings": [r["id"] for r in native if r["terrain"]["violations"]],
        "nativeGroundMaxErrorM": max((abs(r["terrain"]["groundZDifferenceM"]) for r in native), default=0),
        "retainedPlanWouldExceedStepCount": sum(r["terrain"]["retainedPlanWouldExceedStep"] for r in native),
        "retainedPlanTerrainErrorCount": sum(r["terrain"]["retainedPlanTerrainError"] is not None for r in native),
        "sites": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", default="after-cache-and-simple")
    parser.add_argument("--after", default="after-native-foundation")
    args = parser.parse_args()
    for phase in (args.before, args.after):
        if Path(phase).name != phase:
            raise ValueError("Expected a phase directory name")
    raw = (ROOT / "requests.json").read_bytes()
    requests = json.loads(raw)["requests"]
    request_hash = hashlib.sha256(raw).hexdigest()
    phases = {}
    for phase in (args.before, args.after):
        metrics = load(ROOT / phase / "metrics.json")
        if metrics["requestSha256"] != request_hash:
            raise ValueError("Request hash changed")
        plans = load(ROOT / phase / "plans.json")
        phases[phase] = {"metrics": metrics, "plans": plans,
                         "rows": {s["id"]: s for s in metrics["sites"]},
                         "buildings": {b["id"]: b for b in plans["buildings"]}}
    before, after = phases[args.before], phases[args.after]
    changes = []
    for request in requests:
        rid = request["id"]
        a, b = before["rows"][rid], after["rows"][rid]
        row = {"id": rid, "sourceIndex": a["sourceIndex"], "before": a, "after": b}
        if a["status"] == b["status"] == "accepted":
            row["samePlanJson"] = before["buildings"][rid] == after["buildings"][rid]
            row["sameStyle"] = (a["recipe"], a["variant"]) == (b["recipe"], b["variant"])
            row["bodyAreaDeltaM2"] = b["bodyAreaM2"] - a["bodyAreaM2"]
        changes.append(row)
    audits = {phase: audit_phase(requests, p["plans"]) for phase, p in phases.items()}
    report = {
        "version": "native-foundation-comparison-2", "requestSha256": request_hash,
        "beforePhase": args.before, "afterPhase": args.after,
        "accepted": {phase: p["metrics"]["counts"]["accepted"] for phase, p in phases.items()},
        "lost": [c["id"] for c in changes if c["before"]["status"] == "accepted" and c["after"]["status"] == "refused"],
        "gained": [c["id"] for c in changes if c["before"]["status"] == "refused" and c["after"]["status"] == "accepted"],
        "targetWithinTenPercent": {phase: p["metrics"]["targetWithinTenPercent"] for phase, p in phases.items()},
        "nativeMsSingleRun": {phase: p["metrics"]["timing"]["nativePlanCalculationMs"] for phase, p in phases.items()},
        "executableSha256": {phase: p["metrics"]["timing"]["executableSha256"] for phase, p in phases.items()},
        "audits": audits, "sites": changes,
        "scope": "Same 128 frozen requests, original order. Independent GEOS rights and bilinear raster checks on exported native bearing structures only where explicitly marked. Legacy nativeFoundation fields remain Strip-only; singleFoundation reports Single separately and preparedFoundationBuildings gives their total. Deferred Single plans carry no physical certificate. Archive coordinates retain f64 bits. Area reporting tolerance 0.0001m2; terrain/ground numerical reporting tolerance 0.000001m/deg. No native execution, detail/roof/access certification or city/performance extrapolation. Before-phase structures may omit native supports and are not asserted to be a full bearing contract.",
    }
    output = ROOT / args.after / "foundation-comparison.json"
    with output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({k: report[k] for k in ("accepted", "lost", "gained", "targetWithinTenPercent", "nativeMsSingleRun")}, ensure_ascii=False))
    print(json.dumps({phase: {k: v for k, v in audit.items() if k != "sites"} for phase, audit in audits.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
