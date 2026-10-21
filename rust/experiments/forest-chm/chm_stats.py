"""Bounded CHMv2 canopy statistics for the Render3D forest calibration.

Reads small windows from Meta's global CHMv2 COGs (CC BY 4.0) with HTTP range
requests, stores the raw windows and computes reference statistics.

    python -I chm_stats.py <out_dir> [<reference_json>]
    python -I chm_stats.py --summary <out_dir>/report.json <reference_json>

Needs numpy, scipy, rasterio, pyproj, shapely and requests. Deterministic for a
given remote object (its ETag is recorded with each window).
"""
import hashlib, json, math, sys, time
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.windows import from_bounds
from scipy import ndimage
from shapely.geometry import box, shape

ROOT = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3'
SIDE = 1024.0  # ground metres per window side
# Flux-tower or permanent-plot locations in continuous forest/woodland. The
# second window lies 1.5 km east, except at Danum where the east window hit a
# flat rectangular fill artefact (inspected in the contact sheet) and goes west.
SITES = [
    ('temperate', 'fontainebleau-fr', 48.395, 2.705),
    ('temperate', 'hainich-de', 51.0792, 10.4522),
    ('boreal', 'hyytiala-fi', 61.8474, 24.2948),
    ('boreal', 'boreas-nsa-ca', 55.8796, -98.4808),
    ('tropical', 'manaus-k34-br', -2.609, -60.209),
    ('tropical', 'danum-my', 4.951, 117.793, -1500.0),
    ('mediterranean', 'majadas-es', 39.9415, -5.7734),
    ('mediterranean', 'tonzi-us', 38.4316, -120.966),
]
to_merc = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True)
to_geo = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True)


def quadkey(lat, lon, z=10):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    s = math.radians(lat)
    y = int((1 - math.log(math.tan(s) + 1 / math.cos(s)) / math.pi) / 2 * n)
    return ''.join(str(((x >> i) & 1) + 2 * ((y >> i) & 1)) for i in range(z - 1, -1, -1))


def radial_acf(h, px, rmax=60.0):
    """Normalised radial autocorrelation of a mean-removed field (Wiener-Khinchin)."""
    a = h - h.mean()
    ny, nx = a.shape
    f = np.fft.rfft2(a, s=(2 * ny, 2 * nx))
    c = np.fft.irfft2(f * np.conj(f), s=(2 * ny, 2 * nx))
    norm = np.fft.irfft2(np.abs(np.fft.rfft2(np.ones_like(a), s=(2 * ny, 2 * nx))) ** 2, s=(2 * ny, 2 * nx))
    c = c / np.maximum(norm, 1) / max(a.var(), 1e-9)
    k = int(rmax / px) + 2
    sub = np.roll(np.roll(c, k, 0), k, 1)[:2 * k + 1, :2 * k + 1]
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    r = np.hypot(xx, yy) * px
    step = max(1.0, px)  # bins no finer than the sampling grid
    bins = np.arange(0, rmax + step, step)
    idx = np.digitize(r.ravel(), bins) - 1
    ok = (idx >= 0) & (idx < len(bins) - 1)
    prof = np.bincount(idx[ok], sub.ravel()[ok], len(bins) - 1) / np.maximum(np.bincount(idx[ok], minlength=len(bins) - 1), 1)
    return bins[:-1] + step / 2, prof


