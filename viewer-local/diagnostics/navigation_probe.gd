extends SceneTree

# External continuous-input benchmark. Production main.gd is loaded unchanged.
# Do not pass --frames/--tour: those intentionally suppress interactive input.
var viewer: Node
const Evidence = preload("res://diagnostics/navigation_evidence.gd")

func _initialize() -> void:
	call_deferred("run")

func options() -> Dictionary:
	var result := {}; var args := OS.get_cmdline_user_args(); var i := 0
	while i<args.size():
		if i+1<args.size() and not args[i+1].begins_with("--"): result[args[i]]=args[i+1];i+=2
		else: result[args[i]]=true;i+=1
	return result

func ready_for_input(require_live: bool) -> bool:
	if viewer.get("terrain")==null or viewer.get("worker")!=null or viewer.get("packet_worker")!=null or bool(viewer.get("view_dirty")): return false
	if require_live:
		var world: Dictionary = viewer.get("world")
		var rendered: Dictionary = viewer.get("rendered_snapshot")
		return not bool(viewer.get("live_busy")) and int(viewer.get("view_satisfied_serial"))==int(viewer.get("live_serial")) and str(viewer.get("rendered_world_id"))==str(world.get("id","")) and Evidence.final_quality(rendered)
	return true

func snapshot(elapsed: float) -> Dictionary:
	var world: Dictionary = viewer.get("world")
	var focus: Dictionary = viewer.get("focus")
	var rendered: Dictionary = viewer.get("rendered_snapshot")
	var discarded: Dictionary = viewer.get("discarded_preparations")
	return {"elapsedSeconds":elapsed,"focus":focus.duplicate(),"widthM":float(viewer.get("width_m")),
		"appliedGeneration":int(viewer.get("applied_generation")),"requestedGeneration":int(viewer.get("generation")),
		"worldId":str(world.get("id","")),"source":world.get("terrain",{}).get("source",{}),
		"rendered":rendered.duplicate(true),"discardedPreparations":discarded.duplicate(),
		"liveSerial":int(viewer.get("live_serial")),"liveAppliedSerial":int(viewer.get("last_live_applied_serial")),
		"viewSatisfiedSerial":int(viewer.get("view_satisfied_serial")),
		"viewSatisfaction":viewer.get("view_satisfaction").duplicate(true),
		"liveBusy":bool(viewer.get("live_busy")),"geometryBusy":viewer.get("worker")!=null}

func button(index: MouseButton,pressed: bool) -> void:
	var event := InputEventMouseButton.new();event.button_index=index;event.pressed=pressed
	event.button_mask=(MOUSE_BUTTON_MASK_LEFT if pressed else 0) if index==MOUSE_BUTTON_LEFT else Input.get_mouse_button_mask()
	event.position=root.get_visible_rect().size*0.5
	Input.parse_input_event(event)

