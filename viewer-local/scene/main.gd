extends Node3D

const Data = preload("res://adapters/surface_data.gd")
const Library = preload("res://adapters/material_library.gd")
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

func _ready() -> void:
	_parse_options()
	if not ClassDB.class_exists("Terrain3D"):
		push_error("Terrain3D missing. Run viewer-local/bootstrap.ps1 first.")
		get_tree().quit(2)
		return
	world_path = options.get("--world", "")
	if world_path.is_empty():
		push_error("Required: -- --world <SurfaceWorld.json> [--assets resolved.json]")
		get_tree().quit(2)
		return
	packet = Data.read_json(world_path)
	world = Data.unpack_world(packet)
	if world.is_empty():
		get_tree().quit(2)
		return
	world_modified = FileAccess.get_modified_time(world_path)
	var b: Dictionary = world.bounds
	focus = {"x":(float(b.minX)+float(b.maxX))*0.5,"y":(float(b.minZ)+float(b.maxZ))*0.5}
	if options.has("--x"): focus.x = float(options["--x"])
	if options.has("--z"): focus.y = float(options["--z"])
	width_m = float(options.get("--width",maxf(float(b.maxX)-float(b.minX),float(b.maxZ)-float(b.minZ))))
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
	generation += 1
	if worker != null:
		return
	requested_focus = focus.duplicate()
	requested_width = width_m
	var reference_height := Data.height_at(world,focus.x,focus.y)
	var next_origin: Dictionary = {"x":focus.x,"y":reference_height,"z":focus.y}
	worker = Thread.new()
	worker.start(Data.prepare.bind(world,next_origin,width_m))
	last_request_tick = Time.get_ticks_msec()

func _apply_prepared(prepared: Dictionary) -> void:
	if prepared.worldId != world.id:
		return
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
	var code := FileAccess.get_file_as_string("res://addons/terrain_3d/extras/shaders/minimum.gdshader").replace("\r", "")
	code = code.replace("// Public Uniforms",FileAccess.get_file_as_string("res://shaders/surface_uniforms.gdshaderinc")+"\n// Public Uniforms")
	code = code.replace("ALBEDO = vec3(.2);\n\tROUGHNESS = .7;",FileAccess.get_file_as_string("res://shaders/surface_body.gdshaderinc"))
	if recreate:
		var shader := Shader.new()
		shader.code = code
		mat.set("shader_override",shader)
		mat.set("shader_override_enabled",true)
		mat.set("world_background",0)
	var next_origin: Dictionary = prepared.origin
	library.configure(mat,world,next_origin)
	var t: Dictionary = world.terrain
	mat.call("set_shader_param","surface_ids",ImageTexture.create_from_image(prepared.ids))
	mat.call("set_shader_param","surface_state",ImageTexture.create_from_image(prepared.state))
	mat.call("set_shader_param","surface_bedrock",ImageTexture.create_from_image(prepared.rock))
	mat.call("set_shader_param","source_origin",Vector2(float(t.originX)-next_origin.x,float(t.originZ)-next_origin.z))
	mat.call("set_shader_param","source_extent",Vector2((int(t.width)-1)*float(t.spacingM),(int(t.height)-1)*float(t.spacingM)))
	mat.call("set_shader_param","diagnostic",diagnostic)
	if packet.has("candidateBounds"):
		var cb: Dictionary = packet.candidateBounds
		mat.call("set_shader_param","candidate_bounds",Vector4(float(cb.minX)-next_origin.x,float(cb.minZ)-next_origin.z,float(cb.maxX)-next_origin.x,float(cb.maxZ)-next_origin.z))
	var images: Array[Image] = [prepared.height,prepared.control,null]
	next_terrain.get("data").call("import_images",images,prepared.localStart,0.0,1.0)
	mat.set("show_checkered",false)
	terrain = next_terrain
	origin = next_origin
	applied_generation = generation
	_build_scene_objects()
	_update_camera()
	prepare_times.append(float(prepared.prepareMs))
	upload_times.append((Time.get_ticks_usec()-begin)/1000.0)
	warm_frames = 0
	print(JSON.stringify({"event":"terrain-replaced","worldId":world.id,"origin":[origin.x,origin.y,origin.z],"sourceLOD":world.terrain.source.sourceLOD,"nativeSpacingM":world.terrain.source.nativeSpacingM,"displaySpacingM":prepared.spacing,"regions":terrain.get("data").call("get_region_count"),"prepareMs":prepared.prepareMs,"uploadAndObjectsMs":upload_times.back()}))

