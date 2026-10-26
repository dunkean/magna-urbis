extends SceneTree
var viewer:Node
var output:String
var report={"scope":"Retained real V8 candidate pages; whole-view page/frustum transitions only, not fresh neural generation","views":[],"motion":[]}
func _initialize():call_deferred("run")
func ready()->bool:return viewer.get("terrain")!=null and viewer.get("worker")==null and not bool(viewer.get("view_dirty")) and not bool(viewer.get("water_projection_busy")) and not bool(viewer.get("canopy_transition_busy"))
func settle()->bool:
	var start=Time.get_ticks_msec()
	while not ready() and Time.get_ticks_msec()-start<180000:await process_frame
	return ready()
func run():
	var args=OS.get_cmdline_user_args();output=args[args.find("--probe-dir")+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	if not await settle():push_error("Canopy view did not settle");quit(1);return
	for width in [10000.0,2560.0,640.0]:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		if not await settle():push_error("Canopy view did not settle");quit(1);return
		for i in 3:await process_frame
		await viewer.call("_capture",output.path_join("%dm-top.png"%width))
		report.views.append({"widthM":width,"camera":"top","state":viewer.get("canopy_view_state").duplicate(true),"selectedTreeCount":viewer.get("canopy_info").get("selectedTreeCount",0),"treeCount":viewer.get("canopy_info").get("treeCount",0),"atlasSpacingM":viewer.get("canopy_info").get("spacingM",0),"worldId":viewer.get("rendered_world_id")})
	viewer.call("_write_metrics")
	var file=FileAccess.open(output.path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));quit()
