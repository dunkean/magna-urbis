extends Node3D

const Data = preload("res://adapters/surface_data.gd")
const Library = preload("res://adapters/material_library.gd")
const ShaderSource = preload("res://adapters/surface_shader.gd")
const Geometry = preload("res://adapters/surface_geometry.gd")
const ScenePrepare = preload("res://adapters/surface_scene_prepare.gd")
const ViewQuality=preload("res://adapters/surface_view_quality.gd")
const LiveBinding=preload("res://adapters/surface_live_binding.gd")
const WaterProjection=preload("res://adapters/surface_water_projection.gd")
const Presentation = preload("res://adapters/surface_presentation.gd")
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
var layer_visibility:Dictionary={"ground":true,"lowCover":true,"trees":true}
var rendered_surface_layers:Dictionary={}
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
var known_scene_context_id := ""
var scene_contexts: Dictionary = {}
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
var live_request_context:Dictionary={}
var live_http_events:Array=[]
var live_acceptance_events:Array=[]
var live_serial := 0
var live_requested_serial := 0
var last_live_tick := 0
var candidate_buckets: Dictionary = {}
var indexed_packet: Dictionary = {}
var view_dirty := true
var last_real_input_tick:=-1
var quality_preview_active:=false
var rendered_display_samples:=256
var rendered_height_image_size:=0
var rendered_height_range:=Vector2(NAN,NAN)
var view_satisfied_serial:=-1
var view_satisfaction:Dictionary={}
var view_satisfaction_events:Array=[]
var final_quality_pending:=false
var rejected_files: Dictionary = {}
var last_live_applied_serial := -1
var failed_live_serial := -1
var region_counts: Array[int] = []
var preparation_snapshots: Array = []
const CanopyView=preload("res://adapters/surface_canopy_view.gd")
var water_symbol_width_px:float=0.0
var canopy_phase:float=0.0
var canopy_view_state:Dictionary={}
var canopy_transition_busy:bool=false
var canopy_pending:Dictionary={}
var canopy_pending_elapsed:float=0.0
var canopy_pending_start_phase:float=0.0
var canopy_info: Dictionary = {}
var canopy_textures: Dictionary = {}
var canopy_materials: Array[ShaderMaterial] = []
var rendered_source: Dictionary = {}
var rendered_world_id:=""
var rendered_world:Dictionary={}
var rendered_packet:Dictionary={}
var rendered_live_serial:=-1
var rendered_tick_ms:=0
var rendered_snapshot:Dictionary={}
var rendered_presentation_mode:="aerial"
var loaded_live_binding:Dictionary={}
var live_binding_rejections:Array=[]
var render_events:Array=[]
var discarded_preparations:Dictionary={"obsoletePhysicalLineage":0,"olderThanDisplayed":0,"failed":0}
var water_metrics: Dictionary = {}
var rendered_urban_metrics:Dictionary={}
var water_projection_busy:=false
var water_projection_cache:Dictionary={}
var road_texture: ImageTexture
var road_projector_count := 0
var presentation_mode := "aerial"
var environment_settings: Environment
var geometry_detail_textures:Dictionary={}
var rendered_geometry_detail:Dictionary={}
var city_map_metrics:Dictionary={}
var scene_top_y:=-INF
var unsupported_tree_count:=0

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
	var symbol_option=options.get("--water-symbol-width-px","0")
	if not symbol_option is String or not symbol_option.is_valid_float() or not is_finite(float(symbol_option)) or float(symbol_option)<0.0 or float(symbol_option)>1.25:
		push_error("--water-symbol-width-px requires a finite number from 0 to 1.25")
		get_tree().quit(2);return
	water_symbol_width_px=float(symbol_option)
	if options.get("--water-mode","source-map") not in ["source-map","source-levels"]:
		push_error("--water-mode must be source-map or source-levels")
		get_tree().quit(2);return
	if water_symbol_width_px>0 and options.get("--water-mode","source-map")=="source-levels":
		push_error("Water symbols are a map presentation and cannot be applied to source-levels")
		get_tree().quit(2);return
	world_path = options.get("--world", "")
	if world_path.is_empty():
		push_error("Required: -- --world <SurfaceWorld.json> [--assets resolved.json]")
		get_tree().quit(2)
		return
	packet = Data.read_json(world_path)
	packet=Presentation.overrides(packet,str(options.get("--style","")),str(options.get("--style-catalogue","")))
	presentation_mode=Presentation.profile(packet,str(options.get("--presentation","cartographic" if options.has("--style") else ""))).mode
	if not _resolve_scene(packet):
		get_tree().quit(2)
		return
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
	if options.has("--live-url"):loaded_live_binding=LiveBinding.from_packet(packet,world)
	world_modified = FileAccess.get_modified_time(world_path)
	var b: Dictionary = world.bounds
	focus = {"x":(float(b.minX)+float(b.maxX))*0.5,"y":(float(b.minZ)+float(b.maxZ))*0.5}
	if options.has("--x"): focus.x = float(options["--x"])
	if options.has("--z"): focus.y = float(options["--z"])
	width_m = float(options.get("--width",maxf(float(b.maxX)-float(b.minX),float(b.maxZ)-float(b.minZ))))
	diagnostic = int(options.get("--diagnostic",0))
	var layers_mode=str(options.get("--layers","all"))
	if layers_mode!="all": layer_visibility={"ground":layers_mode=="ground","lowCover":layers_mode=="low-cover","trees":layers_mode=="canopy"}
	oblique = options.has("--oblique") or (not options.has("--top") and presentation_mode!="cartographic")
	stream_directory = options.get("--stream-dir", "")
	library.load_manifest(options.get("--assets", ""))
	_setup_lighting()
	camera.name = "RelativeCamera"
	camera.fov = 48.0
	camera.current = true
	add_child(camera)
	add_child(objects)
	add_child(live_request)
	# Large source packets must drain on the HTTP worker, independently of frame rate.
	live_request.use_threads=true
	live_request.download_chunk_size=1024*1024
	live_request.body_size_limit=Data.MAX_PACKET_BYTES
	live_request.timeout=300.0
	live_request.request_completed.connect(_live_completed)
	var canvas := CanvasLayer.new()
	add_child(canvas)
	hud.position = Vector2(18,16)
	hud.add_theme_color_override("font_color", Color.WHITE)
	hud.add_theme_color_override("font_shadow_color",Color.BLACK)
	hud.add_theme_constant_override("shadow_outline_size",4)
	canvas.add_child(hud)
	hud.visible=options.has("--hud") or diagnostic>0
	_update_camera()
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
	environment_settings=settings
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
	Presentation.configure_environment(settings,presentation_mode,packet)
	environment.environment = settings
	add_child(environment)
	sun.rotation_degrees = Vector3(-48,-32,0)
	sun.light_color = Color(1.0,0.95,0.85)
	sun.light_energy = 0.0 if presentation_mode=="cartographic" else 1.5
	sun.visible=presentation_mode!="cartographic"
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 2000.0
	add_child(sun)

func _begin_prepare() -> void:
	if water_projection_busy:
		view_dirty=true
		return
	if worker != null:
		view_dirty = true
		return
	view_dirty = false
	generation += 1
	requested_focus = focus.duplicate()
	requested_width = width_m
	var display_samples=128 if _quality_preview() else 256
	var spacing := Data.display_spacing(world.terrain,width_m,display_samples)
	var expected_image_size=_expected_height_image_size(spacing,width_m*(2.0 if oblique else 1.0))
	var snap_step := spacing*64.0
	var snapped_x: float = float(world.terrain.originX)+round((float(focus.x)-float(world.terrain.originX))/snap_step)*snap_step
	var snapped_z: float = float(world.terrain.originZ)+round((float(focus.y)-float(world.terrain.originZ))/snap_step)*snap_step
	if options.has("--rebase-offset-m"): snapped_x+=round(float(options["--rebase-offset-m"])/spacing)*spacing
	var reference_height := Data.height_at(world,snapped_x,snapped_z)
	var next_origin: Dictionary = {"x":snapped_x,"y":reference_height,"z":snapped_z}
	prepared_context_key = known_context_id if not known_context_id.is_empty() else str(world.id)
	prepared_height_key = str(world.id)+"@"+str(spacing)
	var reuse_height: bool = terrain!=null and rendered_height_image_size==expected_image_size and rendered_revision==world_revision and absf(origin.x-snapped_x)<0.00001 and absf(origin.z-snapped_z)<0.00001 and absf(float(terrain.get("vertex_spacing"))-spacing)<0.00001
	var water_world := world.duplicate(false)
	var canonical := Data.context(world)
	water_world.id=prepared_context_key
	water_world.versions=canonical.get("versions",world.get("versions",{}))
	var water_key := Geometry.chunk_key(world,focus,width_m,"water")
	var urban_key := Geometry.chunk_key(world,focus,width_m,"urban")
	var scene_request := {"heightCoverageExtentM":width_m*(4.0 if oblique else 2.0),"canopyAtlasBounds":_canopy_atlas_request(),"displaySamples":display_samples,"waterKey":water_key,"urbanKey":urban_key,"buildWater":not options.has("--ground-only") and not scene_mesh_cache.has(water_key),"buildUrban":not options.has("--ground-only") and not scene_mesh_cache.has(urban_key),"focus":focus.duplicate()}
	worker = Thread.new()
	worker.start(ScenePrepare.prepare.bind({"heightImageSize":expected_image_size,"displaySamples":display_samples,"physicalLineage":_physical_lineage(world,packet),"contextKey":prepared_context_key,"heightKey":prepared_height_key,"liveSerial":int(packet.get("_acceptedLiveSerial",-1)),"worldRevision":world_revision,"world":world,"origin":next_origin,"width":width_m,"generation":generation,"packet":packet,"skipContext":context_textures.has(prepared_context_key),"displaySource":height_source_cache.get(prepared_height_key,{}),"skipHeight":reuse_height,"sceneRequest":scene_request,"focus":focus.duplicate(),"viewportWidth":get_viewport().get_visible_rect().size.x,"oblique":oblique,"groundOnly":options.has("--ground-only"),"presentationMode":presentation_mode,"projectRoads":RenderingServer.get_current_rendering_method()=="forward_plus"}))
	last_request_tick = Time.get_ticks_msec()

