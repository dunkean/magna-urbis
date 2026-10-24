extends "res://diagnostics/tree_color_layer_probe.gd"
func instance_buffer_digest()->String:
	var buffers:Dictionary={}
	for item in viewer.get("objects").get_children():
		if item is MultiMeshInstance3D and item.multimesh!=null and not item.get_meta("solarShadow",false):buffers[str(item.name)]=item.multimesh.buffer
	var names=buffers.keys();names.sort();return digest_fields(buffers,names)
func physical_snapshot()->Dictionary:
	var result=super.physical_snapshot()
	result["treeSolarShadows"]=viewer.get("tree_solar_metrics").duplicate(true)
	return result
