extends SceneTree
const Low=preload("res://adapters/surface_low_cover_geometry.gd")
const Distribution=preload("res://adapters/surface_detail_distribution.gd")
var failures=[];var checks=0;var records=[]
func check(ok:bool,message:String)->void:
	checks+=1
	if not ok:failures.append(message);push_error(message)
func _initialize()->void:
	for family in ["shrub","debris"]:
		for variant in Low.VARIANTS:
			var mesh=Low.mesh(family,variant);var arrays=mesh.surface_get_arrays(0);var vertices:PackedVector3Array=arrays[Mesh.ARRAY_VERTEX]
			var normals:PackedVector3Array=arrays[Mesh.ARRAY_NORMAL];var tangents:PackedFloat32Array=arrays[Mesh.ARRAY_TANGENT]
			check(vertices.size()%3==0 and vertices.size()/3<=Low.MAX_TRIANGLES[family],"bounded triangle count")
			check(normals.size()==vertices.size() and tangents.size()==vertices.size()*4,"registered normal/tangent stream")
			var bound=AABB(Vector3(-.5,-.5,-.5),Vector3.ONE)
			for i in vertices.size():
				check(vertices[i].is_finite() and bound.has_point(vertices[i]),"same normalised source support envelope")
				check(absf(normals[i].length()-1.0)<.00001,"unit finite normal")
			records.append({"family":family,"variant":variant,"triangles":vertices.size()/3,"vertexBytesSha256":_sha(vertices.to_byte_array()),"bounds":str(mesh.get_aabb())})
	var candidates=[];var buffer=PackedFloat32Array()
	for i in 19:
		candidates.append({"stableId":"source-id-"+str(i),"variant":i%4,"x":1000000000.125+i,"y":2142.25,"z":-1000000000.125-i,"size":.5+float(i)*.01})
		for k in 20:buffer.append(float(i)*100+k+.125)
	var before=_sha(buffer.to_byte_array());var old_candidates=JSON.stringify(candidates)
	var batches=Low.partition(candidates,buffer);var seen={}
	for batch in batches:
		for i in batch.ids.size():
			var index=int(str(batch.ids[i]).trim_prefix("source-id-"));seen[index]=true
			check(batch.buffer.slice(i*20,i*20+20).to_byte_array()==buffer.slice(index*20,index*20+20).to_byte_array(),"every source transform/colour/custom value byte-exact")
	check(seen.size()==candidates.size(),"all and only existing candidate ids")
	check(_sha(buffer.to_byte_array())==before and JSON.stringify(candidates)==old_candidates,"source candidate list and buffers never mutated")
	var p=Distribution.phases({"x":1000000000.125,"z":-1000000000.125})
	check(p.size()==3 and Distribution.metadata().additionalImageBytes==0,"fixed 24-byte phase uniforms, no new raster allocation")
	print(JSON.stringify({"test":"surface-low-cover-geometry","result":"PASS" if failures.is_empty() else "FAIL","checks":checks,"failures":failures,"meshes":records,"bufferSha256":before,"scope":"authored bounded CPU mesh/support/ID/buffer tests, not botanical observation or GPU quality"}));quit(0 if failures.is_empty() else 1)
func _sha(bytes:PackedByteArray)->String:
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes);return hash.finish().hex_encode()
