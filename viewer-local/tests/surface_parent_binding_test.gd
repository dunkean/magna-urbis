extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass authored refined layer fixture.surfacebin");quit(2);return
	var packet=Data.read_json(args[0]);var world:Dictionary=packet.get("world",{})
	if world.is_empty() or not world.has("canonicalContextRef"):push_error("Expected a bound authored context fixture");quit(2);return
	var canonical:Dictionary=world.canonicalContext
	var parent_grid:Dictionary=Data.read_json(str(args[0]).get_base_dir().path_join("canonical.surfacebin")).world.terrain
	packet.terrainParents=[{"canonicalContextId":world.canonicalContextRef.id,"terrain":parent_grid,"bounds":canonical.bounds}]
	var valid=not Data._validate_packet(packet.duplicate(true)).is_empty()
	var failures=[]
	if not valid:failures.append("Correctly bound parent rejected")
	for value in ["obsolete-context",7,null]:
		var changed=packet.duplicate(true);changed.terrainParents[0].canonicalContextId=value
		if not Data._validate_packet(changed).is_empty():failures.append("Malformed parent context binding accepted")
	var missing=packet.duplicate(true);missing.terrainParents[0].erase("canonicalContextId")
	if not Data._validate_packet(missing).is_empty():failures.append("Missing context binding accepted")
	var report={"passed":failures.is_empty(),"failures":failures,"scope":"Authored small bound-context packet: exact source parent accepted, stale/missing/non-string tags rejected before partial display"}
	print(JSON.stringify(report));quit(0 if report.passed else 1)
