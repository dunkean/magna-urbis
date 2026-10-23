class_name SurfaceScenePrepare
extends RefCounted
const Data = preload("res://adapters/surface_data.gd")
const Population = preload("res://adapters/surface_population.gd")

# Prepare winding, normals and material batches without touching the scene tree.
static func mesh_arrays(vertices: PackedVector3Array, normals: PackedVector3Array = PackedVector3Array()) -> Array:
	var points := PackedVector3Array(); points.resize(vertices.size())
	var output_normals := PackedVector3Array(); output_normals.resize(vertices.size())
	for i in range(0,vertices.size(),3):
		points[i]=vertices[i]; points[i+1]=vertices[i+2]; points[i+2]=vertices[i+1]
		if normals.size()==vertices.size():
			output_normals[i]=normals[i]; output_normals[i+1]=normals[i+2]; output_normals[i+2]=normals[i+1]
		else:
			var n := (vertices[i+1]-vertices[i]).cross(vertices[i+2]-vertices[i]).normalized()
			output_normals[i]=n; output_normals[i+1]=n; output_normals[i+2]=n
	var arrays := []; arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=points; arrays[Mesh.ARRAY_NORMAL]=output_normals
	return arrays

static func prepare(request: Dictionary) -> Dictionary:
	var started := Time.get_ticks_usec()
	var result := Data.prepare(request.world,request.origin,request.width,request.generation,request.packet,request.skipContext,request.displaySource,request.skipHeight,request.sceneRequest)
	result.populations=Population.prepare(request.packet,request.focus,request.width,request.viewportWidth,request.oblique)
	if result.has("waterGeometry"): result.waterArrays=mesh_arrays(result.waterGeometry.vertices)
	if result.has("urbanGeometry"):
		var urban: Dictionary = result.urbanGeometry
		result.roadArrays=mesh_arrays(urban.roadVertices)
		var buckets: Dictionary = {}
		for group in urban.get("materialGroups",[]):
			var key := str(group.materialId)+":"+str(group.surface)+":"+JSON.stringify(group.slots)
			if not buckets.has(key): buckets[key]={"vertices":PackedVector3Array(),"normals":PackedVector3Array(),"materialId":group.materialId,"surface":group.surface,"slots":group.slots,"buildingIds":[]}
			var b: Dictionary = buckets[key]
			b.vertices.append_array(urban.vertices.slice(int(group.start),int(group.start)+int(group.count)))
			b.normals.append_array(urban.normals.slice(int(group.start),int(group.start)+int(group.count)))
			if not b.buildingIds.has(group.buildingId): b.buildingIds.append(group.buildingId)
		var batches: Array = []
		for key in buckets:
			var b: Dictionary = buckets[key]
			b.arrays=mesh_arrays(b.vertices,b.normals); b.erase("vertices"); b.erase("normals"); batches.append(b)
		if batches.is_empty() and not urban.vertices.is_empty(): batches.append({"arrays":mesh_arrays(urban.vertices,urban.normals),"materialId":"","surface":"wall","slots":{},"buildingIds":urban.get("buildingIds",[])})
		result.urbanBatches=batches
	result.prepareMs=(Time.get_ticks_usec()-started)/1000.0
	return result
