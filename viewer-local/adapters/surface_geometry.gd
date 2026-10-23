class_name SurfaceGeometry
extends RefCounted

# CPU-only builders. Vertices use canonical right-handed outward winding;
# SurfaceData.make_mesh performs the single conversion to Godot clockwise faces.
const MAX_VERTICES := 999999
const MAX_WATER_QUADS := 65536
const ROAD_CHUNK_PIECES := 1024

static func _finite(value, fallback := NAN) -> float:
	if value == null or not (value is float or value is int): return fallback
	var number := float(value)
	return number if is_finite(number) else fallback

static func _window(focus: Dictionary, view_width: float) -> Dictionary:
	var x := _finite(focus.get("x"))
	var z := _finite(focus.get("y"))
	if not is_finite(x) or not is_finite(z) or not is_finite(view_width) or view_width <= 0.0: return {}
	var span := pow(2.0, ceil(log(maxf(view_width, 0.001)) / log(2.0)))
	var chunk := span * 0.5
	var cx := floorf(x / chunk) * chunk + chunk * 0.5
	var cz := floorf(z / chunk) * chunk + chunk * 0.5
	var radius := span + chunk * 0.5
	return {"minX":cx-radius,"minZ":cz-radius,"maxX":cx+radius,"maxZ":cz+radius,"span":span,"cx":cx,"cz":cz}

# Caller sets _cityIdentity from the retained urban packet when its mesh or
# materials change. Occupation identity alone cannot identify a changed facade.
static func city_identity(packet: Dictionary) -> String:
	if packet.has("_cityIdentity"): return str(packet._cityIdentity)
	return str(hash(packet.get("urban", {}))) + ":proxies=" + str(packet.get("_showProxies", false))

static func chunk_key(world: Dictionary, focus: Dictionary, view_width: float, kind: String) -> String:
	var window := _window(focus, view_width)
	if window.is_empty(): return "invalid"
	var versions: Dictionary = world.get("versions", {})
	return "%s:%s:%s:%s:%s:%s:%s:%s:%s" % [kind,world.get("id",""),world.get("canonicalContextRef", ""),
		world.get("_cityIdentity", versions.get("occupation", "")),world.get("_showProxies",false),
		window.span,window.cx,window.cz,hash(versions)]

static func _context(world: Dictionary) -> Dictionary:
	return world.get("canonicalContext", {"grid":world.get("terrain",{}),"fields":world.get("fields",{})})

static func _contains(bounds: Dictionary, x: float, z: float) -> bool:
	return x >= float(bounds.get("minX", INF)) and x <= float(bounds.get("maxX", -INF)) and z >= float(bounds.get("minZ", INF)) and z <= float(bounds.get("maxZ", -INF))

static func _sample_height(grid: Dictionary, x: float, z: float) -> float:
	var width := int(grid.get("width",0))
	var height := int(grid.get("height",0))
	var spacing := _finite(grid.get("spacingM"))
	var values = grid.get("heights", [])
	if width < 2 or height < 2 or not is_finite(spacing) or spacing <= 0.0 or values.size() != width*height: return NAN
	var u := clampf((x-float(grid.originX))/spacing,0.0,width-1.0)
	var v := clampf((z-float(grid.originZ))/spacing,0.0,height-1.0)
	var ix := int(floor(u))
	var iz := int(floor(v))
	var jx := mini(ix+1,width-1)
	var jz := mini(iz+1,height-1)
	var a := _finite(values[iz*width+ix])
	var b := _finite(values[iz*width+jx])
	var c := _finite(values[jz*width+ix])
	var d := _finite(values[jz*width+jx])
	if not is_finite(a) or not is_finite(b) or not is_finite(c) or not is_finite(d): return NAN
	return lerpf(lerpf(a,b,u-ix),lerpf(c,d,u-ix),v-iz)

static func _height_at(world: Dictionary, x: float, z: float) -> float:
	if _contains(world.get("bounds",{}),x,z): return _sample_height(world.get("terrain",{}),x,z)
	for parent in world.get("_terrainParents",[]):
		if parent is Dictionary and _contains(parent.get("bounds",{}),x,z): return _sample_height(parent.get("terrain",{}),x,z)
	return NAN

static func _local(x: float, altitude: float, z: float, origin: Dictionary) -> Vector3:
	return Vector3(x-float(origin.x),altitude-float(origin.y),z-float(origin.z))

static func _valid_origin(origin: Dictionary) -> bool:
	return is_finite(_finite(origin.get("x"))) and is_finite(_finite(origin.get("y"))) and is_finite(_finite(origin.get("z")))

