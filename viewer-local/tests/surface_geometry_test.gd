extends SceneTree
const G = preload("res://adapters/surface_geometry.gd")
const D = preload("res://adapters/surface_data.gd")
var failures: Array[String] = []
func check(ok: bool, label: String):
	if not ok: failures.append(label)
func plane_grid(n: int, spacing: float, x: float, z: float, base_x := 1000000.0, base_z := 2000000.0) -> Dictionary:
	var heights := PackedFloat64Array()
	for j in n:
		for i in n: heights.append(x+i*spacing-base_x+2.0*(z+j*spacing-base_z))
	return {"width":n,"height":n,"spacingM":spacing,"originX":x,"originZ":z,"heights":heights}
func _initialize():
	var origin := {"x":1000000.0,"y":0.0,"z":2000000.0}
	var grid := plane_grid(20,1,origin.x,origin.z)
	var parent := {"terrain":grid,"bounds":{"minX":origin.x,"minZ":origin.z,"maxX":origin.x+19,"maxZ":origin.z+19}}
	var child_grid := plane_grid(3,0.25,origin.x+9,origin.z+9)
	var world := {"id":"source-world","versions":{"occupation":"original"},"terrain":child_grid,
		"bounds":{"minX":origin.x+9,"minZ":origin.z+9,"maxX":origin.x+9.5,"maxZ":origin.z+9.5},"_terrainParents":[parent]}
	var footprint := [{"outer":[{"x":origin.x+9,"y":origin.z+9},{"x":origin.x+10,"y":origin.z+9},{"x":origin.x+10,"y":origin.z+10}],"holes":[]}]
	var triangle := {"points":[[origin.x+9.001,30.0,origin.z+9],[origin.x+9.001,30.0,origin.z+10],[origin.x+10,30.0,origin.z+9]],"normal":[0,1,0],"surface":"roof","material":"source-roof","materials":{"cladding":"source-roof"}}
	var building := {"groundHeightM":0.0,"id":"native-source-id","footprint":footprint,"representation":"native","triangles":[triangle]}
	var proxy := building.duplicate(true); proxy.id="proxy-id"; proxy.representation="cartographic-proxy"; proxy.nativeRealization=false
	var far := building.duplicate(true); far.id="far-away"; far.footprint=[{"outer":[{"x":origin.x+1000,"y":origin.z+1000}],"holes":[]}]
	var packet := {"urban":{"buildings":[building,proxy,far],"roads":[{"points":[[origin.x-100,origin.z+10],[origin.x+100,origin.z+10]],"widthM":1},
		{"points":[[origin.x+10,origin.z+10],[origin.x+10,origin.z+10]],"widthM":1}]}}
	var source_snapshot := JSON.stringify(packet)
	var focus := {"x":origin.x+10,"y":origin.z+10}
	var urban := G.build_urban(packet,world,origin,focus,4.0)
	check(urban.vertices.size()==3,"only visible native faces")
	check(urban.skippedProxies==1 and urban.nativeBuildings==1,"native/proxy accounting")
	check(urban.materialGroups[0].materialId=="source-roof","source material identity")
	check(urban.buildingIds==["native-source-id"],"source building ID")
	check(urban.supportConflicts.is_empty() and urban.supportObservations.size()==1 and urban.vertices[0].y==30.0,"natural support variation observed without claiming violation or reseating native city")
	check(urban.roadVertices.size()>0,"crossing road clipped instead of dropped")
	check(urban.skippedDegenerates>=1,"zero length segment skipped")
	check(absf(urban.vertices[0].x-9.001)<0.00001,"large-coordinate precision after origin subtraction")
	check((urban.vertices[1]-urban.vertices[0]).cross(urban.vertices[2]-urban.vertices[0]).dot(urban.normals[0])>0,"native RH winding and outward normal")
	for point in urban.roadVertices:
		check(absf(point.y-(point.x+2.0*point.z+0.012))<0.00005,"road drape canonical height and parent fallback")
	for i in range(0,urban.roadVertices.size(),3): check((urban.roadVertices[i+1]-urban.roadVertices[i]).cross(urban.roadVertices[i+2]-urban.roadVertices[i]).y>0,"road RH upward winding")
	check(JSON.stringify(packet)==source_snapshot,"source packet immutable")
	packet._showProxies=true
	check(G.build_urban(packet,world,origin,focus,4.0).proxyBuildings==1,"proxy requires explicit display flag")
	var over_budget := building.duplicate(false)
	over_budget.id="oversized-native-shell"
	var too_many: Array=[]; too_many.resize(200001); too_many.fill(triangle)
	over_budget.triangles=too_many
	var budget_packet={"urban":{"buildings":[over_budget,building]}}
	var budget_result=G.build_urban(budget_packet,world,origin,focus,4.0)
	check(budget_result.vertices.size()==3 and budget_result.omittedBuildingIds==["oversized-native-shell"],"budget never emits a partial native shell")
	var key := G.chunk_key(world,focus,4.0,"urban")
	world._cityIdentity="different-city"
	check(G.chunk_key(world,focus,4.0,"urban")!=key,"cache invalidates city identity")
	var water_grid := {"width":3,"height":3,"originX":0.0,"originZ":0.0,"spacingM":1.0,"heights":PackedFloat64Array([0,0,0,0,0,0,0,0,0])}
	var water_fields := {"waterClass":PackedByteArray([1,1,1,1,1,1,1,1,1]),"waterLevelM":PackedFloat64Array([10,11,12,13,14,15,16,17,18])}
	world.canonicalContext={"grid":water_grid,"fields":water_fields}
	var water := G.build_water(world,{"x":0.0,"y":0.0,"z":0.0},{"x":1.0,"y":1.0},4.0)
	check(water.quads==9,"water includes final sample row and column")
	var corners := {}
	var min_x := INF; var max_x := -INF
	for point in water.vertices:
		min_x=minf(min_x,point.x); max_x=maxf(max_x,point.x)
		var address := Vector2(point.x,point.z)
		if corners.has(address): check(is_equal_approx(float(corners[address]),point.y),"neighbour water quads share corner level")
		else: corners[address]=point.y
	check(is_equal_approx(min_x,-0.5) and is_equal_approx(max_x,2.5),"water is sample-centred")
	for i in range(0,water.vertices.size(),3): check((water.vertices[i+1]-water.vertices[i]).cross(water.vertices[i+2]-water.vertices[i]).y>0,"water RH upward winding")
	var n := 513
	var levels := PackedFloat32Array(); levels.resize(n*n); levels.fill(10)
	var classes := PackedByteArray(); classes.resize(n*n); classes.fill(1)
	var heights := PackedFloat32Array(); heights.resize(n*n)
	world.canonicalContext={"grid":{"width":n,"height":n,"originX":0,"originZ":0,"spacingM":1,"heights":heights},"fields":{"waterClass":classes,"waterLevelM":levels}}
	var bounded := G.build_water(world,{"x":0.0,"y":0.0,"z":0.0},{"x":256.0,"y":256.0},1024)
	check(bounded.quads==1 and bounded.sourceStride==1,"water LOD budget")
	var controls := PackedFloat64Array(); controls.resize(16); controls[5]=1.0
	var cubic := {"width":4,"height":4,"originX":0.0,"originZ":0.0,"spacingM":1.0,"heights":controls,"reconstruction":"cubic-bspline-controls"}
	check(absf(G.sample_height(cubic,1.0,1.0)-4.0/9.0)<1e-12,"16-tap cubic control reconstruction")
	var samples := cubic.duplicate(false); samples.reconstruction="bilinear-samples"
	check(G.sample_height(samples,1.0,1.0)==1.0,"sample raster never silently treated as controls")
	var parent_values := PackedFloat64Array(); parent_values.resize(33*33)
	var child_values := PackedFloat64Array(); child_values.resize(17*17); child_values.fill(10.0)
	var seam_world := {"terrain":{"width":17,"height":17,"originX":4.0,"originZ":4.0,"spacingM":1.0,"heights":child_values},"bounds":{"minX":4.0,"minZ":4.0,"maxX":20.0,"maxZ":20.0},"_terrainParents":[{"terrain":{"width":33,"height":33,"originX":0.0,"originZ":0.0,"spacingM":2.0,"heights":parent_values},"bounds":{"minX":0.0,"minZ":0.0,"maxX":64.0,"maxZ":64.0}}]}
	check(absf(G.height_at(seam_world,4.00001,12)-G.height_at(seam_world,3.99999,12))<0.00001,"child parent display boundary continuous")
	check(G.height_at(seam_world,12,12)==10 and G.raw_height_at(seam_world,4,12)==10,"display feather does not alter physical source")
	check(child_values[0]==10,"source arrays immutable")
	var even := plane_grid(16,1.0,0.0,0.0,0.0,0.0)
	var filtered: Dictionary = D._prefilter_grid(even,2.0)
	check(filtered.width==9 and filtered.lastSampleX==15 and filtered.lastSampleZ==15,"even grid retains final physical sample extent")
	check(is_finite(G.sample_height(filtered,15,15)),"short final display interval samples safely")
	# A 1 km wide, 10 m road on 0.47 m input stays bounded without thousands
	# of cross columns when the displayed terrain is planar.
	var fine_heights := PackedFloat64Array(); fine_heights.resize(1024*1024)
	var road_world := {"terrain":{"width":1024,"height":1024,"originX":0.0,"originZ":0.0,"spacingM":0.47,"heights":fine_heights},"bounds":{"minX":0.0,"minZ":0.0,"maxX":480.81,"maxZ":480.81}}
	var broad_road := G.build_urban({"urban":{"roads":[{"id":"road-source","widthM":10.0,"points":[[0,200],[1000,200]]}]}},road_world,{"x":0.0,"y":0.0,"z":0.0},{"x":240.0,"y":200.0},1024)
	check(broad_road.roadVertices.size()<10000 and not broad_road.budgetLimited,"fine child wide planar road does not exhaust road budget")
	check(broad_road.roadMaximumObservedErrorM<0.00001,"adaptive road error measured against display source")
	# Checkerboard forces masked fallback; mask area equals retained wet area.
	for i in classes.size(): classes[i]=1 if i%2==0 else 0
	world.canonicalContext.fields.waterClass=classes
	var sparse := G.build_water(world,{"x":0.0,"y":0.0,"z":0.0},{"x":256.0,"y":256.0},1024)
	check(sparse.requiresCoverageMask and sparse.quads<=65536,"irregular water fallback requires exact coverage mask")
	var coverage: Image = sparse.coverageImage
	var covered := 0.0
	for value in coverage.get_data().to_float32_array().slice(0,n*n): covered+=value
	check(covered==float(sparse.sourceWetCells),"water coverage mask preserves area without any-wet inflation")
	print(JSON.stringify({"failures":failures,"nativeVertices":urban.vertices.size(),"roadVertices":urban.roadVertices.size(),"waterQuads":water.quads,"uniformWaterQuads":bounded.quads,"sparseWaterQuads":sparse.quads,"sparseWetCells":sparse.sourceWetCells,"wideRoadVertices":broad_road.roadVertices.size()}))
	quit(0 if failures.is_empty() else 1)
