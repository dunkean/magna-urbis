extends SceneTree
var app:Node3D
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func configure_probe(m:ShaderMaterial)->void:
	for key in ["terrain_grid_warp","terrain_grid_scale","terrain_grid_domain","terrain_grid_focus","terrain_detail_seed","meso_context","meso_ready"]:m.set_shader_parameter(key,app.material.get_shader_parameter(key))
	m.set_shader_parameter("terrain_detail_amount",1.0)
func run()->void:
	root.size=Vector2i(1280,800);DirAccess.make_dir_recursive_absolute("res://evidence")
	app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	var probe=SubViewport.new();probe.size=Vector2i(48,16);probe.use_hdr_2d=true;probe.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(probe)
	var rect=ColorRect.new();rect.size=probe.size;probe.add_child(rect)
	var m=ShaderMaterial.new();m.shader=load("res://tests/meso_probe.gdshader");rect.material=m
	var max_height=0.0;var max_gradient=0.0;var derivative_error=0.0
	for width in [12000.0,4000.0,2000.0,500.0,45.0]:
		app.view_width=width;app.focus=Vector3(21007,0,20009);app.update_camera();configure_probe(m)
		for origin in [Vector2(21001.75,20003.25),Vector2(-63.5,-12.5),Vector2(39970,12007)]:
			m.set_shader_parameter("probe_filtered",origin.x>0 and origin.x<30000)
			m.set_shader_parameter("probe_origin",origin)
			await process_frame;await process_frame;await RenderingServer.frame_post_draw
			var im=probe.get_texture().get_image();metrics.probeImageFormat=im.get_format()
			for y in range(0,16,3):
				for x in range(0,48,3):
					var world=origin+Vector2(x,y)*.75;var filtered=origin.x>0 and origin.x<30000;var cpu=app.meso.sample_field(world,app.grid_density(world) if filtered else Vector4.ZERO);var c=im.get_pixel(x,y)
					max_height=maxf(max_height,absf((c.r*8-4)-cpu.x));max_gradient=maxf(max_gradient,maxf(absf(c.g*2-1-cpu.y),absf(c.b*2-1-cpu.z)))
					var left=app.meso.sample_field(world-Vector2(.03125,0),app.grid_density(world-Vector2(.03125,0)) if filtered else Vector4.ZERO).x
					var right=app.meso.sample_field(world+Vector2(.03125,0),app.grid_density(world+Vector2(.03125,0)) if filtered else Vector4.ZERO).x
					derivative_error=maxf(derivative_error,absf((right-left)/.0625-cpu.y))
	metrics.cpuGpuHeightErrorMetres=max_height;metrics.cpuGpuGradientError=max_gradient;metrics.fullDerivativeError=derivative_error
	check(max_height<.01,"Continuous field height agrees with GPU readback")
	check(max_gradient<.004,"Full field gradients agree with GPU")
	check(derivative_error<.006,"Gradients include amplitude and mesh-filter derivatives")
	app.material.set_shader_parameter("terrain_height_probe",true)
	var triangle_error=0.0;var count=0
	for width in [2000.0,500.0,45.0]:
		app.view_width=width;app.focus=Vector3(801,0,38900) if width==500 else Vector3(21007,0,20009);app.update_camera()
		for oblique in [false,true]:
			app.top_view=not oblique;app.yaw=.4 if oblique else 0.0;app.elevation=.9 if oblique else PI/2;app.update_camera()
			await process_frame;await process_frame;await RenderingServer.frame_post_draw
			var im=root.get_texture().get_image()
			for pixel in [Vector2i(601,331),Vector2i(640,400),Vector2i(723,455),Vector2i(909,500)]:
				var hit=app.pick_terrain(Vector2(pixel)+Vector2(.5,.5));var c=im.get_pixelv(pixel)
				var reference=app.pick_terrain(Vector2(pixel)+Vector2(.5,.5),false)
				check((hit==null and reference==null) or (hit!=null and reference!=null and hit.distance_to(reference)<.01),"Conservative block acceleration preserves the first hit")
				if hit==null:
					var origin=app.camera.project_ray_origin(Vector2(pixel)+Vector2(.5,.5));var direction=app.camera.project_ray_normal(Vector2(pixel)+Vector2(.5,.5))
					var gx=app.grid_index(origin.x,0);var gz=app.grid_index(origin.z,1);var nearby:Variant=null
					for iz in range(gz-2,gz+3):
						for ix in range(gx-2,gx+3):
							if ix<0 or iz<0 or ix>=app.mesh_cells or iz>=app.mesh_cells:continue
							var a=app.mesh_vertex(ix,iz);var b=app.mesh_vertex(ix+1,iz);var cc=app.mesh_vertex(ix,iz+1);var d=app.mesh_vertex(ix+1,iz+1)
							var q=Geometry3D.ray_intersects_triangle(origin,direction,a,b,cc)
							if q==null:q=Geometry3D.ray_intersects_triangle(origin,direction,b,d,cc)
							if q!=null:nearby={"point":q,"cell":[ix,iz],"bounds":[a,b,cc,d]}
					print(JSON.stringify({"miss":pixel,"width":width,"oblique":oblique,"gpuPixel":c,"origin":origin,"direction":direction,"grid":[gx,gz],"nearby":nearby}));continue
				var height=(c.r+c.g/255.0+c.b/65025.0)*8192-32
				triangle_error=maxf(triangle_error,absf(hit.y-height));count+=1
	metrics.renderedTriangleHeightErrorMetres=triangle_error;metrics.triangleSamples=count
	check(count==24 and triangle_error<.04,"Picking matches GPU triangles between vertices, top and perspective")
	app.set_detail_enabled(false)
	check(app.terrain_detail_height(21007,20009)==0,"CPU/GPU disable state is shared")
	app.set_detail_enabled(true)
	# GPU zero on a real lake, a thin vector headwater, and their guarded margin.
	app.material.set_shader_parameter("terrain_height_probe",false)
	configure_probe(m);m.set_shader_parameter("probe_filtered",false);m.set_shader_parameter("probe_step",0.0)
	var lake=Vector2.ZERO
	for y in range(0,1334,11):
		for x in range(0,1334,11):
			if app.ground_water_image.get_pixel(x,y).g>.99:lake=Vector2(x+.5,y+.5)/1334.0*40000;break
		if lake!=Vector2.ZERO:break
	var water_meta:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("surface-river-footprint.json")))
	var source=water_meta.sources[0];var river_point=Vector2(source.x,source.y)
	var wet_points=[lake,river_point]
	for point in wet_points:
		m.set_shader_parameter("probe_origin",point);await process_frame;await process_frame;await RenderingServer.frame_post_draw
		var c=probe.get_texture().get_image().get_pixel(0,0)
		check(absf(c.r*8-4)<.0001 and absf(c.g*2-1)<.0001 and absf(c.b*2-1)<.0001,"GPU residual and slope are zero on protected water")
	var bank=lake
	for j in range(1,120):
		bank=lake+Vector2(j*30,0)
		if app.meso.context_at(bank)[0].x>.01:break
	m.set_shader_parameter("probe_origin",bank);await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var bank_gpu=probe.get_texture().get_image().get_pixel(0,0);var bank_cpu=app.meso.sample_field(bank)
	check(absf(bank_gpu.r*8-4-bank_cpu.x)<.01 and absf(bank_gpu.g*2-1-bank_cpu.y)<.004,"GPU bank transition includes amplitude gradients")
	app.load_tile(6);configure_probe(m)
	var sea=Vector2.ZERO
	for y in range(100,1200,37):
		for x in range(100,1200,37):
			if app.ground_water_image.get_pixel(x,y).b>.99:sea=Vector2(x+.5,y+.5)/1334.0*40000;break
		if sea!=Vector2.ZERO:break
	m.set_shader_parameter("probe_origin",sea);await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var sea_gpu=probe.get_texture().get_image().get_pixel(0,0)
	check(sea!=Vector2.ZERO and absf(sea_gpu.r*8-4)<.0001,"GPU sea level remains undisplaced")
	var previous=weakref(app.meso.image);app.load_tile(10);configure_probe(m);await process_frame
	check(previous.get_ref()==null,"Native context CPU image is released on tile change")
	DirAccess.make_dir_recursive_absolute("res://evidence/invalid-meso")
	var bad=FileAccess.open("res://evidence/invalid-meso/meso-context.json",FileAccess.WRITE);bad.store_string("{}");bad.close()
	check(not app.load_detail_context("res://evidence/invalid-meso",false),"Invalid context is rejected")
	check(app.meso.image==null and app.meso.texture==null and app.detail_amount==0 and not app.material.get_shader_parameter("meso_ready"),"Failed context cannot retain previous tile data")
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures}
	var file=FileAccess.open("res://evidence/meso-geometry-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));probe.queue_free();app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
