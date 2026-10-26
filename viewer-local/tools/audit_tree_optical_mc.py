"""Independent CPU process/mask Monte Carlo. No Blender, Godot or GPU needed.

Unlike the producer quadrature, this samples actual unchanged seeded cells and
query points. All density thresholds reuse each realization's minimum accepted
random value at a covering crown. Uncertainty is estimated between realizations.
"""
import argparse,hashlib,json,math,struct,time
from pathlib import Path
import numpy as np
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('--prepared',required=True);p.add_argument('--generator',required=True);p.add_argument('--out',required=True);p.add_argument('--points',type=int,default=200000);a=p.parse_args()
assert 20000<=a.points<=1000000
started=time.monotonic();root=Path(a.prepared);witness_root=Path(a.generator);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
descriptor=json.loads((root/'resolved.json').read_text());prepared=json.loads((root/'report.json').read_text());generator=json.loads((witness_root/'generator.json').read_text());mask_meta=descriptor['mask'];raw=(root/mask_meta['path']).read_bytes();mask=np.frombuffer(raw,np.uint8).reshape((1024,1024));lut=np.frombuffer((root/descriptor['lookup']['path']).read_bytes(),'<f4').copy();checks=0
def sha(data):return hashlib.sha256(data).hexdigest()
def check(v,message):
 global checks
 checks+=1
 if not v:raise AssertionError(message)
check(sha(raw)==mask_meta['sha256'],'actual A8 hash');check(sha((root/descriptor['lookup']['path']).read_bytes())==descriptor['lookup']['sha256'],'actual LUT hash')
check(mask_meta['coordinateSystem'].find('row0=minZ')>=0,'minZ-first declared');check(mask_meta['spacing']==2.2/1024,'exact1024 pitch');check(abs(mask_meta['originX']+1.1-mask_meta['spacing']/2)<1e-14,'half-texel x');check(mask_meta['originX']==mask_meta['originZ'],'half-texel z')
check(np.all(np.diff(lut)>=0) and lut[0]==0,'LUT finite monotone');check(np.all(np.isfinite(lut)),'LUT finite')
alpha=np.array(Image.open(root/prepared['lods'][0]['views'][0]['products']['albedo']['path']).convert('RGBA'))[:,:,3]
check(np.array_equal(alpha,mask),'shared minZ-first A8 bytes match prepared top PNG alpha')

def access(document,binary,index):
 v=document['accessors'][index];view=document['bufferViews'][v['bufferView']];assert v['componentType']==5126 and v['type']=='VEC3'
 return np.ndarray((v['count'],3),dtype='<f4',buffer=binary,offset=view.get('byteOffset',0)+v.get('byteOffset',0),strides=(view.get('byteStride',12),4)).astype(float)
glb=(root/descriptor['sourceGeometry']['path']).read_bytes();check(sha(glb)==descriptor['sourceGeometry']['sha256'],'actual rooted GLB hash');length=struct.unpack_from('<I',glb,12)[0];gltf=json.loads(glb[20:20+length]);binary=glb[28+length:]
check(len(gltf['nodes'])==1 and 'matrix' not in gltf['nodes'][0] and 'rotation' not in gltf['nodes'][0] and 'translation' not in gltf['nodes'][0] and 'scale' not in gltf['nodes'][0],'positions are in exported root frame')
vertices=np.concatenate([access(gltf,binary,prim['attributes']['POSITION']) for mesh in gltf['meshes'] for prim in mesh['primitives']]);lo=vertices.min(axis=0);hi=vertices.max(axis=0);support=np.hypot(vertices[:,0],vertices[:,2]).max();stem=vertices[vertices[:,1]<lo[1]+.01*(hi[1]-lo[1])];stem_pivot=np.median(stem[:,[0,2]],axis=0)
check(support<=1.000001,'physical crown radius remains bounded');check(abs(lo[1])<.001 and abs(hi[1]-1)<.001,'reported vertical fit residual, no root reseating');check(np.linalg.norm(stem_pivot)<.002,'stem bottom remains near declared root')
zz,xx=np.where(mask>=128);mask_bounds=[mask_meta['originX']+xx.min()*mask_meta['spacing'],mask_meta['originZ']+zz.min()*mask_meta['spacing'],mask_meta['originX']+xx.max()*mask_meta['spacing'],mask_meta['originZ']+zz.max()*mask_meta['spacing']]
check(abs(mask_bounds[1]-lo[2])<.04 and abs(mask_bounds[3]-hi[2])<.04,'minZ-first footprint agrees with exported GLB, not mirrored z')

def sample_mask(x,z):
 gx=(x-mask_meta['originX'])/mask_meta['spacing'];gz=(z-mask_meta['originZ'])/mask_meta['spacing'];valid=(gx>=0)&(gx<=1023)&(gz>=0)&(gz<=1023)
 ix=np.clip(np.floor(gx).astype(np.int64),0,1022);iz=np.clip(np.floor(gz).astype(np.int64),0,1022);fx=gx-ix;fz=gz-iz
 # Independent four-term interpolation instead of the producer's nested lerps.
 value=mask[iz,ix]*(1-fx)*(1-fz)+mask[iz,ix+1]*fx*(1-fz)+mask[iz+1,ix]*(1-fx)*fz+mask[iz+1,ix+1]*fx*fz
 return valid&(value>=127.5)
