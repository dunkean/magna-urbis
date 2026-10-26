"""CPU-only optical coverage probe, using real retained candidate columns.

No population regeneration: reads the binary packet without touching its fields.
Produces a renderer calibration (envelope potential -> optical alpha union), not
a new climate/treeCover field. Requires Python+NumPy, no Blender/GPU.
"""
import argparse,hashlib,json,math,mmap,struct,time
from pathlib import Path
import numpy as np

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
args=argparse.ArgumentParser();args.add_argument('--prepared',required=True);args.add_argument('--packet',required=True);args.add_argument('--out',required=True)
options=args.parse_args();started=time.monotonic();prepared=Path(options.prepared)
asset=json.loads((prepared/'report.json').read_text(encoding='utf-8'));desc=asset['lods'][0]['views'][0]['sharedMask']
mask_path=prepared/desc['path'];assert sha(mask_path)==desc['sha256'];mask=np.frombuffer(mask_path.read_bytes(),np.uint8).reshape((desc['height'],desc['width']))
def sample(x,z):
    gx=(x-desc['originX'])/desc['spacing'];gz=(z-desc['originZ'])/desc['spacing'];ix=np.floor(gx).astype(np.int32);iz=np.floor(gz).astype(np.int32)
    valid=(gx>=0)&(gz>=0)&(gx<=desc['width']-1)&(gz<=desc['height']-1)
    ix=np.clip(ix,0,desc['width']-2);iz=np.clip(iz,0,desc['height']-2)
    fx=gx-ix;fz=gz-iz
    value=((mask[iz,ix]*(1-fx)+mask[iz,ix+1]*fx)*(1-fz)+(mask[iz+1,ix]*(1-fx)+mask[iz+1,ix+1]*fx)*fz)/255
    return np.where(valid,value,0)
def cutout(x,z):return (sample(x,z)>=.5).astype(float)

# Integrate the SAME stratified binomial32slot/20m process, including radius and
# orientation distributions. A scalar cover*single-crown-opacity misses overlap.
distances=np.linspace(0,7.56*1.1,1025);radii=np.linspace(1.68,7.56,64,endpoint=False)+(7.56-1.68)/128
angles=np.arange(128)*math.tau/128
kernel=np.array([cutout(d/radii[:,None]*np.cos(angles),d/radii[:,None]*np.sin(angles)).mean() for d in distances])
opt_support=[];disc_support=[]
centres=(np.arange(32)+.5)/32*20
for pz in range(8):
    for px in range(8):
        optical=[];envelope=[];x=(px+.5)*20/8;z=(pz+.5)*20/8
        for cz in [-1,0,1]:
            for cx in [-1,0,1]:
                distance=np.hypot(centres[None,:]+cx*20-x,centres[:,None]+cz*20-z)
                optical.append(float(np.interp(distance,distances,kernel,left=kernel[0],right=0).mean()))
                envelope.append(float(np.clip((7.56-distance)/(7.56-1.68),0,1).mean()))
        opt_support.append(optical);disc_support.append(envelope)
probabilities=np.linspace(0,1,257)
optical_curve=[float(1-np.prod((1-p*np.array(opt_support))**32,axis=1).mean()) for p in probabilities]
envelope_curve=[float(1-np.prod((1-p*np.array(disc_support))**32,axis=1).mean()) for p in probabilities]
single_ratio=float(np.sum(mask>=128)*desc['spacing']**2/math.pi)
examples=[]
for cover in [.1,.25,.5,.8,.95]:
    p=float(np.interp(cover,envelope_curve,probabilities));opt=float(np.interp(p,probabilities,optical_curve))
    examples.append({'envelopePotential':cover,'unchangedAcceptanceProbability':p,'opticalMean':opt,'incorrectLinearShortcut':cover*single_ratio})

with open(options.packet,'rb') as stream:
    binary=mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ);assert binary[:8]==b'MUFSURF1'
    manifest_length=struct.unpack_from('<I',binary,8)[0];manifest=json.loads(binary[16:16+manifest_length]);start=(16+manifest_length+7)//8*8
    def column(name):
        a=next(a for a in manifest['arrays'] if a['path']==['candidateColumns',name]);return np.frombuffer(binary,dtype={'f32':'<f4','f64':'<f8','u8':'u1'}[a['dtype']],count=a['length'],offset=start+a['offset'])
    meta=manifest['value']['candidateColumns'];tree=meta['families'].index('tree');which=column('family')==tree
    page=manifest['value'].get('candidatePages',{}).get('tree',{})
    assert page.get('complete') is True and page.get('includeOverhang') is True and page.get('retention')==1
    positions=column('positions').reshape((-1,3))[which].copy();orientation=column('orientation')[which].copy();radius=column('crownRadiusM')[which].copy();rank=column('rank')[which].copy()
    ids=[key for key,used in zip(meta['ids'],which) if used]
    # Avoid lingering NumPy references into mmap before closing it.
    binary.close()
