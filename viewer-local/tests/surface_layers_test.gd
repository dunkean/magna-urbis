extends SceneTree
const Layers=preload("res://adapters/surface_layers.gd")
const Data=preload("res://adapters/surface_data.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass authored layer fixture directory");quit(2);return
	var directory:String=args[0];var failures=[];var measured=[]
	var reference=JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("expected.json")))
	for name in ["canonical","refined"]:
		for format in ["json","surfacebin"]:
			var path=directory.path_join(name+"."+format);var packet=Data.read_json(path);var world:Dictionary=packet.get("world",packet)
			if world.is_empty() or not Layers.validate(world):failures.append(name+" "+format+" did not validate");continue
			if Layers.fields_version(world.fields)!=reference.worlds[name].surfaceLayers.fieldsVersion:failures.append("TS/GD fingerprint differs")
			var info=Layers.prepare(world)
			if not info.get("available",false):failures.append("explicit image layers unavailable");continue
			for sample in reference.worlds[name].samples:
				# Textures use the canonical context, not camera-projected categories.
				if name=="refined":continue
				var index=int(sample.index);var width=int(world.terrain.width);var actual:Color=info.lowAverage.get_pixel(index%width,index/width)
				var values=[actual.r,actual.g,actual.b,actual.a]
				for channel in 4:
					if absf(values[channel]-float(sample.lowPremulRGBA[channel]))>0.000001:failures.append("premultiplied low-cover image differs from TS reference")
			if info.metadata.textureGrid.has("heights"):failures.append("texture metadata copied raw height samples")
			if name=="refined" and (info.metadata.textureSource!="canonical" or info.metadata.textureFieldsVersion!=world.versions.surfaceLayers):failures.append("refined images lost canonical provenance")
			measured.append({"name":name,"format":format,"fieldsVersion":Layers.fields_version(world.fields),"textureSource":info.metadata.textureSource,"textureGrid":info.metadata.textureGrid})
	var original=JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("canonical.json")))
	for mutation in ["partial","wrong-type","wrong-role","bad-alpha","bad-version","edited-mean","bad-ref"]:
		var world=original.duplicate(true)
		match mutation:
			"partial":world.fields.erase("lowCoverOpacity")
			"wrong-type":world.fields.groundMaterial=PackedInt64Array(world.fields.groundMaterial)
			"wrong-role":world.fields.groundMaterial[0]=world.fields.lowCoverMaterial[0]
			"bad-alpha":world.fields.lowCoverOpacity[0]=1.01
			"bad-version":world.surfaceLayers.fieldsVersion="edited"
			"edited-mean":world.fields.groundMaterialMeanColor[0]=int(world.fields.groundMaterialMeanColor[0])^1
			"bad-ref":world.canonicalContextRef="invalid"
		if Layers.validate(world):failures.append("accepted malformed "+mutation)
	var legacy=original.duplicate(true)
	for key in Layers.FIELDS:legacy.fields.erase(key)
	legacy.erase("surfaceLayers");legacy.versions.erase("surfaceLayers")
	if not Layers.validate(legacy) or Layers.prepare(legacy).get("available",true) or not Layers.prepare(legacy).get("metadata",{}).get("legacyFallback",false):failures.append("legacy invented bare ground or failed explicit warning")
	if Layers.expected_wire_dtype(["world","fields","groundMaterial"])!="u16" or Layers.expected_wire_dtype(["world","canonicalContext","fields","lowCoverOpacity"])!="f32" or Layers.expected_wire_dtype(["fields","lowCoverMaterialMeanColor"])!="u32" or Layers.expected_wire_dtype(["source","fields","groundMaterial"])!="":failures.append("wire dtype path schema mismatch")
	for path in [["source","archive",0,"values"],["world","fields",1],["source",0,1],[1,2]]:
		if Layers.expected_wire_dtype(path)!="":failures.append("numeric nested source path was misclassified")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"measured":measured,"scope":"TS/GD authored fixtures, typed hashes, independent layer image preparation and legacy/malformed rejection; no GPU claim"}));quit(0 if failures.is_empty() else 1)
