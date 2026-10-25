extends SceneTree
var app:Node3D
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var im=root.get_texture().get_image();im.save_png("res://evidence/cover-policy-"+name+".png");return im
func difference(a:Image,b:Image)->float:
	var total=0.0;var count=0
	for y in range(100,700,4):
		for x in range(520,1180,4):
			var a0=a.get_pixel(x,y);var b0=b.get_pixel(x,y)
			total+=(absf(a0.r-b0.r)+absf(a0.g-b0.g)+absf(a0.b-b0.b))/3;count+=1
	return total/count
func metadata()->Dictionary:return JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")))
func visit(key:String,width:float)->void:
	var p=metadata().examples[key];app.focus=Vector3(p[0],0,p[1]);app.view_width=width;app.update_camera()
func run()->void:
	root.size=Vector2i(1280,800);DirAccess.make_dir_recursive_absolute("res://evidence")
	app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false)
	app.material.set_shader_parameter("water_time_override",0.0)
	app.load_tile(10);app.reset_view();app.select_ground_view(0)
	var reference=await capture("render-far")
	app.select_ground_view(1);var textured=await capture("textured-far")
	metrics.farReferenceDifference=difference(reference,textured)
	check(metrics.farReferenceDifference<.025,"Far textured view retains Render colours except exposed rock")
	app.material.set_shader_parameter("ground_auto_snow",false)
	visit("open",80)
	var open=await capture("open-grass-pbr")
	app.material.set_shader_parameter("original_cover_enabled",false)
	var no_trees=await capture("open-without-tree-model")
	metrics.openTreeDifference=difference(open,no_trees)
	check(metrics.openTreeDifference<.0001,"Open grassland has no canopy objects")
	app.material.set_shader_parameter("original_cover_enabled",true)
	# Source photographs remain active in the open surface, including normals.
	app.material.set_shader_parameter("ground_stochastic",false)
	var periodic=await capture("open-periodic")
	app.material.set_shader_parameter("ground_stochastic",true)
	metrics.openTextureDifference=difference(open,periodic)
	check(metrics.openTextureDifference>.0005,"Open ground keeps visible PBR texture detail")
	app.load_tile(4);visit("bare",40)
	var bare=await capture("exposed-rock")
	app.select_ground_view(3);var support=await capture("exposed-support")
	metrics.bareCoverDifference=difference(bare,support)
	check(metrics.bareCoverDifference<.002,"Outcrop retains its mineral textures instead of a blanket cover")
	app.select_ground_view(1);visit("forest",160)
	var forest=await capture("forest")
	app.material.set_shader_parameter("original_cover_enabled",false)
	var floor_only=await capture("forest-floor-pbr")
	metrics.forestCrownDifference=difference(forest,floor_only)
	check(metrics.forestCrownDifference>.01,"Historical crowns remain visible inside forests")
	app.material.set_shader_parameter("original_cover_enabled",true)
	app.load_tile(6);visit("sand",100)
	var desert=await capture("desert-sand-pbr")
	var policy:Dictionary=metadata();check(policy.forestAreaFraction==0,"Arid biome contains no forest objects")
	check(app.material.get_shader_parameter("uHasForestBank")==0,"Gallery trees cannot bypass the forest gate")
	app.material.set_shader_parameter("original_cover_enabled",false)
	var desert_without=await capture("desert-without-tree-model")
	metrics.desertTreeDifference=difference(desert,desert_without)
	check(metrics.desertTreeDifference==0,"Desert plants are ground textures, not green crowns")
	app.material.set_shader_parameter("original_cover_enabled",true)
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures}
	var file=FileAccess.open("res://evidence/cover-policy-gpu-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
