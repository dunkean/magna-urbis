extends SceneTree
var terrain_material: ShaderMaterial
var decal: Decal
var viewport: SubViewport
var baseline: Image
var flat: Image
var deformed: Image
var failures: Array=[]
func capture() -> Image:
	await process_frame
	await RenderingServer.frame_post_draw
	return viewport.get_texture().get_image()
func _initialize():
	call_deferred("run")
func run():
	if RenderingServer.get_current_rendering_method()!="gl_compatibility" and RenderingServer.get_rendering_device()!=null:
		pass
	else:
		push_error("GPU Decal test requires Forward+ rendering device"); quit(2); return
	viewport=SubViewport.new(); viewport.size=Vector2i(256,256); viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d=true; root.add_child(viewport)
	var environment=WorldEnvironment.new(); environment.environment=Environment.new(); environment.environment.background_mode=Environment.BG_COLOR; environment.environment.background_color=Color.BLACK; environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR; environment.environment.ambient_light_color=Color.WHITE; environment.environment.ambient_light_energy=1.0; environment.environment.reflected_light_source=Environment.REFLECTION_SOURCE_DISABLED; environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR; environment.environment.tonemap_exposure=1.0; viewport.add_child(environment)
	var camera=Camera3D.new(); viewport.add_child(camera); camera.projection=Camera3D.PROJECTION_ORTHOGONAL; camera.size=10
	camera.position=Vector3(0,12,0); camera.look_at(Vector3.ZERO,Vector3(0,0,-1)); camera.current=true
	var mesh=MeshInstance3D.new(); var plane=PlaneMesh.new(); plane.size=Vector2(10,10); plane.subdivide_width=64; plane.subdivide_depth=64; mesh.mesh=plane
	mesh.layers=1; mesh.extra_cull_margin=4.0
	var shader=Shader.new(); shader.code="shader_type spatial; render_mode specular_disabled; uniform float amplitude=0.0; void vertex(){VERTEX.y=amplitude*sin(VERTEX.x*0.9)*cos(VERTEX.z*0.7);}void fragment(){ALBEDO=vec3(0.21404114,0.13286832,0.07323896);ROUGHNESS=1.0;}"
	terrain_material=ShaderMaterial.new(); terrain_material.shader=shader; mesh.material_override=terrain_material; viewport.add_child(mesh)
	baseline=await capture()
	decal=Decal.new(); decal.size=Vector3(2,8,8); decal.cull_mask=1; decal.upper_fade=0; decal.lower_fade=0
	var image=Image.create(8,8,false,Image.FORMAT_RGBA8); image.fill(Color(0.8,0.6,0.4,1)); decal.texture_albedo=ImageTexture.create_from_image(image)
	viewport.add_child(decal)
	flat=await capture()
	terrain_material.set_shader_parameter("amplitude",2.0)
	deformed=await capture()
	var changed=0; var projected=0; var mismatch=0
	for z in 256:
		for x in 256:
			var a=baseline.get_pixel(x,z); var b=flat.get_pixel(x,z); var c=deformed.get_pixel(x,z)
			if b.r>a.r+0.1: changed+=1
			if c.r>a.r+0.1: projected+=1
			if absf(c.r-b.r)>0.02 or absf(c.g-b.g)>0.02: mismatch+=1
	if changed<5000: failures.append("Decal does not affect terrain layer1")
	if abs(changed-projected)>10 or mismatch>10: failures.append("projection changes when GPU height moves inside its volume")
	decal.cull_mask=2
	var excluded=await capture()
	var excluded_changed=0
	for z in 256:
		for x in 256:
			if excluded.get_pixel(x,z).r>baseline.get_pixel(x,z).r+0.1: excluded_changed+=1
	if excluded_changed>10: failures.append("Decal leaks into excluded terrain layer")
	var ground=baseline.get_pixel(128,128); var road=flat.get_pixel(128,128)
	var target_ground=Color(0.5,0.4,0.3); var target_road=Color(0.8,0.6,0.4)
	var ground_error=maxf(absf(ground.r-target_ground.r),maxf(absf(ground.g-target_ground.g),absf(ground.b-target_ground.b)))
	var road_error=maxf(absf(road.r-target_road.r),maxf(absf(road.g-target_road.g),absf(road.b-target_road.b)))
	if ground_error>2.0/255.0 or road_error>2.0/255.0: failures.append("Ambient color path does not preserve CSS RGB within2bytes")
	var result={"groundRGB":[ground.r,ground.g,ground.b],"roadRGB":[road.r,road.g,road.b],"groundError":ground_error,"roadError":road_error,"failures":failures,"renderer":RenderingServer.get_current_rendering_method(),"flatRoadPixels":changed,"deformedRoadPixels":projected,"differentPixels":mismatch,"excludedLayerRoadPixels":excluded_changed}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():
		DirAccess.make_dir_recursive_absolute(args[0]); baseline.save_png(args[0]+"/before.png"); flat.save_png(args[0]+"/flat.png"); deformed.save_png(args[0]+"/deformed.png")
		var output=FileAccess.open(args[0]+"/result.json",FileAccess.WRITE); output.store_string(JSON.stringify(result,"  "))
	print(JSON.stringify(result)); quit(0 if failures.is_empty() else 1)

