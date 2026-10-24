extends SceneTree
const TreeAssets=preload("res://adapters/surface_tree_library.gd")
const TreeMask=preload("res://adapters/surface_tree_mask.gd")
func _initialize()->void:call_deferred("run")
func run()->void:
	var args=OS.get_cmdline_user_args();assert(args.size()>=1)
	var library=TreeAssets.new();assert(library.load_manifest(args[0],false),library.last_error)
	assert(not TreeAssets.valid_descriptor({"digest":"wrong"}))
	var edited=library.manifest.duplicate(true);edited.highMaxInstances=15
	assert(TreeAssets.descriptor_digest(edited)!=library.manifest.digest)
	assert(library.cpu.is_read_only() and library.cpu.mask.is_read_only())
	assert(library.cpu.maskBytes.size()==1024*1024 and library.cpu.lut.size()==257)
	assert(library.cpu.color.size()==1024*1024*4 and library.cpu.normal.size()==1024*1024*4)
	var source={"world":{"id":"immutable","fields":{"test":PackedFloat32Array([1,2])}},"source":{"presentation":null},"candidates":[{"stableId":"one","x":1.0}]}
	var before=var_to_bytes(source);var decorated=library.packet_copy(source,"aerial")
	assert(var_to_bytes(source)==before and not source.has("_treeAssetCPU"))
	assert(is_same(decorated,library.packet_copy(source,"aerial")) and is_same(decorated.world,source.world))
	assert(is_same(source,library.packet_copy(source,"cartographic")))
	# Packed buffers are borrowed read-only by ownership contract. Godot does not
	# freeze their elements when freezing a Dictionary; consumers must not write.
	var checksum=HashingContext.new();checksum.start(HashingContext.HASH_SHA256);checksum.update(library.cpu.maskBytes);var before_mask=checksum.finish()
	for x in [-2.0,-1.0,0.0,1.0,2.0]:
		var point=TreeMask.address(library.cpu,x,0)
		var coverage=TreeMask.coverage(library.cpu,point)
		assert(coverage>=0 and coverage<=1)
		if TreeMask.inside(library.cpu,point):assert(TreeMask.response(library.cpu,"color",point).a>=.49)
	checksum=HashingContext.new();checksum.start(HashingContext.HASH_SHA256);checksum.update(library.cpu.maskBytes);assert(checksum.finish()==before_mask)
	if args.size()>1 and args[1]=="--inspect-import":
		var imported=TreeAssets.new();assert(imported.load_manifest(args[0],true),imported.last_error)
		var materials=[]
		for i in imported.high_mesh.get_surface_count():
			var mat:StandardMaterial3D=imported.high_materials[i]
			materials.append({"name":mat.resource_name,"normalEnabled":mat.normal_enabled,"uv1Scale":mat.uv1_scale,"uv1Offset":mat.uv1_offset,"uv2Scale":mat.uv2_scale,"uv2Offset":mat.uv2_offset,"albedoTexture":mat.albedo_texture!=null,"normalTexture":mat.normal_texture!=null,"roughnessTexture":mat.roughness_texture!=null,"vertexCount":imported.high_mesh.surface_get_arrays(i)[Mesh.ARRAY_VERTEX].size()})
		print(JSON.stringify({"cpuImport":true,"surfaces":materials,"scope":"headless import; no GPU render"}))
	print(JSON.stringify({"test":"surface-tree-data","result":"PASS","assetDigest":library.cpu.digest,"scope":"CPU immutable mask/LUT/packet-copy and source data; experimental tree not rendered"}));quit()