func _update_camera() -> void:
	var target := Vector3(focus.x-origin.x,Data.height_at(world,focus.x,focus.y)-origin.y,focus.y-origin.z)
	# Orthographic top view gives an exact physical frame width and mm/px diagnostic.
	if not oblique:
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
		camera.size = width_m/get_viewport().get_visible_rect().size.aspect()
		camera.position = target+Vector3(0,maxf(width_m,20.0),0.0001)
	else:
		camera.projection = Camera3D.PROJECTION_PERSPECTIVE
		var distance := width_m/(2.0*tan(deg_to_rad(camera.fov)*0.5)*get_viewport().get_visible_rect().size.aspect())
		camera.position = target+Vector3(0,distance*0.73,distance*0.68)
	camera.near = maxf(0.0005,width_m*0.000001)
	camera.far = maxf(500.0,width_m*12.0)
	camera.look_at(target,Vector3.UP if oblique else Vector3.FORWARD)
	sun.directional_shadow_max_distance = clampf(width_m*1.5,40.0,3000.0)

func _build_scene_objects() -> void:
	for child in objects.get_children(): child.queue_free()
	_build_water()
	_build_urban()
	_build_populations()

func _build_water() -> void:
	var vertices := PackedVector3Array()
	var t: Dictionary = world.terrain
	var levels: Array = world.fields.waterLevelM
	var classes: Array = world.fields.waterClass
	# Water support uses supplied absolute water levels, never the ground palette.
	for z in int(t.height)-1:
		for x in int(t.width)-1:
			var i: int = z*int(t.width)+x
			if int(classes[i]) == 0 or levels[i] == null: continue
			var px: float = float(t.originX)+x*float(t.spacingM)-origin.x
			var pz: float = float(t.originZ)+z*float(t.spacingM)-origin.z
			var h: float = float(levels[i])-origin.y+0.015
			var s: float = t.spacingM
			var a := Vector3(px,h,pz)
			var b := Vector3(px+s,h,pz)
			var c := Vector3(px+s,h,pz+s)
			var d := Vector3(px,h,pz+s)
			vertices.append_array(PackedVector3Array([a,c,b,a,d,c]))
	if vertices.is_empty(): return
	var mesh := MeshInstance3D.new()
	mesh.name = "ExplicitWater"
	mesh.mesh = Data.make_mesh(vertices)
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/water.gdshader")
	material.set_shader_parameter("world_phase",Vector2(fposmod(origin.x,4096.0),fposmod(origin.z,4096.0)))
	mesh.material_override = material
	objects.add_child(mesh)

