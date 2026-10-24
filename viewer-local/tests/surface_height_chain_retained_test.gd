extends SceneTree
# CPU-only diagnostic. Reconstruct the logged V14 chain SHAPES using queries of
# its retained real B-spline controls. The unarchived NN tile bodies are NOT
# recovered or claimed byte-exact. Production parents are never resampled.
const Batch=preload("res://adapters/surface_height_batch.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
const Coverage=preload("res://adapters/surface_source_coverage.gd")
var failures=[]
func verify(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func _initialize()->void:call_deferred("run")
func bounds(g:Dictionary)->Dictionary:
	return {"minX":g.originX,"minZ":g.originZ,"maxX":float(g.originX)+(int(g.width)-1)*float(g.spacingM),"maxZ":float(g.originZ)+(int(g.height)-1)*float(g.spacingM)}
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=3:push_error("Usage: helper.exe retained-v14-live.surfacebin output.json");quit(2);return
	var packet_path=args[1];var input_sha=FileAccess.get_sha256(packet_path)
	var file=FileAccess.open(packet_path,FileAccess.READ)
	var prefix=file.get_buffer(16)
	if prefix.slice(0,8).get_string_from_ascii()!="MUFSURF1":push_error("Retained packet must be MUFSURF1");quit(2);return
	var manifest_length=prefix.decode_u32(8);var payload_length=prefix.decode_u32(12)
	if manifest_length<=0 or manifest_length>16*1024*1024:push_error("Retained manifest budget");quit(2);return
	var start=ceili(float(16+manifest_length)/8.0)*8
	if start+payload_length!=file.get_length():push_error("Retained framing");quit(2);return
	var manifest=JSON.parse_string(file.get_buffer(manifest_length).get_string_from_utf8())
	var source_parent:Dictionary=manifest.value.terrainParents[0].terrain.duplicate(true)
	var parent_descriptor={}
	for item in manifest.arrays:
		if item.path.size()==4 and item.path[0]=="terrainParents" and int(item.path[1])==0 and item.path[2]=="terrain" and item.path[3]=="heights":parent_descriptor=item
	if parent_descriptor.is_empty() or parent_descriptor.dtype!="f32" or parent_descriptor.length!=512*512 or source_parent.reconstruction!="cubic-bspline-controls":push_error("Expected exact retained 512-square B-spline parent");quit(2);return
	file.seek(start+int(parent_descriptor.offset));var original_bytes=file.get_buffer(int(parent_descriptor.length)*4);file.close()
	source_parent.heights=original_bytes.to_float32_array()
	var parent_sha=Batch._sha(original_bytes)
	var shapes=[[214,100.0,19950.0],[512,244.0,19878.0],[512,820.0,19590.0],[512,3124.0,18438.0],[512,12052.0,13974.0],[512,39921.875,39.0625]]
	var layers=[];var layer_proof=[];var generated_started=Time.get_ticks_usec()
	for shape in shapes:
		var n=int(shape[0]);var spacing=float(shape[1])/n;var origin=float(shape[2])+spacing*.5
		var values=PackedFloat32Array();values.resize(n*n)
		for z in n:
			for x in n:values[z*n+x]=Geometry.sample_height(source_parent,origin+x*spacing,origin+z*spacing)
		var g={"width":n,"height":n,"originX":origin,"originZ":origin,"spacingM":spacing,"heights":values,"reconstruction":"bilinear-samples","source":{"id":source_parent.source.id,"version":source_parent.source.version,"sourceLOD":0,"sourceLODKnown":false,"nativeSpacingM":source_parent.spacingM,"provenance":"retained-control-query-diagnostic; not archived NN tile samples"}}
		layers.append({"terrain":g,"bounds":bounds(g),"canonicalContextId":"retained-v14-chain-diagnostic"})
		layer_proof.append({"width":n,"height":n,"originX":origin,"spacingM":spacing,"heightSha256":Batch._sha(values.to_byte_array()),"sampleProvenance":"F32 queries of retained real B-spline parent, not original NN tile body"})
	layers.append({"terrain":source_parent,"bounds":bounds(source_parent),"canonicalContextId":"retained-v14-chain-diagnostic"})
	layer_proof.append({"width":512,"height":512,"originX":source_parent.originX,"spacingM":source_parent.spacingM,"heightSha256":parent_sha,"sampleProvenance":"exact original retained B-spline controls"})
	var generated_ms=(Time.get_ticks_usec()-generated_started)/1000.0
	var world={"id":"retained-v14-chain-diagnostic","terrain":layers[0].terrain,"bounds":layers[0].bounds,"_terrainParents":layers.slice(1),"versions":{"terrain":"control-query-diagnostic-1"},"canonicalContextRef":{"id":"retained-v14-chain-diagnostic"},"_displaySpacing":100.0/214.0,"_heightLayers":layers}
	verify(Batch.source_budget(layers).samples==1618660,"Exact failed-chain source sample count")
	var source_hashes=[]
	for layer in layers:source_hashes.append(Batch._sha(layer.terrain.heights.to_byte_array()))
	var size=512;var spacing=100.0/214.0;var origin={"x":20000.0,"y":2000.0,"z":20000.0};var local_start=Vector3(-size*.5*spacing,0,-size*.5*spacing)
	var result=Batch.prepare(world,world,origin,local_start,spacing,size,14,{"heightBatchExecutable":args[0]})
	verify(not result.get("failed",false),"Native batch accepts all seven real-source-shaped layers: "+str(result.get("heightBatchError","")))
	if result.get("failed",false):quit(1);return
	var reference_started=Time.get_ticks_usec();var expected=PackedFloat32Array();expected.resize(size*size);var controls=PackedByteArray();controls.resize(size*size*4);controls.fill(0)
	for z in size:
		for x in size:expected[z*size+x]=Geometry.height_at(world,float(origin.x)+float(local_start.x)+x*spacing,float(origin.z)+float(local_start.z)+z*spacing)-float(origin.y)
	verify(expected.to_byte_array()==result.height.get_data(),"ALL 262144 output RF samples byte-exact to scalar GD across real retained relief and all parent seams")
	verify(controls==result.control.get_data() and result.metrics.holes==0,"ALL control/hole bytes match real source support")
	var reference_ms=(Time.get_ticks_usec()-reference_started)/1000.0
	for index in layers.size():verify(Batch._sha(layers[index].terrain.heights.to_byte_array())==source_hashes[index],"No source buffer mutation layer "+str(index))
	verify(Batch._sha(source_parent.heights.to_byte_array())==parent_sha,"Original retained B-spline controls byte-identical")
	verify(FileAccess.get_sha256(packet_path)==input_sha,"Original retained packet byte-identical")
	var report={"result":"PASS" if failures.is_empty() else "FAIL","failures":failures,"scope":"CPU retained-control query diagnostic; failed original NN 214-square BODY was not archived, so this is NOT byte replay of that body, no NN/generate/register/GPU; production never resamples or prunes parents","retainedPacket":{"path":packet_path,"sha256":input_sha,"retainedControlSha256":parent_sha},"layers":layer_proof,"sourceSamples":1618660,"sourceLayers":7,"outputPixels":size*size,"allRfAndControlBytesExact":failures.is_empty(),"sourceBuffersUnchanged":failures.is_empty(),"referencePayloadSha256":Batch._sha(expected.to_byte_array()+controls),"generatedControlQueryFixtureMs":generated_ms,"scalarGdReferenceMs":reference_ms,"nativeSampler":result.metrics,"executableSha256":FileAccess.get_sha256(args[0])}
	var output=FileAccess.open(args[2],FileAccess.WRITE);output.store_string(JSON.stringify(report,"  "));output.close()
	print(JSON.stringify({"test":"height-chain-retained-controls","result":report.result,"sourceSamples":report.sourceSamples,"outputPixels":report.outputPixels,"allRfAndControlBytesExact":report.allRfAndControlBytesExact,"generatedControlQueryFixtureMs":generated_ms,"scalarGdReferenceMs":reference_ms,"nativeTotalMs":result.metrics.totalMs,"report":args[2]}));quit(0 if failures.is_empty() else 1)
