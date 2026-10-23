class_name SurfaceHydrology
extends RefCounted
const Geometry = preload("res://adapters/surface_geometry.gd")
const CityMap = preload("res://adapters/surface_city_map.gd")
const MAX_VERTICES := 399996
const MAX_SOURCE_POINTS := 500000
const MAX_SCAN_WORK := 12000000

# Fixed-map water comes from Magna's retained polygons and measured levels.
# This is a display adapter: no routing, flow threshold, channel generation,
# river widening, source-level edits or bed carving occur here.
static func _geometry(source: Dictionary):
	if source.get("geometry") is Dictionary: return source.geometry
	var archive=source.get("$surfaceSourceArchive",{})
	if not archive is Dictionary or archive.get("format")!="surface-source-archive-1": return null
	for item in archive.get("attachments",[]):
		if item is Dictionary and item.get("path")==["geometry"] and item.get("encoding")=="json-utf8" and item.get("bytes") is PackedByteArray:
			if item.bytes.size()>64*1024*1024: return null
			var value=JSON.parse_string(item.bytes.get_string_from_utf8())
			return value if value is Dictionary else null
	return null

# Only restore the explicitly addressed recipe string. Native metadata remains
# archived; a long query must not hide cavern class-2 ambiguity.
static func _source_query(source: Dictionary) -> String:
	var meta=source.get("meta",{})
	if meta is Dictionary and meta.get("query") is String: return meta.query
	var archive=source.get("$surfaceSourceArchive",{})
	if not archive is Dictionary or archive.get("format")!="surface-source-archive-1": return ""
	for item in archive.get("attachments",[]):
		if item is Dictionary and item.get("path")==["meta","query"] and item.get("encoding")=="json-utf8" and item.get("bytes") is PackedByteArray and item.bytes.size()<=1024*1024:
			var query=JSON.parse_string(item.bytes.get_string_from_utf8())
			return query if query is String else ""
	return ""

static func _is_cavern(source: Dictionary) -> bool:
	var meta=source.get("meta",{})
	if meta is Dictionary and meta.get("tags") is Dictionary and meta.tags.get("relief")=="cavern": return true
	for pair in _source_query(source).trim_prefix("?").split("&"):
		var parts: PackedStringArray=pair.split("=",true,1)
		if parts.size()==2 and parts[0].uri_decode()=="relief" and parts[1].uri_decode()=="cavern": return true
	return false

static func _sequence(value) -> bool:
	return typeof(value) in [TYPE_ARRAY,TYPE_PACKED_BYTE_ARRAY,TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_FLOAT32_ARRAY,TYPE_PACKED_FLOAT64_ARRAY]

static func _finite(value) -> bool:
	return (value is float or value is int) and is_finite(float(value))

# Double-precision Sutherland-Hodgman clipping, before GPU float conversion.
static func _clip(ring: Array, bounds: Dictionary) -> Array:
	var output=ring
	for edge in 4:
		var input: Array=output; output=[]
		if input.size()<3: return []
		var axis: String="x" if edge<2 else "y"
		var limit: float=bounds.minX if edge==0 else bounds.maxX if edge==1 else bounds.minZ if edge==2 else bounds.maxZ
		var lower: bool=edge==0 or edge==2
		var previous: Dictionary=input[-1]
		var pin: bool=float(previous[axis])>=limit if lower else float(previous[axis])<=limit
		for current in input:
			var inside: bool=float(current[axis])>=limit if lower else float(current[axis])<=limit
			if inside!=pin:
				var t: float=(limit-float(previous[axis]))/(float(current[axis])-float(previous[axis]))
				output.append({"x":float(previous.x)+(float(current.x)-float(previous.x))*t,"y":float(previous.y)+(float(current.y)-float(previous.y))*t})
			if inside: output.append(current)
			previous=current; pin=inside
	return output

