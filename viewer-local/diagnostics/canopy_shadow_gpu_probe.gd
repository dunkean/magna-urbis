extends SceneTree
const Canopy=preload("res://adapters/surface_canopy.gd")
func _initialize():call_deferred("run")
func run():
	root.size=Vector2i(1024,512)
	var scene=Node3D.new();root.add_child(scene)
	var environment=WorldEnvironment.new();var config=Environment.new();config.background_mode=Environment.BG_COLOR;config.background_color=Color.BLACK;config.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;config.ambient_light_color=Color(.5,.6,.8);config.ambient_light_energy=.35;config.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=config;scene.add_child(environment)
	var sun=DirectionalLight3D.new();sun.rotation_degrees=Vector3(-48,-32,0);sun.light_energy=1.5;sun.shadow_enabled=true;sun.directional_shadow_max_distance=100;scene.add_child(sun)
	var offset=Canopy.shadow_offset(sun.global_basis.z)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=30;camera.near=.1;camera.far=100;camera.position=Vector3(0,50,0);scene.add_child(camera);camera.look_at(Vector3.ZERO,Vector3.FORWARD)
	var plane=MeshInstance3D.new();var shape=PlaneMesh.new();shape.size=Vector2(60,30);plane.mesh=shape;scene.add_child(plane)
	var shader=Shader.new();shader.code='shader_type spatial;varying vec2 p;uniform vec2 shadow_offset;void vertex(){p=(MODEL_MATRIX*vec4(VERTEX,1.0)).xz;}void fragment(){float shadow=p.x>0.0?1.0-smoothstep(4.9,5.1,length(p-vec2(15.0,0.0)-shadow_offset)):0.0;ALBEDO=vec3(.4)*mix(vec3(1.0),vec3(.25,.34,.50),shadow);ROUGHNESS=1.0;}'
	var material=ShaderMaterial.new();material.shader=shader;material.set_shader_parameter("shadow_offset",offset);plane.material_override=material
	var crown=MeshInstance3D.new();var sphere=SphereMesh.new();sphere.radius=5;sphere.height=10;crown.mesh=sphere;crown.position=Vector3(-15,8,0);var crown_material=StandardMaterial3D.new();crown_material.albedo_color=Color(.055,.105,.036);crown.material_override=crown_material;scene.add_child(crown)
	for i in 8:await process_frame
	await RenderingServer.frame_post_draw
	var image=root.get_texture().get_image();var reference=image.get_pixel(64,64).srgb_to_linear();var reference_y=(reference.r+reference.g+reference.b)/3;var centres=[]
	for centre_x in [-15.0,15.0]:
		var weighted=Vector2.ZERO;var mass=0.0
		for py in range(4,508,2):
			for px in range(4,1020,2):
				var p=Vector2((float(px)+.5)/1024.0*60.0-30.0,(float(py)+.5)/512.0*30.0-15.0)
				if absf(p.x-centre_x)>13.0 or p.distance_to(Vector2(centre_x,0))<5.5:continue
				var rgb=image.get_pixel(px,py).srgb_to_linear();var weight=maxf(0,reference_y-(rgb.r+rgb.g+rgb.b)/3)
				weighted+=(p-Vector2(centre_x,0))*weight;mass+=weight
		centres.append(weighted/maxf(mass,.000001))
	var cosine=centres[0].normalized().dot(centres[1].normalized());var expected=offset.normalized();var report={"passed":cosine>.95 and centres[0].normalized().dot(expected)>.95,"nativeShadowCentroid":[centres[0].x,centres[0].y],"proxyShadowCentroid":[centres[1].x,centres[1].y],"nativeProxyDirectionCosine":cosine,"sourceShadowOffsetM":[offset.x,offset.y],"authoredCrownCentreHeightM":8,"scope":"Orientation only: actual Godot sphere caster versus renderer-only shifted optical disc on a flat receiver; not height/energy/penumbra equivalence","backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name()}
	# Observe a caster close up while its declared MAIN camera has subpixel crowns.
	# The directional cascade still resolves the object, so this exercises shadows.
	var production=ShaderMaterial.new();production.shader=load("res://shaders/canopy_instance.gdshader")
	var reference_camera=Camera3D.new();reference_camera.projection=Camera3D.PROJECTION_ORTHOGONAL;reference_camera.size=10000;reference_camera.position=Vector3(0,50,0);scene.add_child(reference_camera);reference_camera.look_at(Vector3.ZERO,Vector3.FORWARD);reference_camera.current=false;camera.current=true
	production.set_shader_parameter("canopy_geometry_weight",1.0)
	production.set_shader_parameter("canopy_main_camera_enabled",true)
	production.set_shader_parameter("canopy_main_camera_vp",reference_camera.get_camera_projection()*Projection(reference_camera.get_camera_transform().affine_inverse()))
	production.set_shader_parameter("canopy_main_viewport_size",Vector2(1024,512));production.set_shader_parameter("canopy_reference_y",0.0)
	crown.material_override=production
	for i in 5:await process_frame
	await RenderingServer.frame_post_draw
	var hidden=root.get_texture().get_image();crown.visible=false
	for i in 5:await process_frame
	await RenderingServer.frame_post_draw
	var absent=root.get_texture().get_image();var hidden_error=0
	var hidden_data=hidden.get_data();var absent_data=absent.get_data()
	for i in hidden_data.size():hidden_error=maxi(hidden_error,absi(int(hidden_data[i])-int(absent_data[i])))
	crown.visible=true;production.set_shader_parameter("canopy_main_camera_enabled",false)
	for i in 5:await process_frame
	await RenderingServer.frame_post_draw
	var control=root.get_texture().get_image();var control_changed=0
	for y in range(0,512,2):
		for x in range(0,1024,2):
			if (Vector3(control.get_pixel(x,y).r,control.get_pixel(x,y).g,control.get_pixel(x,y).b)-Vector3(absent.get_pixel(x,y).r,absent.get_pixel(x,y).g,absent.get_pixel(x,y).b)).length()>.01:control_changed+=1
	report["mainCameraShadowTest"]={"mainCameraWidthM":20000,"mainViewportWidth":1024,"observerWidthM":60,"maximumHiddenCasterByteError":hidden_error,"controlVisibleCasterChangedSamples":control_changed,"scope":"Production canopy shader, common main-camera uniforms in colour and real shadow pass; close observer resolves hidden geometry/shadow versus absent-caster image"}
	report.passed=report.passed and hidden_error==0 and control_changed>100
	report["sourceShaderSha256"]=FileAccess.get_sha256("res://shaders/canopy_instance.gdshader")
	report["canopyIncludeSha256"]=FileAccess.get_sha256("res://shaders/canopy.gdshaderinc")
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));image.save_png(args[0]+".png");hidden.save_png(args[0]+"-hidden.png");absent.save_png(args[0]+"-absent.png");control.save_png(args[0]+"-control.png")
	print(JSON.stringify(report));quit(0 if report.passed else 1)
