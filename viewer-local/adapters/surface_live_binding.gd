class_name SurfaceLiveBinding
extends RefCounted

# Same rf1 byte identity as web/src/surface/registrationBinding.ts. This is a
# content/cache fingerprint, not a cryptographic authentication protocol.
static func _multiply32(value: int, factor: int) -> int:
	# Avoid signed int64 overflow for the largest uint32 lane products.
	return ((value&65535)*factor+(((value>>16)*factor)&65535)*65536)&0xffffffff

static func fingerprint(width_m: float, n: int, values: PackedFloat32Array) -> String:
	if not is_finite(width_m) or width_m<=0.0 or n<2 or n>4096 or values.size()!=n*n: return ""
	for value in values:
		if not is_finite(value): return ""
	var shape:=PackedByteArray();shape.resize(12);shape.encode_double(0,width_m);shape.encode_u32(8,n)
	var lanes: Array[int]=[2166136261,2246822519,3266489917,668265263]
	var factors: Array[int]=[16777619,2246822519,3266489917,668265263]
	for bytes in [shape,values.to_byte_array()]:
		for byte in bytes:
			for lane in 4: lanes[lane]=_multiply32(lanes[lane]^int(byte),factors[lane])
	return "rf1-%08x%08x%08x%08x"%lanes

static func _error(reason: String) -> Dictionary: return {"error":reason}
static func _grid(terrain) -> Dictionary:
	if not terrain is Dictionary: return _error("missing full retained terrain")
	var n:=int(terrain.get("width",0));var spacing:=float(terrain.get("spacingM",0.0))
	if n<2 or n>4096 or int(terrain.get("height",0))!=n or not is_finite(spacing) or spacing<=0.0: return _error("invalid retained terrain grid")
	var values=terrain.get("heights")
	if not values is PackedFloat32Array and not values is Array: return _error("retained heights are not Float32 samples")
	if values.size()!=n*n: return _error("retained height count differs")
	# The current Magna live provider exposes the full 0..width map. Crops and
	# frame translations remain valid offline; they must never select another
	# full-world location silently when attached to that provider.
	if absf(float(terrain.get("originX",INF))-spacing*0.5)>0.0000001 or absf(float(terrain.get("originZ",INF))-spacing*0.5)>0.0000001: return _error("live requires the full unchanged Magna map frame; this crop/translated map is offline")
	return {"n":n,"widthM":spacing*n,"values":values if values is PackedFloat32Array else PackedFloat32Array(values)}

static func _canonical_values(grid: Dictionary, count: int) -> PackedFloat32Array:
	if count==int(grid.n): return grid.values
	var result:=PackedFloat32Array();result.resize(count*count)
	for z in count:
		for x in count:
			var gx:=clampf((x+0.5)*int(grid.n)/count-0.5,0.0,int(grid.n)-1.0)
			var gz:=clampf((z+0.5)*int(grid.n)/count-0.5,0.0,int(grid.n)-1.0)
			var ix:=int(gx);var iz:=int(gz);var dx:=gx-ix;var dz:=gz-iz
			var right:=mini(ix+1,int(grid.n)-1);var bottom:=mini(iz+1,int(grid.n)-1)
			# Preserve the JS operation order before the final Float32 rounding.
			result[z*count+x]=(float(grid.values[iz*int(grid.n)+ix])*(1.0-dx)+float(grid.values[iz*int(grid.n)+right])*dx)*(1.0-dz)+(float(grid.values[bottom*int(grid.n)+ix])*(1.0-dx)+float(grid.values[bottom*int(grid.n)+right])*dx)*dz
	return result

static func from_packet(packet: Dictionary, world: Dictionary) -> Dictionary:
	var started:=Time.get_ticks_usec()
	var source=packet.get("source",{})
	if not source is Dictionary: return _error("loaded source metadata is not a dictionary")
	var frame=source.get("frame")
	if frame is Dictionary and frame.get("liveCompatible")==false: return _error(str(frame.get("liveIncompatibilityReason","cropped or translated maps require an explicit full-world live frame")))
	var grid: Dictionary
	var binding=source.get("registrationBinding")
	if world.has("canonicalContextRef"):
		if not binding is Dictionary: return _error("a refined snapshot needs its exact registration and retained parent before attaching live")
		var parent: Dictionary={}
		for item in packet.get("terrainParents",[]):
			if item is Dictionary and item.get("terrain") is Dictionary and int(item.terrain.get("width",0))==int(binding.get("n",0)): parent=item.terrain;break
		grid=_grid(parent)
		if grid.has("error"): return grid
		if grid.widthM!=binding.get("width") or fingerprint(grid.widthM,grid.n,grid.values)!=binding.get("fieldFingerprint"): return _error("retained parent bytes differ from the snapshot registration")
		var count:=int(binding.get("canonicalN",0))
		if count<2 or count>4096 or binding.get("canonicalWidth")!=grid.widthM: return _error("invalid canonical registration shape")
		grid={"n":count,"widthM":grid.widthM,"values":_canonical_values(grid,count)}
	else:
		grid=_grid(world.get("terrain"))
		if grid.has("error"): return grid
	var identity:=fingerprint(grid.widthM,grid.n,grid.values)
	if identity.is_empty(): return _error("cannot fingerprint the actual loaded retained heights")
	if world.has("canonicalContextRef") and identity!=binding.get("canonicalFieldFingerprint"): return _error("retained parent does not reconstruct the canonical registered field")
	var declared=source.get("retainedField")
	if declared is Dictionary and (declared.get("fingerprint")!=identity or declared.get("n")!=grid.n or declared.get("widthM")!=grid.widthM): return _error("exported retained-field descriptor differs from actual loaded heights")
	var meta=source.get("meta",{})
	return {"format":"surface-loaded-live-binding","version":1,"n":grid.n,"widthM":grid.widthM,"fingerprint":identity,
		"sourceId":meta.get("id") if meta is Dictionary else null,"seed":meta.get("seed") if meta is Dictionary else null,
		"initialUrbanId":packet.get("urbanId"),"computeMs":(Time.get_ticks_usec()-started)/1000.0}

static func rejection(loaded: Dictionary, packet: Dictionary, _first_accept := true) -> String:
	if loaded.is_empty() or loaded.has("error"): return str(loaded.get("error","loaded map has no verified live source"))
	var source=packet.get("source",{});var binding=source.get("registrationBinding",{}) if source is Dictionary else {}
	if not binding is Dictionary or binding.get("canonicalFieldFingerprint")!=loaded.fingerprint or binding.get("canonicalN")!=loaded.n or binding.get("canonicalWidth")!=loaded.widthM: return "live canonical height content/shape differs from the loaded map"
	var world=packet.get("world",{});var terrain=world.get("terrain",{}) if world is Dictionary else {};var identity=terrain.get("source",{}) if terrain is Dictionary else {}
	if not identity is Dictionary or binding.get("expectedSourceId")==null or binding.get("sourceVersion")==null or binding.expectedSourceId!=identity.get("id") or binding.sourceVersion!=identity.get("version"): return "live terrain source identity differs from its registration"
	var meta=source.get("meta",{})
	if meta is Dictionary:
		for pair in [["sourceId","id"],["seed","seed"]]:
			if loaded.get(pair[0])!=null and meta.get(pair[1])!=null and loaded[pair[0]]!=meta[pair[1]]: return "live source identity differs from the loaded map"
	# Urban/presentation identities also contain source query/style metadata.
	# A legitimate scene edit must not be mistaken for a different heightfield.
	return ""
