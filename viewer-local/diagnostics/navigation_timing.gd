class_name SurfaceNavigationTiming
extends RefCounted

# The nominal interval remains the qualification window. The actual interval
# measures how long the loop really held input, including its final blocked frame.
static func summarize(start_tick: int,duration: float,actual_end_tick: int,samples: Array,applications: Array) -> Dictionary:
	var nominal_end := start_tick+roundi(duration*1000.0)
	if not is_finite(duration) or duration<=0.0 or actual_end_tick<nominal_end or samples.is_empty(): return {"error":"invalid navigation timing"}
	var elapsed := (actual_end_tick-start_tick)/1000.0
	var previous := 0.0;var maximum := 0.0
	var maximum_interval := {"fromElapsedSeconds":0.0,"toElapsedSeconds":0.0,"gapSeconds":0.0,"terminal":false}
	for sample in samples:
		if not sample is Dictionary or not (sample.get("elapsedSeconds") is float or sample.get("elapsedSeconds") is int): return {"error":"invalid input sample"}
		var at := float(sample.elapsedSeconds)
		if not is_finite(at) or at<previous or at>duration: return {"error":"input sample outside nominal interval"}
		var gap := at-previous
		if gap>maximum:
			maximum=gap;maximum_interval={"fromElapsedSeconds":previous,"toElapsedSeconds":at,"gapSeconds":gap,"terminal":false}
		previous=at
	var terminal := elapsed-previous
	if terminal>maximum:
		maximum=terminal;maximum_interval={"fromElapsedSeconds":previous,"toElapsedSeconds":elapsed,"gapSeconds":terminal,"terminal":true}
	var last_apply := 0.0;var application_gap := 0.0
	for application in applications:
		var at := float(application.get("elapsedSeconds",NAN))
		if not is_finite(at) or at<last_apply or at>duration:return {"error":"invalid observed application sample"}
		application_gap=maxf(application_gap,at-last_apply);last_apply=at
	application_gap=maxf(application_gap,elapsed-last_apply)
	return {"timingVersion":"navigation-timing-1","motionStartTickMs":start_tick,"motionEndTickMs":nominal_end,"actualMotionEndTickMs":actual_end_tick,
		"motionActualWallSeconds":elapsed,"maximumInputGapSeconds":maximum,"maximumInputGapInterval":maximum_interval,
		"lastInputElapsedSeconds":previous,"terminalInputGapSeconds":terminal,"longestMotionApplicationGapSeconds":application_gap}

static func acceptance_counts(accepted: Array,start_tick: int,nominal_end_tick: int,actual_end_tick: int) -> Dictionary:
	var nominal := 0;var actual := 0
	for event in accepted:
		var tick := int(event.get("tickMs",-1))
		if tick>start_tick and tick<=nominal_end_tick:nominal+=1
		if tick>start_tick and tick<=actual_end_tick:actual+=1
	return {"motionLiveAcceptedCount":nominal,"motionActualLiveAcceptedCount":actual,"motionLiveApplicationCount":nominal}
