extends SceneTree
const Ground=preload("res://adapters/surface_ground_response.gd")
var checks=0
func check(ok:bool,label:String):
	checks+=1
	if not ok:push_error(label);quit(1)
func _initialize():
	var args=OS.get_cmdline_user_args()
	if args.size()!=1:push_error("Usage: generated-fixture-directory");quit(2);return
	var maximum=float(PackedFloat32Array([PI/2.0])[0])
	check(Ground.MAX_SLOPE_F32==maximum,"bound is exactly rounded Float32 PI/2")
	var bits=PackedByteArray();bits.resize(4);bits.encode_float(0,maximum);bits.encode_u32(0,bits.decode_u32(0)+1)
	var next_slope=float(bits.decode_float(0));check(next_slope>maximum,"next representable slope exists")
	var rows:Array=[]
	for name in ["ordinary-finite-cliff","near-vertical-microscopic-horizontal"]:
		var world=JSON.parse_string(FileAccess.get_file_as_string(args[0].path_join(name+".json")))
		var physical_before=var_to_bytes(world.fields);var response_before=var_to_bytes(world.groundResponse);var terrain_before=var_to_bytes(world.terrain)
		check(Ground.identity(world.groundResponse)==world.groundResponse.id,"unmodified compiler identity matches native")
		check(Ground.validate(world),"true compiled finite world accepted: "+name)
		check(var_to_bytes(world.fields)==physical_before and var_to_bytes(world.groundResponse)==response_before and var_to_bytes(world.terrain)==terrain_before,"validation leaves physical context, response and terrain unchanged")
		var above=world.duplicate(true);above.fields.slope[0]=next_slope
		check(not Ground.validate(above),"next Float32 above mathematical range rejected")
		rows.append({"name":name,"nativeAccepted":true,"firstSlope":world.fields.slope[0],"identityMatches":true,"sourceUnchanged":true})
	var report={"status":"PASS","checks":checks,"maximumSlopeF32":maximum,"nextFloat32Rejected":next_slope,"scope":"Finite compilation interoperability at Float32 upper bound, not a current IG terrain defect or GPU proof","rows":rows}
	var file=FileAccess.open(args[0].path_join("gd-corrected-report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify(report));quit()
