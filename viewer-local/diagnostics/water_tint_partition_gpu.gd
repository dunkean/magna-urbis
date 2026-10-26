extends SceneTree
# Authored two-triangle control: verifies the actual GPU VERTEX_ID partition.
# This is not geographic source data or a landscape qualification.
const P=preload("res://adapters/surface_water_projection.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()!=1:push_error("Expected output directory");quit(2);return
	DirAccess.make_dir_recursive_absolute(args[0])
	var vertices=PackedVector3Array([Vector3(-2,4,0),Vector3(-1,4,0),Vector3(-2,4,1),Vector3(1,4,0),Vector3(2,4,0),Vector3(1,4,1)])
	var classes=Image.create(4,4,false,Image.FORMAT_RF);classes.fill(Color(1,0,0,1))
	var geometry={"vertices":vertices,"anchor":{"x":0.,"y":0.,"z":0.},"sourceVectorVertexCount":3,"sourceSeaVertexCount":3,"authority":"magna-urbis-fixed-hydrology","fixedVectorDisplayAvailable":true,"classImage":classes,"classOrigin":{"x":-3.,"z":-3.},"classSpacingM":2.,"classSize":Vector2i(4,4)}
	var colors={"river":Vector3(.035,.17,.20),"lake":Vector3(.028,.10,.115),"fallback":Vector3(.028,.10,.115),"sea":Vector3(.018,.095,.125)}
	var before=P._sha(vertices.to_byte_array());var class_before=P._sha(classes.get_data())
	var report={"format":"water-tint-partition-gpu-1","scope":"Authored two-triangle branch control only, not real-world water/terrain","adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method(),"runs":[]}
	for uniform in [false,true]:
		var result=await P.bake(root,geometry,{"x":0.,"y":0.,"z":0.},{"x":0.,"y":0.},8.,colors,{"uniformVectorTint":uniform,"sourceKey":"authored-partition-control","resolution":128,"msaa":4})
		if result.has("error"):push_error(str(result.error));quit(1);return
		var image:Image=result.texture.get_image();var counts={"river":0,"fallback":0,"sea":0}
		for y in image.get_height():
			for x in image.get_width():
				var actual=image.get_pixel(x,y)
				if actual.a<.99:continue
				for key in counts:
					var linear:Vector3=colors[key];var expected=Color(linear.x,linear.y,linear.z,1.).linear_to_srgb()
					if maxf(absf(actual.r-expected.r),maxf(absf(actual.g-expected.g),absf(actual.b-expected.b)))<.01:counts[key]+=1
		if (uniform and (counts.fallback<8 or counts.sea<8 or counts.river!=0)) or (not uniform and (counts.river<16 or counts.fallback!=0 or counts.sea!=0)):
			push_error("GPU tint partition differs: "+JSON.stringify(counts));quit(1);return
		if P._sha(vertices.to_byte_array())!=before or P._sha(classes.get_data())!=class_before:push_error("Source control mutated");quit(1);return
		var path=args[0].path_join("uniform.png" if uniform else "source-classes.png");image.save_png(path)
		report.runs.append({"uniform":uniform,"counts":counts,"diagnostics":result.diagnostics,"path":path,"rgbaSha256":P._sha(image.get_data()),"sourceVerticesUnchanged":true,"sourceClassesUnchanged":true})
	report.status="PASS authored GPU partition control"
	var file=FileAccess.open(args[0].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"status":report.status,"adapter":report.adapter,"runs":report.runs.size()}));quit()
