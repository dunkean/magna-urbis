extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
var checks=0
func _initialize()->void:call_deferred("run")
func verify(ok:bool,message:String)->void:
	checks+=1
	if not ok:push_error(message);quit(1);assert(ok,message)
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("small authored fixture.surfacebin frozen-base-surface-data.gd");quit(2);return
	var packet=Data.decode_packet(FileAccess.get_file_as_bytes(args[0]));var world=Data.unpack_world(packet)
	verify(not world.is_empty(),"valid authored fixture")
	var baseline=GDScript.new();baseline.source_code=FileAccess.get_file_as_string(args[1]).replace("class_name SurfaceData","")
	verify(baseline.reload()==OK,"base6ef script compiles independently")
	var origin={"x":256.0,"y":0.0,"z":256.0};var source_bytes=world.terrain.heights.to_byte_array().duplicate()
	var expected=baseline.prepare(world,origin,64.0,1,{},false,{},false,{})
	var actual=Data.prepare(world,origin,64.0,1,{},false,{},false,{})
	for key in ["height","control","ids","state","rock","average"]:verify(expected[key].get_data()==actual[key].get_data(),"TOP "+key+" pixels/mipmaps remain byte-identical")
	for key in ["spacing","localStart","loadedHeightRangeWorld","sourceCoverageRects"]:verify(expected[key]==actual[key],"TOP "+key+" unchanged")
	for key in expected.surfaceLayers:
		if expected.surfaceLayers[key] is Image:verify(expected.surfaceLayers[key].get_data()==actual.surfaceLayers[key].get_data(),"TOP surface layer "+key+" unchanged")
	verify(source_bytes==world.terrain.heights.to_byte_array(),"source physical bytes unchanged")
	print(JSON.stringify({"test":"visibility-top-parity","result":"PASS","checks":checks,"scope":"authored small world; frozen6ef Data.prepare vs current TOP with no visibility options; pixels/mips/source unchanged; no GPU"}));quit()
