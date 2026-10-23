"""Read-only provenance and support analysis for actual retained Magna native cities.

Example:
  python scripts/validate_surface_native_support.py --decor city.decor \
    --plans city-plans.json --requests city-placement-requests.json --limit 500

A construction plane may sit above naturally varying terrain. These observations
must not be described as constraint violations or used to reseat saved buildings.
"""
import argparse
import gzip
import hashlib
import json
import math
import statistics
import struct
from pathlib import Path


def stats(values):
    if not values:
        return {"count": 0}
    return {"count": len(values), "min": min(values), "max": max(values),
            "maxAbs": max(map(abs, values)), "mean": statistics.mean(values),
            "rms": math.sqrt(statistics.mean(value * value for value in values)),
            "median": statistics.median(values)}


def sample(values, width, height, ox, oz, spacing, x, z):
    u = max(0, min(width - 1, (x - ox) / spacing))
    v = max(0, min(height - 1, (z - oz) / spacing))
    ix, iz = int(u), int(v)
    jx, jz = min(ix + 1, width - 1), min(iz + 1, height - 1)
    fx, fz = u - ix, v - iz
    return (((1 - fx) * values[iz * width + ix] + fx * values[iz * width + jx]) * (1 - fz)
            + ((1 - fx) * values[jz * width + ix] + fx * values[jz * width + jx]) * fz)


def analyze(decor_path, plans_path, requests_path, limit):
    files = {"decor": decor_path, "plans": plans_path, "requests": requests_path}
    raw = gzip.decompress(decor_path.read_bytes())
    magic, version, header_length = struct.unpack_from("<III", raw)
    if magic != 0x4344554D or version != 1:
        raise ValueError("Expected retained Magna DECOR version 1")
    header = json.loads(raw[12:12 + header_length])
    n = header["n"]
    count = n * n
    if len(raw) != 12 + header_length + count * 17:
        raise ValueError("Invalid retained DECOR raster length")
    shuffled = raw[12 + header_length:12 + header_length + count * 4]
    ordered = bytearray(count * 4)
    for channel in range(4):
        ordered[channel::4] = shuffled[channel * count:(channel + 1) * count]
    heights = struct.unpack("<" + "f" * count, ordered)
    spacing = header["width"] / n
    origin = spacing / 2
    plans = json.loads(plans_path.read_text())["buildings"][:limit]
    requests = {request["parcel_id"]: request for request in json.loads(requests_path.read_text())}
    aligned = unaligned = outside = 0
    node_delta, point_delta, plane_delta, building_max, ground_delta = [], [], [], [], []
    foundation_limits = set()
    for plan in plans:
        request = requests[plan["parcel_id"]]
        grid = request["terrain"]["grid"]
        ox, oz = grid["origin"]["x"], grid["origin"]["y"]
        step, width, height = grid["step_m"], grid["width"], grid["height"]
        foundation_limits.add(request["terrain"].get("max_foundation_step_m"))
        ground_delta.append(plan["ground_z_m"] - request["terrain"]["ground_z_m"])
        for j in range(height):
            for i in range(width):
                u, v = (ox + i * step - origin) / spacing, (oz + j * step - origin) / spacing
                if abs(u - round(u)) > 1e-9 or abs(v - round(v)) > 1e-9:
                    unaligned += 1
                    continue
                if not (0 <= round(u) < n and 0 <= round(v) < n):
                    raise ValueError("Native request sample falls outside retained source")
                aligned += 1
                node_delta.append(grid["elevations_m"][j * width + i] - heights[round(v) * n + round(u)])
        deltas = []
        for shape in plan["footprint"]:
            for point in shape["outer"]:
                x, z = point["x"], point["y"]
                bed = sample(heights, n, n, origin, origin, spacing, x, z)
                delta = bed - plan["ground_z_m"]
                plane_delta.append(delta)
                deltas.append(abs(delta))
                if x < ox or z < oz or x > ox + (width - 1) * step or z > oz + (height - 1) * step:
                    outside += 1
                    continue
                point_delta.append(sample(grid["elevations_m"], width, height, ox, oz, step, x, z) - bed)
        if deltas:
            building_max.append(max(deltas))
    return {"sourceFiles": {key: str(path.resolve()) for key, path in files.items()},
            "sha256": {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in files.items()},
            "buildings": len(plans), "matchedRequests": len(plans), "alignedSamples": aligned,
            "unalignedSamples": unaligned, "pointsOutsideRequest": outside,
            "acceptedRequestMaxFoundationStepM": sorted(foundation_limits, key=lambda x: -1 if x is None else x),
            "requestGridMinusRetainedDecorM": stats(node_delta),
            "requestInterpolantMinusRetainedDecorM": stats(point_delta),
            "sourceFootprintBedMinusConstructionPlaneM": stats(plane_delta),
            "perBuildingMaxAbsBedMinusConstructionPlaneM": stats(building_max),
            "planGroundMinusRequestGroundM": stats(ground_delta),
            "note": "Natural footprint relief relative to a native construction plane is not a demonstrated foundation violation. Exact request grids compare original coordinates; no generation or repositioning."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("decor", "plans", "requests"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    result = analyze(args.decor, args.plans, args.requests, args.limit)
    encoded = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n")
    print(encoded)
