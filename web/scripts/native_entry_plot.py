"""Plot eight frozen native-entry witnesses; no native generation or UI capture.

Uses the same exported-surface/bit decoding helpers as the foundation proof.
Every pair has one cadastral camera. Native portals come only from resolved;
the old placement proxy is drawn separately, never called a native portal.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import PathPatch, Patch
from matplotlib.path import Path as PlotPath
from shapely import affinity
from shapely.geometry import LineString
from shapely.geometry.polygon import orient

from native_foundation_compare import float_bits, load, polygons, surface

REPO = Path(__file__).resolve().parents[2]
BASE = REPO / "web/out/native-foundation-detail-proof"
AFTER = REPO / "web/out/native-entry-contact-cli-proof"
COLORS = dict(body="#765547", court="#a4c89c", path="#c8dded",
              public="#368bc1", portal="#b72773", obstacle="#d57669",
              structure="#b28a42", front="#12647c", proxy="#555b65")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def world(geometry, building):
    transform = building["transform"]
    rotated = affinity.rotate(geometry, transform["orientation_deg"], origin=(0, 0))
    return affinity.translate(rotated, transform["origin"]["x"], transform["origin"]["y"])


def draw(ax, geometry, origin, color, *, edge=None, alpha=1, hatch=None,
         linewidth=.8, linestyle="-", zorder=1):
    """Compound paths preserve holes instead of repainting them as white."""
    for polygon in polygons(geometry):
        polygon = orient(polygon, sign=1.)
        vertices, codes = [], []
        for ring in [polygon.exterior, *polygon.interiors]:
            points = [(x-origin[0], y-origin[1]) for x, y in ring.coords]
            vertices.extend(points)
            codes.extend([PlotPath.MOVETO] + [PlotPath.LINETO]*(len(points)-2) + [PlotPath.CLOSEPOLY])
        ax.add_patch(PathPatch(PlotPath(vertices, codes), facecolor=color,
                              edgecolor=edge or color, linewidth=linewidth,
                              alpha=alpha, hatch=hatch, linestyle=linestyle,
                              zorder=zorder))


def line(ax, points, origin, **kwargs):
    ax.plot([p[0]-origin[0] for p in points], [p[1]-origin[1] for p in points], **kwargs)


def detail_records(path):
    records = load(path)["details"]
    return {(r["id"], r["interiors"]): r for r in records}


def panel(ax, request, building, details, camera, phase, source_index):
    origin, extent = camera["origin_m"], camera["extent_relative_m"]
    draw(ax, surface(request["cadastral"]), origin, "#faf9f3", edge="#353d42")
    draw(ax, surface(request["buildable"]), origin, "none", edge="#a2ab91", linestyle="--")
    for neighbor in request.get("neighbors", []):
        draw(ax, surface(neighbor["footprint"]), origin, COLORS["obstacle"], alpha=.4, hatch="xx")
    draw(ax, surface(request.get("reserves", [])), origin, COLORS["obstacle"], alpha=.4, hatch="xx")
    compact = float_bits(building["resolved"])
    local_paths = world(surface(compact["surfaces"][compact["paths"]]), building)
    circulation = surface(building["circulation"])
    public = circulation.difference(local_paths)
    draw(ax, surface(building["courtyards"]), origin, COLORS["court"])
    draw(ax, local_paths, origin, COLORS["path"])
    draw(ax, public, origin, COLORS["public"], alpha=.7, zorder=2)
    draw(ax, surface(building["footprint"]), origin, COLORS["body"], edge="#483b34", zorder=3)
    for feature in building["structural_features"]:
        draw(ax, surface(feature["surface"]), origin, COLORS["structure"], edge="#775f36", zorder=4)
    draw(ax, surface(building["roof_footprint"]), origin, "none", edge="#b4a08b", linestyle=":", zorder=5)
    for access in request["accesses"]:
        points = [(p["x"], p["y"]) for p in access["segment"]]
        line(ax, points, origin, color=COLORS["front"], linewidth=2.3,
             linestyle="-" if access["kind"] == "public" else "--", zorder=6)
    entry = compact.get("entrance")
    portal_world = None
    if entry:
        portal_world = world(LineString([(p["x"], p["y"]) for p in entry["opening"]]), building)
        passage_world = world(surface(entry["passage"]), building)
        draw(ax, passage_world, origin, "none", edge=COLORS["portal"],
             hatch="////", linewidth=1.25, zorder=7)
        line(ax, list(portal_world.coords), origin, color=COLORS["portal"], linewidth=3.2,
             marker="o", markersize=2.1, zorder=8)
        entry_label = "portail natif conservé"
    else:
        proxy = building.get("entrance")
        if proxy:
            line(ax, [(proxy["x"], proxy["y"])], origin, color=COLORS["proxy"],
                 marker="x", markersize=6, markeredgewidth=1.4, zorder=8)
        entry_label = "portail natif absent · proxy ×"
    interior = details[(building["id"], True)]
    exterior = details[(building["id"], False)]
    status = "intérieur validé" if interior["ok"] else "intérieur refusé"
    area = surface(building["footprint"]).area
    ax.set_title(f"{phase} · index {source_index} · {status}\n"
                 f"{building['recipe_id']} · {area:.2f} m² · {entry_label}",
                 fontsize=9.2, color="#1e4837" if interior["ok"] else "#713e3d", pad=8)
    ax.set(xlim=extent[:2], ylim=extent[2:])
    ax.set_aspect("equal")
    ax.tick_params(labelsize=7)
    ax.set_xlabel("m depuis l’origine commune du cadrage", fontsize=7)
    ax.grid(alpha=.12, linewidth=.5)
    return dict(body_area_m2=area, native_portal=portal_world is not None,
                native_portal_world=list(portal_world.coords) if portal_world else None,
                public_circulation_area_m2=public.area,
                interior_ok=interior["ok"], interior_error=interior["error"],
                exterior_ok=exterior["ok"],
                transform=building["transform"], generator_version=compact["generator_version"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=AFTER / "geometry-proof")
    args = parser.parse_args()
    sources = dict(requests=BASE / "requests.json", selection=BASE / "selection.json",
                   before_plans=BASE / "after/plans.json", before_details=BASE / "after/details.json",
                   after_plans=AFTER / "eight-plans.json", after_details=AFTER / "eight-details.json")
    hashes = {name: sha(path) for name, path in sources.items()}
    selected = load(sources["selection"])["sites"]
    assert len(selected) == 8, "This proof has exactly eight frozen witnesses."
    assert hashes["requests"] == load(sources["selection"])["requestSha256"]
    requests = {r["id"]: r for r in load(sources["requests"])["requests"]}
    plans = [{b["id"]: b for b in load(sources[f"{phase}_plans"])["buildings"]}
             for phase in ("before", "after")]
    details = [detail_records(sources[f"{phase}_details"]) for phase in ("before", "after")]
    assert all(set(p) == set(requests) for p in plans), "No missing or additional plan."
    args.output.mkdir(parents=True, exist_ok=False)
    legend = [Patch(facecolor=COLORS["body"], label="Corps"),
              Patch(facecolor=COLORS["court"], label="Cour ouverte"),
              Patch(facecolor=COLORS["path"], label="Circulation native"),
              Patch(facecolor=COLORS["public"], label="Raccord vers la rue"),
              Patch(facecolor=COLORS["structure"], label="Appuis / structures"),
              Patch(facecolor=COLORS["obstacle"], hatch="xx", label="Obstacles déclarés"),
              Line2D([], [], color=COLORS["front"], lw=2, label="Front public (autre : tirets)"),
              Line2D([], [], color=COLORS["portal"], lw=3, label="Portail réel + passage hachuré"),
              Line2D([], [], color=COLORS["proxy"], marker="x", ls="none", label="Ancien point proxy")]
    report = dict(version="native-entry-geometric-proof-1", capturedUtc=datetime.now(timezone.utc).isoformat(),
                  inputs={k: dict(path=str(v.relative_to(REPO)), sha256=hashes[k]) for k, v in sources.items()},
                  script=dict(path=str(Path(__file__).relative_to(REPO)), sha256=sha(Path(__file__))),
                  scope="Offline exported geometry, not a detailed mesh rendering. Native portals are decoded from stored resolved float bits. Detail statuses are existing native replay results. No native run or plan changes.",
                  rendering="Same cadastral camera for each pair. Native circulation is transformed from stored paths; blue street connector is exported circulation minus those paths. Holes preserved. Roof outline dotted, buildable outline dashed. Declared reserves/neighbors only, no invented adjacent buildings.",
                  sites=[], images=[])
    for page in range(2):
        fig, axes = plt.subplots(4, 2, figsize=(12, 16), squeeze=False)
        for row, selected_site in enumerate(selected[page*4:page*4+4]):
            rid = selected_site["id"]
            request = requests[rid]
            x0, y0, x1, y1 = surface(request["cadastral"]).bounds
            center = [(x0+x1)/2, (y0+y1)/2]
            half = max(x1-x0, y1-y0)*.58 + .5
            camera = dict(origin_m=center, extent_relative_m=[-half, half, -half, half])
            phases = [panel(axes[row][col], request, plans[col][rid], details[col], camera,
                            "Avant : fondations" if col == 0 else "Après : entrée native", selected_site["sourceIndex"])
                      for col in range(2)]
            report["sites"].append(dict(id=rid, sourceIndex=selected_site["sourceIndex"], camera=camera,
                                        declared_reserves=len(request["reserves"]), declared_neighbors=len(request["neighbors"]),
                                        before=phases[0], after=phases[1]))
        fig.suptitle(f"Entrées natives — comparaison géométrique {page+1}/2\n"
                     "Mêmes demandes et cadastres · statut intérieur issu du rejeu natif enregistré", fontsize=13, y=.993)
        fig.legend(handles=legend, loc="lower center", ncol=3, fontsize=8, frameon=False, bbox_to_anchor=(.5, .003))
        fig.tight_layout(rect=(0, .06, 1, .958), h_pad=2.)
        filename = f"native-entry-before-after-{page+1}.png"
        path = args.output / filename
        fig.savefig(path, dpi=160, facecolor="white")
        plt.close(fig)
        report["images"].append(dict(path=filename, sha256=sha(path)))
    assert hashes == {k: sha(v) for k, v in sources.items()}, "Input changed during plotting."
    report["summary"] = dict(interiors_before=sum(r["before"]["interior_ok"] for r in report["sites"]),
                             interiors_after=sum(r["after"]["interior_ok"] for r in report["sites"]),
                             exteriors_after=sum(r["after"]["exterior_ok"] for r in report["sites"]),
                             changed_poses=sum(r["before"]["transform"] != r["after"]["transform"] for r in report["sites"]),
                             max_abs_body_area_change_m2=max(abs(r["after"]["body_area_m2"]-r["before"]["body_area_m2"]) for r in report["sites"]))
    (args.output / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(dict(output=str(args.output), **report["summary"]), ensure_ascii=False))


if __name__ == "__main__":
    main()
