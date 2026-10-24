class_name SurfaceVegetationLibrary
extends RefCounted

const PIPELINE_VERSION="grass-textured-linear-tbn-hash-v1"
var variants:Array=[]
var textures:Dictionary={}
var mean_linear:=Vector3.ONE
var version:Dictionary={"available":false,"reason":"no prepared vegetation manifest"}
var last_error:=""

static func _path(root:String,value:String)->String:
	return root.path_join(value).simplify_path() if not value.is_absolute_path() else value.simplify_path()

func _fail(message:String)->bool:
	last_error=message;variants.clear();textures.clear();version={"available":false,"reason":message};return false

func load_manifest(path:String)->bool:
	variants.clear();textures.clear();last_error=""
	if path.is_empty():return _fail("no prepared vegetation manifest")
	var manifest=JSON.parse_string(FileAccess.get_file_as_string(path))
	if not manifest is Dictionary or manifest.get("format")!="magna-vegetation-assets" or manifest.get("version")!=1:return _fail("invalid vegetation manifest")
	var assets=manifest.get("assets",[])
	if not assets is Array or assets.size()!=1:return _fail("expected one prepared grass asset")
	var asset:Dictionary=assets[0]
	if asset.get("family")!="grass" or asset.get("license")!="CC0-1.0":return _fail("invalid grass provenance")
	var root=path.get_base_dir();var product:Dictionary=asset.get("product",{})
	var mesh_path=_path(root,str(product.get("path","")))
	if not FileAccess.file_exists(mesh_path) or FileAccess.get_sha256(mesh_path)!=product.get("sha256"):return _fail("prepared mesh hash mismatch")
	var data=JSON.parse_string(FileAccess.get_file_as_string(mesh_path))
	if not data is Dictionary or data.get("format")!="magna-vegetation-meshes" or data.get("version")!=1:return _fail("invalid prepared mesh format")
	var prepared=data.get("variants",[])
	if not prepared is Array or prepared.is_empty() or prepared.size()>8:return _fail("invalid variant count")
	for value in prepared:
		if not validate_variant(value):return _fail("invalid prepared variant")
		variants.append({"id":value.id,"triangleCount":int(value.triangleCount),"mesh":mesh_from_variant(value),"normalization":value.normalization})
	var hashes={"product":product.sha256};var images={}
	for role in ["baseColor","normal","arm","alpha"]:
		var source:Dictionary=asset.get("sources",{}).get(role,{})
		var source_path=_path(root,str(source.get("path","")))
		if not FileAccess.file_exists(source_path) or FileAccess.get_sha256(source_path)!=source.get("sha256"):return _fail("vegetation map hash mismatch: "+role)
		var image=Image.new()
		if image.load(source_path)!=OK or image.is_empty() or image.get_width()>2048 or image.get_height()>2048:return _fail("invalid vegetation map: "+role)
		images[role]=image;hashes[role]=source.sha256
	# Normalize the source texture around its alpha-weighted linear mean. The existing
	# candidate colour stays a mean-response tint; photographic detail is not multiplied
	# by the already dark mean a second time. This affects renderer response only.
	var sum:=Vector3.ZERO;var weight:=0.0
	var base:Image=images.baseColor;var alpha:Image=images.alpha
	if base.get_size()!=alpha.get_size():return _fail("vegetation alpha dimensions mismatch")
	for y in range(0,base.get_height(),8):
		for x in range(0,base.get_width(),8):
			var a=alpha.get_pixel(x,y).r;var color=base.get_pixel(x,y).srgb_to_linear()
			sum+=Vector3(color.r,color.g,color.b)*a;weight+=a
	if weight<=0:return _fail("empty vegetation alpha")
	mean_linear=(sum/weight).max(Vector3(.0001,.0001,.0001))
	for role in images:
		var image:Image=images[role];image.generate_mipmaps(role=="normal")
		textures[role]=ImageTexture.create_from_image(image)
	var descriptor={"pipelineVersion":PIPELINE_VERSION,"assetId":asset.id,"license":asset.license,"hashes":hashes,"variantPolicy":asset.variantPolicy,"sourceMeanLinear":[mean_linear.x,mean_linear.y,mean_linear.z],"meanSamplingStride":8,"variants":[]}
	for item in variants:descriptor.variants.append({"id":item.id,"triangleCount":item.triangleCount,"normalization":item.normalization})
	descriptor["available"]=true;descriptor["digest"]=JSON.stringify(descriptor).sha256_text();version=descriptor
	return true

static func validate_variant(value)->bool:
	if not value is Dictionary:return false
	for key in ["positions","normals","uv","tangents","indices"]:
		if not value.get(key) is Array:return false
		for n in value[key]:
			if not (n is float or n is int) or not is_finite(float(n)):return false
	var count=value.positions.size()/3
	if count<3 or count>1024 or value.positions.size()%3!=0 or value.normals.size()!=count*3 or value.uv.size()!=count*2 or value.tangents.size()!=count*4:return false
	if value.indices.size()%3!=0 or value.indices.size()/3!=value.get("triangleCount") or value.triangleCount>256:return false
	for index in value.indices:
		if index!=int(index) or index<0 or index>=count:return false
	var low:=INF;var high:=-INF
	for i in int(count):low=minf(low,float(value.positions[i*3+1]));high=maxf(high,float(value.positions[i*3+1]))
	return absf(low+.5)<.000001 and absf(high-.5)<.000001 and value.get("normalization",{}).get("preparedHeight")==1

static func mesh_from_variant(value:Dictionary)->ArrayMesh:
	var positions=PackedVector3Array();var normals=PackedVector3Array();var uv=PackedVector2Array()
	for i in value.positions.size()/3:positions.append(Vector3(value.positions[i*3],value.positions[i*3+1],value.positions[i*3+2]));normals.append(Vector3(value.normals[i*3],value.normals[i*3+1],value.normals[i*3+2]))
	for i in value.uv.size()/2:uv.append(Vector2(value.uv[i*2],value.uv[i*2+1]))
	var arrays=[];arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=positions;arrays[Mesh.ARRAY_NORMAL]=normals;arrays[Mesh.ARRAY_TEX_UV]=uv;arrays[Mesh.ARRAY_TANGENT]=PackedFloat32Array(value.tangents);arrays[Mesh.ARRAY_INDEX]=PackedInt32Array(value.indices)
	var mesh=ArrayMesh.new();mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays);return mesh

static func partition(candidates:Array,buffer:PackedFloat32Array,variant_count:int)->Array:
	assert(variant_count>0 and buffer.size()==candidates.size()*20)
	var batches=[]
	for i in variant_count:batches.append({"variant":i,"buffer":PackedFloat32Array(),"ids":[]})
	for i in candidates.size():
		var index=posmod(int(candidates[i].get("variant",0)),variant_count)
		batches[index].buffer.append_array(buffer.slice(i*20,i*20+20));batches[index].ids.append(candidates[i].stableId)
	return batches

func material()->ShaderMaterial:
	var value=ShaderMaterial.new();value.shader=preload("res://shaders/vegetation_grass.gdshader")
	for role in textures:value.set_shader_parameter(role+"_texture",textures[role])
	value.set_shader_parameter("source_mean_linear",mean_linear)
	return value