cells=512;width=320.0;pitch=width/cells;cx=20000.0;cz=20000.0
assert page['bounds']['minX']<=cx-width/2-7.56*1.1 and page['bounds']['maxX']>=cx+width/2+7.56*1.1
assert page['bounds']['minZ']<=cz-width/2-7.56*1.1 and page['bounds']['maxZ']>=cz+width/2+7.56*1.1
coverage=np.zeros((cells,cells),np.uint16);selections=[[np.zeros_like(coverage) for _ in range(4)] for _ in range(3)]
selected_counts=[np.zeros((cells,cells,4),np.uint16) for _ in range(3)]
for (x,y,z),angle,r,selection_rank in zip(positions,orientation,radius,rank):
    lowx=max(0,int(math.floor((x-r*1.1-(cx-width/2))/pitch)));highx=min(cells,int(math.ceil((x+r*1.1-(cx-width/2))/pitch)))
    lowz=max(0,int(math.floor((z-r*1.1-(cz-width/2))/pitch)));highz=min(cells,int(math.ceil((z+r*1.1-(cz-width/2))/pitch)))
    if lowx>=highx or lowz>=highz:continue
    dx=cx-width/2+(np.arange(lowx,highx)+.5)*pitch-x;dz=cz-width/2+(np.arange(lowz,highz)+.5)*pitch-z
    localx=(math.cos(angle)*dx[None,:]-math.sin(angle)*dz[:,None])/r;localz=(math.sin(angle)*dx[None,:]+math.cos(angle)*dz[:,None])/r
    binary=cutout(localx,localz).astype(np.uint16);alpha=binary.astype(np.uint32)*255
    radius_bin=int(np.argmin(np.abs(np.array([2.5,4,5.5,7])-r)))
    def union(target,weight):
        old=target[lowz:highz,lowx:highx].astype(np.uint32);target[lowz:highz,lowx:highx]=old+((255-old)*weight+127)//255
    union(coverage,alpha)
    for target,counts,threshold in zip(selections,selected_counts,[.2,.5,1]):
        if selection_rank<threshold:
            counts[lowz:highz,lowx:highx,radius_bin]+=binary
            for level,weight in zip(target,[0,.25,.5,1]):union(level,np.rint(alpha*weight).astype(np.uint32))
cases=[]
for selected,retention in zip(selections,[.2,.5,1]):
    for visible,geometry_weight in zip(selected,[0,.25,.5,1]):
        c=coverage.astype(float)/255;v=visible.astype(float)/255
        residual=np.where(v<1,(c-v)/np.maximum(1-v,1e-12),0);reconstructed=v+(1-v)*residual
        excess=int(np.sum(v>c+1e-12));error=float(np.max(np.abs(reconstructed-c)))
        assert excess==0 and error<1e-12
        cases.append({'rankSelectionThreshold':retention,'geometryWeight':geometry_weight,'coverageAboveTargetPixels':excess,'maximumResidualCompositionError':error})
count_cases=[]
def mip(image,level):
    side=2**level
    return image.reshape((cells//side,side,cells//side,side)).mean(axis=(1,3))
for counts,retention in zip(selected_counts,[.2,.5,1]):
    for footprint in [.02,.25,1,4,10]:
        t=np.clip((2*np.array([2.5,4,5.5,7])/footprint-3)/5,0,1);lod=t*t*(3-2*t)
        for phase in [0,.25,.5,1]:
            visible=1-np.prod((1-phase*lod)**counts,axis=2)
            for level in [0,1,2,3]:
                # Filter responses with the same dyadic kernel, never average
                # counts before pow(). Bilinear blends then preserve the bound.
                c=mip(coverage.astype(float)/255,level);v=mip(visible,level)
                assert np.max(v-c)<1e-12
                residual=np.where(v<1,(c-v)/np.maximum(1-v,1e-12),0)
                assert np.max(abs(v+(1-v)*residual-c))<1e-12
            count_cases.append({'rankSelectionThreshold':retention,'pixelFootprintM':footprint,'geometryWeight':phase,'dyadicLevelsChecked':[0,1,2,3],'coverageAboveTargetPixels':0})
result={'format':'asset-mask-optical-calibration-probe','version':1,'status':'CPU_ALGEBRA_PASS_NOT_RENDERER_QUALIFIED','packetSha256':sha(options.packet),'assetMaskSha256':desc['sha256'],'sourceCandidateTreeCount':len(ids),'candidateIdsSha256':hashlib.sha256('\n'.join(ids).encode()).hexdigest(),'mutatedSource':False,'sharedGrid':{'width':cells,'height':cells,'spacingM':pitch,'bounds':{'minX':cx-width/2,'minZ':cz-width/2,'maxX':cx+width/2,'maxZ':cz+width/2}},'exactOpticalCoverageMean':float(coverage.mean()/255),'singleCrownAlphaAreaToEnvelope':single_ratio,'calibration':{'cellM':20,'slots':32,'radiusDistribution':[1.68,7.56],'positionQuadrature':32,'probeQuadrature':8,'orientationQuadrature':128,'radiusQuadrature':64,'probabilities':probabilities.tolist(),'envelopePotential':envelope_curve,'opticalMean':optical_curve,'examples':examples},'cases':cases,'elapsedSeconds':time.monotonic()-started,'scope':'Actual retained candidates, same prepared A8/grid/rotation/radii for C and selectedV, stable-rank diagnostic subsets; proves union/residual algebra only. Production selection, GPU silhouette, oblique parallax, filtered mips, energy and whole-view continuity remain unqualified.'}
result['maskSampling']='binary step(.5,bilinear prepared A8); same transform for total and selected coverage'
repo=Path(__file__).resolve().parents[2]
result['populationProcessSources']={name:sha(repo/'web/src/surface'/name) for name in ['treeCanopy.ts','population.ts']}
result['completeSourceTreePage']=page
result['opticalCalibrationDigest']=hashlib.sha256(json.dumps({'assetDigest':asset['assetDigest'],'mask':desc,'process':result['populationProcessSources'],'calibration':result['calibration'],'maskSampling':result['maskSampling']},sort_keys=True,separators=(',',':')).encode()).hexdigest()
result['counts4Bins']={'radii':[2.5,4,5.5,7],'maximumCount':int(max(np.max(c) for c in selected_counts)),'cases':count_cases,'filterPolicy':'pow/count response first, common dyadic and bilinear filtering afterwards'}
Path(options.out).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:result[k] for k in ['status','sourceCandidateTreeCount','exactOpticalCoverageMean','elapsedSeconds']}))
