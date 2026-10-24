extends SceneTree
const P=preload("res://adapters/surface_water_projection.gd")
var failures:Array=[]
var checks=0
func check(ok:bool,label:String):
	checks+=1
	if not ok:failures.append(label)
func _initialize():
	var image=Image.create(256,4,false,Image.FORMAT_RGBA8)
	var bytes=image.get_data()
	for i in 1024:
		bytes[i*4]=i%256;bytes[i*4+1]=255-i%256;bytes[i*4+2]=137;bytes[i*4+3]=i%256
	image.set_data(256,4,false,Image.FORMAT_RGBA8,bytes);image.generate_mipmaps()
	var original=image.get_data();var result=P.black_albedo_image(image)
	check(not result.has("error"),"valid RGBA8 accepted")
	if result.has("image"):
		var black:PackedByteArray=result.image.get_data()
		check(black.size()==original.size(),"mip bytes retained")
		for i in black.size()/4:
			check(black[i*4]==0 and black[i*4+1]==0 and black[i*4+2]==0,"black RGB "+str(i))
			check(black[i*4+3]==original[i*4+3],"exact alpha "+str(i))
	check(image.get_data()==original,"original all RGBA bytes unchanged")
	check(P.black_albedo_image(image,1).has("error"),"budget rejected")
	check(P.black_albedo_image(Image.create(2,2,false,Image.FORMAT_RGB8)).has("error"),"non RGBA8 rejected")
	check(P.lighting_plan().mode=="terrain","legacy default")
	check(P.lighting_plan({"mapLighting":"flat-map","waterMode":"source-levels"}).has("error"),"physical mode rejected")
	check(P.lighting_plan({"mapLighting":42}).has("error"),"invalid type rejected")
	var texture=ImageTexture.create_from_image(image)
	var projection={"texture":texture,"position":Vector3.ZERO,"size":Vector3(20,100,20)}
	var legacy=P.create_decal(projection);var explicit=P.create_decal(projection,{}, {"mapLighting":"terrain"})
	check(legacy.texture_albedo==texture and explicit.texture_albedo==texture and legacy.texture_emission==null,"legacy textures unchanged")
	var flat=P.create_decal(projection,{}, {"mapLighting":"flat-map"});var repeated=P.create_decal(projection,{}, {"mapLighting":"flat-map"})
	check(flat.texture_emission==texture and flat.texture_albedo==repeated.texture_albedo,"original emission and cached derived albedo")
	check(flat.emission_energy==1. and flat.albedo_mix==1. and flat.modulate==Color.WHITE and flat.cull_mask==1,"flat decal parameters")
	check(image.get_data()==original,"source unchanged after cached decals")
	legacy.free();explicit.free();flat.free();repeated.free()
	var report={"checks":checks,"failures":failures,"scope":"CPU image/mips/cache/decal properties; no GPU visual claim","alphaValues":256,"sourceBytesUnchanged":image.get_data()==original}
	var args=OS.get_cmdline_user_args()
	if args.size()>0:
		var file=FileAccess.open(args[0],FileAccess.WRITE)
		if file==null:push_error("CPU report path unavailable");quit(2);return
		file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
