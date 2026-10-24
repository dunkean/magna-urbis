extends "res://diagnostics/layer_probe.gd"
var _component_atlas:Dictionary={}
var _component_hashes:Dictionary={}
func physical_snapshot()->Dictionary:
	var result=super.physical_snapshot()
	var atlas:Dictionary=viewer.get("canopy_info")
	if not is_same(atlas,_component_atlas):
		_component_atlas=atlas;_component_hashes={}
		for role in ["coverageImage","countsImage","normalImage","colorImage"]:
			if not atlas.get(role) is Image:continue
			var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(atlas[role].get_data());_component_hashes[role]=hash.finish().hex_encode()
	result["rendererCanopyComponents"]=_component_hashes.duplicate()
	result["rendererTreeVersion"]=viewer.get("tree_library").version
	result["canopyView"]=viewer.get("canopy_view_state").duplicate(true)
	return result
