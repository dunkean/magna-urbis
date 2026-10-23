extends SceneTree
const Canopy = preload("res://adapters/surface_canopy.gd")
const Population = preload("res://adapters/surface_population.gd")

class Crown:
	extends Node2D
	var radius_px: float
	func _draw() -> void: draw_circle(Vector2.ZERO,radius_px,Color.WHITE)

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	if DisplayServer.get_name()=="headless":
		push_error("Canopy GPU probe requires a real renderer; omit --headless")
		quit(1);return
	var trees := [
		{"stableId":"a","family":"tree","x":29.0,"z":32.0,"y":0.0,"size":12.0,"crownRadiusM":5.0,"rank":0.1},
		{"stableId":"b","family":"tree","x":34.0,"z":32.0,"y":0.0,"size":12.0,"crownRadiusM":5.0,"rank":0.2},
		{"stableId":"budget-excluded","family":"tree","x":32.0,"z":38.0,"y":0.0,"size":10.0,"crownRadiusM":4.2,"rank":0.8}]
	var packet := {"candidateBounds":{"minX":0.0,"minZ":0.0,"maxX":64.0,"maxZ":64.0},"candidates":trees}
	var atlas: Dictionary = Canopy.prepare(packet,{"a":true,"b":true})
	assert(atlas.available and atlas.treeCount==3 and atlas.selectedTreeCount==2)
	assert(atlas.coverageImage.get_format()==Image.FORMAT_RF and atlas.coverageImage.has_mipmaps())
	assert(atlas.countsImage.get_format()==Image.FORMAT_RGBAF and not atlas.countsImage.has_mipmaps())
	var viewport := SubViewport.new(); viewport.size=Vector2i(512,512);viewport.transparent_bg=true;viewport.disable_3d=true
	viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	# Exercise the actual spatial instance shader as well as the canvas coverage probe.
	var spatial := SubViewport.new();spatial.size=Vector2i(64,64);spatial.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	root.add_child(spatial)
	var camera := Camera3D.new();camera.position=Vector3(0,8,8);spatial.add_child(camera);camera.look_at(Vector3.ZERO)
	var mesh := MeshInstance3D.new();mesh.mesh=SphereMesh.new()
	var instance_material := ShaderMaterial.new();instance_material.shader=load("res://shaders/canopy_instance.gdshader")
	mesh.material_override=instance_material;spatial.add_child(mesh)
	var shader := Shader.new()
	shader.code="shader_type canvas_item;\n#include \"res://shaders/canopy.gdshaderinc\"\nuniform float probe_footprint=1.0;\nvoid fragment(){float g=surface_canopy_residual(UV*64.0,probe_footprint,0.0);COLOR=vec4(1.0,1.0,1.0,g);}\n"
	var material := ShaderMaterial.new();material.shader=shader
	material.set_shader_parameter("canopy_enabled",true)
	material.set_shader_parameter("canopy_coverage",ImageTexture.create_from_image(atlas.coverageImage))
	material.set_shader_parameter("canopy_counts",ImageTexture.create_from_image(atlas.countsImage))
	material.set_shader_parameter("canopy_origin",atlas.origin)
	material.set_shader_parameter("canopy_grid_size",atlas.gridSize)
	material.set_shader_parameter("canopy_spacing_m",atlas.spacingM)
	material.set_shader_parameter("canopy_bounds",Vector4(0,0,64,64))
	material.set_shader_parameter("canopy_fallback_blend_m",16.0)
	var background := ColorRect.new();background.size=Vector2(512,512);background.material=material;viewport.add_child(background)
	var crown_materials: Array[ShaderMaterial] = []
	for tree in trees.slice(0,2):
		var crown_shader := Shader.new()
		crown_shader.code="shader_type canvas_item;\n#include \"res://shaders/canopy.gdshaderinc\"\nuniform int probe_class=2;\nuniform float probe_footprint=1.0;\nvoid fragment(){COLOR=vec4(1.0,1.0,1.0,canopy_instance_weight(probe_class,probe_footprint));}\n"
		var crown_material := ShaderMaterial.new();crown_material.shader=crown_shader
		crown_material.set_shader_parameter("probe_class",Canopy.radius_class(float(tree.crownRadiusM)))
		var crown := Crown.new();crown.radius_px=float(tree.crownRadiusM)*8.0;crown.position=Vector2(tree.x,tree.z)*8.0;crown.material=crown_material
		viewport.add_child(crown);crown_materials.append(crown_material)
	var expected := 0.0
	var level_zero: PackedFloat32Array = atlas.coverageImage.get_data().to_float32_array()
	for i in range(1024*1024): expected+=level_zero[i]
	expected/=float(1024*1024)
	var reports := []
	for footprint in [0.25,2.0,4.0,6.0,9.0,12.0,40.0]:
		material.set_shader_parameter("probe_footprint",footprint)
		for crown_material in crown_materials: crown_material.set_shader_parameter("probe_footprint",footprint)
		await process_frame;await process_frame;await process_frame
		var image := viewport.get_texture().get_image()
		if image==null or image.is_empty(): push_error("GPU canopy probe requires a real renderer (do not use --headless)");quit(1);return
		var mean := 0.0
		for y in range(image.get_height()):
			for x in range(image.get_width()): mean+=image.get_pixel(x,y).a
		mean/=float(image.get_width()*image.get_height())
		reports.append({"footprintM":footprint,"actualCoverage":mean,"expectedCoverage":expected,"absoluteError":absf(mean-expected)})
		if absf(mean-expected)>0.02: push_error("Canopy coverage drift exceeds 2pp: "+JSON.stringify(reports[-1]));quit(1);return
	var report := {"version":"canopy-r1","renderer":RenderingServer.get_video_adapter_name(),"results":reports}
	var arguments := OS.get_cmdline_user_args()
	var report_index := arguments.find("--report")
	if report_index>=0 and report_index+1<arguments.size():
		var file := FileAccess.open(arguments[report_index+1],FileAccess.WRITE)
		if file!=null: file.store_string(JSON.stringify(report,"  "))
	print("SURFACE_CANOPY_PROBE "+JSON.stringify(report))
	quit()
