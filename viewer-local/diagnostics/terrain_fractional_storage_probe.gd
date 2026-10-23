extends SceneTree

# Read the actual native regions and RF pixels after import. Separately record
# get_height's near-vertex lookup, which truncates unsnapped fractional positions
# in Terrain3D 1.0.2. That CPU API discrepancy is not a GPU height measurement.
func _initialize():call_deferred("run")
func run():
	if not ClassDB.class_exists("Terrain3D"):push_error("Pinned Terrain3D required");quit(2);return
	var cases=[];var failures=[]
	var camera=Camera3D.new();root.add_child(camera);camera.position=Vector3(0,3000,3000);camera.look_at(Vector3.ZERO);camera.current=true
	for spec in [{"size":256,"spacing":1.0},{"size":512,"spacing":1.0},{"size":512,"spacing":0.4672897196261682},{"size":512,"spacing":77.972412109375},{"size":512,"spacing":1.59765625},{"size":1024,"spacing":0.4726409912109375}]:
		var size:int=spec.size;var spacing:float=spec.spacing
		var terrain=ClassDB.instantiate("Terrain3D");terrain.set("region_size",256);terrain.set("vertex_spacing",spacing);terrain.set("collision_mode",0);root.add_child(terrain);terrain.call("set_camera",camera)
		var heights=PackedFloat32Array();heights.resize(size*size)
		for z in size:
			for x in size:heights[z*size+x]=1000.0+x*0.25+z*0.5
		var source=Image.create_from_data(size,size,false,Image.FORMAT_RF,heights.to_byte_array())
		var start=-size/2.0*spacing;var images:Array[Image]=[source,null,null]
		var data=terrain.get("data");data.call("import_images",images,Vector3(start,0,start),0.0,1.0)
		await process_frame
		var regions=[];var exact=true
		for region in data.call("get_regions_active",true,false):
			var loc:Vector2i=region.call("get_location")
			var offset=loc*256+Vector2i(size/2,size/2)
			var within=offset.x>=0 and offset.y>=0 and offset.x+256<=size and offset.y+256<=size
			var same=false
			if within:
				var actual:Image=region.call("get_height_map")
				var expected=source.get_region(Rect2i(offset,Vector2i(256,256)))
				same=actual.get_size()==expected.get_size() and actual.get_data()==expected.get_data()
			exact=exact and same
			regions.append({"regionLocation":[loc.x,loc.y],"sourcePixelOffset":[offset.x,offset.y],"withinPlannedImage":within,"allRFBytesIdentical":same})
		var queries=[];var maximum_api_error=0.0
		for index in [Vector2i(1,1),Vector2i(size/2,size/2),Vector2i(size-2,1),Vector2i(1,size-2),Vector2i(size-2,size-2)]:
			var p=Vector3(start+index.x*spacing,0,start+index.y*spacing)
			var expected=float(heights[index.y*size+index.x]);var actual=float(data.call("get_height",p))
			var error=absf(actual-expected) if is_finite(actual) else INF
			if is_finite(error):maximum_api_error=maxf(maximum_api_error,error)
			queries.append({"pixel":[index.x,index.y],"position":[p.x,p.z],"expectedPixelHeight":expected,"nativeGetHeight":actual if is_finite(actual) else null,"absoluteError":error if is_finite(error) else null})
		var native_spacing=float(terrain.get("vertex_spacing"));var maximum_xy_rounding=absf(native_spacing-spacing)*size*.5
		var correct=exact and regions.size()==size*size/(256*256) and maximum_xy_rounding<0.001
		if size==256:
			if correct:failures.append("misaligned256regression not reproduced")
		elif not correct:failures.append("native region storage differs at spacing "+str(spacing))
		cases.append({"imageSize":size,"requestedSpacingM":spacing,"nativeSpacingM":native_spacing,"maximumAxisScaleRoundingM":maximum_xy_rounding,"storageAlignedAndAllBytesExact":correct,"regions":regions,"maximumNearVertexGetHeightErrorM":maximum_api_error,"getHeightQueries":queries})
		terrain.free()
	var report={"probe":"pinned native Terrain3D region address + complete RF byte comparison after import","godot":Engine.get_version_info().string,"terrain3d":"1.0.2","headless":DisplayServer.get_name()=="headless","cases":cases,"passed":failures.is_empty(),"failures":failures,"scope":"CPU native storage and fractional vertex spacing; GPU position is not measured. get_height discrepancies are reported separately, never treated as GPU errors.","upstreamGetHeightSource":"https://github.com/TokisanGames/Terrain3D/blob/v1.0.2-stable/src/terrain_3d_data.cpp#L586-L632"}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():
		var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify({"passed":report.passed,"failures":failures,"caseCount":cases.size(),"scope":report.scope}));quit(0 if failures.is_empty() else 1)