func _build_urban() -> void:
	var urban: Dictionary = packet.get("urban",{})
	var buildings = urban.get("buildings",[])
	if buildings is Dictionary: buildings = buildings.get("buildings",[])
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	for building in buildings:
		for triangle in building.get("triangles",[]):
			var n: Array = triangle.normal
			for point in triangle.points:
				vertices.append(Vector3(float(point[0])-origin.x,float(point[1])-origin.y,float(point[2])-origin.z))
				normals.append(Vector3(float(n[0]),float(n[1]),float(n[2])))
	if not vertices.is_empty():
		var instance := MeshInstance3D.new()
		instance.name = "NativeBuildingMeshes"
		instance.mesh = Data.make_mesh(vertices,normals)
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.63,0.56,0.44)
		mat.roughness = 0.85
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		instance.material_override = mat
		objects.add_child(instance)
	for road in urban.get("roads",[]):
		var points: Array = road.get("points",[])
		if points.size()<2: continue
		var road_vertices := PackedVector3Array()
		var half_width := float(road.get("widthM",5.0))*0.5
		for i in points.size()-1:
			var a: Array = points[i]
			var b: Array = points[i+1]
			var bounds: Dictionary = world.bounds
			if float(a[0])<float(bounds.minX) or float(a[0])>float(bounds.maxX) or float(a[1])<float(bounds.minZ) or float(a[1])>float(bounds.maxZ): continue
			if float(b[0])<float(bounds.minX) or float(b[0])>float(bounds.maxX) or float(b[1])<float(bounds.minZ) or float(b[1])>float(bounds.maxZ): continue
			var delta := Vector2(float(b[0])-float(a[0]),float(b[1])-float(a[1])).normalized()
			var side := Vector2(-delta.y,delta.x)*half_width
			var corners: Array[Vector3] = []
			for pair in [[a,-side],[a,side],[b,side],[b,-side]]:
				var x: float = float(pair[0][0])+pair[1].x
				var z: float = float(pair[0][1])+pair[1].y
				corners.append(Vector3(x-origin.x,Data.height_at(world,x,z)+0.06-origin.y,z-origin.z))
			road_vertices.append_array(PackedVector3Array([corners[0],corners[2],corners[1],corners[0],corners[3],corners[2]]))
		var instance := MeshInstance3D.new()
		instance.mesh = Data.make_mesh(road_vertices)
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.21,0.20,0.18)
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		instance.material_override = mat
		objects.add_child(instance)

func _build_populations() -> void:
	var candidates: Array = packet.get("candidates",packet.get("populations",[]))
	candidate_count = candidates.size()
	if not is_same(indexed_packet,packet):
		candidate_buckets.clear()
		for candidate in candidates:
			var address := Vector2i(floori(float(candidate.x)/128.0),floori(float(candidate.z)/128.0))
			if not candidate_buckets.has(address): candidate_buckets[address] = []
			candidate_buckets[address].append(candidate)
		indexed_packet = packet
	selected_candidates = 0
	var families := {"tree":[],"shrub":[],"boulder":[],"grass":[],"debris":[]}
	var radius := clampf(width_m*0.9,40.0,2500.0)
	var nearby: Array = []
	for z in range(floori((focus.y-radius)/128.0),floori((focus.y+radius)/128.0)+1):
		for x in range(floori((focus.x-radius)/128.0),floori((focus.x+radius)/128.0)+1):
			nearby.append_array(candidate_buckets.get(Vector2i(x,z),[]))
	for candidate in nearby:
		var family: String = candidate.family
		if not families.has(family): continue
		var distance := Vector2(float(candidate.x)-focus.x,float(candidate.z)-focus.y).length()
		if distance > radius: continue
		var projected := float(candidate.size)/width_m*get_viewport().get_visible_rect().size.x
		if projected < 1.25: continue
		if selected_candidates >= 16000: break
		families[family].append(candidate)
		selected_candidates += 1
	for family in families:
		var visible: Array = families[family]
		if visible.is_empty(): continue
		var mesh: Mesh
		var mat := StandardMaterial3D.new()
		if family == "tree" or family == "shrub":
			var shape := SphereMesh.new()
			shape.radial_segments = 8
			shape.rings = 4
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
		mesh.surface_set_material(0,mat)
		var multi := MultiMesh.new()
		multi.transform_format = MultiMesh.TRANSFORM_3D
		multi.mesh = mesh
		multi.instance_count = visible.size()
		for i in visible.size():
			var candidate: Dictionary = visible[i]
			var size: float = candidate.size
			var crown: bool = family=="tree"
			var position := Vector3(float(candidate.x)-origin.x,float(candidate.y)+size*(0.72 if crown else 0.5)-origin.y,float(candidate.z)-origin.z)
			var basis := Basis(Vector3.UP,float(candidate.orientation)).scaled(Vector3(size,size*(0.66 if crown else 1.0),size))
			multi.set_instance_transform(i,Transform3D(basis,position))
		var instance := MultiMeshInstance3D.new()
		instance.name = family+"_bounded_instances"
		instance.multimesh = multi
		objects.add_child(instance)
		if family=="tree":
			var trunk_mesh := CylinderMesh.new()
			trunk_mesh.top_radius = 0.035
			trunk_mesh.bottom_radius = 0.055
			trunk_mesh.height = 0.74
			trunk_mesh.radial_segments = 5
			var trunk_mat := StandardMaterial3D.new()
			trunk_mat.albedo_color = Color(0.16,0.105,0.067)
			trunk_mesh.material = trunk_mat
			var trunks := MultiMesh.new()
			trunks.transform_format = MultiMesh.TRANSFORM_3D
			trunks.mesh = trunk_mesh
			trunks.instance_count = visible.size()
			for i in visible.size():
				var c: Dictionary = visible[i]
				var size: float = c.size
				trunks.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3(size,size,size)),Vector3(float(c.x)-origin.x,float(c.y)+size*0.37-origin.y,float(c.z)-origin.z)))
			var trunk_instance := MultiMeshInstance3D.new()
			trunk_instance.name = "tree_trunks"
			trunk_instance.multimesh = trunks
			objects.add_child(trunk_instance)