func _apply_prepared(prepared: Dictionary) -> void:
	var prepared_lineage=str(prepared.get("physicalLineage",_physical_lineage(prepared.world,prepared.packet)))
	if prepared_lineage!=_physical_lineage(world,packet):
		discarded_preparations.obsoletePhysicalLineage+=1
		return
	if int(prepared.get("worldRevision",world_revision))<rendered_revision:
		discarded_preparations.olderThanDisplayed+=1
		return
	if not _import_alignment_valid(prepared):
		discarded_preparations["invalidImportAlignment"]=int(discarded_preparations.get("invalidImportAlignment",0))+1
		push_error("Refusing unaligned Terrain3D import; previous rendered snapshot remains visible")
		return
	var world: Dictionary = prepared.world
	var packet: Dictionary = prepared.packet
	var context_key=str(prepared.get("contextKey",prepared_context_key))
	var height_key=str(prepared.get("heightKey",prepared_height_key))
	height_source_cache[height_key]=prepared.displaySource
	while height_source_cache.size()>3: height_source_cache.erase(height_source_cache.keys()[0])
	var begin := Time.get_ticks_usec()
	var next_terrain: Node3D = terrain
	var previous_native_spacing=float(terrain.get("vertex_spacing")) if terrain!=null else float(prepared.spacing)
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
	if not is_equal_approx(float(next_terrain.get("vertex_spacing")),float(prepared.spacing)):
		discarded_preparations["unsupportedNativeSpacing"]=int(discarded_preparations.get("unsupportedNativeSpacing",0))+1
		if recreate:next_terrain.queue_free()
		else:next_terrain.set("vertex_spacing",previous_native_spacing)
		push_error("Terrain3D vertex spacing differs from the prepared source scale")
		return
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
	if not context_textures.has(context_key):
		context_textures[context_key] = {"surface_ids":ImageTexture.create_from_image(prepared.ids),"surface_state":ImageTexture.create_from_image(prepared.state),"surface_bedrock":ImageTexture.create_from_image(prepared.rock),"surface_average":ImageTexture.create_from_image(prepared.average)}
		if prepared.get("surfaceLayers",{}).get("available",false):
			for binding in {"low_cover_ids":"lowIds","low_cover_average":"lowAverage","low_cover_state":"lowState"}:
				context_textures[context_key][binding]=ImageTexture.create_from_image(prepared.surfaceLayers[{"low_cover_ids":"lowIds","low_cover_average":"lowAverage","low_cover_state":"lowState"}[binding]])
		context_textures[context_key]["surface_layers_explicit"]=prepared.get("surfaceLayers",{}).get("available",false)
		while context_textures.size()>2: context_textures.erase(context_textures.keys()[0])
	for name in context_textures[context_key]: mat.call("set_shader_param",name,context_textures[context_key][name])
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
		rendered_height_image_size=prepared.height.get_width()
		rendered_height_range=prepared.get("loadedHeightRangeWorld",Vector2(NAN,NAN))-Vector2(float(next_origin.y),float(next_origin.y))
		var images: Array[Image] = [prepared.height,prepared.control,null]
		next_terrain.get("data").call("import_images",images,prepared.localStart,0.0,1.0)
	mat.set("show_checkered",false)
	terrain = next_terrain
	origin = next_origin
	applied_generation = int(prepared.generation)
	# A complete same-lineage preparation is useful while the newest tile loads.
	# Keep its actual revision so the next worker immediately targets the latest.
	rendered_display_samples=int(prepared.get("displaySamples",256))
	rendered_revision=int(prepared.get("worldRevision",world_revision))
	rendered_world=world
	rendered_packet=packet
	rendered_world_id=str(world.id)
	var source_focus=_source_actual_at_focus(world,prepared.displaySource,focus)
	rendered_source=source_focus.sourceActualAtFocus.duplicate()
	rendered_live_serial=int(prepared.get("liveSerial",packet.get("_acceptedLiveSerial",-1)))
	rendered_presentation_mode=str(prepared.get("presentationMode",presentation_mode))
	Presentation.configure_environment(environment_settings,rendered_presentation_mode,packet)
	sun.visible=rendered_presentation_mode!="cartographic"
	sun.light_energy=0.0 if rendered_presentation_mode=="cartographic" else 1.5
	var next_canopy:Dictionary=prepared.populations.get("canopy",{}).duplicate(false)
	next_canopy["physicalLineage"]=prepared.get("physicalLineage","")
	_update_canopy_textures(next_canopy)
	_build_scene_objects(prepared)
	_apply_canopy_parameters(mat)
	_apply_geometry_detail(mat,prepared.get("geometryDetail",{}),next_origin)
	unsupported_tree_count=int(prepared.get("unsupportedTreeCount",0))
	Presentation.configure_terrain(mat,packet,rendered_presentation_mode)
	set_layer_visibility(layer_visibility.ground,layer_visibility.lowCover,layer_visibility.trees)
	rendered_surface_layers=prepared.get("surfaceLayersMetadata",{}).duplicate(true)
	rendered_surface_layers.merge({"worldId":rendered_world_id,"visibility":layer_visibility.duplicate(),"renderMode":"three-physical-layers" if context_textures[context_key].get("surface_layers_explicit",false) else "legacy-composite-unavailable"})
	_update_camera()
	prepare_times.append(float(prepared.prepareMs))
	upload_times.append((Time.get_ticks_usec()-begin)/1000.0)
	warm_frames = 0
	region_counts.append(int(terrain.get("data").call("get_region_count")))
	preparation_snapshots.append({"focus":requested_focus.duplicate(),"widthM":requested_width,"generation":prepared.generation,"sourceId":world.terrain.source.id})
	rendered_tick_ms=Time.get_ticks_msec()
	rendered_snapshot={"worldId":rendered_world_id,"source":rendered_source.duplicate(),"tileSource":world.terrain.source.duplicate(),"sourceActualAtFocus":rendered_source.duplicate(),"focusInsideSource":source_focus.focusInsideSource,"fineContributionWeight":source_focus.fineContributionWeight,"seamWeight":source_focus.seamWeight,"sourceContributionsAtFocus":source_focus.contributions,"sourceBounds":world.bounds.duplicate(),"focusAtApply":focus.duplicate(),"request":packet.get("source",{}).get("request",{}).duplicate(true),"deliveredGrid":{"width":int(world.terrain.width),"height":int(world.terrain.height),"spacingM":float(world.terrain.spacingM)},"displaySamples":rendered_display_samples,"heightImageSize":rendered_height_image_size,"loadedHeightRangeWorld":[float(rendered_height_range.x)+float(origin.y),float(rendered_height_range.y)+float(origin.y)],"liveSerial":rendered_live_serial,"appliedTickMs":rendered_tick_ms,"sourceEpoch":packet.get("source",{}).get("sourceEpoch"),"sceneEpoch":packet.get("source",{}).get("sceneEpoch"),"worldRevision":rendered_revision}
	_update_view_satisfaction("rendered-source")
	render_events.append(rendered_snapshot.duplicate(true))
	while render_events.size()>128:render_events.pop_front()
	print(JSON.stringify({"event":"terrain-replaced","worldId":rendered_world_id,"renderedSnapshot":rendered_snapshot,"requestedWorldId":self.world.id,"origin":[origin.x,origin.y,origin.z],"sourceLOD":world.terrain.source.sourceLOD,"nativeSpacingM":world.terrain.source.nativeSpacingM,"displaySpacingM":prepared.spacing,"regions":terrain.get("data").call("get_region_count"),"prepareMs":prepared.prepareMs,"uploadAndObjectsMs":upload_times.back()}))

