extends SceneTree
const P=preload("res://adapters/surface_water_projection.gd")
const H=preload("res://adapters/surface_hydrology.gd")
const G=preload("res://adapters/surface_geometry.gd")
var checks=0
func check(value:bool,message:String):
	checks+=1
	if not value:push_error(message);quit(1)
func _initialize():
	var vertices=PackedVector3Array([Vector3(0,1,0),Vector3(1,1,0),Vector3(0,1,1),Vector3(2,1,0),Vector3(3,1,0),Vector3(2,1,1)])
	var geometry={"vertices":vertices,"sourceVectorVertexCount":3,"sourceSeaVertexCount":3,"authority":"magna-urbis-fixed-hydrology","fixedVectorDisplayAvailable":true}
	var original=var_to_bytes(geometry)
	check(P.vector_tint_plan(geometry).policy=="source-classes","legacy default unchanged")
	var uniform=P.vector_tint_plan(geometry,{"uniformVectorTint":true})
	check(uniform.enabled and uniform.vectorVertices==3 and uniform.seaVertices==3,"explicit vector and sea partitions")
	check(var_to_bytes(geometry)==original,"partition policy never edits source geometry")
	for value in [-3,1,4,9,NAN,INF,"3"]:
		var bad=geometry.duplicate();bad.sourceVectorVertexCount=value
		check(P.vector_tint_plan(bad,{"uniformVectorTint":true}).has("error"),"invalid partition count rejected")
	var bad=geometry.duplicate();bad.sourceSeaVertexCount=0
	check(P.vector_tint_plan(bad,{"uniformVectorTint":true}).has("error"),"partition sum rejected")
	bad=geometry.duplicate();bad.erase("sourceSeaVertexCount")
	check(P.vector_tint_plan(bad).has("error"),"partial metadata rejected even in legacy mode")
	check(P.vector_tint_plan({"vertices":vertices}).policy=="source-classes","legacy generic class path remains available")
	check(P.vector_tint_plan({"vertices":vertices},{"uniformVectorTint":true}).has("error"),"generic vertices are never inferred as retained polygons")
	bad=geometry.duplicate();bad.fixedVectorDisplayAvailable=false
	check(P.vector_tint_plan(bad,{"uniformVectorTint":true}).has("error"),"fallback refuses explicit uniform policy")
	check(P.vector_tint_plan(geometry,{"uniformVectorTint":1}).has("error"),"boolean option strict")
	var colors={"fallback":Vector3(.028,.10,.115)};var focus={"x":0.,"y":0.}
	check(P.cache_key(geometry,focus,10.,colors)!=P.cache_key(geometry,focus,10.,colors,{"uniformVectorTint":true}),"palette cache separates policies")
	# Explicit authored fixture, not a generated source: mixed retained polygon
	# and original sea cells. The count describes existing vertices only.
	var classes=PackedByteArray();classes.resize(16);classes.fill(3);classes[0]=1
	var levels=PackedFloat32Array();levels.resize(16);levels.fill(5.)
	var heights=PackedFloat32Array();heights.resize(16)
	var grid={"width":4,"height":4,"originX":5.,"originZ":5.,"spacingM":10.,"heights":heights}
	var world={"terrain":grid,"bounds":{"minX":5.,"minZ":5.,"maxX":35.,"maxZ":35.},"fields":{"waterClass":classes,"waterLevelM":levels}}
	var ring=[{"x":20.,"y":20.},{"x":30.,"y":20.},{"x":30.,"y":30.},{"x":20.,"y":30.}]
	var source={"geometry":{"water":[[ring]]},"water":{"n":4,"width":40.,"originX":5.,"originZ":5.,"classes":classes,"levelM":levels}}
	var bytes=var_to_bytes(source);var origin={"x":20.,"y":0.,"z":20.};focus={"x":20.,"y":20.}
	var result=H.prepare({"source":source},world,origin,focus,40.,G.build_water(world,origin,focus,40.))
	check(result.sourceVectorVertexCount>0 and result.sourceSeaVertexCount>0,"actual adapter emits both recorded batches")
	check(result.sourceVectorVertexCount+result.sourceSeaVertexCount==result.vertices.size(),"batch counts cover exactly all emitted vertices")
	check(result.sourceVectorVertexCount%3==0 and result.sourceSeaVertexCount%3==0,"batch boundaries are triangle aligned")
	check(var_to_bytes(source)==bytes,"source classes/levels/contours unchanged")
	check(not P.vector_tint_plan(result,{"uniformVectorTint":true}).has("error"),"only explicit retained adapter batches enable uniform policy")
	var shader=Shader.new();shader.code=FileAccess.get_file_as_string("res://shaders/water_source_map.gdshader")
	check(shader.get_shader_uniform_list().size()>0,"source-map shader parser")
	print(JSON.stringify({"status":"PASS","checks":checks,"scope":"CPU batch counts, source immutability, fail-closed options and shader parsing; legacy GPU pixel parity remains a separate proof"}));quit()