func _process(delta: float) -> void:
	if world.is_empty(): return
	frames += 1
	if worker != null and not worker.is_alive():
		var prepared: Dictionary = worker.wait_to_finish()
		worker = null
		_apply_prepared(prepared)
		if prepared.worldId!=world.id or absf(requested_focus.x-focus.x)+absf(requested_focus.y-focus.y)>0.01 or absf(requested_width-width_m)>0.01:
			_begin_prepare()
	if terrain != null:
		warm_frames += 1
		if warm_frames>30: frame_times.append(delta*1000.0)
	if frames%15 == 0:
		_poll_stream()
		_update_hud()
		if live_serial>live_requested_serial and not live_busy and Time.get_ticks_msec()-last_live_tick>400:
			_request_live()
	if options.has("--tour") and terrain != null and worker == null:
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
			_begin_prepare()
	if options.has("--frames") and terrain != null and warm_frames>=int(options["--frames"]):
		if options.has("--capture") and not capture_pending:
			capture_pending = true
			_capture(options["--capture"])
			_write_metrics()
			await get_tree().process_frame
			get_tree().quit()
		elif not options.has("--capture"):
			_write_metrics()
			get_tree().quit()

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
			KEY_O: oblique = not oblique; changed = true
			KEY_D:
				diagnostic = (diagnostic+1)%5
				if terrain!=null: terrain.get("material").call("set_shader_param","diagnostic",diagnostic)
			KEY_S: _capture("res://captures/surface-%d.png"%Time.get_unix_time_from_system())
			KEY_F: print(JSON.stringify({"event":"inspect","x":focus.x,"z":focus.y,"heightM":Data.height_at(world,focus.x,focus.y),"material":Data.field_at(world,"material",focus.x,focus.y,true),"bedrock":Data.field_at(world,"bedrock",focus.x,focus.y,true),"sand":Data.field_at(world,"sand",focus.x,focus.y),"silt":Data.field_at(world,"silt",focus.x,focus.y),"clay":Data.field_at(world,"clay",focus.x,focus.y),"waterClass":Data.field_at(world,"waterClass",focus.x,focus.y,true),"source":world.terrain.source}))
			KEY_ESCAPE: _write_metrics(); get_tree().quit()
		if event.keycode>=KEY_1 and event.keycode<=KEY_7:
			width_m = tour_widths[event.keycode-KEY_1]
			changed = true
	if changed:
		_update_camera()
		if worker==null and Time.get_ticks_msec()-last_request_tick>160:
			_begin_prepare()
		_request_source()
		live_serial += 1

