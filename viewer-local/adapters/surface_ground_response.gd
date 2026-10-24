class_name SurfaceGroundResponse
extends RefCounted

const VERSION="surface-ground-response-1"
const QUANTIZATION="float32-potentials; uint16-recipe; stored-srgb8-at-canonical-knots"
const FLOATS=["alluvial","gravity","wind","coastal","aridity","moisturePreSaturation"]
const FIELDS=["alluvial","gravity","wind","coastal","aridity","moisturePreSaturation","rockRecipe"]
const RECIPES=["fractured-bedrock","carbonate-karst","volcanic-crust","coastal-rock","mineral-soil","organic-soil","arid-reg","alluvial-bars","angular-talus","wind-ripple-sand","coastal-sediment","cultivated-soil"]
static var _cached_response:Dictionary={}
static var _cached_fields:Dictionary={}
static var _cached_result:Dictionary={}

static func expected_wire_dtype(path:Array)->String:
	if path.size()<3 or path[-3]!="groundResponse" or path[-2]!="fields":return ""
	if path.slice(0,path.size()-3) not in [[],["world"],["canonicalContext"],["world","canonicalContext"]]:return ""
	return "f32" if path[-1] in FLOATS else "u16" if path[-1]=="rockRecipe" else ""
static func _number(v)->bool:return (v is float or v is int) and is_finite(float(v))
static func _sequence(v)->bool:return v is Array or v is PackedFloat32Array or v is PackedInt32Array or v is PackedInt64Array or v is PackedByteArray
static func _feed(h:HashingContext,bytes:PackedByteArray)->void:
	if not bytes.is_empty():h.update(bytes)
static func _length(h:HashingContext,n:int)->void:
	var raw:=PackedByteArray();raw.resize(4);raw.encode_u32(0,n);_feed(h,raw)
static func _string(h:HashingContext,value:String)->void:
	_string_bytes(h,value.to_utf16_buffer())
static func _string_bytes(h:HashingContext,bytes:PackedByteArray)->void:
	_feed(h,PackedByteArray([1]));_length(h,bytes.size());_feed(h,bytes)
static func _typed(h:HashingContext,constructor:String,bytes:PackedByteArray)->void:
	_feed(h,PackedByteArray([2,1 if constructor=="Float64Array" else 2 if constructor=="Float32Array" else 3]));_length(h,bytes.size());_feed(h,bytes)
static func identity(r:Dictionary)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);var g:Dictionary=r.grid;var s:Dictionary=r.source
	_feed(h,PackedByteArray([3]));_length(h,18);_string(h,"gr-sha256-1");_string(h,VERSION)
	_typed(h,"Float64Array",PackedFloat64Array([g.width,g.height,g.originX,g.originZ,g.spacingM,s.sourceLOD,s.nativeSpacingM]).to_byte_array())
	for v in [s.id,s.version,"unspecified" if not s.has("sourceLODKnown") else "true" if s.sourceLODKnown else "false",s.get("provenance",""),r.environmentVersion,r.materialLibraryVersion,r.interpolation,r.quantization]:_string(h,str(v))
	for key in FLOATS:_typed(h,"Float32Array",PackedFloat32Array(r.fields[key]).to_byte_array())
	var raw:=PackedByteArray();raw.resize(r.fields.rockRecipe.size()*2)
	for i in r.fields.rockRecipe.size():raw.encode_u16(i*2,int(r.fields.rockRecipe[i]))
	_typed(h,"Uint16Array",raw)
	return "gr-sha256-1:"+h.finish().hex_encode()

