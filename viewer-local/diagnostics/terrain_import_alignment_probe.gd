extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
func _initialize():call_deferred("run")
func run():
	if not ClassDB.class_exists("Terrain3D"):push_error("Pinned Terrain3D required");quit(2);return
	var cases=[];var failures=[]
	var camera=Camera3D.new();root.add_child(camera);camera.position=Vector3(0,2000,2000);camera.look_at(Vector3.ZERO);camera.current=true
	for size in [256,512]:
		var terrain=ClassDB.instantiate("Terrain3D");terrain.set("region_size",256);terrain.set("vertex_spacing",1.0);terrain.set("collision_mode",0);root.add_child(terrain);terrain.call("set_camera",camera)
		var heights=PackedFloat32Array();heights.resize(size*size)
		for z in size:
			for x in size:heights[z*size+x]=1000.0+x*0.25+z*0.5
		var image=Image.create_from_data(size,size,false,Image.FORMAT_RF,heights.to_byte_array())
		var start=-size/2.0;var images:Array[Image]=[image,null,null]
		var data=terrain.get("data");data.call("import_images",images,Vector3(start,0,start),0.0,1.0)
		await process_frame
		var samples=[];var maximum_error=0.0;var mismatch=0;var nonfinite=0
		var grid={"width":size,"height":size,"originX":start,"originZ":start,"spacingM":1.0}
		for point in [Vector2.ZERO,Vector2(start+1,start+1),Vector2(start+size-2,start+1),Vector2(start+1,start+size-2),Vector2(start+size-2,start+size-2)]:
			var expected=Data.sample_grid(grid,heights,point.x,point.y)
			var formula=1000.0+(point.x-start)*0.25+(point.y-start)*0.5
			if absf(formula-expected)>0.0001:failures.append("viewer sampler disagrees with known source plane")
			var actual=float(data.call("get_height",Vector3(point.x,0,point.y)))
			var finite=is_finite(actual);var error=absf(actual-expected) if finite else INF
			if error>0.0001:mismatch+=1
			if finite:maximum_error=maxf(maximum_error,error)
			else:nonfinite+=1
			samples.append({"position":[point.x,point.y],"expectedViewerSample":expected,"sourcePlaneHeight":formula,"actual":actual if finite else null,"actualFinite":finite,"absoluteError":error if finite else null})
		cases.append({"imageSize":size,"regionSize":256,"spacingM":1.0,"importStart":[start,start],"regions":data.call("get_region_count"),"mismatchingQueries":mismatch,"maximumFiniteError":maximum_error,"nonfiniteQueries":nonfinite,"samples":samples})
		if size==512 and mismatch!=0:failures.append("aligned512control failed")
		if size==256 and mismatch==0:failures.append("expected256misalignment was not reproduced")
		terrain.free()
	var report={"probe":"actual pinned Terrain3DData.import_images/get_height, CPU native storage","godot":Engine.get_version_info().string,"terrain3d":"1.0.2","headless":DisplayServer.get_name()=="headless","renderer":RenderingServer.get_current_rendering_method(),"cases":cases,"passed":failures.is_empty(),"failures":failures,"claim":"256 half-region start is invalid; 512 region-aligned control must exactly match source ramp"}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():
		var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
