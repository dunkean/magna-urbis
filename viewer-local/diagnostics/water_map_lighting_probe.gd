extends SceneTree
const P=preload("res://adapters/surface_water_projection.gd")
var failures:Array=[]
var output=""
func check(ok:bool,label:String):
	if not ok:failures.append(label)
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();output=args[0] if args.size()>0 else "user://water-flat-probe"
	DirAccess.make_dir_recursive_absolute(output)
	var image=Image.create(256,256,false,Image.FORMAT_RGBA8)
	var tint=Color(.2,.45,.7,1.)
	for x in 256:
		var alpha=[0.,.25,.5,1.][x/64]
		var stored=Color(tint.r*alpha,tint.g*alpha,tint.b*alpha,alpha).linear_to_srgb()
		for y in 256:image.set_pixel(x,y,stored)
	image.generate_mipmaps();var source_bytes=image.get_data()
	var source_hash=HashingContext.new();source_hash.start(HashingContext.HASH_SHA256);source_hash.update(source_bytes)
	var projection={"texture":ImageTexture.create_from_image(image),"position":Vector3.ZERO,"size":Vector3(40,100,40)}
	var viewport=SubViewport.new();viewport.size=Vector2i(256,256);viewport.own_world_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	var environment=WorldEnvironment.new();var config=Environment.new();config.background_mode=Environment.BG_COLOR;config.background_color=Color.BLACK;config.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;config.ambient_light_color=Color.WHITE;config.ambient_light_energy=.05;config.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=config;viewport.add_child(environment)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=40.;camera.position=Vector3(0,100,0);viewport.add_child(camera);camera.look_at(Vector3.ZERO,Vector3(0,0,-1));camera.current=true
	var terrain=MeshInstance3D.new();var plane=PlaneMesh.new();plane.size=Vector2(60,60);terrain.mesh=plane;terrain.rotation.z=.25;terrain.layers=1
	var material=StandardMaterial3D.new();material.albedo_color=Color(.5,.5,.5);material.roughness=1.;material.metallic_specular=0.;terrain.material_override=material;viewport.add_child(terrain)
	var roof=MeshInstance3D.new();var box=BoxMesh.new();box.size=Vector3(5,1,5);roof.mesh=box;roof.position=Vector3(12,8,-8);roof.layers=2;var red=StandardMaterial3D.new();red.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED;red.albedo_color=Color.RED;roof.material_override=red;viewport.add_child(roof)
	var sun=DirectionalLight3D.new();sun.light_energy=1.;sun.shadow_enabled=false;viewport.add_child(sun)
	var cases:Array=[];var captures={}
	for direction in [-55.,55.]:
		sun.rotation_degrees=Vector3(-40,direction,0)
		for mode in ["none","default","terrain","flat-map"]:
			var options={} if mode=="default" else {"mapLighting":mode}
			var decal=P.create_decal(projection,{},options) if mode!="none" else null
			if decal!=null:viewport.add_child(decal)
			for frame in 6:await process_frame
			await RenderingServer.frame_post_draw
			var capture=viewport.get_texture().get_image();var key=str(int(direction))+"-"+mode;captures[key]=capture.get_data();capture.save_png(output+"/"+key+".png")
			var pixels=[]
			for x in [32,96,160,224]:
				var value=capture.get_pixel(x,180);pixels.append([value.r,value.g,value.b])
			var roof_at=camera.unproject_position(roof.position);var roof_pixel=capture.get_pixel(int(roof_at.x),int(roof_at.y))
			check(roof_pixel.r>.95 and roof_pixel.g<.01 and roof_pixel.b<.01,"roof excluded "+key)
			cases.append({"key":key,"pixels":pixels,"roofRGB":[roof_pixel.r,roof_pixel.g,roof_pixel.b]})
			if decal!=null:decal.queue_free()
			await process_frame
		check(captures[str(int(direction))+"-default"]==captures[str(int(direction))+"-terrain"],"default terrain byte exact "+str(direction))
	var flat_a:Image=Image.create_from_data(256,256,false,Image.FORMAT_RGBA8,captures["-55-flat-map"])
	var flat_b:Image=Image.create_from_data(256,256,false,Image.FORMAT_RGBA8,captures["55-flat-map"])
	var alpha_error=0.
	for direction in [-55,55]:
		var baseline=Image.create_from_data(256,256,false,Image.FORMAT_RGBA8,captures[str(direction)+"-none"])
		var flat=Image.create_from_data(256,256,false,Image.FORMAT_RGBA8,captures[str(direction)+"-flat-map"])
		for x in [32,96,160,224]:
			var source=image.get_pixel(x,180);var emission=source.srgb_to_linear();var base=baseline.get_pixel(x,180).srgb_to_linear()
			var expected=Color(base.r*(1-source.a)+emission.r,base.g*(1-source.a)+emission.g,base.b*(1-source.a)+emission.b).linear_to_srgb()
			var actual=flat.get_pixel(x,180)
			alpha_error=maxf(alpha_error,maxf(absf(actual.r-expected.r),maxf(absf(actual.g-expected.g),absf(actual.b-expected.b))))
	check(alpha_error<=4./255.,"alpha applies once, no alpha squared")
	var interior_delta=0.
	for y in range(150,210):
		for x in range(200,240):
			var a=flat_a.get_pixel(x,y);var b=flat_b.get_pixel(x,y)
			interior_delta=maxf(interior_delta,maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b))))
	check(interior_delta<=2./255.,"opaque flat interior independent of sun")
	check(image.get_data()==source_bytes,"source RGBA unchanged")
	var report={"format":"source-water-map-lighting-probe","version":1,"scope":"authored inclined receiver and alpha ramp, no source hydrology or terrain edited; zero receiver specular isolates proposed albedo/emission mechanism","failures":failures,"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"sourceSha256":source_hash.finish().hex_encode(),"cases":cases,"flatAlphaCompositeMaxError":alpha_error,"flatOpaqueSunDelta":interior_delta,"sourceUnchanged":image.get_data()==source_bytes,"diagnostics":projection.diagnostics}
	var file=FileAccess.open(output+"/report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
