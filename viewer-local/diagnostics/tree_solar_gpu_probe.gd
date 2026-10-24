extends SceneTree
const Assets=preload("res://adapters/surface_tree_library.gd")
const Solar=preload("res://adapters/surface_tree_solar.gd")
var viewport:SubViewport
var scene:Node3D
var camera:Camera3D
var sunlight:DirectionalLight3D
var plane:MeshInstance3D
var library=Assets.new()
var output=""
func _initialize()->void:call_deferred("run")
func frame_image()->Image:
	for i in 4:await process_frame
	await RenderingServer.frame_post_draw
	return viewport.get_texture().get_image()
func native_high(candidate:Dictionary)->MultiMeshInstance3D:
	var mesh:Mesh=library.high_mesh.duplicate()
	for i in library.high_materials.size():
		var material:StandardMaterial3D=library.high_materials[i].duplicate();material.cull_mode=BaseMaterial3D.CULL_DISABLED
		mesh.surface_set_material(i,material)
	var node=MultiMeshInstance3D.new();var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_custom_data=true;multi.use_colors=true;multi.mesh=mesh;multi.instance_count=1;multi.buffer=Assets.instance_buffer([candidate],{"x":0,"y":0,"z":0});node.multimesh=multi;node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY;return node
func mask_compare(bare:Image,a:Image,b:Image)->Dictionary:
	var na=0;var nb=0;var both=0;var any=0;var changed=0;var err=0.0
	for y in bare.get_height():
		for x in bare.get_width():
			var base=bare.get_pixel(x,y).srgb_to_linear();var ca=a.get_pixel(x,y).srgb_to_linear();var cb=b.get_pixel(x,y).srgb_to_linear()
			var ha=base.r-ca.r>.04;var hb=base.r-cb.r>.04
			if ha:na+=1
			if hb:nb+=1
			if ha and hb:both+=1
			if ha or hb:any+=1;err+=absf(ca.r-cb.r)
			if ha!=hb:changed+=1
	return {"referenceShadowPixels":na,"solarShadowPixels":nb,"IoU":float(both)/maxi(any,1),"maskDifferentPixels":changed,"meanAbsoluteLinearReceiverErrorOverUnion":err/maxi(any,1)}
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.has("--check-only"):print("TREE_SOLAR_PROBE_PARSE_OK");quit();return
	var offscreen=args.has("--offscreen");args.erase("--offscreen")
	assert(args.size()==2);output=args[1];DirAccess.make_dir_recursive_absolute(output)
	assert(library.load_manifest(args[0],true),library.last_error)
	viewport=SubViewport.new();viewport.size=Vector2i(1024,1024);viewport.own_world_3d=true;viewport.msaa_3d=Viewport.MSAA_4X;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color(.2,.2,.2);environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;environment.environment.ambient_light_color=Color.WHITE;environment.environment.ambient_light_energy=.15;scene.add_child(environment)
	plane=MeshInstance3D.new();plane.mesh=PlaneMesh.new();plane.mesh.size=Vector2(100,100);var material=StandardMaterial3D.new();material.albedo_color=Color(.65,.65,.65);material.roughness=1;plane.material_override=material;plane.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF;scene.add_child(plane)
	camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=10 if offscreen else 50;camera.near=.1;camera.far=200;camera.position=Vector3(0,90,.0001);scene.add_child(camera);camera.look_at(Vector3.ZERO,Vector3.FORWARD);camera.current=true
	sunlight=DirectionalLight3D.new();sunlight.shadow_enabled=true;sunlight.directional_shadow_mode=DirectionalLight3D.SHADOW_ORTHOGONAL;sunlight.directional_shadow_max_distance=180;sunlight.shadow_bias=.01;sunlight.shadow_normal_bias=.1;sunlight.light_energy=1;scene.add_child(sunlight)
	var candidate={"stableId":"authored-source-alpha-solar-control","family":"tree","x":0.0,"y":1.0,"z":0.0,"size":12.0,"crownRadiusM":5.04,"orientation":5.0*TAU/32.0,"rank":.271,"canopyClass":2}
	if offscreen:candidate.merge({"x":-9.0,"z":18.0,"size":18.0,"crownRadiusM":7.56},true)
	var support=Assets.transformed_support(candidate,{"x":0,"y":0,"z":0},library.high_mesh.get_aabb())
	var source_support_intersects=Assets.intersects_frustum(support,camera.get_frustum())
	if offscreen:assert(not source_support_intersects,"Offscreen control must exclude the whole source high AABB, not just its centre")
	var data={"count":1,"values":PackedFloat64Array([candidate.x,candidate.y,candidate.z,candidate.size,candidate.orientation,candidate.rank])}
	var rows=[]
	for angle in [Vector3(-48,-32,0)] if offscreen else [Vector3(-48,-32,0),Vector3(-30,75,0)]:
		sunlight.rotation_degrees=angle
		var solar=Solar.new();assert(await solar.bake(scene,library,sunlight.global_basis.z),"solar bake failed")
		for receiver in [Vector2(0,0),Vector2(.25,0),Vector2(0,8),Vector2(.25,8)]:
			var slope=receiver.x;plane.rotation.z=slope;plane.position.y=receiver.y
			var baseline=await frame_image()
			var actual=native_high(candidate);scene.add_child(actual);var high=await frame_image();actual.queue_free();await process_frame
			var proxy=solar.create_node(data,{"x":0,"y":0,"z":0});scene.add_child(proxy);var shader:ShaderMaterial=proxy.multimesh.mesh.surface_get_material(0);shader.set_shader_parameter("solar_weight",1)
			var image=await frame_image()
			shader.set_shader_parameter("solar_depth_enabled",false);var planar=await frame_image();proxy.queue_free();await process_frame
			var index=rows.size();baseline.save_png(output.path_join(str(index)+"-bare.png"));high.save_png(output.path_join(str(index)+"-high-shadow.png"));image.save_png(output.path_join(str(index)+"-solar-depth.png"));planar.save_png(output.path_join(str(index)+"-solar-planar-negative.png"))
			rows.append({"sunRotationDegrees":[angle.x,angle.y,angle.z],"receiverSlopeRadians":slope,"receiverHeightM":receiver.y,"depth":mask_compare(baseline,high,image),"planarNegative":mask_compare(baseline,high,planar),"bake":solar.descriptor})
	var report={"version":1,"adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method(),"assetDigest":library.cpu.digest,"rows":rows,"wholeSourceHighAabbIntersectsCameraFrustum":source_support_intersects,"sourcePlacement":"authored one tree using actual CC0 product, exact yawbin centre","scope":"actual native shadow-only MultiMesh and source high shadow; same unmodified receiving mesh/sun/camera; no terrain-world campaign"}
	var file=FileAccess.open(output.path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify(report));quit()
