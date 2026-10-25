"""Bounded native context cache for display-only multi-scale terrain residuals.

One RGBA32F grid per tile, never a full fine-resolution 40 km heightfield.
Hydraulic support is conservatively rasterized, dilated, and zeroed last.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, distance_transform_edt, maximum_filter

ROOT=Path(__file__).resolve().parents[1]
def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def read(file):return json.loads(file.read_text(encoding='utf-8'))
def ramp(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)

def conservative_water(water,river):
    n=water.shape[0]
    # Max rather than BOX: a subpixel spring must never disappear on reduction.
    radius=int(np.ceil(river.shape[0]/n))
    maximum=maximum_filter(river,size=2*radius+1,mode='nearest')
    projected=np.asarray(Image.fromarray(maximum).resize((n,n),Image.Resampling.NEAREST))
    wet=(water>0)|(projected>0)
    return binary_dilation(wet,structure=np.ones((3,3),bool))

def context(fields,placement,protected,cell):
    rock=fields['exposedRock'];fragments=fields['fragmentCover'];matrix=fields['matrixCover']
    rough=fields['structuralRoughness'];sand=np.clip(fields['looseSand']/np.maximum(matrix,.001),0,1)
    coarse=(.85+1.5*rock+.65*fragments)*(.75+.25*rough)*(1-.55*sand)*(1-.30*placement[...,0])
    fine=(.08+.43*rock+.20*fragments)*(.7+.3*rough)*(1-.5*sand)
    snow=fields['renderSnow'];coarse*=1-.55*snow;fine*=1-.65*snow
    distance=distance_transform_edt(~protected,sampling=cell) if protected.any() else np.full_like(rock,40000)
    coarse*=ramp(50,140,distance);fine*=ramp(25,75,distance)
    coarse=np.clip(coarse,0,2.4);fine=np.clip(fine,0,.6)
    coarse[protected]=0;fine[protected]=0
    soil=fields['surfaceCover']*placement[...,1]*matrix
    return np.asarray(np.stack((coarse,fine,fragments,soil),-1),dtype='<f4')

def prepare(entry):
    directory=ROOT/'tiles'/Path(entry['file']).parent;meta=read(directory/'tile.json');n=meta['n']
    schema=meta['groundSurface']['grids'];blob=gzip.decompress((directory/schema['file']).read_bytes())
    names=['exposedRock','fragmentCover','matrixCover','structuralRoughness','looseSand','renderSnow','surfaceCover','waterCoverage']
    fields={name:np.frombuffer(blob,'<f4',count=n*n,offset=schema['fields'][name]['offset']).reshape(n,n) for name in names}
    placement=np.asarray(Image.open(directory/'forest-placement.png'),np.float32)/255
    river=np.asarray(Image.open(directory/meta['groundSurface']['riverFootprint']).getchannel('A'))
    protected=conservative_water(fields['waterCoverage'],river)
    values=context(fields,placement,protected,meta['width']/n)
    file=directory/'meso-context.rgba32f';file.write_bytes(values.tobytes())
    report={'version':1,'format':'RGBA32F','n':n,'width':meta['width'],'file':file.name,'sha256':sha(file),
            'channels':['coarse amplitude metres','fine amplitude metres','fragment fraction','visible matrix cover'],
            'amplitudeBoundsMetres':[2.4,.6],'residualBoundMetres':3.0,
            'sources':{'generator':sha(Path(__file__)),'height':meta['heightSha256'],'surface':schema['sha256'],
                       'placement':sha(directory/'forest-placement.png'),'river':sha(directory/meta['groundSurface']['riverFootprint'])},
            'protectedCells':int(protected.sum()),'bytes':file.stat().st_size}
    (directory/'meso-context.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('MESO CONTEXT',entry['id'],flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--tile');parser.add_argument('--workers',type=int,default=2);args=parser.parse_args()
    entries=[e for e in read(ROOT/'tiles/catalog.json')['tiles'] if not args.tile or e['id']==args.tile]
    if not entries or args.workers<1:parser.error('Unknown tile or invalid worker count')
    with ThreadPoolExecutor(max_workers=args.workers) as pool:list(pool.map(prepare,entries))
if __name__=='__main__':main()
