extends "res://diagnostics/tree_solar_layer_probe.gd"
func run()->void:
	var args=options();assert(args.has("--layer-captures"))
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer)
	var started=Time.get_ticks_msec()
	while not ready(false) and Time.get_ticks_msec()-started<180000:await process_frame
	if not ready(false):push_error("Oblique isolation never reached a stable source");quit(1);return
	viewer.set_process(false);viewer.set_process_unhandled_input(false)
	var terrain=viewer.get("terrain").get("material");var weight=terrain.call("get_shader_param","canopy_geometry_weight")
	var rows=[]
	for mode in ["all","geometry-only","optical-only","neither"]:
		var paint=mode in ["all","optical-only"];var geometry=mode in ["all","geometry-only"]
		terrain.call("set_shader_param","show_trees",paint)
		terrain.call("set_shader_param","canopy_geometry_weight",weight if geometry else 0.0)
		for material in viewer.get("canopy_materials"):material.set_shader_parameter("canopy_geometry_weight",weight if geometry else 0.0)
		for i in 3:await process_frame
		await RenderingServer.frame_post_draw
		var target=str(args["--layer-captures"]).path_join(mode+".png");await viewer.call("_capture",target)
		rows.append({"mode":mode,"physical":physical_snapshot(),"frozenShaderOverride":{"groundCanopy":paint,"geometryWeight":weight if geometry else 0},"capture":target,"sha256":FileAccess.get_sha256(target)})
	var file=FileAccess.open(str(args["--layer-report"]),FileAccess.WRITE);file.store_string(JSON.stringify({"version":1,"scope":"Explicit frozen diagnostic: same source/camera, paint and actual tree geometry independently gated; viewer process paused. No source edits, not production mode.","views":rows},"  "));file=null;quit()
