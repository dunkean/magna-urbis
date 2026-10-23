class_name SurfaceCanopy
extends RefCounted

# canopy-r1: exact provided crown discs, no procedural noise. RGB is LINEAR.
const LINEAR_ALBEDO := Color(0.055,0.105,0.036,1.0)
const RADII := [2.5,4.0,5.5,7.0]
const HALO_M := 16.0
const RESOLUTION := 1024
static var _cached_packet: Dictionary = {}
static var _cached_selection: Dictionary = {}
static var _cached_atlas: Dictionary = {}
static var _cached_unsupported: Dictionary = {}

static func radius_class(radius: float) -> int:
	var best := 0
	for i in range(1,4):
		if absf(radius-float(RADII[i]))<absf(radius-float(RADII[best])): best=i
	return best

static func can_select(x: float,z: float,radius: float,bounds: Dictionary) -> bool:
	return minf(minf(x-float(bounds.minX),float(bounds.maxX)-x),minf(z-float(bounds.minZ),float(bounds.maxZ)-z))>=HALO_M+radius

static func instance_weight(bin: int,footprint: float) -> float:
	return smoothstep(1.25,3.0,2.0*float(RADII[bin])/maxf(footprint,0.00001))

# Called on the population preparation worker; GPU texture creation stays on UI.
static func prepare(packet: Dictionary,selected: Dictionary) -> Dictionary:
	# Packets are immutable snapshots. A sequential preparation worker may reuse
	# the exact atlas while panning if neither packet identity nor selected ids changed.
	var unsupported: Dictionary = packet.get("_unsupportedTreeIDs",{})
	if is_same(packet,_cached_packet) and selected==_cached_selection and unsupported==_cached_unsupported: return _cached_atlas
	var bounds: Dictionary = packet.get("candidateBounds",{})
	if bounds.is_empty(): return {"available":false,"reason":"No declared candidate query bounds"}
	var extent := maxf(float(bounds.maxX)-float(bounds.minX),float(bounds.maxZ)-float(bounds.minZ))
	if extent<=0.0: return {"available":false,"reason":"Empty candidate query bounds"}
	var spacing := extent/float(RESOLUTION)
	var width := maxi(2,ceili((float(bounds.maxX)-float(bounds.minX))/spacing))
	var height := maxi(2,ceili((float(bounds.maxZ)-float(bounds.minZ))/spacing))
	var coverage := PackedFloat32Array(); coverage.resize(width*height)
	var counts := PackedFloat32Array(); counts.resize(width*height*4)
	# Keep absolute regional coordinates in scalar doubles. Vector2 is FP32;
	# the UI creates a Vector2 only after subtracting its render origin.
	var origin := {"x":float(bounds.minX)+spacing/2.0,"z":float(bounds.minZ)+spacing/2.0}
	var candidates: Array = packet.get("candidates",packet.get("populations",[]))
	var columns: Dictionary = packet.get("candidateColumns",{})
	var count := int(columns.count) if not columns.is_empty() else candidates.size()
	var trees := 0; var selected_trees := 0;var unsupported_trees := 0
	for i in range(count):
		var family: String = str(columns.families[int(columns.family[i])]) if not columns.is_empty() else str(candidates[i].family)
		if family!="tree": continue
		var x: float = float(columns.positions[i*3]) if not columns.is_empty() else float(candidates[i].x)
		var z: float = float(columns.positions[i*3+2]) if not columns.is_empty() else float(candidates[i].z)
		var radius: float = float(columns.crownRadiusM[i]) if not columns.is_empty() else float(candidates[i].get("crownRadiusM",float(candidates[i].size)*0.42))
		if not is_finite(radius) or radius<=0.0: continue
		var id: String = str(columns.ids[i]) if not columns.is_empty() else str(candidates[i].stableId)
		if unsupported.has(id):
			unsupported_trees+=1
			continue
		var is_selected := selected.has(id) and can_select(x,z,radius,bounds)
		var bin := radius_class(radius)
		trees+=1
		if is_selected: selected_trees+=1
		for iz in range(maxi(0,ceili((z-radius-float(origin.z))/spacing)),mini(height-1,floori((z+radius-float(origin.z))/spacing))+1):
			var dz := float(origin.z)+float(iz)*spacing-z
			var half := sqrt(maxf(0.0,radius*radius-dz*dz))
			for ix in range(maxi(0,ceili((x-half-float(origin.x))/spacing)),mini(width-1,floori((x+half-float(origin.x))/spacing))+1):
				var index := iz*width+ix
				coverage[index]=1.0
				if is_selected: counts[index*4+bin]+=1.0
	var coverage_image := Image.create_from_data(width,height,false,Image.FORMAT_RF,coverage.to_byte_array())
	coverage_image.generate_mipmaps() # Linear coverage, not sRGB and not overlap counts.
	var counts_image := Image.create_from_data(width,height,false,Image.FORMAT_RGBAF,counts.to_byte_array())
	var atlas := {"available":true,"version":"canopy-r1","coverageImage":coverage_image,"countsImage":counts_image,
		"origin":origin,"spacingM":spacing,"gridSize":Vector2(width,height),"bounds":bounds,"fallbackBlendM":HALO_M,
		"linearAlbedo":LINEAR_ALBEDO,"treeCount":trees,"selectedTreeCount":selected_trees,"unsupportedTreeCount":unsupported_trees,
		"scope":"Supported visual subset of provided candidate query; analytic mean treeCover outside its C1 halo"}
	_cached_packet=packet
	_cached_selection=selected.duplicate()
	_cached_unsupported=unsupported.duplicate()
	_cached_atlas=atlas
	return atlas
