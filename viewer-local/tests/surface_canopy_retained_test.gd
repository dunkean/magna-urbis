extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Trees=preload("res://adapters/surface_tree_library.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
var failures=0
func _initialize()->void:call_deferred("run")
func verify(ok:bool,text:String)->void:
	if not ok:failures+=1;push_error(text)
func sha(bytes:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(bytes);return h.finish().hex_encode()
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=5:push_error("exe source.surfacebin tree-manifest frozen-production-reference.gd report.json");quit(2);return
	var source_hash=FileAccess.get_sha256(args[1]);var packet=Data.read_json(args[1]);verify(not packet.is_empty(),"real retained source validates")
	if packet.is_empty():quit(1);return
	var tree=Trees.new();verify(tree.load_manifest(args[2],false),"verified CPU tree assets: "+tree.last_error)
	if tree.cpu.is_empty():quit(1);return
	var render_packet=tree.packet_copy(packet,"aerial");render_packet["_unsupportedTreeIDs"]={};var columns:Dictionary=packet.candidateColumns;var selected={};var tree_count=0
	for i in int(columns.count):
		if str(columns.families[int(columns.family[i])])=="tree":
			if tree_count%3==0:selected[str(columns.ids[i])]=true
			tree_count+=1
	var before=sha(var_to_bytes(columns));var view={"minX":19900.,"maxX":20100.,"minZ":19900.,"maxZ":20100.};var reference=load(args[3]);var tick=Time.get_ticks_usec();var scalar=reference.prepare(render_packet,selected,view);var scalar_ms=(Time.get_ticks_usec()-tick)/1000.
	tick=Time.get_ticks_usec();var native=Canopy.prepare(render_packet,selected,view,{"canopyBatchExecutable":args[0]});var native_ms=(Time.get_ticks_usec()-tick)/1000.
	verify(not native.get("failed",false),"native real-source raster: "+str(native.get("canopyBatchError","")))
	if native.get("failed",false):quit(1);return
	var images={};var pixels=0
	for key in ["coverageImage","countsImage","normalImage","colorImage"]:
		var a:Image=scalar[key];var b:Image=native[key];var ab=a.get_data();var bb=b.get_data();var same=ab==bb
		verify(same,"ALL production-size base/mip bytes exact: "+key);images[key]={"same":same,"bytes":ab.size(),"sha256":sha(ab),"nativeSha256":sha(bb),"dimensions":[a.get_width(),a.get_height()],"mipmaps":a.has_mipmaps()};pixels=a.get_width()*a.get_height()
	verify(scalar.atlasHash==native.atlasHash,"actual atlas identity unchanged")
	verify(scalar.treeCount==native.treeCount and scalar.selectedTreeCount==native.selectedTreeCount and scalar.unsupportedTreeCount==native.unsupportedTreeCount,"whole inventory counts unchanged")
	verify(before==sha(var_to_bytes(columns)) and FileAccess.get_sha256(args[1])==source_hash,"all source candidate columns and source file unchanged")
	var result={"format":"native-canopy-retained-parity","status":"PASS" if failures==0 else "FAIL","failures":failures,"sourcePath":args[1],"sourceSha256":source_hash,"worldId":packet.world.id,"assetDigest":tree.cpu.digest,"treeCount":tree_count,"selectedCount":selected.size(),"selectionPolicy":"Every third existing tree in original source order, explicitly diagnostic; no source edits","viewBounds":view,"pixels":pixels,"images":images,"atlasHash":native.atlasHash,"scalarWallMs":scalar_ms,"nativeWholeCanopyWallMs":native_ms,"rasterSampler":native.rasterSampler,"scope":"Actual retained V15 source and corrected product, all full-resolution image bytes/mips; CPU wall observations only, no GPU/FPS/city/fresh-generation/artistic claim"}
	var f=FileAccess.open(args[4],FileAccess.WRITE);f.store_string(JSON.stringify(result,"  "));f.close();print(JSON.stringify(result));quit(0 if failures==0 else 1)
