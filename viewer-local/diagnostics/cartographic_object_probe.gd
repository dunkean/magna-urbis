extends SceneTree
const ScenePrepare=preload("res://adapters/surface_scene_prepare.gd")
const Presentation=preload("res://adapters/surface_presentation.gd")
func _initialize():call_deferred("run")
func run():
	root.size=Vector2i(128,128);var world=Node3D.new();root.add_child(world)
	var env=WorldEnvironment.new();env.environment=Environment.new();env.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;env.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;env.environment.ambient_light_energy=0;world.add_child(env)
	var light=DirectionalLight3D.new();light.light_energy=5;light.light_color=Color(1,0,0);world.add_child(light)
	var camera=Camera3D.new();camera.position=Vector3(0,0,3);camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=2;world.add_child(camera)
	var args=OS.get_cmdline_user_args();var catalogue=JSON.parse_string(FileAccess.get_file_as_string(args[0]));var palette=catalogue.terrainStyles.blueprint.palette
	var css=str(palette.grass);var color=Presentation.color_linear(css);var candidate={"x":0,"y":-0.5,"z":0,"size":1,"orientation":0,"_linearAlbedo":[color.x,color.y,color.z]}
	var original=JSON.stringify(candidate);var buffer=ScenePrepare.population_buffer([candidate],"grass",{"x":0,"y":0,"z":0})
	var failures=[]
	if absf(buffer[12]-color.x)>0.000001 or absf(buffer[13]-color.y)>0.000001 or absf(buffer[14]-color.z)>0.000001 or JSON.stringify(candidate)!=original:failures.append("palette transform buffer changed linear colour or source")
	var mesh=QuadMesh.new();mesh.size=Vector2(2,2);var material=ShaderMaterial.new();material.shader=load("res://shaders/surface_object.gdshader");material.set_shader_parameter("presentation_mode",1);mesh.material=material
	var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_colors=true;multi.use_custom_data=true;multi.mesh=mesh;multi.instance_count=1;multi.buffer=buffer
	var object=MultiMeshInstance3D.new();object.multimesh=multi;world.add_child(object)
	for i in 4:await process_frame
	await RenderingServer.frame_post_draw
	var sample=root.get_texture().get_image().get_pixel(64,64);var target=Color.from_string(css,Color.WHITE);var error=maxf(absf(sample.r-target.r),maxf(absf(sample.g-target.g),absf(sample.b-target.b)))
	if error>2.0/255.0:failures.append("cartographic CSS differs under strong red sun")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"css":css,"readback":[sample.r,sample.g,sample.b],"maximumEncodedError":error,"linearBuffer":[buffer[12],buffer[13],buffer[14]],"renderer":RenderingServer.get_current_rendering_method(),"scope":"production shader and MultiMesh transform buffer; source palette without direct-light tint"}));quit(0 if failures.is_empty() else 1)
