extends SceneTree
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_geometry.gd")
const H=preload("res://adapters/surface_hydrology.gd")
var failures: Array=[]
func check(ok: bool,label: String):
	if not ok:failures.append(label)
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Supply actual regional .surface packet [independent GEOS area for diagnostics]");quit(2);return
	var packet=D.read_json(args[0]);var world=D.unpack_world(packet)
	if world.is_empty():quit(1);return
	world["_terrainParents"]=packet.get("terrainParents",[]);world["_heightLayers"]=G.prepare_height_layers(world)
	var origin={"x":20000.0,"y":0.0,"z":20000.0};var focus={"x":20000.0,"y":20000.0}
	var levels=packet.source.water.levelM.duplicate();var classes=packet.source.water.classes.duplicate();var source_hash=hash(packet.source)
	var fallback=G.build_water(world,origin,focus,40000.0)
	var result=H.prepare(packet,world,origin,focus,40000.0,fallback)
	check(result.get("authority")=="magna-urbis-fixed-hydrology" and not result.has("fixedHydrologyFallbackReason"),"actual40km retains native vector water instead of safety-envelope fallback")
	check(result.vertices.size()<=H.MAX_VERTICES,"regional geometry vertex budget")
	check(int(result.get("sourceVectorScanWork",H.MAX_SCAN_WORK+1))<=H.MAX_SCAN_WORK,"actual active-edge work budget")
	check(int(result.get("sourceSimpleRingNativeGroups",0))>0 and int(result.get("sourceEvenOddSweepGroups",0))>0,"regional fixture exercises native simple contours and exact multi-contour sweep")
	check(int(result.get("missingLevelTriangles",-1))==0,"regional source has complete measured level support")
	check(absf(float(result.get("sourceVectorRequestedAreaM2",0))-float(result.get("sourceVectorAreaM2",0)))<maxf(0.001,float(result.get("sourceVectorRequestedAreaM2",0))*0.000001),"GPU float-area deviation within one ppm on actual regional source")
	check(packet.source.water.levelM==levels and packet.source.water.classes==classes and hash(packet.source)==source_hash,"raw levels classes IDs and archived source geometry unchanged")
	for vertex in result.vertices:check(vertex.is_finite(),"finite measured water output")
	var report={"failures":failures,"packet":args[0],"sourceGroups":result.get("sourceGroups"),"sourceDuplicateGroups":result.get("sourceDuplicateGroups"),"displayGroups":result.get("displayGroups"),"vertices":result.vertices.size(),"sourceSimpleRingNativeGroups":result.get("sourceSimpleRingNativeGroups"),"sourceEvenOddSweepGroups":result.get("sourceEvenOddSweepGroups"),"activeEdgeWork":result.get("sourceVectorScanWork"),"requestedSourceParityAreaM2":result.get("sourceVectorRequestedAreaM2"),"GPUAreaM2":result.get("sourceVectorAreaM2"),"missingLevelTriangles":result.get("missingLevelTriangles"),"buildMs":result.get("buildMs"),"maximumNativeFloatAreaErrorM2":result.get("maximumNativeFloatAreaErrorM2"),"maximumNativeFloatAreaToleranceM2":result.get("maximumNativeFloatAreaToleranceM2")}
	if args.size()>1:
		report.independentGeosAreaM2=float(args[1]);report.sourceConventionDifferenceM2=float(result.get("sourceVectorRequestedAreaM2",0))-float(args[1])
		report.sourceTopologyNote="Reference fixture has26 invalid/self-intersecting source rings; GEOS make_valid/XOR is an independent convention, not applied as a production repair. Source SVG itself is already flattened at0.2m."
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
