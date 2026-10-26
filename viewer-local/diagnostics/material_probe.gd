extends SceneTree
const Library=preload("res://adapters/material_library.gd")

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
	var library := Library.new()
	library.load_manifest("res://captures/grass-resolved.json")
	var shader := Shader.new()
	shader.code="shader_type spatial; render_mode unshaded; uniform sampler2DArray probe; uniform vec4 means[32]; void fragment(){vec3 c=textureLod(probe,vec3(UV,1.0),10.0).rgb; if(UV.x<0.25)ALBEDO=c; else if(UV.x<0.5)ALBEDO=means[1].rgb;else if(UV.x<0.75)ALBEDO=c/max(means[1].rgb,vec3(0.0001));else ALBEDO=vec3(.12,.17,.045)*c/max(means[1].rgb,vec3(.0001)); }"
	var material := ShaderMaterial.new()
	material.shader=shader
	material.set_shader_parameter("probe",library.albedo_height)
	var means:=PackedVector4Array()
	for i in 32:
		var c: Color=library.layer_means[mini(i,library.layer_means.size()-1)]
		means.append(Vector4(c.r,c.g,c.b,c.a))
	material.set_shader_parameter("means",means)
	print("CPU means: ",library.layer_means)
	plane.material_override=material
	world.add_child(plane)
	for i in 6: await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var values: Array = []
	for x in [64,192,320,448]:
		var c := image.get_pixel(x,64)
		values.append([c.r,c.g,c.b])
	print(JSON.stringify({"event":"material-probe","backend":RenderingServer.get_current_rendering_method(),"textureSRGBHalf":values[0],"literalLinearHalf":values[1],"manuallyDecodedTexture":values[2],"literalSRGBHalf":values[3]}))
	image.save_png("res://captures/material-probe.png")
	quit()

