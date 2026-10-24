class_name SurfaceTreeMask
extends RefCounted
static func address(asset:Dictionary,x:float,z:float)->Vector3:
	var gx=(x-float(asset.mask.originX))/float(asset.mask.spacing)
	var gz=(z-float(asset.mask.originZ))/float(asset.mask.spacing)
	if gx<0 or gz<0 or gx>int(asset.mask.width)-1 or gz>int(asset.mask.height)-1:return Vector3(-1,0,0)
	var ix=mini(int(asset.mask.width)-2,floori(gx));var iz=mini(int(asset.mask.height)-2,floori(gz))
	return Vector3(iz*int(asset.mask.width)+ix,gx-ix,gz-iz)
static func coverage(asset:Dictionary,location:Vector3)->float:
	if location.x<0:return 0.0
	var a:PackedByteArray=asset.maskBytes;var p=int(location.x);var width=int(asset.mask.width)
	return lerpf(lerpf(a[p],a[p+1],location.y),lerpf(a[p+width],a[p+width+1],location.y),location.z)/255.0
static func inside(asset:Dictionary,location:Vector3)->bool:return coverage(asset,location)>=.5
static func response(asset:Dictionary,key:String,location:Vector3)->Color:
	var values:PackedFloat32Array=asset[key];var p=int(location.x)*4;var stride=int(asset.mask.width)*4
	var result=Color(0,0,0,0)
	for k in 4:result[k]=lerpf(lerpf(values[p+k],values[p+4+k],location.y),lerpf(values[p+stride+k],values[p+stride+4+k],location.y),location.z)
	return result
