extends SceneTree
const Assets=preload("res://adapters/surface_tree_library.gd")
func _initialize()->void:call_deferred("run")
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=1:push_error("Expected prepared directory");quit(2);return
	if not FileAccess.file_exists(args[0].path_join("resolved.json")) or not FileAccess.file_exists(args[0].path_join("report.json")):push_error("Prepared descriptor/report missing");quit(2);return
	var root=args[0];var descriptor=JSON.parse_string(FileAccess.get_file_as_string(root.path_join("resolved.json")));var report=JSON.parse_string(FileAccess.get_file_as_string(root.path_join("report.json")))
	if not descriptor is Dictionary or not report is Dictionary:push_error("Invalid descriptor/report");quit(2);return
	descriptor.sourceAssetDigest=report.assetDigest;descriptor.sourceGeometry=report.lods[0]
	descriptor["albedoEncodingCorrection"]=report.get("glbAlbedoEncodingCorrection",{})
	descriptor.digest=Assets.descriptor_digest(descriptor)
	var file=FileAccess.open(root.path_join("resolved.json"),FileAccess.WRITE);file.store_string(JSON.stringify(descriptor,"  ",true,true));file=null
	var consumer=Assets.new()
	if not consumer.load_manifest(root.path_join("resolved.json"),false):push_error(consumer.last_error);quit(3);return
	print(JSON.stringify({"digest":descriptor.digest,"sourceAssetDigest":descriptor.sourceAssetDigest,"validated":true,"sourceGeometrySha256":descriptor.sourceGeometry.sha256}));quit()
