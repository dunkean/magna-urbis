extends SceneTree
const Clasts=preload("res://adapters/surface_clast_library.gd")
const Prepare=preload("res://adapters/surface_scene_prepare.gd")
const Materials=preload("res://adapters/material_library.gd")
var checks:=0
func _initialize()->void:call_deferred("run")
func verify(value:bool,why:String)->void:
	checks+=1
	if not value:push_error(why);quit(1);assert(value,why)
func digest(mesh:Mesh)->String:
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);var arrays=mesh.surface_get_arrays(0)
	for role in [Mesh.ARRAY_VERTEX,Mesh.ARRAY_NORMAL,Mesh.ARRAY_TANGENT]:hash.update(var_to_bytes(arrays[role]))
	return hash.finish().hex_encode()
func run()->void:
	var library=Clasts.new();var repeated=Clasts.new();var hashes={}
	for variant in Clasts.VARIANTS:
		var mesh=library.mesh(variant);var arrays=mesh.surface_get_arrays(0);var vertices:PackedVector3Array=arrays[Mesh.ARRAY_VERTEX];var normals:PackedVector3Array=arrays[Mesh.ARRAY_NORMAL];var tangents:PackedFloat32Array=arrays[Mesh.ARRAY_TANGENT]
		verify(vertices.size()==240 and tangents.size()==960,"Actual clast triangle count must be80")
		verify(mesh.get_aabb().position.distance_to(Clasts.LOCAL_BOUNDS.position)<.000001 and mesh.get_aabb().size.distance_to(Clasts.LOCAL_BOUNDS.size)<.000001,"Legacy geometry envelope and centre pivot must match")
		var hash=digest(mesh);verify(hash==digest(repeated.mesh(variant)) and not hashes.has(hash),"Variants must be deterministic and distinct");hashes[hash]=true
		for i in range(0,vertices.size(),3):
			var normal=(vertices[i+2]-vertices[i]).cross(vertices[i+1]-vertices[i]).normalized()
			verify(normal.dot(normals[i])>.99999 and normal.dot(vertices[i]+vertices[i+1]+vertices[i+2])>0,"Clockwise fronts and normals must face outward")
			var basis=Basis(Vector3(.2,1,.3).normalized(),.71).scaled(Vector3(2,.3,1.7))
			var expected=(basis*(vertices[i+2]-vertices[i])).cross(basis*(vertices[i+1]-vertices[i])).normalized();var actual=(basis.inverse().transposed()*normals[i]).normalized()
			verify(expected.dot(actual)>.99999,"Inverse-transpose must match nonuniform transformed geometry")
			var t=(basis*Vector3(tangents[i*4],tangents[i*4+1],tangents[i*4+2])).normalized();t=(t-actual*t.dot(actual)).normalized();var b=actual.cross(t).normalized()
			verify(absf(t.dot(actual))<.000001 and absf(t.dot(b))<.000001 and absf(b.dot(actual))<.000001,"Fragment Gram-Schmidt TBN must stay orthogonal")
	var candidates=[]
	for i in 100:candidates.append({"stableId":"boulder-control-"+str(i),"family":"boulder","variant":i%4,"x":1000000000.0+i*.1,"y":50.0,"z":-1000000000.0-i*.2,"size":.1+(i%9)*.2,"orientation":i*.07,"rank":i/100.0,"_linearAlbedo":[.34,.31,.28]})
	var original=var_to_bytes(candidates);var origin={"x":1000000000.0,"y":49.0,"z":-1000000000.0};var buffer=Prepare.population_buffer(candidates,"boulder",origin)
	var lookup=func(x:float,_z:float)->Dictionary:return {"id":int(round((x-1000000000.0)*10))%3+1,"lithology":["granite","limestone","basalt"][int(round((x-1000000000.0)*10))%3]}
	var batches=Clasts.partition(candidates,buffer,lookup);var seen={};var recipes={}
	for batch in batches:
		recipes[batch.recipeId]=true
		for i in batch.indices.size():
			var source_index=int(batch.indices[i]);verify(not seen.has(batch.ids[i]),"No ID duplication");seen[batch.ids[i]]=true
			verify(batch.buffer.slice(i*20,(i+1)*20).to_byte_array()==buffer.slice(source_index*20,(source_index+1)*20).to_byte_array(),"All20 raw instance floats must stay byte-identical")
		var box=Clasts.buffer_bounds(batch.buffer,Clasts.LOCAL_BOUNDS)
		verify(box.size.is_finite() and box.size.min_axis_index()>=0,"Combined bounds must be finite")
	verify(seen.size()==100 and recipes.size()==3 and var_to_bytes(candidates)==original,"All source IDs/values and geology classes must be preserved")
	verify(Clasts.recipe("limestone")=="carbonate-karst" and Clasts.recipe("basalt")=="volcanic-crust" and Clasts.recipe("sandstone")=="fractured-bedrock","Use source lithology, not dominant soil recipe")
	var json_variant=candidates[1].duplicate();json_variant.variant=float(json_variant.variant)
	verify(Clasts.variant(json_variant)==Clasts.variant(candidates[1]),"JSON float and binary uint8 variant must select the same shape")
	var zero=[candidates[0].duplicate()];zero[0].x=0.0;zero[0].z=0.0
	var moved=[candidates[0].duplicate()];var a=Prepare.population_buffer(zero,"boulder",{"x":0.0,"y":49.0,"z":0.0});var b=Prepare.population_buffer(moved,"boulder",origin)
	verify(a.to_byte_array()==b.to_byte_array() and Clasts.variant(zero[0])==Clasts.variant(moved[0]),"Rebase must preserve buffer and private variant")
	verify(absf(a[7]-.35*float(zero[0].size)-1.0)<.000001,"Legacy bottom/pivot/elevation must stay unchanged")
	var shared=FileAccess.get_file_as_string("res://shaders/pbr_stochastic.gdshaderinc").replace("\r","")
	verify(shared.sha256_text()=="ff3fb479583f5341e23ea6dd026342d49e45c7705411f1e2dfba201bddc59f2c","Stochastic function extraction must be formula-byte-exact")
	var source=FileAccess.get_file_as_string("res://shaders/surface_uniforms.gdshaderinc").replace("\r","").replace('#include "res://shaders/pbr_stochastic.gdshaderinc"\n\n',shared)
	verify(source.sha256_text()=="9828e6c4a4a1fa8d7d505579f82c84d62a5cda122c9ff51086cf67c71586391d","Expanded terrain header must equal original1eee770 byte-for-byte after line ending normalization")
	var shader=load("res://shaders/clast_pbr.gdshader") as Shader
	verify(shader.get_shader_uniform_list().size()>0 and shader.code.contains("centre=main_camera_view*MODEL_MATRIX") and shader.code.contains("clast_physical_position=mat3(MODEL_MATRIX)*VERTEX"),"Shader must parse and use the main camera/translation-free physical texture frame")
	var pbr=Materials.new();pbr.layers={"rock":1,"recipe:carbonate-karst":2,"recipe:volcanic-crust":3};pbr.scales={"rock":3.0,"recipe:carbonate-karst":1.8,"recipe:volcanic-crust":2.4};pbr.loaded_assets=["rock-photo","carbonate-photo","basalt-photo"];pbr.layer_means=PackedColorArray([Color(.2,.2,.2),Color(.3,.2,.1),Color(.5,.5,.4),Color(.08,.07,.06)]);pbr.asset_digest="cpu-existing-assets"
	var material=ShaderMaterial.new();material.shader=shader
	var binding=pbr.configure_clast(material,"carbonate-karst",3)
	verify(binding.assetId=="carbonate-photo" and binding.layer==2 and binding.physicalExtentMetres==1.8 and binding.assetDigest=="cpu-existing-assets","Clast must share recipe-priority asset/physical scale and provenance")
	verify(material.get_shader_parameter("pbr_albedo_height")==pbr.albedo_height and material.get_shader_parameter("pbr_normal_rough")==pbr.normal_rough,"Reuse actual loaded texture-array resources")
	var means:PackedVector4Array=material.get_shader_parameter("layer_mean");verify(means[2].distance_to(Vector4(.5,.5,.4,1))<.000001,"Linear means must use numeric vectors, not sRGB-decoded Color uniforms")
	var fallback=pbr.configure_clast(material,"unavailable-recipe",0);verify(fallback.layer==1 and fallback.assetId=="rock-photo","Unavailable recipe must use declared existing rock fallback")
	# The analytic residual range bound has zero expected tint around source mean.
	for mean in [.0,.085,.34,.52,1.0]:
		for registered in [.0,.2,.5,.9,1.0]:
			var amplitude=minf(mean/maxf(registered,.00001),(1.0-mean)/maxf(1.0-registered,.00001))
			for value in [0.0,registered,1.0]:verify(mean+(value-registered)*amplitude>=-.000001 and mean+(value-registered)*amplitude<=1.000001,"Residual must remain bounded without fitted color gain")
	print(JSON.stringify({"test":"source-clast-renderer-cpu","result":"PASS","checks":checks,"variants":hashes.keys(),"trianglesPerInstance":80,"retainedIds":seen.size(),"batches":batches.size(),"sharedSamplerCanonicalSha256":shared.sha256_text(),"scope":"CPU mesh/buffer/geology/pivot/rebase/normal mathematics and shader parse; no GPU art or shadow qualification"}));quit()
