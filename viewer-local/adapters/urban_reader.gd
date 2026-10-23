class_name SurfaceUrbanReader
extends RefCounted

# Renderer-neutral, lazy reader. Coordinate columns remain float64 until a
# consumer subtracts its render origin. Never expands the whole city to Variants.
const SURFACE_KEYS := ["footprint","roofFootprint","floor","surface"]

static func is_columns(urban: Dictionary) -> bool:
	return urban.get("format","")=="magna-urban-columns"

static func _numeric_sequence(value) -> bool:
	return typeof(value) in [TYPE_ARRAY,TYPE_PACKED_BYTE_ARRAY,TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_INT64_ARRAY,TYPE_PACKED_FLOAT32_ARRAY,TYPE_PACKED_FLOAT64_ARRAY]

static func _offsets(values, end: int) -> bool:
	if not _numeric_sequence(values) or values.size()<1 or int(values[0])!=0 or int(values[values.size()-1])!=end: return false
	for i in range(1,values.size()):
		if not is_finite(float(values[i])) or float(values[i])!=floorf(float(values[i])) or int(values[i])<int(values[i-1]) or int(values[i])>end: return false
	return true

static func validate(urban: Dictionary) -> bool:
	if not urban.get("buildings",[]) is Array or not urban.get("roads",[]) is Array: return false
	if not is_columns(urban): return true
	if urban.get("version",0)!=1: return false
	for name in ["positions","normals","surfacePositions","roadPositions","buildingTriangleOffsets","triangleSlots","triangleMaterial","triangleMaterialPresence","triangleSurface","surfaceShapeOffsets","shapeRingOffsets","ringPointOffsets","roadPointOffsets"]:
		if not urban.has(name) or not _numeric_sequence(urban[name]): return false
		if urban[name] is Array:
			for value in urban[name]:
				if not (value is int or value is float) or not is_finite(float(value)): return false
	var count := int(urban.positions.size()/9)
	if urban.positions.size()%9!=0 or urban.normals.size()!=count*3 or urban.surfacePositions.size()%2!=0 or urban.roadPositions.size()%2!=0: return false
	if not _offsets(urban.buildingTriangleOffsets,count) or urban.buildingTriangleOffsets.size()!=urban.buildings.size()+1: return false
	for name in ["triangleSlots","triangleMaterial","triangleMaterialPresence","triangleSurface"]:
		if urban[name].size()!=count: return false
	if not urban.get("materialSlotsTable") is Array or not urban.get("materialIds") is Array or not urban.get("occupationBuildings",[]) is Array: return false
	for slots in urban.materialSlotsTable:
		if not slots is Dictionary: return false
	for id in urban.materialIds:
		if not id is String: return false
	if not _offsets(urban.surfaceShapeOffsets,urban.shapeRingOffsets.size()-1) or not _offsets(urban.shapeRingOffsets,urban.ringPointOffsets.size()-1): return false
	if not _offsets(urban.ringPointOffsets,int(urban.surfacePositions.size()/2)) or not _offsets(urban.roadPointOffsets,int(urban.roadPositions.size()/2)) or urban.roadPointOffsets.size()!=urban.roads.size()+1: return false
	for name in ["positions","normals","surfacePositions","roadPositions"]:
		for coordinate in urban[name]:
			if not is_finite(float(coordinate)): return false
	for i in count:
		if int(urban.triangleSlots[i])<0 or int(urban.triangleSlots[i])>=urban.materialSlotsTable.size(): return false
		if int(urban.triangleMaterial[i]) < -1 or int(urban.triangleMaterial[i])>=urban.materialIds.size(): return false
		if int(urban.triangleSurface[i])<0 or int(urban.triangleSurface[i])>1 or int(urban.triangleMaterialPresence[i])<0 or int(urban.triangleMaterialPresence[i])>1 or (int(urban.triangleMaterial[i])>=0 and int(urban.triangleMaterialPresence[i])==0): return false
	for record in urban.buildings:
		if not record is Dictionary or not _validate_metadata(urban,record): return false
	for record in urban.get("occupationBuildings",[]):
		if not record is Dictionary or not _validate_metadata(urban,record): return false
	for record in urban.roads:
		if not record is Dictionary or not _validate_metadata(urban,record): return false
	return true

static func _surface_id(urban: Dictionary, value) -> bool:
	return (value is int or value is float) and float(value)==floorf(float(value)) and int(value)>=0 and int(value)<urban.surfaceShapeOffsets.size()-1

static func _validate_metadata(urban: Dictionary, value, key := "") -> bool:
	if SURFACE_KEYS.has(key) and (key!="surface" or value is int or value is float): return _surface_id(urban,value)
	if key=="surfaces":
		if not value is Array: return false
		for id in value:
			if not _surface_id(urban,id): return false
		return true
	if value is Dictionary:
		for name in value:
			if not _validate_metadata(urban,value[name],str(name)): return false
	elif value is Array:
		for child in value:
			if not _validate_metadata(urban,child): return false
	return true

