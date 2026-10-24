extends SceneTree
const Vegetation=preload("res://adapters/surface_vegetation_library.gd")
const Prepare=preload("res://adapters/surface_scene_prepare.gd")
var checks:=0
func mip_pixel(image:Image)->Color:
	var offset=image.get_mipmap_offset(1)
	return Image.create_from_data(1,1,false,Image.FORMAT_RGBAH,image.get_data().slice(offset,offset+8)).get_pixel(0,0)
class TestViewer:
	extends "res://scene/main.gd"
	func _ready()->void:pass
func check(value:bool,message:String)->void:
	checks+=1
	if not value:push_error(message);quit(1);assert(value,message)
func _initialize()->void:
	call_deferred("_run")
func _run()->void:
	var args=OS.get_cmdline_user_args()
	check(args.size()==1,"pass prepared resolved.json path")
	var library=Vegetation.new();check(library.load_manifest(args[0]),library.last_error)
	check(library.variants.size()==3,"three real variants")
	for i in 3:
		var v:Dictionary=library.variants[i]
		check(v.triangleCount==[28,40,79][i],"real triangle counts")
		check(v.mesh.get_aabb().position.y==-.5 and absf(v.mesh.get_aabb().end.y-.5)<.000001,"source root normalization")
		var arrays=v.mesh.surface_get_arrays(0)
		check(arrays[Mesh.ARRAY_TANGENT].size()==arrays[Mesh.ARRAY_VERTEX].size()*4,"tangents present")
	var candidates=[]
	for i in 7:candidates.append({"stableId":"grass-"+str(i),"family":"grass","variant":i,"x":1000000000.0+i,"y":5.0,"z":-1000000000.0,"size":.2+i*.01,"orientation":i*.3,"rank":i*.1,"_linearAlbedo":[.05,.25,.03]})
	var snapshot=JSON.stringify(candidates);var origin={"x":1000000000.0,"y":0.0,"z":-1000000000.0}
	var buffer=Prepare.population_buffer(candidates,"grass",origin);var original=buffer.duplicate()
	var groups=Vegetation.partition(candidates,buffer,3);var count:=0
	for group in groups:
		for i in group.ids.size():
			var index=int(str(group.ids[i]).trim_prefix("grass-"));count+=1
			check(group.variant==index%3,"stable source variant")
			check(group.buffer.slice(i*20,i*20+20)==buffer.slice(index*20,index*20+20),"all twenty original transform/color/custom values exact")
	check(count==7 and buffer==original and JSON.stringify(candidates)==snapshot,"inventory/buffers unchanged")
	check(library.version.available and not library.version.digest.is_empty(),"asset provenance")
	var second=Vegetation.new();check(second.load_manifest(args[0]),second.last_error)
	check(second.version.digest==library.version.digest,"repeat load same digest")
	var mat=library.material();check(mat.shader.get_shader_uniform_list().size()>0,"shader parser, not GPU compilation")
	for role in ["baseColor","normal","arm"]:check(mat.get_shader_parameter(role+"_texture")!=null,"all packed maps bound")
	var probe_maps={}
	for role in ["baseColor","normal","arm","alpha"]:probe_maps[role]=Image.create(2,2,false,Image.FORMAT_RGBAF)
	probe_maps.baseColor.fill(Color(.5,.5,.5,1));probe_maps.alpha.fill(Color(1,1,1,1));probe_maps.normal.fill(Color(.5,.5,1,1));probe_maps.arm.fill(Color(1,.7,0,1))
	probe_maps.baseColor.set_pixel(0,0,Color(1,0,0,1));probe_maps.alpha.set_pixel(0,0,Color(0,0,0,1))
	var packed=Vegetation.prepare_maps(probe_maps);var expected=Color(.5,.5,.5).srgb_to_linear().r
	var last=mip_pixel(packed.images.baseColor)
	check(absf(last.a-.75)<.001 and absf(last.r/last.a-expected)<.001,"mip colour linear and alpha weighted, invisible red excluded")
	var response=mip_pixel(packed.images.arm)
	check(absf(response.g/response.a-.7)<.001,"roughness coverage aware")
	check(absf(packed.meanLinear.x-expected)<.000001,"full-source linear mean")
	var viewer=TestViewer.new();viewer.vegetation_library=library
	root.add_child(viewer);viewer.set_process(false);viewer.add_child(viewer.camera);viewer.add_child(viewer.objects)
	viewer.rendered_presentation_mode="aerial";viewer._build_populations({"candidateCount":7,"selectedCount":7,"families":{"grass":candidates},"buffers":{"grass":buffer}})
	check(viewer.objects.get_child_count()==3,"aerial uses three real mesh batches")
	var submitted:=0
	for child in viewer.objects.get_children():
		submitted+=child.multimesh.instance_count
		check(child.get_meta("populationFamily")=="grass" and child.get_meta("surfaceLayer")=="lowCover" and child.layers==2,"layer and family preserved")
	check(submitted==7,"no candidate dropped")
	viewer.set_layer_visibility(true,false,true)
	for child in viewer.objects.get_children():check(not child.visible,"low-cover toggle removes real tufts")
	viewer.set_layer_visibility(true,true,false)
	for child in viewer.objects.get_children():check(child.visible,"tree toggle does not remove grass")
	check(buffer==original and JSON.stringify(candidates)==snapshot,"layer changes do not mutate inventory")
	viewer.objects.free();viewer.camera.free();viewer.sun.free();viewer.hud.free();viewer.live_request.free();viewer.free()
	var carto=TestViewer.new();carto.vegetation_library=library;carto.rendered_presentation_mode="cartographic"
	carto._build_populations({"candidateCount":7,"selectedCount":7,"families":{"grass":candidates},"buffers":{"grass":buffer}})
	check(carto.objects.get_child_count()==1 and carto.objects.get_child(0).multimesh.mesh is PrismMesh,"cartographic glyph unchanged")
	carto.objects.free();carto.camera.free();carto.sun.free();carto.hud.free();carto.live_request.free();carto.free()
	var malformed={"positions":[0,0,0],"normals":[],"uv":[],"tangents":[],"indices":[0,1,2]}
	check(not Vegetation.validate_variant(malformed),"malformed prepared arrays rejected")
	var invalid=JSON.parse_string(FileAccess.get_file_as_string(args[0]));invalid.assets[0].product.sha256="edited"
	invalid.assets[0].product.path=args[0].get_base_dir().path_join(invalid.assets[0].product.path)
	var invalid_path="user://edited-vegetation.json";var edited=FileAccess.open(invalid_path,FileAccess.WRITE);edited.store_string(JSON.stringify(invalid));edited.close()
	var rejected=Vegetation.new();check(not rejected.load_manifest(invalid_path) and rejected.last_error=="prepared mesh hash mismatch","edited prepared product rejected")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(invalid_path))
	print(JSON.stringify({"test":"surface-vegetation","checks":checks,"result":"PASS","assetDigest":library.version.digest,"triangles":[28,40,79],"scope":"headless CPU ingestion/ArrayMesh/buffer integration/shader parse; no rendered artistic or GPU claim"}))
	quit()
