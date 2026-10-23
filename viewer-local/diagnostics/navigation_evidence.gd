class_name SurfaceNavigationEvidence
extends RefCounted

static func same_source(a: Dictionary,b: Dictionary) -> bool:
	for key in ["id","version","sourceLOD","nativeSpacingM","sourceLODKnown"]:
		if a.get(key)!=b.get(key): return false
	return true

static func dominant_fine_source(display: Dictionary) -> bool:
	var source: Dictionary = display.get("source",{})
	var tile: Dictionary = display.get("tileSource",{})
	var actual: Dictionary = display.get("sourceActualAtFocus",{})
	var weight := float(display.get("fineContributionWeight",0.0))
	if display.get("focusInsideSource",false)!=true or source.get("sourceLODKnown",false)!=true or not is_finite(weight) or weight<=0.5 or weight>1.0: return false
	if not same_source(source,tile) or not same_source(source,actual): return false
	if not is_finite(float(source.get("sourceLOD",NAN))) or not is_finite(float(source.get("nativeSpacingM",NAN))) or float(source.get("nativeSpacingM",0.0))<=0.0: return false
	var contributions: Array = display.get("sourceContributionsAtFocus",[])
	if contributions.is_empty(): return false
	var total := 0.0;var child := 0.0
	for part in contributions:
		if not part is Dictionary or not part.get("source") is Dictionary or typeof(part.get("activeChild"))!=TYPE_BOOL: return false
		var value := float(part.get("weight",NAN))
		if not is_finite(value) or value<0.0 or value>1.0: return false
		total+=value
		if part.activeChild:
			if not same_source(part.source,tile): return false
			child+=value
	return absf(total-1.0)<0.000001 and absf(child-weight)<0.000001

# Acceptance is not rendering. Only a fresh accepted world that was actually
# applied during the input interval can demonstrate live display progress.
static func qualifying_live_displays(displays: Array,accepted: Array,start_tick: int,end_tick: int,initial_serial: int) -> Array:
	var result: Array = []
	for display in displays:
		if not display is Dictionary: continue
		var tick := int(display.get("appliedTickMs",-1))
		var serial := int(display.get("liveSerial",-1))
		var source: Dictionary = display.get("source",{})
		if tick<=start_tick or tick>end_tick or serial<=initial_serial or not dominant_fine_source(display): continue
		if str(source.get("id","")).is_empty() or str(source.get("version","")).is_empty() or str(display.get("sourceEpoch","")).is_empty() or str(display.get("sceneEpoch","")).is_empty(): continue
		if str(display.get("worldId","")).is_empty(): continue
		for event in accepted:
			if not event is Dictionary: continue
			var accepted_tick := int(event.get("tickMs",-1))
			if accepted_tick<=start_tick or accepted_tick>tick: continue
			if int(event.get("requestSerial",-1))!=serial or str(event.get("worldId",""))!=str(display.worldId): continue
			if str(event.get("sourceEpoch",""))!=str(display.get("sourceEpoch","")) or str(event.get("sceneEpoch",""))!=str(display.get("sceneEpoch","")): continue
			result.append(display)
			break
	return result
