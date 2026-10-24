"""Conservative simultaneous intervals and an independent native mask oracle.
Reuses persisted MC realizations without rerunning or changing their samples.
"""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--prepared',required=True);p.add_argument('--input',required=True);p.add_argument('--out',required=True);a=p.parse_args();root=Path(a.prepared);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
data=Path(a.input).read_bytes();r=json.loads(data);descriptor=json.loads((root/'resolved.json').read_text());mask_meta=descriptor['mask'];raw=(root/mask_meta['path']).read_bytes();mask=np.frombuffer(raw,np.uint8).reshape((1024,1024))
assert r['asset']['maskSha256']==hashlib.sha256(raw).hexdigest()==mask_meta['sha256'];assert r['asset']['descriptorDigest']==descriptor['digest'];assert not mask.flags.writeable
assert r['asset']['lutSha256']==hashlib.sha256((root/descriptor['lookup']['path']).read_bytes()).hexdigest()
assert len(r['realizations'])==8 and len(r['densities'])==12
def tail7(t):
 theta=math.atan(t/math.sqrt(7));integral=lambda v:(10*v+7.5*math.sin(2*v)+1.5*math.sin(4*v)+math.sin(6*v)/6)/32
 return math.gamma(4)/(math.sqrt(math.pi)*math.gamma(3.5))*(integral(math.pi/2)-integral(theta))
def critical(tail):
 lo,hi=0.,32.
 for _ in range(80):
  middle=(lo+hi)/2
  if tail7(middle)>tail:lo=middle
  else:hi=middle
 return (lo+hi)/2
pointwise=critical(.025);assert abs(pointwise-2.364624251)<1e-8
simultaneous=critical(.05/(2*12));matrix=np.array([v['opticalMean'] for v in r['realizations']]);se=matrix.std(axis=0,ddof=1)/math.sqrt(8)
for i,row in enumerate(r['densities']):
 row['simultaneousCI95HalfWidthPercentagePoints']=float(100*simultaneous*se[i]);row['absoluteErrorPlusSimultaneousCI95PercentagePoints']=abs(row['errorPercentagePoints'])+row['simultaneousCI95HalfWidthPercentagePoints'];row['passesSimultaneousTwoPercentagePoints']=row['absoluteErrorPlusSimultaneousCI95PercentagePoints']<=2
r['rawMonteCarloReportSha256']=hashlib.sha256(data).hexdigest();r['simultaneousConfidence']={'method':'Student t7 between independent seeded process/probe means, Bonferroni12 density comparisons; same retained samples and means','pointwiseCritical':pointwise,'simultaneousCritical':simultaneous,'familyErrorProbability':.05,'densityCount':12,'scope':'Approximate seeded-realization inference under large-area CLT; does not claim exact local finite-page coverage'}
r['status']='PASS' if all(row['passesSimultaneousTwoPercentagePoints'] for row in r['densities']) else 'FAIL'
rng=np.random.default_rng(89631);points=rng.uniform(-1.2,1.2,(5000,2));centres=np.array([[mask_meta['originX']+x*mask_meta['spacing'],mask_meta['originZ']+z*mask_meta['spacing']] for z in range(0,1024,31) for x in range(0,1024,31)])
points=np.concatenate((points,centres,np.array([[-2,0],[2,0],[0,-2],[0,2]])));gx=(points[:,0]-mask_meta['originX'])/mask_meta['spacing'];gz=(points[:,1]-mask_meta['originZ'])/mask_meta['spacing'];valid=(gx>=0)&(gx<=1023)&(gz>=0)&(gz<=1023);ix=np.clip(np.floor(gx).astype(int),0,1022);iz=np.clip(np.floor(gz).astype(int),0,1022);fx=gx-ix;fz=gz-iz
coverage=np.where(valid,(mask[iz,ix]*(1-fx)*(1-fz)+mask[iz,ix+1]*fx*(1-fz)+mask[iz+1,ix]*(1-fx)*fz+mask[iz+1,ix+1]*fx*fz)/255,0)
oracle={'format':'independent-tree-mask-oracle','maskSha256':mask_meta['sha256'],'scope':'Independent Python four-term bilinear; normalized rooted x/z, minZ-first and half-texel points, outside cases','samples':[{'x':float(x),'z':float(z),'coverage':float(c),'inside':bool(c>=.5)} for (x,z),c in zip(points,coverage)]}
bins=np.array([2.5,4,5.5,7.]);radii=np.r_[np.linspace(1.68,7.56,1001),[3.25-1e-12,3.25,3.25+1e-12,4.75-1e-12,4.75,4.75+1e-12,6.25-1e-12,6.25,6.25+1e-12]]
oracle['radiusCases']=[{'radius':float(radius),'expectedClass':int(np.argmin(abs(bins-radius)))}for radius in radii]
oracle['weightCases']=[]
for index,radius in enumerate(bins):
 for footprint in [.000001,.02,.25,1,4,10,100]:
  t=float(np.clip((2*radius/max(footprint,.00001)-3)/5,0,1));oracle['weightCases'].append({'bin':index,'footprint':footprint,'weight':t*t*(3-2*t)})
