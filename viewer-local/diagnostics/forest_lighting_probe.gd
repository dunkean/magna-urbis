extends SceneTree
var viewer:Node
func _initialize():call_deferred("run")
func ready()->bool:return viewer.get("terrain")!=null and viewer.get("worker")==null and not bool(viewer.get("view_dirty")) and not bool(viewer.get("water_projection_busy"))
func run():
	var args=OS.get_cmdline_user_args();var out_index=args.find("--page-dir");var folder=args[out_index+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	var report={"scope":"Frozen retained source, independent optical appearance isolation only; no ground/low/source/inventory changes","views":[]}
	for width in [2560.0,640.0]:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		var start=Time.get_ticks_msec()
		while not ready() and Time.get_ticks_msec()-start<180000:await process_frame
		if not ready():push_error("Lighting diagnostic did not settle");quit(1);return
		var terrain_material=viewer.get("terrain").get("material");var original_counts=viewer.get("canopy_textures").counts
		var zero=Image.create(int(viewer.get("canopy_info").gridSize.x),int(viewer.get("canopy_info").gridSize.y),false,Image.FORMAT_RGBAF);zero.fill(Color(0,0,0,0));var zero_counts=ImageTexture.create_from_image(zero)
		for state in [{"name":"baseline","shadows":true,"instances":true},{"name":"shadows-off","shadows":false,"instances":true},{"name":"instances-off","shadows":true,"instances":false},{"name":"shadows-and-instances-off","shadows":false,"instances":false}]:
			viewer.get("sun").shadow_enabled=state.shadows
			terrain_material.call("set_shader_param","canopy_shadow_transmittance",Vector3(.25,.34,.50) if state.shadows else Vector3.ONE)
			terrain_material.call("set_shader_param","canopy_counts",original_counts if state.instances else zero_counts)
			for child in viewer.get("objects").get_children():
				if child.get_meta("surfaceLayer","")=="trees":child.visible=state.instances
			for i in 5:await process_frame
			var path=str(folder).path_join("%dm-%s.png"%[width,state.name]);await viewer.call("_capture",path)
			report.views.append({"widthM":width,"state":state,"path":path,"worldId":viewer.get("rendered_world_id"),"canopy":viewer.get("canopy_info").get("version"),"sourceActualAtFocus":viewer.get("rendered_source")})
		viewer.get("sun").shadow_enabled=true;terrain_material.call("set_shader_param","canopy_counts",original_counts);terrain_material.call("set_shader_param","canopy_shadow_transmittance",Vector3(.25,.34,.50));viewer.call("set_layer_visibility",true,true,true)
	var path=ProjectSettings.globalize_path(str(folder).path_join("lighting-report.json"));var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));quit()
