extends SceneTree
const Binding=preload("res://adapters/surface_live_binding.gd")
var failures: Array=[]
func check(ok:bool,label:String):
	if not ok:failures.append(label)
func _initialize():
	var data:=PackedFloat32Array();data.resize(64)
	for i in 64:data[i]=100+(i%8)*(i%8)*0.125+floori(i/8.0)*2.25+i*0.015625
	var grid={"n":8,"widthM":80.0,"values":data}
	check(Binding.fingerprint(80.0,8,data)=="rf1-4dfff281d5197e035a236ea1fd40328b","parent exact TS rf1 bytes")
	check(Binding.fingerprint(80.0,4,Binding._canonical_values(grid,4))=="rf1-3872e5fdc5b0700f15fd370d28cd9ca7","reduced canonical exact TS bilinear operation order")
	var signed_bytes:=PackedFloat32Array([0.0,0.0,1.25,-2.5]).to_byte_array();signed_bytes.encode_u32(0,0x80000000)
	check(Binding.fingerprint(2.0,2,signed_bytes.to_float32_array())=="rf1-2101d0e636663794b7e5f5a478975364","signed Float32 zero identity preserved")
	var terrain={"width":8,"height":8,"spacingM":10.0,"originX":5.0,"originZ":5.0,"heights":data}
	var loaded={"source":{"meta":{"id":"original-map","seed":"original-seed","created":"old-timestamp"}},"world":{"terrain":terrain},"urbanId":"exact-city"}
	var descriptor:=Binding.from_packet(loaded,loaded.world)
	check(not descriptor.has("error") and descriptor.fingerprint=="rf1-4dfff281d5197e035a236ea1fd40328b","loaded actual field identity")
	var registration={"canonicalN":8,"canonicalWidth":80.0,"canonicalFieldFingerprint":descriptor.fingerprint,"expectedSourceId":"registered-original","sourceVersion":"provider-version"}
	var incoming={"source":{"registrationBinding":registration,"meta":{"id":"original-map","seed":"original-seed","created":"new-timestamp"}},"urbanId":"exact-city","world":{"terrain":{"source":{"id":"registered-original","version":"provider-version"}}}}
	check(Binding.rejection(descriptor,incoming).is_empty(),"identical physical recapture accepted despite timestamp change")
	var other=incoming.duplicate(true);other.source.registrationBinding.canonicalFieldFingerprint="rf1-unrelated"
	check(not Binding.rejection(descriptor,other).is_empty(),"most recent unrelated browser height content rejected")
	other=incoming.duplicate(true);other.source.meta.id="different-map"
	check(not Binding.rejection(descriptor,other).is_empty(),"different loaded map identity rejected")
	other=incoming.duplicate(true);other.urbanId="other-city"
	check(not Binding.rejection(descriptor,other).is_empty(),"different initial city rejected")
	check(Binding.rejection(descriptor,other,false).is_empty(),"later scene edit preserves the already bound height field")
	other=incoming.duplicate(true);other.world.terrain.source.id="unrelated-registration"
	check(not Binding.rejection(descriptor,other).is_empty(),"child registration source identity checked")
	var shifted=loaded.duplicate(true);shifted.world.terrain.originX+=10
	check(Binding.from_packet(shifted,shifted.world).has("error"),"crop/translated legacy source cannot silently attach full-world live")
	var refined={"source":{"registrationBinding":{"n":8,"width":80.0,"fieldFingerprint":descriptor.fingerprint,"canonicalN":4,"canonicalWidth":80.0,"canonicalFieldFingerprint":"rf1-3872e5fdc5b0700f15fd370d28cd9ca7"}},"terrainParents":[{"terrain":terrain}],"world":{"canonicalContextRef":{},"terrain":{}}}
	var rebound:=Binding.from_packet(refined,refined.world)
	check(not rebound.has("error") and rebound.n==4 and rebound.fingerprint=="rf1-3872e5fdc5b0700f15fd370d28cd9ca7","saved refined snapshot bound by its exact retained parent")
	refined.terrainParents[0].terrain.heights[0]+=1.0
	check(Binding.from_packet(refined,refined.world).has("error"),"edited retained parent rejected")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"computeMs":descriptor.get("computeMs")}));quit(0 if failures.is_empty() else 1)
