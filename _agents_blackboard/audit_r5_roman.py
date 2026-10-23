"""Offline audit only; reproduces the small MED-ANT automatic palette draw.
No house generation, native calls, or source mutation.
"""
import collections
import hashlib
import json
import math
from pathlib import Path
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "web/out/r5-roman"
STEM = "city-04-mountain-bay-s"
MASK = (1 << 32) - 1


class Rng:
    def __init__(self, key):
        self.key = key
        hashed = "burgmap:" + key[len("magna-urbis:"):] if key.startswith("magna-urbis:") else key
        h1, h2, h3, h4 = 1779033703, 3144134277, 1013904242, 2773480762
        raw = hashed.encode("utf-16-le")
        for i in range(0, len(raw), 2):
            k = raw[i] | raw[i + 1] << 8
            h1 = h2 ^ (((h1 ^ k) * 597399067) & MASK)
            h2 = h3 ^ (((h2 ^ k) * 2869860233) & MASK)
            h3 = h4 ^ (((h3 ^ k) * 951274213) & MASK)
            h4 = h1 ^ (((h4 ^ k) * 2716044179) & MASK)
        h1 = ((h3 ^ (h1 >> 18)) * 597399067) & MASK
        h2 = ((h4 ^ (h2 >> 22)) * 2869860233) & MASK
        h3 = ((h1 ^ (h3 >> 17)) * 951274213) & MASK
        h4 = ((h2 ^ (h4 >> 19)) * 2716044179) & MASK
        self.s = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
        for _ in range(12):
            self.next()

    def next(self):
        a, b, c, d = self.s
        t = (a + b + d) & MASK
        self.s = [b ^ (b >> 9), (c + (c << 3)) & MASK,
                  (((c << 21) | (c >> 11)) + t) & MASK, (d + 1) & MASK]
        return t / 4294967296

    def fork(self, label):
        return Rng(self.key + "\x01" + label)


def read(stage, kind):
    return json.loads((BASE / stage / f"{STEM}-{kind}.json").read_text(encoding="utf-8"))


recipes = json.loads((ROOT / "rust/crates/houses/data/recipes.json").read_text(encoding="utf-8"))["recipes"]
recipes = {r["id"]: r for r in recipes if r["pack_id"] == "MED-ANT" and r["weight"] > 0}


def shortlist(q):
    # All 369 automatic requests have precisely these conditions. Refuse to
    # approximate other cultures, pins, hard controls, periods or topologies.
    cfg, programme = q["config"], q["programme"]
    assert q["culture"]["pack"] == "MED-ANT" and cfg["mode"] == "historical_inspired"
    assert not cfg.get("recipe") and not q.get("typology") and cfg["era"] == "any"
    assert not any(v is not None for v in cfg["overrides"].values())
    assert programme["composition"] == "row" and programme["floors"] in ([1, 2], [2, 2])
    assert cfg["variation"] > 0
    buckets = collections.defaultdict(list)
    for r in recipes.values():
        lo, hi = r["parameters"]["floors"]
        wish_lo, wish_hi = programme["floors"]
        rank = (1, max(0, lo - wish_hi, wish_lo - hi))  # No native Strip in MED-ANT.
        buckets[rank].append(r)
    result = []
    for rank in sorted(buckets):
        entries = sorted(buckets[rank], key=lambda r: r["id"])
        rng = Rng(q["seed"]).fork("building-style-recipes-v1")
        while entries and len(result) < 4:
            target = math.floor(rng.next() * sum(r["weight"] for r in entries))
            for i, r in enumerate(entries):
                if target < r["weight"]:
                    break
                target -= r["weight"]
            r = entries.pop(i)
            variants = sorted(["default"] + [v["parameters"]["variant_id"] for v in r["variants"]])
            vrng = Rng(q["seed"]).fork("building-style-variants-v1").fork(r["id"])
            variant = variants[math.floor(vrng.next() * len(variants))]
            result.append(r["id"] + "::" + variant)
        if len(result) == 4:
            break
    return result


def area(surface):
    def ring(points):
        return abs(sum(a["x"] * b["y"] - b["x"] * a["y"]
                       for a, b in zip(points, points[1:] + points[:1]))) / 2
    return sum(ring(p["outer"]) - sum(ring(h) for h in p["holes"]) for p in surface)


