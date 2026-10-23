extends Node3D

const Data = preload("res://adapters/surface_data.gd")
const Library = preload("res://adapters/material_library.gd")
const ShaderSource = preload("res://adapters/surface_shader.gd")
const Geometry = preload("res://adapters/surface_geometry.gd")
const ScenePrepare = preload("res://adapters/surface_scene_prepare.gd")
var surface_shader_code := ""
var world: Dictionary = {}
var packet: Dictionary = {}
var options: Dictionary = {}
var camera := Camera3D.new()
var sun := DirectionalLight3D.new()
var library := Library.new()
var terrain: Node3D
var objects := Node3D.new()
var origin: Dictionary = {"x":0.0,"y":0.0,"z":0.0}
var focus: Dictionary = {"x":0.0,"y":0.0}
var width_m := 40000.0
var oblique := true
var diagnostic := 0
var worker: Thread
var requested_focus: Dictionary = {"x":0.0,"y":0.0}
var requested_width := 40000.0
var generation := 0
var applied_generation := 0
var frames := 0
var warm_frames := 0
var frame_times: Array[float] = []
var all_frame_times: Array[float] = []
var process_times: Array[float] = []
var gpu_render_times: Array[float] = []
var cpu_render_times: Array[float] = []
var previous_frame_tick := 0
var packet_worker: Thread
var packet_context: Dictionary = {}
var canonical_contexts: Dictionary = {}
var known_context_id := ""
var context_textures: Dictionary = {}
var prepared_context_key := ""
var stream_requested_serial := -1
var last_stream_tick := 0
var last_stream_world_id := ""
var height_source_cache: Dictionary = {}
var prepared_height_key := ""
var world_revision := 0
var rendered_revision := -1
var scene_mesh_cache: Dictionary = {}
var upload_times: Array[float] = []
var prepare_times: Array[float] = []
var hud := Label.new()
var last_request_tick := 0
var request_id := 0
var selected_candidates := 0
var candidate_count := 0
var paused := false
var world_path := ""
var world_modified := 0
var stream_directory := ""
var last_stream_request := ""
var capture_pending := false
var tour_index := 0
var tour_settle := 0
var tour_widths: Array[float] = [40000,10000,2560,640,160,40,10]
var live_request := HTTPRequest.new()
var live_busy := false
var live_serial := 0
var live_requested_serial := 0
var last_live_tick := 0
var candidate_buckets: Dictionary = {}
var indexed_packet: Dictionary = {}
var view_dirty := true
var rejected_files: Dictionary = {}
var last_live_applied_serial := -1
var failed_live_serial := -1
var region_counts: Array[int] = []
var preparation_snapshots: Array = []
var canopy_info: Dictionary = {}
var canopy_textures: Dictionary = {}
var canopy_materials: Array[ShaderMaterial] = []
var rendered_source: Dictionary = {}

