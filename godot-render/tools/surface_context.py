"""Compile camera-independent ground diagnostics from retained DEM + vector drainage.

Dependencies: numpy, scipy, pillow, numba. No service, asset download or GPU.
Units are metres, degrees, and fractions. This is a process-potential model,
not a sediment budget, measured geology, flood forecast or soil simulation.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import time

import numpy as np
from numba import njit, prange, set_num_threads
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates, uniform_filter

VERSION = 2
RADII = (150, 600, 2000)
ROOT = Path(__file__).resolve().parents[1] / "tiles"
GEOM_NAMES = ["Sans donnée", "Plat", "Sommet", "Crête", "Épaule", "Éperon",
              "Versant", "Creux", "Pied de pente", "Vallée", "Dépression"]
GEOM_COLORS = ["000000", "b9d99b", "a52b38", "e16b41", "edaf59", "edce73",
               "e5dfbc", "8db4c8", "6fb89b", "3976af", "70449b"]
ROCK_NAMES = ["Sans donnée", "Granite", "Calcaire", "Grès", "Argilo-marneux", "Basalte"]
ROCK_COLORS = ["000000", "d48099", "8ccbd3", "e5b65d", "99a669", "6e65ad"]
ROCK_FIELDS = ["bedrock" + name for name in ("Granite", "Limestone", "Sandstone", "Marl", "Basalt")]
PROCESS_NAMES = ["Sans donnée", "Altération résiduelle", "Transport de versant",
                 "Dépôt alluvial", "Potentiel éolien", "Littoral", "Débris de gel"]
PROCESS_COLORS = ["000000", "c4ba8f", "ca7247", "66b6bc", "edd16e", "6797cc", "d3cde9"]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, obj):
    # Publish manifests only after their payloads have been completed.
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def load_hydrology(directory, meta):
    schema = meta["hydrology"]["grids"]
    blob = gzip.decompress((directory / schema["file"]).read_bytes())
    types = {"Int32Array": "<i4", "Float32Array": "<f4", "Uint8Array": "u1"}
    return {name: np.frombuffer(blob, dtype=types[f["type"]], count=meta["n"] ** 2,
                              offset=f["offset"]).reshape(meta["n"], meta["n"])
            for name, f in schema["fields"].items()}


@njit(cache=True)
def form_class(down, up):
    # Ten-form reduction of the eight ternary lines of sight (GRASS convention).
    if down == 8:
        return 2
    if up == 8:
        return 10
    if down >= 6 or (down == 5 and up <= 1):
        return 3
    if up >= 6 or (up == 5 and down <= 1):
        return 9
    if (down == 5 and up >= 2) or (down == 4 and up == 2):
        return 5
    if (up == 5 and down >= 2) or (up == 4 and down == 2):
        return 7
    if (down == 0 and up <= 2) or (down == 1 and up <= 1) or (down == 2 and up == 0):
        return 1
    if (down <= 1 and up in (3, 4)) or (down == 1 and up == 2):
        return 8
    if (up <= 1 and down in (3, 4)) or (down == 2 and up == 1):
        return 4
    return 6


@njit(cache=True, parallel=True)
def geomorphons(height, cell, radii, flat_degrees=1.0):
    """Eight full DEM rays; signed openness, no extended correction.

    All distances are physical (including diagonal sqrt(2)). Missing rays at
    the edge are marked by a separate confidence layer. Never wrap the DEM.
    """
    n = height.shape[0]
    forms = np.zeros((3, n, n), np.uint8)
    threshold = math.radians(flat_degrees)
    for y in prange(n):
        for x in range(n):
            up = np.zeros(3, np.int32)
            down = np.zeros(3, np.int32)
            center = height[y, x]
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    if dx == 0 and dy == 0:
                        continue
                    step = cell * math.sqrt(dx * dx + dy * dy)
                    highest = -1.e30
                    lowest = 1.e30
                    k = 1
                    for band in range(3):
                        while k * step <= radii[band]:
                            xx, yy = x + k * dx, y + k * dy
                            if 0 <= xx < n and 0 <= yy < n:
                                angle = (height[yy, xx] - center) / (k * step)
                                highest = max(highest, angle)
                                lowest = min(lowest, angle)
                            k += 1
                        if highest == -1.e30:
                            continue
                        # Original zenith/nadir openness difference. Preserve
                        # the sign on planar slopes and single-sample rays.
                        openness = math.atan(highest) + math.atan(lowest)
                        if openness > threshold:
                            up[band] += 1
                        elif openness < -threshold:
                            down[band] += 1
            for band in range(3):
                forms[band, y, x] = form_class(down[band], up[band])
    return forms


def geology(n, width, seed, scenario="mixed"):
    """Continuous lithological proportions with coherent multi-scale structure.

    Pure world/seed synthesis independent of DEM and climate. Noise scales are
    physical; strata, contacts and intrusions persist across all six climates.
    """
    rng = np.random.default_rng(int.from_bytes(hashlib.sha256(seed.encode()).digest()[:8], "little"))
    y, x = np.mgrid[:n, :n].astype(np.float32)
    x = (x + .5) * width / n
    y = (y + .5) * width / n

    def noise(scale, xx=x, yy=y):
        size = int(math.ceil(width / scale)) + 12
        lattice = rng.uniform(-1, 1, (size, size)).astype(np.float32)
        return map_coordinates(lattice, [yy / scale + 5, xx / scale + 5], order=3, mode="nearest")

    def smoothstep(low, high, value):
        t = np.clip((value - low) / (high - low), 0, 1)
        return t * t * (3 - 2 * t)

    warp_x = 2400 * noise(8000) + 650 * noise(2100) + 180 * noise(550) + 55 * noise(140)
    warp_y = 2400 * noise(8000) + 650 * noise(2100) + 180 * noise(550) + 55 * noise(140)
    xx, yy = x + warp_x, y + warp_y
    strike = rng.uniform(.3, 2.7)
    cross = xx * np.cos(strike) + yy * np.sin(strike)
    along = -xx * np.sin(strike) + yy * np.cos(strike)
    fold = cross + 1500 * np.sin(along / 5100 + .5 * noise(2400))
    phase = np.mod(fold / 3500 + .07 * noise(800) + .018 * noise(220)
                   + .004 * noise(70) + rng.uniform(0, 10), 1)
    # A variable physical mixing zone, with nested lobes down to ~70 m.
    # These are proportions, never a thresholded material selector.
    contact_width = 320 + 400 * smoothstep(-.65, .65, noise(1100))
    contact_phase = contact_width / 3500
    weights = np.zeros((n, n, 5), np.float32)
    for k, center, half_width in [(1, .20, .20), (2, .56, .16), (3, .86, .14)]:
        distance = np.abs(np.mod(phase - center + .5, 1) - .5)
        weights[..., k] = smoothstep(-contact_phase, contact_phase, half_width - distance)
    weights /= np.maximum(weights.sum(axis=-1, keepdims=True), 1.e-8)
    intrusion = noise(6500, xx, yy) + .38 * noise(1600) + .12 * noise(400) + .035 * noise(100)
    granite = smoothstep(.10, .52, intrusion)
    weights *= (1 - granite[..., None])
    weights[..., 0] += granite
    lava = noise(5500, xx, yy) + .38 * noise(1400) + .12 * noise(350) + .035 * noise(90)
    basalt = smoothstep(.12, .54, -lava)
    weights *= (1 - basalt[..., None])
    weights[..., 4] += basalt
    # Variations inside units: continuous alteration/mineral heterogeneity,
    # kept separate from the categorical diagnostic and from surface deposits.
    variation = np.clip(.5 + .25 * noise(1200) + .14 * noise(280) + .07 * noise(70), 0, 1)
    if scenario != "mixed":
        weights.fill(0)
        weights[..., {"granite": 0, "limestone": 1, "sandstone": 2, "marl": 3, "basalt": 4}[scenario]] = 1
    weights /= weights.sum(axis=-1, keepdims=True)
    rock = (np.argmax(weights, axis=-1) + 1).astype(np.uint8)
    hardness = (weights @ np.array([.85, .57, .67, .24, .91], np.float32)) * (.94 + .12 * variation)
    weatherability = (weights @ np.array([.38, .65, .46, .88, .55], np.float32)) * (.90 + .20 * variation)
    # Local bed azimuth, tangent to the folded contact field, clockwise from north.
    gy, gx = np.gradient(fold, width / n)
    azimuth = np.mod(np.degrees(np.arctan2(-gy, -gx)), 180).astype(np.float32)
    return rock, hardness, weatherability, azimuth, weights, variation


@njit(cache=True)
def route_context(receiver, sea, lake, lake_level, height, filled, rock_weights, erosion,
                  gravity_source, accumulation, threshold, n, cell):
    """Topological reuse of the exact retained receiver graph, including sinks.

    Geometric contributing area is separate from runoff/loss-weighted discharge.
    Sediment-source mixtures are erosion-weighted, transported donor -> receiver.
    HAND references are found receiver -> donor, never by Euclidean proximity.
    """
    count = receiver.size
    indegree = np.zeros(count, np.int32)
    for c in range(count):
        r = receiver[c]
        if r >= 0:
            indegree[r] += 1
    order = np.empty(count, np.int32)
    tail = 0
    for c in range(count):
        if indegree[c] == 0:
            order[tail] = c
            tail += 1
    area = np.full(count, cell * cell, np.float64)
    provenance = np.zeros((count, 5), np.float32)
    gravity = gravity_source.copy()
    clipped = np.zeros(count, np.uint8)
    channel = np.zeros(count, np.uint8)
    for c in range(count):
        for k in range(5):
            provenance[c, k] = erosion[c] * rock_weights[c, k]
        clipped[c] = (c % n == 0 or c % n == n - 1 or c < n or c >= count - n)
        channel[c] = accumulation[c] >= threshold and not sea[c] and not lake[c]
    head = 0
    while head < tail:
        c = order[head]
        head += 1
        r = receiver[c]
        if r < 0:
            continue
        area[r] += area[c]
        clipped[r] = max(clipped[r], clipped[c])
        for k in range(5):
            provenance[r, k] += provenance[c, k]
        dy, dx = r // n - c // n, r % n - c % n
        distance = cell * math.sqrt(dx * dx + dy * dy)
        # Potential gravity runout decays over 350 m, stops in standing water.
        if not sea[r] and not lake[r]:
            gravity[r] = max(gravity[r], gravity[c] * math.exp(-distance / 350))
        if channel[c] and not sea[r] and not lake[r]:
            channel[r] = 1  # Keep losing downstream reaches, as in vectorWater.
        indegree[r] -= 1
        if indegree[r] == 0:
            order[tail] = r
            tail += 1
    if tail != count:
        raise ValueError("Cycle in retained hydrology receiver graph")
    reference = np.empty(count, np.float32)
    reference_kind = np.empty(count, np.uint8)
    for at in range(count - 1, -1, -1):
        c = order[at]
        r = receiver[c]
        if sea[c]:
            reference[c], reference_kind[c] = 0, 3
        elif lake[c]:
            reference[c], reference_kind[c] = lake_level[c], 2
        elif channel[c]:
            reference[c], reference_kind[c] = height[c], 1
        elif r < 0:
            reference[c] = height[c]
            at_boundary = c % n == 0 or c % n == n - 1 or c < n or c >= count - n
            reference_kind[c] = 4 if at_boundary else 5
        else:
            reference[c], reference_kind[c] = reference[r], reference_kind[r]
    for c in range(count):
        total = 0.
        for k in range(5):
            total += provenance[c, k]
        for k in range(5):
            provenance[c, k] /= max(1.e-12, total)
    return area, provenance, gravity, clipped, channel, reference, reference_kind


def compile_context(height, hydro, meta, scenario="mixed"):
    n, width = meta["n"], meta["width"]
    cell = width / n
    sea, lake = hydro["sea"].astype(bool), hydro["lake"].astype(bool)
    land = ~sea & ~lake
    smooth = gaussian_filter(height, 60 / cell, mode="nearest")
    gy, gx = np.gradient(smooth, cell)
    slope_tan = np.hypot(gx, gy)
    slope = np.degrees(np.arctan(slope_tan))
    aspect = np.mod(np.degrees(np.arctan2(-gx, gy)), 360)
    gyy, gyx = np.gradient(gy, cell)
    gxy, gxx = np.gradient(gx, cell)
    denom = np.maximum(slope_tan ** 2, 1.e-8)
    profile = (gxx * gx ** 2 + (gxy + gyx) * gx * gy + gyy * gy ** 2) / (denom * (1 + denom) ** 1.5)
    plan = (gxx * gy ** 2 - (gxy + gyx) * gx * gy + gyy * gx ** 2) / (denom * np.sqrt(1 + denom))
    fields = {"slope": slope, "aspect": aspect, "profileCurvature": profile, "planCurvature": plan}
    forms = geomorphons(height, cell, np.array(RADII, dtype=np.float64))
    for k, radius in enumerate(RADII):
        fields[f"geomorphon{radius}"] = forms[k]
        # Square neighbourhood with half-width in metres, source grid unchanged.
        fields[f"tpi{radius}"] = height - uniform_filter(height, 2 * round(radius / cell) + 1, mode="nearest")
    rock, hardness, weatherability, azimuth, rock_weights, variation = geology(n, width, meta["seed"], scenario)
    fields.update(bedrock=rock, hardness=hardness, weatherability=weatherability,
                  structureAzimuth=azimuth, bedrockVariation=variation)
    for k, name in enumerate(ROCK_FIELDS):
        fields[name] = rock_weights[..., k]
    erosion = (.02 + slope_tan * weatherability).astype(np.float32)
    erosion[sea | lake] = 0
    gravity_source = np.clip((slope - 24) / 22, 0, 1) * hardness
    routed = route_context(*(hydro[k].ravel() for k in ("receiver", "sea", "lake", "lakeLevel")),
                           height.ravel(), hydro["filled"].ravel(), rock_weights.reshape(-1, 5), erosion.ravel(),
                           gravity_source.astype(np.float32).ravel(), hydro["accumulation"].ravel(),
                           meta["hydrology"]["settings"]["riverArea"] * 1.e6, n, cell)
    area, provenance, gravity, clipped, channel, reference, reference_kind = routed
    area, gravity, clipped, channel, reference, reference_kind = [a.reshape(n, n) for a in
        (area, gravity, clipped, channel, reference, reference_kind)]
    provenance = provenance.reshape(n, n, 5)
    hand = np.maximum(0, height - reference)
    # A terminal without a river/lake/sea reference has no defined HAND.
    hand_valid = reference_kind <= 3
    hand[~hand_valid] = np.nan
    twi = np.log(np.maximum(cell, area / cell) / np.maximum(slope_tan, .001))
    water = sea | lake | channel.astype(bool)
    if np.any(water):
        distance, nearest = distance_transform_edt(~water, sampling=cell, return_indices=True)
        shore_level = np.where(lake, np.nan_to_num(hydro["lakeLevel"]), np.where(sea, 0, height))
        shore_height = shore_level[nearest[0], nearest[1]]
    else:
        distance = np.full_like(height, width)
        shore_height = np.zeros_like(height)
    # Actual lateral alluvium receives the upstream mixture of the nearby reach.
    # Height above water, slope and distance all constrain lateral connectivity.
    relative = np.where(hand_valid, hand, np.maximum(0, height - shore_height))
    alluvial = np.exp(-relative / 9) * np.exp(-distance / 550) * np.exp(-slope / 10)
    alluvial[channel.astype(bool)] = 1
    alluvial[~land] = 0
    transported = provenance[nearest[0], nearest[1]] if np.any(water) else provenance
    mineral_source = rock_weights
    transported = np.where((transported.sum(axis=-1) > 0)[..., None], transported, mineral_source)
    source_mix = mineral_source * (1 - alluvial[..., None]) + transported * alluvial[..., None]
    # Source textures sand / silt / clay, kept separate from organic matter.
    textures = np.array([[.66, .24, .10], [.20, .48, .32], [.83, .12, .05],
                         [.10, .40, .50], [.30, .36, .34]], np.float32)
    texture = source_mix @ textures
    transport_power = np.clip(slope / 18 + np.log1p(area / 1.e6) / 9, 0, 1)
    fine_deposit = np.stack([.18 + .55 * transport_power,
                             .53 - .36 * transport_power, .29 - .19 * transport_power], axis=-1)
    sorting = .45 * alluvial[..., None]
    texture = texture * (1 - sorting) + fine_deposit * sorting
    texture /= texture.sum(axis=-1, keepdims=True)
    aridity = meta["hydrology"]["runoff"]["aridity"]
    warm = np.clip((meta["temperature"] - .006 * np.maximum(height, 0) + 8) / 30, 0, 1)
    weathering = weatherability * np.clip(aridity, .05, 1.5) * (.3 + .7 * warm)
    stable = np.exp(-slope / 22)
    colluvial = gravity * np.clip((25 - slope) / 18, 0, 1) * (1 - alluvial)
    sand_supply = texture[..., 0] * (.15 + weathering)
    # A fixed regional wind constrains lee-side traps; it does not create sand.
    wind_lee = .3 + .7 * np.clip(np.cos(np.radians(aspect - 70)), 0, 1)
    traps = .25 + .75 * np.clip(-fields["tpi150"] / 12, 0, 1)
    aeolian = np.clip((.65 - aridity) * 2, 0, 1) * sand_supply * stable * wind_lee * traps
    sea_distance = distance_transform_edt(~sea, sampling=cell) if np.any(sea) else np.full_like(height, width)
    coastal = (np.exp(-sea_distance / 130) * np.exp(-np.maximum(height, 0) / 12)
               * np.exp(-slope / 25) * (.25 + .75 * np.minimum(1, sand_supply)) * (1 - alluvial))
    frost = np.clip((3 - (meta["temperature"] - .006 * height)) / 15, 0, 1) * np.minimum(1, slope / 30) * hardness
    process_scores = np.stack([.18 + .24 * weathering, colluvial * 1.4, alluvial,
                               aeolian, coastal, frost * .7], axis=-1)
    process = (np.argmax(process_scores, axis=-1) + 1).astype(np.uint8)
    deposit_depth = np.clip(.03 + .8 * weathering * stable + 3.5 * alluvial + 1.8 * colluvial + .9 * aeolian, 0, 8)
    soil_depth = np.clip((.08 + 1.1 * weathering * stable + deposit_depth * .30) * np.exp(-slope / 65), .02, 3)
    stoniness = np.clip(.07 + hardness * (1 - stable) * .65 + colluvial * .6 + frost * .25 - alluvial * .2, 0, 1)
    clay, sand = texture[..., 2], texture[..., 0]
    storage = soil_depth * (75 + 150 * clay + 65 * texture[..., 1]) * (1 - stoniness)
    permeability = np.clip(.15 + .75 * sand - .35 * clay - .15 * weatherability, 0, 1)
    wet_topo = np.clip((twi - 5) / 10, 0, 1)
    riparian = np.exp(-relative / 12) * np.exp(-distance / 400)
    exposure = (.5 + .5 * np.cos(np.radians(aspect))) * np.minimum(1, slope / 30)
    moisture = np.clip(.12 + .35 * min(1.8, aridity) + .20 * wet_topo + .28 * riparian
                       + .12 * (1 - permeability) + .10 * np.minimum(1, storage / 250)
                       + .05 * exposure - .22 * permeability - .12 * warm, 0, 1)
    organic = np.clip(.015 + .14 * moisture * stable * np.clip(aridity, 0, 1.5) * (1.2 - .5 * warm), 0, .45)
    drainage = np.where(moisture > .78, 1, np.where(moisture > .6, 2, np.where(moisture > .38, 3, 4))).astype(np.uint8)
    edge = np.minimum.reduce([np.broadcast_to(np.arange(n)[:, None], (n, n)),
                              np.broadcast_to(np.arange(n)[None, :], (n, n)),
                              np.broadcast_to(np.arange(n - 1, -1, -1)[:, None], (n, n)),
                              np.broadcast_to(np.arange(n - 1, -1, -1)[None, :], (n, n))]) * cell
    confidence = np.minimum(1, edge / 2000) * np.where(clipped, .5, 1) * np.where(hand_valid, 1, .35)
    fields.update(contributingArea=area, twi=twi, hand=hand, handReference=reference,
                  handReferenceKind=reference_kind, distanceToWater=distance, channel=channel,
                  boundaryAffected=clipped, process=process, alluvialPotential=alluvial,
                  colluvialPotential=colluvial, aeolianPotential=aeolian, coastalPotential=coastal,
                  frostPotential=frost, depositDepth=deposit_depth, soilDepth=soil_depth,
                  stoniness=stoniness, storage=storage, permeability=permeability,
                  moisture=moisture, organic=organic, drainage=drainage, confidence=confidence,
                  sedimentProvenance=(np.argmax(transported, axis=-1) + 1).astype(np.uint8))
    for k, name in enumerate(("sand", "silt", "clay")):
        fields[name] = texture[..., k]
    for k, name in enumerate(("Granite", "Limestone", "Sandstone", "Marl", "Basalt")):
        fields["upstream" + name] = provenance[..., k]
    return fields, land


def palette(names, colors, start=1):
    return [{"value": i, "label": names[i], "color": "#" + colors[i]} for i in range(start, len(names))]


def layer_specs():
    layers = []

    def discrete(id, label, field, names, colors, legend, mask="land"):
        layers.append(dict(id=id, label=label, field=field, legend=legend, palette=palette(names, colors),
                           colors=colors, categorical=True, mask=mask, unit="class"))

    def continuous(id, label, field, lo, hi, colors, legend, unit="fraction", mask="land"):
        values = np.linspace(lo, hi, len(colors))
        entries = [{"value": float(v), "label": f"{v:g}" + (" " + unit if unit != "fraction" else ""),
                    "color": "#" + c} for v, c in zip(values, colors)]
        layers.append(dict(id=id, label=label, field=field, legend=legend, palette=entries,
                           colors=colors, range=[lo, hi], categorical=False, mask=mask, unit=unit, filter="linear"))

    for radius in RADII:
        discrete(f"geomorphons-{radius}", f"Relief · Géomorphons {radius:,} m".replace(",", " "), f"geomorphon{radius}",
                 GEOM_NAMES, GEOM_COLORS, f"8 lignes de visée jusqu’à {radius} m ; seuil plat 1°. Formes indépendantes de la caméra. Bords : contexte incomplet.")
    continuous("slope", "Relief · Pente", "slope", 0, 50, ["edf3cc", "d0d87a", "d9a14f", "b65d3e", "743e52"], "Pente du DEM lissé à 60 m ; saturation à 50°.", "°")
    direction = ["be5db2", "5478d4", "62bdbc", "d8b760", "be5db2"]
    continuous("aspect", "Relief · Exposition", "aspect", 0, 360, direction, "Azimut aval : nord 0°, est 90°, sud 180°, ouest 270°. Masqué sous 1° de pente.", "°", "slope")
    for field, label in [("profileCurvature", "Courbure de profil"), ("planCurvature", "Courbure en plan")]:
        continuous(field, "Relief · " + label, field, -.003, .003, ["b35e44", "edd9ae", "f1f0df", "9fc9c5", "356eab"],
                     "Négatif : convexe / divergent ; positif : concave / convergent. DEM lissé à 60 m, palette saturée à ±0,003 m⁻¹.", "m⁻¹")
    for radius, span in zip(RADII, (30, 100, 300)):
        continuous(f"tpi-{radius}", f"Relief · Position topographique {radius} m", f"tpi{radius}", -span, span,
                     ["3267a1", "85b6ba", "eeeece", "d5a265", "a64745"],
                     "Altitude moins moyenne du voisinage carré (demi-largeur indiquée). Bleu : creux ; rouge : hauteur relative.", "m")
    layers.append(dict(id="bedrock", label="Géologie · Roche mère — composition", field=ROCK_FIELDS[0],
                       categorical=False, unit="fraction", mixFields=ROCK_FIELDS, mask="nonsea", filter="linear",
                       legend="Proportions continues des cinq roches. Contacts graduels et variations de 70 m à 8 km. Les teintes se mélangent ; les propriétés et les dépôts utilisent ces proportions.",
                       palette=palette(ROCK_NAMES, ROCK_COLORS)))
    discrete("bedrock-units", "Géologie · Roche dominante (classes)", "bedrock", ROCK_NAMES, ROCK_COLORS,
             "Classification diagnostique de la proportion la plus élevée. Les limites franches de cette vue ne pilotent pas les matériaux, l’altération ou la provenance.", "nonsea")
    for field, label in [("hardness", "Dureté"), ("weatherability", "Altérabilité")]:
        continuous(field, "Géologie · " + label, field, 0, 1, ["e8dcb1", "b3ba8e", "6f968e", "424a79"],
                     "Propriété relative calculée avec les proportions continues et l’hétérogénéité interne. Scénario procédural, sans mesure géologique.", mask="nonsea")
    continuous("structure", "Géologie · Orientation des strates", "structureAzimuth", 0, 180, direction,
                 "Azimut des contacts sédimentaires plissés, modulo 180°. Masqué dans le granite et le basalte.", "°", "strata")
    discrete("process", "Dépôts · Domaine de processus", "process", PROCESS_NAMES, PROCESS_COLORS,
             "Processus dominant potentiel. Éboulis reliés à une source amont ; alluvions contraintes par réseau, pente, hauteur et distance. Littoral selon pente et stock ; éolien selon sable disponible. Aucun relief de dune ajouté.")
    discrete("provenance", "Dépôts · Provenance fluviale amont", "sedimentProvenance", ROCK_NAMES, ROCK_COLORS,
             "Origine minérale dominante du mélange amont transporté sur le graphe. Visible sur chenaux et plaines alluviales potentielles ; distincte de la roche mère locale.", "alluvial")
    continuous("deposit-depth", "Dépôts · Épaisseur potentielle", "depositDepth", 0, 5, ["ebe4cb", "c3b17c", "9c7954", "6d4951"],
                 "Épaisseur de synthèse résiduelle, colluviale, alluviale et éolienne ; aucun bilan de volumes sédimentaires.", "m")
    continuous("twi", "Eau / sol · Indice topographique TWI", "twi", 4, 16, ["d9bf86", "b7c49c", "74b5b4", "3869a4"],
                 "ln(a / tan β) ; a = aire contributive géométrique / largeur de maille, pente minimale 0,001. Aire distincte du ruissellement pondéré. Indice, pas humidité mesurée.", "indice")
    continuous("hand", "Eau / sol · Hauteur au drainage HAND", "hand", 0, 150, ["4266b4", "57beb6", "d7d48b", "d39a62", "a45345"],
                 "Hauteur au premier chenal, lac ou mer atteint en suivant le receveur. Saturation 150 m. Transparent sans référence avant exutoire/sink ; ni distance euclidienne ni cote de crue.", "m")
    continuous("water-distance", "Eau / sol · Distance aux eaux", "distanceToWater", 0, 2000, ["4e85b8", "87c2b3", "d7d7a0", "c69a64"],
                 "Distance euclidienne au réseau hydrologique retenu, aux lacs ou à la mer. Complète HAND sans le remplacer ; saturation 2 km.", "m")
    continuous("moisture", "Eau / sol · Eau disponible", "moisture", 0, 1, ["c69761", "d3cc91", "8fbe9c", "428aa5", "354d94"],
                 "Potentiel hydrique combinant climat, TWI, HAND, stockage, texture et exposition. État moyen synthétique, sans pluie datée ni débit simulé.")
    discrete("drainage", "Eau / sol · Drainage du sol", "drainage", ["Sans donnée", "Très lent / humide", "Lent", "Modéré", "Rapide / sec"],
             ["000000", "4960a0", "58a3ad", "a9c395", "d2b47e"], "Classes déduites du potentiel hydrique et des propriétés du sol ; drainage karstique souterrain non simulé.")
    continuous("storage", "Eau / sol · Réserve utile potentielle", "storage", 0, 400, ["eee1ae", "bac79b", "7aafa5", "426e9c"],
                 "Stockage estimé par profondeur × capacité texturale × fraction sans pierres. Modèle de synthèse, saturation à 400 mm.", "mm")
    layers.append(dict(id="texture", label="Sol · Texture minérale", field="sand", categorical=False, unit="fraction",
                       rgbFields=["sand", "silt", "clay"], mask="land", legend="Fractions minérales : sable rouge, limon vert, argile bleu. Somme = 1 ; organique séparé. Teinte = mélange des trois fractions.",
                       palette=[dict(label="Sable", color="#ff0000"), dict(label="Limon", color="#00ff00"), dict(label="Argile", color="#0000ff")]))
    for field, label, limit in [("organic", "Matière organique", .3), ("stoniness", "Pierrosité", 1), ("soilDepth", "Profondeur", 2.5)]:
        continuous(field, "Sol · " + label, field, 0, limit, ["e9d9ae", "c4b38a", "8f8269", "534d49"],
                     "Propriété de sol synthétique issue du climat, de la roche, des dépôts et de la stabilité des versants ; distincte de l’épaisseur des dépôts.", "m" if field == "soilDepth" else "fraction")
    continuous("confidence", "Contexte · Limites et confiance", "confidence", 0, 1, ["d6665b", "e4bd77", "b6c294", "58978e"],
                 "Contexte extérieur absent : réduction à moins de 2 km des bords, bassins touchant le bord et absence de référence HAND. Ce score décrit la complétude, pas une précision statistique.")
    return layers


def render_layers(directory, fields, land, hydro):
    layers = []
    for spec in layer_specs():
        spec = dict(spec)
        values = fields[spec["field"]]
        mask = spec.pop("mask")
        valid = land.copy() if mask != "nonsea" else ~hydro["sea"].astype(bool)
        if mask == "slope":
            valid &= fields["slope"] >= 1
        if mask == "strata":
            valid &= sum(fields[name] for name in ROCK_FIELDS[1:4]) > .05
        if mask == "alluvial":
            valid &= (fields["alluvialPotential"] > .10) | fields["channel"].astype(bool)
        valid &= np.isfinite(values)
        rgba = np.zeros((*land.shape, 4), np.uint8)
        if "mixFields" in spec:
            proportions = np.stack([fields[k] for k in spec["mixFields"]], axis=-1)
            colors = np.array([tuple(bytes.fromhex(p["color"][1:])) for p in spec["palette"]], np.float32) / 255
            # Blend diagnostic colours in linear light, preserving saturation.
            linear = np.where(colors <= .04045, colors / 12.92, ((colors + .055) / 1.055) ** 2.4)
            rgb = proportions @ linear
            rgb *= (.82 + .36 * fields["bedrockVariation"])[..., None]
            rgb = np.where(rgb <= .0031308, rgb * 12.92, 1.055 * np.maximum(0, rgb) ** (1 / 2.4) - .055)
            rgba[..., :3] = np.clip(rgb * 255, 0, 255).astype(np.uint8)
        elif "rgbFields" in spec:
            rgb = np.stack([fields[k] for k in spec["rgbFields"]], axis=-1)
            rgba[..., :3] = np.clip(rgb * 255, 0, 255).astype(np.uint8)
        else:
            colors = np.array([tuple(bytes.fromhex(c)) for c in spec.pop("colors")], np.float32)
            if spec["categorical"]:
                rgba[..., :3] = colors[values.astype(int)]
            else:
                lo, hi = spec["range"]
                t = np.clip(np.nan_to_num((values - lo) / (hi - lo)), 0, 1) * (len(colors) - 1)
                index = np.minimum(t.astype(int), len(colors) - 2)
                t = (t - index)[..., None]
                rgba[..., :3] = colors[index] * (1 - t) + colors[index + 1] * t
        alpha = valid.astype(np.float32)
        if mask == "strata":
            alpha *= sum(fields[name] for name in ROCK_FIELDS[1:4])
        rgba[..., 3] = np.clip(alpha * 255, 0, 255).astype(np.uint8)
        file = "ground-" + spec["id"] + ".png"
        Image.fromarray(rgba).save(directory / file, compress_level=3)
        spec.update(file=file, sha256=digest((directory / file).read_bytes()))
        layers.append(spec)
    return layers


def save_fields(directory, fields, land):
    schema, offset = {}, 0
    path = directory / "ground-grids.bin.gz"
    with gzip.GzipFile(filename=str(path), mode="wb", compresslevel=2, mtime=0) as out:
        for name, a in {**fields, "soilMask": land.astype(np.uint8)}.items():
            a = a.astype("u1" if a.dtype == np.uint8 else "<f4")
            blob = a.tobytes()
            schema[name] = dict(offset=offset, bytes=len(blob), type="Uint8Array" if a.dtype == np.uint8 else "Float32Array")
            offset += len(blob)
            out.write(blob)
    return dict(file=path.name, fields=schema, endianness="little", sha256=digest(path.read_bytes()))


def compile_tile(root, entry, force, scenario, compiler):
    directory = (root / entry["file"]).parent
    meta = read_json(directory / "tile.json")
    h = meta["hydrology"]
    source = dict(height=meta["heightSha256"], hydrology=digest((directory / h["grids"]["file"]).read_bytes()),
                  settings=h["settings"], runoff=h["runoff"], seed=meta["seed"],
                  temperature=meta["temperature"], precipitation=meta["precipitation"],
                  n=meta["n"], width=meta["width"], scenario=scenario, compiler=compiler)
    identity = digest(json.dumps(source, sort_keys=True).encode())
    previous = meta.get("ground", {})
    if not force and previous.get("identity") == identity and all((directory / l["file"]).is_file() for l in previous.get("layers", [])) and (directory / previous.get("grids", {}).get("file", "missing")).is_file():
        print("RETAINED " + meta["id"], flush=True)
        return meta, dict(id=meta["id"], status="retained")
    print("GROUND " + meta["id"], flush=True)
    started = time.perf_counter()
    raw = (directory / meta["height"]).read_bytes()
    if digest(raw) != meta["heightSha256"]:
        raise ValueError("Changed canonical DEM: " + meta["id"])
    height = np.frombuffer(raw, dtype="<f4").reshape(meta["n"], meta["n"])
    hydro = load_hydrology(directory, meta)
    fields, land = compile_context(height, hydro, meta, scenario)
    layers = render_layers(directory, fields, land, hydro)
    grids = save_fields(directory, fields, land)
    rock_counts = np.bincount(fields["bedrock"][land], minlength=6).tolist()
    ground = dict(version=VERSION, identity=identity, sources=source, layers=layers,
                  grids={**grids, "n": meta["n"], "width": meta["width"]},
                  geology=dict(origin="declared-procedural-prior", scenario=scenario, seed=meta["seed"],
                               classes=palette(ROCK_NAMES, ROCK_COLORS), noiseScalesM=[8000, 6500, 5500, 2400, 2100, 1600, 1400, 1200, 1100, 800, 550, 400, 350, 280, 220, 140, 100, 90, 70],
                               compositionFields=ROCK_FIELDS, contactWidthM=[320, 720],
                               categoricalFieldRole="diagnostic-only", generation="continuous-partition-multiscale",
                               independentOfClimateAndElevation=True),
                  geomorphons=dict(radiiM=list(RADII), flatDegrees=1, comparison="original-signed-openness", rays=8, extendedCorrection=False,
                                  reference="https://grass.osgeo.org/grass-stable/manuals/r.geomorphon.html"),
                  prevailingWindDegrees=70,
                  boundary="Unknown external inflow; retained graph outlets and closed sinks; no fabricated upstream basin.",
                  limitations=["Process potentials and synthetic thicknesses; no sediment mass budget.",
                               "Mean water potential; no dated rainfall, groundwater/karst routing or flood forecast.",
                               "No terrain displacement, dune geometry or salt crust inferred from these diagnostics."],
                  statistics=dict(rockLandCells=rock_counts, handUndefinedLandCells=int(np.sum(land & ~np.isfinite(fields["hand"]))),
                                  boundaryAffectedLandCells=int(np.sum(land & (fields["boundaryAffected"] > 0)))),
                  generationSeconds=round(time.perf_counter() - started, 3))
    meta["ground"] = ground
    write_json(directory / "tile.json", meta)
    print(f"DONE {meta['id']}: {len(layers)} layers, {ground['generationSeconds']:.1f}s", flush=True)
    return meta, dict(id=meta["id"], seconds=ground["generationSeconds"], layers=len(layers), **ground["statistics"])


def generate(root=ROOT, only=None, force=False, scenario="mixed", workers=2, threads=4):
    catalog = read_json(root / "catalog.json")
    compiler = digest(Path(__file__).read_bytes())
    entries = [e for e in catalog["tiles"] if not only or e["id"] == only]
    if not entries:
        raise ValueError("Unknown tile: " + str(only))
    (root / ".gdignore").touch()
    report = []

    def publish(entry, result):
        meta, stats = result
        entry.update(meta)
        report.append(stats)
        write_json(root / "catalog.json", catalog)

    if workers == 1 or len(entries) == 1:
        set_num_threads(threads)
        for entry in entries:
            publish(entry, compile_tile(root, entry, force, scenario, compiler))
    else:
        # Workers own disjoint tile directories; only the parent publishes the
        # catalogue, so completions cannot overwrite another tile's metadata.
        with ProcessPoolExecutor(max_workers=workers, initializer=set_num_threads, initargs=(threads,)) as pool:
            pending = {pool.submit(compile_tile, root, entry, force, scenario, compiler): entry for entry in entries}
            for future in as_completed(pending):
                publish(pending[future], future.result())
    write_json(root / "ground-report.json", dict(version=VERSION, tiles=report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT)
    parser.add_argument("--tile")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--threads", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--scenario", choices=["mixed", "granite", "limestone", "sandstone", "marl", "basalt"], default="mixed")
    args = parser.parse_args()
    if args.workers < 1 or args.threads < 1:
        parser.error("workers and threads must be positive")
    generate(args.out.resolve(), args.tile, args.force, args.scenario, args.workers, args.threads)
