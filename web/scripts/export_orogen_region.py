"""Read a genuine Infinite Map Orogen NPZ into MUFSURF1 regional exchange.

No upstream code/cache is modified. No geology is fabricated: a separate explicit
categorical geology package/catalogue is REQUIRED by import_regional_surface.ts.
Bounds are integer source pixel indices, never an invented finer-resolution crop.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from contextlib import nullcontext
import numpy as np


def read_graph(directory, atlas_width):
    """Original headless graph -> declared nearest spherical raster, no relief synthesis."""
    from scipy.spatial import cKDTree
    manifest_bytes = (directory / "graph.json").read_bytes()
    fields_bytes = (directory / "fields.f32").read_bytes()
    manifest, fields, cursor = json.loads(manifest_bytes), {}, 0
    for key, count in manifest["fields"].items():
        fields[key] = np.frombuffer(fields_bytes, dtype="<f4", count=count, offset=cursor)
        cursor += count * 4
    if cursor != len(fields_bytes) or "xyz" not in fields:
        raise ValueError("Invalid original Orogen graph layout")
    rows, cols = atlas_width // 2, atlas_width
    lon = (np.arange(cols) + .5) / cols * 2*np.pi - np.pi
    lat = np.pi/2 - (np.arange(rows) + .5) / rows * np.pi
    lo, la = np.meshgrid(lon, lat)
    xyz = np.stack((np.cos(la)*np.cos(lo), np.sin(la), np.cos(la)*np.sin(lo)), axis=-1)
    _, nearest = cKDTree(fields["xyz"].reshape(-1, 3)).query(xyz.reshape(-1, 3))
    elevation = fields["elevation"][nearest].reshape(rows, cols)
    t = np.clip(elevation, 0, 1)
    # Exact audited terrain_orogen.py conversion, procedural sea-level zero.
    height = np.where(elevation < 0, elevation * 10000, 6000*t**4*(5-4*t)+1000*t*(1-t)**4).astype(np.float32)
    native = (4*np.pi*(40_000_000/(2*np.pi))**2/manifest["numRegions"])**.5
    source_hash = hashlib.sha256(manifest_bytes + fields_bytes).hexdigest()
    result = {"height_m": height, "physical_ocean": (elevation < 0).astype(np.uint8)}
    for key in ("temperature_summer", "temperature_winter", "precip_summer", "precip_winter"):
        if key not in fields:
            raise ValueError(f"Original graph missing required climate: {key}")
        result["layer_" + key] = fields[key][nearest].reshape(rows, cols)
    result["metadata"] = np.array(json.dumps(dict(graph=manifest, graphSHA256=source_hash, graphNativeSpacingM=native,
        interpolation="nearest spherical original graph region; raster adds no source detail")))
    return result, source_hash, native


def binary_write(path, value):
    arrays, blocks = [], []
    offset = 0

    def visit(node, location):
        nonlocal offset
        if isinstance(node, np.ndarray):
            types = {"float32": ("f32", "<f4"), "uint8": ("u8", "u1"), "uint16": ("u16", "<u2"), "int32": ("i32", "<i4")}
            dtype, little = types[str(node.dtype)]
            data = np.ascontiguousarray(node, dtype=little).tobytes()
            offset = (offset + 7) // 8 * 8
            arrays.append(dict(path=location, dtype=dtype, offset=offset, length=node.size))
            blocks.append((offset, data))
            offset += len(data)
            return None
        if isinstance(node, dict):
            return {key: visit(v, location + [key]) for key, v in node.items()}
        if isinstance(node, list):
            return [visit(v, location + [i]) for i, v in enumerate(node)]
        return node

    metadata = visit(value, [])
    manifest = json.dumps(dict(format="magna-surface-binary", version=1, value=metadata, arrays=arrays), separators=(",", ":"), allow_nan=False).encode()
    start = (16 + len(manifest) + 7) // 8 * 8
    with open(path, "wb") as stream:
        stream.write(b"MUFSURF1" + struct.pack("<II", len(manifest), offset))
        stream.write(manifest)
        stream.write(bytes(start - stream.tell()))
        for position, data in blocks:
            stream.write(bytes(start + position - stream.tell()))
            stream.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--crop", help="x,z,width,height in original source pixels; default whole atlas")
    parser.add_argument("--seed", help="Required if the genuine source metadata does not record a seed")
    parser.add_argument("--atlas-width", type=int, default=256, help="Graph directories only: declared global raster width (height=width/2)")
    args = parser.parse_args()
    if args.input.is_dir():
        if args.atlas_width < 8 or args.atlas_width % 2:
            raise ValueError("Graph atlas-width must be even and at least eight")
        graph, source_hash, graph_native = read_graph(args.input, args.atlas_width)
        source_context = nullcontext(graph)
    else:
        source_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
        graph_native = 0
        source_context = np.load(args.input, allow_pickle=False)
    with source_context as source:
        metadata = json.loads(str(source["metadata"].item())) if "metadata" in source else {}
        raw = source["height_m"]
        if raw.ndim != 2:
            raise ValueError("Expected original two-dimensional Orogen height_m raster")
        rows, cols = raw.shape
        # Native Orogen atlas covers exactly 40Mm x 20Mm in the upstream metric
        # equirectangular projection. It is not a geodesically exact local DEM.
        sx, sz = 40_000_000 / cols, 20_000_000 / rows
        if abs(sx - sz) > 1e-6:
            raise ValueError("Source atlas does not use the audited square metric cells")
        x, z, w, h = map(int, args.crop.split(",")) if args.crop else (0, 0, cols, rows)
        if min(x, z) < 0 or min(w, h) < 2 or x + w > cols or z + h > rows:
            raise ValueError("Invalid source-pixel crop")
        seed = args.seed or metadata.get("seed") or metadata.get("config", {}).get("seed")
        if seed is None:
            raise ValueError("Source seed missing: provide --seed explicitly, preserving provenance")
        source_kind = "graph nearest spherical raster" if args.input.is_dir() else "NPZ atlas"
        provenance = f"Infinite Map original Orogen {source_kind} {args.input.name}; sha256={source_hash}; source crop={x},{z},{w},{h}"
        spacing = sx
        layers = {}

        def layer(key, input_key, units, scale=1.0, bias=0.0, season=None):
            if input_key not in source:
                raise ValueError(f"Required genuine Orogen source field missing: {input_key}")
            field = source[input_key]
            if field.shape != raw.shape:
                raise ValueError(f"Source field shape differs: {input_key}")
            data = np.asarray(field[z:z+h, x:x+w], dtype=np.float32) * np.float32(scale) + np.float32(bias)
            if not np.isfinite(data).all():
                raise ValueError(f"Non-finite genuine source field: {input_key}; no replacement permitted")
            actual_key = input_key.removeprefix("layer_") if args.input.is_dir() else input_key
            layers[key] = dict(id=key, sourceKey=actual_key, units=units, originX=spacing/2, originZ=spacing/2,
                spacingM=spacing, width=w, height=h, values=data.ravel(), sourceLOD=0, nativeSpacingM=max(spacing, graph_native),
                provenance=provenance + f"; physical conversion={scale}*source+{bias}")
            if season:
                layers[key]["season"] = dict(dayOfYear=season, elevationCorrected=True)

        layer("height", "height_m", "m")
        # Audited original vendor/temperature.js: normalized (T +45)/90,
        # already includes moisture-dependent physical elevation lapse.
        layer("temperatureSummer", "layer_temperature_summer", "degC", 90, -45, 172)
        layer("temperatureWinter", "layer_temperature_winter", "degC", 90, -45, 355)
        # Audited vendor/precipitation.js: p95-calibrated 1000mm per HALF YEAR.
        # The original normalized value can exceed one; do not clamp it.
        layer("precipitationSummer", "layer_precip_summer", "mm/half-year", 1000)
        layer("precipitationWinter", "layer_precip_winter", "mm/half-year", 1000)
        if "physical_ocean" in source:
            mask = np.asarray(source["physical_ocean"][z:z+h, x:x+w], dtype=np.uint8)
            if mask.shape != (h,w) or not np.isin(mask, (0,1)).all():
                raise ValueError("Invalid genuine physical_ocean mask")
            layers["waterClass"] = {**layers["height"], "id": "waterClass", "sourceKey": "physical_ocean", "units": "category-id", "values": mask.ravel(),
                "provenance": provenance + "; source ocean mask, codes 0 dry/1 ocean; map explicitly to SurfaceWorld ocean=3"}
            layers["waterLevel"] = {**layers["height"], "id": "waterLevel", "sourceKey": "procedural-sea-level", "units": "m", "values": np.where(mask,0,np.nan).astype(np.float32).ravel(),
                "provenance": provenance + "; procedural sea-level zero on source ocean; NaN on source dry cells"}
        packet = dict(format="surface-regional-exchange", version=1, id=f"orogen:{source_hash[:24]}:{x}:{z}:{w}:{h}", seed=str(seed),
            georeference=dict(crs="OROGEN:EQUIRECTANGULAR-PROCEDURAL-METRES", origin=dict(
                longitudeDeg=-180 + x/cols*360, latitudeDeg=90-z/rows*180, altitudeM=0), zAzimuthDeg=180,
                verticalDatum="Orogen procedural sea-level zero; not an observed geodetic datum"), layers=layers,
            features=dict(sourceMetadata=metadata, sourceSHA256=source_hash, sourcePixelCrop=[x,z,w,h],
                sourceLODMeaning="Opaque export level zero; use nativeSpacingM for physical scale",
                limitations=["Procedural global equirectangular metric atlas; distortion increases with latitude.",
                    "No lithology or directed hydrology graph exposed by this Orogen NPZ; explicit external geology is required.",
                    "Temperature seasonal fields already include original elevation correction.",
                    "Precipitation is procedural p95-calibrated climate, not measured rainfall."]))
        binary_write(args.output, packet)
    print(json.dumps(dict(output=str(args.output), sourceSHA256=source_hash, shape=[h,w], spacingM=spacing,
        bytes=args.output.stat().st_size, geology="absent; explicit external package required")))


if __name__ == "__main__":
    main()
