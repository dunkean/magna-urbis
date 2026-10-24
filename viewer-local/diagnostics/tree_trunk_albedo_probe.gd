extends SceneTree
const Assets=preload("res://adapters/surface_tree_library.gd")
func _initialize()->void:call_deferred("run")
func run()->void:
	var args=OS.get_cmdline_user_args();assert(args.size()==3)
	DirAccess.make_dir_recursive_absolute(args[2])
	var viewport=SubViewport.new();viewport.size=Vector2i(768,768);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	var scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color.BLACK;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;scene.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=20;camera.position=Vector3(18,16,22);scene.add_child(camera);camera.look_at(Vector3(0,6,0));camera.current=true
	var candidate={"stableId":"same-trunk-source-control","family":"tree","x":0.0,"y":0.0,"z":0.0,"size":12.0,"crownRadiusM":5.04,"orientation":.73,"rank":.27,"canopyClass":2}
	var rows=[];var images:Array[Image]=[]
	for path in [args[0],args[1]]:
		var library=Assets.new();assert(library.load_manifest(path,true),library.last_error)
		var product=library.high_render_mesh();var sources=[]
		for i in product.materials.size():
			var source:StandardMaterial3D=library.high_materials[i];var material:ShaderMaterial=product.materials[i]
			var shader=Shader.new();shader.code=material.shader.code.replace('"canopy.gdshaderinc"','"res://shaders/canopy.gdshaderinc"').replace('"color_space.gdshaderinc"','"res://shaders/color_space.gdshaderinc"').replace("render_mode cull_disabled;","render_mode cull_disabled,unshaded;");material.shader=shader
			# No ALBEDO override. Preserve imported textures, factors and productionUV.
			material.set_shader_parameter("tree_main_top",false);material.set_shader_parameter("canopy_footprint_override_m",.001);material.set_shader_parameter("canopy_geometry_weight",0.0 if source.resource_name.contains("leaves") else 1.0)
			var image:Image=source.albedo_texture.get_image()
			sources.append({"material":source.resource_name,"importedTextureFormat":image.get_format(),"importedTextureSha256":image.get_data().hex_encode().sha256_text(),"factor":str(source.albedo_color),"uvScale":str(source.uv1_scale),"uvOffset":str(source.uv1_offset),"leafMasked":source.resource_name.contains("leaves")})
		var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_colors=true;multi.use_custom_data=true;multi.mesh=product.mesh;multi.instance_count=1;multi.buffer=Assets.instance_buffer([candidate],{"x":0,"y":0,"z":0})
		var node=MultiMeshInstance3D.new();node.multimesh=multi;scene.add_child(node)
		for frame in 4:await process_frame
		await RenderingServer.frame_post_draw
		var image=viewport.get_texture().get_image();images.append(image);image.save_png(args[2].path_join("trunk-"+str(rows.size())+".png"))
		rows.append({"digest":library.cpu.digest,"sources":sources});node.queue_free();await process_frame
	var same=images[0].get_data()==images[1].get_data()
	var report={"version":1,"adapter":RenderingServer.get_video_adapter_name(),"fullTrunkBranchesPixelsExact":same,"inputs":rows,"scope":"Same current production high MultiMesh shader and source textures; only unshaded added and leaf geometry hidden. No ALBEDO constant/override. Historical pre/post probes lacked source snapshots and are not retroactively paired."}
	var file=FileAccess.open(args[2].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null;print(JSON.stringify(report));quit(0 if same else 1)
