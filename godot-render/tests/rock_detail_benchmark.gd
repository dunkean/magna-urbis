extends SceneTree
var report:Dictionary={}
func _initialize()->void:call_deferred("run")
func percentile(values:Array[float],q:float)->float:
	values.sort();return values[clampi(int(floor((values.size()-1)*q)),0,values.size()-1)]
func run()->void:
	root.size=Vector2i(1280,800);DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED);RenderingServer.viewport_set_measure_render_time(root.get_viewport_rid(),true)
	var cases=load("res://tests/rock_cases.gd");report={"baselineCommit":JSON.parse_string(FileAccess.get_file_as_string("res://evidence/meso-baseline/source.json")).commit,"gpu":RenderingServer.get_video_adapter_name(),"resolution":[1280,800],"warmupFrames":60,"sampleFrames":120,"order":"ABBA","runs":[]}
	for variant in ["baseline","current","current","baseline"]:
		var app=load("res://evidence/meso-baseline/tile_viewer.gd" if variant=="baseline" else "res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1);app.material.set_shader_parameter("water_time_override",0.0)
		for child in app.get_children():
			if child is CanvasLayer:child.visible=false
		var results:Array=[]
		for scene in ["steep","plane0","plane60","forest","grass","water","far"]:
			var tile=10 if scene=="grass" else 6 if scene=="water" else 4;app.load_tile(tile)
			var meta:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")));var key="forest" if scene=="forest" else "open" if scene=="grass" else "sand" if scene=="water" else "bare";var point=meta.examples[key]
			app.focus=Vector3(point[0],0,point[1]);app.top_view=true;app.elevation=PI/2;app.yaw=0
			# Restore flags after synthetic cases, whose fields are overwritten by load_tile.
			app.set_detail_enabled(true);app.material.set_shader_parameter("meso_material_enabled",true);app.material.set_shader_parameter("ground_auto_snow",true);app.material.set_shader_parameter("ground_macro_reference",true);app.material.set_shader_parameter("water_shore_ready",true);app.sun.shadow_enabled=true
			var slope_degrees=0.0
			if scene=="steep":
				var chosen=cases.steep_point(app);app.focus=Vector3(chosen.point.x,0,chosen.point.y);app.top_view=false;app.yaw=chosen.yaw;app.elevation=.55;slope_degrees=chosen.slopeDegrees
			if scene.begins_with("plane"):
				slope_degrees=60.0 if scene=="plane60" else 0.0;cases.plane(app,slope_degrees)
			if scene=="water":app.focus=Vector3(27901.048828125,0,28800.599609375)
			for width in ([40.0,160.0,1800.0] if scene=="steep" else [40.0,160.0] if scene.begins_with("plane") else [65000.0] if scene=="far" else [1800.0]):
				app.view_width=width;app.update_camera()
				for frame in 60:await process_frame
				var gpu:Array[float]=[]
				for frame in 120:await process_frame;await RenderingServer.frame_post_draw;gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(root.get_viewport_rid()))
				var result={"scene":scene,"width":width,"focus":[app.focus.x,app.focus.z],"slopeDegrees":slope_degrees,"medianGpuMs":percentile(gpu,.5),"p95GpuMs":percentile(gpu,.95),"paletteHash":JSON.stringify(app.ground_library.selected).sha256_text()};results.append(result);print(JSON.stringify({"variant":variant,"result":result}))
				var screenshot=root.get_texture().get_image()
				if scene.begins_with("plane"):
					var lit_pixels=0
					for y in range(80,720,8):
						for x in range(80,1200,8):
							if screenshot.get_pixel(x,y).r>.01:lit_pixels+=1
					if lit_pixels<1000:push_error("Synthetic PBR plane is missing/black");quit(1);return
				screenshot.save_png("res://evidence/rock-"+variant+"-"+scene+"-"+str(int(width))+".png")
		report.runs.append({"variant":variant,"results":results});app.queue_free();for frame in 6:await process_frame
	var file=FileAccess.open("res://evidence/rock-benchmark.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print("ROCK BENCHMARK COMPLETE");quit()
