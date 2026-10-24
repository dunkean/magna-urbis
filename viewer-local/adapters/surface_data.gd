class_name SurfaceData
extends RefCounted
const SourceCoverage=preload("res://adapters/surface_source_coverage.gd")
const PrepareControl=preload("res://adapters/surface_prepare_control.gd")
const Geometry = preload("res://adapters/surface_geometry.gd")
const UrbanReader = preload("res://adapters/urban_reader.gd")
const Layers=preload("res://adapters/surface_layers.gd")
const Detail=preload("res://adapters/surface_geometry_detail.gd")
const MAX_PACKET_BYTES := 512*1024*1024

static func read_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Cannot open " + path)
		return {}
	return decode_packet(file.get_buffer(file.get_length()))

static func _sequence(value) -> bool:
	return typeof(value) in [TYPE_ARRAY,TYPE_PACKED_BYTE_ARRAY,TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_INT64_ARRAY,TYPE_PACKED_FLOAT32_ARRAY,TYPE_PACKED_FLOAT64_ARRAY]

static func _integer(value, minimum: int, maximum: int) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and floorf(float(value))==float(value) and float(value)>=minimum and float(value)<=maximum

static func decode_packet(bytes: PackedByteArray) -> Dictionary:
	if bytes.size()>MAX_PACKET_BYTES: return {}
	if bytes.size()>=16 and bytes.slice(0,8).get_string_from_ascii()=="MUFSURF1":
		var manifest_length := bytes.decode_u32(8)
		var payload_length := bytes.decode_u32(12)
		var payload_start := int(ceil(float(16+manifest_length)/8.0))*8
		if manifest_length<=0 or manifest_length>16*1024*1024 or payload_start+payload_length!=bytes.size():
			push_error("Surface binary length mismatch")
			return {}
		var manifest = JSON.parse_string(bytes.slice(16,16+manifest_length).get_string_from_utf8())
		if not manifest is Dictionary or manifest.get("format","")!="magna-surface-binary" or manifest.get("version",0)!=1:
			push_error("Unsupported surface binary manifest")
			return {}
		if not manifest.get("value") is Dictionary or not manifest.get("arrays") is Array or manifest.arrays.size()>4096: return {}
		var packet: Dictionary = manifest.value
		var strides := {"f32":4,"f64":8,"u8":1,"u16":2,"i32":4,"u32":4}
		var decoded_blocks: Dictionary = {}
		var paths := {}
		# Validate every address before decoding any payload allocation.
		for descriptor in manifest.arrays:
			if not descriptor is Dictionary or not strides.has(descriptor.get("dtype","")): return {}
			var expected=Layers.expected_wire_dtype(descriptor.get("path",[]))
			if not expected.is_empty() and descriptor.dtype!=expected:return {}
			var stride: int = strides[descriptor.dtype]
			if not _integer(descriptor.get("length"),0,MAX_PACKET_BYTES/stride) or not _integer(descriptor.get("offset"),0,payload_length): return {}
			if int(descriptor.offset)%stride!=0 or int(descriptor.offset)+int(descriptor.length)*stride>payload_length: return {}
			var path = descriptor.get("path")
			if not path is Array or path.is_empty() or path.size()>32: return {}
			var path_key := JSON.stringify(path)
			if paths.has(path_key): return {}
			paths[path_key]=true
			var node = packet
			for component in path:
				if node is Dictionary:
					if not component is String or not node.has(component): return {}
					node=node[component]
				elif node is Array:
					if not _integer(component,0,node.size()-1): return {}
					node=node[int(component)]
				else: return {}
			if node!=null: return {}
		for descriptor in manifest.arrays:
			var dtype: String = descriptor.dtype
			var count := int(descriptor.length)
			var offset := int(descriptor.offset)
			if not strides.has(dtype) or count<0 or offset<0 or offset+count*int(strides[dtype])>payload_length:
				push_error("Surface binary array bounds mismatch")
				return {}
			var block_key := dtype+":"+str(offset)+":"+str(count)
			var data := bytes.slice(payload_start+offset,payload_start+offset+count*int(strides[dtype])) if not decoded_blocks.has(block_key) else PackedByteArray()
			var decoded
			if decoded_blocks.has(block_key): decoded=decoded_blocks[block_key]
			match dtype if decoded==null else "cached":
				"f32": decoded = data.to_float32_array()
				"f64": decoded = data.to_float64_array()
				"i32": decoded = data.to_int32_array()
				"u8": decoded = data
				"u16":
					decoded = PackedInt32Array()
					decoded.resize(count)
					for i in count: decoded[i] = data.decode_u16(i*2)
				"u32":
					decoded = PackedInt64Array()
					decoded.resize(count)
					for i in count: decoded[i] = data.decode_u32(i*4)
			decoded_blocks[block_key]=decoded
			var cursor = packet
			var address: Array = descriptor.path
			for i in address.size()-1:
				cursor = cursor[int(address[i])] if cursor is Array else cursor[str(address[i])]
			if cursor is Array: cursor[int(address.back())] = decoded
			else: cursor[str(address.back())] = decoded
		return _validate_packet(packet)
	var value = JSON.parse_string(bytes.get_string_from_utf8())
	return _validate_packet(value) if value is Dictionary else {}

