extends SceneTree

# Production pinned Terrain3D vertex shader; only the fragment output changes.
# Red encodes deviation from an imported analytic plane (saturates at 1 mm),
# green confirms an actual rendered terrain fragment. No get_height API lookup.
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.has("--gpu-import-check-only"):print("GPU_IMPORT_PROBE_PARSE_OK");quit();return
	if DisplayServer.get_name()=="headless":push_error("GPU import probe requires a real renderer");quit(2);return
	if not ClassDB.class_exists("Terrain3D"):push_error("Pinned Terrain3D required");quit(2);return
	root.size=Vector2i(512,512)
	var scene=Node3D.new();root.add_child(scene)
	var environment=WorldEnvironment.new();var settings=Environment.new()
	settings.background_mode=Environment.BG_COLOR;settings.background_color=Color.BLACK;settings.tonemap_mode=Environment.TONE_MAPPER_LINEAR
	environment.environment=settings;scene.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.position=Vector3(0,5000,0.0001);camera.near=1;camera.far=10000;scene.add_child(camera);camera.look_at(Vector3(0,1000,0),Vector3.FORWARD);camera.current=true
	var minimum=FileAccess.get_file_as_string("res://addons/terrain_3d/extras/shaders/minimum.gdshader").replace("\r","")
	var anchor="ALBEDO = vec3(.2);\n\tROUGHNESS = .7;"
	if minimum.count(anchor)!=1:push_error("Pinned fragment anchor missing");quit(2);return
	# Keep the pinned fragment structure: Terrain3D's material injector expects
	# its recovered `uv` variable and normal/filtering anchors to remain present.
	var code=minimum.replace("render_mode blend_mix,", "render_mode unshaded,blend_mix,")
	code=code.replace("// Public Uniforms","uniform float probe_spacing=1.0; uniform float probe_start=-256.0;\n// Public Uniforms")
	code=code.replace(anchor,"float expected=1000.0+(v_vertex.x-probe_start)/probe_spacing*0.25+(v_vertex.z-probe_start)/probe_spacing*0.5; float error=abs(v_vertex.y-expected); ALBEDO=vec3(clamp(error*1000.0,0.0,1.0),1.0,0.0); ROUGHNESS=1.0; SPECULAR=0.0;")
	var shader=Shader.new();shader.code=code
	var cases=[];var failures=[]
	var destination=args[0] if not args.is_empty() else "res://captures/gpu-import-probe"
	destination=ProjectSettings.globalize_path(destination);DirAccess.make_dir_recursive_absolute(destination)
	for spec in [{"size":256,"spacing":1.0},{"size":512,"spacing":1.0},{"size":512,"spacing":0.4672897196261682},{"size":512,"spacing":77.972412109375},{"size":512,"spacing":1.59765625},{"size":1024,"spacing":0.4726409912109375}]:
		var size:int=spec.size;var spacing:float=spec.spacing
		var terrain=ClassDB.instantiate("Terrain3D");terrain.set("region_size",256);terrain.set("vertex_spacing",spacing);terrain.set("mesh_size",32);terrain.set("mesh_lods",7);terrain.set("collision_mode",0);scene.add_child(terrain);terrain.call("set_camera",camera)
		var heights=PackedFloat32Array();heights.resize(size*size)
		for z in size:
			for x in size:heights[z*size+x]=1000.0+x*.25+z*.5
		var image=Image.create_from_data(size,size,false,Image.FORMAT_RF,heights.to_byte_array())
		var start=-size*.5*spacing;var images:Array[Image]=[image,null,null]
		terrain.get("data").call("import_images",images,Vector3(start,0,start),0.0,1.0)
		var mat=terrain.get("material");mat.set("shader_override",shader);mat.set("shader_override_enabled",true);mat.set("world_background",0);mat.set("show_checkered",false);mat.call("set_shader_param","probe_spacing",spacing);mat.call("set_shader_param","probe_start",start)
		camera.size=100.0*spacing
		for frame in 12:await process_frame
		await RenderingServer.frame_post_draw
		var capture=root.get_texture().get_image();var maximum_red=0.0;var saturated=0;var covered=0;var samples=0
		for z in range(16,496,8):
			for x in range(16,496,8):
				var p=capture.get_pixel(x,z);samples+=1
				if p.g>.99:
					covered+=1;maximum_red=maxf(maximum_red,p.r)
					if p.r>.99:saturated+=1
		var accepted=covered==samples and saturated==0
		if size==256:
			if accepted:failures.append("misaligned256 positive control did not fail")
		elif not accepted:failures.append("rendered plane mismatch at spacing "+str(spacing))
		var filename="%d_%s.png"%[size,str(spacing).replace(".","_")]
		capture.save_png(destination.path_join(filename))
		cases.append({"imageSize":size,"requestedSpacingM":spacing,"nativeSpacingM":terrain.get("vertex_spacing"),"sampleCount":samples,"actualTerrainSamples":covered,"saturatedErrorSamples":saturated,"maximumEncodedRed":maximum_red,"conservativeMaximumErrorM":maximum_red/1000.0 if saturated==0 else null,"alignedPlaneAccepted":accepted,"image":filename})
		terrain.free();await process_frame
	var report={"probe":"actual Terrain3D GPU vertex placement against analytic source plane","godot":Engine.get_version_info().string,"terrain3d":"1.0.2","renderer":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"pinnedMinimumShaderSHA256":FileAccess.get_sha256("res://addons/terrain_3d/extras/shaders/minimum.gdshader"),"probeShaderSHA256":code.sha256_text(),"maximumAllowedErrorM":0.001,"cases":cases,"passed":failures.is_empty(),"failures":failures,"scope":"Pinned minimum vertex shader and production region imports. Flat analytic fixture, no PBR, cities or nonlinear source relief; no CPU get_height as substitute for GPU."}
	var file=FileAccess.open(destination.path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"event":"terrain-gpu-import-proof","passed":report.passed,"failures":failures,"report":destination.path_join("report.json")}));quit(0 if failures.is_empty() else 1)