static func _wet(grid: Dictionary, fields: Dictionary, x: int, z: int) -> bool:
	var width := int(grid.width)
	var index := z*width+x
	if int(fields.waterClass[index]) <= 0: return false
	var level := _finite(fields.waterLevelM[index])
	if not is_finite(level): return false
	var heights = grid.get("heights", [])
	return heights.is_empty() or level >= _finite(heights[index], INF)-0.001

static func _group_wet(grid: Dictionary, fields: Dictionary, x: int, z: int, step: int) -> bool:
	for j in range(z,mini(z+step,int(grid.height))):
		for i in range(x,mini(x+step,int(grid.width))):
			if _wet(grid,fields,i,j): return true
	return false

# Every neighbouring quad asks for the same corner index and same neighbourhood.
# Averaging only finite wet source levels removes independent-cell cracks/steps.
static func _water_corner(grid: Dictionary, fields: Dictionary, x: int, z: int, step: int, cache: Dictionary) -> float:
	var key := Vector2i(x,z)
	if cache.has(key): return float(cache[key])
	var total := 0.0
	var count := 0
	for j in range(maxi(0,z-step),mini(z+step,int(grid.height))):
		for i in range(maxi(0,x-step),mini(x+step,int(grid.width))):
			if _wet(grid,fields,i,j):
				total += float(fields.waterLevelM[j*int(grid.width)+i])
				count += 1
	var level := total/count if count else NAN
	cache[key] = level
	return level

static func build_water(world: Dictionary, origin: Dictionary, focus: Dictionary, view_width: float) -> Dictionary:
	var started := Time.get_ticks_usec()
	var result := {"vertices":PackedVector3Array(),"quads":0,"sourceStride":1,"budgetLimited":false,"buildMs":0.0,"anchor":origin.duplicate()}
	var window := _window(focus,view_width)
	if window.is_empty() or not _valid_origin(origin): return result
	var canonical := _context(world)
	var grid: Dictionary = canonical.get("grid",{})
	var fields: Dictionary = canonical.get("fields",{})
	var width := int(grid.get("width",0))
	var height := int(grid.get("height",0))
	var spacing := _finite(grid.get("spacingM"))
	if width < 1 or height < 1 or not is_finite(spacing) or spacing <= 0.0: return result
	if not fields.has("waterClass") or not fields.has("waterLevelM") or fields.waterClass.size() != width*height or fields.waterLevelM.size() != width*height: return result
	var x0 := maxi(0,int(floor((float(window.minX)-float(grid.originX))/spacing+0.5)))
	var z0 := maxi(0,int(floor((float(window.minZ)-float(grid.originZ))/spacing+0.5)))
	var x1 := mini(width-1,int(floor((float(window.maxX)-float(grid.originX))/spacing+0.5)))
	var z1 := mini(height-1,int(floor((float(window.maxZ)-float(grid.originZ))/spacing+0.5)))
	if x0 > x1 or z0 > z1: return result
	var wet_count := 0
	for z in range(z0,z1+1):
		for x in range(x0,x1+1):
			if _wet(grid,fields,x,z): wet_count+=1
	var step := 1
	# Sparse river cells can remain exact even in a million-cell terrain window.
	if wet_count>MAX_WATER_QUADS:
		while int(ceil(float(x1+1)/step)-floor(float(x0)/step))*int(ceil(float(z1+1)/step)-floor(float(z0)/step)) > MAX_WATER_QUADS: step *= 2
	x0 = int(floor(float(x0)/step))*step
	z0 = int(floor(float(z0)/step))*step
	var corners := {}
	var vertices := PackedVector3Array()
	var quads := 0
	for z in range(z0,z1+1,step):
		for x in range(x0,x1+1,step):
			if not _group_wet(grid,fields,x,z,step): continue
			if quads >= MAX_WATER_QUADS: result.budgetLimited=true; break
			var ex := mini(x+step,width)
			var ez := mini(z+step,height)
			var la := _water_corner(grid,fields,x,z,step,corners)
			var lb := _water_corner(grid,fields,ex,z,step,corners)
			var lc := _water_corner(grid,fields,ex,ez,step,corners)
			var ld := _water_corner(grid,fields,x,ez,step,corners)
			if not is_finite(la) or not is_finite(lb) or not is_finite(lc) or not is_finite(ld): continue
			var wx0 := float(grid.originX)+(x-0.5)*spacing
			var wz0 := float(grid.originZ)+(z-0.5)*spacing
			var wx1 := float(grid.originX)+(ex-0.5)*spacing
			var wz1 := float(grid.originZ)+(ez-0.5)*spacing
			var a := _local(wx0,la,wz0,origin)
			var b := _local(wx1,lb,wz0,origin)
			var c := _local(wx1,lc,wz1,origin)
			var d := _local(wx0,ld,wz1,origin)
			vertices.append_array(PackedVector3Array([a,c,b,a,d,c]))
			quads += 1
	result.vertices=vertices; result.quads=quads; result.sourceStride=step; result.sourceWetCells=wet_count
	result.representation="coarse wet-cell groups" if step>1 else "source cell footprints"
	result.buildMs=(Time.get_ticks_usec()-started)/1000.0
	return result