static func _validate_packet(packet: Dictionary) -> Dictionary:
	var world = packet.get("world",packet)
	if world is Dictionary and world.has("terrain"):
		world.erase("_validated")
		if not validate_world(world): return {}
	if packet.has("urban"):
		if not packet.urban is Dictionary or not UrbanReader.validate(packet.urban): return {}
		packet["_cityIdentity"]=Geometry.city_identity(packet)
	if packet.has("terrainParents"):
		if not packet.terrainParents is Array or packet.terrainParents.size()>6: return {}
		for parent in packet.terrainParents:
			if not parent is Dictionary or not parent.get("terrain") is Dictionary or not parent.get("bounds") is Dictionary: return {}
			var reference=world.get("canonicalContextRef")
			if reference is Dictionary and (not parent.get("canonicalContextId") is String or parent.canonicalContextId!=str(reference.get("id",""))):
				push_error("Terrain parent canonicalContextId does not match the packet context; refusing partial display")
				return {}
			var grid: Dictionary = parent.terrain
			var n := int(grid.get("width",0))*int(grid.get("height",0))
			if not _validate_grid(grid,1048576): return {}
			if not grid.get("source") is Dictionary or not world is Dictionary or grid.source.id!=world.terrain.source.id or grid.source.version!=world.terrain.source.version: return {}
			for height in grid.heights:
				if height==null or not is_finite(float(height)): return {}
	if not _index_candidates(packet): return {}
	return packet

