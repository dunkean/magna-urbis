class_name SurfaceNavigationEvidence
extends RefCounted

# Acceptance is not rendering. Only a fresh accepted world that was actually
# applied during the input interval can demonstrate live display progress.
static func qualifying_live_displays(displays: Array,accepted: Array,start_tick: int,end_tick: int,initial_serial: int) -> Array:
	var result: Array = []
	for display in displays:
		if not display is Dictionary: continue
		var tick := int(display.get("appliedTickMs",-1))
		var serial := int(display.get("liveSerial",-1))
		var source: Dictionary = display.get("source",{})
		if tick<=start_tick or tick>end_tick or serial<=initial_serial or source.get("sourceLODKnown",false)!=true: continue
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
