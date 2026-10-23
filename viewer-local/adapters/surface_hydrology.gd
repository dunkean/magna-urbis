class_name SurfaceHydrology
extends RefCounted
const Geometry = preload("res://adapters/surface_geometry.gd")
const Sweep = preload("res://adapters/surface_hydrology_sweep.gd")
const Contours=preload("res://adapters/surface_water_contours.gd")
# Exact regional vectors can exceed the historical raster-quad cap. This bound
# is still <12 MiB of packed positions; it never changes source water footprints.
const MAX_VERTICES := 999996
const MAX_SOURCE_POINTS := 500000
const MAX_SCAN_WORK := 12000000
const MAX_BED_DIAGNOSTIC_SAMPLES := 4096

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

# Sweep vertices are FP32 relative coordinates, after float64 source clipping.
# Recover only a boundary query displaced by <= half an FP32 ULP. This does
# not move the mesh, widen the wet search or replace absent interior levels.
static func _half_float32_ulp(value:float)->float:
	return pow(2.0,-150.0) if absf(value)<1.17549435082229e-38 else pow(2.0,floorf(log(absf(value))/log(2.0))-24.0)
static func _level_at_clipped_vertex(water:Dictionary,origin:Dictionary,p:Vector3)->float:
	var x=float(origin.x)+p.x;var z=float(origin.z)+p.z;var spacing=float(water.width)/int(water.n)
	var low_x=float(water.originX)-spacing*.5;var low_z=float(water.originZ)-spacing*.5;var high_x=low_x+float(water.width);var high_z=low_z+float(water.width)
	if x>=low_x and x<=high_x and z>=low_z and z<=high_z:return NAN
	var eps_x=_half_float32_ulp(p.x)+absf(float(origin.x))*2.220446049250313e-16
	var eps_z=_half_float32_ulp(p.z)+absf(float(origin.z))*2.220446049250313e-16
	if x<low_x-eps_x or x>high_x+eps_x or z<low_z-eps_z or z>high_z+eps_z:return NAN
	return _level(water,clampf(x,low_x,high_x),clampf(z,low_z,high_z))

static func _fallback(value: Dictionary, reason: String) -> Dictionary:
	var result:=value.duplicate(false)
	result.fixedHydrologyFallbackReason=reason
	result.authority="magna-retained-physical-raster"
	result.fixedVectorDisplayAvailable=false
	return result