static func _index_candidates(packet: Dictionary) -> bool:
	var columns: Dictionary = packet.get("candidateColumns",{})
	var candidates: Array = packet.get("candidates",packet.get("populations",[]))
	var count := candidates.size() if columns.is_empty() else int(columns.get("count",-1))
	if count<0 or count>100000 or (not columns.is_empty() and not _integer(columns.get("count"),0,100000)):
		push_error("Candidate budget exceeded (100000)")
		return false
	if not columns.is_empty():
		if columns.get("format","")!="surface-candidate-columns" or columns.get("version",0)!=1: return false
		for name in ["ids","family","size","orientation","rank","variant","crownRadiusM"]:
			if not _sequence(columns.get(name)) or columns[name].size()!=count: return false
		if not _sequence(columns.get("positions")) or columns.positions.size()!=count*3 or not columns.get("families") is Array: return false
	var candidate_ids := {}
	var buckets: Dictionary = {}
	var maximum_crown := 0.0
	var family_counts:Dictionary={}
	for i in count:
		var x: float = columns.positions[i*3] if not columns.is_empty() else float(candidates[i].x)
		var z: float = columns.positions[i*3+2] if not columns.is_empty() else float(candidates[i].z)
		var size: float = columns.size[i] if not columns.is_empty() else float(candidates[i].size)
		if not is_finite(x) or not is_finite(z) or not is_finite(size) or size<=0: return false
		if not columns.is_empty() and (int(columns.family[i])<0 or int(columns.family[i])>=columns.families.size()): return false
		if not columns.is_empty():
			if not columns.ids[i] is String or columns.ids[i].is_empty() or candidate_ids.has(columns.ids[i]): return false
			candidate_ids[columns.ids[i]]=true
			for value in [columns.positions[i*3+1],columns.orientation[i],columns.rank[i]]:
				if not (value is float or value is int) or not is_finite(float(value)): return false
			if float(columns.rank[i])<0 or float(columns.rank[i])>=1 or (not is_nan(float(columns.crownRadiusM[i])) and (not is_finite(float(columns.crownRadiusM[i])) or float(columns.crownRadiusM[i])<=0)) or not _integer(columns.variant[i],0,255): return false
		var family=str(columns.families[int(columns.family[i])]) if not columns.is_empty() else str(candidates[i].get("family",""))
		family_counts[family]=int(family_counts.get(family,0))+1
		var crown: float = columns.crownRadiusM[i] if not columns.is_empty() else float(candidates[i].get("crownRadiusM",size*0.42))
		if is_finite(crown): maximum_crown=maxf(maximum_crown,crown)
		var address := Vector2i(floori(x/128.0),floori(z/128.0))
		if not buckets.has(address): buckets[address]=[]
		buckets[address].append(i)
	packet["_candidateBuckets"]=buckets
	packet["_maximumCrownRadiusM"]=maximum_crown
	return _validate_candidate_pages(packet,family_counts)

static func _validate_candidate_pages(packet:Dictionary,family_counts:Dictionary)->bool:
	if not packet.has("candidatePages"):return true
	var pages=packet.candidatePages
	if not pages is Dictionary or pages.get("version")!="surface-candidate-pages-1":return false
	for family in ["tree","shrub","boulder","grass","debris"]:
		var page=pages.get(family)
		if not page is Dictionary or not _integer(page.get("count"),0,100000) or int(page.count)!=int(family_counts.get(family,0)):return false
		if not page.get("complete") is bool or not page.get("includeOverhang") is bool or not _finite_number(page.get("retention")) or float(page.retention)<0 or float(page.retention)>1:return false
		if page.get("limitedBy") not in ["none","candidate-budget","slot-budget"]:return false
		for name in ["bounds","requestedBounds"]:
			var bounds=page.get(name)
			if not bounds is Dictionary:return false
			for field in ["minX","minZ","maxX","maxZ"]:
				if not _finite_number(bounds.get(field)):return false
			if float(bounds.minX)>=float(bounds.maxX) or float(bounds.minZ)>=float(bounds.maxZ):return false
		if float(page.bounds.minX)<float(page.requestedBounds.minX)-0.000001 or float(page.bounds.minZ)<float(page.requestedBounds.minZ)-0.000001 or float(page.bounds.maxX)>float(page.requestedBounds.maxX)+0.000001 or float(page.bounds.maxZ)>float(page.requestedBounds.maxZ)+0.000001:return false
	return true

static func _finite_number(value)->bool:
	return (value is float or value is int) and is_finite(float(value))

static func unpack_world(packet: Dictionary) -> Dictionary:
	var value = packet.get("world", packet)
	if value is String:
		value = JSON.parse_string(value)
	if not value is Dictionary or value.get("schemaVersion", 0) != 1:
		push_error("Expected SurfaceWorld schemaVersion=1")
		return {}
	if not value.get("_validated",false) and not validate_world(value): return {}
	return value