static func _intersects(bounds: Dictionary, min_x: float, min_z: float, max_x: float, max_z: float) -> bool:
	return max_x >= float(bounds.minX) and min_x <= float(bounds.maxX) and max_z >= float(bounds.minZ) and min_z <= float(bounds.maxZ)

static func _building_visible(building: Dictionary, window: Dictionary) -> bool:
	var min_x := INF
	var min_z := INF
	var max_x := -INF
	var max_z := -INF
	var outlines: Array = []
	outlines.append_array(building.get("footprint",[])); outlines.append_array(building.get("roofFootprint",[]))
	for shape in outlines:
		for point in shape.get("outer",[]):
			min_x=minf(min_x,_finite(point.get("x"),INF)); min_z=minf(min_z,_finite(point.get("y"),INF))
			max_x=maxf(max_x,_finite(point.get("x"),-INF)); max_z=maxf(max_z,_finite(point.get("y"),-INF))
	if min_x==INF:
		for triangle in building.get("triangles",[]):
			for point in triangle.get("points",[]):
				if point.size()<3: continue
				min_x=minf(min_x,_finite(point[0],INF)); min_z=minf(min_z,_finite(point[2],INF))
				max_x=maxf(max_x,_finite(point[0],-INF)); max_z=maxf(max_z,_finite(point[2],-INF))
	return min_x != INF and _intersects(window,min_x,min_z,max_x,max_z)

# Liang-Barsky clips crossing roads instead of dropping outside endpoints.
static func _clip_segment(a: Vector2, b: Vector2, window: Dictionary) -> Array:
	var delta := b-a
	var near := 0.0
	var far := 1.0
	var ps := [-delta.x,delta.x,-delta.y,delta.y]
	var qs := [a.x-float(window.minX),float(window.maxX)-a.x,a.y-float(window.minZ),float(window.maxZ)-a.y]
	for i in 4:
		var p := float(ps[i])
		var q := float(qs[i])
		if absf(p)<1e-12:
			if q<0.0: return []
		else:
			var t := q/p
			if p<0.0: near=maxf(near,t)
			else: far=minf(far,t)
			if near>far: return []
	return [a+near*delta,a+far*delta]

