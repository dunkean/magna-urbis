class_name SurfaceWaterProjection
extends RefCounted
# GPU/main-thread adapter, intentionally separate from physical water surfaces.
# Bake original vector triangles into a map texture, then project only onto
# terrain render layer1. No source coordinate, measured level or bank is edited.
const MAX_RESOLUTION := 4096
const MAX_VERTICES := 999996
const Symbols=preload("res://adapters/surface_water_symbols.gd")
const Contours=preload("res://adapters/surface_water_contours.gd")

static func _sha(bytes: PackedByteArray) -> String:
	var context:=HashingContext.new();context.start(HashingContext.HASH_SHA256);
	if not bytes.is_empty():context.update(bytes)
	return context.finish().hex_encode()

static func _color(colors: Dictionary, key: String, fallback: Vector3) -> Vector3:
	var value=colors.get(key,fallback)
	return value if value is Vector3 and value.is_finite() else fallback

static func cache_key(geometry: Dictionary, focus: Dictionary, width_m: float, colors: Dictionary, options: Dictionary={}) -> String:
	var vertices: PackedVector3Array=geometry.get("vertices",PackedVector3Array())
	var class_hash: String=_sha(geometry.classImage.get_data()) if geometry.get("classImage") is Image else ""
	var coverage_hash: String=_sha(geometry.coverageImage.get_data()) if geometry.get("coverageImage") is Image else ""
	var contour_hash=Contours.digest(geometry.sourceWaterContours) if geometry.get("sourceWaterContours") is Array else "unavailable"
	return _sha(var_to_bytes({"format":"magna-source-water-terrain-projection-1","symbolPlan":Symbols.plan(width_m,options),"contours":contour_hash,"sourceKey":str(options.get("sourceKey","")),"vertices":_sha(vertices.to_byte_array()),"anchor":geometry.get("anchor",{}),"focusX":float(focus.get("x",NAN)),"focusZ":float(focus.get("y",NAN)),"widthM":width_m,"resolution":clampi(int(options.get("resolution",1024)),64,MAX_RESOLUTION),"msaa":int(options.get("msaa",0)),"minHeightM":float(options.get("minHeightM",-10000.0)),"maxHeightM":float(options.get("maxHeightM",10000.0)),"classHash":class_hash,"classOrigin":geometry.get("classOrigin",{}),"classSpacingM":geometry.get("classSpacingM",0.0),"coverageHash":coverage_hash,"coverageOrigin":geometry.get("coverageOrigin",{}),"coverageSpacingM":geometry.get("coverageSpacingM",0.0),"colors":[_color(colors,"river",Vector3(.035,.17,.20)),_color(colors,"lake",Vector3(.028,.10,.115)),_color(colors,"sea",Vector3(.018,.095,.125)),_color(colors,"fallback",Vector3(.028,.10,.115))]}))

