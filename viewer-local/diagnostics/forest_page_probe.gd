extends SceneTree
var viewer:Node
func _initialize():call_deferred("run")
func ready()->bool:return viewer.get("terrain")!=null and viewer.get("worker")==null and not bool(viewer.get("view_dirty")) and not bool(viewer.get("water_projection_busy"))
func run():
	var args=OS.get_cmdline_user_args();var out_index=args.find("--page-dir");var folder=args[out_index+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	var widths=[2560.0,640.0]
	var widths_index=args.find("--page-widths")
	if widths_index>=0:
		widths=[]
		for value in str(args[widths_index+1]).split(","):widths.append(float(value))
	for width in widths:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		var start=Time.get_ticks_msec()
		while not ready() and Time.get_ticks_msec()-start<180000:await process_frame
		if not ready():push_error("Forest page did not settle");quit(1);return
		for i in 5:await process_frame
		await viewer.call("_capture",str(folder).path_join("%dm.png"%width))
		if args.has("--page-isolate"):
			for state in [{"name":"canopy-only","ground":false,"low":false,"trees":true},{"name":"ground-low","ground":true,"low":true,"trees":false},{"name":"ground-only","ground":true,"low":false,"trees":false}]:
				viewer.call("set_layer_visibility",state.ground,state.low,state.trees)
				for i in 3:await process_frame
				await viewer.call("_capture",str(folder).path_join("%dm-%s.png"%[width,state.name]))
			viewer.call("set_layer_visibility",true,true,true)
	viewer.call("_write_metrics");quit()
