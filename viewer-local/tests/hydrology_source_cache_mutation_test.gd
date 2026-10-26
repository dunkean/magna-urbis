extends SceneTree
# Independent authored CPU cases. Pass the frozen pre-cache hydrology script,
# optionally followed by an output JSON path. No source generation or GPU.
const Hydro=preload("res://adapters/surface_hydrology.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
var failures=[]
var checks=0
func digest(bytes:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256)
	if not bytes.is_empty():h.update(bytes)
	return h.finish().hex_encode()
func canonical(value):
	if value is Image:return {"format":value.get_format(),"size":value.get_size(),"sha":digest(value.get_data())}
	if value is Dictionary:
		var result={}
		for key in value:
			if key!="buildMs":result[key]=canonical(value[key])
		return result
	if value is Array:
		var result=[]
		for item in value:result.append(canonical(item))
		return result
	if typeof(value) in [TYPE_PACKED_BYTE_ARRAY,TYPE_PACKED_FLOAT64_ARRAY,TYPE_PACKED_VECTOR3_ARRAY]:return {"type":typeof(value),"size":value.size(),"sha":digest(value if value is PackedByteArray else value.to_byte_array())}
	return value
func check(ok:bool,label:String):
	checks+=1
	if not ok:failures.append(label)
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass frozen pre-cache surface_hydrology.gd path");quit(2);return
	var old=GDScript.new();old.source_code=FileAccess.get_file_as_string(args[0]).replace("class_name SurfaceHydrology","");assert(old.reload()==OK)
	var classes=PackedByteArray();classes.resize(16);classes.fill(2)
	var levels=PackedFloat32Array();levels.resize(16);levels.fill(5)
	var heights=PackedFloat32Array();heights.resize(16)
	var grid={"width":4,"height":4,"originX":5.0,"originZ":5.0,"spacingM":10.0,"heights":heights}
	var world={"terrain":grid,"bounds":{"minX":5.0,"minZ":5.0,"maxX":35.0,"maxZ":35.0},"fields":{"waterClass":classes.duplicate(),"waterLevelM":levels.duplicate()}}
	var geometry={"water":[[[{"x":10.0,"y":10.0},{"x":22.0,"y":10.0},{"x":22.0,"y":22.0},{"x":10.0,"y":22.0}]]]}
	var original_bytes=JSON.stringify(geometry).to_utf8_buffer()
	var water={"n":4,"width":40.0,"originX":5.0,"originZ":5.0,"classes":classes,"levelM":levels}
	var source={"geometry":null,"water":water,"sceneContextId":"same-id","$surfaceSourceArchive":{"format":"surface-source-archive-1","attachments":[{"path":["geometry"],"encoding":"json-utf8","bytes":original_bytes.duplicate()}]}}
	var origin={"x":20.0,"y":0.0,"z":20.0};var focus={"x":20.0,"y":20.0}
	var fallback=Geometry.build_water(world,origin,focus,40.0)
	var warm=Hydro.prepare({"source":source},world,origin,focus,40.0,fallback)
	check(warm.vertices.size()>0 and warm.sourceWaterContours.size()>0,"nonempty geometry and contours")
	var internal=Hydro._geometry(source);var internal_before=digest(var_to_bytes(internal))
	var ring:PackedFloat64Array=warm.sourceWaterContours[0];ring[0]+=1000;warm.sourceWaterContours[0]=ring
	warm.vertices[0]=Vector3(999,999,999);warm.classImage.fill(Color(99,0,0,1))
	for mutation in ["output-only","same-source-valid-class","same-source-invalid-class","class-restore","same-source-byte","json-restore","invalid-shape","shape-restore","invalid-width","width-restore","invalid-origin","origin-restore"]:
		match mutation:
			"same-source-valid-class":source.water.classes[0]=3
			"same-source-invalid-class":source.water.classes[0]=4
			"class-restore":source.water.classes[0]=2
			"same-source-byte":
				var b:PackedByteArray=source["$surfaceSourceArchive"].attachments[0].bytes;var at=b.find(49);assert(at>=0);b[at]=50;source["$surfaceSourceArchive"].attachments[0].bytes=b
			"json-restore":source["$surfaceSourceArchive"].attachments[0].bytes=original_bytes.duplicate()
			"invalid-shape":source.water.n=2
			"shape-restore":source.water.n=4
			"invalid-width":source.water.width=0.0
			"width-restore":source.water.width=40.0
			"invalid-origin":source.water.originX=NAN
			"origin-restore":source.water.originX=5.0
		var before=digest(var_to_bytes(source))
		var expected=old.prepare({"source":source},world,origin,focus,40.0,fallback)
		var actual=Hydro.prepare({"source":source},world,origin,focus,40.0,fallback)
		check(canonical(actual)==canonical(expected),mutation+" parity")
		check(digest(var_to_bytes(source))==before,mutation+" source remains unchanged")
	check(digest(var_to_bytes(internal))==internal_before,"initial cached JSON dictionary remains unchanged after returned-output and same-source mutations")
	var result={"status":"PASS" if failures.is_empty() else "FAIL","checks":checks,"failures":failures,"scope":"Independent authored CPU cache mutation tests; no GPU/performance claim"}
	if args.size()>1:
		var f=FileAccess.open(args[1],FileAccess.WRITE);f.store_string(JSON.stringify(result,"  "));f=null
	print(JSON.stringify(result));quit(0 if failures.is_empty() else 1)
