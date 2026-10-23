class_name SurfaceGeometry
extends RefCounted

# CPU-only builders. Vertices use canonical right-handed outward winding;
# SurfaceData.make_mesh performs the single conversion to Godot clockwise faces.
const UrbanReader = preload("res://adapters/urban_reader.gd")
const MAX_VERTICES := 999999
const MAX_BUILDING_VERTICES := 600000
const MAX_ROAD_VERTICES := 399996
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

static func _grid_coordinate(grid: Dictionary, coordinate: float, axis: String, count: int) -> float:
	var start := float(grid.originX if axis=="X" else grid.originZ)
	var spacing := float(grid.spacingM)
	var end := float(grid.get("lastSample"+axis,start+(count-1)*spacing))
	coordinate=clampf(coordinate,start,end)
	var last_regular := start+(count-2)*spacing
	if coordinate>last_regular and end<start+(count-1)*spacing and end>last_regular:
		return count-2+(coordinate-last_regular)/(end-last_regular)
	return clampf((coordinate-start)/spacing,0.0,count-1.0)

static func _bspline_weights(t: float) -> PackedFloat64Array:
	return PackedFloat64Array([pow(1.0-t,3.0)/6.0,(3.0*t*t*t-6.0*t*t+4.0)/6.0,(-3.0*t*t*t+3.0*t*t+3.0*t+1.0)/6.0,t*t*t/6.0])

static func sample_grid_values(grid: Dictionary, values, x: float, z: float) -> float:
	var width := int(grid.get("width",0))
	var height := int(grid.get("height",0))
	var spacing := _finite(grid.get("spacingM"))
	if width < 2 or height < 2 or not is_finite(spacing) or spacing <= 0.0 or values.size() != width*height: return NAN
	var u := _grid_coordinate(grid,x,"X",width)
	var v := _grid_coordinate(grid,z,"Z",height)
	var ix := int(floor(u))
	var iz := int(floor(v))
	var reconstruction: String = grid.get("reconstruction","bilinear-samples")
	if reconstruction=="cubic-bspline-controls":
		var wx := _bspline_weights(u-ix)
		var wz := _bspline_weights(v-iz)
		var value := 0.0
		for j in 4:
			for i in 4:
				var sample := _finite(values[clampi(iz+j-1,0,height-1)*width+clampi(ix+i-1,0,width-1)])
				if not is_finite(sample): return NAN
				value+=sample*wx[i]*wz[j]
		return value
	if reconstruction!="bilinear-samples": return NAN
	var jx := mini(ix+1,width-1)
	var jz := mini(iz+1,height-1)
	var a := _finite(values[iz*width+ix])
	var b := _finite(values[iz*width+jx])
	var c := _finite(values[jz*width+ix])
	var d := _finite(values[jz*width+jx])
	if not is_finite(a) or not is_finite(b) or not is_finite(c) or not is_finite(d): return NAN
	return lerpf(lerpf(a,b,u-ix),lerpf(c,d,u-ix),v-iz)

static func sample_height(grid: Dictionary, x: float, z: float) -> float:
	return sample_grid_values(grid,grid.get("heights",[]),x,z)

# Borrow immutable source grids; caller caches this small list in its display
# snapshot. Child support wins only inside its footprint and feathers to parent.
static func prepare_height_layers(world: Dictionary) -> Array:
	var layers: Array = [{"bounds":world.get("bounds",{}),"terrain":world.get("terrain",{})}]
	for parent in world.get("_terrainParents",[]):
		if parent is Dictionary and parent.has("terrain") and parent.has("bounds"): layers.append(parent)
	layers.sort_custom(func(a,b): return float(a.terrain.get("spacingM",INF))<float(b.terrain.get("spacingM",INF)))
	return layers

static func raw_height_at(world: Dictionary, x: float, z: float) -> float:
	var layers: Array = world.get("_heightLayers",[])
	if layers.is_empty(): layers=prepare_height_layers(world)
	for layer in layers:
		if _contains(layer.bounds,x,z): return sample_height(layer.terrain,x,z)
	return NAN

