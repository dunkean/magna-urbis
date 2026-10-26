extends SceneTree
const View=preload("res://adapters/surface_canopy_view.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
const Data=preload("res://adapters/surface_data.gd")
func _initialize():call_deferred("run")
var passed=true
func check(value:bool,label:String)->void:
	if not value:push_error(label);passed=false
func run():
	root.size=Vector2i(1000,1000)
	var camera=Camera3D.new();root.add_child(camera);camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=640;camera.position=Vector3(0,1000,0);camera.look_at(Vector3.ZERO,Vector3.FORWARD)
	var bounds={"minX":-2000.0,"maxX":2000.0,"minZ":-2000.0,"maxZ":2000.0};var origin={"x":0.0,"y":0.0,"z":0.0}
	var samples=[]
	for x in [0.0,1590.0,1620.0,1640.0,1700.0]:
		camera.position.x=x
		var state=View.evaluate(camera,Vector2(1000,1000),0,origin,bounds,40)
		check(float(state.safePhase)>=0 and float(state.safePhase)<=2,"phase out of range")
		if x==0:check(state.safePhase==2,"covered view must allow full phase")
		if x>=1640:check(state.safePhase==0,"geometry must be gone before the page edge enters the halo")
		if state.safePhase<1:check(maxf(0,state.safePhase-1)==0,"geometry during optical transition")
		samples.append(state)
	camera.position.x=0
	var rebased=View.evaluate(camera,Vector2(1000,1000),0,{"x":1000000000.0,"y":0,"z":-1000000000.0},{"minX":999998000.0,"maxX":1000002000.0,"minZ":-1000002000.0,"maxZ":-999998000.0},40)
	check(rebased.safePhase==2,"double coordinate rebase changed safety")
	var page={"bounds":bounds,"requestedBounds":bounds,"complete":true,"count":0,"includeOverhang":true,"retention":1,"limitedBy":"candidate-budget"};var pages={"version":"surface-candidate-pages-1"}
	for family in ["tree","shrub","boulder","grass","debris"]:pages[family]=page.duplicate(true)
	var packet={"candidatePages":pages,"candidates":[]}
	check(Data._index_candidates(packet),"valid reduced complete pages rejected")
	check(not Canopy.tree_page(packet).is_empty(),"complete reduced page is usable")
	var invalid=packet.duplicate(true);invalid.candidatePages.tree.count=1
	check(not Data._index_candidates(invalid),"wrong page count accepted")
	invalid=packet.duplicate(true);invalid.candidatePages.tree.bounds.minX=NAN
	check(not Data._index_candidates(invalid),"nonfinite page bounds accepted")
	packet.candidatePages.tree.complete=false
	check(Canopy.tree_page(packet).is_empty(),"incomplete page exposed as exact")
	var main=load("res://scene/main.gd").new()
	var physical={"seed":"seed-a","terrain":{"source":{"id":"same","version":"v1"}},"versions":{"environment":"env-a","occupation":"occ-a","population":"pop-a"},"canonicalContextRef":{"id":"ctx-a"}}
	var source_packet={"source":{"sourceEpoch":"source-a","sceneEpoch":"scene-a"}}
	var lineage=main._physical_lineage(physical,source_packet)
	for kind in ["seed","environment","occupation","sourceEpoch","sceneEpoch","context"]:
		var changed=physical.duplicate(true);var changed_packet=source_packet.duplicate(true)
		match kind:
			"seed":changed.seed="seed-b"
			"environment":changed.versions.environment="env-b"
			"occupation":changed.versions.occupation="occ-b"
			"sourceEpoch":changed_packet.source.sourceEpoch="source-b"
			"sceneEpoch":changed_packet.source.sceneEpoch="scene-b"
			"context":changed.canonicalContextRef.id="ctx-b"
		check(main._physical_lineage(changed,changed_packet)!=lineage,"stale canopy lineage was not invalidated: "+kind)
	main.set("canopy_info",{"physicalLineage":"old","available":false});main.set("canopy_phase",2.0)
	main._update_canopy_textures({"physicalLineage":"new","available":false})
	check(main.get("canopy_phase")==0 and main.get("canopy_pending").is_empty(),"foreign lineage was staged instead of cleared")
	main.set("canopy_info",{"physicalLineage":"same","available":false});main.set("canopy_phase",2.0)
	main._update_canopy_textures({"physicalLineage":"same","available":false,"newPage":true})
	check(main.get("canopy_phase")==2 and not main.get("canopy_pending").is_empty(),"compatible lineage should retain old snapshot while fading")
	for key in ["camera","objects","sun","live_request","hud"]:
		var node=main.get(key)
		if node is Node and not node.is_inside_tree():node.free()
	main.free()
	print(JSON.stringify({"passed":passed,"samples":samples,"scope":"CPU camera-ray safety, halo, global phase and candidate-page contract; no GPU appearance claim"}));quit(0 if passed else 1)