def stats(chm, px):
    """Uint8 CHMv2 metres; px is the ground pixel size (m)."""
    h = chm.astype(np.float32)
    canopy = h[h >= 2]
    q = np.percentile(canopy, [10, 25, 50, 75, 90, 95, 99]) if canopy.size else np.zeros(7)
    gaps, count = ndimage.label(h < 2)
    areas = np.bincount(gaps.ravel())[1:] * px * px
    big = areas[areas >= 10]
    window = h.size * px * px
    # Discrete power-law MLE above 10 m^2 (Clauset et al. 2009 continuous approximation).
    alpha = 1 + big.size / np.log(big / 9.5).sum() if big.size > 5 else float('nan')
    r, acf = radial_acf(h, px)
    efold = float(r[np.argmax(acf < 1 / math.e)]) if (acf < 1 / math.e).any() else float('nan')
    d = np.diff(acf)
    first_min = float(r[1:][np.argmax(d >= 0)]) if (d >= 0).any() else float('nan')
    # Tree tops: local maxima of a 1 m Gaussian-smoothed CHM in a 5 m window, above 5 m.
    sm = ndimage.gaussian_filter(h, 1.0 / px)
    size = max(3, int(round(5.0 / px)) | 1)
    # Integer heights leave flat plateaus: count each connected plateau maximum once.
    tops = ndimage.label((sm == ndimage.maximum_filter(sm, size)) & (sm >= 5), np.ones((3, 3)))[1]
    area_ha = window / 1e4
    # Stand-scale structure: autocorrelation of 4 m block means up to 400 m.
    b4 = max(1, int(round(4 / px)))
    m4 = h[:h.shape[0] // b4 * b4, :h.shape[1] // b4 * b4].reshape(h.shape[0] // b4, b4, h.shape[1] // b4, b4).mean((1, 3))
    r4, acf4 = radial_acf(m4, b4 * px, 400.0)
    stand_efold = float(r4[np.argmax(acf4 < 1 / math.e)]) if (acf4 < 1 / math.e).any() else float('nan')
    block = max(1, int(round(32 / px)))
    cy, cx = h.shape[0] // block, h.shape[1] // block
    cover32 = (h[:cy * block, :cx * block] >= 2).reshape(cy, block, cx, block).mean((1, 3))
    height32 = h[:cy * block, :cx * block].reshape(cy, block, cx, block).mean((1, 3))
    return {
        'cover2': float((h >= 2).mean()), 'cover5': float((h >= 5).mean()),
        'meanHeightAll': float(h.mean()), 'canopyQuantiles_p10_25_50_75_90_95_99': [round(float(v), 2) for v in q],
        'canopyHist1m_0to60': np.histogram(canopy, bins=np.arange(2, 62, 1))[0].tolist(),
        'gapCount_ge10m2': int(big.size), 'gapAlpha_ge10m2': round(float(alpha), 3),
        'gapFraction_lt100m2': float(areas[areas < 100].sum() / window),
        'gapFraction_100m2_to_1ha': float(areas[(areas >= 100) & (areas < 1e4)].sum() / window),
        'gapFraction_ge1ha': float(areas[areas >= 1e4].sum() / window),
        'largestGap_m2': float(areas.max()) if areas.size else 0.0,
        'acfEfold_m': efold, 'acfFirstMin_m': first_min, 'acf_0to60m': [round(float(v), 4) for v in acf],
        'standAcfEfold_m': stand_efold,
        'treeTopsPerHa': float(tops / area_ha),
        'meanTopSpacing_m': float(math.sqrt(window / max(tops, 1))),
        # Crown radius if the canopy above 2 m were the union of disjoint discs, one per top.
        'equivalentCrownRadius_m': float(math.sqrt((h >= 2).sum() * px * px / max(tops, 1) / math.pi)),
        'cover32_std': float(cover32.std()), 'height32_std': float(height32.std()),
    }


def main():
    out = Path(sys.argv[1])
    (out / 'windows').mkdir(parents=True, exist_ok=True)
    report = {'source': ROOT, 'license': 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
              'sideMetres': SIDE, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'windows': []}
    for biome, name, lat, lon, *second in SITES:
        for k, east in enumerate((0.0, second[0] if second else 1500.0)):
            cx, cy = to_merc.transform(lon, lat)
            scale = 1 / math.cos(math.radians(lat))  # Mercator metres per ground metre
            cx += east * scale
            half = SIDE / 2 * scale
            clon, clat = to_geo.transform(cx, cy)
            qk = quadkey(clat, clon)
            url = f'{ROOT}/chm/{qk}.tif'
            head = requests.head(url, timeout=60)
            head.raise_for_status()
            with rasterio.open('/vsicurl/' + url) as src:
                win = from_bounds(cx - half, cy - half, cx + half, cy + half, src.transform).round_offsets().round_lengths()
                chm = src.read(1, window=win)
                px = abs(src.transform.a) / scale
            meta = requests.get(f'{ROOT}/metadata/{qk}.geojson', timeout=60).json()
            w0, s0 = to_geo.transform(cx - half, cy - half)
            e0, n0 = to_geo.transform(cx + half, cy + half)
            footprint = box(w0, s0, e0, n0)
            dates = sorted({f['properties'].get('acq_date') for f in meta['features'] if shape(f['geometry']).intersects(footprint)})
            wid = f'{name}-{k}'
            np.savez_compressed(out / 'windows' / f'{wid}.npz', chm=chm)
            entry = {'id': wid, 'biome': biome, 'lat': round(clat, 6), 'lon': round(clon, 6), 'quadkey': qk, 'url': url,
                     'etag': head.headers.get('ETag', '').strip('"'), 'objectBytes': int(head.headers.get('Content-Length', 0)),
                     'window_col_row_w_h': [int(win.col_off), int(win.row_off), int(win.width), int(win.height)],
                     'bboxLonLat': [round(v, 6) for v in (w0, s0, e0, n0)], 'groundPixel_m': round(px, 4),
                     'imageDates': dates, 'sha256_uint8': hashlib.sha256(chm.tobytes()).hexdigest(),
                     **stats(chm, px)}
            report['windows'].append(entry)
            print(wid, qk, chm.shape, f"cover2={entry['cover2']:.2f} p50={entry['canopyQuantiles_p10_25_50_75_90_95_99'][2]} tops/ha={entry['treeTopsPerHa']:.0f} dates={dates}", flush=True)
    (out / 'report.json').write_text(json.dumps(strict(report), indent=1, allow_nan=False))
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(summarise(report), indent=1) + '\n')


