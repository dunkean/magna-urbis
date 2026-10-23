extends SceneTree
# Standalone diagnostic: native clipmap vertex-hole clipping versus fragment
# rectangle clipping. Same imported heights, image origin, bounds and camera.
# Does not change production controls, shaders or any retained source relief.
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.has("--check-only"):
		print(JSON.stringify({"Terrain3DAvailable":ClassDB.class_exists("Terrain3D")}));quit();return
	if not ClassDB.class_exists("Terrain3D") or DisplayServer.get_name()=="headless":push_error("Native Terrain3D and GPU renderer required");quit(2);return
	var output=ProjectSettings.globalize_path(args[0] if not args.is_empty() else "res://captures/boundary-holes")
	DirAccess.make_dir_recursive_absolute(output)
	root.size=Vector2i(2048,2048)
	var scene=Node3D.new();root.add_child(scene)
	var environment=WorldEnvironment.new();var settings=Environment.new();settings.background_mode=Environment.BG_COLOR;settings.background_color=Color.BLACK;settings.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=settings;scene.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=40000.;camera.position=Vector3(0,50000,.0001);camera.near=1.;camera.far=100000.;scene.add_child(camera);camera.look_at(Vector3(0,1000,0),Vector3.FORWARD);camera.current=true
	var minimum=FileAccess.get_file_as_string("res://addons/terrain_3d/extras/shaders/minimum.gdshader").replace("\r","")
	var anchor="ALBEDO = vec3(.2);\n\tROUGHNESS = .7;"
	if minimum.count(anchor)!=1:push_error("Pinned minimum fragment anchor missing");quit(2);return
	var code=minimum.replace("render_mode blend_mix,","render_mode unshaded,blend_mix,")
	code=code.replace("// Public Uniforms","uniform bool probe_fragment_clip=false; uniform float probe_half_width=19960.0;\n// Public Uniforms")
	code=code.replace(anchor,"if(probe_fragment_clip && (any(lessThan(v_vertex.xz,vec2(-probe_half_width))) || any(greaterThan(v_vertex.xz,vec2(probe_half_width))))) discard; ALBEDO=vec3(clamp(abs(v_vertex.y-1000.0)*1000.0,0.0,1.0),1.0,0.0); ROUGHNESS=1.0; SPECULAR=0.0;")
	var shader=Shader.new();shader.code=code
	var reports=[];var spacing=77.972412109375;var size=1024;var start=-512.*spacing
	var heights=PackedFloat32Array();heights.resize(size*size);heights.fill(1000.)
	var height_image=Image.create_from_data(size,size,false,Image.FORMAT_RF,heights.to_byte_array())
	var height_sha=height_image.get_data().hex_encode().sha256_text()
	var hole_bits=PackedByteArray([4,0,0,0]).decode_float(0)
	for half_width in [19960.0,19960.9375]:
		for holes in [true,false]:
			var controls=Image.create(size,size,false,Image.FORMAT_RF)
			if holes:
				for z in size:
					for x in size:
						var wx=start+x*spacing;var wz=start+z*spacing
						if absf(wx)>half_width or absf(wz)>half_width:controls.set_pixel(x,z,Color(hole_bits,0,0,1))
			var terrain=ClassDB.instantiate("Terrain3D");terrain.set("region_size",256);terrain.set("vertex_spacing",spacing);terrain.set("mesh_size",32);terrain.set("mesh_lods",10);terrain.set("collision_mode",0);scene.add_child(terrain);terrain.call("set_camera",camera)
			var images:Array[Image]=[height_image,controls,null];terrain.get("data").call("import_images",images,Vector3(start,0,start),0.,1.)
			var mat=terrain.get("material");mat.set("shader_override",shader);mat.set("shader_override_enabled",true);mat.set("world_background",0);mat.set("show_checkered",false);mat.call("set_shader_param","probe_fragment_clip",not holes);mat.call("set_shader_param","probe_half_width",half_width)
			for frame in 12:await process_frame
			await RenderingServer.frame_post_draw
			var image=root.get_texture().get_image();var row_reports=[];var maximum_error=0.;var missing=0;var actual_count=0;var expected_count=0
			for y in [512,768,1024,1280,1536]:
				var first=2048;var last=-1;var expected_first=2048;var expected_last=-1
				for x in 2048:
					var wx=(x+.5)/2048.*40000.-20000.;var wz=(y+.5)/2048.*40000.-20000.;var expected=absf(wx)<=half_width and absf(wz)<=half_width
					if expected:expected_count+=1;expected_first=mini(expected_first,x);expected_last=maxi(expected_last,x)
					var pixel=image.get_pixel(x,y);var actual=pixel.g>.99
					if actual:actual_count+=1;first=mini(first,x);last=maxi(last,x);maximum_error=maxf(maximum_error,pixel.r)
					if expected and not actual:missing+=1
				row_reports.append({"yPx":y,"actualFirstPx":first,"actualLastPx":last,"expectedFirstPx":expected_first,"expectedLastPx":expected_last,"westInsetPx":first-expected_first,"eastInsetPx":expected_last-last})
			var name=("holes" if holes else "fragment")+"_"+str(half_width).replace(".","_")+".png";image.save_png(output.path_join(name))
			reports.append({"halfWidthM":half_width,"offDomainVertexHoles":holes,"exactFragmentClip":not holes,"spacingM":spacing,"nativeSpacingM":terrain.get("vertex_spacing"),"imageSize":size,"imageStartM":start,"meshSize":32,"meshLods":10,"importedHeightBytesUnchanged":height_sha==height_image.get_data().hex_encode().sha256_text(),"maximumEncodedHeightError":maximum_error,"missingExpectedSamples":missing,"actualSamples":actual_count,"expectedSamples":expected_count,"rows":row_reports,"image":name})
			terrain.free();await process_frame
	var report={"adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method(),"pinnedMinimumShaderSHA256":minimum.sha256_text(),"cases":reports,"scope":"synthetic constant-height native clipmap boundary diagnostic; not a replay of the actual V5 source or proof of its screenshot cause"}
	var file=FileAccess.open(output.path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));quit()