static func height_at(world: Dictionary, x: float, z: float) -> float:
	var layers: Array = world.get("_heightLayers",[])
	if layers.is_empty(): layers=prepare_height_layers(world)
	var value := NAN
	# Coarse to fine: every finer source approaches its supporting parent
	# continuously at the boundary. This changes display only, never source arrays.
	for index in range(layers.size()-1,-1,-1):
		var layer: Dictionary = layers[index]
		if not _contains(layer.bounds,x,z): continue
		var child := sample_height(layer.terrain,x,z)
		if not is_finite(child): continue
		if is_finite(value):
			var edge := minf(minf(x-float(layer.bounds.minX),float(layer.bounds.maxX)-x),minf(z-float(layer.bounds.minZ),float(layer.bounds.maxZ)-z))
			var band := maxf(float(layer.terrain.spacingM)*4.0,float(world.get("_displaySpacing",0))*2.0)
			var weight := smoothstep(0.0,maxf(band,0.0001),edge)
			value=lerpf(value,child,weight)
		else: value=child
	# Off-domain filler is hidden by terrain hole controls, not generated terrain.
	return value if is_finite(value) else sample_height(world.get("terrain",{}),x,z)

static func _covered(world: Dictionary, x: float, z: float) -> bool:
	if _contains(world.get("bounds",{}),x,z): return true
	for parent in world.get("_terrainParents",[]):
		if parent is Dictionary and _contains(parent.get("bounds",{}),x,z): return true
	return false

