"""Validate retained sources, diagnostics and physical invariants on all tiles."""
import argparse
import gzip
from pathlib import Path

import numpy as np
from PIL import Image

from surface_context import ROOT, RADII, ROCK_FIELDS, digest, read_json, write_json, load_hydrology


def validate(root, only=None):
    catalog = read_json(root / "catalog.json")
    report, geology_hashes = [], {}
    compiler = digest((Path(__file__).parent / "surface_context.py").read_bytes())
    for entry in catalog["tiles"]:
        if only and entry["id"] != only:
            continue
        directory = (root / entry["file"]).parent
        meta = read_json(directory / "tile.json")
        ground = meta["ground"]
        assert ground["version"] == 2
        assert ground == entry["ground"], "Catalogue out of sync"
        source = ground["sources"]
        assert source["compiler"] == compiler, "Compiler changed since generation"
        assert source["height"] == meta["heightSha256"] == digest((directory / meta["height"]).read_bytes())
        assert source["hydrology"] == digest((directory / meta["hydrology"]["grids"]["file"]).read_bytes())
        assert source["settings"] == meta["hydrology"]["settings"]
        assert source["runoff"] == meta["hydrology"]["runoff"]
        assert source["temperature"] == meta["temperature"]
        assert source["precipitation"] == meta["precipitation"]
        assert digest((directory / meta["map"]).read_bytes()) == meta["hydrology"]["mapSha256"]
        assert digest((directory / meta["hydrology"]["surface"]).read_bytes()) == meta["hydrology"]["surfaceSha256"]
        grids = ground["grids"]
        archive = (directory / grids["file"]).read_bytes()
        assert digest(archive) == grids["sha256"]
        blob = gzip.decompress(archive)
        offset, fields = 0, {}
        for name, spec in grids["fields"].items():
            assert spec["offset"] == offset
            offset += spec["bytes"]
            dtype = "u1" if spec["type"] == "Uint8Array" else "<f4"
            assert spec["bytes"] == meta["n"] ** 2 * np.dtype(dtype).itemsize
            fields[name] = np.frombuffer(blob, dtype=dtype, count=meta["n"] ** 2, offset=spec["offset"]).reshape(meta["n"], meta["n"])
        assert len(blob) == offset
        soil = fields["soilMask"].astype(bool)
        h = load_hydrology(directory, meta)
        np.testing.assert_array_equal(soil, ~(h["sea"].astype(bool) | h["lake"].astype(bool)))
        for name, a in fields.items():
            if name != "hand":
                assert np.all(np.isfinite(a)), name + " has non-finite values"
        for name in ("sand", "silt", "clay", "organic", "stoniness", "moisture", "confidence", "permeability", "hardness", "weatherability"):
            assert np.all((fields[name] >= 0) & (fields[name] <= 1)), name
        np.testing.assert_allclose(fields["sand"] + fields["silt"] + fields["clay"], 1, atol=2.e-6)
        upstream = sum(fields["upstream" + name] for name in ("Granite", "Limestone", "Sandstone", "Marl", "Basalt"))
        np.testing.assert_allclose(upstream[soil], 1, atol=2.e-6)
        for radius in RADII:
            assert np.all((fields[f"geomorphon{radius}"] >= 1) & (fields[f"geomorphon{radius}"] <= 10))
        assert np.all((fields["bedrock"] >= 1) & (fields["bedrock"] <= 5))
        mixture = np.stack([fields[name] for name in ROCK_FIELDS], axis=-1)
        assert np.all((mixture >= 0) & (mixture <= 1))
        np.testing.assert_allclose(mixture.sum(axis=-1), 1, atol=2.e-6)
        np.testing.assert_array_equal(np.argmax(mixture, axis=-1) + 1, fields["bedrock"])
        np.testing.assert_allclose(fields["hardness"], (mixture @ np.array([.85,.57,.67,.24,.91])) * (.94+.12*fields["bedrockVariation"]), rtol=2.e-6)
        contact_steps, class_steps = [], []
        discrete_hardness = np.array([0,.85,.57,.67,.24,.91])[fields["bedrock"]]
        for axis in (0, 1):
            contact = np.diff(fields["bedrock"].astype(np.int16), axis=axis) != 0
            contact_steps.append(np.abs(np.diff(fields["hardness"], axis=axis))[contact])
            class_steps.append(np.abs(np.diff(discrete_hardness, axis=axis))[contact])
        steps = np.concatenate(contact_steps)
        contact_mean = float(np.mean(steps)) if steps.size else 0
        class_mean = float(np.mean(np.concatenate(class_steps))) if steps.size else 0
        if steps.size:
            assert contact_mean < class_mean * .5, "Material properties still follow hard class boundaries"
        # Same geological field for every climate of a terrain family.
        geo_hash = digest(mixture.tobytes())
        assert geology_hashes.setdefault(meta["family"], geo_hash) == geo_hash
        raw = np.frombuffer((directory / meta["height"]).read_bytes(), "<f4").reshape(meta["n"], meta["n"])
        valid = fields["handReferenceKind"] <= 3
        np.testing.assert_allclose(fields["hand"][valid], np.maximum(0, raw[valid] - fields["handReference"][valid]), atol=1.e-4)
        assert np.all(np.isnan(fields["hand"][~valid]))
        receiver = h["receiver"].ravel()
        links = (receiver >= 0) & ~fields["channel"].ravel().astype(bool) & ~h["sea"].ravel().astype(bool) & ~h["lake"].ravel().astype(bool)
        np.testing.assert_array_equal(fields["handReference"].ravel()[links], fields["handReference"].ravel()[receiver[links]])
        # D8 area conservation, separate from retained discharge-weighted area.
        area = fields["contributingArea"].ravel()
        expected = np.full(area.size, (meta["width"] / meta["n"]) ** 2, np.float64)
        np.add.at(expected, receiver[receiver >= 0], area[receiver >= 0])
        np.testing.assert_allclose(area, expected, rtol=3.e-6)
        beta = np.tan(np.radians(fields["slope"]))
        cell = meta["width"] / meta["n"]
        np.testing.assert_allclose(fields["twi"], np.log(np.maximum(cell, fields["contributingArea"] / cell) / np.maximum(beta, .001)), rtol=2.e-6)
        assert np.all(fields["confidence"][[0, -1], :] == 0)
        assert np.all(fields["confidence"][:, [0, -1]] == 0)
        layers = ground["layers"]
        assert len(layers) == 29 and len({l["id"] for l in layers}) == 29
        for layer in layers:
            png = (directory / layer["file"]).read_bytes()
            assert digest(png) == layer["sha256"]
            with Image.open(directory / layer["file"]) as image:
                assert image.size == (meta["n"], meta["n"]) and image.mode == "RGBA"
                pixels = np.asarray(image)
                assert np.all(pixels[..., 3][h["sea"].astype(bool)] == 0)
                if layer["id"] == "hand":
                    assert np.all(pixels[..., 3][~valid] == 0)
                if layer["categorical"]:
                    colors = np.array([tuple(bytes.fromhex(p["color"][1:])) for p in layer["palette"]], np.uint8)
                    a = fields[layer["field"]].astype(int)
                    visible = pixels[..., 3] > 0
                    np.testing.assert_array_equal(pixels[..., :3][visible], colors[a[visible] - 1])
        report.append(dict(id=meta["id"], layers=len(layers), moistureMean=float(np.mean(fields["moisture"][soil])),
                           soilDepthMeanM=float(np.mean(fields["soilDepth"][soil])), geologySha256=geo_hash,
                           contactMeanStep=contact_mean, classContactMeanStep=class_mean,
                           mixedRockFraction=float(np.mean(np.max(mixture,axis=-1)<.95))))
        print("VALID " + meta["id"], flush=True)
        del blob, fields, h, pixels, raw, archive, mixture
    assert len(report) == (1 if only else 42)
    climate_checks = []
    for family in catalog["families"]:
        if only:
            break
        dry = next(t for t in report if t["id"] == family["id"] + "--arid")
        wet = next(t for t in report if t["id"] == family["id"] + "--tropical")
        assert wet["moistureMean"] > dry["moistureMean"], family["id"]
        climate_checks.append(dict(family=family["id"], arid=dry["moistureMean"], tropical=wet["moistureMean"]))
    result = dict(status="passed", tiles=report, groundLayers=len(report) * 29, climateChecks=climate_checks)
    write_json(root / ("ground-validation-" + only + ".json" if only else "ground-validation.json"), result)
    print(f"PASS: {len(report)} tiles, {len(report) * 29} ground layers, physical invariants and climate/geology checks", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT)
    parser.add_argument("--tile")
    args = parser.parse_args()
    validate(args.out.resolve(), args.tile)
