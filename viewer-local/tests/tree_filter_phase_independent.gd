extends SceneTree
class Recorder extends RefCounted:
	var values:Dictionary={}
	func set_shader_parameter(key:String,value):values[key]=value
	func set_shader_param(key:String,value):values[key]=value
class TerrainRecorder extends RefCounted:
	var material=Recorder.new()
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();if args.size()!=2:quit(2);return
	var before=FileAccess.get_sha256(args[0]);var code=FileAccess.get_file_as_string(args[0]);var weight_start=code.find("func _canopy_material_geometry_weight(");var weight_end=code.find("func _retire_canopy_nodes(",weight_start);var start=code.find("func _update_canopy_phase(");var end=code.find("func population_instances(",start);var script=GDScript.new()
	script.source_code="""extends RefCounted
var camera=RefCounted.new()
var canopy_info={}
var canopy_pending={}
var canopy_pending_elapsed=0.0
var canopy_pending_start_phase=2.0
var canopy_phase=2.0
var canopy_materials=[]
var canopy_view_state={}
var terrain
var canopy_transition_busy=false
var tree_asset_metrics={}
var retired=0
func _canopy_guard(_info):return {"safePhase":1.0,"geometryFilterCompatible":false}
func _retire_canopy_nodes():retired+=1
func _install_canopy_textures(_next):pass
"""+code.substr(weight_start,weight_end-weight_start)+code.substr(start,end-start)
	if min(weight_start,weight_end,start,end)<0 or script.reload()!=OK:push_error("Actual phase methods unavailable");quit(2);return
	var cases=[];var failures=[]
	for pending in [false,true]:
		for delta in [0.0,.016,1.0]:
			var helper=script.new();helper.terrain=TerrainRecorder.new();var recorders=[]
			for kind in ["high","middle","retired"]:
				var material=Recorder.new();material.set_meta("canopyRetired",kind=="retired");recorders.append(material)
			helper.canopy_materials=recorders
			if pending:helper.canopy_pending={"available":true}
			helper._update_canopy_phase(delta)
			var weights=[]
			for material in recorders:weights.append(material.values.get("canopy_geometry_weight",-1))
			if helper.canopy_phase>1 or helper.canopy_view_state.geometryWeight!=0 or helper.terrain.material.values.get("canopy_geometry_weight")!=0 or weights!=[0.0,0.0,0.0]:failures.append("Unsafe phase/material survived cap")
			cases.append({"pendingAtlas":pending,"delta":delta,"phase":helper.canopy_phase,"terrainWeight":helper.terrain.material.values.get("canopy_geometry_weight"),"highMiddleRetiredWeights":weights})
	if FileAccess.get_sha256(args[0])!=before:failures.append("main changed during test")
	var result={"status":"PASS" if failures.is_empty() else "FAIL","reviewedMainSha256":before,"cases":cases,"failures":failures,"scope":"Actual pure phase/material-weight method text with CPU shader-parameter recorders; verifies immediate global cap including pending atlas at delta0. Not GPU rendering, uniform binding integration or node visibility."};var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(result,"  "));file=null;print(JSON.stringify(result));quit(0 if failures.is_empty() else 1)
