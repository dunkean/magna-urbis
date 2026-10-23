extends SceneTree

const Data = preload("res://adapters/surface_data.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	assert(args.size()>0,"Pass the explicit synthetic probe JSON path")
	var packet := Data.read_json(args[0])
	if packet.has("binaryProbe"):
		assert(packet.binaryProbe.million is PackedFloat32Array)
		assert(packet.binaryProbe.million.size()==1000000)
		assert(packet.binaryProbe.u16[1]==65535)
		assert(packet.binaryProbe.u32[1]==4294967295)
		assert(packet.binaryProbe.i32[0]==-2147483648)
		assert(is_nan(packet.binaryProbe.sentinels[0]))
		assert(is_inf(packet.binaryProbe.sentinels[1]) and packet.binaryProbe.sentinels[1]>0)
		assert(is_inf(packet.binaryProbe.sentinels[2]) and packet.binaryProbe.sentinels[2]<0)
	var world := Data.unpack_world(packet)
	assert(not world.is_empty())
	var node: Node3D = ClassDB.instantiate("Terrain3D")
	root.add_child(node)
	node.get("collision").set("mode",0)
	node.set("vertex_spacing",100.0)
	node.set("region_size",256)
	var canonical_x := 35000.123456789
	var canonical_z := 18000.987654321
	var expected := Data.height_at(world,canonical_x,canonical_z)
	var max_rebase_error := 0.0
	for offset in [0.0,100.0]:
		var origin := {"x":canonical_x-offset,"y":expected,"z":canonical_z}
		var prepared := Data.prepare(world,origin,640.0)
		node.set("vertex_spacing",prepared.spacing)
		var maps: Array[Image] = [prepared.height,prepared.control,null]
		node.get("data").call("import_images",maps,prepared.localStart,0.0,1.0)
		var actual: float = node.get("data").call("get_height",Vector3(offset,0,0))
		max_rebase_error=maxf(max_rebase_error,absf(actual))
		assert(absf(actual)<0.001,"Canonical height changed by >=1mm after origin rebase: "+str(actual))
		assert(prepared.worldId==world.id)
	assert(world.terrain.source.sourceLOD==0,"Representation interpolation changed sourceLOD")
	var refined: Dictionary = world.duplicate(true)
	refined.id = "explicit-synthetic-replacement"
	refined.terrain.source.sourceLOD = 1
	for i in refined.terrain.heights.size(): refined.terrain.heights[i] = float(refined.terrain.heights[i])+7.0
	var updated := Data.prepare(refined,{"x":canonical_x,"y":expected,"z":canonical_z},640.0)
	node.set("vertex_spacing",updated.spacing)
	var maps: Array[Image] = [updated.height,updated.control,null]
	node.get("data").call("import_images",maps,updated.localStart,0.0,1.0)
	var actual: float = node.get("data").call("get_height",Vector3.ZERO)
	assert(absf(actual-7.0)<0.0001,"Actual replacement height data was lost")
	for scale in [2.0,4.0,8.0]:
		var a := fposmod((canonical_x-34900.25)/scale+fposmod(34900.25/scale,4096.0),4096.0)
		var b := fposmod((canonical_x-35000.75)/scale+fposmod(35000.75/scale,4096.0),4096.0)
		assert(absf(a-b)<1e-10,"UV phase drift across origins")
	print(JSON.stringify({"event":"adapter-probe-passed","source":"explicit synthetic adapter fixture","originScalarPrecision":"64-bit","rebaseHeightErrorM":max_rebase_error,"replacementHeightErrorM":actual-7.0,"replacementSourceLOD":refined.terrain.source.sourceLOD,"regions":node.get("data").call("get_region_count")}))
	node.queue_free()
	quit()
