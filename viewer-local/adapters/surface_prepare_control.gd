class_name SurfacePrepareControl
extends RefCounted
# Eligibility is frozen when the job starts. A newly accepted, unrendered
# revision must finish even if another accepted preview arrives meanwhile.
var _mutex=Mutex.new()
var revision:int
var camera_only:bool
var _requested=false
var _reached=false
var _stage=""
var _request_tick_us=0
var _reach_tick_us=0
func _init(job_revision:int=-1,displayed_revision:int=-2,job_world_id:String="",displayed_world_id:String=""):
	revision=job_revision
	camera_only=job_revision>=0 and job_revision==displayed_revision and not job_world_id.is_empty() and job_world_id==displayed_world_id
func request_cancel(newer_accepted_revision:int,displayed_revision:int)->bool:
	_mutex.lock()
	var allowed=camera_only and newer_accepted_revision>revision and revision<=displayed_revision
	if allowed and not _requested:_requested=true;_request_tick_us=Time.get_ticks_usec()
	_mutex.unlock();return allowed
func checkpoint(stage:String)->bool:
	_mutex.lock()
	if _requested and not _reached:_reached=true;_stage=stage;_reach_tick_us=Time.get_ticks_usec()
	var reached=_reached
	_mutex.unlock();return reached
func report()->Dictionary:
	_mutex.lock()
	var result={"cameraOnly":camera_only,"revision":revision,"requested":_requested,"reached":_reached,"stage":_stage,"requestedTickUs":_request_tick_us,"reachedTickUs":_reach_tick_us}
	_mutex.unlock();return result
static func hit(control,stage:String)->bool:
	return control is SurfacePrepareControl and control.checkpoint(stage)
static func result(control,stage:String,started:int)->Dictionary:
	return {"cancelled":true,"cancelStage":stage,"prepareControl":control,"prepareMs":(Time.get_ticks_usec()-started)/1000.0,"cancellation":control.report() if control is SurfacePrepareControl else {}}
static func obsolete_camera_result(prepared:Dictionary,accepted_revision:int,displayed_revision:int)->bool:
	# Covers completion racing the cancellation request: no checkpoint count is
	# incremented when this completed camera refresh is skipped before its bake.
	var control=prepared.get("prepareControl")
	return control is SurfacePrepareControl and control.camera_only and control.revision<accepted_revision and control.revision<=displayed_revision
