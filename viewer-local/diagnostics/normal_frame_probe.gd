extends SceneTree

func _initialize() -> void: call_deferred("_run")

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
	var instance := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size=Vector2(8,2)
	instance.mesh=quad
	var material := ShaderMaterial.new()
	var shader := Shader.new()
	shader.code='shader_type spatial;render_mode unshaded;\n#include "res://shaders/normal_frame.gdshaderinc"\nvoid fragment(){float angle=floor(UV.x*4.0)*1.570796327;mat2 r=mat2(vec2(cos(angle),sin(angle)),vec2(-sin(angle),cos(angle)));vec2 uv=r*UV;float dhdu=cos(uv.x*6.283185307)*0.4;vec2 image_normal=vec2(-dhdu,0);vec2 actual=surface_rotated_normal(image_normal,r);vec2 height_gradient=transpose(r)*vec2(dhdu,0);vec2 expected=vec2(-height_gradient.x,height_gradient.y);float error=length(actual-expected);ALBEDO=vec3(min(error*100000.0,1.0));}'
	material.shader=shader
	instance.material_override=material
	world.add_child(instance)
	for i in 6: await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var maximum := 0.0
	for y in range(4,124,8):
		for x in range(4,508,8): maximum=maxf(maximum,image.get_pixel(x,y).r)
	var report := {"event":"normal-frame-probe","rotationsDegrees":[0,90,180,270],"fixture":"single-sided analytic bump height plus NormalGL gradient; production rotation helper","maximumEncodedError":maximum,"passed":maximum<0.01}
	print(JSON.stringify(report))
	quit(0 if report.passed else 1)