static func validate_world(world: Dictionary) -> bool:
	if not Layers.validate(world):return false
	if not world.get("terrain") is Dictionary or not world.get("fields") is Dictionary or not world.get("materials") is Array:
		push_error("Malformed SurfaceWorld dictionaries")
		return false
	var t: Dictionary = world.terrain
	var n := int(t.get("width",0))*int(t.get("height",0))
	if world.materials.is_empty() or world.materials.size()>32: return false
	if not _validate_grid(t,4194304) or not world.get("bounds") is Dictionary or not world.get("id") is String or world.id.is_empty(): return false
	for name in ["originX","originZ","spacingM"]:
		if not t.has(name) or not is_finite(float(t[name])): return false
	for name in ["id","version","sourceLOD","nativeSpacingM"]:
		if not t.source.has(name): return false
	for recipe in world.materials:
		if not recipe is Dictionary or not recipe.get("colorLinear") is Array or recipe.colorLinear.size()!=3: return false
		for value in recipe.colorLinear:
			if value==null or not is_finite(float(value)) or float(value)<0 or float(value)>1: return false
		if not recipe.has("roughness") or not is_finite(float(recipe.roughness)) or not recipe.has("physicalExtentMetres") or float(recipe.physicalExtentMetres)<=0: return false
	for name in ["minX","minZ","maxX","maxZ"]:
		if not world.bounds.has(name) or not is_finite(float(world.bounds[name])): return false
	if float(world.bounds.minX)>float(world.bounds.maxX) or float(world.bounds.minZ)>float(world.bounds.maxZ): return false
	var minimum := INF
	var maximum := -INF
	for height in t.heights:
		if height==null or not is_finite(float(height)):
			push_error("Terrain height is not finite")
			return false
		minimum=minf(minimum,float(height)); maximum=maxf(maximum,float(height))
	world["_heightRange"] = Vector2(minimum,maximum)
	if not _validate_fields(world.fields,n,world.materials.size()): return false
	if world.has("canonicalContext"):
		var canonical: Dictionary = world.canonicalContext
		if not canonical.get("grid") is Dictionary or not canonical.get("fields") is Dictionary: return false
		var cn := int(canonical.grid.get("width",0))*int(canonical.grid.get("height",0))
		if not _validate_geometry(canonical.grid,1048576) or cn+n>2097152 or not _validate_fields(canonical.fields,cn,world.materials.size()): return false
		if not canonical.get("source") is Dictionary or canonical.source.get("id")!=t.source.id or canonical.source.get("version")!=t.source.version: return false
	elif n>1048576:
		push_error("Context sample budget exceeded (1M); use a coarser canonical context")
		return false
	if world.has("geometryDetail") and not Detail.validate(world.geometryDetail,world):
		push_error("Source geometry detail validation failed")
		return false
	world["_validated"]=true
	return true

static func _validate_geometry(grid: Dictionary, budget: int) -> bool:
	if not _integer(grid.get("width"),2,budget) or not _integer(grid.get("height"),2,budget): return false
	if int(grid.width)*int(grid.height)>budget: return false
	for name in ["originX","originZ","spacingM"]:
		if not (grid.get(name) is float or grid.get(name) is int) or not is_finite(float(grid[name])): return false
	return float(grid.spacingM)>0

static func _validate_grid(grid: Dictionary, budget: int) -> bool:
	if not _validate_geometry(grid,budget): return false
	var n := int(grid.width)*int(grid.height)
	if not _sequence(grid.get("heights")) or grid.heights.size()!=n or not grid.get("source") is Dictionary: return false
	if not ["bilinear-samples","cubic-bspline-controls"].has(grid.get("reconstruction","bilinear-samples")): return false
	var source: Dictionary = grid.source
	for name in ["id","version"]:
		if not source.get(name) is String or source[name].is_empty(): return false
	for name in ["sourceLOD","nativeSpacingM"]:
		if not (source.get(name) is float or source.get(name) is int) or not is_finite(float(source[name])): return false
	if float(source.nativeSpacingM)<=0: return false
	for value in grid.heights:
		if not (value is float or value is int) or not is_finite(float(value)): return false
	return true

