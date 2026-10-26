class_name SurfaceCityMap
extends RefCounted
const UrbanReader = preload("res://adapters/urban_reader.gd")
const REPRESENTATION := "cartographic-source-roof-overlay"
const MAX_VERTICES := 600000

# Renderer-only preview of source roof footprints. It is deliberately separate
# from native triangles, roof realizations, occupation and saved architecture.
# Call only for cartographic presentation, never to fill missing aerial roofs.
static func _finite(value) -> bool:
	return (value is float or value is int) and is_finite(float(value))

static func _window(focus: Dictionary, width: float) -> Dictionary:
	if not _finite(focus.get("x")) or not _finite(focus.get("y")) or not is_finite(width) or width<=0 or width>10000000.0: return {}
	var span := pow(2.0,ceil(log(maxf(width,0.001))/log(2.0)))
	var chunk := span*0.5
	var cx := floorf(float(focus.x)/chunk)*chunk+chunk*0.5
	var cz := floorf(float(focus.y)/chunk)*chunk+chunk*0.5
	return {"minX":cx-span-chunk*0.5,"minZ":cz-span-chunk*0.5,"maxX":cx+span+chunk*0.5,"maxZ":cz+span+chunk*0.5}

static func _plane(building: Dictionary) -> Dictionary:
	var height := -INF
	for triangle in building.get("triangles",[]):
		for point in triangle.get("points",[]):
			if point.size()==3 and _finite(point[1]): height=maxf(height,float(point[1]))
	if is_finite(height): return {"height":height,"source":"maximum-source-native-triangle"}
	for volume in building.get("nativeLevels",[]):
		for level in volume.get("levels",[]):
			if _finite(level.get("z_m")) and _finite(level.get("height_m")):
				height=maxf(height,float(level.z_m)+float(level.height_m))
			var slab=level.get("roof_slab")
			if slab is Dictionary and _finite(slab.get("z_m")): height=maxf(height,float(slab.z_m))
	if is_finite(height): return {"height":height,"source":"maximum-source-level"}
	if _finite(building.get("groundHeightM")): return {"height":float(building.groundHeightM),"source":"source-ground-plane"}
	return {}

static func _edge_x(edge: Array, z: float) -> float:
	return float(edge[0])+(z-float(edge[1]))/(float(edge[3])-float(edge[1]))*(float(edge[2])-float(edge[0]))

# Same even-odd horizontal trapezoids as web surfaceTriangles. Ring orientation
# is irrelevant. Double scalar coordinates are rebased before interpolation and
# area calculations; only the final GPU vertices become single precision.
static func triangulate(surface: Array, origin: Dictionary, height: float, budget: int) -> Dictionary:
	var vertices := PackedVector3Array()
	var area := 0.0
	for shape in surface:
		var rings: Array=[]
		var levels := {}
		var source_rings: Array=[shape.get("outer",[])]
		source_rings.append_array(shape.get("holes",[]))
		for source in source_rings:
			var ring: Array=[]
			for point in source:
				if not point is Dictionary or not _finite(point.get("x")) or not _finite(point.get("y")): return {"vertices":PackedVector3Array(),"invalid":true,"budgetLimited":false,"areaM2":0.0}
				var x := float(point.x)-float(origin.x); var z := float(point.y)-float(origin.z)
				ring.append([x,z]); levels[z]=true
			if ring.size()>=3: rings.append(ring)
		var zs: Array=levels.keys(); zs.sort()
		for band in range(1,zs.size()):
			var low := float(zs[band-1]); var high := float(zs[band]); var middle := (low+high)*0.5
			if high-low<=0.000000001: continue
			var edges: Array=[]
			for ring in rings:
				for i in ring.size():
					var a: Array=ring[i]; var b: Array=ring[(i+1)%ring.size()]
					if middle>minf(float(a[1]),float(b[1])) and middle<maxf(float(a[1]),float(b[1])):
						var edge: Array=[a[0],a[1],b[0],b[1]]
						edge.append(_edge_x(edge,middle)); edges.append(edge)
			edges.sort_custom(func(a,b): return float(a[4])<float(b[4]))
			if edges.size()%2!=0: return {"vertices":PackedVector3Array(),"invalid":true,"budgetLimited":false,"areaM2":0.0}
			for i in range(0,edges.size(),2):
				var ax := _edge_x(edges[i],low); var bx := _edge_x(edges[i+1],low)
				var cx := _edge_x(edges[i+1],high); var dx := _edge_x(edges[i],high)
				var y := height-float(origin.y)
				var a := Vector3(ax,y,low); var b := Vector3(bx,y,low)
				var c := Vector3(cx,y,high); var d := Vector3(dx,y,high)
				var count := (3 if bx-ax>0.000000001 else 0)+(3 if cx-dx>0.000000001 else 0)
				if vertices.size()+count>budget: return {"vertices":PackedVector3Array(),"invalid":false,"budgetLimited":true,"areaM2":0.0}
				if count>0 and (not a.is_finite() or not b.is_finite() or not c.is_finite() or not d.is_finite()): return {"vertices":PackedVector3Array(),"invalid":true,"budgetLimited":false,"areaM2":0.0}
				if bx-ax>0.000000001: vertices.append_array(PackedVector3Array([a,c,b])); area+=(bx-ax)*(high-low)*0.5
				if cx-dx>0.000000001: vertices.append_array(PackedVector3Array([a,d,c])); area+=(cx-dx)*(high-low)*0.5
	return {"vertices":vertices,"invalid":false,"budgetLimited":false,"areaM2":area}

