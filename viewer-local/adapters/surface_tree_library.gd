class_name SurfaceTreeLibrary
extends RefCounted
const Mask=preload("res://adapters/surface_tree_mask.gd")
var cpu:Dictionary={}
var version:Dictionary={"available":false}
var manifest:Dictionary={}
var high_mesh:Mesh
var high_materials:Array=[]
var view_colors:=Texture2DArray.new()
var view_normals:=Texture2DArray.new()
var mean_texture:Texture2D
var mask_texture:Texture2D
var last_error:=""
var _source_packet:Dictionary={}
var _render_packet:Dictionary={}

static func _canonical(value):
	if value is int or value is float:return float(value)
	if value is Array:
		var result=[]
		for child in value:result.append(_canonical(child))
		return result
	if value is Dictionary:
		var result={};var keys=value.keys();keys.sort()
		for key in keys:result[key]=_canonical(value[key])
		return result
	return value

static func descriptor_digest(value:Dictionary)->String:
	var identity=[value.pipelineVersion,value.sourceAssetDigest,value.sourceGeometry.sha256,value.mask.sha256,value.mask.width,value.mask.height,value.mask.originX,value.mask.originZ,value.mask.spacing,value.lookup.sha256,value.lookup.opticalCalibrationDigest,value.meanLinear,value.normalization,value.highMaxInstances,value.highMinPixels,value.highTriangleBudget]
	for view in value.views:identity.append([view.name,view.cameraPosition,view.target,view.orthoScale,view.products.color.sha256,view.products.normal.sha256])
	return JSON.stringify(_canonical(identity),"",true,true).sha256_text()

func _fail(message:String)->bool:
	last_error=message;cpu={};version={"available":false,"reason":message};return false
static func verified(root:String,item:Dictionary)->PackedByteArray:
	var path=root.path_join(str(item.get("path",""))).simplify_path()
	if not FileAccess.file_exists(path) or FileAccess.get_sha256(path)!=item.get("sha256"):return PackedByteArray()
	return FileAccess.get_file_as_bytes(path)
static func _numbers(value,count:int)->bool:
	if not value is Array or value.size()!=count:return false
	for number in value:
		if not (number is int or number is float) or not is_finite(float(number)):return false
	return true
static func valid_descriptor(value:Dictionary)->bool:
	for key in ["digest","sourceAssetDigest","pipelineVersion","license"]:
		if not value.get(key) is String:return false
	for key in ["sourceGeometry","normalization","mask","lookup"]:
		if not value.get(key) is Dictionary:return false
	if not _numbers(value.get("meanLinear"),3):return false
	if not value.get("views") is Array or value.views.size()!=5:return false
	for key in ["highMaxInstances","highMinPixels","highTriangleBudget"]:
		if not (value.get(key) is int or value.get(key) is float) or not is_finite(float(value[key])):return false
	for item in [value.sourceGeometry,value.mask,value.lookup]:
		if not item.get("path") is String or not item.get("sha256") is String:return false
	if value.mask.get("width")!=1024 or value.mask.get("height")!=1024:return false
	if value.normalization.get("preparedHeight")!=1 or value.normalization.get("preparedCrownRadius")!=1:return false
	for key in ["originX","originZ","spacing"]:
		if not (value.mask.get(key) is int or value.mask.get(key) is float) or not is_finite(float(value.mask[key])):return false
	if float(value.mask.spacing)<=0 or not value.lookup.get("opticalCalibrationDigest") is String:return false
	if absf(float(value.mask.spacing)-2.2/1024.0)>.000000001 or absf(float(value.mask.originX)-(-1.1+1.1/1024.0))>.000000001 or absf(float(value.mask.originZ)-(-1.1+1.1/1024.0))>.000000001:return false
	for index in value.views.size():
		var view=value.views[index]
		if not view is Dictionary or not view.get("name") is String or not _numbers(view.get("cameraPosition"),3) or not _numbers(view.get("target"),3) or not view.get("products") is Dictionary:return false
		if view.name!=["top","oblique-0","oblique-1","oblique-2","oblique-3"][index] or view.get("orthoScale")!=2.2:return false
		for role in ["color","normal"]:
			var product=view.products.get(role)
			if not product is Dictionary or not product.get("path") is String or not product.get("sha256") is String or product.get("width")!=1024 or product.get("height")!=1024 or product.get("format")!="linear-premultiplied-rgba16f" or product.get("mipmaps")!=true:return false
			if not (product.get("bytes") is int or product.get("bytes") is float) or product.bytes<=0 or product.bytes>16*1024*1024:return false
	return true