static func _validate_fields(f: Dictionary, n: int, material_count: int) -> bool:
	for name in ["material","treeCover","grassCover","wetness","snow","bedrock","waterClass","waterLevelM"]:
		if not _sequence(f.get(name)) or f[name].size()!=n:
			push_error("Missing or mis-sized field: "+name)
			return false
	for i in n:
		if not _integer(f.material[i],0,material_count-1): return false
		if f.has("materialSecondary") and (not _sequence(f.materialSecondary) or f.materialSecondary.size()!=n or int(f.materialSecondary[i])<0 or int(f.materialSecondary[i])>=material_count): return false
		if f.has("materialBlend") and (not _sequence(f.materialBlend) or f.materialBlend.size()!=n or not is_finite(float(f.materialBlend[i])) or float(f.materialBlend[i])<0 or float(f.materialBlend[i])>1): return false
		for name in ["treeCover","grassCover","wetness","snow"]:
			if f[name][i]==null or not is_finite(float(f[name][i])) or float(f[name][i])<0 or float(f[name][i])>1: return false
		if not _integer(f.waterClass[i],0,3) or not _integer(f.bedrock[i],0,65535): return false
		if int(f.waterClass[i])>0 and (f.waterLevelM[i]==null or not is_finite(float(f.waterLevelM[i]))): return false
	return true

static func sample_grid(terrain: Dictionary, values, x: float, z: float, categorical := false) -> float:
	if not categorical and terrain.get("reconstruction","bilinear-samples")=="cubic-bspline-controls":
		return Geometry.sample_grid_values(terrain,values,x,z)
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
	return Geometry.height_at(world,x,z)

static func contains(bounds: Dictionary, x: float, z: float) -> bool:
	return x>=float(bounds.minX) and x<=float(bounds.maxX) and z>=float(bounds.minZ) and z<=float(bounds.maxZ)

static func covered(world: Dictionary, x: float, z: float) -> bool:
	if contains(world.bounds,x,z): return true
	for parent in world.get("_terrainParents",[]):
		if contains(parent.bounds,x,z): return true
	return false

static func context(world: Dictionary) -> Dictionary:
	return world.get("canonicalContext",{"grid":world.terrain,"fields":world.fields,"bounds":world.bounds})

static func field_at(world: Dictionary, name: String, x: float, z: float, categorical := false) -> float:
	var canonical := context(world)
	var values = canonical.fields.get(name, [])
	if values.is_empty():
		return 0.0
	return sample_grid(canonical.grid, values, x, z, categorical)

