extends "res://diagnostics/tree_solar_layer_probe.gd"
func run()->void:
	var args=options()
	if args.has("--layer-check-only"):print("SURFACE_LAYER_PROBE_PARSE_OK");quit();return
	if not args.has("--world") or not args.has("--layer-report") or not args.has("--layer-captures"):
		push_error("Layer probe requires --world, --layer-report and --layer-captures");quit(2);return
	var packed=load("res://scene/main.tscn") as PackedScene
	viewer=packed.instantiate();viewer.set_script(preload("res://diagnostics/locked_surface_scene.gd"));root.add_child(viewer);current_scene=viewer
	if not viewer.has_method("set_layer_visibility"):push_error("Selected viewer has no explicit layer visibility hook");quit(2);return
	var require_instances=args.has("--layer-require-instances")
	if require_instances and not viewer.has_method("population_instances"):push_error("Near layer probe requires actual renderer population_instances metadata");quit(2);return
	var began=Time.get_ticks_msec();var require_live=args.has("--live-url")
	while not ready(require_live) and Time.get_ticks_msec()-began<180000:await process_frame
	if not ready(require_live):push_error("Layer probe did not reach a final source snapshot");quit(1);return
	var world:Dictionary=viewer.get("rendered_world")
	if world.get("surfaceLayers",{}).get("groundAvailability")!="explicit" or world.get("surfaceLayers",{}).get("lowCoverAvailability")!="explicit":
		push_error("Legacy composite cannot qualify bare ground");quit(1);return
	var report={"format":"magna-layer-isolation-proof","version":2,"status":"running","widthM":float(viewer.get("width_m")),"requireInstances":require_instances,"groundOnlyObjectsExcluded":args.has("--ground-only"),"views":[],
		"scope":"Four production visibility states at one fixed camera/source snapshot, actual binary source/context/ground/geometry/inventory/instance-buffer hashes, shader uniforms and central image digests. Near views additionally require actual submitted/visible/alpha-positive-in-frustum instances. Counts are not GPU occlusion or per-pixel crown areas; potential cover diagnostics remain explicitly separate."}
	var cases=[{"name":"all","ground":true,"lowCover":true,"trees":true},{"name":"no-low-cover","ground":true,"lowCover":false,"trees":true},{"name":"no-trees","ground":true,"lowCover":true,"trees":false},{"name":"ground","ground":true,"lowCover":false,"trees":false}]
	for test in cases:
		viewer.call("set_layer_visibility",test.ground,test.lowCover,test.trees)
		await process_frame;await process_frame
		var started=Time.get_ticks_msec()
		while not ready(require_live) and Time.get_ticks_msec()-started<60000:await process_frame
		if not ready(require_live):push_error("Layer visibility did not settle");quit(1);return
		await RenderingServer.frame_post_draw
		var image=root.get_texture().get_image();var size=image.get_size()
		var centre=image.get_region(Rect2i(Vector2i(size.x/4,size.y/4),Vector2i(size.x/2,size.y/2)))
		var hasher=HashingContext.new();hasher.start(HashingContext.HASH_SHA256);hasher.update(centre.get_data())
		var pixel_hash=hasher.finish().hex_encode()
		var view=physical_snapshot();view.name=test.name;view.centralPixelSha256=pixel_hash
		view.capturePath=str(args["--layer-captures"]).path_join(test.name+".png")
		if require_instances:
			var issue=near_instance_error(view,report.views[0] if not report.views.is_empty() else view)
			if not issue.is_empty():push_error(issue);quit(1);return
		report.views.append(view)
		await viewer.call("_capture",view.capturePath)
	# Raw terrain mean only: source-map/road Decals otherwise add ALBEDO lighting
	# over the diagnostic EMISSION and are not a measurement of the ground field.
	var scene_objects:Node3D=viewer.get("objects")
	var objects_were_visible=scene_objects.visible
	scene_objects.visible=false
	viewer.call("set_layer_visibility",true,false,false);viewer.set("diagnostic",7)
	var terrain:Node=viewer.get("terrain");terrain.get("material").call("set_shader_param","diagnostic",7)
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var bare=physical_snapshot();bare.diagnostic=int(terrain.get("material").call("get_shader_param","diagnostic"))
	bare.diagnosticLayers={"terrain":true,"groundMean":true,"lowCover":false,"canopy":false,"projectedWater":false,"roads":false,"urban":false,"candidateMeshes":false}
	bare.diagnosticScope="Unlit canonical ground mean on terrain only; all objects, including Decals and physical water, hidden without editing source fields or instance buffers"
	bare.capturePath=str(args["--layer-captures"]).path_join("ground-mean-unlit.png")
	report.bareGroundMean=bare;await viewer.call("_capture",bare.capturePath)
	scene_objects.visible=objects_were_visible
	viewer.set("diagnostic",0);terrain.get("material").call("set_shader_param","diagnostic",0)
	viewer.call("set_layer_visibility",true,true,true);await process_frame
	var restore_started=Time.get_ticks_msec()
	while not ready(require_live) and Time.get_ticks_msec()-restore_started<60000:await process_frame
	if not ready(require_live):push_error("Layer restore did not settle");quit(1);return
	report.restored=physical_snapshot()
	report["obliqueForest"]=viewer.get("forest_full_metrics").duplicate(true)
	report["cameraInputLocked"]=true
	report.status="complete";report.durationMs=Time.get_ticks_msec()-began
	viewer.call("_write_metrics")
	var target=ProjectSettings.globalize_path(str(args["--layer-report"]));DirAccess.make_dir_recursive_absolute(target.get_base_dir())
	var file=FileAccess.open(target,FileAccess.WRITE)
	if file==null:push_error("Cannot write layer isolation report");quit(1);return
	file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"event":"layer-isolation-proof","path":target,"status":report.status}));quit()