func _update_camera() -> void:
	var world:Dictionary=rendered_world if not rendered_world.is_empty() else self.world
	var target := Vector3(focus.x-origin.x,Data.height_at(world,focus.x,focus.y)-origin.y,focus.y-origin.z)
	# Orthographic top view gives an exact physical frame width and mm/px diagnostic.
	if not oblique:
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
		camera.size = width_m/get_viewport().get_visible_rect().size.aspect()
		var highest: float = maxf(float(world.get("_heightRange",Vector2(0,0)).y)-origin.y,scene_top_y)
		# Keep the highest loaded source roof below both camera AND its near plane.
		# Orthographic framing stays unchanged when camera elevation increases.
		var required_distance=(highest-target.y+maxf(1.0,width_m*0.02))/0.99
		camera.position = target+Vector3(0,maxf(maxf(width_m,20.0),required_distance),0.0001)
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
	var main_projection=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse())
	var main_size=get_viewport().get_visible_rect().size
	if terrain!=null:_set_canopy_main_camera(terrain.get("material"),main_projection,main_size)
	for material in canopy_materials:
		material.set_shader_parameter("canopy_reference_y",reference_y)
		_set_canopy_main_camera(material,main_projection,main_size)
	_update_canopy_phase(0.0)

func _build_scene_objects(prepared: Dictionary) -> void:
	var world:Dictionary=prepared.world
	var packet:Dictionary=prepared.packet
	var presentation_mode:String=rendered_presentation_mode
	scene_top_y=-INF
	canopy_materials.clear()
	for child in objects.get_children():
		if not canopy_pending.is_empty() and child.get_meta("surfaceLayer","")=="trees" and not child.get_meta("canopyStaged",false):
			var previous_origin:Dictionary=child.get_meta("canopyRenderOrigin",origin)
			child.position+=Vector3(float(previous_origin.x)-float(origin.x),float(previous_origin.y)-float(origin.y),float(previous_origin.z)-float(origin.z))
			child.set_meta("canopyRenderOrigin",origin.duplicate())
			child.set_meta("canopyRetired",true)
			var retained_material:ShaderMaterial=child.multimesh.mesh.surface_get_material(0)
			retained_material.set_meta("canopyRetired",true)
			canopy_materials.append(retained_material)
			continue
		child.visible=false
		child.queue_free()
	if options.has("--ground-only"): return
	var request: Dictionary = prepared.sceneRequest
	if prepared.has("waterGeometry"):
		var data: Dictionary = prepared.waterGeometry
		var entry := {"mesh":_mesh_from_arrays(prepared.waterArrays),"anchor":data.anchor,"quads":data.quads,"sourceStride":data.sourceStride,"buildMs":data.buildMs}
		entry.diagnostics={}
		entry.geometry=data
		for key in data:
			var value=data[key]
			if value is String or value is bool or value is int or value is float and is_finite(value): entry.diagnostics[key]=value
		if data.get("sourceVectorClipBounds") is Dictionary:entry.diagnostics["sourceVectorClipBounds"]=data.sourceVectorClipBounds.duplicate()
		for key in ["coverageOrigin","coverageSpacingM","coverageSize","bedOrigin","bedSpacingM","bedSize","bedBounds","bedReconstruction","classOrigin","classSpacingM","classSize"]:
			if data.has(key): entry[key]=data[key]
		if data.has("coverageImage"): entry.coverageTexture=ImageTexture.create_from_image(data.coverageImage)
		if data.has("bedImage"): entry.bedTexture=ImageTexture.create_from_image(data.bedImage)
		if data.has("classImage"): entry.classTexture=ImageTexture.create_from_image(data.classImage)
		scene_mesh_cache[request.waterKey]=entry
	if prepared.has("urbanGeometry"):
		var data: Dictionary = prepared.urbanGeometry
		scene_mesh_cache[request.urbanKey]={"batches":_urban_batch_meshes(prepared.urbanBatches),"roads":_mesh_from_arrays(prepared.roadArrays),"anchor":data.anchor,"nativeBuildings":data.nativeBuildings,"proxyBuildings":data.proxyBuildings,"budgetLimited":data.budgetLimited,"buildMs":data.buildMs}
	while scene_mesh_cache.size()>8: scene_mesh_cache.erase(scene_mesh_cache.keys()[0])
	rendered_urban_metrics={"worldId":rendered_world_id,"nativeBuildings":0,"proxyBuildings":0,"materialBatches":0,"buildingIds":[],"scope":"prepared submitted mesh batches; not a GPU visibility or occlusion count"}
	if scene_mesh_cache.has(request.urbanKey):
		var urban_entry:Dictionary=scene_mesh_cache[request.urbanKey]
		var native_ids:Dictionary={}
		for batch in urban_entry.batches:
			for id in batch.get("buildingIds",[]):native_ids[str(id)]=true
		var ids=native_ids.keys();ids.sort()
		rendered_urban_metrics.merge({"nativeBuildings":urban_entry.nativeBuildings,"proxyBuildings":urban_entry.proxyBuildings,"materialBatches":urban_entry.batches.size(),"buildingIds":ids,"budgetLimited":urban_entry.budgetLimited},true)
	if scene_mesh_cache.has(request.waterKey):
		var entry: Dictionary = scene_mesh_cache[request.waterKey]
		water_metrics=entry.get("diagnostics",{}).duplicate()
		water_metrics.merge({"worldId":rendered_world_id,"waterPresentation":"source-levels","sourceLevelsUnchanged":true,"physicalWaterSurfaceClaimed":true},true)
		if prepared.has("waterProjection"):
			var projection:Dictionary=prepared.waterProjection
			water_metrics.merge(projection.get("diagnostics",{}),true)
			var decal=WaterProjection.create_decal(projection,origin)
			if decal!=null:objects.add_child(decal)
		elif entry.mesh.get_surface_count()>0:
			var water := MeshInstance3D.new()
			water.name="ExplicitWater"
			water.layers=2
			water.mesh=entry.mesh
			water.position=Vector3(entry.anchor.x-origin.x,entry.anchor.y-origin.y,entry.anchor.z-origin.z)
			var material := Presentation.water_material(packet,presentation_mode)
			material.set_shader_parameter("class_enabled",entry.has("classTexture"))
			if entry.has("classTexture"):
				material.set_shader_parameter("class_map",entry.classTexture)
				material.set_shader_parameter("class_origin_local",Vector2(float(entry.classOrigin.x)-float(origin.x),float(entry.classOrigin.z)-float(origin.z)))
				material.set_shader_parameter("class_spacing",entry.classSpacingM)
				material.set_shader_parameter("class_grid_size",Vector2(entry.classSize))
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
			city.material_override=Presentation.building_material(batch.materialId,batch.slots,batch.surface,packet,presentation_mode)
			objects.add_child(city)
		if RenderingServer.get_current_rendering_method()!="forward_plus" and entry.roads.get_surface_count()>0:
			var roads := MeshInstance3D.new()
			roads.name="DrapedRoadBatch"
			roads.layers=2
			roads.mesh=entry.roads
			roads.position=position
			roads.material_override=Presentation.road_material(packet,presentation_mode)
			objects.add_child(roads)
	city_map_metrics={}
	if presentation_mode=="cartographic" and prepared.has("cityMap"):
		var overlay:Dictionary=prepared.cityMap
		for item in [["SourceRoofFootprintFill",prepared.cityMapArrays,false],["SourceRoofFootprintOutline",prepared.cityMapOutlineArrays,true]]:
			var mesh=_mesh_from_arrays(item[1])
			if mesh.get_surface_count()==0:continue
			var node=MeshInstance3D.new();node.name=item[0];node.mesh=mesh;node.layers=2
			node.material_override=Presentation.city_map_material(packet,item[2])
			node.set_meta("representation",overlay.representation);node.set_meta("buildingIds",overlay.buildingIds)
			objects.add_child(node)
		city_map_metrics={"representation":overlay.representation,"buildingIds":overlay.buildingIds,"sourceRoofAreaM2":overlay.sourceRoofAreaM2,"budgetLimited":overlay.budgetLimited,"omittedBuildingIds":overlay.omittedBuildingIds,"missingRoofFootprintIds":overlay.missingRoofFootprintIds}
	_build_road_projectors(prepared.get("roadProjectors",[]))
	_build_populations(prepared.populations)
	if diagnostic==5:
		var normals := ShaderMaterial.new()
		normals.shader=load("res://shaders/normals.gdshader")
		for child in objects.get_children():
			if child is GeometryInstance3D: child.material_override=normals
	_cache_scene_top_y()
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
	var packet:Dictionary=rendered_packet if not rendered_packet.is_empty() else self.packet
	var presentation_mode:String=rendered_presentation_mode
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
		fade_material.set_shader_parameter("linear_tint",Presentation.canopy_color(packet,presentation_mode) if family=="tree" else Vector3.ONE)
		fade_material.set_shader_parameter("presentation_mode",1 if presentation_mode=="cartographic" else 0)
		if family=="tree":
			fade_material.set_meta("canopyStaged",not canopy_pending.is_empty())
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
		instance.set_meta("populationFamily",family)
		instance.set_meta("surfaceLayer","trees" if family=="tree" else "ground" if family=="boulder" else "lowCover")
		instance.layers=2
		if family=="tree":
			instance.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			instance.set_meta("canopyStaged",not canopy_pending.is_empty())
			instance.set_meta("canopyRenderOrigin",origin.duplicate())
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
			trunk_mat.set_meta("canopyStaged",not canopy_pending.is_empty())
			canopy_materials.append(trunk_mat)
			_apply_canopy_parameters(trunk_mat)
			trunk_mat.set_shader_parameter("linear_tint",Presentation.canopy_trunk_color(packet,presentation_mode))
			trunk_mat.set_shader_parameter("presentation_mode",1 if presentation_mode=="cartographic" else 0)
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
			trunk_instance.set_meta("populationFamily","trunk")
			trunk_instance.set_meta("surfaceLayer","trees")
			trunk_instance.layers=2
			trunk_instance.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			trunk_instance.set_meta("canopyStaged",not canopy_pending.is_empty())
			trunk_instance.set_meta("canopyRenderOrigin",origin.duplicate())
			trunk_instance.multimesh = trunks
			objects.add_child(trunk_instance)

