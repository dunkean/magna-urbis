"""Verify retained original cover/forest provenance and prepared water on all tiles."""
import hashlib
import json
from pathlib import Path
from PIL import Image
import numpy as np
from forest_placement import read_fields
from scipy.ndimage import map_coordinates, convolve1d

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
                assert descriptor['version'] == 2 and len(descriptor['files']) == 5
                with Image.open(directory/'original-cover.png') as im:
                    assert im.getchannel('A').getextrema() == (255,255), 'Mask export must be opaque'
            else:
                assert descriptor['settings'] == {'enabled': True, 'density': 1, 'clearings': .45}
            verify_files(directory, descriptor['files'], descriptor['n'])
        placement=read(directory/'forest-placement.json')
        assert placement['policy']=='forest-only-pbr-matrix'
        assert placement['generatorSha256']==sha(ROOT/'tools/forest_placement.py')
        assert placement['heightSha256']==meta['heightSha256']
        assert placement['groundSurfaceSha256']==meta['groundSurface']['grids']['sha256']
        assert placement['montane']['sourceGroundSha256']==meta['ground']['grids']['sha256']
        assert placement['montane']['hydraulicCompilerSha256']==sha(ROOT/'tools/prepare_mesoscale.py')
        for key,file in [('coverSha256','original-cover.png'),('outcropSha256','original-outcrop.png'),('originalFieldSha256','original-forest-field.png')]:
            assert placement[key]==sha(directory/file)
        for file in placement['files']:
            size=meta['n'] if file['file']=='forest-placement.png' else 1024
            verify_files(directory,[file],size)
        policy=np.asarray(Image.open(directory/'forest-placement.png'))
        original_field=np.asarray(Image.open(directory/'original-forest-field.png'))
        base=np.asarray(Image.open(directory/'forest-base-field.png'))
        supplement=np.asarray(Image.open(directory/'montane-forest.png'))
        placed=np.asarray(Image.open(directory/'forest-placed-field.png'))
        assert (base[...,0]<=original_field[...,0]).all()
        np.testing.assert_array_equal(base[...,1:],original_field[...,1:])
        np.testing.assert_array_equal(placed[supplement[...,0]==0],base[supplement[...,0]==0])
        assert supplement[...,0].max()<=16
        live=supplement[...,0]>0
        if live.any():
            assert supplement[...,1][live].min()>=22 and supplement[...,1][live].max()<=46
            assert supplement[...,2][live].min()>=246
        expected=base[...,0]+supplement[...,0]*(1-base[...,0]/255)
        assert np.abs(placed[...,0]-expected).max()<1.1
        g=read_fields(directory,meta['ground']['grids'],meta['n'],['geomorphon150','slope','soilDepth'])
        f=read_fields(directory,meta['groundSurface']['grids'],meta['n'],['fragmentCover','exposedRock','renderSnow','waterCoverage','distanceSea'])
        outcrop=np.asarray(Image.open(directory/'original-outcrop.png').getchannel('R').resize((meta['n'],meta['n']),Image.Resampling.BILINEAR))/255
        excluded=(np.isin(g['geomorphon150'],[2,3])|(g['slope']>=32)|(g['soilDepth']<=.12)|(f['fragmentCover']>=.42)|(np.maximum(f['exposedRock'],outcrop)>=.35)|(f['renderSnow']>=.25)|(f['waterCoverage']>0)|(f['distanceSea']<100))
        yy,xx=np.where(excluded);density=supplement[...,0]
        assert not map_coordinates(density,[(yy+.5)/meta['n']*1024-.5,(xx+.5)/meta['n']*1024-.5],order=1,mode='nearest').any(),entry['id']
        river=np.asarray(Image.open(directory/meta['groundSurface']['riverFootprint']).getchannel('A'))
        yy,xx=np.where(river>0)
        assert not map_coordinates(density,[(yy+.5)/river.shape[0]*1024-.5,(xx+.5)/river.shape[1]*1024-.5],order=1,mode='nearest').any(),entry['id']
        assert not policy[...,0][np.isin(g['geomorphon150'],[2,3])].any()
        assert not policy[...,1][np.isin(g['geomorphon150'],[2,3])].any()
        assert not policy[...,0][g['slope']>=42].any()
        if meta['precipitation']<=150:assert not placed[...,0].any()
        descriptor = read(directory/'surface-water-detail.json')
        assert descriptor['generatorSha256'] == water['generatorSha256']
        assert descriptor['heightSha256'] == meta['heightSha256']
        verify_files(directory, [{'file': descriptor['file'], 'sha256': descriptor['sha256']}], meta['n'])
        shore=descriptor['shoreline'];assert shore['profile']=='signed-shore-interpolating-v2'
        assert shore['hydrologySha256']==sha(directory/meta['hydrology']['grids']['file'])
        assert shore['sourceMapSha256']==sha(directory/meta['map']) and shore['riverMaskSha256']==sha(directory/'surface-water.png')
        verify_files(directory,[{'file':shore['file'],'sha256':shore['sha256']}],meta['n'])
        packed=np.asarray(Image.open(directory/shore['file']),dtype=np.int32)
        standing=np.asarray(Image.open(directory/'surface-water.png'))
        for pair,channel in [(0,2),(2,1)]:
            coefficients=(packed[...,pair]*256+packed[...,pair+1]-32768)/32
            reconstructed=convolve1d(convolve1d(coefficients,[1/6,4/6,1/6],axis=0,mode='nearest'),[1/6,4/6,1/6],axis=1,mode='nearest')
            assert (reconstructed[standing[...,channel]>0]<0).all(),entry['id']
            assert (reconstructed[standing[...,channel]==0]>0).all(),entry['id']
        for ref in shore['references']:
            assert sha(directory/ref['file'])==ref['sha256']
            with Image.open(directory/ref['file']) as im:assert im.size==(meta['n'],meta['n']) and im.mode=='RGB'
    print('PASS: 42 opaque original covers, forest-only placement, clear ridges/deserts, hydraulic water maps and 2 wave textures')

if __name__ == '__main__':
    main()
