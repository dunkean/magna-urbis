extends SceneTree
const Hydro=preload("res://adapters/surface_hydrology.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
const Data=preload("res://adapters/surface_data.gd")
class Consumer extends "res://scene/main.gd":
	func _begin_prepare()->void:pass
var failures:Array=[]
var checks=0
func check(ok:bool,label:String):
	checks+=1
	if not ok:failures.append(label)
func _initialize():call_deferred("run")
func digest(bytes:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256)
	if not bytes.is_empty():h.update(bytes)
	return h.finish().hex_encode()
func canonical(value):
	if value is Image:return {"format":value.get_format(),"size":value.get_size(),"mips":value.has_mipmaps(),"sha256":digest(value.get_data())}
	if value is Dictionary:
		var result={}
		for key in value:
			if key!="buildMs":result[key]=canonical(value[key])
		return result
	if value is Array:
		var result=[]
		for item in value:result.append(canonical(item))
		return result
	if typeof(value) in [TYPE_PACKED_BYTE_ARRAY,TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_INT64_ARRAY,TYPE_PACKED_FLOAT32_ARRAY,TYPE_PACKED_FLOAT64_ARRAY,TYPE_PACKED_VECTOR2_ARRAY,TYPE_PACKED_VECTOR3_ARRAY,TYPE_PACKED_COLOR_ARRAY]:return {"type":typeof(value),"count":value.size(),"sha256":digest(value.to_byte_array() if not value is PackedByteArray else value)}
	if value is float and not is_finite(value):return str(value)
	return value
func compare(baseline,source:Dictionary,world:Dictionary,origin:Dictionary,focus:Dictionary,width:float,label:String)->Dictionary:
	var before=digest(var_to_bytes(source))
	var fallback=Geometry.build_water(world,origin,focus,width)
	var start=Time.get_ticks_usec();var expected=baseline.prepare({"source":source},world,origin,focus,width,fallback);var old_ms=(Time.get_ticks_usec()-start)/1000.0
	start=Time.get_ticks_usec();var actual=Hydro.prepare({"source":source},world,origin,focus,width,fallback);var new_ms=(Time.get_ticks_usec()-start)/1000.0
	check(canonical(actual)==canonical(expected),label+": every output buffer/image/metadata/rejection equals baseline (excluding elapsed buildMs)")
	check(digest(var_to_bytes(source))==before,label+": source unchanged")
	return {"label":label,"baselineMs":old_ms,"cachedMs":new_ms,"sourceVertices":actual.get("vertices",PackedVector3Array()).size(),"authority":actual.get("authority"),"fallback":actual.get("fixedHydrologyFallbackReason"),"contourSha256":actual.get("sourceContourSha256")}
func archived(geometry:Dictionary,water:Dictionary)->Dictionary:
	return {"sceneContextId":"same-opaque-id","geometry":null,"water":water,"$surfaceSourceArchive":{"format":"surface-source-archive-1","attachments":[{"path":["geometry"],"encoding":"json-utf8","bytes":JSON.stringify(geometry).to_utf8_buffer()}]}}
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass frozen surface_hydrology.gd, optionally initial, preview21, preview204, metrics, output JSON");quit(2);return
	var baseline=GDScript.new();baseline.source_code=FileAccess.get_file_as_string(args[0]).replace("class_name SurfaceHydrology","")
	if baseline.reload()!=OK:quit(2);return
	var classes=PackedByteArray();classes.resize(16);classes.fill(2)
	var levels=PackedFloat32Array();levels.resize(16);levels.fill(5)
	var grid={"width":4,"height":4,"originX":5.0,"originZ":5.0,"spacingM":10.0,"heights":PackedFloat32Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])}
	var world={"terrain":grid,"bounds":{"minX":5.0,"minZ":5.0,"maxX":35.0,"maxZ":35.0},"fields":{"waterClass":classes,"waterLevelM":levels}}
	var outer=[{"x":10.0,"y":10.0},{"x":22.0,"y":10.0},{"x":22.0,"y":22.0},{"x":10.0,"y":22.0}]
	var geometry={"water":[[outer]]};var water={"n":4,"width":40.0,"originX":5.0,"originZ":5.0,"classes":classes,"levelM":levels}
	var source=archived(geometry,water);var origin={"x":20.0,"y":0.0,"z":20.0};var focus={"x":20.0,"y":20.0};var measured=[]
	for i in 3:measured.append(compare(baseline,source,world,origin,focus,40.0,"authored cold/hot "+str(i)))
	# Same bytes/ID across frame alternation: parsed points are always untranslated.
	for delta in [1e9,-1e9,0.0,1e9,0.0]:
		var shifted=source.duplicate(true);shifted.sourceToWorldTranslation={"x":delta,"z":-delta};shifted.water.originX+=delta;shifted.water.originZ-=delta
		var shifted_world=world.duplicate(true);shifted_world.terrain.originX+=delta;shifted_world.terrain.originZ-=delta
		shifted_world.bounds={"minX":5+delta,"maxX":35+delta,"minZ":5-delta,"maxZ":35-delta}
		measured.append(compare(baseline,shifted,shifted_world,{"x":20+delta,"y":0,"z":20-delta},{"x":20+delta,"y":20-delta},40.0,"frame "+str(delta)))
	var edited=source.duplicate(true);var bytes:PackedByteArray=edited["$surfaceSourceArchive"].attachments[0].bytes
	var at=bytes.find(49);check(at>=0,"find a one-byte coordinate edit");bytes[at]=50;edited["$surfaceSourceArchive"].attachments[0].bytes=bytes
	measured.append(compare(baseline,edited,world,origin,focus,40.0,"one byte edit under same scene ID"))
	for mutation in ["class-valid","class-invalid","size","origin","width","levels","fractional-array-class","cavern","malformed-json"]:
		var changed=source.duplicate(true)
		match mutation:
			"class-valid":changed.water.classes[0]=3
			"class-invalid":changed.water.classes[0]=4
			"size":changed.water.classes.resize(15)
			"origin":changed.water.originX=NAN
			"width":changed.water.width=-1.0
			"levels":changed.water.levelM.fill(NAN)
			"fractional-array-class":changed.water.classes=Array(classes);changed.water.classes[0]=1.5
			"cavern":changed.meta={"tags":{"relief":"cavern"}}
			"malformed-json":changed["$surfaceSourceArchive"].attachments[0].bytes="[]".to_utf8_buffer()
		measured.append(compare(baseline,changed,world,origin,focus,40.0,mutation))
	var huge=[];huge.resize(500001);huge.fill({"x":10.0,"y":10.0})
	measured.append(compare(baseline,archived({"water":[[huge]]},water),world,origin,focus,40.0,"unchanged source point budget rejection"))
	if args.size()==6:
		var initial=Data.read_json(args[1]);var consumer=Consumer.new();consumer.packet=initial;consumer.world=Data.unpack_world(initial)
		consumer._resolve_scene(initial);consumer._resolve_context(consumer.world);consumer.world["_terrainParents"]=consumer._external_parents(initial,consumer.world)
		consumer.loaded_live_binding=JSON.parse_string(FileAccess.get_file_as_string(args[4])).loadedLiveBinding;consumer.last_live_applied_serial=0
		for item in [{"path":args[2],"serial":21},{"path":args[3],"serial":204}]:
			consumer.live_serial=item.serial;consumer._accept_packet(Data.read_json(item.path),{"kind":"live","serial":item.serial,"lineage":consumer._source_scene_lineage()})
			var actual_world:Dictionary=consumer.world.duplicate(false);var width=62.5921199841426 if item.serial==21 else 10.9946619335637
			var actual_focus={"x":20000.9828128958,"y":19985.6064973675} if item.serial==21 else {"x":20001.269374443,"y":19985.5177019793}
			var actual_origin={"x":20038.9862060547,"y":2170.00805664063,"z":20038.9862060547}
			actual_world["_displaySource"]=Data.build_display_source(actual_world,Data.display_spacing(actual_world.terrain,width,128));actual_world["_heightLayers"]=Geometry.prepare_height_layers(actual_world)
			for attempt in 3:measured.append(compare(baseline,consumer.packet.source,actual_world,actual_origin,actual_focus,width,"retained V11 "+str(item.serial)+" attempt "+str(attempt)))
		for key in ["camera","objects","sun","live_request","hud"]:consumer.get(key).free()
		consumer.free()
	var report={"passed":failures.is_empty(),"checks":checks,"failures":failures,"measured":measured,"scope":"CPU exact source-cache outputs/rejections, elapsed buildMs excluded; retained V11 replays not archived original BODYs; no GPU or navigation claim"}
	if args.size()==6:
		var f=FileAccess.open(args[5],FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));f=null
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