static func validate(world:Dictionary)->bool:
	world.erase("_groundResponseValidation")
	var versions=world.get("versions",{});var reference=world.get("canonicalContextRef")
	if not versions is Dictionary:return false
	if reference!=null and (not reference is Dictionary or reference.get("groundResponseVersion")!=versions.get("groundResponse")):return false
	if reference!=null and world.has("groundResponse"):return false
	var context=world.get("canonicalContext") if reference!=null else {"grid":world.get("terrain"),"fields":world.get("fields"),"source":world.get("terrain",{}).get("source"),"groundResponse":world.get("groundResponse")}
	if context==null:
		world._groundResponseValidation={"available":versions.has("groundResponse"),"referenceOnly":true,"id":versions.get("groundResponse","")}
		return not versions.has("groundResponse") or versions.groundResponse is String and not versions.groundResponse.is_empty()
	if not context is Dictionary:return false
	var r=context.get("groundResponse")
	if r==null:
		if versions.has("groundResponse") or reference==null and world.has("groundResponse") or reference!=null and context.has("groundResponse"):return false
		world._groundResponseValidation={"available":false};return true
	if not r is Dictionary or not r.get("fields") is Dictionary or not r.get("grid") is Dictionary or not r.get("source") is Dictionary:return false
	if r.get("version")!=VERSION or r.get("interpolation")!="bilinear-physical-before-recipe" or r.get("quantization")!=QUANTIZATION:return false
	for key in ["id","environmentVersion","materialLibraryVersion"]:
		if not r.get(key) is String or r[key].is_empty():return false
	for key in ["id","version"]:
		if not r.source.get(key) is String or r.source[key].is_empty():return false
	if not _number(r.source.get("sourceLOD")) or not _number(r.source.get("nativeSpacingM")) or float(r.source.nativeSpacingM)<=0:return false
	if r.source.has("sourceLODKnown") and not r.source.sourceLODKnown is bool or r.source.has("provenance") and not r.source.provenance is String:return false
	if r.get("id")!=versions.get("groundResponse") or r.get("environmentVersion")!=versions.get("environment") or r.get("materialLibraryVersion")!=versions.get("materialLibrary"):return false
	if r.source!=context.get("source"):return false
	var grid=context.get("grid");var physical=context.get("fields");var materials=world.get("materials");var geology=world.get("geology",{})
	if not grid is Dictionary or not physical is Dictionary or not materials is Array or materials.is_empty() or materials.size()>32 or not geology.get("units") is Array or geology.units.is_empty() or geology.units.size()>64:return false
	if r.grid.size()!=5:return false
	for key in ["width","height","originX","originZ","spacingM"]:
		if not _number(r.grid.get(key)) or r.grid[key]!=grid.get(key):return false
	if floorf(float(grid.width))!=float(grid.width) or floorf(float(grid.height))!=float(grid.height) or float(grid.width)<2 or float(grid.height)<2 or float(grid.spacingM)<=0:return false
	var n=int(grid.width)*int(grid.height)
	if n<4 or n>1048576:return false
	if r.fields.size()!=7:return false
	for key in FIELDS:
		var a=r.fields.get(key)
		if not _sequence(a) or a.size()!=n:return false
		if not a is Array and (key in FLOATS and not a is PackedFloat32Array or key=="rockRecipe" and not a is PackedInt32Array):return false
		for value in a:
			if not _number(value) or float(value)<0:return false
			if key in FLOATS and key!="aridity" and float(value)>1:return false
			if key=="rockRecipe" and (floorf(float(value))!=float(value) or int(value)>=materials.size()):return false
		if key=="aridity" and a is Array and PackedFloat32Array(a).has(INF):return false
	var recipe_ids={}
	for id in r.fields.rockRecipe:recipe_ids[int(id)]=true
	for id in recipe_ids:
		var recipe=materials[int(id)]
		if not recipe is Dictionary or recipe.get("surfaceRole","ground")!="ground" or recipe.get("family") not in ["bedrock","gravity","karst","volcanic","rocky-coast"]:return false
	for key in ["slope","stoniness","organic","bedrock","sourceRock","occupation","groundMaterial","groundMaterialSecondary","groundMaterialBlend","groundMaterialMeanColor"]:
		if not physical.has(key) or not _sequence(physical[key]) and not physical[key] is PackedInt64Array or physical[key].size()!=n:return false
	for key in ["slope","stoniness","organic"]:
		for value in physical[key]:
			if not _number(value) or float(value)<0 or float(value)>(PI/2.0 if key=="slope" else 1.0):return false
	var units={}
	for unit in geology.units:
		if not unit is Dictionary or not _number(unit.get("id")) or floorf(float(unit.id))!=float(unit.id) or int(unit.id)<1 or int(unit.id)>65535 or units.has(int(unit.id)) or not unit.get("colorLinear") is Array or unit.colorLinear.size()!=3:return false
		for value in unit.colorLinear:
			if not _number(value) or float(value)<0 or float(value)>1:return false
		units[int(unit.id)]=true
	for key in ["bedrock","sourceRock"]:
		for value in physical[key]:
			if not _number(value) or floorf(float(value))!=float(value) or not units.has(int(value)):return false
	var catalogue={}
	for recipe in materials:
		if not recipe is Dictionary or not recipe.get("id") is String or not recipe.get("family") is String or not recipe.get("colorLinear") is Array or recipe.colorLinear.size()!=3:return false
		if catalogue.has(recipe.id):return false
		catalogue[recipe.id]=true
		for value in recipe.colorLinear:
			if not _number(value) or float(value)<0 or float(value)>1:return false
		if recipe.id in RECIPES:
			if recipe.get("surfaceRole","ground")!="ground" or recipe.family in ["marine","inland-water","snow-ice","vegetation"]:return false
		if recipe.id in RECIPES.slice(0,4) and recipe.family not in ["bedrock","gravity","karst","volcanic","rocky-coast"]:return false
	for id in RECIPES:
		if not catalogue.has(id):return false
	if identity(r)!=r.id:return false
	world._groundResponseValidation={"available":true,"id":r.id};return true

