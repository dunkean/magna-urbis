extends SceneTree
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func run()->void:
	root.size=Vector2i(1280,800)
	var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame
	var arrays=app.terrain.mesh.surface_get_arrays(0)
	check(arrays[Mesh.ARRAY_VERTEX].size()==(app.mesh_cells+1)*(app.mesh_cells+1),"Rendered mesh retains full heightfield density")
	var indices=arrays[Mesh.ARRAY_INDEX]
	check(indices[0]==0 and indices[1]==1 and indices[2]==app.mesh_cells+1 and indices[3]==1 and indices[4]==app.mesh_cells+2 and indices[5]==app.mesh_cells+1,"Picking follows actual PlaneMesh triangle diagonal")
	var real_height=app.height_image
	var flat=Image.create(8,8,false,Image.FORMAT_RF);flat.fill(Color(100,0,0))
	app.height_image=flat;app.vertex_height_cache.clear();app.terrain_max_height=101
	app.focus=Vector3(20000,100,20000);app.update_camera()
	var centre=Vector2(640,400);var hit=app.pick_terrain(centre)
	check(hit!=null and hit.distance_to(Vector3(20000,100,20000))<.1,"Top cursor hits flat terrain at true height")
	check(app.pick_terrain(Vector2.ZERO)==null,"No altitude beyond tile")
	check(absf(app.ruler_metres_per_pixel()-app.view_width/1280.0)<.01,"Orthographic scale in real metres")
	app.toggle_mode();hit=app.pick_terrain(centre)
	check(hit!=null and hit.distance_to(Vector3(20000,100,20000))<.1,"Perspective centre hits terrain")
	var target=Vector3(23000,100,22000);var pixel=app.camera.unproject_position(target)
	hit=app.pick_terrain(pixel)
	check(hit!=null and hit.distance_to(target)<.2,"Perspective picking respects screen ray")
	var mpp=app.ruler_metres_per_pixel();app.view_width*=.5;app.update_camera()
	check(absf(app.ruler_metres_per_pixel()/mpp-.5)<.001,"Ruler follows zoom")
	app.height_image=real_height;app.vertex_height_cache.clear();app.terrain_max_height=12000;app.reset_view()
	for angle in [12,30,50,80]:
		app.elevation=deg_to_rad(angle);app.update_camera();hit=app.pick_terrain(centre)
		check(hit!=null,"Real relief hit at %d degrees"%angle)
		if hit!=null:
			check(app.camera.unproject_position(hit).distance_to(centre)<.3,"Real hit reprojects under cursor")
	app.elevation=deg_to_rad(50);app.update_camera()
	var started=Time.get_ticks_usec();var max_us=0
	for j in 8:
		for i in 8:
			var tick=Time.get_ticks_usec();app.pick_terrain(Vector2(400+i*65,200+j*55));max_us=maxi(max_us,Time.get_ticks_usec()-tick)
	var timing={"queries":64,"meanMs":float(Time.get_ticks_usec()-started)/64000.0,"maxMs":float(max_us)/1000.0}
	app.set_process(false);app.update_survey(centre)
	check(app.cursor_altitude.visible and not app.cursor_altitude.text.is_empty(),"Altitude visible under cursor")
	await process_frame;await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute("res://evidence")
	root.get_texture().get_image().save_png("res://evidence/survey-altitude.png")
	var report={"failures":failures,"checks":"flat/real relief, top/perspective, off-tile, reprojected hits, scale zoom","picking":timing}
	DirAccess.make_dir_recursive_absolute("res://evidence")
	var file=FileAccess.open("res://evidence/survey-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
