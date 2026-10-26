extends SceneTree
var viewer:Node
func _initialize():call_deferred("run")
func ready()->bool:return viewer.get("terrain")!=null and viewer.get("worker")==null and not bool(viewer.get("view_dirty")) and not bool(viewer.get("water_projection_busy"))
func run():
	var args=OS.get_cmdline_user_args();var out_index=args.find("--page-dir");var folder=args[out_index+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	var report={"scope":"Same retained V7 canonical480m candidate page; independent shadow-transmission versus shadow-model experiment, no source/ground/inventory changes","views":[]}
	var widths=[10000.0,2560.0,640.0]
	var wi=args.find("--page-widths")
	if wi>=0:
		widths=[]
		for value in str(args[wi+1]).split(","):widths.append(float(value))
	for width in widths:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		var start=Time.get_ticks_msec()
		while not ready() and Time.get_ticks_msec()-start<180000:await process_frame
		if not ready():push_error("Shadow policy diagnostic did not settle");quit(1);return
		var material=viewer.get("terrain").get("material")
		for state in [{"name":"residual-old","total":false,"transmission":Vector3(.25,.34,.50)},{"name":"residual-fit","total":false,"transmission":Vector3(.05,.14,.33)},{"name":"unified-old","total":true,"transmission":Vector3(.25,.34,.50)},{"name":"unified-fit","total":true,"transmission":Vector3(.05,.14,.33)}]:
			if args.has("--policy-compact") and state.name.ends_with("fit"):continue
			material.call("set_shader_param","canopy_shadow_use_total",state.total);material.call("set_shader_param","canopy_shadow_transmittance",state.transmission)
			for child in viewer.get("objects").get_children():
				if child.get_meta("surfaceLayer","")=="trees":child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if state.total else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			for i in 5:await process_frame
			var path=str(folder).path_join("%dm-%s.png"%[width,state.name]);await viewer.call("_capture",path)
			report.views.append({"widthM":width,"name":state.name,"canopyShadowTotal":state.total,"canopyAndTrunkNativeCastEnabled":not state.total,"transmission":[state.transmission.x,state.transmission.y,state.transmission.z],"path":path,"worldId":viewer.get("rendered_world_id"),"renderedSource":viewer.get("rendered_source")})
	var path=ProjectSettings.globalize_path(str(folder).path_join("shadow-policy-report.json"));var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));quit()
