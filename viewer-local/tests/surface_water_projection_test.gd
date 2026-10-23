extends SceneTree
const P=preload("res://adapters/surface_water_projection.gd")
var failures: Array=[]
func check(ok: bool, label: String):
	if not ok:failures.append(label)
func _initialize():call_deferred("run")
func run():
	var vertices=PackedVector3Array([Vector3(-10,-20,-10),Vector3(10,-20,10),Vector3(10,-20,-10),Vector3(-10,-20,-10),Vector3(-10,-20,10),Vector3(10,-20,10)])
	var classes=Image.create(2,2,false,Image.FORMAT_RF);classes.fill(Color(2,0,0))
	var geometry={"vertices":vertices,"anchor":{"x":1000000100.,"y":0.,"z":1000000200.},"authority":"synthetic-test-only","sourceVectorAreaM2":400.,"classImage":classes,"classOrigin":{"x":1000000090.,"z":1000000190.},"classSpacingM":20.,"classSize":Vector2i(2,2)}
	var origin=geometry.anchor;var focus={"x":origin.x,"y":origin.z};var colors={"lake":Vector3(.1,.2,.8),"river":Vector3(.8,.1,.1),"sea":Vector3(.1,.8,.1)}
	var options={"sourceKey":"explicit-synthetic-control","resolution":256,"minHeightM":-30.,"maxHeightM":30.}
	var snapshot=hash(geometry);var saved_classes=classes.get_data();var key=P.cache_key(geometry,focus,40.,colors,options)
	var changed=colors.duplicate();changed.lake=Vector3(.8,.1,.1)
	check(key!=P.cache_key(geometry,focus,40.,changed,options),"cache includes palette")
	changed=options.duplicate();changed.resolution=512
	check(key!=P.cache_key(geometry,focus,40.,colors,changed),"cache includes output resolution")
	var projection=await P.bake(root,geometry,origin,focus,40.,colors,options)
	if projection.has("error"):push_error(str(projection));quit(1);return
	check(hash(geometry)==snapshot and classes.get_data()==saved_classes,"source triangles levels and class image unchanged")
	var baked=projection.texture.get_image();var center=baked.get_pixel(128,128);var expected=Color(.1,.2,.8).linear_to_srgb()
	var error=maxf(absf(center.r-expected.r),maxf(absf(center.g-expected.g),absf(center.b-expected.b)))
	check(error<=2./255.,"baked class tint matches declared linear input")
	check(center.a>.99 and baked.get_pixel(5,5).a<.001,"source contour coverage baked as transparent alpha")
	var rebased=P.create_decal(projection,{"x":1000000099.,"y":1.,"z":1000000199.})
	check(rebased.position==Vector3(1,-1,1),"canonical double coordinates rebased before Vector3")
	check(rebased.cull_mask==1,"Decal only targets terrain layer1");rebased.free()
	var vp=SubViewport.new();vp.size=Vector2i(256,256);vp.own_world_3d=true;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(vp)
	var environment=WorldEnvironment.new();var config=Environment.new();config.background_mode=Environment.BG_COLOR;config.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;config.ambient_light_color=Color.WHITE;config.ambient_light_energy=1.;config.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=config;vp.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=40.;camera.position=Vector3(0,100,0);vp.add_child(camera);camera.look_at(Vector3.ZERO,Vector3(0,0,-1));camera.current=true
	var terrain=MeshInstance3D.new();var plane=PlaneMesh.new();plane.size=Vector2(40,40);terrain.mesh=plane;terrain.layers=1;var material=StandardMaterial3D.new();material.albedo_color=Color(.4,.4,.4);material.roughness=1.;material.metallic_specular=0.;terrain.material_override=material;vp.add_child(terrain)
	vp.add_child(P.create_decal(projection,origin))
	var roof=MeshInstance3D.new();var box=BoxMesh.new();box.size=Vector3(8,1,8);roof.mesh=box;roof.position=Vector3(0,10,0);roof.layers=2;var red=StandardMaterial3D.new();red.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED;red.albedo_color=Color.RED;roof.material_override=red;vp.add_child(roof)
	for frame in 4:await process_frame
	await RenderingServer.frame_post_draw
	var image=vp.get_texture().get_image();var roof_pixel=image.get_pixel(128,128);var water_pixel=image.get_pixel(175,128)
	check(roof_pixel.r>.95 and roof_pixel.b<.01,"terrain-only projection never paints the roof")
	check(water_pixel.b>water_pixel.r+.2,"original below-bed water projects onto terrain")
	var report={"failures":failures,"adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method(),"bakedTintMaxError":error,"roofRGB":[roof_pixel.r,roof_pixel.g,roof_pixel.b],"projectedWaterRGB":[water_pixel.r,water_pixel.g,water_pixel.b],"sourceUnchanged":hash(geometry)==snapshot,"projection":projection.diagnostics,"scope":"synthetic below-bed/class-tint/large-coordinate/roof exclusion control for production projection module; real regional contours validated separately"}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():
		var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));image.save_png(args[0].get_basename()+".png")
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
