extends SceneTree
const Mask=preload("res://adapters/surface_tree_mask.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()<3:push_error("prepared directory, oracle JSON, output report required, optional WIPCanopy.gd");quit(2);return
	var descriptor=JSON.parse_string(FileAccess.get_file_as_string(args[0].path_join("resolved.json")));var oracle=JSON.parse_string(FileAccess.get_file_as_string(args[1]));var bytes=FileAccess.get_file_as_bytes(args[0].path_join(descriptor.mask.path));var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes);var before=hash.finish();var failures=[];var maximum=0.0
	if before.hex_encode()!=oracle.maskSha256:failures.append("mask SHA mismatch")
	var asset={"mask":descriptor.mask,"maskBytes":bytes}
	for sample in oracle.samples:
		var point=Mask.address(asset,sample.x,sample.z);var coverage=Mask.coverage(asset,point);maximum=maxf(maximum,absf(coverage-float(sample.coverage)))
		if absf(coverage-float(sample.coverage))>0.0000001:failures.append("coverage numerical difference")
		if Mask.inside(asset,point)!=sample.inside:failures.append("cutout classification difference")
	for case in oracle.radiusCases:
		if Canopy.radius_class(case.radius)!=int(case.expectedClass):failures.append("radius class/tie mismatch")
	for case in oracle.weightCases:
		if absf(Canopy.instance_weight(int(case.bin),case.footprint)-float(case.weight))>0.000000000001:failures.append("instance weight mismatch")
	var atlas_samples=0;var wip_hash="";var tree_library_hash="";var transformed_instances=0;var planned_ids=0
	if args.size()>3:
		wip_hash=FileAccess.get_sha256(args[3]);var code=FileAccess.get_file_as_string(args[3]);var script=GDScript.new();script.source_code=code.replace("class_name SurfaceCanopy\n","")
		if script.reload()!=OK:push_error("Cannot compile actual stable WIP canopy for independent CPU test");quit(1);return
		for role in ["color","normal"]:
			var product:Dictionary
			for view in descriptor.views:
				if view.name=="top":product=view.products[role]
			var packed=FileAccess.get_file_as_bytes(args[0].path_join(product.path));var image=Image.create_from_data(1024,1024,false,Image.FORMAT_RGBAH,packed.slice(0,1024*1024*8));image.convert(Image.FORMAT_RGBAF);asset[role]=image.get_data().to_float32_array()
		asset.digest=descriptor.digest
		var original={"world":{"id":"independent-mask-union","seed":8512,"versions":{},"terrain":{"source":{"id":"authored"}}},"source":{},"candidates":oracle.atlas.candidates,"candidatePages":{"version":"surface-candidate-pages-1","tree":{"bounds":oracle.atlas.bounds,"complete":true,"includeOverhang":true,"retention":1}}};var original_bytes=var_to_bytes(original);var private=original.duplicate(false);private._treeAssetCPU=asset;var selected={}
		for id in oracle.atlas.selectedIds:selected[id]=true
		var helper=script.new();var atlas=helper.prepare(private,selected)
		if not atlas.get("available",false) or atlas.get("version")!="canopy-r6-shared-asset-cutout-whole-frustum":failures.append("WIP did not use real asset C/V")
		if atlas.spacingM!=oracle.atlas.spacingM or atlas.origin!=oracle.atlas.origin:failures.append("independent atlas half-texel/dyadic layout differs")
		for sample in oracle.atlas.samples:
			var value=atlas.coverageImage.get_pixel(sample.x,sample.z).r;var counts:Color=atlas.countsImage.get_pixel(sample.x,sample.z)
			if value!=float(sample.C):failures.append("actual WIP total mask differs")
			for bin in 4:
				if counts[bin]!=float(sample.counts[bin]):failures.append("actual WIP selected mask/count bin differs")
			atlas_samples+=1
		if var_to_bytes(original)!=original_bytes:failures.append("WIP mutated source packet")
		if FileAccess.get_sha256(args[3])!=wip_hash:failures.append("WIP changed during CPU test")
		# Load the exact pure plan/buffer methods without importing GPU resources.
		var library_path=args[3].get_base_dir().path_join("surface_tree_library.gd");tree_library_hash=FileAccess.get_sha256(library_path);var library_source=FileAccess.get_file_as_string(library_path);var start=library_source.find("func plan(");var finish=library_source.find("static func bounds(");var pure=GDScript.new();pure.source_code="extends RefCounted\nvar manifest:Dictionary\n"+library_source.substr(start,finish-start)
		if start<0 or finish<=start or pure.reload()!=OK:push_error("Cannot load exact pure tree plan/buffer methods");quit(1);return
		var planner=pure.new();planner.manifest=descriptor;var candidates=[];var pixels={};var origin={"x":1000000000.0,"y":1.0,"z":-1000000000.0}
		for i in 30:
			var c=oracle.atlas.candidates[i%3].duplicate();c.stableId+="-"+str(i);c.x=origin.x+i*.1;c.z=origin.z+i*.2;c.y=5.0;c.rank=float(i)/30.0;c.canopyClass=Canopy.radius_class(c.crownRadiusM);candidates.append(c);pixels[c.stableId]=1000.0+i
		var saved=var_to_bytes(candidates);var plan=planner.plan(candidates,pixels);var ids={}
		for group in [plan.high,plan.middle]:
			for c in group:
				if ids.has(c.stableId):failures.append("plan duplicated ID")
				ids[c.stableId]=true
		if plan.high.size()!=14 or plan.middle.size()!=16 or plan.droppedCount!=0 or plan.highTriangles>2000000:failures.append("tree budget lost actual accepted inventory")
		planned_ids=ids.size()
		var buffer:PackedFloat32Array=planner.instance_buffer(candidates,origin)
		for i in candidates.size():
			var c=candidates[i];var radius=float(c.crownRadiusM);var cosine=cos(c.orientation);var sine=sin(c.orientation);var expected=[cosine*radius,0.0,sine*radius,float(c.x)-origin.x,0.0,float(c.size),0.0,float(c.y)-origin.y,-sine*radius,0.0,cosine*radius,float(c.z)-origin.z,1.0,1.0,1.0,1.0,float(c.size),float(c.canopyClass),float(c.rank),radius]
			for j in 20:
				if absf(buffer[i*20+j]-float(expected[j]))>0.000001:failures.append("root/rotation/nonuniform scale/rebase buffer mismatch")
			# Explicit root stays at supplied XYZ before float32 conversion.
			if buffer[i*20+3]!=float(PackedFloat32Array([float(c.x)-origin.x])[0]) or buffer[i*20+11]!=float(PackedFloat32Array([float(c.z)-origin.z])[0]):failures.append("absolute coordinate rounded before rebasing")
			transformed_instances+=1
		if var_to_bytes(candidates)!=saved or ids.size()!=candidates.size():failures.append("plan/buffer mutated or lost source IDs")
		if FileAccess.get_sha256(library_path)!=tree_library_hash:failures.append("tree library changed during pure-method test")
	hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes)
	if hash.finish()!=before:failures.append("native sampling mutated private buffer")
	var result={"status":"PASS" if failures.is_empty() else "FAIL","samples":oracle.samples.size(),"radiusCases":oracle.radiusCases.size(),"weightCases":oracle.weightCases.size(),"actualWipAtlasSamples":atlas_samples,"actualWipCanopySha256":wip_hash,"actualWipTreeLibrarySha256":tree_library_hash,"transformedInstances":transformed_instances,"plannedUniqueIds":planned_ids,"maximumCoverageError":maximum,"classificationMismatches":failures.size(),"failures":failures,"maskSha256":before.hex_encode(),"sourceBufferUnchanged":true,"scope":"Headless CPU mask/radius/LOD against independent Python. Optional WIP canopy loaded verbatim except global class registration; actual pure plan/buffer methods extracted verbatim to avoid graphics imports. Rotated C/count samples, budget/IDs and root rebasing tested. No ImageTexture, mesh import or GPU"}
	var file=FileAccess.open(args[2],FileAccess.WRITE);file.store_string(JSON.stringify(result,"  "));file=null
	print(JSON.stringify(result));quit(0 if failures.is_empty() else 1)
