extends SceneTree
const Library=preload("res://adapters/material_library.gd")
const Cache=preload("res://adapters/surface_pbr_cache.gd")
var checks=0
var failures=0
func _initialize()->void:call_deferred("run")
func verify(ok:bool,label:String)->void:
	checks+=1
	if not ok:failures+=1;push_error(label)
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=4:push_error("manifest frozen_library.gd owned_cache_directory output.json");quit(2);return
	var baseline=GDScript.new();var source=FileAccess.get_file_as_string(args[1]).replace("class_name SurfaceMaterialLibrary","")
	source=source.replace("var albedo_height :=", "var audit_images:Array=[]\nvar albedo_height :=")
	source=source.replace("\t\t\tvar layer := albedos.size()", "\t\t\taudit_images.append({\"ah\":_audit_sha(ah.get_data()),\"nr\":_audit_sha(nr.get_data())})\n\t\t\tvar layer := albedos.size()")
	source+="\nfunc _audit_sha(bytes:PackedByteArray)->String:\n\tvar h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(bytes);return h.finish().hex_encode()\n"
	baseline.source_code=source;verify(baseline.reload()==OK,"frozen baseline loads with byte-hash-only instrumentation")
	var original=baseline.new();var tick=Time.get_ticks_usec();original.load_manifest(args[0]);var baseline_ms=(Time.get_ticks_usec()-tick)/1000.0
	var cold=Library.new();cold.prepared_cache_directory=args[2];tick=Time.get_ticks_usec();cold.load_manifest(args[0]);var cold_ms=(Time.get_ticks_usec()-tick)/1000.0
	var warm=Library.new();warm.prepared_cache_directory=args[2];tick=Time.get_ticks_usec();warm.load_manifest(args[0]);var warm_ms=(Time.get_ticks_usec()-tick)/1000.0
	for lib in [cold,warm]:
		verify(lib.asset_digest==original.asset_digest,"cache does not change path-independent assetDigest")
		verify(lib.asset_version==original.asset_version,"asset descriptor is unchanged")
		verify(lib.loaded_asset_bindings==original.loaded_asset_bindings,"all recipe/family bindings unchanged")
		verify(lib.layer_means.to_byte_array()==original.layer_means.to_byte_array(),"ALL mean bytes unchanged")
	verify(cold.cache_stats.misses==original.loaded_assets.size() and cold.cache_stats.writes==original.loaded_assets.size(),"new owned cache rebuilt and wrote every real asset")
	verify(warm.cache_stats.hits==original.loaded_assets.size() and warm.cache_stats.misses==0,"warm call reused every verified asset")
	var manifest=JSON.parse_string(FileAccess.get_file_as_string(args[0]));var assets=manifest.get("assets",manifest.get("materials",[]));var image_hashes=[]
	for i in assets.size():
		var key=cold._prepared_key(assets[i],cold._version_asset(assets[i],args[0]));var hit=Cache.load_entry(args[2],key)
		verify(not hit.is_empty(),"real cached payload verifies")
		var ah=original._audit_sha(hit.ah.get_data());var nr=original._audit_sha(hit.nr.get_data())
		verify(ah==original.audit_images[i].ah and nr==original.audit_images[i].nr,"ALL AH16F/NR8 pixels and mipmaps match untouched baseline asset "+str(i))
		image_hashes.append({"assetId":cold.loaded_assets[i],"ahSha256":ah,"nrSha256":nr})
	var report={"status":"PASS" if failures==0 else "FAIL","checks":checks,"failures":failures,"baselineMs":baseline_ms,"coldMs":cold_ms,"warmMs":warm_ms,"assetDigest":original.asset_digest,"assetCount":original.loaded_assets.size(),"coldStats":cold.cache_stats,"warmStats":warm.cache_stats,"allMeanBytesExact":original.layer_means.to_byte_array()==warm.layer_means.to_byte_array(),"imageHashes":image_hashes,"scope":"headless dummy-renderer CPU load_manifest; full real15-asset image/mip/mean parity, no GPU or whole50s warmup attribution"}
	var file=FileAccess.open(args[3],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  ",true,true));file.close();print(JSON.stringify(report));quit(0 if failures==0 else 1)
