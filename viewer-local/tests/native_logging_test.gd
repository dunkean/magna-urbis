extends SceneTree
func _initialize():call_deferred("run")
func run():
	var consumer=load("res://scene/main.gd").new()
	var snapshot={"worldId":"synthetic-logging-only","source":{"provenance":"complete retained proof"},"request":{"preview":true,"resolution":128}}
	consumer.set("rendered_snapshot",snapshot);consumer.set("render_events",[snapshot])
	for i in 550:consumer._emit_native({"event":"logging-unit","serial":i,"worldId":"synthetic-logging-only"})
	var timings=consumer.get("native_log_timings");var maxima=consumer.get("native_log_maxima")
	assert(timings.size()==512 and maxima["logging-unit"].count==550)
	assert(consumer.get("rendered_snapshot")==snapshot and consumer.get("render_events")[0]==snapshot)
	assert(maxima["logging-unit"].characters<1024)
	for row in timings:assert(row.beforeSerializeUs<=row.beforePrintUs and row.beforePrintUs<=row.afterPrintUs)
	var source=FileAccess.get_file_as_string("res://scene/main.gd")
	var capture=source.substr(source.find("func _capture("),source.find("func _emit_native(")-source.find("func _capture("))
	assert(capture.contains('"renderedSnapshot":rendered_snapshot') and capture.contains('"surfaceLayers":rendered_surface_layers') and capture.contains('"water":water_metrics'))
	for key in ["camera","objects","sun","live_request","hud"]:
		var node=consumer.get(key)
		if node is Node and not node.is_inside_tree():node.free()
	consumer.free();print(JSON.stringify({"passed":true,"scope":"synthetic bounded log-timing retention and complete proof/capture payload preservation; no terrain/GPU evidence"}));quit()