# Normalized interpolation uses only finite measured WET source cells. Dry-cell
# bed sentinels are never promoted to water. A small source-cell neighbourhood
# supports vector banks between the raster sample centres; absent data stays absent.
static func _level(water: Dictionary, x: float, z: float) -> float:
	var n: int=water.n; var spacing: float=float(water.width)/n
	var gx: float=(x-float(water.originX))/spacing; var gz: float=(z-float(water.originZ))/spacing
	if gx< -0.5 or gz< -0.5 or gx>n-0.5 or gz>n-0.5: return NAN
	var ix: int=int(floor(gx)); var iz: int=int(floor(gz)); var total:=0.0; var weight:=0.0
	for dz in 2:
		for dx in 2:
			var xx: int=clampi(ix+dx,0,n-1); var zz: int=clampi(iz+dz,0,n-1); var i: int=zz*n+xx
			if int(water.classes[i])<2 or not _finite(water.levelM[i]): continue
			var w: float=(1.0-absf(gx-(ix+dx)))*(1.0-absf(gz-(iz+dz)))
			if w>0.0: total+=float(water.levelM[i])*w; weight+=w
	if weight>0.0: return total/weight
	var best:=INF; var level:=NAN
	for zz in range(maxi(0,iz-2),mini(n,iz+4)):
		for xx in range(maxi(0,ix-2),mini(n,ix+4)):
			var i: int=zz*n+xx
			if int(water.classes[i])<2 or not _finite(water.levelM[i]): continue
			var distance: float=pow(gx-xx,2.0)+pow(gz-zz,2.0)
			if distance<best and distance<=6.25: best=distance; level=float(water.levelM[i])
	return level

static func _fallback(value: Dictionary, reason: String) -> Dictionary:
	var result:=value.duplicate(false)
	result.fixedHydrologyFallbackReason=reason
	result.authority="magna-retained-physical-raster"
	return result

