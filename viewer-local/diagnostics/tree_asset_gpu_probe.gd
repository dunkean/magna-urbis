extends SceneTree
const Assets=preload("res://adapters/surface_tree_library.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
var library=Assets.new()
var viewport:SubViewport
var scene:Node3D
var camera:Camera3D
func _initialize()->void:call_deferred("run")
func coverage_shader(source:Shader)->Shader:
	var text=source.code.replace('"canopy.gdshaderinc"','"res://shaders/canopy.gdshaderinc"').replace('"color_space.gdshaderinc"','"res://shaders/color_space.gdshaderinc"').replace("render_mode cull_disabled;","render_mode cull_disabled,unshaded;")
	if text.contains("ALBEDO=display_color(source.rgb);"):text=text.replace("ALBEDO=display_color(source.rgb);","ALBEDO=vec3(1.0);")
	else:
		assert(text.contains("ALBEDO=display_color(source.rgb/max(source.a,.00001));"))
		text=text.replace("ALBEDO=display_color(source.rgb/max(source.a,.00001));","ALBEDO=vec3(1.0);")
	var shader=Shader.new();shader.code=text;return shader
func draw(product:Dictionary,candidate:Dictionary)->Image:
	var projection=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse())
	for material in product.materials:
		material.shader=coverage_shader(material.shader)
		material.set_shader_parameter("canopy_geometry_weight",1.0)
		material.set_shader_parameter("canopy_footprint_override_m",.01)
		material.set_shader_parameter("tree_main_top",true)
		material.set_shader_parameter("tree_camera_world_position",camera.global_position)
		material.set_shader_parameter("canopy_main_camera_enabled",true)
		material.set_shader_parameter("canopy_main_camera_vp",projection)
		material.set_shader_parameter("canopy_main_viewport_size",Vector2(viewport.size))
	var node=MultiMeshInstance3D.new();var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_custom_data=true;multi.use_colors=true
	multi.mesh=product.mesh;multi.instance_count=1;multi.buffer=Assets.instance_buffer([candidate],{"x":0,"y":0,"z":0});node.multimesh=multi;scene.add_child(node)
	for i in 3:await process_frame
	await RenderingServer.frame_post_draw
	var image=viewport.get_texture().get_image();node.queue_free();await process_frame;return image
func phase_probe()->Dictionary:
	var n=1024;var mask:PackedByteArray=library.cpu.maskBytes
	var coverage=PackedFloat32Array();coverage.resize(n*n)
	var counts=PackedFloat32Array();counts.resize(n*n*4)
	for i in n*n:
		coverage[i]=1.0 if mask[i]>=128 else 0.0;counts[i*4+2]=coverage[i]
	var cimage=Image.create_from_data(n,n,false,Image.FORMAT_RF,coverage.to_byte_array());cimage.generate_mipmaps()
	var count_image=Image.create_from_data(n,n,false,Image.FORMAT_RGBAF,counts.to_byte_array())
	var mesh=MeshInstance3D.new();mesh.mesh=QuadMesh.new();mesh.mesh.size=Vector2(22,22);mesh.rotation.x=-PI*.5;scene.add_child(mesh)
	var shader=Shader.new();shader.code='shader_type spatial;render_mode unshaded,cull_disabled;\n#include "res://shaders/canopy.gdshaderinc"\nuniform float test_footprint;void fragment(){vec2 p=(UV-.5)*2.2;float c=surface_canopy_target(p,test_footprint,.27);float v=surface_canopy_selected_visibility(p,test_footprint);float g=surface_canopy_residual(p,test_footprint,.27);float error=abs(v+(1.0-v)*g-c);ALBEDO=vec3(v>c+.00001 || g<-.00001 || g>1.00001 || error>.00001?1.0:0.0,0.0,0.0);}'
	var material=ShaderMaterial.new();material.shader=shader;mesh.material_override=material
	var spacing=2.2/1024.0
	var bindings={"canopy_enabled":true,"canopy_asset_enabled":true,"canopy_optical_lut":library.mean_texture,"canopy_coverage":ImageTexture.create_from_image(cimage),"canopy_counts":ImageTexture.create_from_image(count_image),"canopy_origin":Vector2(-1.1+spacing*.5,-1.1+spacing*.5),"canopy_grid_size":Vector2(n,n),"canopy_spacing_m":spacing}
	for key in bindings:material.set_shader_parameter(key,bindings[key])
	var cases=[];var violations=0
	for ratio in [.5,1.0,2.0,4.0,8.0,32.0]:
		for phase in [0.0,.5,1.0,1.25,1.5,1.75,2.0]:
			var actual_phase=minf(phase,1.0) if ratio>8 else phase
			material.set_shader_parameter("canopy_exact_weight",minf(actual_phase,1));material.set_shader_parameter("canopy_geometry_weight",maxf(0,actual_phase-1))
			material.set_shader_parameter("test_footprint",ratio*spacing)
			for i in 2:await process_frame
			await RenderingServer.frame_post_draw
			var image=viewport.get_texture().get_image();var failed=0
			for y in image.get_height():
				for x in image.get_width():
					if image.get_pixel(x,y).r>.5:failed+=1
			violations+=failed;cases.append({"ratio":ratio,"requestedPhase":phase,"safePhase":actual_phase,"violations":failed})
	mesh.queue_free();await process_frame
	return {"passed":violations==0,"pointwiseViolations":violations,"cases":cases,"pixelsPerCase":viewport.size.x*viewport.size.y,"scope":"production fragment C/V kernels with real A8/counts; ratio32 geometry forbidden by certificate, no min(C,V)"}