# Visibility diagnostics are distinct from physical raster validation. A retained
# vector may have complete measured levels while lying below the current display
# terrain. Never fix that by raising water or rewriting its source contours.
# This bounded, deterministic sample is NOT an exact count of clipped fragments.
static func vector_bed_diagnostics(vertices: PackedVector3Array, world: Dictionary, origin: Dictionary) -> Dictionary:
	var result: Dictionary={"vectorBedDiagnosticSamples":0,"vectorBedDiagnosticConflicts":0,"vectorBedDiagnosticMissing":0,"vectorBedDiagnosticMaximumDeltaM":0.0,"vectorBedDiagnosticBudget":MAX_BED_DIAGNOSTIC_SAMPLES,"vectorBedDiagnosticToleranceM":0.001}
	if vertices.is_empty(): return result
	var display: Dictionary=world.get("_displaySource",world).duplicate(false)
	if not display.has("_heightLayers"): display["_heightLayers"]=Geometry.prepare_height_layers(display)
	var stride:=maxi(1,ceili(float(vertices.size())/MAX_BED_DIAGNOSTIC_SAMPLES))
	for i in range(0,vertices.size(),stride):
		var point: Vector3=vertices[i]
		var bed:=Geometry.height_at(display,float(origin.x)+point.x,float(origin.z)+point.z)
		if not is_finite(bed): result.vectorBedDiagnosticMissing+=1; continue
		var delta:=bed-(float(origin.y)+point.y)
		result.vectorBedDiagnosticSamples+=1
		result.vectorBedDiagnosticMaximumDeltaM=maxf(float(result.vectorBedDiagnosticMaximumDeltaM),delta)
		if delta>=-0.001: result.vectorBedDiagnosticConflicts+=1
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
	var boundary_level_queries_resolved:=0;var maximum_boundary_query_roundoff:=0.0
	var missing_area:=0.0; var requested_area:=0.0; var duplicate_groups:=0; var display_groups:=0; var seen_groups: Dictionary={}
	var native_groups:=0;var sweep_groups:=0;var maximum_float_error:=0.0;var maximum_float_tolerance:=0.0
	var source_contours:Array=[];var contour_points=0;var contour_rings=0;var contour_limited=false
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
				if not point is Dictionary or not _finite(point.get("x")) or not _finite(point.get("y")): return _fallback(fallback,"invalid retained vector water point")
				translated.append({"x":float(point.x)+tx,"y":float(point.y)+tz})
			var clipped:=_clip(translated,window)
			if clipped.size()>=3:
				rings.append(clipped)
				contour_points+=clipped.size();contour_rings+=1
				if contour_points>Contours.MAX_POINTS or contour_rings>Contours.MAX_RINGS:
					contour_limited=true;source_contours.clear()
				if not contour_limited:
					var coordinates=PackedFloat64Array();coordinates.resize(clipped.size()*2)
					for i in clipped.size():coordinates[i*2]=float(clipped[i].x);coordinates[i*2+1]=float(clipped[i].y)
					source_contours.append(coordinates)
		if rings.is_empty(): continue
		var mesh:=Sweep.triangulate(rings,origin,MAX_VERTICES-vertices.size(),MAX_SCAN_WORK-work)
		work+=int(mesh.get("work",0))
		if mesh.get("workBudgetLimited",false):return _fallback(fallback,"source vector active-edge scan work budget exceeded")
		if mesh.invalid:return _fallback(fallback,"source vector triangulation parity invalid after work="+str(work))
		if mesh.budgetLimited:return _fallback(fallback,"source vector vertex budget exceeded: output="+str(vertices.size())+", required next="+str(mesh.get("requiredVerticesAtLeast",0)))
		if mesh.get("nativeSimpleRing",false):
			native_groups+=1
			maximum_float_error=maxf(maximum_float_error,float(mesh.get("floatAreaErrorM2",0.0)))
			maximum_float_tolerance=maxf(maximum_float_tolerance,float(mesh.get("floatAreaToleranceM2",0.0)))
		else:sweep_groups+=1
		requested_area+=float(mesh.areaM2)
		var before_group:=vertices.size()
		var triangles: PackedVector3Array=mesh.vertices
		for at in range(0,triangles.size(),3):
			var triangle:=PackedVector3Array(); var valid:=true
			for i in 3:
				var p: Vector3=triangles[at+i]
				var level:=_level(water,float(origin.x)+p.x,float(origin.z)+p.z)
				if not is_finite(level):
					level=_level_at_clipped_vertex(water,origin,p)
					if is_finite(level):
						boundary_level_queries_resolved+=1
						var x=float(origin.x)+p.x;var z=float(origin.z)+p.z
						maximum_boundary_query_roundoff=maxf(maximum_boundary_query_roundoff,maxf(absf(x-clampf(x,float(window.minX),float(window.maxX))),absf(z-clampf(z,float(window.minZ),float(window.maxZ)))))
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
	var bed_diagnostics:=vector_bed_diagnostics(vertices,world,origin)
	vertices.append_array(sea.vertices)
	var result:=fallback.duplicate(false)
	result.erase("coverageImage"); result.erase("coverageOrigin"); result.erase("coverageSpacingM"); result.erase("coverageSize")
	result.vertices=vertices; result.quads=int(ceil(vertices.size()/6.0)); result.sourceStride=1
	result.sourceWaterContours=source_contours;result.sourceContourVersion=Contours.VERSION
	result.sourceContourPointCount=contour_points;result.sourceContourRingCount=contour_rings
	result.sourceContourComplete=not contour_limited;result.sourceContourBudgetLimited=contour_limited
	result.sourceContourSha256="" if contour_limited else Contours.digest(source_contours)
	result.sourceContourPrecision="float64-world-xz; subtract in double before renderer vectors"
	result.sourceContourScope="clipped retained lake/river polygon and hole boundaries; clip edges denote the data window, not surveyed banks"
	result.sourceSeaSymbolPolicy="original sea-cell union fill unchanged; no invented sea contours"
	result.representation="Magna retained vector lakes/rivers and original sea-cell union"
	result.authority="magna-urbis-fixed-hydrology"; result.sourceVectorAreaM2=area
	result.fixedVectorDisplayAvailable=true
	result.fixedVectorCartographicPolicy="project retained contours independently of terrain depth; keep measured source levels unchanged"
	result.fixedVectorPhysicalPolicy="measured source levels with display-bed occlusion; conflicts are not repaired or rerouted"
	result.resolvedBedConflictScope="physical raster only; vector visibility uses bounded vectorBedDiagnostic samples"
	for diagnostic in bed_diagnostics: result[diagnostic]=bed_diagnostics[diagnostic]
	var source_classes:=PackedFloat32Array(); source_classes.resize(n*n)
	for i in source_classes.size():
		var kind:=int(water.classes[i]); source_classes[i]=3.0 if kind==1 else 1.0 if kind==3 else float(kind)
	result.classImage=Image.create_from_data(n,n,false,Image.FORMAT_RF,source_classes.to_byte_array())
	result.classOrigin={"x":float(water.originX),"z":float(water.originZ)}
	result.classSpacingM=spacing; result.classSize=Vector2i(n,n)
	result.sourceLevelBoundaryQueriesResolved=boundary_level_queries_resolved;result.sourceLevelMaximumBoundaryQueryRoundoffM=maximum_boundary_query_roundoff
	result.sourceLevelBoundaryPolicy="Only queries of float64-clipped vertices displaced outside source support by <= half an FP32 relative-coordinate ULP are clamped; source levels and mesh vertices stay unchanged"
	result.missingLevelTriangles=missing; result.sourceVectorPoints=points
	result.sourceVectorRequestedAreaM2=requested_area; result.sourceVectorMissingAreaM2=missing_area; result.sourceVectorCoverageComplete=missing==0
	result.sourceGroups=geometry.water.size(); result.sourceDuplicateGroups=duplicate_groups; result.displayGroups=display_groups
	result.sourceSimpleRingNativeGroups=native_groups;result.sourceEvenOddSweepGroups=sweep_groups
	result.maximumNativeFloatAreaErrorM2=maximum_float_error;result.maximumNativeFloatAreaToleranceM2=maximum_float_tolerance
	result.vertexBudget=MAX_VERTICES
	result.renderAlgorithm="retained even-odd boundary-vertex scan bands; native ear clipping only for one contour with explicit float-area validation"
	result.sourceTopologyPolicy="source contours unchanged; no self-intersection repair or survey-level topology equivalence claimed"
	result.sourceVectorClipBounds={"minX":window.minX,"minZ":window.minZ,"maxX":window.maxX,"maxZ":window.maxZ}; result.sourceVectorScanWork=work
	result.levelInterpolation="finite original wet source levels only; no channel generation or level editing"
	result.buildMs=(Time.get_ticks_usec()-started)/1000.0
	return result
