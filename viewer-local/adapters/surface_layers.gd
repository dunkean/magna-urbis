class_name SurfaceLayers
extends RefCounted
const GroundResponse=preload("res://adapters/surface_ground_response.gd")

const VERSION="surface-layers-1"
const LEGACY_WARNING="Legacy composite-only packet: bare ground and low-cover layers are unavailable; the legacy material pair already mixes soil, litter and herbs and cannot be unmixed."
const SHORT_FIELDS=["groundMaterial","groundMaterialSecondary","lowCoverMaterial","lowCoverMaterialSecondary"]
const FLOAT_FIELDS=["groundMaterialBlend","lowCoverMaterialBlend","lowCoverOpacity"]
const MEAN_FIELDS=["groundMaterialMeanColor","lowCoverMaterialMeanColor"]
const FIELDS=["groundMaterial","groundMaterialSecondary","lowCoverMaterial","lowCoverMaterialSecondary","groundMaterialBlend","lowCoverMaterialBlend","lowCoverOpacity","groundMaterialMeanColor","lowCoverMaterialMeanColor"]
static var _cached_source:Dictionary={}
static var _cached_version:String=""
static var _cached_images:Dictionary={}

static func expected_wire_dtype(path:Array)->String:
	if path.size()<2 or not path[-2] is String or not path[-1] is String or path[-2]!="fields":return ""
	var prefix=path.slice(0,path.size()-2)
	if prefix not in [[],["world"],["canonicalContext"],["world","canonicalContext"]]:return ""
	var name=path[-1]
	return "u16" if name in SHORT_FIELDS else "f32" if name in FLOAT_FIELDS else "u32" if name in MEAN_FIELDS else ""

static func _number(v)->bool:return (v is int or v is float) and is_finite(float(v))
static func _integer(v,lo:int,hi:int)->bool:return _number(v) and float(v)>=lo and float(v)<=hi and floorf(float(v))==float(v)
static func _sequence(v)->bool:return typeof(v) in [TYPE_ARRAY,TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_INT64_ARRAY,TYPE_PACKED_FLOAT32_ARRAY]
static func _count(fields:Dictionary)->int:
	var count=0
	for key in FIELDS:
		if fields.has(key):count+=1
	return count
static func _feed(h:Array,bytes:PackedByteArray)->void:
	for byte in bytes:
		h[0]=((int(h[0])^byte)*16777619)&0xffffffff
		h[1]=((int(h[1])^byte)*16777621)&0xffffffff
		h[2]=((int(h[2])^byte)*16777623)&0xffffffff
		h[3]=((int(h[3])^byte)*16777625)&0xffffffff
static func _text(h:Array,value:String)->void:_feed(h,value.to_utf16_buffer())

# Same typed headers, UTF16 text and little-endian bytes as hash.ts fingerprint.
# A fast cache fingerprint, not cryptographic authentication.
static func fields_version(fields:Dictionary)->String:
	if _count(fields)!=9:return ""
	var h=[2166136261,3335557771,1597334677,3812015801]
	_text(h,"[");_text(h,"string:"+VERSION+";")
	for key in FIELDS:
		var values=fields[key];var raw:PackedByteArray;var constructor:String
		if key in SHORT_FIELDS:
			constructor="Uint16Array";raw.resize(values.size()*2)
			for i in values.size():raw.encode_u16(i*2,int(values[i]))
		elif key in FLOAT_FIELDS:
			constructor="Float32Array";raw=PackedFloat32Array(values).to_byte_array()
		else:
			constructor="Uint32Array";raw.resize(values.size()*4)
			for i in values.size():raw.encode_u32(i*4,int(values[i]))
		_text(h,constructor+":"+str(raw.size())+":");_feed(h,raw)
	_text(h,"]")
	return "%08x%08x%08x%08x"%h

