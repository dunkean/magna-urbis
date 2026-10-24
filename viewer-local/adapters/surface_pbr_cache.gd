extends RefCounted
# Prepared bytes only. No source files, shader code or asset identities change.
const VERSION="surface-pbr-prepared-1"
const MAX_FILES=32
const MAX_BYTES=512*1024*1024
const HEADER_LIMIT=65536
static func _sha(bytes:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(bytes);return h.finish().hex_encode()
static func key(asset_id:String,pipeline:String,side:int,hashes:Dictionary)->Dictionary:
	var engine=Engine.get_version_info()
	return {"version":VERSION,"assetId":asset_id,"pipeline":pipeline,"side":side,"inputActualSha256":hashes,"decoder":{"version":engine.string,"hash":engine.get("hash",""),"os":OS.get_name()}}
static func _key_hash(value:Dictionary)->String:return JSON.stringify(value,"",true,true).sha256_text()
static func _entry_sha(key_hash:String,fallback:bool,payload:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(key_hash.to_ascii_buffer());h.update(PackedByteArray([1 if fallback else 0]));h.update(payload);return h.finish().hex_encode()
static func _stem(value:Dictionary)->String:return str(value.assetId).sha256_text()
static func _image_bytes(side:int,stride:int)->int:
	var total=0
	while true:
		total+=side*side*stride
		if side==1:return total
		side=maxi(1,int(side/2))
	return total
static func load_entry(directory:String,value:Dictionary)->Dictionary:
	var side=int(value.get("side",0))
	if side<2 or side>2048:return {}
	var ah_size=_image_bytes(side,8);var nr_size=_image_bytes(side,4);var expected=ah_size+nr_size+16
	var filename=ProjectSettings.globalize_path(directory).path_join(_stem(value)+".pbrcache")
	if not FileAccess.file_exists(filename):return {}
	var file=FileAccess.open(filename,FileAccess.READ)
	if file==null or file.get_length()<16 or file.get_length()>expected+HEADER_LIMIT:return {}
	var prefix=file.get_buffer(16)
	if prefix.slice(0,8).get_string_from_ascii()!="PBRRAW01":return {}
	var header_size=prefix.decode_u32(8);var payload_size=prefix.decode_u32(12)
	if header_size<1 or header_size>HEADER_LIMIT or payload_size!=expected or file.get_length()!=16+header_size+payload_size:return {}
	var parser=JSON.new()
	if parser.parse(file.get_buffer(header_size).get_string_from_utf8())!=OK:return {}
	var header=parser.data
	if not header is Dictionary or header.get("version")!=VERSION or header.get("keySha256")!=_key_hash(value) or header.get("ahBytes")!=ah_size or header.get("nrBytes")!=nr_size or not header.get("heightFallback") is bool:return {}
	var payload=file.get_buffer(payload_size);file.close()
	if payload.size()!=expected or _sha(payload)!=header.get("payloadSha256") or _entry_sha(_key_hash(value),header.heightFallback,payload)!=header.get("entrySha256"):return {}
	var mean=payload.slice(ah_size+nr_size).to_float32_array()
	for component in mean:
		if not is_finite(component):return {}
	if mean.size()!=4 or mean[3]!=1.0:return {}
	var ah=Image.create_from_data(side,side,true,Image.FORMAT_RGBAH,payload.slice(0,ah_size))
	var nr=Image.create_from_data(side,side,true,Image.FORMAT_RGBA8,payload.slice(ah_size,ah_size+nr_size))
	if ah.is_empty() or nr.is_empty():return {}
	return {"ah":ah,"nr":nr,"mean":Color(mean[0],mean[1],mean[2],mean[3]),"heightFallback":header.heightFallback}

static func store_entry(directory:String,value:Dictionary,prepared:Dictionary,limits:Dictionary={})->String:
	var root=ProjectSettings.globalize_path(directory)
	if DirAccess.make_dir_recursive_absolute(root)!=OK:return "directory-unavailable"
	# Atomic directory creation serializes writers across processes. A stale lock
	# safely stops writes; it never permits growth or deletes somebody else's data.
	var lock=root.path_join("write.lock")
	if DirAccess.make_dir_absolute(lock)!=OK:return "writer-busy-or-stale-lock"
	var result=_store_locked(root,value,prepared,limits)
	DirAccess.remove_absolute(lock)
	return result
static func _store_locked(root:String,value:Dictionary,prepared:Dictionary,limits:Dictionary)->String:
	var side=int(value.side)
	if side<2 or side>2048:return "unsupported-dimensions"
	var ah:Image=prepared.ah;var nr:Image=prepared.nr
	if ah.get_width()!=side or ah.get_height()!=side or nr.get_width()!=side or nr.get_height()!=side or ah.get_format()!=Image.FORMAT_RGBAH or nr.get_format()!=Image.FORMAT_RGBA8 or not ah.has_mipmaps() or not nr.has_mipmaps():return "unsupported-image-format"
	var payload=ah.get_data();var ah_size=payload.size();var normal_bytes=nr.get_data();var nr_size=normal_bytes.size()
	if ah_size!=_image_bytes(side,8) or nr_size!=_image_bytes(side,4):return "unsupported-mip-length"
	payload.append_array(normal_bytes)
	var mean:Color=prepared.mean
	payload.append_array(PackedFloat32Array([mean.r,mean.g,mean.b,mean.a]).to_byte_array())
	var header=JSON.stringify({"version":VERSION,"keySha256":_key_hash(value),"payloadSha256":_sha(payload),"entrySha256":_entry_sha(_key_hash(value),prepared.heightFallback,payload),"ahBytes":ah_size,"nrBytes":nr_size,"heightFallback":prepared.heightFallback},"",true,true).to_utf8_buffer()
	if header.size()>HEADER_LIMIT:return "header-budget"
	var filename=root.path_join(_stem(value)+".pbrcache");var temporary=root.path_join(_stem(value)+".pending")
	var regex=RegEx.new();regex.compile("^[a-f0-9]{64}\\.(pbrcache|pending)$")
	var directory=DirAccess.open(root);var total=0;var count=0;var old_temp_size=0;var has_temp=false;var scanned=0
	if directory==null:return "directory-unavailable"
	directory.list_dir_begin()
	var name=directory.get_next()
	while not name.is_empty():
		scanned+=1
		if scanned>256:directory.list_dir_end();return "directory-scan-budget"
		if not directory.current_is_dir() and regex.search(name)!=null:
			var entry=root.path_join(name);var length=_file_size(entry)
			count+=1;total+=length
			if entry==temporary:has_temp=true;old_temp_size=length
		name=directory.get_next()
		if count>MAX_FILES:directory.list_dir_end();return "entry-count-budget"
	directory.list_dir_end()
	# Include the temporary AND retained final file until atomic replacement.
	if count+(0 if has_temp else 1)>MAX_FILES:return "entry-count-budget"
	if total-old_temp_size+16+header.size()+payload.size()>mini(MAX_BYTES,int(limits.get("maxBytes",MAX_BYTES))):return "byte-budget"
	var file=FileAccess.open(temporary,FileAccess.WRITE)
	if file==null:return "write-unavailable"
	file.store_buffer("PBRRAW01".to_ascii_buffer());file.store_32(header.size());file.store_32(payload.size());file.store_buffer(header);file.store_buffer(payload);file.close()
	if DirAccess.rename_absolute(temporary,filename)!=OK:
		DirAccess.remove_absolute(temporary);return "atomic-replace-failed"
	return "written"
static func _file_size(filename:String)->int:
	var file=FileAccess.open(filename,FileAccess.READ)
	return file.get_length() if file!=null else MAX_BYTES+1
