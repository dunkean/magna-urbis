extends "res://diagnostics/surface_soil_preview.gd"

var results:Array=[]
var failures:Array=[]
var output_path:=""

func require_true(value:bool,message:String)->void:
	if not value:failures.append(message);push_error(message)

func wait_ready()->bool:
	var deadline=Time.get_ticks_msec()+90000
	while Time.get_ticks_msec()<deadline:
		await process_frame
		if controls!=null and viewer.get("terrain")!=null and controls.settled():
			for frame in 4:await process_frame
			return true
	return false

func run()->void:
	super.run()
	var options:Dictionary=viewer.get("options")
	output_path=str(options.get("--soil-smoke-report","user://soil-demo-check.json"))
	if not await wait_ready():failures.append("Initial terrain did not become ready");finish();return
	var packet_path=str(options.get("--world",""))
	var before=FileAccess.get_sha256(packet_path)
	var world_id=str(viewer.get("rendered_world_id"))
	var palette_hashes:Dictionary={}
	for index in controls.styles.size():
		controls.select_style(index)
		for frame in 4:await process_frame
		var selected:Dictionary=controls.current_style()
		var material=viewer.get("terrain").get("material")
		var mode=material.call("get_shader_param","presentation_mode")
		require_true(int(mode)==(0 if selected.mode=="aerial" else 1),"Wrong shader presentation mode: "+str(selected.id))
		var palette=material.call("get_shader_param","map_palette")
		var palette_hash=str(palette).sha256_text()
		if selected.mode=="cartographic":palette_hashes[selected.id]=palette_hash
		var record:Dictionary=await controls.capture_view()
		require_true(record.get("captureStatus")=="complete","Incomplete capture: "+str(selected.id))
		require_true(record.get("imageSha256","")!="","Missing image: "+str(selected.id))
		require_true(not viewer.get("objects").visible and not viewer.get("sun").shadow_enabled,"Objects/shadows unexpectedly visible")
		results.append({"style":selected.id,"shaderMode":mode,"paletteHash":palette_hash,"capture":record})
	var unique:Dictionary={}
	for value in palette_hashes.values():unique[value]=true
	require_true(unique.size()>=7,"Native palette uniforms did not change sufficiently")
	controls.select_style(0);controls.toggle_detail();controls.toggle_low();controls.toggle_mean()
	var toggles=controls.snapshot()
	require_true(not toggles.detail and not toggles.lowCover and toggles.meanOnly,"Comparison controls failed")
	var diagnostic=viewer.get("terrain").get("material").call("get_shader_param","diagnostic")
	require_true(int(diagnostic)==7,"Physical mean diagnostic not applied")
	controls.toggle_detail();controls.toggle_low();controls.toggle_mean()
	for width in [10.0,1.0]:
		viewer.set("width_m",width);viewer.call("_update_camera");viewer.call("_begin_prepare")
		if not await wait_ready():failures.append("Zoom did not settle: "+str(width));break
		var record:Dictionary=await controls.capture_view()
		require_true(record.get("captureStatus")=="complete","Zoom capture incomplete: "+str(width))
		require_true(absf(float(record.get("widthM",0))-width)<.0001,"Wrong zoom width")
		results.append({"zoomM":width,"capture":record})
	require_true(FileAccess.get_sha256(packet_path)==before,"Saved source packet changed")
	finish()

func finish()->void:
	var path=ProjectSettings.globalize_path(output_path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file=FileAccess.open(path,FileAccess.WRITE)
	if file!=null:file.store_string(JSON.stringify({"format":"surface-soil-demo-check","pass":failures.is_empty(),"failures":failures,"results":results},"  "));file=null
	viewer.call("_write_metrics")
	quit(0 if failures.is_empty() else 1)