# CPU work only; called by a Thread. Display interpolation never changes sourceLOD.
static func prepare(world: Dictionary, origin: Dictionary, view_width: float, serial := 0, packet: Dictionary = {}, skip_context := false, display_source: Dictionary = {}, skip_height := false, scene_request: Dictionary = {}) -> Dictionary:
	var start := Time.get_ticks_usec()
	var control_token=scene_request.get("prepareControl")
	if PrepareControl.hit(control_token,"data-start"):return PrepareControl.result(control_token,"data-start",start)
	var terrain: Dictionary = world.terrain
	var source_domains=SourceCoverage.domains(world)
	if source_domains.is_empty():
		push_error("Source rendering domains have invalid lineage or bounds; retaining prior scene")
		return PrepareControl.result(control_token,"invalid-source-domains",start)
	var spacing := display_spacing(terrain,view_width,int(scene_request.get("displaySamples",256)))
	if display_source.is_empty(): display_source=build_display_source(world,spacing,control_token)
	if PrepareControl.hit(control_token,"display-source"):return PrepareControl.result(control_token,"display-source",start)
	# Terrain3D 1.0.2 import_images floors to 256-sample region origins.
	# The symmetric start must therefore remain a multiple of 256 samples.
	var size := 512
	while size*spacing<float(scene_request.get("heightCoverageExtentM",view_width*2.0)) and size<2048: size*=2
	# Region addresses stay local and exactly aligned to Terrain3D's region grid.
	var local_start := Vector3(-size*0.5*spacing,0.0,-size*0.5*spacing)
	var height := Image.create(size,size,false,Image.FORMAT_RF)
	var control := Image.create(size,size,false,Image.FORMAT_RF)
	# This adapter authors hole bits ONLY outside validated height domains.
	# No source cave/water raster is interpreted as a terrain cutout.
	var hole_bits := PackedByteArray([4,0,0,0]).decode_float(0)
	var loaded_minimum=INF;var loaded_maximum=-INF
	var edge_support_cache:Dictionary={}
	var edge_sampler=func(x:float,z:float)->float:return height_at(display_source,x,z)
	for z in (0 if skip_height else size):
		if z%8==0 and PrepareControl.hit(control_token,"height-rows"):return PrepareControl.result(control_token,"height-rows",start)
		for x in size:
			var wx: float = origin.x+local_start.x+x*spacing
			var wz: float = origin.z+local_start.z+z*spacing
			var has_source:=covered(world,wx,wz)
			# Tessellation-only edge extension. Native hole bits remain set and
			# the visual shader discards fragments outside the exact source union.
			var altitude:float
			if has_source:altitude=height_at(display_source,wx,wz)
			else:
				var sample_point=SourceCoverage.nearest_point(source_domains,wx,wz)
				altitude=SourceCoverage.cached_edge_height(edge_support_cache,float(sample_point.x),float(sample_point.z),edge_sampler)
			height.set_pixel(x,z,Color(altitude-origin.y,0,0,1))
			if has_source:loaded_minimum=minf(loaded_minimum,altitude);loaded_maximum=maxf(loaded_maximum,altitude)
			if not has_source:
				control.set_pixel(x,z,Color(hole_bits,0,0,1))
	if PrepareControl.hit(control_token,"height-complete"):return PrepareControl.result(control_token,"height-complete",start)
	# Native context resolution remains independent of the representation mesh.
	var canonical := context(world)
	terrain = canonical.grid
	var fields: Dictionary = canonical.fields
	var result := {"loadedHeightRangeWorld":Vector2(loaded_minimum-.01,loaded_maximum+.01),"worldId":world.id,"world":world,"packet":packet,"generation":serial,"origin":origin,"spacing":spacing,"localStart":local_start,"height":null if skip_height else height,"control":null if skip_height else control,"sourceCoverageRects":SourceCoverage.rebased_rects(source_domains,origin),"sourceCoverageCount":source_domains.size(),"contextGrid":terrain,"displaySource":display_source,"sceneRequest":scene_request}
	var layers=Layers.prepare(world,canonical)
	if PrepareControl.hit(control_token,"layer-images"):return PrepareControl.result(control_token,"layer-images",start)
	result.surfaceLayers=layers
	result.surfaceLayersMetadata=layers.get("metadata",{}).duplicate(true)
	result.surfaceLayersMetadata["fieldsVersion"]=world.get("surfaceLayers",{}).get("fieldsVersion","")
	result.surfaceLayersMetadata["canonicalVersion"]=world.get("versions",{}).get("surfaceLayers","")
	if skip_context:
		if PrepareControl.hit(control_token,"before-scene-geometry"):return PrepareControl.result(control_token,"before-scene-geometry",start)
		_append_scene(result,world,packet,origin,view_width,scene_request)
		result.prepareMs=(Time.get_ticks_usec()-start)/1000.0
		return result
	var ids:Image=layers.groundIds if layers.get("available",false) else Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RGBAF)
	var state := Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RGBAF)
	var rock := Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RF)
	var average:Image=layers.groundAverage if layers.get("available",false) else Image.create(int(terrain.width),int(terrain.height),false,Image.FORMAT_RGBAF)
	for z in int(terrain.height):
		if z%8==0 and PrepareControl.hit(control_token,"context-rows"):return PrepareControl.result(control_token,"context-rows",start)
		for x in int(terrain.width):
			var i: int = z*int(terrain.width)+x
			state.set_pixel(x,z,Color(float(fields.treeCover[i]),float(fields.wetness[i]),float(fields.snow[i]),float(fields.grassCover[i])))
			rock.set_pixel(x,z,Color(float(fields.bedrock[i]),0,0,1))
			if layers.get("available",false):continue
			var primary := int(fields.material[i])
			var secondary := int(fields.materialSecondary[i]) if fields.has("materialSecondary") else primary
			var blend := float(fields.materialBlend[i]) if fields.has("materialBlend") else 0.0
			ids.set_pixel(x,z,Color(float(primary),float(secondary),blend,1))
			var material: Dictionary = world.materials[primary]
			var rgb: Array = material.colorLinear
			var rgb_secondary: Array = world.materials[secondary].colorLinear
			var mean_color := Color(float(rgb[0]),float(rgb[1]),float(rgb[2])).lerp(Color(float(rgb_secondary[0]),float(rgb_secondary[1]),float(rgb_secondary[2])),blend)
			if fields.has("materialMeanColor"):
				var packed: int = fields.materialMeanColor[i]
				mean_color = Color(float(packed&255)/255.0,float((packed>>8)&255)/255.0,float((packed>>16)&255)/255.0).srgb_to_linear()
			mean_color.a = lerpf(float(material.roughness),float(world.materials[secondary].roughness),blend)
			average.set_pixel(x,z,mean_color)
	state.generate_mipmaps()
	average.generate_mipmaps()
	result.merge({"ids":ids,"state":state,"rock":rock,"average":average,"prepareMs":(Time.get_ticks_usec()-start)/1000.0})
	if PrepareControl.hit(control_token,"before-scene-geometry"):return PrepareControl.result(control_token,"before-scene-geometry",start)
	_append_scene(result,world,packet,origin,view_width,scene_request)
	result.prepareMs=(Time.get_ticks_usec()-start)/1000.0
	return result

