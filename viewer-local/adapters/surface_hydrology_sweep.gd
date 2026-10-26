class_name SurfaceHydrologySweep
extends RefCounted

const MAX_NATIVE_RING_POINTS := 32768

# Native ear clipping is restricted to ONE contour. Multiple contours may be
# disjoint components, holes or nested islands and always use exact even-odd.
static func simple_ring(ring: Array, origin: Dictionary, vertex_budget: int) -> Dictionary:
	if ring.size()<3 or ring.size()>MAX_NATIVE_RING_POINTS:return {"useSweep":true}
	var min_x:=INF;var min_z:=INF;var max_x:=-INF;var max_z:=-INF
	var points: Array=[]
	for point in ring:
		var x:=float(point.x);var z:=float(point.y)
		if points.is_empty() or x!=float(points.back()[0]) or z!=float(points.back()[1]):points.append([x,z])
		min_x=minf(min_x,x);min_z=minf(min_z,z);max_x=maxf(max_x,x);max_z=maxf(max_z,z)
	if points.size()>1 and points.front()==points.back():points.pop_back()
	if points.size()<3:return {"useSweep":true}
	var ox:=(min_x+max_x)*0.5;var oz:=(min_z+max_z)*0.5
	var local:=PackedVector2Array();var expected:=0.0;var perimeter:=0.0
	for i in points.size():
		var a: Array=points[i];var b: Array=points[(i+1)%points.size()]
		local.append(Vector2(float(a[0])-ox,float(a[1])-oz))
		expected+=(float(a[0])-ox)*(float(b[1])-oz)-(float(b[0])-ox)*(float(a[1])-oz)
		perimeter+=sqrt(pow(float(b[0])-float(a[0]),2.0)+pow(float(b[1])-float(a[1]),2.0))
	expected=absf(expected)*0.5
	var indices:=Geometry2D.triangulate_polygon(local)
	if indices.is_empty():return {"useSweep":true}
	if indices.size()>vertex_budget:return {"vertices":PackedVector3Array(),"invalid":false,"budgetLimited":true,"areaM2":0.0,"work":points.size()+indices.size()/3,"requiredVerticesAtLeast":indices.size()}
	var vertices:=PackedVector3Array();var measured:=0.0
	for i in range(0,indices.size(),3):
		var pa: Array=points[indices[i]];var pb: Array=points[indices[i+1]];var pc: Array=points[indices[i+2]]
		var a:=Vector3(float(pa[0])-float(origin.x),0.0,float(pa[1])-float(origin.z))
		var b:=Vector3(float(pb[0])-float(origin.x),0.0,float(pb[1])-float(origin.z))
		var c:=Vector3(float(pc[0])-float(origin.x),0.0,float(pc[1])-float(origin.z))
		var cross:=(b-a).cross(c-a).y
		measured+=absf(cross)*0.5
		vertices.append_array(PackedVector3Array([a,b,c] if cross>=0 else [a,c,b]))
	# Float32 triangulation/output is accepted only inside a declared tolerance
	# bounded by rounding along the perimeter and one part per million of area.
	var render_extent:=maxf(maxf(absf(min_x-float(origin.x)),absf(max_x-float(origin.x))),maxf(absf(min_z-float(origin.z)),absf(max_z-float(origin.z))))
	var tolerance:=maxf(0.000001,maxf(expected*0.000001,perimeter*maxf(render_extent*0.00000012,0.0000001)*2.0))
	if absf(measured-expected)>tolerance:return {"useSweep":true}
	return {"vertices":vertices,"invalid":false,"budgetLimited":false,"areaM2":expected,"work":points.size()+indices.size()/3,"nativeSimpleRing":true,"floatAreaErrorM2":absf(measured-expected),"floatAreaToleranceM2":tolerance}

