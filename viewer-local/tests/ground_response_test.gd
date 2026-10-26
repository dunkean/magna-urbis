extends SceneTree
const Ground=preload("res://adapters/surface_ground_response.gd")
const Layers=preload("res://adapters/surface_layers.gd")
const Data=preload("res://adapters/surface_data.gd")
const Presentation=preload("res://adapters/surface_presentation.gd")
class TerrainParameters extends RefCounted:
	var values:Dictionary={}
	func set_shader_param(name:String,value)->void:values[name]=value
var failures:Array=[]
var checks=0
var maximum_mean_error=0.0
var maximum_blend_error=0.0
func smooth(a:float,b:float,value:float)->float:
	var t=clampf((value-a)/(b-a),0.0,1.0);return t*t*(3.0-2.0*t)
func reference_sample(world:Dictionary,prepared:Dictionary,x:float,z:float)->Dictionary:
	var context=Data.context(world);var grid:Dictionary=context.grid;var fields:Dictionary=context.fields;var bindings:Dictionary=prepared.bindings
	var gx=clampf((x-float(grid.originX))/float(grid.spacingM),0.0,float(grid.width)-1.0);var gz=clampf((z-float(grid.originZ))/float(grid.spacingM),0.0,float(grid.height)-1.0)
	var ix=mini(int(grid.width)-2,floori(gx));var iz=mini(int(grid.height)-2,floori(gz));var fx=gx-ix;var fz=gz-iz
	var nearest=roundi(gz)*int(grid.width)+roundi(gx)
	if gx==float(roundi(gx)) and gz==float(roundi(gz)):
		var rgb=Layers._linear(int(fields.groundMaterialMeanColor[nearest]))
		return {"primary":fields.groundMaterial[nearest],"secondary":fields.groundMaterialSecondary[nearest],"blend":fields.groundMaterialBlend[nearest],"mean":[rgb.r,rgb.g,rgb.b]}
	var spatial=[(1.0-fx)*(1.0-fz),fx*(1.0-fz),(1.0-fx)*fz,fx*fz];var soil=[0.0,0.0,0.0,0.0];var processes=[0.0,0.0,0.0,0.0];var aridity=0.0
	for c in 4:
		var px=ix+c%2;var pz=iz+c/2;var s:Color=bindings.ground_response_soil.get_pixel(px,pz);var p:Color=bindings.ground_response_processes.get_pixel(px,pz)
		var a=[s.r,s.g,s.b,s.a];var b=[p.r,p.g,p.b,p.a]
		for channel in 4:soil[channel]+=a[channel]*spatial[c];processes[channel]+=b[channel]*spatial[c]
		aridity+=bindings.ground_response_codes.get_pixel(px,pz).r*spatial[c]
	var codes:Color=bindings.ground_response_codes.get_pixel(roundi(gx),roundi(gz));var ids1:Vector4=bindings.ground_response_recipe_ids1;var ids0:Vector4=bindings.ground_response_recipe_ids0
	if codes.b<0:
		var id=int(ids1.w);var role:int=bindings.ground_response_color_roles[id];var color=world.materials[id].colorLinear
		if role!=0:
			var vector:Vector4=bindings.ground_response_unit_colors[int(codes.a if role==2 else -codes.b-1.0)];color=[vector.x,vector.y,vector.z]
		return {"primary":id,"secondary":id,"blend":0.0,"mean":color}
	var rock=clampf((soil[0]-.08)/.75,0,1);var sum=processes.reduce(func(v,a):return v+a,0.0);var scale=maxf(1.0,sum);var rest=(1.0-rock)*(1.0-minf(1.0,sum));var dry=clampf((.65-aridity)/.4,0,1)
	var humus=smooth(.72,.88,soil[3])*(1.0-smooth(.08,.16,soil[1]))*smooth(.02,.16,soil[2]);var amount=rest*(1.0-dry)
	var ids=[int(codes.g),int(ids1.x),int(ids1.y),int(ids1.z),int(ids0.x),int(ids0.y),int(ids0.z),int(ids0.w)]
	var amounts=[rock,amount*(1.0-humus),amount*humus,rest*dry]
	for value in processes:amounts.append(value/scale*(1.0-rock))
	var total=amounts.reduce(func(v,a):return v+a,0.0);var mean=[0.0,0.0,0.0];var combined={}
	for i in 8:
		var id:int=ids[i];var weight:float=amounts[i];var role:int=bindings.ground_response_color_roles[id];var color=world.materials[id].colorLinear
		if role!=0:
			var vector:Vector4=bindings.ground_response_unit_colors[int(codes.a if role==2 else codes.b)];color=[vector.x,vector.y,vector.z]
		for channel in 3:mean[channel]+=float(color[channel])*weight/total
		if weight>0:combined[id]=float(combined.get(id,0.0))+weight
	var ranked=combined.keys();ranked.sort_custom(func(a,b):return combined[a]>combined[b] if combined[a]!=combined[b] else a<b)
	var first:int=ranked[0];var second:int=ranked[1] if ranked.size()>1 else first;var secondary=float(combined[second]) if ranked.size()>1 else 0.0
	return {"primary":first,"secondary":second,"blend":secondary/(float(combined[first])+secondary),"mean":mean}
