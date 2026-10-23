class_name SurfaceWaterContours
extends RefCounted
const VERSION="source-water-contours-1"
const MAX_POINTS=500000
const MAX_RINGS=8192
const MAX_WORKING_BYTES=256*1024*1024

static func digest(rings:Array)->String:
	var ctx=HashingContext.new();ctx.start(HashingContext.HASH_SHA256);ctx.update(VERSION.to_utf8_buffer())
	for ring in rings:
		ctx.update(var_to_bytes(ring.size()));ctx.update(ring.to_byte_array())
	return ctx.finish().hex_encode()

static func info(geometry:Dictionary)->Dictionary:
	if not geometry.get("sourceWaterContours") is Array or geometry.get("sourceContourComplete",false)!=true or geometry.get("sourceContourBudgetLimited",true):return {"error":"complete retained vector contour inventory is required for water symbols"}
	var rings:Array=geometry.sourceWaterContours
	if rings.size()>MAX_RINGS:return {"error":"water contour node budget exceeded"}
	var count=0
	for ring in rings:
		if not ring is PackedFloat64Array or ring.size()<6 or ring.size()%2!=0:return {"error":"water contours require packed Float64 XZ rings"}
		count+=ring.size()/2
		if count>MAX_POINTS:return {"error":"water contour point budget exceeded"}
		for value in ring:
			if not is_finite(value):return {"error":"nonfinite source contour coordinate"}
	var estimated=count*1024+rings.size()*2048
	if estimated>MAX_WORKING_BYTES:return {"error":"water contour render workspace estimate exceeded"}
	var sha=digest(rings)
	if geometry.get("sourceContourPointCount",-1)!=count or geometry.get("sourceContourRingCount",-1)!=rings.size() or geometry.get("sourceContourSha256","")!=sha:return {"error":"water contour shape/hash differs from retained source metadata"}
	return {"count":count,"rings":rings.size(),"sha256":sha,"estimatedBytes":estimated,"budgetBytes":MAX_WORKING_BYTES}

static func pixel_points(ring:PackedFloat64Array,focus:Dictionary,width_m:float,resolution:int)->PackedVector2Array:
	var count=ring.size()/2
	if count>1 and ring[0]==ring[-2] and ring[1]==ring[-1]:count-=1
	var result=PackedVector2Array();result.resize(count)
	var min_x=float(focus.x)-width_m*.5;var min_z=float(focus.y)-width_m*.5;var scale=float(resolution)/width_m
	for i in count:
		# Both subtractions happen as float64 BEFORE creating an FP32 Vector2.
		result[i]=Vector2((ring[i*2]-min_x)*scale,(ring[i*2+1]-min_z)*scale)
	return result
