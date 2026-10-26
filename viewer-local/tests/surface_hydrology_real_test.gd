extends SceneTree
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_geometry.gd")
const H=preload("res://adapters/surface_hydrology.gd")
var failures: Array=[]
func check(ok: bool,label: String):
	if not ok: failures.append(label)
func ring_area(ring: Array)->float:
	if ring.size()<3:return 0.0
	var x0=float(ring[0].x);var z0=float(ring[0].y);var sum=0.0
	for i in ring.size():
		var a=ring[i];var b=ring[(i+1)%ring.size()]
		sum+=(float(a.x)-x0)*(float(b.y)-z0)-(float(b.x)-x0)*(float(a.y)-z0)
	return absf(sum)*0.5
func in_ring(x: float,z: float,ring: Array)->bool:
	var inside=false
	for i in ring.size():
		var a=ring[i];var b=ring[(i+1)%ring.size()]
		if (float(a.y)>z)!=(float(b.y)>z) and x<(float(b.x)-float(a.x))*(z-float(a.y))/(float(b.y)-float(a.y))+float(a.x):inside=not inside
	return inside
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Supply a retained real Magna .surface/.json packet [x,z,width]");quit(2);return
	var packet=D.read_json(args[0])
	if packet.is_empty():quit(1);return
	var world=D.unpack_world(packet)
	world["_terrainParents"]=packet.get("terrainParents",[]);world["_heightLayers"]=G.prepare_height_layers(world)
	var water: Dictionary=packet.source.water
	var origin={"x":float(water.originX)+float(water.width)*0.5,"y":0.0,"z":float(water.originZ)+float(water.width)*0.5}
	var focus={"x":origin.x,"y":origin.z};var width=256.0
	if args.size()>1:
		var settings=args[1].split(",");focus={"x":float(settings[0]),"y":float(settings[1])};width=float(settings[2]);origin.x=focus.x;origin.z=focus.y
	var snapshot_levels=water.levelM.duplicate();var snapshot_classes=water.classes.duplicate();var snapshot_geometry=hash(packet.source.get("geometry"))
	var geometry=H._geometry(packet.source)
	check(geometry is Dictionary and geometry.get("water") is Array,"real retained geometry restored")
	var window=G._window(focus,width)
	var spacing=float(water.width)/int(water.n)
	window.minX=maxf(float(window.minX),float(water.originX)-spacing*0.5);window.minZ=maxf(float(window.minZ),float(water.originZ)-spacing*0.5)
	window.maxX=minf(float(window.maxX),float(water.originX)+(int(water.n)-0.5)*spacing);window.maxZ=minf(float(window.maxZ),float(water.originZ)+(int(water.n)-0.5)*spacing)
	var expected_area=0.0;var holes=0;var contour_points=0;var seen=[];var source_duplicates=0;var island_rings=[]
	for group in geometry.water:
		if group in seen: source_duplicates+=1;continue
		seen.append(group)
		for index in group.size():
			var clipped=H._clip(group[index],window);contour_points+=group[index].size()
			if index>0:holes+=1;island_rings.append(clipped)
			expected_area+=ring_area(clipped)*(1.0 if index==0 else -1.0)
	var fallback=G.build_water(world,origin,focus,width)
	var result=H.prepare(packet,world,origin,focus,width,fallback)
	check(result.get("authority")=="magna-urbis-fixed-hydrology","fixed source vector authority selected")
	check(result.get("sourceVectorCoverageComplete",true)==(int(result.get("missingLevelTriangles",0))==0),"missing source levels explicitly mark partial coverage")
	check(absf(float(result.get("sourceVectorAreaM2",0))+float(result.get("sourceVectorMissingAreaM2",0))-expected_area)<maxf(0.01,expected_area*0.000001),"source contour area and native width preserved after clipping")
	check(water.levelM==snapshot_levels and water.classes==snapshot_classes and hash(packet.source.get("geometry"))==snapshot_geometry,"source levels classes and archived geometry unchanged")
	for at in range(0,result.vertices.size(),3):
		var centre=(result.vertices[at]+result.vertices[at+1]+result.vertices[at+2])/3.0
		for island in island_rings:check(not in_ring(float(origin.x)+centre.x,float(origin.z)+centre.z,island),"real source island remains a hole in native water fill")
	check(result.get("sourceDuplicateGroups",0)==source_duplicates,"exact duplicate source groups deduplicated only for display")
	# Direct geometry and its reversible binary attachment must yield identical meshes.
	var direct=packet.duplicate(false);direct.source=packet.source.duplicate(false);direct.source.geometry=geometry
	var direct_result=H.prepare(direct,world,origin,focus,width,fallback)
	check(direct_result.vertices==result.vertices,"direct and attached geometry give identical output")
	# Explicit stress derived from a real source point, not a generation fixture.
	var over_source=packet.source.duplicate(false);var huge=[];huge.resize(H.MAX_SOURCE_POINTS+1);huge.fill(geometry.water[0][0][0])
	over_source.geometry={"water":[[huge]]}
	var limited=H.prepare({"source":over_source},world,origin,focus,width,fallback)
	check(limited.get("fixedHydrologyFallbackReason","").contains("point budget"),"point budget returns explicit safe physical fallback")
	var cavern=packet.source.duplicate(false);cavern.meta={"query":null};cavern["$surfaceSourceArchive"]={"format":"surface-source-archive-1","attachments":[{"path":["meta","query"],"encoding":"json-utf8","bytes":JSON.stringify("relief=%63avern").to_utf8_buffer()}]};cavern.geometry=geometry
	var cave_result=H.prepare({"source":cavern},world,origin,focus,width,fallback)
	check(cave_result.get("fixedHydrologyFallbackReason","").contains("cavern"),"archived escaped cavern recipe cannot promote class2 voids to lakes")
	print(JSON.stringify({"failures":failures,"packet":args[0],"focus":focus,"viewWidth":width,"authority":result.get("authority"),"sourcePoints":contour_points,"sourceHoleRings":holes,"sourceVectorAreaM2":result.get("sourceVectorAreaM2"),"sourceVectorMissingAreaM2":result.get("sourceVectorMissingAreaM2"),"sourceDuplicateGroups":source_duplicates,"displayGroups":result.get("displayGroups"),"expectedClippedAreaM2":expected_area,"triangles":result.vertices.size()/3,"missingLevelTriangles":result.get("missingLevelTriangles",0),"fallbackReason":result.get("fixedHydrologyFallbackReason"),"buildMs":result.get("buildMs")}))
	quit(0 if failures.is_empty() else 1)
