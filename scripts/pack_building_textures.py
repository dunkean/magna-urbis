"""Pack the browser texture atlases of the textured-materials view.

Python 3 + Pillow. Reads assets/materials/buildings (full PBR library, not served) and writes
web/src/render/assets/materials/{albedo.webp,normal.webp,materials.json}: square tiles stacked in a
vertical strip (tile i at y = i * TILE). Whole maps are resized (LANCZOS) so tiles stay seamless.
CC0 sources: Poly Haven, ambientCG.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "assets/materials/buildings"
OUT = ROOT / "web/src/render/assets/materials"
TILE = 256

# layer id -> (library folder, fallback extent in m is applied when the set has none)
LAYERS = {
    "clay_roof_tiles": "roof/polyhaven-clay_roof_tiles", "roof_slates_02": "roof/polyhaven-roof_slates_02",
    "roof_slates_03": "roof/polyhaven-roof_slates_03", "reed_roof_03": "roof/polyhaven-reed_roof_03",
    "reed_roof_04": "roof/polyhaven-reed_roof_04", "thatch_roof_angled": "roof/polyhaven-thatch_roof_angled",
    "WoodSiding010": "roof/ambientcg-WoodSiding010", "grass_ground": "special/polyhaven-grass_ground",
    "bark_brown_01": "wood/polyhaven-bark_brown_01", "Leather039": "special/ambientcg-Leather039",
    "Fabric034": "special/ambientcg-Fabric034", "clay_plaster": "wall/polyhaven-clay_plaster",
    "white_plaster_rough_01": "wall/polyhaven-white_plaster_rough_01", "snow_02": "special/polyhaven-snow_02",
    "japanese_stone_wall": "wall/polyhaven-japanese_stone_wall", "medieval_wood": "wood/polyhaven-medieval_wood",
    "brick_wall_001": "wall/polyhaven-brick_wall_001", "stone_wall": "wall/polyhaven-stone_wall",
    "raw_plank_wall": "wood/polyhaven-raw_plank_wall", "bamboo_wall": "wood/polyhaven-bamboo_wall",
    "Wicker013": "wood/ambientcg-Wicker013", "coral_stone_wall": "wall/polyhaven-coral_stone_wall",
    "cobblestone_floor_04": "ground_built/polyhaven-cobblestone_floor_04", "stone_tiles": "ground_built/polyhaven-stone_tiles",
    "gravel_ground_01": "ground_built/polyhaven-gravel_ground_01", "dirt_floor": "ground_built/polyhaven-dirt_floor",
    "old_planks_02": "ground_built/polyhaven-old_planks_02",
}
COVER = {"tile": "clay_roof_tiles", "slate": "roof_slates_02", "thatch": "thatch_roof_angled", "reed": "reed_roof_03",
         "bamboo": "bamboo_wall", "palm": "reed_roof_04", "shingle": "WoodSiding010", "turf": "grass_ground",
         "bark": "bark_brown_01", "hide": "Leather039", "felt": "Fabric034", "earth": "clay_plaster",
         "plaster": "white_plaster_rough_01", "stone": "japanese_stone_wall", "snow": "snow_02",
         "metal": "roof_slates_03", "lead": "roof_slates_03"}
WALL = {"timber": "medieval_wood", "brick": "brick_wall_001", "stone": "stone_wall", "earth": "clay_plaster",
        "wood": "raw_plank_wall", "plaster": "white_plaster_rough_01", "bamboo": "bamboo_wall", "wattle": "Wicker013",
        "hide": "Leather039", "coral": "coral_stone_wall"}
ROAD = {"street_main": "cobblestone_floor_04", "street_lane": "gravel_ground_01", "track": "dirt_floor", "ford": "dirt_floor",
        "place": "stone_tiles", "market": "stone_tiles", "quay": "stone_tiles", "stairs": "stone_tiles",
        "bridge": "stone_tiles", "bridge_timber": "old_planks_02", "causeway": "gravel_ground_01", "wall": "stone_wall"}


def main():
    ids = list(LAYERS)
    index = {k: i for i, k in enumerate(ids)}
    albedo = Image.new("RGB", (TILE, TILE * len(ids)))
    normal = Image.new("RGB", (TILE, TILE * len(ids)))
    layers = []
    for i, k in enumerate(ids):
        meta = json.loads((LIB / LAYERS[k] / "material.json").read_text(encoding="utf-8"))
        def load(sem):
            with Image.open(LIB / meta["maps"][sem]["path"]) as im:
                return im.convert("RGB").resize((TILE, TILE), Image.LANCZOS)
        a = load("base_color")
        albedo.paste(a, (0, i * TILE)); normal.paste(load("normal_gl"), (0, i * TILE))
        mean = [round(c) for c in a.resize((1, 1), Image.BOX).getpixel((0, 0))]
        ext = meta.get("physical_extent_m")
        layers.append(dict(id=k, source=LAYERS[k], extent_m=round(ext[0], 3) if ext and ext[0] > 0 else 2, mean_rgb=mean))
    OUT.mkdir(parents=True, exist_ok=True)
    albedo.save(OUT / "albedo.webp", quality=85, method=6)
    normal.save(OUT / "normal.webp", lossless=True, quality=90, method=6)
    manifest = dict(tile=TILE, layers=layers, cover={k: index[v] for k, v in COVER.items()},
                    wall={k: index[v] for k, v in WALL.items()}, road={k: index[v] for k, v in ROAD.items()})
    (OUT / "materials.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    for f in ("albedo.webp", "normal.webp", "materials.json"):
        print(f, (OUT / f).stat().st_size)


if __name__ == "__main__":
    main()
