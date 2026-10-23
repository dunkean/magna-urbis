extends SceneTree

const Data=preload("res://adapters/surface_data.gd")
var viewer: Node

func _initialize()->void: call_deferred("run")

func options()->Dictionary:
	var result:Dictionary={};var args=OS.get_cmdline_user_args();var i=0
	while i<args.size():
		if i+1<args.size() and not args[i+1].begins_with("--"):result[args[i]]=args[i+1];i+=2
		else:result[args[i]]=true;i+=1
	return result

func ready(require_live:bool)->bool:
	if viewer.get("terrain")==null or viewer.get("worker")!=null or viewer.get("packet_worker")!=null or bool(viewer.get("view_dirty")) or bool(viewer.get("water_projection_busy")) or bool(viewer.get("canopy_transition_busy")):return false
	if not require_live:return true
	var world:Dictionary=viewer.get("world");var shown:Dictionary=viewer.get("rendered_snapshot")
	return not bool(viewer.get("live_busy")) and int(viewer.get("view_satisfied_serial"))==int(viewer.get("live_serial")) and shown.get("worldId")==world.get("id") and shown.get("request",{}).get("preview")==false and shown.get("request",{}).get("resolution")==512

# Hash actual packed values, not only version strings. No huge JSON source dump.
func digest_values(values)->PackedByteArray:
	if typeof(values)==TYPE_PACKED_BYTE_ARRAY:return values
	if typeof(values) in [TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_INT64_ARRAY,TYPE_PACKED_FLOAT32_ARRAY,TYPE_PACKED_FLOAT64_ARRAY]:return values.to_byte_array()
	# Native variant encoding keeps nested packed arrays binary. Avoid giant JSON
	# strings when hashing the full canonical context at every visibility state.
	return var_to_bytes(values)

func digest_fields(record:Dictionary,names:Array)->String:
	var context=HashingContext.new();context.start(HashingContext.HASH_SHA256)
	for name in names:
		context.update(str(name).to_utf8_buffer())
		var bytes=digest_values(record.get(name))
		if not bytes.is_empty():context.update(bytes)
	return context.finish().hex_encode()

func inventory_digest(packet:Dictionary)->String:
	var columns:Dictionary=packet.get("candidateColumns",{})
	if not columns.is_empty():return digest_fields(columns,["ids","family","positions","size","rank","orientation","variant","crownRadiusM"])
	return digest_fields({"candidates":packet.get("candidates",packet.get("populations",[]))},["candidates"])

func physical_parent_digest(world:Dictionary)->String:
	var parents:Array=[]
	for item in world.get("_terrainParents",[]):
		var t:Dictionary=item.get("terrain",{})
		var physical:Dictionary={}
		for key in ["width","height","originX","originZ","spacingM","heights","source","reconstruction"]:physical[key]=t.get(key)
		parents.append({"terrain":physical,"bounds":item.get("bounds"),"canonicalContextId":item.get("canonicalContextId")})
	return digest_fields({"parents":parents},["parents"])

func instance_buffer_digest()->String:
	var buffers:Dictionary={}
	var objects:Node=viewer.get("objects")
	for item in objects.get_children():
		if item is MultiMeshInstance3D and item.multimesh!=null:buffers[str(item.name)]=item.multimesh.buffer
	var names=buffers.keys();names.sort()
	return digest_fields(buffers,names)

func near_instance_error(view:Dictionary,first:Dictionary)->String:
	var pop:Dictionary=view.get("populationInstances",{});var initial:Dictionary=first.get("populationInstances",{})
	if not pop.get("families") is Dictionary or not initial.get("families") is Dictionary:return "Near probe omitted actual instance families"
	var low=0
	for family in ["grass","shrub","debris"]:low+=int(initial.families.get(family,{}).get("alphaPositiveInFrustum",0))
	if int(initial.families.get("tree",{}).get("alphaPositiveInFrustum",0))<=0 or low<=0:return "Near all-layers view lacks actual alpha-positive tree or low-cover instances"
	if not view.visibility.trees and (pop.get("treeResidualEnabled",true) or pop.get("treeOpticalShadowEnabled",true)):return "Disabled trees retain optical canopy or shadow"
	for family in ["tree","trunk","grass","shrub","debris","boulder"]:
		var row:Dictionary=pop.families.get(family,{});var baseline:Dictionary=initial.families.get(family,{})
		if int(row.get("submitted",-1))!=int(baseline.get("submitted",-2)):return "Instance allocation changed during layer masking: "+family
		var enabled=family=="boulder" or (view.visibility.trees if family in ["tree","trunk"] else view.visibility.lowCover)
		for key in ["nodeVisible","alphaPositiveInFrustum"]:
			if int(row.get(key,-1))!=(int(baseline.get(key,-2)) if enabled else 0):return "Actual family visibility did not match independent layer mask: "+family
	return ""