static func _up_triangle(a: Vector3, b: Vector3, c: Vector3) -> PackedVector3Array:
	var cross := (b-a).cross(c-a).y
	if absf(cross)<0.000000000001: return PackedVector3Array()
	return PackedVector3Array([a,b,c] if cross>0 else [a,c,b])

# Centred source-boundary stroke, including every courtyard ring. Quads plus
# bevel joins avoid normal extrusion (UP cannot expand a cartographic XY edge).
static func _outline(surface: Array, origin: Dictionary, height: float, edge_width: float, budget: int) -> Dictionary:
	var vertices := PackedVector3Array()
	if edge_width<=0: return {"vertices":vertices,"budgetLimited":false}
	var half_width := edge_width*0.5
	var y := height-float(origin.y)+0.001
	for shape in surface:
		var rings: Array=[shape.outer]; rings.append_array(shape.get("holes",[]))
		for ring in rings:
			if ring.size()<3: continue
			var segments: Array=[]
			for i in ring.size():
				var a: Dictionary=ring[i]; var b: Dictionary=ring[(i+1)%ring.size()]
				var ax := float(a.x)-float(origin.x); var az := float(a.y)-float(origin.z)
				var bx := float(b.x)-float(origin.x); var bz := float(b.y)-float(origin.z)
				var dx := bx-ax; var dz := bz-az; var length_m := sqrt(dx*dx+dz*dz)
				if length_m<0.000000001: continue
				var px := -dz/length_m*half_width; var pz := dx/length_m*half_width
				var al := Vector3(ax+px,y,az+pz); var ar := Vector3(ax-px,y,az-pz)
				var bl := Vector3(bx+px,y,bz+pz); var br := Vector3(bx-px,y,bz-pz)
				if not al.is_finite() or not ar.is_finite() or not bl.is_finite() or not br.is_finite(): return {"vertices":PackedVector3Array(),"budgetLimited":true}
				if vertices.size()+6>budget: return {"vertices":PackedVector3Array(),"budgetLimited":true}
				vertices.append_array(_up_triangle(al,br,ar)); vertices.append_array(_up_triangle(al,bl,br))
				segments.append({"al":al,"ar":ar,"bl":bl,"br":br,"a":Vector3(ax,y,az)})
			for i in segments.size():
				var current: Dictionary=segments[i]; var previous: Dictionary=segments[(i+segments.size()-1)%segments.size()]
				var left := _up_triangle(current.a,previous.bl,current.al)
				var right := _up_triangle(current.a,previous.br,current.ar)
				if vertices.size()+left.size()+right.size()>budget: return {"vertices":PackedVector3Array(),"budgetLimited":true}
				vertices.append_array(left); vertices.append_array(right)
	return {"vertices":vertices,"budgetLimited":false}

