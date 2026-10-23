extends SceneTree
const Evidence = preload("res://diagnostics/navigation_evidence.gd")
func _initialize() -> void:
	var request := {"x":0.0,"y":0.0,"extent":64.0,"preview":true,"resolution":128}
	var accepted := [{"requestSerial":5,"tickMs":1200,"worldId":"new-live","request":request,"sourceEpoch":"source","sceneEpoch":"scene"}]
	var source := {"id":"registered","version":"v1","sourceLODKnown":true,"sourceLOD":-6,"nativeSpacingM":0.46875}
	var actual := {"worldId":"new-live","request":request,"source":source,"tileSource":source.duplicate(),"sourceActualAtFocus":source.duplicate(),"fineContributionWeight":1.0,
		"sourceContributionsAtFocus":[{"source":source.duplicate(),"activeChild":true,"weight":1.0}],"focusInsideSource":true,"liveSerial":5,"appliedTickMs":1500,"sourceEpoch":"source","sceneEpoch":"scene"}
	assert(Evidence.qualifying_live_displays([actual],accepted,1000,2000,4,"warmup").size()==1)
	assert(Evidence.qualifying_live_displays([actual],accepted,1000,2000,4,"new-live").is_empty())
	# Fresh data accepted, but only the old warmup world rendered: starvation.
	assert(Evidence.qualifying_live_displays([{"worldId":"warmup","source":{"sourceLODKnown":true},"liveSerial":4,"appliedTickMs":1500}],accepted,1000,2000,4,"warmup").is_empty())
	for override in [{"appliedTickMs":2100},{"source":{"sourceLODKnown":false}},{"focusInsideSource":false},{"fineContributionWeight":0.5},{"sceneEpoch":"edited"},{"liveSerial":6},{"worldId":"unaccepted"},{"request":{"preview":false,"resolution":512}}]:
		var bad: Dictionary = actual.duplicate(true);bad.merge(override,true)
		assert(Evidence.qualifying_live_displays([bad],accepted,1000,2000,4,"warmup").is_empty())
	var before := accepted.duplicate(true);before[0].tickMs=900
	assert(Evidence.qualifying_live_displays([actual],before,1000,2000,4,"warmup").is_empty())
	var settled := actual.duplicate(true);settled.request.preview=false;settled.request.resolution=512
	assert(Evidence.final_quality(settled))
	assert(not Evidence.final_quality(actual))
	print("SURFACE_NAVIGATION_EVIDENCE_PROBE_PASS")
	quit()
