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
	for key in ["originX","originZ","spacing"]:
		if not (value.mask.get(key) is int or value.mask.get(key) is float) or not is_finite(float(value.mask[key])):return false
	if float(value.mask.spacing)<=0 or not value.lookup.get("opticalCalibrationDigest") is String:return false
	for view in value.views:
		if not view is Dictionary or not view.get("name") is String or not _numbers(view.get("cameraPosition"),3) or not _numbers(view.get("target"),3) or not view.get("products") is Dictionary:return false
		for role in ["color","normal"]:
			var product=view.products.get(role)
			if not product is Dictionary or not product.get("path") is String or not product.get("sha256") is String or product.get("width")!=1024 or product.get("height")!=1024 or product.get("format")!="linear-premultiplied-rgba16f" or product.get("mipmaps")!=true:return false
	return true
func load_manifest(path:String,graphics:bool=true)->bool:
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
	version={"available":true,"digest":manifest.digest,"sourceAssetDigest":manifest.sourceAssetDigest,"cpuOnly":not graphics,"triangles":manifest.sourceGeometry.actualTriangles,"impostorTriangles":2,"views":5,"pipelineVersion":manifest.pipelineVersion,"scope":manifest.scope}
	return true

func packet_copy(packet:Dictionary,presentation:String)->Dictionary:
	if cpu.is_empty() or presentation!="aerial":return packet
	if is_same(packet,_source_packet):return _render_packet
	_source_packet=packet;_render_packet=packet.duplicate(false);_render_packet["_treeAssetCPU"]=cpu;return _render_packet
