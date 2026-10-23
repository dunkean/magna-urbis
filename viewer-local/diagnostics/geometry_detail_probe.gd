extends SceneTree
func _initialize(): call_deferred("run")
func run():
	root.size=Vector2i(128,128)
	var world=Node3D.new(); root.add_child(world)
	var camera=Camera3D.new(); camera.position=Vector3(0,0,2); camera.projection=Camera3D.PROJECTION_ORTHOGONAL; camera.size=2.0; world.add_child(camera)
	var instance=MeshInstance3D.new(); instance.mesh=QuadMesh.new(); world.add_child(instance)
	var shader=Shader.new(); shader.code='shader_type spatial;render_mode unshaded;\n#include "res://shaders/color_space.gdshaderinc"\n#include "res://shaders/geometry_detail.gdshaderinc"\nuniform vec2 test_point;void fragment(){float e;vec3 c;float s;float q;surface_geometry_detail(test_point,vec3(0.1),e,c,s,q);ALBEDO=display_color(vec3(c.r,e,q));}'
	var material=ShaderMaterial.new();material.shader=shader;instance.material_override=material
	var image=Image.create(4,4,false,Image.FORMAT_RGBAF)
	for y in 4:
		for x in 4: image.set_pixel(x,y,Color(PI/4,0.3,x%2,0.25))
	var colors=PackedVector4Array(); colors.resize(64); colors[0]=Vector4(0.2,0.3,0.4,1);colors[1]=Vector4(0.6,0.7,0.8,1)
	material.set_shader_parameter("geometry_detail_map",ImageTexture.create_from_image(image));material.set_shader_parameter("detail_rock_colors",colors);material.set_shader_parameter("geometry_detail_enabled",true);material.set_shader_parameter("detail_grid_size",Vector2(4,4));material.set_shader_parameter("detail_bedrock_recipe",0)
	var maximum=0.0;var values=[]
	for case in [{"point":Vector2(1.5,1.5),"origin":Vector2.ZERO,"target":Vector3(0.4,0.3,0.25),"enabled":true},{"point":Vector2(-0.01,1.5),"origin":Vector2.ZERO,"target":Vector3(0.1,0,0),"enabled":true},{"point":Vector2(-62.5,1.5),"origin":Vector2(-64,0),"target":Vector3(0.4,0.3,0.25),"enabled":true},{"point":Vector2(3,1.5),"origin":Vector2.ZERO,"target":Vector3(0.6,0.3,0.25),"enabled":true},{"point":Vector2(1.5,1.5),"origin":Vector2.ZERO,"target":Vector3(0.1,0,0),"enabled":false}]:
		material.set_shader_parameter("test_point",case.point);material.set_shader_parameter("detail_origin",case.origin);material.set_shader_parameter("geometry_detail_enabled",case.enabled)
		for i in 3: await process_frame
		await RenderingServer.frame_post_draw
		var sample=root.get_texture().get_image().get_pixel(64,64).srgb_to_linear();var rgb=Vector3(sample.r,sample.g,sample.b)
		var error=(rgb-case.target).abs();maximum=maxf(maximum,maxf(error.x,maxf(error.y,error.z)));values.append([rgb.x,rgb.y,rgb.z])
	print(JSON.stringify({"passed":maximum<0.006,"maximumLinearError":maximum,"samples":values,"renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name()}));quit(0 if maximum<0.006 else 1)
