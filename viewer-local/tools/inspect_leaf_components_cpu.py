"""CPU topology/UV audit for a pinned source, no geometry or renderer edits."""
import argparse,json,sys,time
from pathlib import Path
import bpy
import numpy as np

args=argparse.ArgumentParser();args.add_argument('--source',required=True);args.add_argument('--out',required=True)
options=args.parse_args(sys.argv[sys.argv.index('--')+1:]);started=time.monotonic()
bpy.ops.wm.open_mainfile(filepath=str(Path(options.source).resolve()))
obj=bpy.data.objects['tree_small_02_LOD1'];mesh=obj.data;mesh.calc_loop_triangles()
tri=np.empty(len(mesh.loop_triangles)*3,np.int32);mesh.loop_triangles.foreach_get('vertices',tri);tri=tri.reshape((-1,3))
material=np.empty(len(mesh.loop_triangles),np.int32);mesh.loop_triangles.foreach_get('material_index',material)
leaf_index=next(i for i,m in enumerate(mesh.materials) if m.name=='tree_small_02_leaves');leaf=tri[material==leaf_index]
parent=np.arange(len(mesh.vertices),dtype=np.int32)
def find(i):
    while parent[i]!=i:parent[i]=parent[parent[i]];i=int(parent[i])
    return i
def join(a,b):
    a=find(int(a));b=find(int(b))
    if a!=b:parent[b]=a
for a,b,c in leaf:join(a,b);join(a,c)
roots=np.array([find(int(v)) for v in leaf[:,0]],dtype=np.int32)
labels,counts=np.unique(roots,return_counts=True)
record={'format':'source-leaf-topology-audit','version':1,'sourceObject':obj.name,'sourceTriangles':len(tri),'leafTriangles':len(leaf),'leafComponents':len(labels),'quadReplacementTriangleCount':int(len(labels)*2),'componentTriangleQuantiles':dict(zip(['min','p25','median','p75','p95','max'],[float(v) for v in np.quantile(counts,[0,.25,.5,.75,.95,1])])),'uvLayers':[u.name for u in mesh.uv_layers],'elapsedSeconds':time.monotonic()-started,'scope':'topology counts only; planar UV fit, silhouette conservation and C/V not yet proven; no renderer/GPU run'}
Path(options.out).write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8');print('LEAF_TOPOLOGY_AUDIT',json.dumps(record))
