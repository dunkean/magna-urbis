extends SceneTree
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_ground_response.gd")
func sha(bytes:PackedByteArray)->String:
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes);return hash.finish().hex_encode()
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("Usage: real-fresh.surfacebin report.json");quit(2);return
	var file=FileAccess.open(args[0],FileAccess.READ);var bytes=file.get_buffer(file.get_length());file=null
	var before=sha(bytes);var length=bytes.decode_u32(8);var start=int(ceil(float(16+length)/8.0))*8
	var manifest=JSON.parse_string(bytes.slice(16,16+length).get_string_from_utf8())
	var packet=D.decode_packet(bytes)
	if packet.is_empty():push_error("Real fresh packet rejected");quit(1);return
	var world:Dictionary=packet.get("world",packet)
	if not G.validate(world):push_error("Real world GroundResponse rejected");quit(1);return
	var archives:Array=[]
	for descriptor in manifest.arrays:
		if not descriptor.path.has("$surfaceSourceArchive"):continue
		var cursor=packet
		for component in descriptor.path:cursor=cursor[int(component)] if cursor is Array else cursor[str(component)]
		if descriptor.dtype!="u8" or not cursor is PackedByteArray:push_error("Archive payload type changed");quit(1);return
		var original=bytes.slice(start+int(descriptor.offset),start+int(descriptor.offset)+int(descriptor.length))
		if cursor!=original:push_error("Archive source bytes changed");quit(1);return
		archives.append({"path":descriptor.path,"offset":descriptor.offset,"length":descriptor.length,"dtype":descriptor.dtype,"decodedType":"PackedByteArray","sha256":sha(cursor),"exactOriginalPayload":true})
	if archives.is_empty() or sha(bytes)!=before:push_error("Missing archive proof or original packet mutated");quit(1);return
	var encoded_world:Dictionary=manifest.value.get("world",manifest.value)
	if world.id!=encoded_world.id or world.groundResponse.id!=encoded_world.groundResponse.id:push_error("World or response identity changed");quit(1);return
	var report={"status":"PASS","scope":"Actual fresh packet CPU Data.decode_packet, no GPU or scene acceptance claim","sourcePacket":args[0],"bytes":bytes.size(),"packetSha256":before,"inputBytesUnchanged":true,"worldId":world.id,"groundResponseId":world.groundResponse.id,"nativeGroundResponseValid":true,"sourceId":world.terrain.source.id,"sourceVersion":world.terrain.source.version,"archiveBlocks":archives,"archivePayloadBytesExact":true}
	var output=FileAccess.open(args[1],FileAccess.WRITE);output.store_string(JSON.stringify(report,"  "));output=null
	print(JSON.stringify({"status":"PASS","bytes":bytes.size(),"worldId":world.id,"archiveBlocks":archives.size(),"archivePayloadBytesExact":true,"groundResponseValid":true}));quit()
