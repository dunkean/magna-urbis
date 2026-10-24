extends RefCounted
# Rendering domains only. No padded rectangle or invented heightfield coverage.
const MAX_DOMAINS=7

static func domains(world:Dictionary)->Array:
	var items:Array=[{"terrain":world.terrain,"bounds":world.bounds}]
	items.append_array(world.get("_terrainParents",[]))
	if items.size()>MAX_DOMAINS:return []
	var source:Dictionary=world.terrain.source
	var context_id=str(world.get("canonicalContextRef",{}).get("id",""))
	var result:Array=[]
	for item in items:
		if not item is Dictionary or not item.get("terrain") is Dictionary or not item.get("bounds") is Dictionary:return []
		var grid:Dictionary=item.terrain;var bounds:Dictionary=item.bounds
		if grid.get("source",{}).get("id")!=source.id or grid.get("source",{}).get("version")!=source.version:return []
		if item.has("canonicalContextId") and item.canonicalContextId!=context_id:return []
		for key in ["minX","minZ","maxX","maxZ"]:
			if not bounds.has(key) or not is_finite(float(bounds[key])):return []
		if float(bounds.minX)>float(bounds.maxX) or float(bounds.minZ)>float(bounds.maxZ):return []
		for key in ["originX","originZ","spacingM","width","height"]:
			if not grid.has(key) or not is_finite(float(grid[key])):return []
		if float(grid.spacingM)<=0 or int(grid.width)<2 or int(grid.height)<2:return []
		var end_x=float(grid.originX)+(int(grid.width)-1)*float(grid.spacingM)
		var end_z=float(grid.originZ)+(int(grid.height)-1)*float(grid.spacingM)
		if float(bounds.minX)<float(grid.originX)-0.000001 or float(bounds.minZ)<float(grid.originZ)-0.000001 or float(bounds.maxX)>end_x+0.000001 or float(bounds.maxZ)>end_z+0.000001:return []
		result.append(bounds)
	return result

static func rebased_rects(bounds:Array,origin:Dictionary)->PackedVector4Array:
	var values:=PackedVector4Array()
	for b in bounds:
		# Double subtraction precedes storage in the renderer's FP32 vectors.
		values.append(Vector4(float(b.minX)-float(origin.x),float(b.minZ)-float(origin.z),float(b.maxX)-float(origin.x),float(b.maxZ)-float(origin.z)))
	while values.size()<MAX_DOMAINS:values.append(Vector4.ZERO)
	return values

static func contains(bounds:Array,x:float,z:float)->bool:
	for b in bounds:
		if x>=float(b.minX) and x<=float(b.maxX) and z>=float(b.minZ) and z<=float(b.maxZ):return true
	return false

static func nearest_point(bounds:Array,x:float,z:float)->Dictionary:
	var best=INF;var result={"x":NAN,"z":NAN}
	for b in bounds:
		var px=clampf(x,float(b.minX),float(b.maxX));var pz=clampf(z,float(b.minZ),float(b.maxZ))
		var distance=(px-x)*(px-x)+(pz-z)*(pz-z)
		if distance<best:best=distance;result={"x":px,"z":pz}
	return result

# Float64 dictionary keys must remain exact: an FP32 render vector may alias two
# distinct source-edge samples. The sampler always receives original doubles.
static func cached_edge_height(cache:Dictionary,x:float,z:float,sampler:Callable)->float:
	if not cache.has(x):cache[x]={}
	var column:Dictionary=cache[x]
	if not column.has(z):column[z]=float(sampler.call(x,z))
	return float(column[z])
