class_name SurfaceData
extends RefCounted

static func read_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Cannot open " + path)
		return {}
	var value = JSON.parse_string(file.get_as_text())
	return value if value is Dictionary else {}

static func unpack_world(packet: Dictionary) -> Dictionary:
	var value = packet.get("world", packet)
	if value is String:
		value = JSON.parse_string(value)
	if not value is Dictionary or value.get("schemaVersion", 0) != 1:
		push_error("Expected SurfaceWorld schemaVersion=1")
		return {}
	return value

static func sample_grid(terrain: Dictionary, values: Array, x: float, z: float, categorical := false) -> float:
	var width := int(terrain.width)
	var height := int(terrain.height)
	var u := clampf((x-float(terrain.originX))/float(terrain.spacingM), 0.0, width-1.0)
	var v := clampf((z-float(terrain.originZ))/float(terrain.spacingM), 0.0, height-1.0)
	if categorical:
		var value = values[roundi(v)*width+roundi(u)]
		return float(value) if value != null else NAN
	var ix := int(u)
	var iz := int(v)
	var jx := mini(ix+1, width-1)
	var jz := mini(iz+1, height-1)
	var a = values[iz*width+ix]
	var b = values[iz*width+jx]
	var c = values[jz*width+ix]
	var d = values[jz*width+jx]
	if a == null or b == null or c == null or d == null:
		return NAN
	return lerpf(lerpf(float(a),float(b),u-ix),lerpf(float(c),float(d),u-ix),v-iz)

static func height_at(world: Dictionary, x: float, z: float) -> float:
	return sample_grid(world.terrain, world.terrain.heights, x, z)

static func field_at(world: Dictionary, name: String, x: float, z: float, categorical := false) -> float:
	var values: Array = world.fields.get(name, [])
	if values.is_empty():
		return 0.0
	return sample_grid(world.terrain, values, x, z, categorical)

# CPU work only; called by a Thread. Display interpolation never changes sourceLOD.
static func prepare(world: Dictionary, origin: Dictionary, view_width: float) -> Dictionary:
	var start := Time.get_ticks_usec()
	var terrain: Dictionary = world.terrain
	var size := 512
	# Terrain3D 1.0.2 clamps vertex_spacing to 0.25–100 m. Resampling a coarser
	# source is explicitly representation interpolation, never source refinement.
	var spacing := clampf(maxf(float(terrain.spacingM), view_width/440.0),0.25,100.0)
	# Region addresses stay local and exactly aligned to Terrain3D's region grid.
	var local_start := Vector3(-256.0*spacing,0.0,-256.0*spacing)
	var height := Image.create(size,size,false,Image.FORMAT_RF)
	var control := Image.create(size,size,false,Image.FORMAT_RF)
	var hole_bits := PackedByteArray([4,0,0,0]).decode_float(0)
	var bounds: Dictionary = world.bounds
	for z in size:
		for x in size:
			var wx: float = origin.x+local_start.x+x*spacing
			var wz: float = origin.z+local_start.z+z*spacing
			height.set_pixel(x,z,Color(height_at(world,wx,wz)-origin.y,0,0,1))
			if wx<float(bounds.minX) or wx>float(bounds.maxX) or wz<float(bounds.minZ) or wz>float(bounds.maxZ):
				control.set_pixel(x,z,Color(hole_bits,0,0,1))
	# Native context resolution remains independent of the representation mesh.
	var ids := Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RF)
	var state := Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RGBAF)
	var rock := Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RF)
	for z in int(terrain.height):
		for x in int(terrain.width):
			var i: int = z*int(terrain.width)+x
			ids.set_pixel(x,z,Color(float(world.fields.material[i]),0,0,1))
			state.set_pixel(x,z,Color(float(world.fields.treeCover[i]),float(world.fields.wetness[i]),float(world.fields.snow[i]),float(world.fields.grassCover[i])))
			rock.set_pixel(x,z,Color(float(world.fields.bedrock[i]),0,0,1))
	state.generate_mipmaps()
	return {"worldId":world.id,"origin":origin,"spacing":spacing,"localStart":local_start,"height":height,"control":control,"ids":ids,"state":state,"rock":rock,"prepareMs":(Time.get_ticks_usec()-start)/1000.0}

static func make_mesh(vertices: PackedVector3Array, normals: PackedVector3Array = PackedVector3Array()) -> ArrayMesh:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	if normals.size() == vertices.size():
		arrays[Mesh.ARRAY_NORMAL] = normals
	else:
		var generated := PackedVector3Array()
		for i in range(0,vertices.size(),3):
			var normal := (vertices[i+1]-vertices[i]).cross(vertices[i+2]-vertices[i]).normalized()
			generated.append_array(PackedVector3Array([normal,normal,normal]))
		arrays[Mesh.ARRAY_NORMAL] = generated
	var mesh := ArrayMesh.new()
	if not vertices.is_empty():
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	return mesh


