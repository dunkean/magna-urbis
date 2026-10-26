extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
class Harness extends "res://scene/main.gd":
	func _ready()->void:pass
func _initialize():call_deferred("run")
func run():
	var packet=Data.read_json(OS.get_cmdline_user_args()[0]);var world=Data.unpack_world(packet)
	var node=Harness.new();node.set_process(false);node.options={"--ground-only":true,"--presentation":"aerial"};node.world=world;node.packet=packet;node.presentation_mode="aerial";node.world_revision=1;node.generation=0;node.packet["_acceptedLiveSerial"]=3
	node.focus={"x":(float(world.bounds.minX)+float(world.bounds.maxX))/2,"y":(float(world.bounds.minZ)+float(world.bounds.maxZ))/2};node.width_m=10;node.surface_shader_code=node.ShaderSource.build();node.library.load_manifest("")
	root.add_child(node);node._setup_lighting();node.add_child(node.camera);node.camera.current=true;node.add_child(node.objects)
	node._begin_prepare()
	var newer_world=world.duplicate(false);newer_world.id=str(world.id)+":newer-fine-tile";node.world=newer_world;node.world_revision=2;node.packet=packet.duplicate(false);node.packet.world=newer_world;node.packet["_acceptedLiveSerial"]=4
	while node.worker.is_alive():await process_frame
	var prepared=node.worker.wait_to_finish();node.worker=null;node._apply_prepared(prepared)
	await process_frame;await RenderingServer.frame_post_draw
	var failures=[]
	if node.rendered_world_id!=world.id or node.rendered_live_serial!=3 or node.rendered_revision!=1 or node.world.id!=newer_world.id:failures.append("complete older same-lineage preparation was discarded or overwrote the logical latest world")
	if node.render_events.size()!=1 or node.rendered_snapshot.worldId!=world.id or node.rendered_snapshot.liveSerial!=3 or node.rendered_snapshot.appliedTickMs<=0:failures.append("actual display evidence missing")
	node.packet.source=node.packet.source.duplicate(false);node.packet.source.sceneEpoch="obsolete-test-scene";node._apply_prepared(prepared)
	if node.discarded_preparations.obsoletePhysicalLineage!=1 or node.render_events.size()!=1:failures.append("obsolete scene was displayed")
	node.packet=packet;prepared.worldRevision=0;node._apply_prepared(prepared)
	if node.discarded_preparations.olderThanDisplayed!=1 or node.render_events.size()!=1:failures.append("display revision regressed")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"renderedSnapshot":node.rendered_snapshot,"logicalLatestWorldId":node.world.id,"discardedPreparations":node.discarded_preparations,"renderer":RenderingServer.get_current_rendering_method(),"scope":"real source packet prepared and uploaded to Terrain3D while a newer same-lineage world is pending; obsolete epoch and revision rejected"}))
	for child in [node.live_request,node.hud]:
		if is_instance_valid(child) and child.get_parent()==null:child.free()
	node.free();quit(0 if failures.is_empty() else 1)
