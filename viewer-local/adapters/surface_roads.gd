class_name SurfaceRoads
extends RefCounted
const UrbanReader = preload("res://adapters/urban_reader.gd")
const MAX_PROJECTORS := 512
const DEFAULT_PROJECTORS := 256
const MAX_CHUNK_M := 64.0

# Pure CPU preparation for Forward+ Decal nodes created by the caller. Downward
# projection modifies the rendered terrain material, not its height or source
# road geometry. Compatibility keeps SurfaceGeometry's mesh fallback.
static func _finite(value) -> bool:
	return (value is float or value is int) and is_finite(float(value))

static func _window(focus: Dictionary, width: float) -> Dictionary:
	if not _finite(focus.get("x")) or not _finite(focus.get("y")) or not is_finite(width) or width<=0 or width>10000000.0: return {}
	var span := pow(2.0,ceil(log(maxf(width,0.001))/log(2.0)))
	var chunk := span*0.5
	var cx := floorf(float(focus.x)/chunk)*chunk+chunk*0.5
	var cz := floorf(float(focus.y)/chunk)*chunk+chunk*0.5
	var radius := span+chunk*0.5
	return {"minX":cx-radius,"minZ":cz-radius,"maxX":cx+radius,"maxZ":cz+radius}

# Scalar float operations stay double precision. No Vector2 ever stores absolute
# source coordinates, including while clipping or measuring focus distance.
static func _clip(ax: float, az: float, bx: float, bz: float, bounds: Dictionary) -> Array:
	var dx := bx-ax; var dz := bz-az
	var ps := [-dx,dx,-dz,dz]
	var qs := [ax-float(bounds.minX),float(bounds.maxX)-ax,az-float(bounds.minZ),float(bounds.maxZ)-az]
	var near := 0.0; var far := 1.0
	for i in 4:
		var p := float(ps[i]); var q := float(qs[i])
		if absf(p)<1e-12:
			if q<0: return []
		else:
			var t := q/p
			if p<0: near=maxf(near,t)
			else: far=minf(far,t)
			if near>far: return []
	return [ax+near*dx,az+near*dz,ax+far*dx,az+far*dz]

static func _distance_squared(ax: float, az: float, bx: float, bz: float, x: float, z: float) -> float:
	var dx := bx-ax; var dz := bz-az
	var length2 := dx*dx+dz*dz
	var t := clampf(((x-ax)*dx+(z-az)*dz)/length2,0.0,1.0) if length2>0 else 0.0
	var px := ax+t*dx-x; var pz := az+t*dz-z
	return px*px+pz*pz

static func _height_range(world: Dictionary) -> Array:
	var minimum := INF; var maximum := -INF
	var layers: Array=[world]
	layers.append_array(world.get("_terrainParents",[]))
	for layer in layers:
		var known=layer.get("_heightRange",layer.get("heightRange"))
		if known is Vector2 and known.is_finite():
			minimum=minf(minimum,float(known.x)); maximum=maxf(maximum,float(known.y)); continue
		for height in layer.get("terrain",{}).get("heights",[]):
			if _finite(height): minimum=minf(minimum,float(height)); maximum=maxf(maximum,float(height))
	return [minimum,maximum]

static func _nearer(a: Dictionary, b: Dictionary) -> bool:
	if a.distanceM!=b.distanceM: return a.distanceM<b.distanceM
	if a._roadIndex!=b._roadIndex: return a._roadIndex<b._roadIndex
	if a.segmentIndex!=b.segmentIndex: return a.segmentIndex<b.segmentIndex
	return a.chunkIndex<b.chunkIndex

static func prepareRoadProjectors(packet: Dictionary, world: Dictionary, origin: Dictionary, focus: Dictionary, width: float) -> Array:
	var bounds := _window(focus,width)
	if bounds.is_empty(): return []
	for axis in ["x","y","z"]:
		if not _finite(origin.get(axis)): return []
	var urban=packet.get("urban",{})
	if not urban is Dictionary: return []
	var requested=packet.get("_roadProjectorLimit",DEFAULT_PROJECTORS)
	var cap := clampi(int(requested),1,MAX_PROJECTORS) if _finite(requested) else DEFAULT_PROJECTORS
	var maximum_distance := INF
	var records: Array=[]
	var packed: bool=UrbanReader.is_columns(urban)
	var roads: Array=urban.get("roads",[])
	var range_m := _height_range(world)
	if not is_finite(float(range_m[0])) or not is_finite(float(range_m[1])): return []
	var margin := maxf(2.0,float(world.get("_displaySpacing",world.get("terrain",{}).get("spacingM",1.0)))*2.0)
	var centre_y := (float(range_m[0])+float(range_m[1]))*0.5
	var depth := maxf(0.001,float(range_m[1])-float(range_m[0])+2.0*margin)
	for road_index in roads.size():
		var road: Dictionary=UrbanReader.road(urban,road_index) if packed else roads[road_index]
		if not _finite(road.get("widthM")) or float(road.widthM)<=0: continue
		var points=road.get("points",[])
		var metadata := road.duplicate(false); metadata.erase("points")
		for segment in range(1,points.size()):
			var a=points[segment-1]; var b=points[segment]
			if not a is Array or not b is Array or a.size()!=2 or b.size()!=2: continue
			if not _finite(a[0]) or not _finite(a[1]) or not _finite(b[0]) or not _finite(b[1]): continue
			var clipped := _clip(float(a[0]),float(a[1]),float(b[0]),float(b[1]),bounds)
			if clipped.is_empty(): continue
			var dx := float(clipped[2])-float(clipped[0]); var dz := float(clipped[3])-float(clipped[1])
			var length_m := sqrt(dx*dx+dz*dz)
			if not is_finite(length_m) or length_m<0.000001: continue
			var chunks := maxi(1,int(ceil(length_m/MAX_CHUNK_M)))
			for index in chunks:
				var t0 := float(index)/chunks; var t1 := float(index+1)/chunks
				var ax := float(clipped[0])+dx*t0; var az := float(clipped[1])+dz*t0
				var bx := float(clipped[0])+dx*t1; var bz := float(clipped[1])+dz*t1
				var distance := sqrt(_distance_squared(ax,az,bx,bz,float(focus.x),float(focus.y)))
				if distance>maximum_distance: continue
				var position := Vector3((ax+bx)*0.5-float(origin.x),centre_y-float(origin.y),(az+bz)*0.5-float(origin.z))
				var size := Vector3(float(road.widthM),depth,length_m/chunks)
				if not position.is_finite() or not size.is_finite(): continue
				records.append({"position":position,"size":size,"yaw":atan2(dx,dz),"sourceIndex":road.get("sourceIndex",road_index),"segmentIndex":segment-1,"chunkIndex":index,
					"surface":road.get("surface",""),"class":road.get("class",""),"id":road.get("id",""),"metadata":metadata,
					"sourceEndpoints":[[ax,az],[bx,bz]],"sourceRoadEndpoints":[[float(a[0]),float(a[1])],[float(b[0]),float(b[1])]],"cullMask":1,
					"distanceM":distance,"_roadIndex":road_index})
				# Bound temporary dictionaries as well as the final node count.
				if records.size()>=cap*2:
					records.sort_custom(_nearer); records.resize(cap)
					maximum_distance=float(records.back().distanceM)
	records.sort_custom(_nearer)
	if records.size()>cap: records.resize(cap)
	for record in records: record.erase("_roadIndex")
	return records
