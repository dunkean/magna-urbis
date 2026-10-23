extends SceneTree
var request := HTTPRequest.new()
var started := 0
var args := {}
func _initialize() -> void:
	var values := OS.get_cmdline_user_args();var i := 0
	while i<values.size():
		if i+1<values.size(): args[values[i]]=values[i+1];i+=2
		else: i+=1
	call_deferred("run")
func run() -> void:
	if not args.has("--url") or not args.has("--expected-sha") or not args.has("--expected-bytes") or not args.has("--out"):
		push_error("HTTP probe requires url, expected-sha, expected-bytes and out");quit(2);return
	request.use_threads=true
	request.download_chunk_size=1024*1024
	request.timeout=300.0
	request.body_size_limit=512*1024*1024
	root.add_child(request)
	request.request_completed.connect(completed)
	started=Time.get_ticks_msec()
	var error := request.request(str(args["--url"]))
	if error!=OK: push_error("HTTP request failed to start: "+str(error));quit(1)
func completed(result: int,status: int,headers: PackedStringArray,body: PackedByteArray) -> void:
	var elapsed := Time.get_ticks_msec()-started
	var hash := HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(body)
	var sha := hash.finish().hex_encode()
	var expected := int(args["--expected-bytes"])
	var exact := result==HTTPRequest.RESULT_SUCCESS and status==200 and body.size()==expected and sha==str(args["--expected-sha"])
	var report := {"format":"magna-native-http-io-proof","version":1,"scope":"Actual saved SurfaceWorld packet replay only; no new source generation, scene rendering or FPS claim.",
		"result":result,"status":status,"receivedBytes":body.size(),"downloadedBytes":request.get_downloaded_bytes(),"expectedBytes":expected,
		"elapsedMs":elapsed,"sha256":sha,"expectedSHA256":args["--expected-sha"],"exact":exact,"headers":Array(headers),
		"configuration":{"useThreads":request.use_threads,"downloadChunkBytes":request.download_chunk_size,"timeoutSeconds":request.timeout,"bodySizeLimit":request.body_size_limit}}
	var path := str(args["--out"]);DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path,FileAccess.WRITE)
	if file==null: push_error("Could not write HTTP I/O proof");quit(1);return
	file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify(report));quit(0 if exact else 1)