func _process(delta: float) -> void:
	if world.is_empty(): return
	_update_canopy_phase(delta)
	_update_quality_state()
	var tick := Time.get_ticks_usec()
	var wall_ms := (tick-previous_frame_tick)/1000.0 if previous_frame_tick>0 else delta*1000.0
	previous_frame_tick = tick
	if terrain!=null: all_frame_times.append(wall_ms)
	frames += 1
	if packet_worker!=null and not packet_worker.is_alive():
		var received = packet_worker.wait_to_finish()
		packet_worker = null
		if packet_context.get("kind")=="live":
			print(JSON.stringify({"event":"live-packet-decoded","requestSerial":packet_context.get("serial",-1),"decodeElapsedMs":Time.get_ticks_msec()-int(packet_context.get("decodeStartedTickMs",Time.get_ticks_msec())),"validPacket":received is Dictionary and not received.is_empty(),"tickMs":Time.get_ticks_msec()}))
		if received is Dictionary: _accept_packet(received,packet_context)
	if worker != null and not worker.is_alive():
		var prepared = worker.wait_to_finish()
		worker = null
		if prepared is Dictionary:
			_complete_prepared(prepared)
		else:
			discarded_preparations.failed+=1
			push_warning("Terrain preparation failed; retaining parent. Navigate or reload to retry.")
			applied_generation=generation
	if worker==null and not water_projection_busy and (view_dirty or rendered_revision!=world_revision) and Time.get_ticks_msec()-last_request_tick>160:
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
		if (live_serial>live_requested_serial or final_quality_pending) and not live_busy and Time.get_ticks_msec()-last_live_tick>400:
			_request_live()
		if not stream_directory.is_empty() and live_serial>stream_requested_serial and Time.get_ticks_msec()-last_stream_tick>400:
			_request_source()
	var scene_ready:bool=rendered_revision==world_revision and not water_projection_busy and not canopy_transition_busy
	var live_ready: bool = not options.has("--live-url") or (view_satisfied_serial==live_serial and not _quality_preview()) or failed_live_serial==live_serial
	if options.has("--tour") and scene_ready and terrain != null and worker == null and not view_dirty and packet_worker==null and not live_busy and live_ready:
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
	if options.has("--frames") and scene_ready and terrain != null and worker==null and packet_worker==null and not live_busy and not view_dirty and live_ready and warm_frames>=int(options["--frames"]):
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
	var world:Dictionary=rendered_world if not rendered_world.is_empty() else self.world
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
				diagnostic = (diagnostic+1)%20
				if terrain!=null: terrain.get("material").call("set_shader_param","diagnostic",diagnostic)
				if previous==5 or diagnostic==5: _begin_prepare()
			KEY_S: _capture("res://captures/surface-%d.png"%Time.get_unix_time_from_system())
			KEY_F: print(JSON.stringify({"event":"inspect","x":focus.x,"z":focus.y,"heightM":Data.height_at(world,focus.x,focus.y),"material":Data.field_at(world,"material",focus.x,focus.y,true),"bedrock":Data.field_at(world,"bedrock",focus.x,focus.y,true),"sand":Data.field_at(world,"sand",focus.x,focus.y),"silt":Data.field_at(world,"silt",focus.x,focus.y),"clay":Data.field_at(world,"clay",focus.x,focus.y),"waterClass":Data.field_at(world,"waterClass",focus.x,focus.y,true),"source":world.terrain.source}))
			KEY_ESCAPE: _write_metrics(); get_tree().quit()
		if event.keycode>=KEY_1 and event.keycode<=KEY_7:
			width_m = tour_widths[event.keycode-KEY_1]
			changed = true
	if changed:
		last_real_input_tick=Time.get_ticks_msec()
		quality_preview_active=true
		final_quality_pending=options.has("--live-url")
		view_satisfied_serial=-1
		_update_camera()
		view_dirty = true
		if worker==null and Time.get_ticks_msec()-last_request_tick>160:
			_begin_prepare()
		live_serial += 1

func _request_live() -> void:
	if not options.has("--live-url") or live_busy or packet_worker!=null: return
	if loaded_live_binding.has("error"):
		failed_live_serial=live_serial
		live_requested_serial=live_serial
		_record_live_binding_rejection(str(loaded_live_binding.error),live_serial)
		return
	var region=ViewQuality.request_region(world,packet,focus,width_m,_quality_preview())
	if _update_view_satisfaction("reuse-cached-source",region):
		live_requested_serial=live_serial
		if not bool(region.preview):final_quality_pending=false
		return
	var payload={"region":region}
	if not known_context_id.is_empty() and canonical_contexts.has(known_context_id): payload.region.knownContextId = known_context_id
	if not known_scene_context_id.is_empty() and scene_contexts.has(known_scene_context_id): payload.region.knownSceneContextId=known_scene_context_id
	if options.has("--session-id"): payload.sessionId = options["--session-id"]
	live_requested_serial = live_serial
	if not bool(region.preview):final_quality_pending=false
	live_request_context={"kind":"live","serial":live_requested_serial,"lineage":_source_scene_lineage(),"baseWorldId":world.id,"startedTickMs":Time.get_ticks_msec()}
	live_busy = true
	last_live_tick = Time.get_ticks_msec()
	var error := live_request.request(options["--live-url"],PackedStringArray(["Content-Type: application/json","Accept: application/octet-stream, application/json"]),HTTPClient.METHOD_POST,JSON.stringify(payload))
	if error!=OK:
		live_busy = false
		failed_live_serial=live_requested_serial
		push_warning("Live terrain request failed to start: "+str(error))

