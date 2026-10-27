"""Collect the curated building PBR library, without changing the renderer.

Python 3 + Pillow. Run from any directory; --verify is completely offline.
Powered by Poly Haven (https://polyhaven.com/) and ambientCG.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import zipfile

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "assets/materials/buildings"
CATALOGUE = ROOT / "rust/crates/houses/data/recipes.json"
HEADERS = {"User-Agent": "MagnaUrbis-TextureCollection/1.0 (offline asset preparation)"}


def fetch(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as r:
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def api(url):
    return json.loads(fetch(url))


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def file_record(path, data, url, **extra):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Validate decoded images before retaining them (never store an HTML error as a map).
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        dimensions = list(image.size)
    path.write_bytes(data)
    return dict(path=path.relative_to(LIB).as_posix(), url=url, bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(), pixels=dimensions, **extra)


def collect(selection):
    provider, asset = selection["provider"], selection["asset_id"]
    folder = LIB / selection["family"] / f"{provider}-{asset}"
    meta_path = folder / "material.json"
    if meta_path.exists():
        previous = json.loads(meta_path.read_text(encoding="utf-8"))
        if {"base_color", "normal_gl", "roughness", "height"} <= previous["maps"].keys() and all((LIB / m["path"]).exists() and hashlib.sha256((LIB / m["path"]).read_bytes()).hexdigest() == m["sha256"]
               for m in previous["maps"].values()):
            previous.update(selection)
            save_json(meta_path, previous)
            return previous
    maps = {}
    if provider == "polyhaven":
        info = api(f"https://api.polyhaven.com/info/{asset}")
        files = api(f"https://api.polyhaven.com/files/{asset}")
        slots = {"base_color": "Diffuse", "normal_gl": "nor_gl", "roughness": "Rough", "height": "Displacement", "ao": "AO"}
        for semantic, key in slots.items():
            formats = files.get(key, {}).get("1k", {})
            if not formats:
                continue
            # Colour JPEG; data maps lossless PNG wherever supplied by the source.
            ext = next(e for e in (["jpg", "png"] if semantic == "base_color" else ["png", "jpg"]) if e in formats)
            source = formats[ext]
            local = folder / source["url"].rsplit("/", 1)[1]
            cached = local.read_bytes() if local.exists() else b""
            data = cached if len(cached) == source["size"] and hashlib.md5(cached).hexdigest() == source["md5"] else fetch(source["url"])
            if len(data) != source["size"] or hashlib.md5(data).hexdigest() != source["md5"]:
                raise ValueError(f"Source integrity mismatch: {asset}/{key}")
            maps[semantic] = file_record(folder / source["url"].rsplit("/", 1)[1], data, source["url"],
                                         source_md5=source["md5"], color_space="sRGB" if semantic == "base_color" else "linear")
        dims = info.get("dimensions") or []  # Poly Haven API: millimetres.
        extent = [v / 1000 for v in dims[:2]] if len(dims) >= 2 and all(v > 0 for v in dims[:2]) else None
        provenance = dict(page=f"https://polyhaven.com/a/{asset}", license="CC0-1.0",
                          license_url="https://polyhaven.com/license", authors=info.get("authors"),
                          name=info["name"], tags=info.get("tags"),
                          api_info_url=f"https://api.polyhaven.com/info/{asset}")
        height_amplitude = None  # A greyscale displacement is not a calibrated metric amplitude.
        scale_source = "Poly Haven API dimensions (mm converted to m)" if extent else "unknown"
    else:
        url = "https://ambientcg.com/api/v2/full_json?" + urllib.parse.urlencode({
            "id": asset, "include": "downloadData,dimensionsData,tagData"})
        results = api(url)["foundAssets"]
        info = next(x for x in results if x["assetId"] == asset)
        downloads = info["downloadFolders"]["default"]["downloadFiletypeCategories"]["zip"]["downloads"]
        download = next(x for x in downloads if x["attribute"] == "1K-JPG")
        archive = fetch(download["downloadLink"])
        if len(archive) != download["size"]:
            raise ValueError(f"Archive size mismatch: {asset}")
        slots = {"Color": "base_color", "NormalGL": "normal_gl", "Roughness": "roughness",
                 "Displacement": "height", "AmbientOcclusion": "ao", "Metalness": "metalness", "Opacity": "opacity"}
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            if z.testzip() is not None:
                raise ValueError(f"Corrupt archive: {asset}")
            for member in z.namelist():
                name = Path(member).name
                semantic = slots.get(Path(name).stem.rsplit("_", 1)[-1])
                if semantic and Path(name).suffix.lower() in (".jpg", ".png"):
                    maps[semantic] = file_record(folder / name, z.read(member), download["downloadLink"],
                                                 archive_member=member, color_space="sRGB" if semantic == "base_color" else "linear")
        # ambientCG dimensions are centimetres; 0 means unspecified, not a zero-size tile.
        dims = [info.get("dimensionX", 0), info.get("dimensionY", 0)]
        extent = [v / 100 for v in dims] if all(v > 0 for v in dims) else None
        z = info.get("dimensionZ", 0)
        height_amplitude = z / 100 if z and z > 0 else None
        scale_source = "ambientCG API dimensions (cm converted to m)" if extent else "unknown"
        provenance = dict(page=f"https://ambientcg.com/a/{asset}", license="CC0-1.0",
                          license_url="https://docs.ambientcg.com/license/", authors=["ambientCG / Lennart Demes"],
                          name=info.get("displayName", asset), tags=info.get("tags"), api_info_url=url,
                          archive_url=download["downloadLink"], archive_sha256=hashlib.sha256(archive).hexdigest())
    required = {"base_color", "normal_gl", "roughness", "height"}
    if not required <= maps.keys():
        raise ValueError(f"Incomplete PBR set {asset}: missing {required - maps.keys()}")
    result = dict(**selection, provenance=provenance, resolution="1k", normal_convention="OpenGL (+Y)",
                  physical_extent_m=extent, scale_source=scale_source, height_amplitude_m=height_amplitude,
                  maps=maps, downloaded_at=datetime.now(timezone.utc).isoformat())
    save_json(meta_path, result)
    print(f"OK {provider}/{asset}: {len(maps)} maps", flush=True)
    return result


def native_coverage(selections):
    native = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    policy = json.loads((LIB / "selection.json").read_text(encoding="utf-8"))["material_qualifications"]
    coverage = {}
    for m in native["materials"]:
        ids = [f'{s["provider"]}-{s["asset_id"]}' for s in selections if m["id"] in s["native_material_ids"]]
        qualification = policy.get(m["id"], {"status": "direct", "note": "Surface de la même famille ; la géométrie constructive reste à fournir."})
        coverage[m["id"]] = dict(**qualification, textures=ids)
        if not ids and qualification["status"] != "missing":
            raise ValueError(f"Unaccounted native material: {m['id']}")

    def materials(value):
        found = set()
        if isinstance(value, dict):
            for child in value.values():
                found.update(materials(child))
        elif isinstance(value, list):
            for child in value:
                found.update(materials(child))
        elif isinstance(value, str) and value.startswith("MAT-"):
            found.add(value)
        return found

    packs = []
    for pack in native["packs"]:
        recipes = [r for r in native["recipes"] if r["pack_id"] == pack["id"]]
        mids = sorted(materials(recipes))
        packs.append(dict(pack_id=pack["id"], recipe_count=len(recipes), native_material_ids=mids,
                          direct=[m for m in mids if coverage[m]["status"] == "direct"],
                          proxy=[m for m in mids if coverage[m]["status"] == "proxy"],
                          missing=[m for m in mids if coverage[m]["status"] == "missing"]))
    return coverage, packs


def previews(entries):
    width, height, columns = 240, 282, 6
    sheet = Image.new("RGB", (width * columns, height * ((len(entries) + columns - 1) // columns)), "#ece8e0")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    for index, entry in enumerate(entries):
        x, y = index % columns * width, index // columns * height
        with Image.open(LIB / entry["maps"]["base_color"]["path"]) as im:
            im = im.convert("RGB")
            im.thumbnail((224, 224))
            sheet.paste(im, (x + 8, y + 8))
        label = entry["asset_id"]
        draw.text((x + 8, y + 236), label[:31], fill="#171717", font=font)
        draw.text((x + 8, y + 256), entry["family"] + " / " + entry["provider"], fill="#484848", font=font)
    sheet.save(LIB / "contact-sheet.jpg", quality=88)


def write_readme(catalog):
    entries = catalog["textures"]
    count = sum(len(e["maps"]) for e in entries)
    size = sum(m["bytes"] for e in entries for m in e["maps"].values()) / 1024 ** 2
    lines = ["# Textures de bâtiments — collection hors ligne", "", "[English](README.md)", "",
             f"{len(entries)} jeux PBR, {count} cartes, {size:.1f} Mio de cartes. Résolution source 1K, fichiers originaux sans retouche.", "",
             "Collecte seule : aucun branchement au moteur, aucune affectation automatique aux bâtiments.", "",
             "[Guide et limites](../../../docs/BUILDING_TEXTURE_LIBRARY.md) · [Planche des couleurs](contact-sheet.jpg) · "
             "[Catalogue complet](catalog.json) · [Sélection et qualifications](selection.json)", "",
             "Powered by [Poly Haven](https://polyhaven.com/) et [ambientCG](https://ambientcg.com/). "
             "Les cartes téléchargées sont sous [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), "
             "selon les licences [Poly Haven](https://polyhaven.com/license) et "
             "[ambientCG](https://docs.ambientcg.com/license/). Les aperçus sont dérivés des cartes couleur, pas des rendus du site.", "",
             "## Types disponibles", "",
             "Les identifiants `MAT-*` sont des pistes d’emploi documentaire. Leur qualification "
             "`direct`, `proxy` ou `missing` figure dans la table suivante. Les profils culturels "
             "et l’appareillage doivent être contrôlés lors de l’intégration.", "",
             "| Texture / fournisseur | Type | Matériaux natifs candidats | Emprise (m) | Cartes | Note |",
             "|---|---|---|---|---|---|"]
    for e in entries:
        extent = " × ".join(f"{v:g}" for v in e["physical_extent_m"]) if e["physical_extent_m"] else "inconnue"
        folder = Path(e["maps"]["base_color"]["path"]).parent.as_posix()
        lines.append(f'| [{e["asset_id"]}]({folder}/material.json) ([source]({e["provenance"]["page"]})) '
                     f'| {e["type_fr"]} | {", ".join(e["native_material_ids"])} | {extent} '
                     f'| {", ".join(e["maps"])} | {e["notes_fr"]} |')
    lines += ["", "## Couverture des 39 matériaux natifs", "",
              "`direct` : matière de la même famille ; `proxy` : approximation explicitement qualifiée ; "
              "`missing` : aucun fichier retenu. Même `direct` ne certifie ni la provenance historique "
              "ni la géométrie constructive.", "",
              "| Matériau | Statut | Jeux candidats | Limite |", "|---|---|---|---|"]
    for mid, c in catalog["material_coverage"].items():
        lines.append(f'| `{mid}` | {c["status"]} | {", ".join(c["textures"]) or "—"} | {c["note"]} |')
    lines += ["", "## Couverture des 32 packs architecturaux", "",
              "Inventaire calculé à partir des matériaux de toutes les recettes, variantes et composants "
              "de `rust/crates/houses/data/recipes.json`, y compris les champs de structure et de cordage. Le détail complet est dans `catalog.json`. "
              "Les nombres comptent des familles de matériaux, pas des styles validés visuellement.", "",
              "| Pack | Recettes | Matières directes | Matières approchées | Matières absentes |",
              "|---|---:|---:|---|---|"]
    for p in catalog["pack_coverage"]:
        lines.append(f'| `{p["pack_id"]}` | {p["recipe_count"]} | {len(p["direct"])} '
                     f'| {", ".join(p["proxy"]) or "—"} | {", ".join(p["missing"]) or "—"} |')
    (LIB / "README_FR.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def verify(catalog):
    count, total = 0, 0
    for entry in catalog["textures"]:
        dimensions = set()
        for semantic, m in entry["maps"].items():
            path = LIB / m["path"]
            data = path.read_bytes()
            assert len(data) == m["bytes"] and hashlib.sha256(data).hexdigest() == m["sha256"], path
            with Image.open(path) as im:
                im.load()
                assert list(im.size) == m["pixels"], path
                dimensions.add(im.size)
            count += 1
            total += len(data)
        assert len(dimensions) == 1, entry["asset_id"]
        assert {"base_color", "normal_gl", "roughness", "height"} <= entry["maps"].keys()
    assert len(catalog["material_coverage"]) == 39
    assert len(catalog["pack_coverage"]) == 32
    assert len({(e["provider"], e["asset_id"]) for e in catalog["textures"]}) == len(catalog["textures"])
    coverage, packs = native_coverage(catalog["textures"])
    assert coverage == catalog["material_coverage"] and packs == catalog["pack_coverage"], "Native catalogue coverage changed"
    assert catalog["native_catalogue_sha256"] == hashlib.sha256(CATALOGUE.read_bytes()).hexdigest(), "Native catalogue changed"
    print(f"Verified {len(catalog['textures'])} PBR sets, {count} maps, {total / 1024 ** 2:.1f} MiB; 39 materials / 32 packs.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="check retained files offline")
    args = parser.parse_args()
    path = LIB / "catalog.json"
    if args.verify:
        verify(json.loads(path.read_text(encoding="utf-8")))
        return
    selections = json.loads((LIB / "selection.json").read_text(encoding="utf-8"))["textures"]
    # Two bounded workers to avoid hammering the public services.
    with ThreadPoolExecutor(max_workers=2) as pool:
        entries = list(pool.map(collect, selections))
    coverage, packs = native_coverage(entries)
    catalog = dict(schema_version=1, purpose="offline collection; not integrated in renderer", resolution="1k",
                   native_catalogue_sha256=hashlib.sha256(CATALOGUE.read_bytes()).hexdigest(),
                   material_coverage=coverage, pack_coverage=packs, textures=entries)
    save_json(path, catalog)
    previews(entries)
    write_readme(catalog)
    # Regenerate the primary English guide from the preserved French source.
    import runpy
    runpy.run_path(str(Path(__file__).with_name("translate_building_textures.py")))
    verify(catalog)


if __name__ == "__main__":
    main()
