extends SceneTree
const Batch=preload("res://adapters/surface_canopy_batch.gd")
class CancelGate extends "res://adapters/surface_prepare_control.gd":
	func checkpoint(stage:String)->bool:
		if stage=="canopy-batch-poll":request_cancel(2,1)
		return super.checkpoint(stage)
var checks=0
var failures=0
var cases=[]
func _initialize()->void:call_deferred("run")
func verify(ok:bool,why:String)->void:
	checks+=1
	if not ok:failures+=1;push_error(why)
func fixture(mode:int,offset:float)->Dictionary:
	var candidates=[]
	for i in 24:
		candidates.append({"stableId":"tree-"+str(i),"family":"tree","x":offset+(i%6-3)*4.13,"z":-offset+(int(i/6)-2)*6.07,"y":10.001+i*.11,"size":5.+i*.137,"crownRadiusM":[2.5,3.25,4.0,5.5,7.0][i%5],"orientation":i*.324,"rank":i/24.})
	var packet={"world":{"id":"canopy-fixture-"+str(mode),"seed":17,"versions":{},"terrain":{"source":{}}},"source":{"sourceEpoch":"test-source","sceneEpoch":"test-scene"},"candidates":candidates,"candidatePages":{"version":"surface-candidate-pages-1","tree":{"complete":true,"includeOverhang":true,"retention":1,"bounds":{"minX":offset-16,"maxX":offset+16,"minZ":-offset-16,"maxZ":-offset+16}}},"_unsupportedTreeIDs":{"tree-0":true,"tree-11":true}}
	if mode>0:
		var mask=PackedByteArray();var n=PackedFloat32Array();var c=PackedFloat32Array()
		for z in 8:
			for x in 8:
				var a=0.0 if x==0 or z==0 else (128./255. if x==3 else 1.)
				mask.append(roundi(a*255));n.append_array(PackedFloat32Array([(.3+x*.04)*a,.9*a,(.3+z*.04)*a,a]));c.append_array(PackedFloat32Array([x*.04*a,z*.04*a,.1*a,a]))
		packet["_treeAssetCPU"]={"digest":"authored-mask-8","mask":{"width":8,"height":8,"originX":-1.1,"originZ":-1.1,"spacing":2.2/7},"maskBytes":mask,"normal":n,"color":c}
	if mode==3:packet.candidates=[]
	return packet
