"""Place original Render3D trees only in forest, over a separate PBR soil.

The original field and tree model stay retained. This display policy adds
explicit forest/open-land/exposure exclusions, not an ecological simulation.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, minimum_filter

ROOT = Path(__file__).resolve().parents[1]

def ramp(lo, hi, x):
    t = np.clip((x-lo)/(hi-lo), 0, 1)
    return t*t*(3-2*t)

def resize(a, n, nearest=False):
    return np.asarray(Image.fromarray(a.astype(np.float32)).resize((n,n), Image.Resampling.NEAREST if nearest else Image.Resampling.BILINEAR), np.float32)

def read_fields(directory, schema, n, names):
    blob = gzip.decompress((directory/schema['file']).read_bytes())
    return {k: np.frombuffer(blob, '<f4', count=n*n, offset=schema['fields'][k]['offset']).reshape(n,n) for k in names}

def classify(g, f, cover, outcrop, field, height, temperature, precipitation, cell):
    local_t = temperature-.006*np.maximum(height,0)
    humidity = precipitation/np.maximum(20*local_t+280,120)
    dry = 1-ramp(.45,1.4,humidity)
    # Small crown-eligible densities are not a forest biome. Woods is the
    # actual (opaque, unpremultiplied) Render canopy guide, not field.r > 0.
    forest = ramp(.36,.66,cover[...,2])*ramp(.22,.55,field[...,0])
    forest *= ramp(5.5,9,field[...,1]*50)*ramp(.7,1.15,humidity)
    forest *= ramp(.06,.24,f['forestPotential'])
    exposure = np.maximum(outcrop, f['exposedRock'])
    ridge = np.isin(g['geomorphon150'], [2,3])
    shoulder = (g['geomorphon150']==4)&(g['slope']>22)&(exposure>.3)
    shore = f['distanceSea'] < 100
    water = f['waterCoverage'] > .01
    forbidden = ridge|shoulder|shore|water|(g['slope']>=42)|(exposure>=.65)
    # A physical-distance margin keeps bilinear interpolation and whole crowns
    # clear of narrow ridges and beaches; tree centres use the same gate.
    edge = ramp(20,70,distance_transform_edt(~forbidden,sampling=cell)) if forbidden.any() else np.ones_like(height)
    forest *= edge*(1-ramp(25,42,g['slope']))*(1-ramp(.22,.65,exposure))
    forest[forbidden] = 0
    # Only the matrix can receive litter/herbs/moss. Rock and fragments keep
    # their complete N1 budget in the shader, independently of this cap.
    soil = (1-ramp(.3,.7,exposure))*(1-ramp(32,47,g['slope']))
    soil[ridge|shoulder|water|(g['slope']>=42)|(exposure>=.65)] = 0
    soil *= 1-ramp(.15,.65,cover[...,1])  # exposed beach/deposit sand stays PBR sand
    return np.stack((np.clip(forest,0,1),np.clip(soil,0,1),np.clip(exposure,0,1),dry),-1)

def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def read(file):return json.loads(file.read_text(encoding='utf-8'))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--tile');args=parser.parse_args()
    catalogue=read(ROOT/'tiles/catalog.json')
    for entry in catalogue['tiles']:
        if args.tile and entry['id']!=args.tile:continue
        directory=ROOT/'tiles'/Path(entry['file']).parent;meta=read(directory/'tile.json');n=meta['n']
        descriptor=read(directory/'original-cover.json')
        if descriptor['version']!=2:raise ValueError('Re-export opaque original masks before placement: '+entry['id'])
        g=read_fields(directory,meta['ground']['grids'],n,['slope','geomorphon150'])
        f=read_fields(directory,meta['groundSurface']['grids'],n,['exposedRock','forestPotential','distanceSea','waterCoverage'])
        cover=np.asarray(Image.open(directory/'original-cover.png').resize((n,n),Image.Resampling.BILINEAR),np.float32)/255
        outcrop=np.asarray(Image.open(directory/'original-outcrop.png').getchannel('R').resize((n,n),Image.Resampling.BILINEAR),np.float32)/255
        raw_field=np.asarray(Image.open(directory/'original-forest-field.png')).copy()
        field=np.stack([resize(raw_field[...,i]/255,n) for i in range(4)],-1)
        height=np.fromfile(directory/meta['height'],'<f4').reshape(n,n)
        result=classify(g,f,cover,outcrop,field,height,meta['temperature'],meta['precipitation'],meta['width']/n)
        Image.fromarray(np.uint8(np.rint(result*255))).save(directory/'forest-placement.png')
        raw_field[...,0]=np.uint8(np.rint(raw_field[...,0]*resize(result[...,0],raw_field.shape[0])))
        Image.fromarray(raw_field).save(directory/'forest-placed-field.png')
        land=f['waterCoverage']<.01
        def point(score):
            score=score.copy();margin=max(1,int(n*.06))
            score[:margin,:]=-1;score[-margin:,:]=-1;score[:,:margin]=-1;score[:,-margin:]=-1
            y,x=np.unravel_index(np.argmax(score),score.shape)
            return [float((x+.5)*meta['width']/n),float((y+.5)*meta['width']/n)]
        examples={'bare':point(result[...,2]*land),
                  'open':point((result[...,0]<.01)*result[...,1]*(1-result[...,2])*land),
                  'sand':point(cover[...,1]*land)}
        dense=minimum_filter(result[...,0],size=9)
        if dense.max()>.5:examples['forest']=point(dense)
        files=[{'file':file,'sha256':sha(directory/file)} for file in ['forest-placement.png','forest-placed-field.png']]
        report={'version':1,'policy':'forest-only-pbr-matrix','generatorSha256':sha(Path(__file__)),
                'heightSha256':meta['heightSha256'],'groundSurfaceSha256':meta['groundSurface']['grids']['sha256'],
                'coverSha256':sha(directory/'original-cover.png'),'outcropSha256':sha(directory/'original-outcrop.png'),
                'originalFieldSha256':sha(directory/'original-forest-field.png'),
                'channels':['forest eligibility','PBR matrix cover cap','exposure priority','aridity'],
                'forestAreaFraction':float(np.mean(result[...,0]>.5)),'examples':examples,'files':files}
        (directory/'forest-placement.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('PLACEMENT',entry['id'],round(report['forestAreaFraction'],4),flush=True)

if __name__=='__main__':main()
