extends SceneTree
const Evidence = preload("res://diagnostics/navigation_evidence.gd")
func _initialize() -> void:
	var accepted := [{"requestSerial":5,"tickMs":1200,"worldId":"new-live","sourceEpoch":"source","sceneEpoch":"scene"}]
	var actual := {"worldId":"new-live","source":{"id":"registered","version":"v1","sourceLODKnown":true},"liveSerial":5,"appliedTickMs":1500,"sourceEpoch":"source","sceneEpoch":"scene"}
	assert(Evidence.qualifying_live_displays([actual],accepted,1000,2000,4).size()==1)
	# Fresh data accepted, but only the old warmup world rendered: starvation.
	assert(Evidence.qualifying_live_displays([{"worldId":"warmup","source":{"sourceLODKnown":true},"liveSerial":4,"appliedTickMs":1500}],accepted,1000,2000,4).is_empty())
	for override in [{"appliedTickMs":2100},{"source":{"sourceLODKnown":false}},{"sceneEpoch":"edited"},{"liveSerial":6},{"worldId":"unaccepted"}]:
		var bad: Dictionary = actual.duplicate(true);bad.merge(override,true)
		assert(Evidence.qualifying_live_displays([bad],accepted,1000,2000,4).is_empty())
	var before := accepted.duplicate(true);before[0].tickMs=900
	assert(Evidence.qualifying_live_displays([actual],before,1000,2000,4).is_empty())
	print("SURFACE_NAVIGATION_EVIDENCE_PROBE_PASS")
	quit()
