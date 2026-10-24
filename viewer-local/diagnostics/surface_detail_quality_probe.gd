extends "res://diagnostics/layer_probe.gd"
# Same source, camera, inventory and instance buffers for each paired view.
# Only the material allocation and shrub/debris representation are changed.
const DetailDistribution=preload("res://adapters/surface_detail_distribution.gd")
func set_representation(enabled:bool)->void:
	viewer.get("terrain").get("material").call("set_shader_param","surface_detail_distribution_enabled",enabled)
	for node in viewer.get("objects").get_children():
		if not node is MultiMeshInstance3D:continue
		var family=str(node.get_meta("populationFamily",""))
		if not family in ["shrub","debris"]:continue
		if not node.has_meta("probeNewMesh"):node.set_meta("probeNewMesh",node.multimesh.mesh)
		if enabled:node.multimesh.mesh=node.get_meta("probeNewMesh");continue
		var mesh=SphereMesh.new();mesh.radial_segments=8 if family=="shrub" else 5;mesh.rings=4 if family=="shrub" else 3
		mesh.radius=.42 if family=="shrub" else .5;mesh.height=1.0 if family=="shrub" else .7
		var material=ShaderMaterial.new();material.shader=load("res://shaders/surface_object.gdshader");mesh.material=material;node.multimesh.mesh=mesh
func run()->void:
	var args=options()
	if args.has("--detail-check-only"):print("SURFACE_DETAIL_QUALITY_PARSE_OK");quit();return
	if not args.has("--detail-report") or not args.has("--detail-captures"):push_error("Detail probe output paths missing");quit(2);return
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	var began=Time.get_ticks_msec()
	while not ready(false) and Time.get_ticks_msec()-began<180000:await process_frame
	if not ready(false):push_error("Retained detail source did not settle");quit(1);return
	var report={"format":"surface-detail-retained-quality-probe","version":1,"status":"running","distribution":DetailDistribution.metadata(int(viewer.get("rendered_world").get("seed",0))),"views":[],"scope":"Explicit retained replay, no neural call or new observed detail. Each paired pose keeps camera/source/context/ground/geometry/inventory/buffers exact. Before uses the previous uniform mixture and sphere shrubs/debris, after uses calibrated component allocations and authored leaves/twigs. Tree pipeline/positions/densities unchanged."}
	for width in [2560.0,160.0,40.0,10.0]:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		var started=Time.get_ticks_msec()
		while not ready(false) and Time.get_ticks_msec()-started<180000:await process_frame
		if not ready(false):push_error("Detail pose failed to settle");quit(1);return
		var reference={};var raw_hashes=[]
		for test in [{"name":"before-all","enabled":false,"low":true,"trees":true,"diagnostic":0},{"name":"after-all","enabled":true,"low":true,"trees":true,"diagnostic":0},{"name":"before-no-trees","enabled":false,"low":true,"trees":false,"diagnostic":0},{"name":"after-no-trees","enabled":true,"low":true,"trees":false,"diagnostic":0},{"name":"after-ground","enabled":true,"low":false,"trees":false,"diagnostic":0},{"name":"before-mean","enabled":false,"low":false,"trees":false,"diagnostic":7},{"name":"after-mean","enabled":true,"low":false,"trees":false,"diagnostic":7}]:
			set_representation(test.enabled);viewer.call("set_layer_visibility",true,test.low,test.trees)
			viewer.get("terrain").get("material").call("set_shader_param","diagnostic",test.diagnostic)
			viewer.get("objects").visible=test.diagnostic==0
			for i in 4:await process_frame
			await RenderingServer.frame_post_draw
			var snapshot=physical_snapshot()
			var immutable={}
			for key in ["worldId","terrainVersion","canonicalContextId","canonicalContextFingerprint","parentTerrainFingerprint","groundResponseFingerprint","groundFieldsVersion","projectedGroundFieldsVersion","geometryDetailFingerprint","inventoryFingerprint","instanceBufferFingerprint"]:immutable[key]=snapshot[key]
			if reference.is_empty():reference=immutable
			elif immutable!=reference:push_error("Detail A/B mutated source physics/buffers");quit(1);return
			var image=root.get_texture().get_image();var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(image.get_data());var pixel_hash=hash.finish().hex_encode()
			if test.diagnostic==7:raw_hashes.append(pixel_hash)
			var path=str(args["--detail-captures"]).path_join("%dm"%int(width)).path_join(test.name+".png")
			DirAccess.make_dir_recursive_absolute(path.get_base_dir());await viewer.call("_capture",path)
			report.views.append({"widthM":width,"name":test.name,"enabled":test.enabled,"diagnostic":test.diagnostic,"image":path,"pixelSha256":pixel_hash,"sourceFingerprints":immutable,"populationInstances":snapshot.populationInstances,"visibility":snapshot.visibility})
		if raw_hashes.size()!=2 or raw_hashes[0]!=raw_hashes[1]:push_error("Raw GR mean changed under renderer distribution toggle");quit(1);return
	viewer.get("objects").visible=true;viewer.call("set_layer_visibility",true,true,true);viewer.call("_write_metrics")
	report.status="complete";report.durationMs=Time.get_ticks_msec()-began
	var output=FileAccess.open(str(args["--detail-report"]),FileAccess.WRITE);output.store_string(JSON.stringify(report,"  "));output=null;quit()
