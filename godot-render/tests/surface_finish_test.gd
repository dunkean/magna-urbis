extends SceneTree
var app:Node3D
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var image=root.get_texture().get_image();image.save_png("res://evidence/surface-finish-"+name+".png");return image
func difference(a:Image,b:Image)->float:
	var total=0.0;var count=0
	for y in range(100,700,4):
		for x in range(520,1180,4):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y)
			total+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return total/count
func run()->void:
	root.size=Vector2i(1280,800);DirAccess.make_dir_recursive_absolute("res://evidence")
	app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false)
	app.select_ground_view(1);app.material.set_shader_parameter("water_time_override",0.0)
	check(app.original_cover_meta.profile=="original-render3d","Original Render3D profile")
	check(app.original_cover_meta.sourceHead=="dff14f387a6d1edc89d93737f861ee91e022a5aa","Original pinned source, not V2")
	var forest:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("original-forest.json")))
	check(forest.seed==1905266606 and forest.settings.density==1 and forest.settings.clearings==.45,"Historical forest seed and settings")
	var placement:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")))
	var forest_point:Vector2=Vector2(placement.examples.forest[0],placement.examples.forest[1])
	app.focus=Vector3(forest_point.x,0,forest_point.y);app.view_width=160;app.update_camera()
	var covered=await capture("original-forest")
	var stable=await capture("original-forest-stable")
	check(difference(covered,stable)==0,"Original crowns remain temporally stable")
	app.material.set_shader_parameter("original_cover_enabled",false)
	var no_original=await capture("without-original-cover")
	metrics.originalForestDifference=difference(covered,no_original)
	check(metrics.originalForestDifference>.01,"Original forest visibly masks the substrate")
	app.material.set_shader_parameter("original_cover_enabled",true)
	app.select_ground_view(3);app.material.set_shader_parameter("ground_auto_snow",false)
	app.focus=Vector3(21000,0,20000)
	# Isolate real displacement/vertex lighting; the intermediate material can
	# otherwise preserve the same physical normal when geometry LOD changes.
	app.material.set_shader_parameter("meso_material_enabled",false)
	app.view_width=45;app.update_camera()
	var detailed=await capture("relief-detail")
	check(app.grid_warp>5,"Zoom concentrates real mesh vertices")
	metrics.centreCellMetres=app.grid_coordinate(.5+1.0/app.mesh_cells,0)-app.grid_coordinate(.5,0)
	check(metrics.centreCellMetres<2,"Local mesh resolves the 9.5 m octave")
	var maximum=0.0;var values:Array[float]=[]
	for j in 20:values.append(app.terrain_detail_height(21000+j*.7,20000));maximum=maxf(maximum,absf(values[-1]))
	metrics.detailMaxMetres=maximum
	check(maximum>.02 and maximum<=app.meso.MAX_HEIGHT,"Bounded additional geometric relief")
	var canonical:Array[float]=[]
	for j in 20:canonical.append(app.meso.sample_field(Vector2(21000+j*.7,20000)).x)
	app.view_width=60;app.focus.x+=30;app.update_camera()
	for j in 20:check(is_equal_approx(canonical[j],app.meso.sample_field(Vector2(21000+j*.7,20000)).x),"Underlying detail stays fixed while mesh LOD morphs")
	app.focus.x-=30;app.view_width=45;app.update_camera()
	var hit=app.pick_terrain(Vector2(640,400))
	check(hit!=null and app.camera.unproject_position(hit).distance_to(Vector2(640,400))<.2,"Picking follows refined displaced triangles")
	app.set_detail_enabled(false)
	var smooth=await capture("relief-without-detail")
	metrics.reliefDifference=difference(detailed,smooth)
	check(metrics.reliefDifference>.001,"Extra relief is visible at close zoom")
	app.set_detail_enabled(true)
	app.material.set_shader_parameter("meso_material_enabled",true)
	app.load_tile(6);app.select_ground_view(1)
	var sea_point=Vector2.ZERO
	for y in range(250,1100,80):
		for x in range(250,1100,80):
			if app.ground_water_image.get_pixel(x,y).b>.99:sea_point=Vector2(x+.5,y+.5)/app.ground_water_image.get_width()*40000;break
		if sea_point!=Vector2.ZERO:break
	check(sea_point!=Vector2.ZERO,"Coastal fixture contains open water")
	app.focus=Vector3(sea_point.x,0,sea_point.y);app.view_width=80;app.update_camera()
	check(app.terrain_detail_height(sea_point.x,sea_point.y)==0,"Detail never displaces permanent water")
	var waves=await capture("water-ripples")
	app.material.set_shader_parameter("water_textured",false)
	var flat=await capture("water-flat")
	metrics.waterTextureDifference=difference(waves,flat)
	check(metrics.waterTextureDifference>.002,"Procedural textures visibly change water")
	app.material.set_shader_parameter("water_textured",true);app.material.set_shader_parameter("water_time_override",20.0)
	var moved=await capture("water-advected")
	metrics.waterAnimationDifference=difference(waves,moved)
	check(metrics.waterAnimationDifference>.0005,"Water texture advects")
	app.select_ground_view(0)
	check(app.detail_amount==0 and app.material.get_shader_parameter("terrain_detail_amount")==0,"Returning to Render immediately restores the undetailed source surface")
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures}
	var file=FileAccess.open("res://evidence/surface-finish-gpu-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
