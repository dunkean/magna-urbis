extends "res://main.gd"
var started_us:=0
var previous_us:=0
var input_ms:Array[float]=[]
var warm:=0
var steps:=0
var zooms:=0
var done:=false
var baseline_draws:=0
func handle_input(_event:InputEvent)->void:pass # Ignore unrelated desktop events.
func _process(delta:float)->bool:
	super._process(delta)
	if renderer==null or not str(renderer.failed).is_empty() or done:return false
	if started_us==0:
		if not renderer.ready:return false
		warm+=1
		if warm<30:return false
		started_us=Time.get_ticks_usec();previous_us=started_us;baseline_draws=int(renderer.stats().draws)
		var down:=InputEventMouseButton.new();down.button_index=MOUSE_BUTTON_LEFT;down.pressed=true
		super.handle_input(down)
	var now=Time.get_ticks_usec();var seconds=float(now-started_us)/1000000.0
	if seconds<8.0:
		if steps>0:input_ms.append(float(now-previous_us)/1000.0)
		previous_us=now;steps+=1
		var motion:=InputEventMouseMotion.new();motion.relative=Vector2(.15*sin(seconds*2),.12*cos(seconds*3));super.handle_input(motion)
		if zooms<37 and seconds>=float(zooms)*.18:
			var wheel:=InputEventMouseButton.new();wheel.button_index=MOUSE_BUTTON_WHEEL_UP;wheel.pressed=true;wheel.position=Vector2(pixels)*.5
			super.handle_input(wheel);zooms+=1
	elif renderer.ready and not view_dirty:
		done=true;call_deferred("finish_navigation",seconds)
	return false
func quantile(fraction:float)->float:
	var ordered=input_ms.duplicate();ordered.sort()
	return ordered[mini(ordered.size()-1,int(floor(fraction*ordered.size())))] if not ordered.is_empty() else 0.0
func finish_navigation(seconds:float)->void:
	var stats:Dictionary=renderer.stats()
	var report={"scope":"8s scripted actual pan/zoom inputs on retained original Render, no live source generation; initial warm-up excluded","steps":steps,"zoomSteps":zooms,"durationWithDrainS":seconds,"inputFrames":input_ms.size(),"frameWallMs":{"p50":quantile(.50),"p95":quantile(.95),"p99":quantile(.99),"max":quantile(1)},"drawsDuringInputsAndDrain":int(stats.draws)-baseline_draws,"finalWidthM":width_m,"finalFocus":[focus_x,focus_y],"renderer":stats}
	var path=ProjectSettings.globalize_path(str(options["--scene"]).get_base_dir().path_join("navigation-check.json"))
	# Caller gives a copied test fixture, never edits the retained reference itself.
	var file=FileAccess.open(path,FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"event":"render-original-navigation","path":path,"report":report}));exiting=true;quit()
