extends SceneTree
var app:Node3D
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var im=root.get_texture().get_image();im.save_png("res://evidence/meso-material-"+name+".png");return im
func difference(a:Image,b:Image)->float:
	var total=0.0;var count=0
	for y in range(100,700,5):
		for x in range(520,1180,5):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);total+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return total/count
func run()->void:
	root.size=Vector2i(1280,800);DirAccess.make_dir_recursive_absolute("res://evidence")
	app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
	app.material.set_shader_parameter("water_time_override",0.0)
	for scene in [[10,"open","grass"],[6,"sand","sand"],[4,"bare","rock"]]:
		app.load_tile(scene[0]);var meta:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")));var point=meta.examples[scene[1]]
		app.focus=Vector3(point[0],0,point[1]);app.view_width=1800;app.update_camera()
		app.material.set_shader_parameter("meso_material_enabled",false);var plain=await capture(scene[2]+"-without")
		app.material.set_shader_parameter("meso_material_enabled",true);var meso=await capture(scene[2]+"-with")
		metrics[scene[2]+"Difference"]=difference(plain,meso)
		check(metrics[scene[2]+"Difference"]>.001,"Intermediate material is visible on "+scene[2])
		var stable=await capture(scene[2]+"-stable");check(difference(meso,stable)==0,"Material is temporally stable on "+scene[2])
	# Read GPU slopes/Jacobian independently, before PBR/lighting/trees.
	var probe=SubViewport.new();probe.size=Vector2i(32,16);probe.use_hdr_2d=true;probe.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(probe)
	var rect=ColorRect.new();rect.size=probe.size;probe.add_child(rect);var m=ShaderMaterial.new();m.shader=load("res://tests/meso_material_probe.gdshader");rect.material=m
	app.view_width=1800;app.focus=Vector3(21000,0,20000);app.update_camera()
	for key in ["terrain_grid_warp","terrain_grid_scale","terrain_grid_domain","terrain_grid_focus","terrain_detail_seed","meso_context","meso_profiles","meso_structure","meso_ready","ground_weights","ground_structure"]:m.set_shader_parameter(key,app.material.get_shader_parameter(key))
	m.set_shader_parameter("terrain_detail_amount",1.0)
	var max_error=0.0
	for footprint in [.1,.75,2.0,8.0]:
		m.set_shader_parameter("probe_footprint",footprint);await process_frame;await process_frame;await RenderingServer.frame_post_draw
		var im=probe.get_texture().get_image()
		for y in range(0,16,3):
			for x in range(0,32,3):
				var world=Vector2(21000+x*.75,20000+y*.75);var target=app.meso.sample_field(world,Vector4(footprint/sqrt(2)*2/3,footprint/sqrt(2)*2/3,0,0));var c=im.get_pixel(x,y)
				max_error=maxf(max_error,maxf(absf(c.r*2-1-target.y),absf(c.g*2-1-target.z)))
	metrics.normalTransferError=max_error;check(max_error<.004,"Pixel-filtered physical slopes are reconstructed independently of mesh LOD")
	var jac_error=0.0
	m.set_shader_parameter("probe_footprint",.1)
	for mode in [1,2]:
		m.set_shader_parameter("probe_mode",mode);await process_frame;await process_frame;await RenderingServer.frame_post_draw
		var im=probe.get_texture().get_image()
		for y in range(0,16,3):
			for x in range(0,32,3):
				var world=Vector2(21000+x*.75,20000+y*.75);var a=app.meso.noise_at(world,11,app.meso.seed+2179);var b=app.meso.noise_at(world,17,app.meso.seed+3253);var c=im.get_pixel(x,y)
				if mode==1:jac_error=maxf(jac_error,maxf(absf(c.r-.5-a.x*.28),maxf(absf(c.g-.5-b.x*.28),absf(c.b*2-1-a.y*.28))))
				else:jac_error=maxf(jac_error,maxf(absf(c.r-.5-a.z*.28),maxf(absf(c.g*2-1-b.z*.28),absf(c.b-.5-b.y*.28))))
	metrics.warpJacobianError=jac_error;check(jac_error<.004,"Warp and derivative maps agree with the same world coordinates")
	m.set_shader_parameter("probe_mode",3);m.set_shader_parameter("probe_step",.125)
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var fracture=probe.get_texture().get_image();var fracture_error=0.0;var depth=0.0
	for y in range(1,15):
		for x in range(1,31):
			var c=fracture.get_pixel(x,y);var gx=(fracture.get_pixel(x+1,y).r-fracture.get_pixel(x-1,y).r)/4/.25;var gz=(fracture.get_pixel(x,y+1).r-fracture.get_pixel(x,y-1).r)/4/.25
			fracture_error=maxf(fracture_error,maxf(absf(gx-(c.g-.5)*2),absf(gz-(c.b-.5)*2)));depth=maxf(depth,(.5-c.r)/4)
	metrics.fractureDerivativeError=fracture_error;metrics.fractureDepthMetres=depth
	check(fracture_error<.02 and depth>.001,"Oriented fracture normals derive from their actual blended height")
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures};var file=FileAccess.open("res://evidence/meso-material-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report))
	probe.queue_free();app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
