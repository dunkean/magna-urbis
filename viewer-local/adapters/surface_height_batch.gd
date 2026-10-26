class_name SurfaceHeightBatch
extends RefCounted
const Geometry=preload("res://adapters/surface_geometry.gd")
const Coverage=preload("res://adapters/surface_source_coverage.gd")
const PrepareToken=preload("res://adapters/surface_prepare_control.gd")
const VERSION="gd-height-batch-1"
const MAX_BYTES=512*1024*1024
const MAX_SOURCE_LAYERS=7
# Seven retained grids of 1024² fit 56 MiB even when every control is f64.
# The source packet/wire cap remains 512 MiB; no parent is removed or resampled.
const MAX_SOURCE_SAMPLES=MAX_SOURCE_LAYERS*1024*1024
const SOURCE_BUDGET_VERSION="height-source-chain-2"
const MAX_NATIVE_KNOWN_BUFFERS=384*1024*1024
static func _sha(bytes:PackedByteArray)->String:
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(bytes);return hash.finish().hex_encode()
static func _remove_files(directory:String,files:Array)->void:
	for file in files:
		if FileAccess.file_exists(file):DirAccess.remove_absolute(file)
	DirAccess.remove_absolute(directory)
static func _failed(reason:String)->Dictionary:return {"failed":true,"heightBatchError":reason}

# Validate the entire chain before creating any wire payload copies.
static func source_budget(layers:Array)->Dictionary:
	if layers.is_empty() or layers.size()>MAX_SOURCE_LAYERS:return _failed("height batch source layer budget")
	var samples=0;var bytes=0
	for layer in layers:
		if not layer is Dictionary or not layer.get("terrain") is Dictionary:return _failed("height batch invalid display layer")
		var g:Dictionary=layer.terrain;var values=g.get("heights")
		if not values is PackedFloat32Array and not values is PackedFloat64Array and not values is Array:return _failed("height batch source dtype unsupported")
		for key in ["width","height","originX","originZ","spacingM","source"]:
			if not g.has(key):return _failed("height batch incomplete source metadata")
		if int(g.width)<2 or int(g.height)<2 or int(g.width)*int(g.height)!=values.size():return _failed("height batch source shape")
		samples+=values.size()
		if samples>MAX_SOURCE_SAMPLES:return _failed("height batch source sample budget")
		bytes+=values.size()*(4 if values is PackedFloat32Array else 8)
	return {"samples":samples,"bytes":bytes,"layers":layers.size()}

