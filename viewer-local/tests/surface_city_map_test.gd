extends SceneTree
const M=preload("res://adapters/surface_city_map.gd")
var failures: Array=[]
func check(ok: bool,label: String):
	if not ok: failures.append(label)
func ring(points: Array,base: float)->Array:
	var result=[]
	for p in points: result.append({"x":float(p[0])+base,"y":float(p[1])+base})
	return result
func _initialize():
	var base=1000000000.001
	var origin={"x":base,"y":40.0,"z":base}
	var outer=ring([[0,0],[10,0],[10,10],[0,10]],base)
	var hole=ring([[3,3],[7,3],[7,7],[3,7]],base)
	var surface=[{"outer":outer,"holes":[hole]},{"outer":ring([[12,0],[14,0],[14,2],[12,2]],base),"holes":[]}]
	var building={"id":"source-native-id","representation":"native","groundHeightM":42.0,"roofFootprint":surface,"footprint":surface,"nativeLevels":[{"levels":[{"z_m":42.0,"height_m":3.0}]}],"triangles":[]}
	var packet={"urban":{"buildings":[building]}}
	var snapshot=JSON.stringify(packet)
	var result=M.prepare(packet,origin,{"x":base+5,"y":base+5},16.0)
	check(result.buildingIds==["source-native-id"] and result.representation=="cartographic-source-roof-overlay","explicit renderer preview and stable sourceID")
	check(absf(result.sourceRoofAreaM2-88.0)<0.00001,"outer minus courtyard plus second shape area exact")
	var area=0.0
	for i in range(0,result.vertices.size(),3):
		var a=result.vertices[i]; var b=result.vertices[i+1]; var c=result.vertices[i+2]
		var cross=(b-a).cross(c-a); area+=cross.length()*0.5
		check(cross.y>0 and a.y==5.0,"RH upward winding and explicit native-level plane")
		var centre=(a+b+c)/3.0
		check(not(centre.x>3 and centre.x<7 and centre.z>3 and centre.z<7),"triangles do not cover courtyard")
	check(absf(area-88)<0.00001,"GPU triangle area matches evenodd source area at large coordinates")
	check(result.outlineVertices.size()>0 and result.groups[0].outlineCount==result.outlineVertices.size(),"outer and courtyard source strokes retained separately")
	var courtyard_stroke=false
	for point in result.outlineVertices:
		if point.x>2.9 and point.x<7.1 and point.z>2.9 and point.z<7.1: courtyard_stroke=true
		check(absf(point.y-5.001)<0.000001,"cartographic stroke explicit plane lift")
	check(courtyard_stroke,"courtyard boundary receives outline")
	check(JSON.stringify(packet)==snapshot,"source surfaces levels and triangles unchanged")
	packet._cityMapVertexLimit=3
	var capped=M.prepare(packet,origin,{"x":base+5,"y":base+5},16.0)
	check(capped.vertices.is_empty() and capped.omittedBuildingIds==["source-native-id"],"budget is atomic per building")
	var reversed=building.duplicate(true)
	reversed.roofFootprint[0].outer.reverse(); reversed.roofFootprint[0].holes[0].reverse()
	var parity=M.prepare({"urban":{"buildings":[reversed]}},origin,{"x":base+5,"y":base+5},16.0)
	check(absf(parity.sourceRoofAreaM2-88)<0.00001,"evenodd independent of ring winding")
	print(JSON.stringify({"failures":failures,"vertices":result.vertices.size(),"sourceRoofAreaM2":result.sourceRoofAreaM2,"displayPlaneHeightM":result.groups[0].planeHeightM}))
	quit(0 if failures.is_empty() else 1)