static func _append_scene(result: Dictionary, world: Dictionary, packet: Dictionary, origin: Dictionary, view_width: float, request: Dictionary) -> void:
	if request.is_empty(): return
	var geometry_world := world.duplicate(false)
	geometry_world["_displaySource"]=result.displaySource
	geometry_world["_displaySpacing"]=result.spacing
	geometry_world["_heightLayers"]=Geometry.prepare_height_layers(world)
	if request.get("buildWater",false): result.waterGeometry=Geometry.build_water(geometry_world,origin,request.focus,view_width)
	if request.get("buildUrban",false): result.urbanGeometry=Geometry.build_urban(packet,geometry_world,origin,request.focus,view_width)

static func display_spacing(terrain: Dictionary, view_width: float, sampleBudget: int = 256) -> float:
	var base := float(terrain.spacingM)
	var budget:=clampi(sampleBudget,1,256)
	# Pinned Terrain3D 1.0.2 clamps its actual vertex spacing to [0.25,100].
	# Larger representation values would silently rescale imported source data.
	var target:=clampf(view_width/float(budget),0.25,100.0)
	var exponent := floorf(log(target/base)/log(2.0))
	var spacing := base*pow(2.0,exponent)
	if spacing<0.25: spacing*=2.0
	return spacing

static func build_display_source(world: Dictionary, spacing: float,control_token=null) -> Dictionary:
	var display := world.duplicate(false)
	display.terrain=_prefilter_grid(world.terrain,spacing,control_token)
	if PrepareControl.hit(control_token,"prefilter-root-complete"):return {}
	var parents: Array = []
	for parent in world.get("_terrainParents",[]):
		if PrepareControl.hit(control_token,"prefilter-parent"):return {}
		var filtered=_prefilter_grid(parent.terrain,spacing,control_token)
		if PrepareControl.hit(control_token,"prefilter-parent-complete"):return {}
		parents.append({"bounds":parent.bounds,"terrain":filtered})
	display["_terrainParents"]=parents
	display["_displaySpacing"]=spacing
	display["_heightLayers"]=Geometry.prepare_height_layers(display)
	return display