static func _validate_fields(fields:Dictionary,n:int,materials:Array)->bool:
	if _count(fields)!=9:return false
	for key in FIELDS:
		var v=fields[key]
		if not _sequence(v) or v.size()!=n:return false
		if typeof(v)!=TYPE_ARRAY:
			if key in SHORT_FIELDS and typeof(v)!=TYPE_PACKED_INT32_ARRAY:return false
			if key in FLOAT_FIELDS and typeof(v)!=TYPE_PACKED_FLOAT32_ARRAY:return false
			if key in MEAN_FIELDS and typeof(v)!=TYPE_PACKED_INT64_ARRAY:return false
	for i in n:
		for key in SHORT_FIELDS:
			if not _integer(fields[key][i],0,materials.size()-1):return false
			var recipe=materials[int(fields[key][i])]
			if not recipe is Dictionary:return false
			var role=recipe.get("surfaceRole","")
			if key.begins_with("ground"):
				if role!="" and role!="ground":return false
				if recipe.get("id","") in ["forest-litter","vegetation-litter","inland-water","marine-water","snow-ice"]:return false
			elif role!="" and role!="low-cover":return false
		for key in FLOAT_FIELDS:
			if not _number(fields[key][i]) or float(fields[key][i])<0 or float(fields[key][i])>1:return false
		for key in MEAN_FIELDS:
			if not _integer(fields[key][i],0,0xffffff):return false
	return true

# Run on the decode worker before caching a world. Cached canonical contexts
# remain immutable; prepare() does not re-hash them on every camera movement.
static func validate(world:Dictionary)->bool:
	world.erase("_surfaceLayersValidation")
	if not GroundResponse.validate(world):return false
	var fields=world.get("fields");var grid=world.get("terrain");var materials=world.get("materials");var versions=world.get("versions",{})
	if not fields is Dictionary or not grid is Dictionary or not materials is Array or materials.is_empty() or not versions is Dictionary:return false
	if not _integer(grid.get("width"),2,1048576) or not _integer(grid.get("height"),2,1048576):return false
	var n=int(grid.get("width",0))*int(grid.get("height",0))
	if n<4 or n>1048576:return false
	var reference=world.get("canonicalContextRef")
	if reference!=null and not reference is Dictionary:return false
	var count=_count(fields);var metadata=world.get("surfaceLayers")
	if count==0:
		if versions.has("surfaceLayers") or reference is Dictionary and reference.has("surfaceLayersVersion"):return false
		if metadata!=null:
			if not metadata is Dictionary or metadata.get("version")!=VERSION or metadata.get("groundAvailability")!="legacy-composite-unavailable" or metadata.get("lowCoverAvailability")!="legacy-composite-unavailable" or metadata.has("fieldsVersion"):return false
		world["_surfaceLayersValidation"]={"available":false,"legacyFallback":true,"warning":LEGACY_WARNING}
		return true
	if not _validate_fields(fields,n,materials) or not metadata is Dictionary:return false
	if metadata.get("version")!=VERSION or metadata.get("groundAvailability")!="explicit" or metadata.get("lowCoverAvailability")!="explicit":return false
	var actual=fields_version(fields)
	if metadata.get("fieldsVersion")!=actual or not versions.get("surfaceLayers") is String or str(versions.surfaceLayers).is_empty():return false
	var canonical_version=str(versions.surfaceLayers)
	if reference!=null:
		if not reference is Dictionary or reference.get("surfaceLayersVersion")!=canonical_version:return false
		if world.has("canonicalContext"):
			var context=world.canonicalContext
			if not context is Dictionary or not context.get("grid") is Dictionary or not context.get("fields") is Dictionary or context.get("versions",{}).get("surfaceLayers")!=canonical_version:return false
			if not _integer(context.grid.get("width"),2,1048576) or not _integer(context.grid.get("height"),2,1048576):return false
			var cn=int(context.grid.get("width",0))*int(context.grid.get("height",0))
			if cn<4 or cn>1048576 or not _validate_fields(context.fields,cn,materials) or fields_version(context.fields)!=canonical_version:return false
	elif actual!=canonical_version:return false
	world["_surfaceLayersValidation"]={"available":true,"legacyFallback":false,"fieldsVersion":actual,"canonicalFieldsVersion":canonical_version}
	return true

static func _linear(packed:int)->Color:
	return Color(float(packed&255)/255.0,float((packed>>8)&255)/255.0,float((packed>>16)&255)/255.0,1).srgb_to_linear()
static func _roughness(materials:Array,a:int,b:int,blend:float)->float:
	return lerpf(float(materials[a].roughness),float(materials[b].roughness),blend)

