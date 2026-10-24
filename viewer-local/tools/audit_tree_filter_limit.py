"""CPU counterexample to independently mismatched C/V mip levels.
Uses the actual mask and rotated authored layout from the independent atlas test.
No claim that the diagnostic camera/atlas ratio occurred in a shipped capture.
"""
import argparse,json,math
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--prepared',required=True);p.add_argument('--oracle',required=True);p.add_argument('--out',required=True);a=p.parse_args();root=Path(a.prepared);descriptor=json.loads((root/'resolved.json').read_text());oracle=json.loads(Path(a.oracle).read_text());meta=descriptor['mask'];mask=np.frombuffer((root/meta['path']).read_bytes(),np.uint8).reshape((1024,1024));n=2048;spacing=.03125;origin=-16+spacing/2
C=np.zeros((n,n),bool);V=np.zeros_like(C)
for tree in oracle['atlas']['candidates']:
 radius=tree['crownRadiusM'];ix0=max(0,math.ceil((tree['x']-radius*1.1-origin)/spacing));ix1=min(n,math.floor((tree['x']+radius*1.1-origin)/spacing)+1);iz0=max(0,math.ceil((tree['z']-radius*1.1-origin)/spacing));iz1=min(n,math.floor((tree['z']+radius*1.1-origin)/spacing)+1)
 dx=origin+np.arange(ix0,ix1)[None,:]*spacing-tree['x'];dz=origin+np.arange(iz0,iz1)[:,None]*spacing-tree['z'];c=math.cos(tree['orientation']);s=math.sin(tree['orientation']);x=(c*dx-s*dz)/radius;z=(s*dx+c*dz)/radius;gx=(x-meta['originX'])/meta['spacing'];gz=(z-meta['originZ'])/meta['spacing'];valid=(gx>=0)&(gx<=1023)&(gz>=0)&(gz<=1023);ix=np.clip(np.floor(gx).astype(int),0,1022);iz=np.clip(np.floor(gz).astype(int),0,1022);fx=gx-ix;fz=gz-iz
 alpha=mask[iz,ix]*(1-fx)*(1-fz)+mask[iz,ix+1]*fx*(1-fz)+mask[iz+1,ix]*(1-fx)*fz+mask[iz+1,ix+1]*fx*fz;hits=valid&(alpha>=127.5);C[iz0:iz1,ix0:ix1]|=hits
 if tree['stableId']in oracle['atlas']['selectedIds']:V[iz0:iz1,ix0:ix1]|=hits
assert np.all(V<=C)
def mip(field,level):
 side=2**level
 return field.reshape((n//side,side,n//side,side)).mean(axis=(1,3))
def bilinear(image,points,level):
 size=len(image);grid=np.clip((points+.5)/(2**level)-.5,0,size-1.001);cell=np.floor(grid).astype(int);f=grid-cell;x=cell[:,0];z=cell[:,1];fx=f[:,0];fz=f[:,1]
 return (image[z,x]*(1-fx)+image[z,x+1]*fx)*(1-fz)+(image[z+1,x]*(1-fx)+image[z+1,x+1]*fx)*fz
points=np.random.default_rng(4235).integers(32,992,(50000,2));footprint=1.;c=bilinear(mip(C,5),points,5);v=bilinear(mip(V,3),points,3);same=bilinear(mip(V,5),points,5)
# Selected bin1/3 have diameter8/14m; smoothstep(3,8,diameter/1m)=1.
assert 2*4/footprint>=8 and 2*7/footprint>=8
maximum=float((v-c).max());bad=int(np.count_nonzero(v>c+1e-12));assert maximum>.01 and bad>0 and np.max(same-c)<=1e-12
result={'format':'independent-canopy-filter-limit','version':1,'status':'CONDITIONAL_COUNTEREXAMPLE_REPRODUCED','gridSize':n,'spacingM':spacing,'footprintM':footprint,'phase':1,'selectedBins':[1,3],'selectedInstanceWeights':[1,1],'sourceCLevel':5,'selectedVLevelAfterCurrentCap':3,'queryPoints':len(points),'maximumVisibleAboveC':maximum,'queriesWithVisibleAboveC':bad,'sameLevel5KernelMaximumVisibleAboveC':float((same-c).max()),'finePointwiseVAboveC':0,'scope':'Actual prepared mask and independently validated rotated atlas layout. CPU emulates current shader C mip floor(log2(footprint/spacing)) vs selected-V cap3. Reachable only if an active geometry view permits footprint/atlasSpacing>8. No assertion that ordinary2048px tested views reached this ratio; oblique/resize/reuse invariants must exclude it or kernels must match. min(total,visible) conceals the internal overshoot but does not prove matching geometry/paint energy.'}
Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