static func prepare(packet: Dictionary, world: Dictionary, origin: Dictionary, focus: Dictionary, width: float, fallback: Dictionary) -> Dictionary:
	var started:=Time.get_ticks_usec()
	var source=packet.get("source",{})
	if not source is Dictionary: return _fallback(fallback,"source record is not a dictionary")
	var geometry=_geometry(source)
	var water=source.get("water",{}) if source is Dictionary else {}
	# Legacy cavern class 2 also denotes non-water voids. Its ambiguous raster
	# cannot supply measured lake levels; retain the explicit contextual fallback.
	if _is_cavern(source): return _fallback(fallback,"cavern class 2 is ambiguous; retained physical contextual water only")
	if not geometry is Dictionary or not geometry.get("water") is Array or geometry.water.is_empty(): return _fallback(fallback,"retained source vector water geometry unavailable")
	if not water is Dictionary or not _finite(water.get("n")) or floorf(float(water.n))!=float(water.n) or not _finite(water.get("width")) or float(water.width)<=0.0: return _fallback(fallback,"invalid retained water grid shape")
	var n:=int(water.n)
	if n<2 or n>4096 or not _sequence(water.get("classes")) or water.classes.size()!=n*n or not _sequence(water.get("levelM")) or water.levelM.size()!=n*n: return _fallback(fallback,"missing or mis-sized retained water columns")
	for value in water.classes:
		if not _finite(value) or floorf(float(value))!=float(value) or float(value)<0.0 or float(value)>3.0: return _fallback(fallback,"invalid retained Magna water class")
	if not _finite(water.get("originX")) or not _finite(water.get("originZ")): return _fallback(fallback,"invalid retained first-sample water origin")
	var window:=Geometry._window(focus,width)
	if window.is_empty(): return _fallback(fallback,"invalid display window")
	# A cropped export still retains full source contours. Clip to the measured
	# source support before triangulation, rather than dropping entire triangles
	# whose remote vertex lies outside the retained level raster.
	var spacing := float(water.width)/n
	window.minX=maxf(float(window.minX),float(water.originX)-spacing*0.5)
	window.minZ=maxf(float(window.minZ),float(water.originZ)-spacing*0.5)
	window.maxX=minf(float(window.maxX),float(water.originX)+(n-0.5)*spacing)
	window.maxZ=minf(float(window.maxZ),float(water.originZ)+(n-0.5)*spacing)
	if float(window.minX)>=float(window.maxX) or float(window.minZ)>=float(window.maxZ): return _fallback(fallback,"display window is outside retained source levels")
	# Source vectors stay local to the retained decor; only its common scene
	# translation applies. The terrain-only sampling offset is intentionally absent.
	var translation: Dictionary=source.get("sourceToWorldTranslation",{})
	var tx:=float(translation.get("x",0.0)); var tz:=float(translation.get("z",0.0))
	var vertices:=PackedVector3Array(); var missing:=0; var points:=0; var area:=0.0; var work:=0
	var missing_area:=0.0; var requested_area:=0.0; var duplicate_groups:=0; var display_groups:=0; var seen_groups: Dictionary={}
	for group in geometry.water:
		if not group is Array: return _fallback(fallback,"invalid source water group")
		for ring in group:
			if not ring is Array: return _fallback(fallback,"invalid source water ring")
			points+=ring.size()
			if points>MAX_SOURCE_POINTS: return _fallback(fallback,"source vector point budget exceeded")
		# Real retained captures may contain duplicate lake groups. Deduplicate
		# display only, with exact equality after hash lookup (never fuzzy union).
		var key:=hash(group); var identical:=false
		for previous in seen_groups.get(key,[]):
			if previous==group: identical=true; break
		if identical: duplicate_groups+=1; continue
		if not seen_groups.has(key): seen_groups[key]=[]
		seen_groups[key].append(group)
		var rings: Array=[]
		for ring in group:
			var translated: Array=[]
			for point in ring:
				if not point is Dictionary or not _finite(point.get("x")) or not _finite(point.get("y")): return fallback
				translated.append({"x":float(point.x)+tx,"y":float(point.y)+tz})
			var clipped:=_clip(translated,window)
			if clipped.size()>=3: rings.append(clipped)
		if rings.is_empty(): continue
		var scan_levels: Dictionary={}; var edges:=0
		for ring in rings:
			edges+=ring.size()
			for point in ring: scan_levels[point.y]=true
		work+=edges*scan_levels.size()
		if work>MAX_SCAN_WORK: return _fallback(fallback,"source vector scan work budget exceeded")
		var mesh:=CityMap.triangulate([{"outer":rings[0],"holes":rings.slice(1)}],origin,float(origin.y),MAX_VERTICES-vertices.size())
		if mesh.invalid or mesh.budgetLimited: return _fallback(fallback,"source vector triangulation invalid or over budget")
		requested_area+=float(mesh.areaM2)
		var before_group:=vertices.size()
		var triangles: PackedVector3Array=mesh.vertices
		for at in range(0,triangles.size(),3):
			var triangle:=PackedVector3Array(); var valid:=true
			for i in 3:
				var p: Vector3=triangles[at+i]
				var level:=_level(water,float(origin.x)+p.x,float(origin.z)+p.z)
				if not is_finite(level): valid=false; break
				p.y=level-float(origin.y); triangle.append(p)
			if valid:
				vertices.append_array(triangle)
				area+=absf((triangle[1]-triangle[0]).cross(triangle[2]-triangle[0]).y)*0.5
			else:
				missing+=1
				missing_area+=absf((triangles[at+1]-triangles[at]).cross(triangles[at+2]-triangles[at]).y)*0.5
		if vertices.size()>before_group: display_groups+=1
	# Sea remains the exact original sea-cell union. Lakes/rivers are drawn from
	# the native polygons, avoiding the conservative safety-envelope raster width.
	var sea_classes:=PackedByteArray(); sea_classes.resize(n*n)
	for i in sea_classes.size(): sea_classes[i]=3 if int(water.classes[i])==1 else 0
	var grid: Dictionary={"width":n,"height":n,"originX":water.originX,"originZ":water.originZ,"spacingM":float(water.width)/n}
	var sea_world:=world.duplicate(false)
	sea_world.canonicalContext={"grid":grid,"fields":{"waterClass":sea_classes,"waterLevelM":water.levelM}}
	var sea:=Geometry.build_water(sea_world,origin,focus,width)
	# A budget-aggregated sea needs its separate coverage material. Until this
	# adapter has multiple water batches, keep the already safe complete fallback.
	if sea.get("requiresCoverageMask",false) or vertices.size()+sea.vertices.size()>MAX_VERTICES: return _fallback(fallback,"exact sea and vector batches exceed the shared geometry budget")
	vertices.append_array(sea.vertices)
	var result:=fallback.duplicate(false)
	result.erase("coverageImage"); result.erase("coverageOrigin"); result.erase("coverageSpacingM"); result.erase("coverageSize")
	result.vertices=vertices; result.quads=int(ceil(vertices.size()/6.0)); result.sourceStride=1
	result.representation="Magna retained vector lakes/rivers and original sea-cell union"
	result.authority="magna-urbis-fixed-hydrology"; result.sourceVectorAreaM2=area
	result.missingLevelTriangles=missing; result.sourceVectorPoints=points
	result.sourceVectorRequestedAreaM2=requested_area; result.sourceVectorMissingAreaM2=missing_area; result.sourceVectorCoverageComplete=missing==0
	result.sourceGroups=geometry.water.size(); result.sourceDuplicateGroups=duplicate_groups; result.displayGroups=display_groups
	result.sourceVectorClipBounds={"minX":window.minX,"minZ":window.minZ,"maxX":window.maxX,"maxZ":window.maxZ}; result.sourceVectorScanWork=work
	result.levelInterpolation="finite original wet source levels only; no channel generation or level editing"
	result.buildMs=(Time.get_ticks_usec()-started)/1000.0
	return result
