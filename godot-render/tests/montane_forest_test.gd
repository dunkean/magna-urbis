extends SceneTree
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var im=root.get_texture().get_image();im.save_png("res://evidence/montane-"+name+".png");return im
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	app.material.set_shader_parameter("water_time_override",0.0)
	for index in app.catalog.tiles.size():
		if app.catalog.tiles[index].id=="hills--cold":app.load_tile(index);break
	var meta:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")));var p=meta.examples.montane
	check(meta.montane.meanCanopyTile>0 and meta.montane.meanCanopyTile<.025,"Cold woodland is present but very sparse")
	app.focus=Vector3(p[0],0,p[1]);app.view_width=512;app.update_camera();await capture("cold-hills-near")
	app.material.set_shader_parameter("forest_coverage_probe",true)
	var cover=0.0;var pixels=0
	for offset in [Vector2.ZERO,Vector2(400,0),Vector2(0,350),Vector2(-400,-350)]:
		app.focus=Vector3(p[0]+offset.x,0,p[1]+offset.y);app.update_camera();var im=await capture("coverage-"+str(pixels))
		for y in range(20,780,2):
			for x in range(20,1260,2):cover+=im.get_pixel(x,y).r;pixels+=1
	metrics.rasterMeanCanopy=cover/pixels
	check(metrics.rasterMeanCanopy>.002 and metrics.rasterMeanCanopy<.09,"Original crown raster resolves a modest amount of supplemental conifers")
	app.material.set_shader_parameter("forest_coverage_probe",false)
	# A counterfactual keeps the exact same crowns/shadows but removes the
	# complement guide. At fully resolved zoom only crown pixels may recolour.
	app.focus=Vector3(p[0],0,p[1]);app.view_width=256;app.update_camera();var near=await capture("near-guide")
	app.material.set_shader_parameter("forest_coverage_probe",true);var mask=await capture("near-mask");app.material.set_shader_parameter("forest_coverage_probe",false)
	var empty=Image.create(1,1,false,Image.FORMAT_RGBA8);empty.fill(Color(0,0,0,0));app.material.set_shader_parameter("montane_forest",ImageTexture.create_from_image(empty));var control=await capture("near-guide-control")
	var open_error=0.0;var open_count=0
	for y in range(20,780,2):
		for x in range(20,1260,2):
			if mask.get_pixel(x,y).r>0:continue
			var a=near.get_pixel(x,y);var b=control.get_pixel(x,y);open_error+=(absf(a.r-b.r)+absf(a.g-b.g)+absf(a.b-b.b))/3;open_count+=1
	metrics.nearOpenGroundGuideError=open_error/maxi(open_count,1)
	check(metrics.nearOpenGroundGuideError<.00002,"Expected canopy does not tint the resolved ground between crowns")
	var field=app.load_local_png(app.tile_dir.path_join("montane-forest.png"));field.generate_mipmaps();app.material.set_shader_parameter("montane_forest",ImageTexture.create_from_image(field))
	var first=near
	for i in range(33):
		app.view_width=exp(lerpf(log(256.0),log(16000.0),float(i)/32));app.update_camera();await process_frame
	app.view_width=256;app.update_camera();var returned=await capture("near-returned");check(first.get_data()==returned.get_data(),"Complement zoom roundtrip reproduces the complete image")
	app.view_width=65000;app.update_camera();var far=await capture("far-guide")
	app.material.set_shader_parameter("montane_forest",ImageTexture.create_from_image(empty));var far_control=await capture("far-control")
	var far_error=0.0
	for y in range(100,700,4):
		for x in range(100,1180,4):
			var a=far.get_pixel(x,y);var b=far_control.get_pixel(x,y);far_error+=(absf(a.r-b.r)+absf(a.g-b.g)+absf(a.b-b.b))/3
	metrics.farMeanGuideContribution=far_error/(150*270)
	check(metrics.farMeanGuideContribution>0 and metrics.farMeanGuideContribution<.01,"Far reference contains the weak expected supplemental canopy")
	app.material.set_shader_parameter("montane_forest",ImageTexture.create_from_image(field))
	app.focus=Vector3(p[0],0,p[1]);app.top_view=false;app.elevation=.8;app.yaw=.4;app.view_width=1000;app.update_camera();await capture("cold-hills-oblique")
	for index in app.catalog.tiles.size():
		if app.catalog.tiles[index].id=="mountains--cold":app.load_tile(index);break
	meta=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")))
	check(meta.montane.meanCanopyTile==0,"Snow-dominant cold mountains are not artificially planted")
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures};var f=FileAccess.open("res://evidence/montane-report.json",FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