func check(value:bool,message:String):
	checks+=1
	if not value:failures.append(message)
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass authored ground-response fixture directory");quit(2);return
	var directory:String=args[0];var expected=JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("expected.json")))
	for fixture in expected.framingCases:
		var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);Ground._feed(hash,PackedByteArray([3]));Ground._length(hash,fixture.stringsUtf16Bytes.size())
		for bytes in fixture.stringsUtf16Bytes:Ground._string_bytes(hash,PackedByteArray(bytes))
		check(hash.finish().hex_encode()==fixture.sha256,"UTF16 byte framing including NUL/astral")
	var records=[]
	for name in ["canonical","refined","rebased","legacy"]:
		for format in ["json","surfacebin"]:
			var packet=Data.read_json(directory.path_join(name+"."+format));var world:Dictionary=packet.get("world",packet)
			check(not world.is_empty(),name+" "+format+" decode")
			if world.is_empty():continue
			check(Ground.validate(world),name+" "+format+" group")
			var context=Data.context(world);var result=Ground.prepare(world,context)
			check(not result.has("error"),name+" "+format+" prepare")
			check(result.get("available",false)==(name!="legacy"),name+" availability")
			if name=="legacy":continue
			var layer_result=Layers.prepare(world)
			check(layer_result.get("groundResponse",{}).get("available",false),name+" Layers standalone fallback carries response")
			check(context.groundResponse.id==expected.worlds[name].responseId,name+" TS/GD id")
			check(Ground.identity(context.groundResponse)==context.groundResponse.id,name+" hash")
			for sample in expected.worlds[name].samples:
				var actual=reference_sample(world,result,float(sample.x),float(sample.z))
				check(actual.primary==int(sample.primary) and actual.secondary==int(sample.secondary),name+" recipe ids")
				maximum_blend_error=maxf(maximum_blend_error,absf(float(actual.blend)-float(sample.blend)))
				check(absf(float(actual.blend)-float(sample.blend))<0.000002,name+" blend parity")
				for channel in 3:
					maximum_mean_error=maxf(maximum_mean_error,absf(float(actual.mean[channel])-float(sample.mean[channel])))
					check(absf(float(actual.mean[channel])-float(sample.mean[channel]))<0.000002,name+" mean parity")
			var bindings:Dictionary=result.bindings;var fields:Dictionary=context.fields;var g:Dictionary=context.groundResponse.fields;var grid:Dictionary=context.grid
			for i in [0,18,73,105,288]:
				var soil:Color=bindings.ground_response_soil.get_pixel(i%int(grid.width),i/int(grid.width));var process:Color=bindings.ground_response_processes.get_pixel(i%int(grid.width),i/int(grid.width))
				check(absf(soil.r-float(fields.stoniness[i]))<0.0000001 and absf(soil.g-float(fields.slope[i]))<0.0000001 and absf(soil.b-float(fields.organic[i]))<0.0000001 and absf(soil.a-float(g.moisturePreSaturation[i]))<0.0000001,name+" soil texture")
				check(absf(process.r-float(g.alluvial[i]))<0.0000001 and absf(process.g-float(g.gravity[i]))<0.0000001 and absf(process.b-float(g.wind[i]))<0.0000001 and absf(process.a-float(g.coastal[i]))<0.0000001,name+" process texture")
			records.append({"world":name,"format":format,"id":context.groundResponse.id,"imageBytes":result.metadata.imageBytes})
	var original=JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("canonical.json")))
	# The renderer consumes recipe ids for its separate cartographic palette.
	# Physical means remain diagnostic7/aerial evidence, never blueprint colours.
	var blueprint={"world":original,"presentation":{"mapStyle":"authored-blueprint","defaultView":"cartographic","palette":{"paper":"#214bc3","land":{"meadow":"#284dcc","marsh":"#1640b0","field":"#3455ff"}}}}
	var cartographic=TerrainParameters.new();Presentation.configure_terrain(cartographic,blueprint,"cartographic")
	var aerial=TerrainParameters.new();Presentation.configure_terrain(aerial,blueprint,"aerial")
	check(cartographic.values.presentation_mode==1 and aerial.values.presentation_mode==0,"blueprint/aerial mode binding")
	var colors:PackedVector4Array=cartographic.values.map_palette
	var prepared=Ground.prepare(original,Data.context(original))
	for point in [[112.3,215.7],[255.5,180.25],[128.0,160.0]]:
		var value=reference_sample(original,prepared,point[0],point[1]);var first:Vector4=colors[value.primary];var second:Vector4=colors[value.secondary];var mapped=first.lerp(second,value.blend)
		check(mapped.z>mapped.x and mapped.z>mapped.y,"blueprint retains blue recipe presentation instead of physical brown")
		check(value.mean!=[mapped.x,mapped.y,mapped.z],"intrinsic diagnostic mean remains independent of presentation")
	for mutation in ["partial","badtype","negative","fraction","overflow","edited","frame","source","version","role","legacy-family","null","missing"]:
		var world=original.duplicate(true)
		match mutation:
			"partial":world.groundResponse.fields.erase("gravity")
			"badtype":world.groundResponse.fields.gravity=PackedFloat64Array(world.groundResponse.fields.gravity)
			"negative":world.groundResponse.fields.gravity[0]=-1.0
			"fraction":world.groundResponse.fields.gravity[0]=1.01
			"overflow":world.groundResponse.fields.aridity[0]=1e100
			"edited":world.groundResponse.fields.aridity[0]+=0.1
			"frame":world.groundResponse.grid.originX+=1.0
			"source":world.groundResponse.source.version="different"
			"version":world.versions.groundResponse="edited"
			"role":world.groundResponse.fields.rockRecipe[0]=13
			"legacy-family":world.materials[1].erase("surfaceRole");world.materials[1].family="marine"
			"null":world.groundResponse=null
			"missing":world.erase("groundResponse")
		check(not Ground.validate(world),"reject "+mutation)
	var report={"status":"PASS" if failures.is_empty() else "FAIL","checks":checks,"failures":failures,"records":records,"maximumMeanError":maximum_mean_error,"maximumBlendError":maximum_blend_error,"scope":"Authored CPU decode/validation/texture and response-law parity; shader-language reflection is separate, GPU numerical validation remains pending"}
	print(JSON.stringify(report));quit(0 if failures.is_empty() else 1)
