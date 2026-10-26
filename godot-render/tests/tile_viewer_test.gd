extends SceneTree
var app:Node3D
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func run()->void:
	root.size=Vector2i(1280,800)
	app=load("res://tile_viewer.gd").new();root.add_child(app)
	await process_frame
	check(app.current_index>=0,"Default tile loads")
	check(app.top_view and app.camera.projection==Camera3D.PROJECTION_ORTHOGONAL,"Starts orthographic")
	var mesh=app.terrain.mesh.get_instance_id();var focus=app.focus;var width=app.view_width
	app.toggle_mode()
	check(not app.top_view and app.camera.projection==Camera3D.PROJECTION_PERSPECTIVE,"Switches to perspective")
	check(app.focus.is_equal_approx(focus) and app.view_width==width,"Switch preserves focus and width")
	var wheel=InputEventMouseButton.new();wheel.button_index=MOUSE_BUTTON_WHEEL_UP;wheel.pressed=true;app._unhandled_input(wheel)
	check(app.view_width<width,"Wheel zoom")
	var down=InputEventMouseButton.new();down.button_index=MOUSE_BUTTON_RIGHT;down.pressed=true;app._unhandled_input(down)
	var motion=InputEventMouseMotion.new();motion.relative=Vector2(80,20);app._unhandled_input(motion)
	check(app.yaw!=0,"Mouse orbit")
	down.pressed=false;app._unhandled_input(down)
	check(not app.drag_orbit and not app.drag_pan,"Mouse release clears drag")
	app.pan(Vector2(30,20));check(not app.focus.is_equal_approx(focus),"Pan moves focus")
	var saved_yaw=app.yaw;var saved_elevation=app.elevation
	app.toggle_mode();check(app.top_view,"Returns to top")
	app.toggle_mode();check(app.yaw==saved_yaw and app.elevation==saved_elevation,"Restores last orbit")
	app.toggle_mode()
	app.selector.grab_focus()
	var tab=InputEventKey.new();tab.keycode=KEY_TAB;tab.pressed=true
	Input.parse_input_event(tab);await process_frame
	check(not app.top_view,"Tab switches while selector has focus")
	app.toggle_mode()
	app.family_filter.select(5);app.climate_filter.select(3);app.select_filtered(0)
	check(app.catalog.tiles[app.current_index].id=="coastal-valley--tropical","Relief/climate filters")
	app.load_tile(41);app.next_tile();check(app.current_index==0,"Next wraps to first")
	app.previous_tile();check(app.current_index==41,"Previous wraps to last")
	var kept_focus=Vector2(app.focus.x,app.focus.z);var unique:Dictionary={}
	for i in 42:
		app.load_tile(i)
		check(app.current_index==i,"Tile loads %d"%i)
		check(Vector2(app.focus.x,app.focus.z).is_equal_approx(kept_focus),"Tile keeps observation XY")
		check(app.terrain.mesh.get_instance_id()==mesh,"Same geometry in every mode/tile")
		var meta:Dictionary=app.catalog.tiles[i];unique[meta.heightSha256]=true
		var raw=FileAccess.get_file_as_bytes(app.catalog_dir.path_join(meta.file).get_base_dir().path_join(meta.height))
		var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(raw)
		check(hash.finish().hex_encode()==meta.heightSha256,"Heightfield hash %d"%i)
		var hydro:Dictionary=meta.get("hydrology",{})
		check(hydro.get("engine")=="vector" and hydro.get("balance",false),"Climate-balanced vector hydrology")
		check(hydro.get("rivers",0)>0,"Visible river network: "+meta.id)
		var dir=app.catalog_dir.path_join(meta.file).get_base_dir()
		var surface=FileAccess.get_file_as_bytes(dir.path_join(hydro.surface))
		var surface_hash=HashingContext.new();surface_hash.start(HashingContext.HASH_SHA256);surface_hash.update(surface)
		check(surface_hash.finish().hex_encode()==hydro.surfaceSha256,"Hydraulic surface hash")
		check(app.height_image.get_data()==surface,"Viewer uses the hydraulic surface")
		var svg=FileAccess.get_file_as_string(dir.path_join(hydro.svg))
		check(svg.contains("<path") and not svg.contains("<image"),"Water archive contains vector paths")
		var expected_layers:Array=hydro.layers.duplicate();expected_layers.append_array(meta.get("ground",{}).get("layers",[]))
		expected_layers.append_array(meta.get("groundSurface",{}).get("layers",[]))
		check(expected_layers.size()==47,"Five water, 29 ground and 13 N1–N4/surface layers")
		check(app.info_selector.item_count==expected_layers.size()+1,"All information layers plus none")
		for layer_index in range(1,expected_layers.size()+1):
			app.select_info_layer(layer_index)
			check(app.selected_info==expected_layers[layer_index-1].id,"Layer selection")
			check(not app.info_legend.text.is_empty(),"Layer legend")
			var texture=app.material.get_shader_parameter("info_image")
			check(texture.get_width()==int(meta.n),"Information layer aligned with native grid")
		app.select_info_layer(0)
		check(app.material.get_shader_parameter("info_opacity")==0.0,"None restores the Render map")
		check(meta.width==40000 and meta.n==1334,"40 km surface at decoder native definition")
		check(meta.neural.nativeDefinitionRetained and meta.neural.decoderNativeCell==30,"Native decoder output retained")
		check(meta.neural.stages==["coarse","base","decoder"],"Complete neural chain")
		check(meta.neural.evaluations.size()==3 and meta.neural.evaluations[0]>0 and meta.neural.evaluations[1]>0 and meta.neural.evaluations[2]>0,"All three stages actually evaluated")
		check(app.mesh_cells==int(meta.n),"Geometry keeps source density")
		var map_texture=app.material.get_shader_parameter("map_image")
		check(map_texture.get_width()==4096 and map_texture.get_height()==4096,"4K retained map")
		if meta.coasts!=0:check(meta.landFraction>.05 and meta.landFraction<.97,"Coastal tile has land and sea: "+meta.id)
		await process_frame
	check(unique.size()==42,"42 distinct heightfields")
	for family in app.catalog.families:
		var dry:Dictionary={};var wet:Dictionary={}
		for tile in app.catalog.tiles:
			if tile.id==family.id+"--arid":dry=tile.hydrology
			if tile.id==family.id+"--tropical":wet=tile.hydrology
		check(dry.rivers<wet.rivers and dry.riverKm<wet.riverKm,"Tropical network denser than arid: "+family.id)
	app.load_tile(4);app.reset_view()
	await process_frame;await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute("res://evidence")
	root.get_texture().get_image().save_png("res://evidence/top.png")
	app.toggle_mode();await process_frame;await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("res://evidence/oblique.png")
	app.select_info_layer(1);await process_frame;await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("res://evidence/hydrology-basins-oblique.png")
	app.load_tile(3);check(app.selected_info=="v-basins","Layer survives tile change")
	app.toggle_mode();app.select_info_layer(4);await process_frame;await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("res://evidence/hydrology-lakes-top.png")
	var report={"tiles":42,"distinctHeightfields":unique.size(),"failures":failures,"sameMesh":true,"projections":["orthographic","perspective"]}
	var file=FileAccess.open("res://evidence/test-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
