extends SceneTree
const Batch=preload("res://adapters/surface_height_batch.gd")
const Geometry=preload("res://adapters/surface_geometry.gd")
const Coverage=preload("res://adapters/surface_source_coverage.gd")
const PrepareToken=preload("res://adapters/surface_prepare_control.gd")
class CancelGate extends "res://adapters/surface_prepare_control.gd":
	func checkpoint(stage:String)->bool:
		if stage=="height-batch-poll":request_cancel(2,1)
		return super.checkpoint(stage)
class CancelSourceGate extends "res://adapters/surface_prepare_control.gd":
	func checkpoint(stage:String)->bool:
		if stage=="height-batch-source-layer":request_cancel(2,1)
		return super.checkpoint(stage)
var checks=0
var failures=0
var cases=[]
func _initialize()->void:call_deferred("run")
func verify(ok:bool,message:String)->void:
	checks+=1
	if not ok:failures+=1;push_error(message)
func grid(n:int,spacing:float,ox:float,oz:float,cubic:bool,f64:bool=false)->Dictionary:
	var values=PackedFloat64Array() if f64 else PackedFloat32Array();values.resize(n*n)
	for z in n:
		for x in n:values[z*n+x]=1031.25+sin(float(x)*.41)*37.0+cos(float(z)*.73)*19.0
	return {"width":n,"height":n,"originX":ox,"originZ":oz,"spacingM":spacing,"heights":values,"reconstruction":"cubic-bspline-controls" if cubic else "bilinear-samples","source":{"id":"authored-native-kernel-test","version":"height-1","nativeSpacingM":spacing,"sourceLOD":0}}
func world_for(g:Dictionary)->Dictionary:
	return {"id":"batch-test","terrain":g,"bounds":{"minX":g.originX,"minZ":g.originZ,"maxX":float(g.get("lastSampleX",float(g.originX)+(int(g.width)-1)*float(g.spacingM))),"maxZ":float(g.get("lastSampleZ",float(g.originZ)+(int(g.height)-1)*float(g.spacingM)))},"versions":{"terrain":"test-version"},"canonicalContextRef":{"id":"test-context"}}
