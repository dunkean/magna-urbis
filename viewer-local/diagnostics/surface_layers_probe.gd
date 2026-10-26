extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Layers=preload("res://adapters/surface_layers.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass input SurfaceWorld/packet path and optional JSON report path");quit(2);return
	var start=Time.get_ticks_usec();var packet=Data.read_json(args[0]);var world:Dictionary=packet.get("world",packet);var decode_ms=(Time.get_ticks_usec()-start)/1000.0
	if world.is_empty():push_error("Layer probe could not decode source");quit(1);return
	start=Time.get_ticks_usec();var valid=Layers.validate(world);var validate_ms=(Time.get_ticks_usec()-start)/1000.0
	if not valid:push_error("Layer validation failed");quit(1);return
	var context=Data.context(world)
	start=Time.get_ticks_usec();var prepared=Layers.prepare(world,context);var prepare_ms=(Time.get_ticks_usec()-start)/1000.0
	start=Time.get_ticks_usec();var reused=Layers.prepare(world,context);var reuse_ms=(Time.get_ticks_usec()-start)/1000.0
	var exact_cache=prepared.get("available",false) and is_same(prepared.groundIds,reused.groundIds) and is_same(prepared.lowAverage,reused.lowAverage)
	var report={"format":"surface-native-layer-preparation-proof","version":1,"input":args[0],"inputSHA256":FileAccess.get_sha256(args[0]),"worldId":world.id,"compilerVersion":world.get("compilerVersion"),"metadata":prepared.get("metadata",{}),"decodeMs":decode_ms,"validateMs":validate_ms,"prepareMs":prepare_ms,"reuseMs":reuse_ms,"sameImageObjectsOnReuse":exact_cache,"passed":valid and prepared.get("available",false) and exact_cache,"scope":"CPU layer validation/image preparation/cache, not a GPU rendering or fresh generation proof"}
	if args.size()>1:
		var output=FileAccess.open(args[1],FileAccess.WRITE);output.store_string(JSON.stringify(report,"  "));output=null
	print(JSON.stringify(report));quit(0 if report.passed else 1)
