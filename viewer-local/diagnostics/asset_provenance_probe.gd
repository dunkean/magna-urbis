extends SceneTree
const Library=preload("res://adapters/material_library.gd")
func _initialize(): call_deferred("run")
func run():
	var failures=[]
	var asset={"id":"probe","assetId":"provider-probe","families":["bedrock","gravity"],"recipeIds":["fractured-bedrock","angular-talus"],"physicalExtentMetres":4.0,"heightAmplitudeMetres":0.2,"maps":{"baseColor":{"sha256":"ABC","path":"C:/one.jpg"},"normal":{"sha256":"DEF","path":"C:/normal.jpg"},"roughness":{"sha256":"123"},"height":{"sha256":"456"}}}
	var baseline=Library.describe_assets([asset]); var permuted=asset.duplicate(true)
	permuted.maps={"height":{"path":"D:/other-h.png","sha256":"456"},"roughness":{"sha256":"123"},"normal":{"path":"D:/other-n.png","sha256":"def"},"baseColor":{"path":"D:/other-d.png","sha256":"abc"}}
	permuted.recipeIds.reverse();permuted.families.reverse()
	if Library.describe_assets([permuted]).digest!=baseline.digest: failures.append("paths/order changed semantic digest")
	var changed=asset.duplicate(true);changed.maps.baseColor.sha256="different-content"
	if Library.describe_assets([changed]).digest==baseline.digest: failures.append("content SHA did not invalidate")
	changed=asset.duplicate(true);changed.heightAmplitudeMetres=0.3
	if Library.describe_assets([changed]).digest==baseline.digest: failures.append("physical height scale did not invalidate")
	if Library.describe_assets([asset],["probe"]).digest==baseline.digest: failures.append("height fallback did not invalidate")
	var directory="res://.deps/provenance-probe";DirAccess.make_dir_recursive_absolute(directory)
	var pixel=Image.create(2,2,false,Image.FORMAT_RGBA8);pixel.fill(Color(0.5,0.5,1,1));pixel.save_png(directory+"/map.png")
	var local=ProjectSettings.globalize_path(directory+"/map.png");var map={"path":local,"sha256":FileAccess.get_sha256(local)}
	var without_height=asset.duplicate(true);without_height.maps={"baseColor":map,"normal":map,"roughness":map}
	var manifest=FileAccess.open(directory+"/manifest.json",FileAccess.WRITE);manifest.store_string(JSON.stringify({"materials":[without_height]}));manifest.close()
	var library=Library.new();library.load_manifest(ProjectSettings.globalize_path(directory+"/manifest.json"))
	if library.loaded_assets!=["probe"] or library.asset_version.assets[0].heightFallback!=0.5: failures.append("missing height dropped asset or omitted explicit fallback")
	if library.asset_digest.is_empty() or library.loaded_asset_bindings.get("recipe:fractured-bedrock",{}).get("assetId")!="probe": failures.append("runtime provenance/bindings missing")
	var original_digest=library.asset_digest
	pixel.fill(Color(0.4,0.5,1,1));pixel.save_png(directory+"/map.png")
	library.load_manifest(ProjectSettings.globalize_path(directory+"/manifest.json"))
	if library.asset_digest==original_digest: failures.append("actual file bytes changed with stale metadata SHA but digest did not invalidate")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"digest":library.asset_digest,"pipelineVersion":library.asset_version.pipelineVersion}));quit(0 if failures.is_empty() else 1)
