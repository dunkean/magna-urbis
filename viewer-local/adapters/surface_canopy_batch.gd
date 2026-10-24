extends RefCounted
const PrepareControl=preload("res://adapters/surface_prepare_control.gd")
const VERSION="native-canopy-raster-1"
const MAX_BYTES=256*1024*1024
const MAX_KNOWN=384*1024*1024
static func sha(bytes:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(bytes);return h.finish().hex_encode()
static func failed(reason:String)->Dictionary:return {"failed":true,"canopyBatchError":reason}
static func number(value)->bool:return (value is float or value is int) and is_finite(float(value))
static func cleanup(directory:String,files:Array)->void:
	for path in files:
		if FileAccess.file_exists(path):DirAccess.remove_absolute(path)
	DirAccess.remove_absolute(directory)

# Runs only on the existing sequential scene preparation worker. No GPU calls.
static func prepare(packet:Dictionary,selected:Dictionary,unsupported:Dictionary,asset:Dictionary,origin:Dictionary,spacing:float,width:int,height:int,options:Dictionary)->Dictionary:
	var started=Time.get_ticks_usec();var executable=ProjectSettings.globalize_path(str(options.get("canopyBatchExecutable","")));var control=options.get("prepareControl")
	if executable.is_empty() or not FileAccess.file_exists(executable):return failed("explicit canopy batch executable missing")
	if width<2 or height<2 or width>2048 or height>2048:return failed("canopy raster budget")
	var columns:Dictionary=packet.get("candidateColumns",{});var candidates:Array=packet.get("candidates",packet.get("populations",[]));var count=int(columns.count) if not columns.is_empty() else candidates.size()
	var rows=PackedFloat64Array()
	for i in count:
		if i%1024==0 and PrepareControl.hit(control,"canopy-batch-input"):return {"cancelled":true}
		var family=str(columns.families[int(columns.family[i])]) if not columns.is_empty() else str(candidates[i].family)
		if family!="tree":continue
		var radius=float(columns.crownRadiusM[i]) if not columns.is_empty() else float(candidates[i].get("crownRadiusM",float(candidates[i].size)*.42))
		if not is_finite(radius) or radius<=0:continue
		if rows.size()/8>=100000:return failed("canopy tree budget")
		var id=str(columns.ids[i]) if not columns.is_empty() else str(candidates[i].stableId)
		rows.append_array(PackedFloat64Array([float(columns.positions[i*3]) if not columns.is_empty() else float(candidates[i].x),float(columns.positions[i*3+2]) if not columns.is_empty() else float(candidates[i].z),radius,float(columns.positions[i*3+1]) if not columns.is_empty() else float(candidates[i].y),float(columns.size[i]) if not columns.is_empty() else float(candidates[i].size),float(columns.orientation[i]) if not columns.is_empty() else float(candidates[i].get("orientation",0)),1.0 if selected.has(id) else 0.0,1.0 if unsupported.has(id) else 0.0]))
	var source:Dictionary=packet.get("source",{});var world:Dictionary=packet.get("world",{});var executable_hash=FileAccess.get_sha256(executable)
	if executable_hash.length()!=64 or not executable_hash.is_valid_hex_number():return failed("canopy executable hash unavailable")
	var job={"worldId":str(world.get("id","")),"sourceEpoch":str(source.get("sourceEpoch","")),"sceneEpoch":str(source.get("sceneEpoch","")),"assetDigest":str(asset.get("digest","legacy")),"executableSha256":executable_hash,"origin":origin,"spacingM":spacing,"width":width,"height":height}
	var request={"version":VERSION,"job":job,"width":width,"height":height,"originX":float(origin.x),"originZ":float(origin.z),"spacing":spacing,"treeCount":int(rows.size()/8),"mask":null}
	var payload=rows.to_byte_array();rows=PackedFloat64Array()
	if not asset.is_empty():
		var m:Dictionary=asset.mask
		if int(m.width)<2 or int(m.height)<2 or int(m.width)>1024 or int(m.height)>1024:return failed("canopy asset shape budget")
		var mask_bytes:PackedByteArray=asset.maskBytes;var normal:PackedFloat32Array=asset.normal;var color:PackedFloat32Array=asset.color;var pixels=int(m.width)*int(m.height)
		if mask_bytes.size()!=pixels or normal.size()!=pixels*4 or color.size()!=pixels*4:return failed("canopy asset payload shape")
		request.mask={"width":int(m.width),"height":int(m.height),"originX":float(m.originX),"originZ":float(m.originZ),"spacing":float(m.spacing)}
		payload.append_array(mask_bytes);payload.append_array(normal.to_byte_array());payload.append_array(color.to_byte_array())
	var manifest=JSON.stringify(request,"",true,true).to_utf8_buffer();var wire_job=JSON.parse_string(manifest.get_string_from_utf8()).job;var start=ceili(float(16+manifest.size())/8)*8
	if manifest.size()>1024*1024 or start+payload.size()>MAX_BYTES:return failed("canopy input wire budget")
	var input=PackedByteArray();input.resize(start);input.fill(0)
	for i in 8:input[i]="MUCIN001".to_ascii_buffer()[i]
	input.encode_u32(8,manifest.size());input.encode_u32(12,payload.size())
	for i in manifest.size():input[16+i]=manifest[i]
	input.append_array(payload);payload=PackedByteArray();var input_hash=sha(input)
	var directory=ProjectSettings.globalize_path("user://canopy-batch/%s-%s"%[OS.get_process_id(),Time.get_ticks_usec()]);var ip=directory.path_join("input.bin");var op=directory.path_join("output.bin")
	if DirAccess.make_dir_recursive_absolute(directory)!=OK:return failed("canopy temporary directory unavailable")
	var file=FileAccess.open(ip,FileAccess.WRITE)
	if file==null:cleanup(directory,[]);return failed("canopy input write failed")
	file.store_buffer(input);file.close();input=PackedByteArray()
	if PrepareControl.hit(control,"canopy-batch-before-process"):cleanup(directory,[ip]);return {"cancelled":true}
	var pid=OS.create_process(executable,PackedStringArray([ip,op,input_hash]),false)
	if pid<=0:cleanup(directory,[ip]);return failed("canopy process start failed")
	var partial=op.get_basename()+".partial-"+str(pid);var process_started=Time.get_ticks_usec();var timeout=clampf(float(options.get("canopyBatchTimeoutMs",30000)),10,120000)
	while true:
		var cancelled=PrepareControl.hit(control,"canopy-batch-poll");var timed_out=(Time.get_ticks_usec()-process_started)/1000.0>timeout
		if cancelled or timed_out:
			var running=OS.is_process_running(pid)
			if running:OS.kill(pid)
			for j in 2000:
				if not OS.is_process_running(pid):break
				OS.delay_msec(1)
			if OS.is_process_running(pid):return {"failed":true,"canopyBatchError":"owned canopy process did not terminate after abort; cleanup incomplete","abortIncomplete":true,"ownedProcessId":pid,"processRunningAfterCleanup":true,"temporaryDirectoryRemoved":false}
			cleanup(directory,[ip,op,partial]);var result={"cancelled":true} if cancelled else failed("canopy process timeout")
			result.merge({"ownedProcessId":pid,"processWasRunningAtAbort":running,"processRunningAfterCleanup":OS.is_process_running(pid),"temporaryDirectoryRemoved":not DirAccess.dir_exists_absolute(directory)})
			return result
		if not OS.is_process_running(pid):break
		OS.delay_msec(1)
	if not FileAccess.file_exists(op):cleanup(directory,[ip,partial]);return failed("canopy process produced no output")
	file=FileAccess.open(op,FileAccess.READ)
	if file==null:cleanup(directory,[ip,op,partial]);return failed("canopy output read failed")
	if file.get_length()>MAX_BYTES:file.close();cleanup(directory,[ip,op,partial]);return failed("canopy output wire budget")
	var raw=file.get_buffer(file.get_length());file.close();cleanup(directory,[ip,op,partial])
	return decode_output(raw,request,wire_job,input_hash,executable_hash,started)

# Kept separate so malformed typed headers are exercised without a subprocess.
static func decode_output(raw:PackedByteArray,request:Dictionary,wire_job:Dictionary,input_hash:String,executable_hash:String,started:int)->Dictionary:
	var width=int(request.width);var height=int(request.height);var job:Dictionary=request.job
	if raw.size()<16 or raw.slice(0,8).get_string_from_ascii()!="MUCOUT01":return failed("canopy output framing")
	var json_len=raw.decode_u32(8);var payload_len=raw.decode_u32(12);var offset=ceili(float(16+json_len)/8)*8
	if json_len>1024*1024 or offset>raw.size() or offset+payload_len!=raw.size():return failed("canopy output lengths")
	for i in range(16+json_len,offset):
		if raw[i]!=0:return failed("canopy output padding")
	var header=JSON.parse_string(raw.slice(16,16+json_len).get_string_from_utf8())
	if not header is Dictionary or header.get("version")!=VERSION or header.get("job")!=wire_job or header.get("inputSha256")!=input_hash or header.get("width")!=width or header.get("height")!=height:return failed("canopy output job binding")
	var n=width*height;var lengths=[n*4,n*16,n*16,n*16 if request.mask!=null else 0]
	if not header.get("planeBytes") is Array or header.planeBytes.size()!=4 or payload_len!=lengths[0]+lengths[1]+lengths[2]+lengths[3]:return failed("canopy output plane shape")
	for k in 4:
		if not header.planeBytes[k] is float or header.planeBytes[k]!=float(lengths[k]):return failed("canopy output plane length")
	var known=header.get("nativeKnownBufferUpperBytes")
	if not known is float and not known is int:return failed("canopy known-buffer provenance")
	if not is_finite(float(known)) or float(known)<payload_len+n*4 or float(known)>MAX_KNOWN:return failed("canopy native allocation budget")
	if not number(header.get("sampleMs")) or float(header.sampleMs)<0:return failed("canopy native timing")
	for key in ["trees","selectedTrees","unsupportedTrees"]:
		var value=header.get(key)
		if not number(value) or float(value)!=floor(float(value)) or float(value)<0 or float(value)>request.treeCount:return failed("canopy output tree statistics")
	if header.trees+header.unsupportedTrees!=request.treeCount or header.selectedTrees>header.trees:return failed("canopy output tree partition")
	var body=raw.slice(offset);raw=PackedByteArray()
	if sha(body)!=header.get("payloadSha256"):return failed("canopy payload sha256")
	var planes=[];var position=0
	for bytes in lengths:
		planes.append(body.slice(position,position+bytes).to_float32_array());position+=bytes
	# The pinned native producer validates every output value. Its echoed extrema
	# plus the bound payload digest avoid redoing millions of scalar GD iterations.
	var extremes=header.get("planeExtremes")
	if not extremes is Array or extremes.size()!=4:return failed("canopy output extrema contract")
	for k in 4:
		if lengths[k]==0:
			if extremes[k]!=null:return failed("canopy empty plane extrema")
			continue
		var e=extremes[k]
		if not e is Array or e.size()!=2 or not number(e[0]) or not number(e[1]) or float(e[0])>float(e[1]):return failed("canopy output finite extrema")
		if k==0 and (float(e[0])<0 or float(e[1])>1):return failed("canopy coverage extrema")
		if k==1 and (float(e[0])<0 or float(e[1])>request.treeCount):return failed("canopy counts extrema")
		if k==2 and (float(e[0])<-.00001 or float(e[1])>1.00001):return failed("canopy normal extrema")
	body=PackedByteArray()
	return {"coverage":planes[0],"counts":planes[1],"normals":planes[2],"colors":planes[3],"trees":int(header.trees),"selected":int(header.selectedTrees),"unsupported":int(header.unsupportedTrees),"metrics":{"version":VERSION,"requested":true,"used":true,"eligible":true,"sourceWorldId":job.worldId,"sourceEpoch":job.sourceEpoch,"sceneEpoch":job.sceneEpoch,"assetDigest":job.assetDigest,"executableSha256":executable_hash,"sourceInputSha256":input_hash,"outputPayloadSha256":header.payloadSha256,"width":width,"height":height,"treeCount":request.treeCount,"nativeKnownBufferUpperBytes":known,"sampleMs":header.sampleMs,"totalMs":(Time.get_ticks_usec()-started)/1000.0}}
