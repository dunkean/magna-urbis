extends SceneTree
var report:Dictionary={}
func _initialize()->void:call_deferred("run")
func percentile(values:Array[float],q:float)->float:
	values.sort();return values[clampi(int(floor((values.size()-1)*q)),0,values.size()-1)]
func run()->void:
	root.size=Vector2i(1280,800);DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	RenderingServer.viewport_set_measure_render_time(root.get_viewport_rid(),true)
	report={"engine":Engine.get_version_info().string,"resolution":[1280,800],"gpu":RenderingServer.get_video_adapter_name(),"warmupFrames":30,"sampleFrames":45,"runs":[],"order":"baseline / mesoscale / mesoscale / baseline"}
	for variant in ["baseline","mesoscale","mesoscale","baseline"]:
		var path="res://evidence/meso-baseline/tile_viewer.gd" if variant=="baseline" else "res://tile_viewer.gd"
		if not FileAccess.file_exists(path):push_error("Baseline snapshot missing");quit(1);return
		var app=load(path).new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
		app.material.set_shader_parameter("water_time_override",0.0)
		for child in app.get_children():
			if child is CanvasLayer:child.visible=false
		var results:Array=[]
		for scene in [[10,"open","grass"],[6,"sand","sand"],[4,"bare","rock"],[4,"forest","forest"]]:
			app.load_tile(scene[0]);var meta:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")));var point=meta.examples[scene[1]]
			for width in ([1800.0] if scene[2]=="forest" else [65000.0,1800.0,160.0]):
				app.focus=Vector3(20000,0,20000) if width>40000 else Vector3(point[0],0,point[1]);app.view_width=width;app.update_camera()
				for frame in 30:await process_frame
				var gpu:Array[float]=[];var cpu:Array[float]=[]
				for frame in 45:
					await process_frame;await RenderingServer.frame_post_draw
					gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(root.get_viewport_rid()));cpu.append(RenderingServer.viewport_get_measured_render_time_cpu(root.get_viewport_rid()))
				var result={"scene":scene[2],"width":width,"focus":[app.focus.x,app.focus.z],"medianGpuMs":percentile(gpu,.5),"p95GpuMs":percentile(gpu,.95),"medianCpuMs":percentile(cpu,.5),"palette":app.ground_library.palette_seed,"paletteHash":JSON.stringify(app.ground_library.selected).sha256_text(),"focusSpacing":app.grid_spacing(app.focus.x,0)}
				results.append(result)
				root.get_texture().get_image().save_png("res://evidence/meso-bench-"+variant+"-"+scene[2]+"-"+str(int(width))+".png")
				print(JSON.stringify({"variant":variant,"result":result}))
		report.runs.append({"variant":variant,"results":results});app.queue_free();for frame in 6:await process_frame
	var file=FileAccess.open("res://evidence/meso-benchmark.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print("MESO BENCHMARK COMPLETE");quit()
