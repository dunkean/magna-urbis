extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Layers=preload("res://adapters/surface_layers.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var start=Time.get_ticks_msec()
	var packet=Data.read_json(args[0]);var world=packet.get("world",{});var failures=[]
	if world.is_empty():push_error("Fixture did not decode");quit(2);return
	var info=Layers.prepare(world,Data.context(world));var again=Layers.prepare(world,Data.context(world))
	if not info.get("available",false):failures.append("No explicit layers")
	if not is_same(info.groundIds,again.groundIds) or not is_same(info.lowAverage,again.lowAverage):failures.append("Immutable field aliases missed image cache")
	for path in [["source","archive",0,"values"],["world","fields",1],["source",0,1],[1,2]]:
		if Layers.expected_wire_dtype(path)!="":failures.append("Numeric archive path was misclassified")
	var maximum=0.0
	for z in range(0,int(world.terrain.height),31):
		for x in range(0,int(world.terrain.width),29):
			var i=z*int(world.terrain.width)+x;var alpha=float(world.fields.lowCoverOpacity[i]);var rgb=Layers._linear(int(world.fields.lowCoverMaterialMeanColor[i]));var actual=info.lowAverage.get_pixel(x,z)
			maximum=maxf(maximum,maxf(absf(actual.r-rgb.r*alpha),maxf(absf(actual.g-rgb.g*alpha),absf(actual.b-rgb.b*alpha))))
			if absf(actual.a-alpha)>0.000001:failures.append("Coverage changed")
	if maximum>0.000001:failures.append("Premultiplied mean differs")
	var report={"passed":failures.is_empty(),"failures":failures,"elapsedMs":Time.get_ticks_msec()-start,"metadata":info.metadata,"maximumPremultipliedError":maximum,"scope":"Actual retained teacher migrated by compiler1.5.1; independent layer preparation/cache and numeric archive descriptors, CPU only"}
	if args.size()>1:var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if report.passed else 1)
