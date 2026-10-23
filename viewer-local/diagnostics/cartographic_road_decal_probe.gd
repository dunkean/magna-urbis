extends SceneTree
const Presentation=preload("res://adapters/surface_presentation.gd")
func _initialize():call_deferred("run")
func capture(viewport:SubViewport)->Image:
	for i in 3:await process_frame
	await RenderingServer.frame_post_draw
	return viewport.get_texture().get_image()
func error(a:Color,b:Color)->float:return maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b)))
func run():
	if RenderingServer.get_current_rendering_method()!="forward_plus":push_error("Requires Forward+");quit(2);return
	var args=OS.get_cmdline_user_args();var catalogue=args[0];var failures=[];var samples=[]
	var viewport=SubViewport.new();viewport.size=Vector2i(256,256);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;environment.environment.ambient_light_color=Color.WHITE;environment.environment.ambient_light_energy=1;environment.environment.reflected_light_source=Environment.REFLECTION_SOURCE_DISABLED;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;viewport.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=10;camera.position=Vector3(0,12,0);viewport.add_child(camera);camera.look_at(Vector3.ZERO,Vector3(0,0,-1))
	var mesh=MeshInstance3D.new();var plane=PlaneMesh.new();plane.size=Vector2(10,10);plane.subdivide_width=64;plane.subdivide_depth=64;mesh.mesh=plane;mesh.extra_cull_margin=4;mesh.layers=1;viewport.add_child(mesh)
	var material=ShaderMaterial.new();var shader=Shader.new();shader.code="shader_type spatial;render_mode specular_disabled;uniform float amplitude=0.0;void vertex(){VERTEX.y=amplitude*sin(VERTEX.x*.9)*cos(VERTEX.z*.7);}void fragment(){ALBEDO=vec3(.21404114,.13286832,.07323896);ROUGHNESS=1.0;}";material.shader=shader;mesh.material_override=material
	var decal=Decal.new();decal.size=Vector3(2,8,8);decal.cull_mask=1;decal.upper_fade=0;decal.lower_fade=0;viewport.add_child(decal)
	var source_size=decal.size
	for style_name in ["blueprint","parchment"]:
		for road_class in ["main","track"]:
			var packet=Presentation.overrides({"source":{"presentation":null}},style_name,catalogue);var style=Presentation.road_decal_style(packet,"cartographic",{"class":road_class})
			decal.texture_albedo=style.texture;decal.modulate=style.modulate;decal.albedo_mix=style.albedoMix;material.set_shader_parameter("amplitude",0.0)
			var flat=await capture(viewport);material.set_shader_parameter("amplitude",2.0);var deformed=await capture(viewport)
			var target_fill=Color.from_string(style.fillCSS,Color.WHITE);var target_edge=Color.from_string(style.edgeCSS,Color.WHITE)
			var fill_error=error(flat.get_pixel(128,128),target_fill);var edge_error=error(flat.get_pixel(106,128),target_edge);var maximum_difference=0.0
			for y in 256:
				for x in 256:maximum_difference=maxf(maximum_difference,error(flat.get_pixel(x,y),deformed.get_pixel(x,y)))
			if fill_error>2.0/255 or edge_error>2.0/255 or maximum_difference>2.0/255 or decal.size!=source_size or decal.modulate!=Color.WHITE or decal.albedo_mix!=1:failures.append(style_name+":"+road_class)
			samples.append({"style":style_name,"class":road_class,"fillCSS":style.fillCSS,"edgeCSS":style.edgeCSS,"fillError":fill_error,"edgeError":edge_error,"maximumDeformationDifference":maximum_difference,"sourceWidthM":decal.size.x})
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"samples":samples,"renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"scope":"production CSS decal helper on deformed physical terrain, border inside unchanged source width"}));quit(0 if failures.is_empty() else 1)