# canonical_source is {grid,fields} from SurfaceData.context(world). The five
# returned images describe independent physical layers, not a legacy subtraction.
static func prepare(world:Dictionary,canonical_source:Dictionary={})->Dictionary:
	if not world.has("_surfaceLayersValidation") and not validate(world):return {"available":false,"error":"invalid explicit surface layers"}
	var validation:Dictionary=world._surfaceLayersValidation
	if not validation.get("available",false):
		var legacy=validation.duplicate(true);legacy.metadata={"version":VERSION,"groundAvailability":"legacy-composite-unavailable","lowCoverAvailability":"legacy-composite-unavailable","legacyFallback":true,"warning":LEGACY_WARNING};return legacy
	var source=canonical_source
	if source.is_empty():
		source=world.get("canonicalContext",{"grid":world.terrain,"fields":world.fields})
		if not world.has("canonicalContext") and world.has("groundResponse"):source.groundResponse=world.groundResponse
	if not source.get("grid") is Dictionary or not source.get("fields") is Dictionary:return {"available":false,"error":"layer texture source is missing"}
	var grid:Dictionary=source.grid;var fields:Dictionary=source.fields
	var response=GroundResponse.prepare(world,source)
	if response.has("error"):return {"available":false,"error":response.error}
	var canonical=world.get("canonicalContext")
	var from_canonical=world.has("canonicalContextRef") and canonical is Dictionary and is_same(fields,canonical.get("fields",{}))
	var texture_version=str(validation.canonicalFieldsVersion) if from_canonical else str(validation.fieldsVersion)
	var texture_grid={}
	for key in ["width","height","originX","originZ","spacingM"]:texture_grid[key]=grid[key]
	var metadata={"version":VERSION,"groundAvailability":"explicit","lowCoverAvailability":"explicit","projectedFieldsVersion":str(validation.fieldsVersion),"canonicalFieldsVersion":str(validation.canonicalFieldsVersion),"textureFieldsVersion":texture_version,"textureSource":"canonical" if from_canonical else "world","textureGrid":texture_grid,"legacyFallback":false}
	metadata.groundResponse=response.metadata
	if is_same(fields,_cached_source.get("fields",{})) and is_same(grid,_cached_source.get("grid",{})) and texture_version==_cached_version:
		var reused=_cached_images.duplicate(false);reused.metadata=metadata;reused.groundResponse=response;return reused
	var width=int(grid.width);var height=int(grid.height);var n=width*height
	if n<4 or n>1048576 or _count(fields)!=9:return {"available":false,"error":"layer texture field shape is invalid"}
	var ids=Image.create(width,height,false,Image.FORMAT_RGBAF);var average=Image.create(width,height,false,Image.FORMAT_RGBAF)
	var low_ids=Image.create(width,height,false,Image.FORMAT_RGBAF);var low_average=Image.create(width,height,false,Image.FORMAT_RGBAF);var low_state=Image.create(width,height,false,Image.FORMAT_RGBAF)
	var materials:Array=world.materials
	for i in n:
		var x=i%width;var z=i/width;var a=int(fields.groundMaterial[i]);var b=int(fields.groundMaterialSecondary[i]);var blend=float(fields.groundMaterialBlend[i])
		var rough=_roughness(materials,a,b,blend);var rgb=_linear(int(fields.groundMaterialMeanColor[i]))
		ids.set_pixel(x,z,Color(a,b,blend,rough));average.set_pixel(x,z,Color(rgb.r,rgb.g,rgb.b,rough))
		a=int(fields.lowCoverMaterial[i]);b=int(fields.lowCoverMaterialSecondary[i]);blend=float(fields.lowCoverMaterialBlend[i]);var alpha=float(fields.lowCoverOpacity[i]);rgb=_linear(int(fields.lowCoverMaterialMeanColor[i]))
		low_ids.set_pixel(x,z,Color(a,b,blend,alpha));low_average.set_pixel(x,z,Color(rgb.r*alpha,rgb.g*alpha,rgb.b*alpha,alpha))
		low_state.set_pixel(x,z,Color(float(fields.grassCover[i]),float(fields.shrubCover[i]),float(fields.litter[i]),alpha))
	average.generate_mipmaps();low_average.generate_mipmaps();low_state.generate_mipmaps()
	var result={"available":true,"groundIds":ids,"groundAverage":average,"lowIds":low_ids,"lowAverage":low_average,"lowState":low_state,"groundResponse":response,"metadata":metadata}
	_cached_source=source;_cached_version=texture_version;_cached_images=result
	return result