def fnv(text):
 h=2166136261
 for byte in text.encode('ascii'):h=((h^byte)*16777619)&0xffffffff
 return h
def channel(prefix,k):
 with np.errstate(over='ignore'):
  v=(prefix^np.uint32(ord(str(k))))*np.uint32(16777619);v=(v^(v>>np.uint32(16)))*np.uint32(0x7feb352d);v=(v^(v>>np.uint32(15)))*np.uint32(0x846ca68b);v=v^(v>>np.uint32(16))
 return v.astype(np.float64)/4294967296
def records_for_seed(seed):
 ids=[f'{seed}:tree:{cx}:{cz}:{slot}' for cz in range(-26,26) for cx in range(-26,26) for slot in range(32)]
 prefix=np.array([fnv(s+':') for s in ids],np.uint32);cx=np.repeat(np.tile(np.arange(-26,26),52),32);cz=np.repeat(np.repeat(np.arange(-26,26),52),32);size=4+channel(prefix,4)*14
 values=np.column_stack(((cx+channel(prefix,1))*20,(cz+channel(prefix,2))*20,size,size*.42,(channel(prefix,5)*math.pi)*2,channel(prefix,8),np.floor(channel(prefix,6)*8)))
 return ids,values,channel(prefix,3)

densities=generator['densities'];prob=np.array([d['acceptance'] for d in densities]);cover=np.array([d['actualCover'] for d in densities]);pred=np.interp(cover,np.arange(257)/256,lut);realizations=[];rng_checks=[];cv_checks=[];radii_bins=np.array([2.5,4,5.5,7.]);target_index=9
for seed_info in generator['seeds']:
 seed=seed_info['seed'];ids,values,accept=records_for_seed(seed);actual=(witness_root/seed_info['file']).read_bytes();check(sha(actual)==seed_info['sha256'],'actual generator data hash');check(values.tobytes()==actual,f'independent candidate records exact seed{seed}');check(sha('\n'.join(ids).encode())==seed_info['idsSha256'],'independent IDs exact')
 for w in seed_info['witnesses']:
  selected=accept<w['acceptance'];check(int(selected.sum())==w['count'],'actual acceptance count');check(sha('\n'.join(s for s,keep in zip(ids,selected) if keep).encode())==w['idsSha256'],'actual retained IDs/order');check(sha(values[selected].tobytes())==w['recordsSha256'],'all accepted positions/radii/rotations/ranks unchanged')
 rng_checks.append({'seed':seed,'records':len(ids),'allRecordBytesAndIdsExact':True,'actualDensityWitnesses':len(seed_info['witnesses'])})
 field=values.reshape((52,52,32,7));accept=accept.reshape((52,52,32));rng=np.random.default_rng(int.from_bytes(hashlib.sha256(('probe:'+str(seed)).encode()).digest()[:8],'little'));points=rng.uniform(-500,500,(a.points,2));minimum_opt=np.ones(a.points);minimum_disc=np.ones(a.points);counts=np.zeros((a.points,3,4),np.uint16)
 for begin in range(0,a.points,4096):
  end=min(begin+4096,a.points);point=points[begin:end];cx=np.floor(point[:,0]/20).astype(int);cz=np.floor(point[:,1]/20).astype(int);opt=np.ones(end-begin);disc=np.ones(end-begin)
  for dz in [-1,0,1]:
   for dx in [-1,0,1]:
    trees=field[cz+dz+26,cx+dx+26];chance=accept[cz+dz+26,cx+dx+26]
    for slot in range(32):
     t=trees[:,slot];q=chance[:,slot];vx=point[:,0]-t[:,0];vz=point[:,1]-t[:,1];rr=t[:,3];d2=vx*vx+vz*vz;inside=d2<=rr*rr;disc=np.minimum(disc,np.where(inside,q,1))
     nearby=np.flatnonzero(d2<=(rr*1.1)**2)
     if not nearby.size:continue
     angle=t[nearby,4];c=np.cos(angle);s=np.sin(angle);local_x=(c*vx[nearby]-s*vz[nearby])/rr[nearby];local_z=(s*vx[nearby]+c*vz[nearby])/rr[nearby];hits=nearby[sample_mask(local_x,local_z)]
     opt[hits]=np.minimum(opt[hits],q[hits]);accepted=hits[q[hits]<prob[target_index]]
     if accepted.size:
      bins=np.argmin(abs(t[accepted,3,None]-radii_bins),axis=1)
      for rank_index,threshold in enumerate([.2,.5,1.]):
       kept=t[accepted,5]<threshold;np.add.at(counts,(begin+accepted[kept],rank_index,bins[kept]),1)
  minimum_opt[begin:end]=opt;minimum_disc[begin:end]=disc
 optical=np.array([(minimum_opt<p).mean() for p in prob]);envelope=np.array([(minimum_disc<p).mean() for p in prob]);target=minimum_opt<prob[target_index]
 for footprint in [.02,.25,1,4,10]:
  t=np.clip((2*radii_bins/footprint-3)/5,0,1);lod=t*t*(3-2*t)
  for phase in [0,.25,.5,1]:
   for rank_index in range(3):
    visible=1-np.prod((1-phase*lod)**counts[:,rank_index,:],axis=1);check(np.all(visible<=target),'actual pointwise V<=C');residual=np.divide(target-visible,1-visible,out=np.zeros_like(visible),where=visible<1);check(np.max(abs(visible+(1-visible)*residual-target))<2e-15,'actual pointwise reconstruction')
    # Treat consecutive independent probe groups as an arbitrary common box
    # filter; correctness is algebraic for every positive linear filter.
    for block in [4,16,64]:
     n=(a.points//block)*block;c=target[:n].reshape((-1,block)).mean(axis=1);v=visible[:n].reshape((-1,block)).mean(axis=1);check(np.max(v-c)<2e-15,'filter response after pow preserves bound')
 cv_checks.append({'seed':seed,'pointCount':a.points,'selectedRankThresholds':[.2,.5,1.],'phases':[0,.25,.5,1.],'pixelFootprintsM':[.02,.25,1,4,10],'commonPositiveFilterBlockSizes':[4,16,64],'maximumCount':int(counts.max()),'VAboveC':0})
 realizations.append({'seed':seed,'opticalMean':optical.tolist(),'envelopeMean':envelope.tolist()});print(json.dumps({'seed':seed,'points':a.points,'opticalAtPotential085':float(optical[target_index]),'elapsedSeconds':time.monotonic()-started}),flush=True)

means=np.array([r['opticalMean'] for r in realizations]);env=np.array([r['envelopeMean'] for r in realizations]);estimate=means.mean(axis=0);critical=2.364624251;ci=critical*means.std(axis=0,ddof=1)/math.sqrt(len(realizations));results=[]
for i,d in enumerate(densities):
 error=float(estimate[i]-pred[i]);bound=abs(error)+float(ci[i]);results.append({**d,'lutOpticalMean':float(pred[i]),'monteCarloMean':float(estimate[i]),'errorPercentagePoints':100*error,'ci95HalfWidthPercentagePoints':100*float(ci[i]),'absoluteErrorPlusCI95PercentagePoints':100*bound,'passesTwoPercentagePoints':bound<=.02,'monteCarloEnvelopeMean':float(env[:,i].mean())})
# Negative control: averaging counts before pow can exceed the filtered source C.
right=.5*(1-.5**4);wrong=1-.5**2;check(right<=.5 and wrong>.5,'reject counts-before-pow negative control')
rows={'format':'independent-tree-optical-monte-carlo','version':1,'status':'PASS' if all(r['passesTwoPercentagePoints'] for r in results) else 'FAIL','checks':checks,'elapsedSeconds':time.monotonic()-started,'pointsPerSeed':a.points,'seeds':len(realizations),'totalPoints':a.points*len(realizations),'confidence':'Student t7 95% interval across8 independent seeded process/probe realizations; includes finite-domain and sampled-point variation, not only conditional binomial uncertainty','asset':{'descriptorDigest':descriptor['digest'],'sourceAssetDigest':descriptor['sourceAssetDigest'],'maskSha256':sha(raw),'lutSha256':sha((root/descriptor['lookup']['path']).read_bytes()),'maskBoundsXZ':mask_bounds,'glbBoundsXYZ':{'min':lo.tolist(),'max':hi.tolist()},'stemBottomMedianXZ':stem_pivot.tolist(),'horizontalRadius':float(support),'normalizedHeight':float(hi[1]-lo[1])},'generator':{'sourceHashes':generator['sourceHashes'],'witnesses':rng_checks,'heightRange':[4,18],'radiusRange':[1.68,7.56],'rotationRangeRadians':[0,math.tau],'rankRange':'[0,1)','cellM':20,'slots':32,'probeDomainXZ':[-500,500],'sourceCentreDomainXZ':[-520,520],'overhangGuaranteedM':20},'densities':results,'realizations':realizations,'selectedCoverage':cv_checks,'negativeControl':{'filteredSourceC':.5,'filterAfterPow':right,'wrongPowAfterMeanCounts':wrong,'wrongExceedsC':True},'scope':'CPU Monte Carlo of actual unchanged homogeneous generator and actual1024 root-pivot binary mask. Not cover times mean opacity. No source/ID/seed/acceptance changes, GPU/Blender or renderer activation. Stationary marginal LUT, not local finite-page exact C. Top-down footprint only; oblique parallax/silhouette/BRDF/shadow compatibility remains unqualified.'}
(out/'report.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps({'status':rows['status'],'checks':checks,'maximumAbsoluteErrorPlusCI95PercentagePoints':max(r['absoluteErrorPlusCI95PercentagePoints'] for r in results)}));raise SystemExit(0 if rows['status']=='PASS' else 1)
