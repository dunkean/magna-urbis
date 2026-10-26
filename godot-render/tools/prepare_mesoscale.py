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
from scipy.ndimage import binary_dilation, distance_transform_edt, maximum_filter, map_coordinates

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

def support_profiles(g, f):
    """Convex appearance profiles; soil/altered rock is the soft remainder."""
    fresh=1-.65*f['alteration'];rock=f['exposedRock']
    massive=rock*(g['bedrockGranite']+g['bedrockBasalt'])*fresh
    bedded=rock*(g['bedrockLimestone']+g['bedrockSandstone'])*fresh
    clastic=f['fragmentCover']*(1-.65*f['roundness'])*(.55+.45*g['colluvialPotential'])
    total=massive+bedded+clastic
    factor=np.maximum(total,1)
    weights=np.stack((massive/factor,bedded/factor,clastic/factor,1-total/factor),-1)
    # Largest remainder keeps an exact byte simplex, including profile borders.
    scaled=np.clip(weights,0,1)*255;quant=np.floor(scaled).astype(np.uint8)
    residual=255-quant.astype(np.int16).sum(-1);yy,xx=np.indices(residual.shape)
    for _ in range(3):
        best=np.argmax(scaled-quant,axis=-1);quant[yy,xx,best]+=(residual>0).astype(np.uint8);residual-=residual>0
    return quant

def presence_envelope(n, width, seed):
    # Fixed 150m world lattice. It only modulates amplitude, never thresholds
    # the colour into patches; its full derivative enters via the native cache.
    size=int(np.ceil(width/150))+3;rng=np.random.default_rng(seed)
    lattice=rng.uniform(-1,1,(size,size)).astype(np.float32)
    axis=(np.arange(n,dtype=np.float32)+.5)/n*width/150+1
    yy,xx=np.meshgrid(axis,axis,indexing='ij')
    smooth=np.clip(map_coordinates(lattice,[yy,xx],order=3,mode='nearest'),-1,1)
    return .88+.12*smooth

def prepare(entry):
    directory=ROOT/'tiles'/Path(entry['file']).parent;meta=read(directory/'tile.json');n=meta['n']
    schema=meta['groundSurface']['grids'];blob=gzip.decompress((directory/schema['file']).read_bytes())
    names=['exposedRock','fragmentCover','matrixCover','structuralRoughness','looseSand','renderSnow','surfaceCover','waterCoverage','alteration','roundness']
    fields={name:np.frombuffer(blob,'<f4',count=n*n,offset=schema['fields'][name]['offset']).reshape(n,n) for name in names}
    ground=meta['ground']['grids'];ground_blob=gzip.decompress((directory/ground['file']).read_bytes())
    g={name:np.frombuffer(ground_blob,'<f4',count=n*n,offset=ground['fields'][name]['offset']).reshape(n,n) for name in ['bedrockGranite','bedrockBasalt','bedrockLimestone','bedrockSandstone','colluvialPotential']}
    placement=np.asarray(Image.open(directory/'forest-placement.png'),np.float32)/255
    river=np.asarray(Image.open(directory/meta['groundSurface']['riverFootprint']).getchannel('A'))
    protected=conservative_water(fields['waterCoverage'],river)
    values=context(fields,placement,protected,meta['width']/n)
    seed=int.from_bytes(hashlib.sha256(meta['seed'].encode()).digest()[:8],'little')
    values[...,:2]*=presence_envelope(n,meta['width'],seed)[...,None]
    profile=directory/'meso-profiles.png';Image.fromarray(support_profiles(g,fields)).save(profile)
    file=directory/'meso-context.rgba32f';file.write_bytes(values.tobytes())
    report={'version':1,'format':'RGBA32F','n':n,'width':meta['width'],'file':file.name,'sha256':sha(file),
            'channels':['coarse amplitude metres','fine amplitude metres','fragment fraction','visible matrix cover'],
            'amplitudeBoundsMetres':[2.4,.6],'residualBoundMetres':3.0,
            'profiles':{'file':profile.name,'sha256':sha(profile),'channels':['massive rock','bedded rock','clastic','soft remainder']},
            'sources':{'generator':sha(Path(__file__)),'height':meta['heightSha256'],'surface':schema['sha256'],'ground':ground['sha256'],'structure':sha(directory/'surface-structure.png'),
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
