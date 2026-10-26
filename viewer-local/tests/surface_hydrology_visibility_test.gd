extends SceneTree
const H=preload("res://adapters/surface_hydrology.gd")
const G=preload("res://adapters/surface_geometry.gd")
const D=preload("res://adapters/surface_data.gd")
var failures: Array=[]
func check(ok: bool, label: String):
	if not ok: failures.append(label)
func _initialize():
	# Explicit test fixture, not a claim of generated terrain: source polygon
	# lies below a flat bed while the derived physical raster is entirely dry.
	var heights:=PackedFloat32Array();heights.resize(16);heights.fill(4.0)
	var classes:=PackedByteArray();classes.resize(16);classes.fill(3)
	var levels:=PackedFloat32Array();levels.resize(16);levels.fill(1.0)
	var dry:=PackedByteArray();dry.resize(16)
	var dry_levels:=PackedFloat32Array();dry_levels.resize(16);dry_levels.fill(NAN)
	var grid={"width":4,"height":4,"originX":20.,"originZ":20.,"spacingM":40.,"heights":heights}
	var world={"terrain":grid,"bounds":{"minX":20.,"minZ":20.,"maxX":140.,"maxZ":140.},"fields":{"waterClass":dry,"waterLevelM":dry_levels}}
	var source={"water":{"n":4,"width":160.,"originX":20.,"originZ":20.,"classes":classes,"levelM":levels},"geometry":{"water":[[[{"x":30.,"y":30.},{"x":130.,"y":30.},{"x":130.,"y":130.},{"x":30.,"y":130.}]]]}}
	var source_hash:=hash(source)
	var origin={"x":80.,"y":0.,"z":80.};var focus={"x":80.,"y":80.}
	var result=H.prepare({"source":source},world,origin,focus,160.,G.build_water(world,origin,focus,160.))
	check(result.get("authority")=="magna-urbis-fixed-hydrology","retained vectors remain authoritative despite all-dry derived raster")
	check(result.get("missingLevelTriangles",-1)==0 and absf(float(result.get("sourceVectorAreaM2",0))-10000.)<0.01,"complete source area without fallback")
	check(result.get("vectorBedDiagnosticSamples",0)==result.vertices.size() and result.get("vectorBedDiagnosticConflicts",0)==result.vertices.size(),"small fixture probes every vector vertex and reports below-bed conflicts")
	check(absf(float(result.get("vectorBedDiagnosticMaximumDeltaM",0))-3.)<0.00001,"exact bed delta, not a raster conflict count")
	check(hash(source)==source_hash,"source geometry classes levels unchanged")
	for vertex in result.vertices:check(vertex.y==1.,"source measured level never raised to terrain")
	var many:=PackedVector3Array();many.resize(20000);many.fill(Vector3(0,1,0))
	check(int(H.vector_bed_diagnostics(many,world,origin).vectorBedDiagnosticSamples)<=H.MAX_BED_DIAGNOSTIC_SAMPLES,"diagnostic work bounded")
	var reports: Array=[];var args=OS.get_cmdline_user_args()
	if not args.is_empty():
		var packet=D.read_json(args[0]);var actual=D.unpack_world(packet)
		actual["_terrainParents"]=packet.get("terrainParents",[]);actual["_heightLayers"]=G.prepare_height_layers(actual)
		var saved_hash:=hash(packet.source)
		for span in [10000.,2560.]:
			var anchor={"x":20000.,"y":0.,"z":20000.};var center={"x":20000.,"y":20000.}
			var r=H.prepare(packet,actual,anchor,center,span,G.build_water(actual,anchor,center,span))
			check(r.get("authority")=="magna-urbis-fixed-hydrology" and not r.has("fixedHydrologyFallbackReason"),"actual regional source stays vector authoritative")
			check(r.get("missingLevelTriangles",-1)==0,"actual regional measured source level coverage complete")
			check(int(r.get("vectorBedDiagnosticConflicts",0))>0,"actual regional visibility conflicts detected instead of misleading raster zero")
			check(hash(packet.source)==saved_hash,"actual source unchanged")
			var report={"viewWidthM":span,"vertices":r.vertices.size(),"packet":args[0]}
			for key in r:
				if r[key] is String or r[key] is bool or r[key] is float or r[key] is int: report[key]=r[key]
			reports.append(report)
	var report={"CPUOnly":true,"failures":failures,"views":reports,"scope":"source contour triangulation and bounded display-bed diagnostics; no GPU visibility or discharge claim"}
	if args.size()>1:
		var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
