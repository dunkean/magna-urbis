extends SceneTree
var app:Node3D
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var image=root.get_texture().get_image();image.save_png("res://evidence/ground-quality-"+name+".png");return image
func difference(a:Image,b:Image)->float:
	var total=0.0;var count=0
	for y in range(100,700,8):
		for x in range(520,1180,8):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y)
			total+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return total/count
func constant_texture(value:Color,format:int=Image.FORMAT_RGBA8)->ImageTexture:
	var image=Image.create(16,16,false,format);image.fill(value);return ImageTexture.create_from_image(image)
func run()->void:
	root.size=Vector2i(1280,800);DirAccess.make_dir_recursive_absolute("res://evidence")
	app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame
	app.set_process(false);app.select_ground_view(1)
	app.material.set_shader_parameter("water_time_override",0.0)
	check(app.surface_meta.get("version")==2 and app.surface_meta.get("coverSlots")==3,"Separate support and surface metadata")
	check(app.sun.shadow_enabled,"Terrain casts directional shadows")
	var palette=app.ground_library.palette_texture.get_image()
	var darkest=1.0;var brightest=0.0
	for i in range(24,44):
		var mean=palette.get_pixel(i,1);var luminance=mean.r*.2126+mean.g*.7152+mean.b*.0722
		darkest=minf(darkest,luminance);brightest=maxf(brightest,luminance)
		check(mean.is_equal_approx(palette.get_pixel(24+int((i-24)/4)*4,1)),"Rock profile means remain equal within a parent")
	metrics.rockParentMeanSpreadLinear=brightest-darkest
	check(brightest-darkest<.06,"Bare-rock palette does not reveal large geological bands through source means")
	var snowy=await capture("render-snow-top")
	app.material.set_shader_parameter("ground_auto_snow",false)
	var cover=await capture("surface-top")
	metrics.renderSnowDifference=difference(snowy,cover)
	check(metrics.renderSnowDifference>.02,"Canonical Render snow remains visible by default")
	# Inspect cover on a productive temperate terrain, not a mostly barren
	# freezing range. The snow counterfactual above stays on the cold terrain.
	app.load_tile(4);cover=await capture("surface-top")
	app.select_ground_view(3);var support=await capture("support-top")
	metrics.surfaceDifference=difference(cover,support)
	check(metrics.surfaceDifference>.001,"Surface cover visibly overlays mineral support")
	app.select_ground_view(1);app.material.set_shader_parameter("ground_auto_snow",false)
	app.material.set_shader_parameter("ground_macro_reference",false)
	var shadows=await capture("shadows-on")
	app.sun.shadow_enabled=false;var unshadowed=await capture("shadows-off")
	metrics.castShadowDifference=difference(shadows,unshadowed)
	check(metrics.castShadowDifference>.0005,"Cast shadows visibly affect the terrain")
	app.sun.shadow_enabled=true;app.toggle_mode();await capture("surface-oblique")
	app.toggle_mode()
	# A flat, single-material counterfactual isolates source repetition from
	# terrain, hydrology, masks, shadows and UI. Eight asset periods span width.
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	app.sun.shadow_enabled=false;app.material.set_shader_parameter("ground_auto_snow",false)
	app.material.set_shader_parameter("original_cover_enabled",false)
	app.material.set_shader_parameter("terrain_detail_enabled",false)
	app.height_image=Image.create(16,16,false,Image.FORMAT_RF);app.height_image.fill(Color(100,0,0))
	app.material.set_shader_parameter("height_map",ImageTexture.create_from_image(app.height_image));app.material.set_shader_parameter("height_n",16.0)
	app.material.set_shader_parameter("ground_indices",constant_texture(Color(21.0/255,0,0,0)))
	app.material.set_shader_parameter("ground_weights",constant_texture(Color(1,0,0,0)))
	for name in ["ground_indices_extra","ground_weights_extra","cover_indices","cover_weights","ground_water","river_footprint"]:app.material.set_shader_parameter(name,constant_texture(Color(0,0,0,0)))
	app.material.set_shader_parameter("ground_attributes",constant_texture(Color(0,.7,0,0)))
	app.material.set_shader_parameter("ground_structure",constant_texture(Color(.5,.5,1,1)))
	var scale=float(app.ground_library.selected[21].scale)
	app.focus=Vector3(20000,100,20000);app.view_width=scale*8;app.update_camera()
	app.material.set_shader_parameter("ground_stochastic",false);await capture("periodic-reference")
	app.material.set_shader_parameter("ground_stochastic",true);var hex=await capture("stochastic")
	var stable=await capture("stochastic-stable")
	check(hex.get_data()==stable.get_data(),"Stochastic patches are temporally stable")
	metrics.sourcePeriodPixels=160;metrics.sourceAsset=app.ground_library.selected[21].asset
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures}
	var file=FileAccess.open("res://evidence/ground-quality-gpu-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