requests = read("after", "placement-requests")
plans = read("after", "plans")
by_id = {r["id"]: r for r in requests}
refusals = {r["id"]: r for r in plans["refusals"]}
accepted = {r["id"]: r for r in plans["buildings"]}
auto = [r for r in requests if not r.get("config", {}).get("recipe")]
draws = {q["id"]: shortlist(q) for q in auto}
# A strong cross-check against existing native output; no new native run.
for ident, building in accepted.items():
    if ident in draws:
        assert building["recipe_id"] + "::" + building["variant_id"] in draws[ident], ident


def final_class(message):
    final = message.split(" An earlier candidate")[0]
    if final.startswith("Architecture exceeds physical"):
        return "terrain_final"
    if "no constrained composition operator" in final:
        return "unsupported_composition_final"
    if "cannot preserve minimum ranges" in final:
        return "minimum_span_final"
    if "no admissible composition" in final:
        return "bounded_search_final"
    if "No unobstructed planning connection" in final:
        return "access_final"
    return "other"


rows = []
for ident, refused in refusals.items():
    q = by_id[ident]
    message = refused["message"]
    terrain = re.findall(r"Required step ([\d.]+) m / allowed ([\d.]+) m; raster slope ([\d.]+) deg / allowed ([\d.]+) deg", message)
    row = {
        "id": ident, "role": q["programme"]["role"], "function": q["function"],
        "district": q["programme"].get("district_role"),
        "target_m2": q["programme"].get("built_area_m2"),
        "buildable_m2": area(q["buildable"]),
        "pin": q.get("config", {}).get("recipe"),
        "composition": q["programme"].get("composition"), "floors": q["programme"].get("floors"),
        "shortlist_reconstruction": draws.get(ident),
        "b01_in_shortlist": any(s.startswith("MED-ANT-B01::") for s in draws[ident]) if ident in draws else None,
        "final_class": final_class(message),
        "terrain_evidence": [dict(zip(("required_step_m", "allowed_step_m", "raster_slope_deg", "allowed_slope_deg"), map(float, t))) for t in terrain],
        "max_access_width_m": max((a["width_m"] for a in q["accesses"]), default=0),
        "message": message,
    }
    rows.append(row)

