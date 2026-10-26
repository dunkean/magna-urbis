"""Local deterministic water maps; no downloads, no change to hydraulic levels.

Two periodic slope textures are sampled at incommensurate world scales and
advected independently. Native hydro supplies flow, optical depth and banks.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, spline_filter, label
from scipy.spatial import cKDTree
from surface_context import load_hydrology

ROOT = Path(__file__).resolve().parents[1]


def wave_texture(seed=43189, n=512):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[:n, :n] * (2 * np.pi / n)
    value = np.zeros((n, n), np.float64)
    sx, sy = value.copy(), value.copy()
    for _ in range(72):
        kx, ky = rng.integers(-24, 25, 2)
        length = np.hypot(kx, ky)
        if length < 2:
            continue
        phase = kx*x + ky*y + rng.uniform(0, 2*np.pi)
        amplitude = np.exp(-length/11) / length**1.6
        value += np.sin(phase)*amplitude
        sx += np.cos(phase)*amplitude*kx
        sy += np.cos(phase)*amplitude*ky
    slopes = np.stack((sx, sy), -1)
    slopes /= max(float(np.max(np.abs(slopes))), 1.e-6)
    foam = (value-value.min()) / (value.max()-value.min())
    return np.uint8(np.rint(np.clip(np.dstack((slopes*.5+.5, foam, np.ones_like(foam))), 0, 1)*255))


def water_field(height, hydro, cell, river=None):
    n = height.shape[0]
    index = np.arange(n*n).reshape(n, n)
    receiver = hydro['receiver'].astype(np.int64)
    valid = (receiver >= 0) & (receiver < n*n) & (receiver != index)
    dx = np.where(valid, receiver % n-index % n, 0)
    dz = np.where(valid, receiver // n-index // n, 1)
    length = np.maximum(np.hypot(dx, dz), 1)
    flow_x=dx/length;flow_z=dz/length
    if river is not None and river.any():
        distance,nearest=distance_transform_edt(~river,sampling=cell,return_indices=True)
        # Fixed shader frames around streams read the stream's downstream
        # direction, rather than arbitrary hillslope flow beside its bank.
        flow_x=np.where(distance<128,flow_x[tuple(nearest)],flow_x)
        flow_z=np.where(distance<128,flow_z[tuple(nearest)],flow_z)
    standing = (hydro['sea'] > 0) | (hydro['lake'] > 0)
    shore = distance_transform_edt(standing, sampling=cell) if standing.any() else np.zeros_like(height)
    depth = np.where(hydro['sea'] > 0, np.maximum(-height, 0),
                     np.where(hydro['lake'] > 0, np.maximum(hydro['lakeLevel']-height, 0), 0))
    # RG unit downstream direction, B inward shore distance / 256 m, A depth / 50 m.
    return np.uint8(np.rint(np.clip(np.dstack((flow_x*.5+.5, flow_z*.5+.5, shore/256, depth/50)), 0, 1)*255))

def level_shore_distance(wet, height, level, cell, signed):
    # Subcell level crossings follow the actual DEM/standing level rather
    # than always landing halfway between two binary wet/dry cells.
    scalar=np.where(wet,-np.maximum(np.abs(height-level),1e-6),np.maximum(np.abs(height-level),1e-6))
    mixed=(wet[:-1,:-1]!=wet[1:,:-1])|(wet[:-1,:-1]!=wet[:-1,1:])|(wet[:-1,:-1]!=wet[1:,1:])
    yy,xx=np.where(mixed);points=[]
    for y,x in zip(yy,xx):
        corners=[(x+.5,y+.5),(x+1.5,y+.5),(x+.5,y+1.5),(x+1.5,y+1.5)]
        values=[scalar[y,x],scalar[y,x+1],scalar[y+1,x],scalar[y+1,x+1]]
        for tri in [(0,1,2),(1,3,2)]:
            crossings=[]
            for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:
                if (values[a]<0)==(values[b]<0):continue
                t=abs(values[a])/(abs(values[a])+abs(values[b]));pa=corners[a];pb=corners[b]
                crossings.append((pa[0]+t*(pb[0]-pa[0]),pa[1]+t*(pb[1]-pa[1])))
            if len(crossings)==2:
                a,b=crossings
                for t in np.linspace(0,1,7):points.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
    if points:
        near=np.abs(signed)<180;yy,xx=np.where(near)
        distance=cKDTree(points).query(np.column_stack((xx+.5,yy+.5)))[0]*cell
        signed=signed.copy();signed[near]=np.where(wet[near],-distance,distance)
    return signed

def shoreline_field(hydro, cell, height=None):
    """Display-only signed shores; 16 bits each, 1/32m over +/-1024m.

    A mild reconstruction rounds the binary native staircase, then the GPU
    evaluates its continuous cubic B-spline. Original sea/lake data stay intact.
    """
    channels=[]
    for key in ['sea','lake']:
        wet=hydro[key].astype(bool)
        if wet.all():signed=np.full(wet.shape,-1024,np.float32)
        elif not wet.any():signed=np.full(wet.shape,1023,np.float32)
        else:
            signed=distance_transform_edt(~wet,sampling=cell)-distance_transform_edt(wet,sampling=cell)
            if height is not None:
                level=0
                if key=='lake':
                    nearest=distance_transform_edt(~wet,return_distances=False,return_indices=True)
                    level=hydro['lakeLevel'][tuple(nearest)]
                signed=level_shore_distance(wet,height,level,cell,signed)
            smooth=gaussian_filter(signed,sigma=.25 if height is not None else .65,mode='nearest')
            # Constrain every native centre's sign, including one-cell islands
            # and lakes, then store interpolating spline coefficients. A plain
            # smoothing B-spline would erase these small features.
            signed=np.where(wet,np.minimum(smooth,-cell*.02),np.maximum(smooth,cell*.02))
        coefficients=spline_filter(signed,order=3,mode='nearest')
        packed=np.rint(np.clip(coefficients*32+32768,0,65535)).astype(np.uint16)
        channels.extend([(packed>>8).astype(np.uint8),(packed&255).astype(np.uint8)])
    return np.stack(channels,-1)

def shore_reference(hydro, color, cell, river=None):
    wet=(hydro['sea']>0)|(hydro['lake']>0)
    def donors(mask):
        if not mask.any():return color.copy()
        components,count=label(mask)
        distance,nearest=distance_transform_edt(~mask,sampling=cell,return_indices=True)
        wanted=components[tuple(nearest)]
        inside=distance_transform_edt(mask,sampling=cell)
        safe=mask&(inside>=1.5*cell)
        has_safe=np.bincount(components[safe],minlength=count+1)>0
        safe|=mask&~has_safe[components]
        far,certified=distance_transform_edt(~safe,sampling=cell,return_indices=True)
        valid=(components[tuple(certified)]==wanted)&(far<=150)
        yy=np.where(valid,certified[0],nearest[0]);xx=np.where(valid,certified[1],nearest[1])
        return color[yy,xx]
    dry=~wet
    if river is not None:dry&=~river
    return donors(dry),donors(wet)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tile')
    args = parser.parse_args()
    directory = ROOT / 'materials/water'
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    for name, seed in [('ripples', 43189), ('capillary', 81913)]:
        file = name+'.png'
        Image.fromarray(wave_texture(seed)).save(directory/file)
        files.append({'file': file, 'sha256': hashlib.sha256((directory/file).read_bytes()).hexdigest()})
    (directory/'water.json').write_text(json.dumps({'version': 1, 'source': 'procedural Fourier slopes',
        'files': files, 'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
    catalogue = json.loads((ROOT/'tiles/catalog.json').read_text(encoding='utf-8'))
    for entry in catalogue['tiles']:
        if args.tile and args.tile != entry['id']:
            continue
        tile = ROOT/'tiles'/Path(entry['file']).parent
        meta = json.loads((tile/'tile.json').read_text(encoding='utf-8'))
        height = np.fromfile(tile/meta['height'], '<f4').reshape(meta['n'], meta['n'])
        hydro=load_hydrology(tile, meta)
        river=np.asarray(Image.open(tile/'surface-water.png'))[...,0]>0
        image = water_field(height, hydro, meta['width']/meta['n'],river)
        file = tile/'surface-water-detail.png'
        Image.fromarray(image).save(file)
        shore=tile/'surface-shoreline.png';Image.fromarray(shoreline_field(hydro,meta['width']/meta['n'],height)).save(shore)
        source=tile/meta['map'];color=np.asarray(Image.open(source).convert('RGB').resize((meta['n'],meta['n']),Image.Resampling.NEAREST))
        dry,wet=shore_reference(hydro,color,meta['width']/meta['n'],river)
        references=[]
        for name,values in [('dry',dry),('wet',wet)]:
            ref=tile/f'surface-shore-{name}.png';Image.fromarray(values).save(ref)
            references.append({'file':ref.name,'sha256':hashlib.sha256(ref.read_bytes()).hexdigest()})
        (tile/'surface-water-detail.json').write_text(json.dumps({'version': 2,
            'heightSha256': meta['heightSha256'], 'file': file.name,
            'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
            'channels': ['downstream X', 'downstream Z', 'shore distance / 256m', 'optical depth / 50m'],
            'shoreline':{'file':shore.name,'sha256':hashlib.sha256(shore.read_bytes()).hexdigest(),'hydrologySha256':hashlib.sha256((tile/meta['hydrology']['grids']['file']).read_bytes()).hexdigest(),'sourceMapSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'riverMaskSha256':hashlib.sha256((tile/'surface-water.png').read_bytes()).hexdigest(),'references':references,'profile':'signed-shore-interpolating-v2','unitsPerMetre':32,'displayOnly':True},
            'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
        print('WATER', entry['id'], flush=True)


if __name__ == '__main__':
    main()