func load_manifest(path:String,graphics:bool=true)->bool:
	_source_packet={};_render_packet={};high_mesh=null;high_materials.clear();cpu={};manifest={}
	if not FileAccess.file_exists(path):return _fail("Missing experimental tree manifest")
	var decoded=JSON.parse_string(FileAccess.get_file_as_string(path))
	if not decoded is Dictionary or decoded.get("format")!="magna-tree-render-assets" or decoded.get("version")!=1 or decoded.get("license")!="CC0-1.0":return _fail("Invalid experimental tree manifest")
	manifest=decoded
	if not valid_descriptor(manifest):return _fail("Invalid experimental tree descriptor")
	if descriptor_digest(manifest)!=manifest.get("digest"):return _fail("Tree descriptor digest mismatch")
	if manifest.highMaxInstances<1 or manifest.highMaxInstances>14 or manifest.highMinPixels<500 or manifest.highTriangleBudget>2000000:return _fail("Invalid experimental tree budgets")
	var root=path.get_base_dir();var mask_bytes=verified(root,manifest.get("mask",{}));var lut_bytes=verified(root,manifest.get("lookup",{}))
	if mask_bytes.size()!=int(manifest.mask.width)*int(manifest.mask.height) or lut_bytes.size()!=257*4:return _fail("Tree mask/LUT hash or size mismatch")
	var lut=lut_bytes.to_float32_array()
	for i in lut.size():
		if not is_finite(lut[i]) or lut[i]<0 or lut[i]>1 or (i>0 and lut[i]<lut[i-1]):return _fail("Invalid tree optical LUT")
	var colors:Array[Image]=[];var normals:Array[Image]=[]
	var top_color:PackedFloat32Array;var top_normal:PackedFloat32Array
	for view in manifest.get("views",[]):
		for role in ["color","normal"]:
			var product:Dictionary=view.products[role];var raw=verified(root,product)
			if raw.size()!=int(product.bytes) or product.width!=manifest.mask.width or product.height!=manifest.mask.height:return _fail("Tree packed image mismatch")
			var image=Image.create_from_data(product.width,product.height,true,Image.FORMAT_RGBAH,raw)
			if image.is_empty():return _fail("Invalid packed tree image")
			if role=="color":colors.append(image)
			else:normals.append(image)
			if view.name=="top":
				var unpacked=Image.create_from_data(product.width,product.height,false,Image.FORMAT_RGBAH,raw.slice(0,product.width*product.height*8))
				unpacked.convert(Image.FORMAT_RGBAF)
				if role=="color":top_color=unpacked.get_data().to_float32_array()
				else:top_normal=unpacked.get_data().to_float32_array()
	if colors.size()!=5 or normals.size()!=5 or top_color.is_empty() or top_normal.is_empty():return _fail("Expected five tree views including top")
	if verified(root,manifest.sourceGeometry).is_empty():return _fail("Tree geometry hash mismatch")
	cpu={"digest":manifest.digest,"mask":manifest.mask.duplicate(true),"maskBytes":mask_bytes,"lut":lut,"color":top_color,"normal":top_normal,"meanLinear":manifest.meanLinear,"version":"tree-cpu-top-mask-v1"}
	cpu.mask.make_read_only();cpu.make_read_only()
	if graphics:
		if view_colors.create_from_images(colors)!=OK or view_normals.create_from_images(normals)!=OK:return _fail("Tree texture-array upload failed")
		mean_texture=ImageTexture.create_from_image(Image.create_from_data(257,1,false,Image.FORMAT_RF,lut_bytes))
		mask_texture=ImageTexture.create_from_image(Image.create_from_data(1024,1024,false,Image.FORMAT_R8,mask_bytes))
		var geometry:Dictionary=manifest.sourceGeometry
		if verified(root,geometry).is_empty():return _fail("Tree geometry hash mismatch")
		var document=GLTFDocument.new();var state=GLTFState.new()
		if document.append_from_file(root.path_join(geometry.path),state)!=OK:return _fail("Tree glTF import failed")
		var scene=document.generate_scene(state)
		var nodes=scene.find_children("*","MeshInstance3D",true,false)
		if nodes.size()!=1:scene.free();return _fail("Expected one prepared tree mesh")
		high_mesh=nodes[0].mesh.duplicate()
		for i in high_mesh.get_surface_count():high_materials.append(high_mesh.surface_get_material(i))
		scene.free()
		var actual=0
		for i in high_mesh.get_surface_count():actual+=high_mesh.surface_get_array_index_len(i)/3
		if actual!=int(geometry.actualTriangles):return _fail("Imported tree triangle count mismatch")
	version={"available":true,"digest":manifest.digest,"sourceAssetDigest":manifest.sourceAssetDigest,"cpuOnly":not graphics,"triangles":manifest.sourceGeometry.actualTriangles,"impostorTriangles":2,"views":5,"pipelineVersion":manifest.pipelineVersion,"scope":manifest.scope}
	return true

