class_name SurfacePopulation
extends RefCounted
const Canopy = preload("res://adapters/surface_canopy.gd")
const FAMILY_BUDGETS := {"tree":10000,"shrub":2500,"boulder":2000,"grass":1000,"debris":500}

# Pure CPU query. Run on a worker, never sort the full population on the UI thread.
static func prepare(packet: Dictionary, focus: Dictionary, width_m: float, viewport_width: float, oblique: bool, geometry_enabled := true) -> Dictionary:
	var candidates: Array = packet.get("candidates",packet.get("populations",[]))
	var columns: Dictionary = packet.get("candidateColumns",{})
	var count := int(columns.count) if not columns.is_empty() else candidates.size()
	var families := {"tree":[],"shrub":[],"boulder":[],"grass":[],"debris":[]}
	if not geometry_enabled: return {"families":families,"selectedCount":0,"candidateCount":count,"canopy":Canopy.prepare(packet,{}),"familyBudgets":FAMILY_BUDGETS}
	var canopy_bounds: Dictionary = packet.get("candidateBounds",{})
	var unsupported: Dictionary = packet.get("_unsupportedTreeIDs",{})
	var radius := clampf(width_m*(1.5 if oblique else 1.0),40.0,5000.0)
	var query_radius := radius+float(packet.get("_maximumCrownRadiusM",0.0))
	var buckets: Dictionary = packet.get("_candidateBuckets",{})
	var nearby: Array = []
	for z in range(floori((focus.y-query_radius)/128.0),floori((focus.y+query_radius)/128.0)+1):
		for x in range(floori((focus.x-query_radius)/128.0),floori((focus.x+query_radius)/128.0)+1): nearby.append_array(buckets.get(Vector2i(x,z),[]))
	var eligible: Array = []
	for index in nearby:
		var i := int(index)
		var px: float = columns.positions[i*3] if not columns.is_empty() else float(candidates[i].x)
		var pz: float = columns.positions[i*3+2] if not columns.is_empty() else float(candidates[i].z)
		var size: float = columns.size[i] if not columns.is_empty() else float(candidates[i].size)
		var crown_radius: float = columns.crownRadiusM[i] if not columns.is_empty() else float(candidates[i].get("crownRadiusM",size*0.42))
		if not is_finite(crown_radius): crown_radius=size*0.42
		if Vector2(px-focus.x,pz-focus.y).length()>radius+crown_radius: continue
		if maxf(size,2.0*crown_radius)/width_m*viewport_width<1.25: continue
		var candidate: Dictionary = candidates[i] if columns.is_empty() else {"stableId":columns.ids[i],"family":columns.families[int(columns.family[i])],"x":px,"y":columns.positions[i*3+1],"z":pz,"size":size,"orientation":columns.orientation[i],"rank":columns.rank[i],"variant":columns.variant[i],"crownRadiusM":crown_radius}
		if str(candidate.family)=="tree":
			if unsupported.has(str(candidate.stableId)): continue
			if canopy_bounds.is_empty() or not Canopy.can_select(px,pz,crown_radius,canopy_bounds): continue
			candidate=candidate.duplicate()
			candidate["canopyClass"]=Canopy.radius_class(crown_radius)
		if families.has(candidate.family): eligible.append(candidate)
	eligible.sort_custom(func(a,b): return float(a.get("rank",0.0))<float(b.get("rank",0.0)) if float(a.get("rank",0.0))!=float(b.get("rank",0.0)) else str(a.stableId)<str(b.stableId))
	var selected := {}; var selected_count := 0
	for candidate in eligible:
		if families[candidate.family].size()>=int(FAMILY_BUDGETS[candidate.family]): continue
		families[candidate.family].append(candidate); selected_count+=1
		if str(candidate.family)=="tree": selected[str(candidate.stableId)]=true
	return {"families":families,"selectedCount":selected_count,"candidateCount":count,"canopy":Canopy.prepare(packet,selected),"familyBudgets":FAMILY_BUDGETS}