func _request_live() -> void:
	if not options.has("--live-url") or live_busy: return
	var extent := width_m*1.2
	var payload := {"region":{"x":focus.x-extent*0.5,"y":focus.y-extent*0.5,"extent":extent,"resolution":512}}
	if options.has("--session-id"): payload.sessionId = options["--session-id"]
	live_requested_serial = live_serial
	live_busy = true
	last_live_tick = Time.get_ticks_msec()
	var error := live_request.request(options["--live-url"],PackedStringArray(["Content-Type: application/json"]),HTTPClient.METHOD_POST,JSON.stringify(payload))
	if error!=OK:
		live_busy = false
		push_warning("Live terrain request failed to start: "+str(error))

func _live_completed(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	live_busy = false
	if live_requested_serial!=live_serial:
		print("Discarded superseded live terrain response")
		return
	if result!=HTTPRequest.RESULT_SUCCESS or code<200 or code>=300:
		push_warning("Live terrain unavailable, retaining parent: HTTP "+str(code)+" "+body.get_string_from_utf8().left(240))
		return
	var next = JSON.parse_string(body.get_string_from_utf8())
	if not next is Dictionary: return
	var next_world := Data.unpack_world(next)
	if next_world.is_empty(): return
	world = next_world
	packet = next
	if worker==null: _begin_prepare()

func _request_source() -> void:
	if stream_directory.is_empty(): return
	request_id += 1
	var requests := stream_directory.path_join("requests")
	DirAccess.make_dir_recursive_absolute(requests)
	var id := "%d-%d"%[Time.get_unix_time_from_system(),request_id]
	var content := {"id":id,"worldId":world.id,"bounds":{"minX":focus.x-width_m*0.6,"minZ":focus.y-width_m*0.6,"maxX":focus.x+width_m*0.6,"maxZ":focus.y+width_m*0.6},"resolutionM":maxf(width_m/512.0,0.01),"sourceLOD":world.terrain.source.sourceLOD}
	var file := FileAccess.open(requests.path_join(id+".json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(content))
	last_stream_request = id

func _poll_stream() -> void:
	var path := world_path
	if not stream_directory.is_empty() and not last_stream_request.is_empty():
		var response := stream_directory.path_join("responses").path_join(last_stream_request+".json")
		if FileAccess.file_exists(response): path = response
	if path==world_path and FileAccess.get_modified_time(path)==world_modified: return
	var next := Data.read_json(path)
	if next.has("requestId") and str(next.requestId)!=last_stream_request: return
	if next.has("baseWorldId") and next.baseWorldId!=world.id: return
	var next_world := Data.unpack_world(next)
	if next_world.is_empty(): return
	if path==world_path: world_modified = FileAccess.get_modified_time(path)
	else: last_stream_request = ""
	world = next_world
	packet = next
	if worker==null: _begin_prepare()

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
	var metrics := {"godot":Engine.get_version_info().string,"terrain3d":"1.0.2","backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"worldId":world.id,"source":world.terrain.source,"resolution":[get_viewport().get_visible_rect().size.x,get_viewport().get_visible_rect().size.y],"frames":frame_times.size(),"frameWallMs":{"p50":_quantile(frame_times,0.5),"p95":_quantile(frame_times,0.95),"p99":_quantile(frame_times,0.99)},"prepareMs":prepare_times,"uploadAndObjectsMs":upload_times,"videoMemoryBytes":Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),"textureMemoryBytes":Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED),"drawCalls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"objects":selected_candidates,"candidateCount":candidate_count,"gpuTimeMs":null,"gpuTimeNote":"GPU timestamps unavailable through this compatibility backend; frame wall time includes vsync and driver."}
	var path: String = options.get("--metrics","res://captures/metrics.json")
	path = ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path,FileAccess.WRITE)
	file.store_string(JSON.stringify(metrics,"  "))
	print(JSON.stringify({"event":"metrics","path":path,"metrics":metrics}))

func _exit_tree() -> void:
	if worker!=null: worker.wait_to_finish()




