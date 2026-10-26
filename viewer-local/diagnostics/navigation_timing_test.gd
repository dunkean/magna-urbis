extends SceneTree
const Timing=preload("res://diagnostics/navigation_timing.gd")
const Evidence=preload("res://diagnostics/navigation_evidence.gd")

func _initialize()->void:
	var samples=[{"elapsedSeconds":0.0},{"elapsedSeconds":4.511},{"elapsedSeconds":15.060},{"elapsedSeconds":18.091}]
	var applications=[{"elapsedSeconds":1.236},{"elapsedSeconds":15.869}]
	var timing=Timing.summarize(105262,20.0,132277,samples,applications)
	assert(not timing.has("error"))
	assert(timing.motionEndTickMs==125262 and timing.actualMotionEndTickMs==132277)
	assert(is_equal_approx(timing.motionActualWallSeconds,27.015))
	assert(is_equal_approx(timing.maximumInputGapSeconds,10.549))
	assert(is_equal_approx(timing.terminalInputGapSeconds,8.924))
	assert(is_equal_approx(timing.longestMotionApplicationGapSeconds,14.633))
	assert(not timing.maximumInputGapInterval.terminal)
	var dense=[]
	for i in 199:dense.append({"elapsedSeconds":i/10.0})
	var tail=Timing.summarize(105262,20.0,132277,dense,applications)
	assert(tail.maximumInputGapInterval.terminal)
	assert(is_equal_approx(tail.maximumInputGapSeconds,7.215))
	assert(Timing.summarize(105262,20.0,125261,samples,applications).has("error"))
	assert(Timing.summarize(105262,20.0,132277,[{"elapsedSeconds":2.0},{"elapsedSeconds":1.0}],applications).has("error"))
	var accepted=[{"tickMs":80086},{"tickMs":121222},{"tickMs":132206},{"tickMs":134792}]
	var counts=Timing.acceptance_counts(accepted,105262,125262,132277)
	assert(counts.motionLiveAcceptedCount==1 and counts.motionActualLiveAcceptedCount==2 and counts.motionLiveApplicationCount==1)
	# A source actually displayed only after nominal20s cannot qualify, even
	# though an honest timing report records that the loop was blocked until27s.
	var source={"id":"retained","version":"v1","sourceLODKnown":true,"sourceLOD":-6,"nativeSpacingM":0.46875}
	var request={"x":0.0,"y":0.0,"extent":64.0,"preview":true,"resolution":128}
	var display={"worldId":"new","liveSerial":37,"appliedTickMs":127262,"source":source,"tileSource":source,"sourceActualAtFocus":source,
		"focusInsideSource":true,"fineContributionWeight":1.0,"sourceContributionsAtFocus":[{"source":source,"activeChild":true,"weight":1.0}],
		"sourceEpoch":"source","sceneEpoch":"scene","request":request}
	var ledger=[{"worldId":"new","requestSerial":37,"tickMs":121222,"sourceEpoch":"source","sceneEpoch":"scene","request":request}]
	assert(Evidence.qualifying_live_displays([display],ledger,105262,125262,0,"warmup").is_empty())
	assert(Evidence.qualifying_live_displays([display],ledger,105262,132277,0,"warmup").size()==1)
	print(JSON.stringify({"status":"PASS","scope":"Authored CPU timing fixtures; no native rendering/navigation performance claim","terminalGapSeconds":timing.terminalInputGapSeconds,"maximumGapSeconds":timing.maximumInputGapSeconds,"motionEndTickMs":timing.motionEndTickMs,"actualMotionEndTickMs":timing.actualMotionEndTickMs,"nominalAccepted":counts.motionLiveAcceptedCount,"actualAccepted":counts.motionActualLiveAcceptedCount}))
	quit()