static func _height_at(world: Dictionary, x: float, z: float) -> float:
	if not _covered(world,x,z): return NAN
	return height_at(world.get("_displaySource",world),x,z)

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
	var minimum_level := INF; var maximum_level := -INF
	var mask := PackedFloat32Array(); mask.resize(width*height)
	var rectangles: Array = []
	var active := {}
	for z in height:
		var next := {}
		var x := 0
		while x<width:
			if not _wet(grid,fields,x,z): x+=1; continue
			mask[z*width+x]=1.0
			if z<z0 or z>z1 or x<x0 or x>x1: x+=1; continue
			var start := x
			var level := float(fields.waterLevelM[z*width+x])
			minimum_level=minf(minimum_level,level); maximum_level=maxf(maximum_level,level)
			var kind := int(fields.waterClass[z*width+x])
			while x<=x1 and _wet(grid,fields,x,z) and float(fields.waterLevelM[z*width+x])==level and int(fields.waterClass[z*width+x])==kind:
				mask[z*width+x]=1.0; wet_count+=1; x+=1
			var key := str(start)+":"+str(x)+":"+str(kind)+":"+str(level)
			var rectangle: Array
			if active.has(key): rectangle=active[key]; rectangle[3]=z+1
			else: rectangle=[start,z,x,z+1,level]; rectangles.append(rectangle)
			next[key]=rectangle
		active=next
	var coverage := Image.create_from_data(width,height,false,Image.FORMAT_RF,mask.to_byte_array())
	coverage.generate_mipmaps()
	result.coverageImage=coverage
	result.coverageOrigin={"x":float(grid.originX),"z":float(grid.originZ)}
	result.coverageSpacingM=spacing; result.coverageSize=Vector2i(width,height)
	var bed: Dictionary = world.get("terrain",{})
	if bed.has("heights") and bed.heights.size()==int(bed.get("width",0))*int(bed.get("height",0)):
		var bed_values := PackedFloat32Array(); bed_values.resize(bed.heights.size())
		for i in bed_values.size(): bed_values[i]=float(bed.heights[i])
		result.bedImage=Image.create_from_data(int(bed.width),int(bed.height),false,Image.FORMAT_RF,bed_values.to_byte_array())
		result.bedOrigin={"x":float(bed.originX),"z":float(bed.originZ)}
		result.bedSpacingM=float(bed.spacingM); result.bedSize=Vector2i(int(bed.width),int(bed.height))
		result.bedBounds=world.get("bounds",{}).duplicate()
		result.bedReconstruction=bed.get("reconstruction","bilinear-samples")
	var step := 1
	# Unequal levels need every shared corner: long merged edges would otherwise
	# interpolate across intermediate neighbour levels and form T-junction cracks.
	if minimum_level!=maximum_level:
		rectangles=[]
		for z in range(z0,z1+1):
			for x in range(x0,x1+1):
				if mask[z*width+x]>0: rectangles.append([x,z,x+1,z+1,NAN])
				if rectangles.size()>MAX_WATER_QUADS: break
			if rectangles.size()>MAX_WATER_QUADS: break
	if rectangles.size()>MAX_WATER_QUADS:
		# The geometry may cover dry cells ONLY with its mandatory exact mask.
		# Linear area mipmaps preserve mean wet area at distant display LODs.
		rectangles=[]
		while int(ceil(float(x1-x0+1)/step))*int(ceil(float(z1-z0+1)/step))>MAX_WATER_QUADS: step*=2
		for z in range(z0,z1+1,step):
			for x in range(x0,x1+1,step):
				if _group_wet(grid,fields,x,z,step): rectangles.append([x,z,mini(x+step,x1+1),mini(z+step,z1+1),NAN])
		result.requiresCoverageMask=true
	else: result.requiresCoverageMask=false
	var corners := {}
	var vertices := PackedVector3Array()
	var conflicts := 0
	var maximum_bed_conflict := 0.0
	for rectangle in rectangles:
		var x := int(rectangle[0]); var z := int(rectangle[1]); var ex := int(rectangle[2]); var ez := int(rectangle[3])
		var la := _water_corner(grid,fields,x,z,step,corners)
		var lb := _water_corner(grid,fields,ex,z,step,corners)
		var lc := _water_corner(grid,fields,ex,ez,step,corners)
		var ld := _water_corner(grid,fields,x,ez,step,corners)
		if not is_finite(la) or not is_finite(lb) or not is_finite(lc) or not is_finite(ld): continue
		var wx0 := float(grid.originX)+(x-0.5)*spacing; var wz0 := float(grid.originZ)+(z-0.5)*spacing
		var wx1 := float(grid.originX)+(ex-0.5)*spacing; var wz1 := float(grid.originZ)+(ez-0.5)*spacing
		var a := _local(wx0,la,wz0,origin); var b := _local(wx1,lb,wz0,origin)
		var c := _local(wx1,lc,wz1,origin); var d := _local(wx0,ld,wz1,origin)
		vertices.append_array(PackedVector3Array([a,c,b,a,d,c]))
	# This diagnostic concerns resolved source depth; canonical masks and levels
	# are retained even where the fine bed now protrudes through the water.
	for z in range(z0,z1+1):
		for x in range(x0,x1+1):
			if mask[z*width+x]==0: continue
			var wx := float(grid.originX)+x*spacing; var wz := float(grid.originZ)+z*spacing
			if not _contains(world.get("bounds",{}),wx,wz): continue
			var delta := sample_height(bed,wx,wz)-float(fields.waterLevelM[z*width+x])
			if is_finite(delta) and delta>=-0.001: conflicts+=1; maximum_bed_conflict=maxf(maximum_bed_conflict,delta)
	result.vertices=vertices; result.quads=vertices.size()/6; result.sourceStride=step; result.sourceWetCells=wet_count
	result.resolvedBedConflicts=conflicts; result.maximumBedAboveWaterM=maximum_bed_conflict
	result.representation="masked area-preserving groups" if step>1 else "exact wet-cell rectangle union"
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
	var result := {"vertices":vertices,"normals":normals,"roadVertices":roads,"anchor":origin.duplicate(),"buildingIds":[],"materialGroups":[],"supportConflicts":[],"maximumSupportDeltaM":0.0,
		"nativeBuildings":0,"proxyBuildings":0,"skippedProxies":0,"roadChunks":0,"roadPieces":0,"skippedDegenerates":0,"budgetLimited":false,"buildMs":0.0,"cityIdentity":city_identity(packet)}
	var window := _window(focus,view_width)
	if window.is_empty() or not _valid_origin(origin): return result
	var urban: Dictionary = packet.get("urban",{})
	var show_proxies := bool(packet.get("_showProxies",false))
	var packed: bool = urban.get("format","")=="magna-urban-columns"
	var buildings: Array = urban.get("buildings",[])
	for building_index in buildings.size():
		if packed:
			var bounds: Dictionary = UrbanReader.building_bounds(urban,building_index)
			if bounds.is_empty() or not _intersects(window,float(bounds.minX),float(bounds.minZ),float(bounds.maxX),float(bounds.maxZ)): continue
		var building: Dictionary = UrbanReader.building(urban,building_index) if packed else buildings[building_index]
		var proxy: bool = building.get("representation","")=="cartographic-proxy" or building.get("nativeRealization",true)==false
		if proxy and not show_proxies: result.skippedProxies+=1; continue
		if not _building_visible(building,window): continue
		var before := vertices.size()
		for triangle in building.get("triangles",[]):
			if vertices.size()+3>MAX_BUILDING_VERTICES: result.budgetLimited=true; break
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
			# Read-only constraint diagnostic: foundations, stilts and edited source
			# heights remain authoritative. Never translate native triangles to fit.
			var support := _finite(building.get("groundHeightM"))
			var low := INF; var high := -INF; var support_samples := 0
			if is_finite(support):
				for shape in building.get("footprint",[]):
					for point in shape.get("outer",[]):
						if support_samples>=128: break
						var bed_height := raw_height_at(world,float(point.x),float(point.y))
						if is_finite(bed_height):
							var delta := bed_height-support
							low=minf(low,delta); high=maxf(high,delta); support_samples+=1
				if support_samples>0:
					result.maximumSupportDeltaM=maxf(float(result.maximumSupportDeltaM),maxf(absf(low),absf(high)))
					if maxf(absf(low),absf(high))>0.05: result.supportConflicts.append({"buildingId":building.get("id",""),"sourceGroundHeightM":support,"minimumBedDeltaM":low,"maximumBedDeltaM":high,"samples":support_samples,"resolution":"native constraints preserved; potential support conflict"})
			result.buildingIds.append(building.get("id",""))
			if proxy: result.proxyBuildings+=1
			else: result.nativeBuildings+=1
		if result.budgetLimited: break
	# Independent road budget: a single complex native mesh cannot erase roads,
	# and input order cannot choose which district receives the remaining budget.
	var display: Dictionary = world.get("_displaySource",world)
	var spacing := maxf(float(world.get("_displaySpacing",0)),_finite(display.get("terrain",{}).get("spacingM"),1.0))
	var tolerance := maxf(0.01,view_width/1920.0*0.5)
	var road_window := {"minX":float(window.minX)-float(origin.x),"minZ":float(window.minZ)-float(origin.z),"maxX":float(window.maxX)-float(origin.x),"maxZ":float(window.maxZ)-float(origin.z)}
	var segments: Array = []
	var road_records: Array = urban.get("roads",[])
	for road_index in road_records.size():
		var road: Dictionary = UrbanReader.road(urban,road_index) if packed else road_records[road_index]
		var width := _finite(road.get("widthM"))
		if not is_finite(width) or width<=0.0: continue
		var points = road.get("points",[])
		for i in range(1,points.size()):
			if points[i-1].size()<2 or points[i].size()<2: continue
			var a := Vector2(_finite(points[i-1][0])-float(origin.x),_finite(points[i-1][1])-float(origin.z))
			var b := Vector2(_finite(points[i][0])-float(origin.x),_finite(points[i][1])-float(origin.z))
			if not a.is_finite() or not b.is_finite() or a.distance_squared_to(b)<1e-16: result.skippedDegenerates+=1; continue
			var clipped := _clip_segment(a,b,road_window)
			if clipped.is_empty(): continue
			a=clipped[0]; b=clipped[1]
			if a.distance_squared_to(b)<1e-16: result.skippedDegenerates+=1; continue
			var centre := (a+b)*0.5
			var distance := pow(float(centre.x)+float(origin.x)-float(focus.x),2)+pow(float(centre.y)+float(origin.z)-float(focus.y),2)
			segments.append({"a":a,"b":b,"width":width,"distance":distance,"index":segments.size(),"road":road})
	segments.sort_custom(func(a,b): return a.distance<b.distance if a.distance!=b.distance else a.index<b.index)
	result.roadGroups=[]; result.roadOmittedSegments=0; result.roadErrorToleranceM=tolerance
	var observed_error := 0.0
	for segment_index in segments.size():
		if roads.size()+6>MAX_ROAD_VERTICES:
			result.roadOmittedSegments=segments.size()-segment_index; result.budgetLimited=true; break
		var segment: Dictionary = segments[segment_index]
		var a: Vector2 = segment.a; var b: Vector2 = segment.b
		var perpendicular := Vector2(-(b-a).y,(b-a).x).normalized()
		var length := a.distance_to(b)
		var pieces := clampi(int(ceil(length/maxf(spacing*4.0,0.01))),1,1024)
		var stack: Array = []
		for i in range(pieces-1,-1,-1): stack.append([a.lerp(b,float(i)/pieces),a.lerp(b,float(i+1)/pieces),float(segment.width)*0.5,-float(segment.width)*0.5,0])
		var start := roads.size()
		while not stack.is_empty():
			if roads.size()+6>MAX_ROAD_VERTICES: result.budgetLimited=true; break
			var patch: Array = stack.pop_back()
			var p: Vector2 = patch[0]; var q: Vector2 = patch[1]
			var left := float(patch[2]); var right := float(patch[3]); var depth := int(patch[4])
			var coords := [p+perpendicular*left,p+perpendicular*right,q+perpendicular*right,q+perpendicular*left]
			var quad: Array[Vector3] = []
			for coord in coords:
				var wx := float(origin.x)+float(coord.x); var wz := float(origin.z)+float(coord.y)
				var level := _height_at(world,wx,wz)
				if not is_finite(level): break
				quad.append(_local(wx,level+0.012,wz,origin))
			if quad.size()!=4: continue
			var error := 0.0
			# Compare terrain with the actual diagonal-triangle interpolant at
			# centre and four edge midpoints; subdivide only physical curvature.
			for probe in [[0,1],[1,2],[2,3],[3,0],[0,2]]:
				var coord: Vector2 = (coords[probe[0]]+coords[probe[1]])*0.5
				var actual := _height_at(world,float(origin.x)+float(coord.x),float(origin.z)+float(coord.y))
				var estimate := (float(quad[probe[0]].y)+float(quad[probe[1]].y))*0.5+float(origin.y)-0.012
				if is_finite(actual): error=maxf(error,absf(actual-estimate))
			if error>tolerance and depth<12:
				if p.distance_to(q)>absf(left-right):
					var middle := (p+q)*0.5
					stack.append([middle,q,left,right,depth+1]); stack.append([p,middle,left,right,depth+1])
				else:
					var middle := (left+right)*0.5
					stack.append([p,q,middle,right,depth+1]); stack.append([p,q,left,middle,depth+1])
				continue
			observed_error=maxf(observed_error,error)
			if (quad[2]-quad[0]).cross(quad[1]-quad[0]).length_squared()<1e-16: result.skippedDegenerates+=1; continue
			roads.append_array(PackedVector3Array([quad[0],quad[2],quad[1],quad[0],quad[3],quad[2]])); result.roadPieces+=1
		result.roadChunks+=1
		if roads.size()>start: result.roadGroups.append({"start":start,"count":roads.size()-start,"roadId":segment.road.get("id",""),"surface":segment.road.get("surface","")})
	result.vertices=vertices; result.normals=normals; result.roadVertices=roads
	result.roadMaximumObservedErrorM=observed_error; result.roadMaximumStepM=spacing*4.0
	result.buildMs=(Time.get_ticks_usec()-started)/1000.0
	return result
