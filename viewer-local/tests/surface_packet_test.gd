extends SceneTree
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_geometry.gd")
var errors: Array=[]
func check(ok: bool,label: String):
	if not ok: errors.append(label)
func make_binary(value: Dictionary, arrays: Array) -> PackedByteArray:
	var manifest=JSON.stringify({"format":"magna-surface-binary","version":1,"value":value,"arrays":arrays}).to_utf8_buffer()
	var start=int(ceil(float(16+manifest.size())/8.0))*8
	var bytes=PackedByteArray(); bytes.resize(start+8)
	var magic="MUFSURF1".to_ascii_buffer()
	for i in 8: bytes[i]=magic[i]
	bytes.encode_u32(8,manifest.size()); bytes.encode_u32(12,8)
	for i in manifest.size(): bytes[16+i]=manifest[i]
	return bytes
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.is_empty(): push_error("Supply real .surface packet path"); quit(2); return
	var file=FileAccess.open(args[0],FileAccess.READ)
	var bytes=file.get_buffer(file.get_length())
	var packet=D.decode_packet(bytes)
	check(not packet.is_empty(),"real binary packet validated")
	if packet.is_empty(): print(JSON.stringify({"failures":errors})); quit(1); return
	var world: Dictionary=packet.world
	check(packet.urban.buildings.size()==500,"500 distinct real native records")
	var geometry_packet=packet.duplicate(false)
	geometry_packet.urban=packet.urban.duplicate(false)
	geometry_packet.urban.roads=[]
	var urban=G.build_urban(geometry_packet,world,{"x":0.0,"y":0.0,"z":0.0},{"x":8000.0,"y":8000.0},40000.0)
	check(urban.nativeBuildings==500 and urban.skippedProxies==0,"lazy columns display all native records")
	check(urban.materialGroups.size()>1,"source material groups retained")
	check(urban.vertices.size()+urban.skippedDegenerates*3==packet.urban.positions.size()/3,"all source triangles retained")
	var bad=bytes.duplicate(); bad.append(0)
	check(D.decode_packet(bad).is_empty(),"reject trailing binary payload")
	var header=bytes.duplicate(); header.encode_u32(8,17*1024*1024)
	check(D.decode_packet(header).is_empty(),"reject oversized manifest")
	for descriptor in [
		{"path":["field"],"dtype":"f64","length":0.5,"offset":0},
		{"path":["field"],"dtype":"f64","length":1,"offset":1},
		{"path":["absent"],"dtype":"f64","length":1,"offset":0},
		{"path":[],"dtype":"f64","length":1,"offset":0},
		{"path":["field",0],"dtype":"f64","length":1,"offset":0}]:
		check(D.decode_packet(make_binary({"field":null},[descriptor])).is_empty(),"reject malformed descriptor address/shape/alignment")
	var double_descriptor={"path":["field"],"dtype":"f64","length":1,"offset":0}
	check(D.decode_packet(make_binary({"field":null},[double_descriptor,double_descriptor])).is_empty(),"reject duplicate descriptor path")
	check(D.decode_packet(make_binary({"field":123},[double_descriptor])).is_empty(),"reject nonnull attachment target")
	var bad_world=world.duplicate(true); bad_world.terrain.reconstruction="invented"
	check(not D.validate_world(bad_world),"reject unknown reconstruction")
	bad_world=world.duplicate(false); bad_world.terrain=world.terrain.duplicate(false); bad_world.terrain.heights=123
	check(not D.validate_world(bad_world),"malformed numeric grid column rejected without indexing error")
	print(JSON.stringify({"failures":errors,"nativeBuildings":urban.nativeBuildings,"vertices":urban.vertices.size(),"sourceDegenerateTriangles":urban.skippedDegenerates,"materialGroups":urban.materialGroups.size(),"supportConflicts":urban.supportConflicts.size(),"decodeBytes":bytes.size()}))
	quit(0 if errors.is_empty() else 1)