func run() -> void:
	var args := options()
	if args.has("--navigation-check-only"):
		print("SURFACE_NAVIGATION_PROBE_PARSE_OK");quit();return
	var duration := float(args.get("--navigation-seconds","20"))
	if duration<5.0 or duration>120.0 or not args.has("--world") or args.has("--frames") or args.has("--tour"):
		push_error("Navigation probe requires --world, duration5..120s, and no --frames/--tour");quit(2);return
	var packed := load("res://scene/main.tscn") as PackedScene
	if packed==null: push_error("Native main scene missing");quit(2);return
	viewer=packed.instantiate();root.add_child(viewer);current_scene=viewer
	var began := Time.get_ticks_msec();var require_live := args.has("--live-url")
	while not ready_for_input(require_live) and Time.get_ticks_msec()-began<180000:
		await process_frame
	if not ready_for_input(require_live): push_error("Navigation source did not reach initial applied ready state");quit(1);return
	var report := {"format":"magna-native-navigation-proof","version":2,"profile":"zoom-pan-v1","continuousSeconds":duration,
		"warmupSeconds":(Time.get_ticks_msec()-began)/1000.0,"live":require_live,"inputHzRequested":20.0,
		"initial":snapshot(0.0),"motionApplications":[],"inputSamples":[],"sourceReplacedWhileMoving":false,
		"scope":"Real Input.parse_input_event wheel and held-left pan against the unmodified native scene; no FPS target is assumed."}
	report.qualityPolicy={"interactive":{"preview":true,"requestedResolution":128},"settled":{"preview":false,"requestedResolution":512},"actualProviderGridAuthoritative":true,"canonicalInventoryUnchanged":true}
	button(MOUSE_BUTTON_LEFT,true)
	var motion_began := Time.get_ticks_msec();var next_input := 0.0
	report.motionStartTickMs=motion_began
	var initial_rendered_serial := int(viewer.get("rendered_live_serial"))
	var initial_rendered_world_id := str(viewer.get("rendered_world_id"))
	var minimum_width := float(viewer.get("width_m"));var maximum_pan_offset := 0.0
	var last_generation := int(viewer.get("applied_generation"));var last_live := int(viewer.get("last_live_applied_serial"))
	var last_apply := 0.0;var longest_gap := 0.0;var live_applies := 0
	while true:
		var elapsed := (Time.get_ticks_msec()-motion_began)/1000.0
		if elapsed>=duration: break
		var generation := int(viewer.get("applied_generation"));var live_applied := int(viewer.get("last_live_applied_serial"))
		if generation!=last_generation:
			report.motionApplications.append(snapshot(elapsed));longest_gap=maxf(longest_gap,elapsed-last_apply);last_apply=elapsed;last_generation=generation
		if live_applied!=last_live: live_applies+=1;last_live=live_applied
		if elapsed>=next_input:
			next_input=elapsed+0.05
			# A log-scale zoom reaches the close view without a quiet pause. Panning
			# continues at20Hz after the final zoom, so stale-result starvation is visible.
			var progress := minf(1.0,elapsed/(duration*0.7))
			var target := exp(lerpf(log(40000.0),log(10.0),progress))
			if progress>=1.0: target=10.0*(1.0+0.18*sin(elapsed*1.9))
			var width := float(viewer.get("width_m"));var wheel := 0
			minimum_width=minf(minimum_width,width)
			var focus: Dictionary = viewer.get("focus")
			maximum_pan_offset=maxf(maximum_pan_offset,sqrt(pow(float(focus.x)-float(report.initial.focus.x),2.0)+pow(float(focus.y)-float(report.initial.focus.y),2.0)))
			if width>target*1.13: wheel=MOUSE_BUTTON_WHEEL_UP
			elif width<target/1.13: wheel=MOUSE_BUTTON_WHEEL_DOWN
			if wheel!=0: button(wheel,true);button(wheel,false)
			var motion := InputEventMouseMotion.new();motion.position=root.get_visible_rect().size*0.5
			motion.relative=Vector2(sin(elapsed*1.3)*2.0,cos(elapsed*0.9)*1.5);motion.button_mask=MOUSE_BUTTON_MASK_LEFT
			Input.parse_input_event(motion)
			report.inputSamples.append({"elapsedSeconds":elapsed,"targetWidthM":target,"widthBeforeInputM":width,"wheel":wheel})
		await process_frame
	button(MOUSE_BUTTON_LEFT,false)
	report.motionEndTickMs=mini(Time.get_ticks_msec(),motion_began+roundi(duration*1000.0))
	report.motionActualWallSeconds=(Time.get_ticks_msec()-motion_began)/1000.0
	var previous_input := 0.0;var input_max_gap := 0.0
	for sample in report.inputSamples:
		input_max_gap=maxf(input_max_gap,float(sample.elapsedSeconds)-previous_input);previous_input=float(sample.elapsedSeconds)
	report.maximumInputGapSeconds=maxf(input_max_gap,duration-previous_input)
	longest_gap=maxf(longest_gap,duration-last_apply)
	report.motionApplicationCount=report.motionApplications.size();report.motionLiveApplicationCount=live_applies
	report.longestMotionApplicationGapSeconds=longest_gap
	report.motionEnd=snapshot(duration)
	report.minimumObservedWidthM=minimum_width;report.maximumObservedPanOffsetM=maximum_pan_offset
	var drain_began := Time.get_ticks_msec()
	await process_frame
	while not ready_for_input(require_live) and Time.get_ticks_msec()-drain_began<120000:
		await process_frame
	report.drainSeconds=(Time.get_ticks_msec()-drain_began)/1000.0
	report.finalReady=ready_for_input(require_live);report.final=snapshot(duration+report.drainSeconds)
	var render_events: Array = viewer.get("render_events")
	var accepted: Array = viewer.get("live_acceptance_events")
	report.liveAcceptance=accepted.duplicate(true)
	report.motionDisplayEvents=render_events.filter(func(event): return int(event.get("appliedTickMs",-1))>motion_began and int(event.get("appliedTickMs",-1))<=int(report.motionEndTickMs)).duplicate(true)
	report.motionLiveDisplays=Evidence.qualifying_live_displays(report.motionDisplayEvents,accepted,motion_began,int(report.motionEndTickMs),initial_rendered_serial,initial_rendered_world_id)
	report.motionLiveDisplayCount=report.motionLiveDisplays.size()
	report.sourceReplacedWhileMoving=report.motionLiveDisplayCount>0
	report.discardedPreparations=viewer.get("discarded_preparations").duplicate()
	report.status="complete" if bool(report.finalReady) and int(report.motionApplicationCount)>0 else "failed"
	if require_live and report.motionLiveDisplayCount==0: report.status="failed"
	if minimum_width>20.0 or maximum_pan_offset<=0.001: report.status="failed"
	viewer.call("_write_metrics")
	var path: String = str(args.get("--navigation-report","res://captures/navigation-report.json"))
	var absolute := ProjectSettings.globalize_path(path);DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())
	var file := FileAccess.open(absolute,FileAccess.WRITE)
	if file==null: push_error("Cannot write navigation report");quit(1);return
	file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"event":"navigation-proof","path":absolute,"status":report.status,
		"motionApplicationCount":report.motionApplicationCount,"motionLiveApplicationCount":live_applies,"motionLiveDisplayCount":report.motionLiveDisplayCount,"longestGapSeconds":longest_gap}))
	quit(0 if report.status=="complete" else 1)
