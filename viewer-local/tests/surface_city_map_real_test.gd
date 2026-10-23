extends SceneTree
const D=preload("res://adapters/surface_data.gd")
const U=preload("res://adapters/urban_reader.gd")
const M=preload("res://adapters/surface_city_map.gd")
var failures: Array=[]
func check(ok: bool,label: String):
	if not ok: failures.append(label)
func ring_area(ring: Array)->float:
	if ring.size()<3: return 0.0
	var x0=float(ring[0].x); var z0=float(ring[0].y); var area=0.0
	for i in ring.size():
		var a=ring[i];var b=ring[(i+1)%ring.size()]
		area+=(float(a.x)-x0)*(float(b.y)-z0)-(float(b.x)-x0)*(float(a.y)-z0)
	return absf(area)*0.5
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.is_empty(): push_error("Supply existing real500 .surface packet"); quit(2);return
	var packet=D.read_json(args[0])
	if packet.is_empty(): quit(1);return
	var urban: Dictionary=packet.urban
	var snapshot=hash(urban)
	var expected_area=0.0;var ids={};var source_holes=0
	for index in urban.buildings.size():
		var building=U.building(urban,index);ids[building.id]=true
		for shape in building.roofFootprint:
			expected_area+=ring_area(shape.outer)
			for hole in shape.holes: expected_area-=ring_area(hole);source_holes+=1
	var result=M.prepare(packet,{"x":8000.0,"y":0.0,"z":8000.0},{"x":8000.0,"y":8000.0},40000.0)
	check(result.buildingIds.size()==500 and result.omittedBuildingIds.is_empty() and result.invalidBuildingIds.is_empty(),"all500 real native source roof previews")
	check(absf(result.sourceRoofAreaM2-expected_area)<0.000001,"real500 exact source outer-minus-hole area")
	for id in result.buildingIds: check(ids.has(id),"preview preserves source building ID")
	check(hash(urban)==snapshot,"real source columns native triangles and metadata unchanged")
	check(result.outlineVertices.size()>0,"shared source boundary outlines generated")
	print(JSON.stringify({"failures":failures,"sourceBuildings":urban.buildings.size(),"renderedBuildings":result.buildingIds.size(),"sourceCourtyardRings":source_holes,"vertices":result.vertices.size(),"outlineVertices":result.outlineVertices.size(),"sourceRoofAreaM2":result.sourceRoofAreaM2,"expectedRoofAreaM2":expected_area,"buildMs":result.buildMs,"representation":result.representation}))
	quit(0 if failures.is_empty() else 1)