trees=[{'stableId':'a','family':'tree','x':0.,'y':0.,'z':0.,'size':10.,'crownRadiusM':4.2,'orientation':.3,'rank':.15},{'stableId':'b','family':'tree','x':2.,'y':0.,'z':1.,'size':3.25/.42,'crownRadiusM':3.25,'orientation':math.pi/2,'rank':.6},{'stableId':'c','family':'tree','x':-3.,'y':0.,'z':-2.,'size':18.,'crownRadiusM':7.56,'orientation':-1.2,'rank':.9}]
atlas_rng=np.random.default_rng(8512);indices=atlas_rng.integers(0,1024,(5000,2));positions=-16+.03125/2+indices*.03125;total=np.zeros(len(indices),bool);counts=np.zeros((len(indices),4),int)
for tree in trees:
 dx=positions[:,0]-tree['x'];dz=positions[:,1]-tree['z'];c=math.cos(tree['orientation']);s=math.sin(tree['orientation']);x=(c*dx-s*dz)/tree['crownRadiusM'];z=(s*dx+c*dz)/tree['crownRadiusM'];gx=(x-mask_meta['originX'])/mask_meta['spacing'];gz=(z-mask_meta['originZ'])/mask_meta['spacing'];valid=(gx>=0)&(gx<=1023)&(gz>=0)&(gz<=1023);ix=np.clip(np.floor(gx).astype(int),0,1022);iz=np.clip(np.floor(gz).astype(int),0,1022);fx=gx-ix;fz=gz-iz
 alpha=mask[iz,ix]*(1-fx)*(1-fz)+mask[iz,ix+1]*fx*(1-fz)+mask[iz+1,ix]*(1-fx)*fz+mask[iz+1,ix+1]*fx*fz;inside=valid&(alpha>=127.5);total|=inside
 if tree['stableId']in['a','c']:counts[:,int(np.argmin(abs(bins-tree['crownRadiusM'])))]+=inside
oracle['atlas']={'candidates':trees,'selectedIds':['a','c'],'bounds':{'minX':-16.,'minZ':-16.,'maxX':16.,'maxZ':16.},'spacingM':.03125,'origin':{'x':-15.984375,'z':-15.984375},'samples':[{'x':int(ix),'z':int(iz),'C':int(c),'counts':v.tolist()}for(ix,iz),c,v in zip(indices,total,counts)]}
(out/'native-oracle.json').write_text(json.dumps(oracle)+'\n');(out/'report.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'status':r['status'],'simultaneousCritical':simultaneous,'maximumAbsoluteErrorPlusSimultaneousCI95PercentagePoints':max(v['absoluteErrorPlusSimultaneousCI95PercentagePoints'] for v in r['densities']),'nativeOraclePoints':len(points)}));raise SystemExit(0 if r['status']=='PASS' else 1)
