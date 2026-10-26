extends SceneTree
# --script tests/prepare_control_test.gd -- <authored canonical.surfacebin> <frozen surface_data.gd>
# Both inputs are read-only. The baseline must precede the cancellation change.
const PrepareToken=preload("res://adapters/surface_prepare_control.gd")
const Data=preload("res://adapters/surface_data.gd")
class Consumer extends "res://scene/main.gd":
	var starts=0
	func _begin_prepare()->void:starts+=1
class RowGate extends "res://adapters/surface_prepare_control.gd":
	var entered=Semaphore.new()
	var resume=Semaphore.new()
	var rows=0
	func checkpoint(stage:String)->bool:
		if stage=="height-rows":
			rows+=1
			if rows==5:entered.post();resume.wait()
		return super.checkpoint(stage)
class PrefilterGate extends "res://adapters/surface_prepare_control.gd":
	func checkpoint(stage:String)->bool:
		if stage=="prefilter-rows":request_cancel(2,1)
		return super.checkpoint(stage)
var checks=0
func check(ok:bool,message:String)->void:
	checks+=1
	if not ok:push_error(message);quit(1);assert(ok,message)
func _initialize():call_deferred("run")
func release_consumer(consumer):
	for key in ["camera","objects","sun","live_request","hud"]:
		var node=consumer.get(key)
		if node is Node and not node.is_inside_tree():node.free()
	consumer.free()
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("Pass authored canonical.surfacebin and frozen surface_data.gd paths");quit(2);return
	var camera=PrepareToken.new(1,1,"shown","shown")
	check(camera.camera_only and camera.request_cancel(2,1),"Displayed camera refresh is cancellable")
	check(camera.report().requested and not camera.report().reached,"Request alone is not an observed cancellation")
	check(PrepareToken.hit(camera,"unit-checkpoint") and camera.report().stage=="unit-checkpoint","Checkpoint records the observed cancellation")
	var unseen=PrepareToken.new(2,1,"accepted-new","shown")
	for revision in [3,4,1000]:check(not unseen.request_cancel(revision,1),"Never cancel an accepted world that was not displayed")
	check(not PrepareToken.hit(unseen,"still-working"),"Unrendered world finishes despite an arbitrary stream of newer previews")
	var different_id=PrepareToken.new(1,1,"new","shown")
	check(not different_id.camera_only,"Matching revision alone is insufficient")
	var consumer=Consumer.new();consumer.world_revision=2;consumer.rendered_revision=1
	var completed=PrepareToken.new(1,1,"shown","shown")
	check(completed.request_cancel(2,1),"Completion race request is eligible")
	check(consumer._skip_obsolete_camera_refresh({"prepareControl":completed}),"Completed obsolete camera job skips water bake")
	check(consumer.starts==1 and consumer.discarded_preparations.get("skippedCameraRefresh",0)==1,"Skip restarts latest preparation immediately")
	check(consumer.discarded_preparations.get("cancelledSuperseded",0)==0 and not completed.report().reached,"Completion skip is not falsely counted as checkpoint cancellation")
	check(not consumer._skip_obsolete_camera_refresh({"prepareControl":unseen}),"Unrendered accepted preparation is never skipped")
	consumer._handle_prepared_result(PrepareToken.result(camera,"unit-checkpoint",Time.get_ticks_usec()))
	check(consumer.starts==2 and consumer.discarded_preparations.get("cancelledSuperseded",0)==1 and consumer.preparation_cancellations.size()==1,"Actual cancellation has its own counter and restarts once")
	check(consumer.discarded_preparations.failed==0,"Cancellation is not preparation failure")
	release_consumer(consumer)
	var fixture=args[0]
	var packet=Data.decode_packet(FileAccess.get_file_as_bytes(fixture))
	check(not packet.is_empty(),"Authored cross-TS fixture loads")
	if packet.is_empty():return
	var world=packet.world;var original_heights=world.terrain.heights.duplicate()
	var origin={"x":256.0,"y":0.0,"z":256.0}
	var gate=RowGate.new(1,1,"shown","shown")
	var thread=Thread.new()
	thread.start(Data.prepare.bind(world,origin,64.0,1,{},true,{},false,{"prepareControl":gate}))
	gate.entered.wait()
	check(gate.request_cancel(2,1),"Main thread requests cancellation while height rows are active")
	gate.resume.post()
	var cancelled=thread.wait_to_finish()
	check(cancelled.get("cancelled",false) and cancelled.cancelStage=="height-rows" and gate.rows==5,"Height construction exits at a real bounded row checkpoint")
	check(not cancelled.has("height") and world.terrain.heights==original_heights,"No partial image or source mutation escapes cancellation")
	var filter_gate=PrefilterGate.new(1,1,"shown","shown")
	check(Data.build_display_source(world,float(world.terrain.spacingM)*4.0,filter_gate).is_empty(),"Cancelled root prefilter returns clean sentinel before consumption")
	var baseline=GDScript.new()
	baseline.source_code=FileAccess.get_file_as_string(args[1]).replace("class_name SurfaceData","")
	check(baseline.reload()==OK,"Frozen baseline Data script loads independently")
	var expected=baseline.prepare(world,origin,64.0,3,{},false,{},false,{})
	var actual=Data.prepare(world,origin,64.0,3,{},false,{},false,{"prepareControl":unseen})
	for key in ["height","control","ids","state","rock","average"]:
		check(expected[key].get_data()==actual[key].get_data(),"Non-cancelled "+key+" image is byte-identical to frozen baseline")
	for key in ["spacing","localStart","contextGrid","loadedHeightRangeWorld"]:check(expected[key]==actual[key],"Non-cancelled "+key+" is unchanged")
	check(world.terrain.heights==original_heights,"All source heights remain unchanged")
	print(JSON.stringify({"passed":true,"checks":checks,"scope":"CPU eligibility, real concurrent height-row checkpoint, completion race, anti-starvation, and byte-identical non-cancelled authored fixture images; no GPU or fresh-source claim","rowCancellation":gate.report()}))
	quit()
