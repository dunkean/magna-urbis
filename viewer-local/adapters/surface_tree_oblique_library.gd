class_name SurfaceTreeObliqueLibrary
extends RefCounted
const RESOLUTION=512
const SPAN=1.6
const RATIO=.42
const ELEVATIONS=[-30.0,0.0,30.0,60.0]
const AZIMUTHS=8
const VERSION="tree-physical-view-grid-1"
var colors:Texture2DArray
var normal_roughness:Texture2DArray
var depths:Texture2DArray
var descriptor:Dictionary={}

static func directions()->PackedVector3Array:
	var result=PackedVector3Array()
	for elevation in ELEVATIONS:
		var angle=deg_to_rad(elevation)
		for yaw in AZIMUTHS:
			var a=float(yaw)*TAU/AZIMUTHS
			result.append(Vector3(cos(a)*cos(angle),sin(angle),sin(a)*cos(angle)))
	result.append(Vector3.UP);return result

static func nearest(direction:Vector3,grid:PackedVector3Array=PackedVector3Array())->int:
	if grid.is_empty():grid=directions()
	var best=-INF;var selected=0
	for i in grid.size():
		var score=direction.normalized().dot(grid[i])
		if score>best:best=score;selected=i
	return selected

static func frame(direction:Vector3)->Basis:
	var x=Vector3.RIGHT if direction.y>.999 else Vector3.UP.cross(direction).normalized()
	return Basis(x,direction.cross(x).normalized(),direction)

static func mip_pixels()->int:
	var n=RESOLUTION;var total=0
	while n>0:total+=n*n;n/=2
	return total

static func persistent_bytes()->int:return directions().size()*mip_pixels()*(8+4+4)

