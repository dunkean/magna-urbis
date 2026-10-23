"""Read-only analysis of recorded vector geography and native port snapshots.
Run from the repository root. No generation, requests, or filesystem mutation.
"""
import json
import math
from pathlib import Path
from collections import Counter
from shapely.geometry import Polygon, Point, GeometryCollection
from shapely.ops import unary_union


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def polygon(shape):
    return Polygon([(p["x"], p["y"]) for p in shape["outer"]],
                   [[(p["x"], p["y"]) for p in h] for h in shape.get("holes", [])])


def even_odd(rings):
    result = GeometryCollection()
    for ring in rings:
        result = result.symmetric_difference(polygon({"outer": ring}))
    return result


fixture = read("web/out/roman-port-proof/fixture.json")
geo = fixture["geometry"]
land = even_odd(geo["land"])
water = unary_union([even_odd(group) for group in geo["water"]])
dry = land.difference(water)
sources = [
    ("live8791", read("web/out/roman-user-04-8791/01-quarters-response.json")["layouts"][0],
     read("web/out/roman-user-04-8791/02-parcels-response.json")["partitions"][0]),
    *[(name, read(f"web/out/roman-port-proof/{name}/layouts.json")[0],
       read(f"web/out/roman-port-proof/{name}/partitions.json")[0])
      for name in ["before", "quay-profile"]],
]
output = {"fixtureProvenance": fixture["fixtureProvenance"], "datasets": {}}
for name, layout, partition in sources:
    environment = layout["programme"]["environment"]
    districts = layout["structure"]["districts"]
    ports = {d["id"] for d in districts if d["role"] == "port"}
    facts = []
    for i, e in enumerate(environment):
        if e.get("district") not in ports or not e.get("waterfront"):
            continue
        block = layout["blocks"][i]
        shape = polygon(block["shape"])
        outside = shape.difference(dry)
        vertices = [Point(p["x"], p["y"]) for p in block["shape"]["outer"]]
        outside_vertices = [p for p in vertices if not dry.covers(p)]
        parcels = [p for p in partition["parcels"] if p["block"] == i]
        facts.append({
            "block": i, "quarter": block["quarter"], "kind": block["kind"],
            "water": e.get("water"), "nativeWet": e["wet"], "slope": e["slope"],
            "areaM2": shape.area, "outsideDryM2": outside.area,
            "outsideRatio": outside.area / shape.area if shape.area else None,
            "centroidDry": dry.covers(shape.centroid),
            "outerVertices": len(vertices), "outsideVertices": len(outside_vertices),
            "verticesWithin10MicrometresOfBoundary": sum(dry.boundary.distance(p) < 1e-5 for p in vertices),
            "maxOutsideVertexDistanceM": max((dry.distance(p) for p in outside_vertices), default=0),
            "outsideVerticesFirst4": [{"x": p.x, "y": p.y, "distanceM": dry.distance(p)} for p in outside_vertices[:4]],
            "parcelUses": dict(Counter(p["use"] for p in parcels)),
            "witnessedParcels": sum(bool(p.get("envelope")) for p in parcels),
            "largestPublicContactM": max((c["length"] for p in parcels for c in p["contacts"] if c["kind"] == "public"), default=0),
        })
    output["datasets"][name] = {"portDistrictIds": sorted(ports), "shoreBlocks": facts}
print(json.dumps(output, ensure_ascii=False, indent=2))
