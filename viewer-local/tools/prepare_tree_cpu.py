"""Pinned Blender CPU-only authoring tool. No renderer runtime or source packet edits.

blender --background --factory-startup --python viewer-local/tools/prepare_tree_cpu.py --
  --source-root web/out/vegetation-tree/source --out web/out/vegetation-tree/prepared
"""
import argparse
import hashlib
import json
import math
import struct
import sys
import time
from pathlib import Path
import bpy
import bmesh
import numpy as np
from mathutils import Vector

PIPELINE = "tree-offline-root-pivot-leaf-uv-quad-binary-alpha-normal-source-impostor-v6"

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)

def export_leaf_material(original):
    # A concrete export profile: explicit source RGB/linear alpha/roughness/normal.
    # The source's custom translucent node group is not an unspecified glTF fallback.
    mat=original.copy();mat.name=original.name+'-prepared-cutout'
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    def image(channel):return next(n for n in nodes if n.type=='TEX_IMAGE' and channel in n.image.filepath)
    bsdf=nodes.new('ShaderNodeBsdfPrincipled');bsdf.inputs['Metallic'].default_value=0
    links.new(image('_diff').outputs['Color'],bsdf.inputs['Base Color']);links.new(image('_alpha').outputs['Color'],bsdf.inputs['Alpha']);links.new(image('_rough').outputs['Color'],bsdf.inputs['Roughness'])
    normal=next((n for n in nodes if n.type=='NORMAL_MAP'),None)
    if not normal:
        normal=nodes.new('ShaderNodeNormalMap');normal.space='TANGENT'
        links.new(image('_nor_gl').outputs['Color'],normal.inputs['Color'])
    if normal:links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
    output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
    for link in list(output.inputs['Surface'].links):links.remove(link)
    links.new(bsdf.outputs[0],output.inputs['Surface']);return mat

