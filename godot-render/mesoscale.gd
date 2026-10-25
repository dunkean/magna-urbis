extends RefCounted
## CPU counterpart of terrain_detail.gdshaderinc, including amplitude/LOD gradients.
const MAX_HEIGHT=3.0
const SCALES=[64.0,27.0,9.5,3.75]
const WEIGHTS=[.68,.32,.72,.28]
const SALTS=[17,109,271,577]
var image:Image
var seed:=1
var texture:ImageTexture
var generator_sha:=""
func digest(data:PackedByteArray)->String:
	var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(data);return h.finish().hex_encode()
func load_context(directory:String,n:int,expected:Dictionary={})->bool:
	image=null;texture=null;seed=1
	var path=directory.path_join("meso-context.json")
	if not FileAccess.file_exists(path):return false
	var meta=JSON.parse_string(FileAccess.get_file_as_string(path))
	if not meta is Dictionary or meta.get("n")!=n or meta.get("format")!="RGBA32F":return false
	var sources=meta.get("sources",{})
	if not sources is Dictionary:return false
	if generator_sha.is_empty():generator_sha=digest(FileAccess.get_file_as_bytes("res://tools/prepare_mesoscale.py"))
	if sources.get("generator")!=generator_sha:return false
	for key in expected:
		if sources.get(key)!=expected[key]:return false
	for pair in [["placement","forest-placement.png"],["river","surface-river-footprint.png"]]:
		if sources.get(pair[0])!=digest(FileAccess.get_file_as_bytes(directory.path_join(pair[1]))):return false
	var data=FileAccess.get_file_as_bytes(directory.path_join("meso-context.rgba32f"))
	if data.size()!=n*n*16 or digest(data)!=meta.get("sha256"):return false
	image=Image.create_from_data(n,n,false,Image.FORMAT_RGBAF,data)
	texture=ImageTexture.create_from_image(image);return true
func hash_bits(x:int,z:int,salt:int)->int:
	var h=((x*374761393)&0x7fffffff)^((z*668265263)&0x7fffffff)^(salt&0x7fffffff)
	h=((h^(h>>13))*1274126177)&0x7fffffff;h=(h^(h>>16))&0x7fffffff
	return h
func gradient_at(x:int,z:int,salt:int)->Vector2:
	var h=hash_bits(x,z,salt)
	return Vector2(float(h&65535)/32767.5-1.0,float((h>>15)&65535)/32767.5-1.0).normalized()
func noise_at(world:Vector2,scale:float,salt:int)->Vector3:
	var px=float(world.x)/scale;var pz=float(world.y)/scale;var x=int(floor(px));var z=int(floor(pz))
	var tx=px-x;var tz=pz-z
	var ux=tx*tx*tx*(tx*(tx*6-15)+10);var uz=tz*tz*tz*(tz*(tz*6-15)+10)
	var dx=30*tx*tx*(tx-1)*(tx-1)/scale;var dz=30*tz*tz*(tz-1)*(tz-1)/scale
	var ga=gradient_at(x,z,salt);var gb=gradient_at(x+1,z,salt);var gc=gradient_at(x,z+1,salt);var gd=gradient_at(x+1,z+1,salt)
	var t=Vector2(tx,tz);var a=ga.dot(t);var b=gb.dot(t-Vector2(1,0));var c=gc.dot(t-Vector2(0,1));var d=gd.dot(t-Vector2.ONE)
	var gradient=ga.lerp(gb,ux).lerp(gc.lerp(gd,ux),uz)/scale+Vector2(lerpf(b-a,d-c,uz)*dx,lerpf(c-a,d-b,ux)*dz)
	return Vector3(lerpf(lerpf(a,b,ux),lerpf(c,d,ux),uz),gradient.x,gradient.y)*1.4142135
func context_at(world:Vector2)->Array[Vector4]:
	var n=image.get_width();var p=world/40000.0*n-Vector2(.5,.5);var base=Vector2i(p.floor());var t=p-p.floor();var last=Vector2i(n-1,n-1)
	var samples:Array[Vector4]=[]
	for offset in [Vector2i.ZERO,Vector2i(1,0),Vector2i(0,1),Vector2i.ONE]:
		var c=image.get_pixelv((base+offset).clamp(Vector2i.ZERO,last));samples.append(Vector4(c.r,c.g,c.b,c.a))
	var a=samples[0];var b=samples[1];var c=samples[2];var d=samples[3]
	return [a.lerp(b,t.x).lerp(c.lerp(d,t.x),t.y),(b-a).lerp(d-c,t.y)*(n/40000.0),(c-a).lerp(d-b,t.x)*(n/40000.0)]
func band_filter(scale:float,spacing:float)->Vector2:
	var lo=scale/6.0;var hi=scale/3.0;var t=clampf((spacing-lo)/(hi-lo),0,1)
	return Vector2(1-t*t*(3-2*t),-6*t*(1-t)/(hi-lo))
func sample_field(world:Vector2,density:Vector4=Vector4.ZERO)->Vector3:
	if image==null:return Vector3.ZERO
	if Vector2(density.x,density.y).length()>=64.0/3:return Vector3.ZERO
	var ctx=context_at(world)
	if ctx[0].x+ctx[0].y<=0:return Vector3.ZERO
	var spacing=Vector2(density.x,density.y).length()
	var ds=Vector2(density.x*density.z,density.y*density.w)/maxf(spacing,.00001)
	var result=Vector3.ZERO
	for k in 4:
		var channel=0 if k<2 else 1;var filter=band_filter(SCALES[k],spacing)
		if filter.x<=0:continue
		var noise=noise_at(world,SCALES[k],seed+SALTS[k]);var amplitude=ctx[0][channel]*WEIGHTS[k]
		var gradient=Vector2(ctx[1][channel],ctx[2][channel])*WEIGHTS[k]
		var slope=filter.x*(amplitude*Vector2(noise.y,noise.z)+noise.x*gradient)+amplitude*noise.x*filter.y*ds
		result+=Vector3(amplitude*noise.x*filter.x,slope.x,slope.y)
	return result