static func _prefilter_grid(source: Dictionary, target_spacing: float,control_token=null) -> Dictionary:
	var grid := source
	var max_shift := 0.0
	while float(grid.spacingM)*2.0<=target_spacing*1.000001 and int(grid.width)>2 and int(grid.height)>2:
		var end_x := float(grid.get("lastSampleX",float(grid.originX)+(int(grid.width)-1)*float(grid.spacingM)))
		var end_z := float(grid.get("lastSampleZ",float(grid.originZ)+(int(grid.height)-1)*float(grid.spacingM)))
		var next_spacing := float(grid.spacingM)*2.0
		var width := int(ceil((end_x-float(grid.originX))/next_spacing))+1
		var height := int(ceil((end_z-float(grid.originZ))/next_spacing))+1
		var values := PackedFloat64Array()
		values.resize(width*height)
		for z in height:
			if z%8==0 and PrepareControl.hit(control_token,"prefilter-rows"):return {}
			for x in width:
				var sum := 0.0
				var low := INF
				var high := -INF
				for dz in range(-1,2):
					for dx in range(-1,2):
						var wx := minf(float(grid.originX)+x*next_spacing,end_x)+dx*float(grid.spacingM)
						var wz := minf(float(grid.originZ)+z*next_spacing,end_z)+dz*float(grid.spacingM)
						var value := Geometry.sample_height(grid,wx,wz)
						var weight := (2.0 if dx==0 else 1.0)*(2.0 if dz==0 else 1.0)
						sum+=value*weight
						low=minf(low,value); high=maxf(high,value)
				var mean := clampf(sum/16.0,low,high)
				values[z*width+x]=mean
				max_shift=maxf(max_shift,absf(mean-Geometry.sample_height(grid,minf(float(grid.originX)+x*next_spacing,end_x),minf(float(grid.originZ)+z*next_spacing,end_z))))
		var next := grid.duplicate(false)
		next.width=width; next.height=height; next.spacingM=next_spacing; next.heights=values
		next.reconstruction="bilinear-samples"; next.lastSampleX=end_x; next.lastSampleZ=end_z
		grid=next
	if not is_same(grid,source): grid["displayFilterMaxShiftM"]=max_shift
	return grid

static func make_mesh(vertices: PackedVector3Array, normals: PackedVector3Array = PackedVector3Array()) -> ArrayMesh:
	# Source triangles use the conventional right-handed outward winding. Godot
	# front faces are clockwise, so reverse each triangle while preserving normals.
	var godot_vertices := PackedVector3Array()
	var godot_normals := PackedVector3Array()
	for i in range(0,vertices.size(),3):
		godot_vertices.append_array(PackedVector3Array([vertices[i],vertices[i+2],vertices[i+1]]))
		if normals.size()==vertices.size(): godot_normals.append_array(PackedVector3Array([normals[i],normals[i+2],normals[i+1]]))
	vertices=godot_vertices
	normals=godot_normals
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	if normals.size() == vertices.size():
		arrays[Mesh.ARRAY_NORMAL] = normals
	else:
		var generated := PackedVector3Array()
		for i in range(0,vertices.size(),3):
			var normal := (vertices[i+2]-vertices[i]).cross(vertices[i+1]-vertices[i]).normalized()
			generated.append_array(PackedVector3Array([normal,normal,normal]))
		arrays[Mesh.ARRAY_NORMAL] = generated
	var mesh := ArrayMesh.new()
	if not vertices.is_empty():
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	return mesh