func high_render_mesh()->Dictionary:
	var mesh=high_mesh.duplicate();var materials=[]
	for i in high_materials.size():
		var source:StandardMaterial3D=high_materials[i];var material=ShaderMaterial.new()
		material.shader=preload("res://shaders/tree_asset_high.gdshader")
		material.set_shader_parameter("tree_albedo",source.albedo_texture);material.set_shader_parameter("tree_normal",source.normal_texture);material.set_shader_parameter("tree_roughness",source.roughness_texture)
		material.set_shader_parameter("tree_uv_scale",source.uv1_scale);material.set_shader_parameter("tree_uv_offset",source.uv1_offset)
		var channel=Vector4.ZERO
		if int(source.roughness_texture_channel)<4:channel[int(source.roughness_texture_channel)]=1
		else:channel=Vector4(.333333333,.333333333,.333333333,0)
		material.set_shader_parameter("tree_roughness_channel",channel);material.set_shader_parameter("tree_roughness_factor",source.roughness)
		material.set_shader_parameter("tree_normal_scale",source.normal_scale);material.set_shader_parameter("tree_cutout",source.resource_name.contains("leaves"))
		material.set_shader_parameter("tree_albedo_factor",Vector4(source.albedo_color.r,source.albedo_color.g,source.albedo_color.b,source.albedo_color.a))
		material.set_shader_parameter("tree_top_mask",mask_texture)
		mesh.surface_set_material(i,material);materials.append(material)
	return {"mesh":mesh,"materials":materials}

func impostor_render_mesh()->Dictionary:
	var mesh=QuadMesh.new();mesh.size=Vector2(2.2,2.2)
	var material=ShaderMaterial.new();material.shader=preload("res://shaders/tree_asset_impostor.gdshader")
	material.set_shader_parameter("tree_view_colors",view_colors);material.set_shader_parameter("tree_view_normals",view_normals);material.set_shader_parameter("tree_top_mask",mask_texture)
	mesh.surface_set_material(0,material)
	return {"mesh":mesh,"materials":[material]}

func plan(candidates:Array,pixels:Dictionary)->Dictionary:
	var eligible=[]
	for candidate in candidates:
		if float(pixels.get(str(candidate.stableId),0.0))>=float(manifest.highMinPixels):eligible.append(candidate)
	eligible.sort_custom(func(a,b):return float(pixels[str(a.stableId)])>float(pixels[str(b.stableId)]) if float(pixels[str(a.stableId)])!=float(pixels[str(b.stableId)]) else str(a.stableId)<str(b.stableId))
	var maximum=mini(int(manifest.highMaxInstances),int(manifest.highTriangleBudget)/int(manifest.sourceGeometry.actualTriangles))
	var high=[];var selected={}
	for i in mini(maximum,eligible.size()):high.append(eligible[i]);selected[str(eligible[i].stableId)]=true
	var middle=[]
	for candidate in candidates:
		if not selected.has(str(candidate.stableId)):middle.append(candidate)
	return {"high":high,"middle":middle,"eligibleHigh":eligible.size(),"highTriangles":high.size()*int(manifest.sourceGeometry.actualTriangles),"impostorTriangles":middle.size()*2,"retainedCount":candidates.size(),"droppedCount":0}

static func instance_buffer(candidates:Array,origin:Dictionary)->PackedFloat32Array:
	var buffer=PackedFloat32Array();buffer.resize(candidates.size()*20)
	for i in candidates.size():
		var c:Dictionary=candidates[i];var size=float(c.size);var radius=float(c.get("crownRadiusM",size*.42));var angle=float(c.orientation)
		var cosine=cos(angle);var sine=sin(angle);var at=i*20
		buffer[at]=cosine*radius;buffer[at+1]=0;buffer[at+2]=sine*radius;buffer[at+3]=float(c.x)-float(origin.x)
		buffer[at+4]=0;buffer[at+5]=size;buffer[at+6]=0;buffer[at+7]=float(c.y)-float(origin.y)
		buffer[at+8]=-sine*radius;buffer[at+9]=0;buffer[at+10]=cosine*radius;buffer[at+11]=float(c.z)-float(origin.z)
		buffer[at+12]=1;buffer[at+13]=1;buffer[at+14]=1;buffer[at+15]=1
		buffer[at+16]=size;buffer[at+17]=float(c.get("canopyClass",0));buffer[at+18]=float(c.get("rank",0));buffer[at+19]=radius
	return buffer

static func bounds(candidates:Array,origin:Dictionary)->AABB:
	var low=Vector3(INF,INF,INF);var high=Vector3(-INF,-INF,-INF)
	for c in candidates:
		var point=Vector3(float(c.x)-float(origin.x),float(c.y)-float(origin.y),float(c.z)-float(origin.z));var radius=float(c.get("crownRadiusM",float(c.size)*.42))*1.1
		low=low.min(point-Vector3(radius,float(c.size)*.6,radius));high=high.max(point+Vector3(radius,float(c.size)*1.6,radius))
	return AABB(low,high-low) if not candidates.is_empty() else AABB()

func packet_copy(packet:Dictionary,presentation:String)->Dictionary:
	if cpu.is_empty() or presentation!="aerial":return packet
	if is_same(packet,_source_packet):return _render_packet
	_source_packet=packet;_render_packet=packet.duplicate(false);_render_packet["_treeAssetCPU"]=cpu;return _render_packet
