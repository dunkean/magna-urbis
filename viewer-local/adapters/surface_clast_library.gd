class_name SurfaceClastLibrary
extends RefCounted
const VERSION="renderer-clast-icosa80-pbr-v1"
const VARIANTS=6
const LOCAL_BOUNDS=AABB(Vector3(-.5,-.35,-.5),Vector3(1,.7,1))
var _meshes:Dictionary={}

static func stable_hash(value:String)->int:
	var hash=2166136261
	for byte in value.to_utf8_buffer():hash=((hash^int(byte))*16777619)&0xffffffff
	return hash

static func variant(candidate:Dictionary)->int:
	return stable_hash(str(candidate.stableId)+":"+str(int(candidate.get("variant",0))))%VARIANTS

static func recipe(lithology:String)->String:
	return {"basalt":"volcanic-crust","limestone":"carbonate-karst"}.get(lithology,"fractured-bedrock")

func mesh(index:int)->ArrayMesh:
	index=posmod(index,VARIANTS)
	if _meshes.has(index):return _meshes[index]
	var phi=(1.0+sqrt(5.0))*.5
	var points=[Vector3(-1,phi,0),Vector3(1,phi,0),Vector3(-1,-phi,0),Vector3(1,-phi,0),Vector3(0,-1,phi),Vector3(0,1,phi),Vector3(0,-1,-phi),Vector3(0,1,-phi),Vector3(phi,0,-1),Vector3(phi,0,1),Vector3(-phi,0,-1),Vector3(-phi,0,1)]
	for i in points.size():points[i]=points[i].normalized()
	var faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]
	var cache={};var divided=[]
	for face in faces:
		var edge=[]
		for pair in [[face[0],face[1]],[face[1],face[2]],[face[2],face[0]]]:
			var key=Vector2i(mini(pair[0],pair[1]),maxi(pair[0],pair[1]))
			if not cache.has(key):cache[key]=points.size();points.append((points[pair[0]]+points[pair[1]]).normalized())
			edge.append(cache[key])
		divided.append_array([[face[0],edge[0],edge[2]],[face[1],edge[1],edge[0]],[face[2],edge[2],edge[1]],[edge[0],edge[1],edge[2]]])
	var low=Vector3(INF,INF,INF);var high=Vector3(-INF,-INF,-INF)
	for i in points.size():
		var radial=.72+.28*float(stable_hash("clast-v1:"+str(index)+":"+str(i))&0xffffff)/16777216.0
		var p:Vector3=points[i]*radial
		p+=Vector3(.055*sin(p.y*3.1+index),.045*sin(p.z*3.7+index*.7),.06*sin(p.x*2.9-index*.9))
		points[i]=p;low=low.min(p);high=high.max(p)
	for i in points.size():points[i]=((points[i]-low)/(high-low)-Vector3(.5,.5,.5))*Vector3(1,.7,1)
	var vertices=PackedVector3Array();var normals=PackedVector3Array();var tangents=PackedFloat32Array()
	for face in divided:
		var a:Vector3=points[face[0]];var b:Vector3=points[face[1]];var c:Vector3=points[face[2]]
		var normal=(b-a).cross(c-a).normalized()
		if normal.dot(a+b+c)<0:var swap=b;b=c;c=swap;normal=-normal
		var tangent=(Vector3.UP if absf(normal.y)<.9 else Vector3.FORWARD).cross(normal).normalized()
		# Godot front faces are clockwise. Normals remain outward.
		for p in [a,c,b]:vertices.append(p);normals.append(normal);tangents.append_array([tangent.x,tangent.y,tangent.z,1.0])
	var arrays=[];arrays.resize(Mesh.ARRAY_MAX);arrays[Mesh.ARRAY_VERTEX]=vertices;arrays[Mesh.ARRAY_NORMAL]=normals;arrays[Mesh.ARRAY_TANGENT]=tangents
	var result=ArrayMesh.new();result.resource_name="clast80-"+str(index);result.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays);_meshes[index]=result
	return result

# Read source geology, never the dominant alluvial/soil surface material. Buffers
# and candidate values are borrowed unchanged; private groups only select a mesh.
static func partition(candidates:Array,buffer:PackedFloat32Array,rock_lookup:Callable)->Array:
	assert(buffer.size()==candidates.size()*20)
	var buckets={};var order=[]
	for i in candidates.size():
		var candidate:Dictionary=candidates[i];var unit:Dictionary=rock_lookup.call(float(candidate.x),float(candidate.z))
		var id=variant(candidate);var recipe_id=recipe(str(unit.get("lithology","")));var key=recipe_id+":"+str(id)
		if not buckets.has(key):buckets[key]={"variant":id,"recipeId":recipe_id,"indices":[],"ids":[],"sourceRockIds":{}};order.append(key)
		buckets[key].indices.append(i);buckets[key].ids.append(candidate.stableId);buckets[key].sourceRockIds[str(unit.get("id","unknown"))]=true
	var result=[]
	for key in order:
		var batch:Dictionary=buckets[key];var copied=PackedFloat32Array();copied.resize(batch.indices.size()*20)
		for i in batch.indices.size():
			for j in 20:copied[i*20+j]=buffer[int(batch.indices[i])*20+j]
		batch["buffer"]=copied;result.append(batch)
	return result

static func buffer_bounds(buffer:PackedFloat32Array,local:AABB)->AABB:
	var result=AABB();var first=true
	for at in range(0,buffer.size(),20):
		var basis=Basis(Vector3(buffer[at],buffer[at+4],buffer[at+8]),Vector3(buffer[at+1],buffer[at+5],buffer[at+9]),Vector3(buffer[at+2],buffer[at+6],buffer[at+10]))
		var box=Transform3D(basis,Vector3(buffer[at+3],buffer[at+7],buffer[at+11]))*local
		result=box if first else result.merge(box);first=false
	return result