# Exact even-odd scan bands, using the same strict low/middle/high convention as
# SurfaceCityMap. Only active edges are visited; no ring is presumed to be an
# outer boundary merely because it happens to precede another ring in SVG data.
static func triangulate(rings: Array, origin: Dictionary, vertex_budget: int, work_budget: int) -> Dictionary:
	if rings.size()==1:
		var native:=simple_ring(rings[0],origin,vertex_budget)
		if not native.get("useSweep",false):
			if int(native.get("work",0))>work_budget:return {"vertices":PackedVector3Array(),"invalid":false,"budgetLimited":true,"workBudgetLimited":true,"areaM2":0.0,"work":native.work}
			return native
	var vertices:=PackedVector3Array(); var area:=0.0; var work:=0
	var edges: Array=[]; var levels: Dictionary={}
	for ring in rings:
		for i in ring.size():
			var a: Dictionary=ring[i];var b: Dictionary=ring[(i+1)%ring.size()]
			var ax:=float(a.x)-float(origin.x);var az:=float(a.y)-float(origin.z)
			var bx:=float(b.x)-float(origin.x);var bz:=float(b.y)-float(origin.z)
			levels[az]=true
			if az!=bz:edges.append([ax,az,bx,bz,minf(az,bz),maxf(az,bz)])
	var zs: Array=levels.keys();zs.sort()
	var starts: Array=[];var ends: Array=[]
	for i in edges.size():starts.append(i);ends.append(i)
	starts.sort_custom(func(a,b):return float(edges[a][4])<float(edges[b][4]) if edges[a][4]!=edges[b][4] else a<b)
	ends.sort_custom(func(a,b):return float(edges[a][5])<float(edges[b][5]) if edges[a][5]!=edges[b][5] else a<b)
	var active: Dictionary={};var si:=0;var ei:=0
	for band in range(1,zs.size()):
		var low:=float(zs[band-1]);var high:=float(zs[band]);var middle:=(low+high)*0.5
		while ei<ends.size() and float(edges[ends[ei]][5])<=low:active.erase(ends[ei]);ei+=1
		while si<starts.size() and float(edges[starts[si]][4])<=low:
			var id: int=starts[si]
			if float(edges[id][5])>low:active[id]=true
			si+=1
		if high-low<=0.000000001:continue
		work+=active.size()
		if work>work_budget:return {"vertices":PackedVector3Array(),"invalid":false,"budgetLimited":true,"workBudgetLimited":true,"areaM2":0.0,"work":work}
		var crossings: Array=[]
		for id in active:
			var edge: Array=edges[id]
			# Both endpoints are scan events. Therefore active implies the exact
			# strict midpoint crossing used by the original even-odd algorithm.
			var x:=_x(edge,middle)
			crossings.append([id,x])
		crossings.sort_custom(func(a,b):return float(a[1])<float(b[1]) if a[1]!=b[1] else a[0]<b[0])
		if crossings.size()%2!=0:return {"vertices":PackedVector3Array(),"invalid":true,"budgetLimited":false,"areaM2":0.0,"work":work}
		for i in range(0,crossings.size(),2):
			var left: Array=edges[crossings[i][0]];var right: Array=edges[crossings[i+1][0]]
			var ax:=_x(left,low);var bx:=_x(right,low);var cx:=_x(right,high);var dx:=_x(left,high)
			var count:=(3 if bx-ax>0.000000001 else 0)+(3 if cx-dx>0.000000001 else 0)
			if vertices.size()+count>vertex_budget:return {"vertices":PackedVector3Array(),"invalid":false,"budgetLimited":true,"workBudgetLimited":false,"areaM2":0.0,"work":work,"requiredVerticesAtLeast":vertices.size()+count}
			work+=count/3
			if work>work_budget:return {"vertices":PackedVector3Array(),"invalid":false,"budgetLimited":true,"workBudgetLimited":true,"areaM2":0.0,"work":work}
			var a:=Vector3(ax,0.0,low);var b:=Vector3(bx,0.0,low);var c:=Vector3(cx,0.0,high);var d:=Vector3(dx,0.0,high)
			if bx-ax>0.000000001:vertices.append_array(PackedVector3Array([a,c,b]));area+=(bx-ax)*(high-low)*0.5
			if cx-dx>0.000000001:vertices.append_array(PackedVector3Array([a,d,c]));area+=(cx-dx)*(high-low)*0.5
	return {"vertices":vertices,"invalid":false,"budgetLimited":false,"areaM2":area,"work":work}

static func _x(edge: Array,z:float)->float:
	return float(edge[0])+(z-float(edge[1]))/(float(edge[3])-float(edge[1]))*(float(edge[2])-float(edge[0]))
