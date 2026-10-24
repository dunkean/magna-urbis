extends SceneTree
const Full=preload("res://adapters/surface_tree_oblique.gd")
const Views=preload("res://adapters/surface_tree_oblique_library.gd")
const Visibility=preload("res://adapters/surface_visibility_plan.gd")
var checks=0
var failures=0
func check(value:bool,message:String)->void:
 checks+=1
 if not value:failures+=1;push_error(message)
func _initialize()->void:call_deferred("run")
func run()->void:
 var production=load("res://scene/main.gd")
 check(production!=null,"production main compiles")
 var projection=Projection.create_orthogonal(-2,2,-2,2,.1,100)
 var camera={"position":{"x":1e9,"y":100.0,"z":-1e9+20},"basis":Basis.IDENTITY,"projection":projection,"viewport":Vector2(2048,2048),"near":.1,"far":100.0}
 var data={"available":true,"count":3,"values":PackedFloat64Array([1e9,100,-1e9,12,.73,.12,1e9+100,100,-1e9,12,.7,.2,1e9+1,100,-1e9,8,.2,.3]),"radii":PackedFloat64Array([5.04,5.04,3.36]),"ids":PackedStringArray(["one","offscreen","three"]),"sourceInventorySha256":"unchanged-source"}
 var origin={"x":1e9,"y":97.0,"z":-1e9}
 var support={"horizontalRadiusH":.8566,"minYH":-.0775,"maxYH":1.0777}
 var high=AABB(Vector3(-1,0,-1),Vector3(2,1,2))
 var original=var_to_bytes(data)
 var result=Full.prepare(data,camera,origin,high,134295,14,support)
 check(result.available,"complete source accepted")
 check(result.count==3 and result.high.size()+result.middleCount==3,"all IDs present, no rank dropping")
 check(result.highTriangles<=2000000,"high triangle budget")
 check(result.middleCount>=1,"offscreen IDs retained as cards")
 check(var_to_bytes(data)==original,"source values unchanged")
 var ids=[]
 for c in result.high:ids.append(c.stableId);check(c.y==100,"actual rootY retained")
 check(not ids.has("offscreen"),"truly offscreen support not high")
 for i in int(result.middleCount):check(result.middleBuffer[i*20+7]==3,"card root pivot actualY minus origin")
 var none=Full.prepare(data,camera,origin,high,134295,0,support)
 check(none.available and none.high.is_empty() and none.middleCount==3,"budget never culls IDs")
 check(none.middleBuffer.size()==60,"one80byte row per retained ID")
 check(absf(none.middleBuffer[3])<.000001 and none.middleBuffer[11]==0,"double rebase before float32")
 var moved=data.duplicate(true);var moved_camera=camera.duplicate(true);var moved_origin=origin.duplicate()
 moved_camera.position.x-=2e9;moved_camera.position.z+=2e9;moved_origin.x-=2e9;moved_origin.z+=2e9
 for i in int(moved.count):moved.values[i*6]-=2e9;moved.values[i*6+2]+=2e9
 var shifted=Full.prepare(moved,moved_camera,moved_origin,high,134295,0,support)
 check(shifted.middleBuffer.to_byte_array()==none.middleBuffer.to_byte_array(),"rebases plus/minus1e9 preserve buffer bytes")
 check(not Full.prepare(data,camera,origin,high,134295).available,"missing measured support refused")
 check(Views.persistent_bytes()==184549200,"all33views+mips RGBAH/RGBA8/RGH counted")
 check(Full.feature_bytes(100000).obliqueFullColorBuffersCopiesBytes==64000000,"full100k two generations/fourcopies bounded")
 check(not Visibility.feature_ledger(Full.feature_bytes(100001)).valid,"oversized inventory budget fails closed")
 var world={"id":"physical-source"}
 var plan={"available":true,"_world":world,"camera":camera,"residentBounds":{"minX":0,"minZ":0,"maxX":100,"maxZ":100},"visibleBounds":{"minX":5,"minZ":5,"maxX":95,"maxZ":95}}
 check(Full.guard(plan,world,camera,result,true).weight==1,"complete current snapshot enables whole view")
 check(Full.guard(plan,world,camera,result,false).weight==0,"wrong source binding falls to meso")
 check(Full.guard(plan,{"id":"other"},camera,result,true).weight==0,"different physical dictionary rejected")
 var changed=camera.duplicate(true);changed.position.x+=1
 check(Full.guard(plan,world,changed,result,true).weight==0,"camera motion immediately caps old snapshot")
 var bad=plan.duplicate(false);bad.residentBounds={"minX":0,"minZ":0,"maxX":90,"maxZ":90}
 check(Full.guard(bad,world,camera,result,true).weight==0,"resident undercoverage refused")
 print(JSON.stringify({"test":"full-oblique-source-cpu","checks":checks,"failures":failures,"scope":"pure source/buffer/budget/source-camera guards, no GPU alpha or full-world visual qualification"}))
 quit(0 if failures==0 else 1)