static func prepare(packet: Dictionary, origin: Dictionary, focus: Dictionary, width: float, edgeWidthM: float = 0.04) -> Dictionary:
	var started := Time.get_ticks_usec()
	var result := {"vertices":PackedVector3Array(),"normals":PackedVector3Array(),"outlineVertices":PackedVector3Array(),"outlineNormals":PackedVector3Array(),"outlineWidthM":edgeWidthM,"buildingIds":[],"groups":[],"representation":REPRESENTATION,
		"omittedBuildingIds":[],"invalidBuildingIds":[],"missingRoofFootprintIds":[],"budgetLimited":false,"sourceRoofAreaM2":0.0,"buildMs":0.0,"anchor":origin.duplicate()}
	var window := _window(focus,width)
	if window.is_empty() or not is_finite(edgeWidthM) or edgeWidthM<0: return result
	for axis in ["x","y","z"]:
		if not _finite(origin.get(axis)): return result
	var urban=packet.get("urban",{})
	if not urban is Dictionary: return result
	var packed: bool=UrbanReader.is_columns(urban)
	var records: Array=urban.get("buildings",[])
	var requested=packet.get("_cityMapVertexLimit",MAX_VERTICES)
	var budget := clampi(int(requested),3,MAX_VERTICES) if _finite(requested) else MAX_VERTICES
	var visible: Array=[]
	for index in records.size():
		var bounds: Dictionary=UrbanReader.building_bounds(urban,index)
		if float(bounds.get("maxX",-INF))<float(window.minX) or float(bounds.get("minX",INF))>float(window.maxX) or float(bounds.get("maxZ",-INF))<float(window.minZ) or float(bounds.get("minZ",INF))>float(window.maxZ): continue
		var x := clampf(float(focus.x),float(bounds.minX),float(bounds.maxX))-float(focus.x)
		var z := clampf(float(focus.y),float(bounds.minZ),float(bounds.maxZ))-float(focus.y)
		visible.append({"index":index,"distance":x*x+z*z})
	visible.sort_custom(func(a,b): return a.distance<b.distance if a.distance!=b.distance else a.index<b.index)
	var vertices: PackedVector3Array=result.vertices
	var normals: PackedVector3Array=result.normals
	var outlines: PackedVector3Array=result.outlineVertices
	var outline_normals: PackedVector3Array=result.outlineNormals
	for item in visible:
		var building: Dictionary=UrbanReader.building(urban,int(item.index)) if packed else records[int(item.index)]
		var id=building.get("id","")
		var surface=building.get("roofFootprint",[])
		if not surface is Array or surface.is_empty(): result.missingRoofFootprintIds.append(id); continue
		var plane := _plane(building)
		if plane.is_empty(): result.invalidBuildingIds.append(id); continue
		var triangles := triangulate(surface,origin,float(plane.height),budget-vertices.size()-outlines.size())
		if triangles.invalid: result.invalidBuildingIds.append(id); continue
		if triangles.budgetLimited: result.omittedBuildingIds.append(id); result.budgetLimited=true; continue
		if triangles.vertices.is_empty(): continue
		var stroke := _outline(surface,origin,float(plane.height),edgeWidthM,budget-vertices.size()-outlines.size()-triangles.vertices.size())
		if stroke.budgetLimited: result.omittedBuildingIds.append(id); result.budgetLimited=true; continue
		result.groups.append({"start":vertices.size(),"count":triangles.vertices.size(),"buildingId":id,"planeHeightM":plane.height,"planeHeightSource":plane.source,
			"outlineStart":outlines.size(),"outlineCount":stroke.vertices.size(),"sourceRoofAreaM2":triangles.areaM2,"representation":REPRESENTATION,"sourceRepresentation":building.get("representation",""),"presentation":building.get("presentation",{})})
		outlines.append_array(stroke.vertices)
		for i in stroke.vertices.size(): outline_normals.append(Vector3.UP)
		vertices.append_array(triangles.vertices)
		for i in triangles.vertices.size(): normals.append(Vector3.UP)
		result.buildingIds.append(id); result.sourceRoofAreaM2+=float(triangles.areaM2)
	result.vertices=vertices; result.normals=normals; result.outlineVertices=outlines; result.outlineNormals=outline_normals; result.buildMs=(Time.get_ticks_usec()-started)/1000.0
	return result