func _live_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	var http_event={"event":"live-http-completed","requestSerial":int(live_request_context.get("serial",live_requested_serial)),"resultCode":result,"httpCode":code,"bodyBytes":body.size(),"downloadedBytes":live_request.get_downloaded_bytes(),"expectedBodyBytes":live_request.get_body_size(),"requestElapsedMs":Time.get_ticks_msec()-int(live_request_context.get("startedTickMs",Time.get_ticks_msec())),"tickMs":Time.get_ticks_msec(),"useThreads":live_request.use_threads,"downloadChunkBytes":live_request.download_chunk_size,"timeoutSeconds":live_request.timeout}
	live_http_events.append(http_event)
	while live_http_events.size()>128:live_http_events.pop_front()
	print(JSON.stringify(http_event))
	live_busy = false
	# Camera movement does not invalidate an immutable source request.
	if live_request_context.get("lineage","")!=_source_scene_lineage():
		live_requested_serial=mini(live_requested_serial,live_serial-1)
		print("Discarded live response from an obsolete source/scene epoch")
		return
	if result!=HTTPRequest.RESULT_SUCCESS or code<200 or code>=300:
		failed_live_serial=live_requested_serial
		push_warning("Live terrain unavailable, retaining parent: HTTP "+str(code)+" "+body.get_string_from_utf8().left(240))
		return
	if packet_worker!=null:
		# A newer navigation will issue another request; the parent remains visible.
		live_requested_serial = live_serial-1
		return
	# A malformed decoded packet is an explicit failed request, not an endless tour wait.
	failed_live_serial=live_requested_serial
	packet_context = live_request_context.duplicate(true)
	packet_context["decodeStartedTickMs"]=Time.get_ticks_msec()
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
	if context.kind=="live":
		if int(context.serial)<last_live_applied_serial or context.get("lineage","")!=_source_scene_lineage():
			live_requested_serial=mini(live_requested_serial,live_serial-1)
			return
	if context.kind=="file" and context.requestId!=last_stream_request: return
	if next.has("requestId") and str(next.requestId)!=last_stream_request:
		last_stream_request=""
		return
	if next.has("baseWorldId") and next.baseWorldId!=context.get("baseWorldId",world.id) and next.baseWorldId!=known_context_id: return
	if context.kind=="live":
		var reason=LiveBinding.rejection(loaded_live_binding,next,last_live_applied_serial<0)
		if not reason.is_empty():
			failed_live_serial=int(context.serial)
			_record_live_binding_rejection(reason,int(context.serial))
			return
	next=Presentation.overrides(next,str(options.get("--style","")),str(options.get("--style-catalogue","")))
	if not _resolve_scene(next): return
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
	if context.kind=="live":
		last_live_applied_serial=int(context.serial)
		failed_live_serial=-1
		next["_acceptedLiveSerial"]=int(context.serial)
		live_acceptance_events.append({"tickMs":Time.get_ticks_msec(),"requestSerial":context.serial,"cameraSerial":live_serial,"sourceEpoch":next.get("source",{}).get("sourceEpoch"),"sceneEpoch":next.get("source",{}).get("sceneEpoch"),"request":next.get("source",{}).get("request",{}).duplicate(true),"worldId":next_world.id})
		while live_acceptance_events.size()>128:live_acceptance_events.pop_front()
		print(JSON.stringify({"event":"live-tile-applied","requestSerial":context.serial,"cameraSerial":live_serial,"worldId":next_world.id}))
	var repeated_identity: bool = next_world.id==world.id
	world_revision+=1
	world = next_world
	packet = next
	presentation_mode=Presentation.profile(packet,str(options.get("--presentation","cartographic" if options.has("--style") else ""))).mode
	# Live content identities are immutable. Clearing them while an older worker
	# relies on skipContext would destroy an otherwise complete valid snapshot.
	if repeated_identity and context.kind!="live":
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
		for key in ["environment","occupation","population","materialLibrary","surfaceState","hydrology","geology","surfaceLayers"]:
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
	print(JSON.stringify({"event":"capture","captureTickMs":Time.get_ticks_msec(),"populationInstances":population_instances(),"canopyView":canopy_view_state,"surfaceLayers":rendered_surface_layers,"water":water_metrics,"urban":rendered_urban_metrics,"renderedWorldId":rendered_world_id,"renderedSource":rendered_source,"renderedLiveSerial":rendered_live_serial,"renderedSnapshot":rendered_snapshot,"viewSatisfiedSerial":view_satisfied_serial,"viewSatisfaction":view_satisfaction,"path":absolute,"error":result,"widthM":width_m,"metresPerPixel":width_m/get_viewport().get_visible_rect().size.x}))

func _quantile(values: Array[float], fraction: float) -> Variant:
	if values.is_empty(): return null
	var sorted := values.duplicate()
	sorted.sort()
	return sorted[mini(int(fraction*(sorted.size()-1)),sorted.size()-1)]

func _write_metrics() -> void:
	var metrics := {"godot":Engine.get_version_info().string,"terrain3d":"1.0.2","backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"worldId":rendered_world_id,"source":rendered_source,"requestedWorldId":world.id,"requestedSource":world.terrain.source,"resolution":[get_viewport().get_visible_rect().size.x,get_viewport().get_visible_rect().size.y],"frames":frame_times.size(),"frameWallMs":{"p50":_quantile(frame_times,0.5),"p95":_quantile(frame_times,0.95),"p99":_quantile(frame_times,0.99)},"navigationFrameWallMs":{"p50":_quantile(all_frame_times,0.5),"p95":_quantile(all_frame_times,0.95),"p99":_quantile(all_frame_times,0.99),"max":_quantile(all_frame_times,1.0)},"cpuScriptMs":{"p50":_quantile(process_times,0.5),"p95":_quantile(process_times,0.95),"p99":_quantile(process_times,0.99)},"prepareMs":prepare_times,"uploadAndObjectsMs":upload_times,"regionCounts":region_counts,"preparationSnapshots":preparation_snapshots,"videoMemoryBytes":Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),"textureMemoryBytes":Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED),"drawCalls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"objects":selected_candidates,"roadProjectors":road_projector_count,"candidateCount":candidate_count,"cpuFrameMs":null,"cpuTimeNote":"cpuScriptMs measures this viewer script only; full engine CPU frame/pass timing is not available here.","gpuRenderMs":{"p50":_quantile(gpu_render_times,0.5),"p95":_quantile(gpu_render_times,0.95),"p99":_quantile(gpu_render_times,0.99)},"cpuRenderMs":{"p50":_quantile(cpu_render_times,0.5),"p95":_quantile(cpu_render_times,0.95)},"gpuTimeNote":"RenderingServer measured viewport render time; null when the backend returns no positive samples. Frame wall time separately includes vsync, uploads and driver stalls."}
	metrics["renderSourceVersion"]={"assetVersion":library.asset_version,"assetDigest":library.asset_digest,"assetBindings":library.loaded_asset_bindings,"presentation":Presentation.profile(rendered_packet,rendered_presentation_mode),"geometryDetail":rendered_geometry_detail}
	metrics["liveHttpEvents"]=live_http_events
	metrics["viewSatisfiedSerial"]=view_satisfied_serial
	metrics["viewSatisfaction"]=view_satisfaction
	metrics["viewSatisfactionEvents"]=view_satisfaction_events
	metrics["loadedLiveBinding"]=loaded_live_binding
	metrics["liveBindingRejections"]=live_binding_rejections
	metrics["renderedSnapshot"]=rendered_snapshot
	metrics["renderEvents"]=render_events
	metrics["discardedPreparations"]=discarded_preparations
	metrics["liveAcceptance"]=live_acceptance_events
	metrics["unsupportedTreeCount"]=unsupported_tree_count
	metrics["cityMap"]=city_map_metrics
	metrics["water"]=water_metrics
	metrics["urban"]=rendered_urban_metrics
	metrics["surfaceLayers"]=rendered_surface_layers
	metrics["populationInstances"]=population_instances()
	metrics["canopyView"]=canopy_view_state
	metrics["canopy"]={"representation":"whole-view exact inventory when complete page, atlas and resident terrain cover the frustum plus halo; otherwise whole-view calibrated meso","approximatePositionsClaimedAsInventory":false,"paintedCrownShadow":"total-C optical transfer for the entire canopy; native canopy/trunk casting disabled; buildings and terrain retain physical shadows","physicalForestShadowClaimed":false,"opticalDetailPixels":[1.25,3.0],"geometryDetailPixels":[3.0,8.0],"referenceCrownDiameterM":preload("res://adapters/surface_canopy.gd").REFERENCE_CROWN_DIAMETER_M,"referenceCrownCentreHeightM":preload("res://adapters/surface_canopy.gd").REFERENCE_CROWN_CENTRE_HEIGHT_M,"mesoCellM":preload("res://adapters/surface_canopy.gd").MESO_CELL_M,"paintedShadowTransmittance":[.25,.34,.50],"canonicalSeed":rendered_world.get("seed"),"atlasVersion":canopy_info.get("version",""),"paintBlendM":canopy_info.get("fallbackBlendM"),"geometryBlendM":canopy_info.get("geometryBlendM")}
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
	if is_same(canopy_info,info):return
	if canopy_info.is_empty() or canopy_phase<=0.00001 or info.get("physicalLineage")!=canopy_info.get("physicalLineage"):
		_install_canopy_textures(info)
		return
	# The old atlas remains bound while its WHOLE-VIEW optical response fades.
	# New geometry is hidden until its matching atlas is installed at phase zero.
	canopy_pending=info
	canopy_pending_elapsed=0.0
	canopy_pending_start_phase=canopy_phase

func _install_canopy_textures(info:Dictionary)->void:
	canopy_info=info
	canopy_phase=0.0
	canopy_pending={}
	_retire_canopy_nodes()
	for child in objects.get_children():
		if child.get_meta("canopyStaged",false):child.set_meta("canopyStaged",false)
	if not info.get("available",false):
		canopy_textures={}
		_refresh_canopy_bindings()
		return
	if not is_same(canopy_textures.get("coverageImage"),info.coverageImage) or not is_same(canopy_textures.get("countsImage"),info.countsImage):
		canopy_textures={"coverageImage":info.coverageImage,"countsImage":info.countsImage,"coverage":ImageTexture.create_from_image(info.coverageImage),"counts":ImageTexture.create_from_image(info.countsImage)}
		if info.has("normalImage"):canopy_textures["normals"]=ImageTexture.create_from_image(info.normalImage)
	_refresh_canopy_bindings()