def strict(value):
    """NaN/inf become null, so every output is strict JSON."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: strict(v) for k, v in value.items()}
    if isinstance(value, list):
        return [strict(v) for v in value]
    return value


def median(values):
    v = [x for x in values if x is not None and x == x]
    return round(float(np.median(v)), 3) if v else None


def summarise(report):
    """Per-biome medians across windows: the compact reference kept in the repository."""
    keys = ['cover2', 'cover5', 'gapAlpha_ge10m2', 'gapFraction_lt100m2', 'gapFraction_100m2_to_1ha', 'gapFraction_ge1ha',
            'acfEfold_m', 'acfFirstMin_m', 'standAcfEfold_m', 'treeTopsPerHa', 'meanTopSpacing_m', 'equivalentCrownRadius_m',
            'cover32_std', 'height32_std']
    biomes = {}
    for w in report['windows']:
        biomes.setdefault(w['biome'], []).append(w)
    out = {'source': report['source'], 'license': report['license'], 'sideMetres': report['sideMetres'],
           'note': 'Medians of 1 km windows of a model-estimated canopy height map; not field measurements.', 'biomes': {}}
    for biome, ws in biomes.items():
        hist = np.sum([w['canopyHist1m_0to60'] for w in ws], 0)
        cdf = np.cumsum(hist) / max(hist.sum(), 1)
        quant = [float(2 + np.searchsorted(cdf, p) + 0.5) for p in (0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99)]
        out['biomes'][biome] = {'windows': [w['id'] for w in ws],
                                **{k: median([w[k] for w in ws]) for k in keys},
                                'range_cover2': [round(min(w['cover2'] for w in ws), 3), round(max(w['cover2'] for w in ws), 3)],
                                'pooledCanopyQuantiles_p10_25_50_75_90_95_99': quant,
                                # Integer-metre CHM counts for 2..61 m, for Wasserstein distances.
                                'pooledCanopyHist1m_2to61': hist.tolist()}
    return out


if __name__ == '__main__':
    if sys.argv[1:2] == ['--summary']:  # re-summarise an existing report without downloading
        Path(sys.argv[3]).write_text(json.dumps(summarise(json.loads(Path(sys.argv[2]).read_text())), indent=1) + '\n')
    else:
        main()