func draw_target(candidate:Dictionary,width_m:float)->Dictionary:
	var packet={"world":{"id":"authored-single-tree-render-control","seed":"fixed","versions":{},"terrain":{"source":{"id":"authored"}}},"source":{},"candidatePages":{"version":"surface-candidate-pages-1","tree":{"complete":true,"includeOverhang":true,"retention":1,"bounds":{"minX":-2000.0,"maxX":2000.0,"minZ":-2000.0,"maxZ":2000.0}}},"candidates":[candidate]}
	var extent=width_m*.5+128.0
	var atlas=Canopy.prepare(library.packet_copy(packet,"aerial"),{candidate.stableId:true},{"minX":-extent,"maxX":extent,"minZ":-extent,"maxZ":extent})
	var node=MeshInstance3D.new();node.mesh=PlaneMesh.new();node.mesh.size=Vector2(200,200)
	var shader=Shader.new();shader.code='shader_type spatial;render_mode unshaded,cull_disabled;\n#include "res://shaders/canopy.gdshaderinc"\nuniform float fp;varying vec2 p;void vertex(){p=(MODEL_MATRIX*vec4(VERTEX,1)).xz;}void fragment(){ALBEDO=vec3(surface_canopy_target(p,fp,0.0));}'
	var material=ShaderMaterial.new();material.shader=shader;node.material_override=material
	var bindings={"canopy_enabled":true,"canopy_exact_weight":1.0,"canopy_geometry_weight":0.0,"canopy_coverage":ImageTexture.create_from_image(atlas.coverageImage),"canopy_origin":Vector2(atlas.origin.x,atlas.origin.z),"canopy_grid_size":atlas.gridSize,"canopy_spacing_m":atlas.spacingM,"fp":width_m/float(viewport.size.x)}
	for key in bindings:material.set_shader_parameter(key,bindings[key])
	scene.add_child(node)
	for i in 3:await process_frame
	await RenderingServer.frame_post_draw
	var image=viewport.get_texture().get_image();node.queue_free();await process_frame
	return {"image":image,"atlasSpacingM":atlas.spacingM,"atlasHash":atlas.atlasHash}
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.has("--check-only"):print("TREE_ASSET_GPU_PROBE_PARSE_OK");quit();return
	assert(args.size()==2)
	assert(library.load_manifest(args[0],true),library.last_error)
	DirAccess.make_dir_recursive_absolute(args[1]);viewport=SubViewport.new();viewport.size=Vector2i(512,512);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color.BLACK;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;scene.add_child(environment)
	camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=22;camera.position=Vector3(0,100,.0001);scene.add_child(camera);camera.look_at(Vector3.ZERO,Vector3.FORWARD);camera.current=true
	var rows=[];var passed=true
	for test in [{"angle":0.0,"width":10.0},{"angle":.73,"width":10.0},{"angle":-1.2,"width":10.0},{"angle":0.0,"width":160.0},{"angle":.73,"width":160.0},{"angle":-1.2,"width":160.0}]:
		var angle=float(test.angle);var width_m=float(test.width);camera.size=width_m
		var candidate={"stableId":"authored-asset-render-control","family":"tree","x":0.0,"y":0.0,"z":0.0,"size":16.194046,"crownRadiusM":6.8014998,"orientation":angle,"canopyClass":3,"rank":0.0}
		var high=await draw(library.high_render_mesh(),candidate);var middle=await draw(library.impostor_render_mesh(),candidate)
		var target=await draw_target(candidate,width_m);var target_image:Image=target.image
		high.save_png(args[1].path_join("high-"+str(rows.size())+".png"));middle.save_png(args[1].path_join("impostor-"+str(rows.size())+".png"))
		target_image.save_png(args[1].path_join("target-"+str(rows.size())+".png"))
		var a=0;var b=0;var intersection=0;var union_count=0;var c_sum=0.0;var envelope=0
		for y in high.get_height():
			for x in high.get_width():
				var ha=high.get_pixel(x,y).r>.5;var hb=middle.get_pixel(x,y).r>.5
				var point=(Vector2(x+.5,y+.5)/Vector2(viewport.size)-Vector2(.5,.5))*width_m
				if point.length()<=float(candidate.crownRadiusM):envelope+=1
				c_sum+=target_image.get_pixel(x,y).srgb_to_linear().r
				if ha:a+=1
				if hb:b+=1
				if ha and hb:intersection+=1
				if ha or hb:union_count+=1
		var difference=absf(float(a-b))/float(envelope)
		var high_error=absf(float(a)-c_sum)/float(envelope);var middle_error=absf(float(b)-c_sum)/float(envelope)
		passed=passed and difference<=.02 and high_error<=.02 and middle_error<=.02 and a>0 and b>0
		rows.append({"rotation":angle,"widthM":width_m,"highPixels":a,"impostorPixels":b,"targetLinearPixelSum":c_sum,"visibleEnvelopePixels":envelope,"highVsImpostorEnvelopeError":difference,"highVsTargetEnvelopeError":high_error,"impostorVsTargetEnvelopeError":middle_error,"atlasSpacingM":target.atlasSpacingM,"IoU":float(intersection)/maxi(union_count,1)})
	camera.size=22
	var phases=await phase_probe();passed=passed and phases.passed
	var result={"passed":passed,"adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method(),"assetDigest":library.cpu.digest,"silhouette":rows,"phases":phases,"scope":"actual production MultiMesh vertex/alpha shaders, only ALBEDO and unshaded replaced for coverage readback. Authored placement, real CC0 product. Top control only; no oblique or physical3D C/V exactness claim."}
	var file=FileAccess.open(args[1].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(result,"  "));file=null
	print(JSON.stringify({"passed":passed,"silhouette":rows,"pointwiseViolations":phases.pointwiseViolations}));quit(0 if passed else 1)
