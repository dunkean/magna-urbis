extends "res://diagnostics/layer_probe.gd"
func non_boulder_buffers()->String:
	var values={};var objects:Node=viewer.get("objects")
	for node in objects.get_children():
		if node is MultiMeshInstance3D and node.get_meta("populationFamily","")!="boulder":values[str(node.name)]=node.multimesh.buffer
	var names=values.keys();names.sort();return digest_fields(values,names)
func physical_snapshot()->Dictionary:
	var result=super.physical_snapshot();result["nonBoulderBufferFingerprint"]=non_boulder_buffers();result["populationInstances"]=viewer.call("population_instances");return result
func run()->void:
	var args=options()
	if args.has("--clast-check-only"):print("CLAST_LAYER_PROBE_PARSE_OK");quit();return
	if not args.has("--clast-report") or not args.has("--clast-captures"):push_error("Missing clast probe output arguments");quit(2);return
	viewer=(load("res://scene/main.tscn") as PackedScene).instantiate();root.add_child(viewer);current_scene=viewer
	var began=Time.get_ticks_msec()
	while not ready(false) and Time.get_ticks_msec()-began<180000:await process_frame
	if not ready(false):push_error("Clast source did not settle");quit(1);return
	var report={"format":"source-clast-layer-probe","version":1,"views":[],"scope":"Actual source/native meshes. Non-boulder buffer hash and five visibility states; no-boulders disables nodes AND their engine casting, not canonical fields."}
	var cases=[{"name":"all","ground":true,"lowCover":true,"trees":true,"boulders":true},{"name":"no-boulders","ground":true,"lowCover":true,"trees":true,"boulders":false},{"name":"no-low-cover","ground":true,"lowCover":false,"trees":true,"boulders":true},{"name":"no-trees","ground":true,"lowCover":true,"trees":false,"boulders":true},{"name":"ground","ground":true,"lowCover":false,"trees":false,"boulders":true}]
	for test in cases:
		viewer.call("set_layer_visibility",test.ground,test.lowCover,test.trees)
		for node in viewer.get("objects").get_children():
			if not node is MultiMeshInstance3D or node.get_meta("populationFamily","")!="boulder":continue
			if not node.has_meta("probeOriginalCasting"):node.set_meta("probeOriginalCasting",node.cast_shadow)
			node.visible=test.boulders;node.cast_shadow=node.get_meta("probeOriginalCasting") if test.boulders else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		for i in 3:await process_frame
		await RenderingServer.frame_post_draw
		var image=root.get_texture().get_image();var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(image.get_data())
		var view=physical_snapshot();view.name=test.name;view["fullPixelSha256"]=hash.finish().hex_encode();view["bouldersVisible"]=test.boulders
		view["capturePath"]=str(args["--clast-captures"]).path_join(test.name+".png");report.views.append(view)
		await viewer.call("_capture",view.capturePath)
	viewer.call("set_layer_visibility",true,true,true);viewer.call("_write_metrics")
	report.status="complete";report.durationMs=Time.get_ticks_msec()-began
	var path=ProjectSettings.globalize_path(str(args["--clast-report"]));DirAccess.make_dir_recursive_absolute(path.get_base_dir());var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null;quit()
