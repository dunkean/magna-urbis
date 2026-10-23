extends SceneTree
var viewer:Node
var output:String
var report={"scope":"Real retained V8 source and candidate inventory unchanged; production whole-view canopy plus camera pans across former 480m query edges","frames":[]}
func _initialize():call_deferred("run")
func ready()->bool:return viewer.get("terrain")!=null and viewer.get("worker")==null and not bool(viewer.get("view_dirty")) and not bool(viewer.get("water_projection_busy")) and not bool(viewer.get("canopy_transition_busy"))
func settle()->bool:
	var start=Time.get_ticks_msec()
	while not ready() and Time.get_ticks_msec()-start<180000:await process_frame
	return ready()
func run():
	var args=OS.get_cmdline_user_args();output=args[args.find("--probe-dir")+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	if not await settle():quit(1);return
	for x in [19680.0,19840.0,20000.0,20160.0,20320.0]:
		viewer.set("focus",{"x":x,"y":20000.0});viewer.set("width_m",640.0);viewer.call("_update_camera");viewer.call("_begin_prepare")
		if not await settle():quit(1);return
		for i in 3:await process_frame
		var file=output.path_join("pan-%d"%x)
		await viewer.call("_capture",file+"-beauty.png")
		viewer.get("objects").visible=false
		viewer.get("terrain").get("material").call("set_shader_param","diagnostic",20)
		for i in 3:await process_frame
		await viewer.call("_capture",file+"-target.png")
		viewer.get("objects").visible=true;viewer.get("terrain").get("material").call("set_shader_param","diagnostic",0)
		report.frames.append({"focusX":x,"widthM":640,"state":viewer.get("canopy_view_state").duplicate(true),"worldId":viewer.get("rendered_world_id"),"path":file})
	viewer.set("oblique",true);viewer.set("focus",{"x":20000.0,"y":20000.0});viewer.call("_update_camera");viewer.call("_begin_prepare")
	if not await settle():quit(1);return
	for i in 3:await process_frame
	await viewer.call("_capture",output.path_join("640m-oblique.png"))
	report["oblique"]=viewer.get("canopy_view_state").duplicate(true)
	var file=FileAccess.open(output.path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));quit()