func _ready() -> void:
	_parse_options()
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(),true)
	surface_shader_code = ShaderSource.build()
	if options.has("--resolution"):
		var dimensions: PackedStringArray = str(options["--resolution"]).split("x")
		if dimensions.size()==2: get_window().size = Vector2i(int(dimensions[0]),int(dimensions[1]))
	if not ClassDB.class_exists("Terrain3D"):
		push_error("Terrain3D missing. Run viewer-local/bootstrap.ps1 first.")
		get_tree().quit(2)
		return
	var addon = ClassDB.instantiate("Terrain3D")
	assert(addon.get("version")=="1.0.2","Expected pinned Terrain3D 1.0.2")
	addon.free()
	world_path = options.get("--world", "")
	if world_path.is_empty():
		push_error("Required: -- --world <SurfaceWorld.json> [--assets resolved.json]")
		get_tree().quit(2)
		return
	packet = Data.read_json(world_path)
	packet["_showProxies"]=options.has("--show-proxies")
	world = Data.unpack_world(packet)
	if world.is_empty():
		get_tree().quit(2)
		return
	if not _resolve_context(world):
		get_tree().quit(2)
		return
	world["_cityIdentity"]=Geometry.city_identity(packet)
	world["_showProxies"]=packet._showProxies
	if packet.has("terrainParents"): world["_terrainParents"]=_external_parents(packet,world)
	world_modified = FileAccess.get_modified_time(world_path)
	var b: Dictionary = world.bounds
	focus = {"x":(float(b.minX)+float(b.maxX))*0.5,"y":(float(b.minZ)+float(b.maxZ))*0.5}
	if options.has("--x"): focus.x = float(options["--x"])
	if options.has("--z"): focus.y = float(options["--z"])
	width_m = float(options.get("--width",maxf(float(b.maxX)-float(b.minX),float(b.maxZ)-float(b.minZ))))
	diagnostic = int(options.get("--diagnostic",0))
	oblique = not options.has("--top")
	stream_directory = options.get("--stream-dir", "")
	library.load_manifest(options.get("--assets", ""))
	_setup_lighting()
	camera.name = "RelativeCamera"
	camera.fov = 48.0
	camera.current = true
	add_child(camera)
	add_child(objects)
	add_child(live_request)
	live_request.timeout = 120.0
	live_request.request_completed.connect(_live_completed)
	var canvas := CanvasLayer.new()
	add_child(canvas)
	hud.position = Vector2(18,16)
	hud.add_theme_color_override("font_color", Color.WHITE)
	hud.add_theme_color_override("font_shadow_color",Color.BLACK)
	hud.add_theme_constant_override("shadow_outline_size",4)
	canvas.add_child(hud)
	hud.visible=options.has("--hud") or diagnostic>0
	_begin_prepare()
	_request_live()
	print(JSON.stringify({"event":"surface-viewer-start","godot":Engine.get_version_info().string,"terrain3d":"1.0.2","backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"source":world.terrain.source,"worldId":world.id,"pbrAssets":library.loaded_assets}))

func _parse_options() -> void:
	var args := OS.get_cmdline_user_args()
	var i := 0
	while i < args.size():
		var key := args[i]
		if i+1 < args.size() and not args[i+1].begins_with("--"):
			options[key] = args[i+1]
			i += 2
		else:
			options[key] = true
			i += 1

func _setup_lighting() -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_SKY
	settings.sky = Sky.new()
	var sky := ProceduralSkyMaterial.new()
	sky.sky_top_color = Color(0.20,0.39,0.66)
	sky.sky_horizon_color = Color(0.64,0.74,0.83)
	sky.ground_bottom_color = Color(0.12,0.14,0.14)
	sky.ground_horizon_color = Color(0.58,0.66,0.72)
	settings.sky.sky_material = sky
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	settings.ambient_light_energy = 0.55
	settings.reflected_light_source = 2
	settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	settings.tonemap_exposure = 1.0
	environment.environment = settings
	add_child(environment)
	sun.rotation_degrees = Vector3(-48,-32,0)
	sun.light_color = Color(1.0,0.95,0.85)
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 2000.0
	add_child(sun)

func _begin_prepare() -> void:
	if worker != null:
		view_dirty = true
		return
	view_dirty = false
	generation += 1
	requested_focus = focus.duplicate()
	requested_width = width_m
	var spacing := Data.display_spacing(world.terrain,width_m)
	var snap_step := spacing*64.0
	var snapped_x: float = float(world.terrain.originX)+round((float(focus.x)-float(world.terrain.originX))/snap_step)*snap_step
	var snapped_z: float = float(world.terrain.originZ)+round((float(focus.y)-float(world.terrain.originZ))/snap_step)*snap_step
	if options.has("--rebase-offset-m"): snapped_x+=round(float(options["--rebase-offset-m"])/spacing)*spacing
	var reference_height := Data.height_at(world,snapped_x,snapped_z)
	var next_origin: Dictionary = {"x":snapped_x,"y":reference_height,"z":snapped_z}
	prepared_context_key = known_context_id if not known_context_id.is_empty() else str(world.id)
	prepared_height_key = str(world.id)+"@"+str(spacing)
	var reuse_height: bool = terrain!=null and rendered_revision==world_revision and absf(origin.x-snapped_x)<0.00001 and absf(origin.z-snapped_z)<0.00001 and absf(float(terrain.get("vertex_spacing"))-spacing)<0.00001
	var water_world := world.duplicate(false)
	var canonical := Data.context(world)
	water_world.id=prepared_context_key
	water_world.versions=canonical.get("versions",world.get("versions",{}))
	var water_key := Geometry.chunk_key(world,focus,width_m,"water")
	var urban_key := Geometry.chunk_key(world,focus,width_m,"urban")
	var scene_request := {"waterKey":water_key,"urbanKey":urban_key,"buildWater":not options.has("--ground-only") and not scene_mesh_cache.has(water_key),"buildUrban":not options.has("--ground-only") and not scene_mesh_cache.has(urban_key),"focus":focus.duplicate()}
	worker = Thread.new()
	worker.start(ScenePrepare.prepare.bind({"world":world,"origin":next_origin,"width":width_m,"generation":generation,"packet":packet,"skipContext":context_textures.has(prepared_context_key),"displaySource":height_source_cache.get(prepared_height_key,{}),"skipHeight":reuse_height,"sceneRequest":scene_request,"focus":focus.duplicate(),"viewportWidth":get_viewport().get_visible_rect().size.x,"oblique":oblique}))
	last_request_tick = Time.get_ticks_msec()

func _apply_prepared(prepared: Dictionary) -> void:
	if prepared.worldId != world.id:
		return
	var world: Dictionary = prepared.world
	var packet: Dictionary = prepared.packet
	height_source_cache[prepared_height_key]=prepared.displaySource
	while height_source_cache.size()>3: height_source_cache.erase(height_source_cache.keys()[0])
	var begin := Time.get_ticks_usec()
	var next_terrain: Node3D = terrain
	var recreate := terrain==null
	if recreate:
		next_terrain = ClassDB.instantiate("Terrain3D")
		next_terrain.name = "SurfaceTerrain"
		next_terrain.set("region_size",256)
		next_terrain.set("vertex_spacing",prepared.spacing)
		next_terrain.set("mesh_lods",10)
		next_terrain.set("mesh_size",32)
		next_terrain.set("collision_mode",0)
		next_terrain.set("free_editor_textures",false)
		add_child(next_terrain)
		next_terrain.get("collision").set("mode",0)
		next_terrain.call("set_camera",camera)
	elif absf(float(next_terrain.get("vertex_spacing"))-float(prepared.spacing))>0.001:
		next_terrain.set("vertex_spacing",prepared.spacing)
	var mat: Object = next_terrain.get("material")
	if recreate:
		var shader := Shader.new()
		shader.code = surface_shader_code
		mat.set("shader_override",shader)
		mat.set("shader_override_enabled",true)
		mat.set("world_background",0)
	var next_origin: Dictionary = prepared.origin
	library.configure(mat,world,next_origin)
	var t: Dictionary = prepared.contextGrid
	if not context_textures.has(prepared_context_key):
		context_textures[prepared_context_key] = {"surface_ids":ImageTexture.create_from_image(prepared.ids),"surface_state":ImageTexture.create_from_image(prepared.state),"surface_bedrock":ImageTexture.create_from_image(prepared.rock),"surface_average":ImageTexture.create_from_image(prepared.average)}
		while context_textures.size()>2: context_textures.erase(context_textures.keys()[0])
	for name in context_textures[prepared_context_key]: mat.call("set_shader_param",name,context_textures[prepared_context_key][name])
	mat.call("set_shader_param","source_spacing_m",float(t.spacingM))
	mat.call("set_shader_param","source_grid_size",Vector2(int(t.width),int(t.height)))
	mat.call("set_shader_param","source_origin",Vector2(float(t.originX)-next_origin.x,float(t.originZ)-next_origin.z))
	mat.call("set_shader_param","source_extent",Vector2((int(t.width)-1)*float(t.spacingM),(int(t.height)-1)*float(t.spacingM)))
	mat.call("set_shader_param","diagnostic",diagnostic)
	if packet.has("candidateBounds"):
		var cb: Dictionary = packet.candidateBounds
		mat.call("set_shader_param","candidate_bounds",Vector4(float(cb.minX)-next_origin.x,float(cb.minZ)-next_origin.z,float(cb.maxX)-next_origin.x,float(cb.maxZ)-next_origin.z))
	if prepared.height!=null:
		# A smaller import does not remove old Terrain3D regions automatically.
		# Remove the previous active set before importing one coherent new window.
		var terrain_data: Object = next_terrain.get("data")
		for region in terrain_data.call("get_regions_active",true,false): terrain_data.call("remove_region",region,false)
		var images: Array[Image] = [prepared.height,prepared.control,null]
		next_terrain.get("data").call("import_images",images,prepared.localStart,0.0,1.0)
	mat.set("show_checkered",false)
	terrain = next_terrain
	origin = next_origin
	applied_generation = int(prepared.generation)
	rendered_revision=world_revision
	rendered_source=world.terrain.source.duplicate()
	_update_canopy_textures(prepared.populations.get("canopy",{}))
	_build_scene_objects(prepared)
	_apply_canopy_parameters(mat)
	_update_camera()
	prepare_times.append(float(prepared.prepareMs))
	upload_times.append((Time.get_ticks_usec()-begin)/1000.0)
	warm_frames = 0
	region_counts.append(int(terrain.get("data").call("get_region_count")))
	preparation_snapshots.append({"focus":requested_focus.duplicate(),"widthM":requested_width,"generation":prepared.generation,"sourceId":world.terrain.source.id})
	print(JSON.stringify({"event":"terrain-replaced","worldId":world.id,"origin":[origin.x,origin.y,origin.z],"sourceLOD":world.terrain.source.sourceLOD,"nativeSpacingM":world.terrain.source.nativeSpacingM,"displaySpacingM":prepared.spacing,"regions":terrain.get("data").call("get_region_count"),"prepareMs":prepared.prepareMs,"uploadAndObjectsMs":upload_times.back()}))

func _update_camera() -> void:
	var target := Vector3(focus.x-origin.x,Data.height_at(world,focus.x,focus.y)-origin.y,focus.y-origin.z)
	# Orthographic top view gives an exact physical frame width and mm/px diagnostic.
	if not oblique:
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
		camera.size = width_m/get_viewport().get_visible_rect().size.aspect()
		var highest: float = float(world.get("_heightRange",Vector2(0,0)).y)-origin.y
		camera.position = target+Vector3(0,maxf(maxf(width_m,20.0),highest-target.y+maxf(1.0,width_m*0.02)),0.0001)
	else:
		camera.projection = Camera3D.PROJECTION_PERSPECTIVE
		var distance := width_m/(2.0*tan(deg_to_rad(camera.fov)*0.5)*get_viewport().get_visible_rect().size.aspect())
		camera.position = target+Vector3(0,0.73,0.68).normalized()*distance
		var camera_ground: float = Data.height_at(world,float(camera.position.x)+origin.x,float(camera.position.z)+origin.z)-origin.y
		camera.position.y=maxf(camera.position.y,camera_ground+maxf(0.05,width_m*0.003))
	var distance_to_target := camera.position.distance_to(target)
	camera.near = maxf(0.01,distance_to_target*0.01)
	var lowest: float = float(world.get("_heightRange",Vector2(0,0)).x)-origin.y
	camera.far = maxf(maxf(camera.near+100.0,distance_to_target+width_m*3.0),camera.position.y-lowest+width_m*0.1)
	camera.look_at(target,Vector3.UP if oblique else Vector3.FORWARD)
	sun.directional_shadow_max_distance = clampf(width_m*1.5,40.0,3000.0)
	var reference_y := Data.height_at(world,focus.x,focus.y)-float(origin.y)
	if terrain!=null: terrain.get("material").call("set_shader_param","canopy_reference_y",reference_y)
	for material in canopy_materials: material.set_shader_parameter("canopy_reference_y",reference_y)

func _build_scene_objects(prepared: Dictionary) -> void:
	canopy_materials.clear()
	for child in objects.get_children():
		child.visible=false
		child.queue_free()
	if options.has("--ground-only"): return
	var request: Dictionary = prepared.sceneRequest
	if prepared.has("waterGeometry"):
		var data: Dictionary = prepared.waterGeometry
		var entry := {"mesh":_mesh_from_arrays(prepared.waterArrays),"anchor":data.anchor,"quads":data.quads,"sourceStride":data.sourceStride,"buildMs":data.buildMs}
		for key in ["coverageOrigin","coverageSpacingM","coverageSize","bedOrigin","bedSpacingM","bedSize","bedBounds","bedReconstruction"]:
			if data.has(key): entry[key]=data[key]
		if data.has("coverageImage"): entry.coverageTexture=ImageTexture.create_from_image(data.coverageImage)
		if data.has("bedImage"): entry.bedTexture=ImageTexture.create_from_image(data.bedImage)
		scene_mesh_cache[request.waterKey]=entry
	if prepared.has("urbanGeometry"):
		var data: Dictionary = prepared.urbanGeometry
		scene_mesh_cache[request.urbanKey]={"batches":_urban_batch_meshes(prepared.urbanBatches),"roads":_mesh_from_arrays(prepared.roadArrays),"anchor":data.anchor,"nativeBuildings":data.nativeBuildings,"proxyBuildings":data.proxyBuildings,"budgetLimited":data.budgetLimited,"buildMs":data.buildMs}
	while scene_mesh_cache.size()>8: scene_mesh_cache.erase(scene_mesh_cache.keys()[0])
	if scene_mesh_cache.has(request.waterKey):
		var entry: Dictionary = scene_mesh_cache[request.waterKey]
		if entry.mesh.get_surface_count()>0:
			var water := MeshInstance3D.new()
			water.name="ExplicitWater"
			water.layers=2
			water.mesh=entry.mesh
			water.position=Vector3(entry.anchor.x-origin.x,entry.anchor.y-origin.y,entry.anchor.z-origin.z)
			var material := ShaderMaterial.new()
			material.shader=load("res://shaders/water.gdshader")
			material.render_priority=1
			material.set_shader_parameter("wave_phase",Vector2(fposmod(origin.x*0.32,TAU),fposmod(origin.z*0.27,TAU)))
			material.set_shader_parameter("render_origin_y",float(origin.y))
			material.set_shader_parameter("coverage_enabled",entry.has("coverageTexture"))
			if entry.has("coverageTexture"):
				material.set_shader_parameter("coverage_map",entry.coverageTexture)
				material.set_shader_parameter("coverage_origin_local",Vector2(float(entry.coverageOrigin.x)-float(origin.x),float(entry.coverageOrigin.z)-float(origin.z)))
				material.set_shader_parameter("coverage_spacing",entry.coverageSpacingM)
				material.set_shader_parameter("coverage_grid_size",Vector2(entry.coverageSize))
			material.set_shader_parameter("bed_clip_enabled",entry.has("bedTexture"))
			if entry.has("bedTexture"):
				var b: Dictionary = entry.bedBounds
				material.set_shader_parameter("bed_map",entry.bedTexture)
				material.set_shader_parameter("bed_origin_local",Vector2(float(entry.bedOrigin.x)-float(origin.x),float(entry.bedOrigin.z)-float(origin.z)))
				material.set_shader_parameter("bed_spacing",entry.bedSpacingM)
				material.set_shader_parameter("bed_grid_size",Vector2(entry.bedSize))
				material.set_shader_parameter("bed_bounds_local",Vector4(float(b.minX)-float(origin.x),float(b.minZ)-float(origin.z),float(b.maxX)-float(origin.x),float(b.maxZ)-float(origin.z)))
				material.set_shader_parameter("bed_cubic",entry.bedReconstruction=="cubic-bspline-controls")
			water.material_override=material
			objects.add_child(water)
	if scene_mesh_cache.has(request.urbanKey):
		var entry: Dictionary = scene_mesh_cache[request.urbanKey]
		var position := Vector3(entry.anchor.x-origin.x,entry.anchor.y-origin.y,entry.anchor.z-origin.z)
		for batch in entry.batches:
			if batch.mesh.get_surface_count()==0: continue
			var city := MeshInstance3D.new()
			city.name="NativeBuildingMeshes_"+str(batch.materialId)
			city.layers=2
			city.mesh=batch.mesh
			city.position=position
			city.set_meta("nativeMaterialId",batch.materialId)
			city.set_meta("buildingIds",batch.buildingIds)
			var material := StandardMaterial3D.new()
			material.albedo_color=Color(0.63,0.56,0.44)
			material.roughness=0.85
			material.cull_mode=BaseMaterial3D.CULL_BACK
			city.material_override=material
			objects.add_child(city)
		if entry.roads.get_surface_count()>0:
			var roads := MeshInstance3D.new()
			roads.name="DrapedRoadBatch"
			roads.layers=2
			roads.mesh=entry.roads
			roads.position=position
			var material := ShaderMaterial.new()
			material.shader=load("res://shaders/road.gdshader")
			material.render_priority=2
			roads.material_override=material
			objects.add_child(roads)
	_build_populations(prepared.populations)
	if diagnostic==5:
		var normals := ShaderMaterial.new()
		normals.shader=load("res://shaders/normals.gdshader")
		for child in objects.get_children():
			if child is GeometryInstance3D: child.material_override=normals
func _mesh_from_arrays(arrays: Array) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	if arrays[Mesh.ARRAY_VERTEX].size()>0: mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	return mesh

func _urban_batch_meshes(batches: Array) -> Array:
	var result: Array = []
	for batch in batches:
		var item: Dictionary = batch.duplicate(false)
		item.mesh=_mesh_from_arrays(item.arrays); item.erase("arrays"); result.append(item)
	return result

func _build_populations(populations: Dictionary) -> void:
	candidate_count=int(populations.candidateCount)
	selected_candidates=int(populations.selectedCount)
	var families: Dictionary = populations.families
	for family in families:
		var visible: Array = families[family]
		if visible.is_empty(): continue
		var mesh: Mesh
		var mat := StandardMaterial3D.new()
		if family == "tree" or family == "shrub":
			var shape := SphereMesh.new()
			# 32 sides keep top-down crown-disc area within 0.7% of the coverage atlas.
			shape.radial_segments = 32 if family=="tree" else 8
			shape.rings = 6 if family=="tree" else 4
			shape.radius = 0.42
			shape.height = 1.0
			mesh = shape
			mat.albedo_color = Color(0.10,0.20,0.065)
		elif family == "grass":
			var shape := PrismMesh.new()
			shape.size = Vector3(0.8,1.0,0.65)
			mesh = shape
			mat.albedo_color = Color(0.26,0.32,0.10)
		else:
			var shape := SphereMesh.new()
			shape.radial_segments = 5
			shape.rings = 3
			shape.radius = 0.5
			shape.height = 0.7
			mesh = shape
			mat.albedo_color = Color(0.33,0.32,0.29)
		mat.roughness = 0.91
		var fade_material := ShaderMaterial.new()
		fade_material.shader = load("res://shaders/canopy_instance.gdshader") if family=="tree" else load("res://shaders/surface_object.gdshader")
		fade_material.set_shader_parameter("linear_tint",Vector3(0.055,0.105,0.036) if family=="tree" else Vector3.ONE)
		if family=="tree":
			canopy_materials.append(fade_material)
			_apply_canopy_parameters(fade_material)
		mesh.surface_set_material(0,fade_material)
		var multi := MultiMesh.new()
		multi.transform_format = MultiMesh.TRANSFORM_3D
		multi.use_custom_data = true
		multi.use_colors = true
		multi.mesh = mesh
		multi.instance_count = visible.size()
		multi.buffer=populations.buffers[family]
		var instance := MultiMeshInstance3D.new()
		instance.name = family+"_bounded_instances"
		instance.layers=2
		instance.multimesh = multi
		objects.add_child(instance)
		if family=="tree":
			var trunk_mesh := CylinderMesh.new()
			trunk_mesh.top_radius = 0.035
			trunk_mesh.bottom_radius = 0.055
			trunk_mesh.height = 0.74
			trunk_mesh.radial_segments = 5
			var trunk_mat := ShaderMaterial.new()
			trunk_mat.shader = load("res://shaders/canopy_instance.gdshader")
			canopy_materials.append(trunk_mat)
			_apply_canopy_parameters(trunk_mat)
			trunk_mat.set_shader_parameter("linear_tint",Vector3(0.16,0.105,0.067))
			trunk_mesh.material = trunk_mat
			var trunks := MultiMesh.new()
			trunks.transform_format = MultiMesh.TRANSFORM_3D
			trunks.use_custom_data = true
			trunks.use_colors = true
			trunks.mesh = trunk_mesh
			trunks.instance_count = visible.size()
			trunks.buffer=populations.trunkBuffer
			var trunk_instance := MultiMeshInstance3D.new()
			trunk_instance.name = "tree_trunks"
			trunk_instance.layers=2
			trunk_instance.multimesh = trunks
			objects.add_child(trunk_instance)

func _process(delta: float) -> void:
	if world.is_empty(): return
	var tick := Time.get_ticks_usec()
	var wall_ms := (tick-previous_frame_tick)/1000.0 if previous_frame_tick>0 else delta*1000.0
	previous_frame_tick = tick
	if terrain!=null: all_frame_times.append(wall_ms)
	frames += 1
	if packet_worker!=null and not packet_worker.is_alive():
		var received = packet_worker.wait_to_finish()
		packet_worker = null
		if received is Dictionary: _accept_packet(received,packet_context)
	if worker != null and not worker.is_alive():
		var prepared = worker.wait_to_finish()
		worker = null
		if prepared is Dictionary:
			_apply_prepared(prepared)
		else:
			push_warning("Terrain preparation failed; retaining parent. Navigate or reload to retry.")
			applied_generation=generation
	if worker==null and (view_dirty or rendered_revision!=world_revision) and Time.get_ticks_msec()-last_request_tick>160:
		_begin_prepare()
	if terrain != null:
		warm_frames += 1
		if warm_frames>30:
			frame_times.append(wall_ms)
			var viewport_rid := get_viewport().get_viewport_rid()
			var gpu_ms := RenderingServer.viewport_get_measured_render_time_gpu(viewport_rid)
			var cpu_ms := RenderingServer.viewport_get_measured_render_time_cpu(viewport_rid)
			if gpu_ms>0.0: gpu_render_times.append(gpu_ms)
			if cpu_ms>0.0: cpu_render_times.append(cpu_ms)
	if frames%15 == 0:
		_poll_stream()
		_update_hud()
		if live_serial>live_requested_serial and not live_busy and Time.get_ticks_msec()-last_live_tick>400:
			_request_live()
		if not stream_directory.is_empty() and live_serial>stream_requested_serial and Time.get_ticks_msec()-last_stream_tick>400:
			_request_source()
	var live_ready: bool = not options.has("--live-url") or last_live_applied_serial==live_serial or failed_live_serial==live_serial
	if options.has("--tour") and terrain != null and worker == null and not view_dirty and packet_worker==null and not live_busy and live_ready:
		tour_settle += 1
		if tour_settle == 60:
			_capture(options["--tour"].path_join("%02d_%dm_%s.png" % [tour_index,width_m,"oblique" if oblique else "top"]))
		if tour_settle>65:
			tour_index += 1
			tour_settle = 0
			if tour_index>=tour_widths.size():
				_write_metrics()
				get_tree().quit()
				return
			width_m = tour_widths[tour_index]
			_update_camera()
			live_serial+=1
			_begin_prepare()
			_request_live()
	if options.has("--frames") and terrain != null and worker==null and packet_worker==null and not live_busy and not view_dirty and live_ready and warm_frames>=int(options["--frames"]):
		if options.has("--capture") and not capture_pending:
			capture_pending = true
			_capture(options["--capture"])
			_write_metrics()
			await get_tree().process_frame
			get_tree().quit()
		elif not options.has("--capture"):
			_write_metrics()
			get_tree().quit()
	if warm_frames>30: process_times.append((Time.get_ticks_usec()-tick)/1000.0)

func _update_hud() -> void:
	var spacing: float = world.terrain.source.nativeSpacingM
	var sample_x: float = focus.x
	var sample_z: float = focus.y
	var material_id := int(Data.field_at(world,"material",sample_x,sample_z,true))
	var recipe: Dictionary = world.materials[material_id]
	hud.text = "MAGNA URBIS  /  SURFACE WORLD\n%.2f m wide · %.4f m/px · %s\n%s · source LOD %s / %.2f m native\n%s · rock %d · deposit %d · wet %.2f · trees %.2f\n%d / %d candidates visible · %d frames · %s\nWheel: zoom  Drag: pan  O: top/oblique  D: diagnostics  F: inspect  S: capture  1–7: scales\n%s" % [width_m,width_m/get_viewport().get_visible_rect().size.x,"oblique" if oblique else "top",world.terrain.source.id,str(world.terrain.source.sourceLOD) if world.terrain.source.get("sourceLODKnown",true) else "unknown (retained)",spacing,recipe.family,int(Data.field_at(world,"bedrock",sample_x,sample_z,true)),int(Data.field_at(world,"depositOrigin",sample_x,sample_z,true)),Data.field_at(world,"moisture",sample_x,sample_z),Data.field_at(world,"treeCover",sample_x,sample_z),selected_candidates,candidate_count,frames,"preparing (parent remains visible)" if worker!=null else "ready",world.diagnostics.warnings[0] if world.diagnostics.warnings.size()>0 else ""]

func _unhandled_input(event: InputEvent) -> void:
	if world.is_empty(): return
	# Reproducible capture jobs ignore unrelated desktop input.
	if options.has("--frames") or options.has("--tour"): return
	var changed := false
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			width_m = maxf(0.64,width_m*0.78)
			changed = true
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			width_m = minf(80000.0,width_m/0.78)
			changed = true
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		focus.x -= float(event.relative.x)*width_m/get_viewport().get_visible_rect().size.x
		focus.y -= float(event.relative.y)*width_m/get_viewport().get_visible_rect().size.x
		changed = true
	if event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_H: hud.visible=not hud.visible
			KEY_O: oblique = not oblique; changed = true
			KEY_D:
				var previous := diagnostic
				diagnostic = (diagnostic+1)%6
				if terrain!=null: terrain.get("material").call("set_shader_param","diagnostic",diagnostic)
				if previous==5 or diagnostic==5: _begin_prepare()
			KEY_S: _capture("res://captures/surface-%d.png"%Time.get_unix_time_from_system())
			KEY_F: print(JSON.stringify({"event":"inspect","x":focus.x,"z":focus.y,"heightM":Data.height_at(world,focus.x,focus.y),"material":Data.field_at(world,"material",focus.x,focus.y,true),"bedrock":Data.field_at(world,"bedrock",focus.x,focus.y,true),"sand":Data.field_at(world,"sand",focus.x,focus.y),"silt":Data.field_at(world,"silt",focus.x,focus.y),"clay":Data.field_at(world,"clay",focus.x,focus.y),"waterClass":Data.field_at(world,"waterClass",focus.x,focus.y,true),"source":world.terrain.source}))
			KEY_ESCAPE: _write_metrics(); get_tree().quit()
		if event.keycode>=KEY_1 and event.keycode<=KEY_7:
			width_m = tour_widths[event.keycode-KEY_1]
			changed = true
	if changed:
		_update_camera()
		view_dirty = true
		if worker==null and Time.get_ticks_msec()-last_request_tick>160:
			_begin_prepare()
		live_serial += 1

func _request_live() -> void:
	if not options.has("--live-url") or live_busy: return
	var extent := width_m*1.2+2.0*(16.0+maxf(10.0,float(packet.get("_maximumCrownRadiusM",0.0))))
	var footprint: Dictionary = Data.context(world).bounds
	extent = minf(extent,minf(float(footprint.maxX)-float(footprint.minX),float(footprint.maxZ)-float(footprint.minZ)))
	var request_x := clampf(focus.x-extent*0.5,float(footprint.minX),float(footprint.maxX)-extent)
	var request_z := clampf(focus.y-extent*0.5,float(footprint.minZ),float(footprint.maxZ)-extent)
	var payload := {"region":{"x":request_x,"y":request_z,"extent":extent,"resolution":512}}
	if not known_context_id.is_empty() and canonical_contexts.has(known_context_id): payload.region.knownContextId = known_context_id
	if options.has("--session-id"): payload.sessionId = options["--session-id"]
	live_requested_serial = live_serial
	live_busy = true
	last_live_tick = Time.get_ticks_msec()
	var error := live_request.request(options["--live-url"],PackedStringArray(["Content-Type: application/json","Accept: application/octet-stream, application/json"]),HTTPClient.METHOD_POST,JSON.stringify(payload))
	if error!=OK:
		live_busy = false
		push_warning("Live terrain request failed to start: "+str(error))

func _live_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	live_busy = false
	if live_requested_serial!=live_serial:
		print("Discarded superseded live terrain response")
		return
	if result!=HTTPRequest.RESULT_SUCCESS or code<200 or code>=300:
		failed_live_serial=live_requested_serial
		push_warning("Live terrain unavailable, retaining parent: HTTP "+str(code)+" "+body.get_string_from_utf8().left(240))
		return
	if packet_worker!=null:
		# A newer navigation will issue another request; the parent remains visible.
		live_requested_serial = live_serial-1
		return
	packet_context = {"kind":"live","serial":live_requested_serial}
	packet_worker = Thread.new()
	packet_worker.start(Data.decode_packet.bind(body))

func _request_source() -> void:
	if stream_directory.is_empty(): return
	request_id += 1
	stream_requested_serial=live_serial
	last_stream_tick=Time.get_ticks_msec()
	last_stream_world_id=world.id
	var requests := stream_directory.path_join("requests")
	DirAccess.make_dir_recursive_absolute(requests)
	var id := "%d-%d"%[Time.get_unix_time_from_system(),request_id]
	var content := {"id":id,"worldId":world.id,"bounds":{"minX":focus.x-width_m*0.6,"minZ":focus.y-width_m*0.6,"maxX":focus.x+width_m*0.6,"maxZ":focus.y+width_m*0.6},"resolutionM":maxf(width_m/512.0,0.01),"sourceLOD":world.terrain.source.sourceLOD}
	var temporary := requests.path_join(id+".json.tmp")
	var file := FileAccess.open(temporary,FileAccess.WRITE)
	file.store_string(JSON.stringify(content))
	file=null
	DirAccess.rename_absolute(temporary,requests.path_join(id+".json"))
	last_stream_request = id

func _poll_stream() -> void:
	if packet_worker!=null: return
	var path := world_path
	if not stream_directory.is_empty() and not last_stream_request.is_empty():
		var response := stream_directory.path_join("responses").path_join(last_stream_request+".json")
		if FileAccess.file_exists(response): path = response
	if path==world_path and FileAccess.get_modified_time(path)==world_modified: return
	if rejected_files.get(path,-1)==FileAccess.get_modified_time(path): return
	packet_context = {"kind":"file","path":path,"requestId":last_stream_request,"baseWorldId":last_stream_world_id if path!=world_path else world.id,"modified":FileAccess.get_modified_time(path)}
	packet_worker = Thread.new()
	packet_worker.start(Data.read_json.bind(path))

func _accept_packet(next: Dictionary, context: Dictionary) -> void:
	if context.get("kind")=="file": rejected_files[context.path]=int(context.modified)
	if next.is_empty(): return
	if context.kind=="live" and int(context.serial)!=live_serial: return
	if context.kind=="file" and context.requestId!=last_stream_request: return
	if next.has("requestId") and str(next.requestId)!=last_stream_request:
		last_stream_request=""
		return
	if next.has("baseWorldId") and next.baseWorldId!=context.get("baseWorldId",world.id) and next.baseWorldId!=known_context_id: return
	var next_world := Data.unpack_world(next)
	if next_world.is_empty(): return
	if next.has("source") and next.source.has("canonicalContextId") and next_world.has("canonicalContextRef") and next.source.canonicalContextId!=next_world.canonicalContextRef.id: return
	if not _resolve_context(next_world): return
	next["_showProxies"]=options.has("--show-proxies")
	next_world["_cityIdentity"]=Geometry.city_identity(next)
	next_world["_showProxies"]=next._showProxies
	if context.kind=="file":
		if context.path==world_path: world_modified = int(context.modified)
		else: last_stream_request = ""
	var parents := _external_parents(next,next_world)
	if next_world.terrain.source.id==world.terrain.source.id and next_world.terrain.source.version==world.terrain.source.version:
		parents.append({"terrain":world.terrain,"bounds":world.bounds})
		parents.append_array(world.get("_terrainParents",[]))
	if not parents.is_empty():
		var unique: Array = []
		var seen: Dictionary = {}
		for parent in parents:
			var grid: Dictionary = parent.terrain
			if float(grid.spacingM)<float(next_world.terrain.spacingM): continue
			var key := str(grid.originX)+":"+str(grid.originZ)+":"+str(grid.spacingM)+":"+str(grid.width)+":"+str(grid.height)
			if seen.has(key): continue
			seen[key] = true
			unique.append(parent)
		unique.sort_custom(func(a,b): return float(a.terrain.spacingM)<float(b.terrain.spacingM))
		if unique.size()>6:
			var coarsest: Dictionary = unique.back()
			unique.resize(5)
			unique.append(coarsest)
		next_world["_terrainParents"] = unique
	if context.kind=="live": last_live_applied_serial=int(context.serial)
	var repeated_identity: bool = next_world.id==world.id
	world_revision+=1
	world = next_world
	packet = next
	if repeated_identity:
		context_textures.erase(known_context_id)
		height_source_cache.clear()
		scene_mesh_cache.clear()
	_begin_prepare()

func _external_parents(packet_value: Dictionary, value: Dictionary) -> Array:
	var parents: Array = []
	for parent in packet_value.get("terrainParents",[]):
		if parent.get("canonicalContextId",known_context_id)!=known_context_id: continue
		if parent.terrain.source.id!=value.terrain.source.id or parent.terrain.source.version!=value.terrain.source.version: continue
		parents.append(parent)
	return parents

func _resolve_context(value: Dictionary) -> bool:
	if value.has("canonicalContextRef"):
		var reference: Dictionary = value.canonicalContextRef
		if not value.has("canonicalContext"):
			if not canonical_contexts.has(reference.id):
				push_warning("Canonical context unavailable; retaining previous world: "+str(reference.id))
				return false
			value.canonicalContext = canonical_contexts[reference.id]
		var canonical: Dictionary = value.canonicalContext
		if canonical.id!=reference.id: return false
		if canonical.source.id!=value.terrain.source.id or canonical.source.version!=value.terrain.source.version:
			push_warning("Canonical context terrain source identity mismatch")
			return false
		for key in ["environment","occupation","population","materialLibrary","surfaceState","hydrology","geology"]:
			if canonical.versions.get(key)!=value.versions.get(key):
				push_warning("Canonical context version mismatch: "+key)
				return false
		canonical_contexts[canonical.id] = canonical
		known_context_id = canonical.id
	elif value.has("versions"):
		# An offline world has no server context reference. Never invent the
		# provider's content hash; the first live response supplies the real id.
		known_context_id = ""
	while canonical_contexts.size()>2: canonical_contexts.erase(canonical_contexts.keys()[0])
	return true

func _capture(path: String) -> void:
	await RenderingServer.frame_post_draw
	var absolute := ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	var result := get_viewport().get_texture().get_image().save_png(absolute)
	print(JSON.stringify({"event":"capture","path":absolute,"error":result,"widthM":width_m,"metresPerPixel":width_m/get_viewport().get_visible_rect().size.x}))

func _quantile(values: Array[float], fraction: float) -> Variant:
	if values.is_empty(): return null
	var sorted := values.duplicate()
	sorted.sort()
	return sorted[mini(int(fraction*(sorted.size()-1)),sorted.size()-1)]

func _write_metrics() -> void:
	var metrics := {"godot":Engine.get_version_info().string,"terrain3d":"1.0.2","backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"worldId":world.id,"source":world.terrain.source,"resolution":[get_viewport().get_visible_rect().size.x,get_viewport().get_visible_rect().size.y],"frames":frame_times.size(),"frameWallMs":{"p50":_quantile(frame_times,0.5),"p95":_quantile(frame_times,0.95),"p99":_quantile(frame_times,0.99)},"navigationFrameWallMs":{"p50":_quantile(all_frame_times,0.5),"p95":_quantile(all_frame_times,0.95),"p99":_quantile(all_frame_times,0.99),"max":_quantile(all_frame_times,1.0)},"cpuScriptMs":{"p50":_quantile(process_times,0.5),"p95":_quantile(process_times,0.95),"p99":_quantile(process_times,0.99)},"prepareMs":prepare_times,"uploadAndObjectsMs":upload_times,"regionCounts":region_counts,"preparationSnapshots":preparation_snapshots,"videoMemoryBytes":Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),"textureMemoryBytes":Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED),"drawCalls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"objects":selected_candidates,"candidateCount":candidate_count,"cpuFrameMs":null,"cpuTimeNote":"cpuScriptMs measures this viewer script only; full engine CPU frame/pass timing is not available here.","gpuRenderMs":{"p50":_quantile(gpu_render_times,0.5),"p95":_quantile(gpu_render_times,0.95),"p99":_quantile(gpu_render_times,0.99)},"cpuRenderMs":{"p50":_quantile(cpu_render_times,0.5),"p95":_quantile(cpu_render_times,0.95)},"gpuTimeNote":"RenderingServer measured viewport render time; null when the backend returns no positive samples. Frame wall time separately includes vsync, uploads and driver stalls."}
	var path: String = options.get("--metrics","res://captures/metrics.json")
	path = ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path,FileAccess.WRITE)
	file.store_string(JSON.stringify(metrics,"  "))
	print(JSON.stringify({"event":"metrics","path":path,"metrics":metrics}))

func _exit_tree() -> void:
	if worker!=null: worker.wait_to_finish()
	if packet_worker!=null: packet_worker.wait_to_finish()











func _update_canopy_textures(info: Dictionary) -> void:
	canopy_info=info
	if not info.get("available",false): return
	if not is_same(canopy_textures.get("coverageImage"),info.coverageImage) or not is_same(canopy_textures.get("countsImage"),info.countsImage):
		canopy_textures={"coverageImage":info.coverageImage,"countsImage":info.countsImage,"coverage":ImageTexture.create_from_image(info.coverageImage),"counts":ImageTexture.create_from_image(info.countsImage)}

func _apply_canopy_parameters(material: Object) -> void:
	var values := {"canopy_enabled":canopy_info.get("available",false),"canopy_linear_albedo":Vector3(0.055,0.105,0.036),"canopy_reference_y":Data.height_at(world,focus.x,focus.y)-float(origin.y)}
	if canopy_info.get("available",false):
		var b: Dictionary = canopy_info.bounds
		values.merge({"canopy_coverage":canopy_textures.coverage,"canopy_counts":canopy_textures.counts,
			"canopy_origin":Vector2(float(canopy_info.origin.x)-float(origin.x),float(canopy_info.origin.z)-float(origin.z)),
			"canopy_grid_size":canopy_info.gridSize,"canopy_spacing_m":canopy_info.spacingM,"canopy_fallback_blend_m":canopy_info.fallbackBlendM,
			"canopy_bounds":Vector4(float(b.minX)-float(origin.x),float(b.minZ)-float(origin.z),float(b.maxX)-float(origin.x),float(b.maxZ)-float(origin.z))})
	for key in values:
		if material is ShaderMaterial: material.set_shader_parameter(key,values[key])
		else: material.call("set_shader_param",key,values[key])
