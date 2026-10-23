extends SceneTree
var viewer:Node
func _initialize():call_deferred("run")
func ready()->bool:return viewer.get("terrain")!=null and viewer.get("worker")==null and not bool(viewer.get("view_dirty")) and not bool(viewer.get("water_projection_busy"))
func run():
	var args=OS.get_cmdline_user_args();var out_index=args.find("--page-dir");var folder=args[out_index+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	for width in [2560.0,640.0]:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		var start=Time.get_ticks_msec()
		while not ready() and Time.get_ticks_msec()-start<180000:await process_frame
		if not ready():push_error("Forest page did not settle");quit(1);return
		for i in 5:await process_frame
		await viewer.call("_capture",str(folder).path_join("%dm.png"%width))
	viewer.call("_write_metrics");quit()