static func surface(urban: Dictionary, index: int) -> Array:
	var result: Array = []
	if index<0 or index>=urban.surfaceShapeOffsets.size()-1: return result
	for shape in range(int(urban.surfaceShapeOffsets[index]),int(urban.surfaceShapeOffsets[index+1])):
		var rings: Array = []
		for ring in range(int(urban.shapeRingOffsets[shape]),int(urban.shapeRingOffsets[shape+1])):
			var points: Array = []
			for point in range(int(urban.ringPointOffsets[ring]),int(urban.ringPointOffsets[ring+1])):
				points.append({"x":float(urban.surfacePositions[point*2]),"y":float(urban.surfacePositions[point*2+1])})
			rings.append(points)
		if not rings.is_empty(): result.append({"outer":rings[0],"holes":rings.slice(1)})
	return result

static func _metadata(urban: Dictionary, value, key := ""):
	if SURFACE_KEYS.has(key) and (key!="surface" or value is int or value is float): return surface(urban,int(value))
	if key=="surfaces":
		var result: Array = []
		for id in value: result.append(surface(urban,int(id)))
		return result
	if value is Dictionary:
		var result: Dictionary = {}
		for name in value: result[name]=_metadata(urban,value[name],str(name))
		return result
	if value is Array:
		var result: Array = []
		for child in value: result.append(_metadata(urban,child))
		return result
	return value

static func building(urban: Dictionary, index: int) -> Dictionary:
	if index<0 or index>=urban.get("buildings",[]).size(): return {}
	if not is_columns(urban): return urban.buildings[index]
	var result: Dictionary = _metadata(urban,urban.buildings[index])
	var triangles: Array = []
	for i in range(int(urban.buildingTriangleOffsets[index]),int(urban.buildingTriangleOffsets[index+1])):
		var points: Array = []
		for vertex in 3:
			var offset: int = i*9+vertex*3
			points.append([float(urban.positions[offset]),float(urban.positions[offset+1]),float(urban.positions[offset+2])])
		var triangle := {"points":points,"normal":[float(urban.normals[i*3]),float(urban.normals[i*3+1]),float(urban.normals[i*3+2])],"surface":"roof" if int(urban.triangleSurface[i]) else "wall","materials":urban.materialSlotsTable[int(urban.triangleSlots[i])].duplicate(true)}
		if int(urban.triangleMaterialPresence[i]):
			# Godot Variant null retains presence where JavaScript has an explicit undefined.
			triangle.material=urban.materialIds[int(urban.triangleMaterial[i])] if int(urban.triangleMaterial[i])>=0 else null
		triangles.append(triangle)
	result.triangles=triangles
	return result

static func occupation_building(urban: Dictionary, index: int) -> Dictionary:
	var values: Array = urban.get("occupationBuildings",[])
	if index<0 or index>=values.size(): return {}
	return _metadata(urban,values[index]) if is_columns(urban) else values[index]

static func road(urban: Dictionary, index: int) -> Dictionary:
	if index<0 or index>=urban.get("roads",[]).size(): return {}
	if not is_columns(urban): return urban.roads[index]
	var result: Dictionary = _metadata(urban,urban.roads[index])
	var points: Array = []
	for i in range(int(urban.roadPointOffsets[index]),int(urban.roadPointOffsets[index+1])):
		points.append([float(urban.roadPositions[i*2]),float(urban.roadPositions[i*2+1])])
	result.points=points
	return result

static func building_bounds(urban: Dictionary, index: int) -> Dictionary:
	var result := {"minX":INF,"minZ":INF,"maxX":-INF,"maxZ":-INF}
	if index<0 or index>=urban.get("buildings",[]).size(): return result
	var record: Dictionary = urban.buildings[index]
	for key in ["footprint","roofFootprint"]:
		var value = record.get(key,[])
		if is_columns(urban) and _surface_id(urban,value):
			for shape in range(int(urban.surfaceShapeOffsets[int(value)]),int(urban.surfaceShapeOffsets[int(value)+1])):
				for ring in range(int(urban.shapeRingOffsets[shape]),int(urban.shapeRingOffsets[shape+1])):
					for point in range(int(urban.ringPointOffsets[ring]),int(urban.ringPointOffsets[ring+1])):
						_extend_bounds(result,float(urban.surfacePositions[point*2]),float(urban.surfacePositions[point*2+1]))
		elif value is Array:
			for shape in value:
				for point in shape.get("outer",[]): _extend_bounds(result,float(point.x),float(point.y))
	if result.minX==INF:
		if is_columns(urban):
			for i in range(int(urban.buildingTriangleOffsets[index])*9,int(urban.buildingTriangleOffsets[index+1])*9,3): _extend_bounds(result,float(urban.positions[i]),float(urban.positions[i+2]))
		else:
			for triangle in record.get("triangles",[]):
				for point in triangle.points: _extend_bounds(result,float(point[0]),float(point[2]))
	return result

static func _extend_bounds(bounds: Dictionary, x: float, z: float) -> void:
	bounds.minX=minf(bounds.minX,x); bounds.minZ=minf(bounds.minZ,z)
	bounds.maxX=maxf(bounds.maxX,x); bounds.maxZ=maxf(bounds.maxZ,z)
