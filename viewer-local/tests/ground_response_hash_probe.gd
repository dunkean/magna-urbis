extends SceneTree
const Ground=preload("res://adapters/surface_ground_response.gd")
const Data=preload("res://adapters/surface_data.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():quit(2);return
	var began=Time.get_ticks_usec();var response=Data.read_json(args[0]);var decoded_ms=(Time.get_ticks_usec()-began)/1000.0
	if response.is_empty():push_error("Response fixture decode failed");quit(1);return
	began=Time.get_ticks_usec();var actual=Ground.identity(response);var hash_ms=(Time.get_ticks_usec()-began)/1000.0
	var report={"status":"PASS" if actual==response.id else "FAIL","width":response.grid.width,"height":response.grid.height,"typedBytes":26*int(response.grid.width)*int(response.grid.height),"decodeMs":decoded_ms,"identityMs":hash_ms,"id":actual,"scope":"CPU hash microprobe of retained V12-derived512 typed response; not fresh source or navigation latency"}
	if args.size()>1:
		began=Time.get_ticks_usec();var value=Data.read_json(args[1]);report.fullWorldDecodeAndValidationMs=(Time.get_ticks_usec()-began)/1000.0
		var world:Dictionary=value.get("world",value)
		if world.is_empty():push_error("Full retained response world rejected");quit(1);return
		began=Time.get_ticks_usec();var images=Ground.prepare(world,Data.context(world));report.coldImagePrepareMs=(Time.get_ticks_usec()-began)/1000.0
		var compact={"canonicalContextRef":{"id":"known-test-context","groundResponseVersion":world.versions.groundResponse},"versions":world.versions,"materials":world.materials,"geology":world.geology}
		began=Time.get_ticks_usec()
		for i in 100:
			if not Ground.validate(compact):push_error("Compact reference rejected");quit(1);return
			var reused=Ground.prepare(compact,Data.context(world))
			if not is_same(reused.bindings.ground_response_soil,images.bindings.ground_response_soil):push_error("Known-context images were regenerated");quit(1);return
		report.knownContextValidateAndPrepare100Ms=(Time.get_ticks_usec()-began)/1000.0
		report.knownContextTablePresent=false;report.knownContextImagesSame=true
	if args.size()>2:
		began=Time.get_ticks_usec();var legacy=Data.read_json(args[2]);report.legacyPacketDecodeAndValidationMs=(Time.get_ticks_usec()-began)/1000.0
		if legacy.is_empty():push_error("Legacy control decode failed");quit(1);return
		report.controlScope="Same retained source packet with/without explicit response; whole packet parser/legacy validation included, not isolated response validation CPU"
	print(JSON.stringify(report));quit(0 if actual==response.id else 1)