static func prepare(world:Dictionary,context:Dictionary)->Dictionary:
	if not world.has("_groundResponseValidation") and not validate(world):return {"error":"invalid ground response"}
	var response=context.get("groundResponse")
	if response==null:return {"available":false,"metadata":{"available":false,"reason":"baked-color-legacy: physical response potentials were not retained"}}
	if not world._groundResponseValidation.get("available",false) or response.get("id")!=world.versions.get("groundResponse"):return {"error":"canonical ground response mismatch"}
	var fields:Dictionary=context.fields;var grid:Dictionary=context.grid
	if is_same(response,_cached_response) and is_same(fields,_cached_fields):return _cached_result
	var width=int(grid.width);var height=int(grid.height);var n=width*height
	var soil=Image.create(width,height,false,Image.FORMAT_RGBAF);var processes=Image.create(width,height,false,Image.FORMAT_RGBAF);var codes=Image.create(width,height,false,Image.FORMAT_RGBAF)
	var unit_indices={};var colors:=PackedVector4Array();var recipe_indices={}
	for unit in world.geology.units:
		unit_indices[int(unit.id)]=colors.size();colors.append(Vector4(float(unit.colorLinear[0]),float(unit.colorLinear[1]),float(unit.colorLinear[2]),1))
	while colors.size()<64:colors.append(Vector4(0,0,0,1))
	for i in world.materials.size():recipe_indices[str(world.materials[i].id)]=i
	var color_roles:=PackedInt32Array();color_roles.resize(32)
	for i in 32:
		var family=str(world.materials[mini(i,world.materials.size()-1)].family)
		color_roles[i]=2 if family=="gravity" else 1 if family in ["bedrock","karst","volcanic","rocky-coast"] else 0
	for key in ["alluvial-bars","angular-talus","wind-ripple-sand","coastal-sediment","mineral-soil","organic-soil","arid-reg","cultivated-soil"]:
		if not recipe_indices.has(key):return {"error":"ground response recipe missing: "+key}
	var f:Dictionary=response.fields
	for i in n:
		if not unit_indices.has(int(fields.bedrock[i])) or not unit_indices.has(int(fields.sourceRock[i])):return {"error":"ground response unit missing"}
		var x=i%width;var z=i/width
		soil.set_pixel(x,z,Color(float(fields.stoniness[i]),float(fields.slope[i]),float(fields.organic[i]),float(f.moisturePreSaturation[i])))
		processes.set_pixel(x,z,Color(float(f.alluvial[i]),float(f.gravity[i]),float(f.wind[i]),float(f.coastal[i])))
		# A negative bed-index is an internal crop tag; source ids stay intact.
		var bed_index=float(unit_indices[int(fields.bedrock[i])])
		codes.set_pixel(x,z,Color(float(f.aridity[i]),float(f.rockRecipe[i]),-1.0-bed_index if int(fields.occupation[i])==2 else bed_index,float(unit_indices[int(fields.sourceRock[i])])))
	var bindings={"ground_response_enabled":true,"ground_response_soil":soil,"ground_response_processes":processes,"ground_response_codes":codes,"ground_response_unit_colors":colors,"ground_response_color_roles":color_roles,
		"ground_response_recipe_ids0":Vector4(recipe_indices["alluvial-bars"],recipe_indices["angular-talus"],recipe_indices["wind-ripple-sand"],recipe_indices["coastal-sediment"]),
		"ground_response_recipe_ids1":Vector4(recipe_indices["mineral-soil"],recipe_indices["organic-soil"],recipe_indices["arid-reg"],recipe_indices["cultivated-soil"])}
	var result={"available":true,"bindings":bindings,"metadata":{"available":true,"version":VERSION,"id":response.id,"sourceGrid":response.grid.duplicate(),"sourceNativeSpacingM":response.source.nativeSpacingM,"quantization":QUANTIZATION,"interpretation":"inferred regional parameters before recipes; no new observed fine soil","imageBytes":n*48}}
	_cached_response=response;_cached_fields=fields;_cached_result=result;return result
