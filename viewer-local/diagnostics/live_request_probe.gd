extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
class Harness extends "res://scene/main.gd":
	var preparations:=0
	func _begin_prepare()->void:preparations+=1
	func _resolve_scene(_value:Dictionary)->bool:return true
	func _resolve_context(_value:Dictionary)->bool:return true
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Requires a real surface packet path");quit(2);return
	var packet=Data.read_json(args[0]);var node=Harness.new();node.world=Data.unpack_world(packet);node.packet=packet;node.environment_settings=Environment.new();node.loaded_live_binding=node.LiveBinding.from_packet(packet,node.world)
	var file=FileAccess.open(args[0],FileAccess.READ);var bytes=file.get_buffer(file.get_length())
	node.live_serial=44;node.live_requested_serial=3;node.live_busy=true
	node.live_request_context={"kind":"live","serial":3,"lineage":node._source_scene_lineage(),"baseWorldId":node.world.id}
	node._live_completed(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),bytes)
	var failures=[]
	if node.packet_worker==null:failures.append("camera movement discarded active response")
	else:
		while node.packet_worker.is_alive():await process_frame
		var received=node.packet_worker.wait_to_finish();node.packet_worker=null
		node._accept_packet(received,node.packet_context)
		if node.last_live_applied_serial!=3 or node.preparations!=1:failures.append("completed older-view tile was not accepted")
		if node.live_acceptance_events.is_empty() or node.live_acceptance_events[0].cameraSerial!=44:failures.append("acceptance evidence missing")
		var old_context={"kind":"live","serial":2,"lineage":node._source_scene_lineage()};node._accept_packet(received,old_context)
		if node.preparations!=1:failures.append("older-than-applied tile accepted")
		node.live_requested_serial=45;node.live_serial=60;node.live_request_context={"kind":"live","serial":45,"lineage":node._source_scene_lineage()}
		node.known_scene_context_id="changed-scene-epoch"
		node._live_completed(HTTPRequest.RESULT_SUCCESS,200,PackedStringArray(),bytes)
		if node.packet_worker!=null:failures.append("obsolete source/scene request started decoding")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"scope":"request-state harness using real packet; separate from live neural-provider E2E","events":node.live_acceptance_events}))
	for child in [node.camera,node.sun,node.objects,node.live_request,node.hud]:
		if is_instance_valid(child) and child.get_parent()==null:child.free()
	node.free();quit(0 if failures.is_empty() else 1)
