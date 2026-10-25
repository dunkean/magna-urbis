extends SceneTree
func _initialize()->void:call_deferred("run")
func run()->void:
	root.size=Vector2i(1280,800);var results:Array=[]
	for variant in ["baseline","mesoscale"]:
		var app=load("res://evidence/meso-baseline/tile_viewer.gd" if variant=="baseline" else "res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
		for width in [1800.0,160.0]:
			for top in [true,false]:
				app.top_view=top;app.yaw=.4 if not top else 0.0;app.elevation=.8 if not top else PI/2;app.focus=Vector3(21000,0,20000);app.view_width=width;app.update_camera()
				var times:Array[float]=[];var hits=0
				for point in [Vector2(640,400),Vector2(500,330),Vector2(780,390),Vector2(900,500),Vector2(600,500)]:
					app.vertex_height_cache.clear();var start=Time.get_ticks_usec();var hit=app.pick_terrain(point);times.append((Time.get_ticks_usec()-start)/1000.0)
					if hit!=null:hits+=1
				times.sort();results.append({"renderer":variant,"width":width,"top":top,"coldMedianMs":times[2],"coldMaxMs":times[-1],"hits":hits})
		app.queue_free();await process_frame
	var file=FileAccess.open("res://evidence/meso-picking-benchmark.json",FileAccess.WRITE);file.store_string(JSON.stringify(results,"  "));print(JSON.stringify(results));quit()
