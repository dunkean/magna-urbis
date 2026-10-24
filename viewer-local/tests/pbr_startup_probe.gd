extends SceneTree
const Library=preload("res://adapters/material_library.gd")
func _initialize()->void:call_deferred("run")
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("Pass real resolved.json and output report.json");quit(2);return
	var library=Library.new();var started=Time.get_ticks_usec()
	library.load_manifest(args[0])
	var elapsed=(Time.get_ticks_usec()-started)/1000.0
	var report={"scope":"CPU headless/dummy renderer MaterialLibrary.load_manifest only; no GPU or full warmup attribution","loadMs":elapsed,"assets":library.loaded_assets,"assetDigest":library.asset_digest,"assetVersion":library.asset_version,"bindings":library.loaded_asset_bindings,"meansBytes":library.layer_means.to_byte_array().hex_encode(),"godot":Engine.get_version_info()}
	var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  ",true,true));file.close()
	print(JSON.stringify({"test":"pbr-startup","loadMs":elapsed,"assetCount":library.loaded_assets.size(),"assetDigest":library.asset_digest,"output":args[1],"scope":report.scope}));quit()
