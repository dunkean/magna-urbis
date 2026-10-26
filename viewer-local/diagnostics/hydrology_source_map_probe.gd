extends SceneTree
# Standalone GPU A/B: actual retained source contours and levels, top-down10km.
# Terrain is a CPU reconstruction of the packet, not a Terrain3D/addon claim.
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_geometry.gd")
const H=preload("res://adapters/surface_hydrology.gd")
func _initialize(): call_deferred("run")
func mesh_for(points: PackedVector3Array) -> ArrayMesh:
	var arrays=[];arrays.resize(Mesh.ARRAY_MAX);arrays[Mesh.ARRAY_VERTEX]=points
	var mesh=ArrayMesh.new();mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays);return mesh
func water_pixels(image: Image) -> int:
	var count=0
	for z in image.get_height():
		for x in image.get_width():
			var c=image.get_pixel(x,z)
			if c.b>c.r+0.1 and c.b>0.2:count+=1
	return count
func capture(viewport: SubViewport, path: String) -> Image:
	for frame in 3:await process_frame
	await RenderingServer.frame_post_draw
	var image=viewport.get_texture().get_image();image.save_png(path);return image
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()<3:push_error("Required packet output-directory actual-physical-shader-path");quit(2);return
	DirAccess.make_dir_recursive_absolute(args[1])
	var packet=D.read_json(args[0]);var world=D.unpack_world(packet)
	world["_terrainParents"]=packet.get("terrainParents",[]);world["_heightLayers"]=G.prepare_height_layers(world)
	var source_hash=hash(packet.source)
	var anchor={"x":20000.,"y":0.,"z":20000.};var focus={"x":20000.,"y":20000.}
	var water=H.prepare(packet,world,anchor,focus,10000.,G.build_water(world,anchor,focus,10000.))
	if water.get("authority")!="magna-urbis-fixed-hydrology":push_error("Source vector fallback: "+str(water));quit(1);return
	var vp=SubViewport.new();vp.size=Vector2i(1024,1024);vp.own_world_3d=true;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(vp)
	var env=WorldEnvironment.new();var settings=Environment.new();settings.background_mode=Environment.BG_COLOR;settings.background_color=Color(0.2,0.2,0.2);settings.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;settings.ambient_light_color=Color.WHITE;settings.ambient_light_energy=1.;settings.tonemap_mode=Environment.TONE_MAPPER_LINEAR;env.environment=settings;vp.add_child(env)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=10000.;camera.position=Vector3(0,10000,0);camera.far=20000.;vp.add_child(camera);camera.look_at(Vector3.ZERO,Vector3(0,0,-1));camera.current=true
	var ground=MeshInstance3D.new();var terrain:=PackedVector3Array()
	# 128² cells across this exact source window. CPU bilinear source samples,
	# no bed carving and no changed source heights.
	for z in 128:
		for x in 128:
			var corners: Array=[]
			for offset in [Vector2(0,0),Vector2(1,0),Vector2(1,1),Vector2(0,1)]:
				var px=-5000.+(x+offset.x)*10000./128.;var pz=-5000.+(z+offset.y)*10000./128.
				corners.append(Vector3(px,G.height_at(world,20000.+px,20000.+pz),pz))
			for index in [0,2,1,0,3,2]:terrain.append(corners[index])
	ground.mesh=mesh_for(terrain);var gray=StandardMaterial3D.new();gray.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED;gray.albedo_color=Color(.4,.4,.4);gray.cull_mode=BaseMaterial3D.CULL_DISABLED;ground.material_override=gray;vp.add_child(ground)
	var item=MeshInstance3D.new();item.mesh=mesh_for(water.vertices);vp.add_child(item)
	var overlay=ShaderMaterial.new();overlay.shader=load("res://shaders/water_source_map.gdshader");overlay.set_shader_parameter("linear_tint",Vector3(0,.25,1));overlay.render_priority=10
	item.material_override=overlay;ground.visible=false
	var reference=await capture(vp,args[1].path_join("source-contours.png"))
	ground.visible=true
	var projected=await capture(vp,args[1].path_join("source-map-over-terrain.png"))
	# Depth-disabled source maps deliberately expose their limitation: a city
	# occluder must remain visible. The terrain-only Decal control below supplies
	# a bounded renderer integration contract, without moving any source vertex.
	var roof_pixel:=Vector2i(512,512);var nearest:=INF
	for z in range(64,960):
		for x in range(64,960):
			var pixel=reference.get_pixel(x,z)
			var distance=Vector2(x-512,z-512).length_squared()
			if pixel.b>pixel.r+0.1 and distance<nearest:nearest=distance;roof_pixel=Vector2i(x,z)
	var roof=MeshInstance3D.new();var roof_mesh=BoxMesh.new();roof_mesh.size=Vector3(1200,10,1200);roof.mesh=roof_mesh;roof.position=Vector3((roof_pixel.x+.5)*10000./1024.-5000.,2000,(roof_pixel.y+.5)*10000./1024.-5000.);roof.layers=2
	var red=StandardMaterial3D.new();red.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED;red.albedo_color=Color.RED;roof.material_override=red;vp.add_child(roof)
	var unsafe_roof=await capture(vp,args[1].path_join("diagnostic-overlay-over-roof.png"))
	item.visible=false;gray.shading_mode=BaseMaterial3D.SHADING_MODE_PER_PIXEL;gray.roughness=1.;gray.metallic_specular=0.
	var paint=Image.create(1024,1024,false,Image.FORMAT_RGBA8)
	for z in 1024:
		for x in 1024:
			var pixel=reference.get_pixel(x,z);var alpha=clampf(pixel.b-pixel.r,0.,1.)
			paint.set_pixel(x,z,Color(0,.5370987,1.,alpha))
	var decal=Decal.new();decal.size=Vector3(10000,20000,10000);decal.cull_mask=1;decal.texture_albedo=ImageTexture.create_from_image(paint);decal.albedo_mix=1.;decal.upper_fade=0.;decal.lower_fade=0.;decal.normal_fade=0.;vp.add_child(decal)
	roof.visible=false
	var decal_image=await capture(vp,args[1].path_join("terrain-only-source-map.png"))
	roof.visible=true
	var decal_roof=await capture(vp,args[1].path_join("terrain-only-source-map-roof.png"))
	roof.visible=false;decal.visible=false;item.visible=true
	var physical=ShaderMaterial.new();var shader=Shader.new();shader.code=FileAccess.get_file_as_string(args[2]);physical.shader=shader;physical.set_shader_parameter("linear_tint",Vector3(0,.25,1));physical.set_shader_parameter("presentation_mode",1);item.material_override=physical
	var occluded=await capture(vp,args[1].path_join("source-levels-with-depth.png"))
	var differences=0;var max_error=0.
	for z in reference.get_height():
		for x in reference.get_width():
			var a=reference.get_pixel(x,z);var b=projected.get_pixel(x,z)
			# Compare water footprints, not the intentionally changed background.
			var aw=a.b>a.r+0.1 and a.b>0.2;var bw=b.b>b.r+0.1 and b.b>0.2
			if aw!=bw:differences+=1
			if aw and bw:max_error=maxf(max_error,maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b))))
	var roof_blue_unsafe=0;var roof_blue_decal=0;var decal_mismatch=0
	for z in range(roof_pixel.y-59,roof_pixel.y+60):
		for x in range(roof_pixel.x-59,roof_pixel.x+60):
			var a=unsafe_roof.get_pixel(x,z);var b=decal_roof.get_pixel(x,z)
			if a.b>a.r+0.1:roof_blue_unsafe+=1
			if b.b>b.r+0.1:roof_blue_decal+=1
	for z in 1024:
		for x in 1024:
			var a=reference.get_pixel(x,z);var b=decal_image.get_pixel(x,z)
			if (a.b>a.r+0.1 and a.b>0.2)!=(b.b>b.r+0.1 and b.b>0.2):decal_mismatch+=1
	var report={"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"packet":args[0],"viewWidthM":10000,"viewportPx":1024,"sourceContourPixels":water_pixels(reference),"sourceMapWithTerrainPixels":water_pixels(projected),"sourceLevelsDepthTestPixels":water_pixels(occluded),"sourceMapFootprintMismatchPixels":differences,"sourceMapMaximumWaterColorError":max_error,"unsafeOverlayWaterPixelsOverRoof":roof_blue_unsafe,"terrainOnlyDecalWaterPixelsOverRoof":roof_blue_decal,"terrainOnlyDecalFootprintMismatchPixels":decal_mismatch,"terrainOnlyDecalWaterPixels":water_pixels(decal_image),"sourceUnchanged":hash(packet.source)==source_hash,"sourceAuthority":water.authority,"missingLevelTriangles":water.missingLevelTriangles,"sourceVectorAreaM2":water.sourceVectorAreaM2,"vectorVertices":water.vertices.size(),"scope":"real retained Magna contours and original measured levels; controlled palette and CPU source-bed mesh; overlay depth control and terrain-only Decal cull-mask control, not Terrain3D integration, source topology repair, final artistic style or physical water reconciliation"}
	var file=FileAccess.open(args[1].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file.close();print(JSON.stringify(report));quit(0 if differences==0 and report.sourceUnchanged and report.sourceContourPixels>0 else 1)
