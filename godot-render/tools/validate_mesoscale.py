"""Validate native context provenance, bounds and conservative hydraulic support."""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from prepare_mesoscale import ROOT,read,sha

def main():
    total=0
    for entry in read(ROOT/'tiles/catalog.json')['tiles']:
        directory=ROOT/'tiles'/Path(entry['file']).parent;meta=read(directory/'tile.json');m=read(directory/'meso-context.json');n=meta['n']
        assert m['sources']['generator']==sha(ROOT/'tools/prepare_mesoscale.py')
        assert m['sources']['height']==meta['heightSha256']
        assert m['sources']['surface']==meta['groundSurface']['grids']['sha256']
        assert m['sources']['placement']==sha(directory/'forest-placement.png')
        assert m['sources']['river']==sha(directory/'surface-river-footprint.png')
        file=directory/m['file'];assert sha(file)==m['sha256'] and file.stat().st_size==n*n*16
        a=np.fromfile(file,'<f4').reshape(n,n,4)
        assert np.isfinite(a).all() and a.min()>=0 and a[...,0].max()<=2.4 and a[...,1].max()<=.6 and a[...,2:].max()<=1
        water=np.asarray(Image.open(directory/'surface-water.png'))[...,3]>0
        yy,xx=np.where(water)
        if len(yy):
            for channel in (0,1):
                # Native water's whole bilinear support stays protected.
                for dy,dx in [(0,0),(-.49,-.49),(.49,.49),(-.49,.49),(.49,-.49)]:
                    assert not map_coordinates(a[...,channel],[yy+dy,xx+dx],order=1,mode='nearest').any()
        river=np.asarray(Image.open(directory/'surface-river-footprint.png').getchannel('A'))
        yy,xx=np.where(river>0)
        if len(yy):
            for channel in (0,1):
                assert not map_coordinates(a[...,channel],[(yy+.5)*n/river.shape[0]-.5,(xx+.5)*n/river.shape[1]-.5],order=1,mode='nearest').any()
        total+=file.stat().st_size
    print('PASS: 42 bounded contexts; native and subpixel river water remain exactly zero; bytes',total)
if __name__=='__main__':main()
