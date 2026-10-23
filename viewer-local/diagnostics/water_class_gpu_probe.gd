extends SceneTree
const Presentation=preload("res://adapters/surface_presentation.gd")
func _initialize():call_deferred("run")
func capture(viewport:SubViewport)->Image:
	for i in 3:await process_frame
	await RenderingServer.frame_post_draw
	return viewport.get_texture().get_image()
func error(a:Color,b:Color)->float:return maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b)))
func run():
	var args=OS.get_cmdline_user_args();var catalogue=args[0];var failures=[];var samples=[]
	var viewport=SubViewport.new();viewport.size=Vector2i(384,128);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;environment.environment.ambient_light_color=Color.WHITE;environment.environment.ambient_light_energy=1;environment.environment.reflected_light_source=Environment.REFLECTION_SOURCE_DISABLED;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;viewport.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=2;camera.position=Vector3(0,4,0);viewport.add_child(camera);camera.look_at(Vector3.ZERO,Vector3(0,0,-1))
	var mesh=MeshInstance3D.new();var plane=PlaneMesh.new();plane.size=Vector2(6,2);mesh.mesh=plane;viewport.add_child(mesh)
	var classes=Image.create(3,1,false,Image.FORMAT_RF)
	for i in 3:classes.set_pixel(i,0,Color(i+1,0,0,1))
	var texture=ImageTexture.create_from_image(classes)
	for style_name in ["blueprint","parchment"]:
		var packet=Presentation.overrides({"source":{"presentation":null}},style_name,catalogue);var palette=Presentation.profile(packet,"cartographic").palette
		var material=Presentation.water_material(packet,"cartographic");material.set_shader_parameter("class_enabled",true);material.set_shader_parameter("class_map",texture);material.set_shader_parameter("class_origin_local",Vector2(-2,0));material.set_shader_parameter("class_grid_size",Vector2(3,1));material.set_shader_parameter("class_spacing",2.0);mesh.material_override=material
		var image=await capture(viewport)
		for i in 3:
			var token=["riverFill","lakeFill","seaFill"][i];var target=Color.from_string(palette[token],Color.WHITE);var sample=image.get_pixel(64+i*128,64);var delta=error(sample,target)
			if delta>2.0/255:failures.append(style_name+":"+token)
			samples.append({"style":style_name,"token":token,"css":palette[token],"maximumEncodedError":delta})
	# No camera-/position-dependent periodic albedo is allowed in the physical water branch.
	var packet={};var material=Presentation.water_material(packet,"aerial");mesh.material_override=material
	var image=await capture(viewport);var minimum=Color(1,1,1);var maximum=Color(0,0,0)
	for y in range(8,120):
		for x in range(8,376):
			var c=image.get_pixel(x,y);minimum.r=minf(minimum.r,c.r);minimum.g=minf(minimum.g,c.g);minimum.b=minf(minimum.b,c.b);maximum.r=maxf(maximum.r,c.r);maximum.g=maxf(maximum.g,c.g);maximum.b=maxf(maximum.b,c.b)
	var variation=error(minimum,maximum)
	if variation>2.0/255:failures.append("periodic aerial colour checker")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"samples":samples,"aerialMaximumSpatialEncodedVariation":variation,"renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"scope":"production water shader and presentation materials, raw river/lake/sea class image"}));quit(0 if failures.is_empty() else 1)
