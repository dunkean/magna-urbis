class_name SurfaceTreeSolar
extends RefCounted
const Canopy=preload("res://adapters/surface_canopy.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
const Coverage=preload("res://adapters/surface_source_coverage.gd")
const Visibility=preload("res://adapters/surface_visibility_plan.gd")
const VERSION="tree-solar-shadow-1"
const YAW_BINS=32
const RESOLUTION=1024
const SPAN=1.6
const RATIO=.42
const MAX_TREES=100000
const MAX_HEIGHT=18.0
const MAX_ASSET_Y=.5+SPAN*.5 # Guaranteed by the real AABB sphere bake preflight.
var texture:Texture2DArray
var direction:=Vector3.ZERO
var descriptor:Dictionary={}

static func known_feature_bytes(source_count:int)->Dictionary:
	# At most active+new source/caster batches coexist. Four source-array/reference
	# copies include grow/reallocation peaks; instance rows reserve two batches times
	# four copies (caller, server backing, upload, GPU). These are explicit upper
	# accounting allowances, not an assertion about undocumented engine/RSS copies.
	var count=clampi(source_count,0,MAX_TREES)
	return {"solarShadowTextureGpuBytes":RESOLUTION*RESOLUTION*4*YAW_BINS,"solarShadowSourceFloat64PeakBytes":count*6*8*4,"solarShadowIdReferenceReserveBytes":count*16*4,"solarShadowInstanceCpuGpuPeakBytes":count*20*4*2*4,"solarShadowMetadataReserveBytes":8*1024*1024}

static func binding_matches(data:Dictionary,world:Dictionary,packet:Dictionary,bake:Dictionary,asset_digest:String)->bool:
	var source:Dictionary=packet.get("source",{});var expected:Dictionary=world.get("terrain",{}).get("source",{})
	return data.get("available",false) and data.get("worldId","")==world.get("id") and data.get("source",{}).get("id")==expected.get("id") and data.get("source",{}).get("version")==expected.get("version") and data.get("sourceEpoch")==source.get("sourceEpoch") and data.get("sceneEpoch")==source.get("sceneEpoch") and bake.get("available",false) and bake.get("assetDigest","")==asset_digest

static func solar_basis(to_sun:Vector3)->Basis:
	var z=to_sun.normalized()
	var x=Vector3.UP.cross(z).normalized()
	return Basis(x,z.cross(x).normalized(),z)

static func yaw_bin(angle:float)->int:
	return posmod(roundi(fposmod(angle,TAU)/TAU*YAW_BINS),YAW_BINS)

# CPU only. Complete inventory, NOT Population's selected colour geometry.
# Source records remain untouched. Buffers are private renderer products.
static func prepare(packet:Dictionary,world:Dictionary,origin:Dictionary,to_sun:Vector3=Vector3.ZERO)->Dictionary:
	var page=Canopy.tree_page(packet)
	if page.is_empty():return {"available":false,"reason":"missing-complete-tree-page"}
	if not Visibility._covered_rectangle(page.bounds,Coverage.domains(world)):return {"available":false,"reason":"tree-page-without-complete-real-height-domain"}
	var columns:Dictionary=packet.get("candidateColumns",{})
	var records:Array=packet.get("candidates",[])
	var n=int(columns.count) if not columns.is_empty() else records.size()
	var values=PackedFloat64Array();var radii=PackedFloat64Array();var names=PackedStringArray();var ids=HashingContext.new();ids.start(HashingContext.HASH_SHA256)
	var count=0;var max_root=-INF;var min_root=INF;var maximum_height=0.0
	var declared_count=0;var excluded=0;var unsupported:Dictionary=packet.get("_unsupportedTreeIDs",{})
	for i in n:
		var family=str(columns.families[int(columns.family[i])]) if not columns.is_empty() else str(records[i].family)
		if family!="tree":continue
		var id=str(columns.ids[i]) if not columns.is_empty() else str(records[i].stableId)
		var x=float(columns.positions[i*3]) if not columns.is_empty() else float(records[i].x)
		var y=float(columns.positions[i*3+1]) if not columns.is_empty() else float(records[i].y)
		var z=float(columns.positions[i*3+2]) if not columns.is_empty() else float(records[i].z)
		var size=float(columns.size[i]) if not columns.is_empty() else float(records[i].size)
		var radius=float(columns.crownRadiusM[i]) if not columns.is_empty() else float(records[i].get("crownRadiusM",size*RATIO))
		var angle=float(columns.orientation[i]) if not columns.is_empty() else float(records[i].orientation)
		var rank=float(columns.rank[i]) if not columns.is_empty() else float(records[i].get("rank",0))
		if not is_finite(x) or not is_finite(y) or not is_finite(z) or not is_finite(size) or not is_finite(radius) or not is_finite(angle) or not is_finite(rank) or rank<0 or rank>=1 or size<=0 or size>MAX_HEIGHT or absf(radius/size-RATIO)>.000001:
			return {"available":false,"reason":"unsupported-nonfinite-height-or-anisotropy","offendingId":id}
		declared_count+=1
		if declared_count>MAX_TREES:return {"available":false,"reason":"complete-shadow-inventory-over-budget"}
		ids.update(id.to_utf8_buffer());ids.update(PackedFloat64Array([x,y,z,size,radius,angle,rank]).to_byte_array());ids.update(PackedByteArray([1 if unsupported.has(id) else 0]))
		if unsupported.has(id):excluded+=1;continue
		count+=1;names.append(id);values.append_array(PackedFloat64Array([x,y,z,size,angle,rank]));radii.append(radius)
		max_root=maxf(max_root,y);min_root=minf(min_root,y);maximum_height=maxf(maximum_height,size)
	if declared_count!=int(page.get("count",-1)):return {"available":false,"reason":"complete-page-count-mismatch","actualCount":declared_count,"declaredCount":page.get("count")}
	var maximum=-INF;var minimum=INF
	for layer in Geometry.prepare_height_layers(world):
		if str(layer.terrain.get("reconstruction","bilinear-samples")) not in ["bilinear-samples","cubic-bspline-controls"]:return {"available":false,"reason":"unsupported-nonpositive-source-height-kernel"}
		for value in layer.terrain.heights:
			if not is_finite(float(value)):return {"available":false,"reason":"nonfinite-source-height"}
			maximum=maxf(maximum,float(value));minimum=minf(minimum,float(value))
	if not is_finite(maximum) or not is_finite(minimum):return {"available":false,"reason":"missing-real-height-support"}
	var result={"available":true,"version":VERSION,"page":page,"values":values,"radii":radii,"ids":names,"count":count,"declaredSourceTreeCount":declared_count,"unsupportedTreeCount":excluded,"triangles":count*2,"sourceInventorySha256":ids.finish().hex_encode(),"worldId":str(world.id),"source":world.terrain.source.duplicate(true),"sourceEpoch":packet.get("source",{}).get("sourceEpoch"),"sceneEpoch":packet.get("source",{}).get("sceneEpoch"),"maximumSourceY":maxf(maximum,max_root),"minimumSourceY":minf(minimum,min_root),"maximumTreeHeightM":MAX_HEIGHT,"actualMaximumTreeHeightM":maximum_height,"origin":origin.duplicate()}
	if to_sun.is_finite() and to_sun.length_squared()>.5:
		var prepared=instance_buffer(result,origin,to_sun.normalized());result["renderBuffer"]=prepared.buffer;result["renderBounds"]=prepared.bounds;result["renderDirection"]=to_sun.normalized()
	return result

static func instance_buffer(data:Dictionary,origin:Dictionary,to_sun:Vector3)->Dictionary:
	var values:PackedFloat64Array=data.values;var basis=solar_basis(to_sun)
	var buffer=PackedFloat32Array();buffer.resize(int(data.count)*20)
	var low=Vector3(INF,INF,INF);var high=Vector3(-INF,-INF,-INF)
	for i in int(data.count):
		var source=i*6;var at=i*20;var h=float(values[source+3])
		var p=Vector3(values[source]-float(origin.x),values[source+1]-float(origin.y)+h*.5,values[source+2]-float(origin.z))
		var b=basis.scaled(Vector3.ONE*h)
		buffer[at]=b.x.x;buffer[at+1]=b.y.x;buffer[at+2]=b.z.x;buffer[at+3]=p.x
		buffer[at+4]=b.x.y;buffer[at+5]=b.y.y;buffer[at+6]=b.z.y;buffer[at+7]=p.y
		buffer[at+8]=b.x.z;buffer[at+9]=b.y.z;buffer[at+10]=b.z.z;buffer[at+11]=p.z
		buffer[at+12]=1;buffer[at+13]=1;buffer[at+14]=1;buffer[at+15]=1
		buffer[at+16]=yaw_bin(values[source+4]);buffer[at+17]=values[source+5];buffer[at+18]=h;buffer[at+19]=1
		# Contains the plane AND all reconstructed fragment depths; not just roots.
		var extent=(basis.x.abs()+basis.y.abs()+basis.z.abs())*(SPAN*.5*h)
		low=low.min(p-extent);high=high.max(p+extent)
	return {"buffer":buffer,"bounds":AABB(low,high-low) if data.count>0 else AABB()}

static func guard(data:Dictionary,view:Dictionary,receiver_minimum_y:float,to_sun:Vector3)->Dictionary:
	if not data.get("available",false):return {"weight":0.0,"reason":data.get("reason","no-inventory")}
	if not to_sun.is_finite() or to_sun.y<=.05 or view.is_empty() or not is_finite(receiver_minimum_y):return {"weight":0.0,"reason":"unsupported-solar-angle-or-view"}
	# Any source root outside the complete page is bounded by the actual transported
	# source maximum plus the catalogue's explicit18m maximum. Receivers use the
	# actual loaded resident minimum, NOT a constant crown/reference-plane height.
	var travel=maxf(0,float(data.maximumSourceY)+MAX_HEIGHT*MAX_ASSET_Y-receiver_minimum_y)/to_sun.y
	var dx=to_sun.x*travel;var dz=to_sun.z*travel;var crown=1.56*MAX_HEIGHT*RATIO
	var required={"minX":float(view.minX)+minf(0,dx)-crown,"maxX":float(view.maxX)+maxf(0,dx)+crown,"minZ":float(view.minZ)+minf(0,dz)-crown,"maxZ":float(view.maxZ)+maxf(0,dz)+crown}
	var b:Dictionary=data.page.bounds
	var margin=minf(minf(float(required.minX)-float(b.minX),float(b.maxX)-float(required.maxX)),minf(float(required.minZ)-float(b.minZ),float(b.maxZ)-float(required.maxZ)))
	return {"weight":smoothstep(0,64,margin),"reason":"complete-source-page-covers-receivers-and-solar-casters" if margin>=0 else "shadow-halo-outside-complete-tree-page","requiredCasterBounds":required,"receiverBounds":view,"receiverMinimumY":receiver_minimum_y,"maximumCasterY":float(data.maximumSourceY)+MAX_HEIGHT*MAX_ASSET_Y,"solarTravelM":travel,"marginM":margin,"transitionM":64.0,"pageBounds":b,"maximumAssetNormalizedY":MAX_ASSET_Y}

func bake(parent:Node,library:RefCounted,to_sun:Vector3)->bool:
	var started=Time.get_ticks_usec();direction=to_sun.normalized();descriptor={"available":false}
	if direction.y<=.05 or library.high_mesh==null:return false
	# Conservative eight-corner bound covers every source vertex, all32 yaws and
	# all solar directions. Refuse a product whose real support could be cropped.
	var bounds:AABB=library.high_mesh.get_aabb();var bound_radius=0.0
	for i in 8:
		var p=Vector3(bounds.end.x if i&1 else bounds.position.x,bounds.end.y if i&2 else bounds.position.y,bounds.end.z if i&4 else bounds.position.z)*Vector3(RATIO,1,RATIO)-Vector3(0,.5,0)
		bound_radius=maxf(bound_radius,p.length())
	if bound_radius>=SPAN*.5:return false
	var viewport=SubViewport.new();viewport.size=Vector2i(RESOLUTION,RESOLUTION);viewport.own_world_3d=true;viewport.transparent_bg=true;viewport.use_hdr_2d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;parent.add_child(viewport)
	var scene=Node3D.new();viewport.add_child(scene)
	var environment=WorldEnvironment.new();environment.environment=Environment.new();environment.environment.background_mode=Environment.BG_COLOR;environment.environment.background_color=Color(0,0,0,0);environment.environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;scene.add_child(environment)
	var node=MeshInstance3D.new();node.mesh=library.high_mesh.duplicate();node.scale=Vector3(RATIO,1,RATIO);node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF;scene.add_child(node)
	for i in library.high_materials.size():
		var source:StandardMaterial3D=library.high_materials[i];var material=ShaderMaterial.new();material.shader=preload("res://shaders/tree_solar_bake.gdshader")
		for pair in [["source_albedo",source.albedo_texture],["source_factor",Vector4(source.albedo_color.r,source.albedo_color.g,source.albedo_color.b,source.albedo_color.a)],["uv_scale",source.uv1_scale],["uv_offset",source.uv1_offset],["source_cutout",source.resource_name.contains("leaves")],["to_sun",direction]]:material.set_shader_parameter(pair[0],pair[1])
		node.mesh.surface_set_material(i,material)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=SPAN;camera.near=.01;camera.far=5;camera.position=Vector3(0,.5,0)+direction*2.0;scene.add_child(camera);camera.look_at(Vector3(0,.5,0));camera.current=true
	var images:Array[Image]=[];var digest=HashingContext.new();digest.start(HashingContext.HASH_SHA256);var transfer="";var observed_format=-1
	for bin in YAW_BINS:
		node.rotation.y=float(bin)*TAU/YAW_BINS
		await parent.get_tree().process_frame;await parent.get_tree().process_frame;await RenderingServer.frame_post_draw
		var image=viewport.get_texture().get_image();observed_format=image.get_format();image.convert(Image.FORMAT_RGBAF)
		var source=image.get_data().to_float32_array();var calibration=-1.0
		for pixel in RESOLUTION*RESOLUTION:
			var at=pixel*4
			if source[at+1]>.5:
				calibration=source[at+2];break
		if calibration<0 or minf(absf(calibration-.25),absf(calibration-.5370987305))>.006:viewport.queue_free();return false
		var decode=absf(calibration-.25)>absf(calibration-.5370987305)
		transfer="sRGB readback decoded to linear" if decode else "linear HDR readback"
		if decode:image.srgb_to_linear()
		image.convert(Image.FORMAT_RGH);digest.update(image.get_data());images.append(image)
	viewport.queue_free()
	texture=Texture2DArray.new()
	if texture.create_from_images(images)!=OK:return false
	descriptor={"available":true,"version":VERSION,"assetDigest":library.cpu.digest,"solarDirection":[direction.x,direction.y,direction.z],"yawBins":YAW_BINS,"maximumYawErrorDegrees":180.0/YAW_BINS,"heightRadiusRatio":RATIO,"sourceAabbEnclosingRadius":bound_radius,"bakeHalfSpan":SPAN*.5,"resolution":RESOLUTION,"dataFormat":"RG16F(solar-depth,source-cutout)","textureBytes":RESOLUTION*RESOLUTION*4*YAW_BINS,"productsSha256":digest.finish().hex_encode(),"bakeMs":(Time.get_ticks_usec()-started)/1000.0,"readbackTransfer":transfer,"readbackFormat":observed_format,"depthPolicy":"actual source surface depth along solar axis; fragment writes native shadow-map depth","scope":"quantized yaw silhouette/depth of corrected high asset, not full3D view-dependent light transport"}
	return true

func create_node(data:Dictionary,origin:Dictionary)->MultiMeshInstance3D:
	var mesh=QuadMesh.new();mesh.size=Vector2(SPAN,SPAN)
	var material=ShaderMaterial.new();material.shader=preload("res://shaders/tree_solar_shadow.gdshader");material.set_shader_parameter("solar_data",texture)
	mesh.surface_set_material(0,material)
	var prepared=data.has("renderBuffer") and data.get("origin",{})==origin and data.get("renderDirection",Vector3.ZERO).distance_to(direction)<.000001
	var instance={"buffer":data.renderBuffer,"bounds":data.renderBounds} if prepared else instance_buffer(data,origin,direction)
	var multi=MultiMesh.new();multi.transform_format=MultiMesh.TRANSFORM_3D;multi.use_colors=true;multi.use_custom_data=true;multi.mesh=mesh;multi.instance_count=int(data.count);multi.buffer=instance.buffer;multi.custom_aabb=instance.bounds
	var node=MultiMeshInstance3D.new();node.name="CompleteTreeSolarShadowOnly";node.multimesh=multi;node.layers=2;node.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY;node.gi_mode=GeometryInstance3D.GI_MODE_DISABLED;node.set_meta("surfaceLayer","trees");node.set_meta("solarShadow",true)
	return node