# Called on the existing preparation worker. Only the subprocess created here
# can be killed. Source arrays/files are never changed; output is job-bound.
static func prepare(world:Dictionary,display:Dictionary,origin:Dictionary,local_start:Vector3,spacing:float,size:int,serial:int,options:Dictionary)->Dictionary:
	var started=Time.get_ticks_usec();var control=options.get("prepareControl")
	var executable=ProjectSettings.globalize_path(str(options.get("heightBatchExecutable","")))
	if executable.is_empty() or not FileAccess.file_exists(executable):return _failed("explicit height batch executable missing")
	if size<2 or size>4096:return _failed("height batch resident shape/budget")
	var domains=Coverage.domains(world)
	if domains.is_empty():return _failed("height batch source domains invalid")
	var job={"worldId":str(world.id),"terrainVersion":str(world.get("versions",{}).get("terrain","")),"contextId":str(world.get("canonicalContextRef",{}).get("id","")),"sourceEpoch":options.get("heightBatchSourceEpoch"),"sceneEpoch":options.get("heightBatchSceneEpoch"),"serial":serial,"origin":origin.duplicate(),"size":size,"spacingM":spacing,"visibilityCameraSha256":str(options.get("visibilityCameraSha256","")),"executableSha256":FileAccess.get_sha256(executable)}
	var request={"version":VERSION,"job":job,"sourceId":str(world.terrain.source.id),"sourceVersion":str(world.terrain.source.version),"width":size,"height":size,"sampleOriginX":float(origin.x)+float(local_start.x),"sampleOriginZ":float(origin.z)+float(local_start.z),"relativeOriginY":float(origin.y),"spacingM":spacing,"displaySpacingM":float(display.get("_displaySpacing",spacing)),"domains":domains,"layers":[]}
	var layers:Array=display.get("_heightLayers",Geometry.prepare_height_layers(display))
	var budget=source_budget(layers)
	if budget.get("failed",false):return budget
	var payload=PackedByteArray();var samples=int(budget.samples)
	for layer in layers:
		if PrepareToken.hit(control,"height-batch-source-layer"):return {"cancelled":true}
		var g:Dictionary=layer.terrain;var values=g.get("heights")
		var dtype="f32" if values is PackedFloat32Array else "f64"
		var bytes:PackedByteArray
		if values is PackedFloat32Array or values is PackedFloat64Array:bytes=values.to_byte_array()
		elif values is Array:bytes=PackedFloat64Array(values).to_byte_array()
		else:return _failed("height batch source dtype unsupported")
		var item={"bounds":layer.bounds,"width":int(g.width),"height":int(g.height),"originX":float(g.originX),"originZ":float(g.originZ),"spacingM":float(g.spacingM),"reconstruction":str(g.get("reconstruction","bilinear-samples")),"dtype":dtype,"offset":payload.size(),"length":values.size(),"sourceId":str(g.source.id),"sourceVersion":str(g.source.version)}
		for key in ["lastSampleX","lastSampleZ"]:
			if g.has(key):item[key]=g[key]
		request.layers.append(item);payload.append_array(bytes)
	var source_bytes=payload.size()
	var manifest=JSON.stringify(request,"",true,true).to_utf8_buffer()
	# JSON numbers normalize Variant int/float types at this process boundary.
	# Compare the decoded wire job rather than its pre-encoding Variant types.
	var wire_job=JSON.parse_string(manifest.get_string_from_utf8()).job
	var start=ceili(float(16+manifest.size())/8.0)*8
	if manifest.size()>1024*1024 or start+payload.size()>MAX_BYTES:return _failed("height batch wire budget")
	var input=PackedByteArray();input.resize(start);input.fill(0)
	for i in 8:input[i]="MUHIN001".to_ascii_buffer()[i]
	input.encode_u32(8,manifest.size());input.encode_u32(12,payload.size())
	for i in manifest.size():input[16+i]=manifest[i]
	input.append_array(payload);payload=PackedByteArray()
	var digest=_sha(input)
	var directory=ProjectSettings.globalize_path("user://height-batch/%s-%s-%s"%[OS.get_process_id(),serial,Time.get_ticks_usec()])
	if DirAccess.make_dir_recursive_absolute(directory)!=OK:return _failed("height batch temporary directory unavailable")
	var input_path=directory.path_join("input.bin");var output_path=directory.path_join("output.bin")
	var file=FileAccess.open(input_path,FileAccess.WRITE)
	if file==null:_remove_files(directory,[]);return _failed("height batch input write failed")
	file.store_buffer(input);file.close();input=PackedByteArray()
	if PrepareToken.hit(control,"height-batch-before-process"):
		_remove_files(directory,[input_path]);return {"cancelled":true}
	var pid=OS.create_process(executable,PackedStringArray([input_path,output_path,digest]),false)
	if pid<=0:_remove_files(directory,[input_path]);return _failed("height batch process could not start")
	var process_started=Time.get_ticks_usec();var timeout_ms=clampf(float(options.get("heightBatchTimeoutMs",30000)),10.0,120000.0)
	var partial=directory.path_join("output.partial-"+str(pid))
	while true:
		var cancelled=PrepareToken.hit(control,"height-batch-poll")
		var timeout=(Time.get_ticks_usec()-process_started)/1000.0>timeout_ms
		if cancelled or timeout:
			var was_running=OS.is_process_running(pid)
			if was_running:OS.kill(pid)
			# Bounded wait permits Windows to release only this job's files.
			for i in 100:
				if not OS.is_process_running(pid):break
				OS.delay_msec(1)
			_remove_files(directory,[input_path,output_path,partial])
			var failure={"cancelled":true} if cancelled else _failed("height batch process timeout")
			failure.merge({"ownedProcessId":pid,"processWasRunningAtAbort":was_running,"processRunningAfterCleanup":OS.is_process_running(pid),"temporaryDirectory":directory,"temporaryDirectoryRemoved":not DirAccess.dir_exists_absolute(directory)})
			return failure
		if not OS.is_process_running(pid):break
		OS.delay_msec(2)
	if not FileAccess.file_exists(output_path):_remove_files(directory,[input_path,partial]);return _failed("height batch failed; no atomic output")
	var output_file=FileAccess.open(output_path,FileAccess.READ)
	var expected_payload=size*size*8
	if output_file==null or output_file.get_length()>expected_payload+1024*1024 or output_file.get_length()<16:
		_remove_files(directory,[input_path,output_path,partial]);return _failed("height batch output length budget")
	var output=output_file.get_buffer(output_file.get_length());output_file.close()
	_remove_files(directory,[input_path,output_path,partial])
	if output.slice(0,8).get_string_from_ascii()!="MUHOUT01":return _failed("height batch output magic")
	var header_length=output.decode_u32(8);var payload_length=output.decode_u32(12);var payload_start=ceili(float(16+header_length)/8.0)*8
	if header_length<1 or header_length>1024*1024 or payload_length!=expected_payload or payload_start+payload_length!=output.size():return _failed("height batch output framing")
	var header=JSON.parse_string(output.slice(16,16+header_length).get_string_from_utf8())
	if not header is Dictionary or header.get("version")!=VERSION or header.get("inputSha256")!=digest or header.get("job")!=wire_job or header.get("width")!=size or header.get("height")!=size or header.get("heightBytes")!=size*size*4 or header.get("controlBytes")!=size*size*4:return _failed("height batch job/source binding mismatch")
	if header.get("sourceBudgetVersion")!=SOURCE_BUDGET_VERSION or header.get("sourceSamples")!=samples or header.get("sourceLayers")!=layers.size() or header.get("sourceBytes")!=source_bytes or header.get("sourceSampleBudget")!=MAX_SOURCE_SAMPLES:return _failed("height batch source budget contract mismatch")
	var native_buffers=float(header.get("nativeKnownBufferUpperBytes",NAN))
	if not is_finite(native_buffers) or native_buffers<source_bytes+samples*8+size*size*8 or native_buffers>MAX_NATIVE_KNOWN_BUFFERS:return _failed("height batch native buffer budget contract mismatch")
	if not is_finite(float(header.get("minimumM",NAN))) or not is_finite(float(header.get("maximumM",NAN))):return _failed("height batch invalid source extrema")
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256)
	for offset in range(payload_start,output.size(),4*1024*1024):hash.update(output.slice(offset,mini(output.size(),offset+4*1024*1024)))
	if hash.finish().hex_encode()!=header.get("payloadSha256"):return _failed("height batch output SHA256 mismatch")
	var height_bytes=output.slice(payload_start,payload_start+size*size*4);var control_bytes=output.slice(payload_start+size*size*4);output=PackedByteArray()
	var result={"height":Image.create_from_data(size,size,false,Image.FORMAT_RF,height_bytes),"control":Image.create_from_data(size,size,false,Image.FORMAT_RF,control_bytes),"minimumM":float(header.minimumM),"maximumM":float(header.maximumM)}
	result["metrics"]={"version":VERSION,"mode":"explicit-native-batch","requested":true,"used":true,"eligible":true,"sourceWorldId":world.id,"sourceEpoch":job.sourceEpoch,"sceneEpoch":job.sceneEpoch,"sourceInputSha256":digest,"outputPayloadSha256":header.payloadSha256,"executableSha256":job.executableSha256,"sampleMs":header.sampleMs,"totalMs":(Time.get_ticks_usec()-started)/1000.0,"sourceSamples":samples,"sourceLayers":layers.size(),"sourceBytes":source_bytes,"sourceSampleBudget":MAX_SOURCE_SAMPLES,"sourceBudgetVersion":SOURCE_BUDGET_VERSION,"nativeKnownBufferUpperBytes":header.nativeKnownBufferUpperBytes,"holes":header.holes,"size":size,"spacingM":spacing,"provenance":header.provenance}
	return result
