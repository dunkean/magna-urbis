"""Reproduce the pre-mesoscale renderer snapshot for a bounded GPU comparison."""
import hashlib
import json
from pathlib import Path
import subprocess
import gzip
import shutil
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
COMMIT='338efaf428ccd1f3aa6724c5749bf4f2f7fbb8ab'
def main():
    target=ROOT/'evidence/meso-baseline';target.mkdir(parents=True,exist_ok=True);files=[]
    sources=['tile_viewer.gd','tile_terrain.gdshader','mesoscale.gd','shaders/terrain_detail.gdshaderinc','shaders/meso_material.gdshaderinc','shaders/surface_water.gdshaderinc','tools/prepare_mesoscale.py']
    mapping={source:Path(source).name for source in sources}
    for source,name in mapping.items():
        blob=subprocess.run(['git','show',f'{COMMIT}:godot-render/{source}'],cwd=ROOT,check=True,capture_output=True).stdout
        code=blob.decode('utf-8')
        if source!='tools/prepare_mesoscale.py':
            for old,new in mapping.items():code=code.replace('res://'+old,'res://evidence/meso-baseline/'+new)
        if source=='mesoscale.gd':
            code=code.replace('var path=directory.path_join("meso-context.json")','directory="res://evidence/meso-baseline/tiles/"+directory.get_file()\n\tvar path=directory.path_join("meso-context.json")')
        if source=='tile_viewer.gd':code=code.replace('forest-placed-field.png','forest-base-field.png')
        (target/name).write_bytes(code.encode('utf-8'))
        files.append({'source':source,'sourceSha256':hashlib.sha256(blob).hexdigest()})
    # Rebuild the actual old context from retained N1/DEM inputs, rather than
    # benchmarking the old shader against new amplitudes. Redirect only these
    # cache reads; all base PBR/native/source assets remain shared.
    old={"__name__":"baseline_context","__file__":str(target/'prepare_mesoscale.py')}
    exec((target/'prepare_mesoscale.py').read_text(encoding='utf-8'),old)
    for tile in ['mountains--temperate','coastal-plain--temperate','coastal-plain--arid','hills--cold']:
        directory=ROOT/'tiles'/tile;cache=target/'tiles'/tile;cache.mkdir(parents=True,exist_ok=True)
        meta=json.loads((directory/'tile.json').read_text(encoding='utf-8'));n=meta['n'];schema=meta['groundSurface']['grids'];blob=gzip.decompress((directory/schema['file']).read_bytes())
        fields={k:np.frombuffer(blob,'<f4',count=n*n,offset=schema['fields'][k]['offset']).reshape(n,n) for k in ['exposedRock','fragmentCover','matrixCover','structuralRoughness','looseSand','renderSnow','surfaceCover','waterCoverage']}
        placement=np.asarray(Image.open(directory/'forest-placement.png'),np.float32)/255
        river=np.asarray(Image.open(directory/'surface-river-footprint.png').getchannel('A'))
        protected=old['conservative_water'](fields['waterCoverage'],river)
        values=old['context'](fields,placement,protected,meta['width']/n);data=values.tobytes();(cache/'meso-context.rgba32f').write_bytes(data)
        for name in ['forest-placement.png','surface-river-footprint.png']:shutil.copyfile(directory/name,cache/name)
        sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
        descriptor={'n':n,'format':'RGBA32F','sha256':hashlib.sha256(data).hexdigest(),'sources':{'generator':sha(target/'prepare_mesoscale.py'),'height':meta['heightSha256'],'surface':schema['sha256'],'placement':sha(directory/'forest-placement.png'),'river':sha(directory/'surface-river-footprint.png')}}
        (cache/'meso-context.json').write_text(json.dumps(descriptor),encoding='utf-8')
    (target/'source.json').write_text(json.dumps({'commit':COMMIT,'files':files},indent=2),encoding='utf-8')
    print('Prepared original baseline',COMMIT)
if __name__=='__main__':main()
