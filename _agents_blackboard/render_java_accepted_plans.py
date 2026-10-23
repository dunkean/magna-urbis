"""Small offline view of the three accepted real Java witness plans."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon

root = Path(__file__).resolve().parents[1]
folder = root / "web/out/javanese-user-10-8791/houses-targeted"
batch = json.loads((folder / "integrated-ground-budget-after.json").read_text(encoding="utf-8"))
requests = json.loads((folder / "original-requests.json").read_text(encoding="utf-8"))["requests"]
sites = {site["id"]: site for site in requests}
fig, axes = plt.subplots(1, len(batch["buildings"]), figsize=(14, 5), squeeze=False)
for ax, building in zip(axes[0], batch["buildings"]):
    site = sites[building["id"]]
    points = [point for polygon in building["footprint"] for point in polygon["outer"]]
    cx = sum(point["x"] for point in points) / len(points)
    cy = sum(point["y"] for point in points) / len(points)
    def xy(points):
        return [(point["x"] - cx, point["y"] - cy) for point in points]
    for field, face, edge, alpha in [
        ("buildable", "#e5eddc", "#74836b", 1),
        ("circulation", "#d4ceb8", "#a59b79", 1),
        ("roof_footprint", "#d8b892", "#976d40", .5),
        ("footprint", "#b4734b", "#523623", 1),
    ]:
        for polygon in (site if field == "buildable" else building).get(field, []):
            ax.add_patch(Polygon(xy(polygon["outer"]), facecolor=face, edgecolor=edge, alpha=alpha))
            for hole in polygon.get("holes", []):
                ax.add_patch(Polygon(xy(hole), facecolor="white", edgecolor=edge))
    for access in site["accesses"]:
        coords = xy(access["segment"])
        ax.plot(*zip(*coords), color="#6b6e73", linewidth=3)
    for ridge in building["cartographic"]["ridges"]:
        ax.plot(*zip(*xy(ridge)), color="#523623", linewidth=1.6)
    extent = max(max(abs(x), abs(y)) for x, y in xy(points)) + 3
    ax.set_xlim(-extent, extent)
    ax.set_ylim(-extent, extent)
    ax.set_aspect("equal")
    ax.set_xlabel("m")
    ax.set_ylabel("m")
    target = site["programme"]["built_area_m2"]
    ax.set_title(f'{building["recipe_id"]} · {target:.1f} m² demandés\n{building["useful_area_m2"]:.2f} m² de plan natif')
fig.suptitle("Trois sites domestiques Java réels — plans compacts admis\nMême terrain et mêmes droits ; gros lots et autres refus restent à corriger", fontsize=14)
fig.tight_layout(rect=(0, 0, 1, .86))
fig.savefig(folder / "accepted-native-plans.png", dpi=140)