# parent must be in a live SceneTree. Caller owns cache keyed by cache_key and
# checks its request generation after awaiting bake. All color inputs are LINEAR
# Vector3, not Color variants. minHeightM/maxHeightM bound terrain support in
# canonical metres; renderer origin is subtracted only when creating the Decal.
static func bake(parent: Node, geometry: Dictionary, origin: Dictionary, focus: Dictionary, width_m: float, colors: Dictionary, options: Dictionary={}) -> Dictionary:
	var started:=Time.get_ticks_usec()
	if not is_instance_valid(parent) or not parent.is_inside_tree(): return {"error":"projection parent must be in the scene tree"}
	if str(options.get("sourceKey","")).is_empty():return {"error":"projection sourceKey is required"}
	if RenderingServer.get_current_rendering_method()=="gl_compatibility": return {"error":"source-map terrain projection requires Forward+ or Mobile Decal support"}
	if not is_finite(width_m) or width_m<=0.0: return {"error":"invalid projection width"}
	var plan=Symbols.plan(width_m,options)
	if plan.has("error"):return plan
	var requested_width=width_m
	width_m=float(plan.widthM)
	for key in ["x","y"]:
		if not is_finite(float(focus.get(key,NAN))): return {"error":"invalid canonical projection focus"}
	for key in ["x","y","z"]:
		if not is_finite(float(origin.get(key,NAN))): return {"error":"invalid render origin"}
	var vertices=geometry.get("vertices")
	if not vertices is PackedVector3Array or vertices.size()%3!=0 or vertices.size()>MAX_VERTICES: return {"error":"invalid or over-budget source vector triangles"}
	var contour_info:Dictionary={}
	if plan.widthPx>0.0:
		contour_info=Contours.info(geometry)
		if contour_info.has("error"):return contour_info
	var anchor: Dictionary=geometry.get("anchor",origin)
	var min_y:=INF;var max_y:=-INF
	for point in vertices:
		if not point.is_finite(): return {"error":"nonfinite source vector vertex"}
		min_y=minf(min_y,point.y);max_y=maxf(max_y,point.y)
	var min_height:=float(options.get("minHeightM",-10000.0));var max_height:=float(options.get("maxHeightM",10000.0))
	if not is_finite(min_height) or not is_finite(max_height) or min_height>=max_height: return {"error":"invalid terrain projection height bounds"}
	var bounds={"minX":float(focus.x)-width_m*.5,"maxX":float(focus.x)+width_m*.5,"minZ":float(focus.y)-width_m*.5,"maxZ":float(focus.y)+width_m*.5}
	var result={"cacheKey":cache_key(geometry,focus,requested_width,colors,options),"bounds":bounds,"worldCenter":{"x":float(focus.x),"y":(min_height+max_height)*.5,"z":float(focus.y)},"position":Vector3(float(focus.x)-float(origin.x),(min_height+max_height)*.5-float(origin.y),float(focus.y)-float(origin.z)),"size":Vector3(width_m,max_height-min_height,width_m),"cullMask":1,"texture":null,"diagnostics":{"waterPresentation":"source-map-terrain-projection","sourceAuthority":str(geometry.get("authority","unknown")),"sourceGeometrySha256":_sha(vertices.to_byte_array()),"sourceLevelsUnchanged":true,"sourceVertices":vertices.size(),"projectionCullMask":1,"physicalWaterSurfaceClaimed":false,"minimumRiverStrokeApplied":false,"sourceVectorAreaM2":geometry.get("sourceVectorAreaM2",0.0)}}
	for key in ["sourceVectorRequestedAreaM2","sourceVectorMissingAreaM2","sourceVectorCoverageComplete","missingLevelTriangles","sourceVectorScanWork","vertexBudget","budgetLimited","fixedHydrologyFallbackReason","vectorBedDiagnosticSamples","vectorBedDiagnosticConflicts","vectorBedDiagnosticMissing","vectorBedDiagnosticMaximumDeltaM","vectorBedDiagnosticBudget","vectorBedDiagnosticToleranceM","sourceLevelBoundaryQueriesResolved","sourceLevelMaximumBoundaryQueryRoundoffM","sourceLevelBoundaryPolicy","sourceVectorClipBounds"]:
		if geometry.has(key):result.diagnostics[key]=geometry[key]
	result.diagnostics["sourceVectorAreaScope"]="input geometry clip window; projection camera may be narrower"
	result.diagnostics["subpixelPolicy"]="original contour coverage only; no minimum stroke or physical-width edits"
	result.diagnostics.merge(Symbols.diagnostics(plan),true)
	for key in ["sourceContourVersion","sourceContourSha256","sourceContourPointCount","sourceContourRingCount","sourceContourComplete","sourceContourBudgetLimited","sourceContourPrecision","sourceContourScope","sourceSeaSymbolPolicy"]:
		if geometry.has(key):result.diagnostics[key]=geometry[key]
	if plan.widthPx>0.0:result.diagnostics["symbolContourEstimatedBytes"]=contour_info.estimatedBytes;result.diagnostics["symbolContourBudgetBytes"]=contour_info.budgetBytes
	result.diagnostics["resolution"]=int(plan.resolution);result.diagnostics["metresPerTexel"]=width_m/int(plan.resolution)
	if plan.widthPx>0.0:result.diagnostics["subpixelPolicy"]="declared source vector-ring outline before raster; original source contours, levels and physical area unchanged"
	if vertices.is_empty(): result.diagnostics["empty"]=true;return result
	var resolution:=int(plan.resolution)
	var viewport:=SubViewport.new();viewport.size=Vector2i(resolution,resolution);viewport.own_world_3d=true;viewport.transparent_bg=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	viewport.msaa_3d={2:Viewport.MSAA_2X,4:Viewport.MSAA_4X,8:Viewport.MSAA_8X}.get(int(plan.msaa),Viewport.MSAA_DISABLED)
	parent.add_child(viewport)
	var environment:=WorldEnvironment.new();var config:=Environment.new();config.background_mode=Environment.BG_COLOR;config.background_color=Color(0,0,0,0);config.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=config;viewport.add_child(environment)
	var camera:=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=width_m;camera.near=.1;camera.far=maxf(10.0,max_y-min_y+20.0);camera.position=Vector3(0,max_y+10.0,0);viewport.add_child(camera);camera.look_at(Vector3(0,min_y,0),Vector3(0,0,-1));camera.current=true
	var arrays:=[];arrays.resize(Mesh.ARRAY_MAX);arrays[Mesh.ARRAY_VERTEX]=vertices
	var mesh:=ArrayMesh.new();mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var material:=ShaderMaterial.new();material.shader=load("res://shaders/water_source_map.gdshader")
	material.set_shader_parameter("linear_tint",_color(colors,"fallback",Vector3(.028,.10,.115)))
	for kind in ["river","lake","sea"]:material.set_shader_parameter("linear_"+kind+"_tint",_color(colors,kind,{"river":Vector3(.035,.17,.20),"lake":Vector3(.028,.10,.115),"sea":Vector3(.018,.095,.125)}[kind]))
	if geometry.get("classImage") is Image:
		material.set_shader_parameter("class_enabled",true);material.set_shader_parameter("class_map",ImageTexture.create_from_image(geometry.classImage))
		material.set_shader_parameter("class_origin_local",Vector2(float(geometry.classOrigin.x)-float(focus.x),float(geometry.classOrigin.z)-float(focus.y)))
		material.set_shader_parameter("class_spacing",float(geometry.classSpacingM));material.set_shader_parameter("class_grid_size",Vector2(geometry.classSize))
	if geometry.get("coverageImage") is Image:
		material.set_shader_parameter("coverage_enabled",true);material.set_shader_parameter("coverage_map",ImageTexture.create_from_image(geometry.coverageImage))
		material.set_shader_parameter("coverage_origin_local",Vector2(float(geometry.coverageOrigin.x)-float(focus.x),float(geometry.coverageOrigin.z)-float(focus.y)))
		material.set_shader_parameter("coverage_spacing",float(geometry.coverageSpacingM));material.set_shader_parameter("coverage_grid_size",Vector2(geometry.coverageSize))
	var item:=MeshInstance3D.new();item.mesh=mesh;item.material_override=material;item.position=Vector3(float(anchor.x)-float(focus.x),0,float(anchor.z)-float(focus.y));viewport.add_child(item)
	var tree:=parent.get_tree()
	for frame in 3:await tree.process_frame
	await RenderingServer.frame_post_draw
	if not is_instance_valid(viewport):return {"error":"projection viewport removed before completion"}
	var image:=viewport.get_texture().get_image()
	viewport.queue_free()
	if image==null or image.is_empty():return {"error":"source map texture readback unavailable"}
	result.diagnostics["sourceCoverageImageSha256"]=_sha(image.get_data())
	if options.get("retainSourceImage",false):result.sourceImage=image
	if plan.widthPx>0.0:
		image=await Symbols.apply(parent,image,plan,geometry,focus,colors)
		if image==null or image.is_empty():return {"error":"symbolic source map texture readback unavailable"}
		result.diagnostics["symbolCoverageImageSha256"]=_sha(image.get_data())
	image.generate_mipmaps();result.texture=ImageTexture.create_from_image(image)
	result.diagnostics["resolution"]=resolution;result.diagnostics["metresPerTexel"]=width_m/resolution;result.diagnostics["buildMs"]=(Time.get_ticks_usec()-started)/1000.0
	return result

static func create_decal(projection: Dictionary, origin: Dictionary={}) -> Decal:
	if projection.has("error") or not projection.get("texture") is Texture2D:return null
	var decal:=Decal.new();decal.name="SourceMapWaterTerrainOnly";decal.texture_albedo=projection.texture;decal.position=projection.position;decal.size=projection.size;decal.cull_mask=1;decal.albedo_mix=1.;decal.upper_fade=0.;decal.lower_fade=0.;decal.normal_fade=0.
	if not origin.is_empty():
		var center: Dictionary=projection.worldCenter
		decal.position=Vector3(float(center.x)-float(origin.x),float(center.y)-float(origin.y),float(center.z)-float(origin.z))
	return decal