def pin_glb_cutout(path):
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];document=json.loads(data[20:20+length]);binary=data[28+length:]
    leaf=next(m for m in document['materials'] if m['name'].endswith('-prepared-cutout'));leaf['alphaMode']='MASK';leaf['alphaCutoff']=.5
    encoded=json.dumps(document,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    path.write_bytes(b'glTF'+struct.pack('<II',2,12+8+len(encoded)+8+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary)

def leaf_quads(template, leaf_material):
    """Replace each connected leaf with its UV-affine plane, never drop a leaf.
    Degenerate UV components preserve their original triangles instead.
    """
    mesh=template.data;mesh.calc_loop_triangles()
    tri=np.empty(len(mesh.loop_triangles)*3,np.int32);mesh.loop_triangles.foreach_get('vertices',tri);tri=tri.reshape((-1,3))
    loops=np.empty(len(mesh.loop_triangles)*3,np.int32);mesh.loop_triangles.foreach_get('loops',loops);loops=loops.reshape((-1,3))
    material=np.empty(len(mesh.loop_triangles),np.int32);mesh.loop_triangles.foreach_get('material_index',material)
    leaf_index=list(mesh.materials).index(leaf_material);tri=tri[material==leaf_index];loops=loops[material==leaf_index]
    co=np.empty(len(mesh.vertices)*3,np.float32);mesh.vertices.foreach_get('co',co);co=co.reshape((-1,3))
    uv=np.empty(len(mesh.loops)*2,np.float32);mesh.uv_layers[0].data.foreach_get('uv',uv);uv=uv.reshape((-1,2))
    parent=np.arange(len(mesh.vertices),dtype=np.int32)
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=int(parent[i])
        return i
    for a,b,c in tri:
        root=find(int(a))
        for other in [b,c]:
            other=find(int(other))
            if root!=other:parent[other]=root
    roots=np.array([find(int(v)) for v in tri[:,0]],dtype=np.int32);order=np.argsort(roots,kind='stable')
    boundaries=np.r_[0,np.flatnonzero(np.diff(roots[order]))+1,len(order)]
    positions=[];faces=[];texcoords=[];errors=[];fallbacks=0
    for begin,end in zip(boundaries[:-1],boundaries[1:]):
        group=order[begin:end];vertices=co[tri[group].reshape(-1)].astype(np.float64);texture=uv[loops[group].reshape(-1)].astype(np.float64)
        design=np.column_stack((texture,np.ones(len(texture))));fit,_,rank,_=np.linalg.lstsq(design,vertices,rcond=None)
        if rank<3 or not np.isfinite(fit).all():
            fallbacks+=1
            for t,l in zip(tri[group],loops[group]):
                start=len(positions);positions.extend(co[t].tolist());texcoords.extend(uv[l].tolist());faces.append((start,start+1,start+2))
            continue
        errors.append(float(np.sqrt(np.mean(np.sum((design@fit-vertices)**2,axis=1)))))
        low=texture.min(axis=0);high=texture.max(axis=0)
        quad_uv=np.array([[low[0],low[1]],[high[0],low[1]],[high[0],high[1]],[low[0],high[1]]])
        quad=np.column_stack((quad_uv,np.ones(4)))@fit
        source_normal=np.cross(co[tri[group,1]]-co[tri[group,0]],co[tri[group,2]]-co[tri[group,0]]).sum(axis=0)
        if np.dot(np.cross(quad[1]-quad[0],quad[2]-quad[0]),source_normal)<0:quad=quad[[0,3,2,1]];quad_uv=quad_uv[[0,3,2,1]]
        start=len(positions);positions.extend(quad.tolist());texcoords.extend(quad_uv.tolist());faces.append((start,start+1,start+2,start+3))
    data=bpy.data.meshes.new('source-leaves-uv-affine');data.from_pydata(positions,[],faces);data.materials.append(leaf_material)
    layer=data.uv_layers.new(name=mesh.uv_layers[0].name)
    for polygon in data.polygons:
        for loop_id in polygon.loop_indices:layer.data[loop_id].uv=texcoords[data.loops[loop_id].vertex_index]
    data.update();obj=bpy.data.objects.new('source-leaves-uv-affine',data);bpy.context.scene.collection.objects.link(obj)
    return obj,{'leafComponents':len(boundaries)-1,'sourceLeafTriangles':len(tri),'actualLeafTriangles':triangles(obj),'componentDrops':0,'degenerateUVOriginalTriangleFallbacks':fallbacks,'uvAffineRMSErrorNormalizedQuantiles':dict(zip(['median','p95','max'],[float(v) for v in np.quantile(errors,[.5,.95,1])]))}

def emission_material(original, normal=False):
    mat=original.copy();mat.name=original.name+('-world-normal' if normal else '-linear-albedo')
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    color=next(n for n in nodes if n.type=='TEX_IMAGE' and '_diff' in n.image.filepath)
    alpha=next((n for n in nodes if n.type=='TEX_IMAGE' and '_alpha' in n.image.filepath),None)
    emission=nodes.new('ShaderNodeEmission')
    if normal:
        geometry=nodes.new('ShaderNodeNewGeometry')
        normal_map=next((n for n in nodes if n.type=='NORMAL_MAP'),None)
        scale=nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.5
        offset=nodes.new('ShaderNodeVectorMath');offset.operation='ADD';offset.inputs[1].default_value=(.5,.5,.5)
        links.new(normal_map.outputs['Normal'] if normal_map else geometry.outputs['Normal'],scale.inputs[0]);links.new(scale.outputs[0],offset.inputs[0]);links.new(offset.outputs[0],emission.inputs['Color'])
        mat['bakedNormalPolicy']='authored NormalMap node world output' if normal_map else 'geometric world normal fallback'
    else:links.new(color.outputs['Color'],emission.inputs['Color'])
    output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
    for link in list(output.inputs['Surface'].links):links.remove(link)
    if alpha:
        transparent=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader')
        threshold=nodes.new('ShaderNodeMath');threshold.operation='LESS_THAN';threshold.inputs[1].default_value=.5
        links.new(alpha.outputs['Color'],threshold.inputs[0]);links.new(threshold.outputs[0],mix.inputs[0]);links.new(emission.outputs[0],mix.inputs[1]);links.new(transparent.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs['Surface'])
    else:links.new(emission.outputs[0],output.inputs['Surface'])
    return mat

def main():
    args=argparse.ArgumentParser();args.add_argument('--source-root',required=True);args.add_argument('--out',required=True)
    args.add_argument('--resolution',type=int,default=256);args.add_argument('--samples',type=int,default=8);args.add_argument('--method',choices=['collapse','leaf-quads'],default='leaf-quads')
    options=args.parse_args(sys.argv[sys.argv.index('--')+1:])
    root=Path(__file__).resolve().parents[2];source=Path(options.source_root).resolve();out=Path(options.out).resolve();out.mkdir(parents=True,exist_ok=True)
    catalog=json.loads((root/'surface/vegetation/tree-offline-source.json').read_text(encoding='utf-8'))
    if bpy.app.version_string!=catalog['tool']['version']:raise RuntimeError('Blender version pin mismatch')
    if bpy.app.build_hash.decode()!=catalog['tool']['buildHash']:raise RuntimeError('Blender build pin mismatch')
    if not 64<=options.resolution<=1024:raise ValueError('Resolution must be 64..1024')
    for file in catalog['sourceFiles']:
        p=source/file['path']
        if p.stat().st_size!=file['bytes'] or digest(p)!=file['sha256']:raise ValueError('Pinned source mismatch: '+file['path'])
    started=time.monotonic();bpy.ops.wm.open_mainfile(filepath=str(source/'tree_small_02_1k.blend'))
    template=bpy.data.objects['tree_small_02_LOD1']
    # Normalize the root/height and the maximum horizontal crown support explicitly.
    # Final consumer must scale height by size and horizontal support by crownRadiusM.
    points=[template.matrix_world@v.co for v in template.data.vertices]
    low=min(v.z for v in points);high=max(v.z for v in points)
    height=high-low
    base=np.array([[v.x,v.y] for v in points if v.z<=low+height*.01])
    pivot=Vector((float(np.median(base[:,0])),float(np.median(base[:,1])),low))
    radius=max(math.hypot(v.x-pivot.x,v.y-pivot.y) for v in points);height=high-low
    originals=list(template.data.materials)
    # Keep only the authoring template; never export the complete collection/2M source.
    for obj in list(bpy.data.objects):
        if obj!=template:bpy.data.objects.remove(obj,do_unlink=True)
    template.hide_render=True
    for v,p in zip(template.data.vertices,points):v.co=((p.x-pivot.x)/radius,(p.y-pivot.y)/radius,(p.z-low)/height)
    template.matrix_world.identity()
    for image in bpy.data.images:
        if image.source=='FILE':
            matches=[file['path'] for file in catalog['sourceFiles'] if Path(file['path']).stem==Path(image.name).stem+'_1k']
            if len(matches)!=1:raise RuntimeError('Ambiguous pinned image '+image.name)
            image.filepath=str(source/matches[0]);image.reload()
            if not Path(image.filepath).exists() or image.size[0]==0:raise RuntimeError('Missing image '+image.name+': '+image.filepath)
            if '_alpha' in image.filepath:image.colorspace_settings.name='Non-Color'
    # A shared binary source-alpha product prevents 16->8bit glTF quantization
    # from moving the .5 classification relative to the CPU mask bake.
    source_alpha=next(n.image for n in originals[1].node_tree.nodes if n.type=='TEX_IMAGE' and '_alpha' in n.image.filepath)
    source_pixels=np.array(source_alpha.pixels[:],np.float32).reshape((-1,4));binary_alpha=(source_pixels[:,0]>.5).astype(np.float32)
    prepared_alpha=bpy.data.images.new('tree_small_02_leaves_alpha_cutout',width=source_alpha.size[0],height=source_alpha.size[1],alpha=True,float_buffer=False,is_data=True)
    values=np.ones((len(binary_alpha),4),np.float32);values[:,:3]=binary_alpha[:,None];prepared_alpha.pixels.foreach_set(values.reshape(-1))
    prepared_alpha.filepath_raw=str(out/'tree_small_02_leaves_alpha_cutout.png');prepared_alpha.file_format='PNG';prepared_alpha.save()
    for node in originals[1].node_tree.nodes:
        if node.type=='TEX_IMAGE' and node.image==source_alpha:node.image=prepared_alpha
    prepared_leaf=export_leaf_material(originals[1]);template.data.materials[1]=prepared_leaf;originals[1]=prepared_leaf
    albedo=[emission_material(m) for m in originals];normals=[emission_material(m,True) for m in originals]
    records=[];objects=[];leaf_diagnostic={}
    for name,budget in [('near',16000 if options.method=='collapse' else 8000)]:
        tick=time.monotonic();obj=template.copy();obj.data=template.data.copy();bpy.context.collection.objects.link(obj)
        obj.name='tree_small_02_prepared_'+name;obj.hide_render=False
        if options.method=='leaf-quads':
            tree=bmesh.new();tree.from_mesh(obj.data)
            bmesh.ops.delete(tree,geom=[f for f in tree.faces if f.material_index==1],context='FACES')
            bmesh.ops.delete(tree,geom=[v for v in tree.verts if not v.link_faces],context='VERTS');tree.to_mesh(obj.data);tree.free()
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        triangulate=obj.modifiers.new('triangulate-before-budget','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=triangulate.name)
        initial=triangles(obj);count=initial;passes=[]
        for attempt in range(4):
            decimate=obj.modifiers.new('bounded-offline-collapse','DECIMATE');decimate.ratio=max(.00001,(budget-8)/count);decimate.use_collapse_triangulate=True
            bpy.ops.object.modifier_apply(modifier=decimate.name)
            count=triangles(obj);passes.append(count)
            if count<=budget:break
        if count>budget:raise RuntimeError('Actual triangle budget exceeded: '+str(count)+' > '+str(budget))
        if options.method=='leaf-quads':
            branches=count;leaves,leaf_diagnostic=leaf_quads(template,originals[1])
            bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);leaves.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.ops.object.join()
            count=triangles(obj);leaf_diagnostic['actualBranchTriangles']=branches;budget=branches+leaf_diagnostic['actualLeafTriangles']
        support=max(math.hypot(v.co.x,v.co.y) for v in obj.data.vertices)
        if support>1:
            for item in [obj,template]:
                for vertex in item.data.vertices:vertex.co.x/=support;vertex.co.y/=support
                item.data.update()
            radius*=support
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        glb=out/(name+'.glb')
        bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_normals=True,export_tangents=True)
        pin_glb_cutout(glb)
        records.append({'lod':name,'actualTriangles':count,'budget':budget,'decimationPassTriangles':passes,'surfaces':len(obj.data.materials),'path':glb.name,'bytes':glb.stat().st_size,'sha256':digest(glb),'prepareSeconds':time.monotonic()-tick,'actualNormalizedBounds':{'min':[min(v.co[k] for v in obj.data.vertices) for k in range(3)],'max':[max(v.co[k] for v in obj.data.vertices) for k in range(3)],'maximumHorizontalRadius':max(math.hypot(v.co.x,v.co.y) for v in obj.data.vertices)},'views':[]})
        objects.append(obj);obj.hide_render=True
    # A source control diagnoses silhouette loss from reduction. It is baked
    # offline only and is never exported as runtime geometry.
    objects.append(template);records.append({'lod':'source-reference','actualTriangles':triangles(template),'runtimeGeometryExported':False,'views':[]})
    template.hide_render=True
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=options.samples;scene.cycles.use_denoising=False
    scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=options.resolution;scene.render.resolution_y=options.resolution;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='16'
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.world.color=(0,0,0)
    camera_data=bpy.data.cameras.new('impostor-camera');camera=bpy.data.objects.new('impostor-camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
    camera_data.type='ORTHO';camera_data.ortho_scale=2.2;camera_data.clip_start=.01;camera_data.clip_end=20
    views=[('top',Vector((0,0,5)))]+[('oblique-'+str(k),Vector((math.cos(k*math.pi/2)*3.535,math.sin(k*math.pi/2)*3.535,3.535))) for k in range(4)]
    top_masks=[]
    for obj,record in zip(objects,records):
        obj.hide_render=False
        for label,offset in views:
            target=Vector((0,0,.5));camera.location=target+offset;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
            view={'name':label,'orthoScale':2.2,'resolution':options.resolution,'cameraPosition':list(camera.location),'target':list(target),'products':{}}
            for channel,mats in [('albedo',albedo),('normal',normals)]:
                # Replacing slots preserves polygon material indices. Clearing all
                # slots first would silently repaint every leaf as material zero.
                for slot,mat in enumerate(mats):obj.data.materials[slot]=mat
                scene.view_settings.view_transform='Standard' if channel=='albedo' else 'Raw'
                output=out/(record['lod']+'-'+label+'-'+channel+'.png');scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
                view['products'][channel]={'path':output.name,'sha256':digest(output),'bytes':output.stat().st_size,'colorSpace':'srgb' if channel=='albedo' else 'linear-world-normal-encoded'}
                if label=='top' and channel=='albedo':
                    image=bpy.data.images.load(str(output),check_existing=False);pixels=list(image.pixels);mask=pixels[3::4]
                    alpha=sum(mask);rgb=[sum(pixels[i+k]*mask[i//4] for i in range(0,len(pixels),4))/alpha for k in range(3)]
                    view['alphaAreaToCanonicalDisc']=alpha*(2.2/options.resolution)**2/math.pi;view['alphaWeightedMeanLinear']=rgb
                    view['binaryAlphaScissorThreshold']=.5;view['binaryAlphaAreaToCanonicalDisc']=sum(a>=.5 for a in mask)*(2.2/options.resolution)**2/math.pi
                    view['alphaMaskPolicy']='alpha channel of this same albedo product; no independent procedural silhouette'
                    # Blender pixels are bottom-up. Its top camera's +Y maps to
                    # glTF/Godot -Z, so reverse rows for the neutral minZ-first grid.
                    a8=bytes(max(0,min(255,round(mask[(options.resolution-1-y)*options.resolution+x]*255))) for y in range(options.resolution) for x in range(options.resolution))
                    mask_file=out/(record['lod']+'-top-alpha.a8');mask_file.write_bytes(a8)
                    step=2.2/options.resolution
                    view['sharedMask']={'path':mask_file.name,'sha256':digest(mask_file),'bytes':len(a8),'format':'linear-coverage-u8','width':options.resolution,'height':options.resolution,'originX':-1.1+step*.5,'originZ':-1.1+step*.5,'spacing':step,'coordinateSystem':'x-east,y-up,z-map-y; row0=minZ; centered normalized crown','sourceLeafAlphaScissorThreshold':.5,'antialiasSamples':options.samples,'source':'this exact prepared mesh and cutout policy, not a crown disc'}
                    top_masks.append(mask);bpy.data.images.remove(image)
            record['views'].append(view)
        obj.hide_render=True
    # A view-indexed optical representation, not a second decimated leaf mesh.
    # The intact-source RGBA channel belongs to this optical quad. The near
    # derivative also has its own measured mask; they must not be conflated in V.
    impostor={'format':'magna-tree-impostor','version':1,'triangleCount':2,'positions':[-1.1,-1.1,0,1.1,-1.1,0,1.1,1.1,0,-1.1,1.1,0],'uv':[0,1,1,1,1,0,0,0],'indices':[0,2,1,0,3,2],'coordinateFrame':'camera right/up; centre at normalized root+(0,0,.5); camera view selection must match descriptor','views':records[0]['views'],'source':'same prepared near derivative; same alpha grid/policy as its C/V mask','viewPolicy':'nearest authored orthographic direction; oblique interpolation/parallax not qualified'}
    impostor_file=out/'middle-impostor.json';impostor_file.write_text(json.dumps(impostor,indent=2)+'\n',encoding='utf-8')
    source_impostor=dict(impostor);source_impostor['views']=records[1]['views'];source_impostor['source']='intact source LOD1: artistic reference, not the shared near-product C/V';(out/'source-impostor-reference.json').write_text(json.dumps(source_impostor,indent=2)+'\n',encoding='utf-8')
    alpha_union=sum(max(a,b) for a,b in zip(*top_masks));alpha_intersection=sum(min(a,b) for a,b in zip(*top_masks))
    report={'format':'magna-offline-tree-prototype','version':1,'pipelineVersion':PIPELINE,'status':'PREPARED-NOT-RENDERER-QUALIFIED','assetId':catalog['assetId'],'license':catalog['license'],'sourceFiles':catalog['sourceFiles'],'blender':bpy.app.version_string,'device':'CPU','threads':2,'sourceTemplate':'tree_small_02_LOD1','sourceTriangles':triangles(template),'normalization':{'sourceBottomPivot':list(pivot),'sourceHeight':height,'sourceCrownRadius':radius,'preparedHeight':1,'preparedCrownRadius':1,'physicalBinding':'height=candidate.size; horizontal radius=candidate.crownRadiusM; root=candidate position'},'lods':records,'middleImpostor':{'path':impostor_file.name,'sha256':digest(impostor_file),'bytes':impostor_file.stat().st_size,'actualTriangles':2},'sourceComparison':{'topAlphaSoftIoU':alpha_intersection/alpha_union,'nearAreaToSourceArea':sum(top_masks[0])/sum(top_masks[1]),'gridAndViewIdentical':True},'failed8kAttempt':{'trianglesAfterFourPasses':15109,'target':8000,'reason':'disconnected source leaf components reach collapse floor; no claim that repeated ratios achieve target'},'elapsedSeconds':time.monotonic()-started,'runtimeEnabled':False,'canonicalCoverCalibrated':False,'selectedCoverageCalibrated':False,'shadowPolicy':'retain existing total-C optical approximation; no engine tree shadow activation','limitations':['No imported-tree render or C/V gate has run in Godot.','Near derivative and impostor share the same baked alpha on the same grid; the consumer must bind that actual mask, not the old filled disc.','Sparse crown alpha area is not equal to the canonical filled-disc coverage. No silent opacity or population correction is applied.','The impostor normal is encoded world geometric normal, not a claim of exact view-dependent BRDF.']}
    report['preparationMethod']=options.method;report['leafReconstruction']=leaf_diagnostic
    report['alphaPolicy']='binary alpha from pinned linear source PNG>.5, then same sampler/cutout>.5 for near/reference CPU bake and derived glTF MASK alphaCutoff=.5; A8 includes pixel AA'
    report['preparedAlpha']={'path':Path(prepared_alpha.filepath_raw).name,'sha256':digest(Path(prepared_alpha.filepath_raw)),'sourceAlphaSha256':next(f['sha256'] for f in catalog['sourceFiles'] if 'leaves_alpha' in f['path']),'threshold':.5,'values':[0,1]}
    report['normalPolicies']={m.name:m.get('bakedNormalPolicy') for m in normals}
    report['normalization']['pivotPolicy']='median XY of source vertices in bottom1% of measured height; Z=min; no crown-bbox recentering'
    report['normalization']['sourceCoordinates']='Blender horizontal X/Y, Z-up; export glTF x-east,y-up,z=-BlenderY'
    report['normalization']['sourceSupportVertexCount']=len(base)
    report['limitations'][3]='View-dependent parallax, double-sided lighting and BRDF parity are not qualified by an encoded-world-normal bake.'
    identity={'pipelineVersion':PIPELINE,'sourceSha256':catalog['sourceFiles'][0]['sha256'],'geometrySha256':records[0]['sha256'],'preparedAlphaSha256':report['preparedAlpha']['sha256'],'impostorSha256':digest(impostor_file),'normalization':report['normalization'],'alphaPolicy':report['alphaPolicy'],'maskSha256':records[0]['views'][0]['sharedMask']['sha256']}
    report['assetDigest']=hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest();report['assetVersion']=identity
    report['limitations'][1]='The prepared near and middle optical quad use the same derived alpha grid; the intact-source comparison has its own separately named mask. No filled disc is substituted for foliage coverage.'
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('TREE_PREPARATION_RESULT',json.dumps({k:report[k] for k in ['status','device','elapsedSeconds']}))

if __name__=='__main__':main()
