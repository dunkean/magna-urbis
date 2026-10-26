extends SceneTree

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	root.size=Vector2i(512,128)
	var world := Node3D.new()
	root.add_child(world)
	var camera := Camera3D.new()
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL
	camera.size=2.0
	camera.position=Vector3(0,0,2)
	world.add_child(camera)
	camera.look_at(Vector3.ZERO)
	var plane := MeshInstance3D.new()
	var mesh := QuadMesh.new()
	mesh.size=Vector2(8,2)
	plane.mesh=mesh
	var texture := Texture2DArray.new()
	var im := Image.create(8,8,false,Image.FORMAT_RGBA8)
	im.fill(Color(0.5,0.5,0.5,1))
	var images: Array[Image] = [im]
	texture.create_from_images(images)
	var shader := Shader.new()
	shader.code="shader_type spatial; render_mode unshaded; uniform sampler2DArray probe:source_color; void fragment(){vec3 c=texture(probe,vec3(UV,0.0)).rgb; if(UV.x<0.25)ALBEDO=c; else if(UV.x<0.5)ALBEDO=vec3(0.21404114);else if(UV.x<0.75)ALBEDO=pow(c,vec3(2.2));else ALBEDO=vec3(0.5); }"
	var material := ShaderMaterial.new()
	material.shader=shader
	material.set_shader_parameter("probe",texture)
	plane.material_override=material
	world.add_child(plane)
	for i in 6: await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var values: Array = []
	for x in [64,192,320,448]:
		var c := image.get_pixel(x,64)
		values.append([c.r,c.g,c.b])
	print(JSON.stringify({"event":"color-probe","backend":RenderingServer.get_current_rendering_method(),"textureSRGBHalf":values[0],"literalLinearHalf":values[1],"manuallyDecodedTexture":values[2],"literalSRGBHalf":values[3]}))
	image.save_png("res://captures/color-probe.png")
	quit()
