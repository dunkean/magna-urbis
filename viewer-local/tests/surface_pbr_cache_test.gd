extends SceneTree
const Cache=preload("res://adapters/surface_pbr_cache.gd")
var checks=0
var failures=0
func _initialize()->void:call_deferred("run")
func verify(ok:bool,label:String)->void:
	checks+=1
	if not ok:failures+=1;push_error(label)
func write_file(path:String,bytes:PackedByteArray)->void:
	var file=FileAccess.open(path,FileAccess.WRITE);file.store_buffer(bytes);file.close()
func run()->void:
	var args=OS.get_cmdline_user_args()
	if args.size()!=1:push_error("Pass a new owned cache test directory");quit(2);return
	var root=args[0];DirAccess.make_dir_recursive_absolute(root)
	var ah=Image.create(8,8,false,Image.FORMAT_RGBAH);var nr=Image.create(8,8,false,Image.FORMAT_RGBA8)
	for z in 8:
		for x in 8:ah.set_pixel(x,z,Color(x/8.0,z/8.0,.17,.5));nr.set_pixel(x,z,Color(.5,.6,.9,x/8.0))
	ah.generate_mipmaps();nr.generate_mipmaps()
	var prepared={"ah":ah,"nr":nr,"mean":Color(.17,.23,.34,1),"heightFallback":false}
	var key=Cache.key("asset-a","pipeline-a",8,{"baseColor":"a","normal":"n","roughness":"r","height":"h"})
	verify(Cache.load_entry(root,key).is_empty(),"uncached input misses")
	verify(Cache.store_entry(root,key,prepared)=="written","first entry is atomically written")
	var hit=Cache.load_entry(root,key)
	verify(not hit.is_empty(),"verified entry loads")
	verify(hit.ah.get_data()==ah.get_data() and hit.nr.get_data()==nr.get_data(),"all AH/NR mip bytes exact")
	verify(PackedColorArray([hit.mean]).to_byte_array()==PackedColorArray([prepared.mean]).to_byte_array(),"mean float bytes exact")
	for field in ["pipeline","side","decoder","inputActualSha256"]:
		var changed=key.duplicate(true)
		if field=="side":changed[field]=16
		elif field=="decoder":changed.decoder.hash="changed-decoder"
		elif field=="inputActualSha256":changed.inputActualSha256.baseColor="changed-input"
		else:changed[field]="changed"
		verify(Cache.load_entry(root,changed).is_empty(),"key invalidation "+field)
	var filename=root.path_join("asset-a".sha256_text()+".pbrcache");var raw=FileAccess.get_file_as_bytes(filename);var broken=raw.duplicate();broken[broken.size()-1]^=1;write_file(filename,broken)
	verify(Cache.load_entry(root,key).is_empty(),"payload corruption safely misses")
	verify(Cache.store_entry(root,key,prepared)=="written","corrupt entry rebuilt by atomic replace")
	var length=raw.decode_u32(8);var header=JSON.parse_string(raw.slice(16,16+length).get_string_from_utf8());header.heightFallback=true
	var encoded=JSON.stringify(header,"",true,true).to_utf8_buffer();var tampered=PackedByteArray();tampered.resize(16);tampered.fill(0)
	for i in 8:tampered[i]=raw[i]
	tampered.encode_u32(8,encoded.size());tampered.encode_u32(12,raw.decode_u32(12));tampered.append_array(encoded);tampered.append_array(raw.slice(16+length));write_file(filename,tampered)
	verify(Cache.load_entry(root,key).is_empty(),"fallback metadata is bound to payload and key")
	verify(Cache.store_entry(root,key,prepared)=="written","metadata corruption rebuilt")
	var budget_key=Cache.key("budget-asset","pipeline-a",8,key.inputActualSha256)
	verify(Cache.store_entry(root,budget_key,prepared,{"maxBytes":64})=="byte-budget","byte cap stops writes without image changes")
	DirAccess.make_dir_absolute(root.path_join("write.lock"))
	verify(Cache.store_entry(root,budget_key,prepared)=="writer-busy-or-stale-lock","concurrent/stale writer lock fails closed")
	DirAccess.remove_absolute(root.path_join("write.lock"))
	for i in 31:write_file(root.path_join(("existing-"+str(i)).sha256_text()+".pbrcache"),PackedByteArray([0]))
	verify(Cache.store_entry(root,budget_key,prepared)=="entry-count-budget","32 known entries stop growth; no eviction/deletion")
	verify(Cache.load_entry(root,key).ah.get_data()==ah.get_data(),"budget refusal leaves prior valid entry usable")
	verify(prepared.ah.get_data()==ah.get_data() and prepared.mean==Color(.17,.23,.34,1),"cache operations never mutate prepared inputs")
	print(JSON.stringify({"test":"surface-pbr-cache","checks":checks,"failures":failures,"result":"PASS" if failures==0 else "FAIL","scope":"small authored image bytes/mips/means, invalidation/corruption/atomic replace/budgets/lock; no GPU"}));quit(0 if failures==0 else 1)
