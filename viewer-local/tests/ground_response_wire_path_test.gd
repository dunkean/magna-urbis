extends SceneTree
const G=preload("res://adapters/surface_ground_response.gd")
const D=preload("res://adapters/surface_data.gd")
var checks=0
func check(ok:bool,label:String):
	checks+=1
	if not ok:push_error(label);quit(1)
func binary(value:Dictionary,path,dtype:String,count:int,payload:PackedByteArray)->PackedByteArray:
	var manifest=JSON.stringify({"format":"magna-surface-binary","version":1,"value":value,"arrays":[{"path":path,"dtype":dtype,"length":count,"offset":0}]}).to_utf8_buffer()
	var start=int(ceil(float(16+manifest.size())/8.0))*8
	var bytes=PackedByteArray();bytes.resize(start+payload.size())
	for i in 8:bytes[i]="MUFSURF1".to_ascii_buffer()[i]
	bytes.encode_u32(8,manifest.size());bytes.encode_u32(12,payload.size())
	for i in manifest.size():bytes[16+i]=manifest[i]
	for i in payload.size():bytes[start+i]=payload[i]
	return bytes
func _initialize():
	for prefix in [[],["world"],["canonicalContext"],["world","canonicalContext"]]:
		check(G.expected_wire_dtype(prefix+["groundResponse","fields","alluvial"])=="f32","true float response column")
		check(G.expected_wire_dtype(prefix+["groundResponse","fields","rockRecipe"])=="u16","true recipe response column")
	for path in [[0.0,"fields","x"],["world",0.0,"fields","alluvial"],["groundResponse","fields",0.0],["source","opaque",0.0,"groundResponse","fields","alluvial"],["source","groundResponse","fields","alluvial"],["world",false,"groundResponse","fields","rockRecipe"],[null,"groundResponse","fields","alluvial"],[{},"groundResponse","fields","alluvial"],[],["fields","alluvial"]]:
		check(G.expected_wire_dtype(path)=="","mixed/opaque path never inferred as response")
	var raw=PackedByteArray([0,127,255]);var opaque={"source":{"opaque":[{"groundResponse":{"fields":{"alluvial":null}}}]}}
	var bytes=binary(opaque,["source","opaque",0.0,"groundResponse","fields","alluvial"],"u8",3,raw)
	var decoded=D.decode_packet(bytes)
	check(not decoded.is_empty(),"opaque numeric array index decoded")
	check(decoded.source.opaque is Array and decoded.source.opaque[0].groundResponse.fields.alluvial is PackedByteArray,"opaque Array/typed payload constructors preserved")
	check(decoded.source.opaque[0].groundResponse.fields.alluvial==raw,"opaque source bytes exact")
	var values=PackedFloat64Array([1.25,-2.5]);var nested={"source":{"groundResponse":{"fields":{"alluvial":null}},"typesArray":["Float32Array",7.0]}}
	decoded=D.decode_packet(binary(nested,["source","groundResponse","fields","alluvial"],"f64",2,values.to_byte_array()))
	check(decoded.source.groundResponse.fields.alluvial is PackedFloat64Array and decoded.source.groundResponse.fields.alluvial==values,"unknown all-string prefix is opaque, not forced f32")
	check(decoded.source.typesArray is Array and decoded.source.typesArray==["Float32Array",7.0],"opaque metadata Array unchanged")
	for invalid_path in [null,"fields",42.0,{},[]]:check(D.decode_packet(binary({},invalid_path,"u8",3,raw)).is_empty(),"invalid address shape fails closed before typed classifier")
	print(JSON.stringify({"status":"PASS","checks":checks,"scope":"CPU mixed archive paths/strict GR prefix and opaque typed payload preservation; no GPU"}));quit()
