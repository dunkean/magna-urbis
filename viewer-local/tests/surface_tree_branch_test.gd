extends SceneTree
const TreeAssets=preload("res://adapters/surface_tree_library.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
func _initialize()->void:call_deferred("run")
func run()->void:
	var args=OS.get_cmdline_user_args();assert(args.size()==1)
	var library=TreeAssets.new();assert(library.load_manifest(args[0],true),library.last_error)
	var high=library.high_render_mesh();var middle=library.impostor_render_mesh()
	for product in [high,middle]:
		for material in product.materials:assert(material.shader.get_shader_uniform_list().size()>0)
	var candidates=[];var pixels={}
	for i in 30:
		candidates.append({"stableId":"tree-"+str(i),"family":"tree","x":1000000000.0+i*.1,"y":5.0,"z":-1000000000.0,"size":10.0,"crownRadiusM":4.2,"orientation":.3,"rank":i/30.0,"canopyClass":1})
		pixels["tree-"+str(i)]=1000.0+i
	var before=var_to_bytes(candidates);var plan=library.plan(candidates,pixels)
	assert(plan.high.size()==14 and plan.middle.size()==16 and plan.highTriangles<=2000000 and plan.droppedCount==0)
	var ids={}
	for group in [plan.high,plan.middle]:
		for candidate in group:assert(not ids.has(candidate.stableId));ids[candidate.stableId]=true
	assert(ids.size()==candidates.size() and var_to_bytes(candidates)==before)
	var buffer=TreeAssets.instance_buffer(candidates,{"x":1000000000.0,"y":1.0,"z":-1000000000.0})
	assert(buffer[3]==0 and buffer[7]==4 and buffer[11]==0 and buffer[5]==10 and absf(buffer[19]-4.2)<.00001)
	var one=candidates[0].duplicate();one.x=0.0;one.z=0.0
	var source={"world":{"id":"synthetic-mask-layout-test","seed":"fixed","versions":{},"terrain":{"source":{"id":"test"}}},"source":{},"candidatePages":{"version":"surface-candidate-pages-1","tree":{"complete":true,"includeOverhang":true,"retention":1,"bounds":{"minX":-16.0,"minZ":-16.0,"maxX":16.0,"maxZ":16.0}}},"candidates":[one]}
	var source_bytes=var_to_bytes(source);var decorated=library.packet_copy(source,"aerial")
	var atlas=Canopy.prepare(decorated,{one.stableId:true})
	assert(atlas.available and atlas.version=="canopy-r6-shared-asset-cutout-whole-frustum" and atlas.assetDigest==library.cpu.digest and atlas.has("colorImage"))
	var coverage=atlas.coverageImage.get_data().slice(0,int(atlas.gridSize.x)*int(atlas.gridSize.y)*4).to_float32_array()
	var counts=atlas.countsImage.get_data().to_float32_array();var samples=0
	for i in coverage.size():
		if coverage[i]>0:assert(counts[i*4+1]==1);samples+=1
	assert(samples>0 and var_to_bytes(source)==source_bytes and not source.has("_treeAssetCPU"))
	var legacy=Canopy.prepare(library.packet_copy(source,"cartographic"),{one.stableId:true})
	assert(legacy.version=="canopy-r5-whole-frustum-phase" and not legacy.has("assetDigest") and not legacy.has("colorImage"))
	print(JSON.stringify({"test":"experimental-tree-branch","result":"PASS","high":plan.high.size(),"middle":plan.middle.size(),"highTriangles":plan.highTriangles,"assetMaskTexels":samples,"scope":"headless shader parse, budget/ID/root transforms and real-mask atlas; no GPU silhouette claim"}));quit()