func _canopy_material_geometry_weight(material:Object)->float:
	if not canopy_pending.is_empty() and material is ShaderMaterial and not material.get_meta("canopyRetired",false):return 0.0
	return maxf(0.0,canopy_phase-1.0)

func _retire_canopy_nodes()->void:
	for child in objects.get_children():
		if child.get_meta("canopyRetired",false):child.visible=false;child.queue_free()
	for i in range(canopy_materials.size()-1,-1,-1):
		if canopy_materials[i].get_meta("canopyRetired",false):canopy_materials.remove_at(i)

func _refresh_canopy_bindings()->void:
	if terrain!=null:_apply_canopy_parameters(terrain.get("material"))
	for material in canopy_materials:_apply_canopy_parameters(material)

func _apply_canopy_parameters(material: Object) -> void:
	var world:Dictionary=rendered_world if not rendered_world.is_empty() else self.world
	var packet:Dictionary=rendered_packet if not rendered_packet.is_empty() else self.packet
	var presentation_mode:String=rendered_presentation_mode
	var values := {"canopy_exact_weight":minf(canopy_phase,1.0),"canopy_geometry_weight":_canopy_material_geometry_weight(material),"canopy_shadow_use_total":true,"canopy_enabled":canopy_info.get("available",false),"canopy_linear_albedo":Presentation.canopy_color(packet,presentation_mode),"canopy_reference_y":Data.height_at(world,focus.x,focus.y)-float(origin.y)}
	values.merge(preload("res://adapters/surface_canopy.gd").meso_parameters(world,origin))
	var to_light=sun.global_basis.z
	values["canopy_shadow_offset"]=preload("res://adapters/surface_canopy.gd").shadow_offset(to_light,preload("res://adapters/surface_canopy.gd").REFERENCE_CROWN_CENTRE_HEIGHT_M)
	if canopy_info.get("available",false):
		var b: Dictionary = canopy_info.bounds
		values["canopy_normals_enabled"]=canopy_textures.has("normals")
		if canopy_textures.has("normals"):values["canopy_normals"]=canopy_textures.normals
		values.merge({"canopy_coverage":canopy_textures.coverage,"canopy_counts":canopy_textures.counts,
			"canopy_origin":Vector2(float(canopy_info.origin.x)-float(origin.x),float(canopy_info.origin.z)-float(origin.z)),
			"canopy_grid_size":canopy_info.gridSize,"canopy_spacing_m":canopy_info.spacingM,"canopy_fallback_blend_m":canopy_info.fallbackBlendM,
			"canopy_bounds":Vector4(float(b.minX)-float(origin.x),float(b.minZ)-float(origin.z),float(b.maxX)-float(origin.x),float(b.maxZ)-float(origin.z))})
	for key in values:
		if material is ShaderMaterial: material.set_shader_parameter(key,values[key])
		else: material.call("set_shader_param",key,values[key])

func _canopy_guard(info:Dictionary)->Dictionary:
	if not info.get("available",false):return {"safePhase":0.0,"reason":info.get("reason","No prepared complete tree atlas")}
	var w:Dictionary=rendered_world if not rendered_world.is_empty() else world
	var reference_y=Data.height_at(w,focus.x,focus.y)-float(origin.y)
	var shadow=preload("res://adapters/surface_canopy.gd").shadow_offset(sun.global_basis.z,preload("res://adapters/surface_canopy.gd").REFERENCE_CROWN_CENTRE_HEIGHT_M)
	var halo=maxf(3.0*float(packet.get("_maximumCrownRadiusM",7.56)),shadow.length()+2.0*float(info.spacingM)+7.56)
	var safe_bounds=CanopyView.intersection(info.pageBounds,info.bounds)
	var resident={}
	if terrain!=null and rendered_height_image_size>0:
		var spacing=float(terrain.get("vertex_spacing"));var extent=float(rendered_height_image_size)*spacing*.5
		resident={"minX":float(origin.x)-extent+2*spacing,"minZ":float(origin.z)-extent+2*spacing,"maxX":float(origin.x)+extent-3*spacing,"maxZ":float(origin.z)+extent-3*spacing}
		safe_bounds=CanopyView.intersection(safe_bounds,resident)
	var guard=CanopyView.evaluate(camera,get_viewport().get_visible_rect().size,reference_y,origin,safe_bounds,halo,20.0,rendered_height_range if oblique else Vector2(NAN,NAN))
	guard["residentTerrainBounds"]=resident
	if float(guard.get("maximumPixelFootprintM",INF))/float(info.spacingM)>8.0:
		guard.safePhase=minf(float(guard.safePhase),1.0)
		guard["geometryFilterBudgetLimited"]=true
	return guard

func _canopy_atlas_request()->Dictionary:
	var page=preload("res://adapters/surface_canopy.gd").tree_page(packet)
	if page.is_empty():return {"disabled":true}
	var reference_y=Data.height_at(world,focus.x,focus.y)-float(origin.y)
	var guard=CanopyView.evaluate(camera,get_viewport().get_visible_rect().size,reference_y,origin,page.bounds,40.0,20.0,rendered_height_range if oblique else Vector2(NAN,NAN))
	if float(guard.safePhase)<=0.0:return {"disabled":true}
	return CanopyView.intersection(page.bounds,CanopyView.expanded(guard.frustumBounds,128.0))

func _update_canopy_phase(delta:float)->void:
	if camera==null:return
	var guard=_canopy_guard(canopy_info)
	var cap=float(guard.safePhase)
	if not canopy_pending.is_empty():
		canopy_pending_elapsed+=delta
		canopy_phase=minf(cap,canopy_pending_start_phase*(1.0-smoothstep(0.0,0.70,canopy_pending_elapsed)))
		if canopy_phase<=1.0:_retire_canopy_nodes()
		if canopy_phase<=0.00001:
			var next=canopy_pending
			_install_canopy_textures(next)
			guard=_canopy_guard(canopy_info);cap=float(guard.safePhase)
	else:
		# A safety cap can only fall immediately. Rise is smooth and time based.
		canopy_phase=minf(canopy_phase,cap)
		canopy_phase=lerpf(canopy_phase,cap,1.0-exp(-delta/0.20))
		if absf(cap-canopy_phase)<0.001:canopy_phase=cap
	canopy_transition_busy=not canopy_pending.is_empty() or absf(cap-canopy_phase)>0.001
	canopy_view_state=guard.duplicate(true)
	canopy_view_state.merge({"phase":canopy_phase,"exactWeight":minf(canopy_phase,1.0),"geometryWeight":maxf(0.0,canopy_phase-1.0),"activeAtlasWorldId":canopy_info.get("worldId",""),"activeAtlasHash":canopy_info.get("atlasHash",""),"activeAtlasSource":canopy_info.get("sourceDescriptor",{}),"transitionPending":not canopy_pending.is_empty(),"pendingAtlasHash":canopy_pending.get("atlasHash",""),"pendingAtlas":not canopy_pending.is_empty(),"treePage":canopy_info.get("page",{}),"atlasBounds":canopy_info.get("bounds",{}),"spatialBlend":"none; one phase for the whole viewport"},true)
	var bindings={"canopy_exact_weight":canopy_view_state.exactWeight,"canopy_geometry_weight":canopy_view_state.geometryWeight}
	if terrain!=null:
		for key in bindings:terrain.get("material").call("set_shader_param",key,bindings[key])
	for material in canopy_materials:
		for key in bindings:material.set_shader_parameter(key,_canopy_material_geometry_weight(material) if key=="canopy_geometry_weight" else bindings[key])