func bake(parent:Node,library:RefCounted)->bool:
	var started=Time.get_ticks_usec();descriptor={"available":false}
	var bound: AABB=library.high_mesh.get_aabb();var radius=0.0
	for i in 8:
		var p=Vector3(bound.end.x if i&1 else bound.position.x,bound.end.y if i&2 else bound.position.y,bound.end.z if i&4 else bound.position.z)*Vector3(RATIO,1,RATIO)-Vector3(0,.5,0)
		radius=maxf(radius,p.length())
	if radius>=SPAN*.5:return false
	var viewport=SubViewport.new();viewport.size=Vector2i(RESOLUTION,RESOLUTION);viewport.own_world_3d=true;viewport.transparent_bg=true;viewport.use_hdr_2d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;parent.add_child(viewport)
	var scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color(0,0,0,0);environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;scene.add_child(environment)
	var node=MeshInstance3D.new();node.mesh=library.high_mesh.duplicate();node.scale=Vector3(RATIO,1,RATIO);node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF;scene.add_child(node)
	var materials=[]
	for i in library.high_materials.size():
		var source:StandardMaterial3D=library.high_materials[i];var material=ShaderMaterial.new();material.shader=preload("res://shaders/tree_view_bake.gdshader")
		var channel=Vector4.ZERO
		if int(source.roughness_texture_channel)<4:channel[int(source.roughness_texture_channel)]=1
		else:channel=Vector4(.33333333,.33333333,.33333333,0)
		for pair in [["source_albedo",source.albedo_texture],["source_normal",source.normal_texture],["source_roughness",source.roughness_texture],["source_factor",Vector4(source.albedo_color.r,source.albedo_color.g,source.albedo_color.b,source.albedo_color.a)],["uv_scale",source.uv1_scale],["uv_offset",source.uv1_offset],["source_cutout",source.resource_name.contains("leaves")],["roughness_channel",channel],["roughness_factor",source.roughness],["normal_scale",source.normal_scale]]:material.set_shader_parameter(pair[0],pair[1])
		node.mesh.surface_set_material(i,material);materials.append(material)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=SPAN;camera.near=.01;camera.far=5;scene.add_child(camera);camera.current=true
	var color_images:Array[Image]=[];var normal_images:Array[Image]=[];var depth_images:Array[Image]=[];var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256)
	# Opaque alpha-scissor MRT replacement must preserve unassociated RGB even
	# when A stores roughness. Refuse an unexpected engine/readback association.
	camera.position=Vector3(2,1,2);camera.look_at(Vector3(0,.5,0))
	for material in materials:material.set_shader_parameter("channel",3)
	await parent.get_tree().process_frame;await parent.get_tree().process_frame;await RenderingServer.frame_post_draw
	var calibration=viewport.get_texture().get_image();var sentinel=Color(0,0,0,0)
	for y in calibration.get_height():
		for x in calibration.get_width():
			var c=calibration.get_pixel(x,y)
			if c.a>.1:sentinel=c;break
		if sentinel.a>.1:break
	if absf(sentinel.r-.25)>.003 or absf(sentinel.g-.5)>.003 or absf(sentinel.b-.75)>.003 or absf(sentinel.a-.5)>.003:viewport.queue_free();return false
	for direction in directions():
		camera.position=Vector3(0,.5,0)+direction*2;camera.look_at(Vector3(0,.5,0),Vector3.FORWARD if direction.y>.999 else Vector3.UP)
		for channel in 3:
			for material in materials:material.set_shader_parameter("channel",channel);material.set_shader_parameter("view_direction",direction)
			await parent.get_tree().process_frame;await parent.get_tree().process_frame;await RenderingServer.frame_post_draw
			var image=viewport.get_texture().get_image()
			# HDR preserves LINEAR RGB, premultiplied by binary source coverage0/1.
			if image.get_format()!=Image.FORMAT_RGBAH:viewport.queue_free();return false
			if channel==0:image.generate_mipmaps();color_images.append(image)
			elif channel==1:image.convert(Image.FORMAT_RGBA8);image.generate_mipmaps();normal_images.append(image)
			else:image.convert(Image.FORMAT_RGH);image.generate_mipmaps();depth_images.append(image)
			hash.update(image.get_data())
	colors=Texture2DArray.new();normal_roughness=Texture2DArray.new();depths=Texture2DArray.new()
	if colors.create_from_images(color_images)!=OK or normal_roughness.create_from_images(normal_images)!=OK or depths.create_from_images(depth_images)!=OK:viewport.queue_free();return false
	var bytes=0
	for array in [color_images,normal_images,depth_images]:
		for image in array:bytes+=image.get_data().size()
	if bytes!=persistent_bytes():viewport.queue_free();return false
	color_images.clear();normal_images.clear();depth_images.clear();viewport.queue_free();await RenderingServer.frame_post_draw
	descriptor={"available":true,"version":VERSION,"assetDigest":library.cpu.digest,"viewCount":directions().size(),"elevationsDegrees":ELEVATIONS,"azimuthCount":AZIMUTHS,"maximumAzimuthQuantizationDegrees":22.5,"maximumElevationQuantizationDegrees":15,"resolution":RESOLUTION,"spanInSourceHeight":SPAN,"heightRadiusRatioAppliedBeforeProjection":RATIO,"colorFormat":"premultiplied-linear-RGBA16F+mips","normalRoughnessFormat":"coverage-premultiplied-encoded-world-normalRGB/roughnessA-linear-RGBA8+mips","depthFormat":"coverage-premultiplied-depthR/coverageG-RG16F+mips","persistentTextureBytes":bytes,"sourceAabbEnclosingRadius":radius,"productsSha256":hash.finish().hex_encode(),"bakeMs":(Time.get_ticks_usec()-started)/1000.0,"scope":"view-quantized source geometry/albedo/normal/roughness/depth; no beauty lighting, canonical data changes or exact oblique3D claim"}
	return true

func material()->ShaderMaterial:
	var result=ShaderMaterial.new();result.shader=preload("res://shaders/tree_oblique_full.gdshader")
	result.set_shader_parameter("physical_view_colors",colors);result.set_shader_parameter("physical_view_normal_roughness",normal_roughness);result.set_shader_parameter("physical_view_depth",depths)
	return result
