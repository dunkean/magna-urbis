"""Native-resolution atlas PNGs, assembled in bounded strips rather than one giant bitmap."""
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import tempfile
import zlib
from PIL import Image
from .outpaint import bounds

STRIP_BYTES = 8 * 1024 * 1024


def family(job):
    return (job.get('continuation') or {}).get('rootId', job['id'])


def atlas_jobs(service, job_id):
    anchor = service.get(job_id)
    bounds(anchor['context'])
    root = family(anchor)
    jobs = []
    for path in service.output.glob('*/metadata.json'):
        try:
            job = service.get(path.parent.name)
            if job['status'] == 'succeeded' and family(job) == root:
                jobs.append(job)
        except (ValueError, KeyError, OSError):
            continue
    jobs.sort(key=lambda job: (job.get('createdAt', 0), job['id']))
    return {'rootId': root, 'jobs': jobs[:128]}


def layout(service, ids):
    if not isinstance(ids, list) or not 1 <= len(ids) <= 128 or any(not isinstance(value, str) for value in ids):
        raise ValueError('Sélectionnez entre 1 et 128 tuiles terminées pour exporter la carte.')
    jobs = [service.get(job_id) for job_id in dict.fromkeys(ids)]
    first = jobs[0]
    origin = bounds(first['context'])
    pixel_width, pixel_height = first['outputSize']
    sx, sy = pixel_width/(origin[2]-origin[0]), pixel_height/(origin[3]-origin[1])
    tiles = []
    for job in jobs:
        if job['status'] != 'succeeded' or job['settings'].get('output') != 'battlemap' or family(job) != family(first):
            raise ValueError('L’export global assemble uniquement les tuiles terminées d’une même battlemap.')
        box = bounds(job['context'])
        w, h = job['outputSize']
        if not math.isclose(w/(box[2]-box[0]), sx, rel_tol=1e-7) or not math.isclose(h/(box[3]-box[1]), sy, rel_tol=1e-7):
            raise ValueError('Les tuiles doivent conserver la même résolution par mètre.')
        if job['context'].get('sourceId') != first['context'].get('sourceId'):
            raise ValueError('Les tuiles doivent appartenir à la même carte.')
        x, y = (box[0]-origin[0])*sx, (box[1]-origin[1])*sy
        if abs(x-round(x)) > .01 or abs(y-round(y)) > .01:
            raise ValueError('Les tuiles ne sont pas alignées sur les mêmes pixels.')
        tiles.append({'job': job, 'x': round(x), 'y': round(y), 'width': w, 'height': h,
                      'path': service.asset(job['id'], 'result.png')})
    left, top = min(t['x'] for t in tiles), min(t['y'] for t in tiles)
    width = max(t['x']+t['width'] for t in tiles)-left
    height = max(t['y']+t['height'] for t in tiles)-top
    # PNG dimensions are signed 31-bit quantities. This does not impose a canvas-sized pixel budget.
    if max(width, height) > 2**31-1:
        raise ValueError('Dimensions PNG trop grandes.')
    for tile in tiles:
        tile['x'] -= left
        tile['y'] -= top
    return tiles, width, height


def chunk(output, kind, data):
    output.write(struct.pack('>I', len(data)))
    output.write(kind)
    output.write(data)
    output.write(struct.pack('>I', zlib.crc32(data, zlib.crc32(kind)) & 0xffffffff))


def write_png(output, tiles, width, height, spool_dir=None):
    output.write(b'\x89PNG\r\n\x1a\n')
    chunk(output, b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    compressor = zlib.compressobj(6)
    sources = {}
    strip_height = max(1, min(128, STRIP_BYTES // (width*4)))
    try:
        for y in range(0, height, strip_height):
            rows = min(strip_height, height-y)
            strip = Image.new('RGBA', (width, rows), (0, 0, 0, 0))
            for tile in tiles:
                low, high = max(y, tile['y']), min(y+rows, tile['y']+tile['height'])
                if high <= low:
                    continue
                path = tile['path']
                source = sources.get(path)
                if source is None:
                    # Decode each tile once. Temporary raw rows let even a wide
                    # 128-tile atlas stream without keeping all its bitmaps in RAM
                    # or repeatedly decoding their PNGs for every output strip.
                    source = tempfile.TemporaryFile(dir=spool_dir)
                    sources[path] = source
                    with Image.open(path) as source:
                        if source.size != (tile['width'], tile['height']):
                            raise ValueError('Une tuile a changé de dimensions depuis sa génération.')
                        image = source.convert('RGBA')
                    source = sources[path]
                    for row in range(0, image.height, 64):
                        band = image.crop((0, row, image.width, min(row+64, image.height)))
                        source.write(band.tobytes())
                        band.close()
                    image.close()
                source.seek((low-tile['y'])*tile['width']*4)
                patch = Image.frombytes('RGBA', (tile['width'], high-low), source.read((high-low)*tile['width']*4))
                strip.paste(patch, (tile['x'], low-y))
                patch.close()
            raw = memoryview(strip.tobytes())
            stride = width*4
            for row in range(rows):
                data = compressor.compress(b'\0') + compressor.compress(raw[row*stride:(row+1)*stride])
                if data:
                    chunk(output, b'IDAT', data)
            raw.release()
            strip.close()
        chunk(output, b'IDAT', compressor.flush())
        chunk(output, b'IEND', b'')
    finally:
        for source in sources.values():
            source.close()


def export(service, ids):
    tiles, width, height = layout(service, ids)
    identity = hashlib.sha256(json.dumps([tile['job']['id'] for tile in tiles]).encode()).hexdigest()
    directory = service.output / 'mosaics'
    directory.mkdir(exist_ok=True)
    path = directory / (identity+'.png')
    if not path.is_file():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix=identity+'-', suffix='.tmp', delete=False) as output:
                temporary = Path(output.name)
                write_png(output, tiles, width, height, directory)
            temporary.replace(path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return {'id': identity, 'width': width, 'height': height, 'tiles': len(tiles),
            'filename': f'battlemap-globale-{family(tiles[0]["job"])}.png',
            'url': f'/v1/illustrations/mosaics/{identity}.png'}


def asset(service, name):
    if not re.fullmatch(r'[0-9a-f]{64}\.png', name):
        raise KeyError('Export inconnu.')
    path = service.output / 'mosaics' / name
    if not path.is_file():
        raise KeyError('Export indisponible.')
    return path
