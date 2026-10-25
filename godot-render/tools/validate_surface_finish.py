"""Verify retained original cover/forest provenance and prepared water on all tiles."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PIN = 'dff14f387a6d1edc89d93737f861ee91e022a5aa'
def read(file):
    return json.loads(file.read_text(encoding='utf-8'))
def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()
def verify_files(directory, files, size):
    for item in files:
        file = directory/item['file']
        assert sha(file) == item['sha256'], str(file)
        with Image.open(file) as im:
            assert im.size == (size, size), str(file)
            assert im.mode == 'RGBA', str(file)

def main():
    source = read(ROOT/'shaders/original_forest_source.json')
    assert source['sourceHead'] == PIN and source['profile'] == 'original'
    include = (ROOT/'shaders/original_forest.gdshaderinc').read_text(encoding='utf-8')
    assert hashlib.sha256(include.encode('utf-8')).hexdigest() == source['portedSha256']
    assert 'clearingProfile' not in include and 'const int uForestBrushes=0;' in include
    catalogue = read(ROOT/'tiles/catalog.json')
    assert len(catalogue['tiles']) == 42
    water = read(ROOT/'materials/water/water.json')
    assert water['generatorSha256'] == sha(ROOT/'tools/prepare_surface_water.py')
    verify_files(ROOT/'materials/water', water['files'], 512)
    for entry in catalogue['tiles']:
        directory = ROOT/'tiles'/Path(entry['file']).parent
        meta = read(directory/'tile.json')
        for role in ('cover', 'forest'):
            descriptor = read(directory/('original-'+role+'.json'))
            assert descriptor['sourceHead'] == PIN and descriptor['profile'] == 'original-render3d'
            assert descriptor['seed'] == 1905266606
            assert descriptor['heightSha256'] == meta['heightSha256']
            if role == 'cover':
                assert descriptor['climate'] == [meta['temperature'], meta['precipitation']]
                assert len(descriptor['files']) == 4
            else:
                assert descriptor['settings'] == {'enabled': True, 'density': 1, 'clearings': .45}
            verify_files(directory, descriptor['files'], descriptor['n'])
        descriptor = read(directory/'surface-water-detail.json')
        assert descriptor['generatorSha256'] == water['generatorSha256']
        assert descriptor['heightSha256'] == meta['heightSha256']
        verify_files(directory, [{'file': descriptor['file'], 'sha256': descriptor['sha256']}], meta['n'])
    print('PASS: 42 original Render3D covers/forests, hydraulic water maps and 2 procedural wave textures')

if __name__ == '__main__':
    main()
