extends SceneTree
const Q=preload("res://adapters/surface_view_quality.gd")
class Harness extends "res://scene/main.gd":
	func _ready()->void:pass
func _initialize():
	var failures=[]
	var world={"id":"fine-known","terrain":{"width":512,"height":512,"originX":39.0625,"originZ":39.0625,"spacingM":78.125,"source":{"sourceLODKnown":true,"nativeSpacingM":39.0625}},"bounds":{"minX":39.0625,"minZ":39.0625,"maxX":39960.9375,"maxZ":39960.9375},"versions":{}}
	var packet={"source":{"request":{"x":0.0,"y":0.0,"extent":40000.0,"resolution":512,"preview":false}}}
	var region={"x":0.0,"y":0.0,"extent":40000.0,"resolution":128,"preview":true}
	if not Q.preview(100,449) or Q.preview(100,450):failures.append("preview settle window")
	var evidence=Q.cache_evidence(world,packet,region,true)
	if not evidence.covered or evidence.deliveredSpacingM!=78.125 or evidence.requiredSpacingM!=312.5:failures.append("clamped full ROI preview cache")
	if Q.cache_evidence(world,packet,region,false).covered:failures.append("physical lineage mismatch accepted")
	var off=region.duplicate();off.x=1.0
	if Q.cache_evidence(world,packet,off,true).covered:failures.append("out-of-source ROI accepted")
	var fine=region.duplicate();fine.extent=8000.0
	if Q.cache_evidence(world,packet,fine,true).covered:failures.append("insufficient source density accepted")
	var final=region.duplicate();final.resolution=512;final.preview=false
	var preview_packet={"source":{"request":{"x":0.0,"y":0.0,"extent":40000.0,"resolution":128,"preview":true}}}
	if Q.cache_evidence(world,preview_packet,final,true).covered:failures.append("preview source accepted as final512")
	var capped=world.duplicate(true);capped.terrain.spacingM=78.125;capped.terrain.source.nativeSpacingM=100.0
	var e=Q.cache_evidence(capped,packet,final,true)
	if not e.covered or e.requiredSpacingM!=100.0:failures.append("native density cap")
	var node=Harness.new();node.world=world;node.packet=packet;node.rendered_world=world;node.rendered_packet=packet;node.rendered_world_id=world.id;node.rendered_live_serial=3;node.last_live_applied_serial=3;node.live_serial=44;node.last_real_input_tick=Time.get_ticks_msec();node.focus={"x":20000.0,"y":20000.0};node.width_m=40000
	if not node._update_view_satisfaction("test-cache",region) or node.view_satisfied_serial!=44 or node.rendered_live_serial!=3 or node.last_live_applied_serial!=3:failures.append("cache forged an acceptance or failed camera satisfaction")
	node.quality_preview_active=true;node.last_real_input_tick=Time.get_ticks_msec()-351;node.options["--live-url"]="http://127.0.0.1:1";node._update_quality_state()
	var settled=Q.request_region(world,packet,node.focus,node.width_m,node._quality_preview())
	if settled.preview or settled.resolution!=512 or not node.final_quality_pending or node.live_serial!=44:failures.append("settling failed to request final512 at the unchanged camera serial")
	if node._expected_height_image_size(100.0,20000.0)!=512 or node._expected_height_image_size(100.0,40000.0)!=1024 or node._expected_height_image_size(100.0,80000.0)!=2048:failures.append("height window cache size at fixed native spacing")
	if not node._import_alignment_valid({"spacing":1.0,"localStart":Vector3(-256,0,-256)}) or node._import_alignment_valid({"spacing":1.0,"localStart":Vector3(-128,0,-128)}) or node._import_alignment_valid({"spacing":312.5,"localStart":Vector3(-80000,0,-80000)}):failures.append("native import invariants")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"viewSatisfiedSerial":node.view_satisfied_serial,"realAcceptedSerial":node.last_live_applied_serial,"renderedLiveSerial":node.rendered_live_serial,"evidence":node.view_satisfaction}))
	for child in [node.camera,node.sun,node.objects,node.live_request,node.hud]:child.free()
	node.free();quit(0 if failures.is_empty() else 1)
