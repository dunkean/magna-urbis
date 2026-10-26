extends "res://diagnostics/tree_asset_gpu_probe.gd"
var channel:="coverage"
func coverage_shader(source:Shader)->Shader:
	if channel=="lit":return source
	var text=source.code.replace('"canopy.gdshaderinc"','"res://shaders/canopy.gdshaderinc"').replace('"color_space.gdshaderinc"','"res://shaders/color_space.gdshaderinc"').replace("render_mode cull_disabled;","render_mode cull_disabled,unshaded;")
	if channel=="normal-no-face-flip":text=text.replace("*(FRONT_FACING?1.0:-1.0)","")
	var replacement=""
	match channel:
		"coverage":replacement="ALBEDO=vec3(1.0);"
		"normal","normal-no-face-flip":replacement="ALBEDO=display_color(normalize(mat3(INV_VIEW_MATRIX)*NORMAL)*.5+.5);"
		"face":replacement="ALBEDO=FRONT_FACING?vec3(1,0,0):vec3(0,0,1);"
		"roughness":replacement="ALBEDO=display_color(vec3(ROUGHNESS));"
	if not replacement.is_empty():
		var at=text.rfind("}");text=text.substr(0,at)+replacement+text.substr(at)
	var shader=Shader.new();shader.code=text;return shader
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.has("--check-only"):print("TREE_BRDF_PROBE_PARSE_OK");quit();return
	assert(args.size()==2);assert(library.load_manifest(args[0],true),library.last_error)
	DirAccess.make_dir_recursive_absolute(args[1]);viewport=SubViewport.new();viewport.size=Vector2i(768,768);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color.BLACK;environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR
	environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;environment.environment.ambient_light_color=Color(.5,.5,.5);environment.environment.ambient_light_energy=.3;scene.add_child(environment)
	var sun=DirectionalLight3D.new();sun.rotation_degrees=Vector3(-48,-32,0);sun.light_color=Color(1,.95,.85);sun.light_energy=1.5;sun.shadow_enabled=false;scene.add_child(sun)
	camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=20;camera.position=Vector3(0,100,.0001);scene.add_child(camera);camera.look_at(Vector3.ZERO,Vector3.FORWARD);camera.current=true
	var quad=MeshInstance3D.new();quad.mesh=PlaneMesh.new();quad.mesh.size=Vector2(22,22);var calibration=ShaderMaterial.new();var cshader=Shader.new();cshader.code="shader_type spatial;render_mode unshaded;void fragment(){ALBEDO=vec3(.25,.5,.75);}";calibration.shader=cshader;quad.material_override=calibration;scene.add_child(quad)
	for i in 3:await process_frame
	await RenderingServer.frame_post_draw
	var cal=viewport.get_texture().get_image().get_pixel(384,384);var cal_linear=cal.srgb_to_linear();quad.queue_free();await process_frame
	assert(absf(cal_linear.r-.25)<.005 and absf(cal_linear.g-.5)<.005 and absf(cal_linear.b-.75)<.005,"Readback color space calibration failed")
	var candidate={"stableId":"authored-common-transform-brdf","family":"tree","x":0.0,"y":0.0,"z":0.0,"size":16.194046,"crownRadiusM":6.8014998,"orientation":0.0,"canopyClass":3,"rank":0.0}
	var snapshots={};var summaries={}
	for mode in ["coverage","albedo","normal","normal-no-face-flip","face","roughness","lit"]:
		channel=mode;snapshots[mode]={};summaries[mode]={}
		for product in ["high","impostor"]:
			var mesh=library.high_render_mesh() if product=="high" else library.impostor_render_mesh()
			var image=await draw(mesh,candidate);image.save_png(args[1].path_join(mode+"-"+product+".png"));snapshots[mode][product]=image
	var light=sun.global_basis.z.normalized()
	for mode in snapshots:
		for product in ["high","impostor"]:
			var image:Image=snapshots[mode][product];var mask:Image=snapshots.coverage[product]
			var count=0;var total=Vector3.ZERO;var square=Vector3.ZERO;var normal_sum=Vector3.ZERO;var dot_sum=0.0;var front=0;var below=0
			for y in viewport.size.y:
				for x in viewport.size.x:
					if mask.get_pixel(x,y).r<=.5:continue
					var raw=image.get_pixel(x,y);var c=raw.srgb_to_linear();var rgb=Vector3(c.r,c.g,c.b);count+=1;total+=rgb;square+=rgb*rgb
					if mode=="face" and raw.r>.5:front+=1
					if mode in ["normal","normal-no-face-flip"]:
						var n=(rgb*2.0-Vector3.ONE).normalized();normal_sum+=n;dot_sum+=maxf(n.dot(light),0.0)
						if n.y<0:below+=1
			var mean=total/maxi(count,1);var mean_n=normal_sum/maxi(count,1)
			summaries[mode][product]={"pixels":count,"meanLinearRGB":[mean.x,mean.y,mean.z],"secondMomentRGB":[square.x/maxi(count,1),square.y/maxi(count,1),square.z/maxi(count,1)],"meanNormal":[mean_n.x,mean_n.y,mean_n.z],"normalMeanLength":mean_n.length(),"meanPositiveDotSun":dot_sum/maxi(count,1),"frontPixels":front,"downwardNormalPixels":below}
	var comparisons={}
	for mode in ["albedo","normal","normal-no-face-flip","roughness","lit"]:
		var sum=Vector3.ZERO;var count=0;var angle=0.0
		for y in viewport.size.y:
			for x in viewport.size.x:
				if snapshots.coverage.high.get_pixel(x,y).r<=.5 or snapshots.coverage.impostor.get_pixel(x,y).r<=.5:continue
				var a:Color=snapshots[mode].high.get_pixel(x,y).srgb_to_linear();var b:Color=snapshots[mode].impostor.get_pixel(x,y).srgb_to_linear();var av=Vector3(a.r,a.g,a.b);var bv=Vector3(b.r,b.g,b.b)
				sum+=(av-bv).abs();count+=1
				if mode.begins_with("normal"):angle+=rad_to_deg(acos(clampf((av*2.0-Vector3.ONE).normalized().dot((bv*2.0-Vector3.ONE).normalized()),-1.0,1.0)))
		var mean=sum/maxi(count,1);comparisons[mode]={"commonVisiblePixels":count,"meanAbsoluteLinearRGB":[mean.x,mean.y,mean.z],"meanNormalAngleDegrees":angle/maxi(count,1)}
	var material=[]
	for source in library.high_materials:material.append({"name":source.resource_name,"albedoFactor":source.albedo_color,"roughnessFactor":source.roughness,"roughnessChannel":source.roughness_texture_channel,"normalScale":source.normal_scale,"uvScale":source.uv1_scale,"uvOffset":source.uv1_offset})
	var report={"format":"tree-common-transform-brdf-diagnostic","version":1,"adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method(),"assetDigest":library.cpu.digest,"camera":{"projection":"orthographic-top","widthM":20,"resolution":[768,768],"treeDiameterPixels":2*6.8014998/20*768},"readbackCalibration":{"encoded":[cal.r,cal.g,cal.b],"decodedLinear":[cal_linear.r,cal_linear.g,cal_linear.b]},"lightDirection":[light.x,light.y,light.z],"summaries":summaries,"comparisons":comparisons,"importedMaterial":material,"scope":"Same actual MultiMesh high/impostor transforms. Production shaders with explicit diagnostic channel overrides; fixed neutral ambient plus source sun, linear tone mapping. Direct sky/GI/optical ground shadow not reproduced. Diagnostic, no artistic pass verdict."}
	var file=FileAccess.open(args[1].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null;print(JSON.stringify({"report":args[1].path_join("report.json"),"summaries":summaries,"comparisons":comparisons}));quit()