func physical_snapshot()->Dictionary:
	var world:Dictionary=viewer.get("rendered_world");var packet:Dictionary=viewer.get("rendered_packet")
	var canonical=Data.context(world);var fields:Dictionary=canonical.fields
	var ground_keys=["groundMaterial","groundMaterialSecondary","groundMaterialBlend","groundMaterialMeanColor"]
	var focus:Dictionary=viewer.get("focus");var width=float(viewer.get("width_m"));var samples:Array=[];var low=0.0;var trees=0.0
	for dz in [-0.2,0.0,0.2]:
		for dx in [-0.2,0.0,0.2]:
			var x=clampf(float(focus.x)+dx*width,float(canonical.bounds.minX),float(canonical.bounds.maxX))
			var z=clampf(float(focus.y)+dz*width,float(canonical.bounds.minZ),float(canonical.bounds.maxZ))
			for key in ground_keys:samples.append(Data.field_at(world,key,x,z,key!="groundMaterialBlend"))
			low+=Data.field_at(world,"lowCoverOpacity",x,z)/9.0;trees+=Data.field_at(world,"treeCover",x,z)/9.0
	var visibility:Dictionary=viewer.get("layer_visibility")
	var material=viewer.get("terrain").get("material")
	var uniforms={"ground":material.call("get_shader_param","show_ground"),"lowCover":material.call("get_shader_param","show_low_cover"),"trees":material.call("get_shader_param","show_trees")}
	var detail:Dictionary=world.get("geometryDetail",{});var detail_keys=detail.keys();detail_keys.sort()
	return {"visibility":visibility.duplicate(),"worldId":world.id,"widthM":width,"focus":{"x":float(focus.x),"y":float(focus.y)},"oblique":bool(viewer.get("oblique")),"terrainVersion":str(world.versions.terrain)+":"+digest_fields(world.terrain,["heights"]),
		"canonicalContextId":world.get("canonicalContextRef",{}).get("id",world.id),"groundFieldsVersion":digest_fields(fields,ground_keys),
		"canonicalContextFingerprint":digest_fields(canonical,["grid","bounds","source","versions","fields"]),"parentTerrainFingerprint":physical_parent_digest(world),
		"projectedGroundFieldsVersion":digest_fields(world.fields,ground_keys),"geometryDetailFingerprint":digest_fields(detail,detail_keys),"instanceBufferFingerprint":instance_buffer_digest(),
		"inventoryFingerprint":inventory_digest(packet),"geometryDetailId":world.get("geometryDetail",{}).get("id",""),
		"groundSampleFingerprint":digest_fields({"samples":samples},["samples"]),"lowCoverOpacity":low if visibility.lowCover else 0.0,
		"treeOpticalCoverage":trees if visibility.trees else 0.0,"physicalLowCoverMean":low,"physicalTreeCoverMean":trees,
		"surfaceLayers":world.get("surfaceLayers",{}),"layerUniforms":uniforms,
		"populationInstances":viewer.call("population_instances") if viewer.has_method("population_instances") else {"available":false,"scope":"Renderer does not expose actual instance counts"}}