static func build_urban(packet: Dictionary, world: Dictionary, origin: Dictionary, focus: Dictionary, view_width: float) -> Dictionary:
	var started := Time.get_ticks_usec()
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var roads := PackedVector3Array()
	var result := {"vertices":vertices,"normals":normals,"roadVertices":roads,"anchor":origin.duplicate(),"buildingIds":[],"materialGroups":[],
		"nativeBuildings":0,"proxyBuildings":0,"skippedProxies":0,"roadChunks":0,"roadPieces":0,"skippedDegenerates":0,"budgetLimited":false,"buildMs":0.0,"cityIdentity":city_identity(packet)}
	var window := _window(focus,view_width)
	if window.is_empty() or not _valid_origin(origin): return result
	var urban: Dictionary = packet.get("urban",{})
	var show_proxies := bool(packet.get("_showProxies",false))
	for building in urban.get("buildings",[]):
		var proxy: bool = building.get("representation","")=="cartographic-proxy" or building.get("nativeRealization",true)==false
		if proxy and not show_proxies: result.skippedProxies+=1; continue
		if not _building_visible(building,window): continue
		var before := vertices.size()
		for triangle in building.get("triangles",[]):
			if vertices.size()+roads.size()+3>MAX_VERTICES: result.budgetLimited=true; break
			var points = triangle.get("points",[])
			if points.size()!=3: result.skippedDegenerates+=1; continue
			var local_points: Array[Vector3] = []
			for point in points:
				if point.size()!=3: break
				var x := _finite(point[0]); var y := _finite(point[1]); var z := _finite(point[2])
				if not is_finite(x) or not is_finite(y) or not is_finite(z): break
				local_points.append(_local(x,y,z,origin))
			if local_points.size()!=3: result.skippedDegenerates+=1; continue
			var cross := (local_points[1]-local_points[0]).cross(local_points[2]-local_points[0])
			if cross.length_squared()<1e-16: result.skippedDegenerates+=1; continue
			var normal := cross.normalized()
			var source_normal = triangle.get("normal",[])
			if source_normal.size()==3:
				var candidate := Vector3(_finite(source_normal[0],0),_finite(source_normal[1],0),_finite(source_normal[2],0))
				if candidate.length_squared()>1e-12: normal=candidate.normalized()
			if cross.dot(normal)<0.0:
				var saved := local_points[1]; local_points[1]=local_points[2]; local_points[2]=saved
			var slots: Dictionary = triangle.get("materials",{})
			var material_id: String = str(triangle.get("material",slots.get("cladding",slots.get("coating",""))))
			var groups: Array = result.materialGroups
			var last: Dictionary = groups.back() if not groups.is_empty() else {}
			if not last.is_empty() and last.materialId==material_id and last.buildingId==building.get("id","") and last.surface==triangle.get("surface","wall") and last.slots==slots:
				last.count+=3
			else:
				groups.append({"start":vertices.size(),"count":3,"materialId":material_id,"slots":slots.duplicate(),"surface":triangle.get("surface","wall"),"buildingId":building.get("id","")})
			vertices.append_array(PackedVector3Array(local_points))
			normals.append_array(PackedVector3Array([normal,normal,normal]))
		if vertices.size()>before:
			result.buildingIds.append(building.get("id",""))
			if proxy: result.proxyBuildings+=1
			else: result.nativeBuildings+=1
		if result.budgetLimited: break
	var spacing := _finite(world.get("terrain",{}).get("spacingM"),1.0)
	var target_step := maxf(spacing*0.5,0.0001)
	# Subtract the floating origin BEFORE using single-precision Vector2 geometry.
	var road_window := {"minX":float(window.minX)-float(origin.x),"minZ":float(window.minZ)-float(origin.z),
		"maxX":float(window.maxX)-float(origin.x),"maxZ":float(window.maxZ)-float(origin.z)}
	for road in urban.get("roads",[]):
		if result.budgetLimited: break
		var width := _finite(road.get("widthM"))
		if not is_finite(width) or width<=0.0: continue
		var points = road.get("points",[])
		for i in range(1,points.size()):
			if result.budgetLimited: break
			if points[i-1].size()<2 or points[i].size()<2: continue
			var a := Vector2(_finite(points[i-1][0])-float(origin.x),_finite(points[i-1][1])-float(origin.z))
			var b := Vector2(_finite(points[i][0])-float(origin.x),_finite(points[i][1])-float(origin.z))
			if not a.is_finite() or not b.is_finite() or a.distance_squared_to(b)<1e-16: result.skippedDegenerates+=1; continue
			var clipped := _clip_segment(a,b,road_window)
			if clipped.is_empty(): continue
			a=clipped[0]; b=clipped[1]
			var length := a.distance_to(b)
			if length<1e-8: result.skippedDegenerates+=1; continue
			var perpendicular := Vector2(-(b-a).y,(b-a).x).normalized()
			var pieces := maxi(1,int(ceil(length/target_step)))
			var columns := maxi(1,int(ceil(width/target_step)))
			# Long clipped paths are split into bounded chunks; the physical sampling
			# step is never silently increased to meet the per-chunk work budget.
			for chunk_start in range(0,pieces,ROAD_CHUNK_PIECES):
				if result.budgetLimited: break
				result.roadChunks+=1
				for piece in range(chunk_start,mini(pieces,chunk_start+ROAD_CHUNK_PIECES)):
					if result.budgetLimited: break
					var p := a.lerp(b,float(piece)/pieces)
					var q := a.lerp(b,float(piece+1)/pieces)
					for column in columns:
						if vertices.size()+roads.size()+6>MAX_VERTICES: result.budgetLimited=true; break
						var left := width*(0.5-float(column)/columns)
						var right := width*(0.5-float(column+1)/columns)
						var coords := [p+perpendicular*left,p+perpendicular*right,q+perpendicular*right,q+perpendicular*left]
						var quad: Array[Vector3] = []
						for coord in coords:
							var wx := float(origin.x)+float(coord.x)
							var wz := float(origin.z)+float(coord.y)
							var level := _height_at(world,wx,wz)
							if not is_finite(level): break
							quad.append(_local(wx,level+0.012,wz,origin))
						if quad.size()!=4: continue
						if (quad[2]-quad[0]).cross(quad[1]-quad[0]).length_squared()<1e-16 or (quad[3]-quad[0]).cross(quad[2]-quad[0]).length_squared()<1e-16:
							result.skippedDegenerates+=1; continue
						roads.append_array(PackedVector3Array([quad[0],quad[2],quad[1],quad[0],quad[3],quad[2]]))
						result.roadPieces+=1
	result.vertices=vertices; result.normals=normals; result.roadVertices=roads
	result.roadMaximumStepM=target_step
	result.buildMs=(Time.get_ticks_usec()-started)/1000.0
	return result