func decoder_cases()->void:
	var job={"worldId":"authored-decoder","sourceEpoch":"s","sceneEpoch":"c","assetDigest":"legacy"};var request={"width":2,"height":2,"treeCount":0,"mask":null,"job":job};var body=PackedByteArray();body.resize(144);body.fill(0)
	var header={"version":Batch.VERSION,"job":job,"inputSha256":"source","payloadSha256":Batch.sha(body),"width":2,"height":2,"planeBytes":[16,64,64,0],"planeExtremes":[[0,0],[0,0],[0,0],null],"trees":0,"selectedTrees":0,"unsupportedTrees":0,"nativeKnownBufferUpperBytes":33555000,"sampleMs":0}
	var mutations=[{}, {"sampleMs":"fast"},{"sampleMs":{}},{"trees":[]},{"trees":true},{"selectedTrees":1},{"unsupportedTrees":-1},{"planeExtremes":[[{},0],[0,0],[0,0],null]},{"planeExtremes":[[0,2],[0,0],[0,0],null]},{"planeBytes":[16,"64",64,0]},{"nativeKnownBufferUpperBytes":"large"},{"payloadSha256":"changed"},{"job":{"worldId":"stale"}}]
	for index in mutations.size():
		var value=header.duplicate(true);value.merge(mutations[index],true);var json=JSON.stringify(value,"",true,true).to_utf8_buffer();var start=ceili(float(16+json.size())/8)*8;var raw=PackedByteArray();raw.resize(start);raw.fill(0)
		for i in 8:raw[i]="MUCOUT01".to_ascii_buffer()[i]
		raw.encode_u32(8,json.size());raw.encode_u32(12,body.size())
		for i in json.size():raw[16+i]=json[i]
		raw.append_array(body);var result=Batch.decode_output(raw,request,job,"source","exe",Time.get_ticks_usec())
		verify(result.get("failed",false)==(index>0),"authored decoder typed case "+str(index)+": "+str(result.get("canopyBatchError","valid")))
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("Pass native executable and frozen V15 reference script (RESOLUTION only set to256)");quit(2);return
	var reference=load(args[1]);verify(reference!=null,"frozen reference loads")
	if reference==null:quit(1);return
	decoder_cases()
	for mode in 4:
		var offset=1000000000.0 if mode==2 else 0.;var packet=fixture(mode,offset);var selected={"tree-1":true,"tree-2":true,"tree-11":true,"tree-17":true};var before=var_to_bytes(packet)
		var scalar=reference.prepare(packet,selected);var native=Batch.prepare(packet,selected,packet._unsupportedTreeIDs,packet.get("_treeAssetCPU",{}),scalar.origin,scalar.spacingM,int(scalar.gridSize.x),int(scalar.gridSize.y),{"canopyBatchExecutable":args[0]})
		verify(not native.get("failed",false),"native run "+str(mode)+": "+str(native))
		if native.get("failed",false):continue
		verify(var_to_bytes(packet)==before,"source packet and candidate IDs unchanged")
		var fields=["coverage","counts","normals","colors"];var images=["coverageImage","countsImage","normalImage","colorImage"];var exact={};var maxima={}
		for k in 4:
			if not scalar.has(images[k]):continue
			var format=Image.FORMAT_RF if k==0 else Image.FORMAT_RGBAF;var image=Image.create_from_data(int(scalar.gridSize.x),int(scalar.gridSize.y),false,format,native[fields[k]].to_byte_array())
			if k!=1:image.generate_mipmaps()
			var expected:PackedFloat32Array=scalar[images[k]].get_data().to_float32_array();var actual:PackedFloat32Array=image.get_data().to_float32_array();var error=0.;var mismatches=0
			for i in expected.size():
				if expected[i]!=actual[i]:mismatches+=1;error=maxf(error,absf(expected[i]-actual[i]))
			exact[fields[k]]=image.get_data()==scalar[images[k]].get_data();maxima[fields[k]]={"maximumError":error,"mismatches":mismatches};verify(exact[fields[k]],"all base+mip bytes exact for "+fields[k]+" case "+str(mode)+": "+str(maxima[fields[k]]))
		verify(native.trees==scalar.treeCount and native.selected==scalar.selectedTreeCount and native.unsupported==scalar.unsupportedTreeCount,"tree statistics unchanged")
		cases.append({"mode":mode,"offset":offset,"pixelCount":int(scalar.gridSize.x)*int(scalar.gridSize.y),"allBaseAndMipBytesExact":exact,"maximumErrors":maxima,"sampler":native.metrics})
	var packet=fixture(1,0.);var selected={"tree-1":true};var origin={"x":-16.,"z":-16.};var token=CancelGate.new(1,1,"same","same")
	var cancelled=Batch.prepare(packet,selected,packet._unsupportedTreeIDs,packet._treeAssetCPU,origin,.25,256,256,{"canopyBatchExecutable":args[0],"prepareControl":token})
	verify(cancelled.get("cancelled",false) and token.report().reached,"cancellation reaches actual owned process")
	verify(cancelled.get("processWasRunningAtAbort",false) and not cancelled.get("processRunningAfterCleanup",true) and cancelled.get("temporaryDirectoryRemoved",false),"cancel observes owned process exit and files removed")
	var timed=Batch.prepare(packet,selected,packet._unsupportedTreeIDs,packet._treeAssetCPU,origin,.25,2048,2048,{"canopyBatchExecutable":args[0],"canopyBatchTimeoutMs":10})
	verify(timed.get("failed",false) and timed.get("canopyBatchError")=="canopy process timeout","bounded actual process timeout")
	verify(not timed.get("processRunningAfterCleanup",true) and timed.get("temporaryDirectoryRemoved",false),"timeout observes owned process exit and files removed")
	verify(reference.prepare(packet,selected).available,"preseed scalar cache")
	verify(preload("res://adapters/surface_canopy.gd").prepare(packet,selected,{}, {"canopyBatchExecutable":"missing-canopy-native-executable"}).get("failed",false),"explicit missing native cannot reuse a scalar cache")
	print(JSON.stringify({"test":"native-canopy-frozen-v15-parity","checks":checks,"failures":failures,"cases":cases,"cancel":cancelled,"timeout":timed,"scope":"CPU authored trees/cutout/response versus frozen V15 scalar implementation; sizing constant only changed to256; decoder rejects malformed types; real cancellation/timeout; no GPU or artistic qualification"}));quit(0 if failures==0 else 1)