before_requests = {r["id"]: r for r in read("before", "placement-requests")}
before_plans = read("before", "plans")
before_ok = {r["id"] for r in before_plans["buildings"]}
after_ok = set(accepted)
summary = {
    "requests": len(requests), "accepted": len(accepted), "refused": len(refusals), "open": len(plans["open_spaces"]),
    "automatic": len(auto), "automatic_accepted": sum(x["id"] in accepted for x in auto),
    "automatic_refused": sum(x["id"] in refusals for x in auto),
    "gained": len(after_ok - before_ok), "lost": len(before_ok - after_ok),
    "same_geometry_terrain_access_requests": sum(all(q.get(k) == before_requests[q["id"]].get(k) for k in ("buildable", "cadastral", "reserves", "roof_domain", "accesses", "terrain")) for q in requests),
    "final_classes": dict(collections.Counter(x["final_class"] for x in rows)),
    "terrain_evidence_count": sum(bool(x["terrain_evidence"]) for x in rows),
    "terrain_step_only_count": sum(bool(x["terrain_evidence"]) and all(t["raster_slope_deg"] <= t["allowed_slope_deg"] for t in x["terrain_evidence"]) for x in rows),
    "terrain_slope_and_step_count": sum(any(t["raster_slope_deg"] > t["allowed_slope_deg"] for t in x["terrain_evidence"]) for x in rows),
    "auto_refusal_b01_present_terrain_cross": dict(collections.Counter(str((x["b01_in_shortlist"], bool(x["terrain_evidence"]))) for x in rows if x["pin"] is None)),
    "auto_shortlist_b01_missing": sum(not any(s.startswith("MED-ANT-B01::") for s in draw) for draw in draws.values()),
    "accepted_recipes": dict(collections.Counter(b["recipe_id"] for b in accepted.values())),
    "refused_roles": dict(collections.Counter(x["role"] for x in rows)),
    "refused_districts": dict(collections.Counter(x["district"] for x in rows)),
    "terrain_districts": dict(collections.Counter(x["district"] for x in rows if x["terrain_evidence"])),
    "sources": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [BASE / "after" / f"{STEM}-placement-requests.json", BASE / "after" / f"{STEM}-plans.json", ROOT / "rust/crates/houses/data/recipes.json"]},
    "shortlist_method": "Offline direct port of random::Rng UTF-16/sfc32, order_styles, source weights/ranges and Row/floor ranking; validates all261 native automatic accepted recipe/variants are in reconstructed shortlist. No geometry generated. Current MED-ANT-only guards asserted.",
}
auto_positive = [q for q in auto if (q["programme"].get("built_area_m2") or 0) > 0]
accepted_positive = [q for q in auto_positive if q["id"] in accepted]
ratios = [area(accepted[q["id"]]["footprint"]) / q["programme"]["built_area_m2"] for q in accepted_positive]
summary["automatic_budget"] = {
    "positive_targets": len(auto_positive), "accepted_positive_targets": len(accepted_positive),
    "met_within_ten_percent": sum(0.9 <= ratio <= 1.1 for ratio in ratios),
    "median_actual_target_ratio": sorted(ratios)[len(ratios) // 2],
    "capacity_certified": False,
}
output = ROOT / "_agents_blackboard/r5-roman-refusal-audit.json"
output.write_text(json.dumps({"summary": summary, "refusals": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
# Eight unmodified requests, selected for distinct limitations, not success claims.
witness_specs = [
    ("d85568ded9431341", "row_simple_source_missing", "No B01 among four courts; house target99.3m2; no recorded terrain failure."),
    ("b717fcd8e58837c7", "small_tenement_typology_gap", "No B01; target24.8m2 is below B01 nominal35m2 minimum; do not claim programme capacity from a fallback."),
    ("e28c4d5331723e1b", "simple_present_geometry_untraced", "B01/default already tried; shop target87m2; final message does not retain its own refusal."),
    ("2a77099a1d516ed1", "large_target_geometry_untraced", "B01/adobe already tried; target406.6m2 below inspired432 upper bound, no fit guaranteed."),
    ("a1cb4a99b0bd549c", "foundation_step_only", "Contained candidate required0.795m against0.75m, slope6.283deg; no tolerance relaxation."),
    ("46cad69c714e39be", "foundation_step_and_slope", "Contained candidate required1.316m and15.189deg; not a presumed shortlist gain."),
    ("a5bdac37759faea7", "access_and_earlier_terrain", "Final access failure plus earlier0.753m step; dimensions/terrain alone do not certify access."),
    ("71c5dc7176adaf8d", "functional_source_gap", "Horreum warehouse pinned by producer to domusB02; terrain failure also real; no authored horreum capability."),
]
witnesses, manifest = [], []
positions = {q["id"]: i for i, q in enumerate(requests)}
for suffix, category, purpose in witness_specs:
    found = [q for q in requests if q["parcel_id"].endswith(suffix)]
    assert len(found) == 1
    q = found[0]
    assert q["id"] in refusals
    witnesses.append(q)
    manifest.append({"id": q["id"], "original_position": positions[q["id"]], "category": category,
                     "purpose": purpose, "request_sha256_canonical_json": hashlib.sha256(json.dumps(q, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                     "archived_refusal": refusals[q["id"]]})
witness_path = ROOT / "_agents_blackboard/r5-roman-refusal-witnesses.json"
witness_path.write_text(json.dumps(witnesses, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
assert json.loads(witness_path.read_text(encoding="utf-8")) == witnesses
(ROOT / "_agents_blackboard/r5-roman-refusal-witnesses-manifest.json").write_text(json.dumps({
    "source": "web/out/r5-roman/after/city-04-mountain-bay-s-placement-requests.json",
    "source_sha256": summary["sources"][str((BASE / "after" / f"{STEM}-placement-requests.json").relative_to(ROOT))],
    "scope": "Eight exact request objects, no altered geometry/seed/programme. No replay performed. An isolated replay omits earlier accepted batch occupancy unless restored separately; original batch settings are not present in this request-array archive.",
    "witnesses": manifest,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
print("Non-terrain refusals:")
for x in rows:
    if not x["terrain_evidence"]:
        print(x["id"].split("/parcel-")[-1], x["role"], x["b01_in_shortlist"], round(x["buildable_m2"], 2), x["target_m2"], x["final_class"], x["shortlist_reconstruction"])
