extends SceneTree
var app:Node3D
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var image=root.get_texture().get_image()
	image.save_png("res://evidence/ground-textures-"+name+".png")
	return image
func run()->void:
	root.size=Vector2i(1280,800);DirAccess.make_dir_recursive_absolute("res://evidence")
	app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame
	check(app.surface_meta.get("version")==2,"N1–N4 and separate surface metadata")
	check(app.tile_layers.size()==47,"Five water, 29 ground and 13 N1–N4/surface layers")
	var mesh=app.terrain.mesh.get_instance_id()
	app.select_ground_view(1);await process_frame
	check(app.ground_library.ready,"Local PBR arrays loaded: "+app.ground_library.error)
	check(app.ground_library.selected.size()==90,"One asset per type")
	check(app.material.get_shader_parameter("ground_view")==1,"Ground view enabled")
	var original_palette=JSON.stringify(app.ground_library.selected)
	var original_ids=app.ground_ids_image.get_data()
	var original_cover=app.cover_ids_image.get_data()
	await capture("top")
	app.view_width=160;app.focus=Vector3(21000,0,20000);app.update_camera()
	await capture("local")
	# A fully covered original canopy intentionally keeps its historical colour
	# and seed when PBR variants change. Verify rerolls on exposed support.
	app.select_ground_view(3);app.view_width=20;app.update_camera()
	var close_before=await capture("close-before")
	app.variants_button.pressed.emit();await process_frame
	check(JSON.stringify(app.ground_library.selected)!=original_palette,"Variant button changes global palette")
	check(app.ground_ids_image.get_data()==original_ids,"Variant button leaves classification fixed")
	check(app.cover_ids_image.get_data()==original_cover,"Variant button leaves upper surface fixed")
	var changed=await capture("close-after")
	var region=Rect2i(520,120,640,520)
	check(changed.get_region(region).get_data()!=close_before.get_region(region).get_data(),"Variant change is visible on terrain outside UI")
	app.select_ground_view(1)
	var selected=JSON.stringify(app.ground_library.selected)
	app.update_ground_surface()
	check(JSON.stringify(app.ground_library.selected)==selected,"Repeated resolution is stable")
	var single_index=86
	check(app.ground_library.selected[single_index].asset=="acg:Snow015","Single-candidate snow type keeps its asset")
	app.select_ground_state(1);check(app.material.get_shader_parameter("ground_state")==1,"Dry preset")
	check(app.ground_ids_image.get_data()!=original_ids,"Dry state changes admissible recipes")
	app.select_ground_state(2);await capture("wet-close")
	app.reset_view();app.toggle_mode();await capture("oblique")
	for state in range(3,12):
		app.select_ground_state(state);await process_frame
		check(app.material.get_shader_parameter("ground_state")==state,"N4 preset %d"%state)
	app.select_ground_state(3);await capture("snow-oblique")
	app.select_ground_state(0);app.select_ground_view(2);await capture("types")
	app.select_ground_view(1)
	var stable_pixels=app.ground_library.palette_texture.get_image().get_data()
	app.load_tile(6);app.randomize_ground_variants();app.load_tile(0)
	check(app.ground_library.palette_texture.get_image().get_data()==stable_pixels,"Other worlds' rerolls preserve this world's full palette and UV parameters")
	# Same world seed across the six climates preserves the resolved assets.
	app.load_tile(1);check(JSON.stringify(app.ground_library.selected)==selected,"Palette survives climate change")
	check(app.terrain.mesh.get_instance_id()==mesh,"Same physical terrain mesh")
	check(not app.ground_at(20000,20000).is_empty(),"Inspector identifies type and actual asset")
	app.select_ground_view(0);check(app.material.get_shader_parameter("ground_view")==0,"Original Render restored")
	var report={"status":"passed" if failures.is_empty() else "failed","types":app.ground_library.selected.size(),"assets":app.ground_library.assets.size(),"failures":failures}
	var file=FileAccess.open("res://evidence/ground-textures-gpu-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
