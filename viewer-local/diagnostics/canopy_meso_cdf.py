from pathlib import Path
import numpy as np,json
MASK=np.uint64(0xffffffff)
def hashed(x,z,seed,salt):
 x=np.asarray(x,dtype=np.int64)&1048575;z=np.asarray(z,dtype=np.int64)&1048575
 h=(x.astype(np.uint64)*1664525+z.astype(np.uint64)*1013904223+np.uint64((seed^salt)&0xffffffff)*374761393+2246822519)&MASK
 h=((h^(h>>16))*2246822519)&MASK;h=((h^(h>>13))*3266489917)&MASK;h=h^(h>>16)
 return (h&16777215).astype(np.float64)/16777216.0
def distance(x,z,seed):
 cx=np.floor(x).astype(np.int64);cz=np.floor(z).astype(np.int64);f=x-cx;g=z-cz;best=np.full(np.shape(x),100.)
 for dz in [-2,-1,0,1,2]:
  for dx in [-2,-1,0,1,2]:
   px=dx+hashed(cx+dx,cz+dz,seed,0x9e3779b9);pz=dz+hashed(cx+dx,cz+dz,seed,0x85ebca6b)
   best=np.minimum(best,(px-f)**2+(pz-g)**2)
 return np.sqrt(best)
rng=np.random.default_rng(20261023);d=np.sort(distance(rng.uniform(0,128,524288),rng.uniform(0,128,524288),0));bins=np.linspace(0,1.5,65);cdf=np.searchsorted(d,bins,side='right')/len(d);cdf[-1]=1.
lines=', '.join(f'{v:.9f}' for v in cdf)
Path('viewer-local/shaders/canopy_meso.gdshaderinc').write_text('''// Renderer-only canopy approximation outside supplied candidate inventory.
// Marginal rank CDF calibrated on deterministic full-cell-jittered world sites.
uniform vec4 canopy_meso_phase=vec4(0.0);
uniform int canopy_meso_seed=0;
const float CANOPY_MESO_CELL_M=16.0;
const float CANOPY_MESO_CDF[65]=float[65]('''+lines+''');
float canopy_meso_hash(ivec2 cell,uint salt){
 uvec2 c=uvec2(cell)&uvec2(1048575u);
 uint h=c.x*1664525u+c.y*1013904223u+(uint(canopy_meso_seed)^salt)*374761393u+2246822519u;
 h=(h^(h>>16u))*2246822519u;h=(h^(h>>13u))*3266489917u;h=h^(h>>16u);
 return float(h&16777215u)/16777216.0;
}
float canopy_meso_cover(vec2 world_xz,float footprint_m,float cover){
 cover=clamp(cover,0.0,1.0);if(cover<=0.0||cover>=1.0)return cover;
 float diameter=2.0*CANOPY_MESO_CELL_M*sqrt(cover/3.141592654);
 float detail=smoothstep(1.5,3.0,diameter/max(footprint_m,.000001));
 if(detail<=0.0)return cover;
 vec2 p=world_xz/CANOPY_MESO_CELL_M+canopy_meso_phase.xy;
 ivec2 cell=ivec2(floor(p))+ivec2(canopy_meso_phase.zw);vec2 f=fract(p);
 float distance_sq=4.0;
 for(int z=-2;z<=2;z++)for(int x=-2;x<=2;x++){
  ivec2 c=cell+ivec2(x,z);
  vec2 center=vec2(float(x),float(z))+vec2(canopy_meso_hash(c,0x9e3779b9u),canopy_meso_hash(c,0x85ebca6bu));
  vec2 delta=f-center;distance_sq=min(distance_sq,dot(delta,delta));
 }
 float lookup=clamp(sqrt(distance_sq)*(64.0/1.5),0.0,63.99999);
 int index=int(floor(lookup));float rank=mix(CANOPY_MESO_CDF[index],CANOPY_MESO_CDF[index+1],fract(lookup));
 // Rank has a uniform marginal. A symmetric threshold within [0,1] preserves
 // its area mean, unlike thresholding uncalibrated value noise.
 float aa=min(min(cover,1.0-cover),max(.000001,footprint_m/CANOPY_MESO_CELL_M));
 float mask=1.0-smoothstep(cover-aa,cover+aa,rank);
 return mix(cover,mask,detail);
}
vec3 canopy_meso_normal(vec2 world_xz,float footprint_m,float cover){
 cover=clamp(cover,0.000001,.999999);
 float diameter=2.0*CANOPY_MESO_CELL_M*sqrt(cover/3.141592654);
 float detail=smoothstep(1.5,3.0,diameter/max(footprint_m,.000001));
 if(detail<=0.0)return vec3(0,1,0);
 vec2 p=world_xz/CANOPY_MESO_CELL_M+canopy_meso_phase.xy;
 ivec2 cell=ivec2(floor(p))+ivec2(canopy_meso_phase.zw);vec2 f=fract(p);vec2 nearest=vec2(0.0);float best=4.0;
 for(int z=-2;z<=2;z++)for(int x=-2;x<=2;x++){
  ivec2 c=cell+ivec2(x,z);vec2 center=vec2(float(x),float(z))+vec2(canopy_meso_hash(c,0x9e3779b9u),canopy_meso_hash(c,0x85ebca6bu));vec2 delta=f-center;
  float d=dot(delta,delta);if(d<best){best=d;nearest=delta;}
 }
 float radius=.000001;
 for(int i=0;i<64;i++)if(cover>=CANOPY_MESO_CDF[i] && cover<=CANOPY_MESO_CDF[i+1]){
  radius=(float(i)+(cover-CANOPY_MESO_CDF[i])/max(CANOPY_MESO_CDF[i+1]-CANOPY_MESO_CDF[i],.000001))*(1.5/64.0);break;
 }
 vec2 radial=nearest/max(radius,.000001);float height=sqrt(max(.001,1.0-dot(radial,radial)));
 vec3 normal=normalize(vec3(radial.x,height*1.157,radial.y));
 return normalize(mix(vec3(0,1,0),normal,detail));
}

''')
x,z=np.meshgrid((np.arange(512)+.5)*(40/512),(np.arange(512)+.5)*(40/512));checks=[]
def smooth(a,b,v):
 t=np.clip((v-a)/(b-a),0,1);return t*t*(3-2*t)
for seed in [1,69,2026]:
 rank=np.interp(distance(x+1250.37,z-513.21,seed),bins,cdf)
 for cover in [.03,.1,.27,.5,.8,.97]:
  for footprint in [.1,1.25,4.,8.,20.]:
   aa=min(cover,1-cover,max(.000001,footprint/16));detail=smooth(1.5,3.0,32*np.sqrt(cover/np.pi)/max(footprint,.000001));mask=cover*(1-detail)+(1-smooth(cover-aa,cover+aa,rank))*detail
   checks.append({'seed':seed,'cover':cover,'footprintM':footprint,'mean':float(mask.mean()),'errorPoints':float((mask.mean()-cover)*100)})
report={'kind':'CPU calibration and independent seed/grid validation; not GPU evidence','version':'canopy-meso-fullcell-jitter-cdf-1','cellMetres':16,'siteCountPerCell':1,'neighborhood':25,'stableHashPeriodMetres':16777216,'calibrationSamples':len(d),'maximumAbsoluteCoverageErrorPoints':max(abs(c['errorPoints']) for c in checks),'samples':checks,'cdf':cdf.tolist()}
Path('viewer-local/diagnostics/evidence/canopy-meso-cpu.json').write_text(json.dumps(report,indent=2)+'\n');print(report['maximumAbsoluteCoverageErrorPoints'])