func run()->void:
	var args=options()
	if args.has("--layer-check-only"):print("SURFACE_LAYER_PROBE_PARSE_OK");quit();return
	if not args.has("--world") or not args.has("--layer-report") or not args.has("--layer-captures"):
		push_error("Layer probe requires --world, --layer-report and --layer-captures");quit(2);return
	var packed=load("res://scene/main.tscn") as PackedScene
	viewer=packed.instantiate();root.add_child(viewer);current_scene=viewer
	if not viewer.has_method("set_layer_visibility"):push_error("Selected viewer has no explicit layer visibility hook");quit(2);return
	var require_instances=args.has("--layer-require-instances")
	if require_instances and not viewer.has_method("population_instances"):push_error("Near layer probe requires actual renderer population_instances metadata");quit(2);return
	var began=Time.get_ticks_msec();var require_live=args.has("--live-url")
	while not ready(require_live) and Time.get_ticks_msec()-began<180000:await process_frame
	if not ready(require_live):push_error("Layer probe did not reach a final source snapshot");quit(1);return
	var world:Dictionary=viewer.get("rendered_world")
	if world.get("surfaceLayers",{}).get("groundAvailability")!="explicit" or world.get("surfaceLayers",{}).get("lowCoverAvailability")!="explicit":
		push_error("Legacy composite cannot qualify bare ground");quit(1);return
	var report={"format":"magna-layer-isolation-proof","version":2,"status":"running","widthM":float(viewer.get("width_m")),"requireInstances":require_instances,"views":[],
		"scope":"Four production visibility states at one fixed camera/source snapshot, actual binary source/context/ground/geometry/inventory/instance-buffer hashes, shader uniforms and central image digests. Near views additionally require actual submitted/visible/alpha-positive-in-frustum instances. Counts are not GPU occlusion or per-pixel crown areas; potential cover diagnostics remain explicitly separate."}
	var cases=[{"name":"all","ground":true,"lowCover":true,"trees":true},{"name":"no-low-cover","ground":true,"lowCover":false,"trees":true},{"name":"no-trees","ground":true,"lowCover":true,"trees":false},{"name":"ground","ground":true,"lowCover":false,"trees":false}]
	for test in cases:
		viewer.call("set_layer_visibility",test.ground,test.lowCover,test.trees)
		await process_frame;await process_frame
		var started=Time.get_ticks_msec()
		while not ready(require_live) and Time.get_ticks_msec()-started<60000:await process_frame
		if not ready(require_live):push_error("Layer visibility did not settle");quit(1);return
		await RenderingServer.frame_post_draw
		var image=root.get_texture().get_image();var size=image.get_size()
		var centre=image.get_region(Rect2i(Vector2i(size.x/4,size.y/4),Vector2i(size.x/2,size.y/2)))
		var hasher=HashingContext.new();hasher.start(HashingContext.HASH_SHA256);hasher.update(centre.get_data())
		var pixel_hash=hasher.finish().hex_encode()
		var view=physical_snapshot();view.name=test.name;view.centralPixelSha256=pixel_hash
		view.capturePath=str(args["--layer-captures"]).path_join(test.name+".png")
		if require_instances:
			var issue=near_instance_error(view,report.views[0] if not report.views.is_empty() else view)
			if not issue.is_empty():push_error(issue);quit(1);return
		report.views.append(view)
		await viewer.call("_capture",view.capturePath)
	# A single-variable unlit support diagnostic, still using the exact same data.
	viewer.call("set_layer_visibility",true,false,false);viewer.set("diagnostic",7)
	var terrain:Node=viewer.get("terrain");terrain.get("material").call("set_shader_param","diagnostic",7)
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var bare=physical_snapshot();bare.diagnostic=int(terrain.get("material").call("get_shader_param","diagnostic"))
	bare.capturePath=str(args["--layer-captures"]).path_join("ground-mean-unlit.png")
	report.bareGroundMean=bare;await viewer.call("_capture",bare.capturePath)
	viewer.set("diagnostic",0);terrain.get("material").call("set_shader_param","diagnostic",0)
	viewer.call("set_layer_visibility",true,true,true);await process_frame
	var restore_started=Time.get_ticks_msec()
	while not ready(require_live) and Time.get_ticks_msec()-restore_started<60000:await process_frame
	if not ready(require_live):push_error("Layer restore did not settle");quit(1);return
	report.restored=physical_snapshot()
	report.status="complete";report.durationMs=Time.get_ticks_msec()-began
	viewer.call("_write_metrics")
	var target=ProjectSettings.globalize_path(str(args["--layer-report"]));DirAccess.make_dir_recursive_absolute(target.get_base_dir())
	var file=FileAccess.open(target,FileAccess.WRITE)
	if file==null:push_error("Cannot write layer isolation report");quit(1);return
	file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"event":"layer-isolation-proof","path":target,"status":report.status}));quit()
