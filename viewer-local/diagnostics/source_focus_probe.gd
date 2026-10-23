extends SceneTree
const Main=preload("res://scene/main.gd")
const Data=preload("res://adapters/surface_data.gd")
func _initialize():
	var node=Main.new();var failures=[]
	var child={"spacingM":1.0,"source":{"id":"same-physical-source","sourceLOD":-2,"sourceLODKnown":true}}
	var parent={"spacingM":2.0,"source":{"id":"same-physical-source","sourceLOD":0,"sourceLODKnown":false}}
	var world={"terrain":child,"bounds":{"minX":0.0,"minZ":0.0,"maxX":10.0,"maxZ":10.0},"_terrainParents":[{"terrain":parent,"bounds":{"minX":-10.0,"minZ":-10.0,"maxX":20.0,"maxZ":20.0}}],"_displaySpacing":0.5}
	for test in [[5.0,1.0,true],[1.0,0.15625,true],[0.0,0.0,false],[15.0,0.0,false]]:
		var result=node._source_actual_at_focus(world,world,{"x":test[0],"y":5.0})
		if absf(result.fineContributionWeight-float(test[1]))>0.000001 or result.sourceActualAtFocus.get("sourceLODKnown",false)!=test[2]:failures.append("wrong child/parent contribution at "+str(test[0]))
	var real={}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():
		var packet=Data.read_json(args[0]);var value=Data.unpack_world(packet);value["_terrainParents"]=packet.get("terrainParents",[])
		real=node._source_actual_at_focus(value,Data.build_display_source(value,7.8125),{"x":8000.0,"y":8000.0})
		if real.focusInsideSource or real.fineContributionWeight!=0 or real.sourceActualAtFocus.get("sourceLODKnown",true):failures.append("real500 view misreported as child refinement")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"real500":real,"scope":"exact coarse-to-fine source contribution at focus, including Geometry.height_at seam feather"}))
	for child_node in [node.camera,node.sun,node.objects,node.live_request,node.hud]:
		if is_instance_valid(child_node):child_node.free()
	node.free();quit(0 if failures.is_empty() else 1)