# Counts come from the actually submitted MultiMesh buffers and shader state.
# They deliberately do not claim occlusion visibility or a GPU fragment count.
func population_instances()->Dictionary:
	var families={}
	for family in ["tree","trunk","grass","shrub","debris","boulder"]:families[family]={"submitted":0,"nodeVisible":0,"alphaPositiveInFrustum":0}
	var viewport_size=get_viewport().get_visible_rect().size
	var projection=camera.get_camera_projection();var view=camera.get_camera_transform().affine_inverse()
	var reference_y=Data.height_at(rendered_world if not rendered_world.is_empty() else world,focus.x,focus.y)-float(origin.y)
	var vp=projection*Projection(view)
	for child in objects.get_children():
		if not child is MultiMeshInstance3D or child.is_queued_for_deletion() or not child.has_meta("populationFamily"):continue
		var family=str(child.get_meta("populationFamily"));var multi=child.multimesh
		var count=multi.instance_count if multi.visible_instance_count<0 else mini(multi.instance_count,multi.visible_instance_count)
		families[family].submitted+=count
		if not child.is_visible_in_tree() or (child.layers&camera.cull_mask)==0:continue
		families[family].nodeVisible+=count
		var buffer=multi.buffer
		var material:ShaderMaterial=multi.mesh.surface_get_material(0)
		var geometry_weight=float(material.get_shader_parameter("canopy_geometry_weight")) if family in ["tree","trunk"] else 1.0
		if geometry_weight<=0:continue
		for i in count:
			var at=i*20;var position=child.global_transform*Vector3(buffer[at+3],buffer[at+7],buffer[at+11])
			if not camera.is_position_in_frustum(position):continue
			var alpha=0.0
			if family in ["tree","trunk"]:
				var clip=vp*Vector4(position.x,reference_y,position.z,1)
				var east=vp*Vector4(position.x+1,reference_y,position.z,1);var south=vp*Vector4(position.x,reference_y,position.z+1,1)
				var east_pixels=((Vector2(east.x,east.y)/east.w-Vector2(clip.x,clip.y)/clip.w)*viewport_size*.5).length()
				var south_pixels=((Vector2(south.x,south.y)/south.w-Vector2(clip.x,clip.y)/clip.w)*viewport_size*.5).length()
				var footprint=1.0/maxf(minf(east_pixels,south_pixels),.000001)
				alpha=geometry_weight*preload("res://adapters/surface_canopy.gd").instance_weight(int(buffer[at+17]),footprint)
			else:
				var centre_view=view*position;var denominator=1.0 if projection.w.w>.5 else maxf(.001,-centre_view.z)
				alpha=smoothstep(1.25,3.0,float(buffer[at+16])*absf(projection.y.y)*viewport_size.y/(2.0*denominator))
			if alpha>0.000001:families[family].alphaPositiveInFrustum+=1
	var material=terrain.get("material") if terrain!=null else null
	var trees=bool(material.call("get_shader_param","show_trees")) if material!=null else false
	return {"families":families,"treeResidualEnabled":trees,"treeOpticalShadowEnabled":trees and rendered_presentation_mode!="cartographic","scope":"submitted buffers, actual node/camera visibility, shader ALPHA>0 and centres in frustum; no GPU occlusion claim"}

func _build_road_projectors(records: Array) -> void:
	var packet:Dictionary=rendered_packet if not rendered_packet.is_empty() else self.packet
	var presentation_mode:String=rendered_presentation_mode
	road_projector_count=records.size()
	if records.is_empty(): return
	if road_texture==null:
		var image := Image.create(8,8,false,Image.FORMAT_RGBA8)
		image.fill(Color.WHITE)
		road_texture=ImageTexture.create_from_image(image)
	for record in records:
		var projector := Decal.new()
		projector.name="SourceRoad_"+str(record.sourceIndex)+"_"+str(record.segmentIndex)+"_"+str(record.chunkIndex)
		projector.position=record.position; projector.rotation.y=record.yaw; projector.size=record.size
		projector.cull_mask=1; projector.upper_fade=0.0; projector.lower_fade=0.0
		projector.texture_albedo=road_texture
		projector.modulate=Color(0.42,0.38,0.30,1.0)
		projector.albedo_mix=0.72
		var style=Presentation.road_decal_style(packet,presentation_mode,record.get("metadata",record))
		if style.cartographic:
			projector.texture_albedo=style.texture
			projector.modulate=style.modulate
			projector.albedo_mix=style.albedoMix
			projector.set_meta("cartographicRoadStyle",{"fillCSS":style.fillCSS,"edgeCSS":style.edgeCSS,"borderFraction":style.borderFraction,"rural":style.rural})
		projector.set_meta("sourceRoad",record.metadata)
		objects.add_child(projector)

func _resolve_scene(value: Dictionary) -> bool:
	var source: Dictionary = value.get("source",{})
	var id := str(source.get("sceneContextId",""))
	if id.is_empty(): return true
	if not value.has("urban") or value.urban==null:
		if not scene_contexts.has(id):
			push_warning("Scene context unavailable; requesting a complete scene on the next reply")
			known_scene_context_id=""
			return false
		value.urban=scene_contexts[id].urban
		var combined: Dictionary = scene_contexts[id].source.duplicate(false)
		combined.merge(source,true); value.source=combined
	scene_contexts[id]={"urban":value.urban,"source":value.source}
	known_scene_context_id=id
	while scene_contexts.size()>2: scene_contexts.erase(scene_contexts.keys()[0])
	return true

func _apply_geometry_detail(material:Object,info:Dictionary,render_origin:Dictionary)->void:
	material.call("set_shader_param","geometry_detail_enabled",info.get("available",false) and int(info.get("recipe",-1))>=0)
	rendered_geometry_detail={"available":info.get("available",false)}
	if not info.get("available",false):return
	var key=str(info.cacheKey)
	if not geometry_detail_textures.has(key):
		geometry_detail_textures[key]=ImageTexture.create_from_image(info.image)
		while geometry_detail_textures.size()>2:geometry_detail_textures.erase(geometry_detail_textures.keys()[0])
	var grid:Dictionary=info.grid
	var values={"geometry_detail_map":geometry_detail_textures[key],"detail_origin":Vector2(float(grid.originX)-float(render_origin.x),float(grid.originZ)-float(render_origin.z)),"detail_grid_size":Vector2(int(grid.width),int(grid.height)),"detail_spacing_m":float(grid.spacingM),"detail_rock_colors":info.colors,"detail_bedrock_recipe":int(info.recipe)}
	for name in values:material.call("set_shader_param",name,values[name])
	rendered_geometry_detail={"available":true,"id":info.id,"source":info.source,"grid":grid,"conditioned":info.conditioned,"bedrockRecipe":info.recipe}

func _source_scene_lineage()->String:
	var source:Dictionary=packet.get("source",{})
	return JSON.stringify(Library._canonical([world.get("terrain",{}).get("source",{}),source.get("sourceEpoch"),source.get("sceneEpoch"),known_context_id,known_scene_context_id]))

# Source LOD, child bounds and terrain version may evolve within this physical
# lineage. Canonical environment, accepted scene or source epoch may not.
func _physical_lineage(value:Dictionary,scene_packet:Dictionary)->String:
	var source:Dictionary=scene_packet.get("source",{})
	var identity:Dictionary=value.get("terrain",{}).get("source",{})
	var versions:Dictionary=value.get("versions",{})
	var canonical_versions=[]
	for key in ["environment","occupation","population","materialLibrary","surfaceState","hydrology","geology","surfaceLayers"]:canonical_versions.append(versions.get(key))
	var profile=Presentation.profile(scene_packet,str(options.get("--presentation","cartographic" if options.has("--style") else "")))
	return JSON.stringify(Library._canonical([value.get("seed"),identity.get("id"),identity.get("version"),source.get("sourceEpoch"),source.get("sceneEpoch"),value.get("canonicalContextRef",{}).get("id"),source.get("sceneContextId"),Geometry.city_identity(scene_packet),canonical_versions,profile.mode,profile.palette]))

func _record_live_binding_rejection(reason:String,serial:int)->void:
	var event={"tickMs":Time.get_ticks_msec(),"requestSerial":serial,"reason":reason}
	live_binding_rejections.append(event)
	while live_binding_rejections.size()>128:live_binding_rejections.pop_front()
	push_warning("Live source rejected; retaining the loaded map: "+reason)

# Mirror Geometry.height_at's coarse-to-fine feather without inventing a source
# level. A bundle's known fine tile can be completely outside the current view.
func _source_actual_at_focus(value:Dictionary,display:Dictionary,position:Dictionary)->Dictionary:
	var x=float(position.x);var z=float(position.y)
	var layers=Geometry.prepare_height_layers(display)
	var contributions:Array=[]
	var seam_weight=0.0
	for index in range(layers.size()-1,-1,-1):
		var layer:Dictionary=layers[index]
		if not Data.contains(layer.bounds,x,z):continue
		var weight=1.0
		if not contributions.is_empty():
			var edge=minf(minf(x-float(layer.bounds.minX),float(layer.bounds.maxX)-x),minf(z-float(layer.bounds.minZ),float(layer.bounds.maxZ)-z))
			var band=maxf(float(layer.terrain.spacingM)*4.0,float(display.get("_displaySpacing",0))*2.0)
			weight=smoothstep(0.0,maxf(band,0.0001),edge)
		for part in contributions:part.weight*=1.0-weight
		var active=is_same(layer.terrain,display.terrain)
		if active:seam_weight=weight
		contributions.append({"source":layer.terrain.get("source",{}),"weight":weight,"activeChild":active})
	var fine_weight=0.0;var actual:Dictionary={};var dominant_weight=-1.0
	for part in contributions:
		if part.activeChild:fine_weight+=float(part.weight)
		if float(part.weight)>dominant_weight:
			dominant_weight=float(part.weight);actual=part.source
	return {"sourceActualAtFocus":actual,"focusInsideSource":Data.contains(value.bounds,x,z),"fineContributionWeight":fine_weight,"seamWeight":seam_weight,"contributions":contributions}