func exercise(executable:String,world:Dictionary,origin:Dictionary,spacing:float,size:int,name:String)->void:
	world["_displaySpacing"]=spacing;world["_heightLayers"]=Geometry.prepare_height_layers(world)
	var local_start=Vector3(-size*.5*spacing,0,-size*.5*spacing)
	var result=Batch.prepare(world,world,origin,local_start,spacing,size,checks,{"heightBatchExecutable":executable})
	verify(not result.get("failed",false),name+": native job "+str(result))
	if result.get("failed",false):return
	var expected=PackedFloat32Array();expected.resize(size*size);var controls=PackedByteArray();controls.resize(size*size*4)
	var domains=Coverage.domains(world);var maximum=0.0;var holes=0
	for z in size:
		for x in size:
			var wx=float(origin.x)+float(local_start.x)+float(x)*spacing;var wz=float(origin.z)+float(local_start.z)+float(z)*spacing
			var covered=Coverage.contains(domains,wx,wz)
			var px=wx;var pz=wz
			if not covered:
				var point=Coverage.nearest_point(domains,wx,wz);px=point.x;pz=point.z;holes+=1
			var value=Geometry.height_at(world,px,pz)-float(origin.y);expected[z*size+x]=value
			controls.encode_u32((z*size+x)*4,0 if covered else 4)
			maximum=maxf(maximum,absf(value-float(result.height.get_pixel(x,z).r)))
	verify(expected.to_byte_array()==result.height.get_data(),name+": ALL output RF bytes equal GDScript source/seam/nearest-height reconstruction")
	verify(controls==result.control.get_data(),name+": ALL terrain hole/control bits equal")
	verify(int(result.metrics.holes)==holes,name+": source coverage count")
	cases.append({"name":name,"pixels":size*size,"holes":holes,"nativeTotalMs":result.metrics.totalMs,"nativeSampleMs":result.metrics.sampleMs,"maximumF64ToRfErrorM":maximum,"allRfAndControlBytesExact":true,"sourceSamples":result.metrics.sourceSamples,"sourceLayers":result.metrics.sourceLayers,"sourceBudgetVersion":result.metrics.sourceBudgetVersion,"sourceInputSha256":result.metrics.sourceInputSha256,"outputPayloadSha256":result.metrics.outputPayloadSha256,"nativeKnownBufferUpperBytes":result.metrics.nativeKnownBufferUpperBytes})
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=1:push_error("Pass native height helper executable");quit(2);return
	var exe=args[0];var origin={"x":0.0,"y":1000.125,"z":0.0}
	exercise(exe,world_for(grid(9,2.5,-10,-10,false)),origin,1.25,33,"bilinear-f32-edge-padding")
	exercise(exe,world_for(grid(9,2.5,-10,-10,true)),origin,.625,65,"cubic-f32-16tap")
	exercise(exe,world_for(grid(9,2.5,-10,-10,true,true)),origin,.625,65,"cubic-f64-16tap")
	var offset=1000000000.125;var shifted=grid(9,.3,offset-1.2,-offset-1.2,false);shifted.lastSampleX=float(shifted.originX)+2.4-.07;shifted.lastSampleZ=float(shifted.originZ)+2.4-.03
	exercise(exe,world_for(shifted),{"x":offset,"y":1000.125,"z":-offset},.15,33,"rebase-1e9-irregular-last-sample")
	var child=world_for(grid(9,1,-4,-4,false));var parent=world_for(grid(9,4,-16,-16,true))
	child["_terrainParents"]=[{"terrain":parent.terrain,"bounds":parent.bounds,"canonicalContextId":"test-context"}]
	exercise(exe,child,origin,.625,65,"fine-child-cubic-parent-feather")
	var left=world_for(grid(5,2,-18,-4,true));var right=world_for(grid(5,2,10,-4,true));right.terrain.heights.fill(1100)
	right["_terrainParents"]=[{"terrain":left.terrain,"bounds":left.bounds,"canonicalContextId":"test-context"}]
	exercise(exe,right,origin,1.0,49,"disjoint-domains-hidden-gap-nearest-tie")
	# Actual failing V14 chain SHAPES, with explicitly authored heights here.
	# The unarchived NN child body is not claimed to be replayed by this fixture.
	var shapes=[[214,100.0,19950.0],[512,244.0,19878.0],[512,820.0,19590.0],[512,3124.0,18438.0],[512,12052.0,13974.0],[512,39921.875,39.0625]]
	var chain=[]
	for shape in shapes:
		var spacing=float(shape[1])/int(shape[0]);var start=float(shape[2])+spacing*.5
		chain.append(world_for(grid(int(shape[0]),spacing,start,start,false)))
	chain.append(world_for(grid(512,78.125,39.0625,39.0625,true)))
	var live:Dictionary=chain[0];live._terrainParents=[]
	for index in range(1,chain.size()):live._terrainParents.append({"terrain":chain[index].terrain,"bounds":chain[index].bounds,"canonicalContextId":"test-context"})
	exercise(exe,live,{"x":20000.0,"y":1000.125,"z":20000.0},100.0/214.0,512,"v14-full-live-chain-shapes-authored-heights-1618660-samples")
	var full=[]
	var maximum_grid=grid(1024,1.0,-512,-512,false,true)
	for index in 7:
		var g:Dictionary=maximum_grid.duplicate();g.spacingM=float(index+1)
		var item=world_for(g);full.append({"terrain":g,"bounds":item.bounds,"canonicalContextId":"test-context"})
	var maximum_world=world_for(full[0].terrain);maximum_world._terrainParents=full.slice(1)
	exercise(exe,maximum_world,origin,1.25,65,"exact-seven-1024-square-f64-budget")
	verify(Batch.source_budget(full).samples==7340032,"expanded source sample limit accepts exactly seven 1024-square controls")
	var oversized:Dictionary=full[6].duplicate(true);oversized.terrain.width=1025;oversized.terrain.heights.resize(1025*1024)
	var above=full.duplicate();above[6]=oversized
	verify(Batch.source_budget(above).get("heightBatchError")=="height batch source sample budget","above total source samples rejected before payload copies")
	var too_many=full.duplicate();too_many.append(full[0])
	verify(Batch.source_budget(too_many).get("heightBatchError")=="height batch source layer budget","eight layers rejected independently of sample count")
	var before_wire=CancelSourceGate.new(1,1,"shown","shown")
	verify(Batch.prepare(maximum_world,maximum_world,origin,Vector3.ZERO,1,65,checks,{"heightBatchExecutable":exe,"prepareControl":before_wire}).get("cancelled",false) and before_wire.report().reached,"source serialization checkpoint cancels before allocating wire copies or subprocess")
	var source=world_for(grid(5,2,-4,-4,true));source["_displaySpacing"]=1.0
	verify(Batch.prepare(source,source,origin,Vector3.ZERO,1,16,1,{"heightBatchExecutable":"missing-native-helper"}).failed,"explicit missing helper refuses rather than silently fake/fallback")
	var token=CancelGate.new(1,1,"shown","shown")
	var cancelled=Batch.prepare(source,source,origin,Vector3(-2048,0,-2048),1,4096,2,{"heightBatchExecutable":exe,"prepareControl":token})
	verify(cancelled.get("cancelled",false) and token.report().reached,"cancellation reaches a live subprocess checkpoint")
	verify(cancelled.processWasRunningAtAbort and not cancelled.processRunningAfterCleanup and cancelled.temporaryDirectoryRemoved,"cancel kills only owned live process and removes its job files")
	var timeout=Batch.prepare(source,source,origin,Vector3(-2048,0,-2048),1,4096,3,{"heightBatchExecutable":exe,"heightBatchTimeoutMs":10})
	verify(timeout.get("failed",false) and timeout.heightBatchError=="height batch process timeout","native timeout is bounded and explicit")
	verify(not timeout.processRunningAfterCleanup and timeout.temporaryDirectoryRemoved,"timeout cleans its owned process/files")
	print(JSON.stringify({"test":"native-height-batch","result":"PASS" if failures==0 else "FAIL","checks":checks,"failures":failures,"cases":cases,"cancel":cancelled,"timeout":timeout,"scope":"authored CPU kernel/whole-image F32 and hole-bit parity, process cancellation/timeout; no GPU"}));quit(0 if failures==0 else 1)
