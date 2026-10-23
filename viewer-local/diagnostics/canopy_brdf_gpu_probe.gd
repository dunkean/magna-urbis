extends SceneTree
const Canopy=preload("res://adapters/surface_canopy.gd")
func _initialize():call_deferred("run")
func run():
	root.size=Vector2i(1024,512);var scene=Node3D.new();root.add_child(scene)
	var env=WorldEnvironment.new();var settings=Environment.new();settings.background_mode=Environment.BG_COLOR;settings.background_color=Color(.05,.05,.05);settings.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;settings.ambient_light_color=Color(1,1,1);settings.ambient_light_energy=.4;settings.tonemap_mode=Environment.TONE_MAPPER_LINEAR;env.environment=settings;scene.add_child(env)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=20;camera.near=.1;camera.far=100;camera.position=Vector3(0,50,0);scene.add_child(camera);camera.look_at(Vector3.ZERO,Vector3.FORWARD)
	var sun=DirectionalLight3D.new();sun.rotation_degrees=Vector3(-48,-32,0);sun.light_energy=1.5;sun.shadow_enabled=false;scene.add_child(sun)
	var native=MeshInstance3D.new();var sphere=SphereMesh.new();sphere.radius=.42;sphere.height=1.0;sphere.radial_segments=32;sphere.rings=6;native.mesh=sphere;native.position=Vector3(-10,8.64,0);native.scale=Vector3(12,7.92,12);var native_mat=ShaderMaterial.new();native_mat.shader=load("res://shaders/canopy_instance.gdshader");native_mat.set_shader_parameter("canopy_footprint_override_m",.25);native.material_override=native_mat;scene.add_child(native)
	var packet={"candidateBounds":{"minX":0.0,"minZ":0.0,"maxX":64.0,"maxZ":64.0},"candidates":[{"stableId":"authored-one-tree","family":"tree","x":32.0,"z":32.0,"y":0.0,"size":12.0,"crownRadiusM":5.04,"rank":0.0}]};var atlas=Canopy.prepare(packet,{})
	var plane=MeshInstance3D.new();var shape=PlaneMesh.new();shape.size=Vector2(10.08,10.08);plane.mesh=shape;plane.position=Vector3(10,0,0);scene.add_child(plane)
	var shader=Shader.new();shader.code='shader_type spatial;\n#include "res://shaders/canopy.gdshaderinc"\n#include "res://shaders/color_space.gdshaderinc"\nuniform float normal_depth=1.0;varying vec2 p;void vertex(){p=(MODEL_MATRIX*vec4(VERTEX,1)).xz-vec2(10,0)+vec2(32); }void fragment(){vec2 radial=(p-vec2(32))/5.04;if(dot(radial,radial)>1.0)discard;vec3 n=surface_canopy_normal(p,.25,0.0);NORMAL=(VIEW_MATRIX*vec4(0,1,0,0)).xyz;TANGENT=(VIEW_MATRIX*vec4(1,0,0,0)).xyz;BINORMAL=(VIEW_MATRIX*vec4(0,0,-1,0)).xyz;NORMAL_MAP=vec3(n.x,-n.z,n.y)*.5+.5;NORMAL_MAP_DEPTH=normal_depth;ALBEDO=display_color(vec3(.055,.105,.036));ROUGHNESS=.91;}'
	var proxy=ShaderMaterial.new();proxy.shader=shader;proxy.set_shader_parameter("canopy_enabled",true);proxy.set_shader_parameter("canopy_normals_enabled",true);proxy.set_shader_parameter("canopy_normals",ImageTexture.create_from_image(atlas.normalImage));proxy.set_shader_parameter("canopy_origin",Vector2(atlas.origin.x,atlas.origin.z));proxy.set_shader_parameter("canopy_grid_size",atlas.gridSize);proxy.set_shader_parameter("canopy_spacing_m",atlas.spacingM);proxy.set_shader_parameter("canopy_bounds",Vector4(0,0,64,64));proxy.set_shader_parameter("canopy_fallback_blend_m",atlas.fallbackBlendM);plane.material_override=proxy
	var instanced=MultiMeshInstance3D.new();var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_custom_data=true;multi.mesh=sphere;multi.instance_count=1;multi.set_instance_transform(0,Transform3D(Basis.from_scale(Vector3(12,7.92,12)),Vector3(-10,8.64,0)));multi.set_instance_custom_data(0,Color(0,0,0,0));instanced.multimesh=multi;instanced.material_override=native_mat;instanced.visible=false;scene.add_child(instanced)
	var results=[];var after_mean=0.0;var native_reference:Image
	var multimesh_mean_error=0.0;var multimesh_max_error=0.0
	for depth in [.75,1.0,2.0]:
		if depth==2.0:native.visible=false;instanced.visible=true
		else:native.visible=true;instanced.visible=false
		proxy.set_shader_parameter("normal_depth",minf(depth,1.0))
		for i in 5:await process_frame
		await RenderingServer.frame_post_draw
		var image=root.get_texture().get_image()
		if depth==1.0:native_reference=image.duplicate()
		if depth==2.0:
			var channels=0
			for py in range(512):
				for px in range(512):
					var a=image.get_pixel(px,py);var b=native_reference.get_pixel(px,py);var d=Vector3(absf(a.r-b.r),absf(a.g-b.g),absf(a.b-b.b))*255;multimesh_mean_error+=d.x+d.y+d.z;multimesh_max_error=maxf(multimesh_max_error,maxf(d.x,maxf(d.y,d.z)));channels+=3
			multimesh_mean_error/=channels
		var total=0.0;var maximum=0.0;var count=0
		for py in range(512):
			for dx in range(-110,111):
				var dz=float(py)+.5-256.0
				if Vector2(float(dx)+.5,dz).length()>5.04*.85*25.6:continue
				var a=image.get_pixel(256+dx,py);var b=image.get_pixel(768+dx,py)
				var difference=Vector3(absf(a.r-b.r),absf(a.g-b.g),absf(a.b-b.b))*255;total+=difference.x+difference.y+difference.z;maximum=maxf(maximum,maxf(difference.x,maxf(difference.y,difference.z)));count+=3
		var mean=total/count;results.append({"normalMapDepth":minf(depth,1.0),"nativeRenderer":"MultiMeshInstance3D" if depth==2.0 else "MeshInstance3D","meanByteError":mean,"maximumByteError":maximum,"comparedChannels":count})
		if depth==1.0:after_mean=mean
		var args=OS.get_cmdline_user_args()
		if not args.is_empty():image.save_png(args[0]+"-depth"+str(depth)+".png")
	var report={"passed":after_mean<3.0 and after_mean<float(results[0].meanByteError) and multimesh_max_error<=1.0,"meshVsMultiMeshMeanByteError":multimesh_mean_error,"meshVsMultiMeshMaximumByteError":multimesh_max_error,"results":results,"scope":"Independent actual production SphereMesh radius.42 height1 scale(12,7.92,12), versus production exact crown-normal atlas on a flat receiver. Same footprint, tint, BRDF and lighting; shadows disabled to isolate normals/illumination. Core radius85percent excludes silhouette tessellation.","normalTransform":"explicit inverse transpose of full MODEL_MATRIX for nonuniform instance scale","adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method()}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if report.passed else 1)