# Bound once per coherent object replacement, never once per camera input.
# Decal projection volumes are not physical structures and are excluded.
func _cache_scene_top_y()->void:
	scene_top_y=-INF
	for child in objects.get_children():
		if not child.visible or not (child is MeshInstance3D or child is MultiMeshInstance3D):continue
		var bounds:AABB=child.transform*child.get_aabb()
		if bounds.position.is_finite() and bounds.size.is_finite():scene_top_y=maxf(scene_top_y,bounds.end.y)

func _quality_preview()->bool:
	return ViewQuality.preview(last_real_input_tick,Time.get_ticks_msec())

func _update_quality_state()->void:
	var preview=_quality_preview()
	if quality_preview_active and not preview:
		quality_preview_active=false
		view_dirty=true
		final_quality_pending=options.has("--live-url")
		view_satisfied_serial=-1
		_update_view_satisfaction("input-settled")

func _update_view_satisfaction(reason:String,region:Dictionary={})->bool:
	if rendered_world.is_empty():return false
	if region.is_empty():region=ViewQuality.request_region(world,packet,focus,width_m,_quality_preview())
	var evidence=ViewQuality.cache_evidence(rendered_world,rendered_packet,region,_physical_lineage(rendered_world,rendered_packet)==_physical_lineage(world,packet))
	if not evidence.get("covered",false):
		view_satisfied_serial=-1
		view_satisfaction={"serial":live_serial,"covered":false,"reason":evidence.get("reason","unknown"),"preview":bool(region.preview)}
		return false
	var changed=view_satisfied_serial!=live_serial or view_satisfaction.get("preview")!=bool(region.preview) or view_satisfaction.get("worldId")!=rendered_world_id
	view_satisfied_serial=live_serial
	view_satisfaction=evidence.duplicate(true)
	view_satisfaction.merge({"serial":live_serial,"worldId":rendered_world_id,"requestSerial":rendered_live_serial,"reason":reason,"tickMs":Time.get_ticks_msec()})
	if changed:
		view_satisfaction_events.append(view_satisfaction.duplicate(true))
		while view_satisfaction_events.size()>128:view_satisfaction_events.pop_front()
		print(JSON.stringify({"event":"view-satisfied","viewSatisfaction":view_satisfaction}))
	return true

func _import_alignment_valid(prepared:Dictionary)->bool:
	if not prepared.get("localStart") is Vector3 or not is_finite(float(prepared.get("spacing",0))) or float(prepared.spacing)<0.25 or float(prepared.spacing)>100.0:return false
	var x=float(prepared.localStart.x)/float(prepared.spacing)/256.0
	var z=float(prepared.localStart.z)/float(prepared.spacing)/256.0
	return absf(x-roundf(x))<0.00001 and absf(z-roundf(z))<0.00001

func _expected_height_image_size(spacing:float,view_width:float)->int:
	var size=512
	while size*spacing<view_width*2.0 and size<2048:size*=2
	return size

# Presentation switches affect the renderer only; the source arrays/inventory remain immutable.
func set_layer_visibility(ground:bool,low_cover:bool,trees:bool)->void:
	layer_visibility={"ground":ground,"lowCover":low_cover,"trees":trees}
	if terrain!=null:
		var material=terrain.get("material")
		for binding in {"show_ground":ground,"show_low_cover":low_cover,"show_trees":trees}:
			material.call("set_shader_param",binding,{"show_ground":ground,"show_low_cover":low_cover,"show_trees":trees}[binding])
	for child in objects.get_children():
		if child.has_meta("surfaceLayer"): child.visible=layer_visibility.get(str(child.get_meta("surfaceLayer")),true)
	if not rendered_surface_layers.is_empty():rendered_surface_layers.visibility=layer_visibility.duplicate()

# Finish the immutable snapshot BEFORE applying any textures, origin or mesh.
# One active bake; camera updates coalesce in view_dirty and prepare afterwards.
func _water_source_covers(bounds:Dictionary,required_focus:Dictionary,required_width:float,source_world:Dictionary)->bool:
	if bounds.is_empty():return false
	var g:Dictionary=Data.context(source_world).grid
	var half=float(g.spacingM)*0.5
	var min_x=maxf(float(required_focus.x)-required_width*.5,float(g.originX)-half)
	var min_z=maxf(float(required_focus.y)-required_width*.5,float(g.originZ)-half)
	var max_x=minf(float(required_focus.x)+required_width*.5,float(g.originX)+(int(g.width)-1)*float(g.spacingM)+half)
	var max_z=minf(float(required_focus.y)+required_width*.5,float(g.originZ)+(int(g.height)-1)*float(g.spacingM)+half)
	return min_x>=max_x or min_z>=max_z or (float(bounds.get("minX",INF))<=min_x and float(bounds.get("minZ",INF))<=min_z and float(bounds.get("maxX",-INF))>=max_x and float(bounds.get("maxZ",-INF))>=max_z)

func _complete_prepared(prepared:Dictionary)->void:
	var geometry:Dictionary=prepared.get("waterGeometry",{})
	if geometry.is_empty():
		geometry=scene_mesh_cache.get(prepared.sceneRequest.get("waterKey",""),{}).get("geometry",{})
	var fixed=geometry.get("fixedVectorDisplayAvailable",false)
	var requested_mode=str(options.get("--water-mode","source-map" if fixed else "source-levels"))
	if requested_mode=="source-map" and fixed:
		water_projection_busy=true
		var snapshot_packet:Dictionary=prepared.packet
		var mode=str(prepared.get("presentationMode",presentation_mode))
		var physical=Presentation.water_material(snapshot_packet,mode)
		var colors={}
		for kind in ["river","lake","sea"]:colors[kind]=physical.get_shader_parameter("linear_"+kind+"_tint")
		colors.fallback=colors.lake
		var requested_focus:Dictionary=prepared.focus
		var width=float(prepared.get("viewWidth",requested_width))
		var coverage_width=width*(2.25 if prepared.get("oblique",oblique) else 1.0)
		var source_key=str(prepared.sceneRequest.get("waterKey",""))+":contours:"+str(geometry.get("sourceContourSha256","none"))
		var screen_mpp=coverage_width/get_viewport().get_visible_rect().size.x
		var scale_policy="oblique-ground-scale-approximation" if prepared.get("oblique",oblique) else "orthographic-map-ground-scale"
		var style_key=JSON.stringify([mode,colors.river,colors.lake,colors.sea,water_symbol_width_px,screen_mpp,scale_policy])
		var projection:Dictionary={}
		for cache_id in water_projection_cache:
			var entry:Dictionary=water_projection_cache[cache_id]
			var bounds:Dictionary=entry.bounds
			if entry.get("binding","")==source_key+style_key and _water_source_covers(entry.diagnostics.get("sourceVectorClipBounds",{}),requested_focus,coverage_width,prepared.world) and float(bounds.minX)<=float(requested_focus.x)-coverage_width*.5 and float(bounds.maxX)>=float(requested_focus.x)+coverage_width*.5 and float(bounds.minZ)<=float(requested_focus.y)-coverage_width*.5 and float(bounds.maxZ)>=float(requested_focus.y)+coverage_width*.5 and float(entry.diagnostics.get("metresPerTexel",INF))<=coverage_width/1024.0:
				projection=entry.duplicate(false);projection.diagnostics=entry.diagnostics.duplicate();projection.diagnostics.cacheUsed=true;break
		if projection.is_empty():
			var projection_width=coverage_width*1.25
			var bake_options={"symbolWidthPx":water_symbol_width_px,"screenMetresPerPixel":screen_mpp,"screenScalePolicy":scale_policy,"sourceKey":source_key,"resolution":2048,"msaa":2,"minHeightM":-10000.0,"maxHeightM":10000.0}
			projection=await WaterProjection.bake(self,geometry,prepared.origin,requested_focus,projection_width,colors,bake_options)
			if not projection.has("error"):
				projection.binding=source_key+style_key;projection.diagnostics.cacheUsed=false
				water_projection_cache[projection.cacheKey]=projection
				while water_projection_cache.size()>3:water_projection_cache.erase(water_projection_cache.keys()[0])
		water_projection_busy=false
		# Epoch/lineage is checked again after the await. No stale cache mutates source.
		if projection.has("error"):
			discarded_preparations["waterProjectionFailed"]=int(discarded_preparations.get("waterProjectionFailed",0))+1
			push_error("Water source-map projection failed; retaining displayed snapshot: "+str(projection.error))
			return
		prepared.waterProjection=projection
	_apply_prepared(prepared)

func _set_canopy_main_camera(material:Object,view_projection:Projection,viewport_size:Vector2)->void:
	var bindings={"canopy_main_camera_enabled":true,"canopy_main_camera_vp":view_projection,"canopy_main_viewport_size":viewport_size}
	for key in bindings:
		if material is ShaderMaterial:material.set_shader_parameter(key,bindings[key])
		else:material.call("set_shader_param",key,bindings[key])
