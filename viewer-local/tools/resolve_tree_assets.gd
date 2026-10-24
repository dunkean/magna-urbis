extends SceneTree
const TreeAssets=preload("res://adapters/surface_tree_library.gd")
func _initialize()->void:
	call_deferred("run")
func run()->void:
	var args=OS.get_cmdline_user_args()
	assert(args.size()==2,"prepared directory and calibration JSON required")
	var root=args[0];var report=JSON.parse_string(FileAccess.get_file_as_string(root.path_join("report.json")))
	var calibration=JSON.parse_string(FileAccess.get_file_as_string(args[1]))
	assert(report is Dictionary and calibration is Dictionary)
	assert(calibration.assetMaskSha256==report.lods[0].views[0].sharedMask.sha256)
	var views=[]
	for view in report.lods[0].views:
		var color=Image.new();var normal=Image.new()
		assert(color.load(root.path_join(view.products.albedo.path))==OK and normal.load(root.path_join(view.products.normal.path))==OK)
		assert(FileAccess.get_sha256(root.path_join(view.products.albedo.path))==view.products.albedo.sha256)
		assert(FileAccess.get_sha256(root.path_join(view.products.normal.path))==view.products.normal.sha256)
		var packed_color=Image.create(color.get_width(),color.get_height(),false,Image.FORMAT_RGBAH)
		var packed_normal=Image.create(color.get_width(),color.get_height(),false,Image.FORMAT_RGBAH)
		for y in color.get_height():
			for x in color.get_width():
				var c=color.get_pixel(x,y);var n=normal.get_pixel(x,y);var a=c.a;var linear=c.srgb_to_linear()
				packed_color.set_pixel(x,y,Color(linear.r*a,linear.g*a,linear.b*a,a))
				# Baked world normal is BlenderX/Y/Z; glTF/Godot is X/Z/-Y.
				packed_normal.set_pixel(x,y,Color(n.r*a,n.b*a,(1.0-n.g)*a,a))
		packed_color.generate_mipmaps();packed_normal.generate_mipmaps()
		var products={}
		for role in ["color","normal"]:
			var image:Image=packed_color if role=="color" else packed_normal
			var relative=view.name+"-"+role+".rgbah";var target=root.path_join(relative)
			var file=FileAccess.open(target,FileAccess.WRITE);file.store_buffer(image.get_data());file.close()
			products[role]={"path":relative,"sha256":FileAccess.get_sha256(target),"bytes":image.get_data().size(),"width":image.get_width(),"height":image.get_height(),"mipmaps":true,"format":"linear-premultiplied-rgba16f"}
		views.append({"name":view.name,"cameraPosition":view.cameraPosition,"target":view.target,"orthoScale":view.orthoScale,"products":products})
	var lut=PackedFloat32Array()
	for i in 257:
		var cover=float(i)/256.0;var j=0
		while j<255 and float(calibration.calibration.envelopePotential[j+1])<cover:j+=1
		var low=float(calibration.calibration.envelopePotential[j]);var high=float(calibration.calibration.envelopePotential[j+1])
		var t=clampf((cover-low)/maxf(high-low,.0000001),0.0,1.0)
		lut.append(lerpf(float(calibration.calibration.opticalMean[j]),float(calibration.calibration.opticalMean[j+1]),t))
	var lut_file=FileAccess.open(root.path_join("optical-mean.f32"),FileAccess.WRITE);lut_file.store_buffer(lut.to_byte_array());lut_file.close()
	var mask:Dictionary=report.lods[0].views[0].sharedMask
	var descriptor={"format":"magna-tree-render-assets","version":1,"experimental":true,"sourceAssetDigest":report.assetDigest,"sourceGeometry":report.lods[0],"normalization":report.normalization,"mask":mask,"views":views,"meanLinear":report.lods[0].views[0].alphaWeightedMeanLinear,"lookup":{"path":"optical-mean.f32","sha256":FileAccess.get_sha256(root.path_join("optical-mean.f32")),"length":257,"opticalCalibrationDigest":calibration.opticalCalibrationDigest},"license":report.license,"pipelineVersion":"tree-render-cpu-packed-v1","highMaxInstances":14,"highMinPixels":500.0,"highTriangleBudget":2000000,"scope":"experimental; shared top cutout C/V; oblique view-indexed planar depth approximation"}
	descriptor["digest"]=TreeAssets.descriptor_digest(descriptor)
	var result=FileAccess.open(root.path_join("resolved.json"),FileAccess.WRITE);result.store_string(JSON.stringify(descriptor,"  ",true,true));result.close()
	print(JSON.stringify({"format":descriptor.format,"digest":descriptor.digest,"views":views.size(),"output":root.path_join("resolved.json"),"scope":"CPU packing only; no GPU textures created"}));quit()
