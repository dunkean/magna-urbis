"""Download the CC0 catalogue's PBR sources and prepare equal-sized GPU layers.

Network is used only by this explicit offline preparation tool, never by Godot.
Original downloads, source hashes and resolved channels are retained locally.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.request
import zipfile

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, path):
    if path.exists():
        return path.read_bytes()
    for attempt in range(4):
        try:
            started=time.monotonic()
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "MagnaUrbis-ground-study/1.0"}), timeout=30) as response:
                chunks=[]
                while True:
                    chunk=response.read(128*1024)
                    if not chunk:break
                    chunks.append(chunk)
                    if time.monotonic()-started>120:raise TimeoutError('Download exceeded 120 seconds: '+url)
                data=b''.join(chunks)
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix(path.suffix + '.part')
            temp.write_bytes(data)
            temp.replace(path)
            return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def image(data, size, mode='RGB'):
    with Image.open(io.BytesIO(data)) as source:
        return source.convert(mode).resize((size, size), Image.Resampling.LANCZOS)


def prepare(asset, cache, output, size):
    key = asset['ref'].replace(':', '-')
    manifest = output / (key + '.json')
    if manifest.exists():
        previous = json.loads(manifest.read_text(encoding='utf-8'))
        if previous.get('size') == size and all((output / previous[k]).exists() and sha((output / previous[k]).read_bytes())==previous.get('preparedSha256',{}).get(k) for k in ('color', 'normalRoughness', 'height')):
            return previous
    aid = asset['assetId']
    sources, maps = {}, {}
    if asset['provider'] == 'Poly Haven':
        url = 'https://api.polyhaven.com/files/' + aid
        metadata = json.loads(fetch(url, cache / (key + '-files.json')))
        for channel, candidates in {'color': ['Diffuse', 'diff', 'color'], 'normal': ['nor_gl'], 'roughness': ['Rough'], 'height': ['Displacement']}.items():
            entry = next((metadata[k] for k in candidates if k in metadata), None)
            if entry is None:
                raise ValueError(f'{key}: missing {channel}')
            scale = entry.get('1k') or entry[sorted(entry)[0]]
            file = scale.get('jpg') or scale.get('png') or next(iter(scale.values()))
            data = fetch(file['url'], cache / key / Path(file['url']).name)
            maps[channel] = data
            sources[channel] = {'url': file['url'], 'sha256': sha(data)}
    else:
        metadata = json.loads(fetch('https://ambientcg.com/api/v2/full_json?id=' + aid + '&include=downloadData,dimensionsData', cache / (key + '-metadata.json')))
        record = metadata['foundAssets'][0]
        downloads = [d for folder in record['downloadFolders'].values() for category in folder['downloadFiletypeCategories'].values() for d in category['downloads']]
        jpg = next(d for d in downloads if d['attribute'] == '1K-JPG')
        png = next((d for d in downloads if d['attribute'] == '1K-PNG'), None)
        entry = png if png and zipfile.is_zipfile(cache/png['fileName']) else jpg
        try:
            data = fetch(entry['downloadLink'], cache / entry['fileName'])
            if not zipfile.is_zipfile(io.BytesIO(data)):raise ValueError('Invalid texture archive')
        except Exception:
            if entry is not jpg or png is None:raise
            entry=png
            data=fetch(entry['downloadLink'],cache/entry['fileName'])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for channel, suffix in {'color': 'Color', 'normal': 'NormalGL', 'roughness': 'Roughness', 'height': 'Displacement'}.items():
                names = [n for n in archive.namelist() if Path(n).stem.endswith('_' + suffix) and Path(n).suffix.lower() in ('.jpg', '.png')]
                if not names:
                    raise ValueError(f'{key}: no {suffix} in pack')
                maps[channel] = archive.read(names[0])
                sources[channel] = {'url': entry['downloadLink'], 'archiveSha256': sha(data), 'member': names[0], 'sha256': sha(maps[channel])}
    color = image(maps['color'], size)
    rgb = np.asarray(color, np.float32) / 255
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    normal = np.asarray(image(maps['normal'], size), np.float32) / 255 * 2 - 1
    normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1.e-6)
    packed = np.empty((size, size, 4), np.uint8)
    packed[..., :3] = np.clip((normal * .5 + .5) * 255, 0, 255).astype(np.uint8)
    packed[..., 3] = np.asarray(image(maps['roughness'], size, 'L'))
    files = {'color': key + '-color.png', 'normalRoughness': key + '-nr.png', 'height': key + '-height.png'}
    color.save(output / files['color'])
    Image.fromarray(packed).save(output / files['normalRoughness'])
    image(maps['height'], size, 'L').save(output / files['height'])
    result = {**asset, **files, 'size': size, 'meanLinear': linear.mean(axis=(0, 1)).tolist(),
              'normalConvention': 'OpenGL', 'sources': sources,
              'preparedSha256': {k: sha((output / v).read_bytes()) for k, v in files.items()}}
    manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', type=Path, default=ROOT / 'ground_texture_catalogue.json')
    parser.add_argument('--out', type=Path, default=ROOT / 'materials/prepared')
    parser.add_argument('--cache', type=Path, default=ROOT / 'materials/cache')
    parser.add_argument('--size', type=int, default=512)
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    (args.out.parent / '.gdignore').touch()
    catalogue = json.loads(args.catalogue.read_text(encoding='utf-8'))
    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(prepare, a, args.cache, args.out, args.size): a['ref'] for a in catalogue['assets']}
        for future in as_completed(pending):
            ref = pending[future]
            try:
                results[ref] = future.result()
                print(f'PBR {len(results)}/{len(pending)} {ref}', flush=True)
            except Exception as error:
                errors[ref] = str(error)
                print(f'FAILED {ref}: {error}', flush=True)
    missing_types = [t['id'] for t in catalogue['types'] if not any(c in results for c in t['candidates'])]
    report = {'version': 1, 'catalogueSha256': sha(args.catalogue.read_bytes()), 'size': args.size,
              'assets': [results[k] for k in sorted(results)], 'errors': errors, 'missingTypes': missing_types}
    (args.out / 'library.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'prepared': len(results), 'errors': len(errors), 'missingTypes': missing_types}), flush=True)
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
