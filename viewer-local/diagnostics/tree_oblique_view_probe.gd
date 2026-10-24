extends SceneTree
const Assets=preload("res://adapters/surface_tree_library.gd")
const Views=preload("res://adapters/surface_tree_oblique_library.gd")
var library=Assets.new();var views=Views.new();var viewport:SubViewport;var scene:Node3D;var camera:Camera3D
func _initialize()->void:call_deferred("run")
func draw(product:Dictionary,candidate:Dictionary,uniform_scale:bool,channel:String)->Image:
	for material:ShaderMaterial in product.materials:
		var text=material.shader.code.replace('"canopy.gdshaderinc"','"res://shaders/canopy.gdshaderinc"').replace('"color_space.gdshaderinc"','"res://shaders/color_space.gdshaderinc"').replace('"forest_oblique.gdshaderinc"','"res://shaders/forest_oblique.gdshaderinc"').replace('"forest_alpha_hash.gdshaderinc"','"res://shaders/forest_alpha_hash.gdshaderinc"')
		if channel=="coverage":
			text=text.replace("render_mode cull_disabled;","render_mode cull_disabled,unshaded;")
			text=text.insert(text.rfind("}"),"ALBEDO=vec3(1.0);\n")
		var shader=Shader.new();shader.code=text;material.shader=shader
		for pair in [["tree_main_top",false],["tree_camera_world_position",camera.global_position],["canopy_geometry_weight",1.0],["canopy_footprint_override_m",.01],["forest_oblique_full_enabled",true],["forest_oblique_full_weight",1.0]]:material.set_shader_parameter(pair[0],pair[1])
	var buffer=Assets.instance_buffer([candidate],{"x":0,"y":0,"z":0})
	if uniform_scale:
		for index in [0,1,2,8,9,10]:buffer[index]/=.42
	var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_colors=true;multi.use_custom_data=true;multi.mesh=product.mesh;multi.instance_count=1;multi.buffer=buffer
	var node=MultiMeshInstance3D.new();node.multimesh=multi;node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF;scene.add_child(node)
	for i in 3:await process_frame
	await RenderingServer.frame_post_draw
	var image=viewport.get_texture().get_image();node.queue_free();await process_frame;return image
func compare(a:Image,b:Image)->Dictionary:
	var na=0;var nb=0;var both=0;var either=0
	for y in a.get_height():
		for x in a.get_width():
			var ha=a.get_pixel(x,y).r>.5;var hb=b.get_pixel(x,y).r>.5
			if ha:na+=1
			if hb:nb+=1
			if ha and hb:both+=1
			if ha or hb:either+=1
	return {"highPixels":na,"proxyPixels":nb,"IoU":float(both)/maxi(either,1),"relativePixelCountDelta":float(nb-na)/maxi(na,1)}
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.has("--check-only"):quit();return
	assert(args.size()==2);DirAccess.make_dir_recursive_absolute(args[1]);assert(library.load_manifest(args[0],true),library.last_error)
	viewport=SubViewport.new();viewport.size=Vector2i(1024,1024);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport);scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color.BLACK;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;environment.environment.ambient_light_color=Color(.5,.5,.5);environment.environment.ambient_light_energy=.3;scene.add_child(environment)
	var sun=DirectionalLight3D.new();sun.rotation_degrees=Vector3(-48,-32,0);sun.light_energy=1.5;scene.add_child(sun)
	camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=24;camera.near=.01;camera.far=100;camera.current=true;scene.add_child(camera)
	if not await views.bake(scene,library):push_error("Physical view-grid bake failed");quit(1);return
	var candidate={"stableId":"authored-horizon-control","family":"tree","x":0.0,"y":0.0,"z":0.0,"size":12.0,"crownRadiusM":5.04,"orientation":0.0,"rank":.27,"canopyClass":2}
	var rows=[]
	for degrees in [8.0,0.0,-10.0]:
		var angle=deg_to_rad(degrees);var centre=Vector3(0,6,0);camera.position=centre+Vector3(cos(angle),sin(angle),0)*35;camera.look_at(centre)
		var images={}
		for channel in ["coverage","lit"]:
			for kind in ["high","old","new"]:
				var product:Dictionary
				if kind=="high":product=library.high_render_mesh()
				elif kind=="old":product=library.impostor_render_mesh()
				else:
					var mesh=QuadMesh.new();var material=views.material();mesh.surface_set_material(0,material);product={"mesh":mesh,"materials":[material]}
				var image=await draw(product,candidate,kind=="new",channel);images[channel+"-"+kind]=image;image.save_png(args[1].path_join(str(degrees)+"-"+channel+"-"+kind+".png"))
		rows.append({"elevationDegrees":degrees,"old":compare(images["coverage-high"],images["coverage-old"]),"new":compare(images["coverage-high"],images["coverage-new"])})
	var report={"version":1,"adapter":RenderingServer.get_video_adapter_name(),"viewLibrary":views.descriptor,"rows":rows,"sourcePlacement":"authored, actual corrected CC0 high product, same physical height12/radius5.04/yaw0","scope":"actual production vertex/alpha with diagnostic unlit-white coverage override plus lit views; not a real terrain/city campaign or exact arbitrary-view3D claim"}
	var file=FileAccess.open(args[1].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null;print(JSON.stringify(report));quit()
