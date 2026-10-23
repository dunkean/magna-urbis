extends SceneTree
const S=preload("res://adapters/surface_hydrology_sweep.gd")
const C=preload("res://adapters/surface_city_map.gd")
var failures: Array=[]
func check(ok: bool,label: String):
	if not ok:failures.append(label)
func ring(points: Array,offset: float=0.0)->Array:
	var result=[]
	for p in points:result.append({"x":float(p[0])+offset,"y":float(p[1])+offset})
	return result
func _initialize():
	var offset=1000000000.001
	var origin={"x":offset,"y":0.0,"z":offset}
	var outer=ring([[0,0],[10,0],[10,10],[0,10]],offset)
	var hole=ring([[3,3],[7,3],[7,7],[3,7]],offset)
	var separate=ring([[12,0],[14,0],[14,2],[12,2]],offset)
	var snapshot=hash([outer,hole,separate])
	for rings in [[outer,hole,separate],[hole,separate,outer]]:
		var result=S.triangulate(rings,origin,10000,10000)
		var reference=C.triangulate([{"outer":rings[0],"holes":rings.slice(1)}],origin,0.0,10000)
		check(not result.invalid and not result.budgetLimited,"valid evenodd result")
		check(absf(result.areaM2-88.0)<0.000001 and absf(result.areaM2-reference.areaM2)<0.000001,"sweep equals original scan with hole and disjoint contour in arbitrary order")
		for i in range(0,result.vertices.size(),3):check((result.vertices[i+1]-result.vertices[i]).cross(result.vertices[i+2]-result.vertices[i]).y>0.0,"source RH up winding")
	var simple=S.triangulate([outer],origin,1000,1000)
	check(simple.get("nativeSimpleRing",false) and absf(simple.areaM2-100.0)<0.000001,"one-ring native triangulation after large-coordinate rebase")
	check(simple.floatAreaErrorM2<=simple.floatAreaToleranceM2,"explicit float-area tolerance validated")
	var narrow=ring([[0,0],[10,0],[10,0.01],[0,0.01]],offset)
	var thin=S.triangulate([narrow],origin,1000,1000)
	check(not thin.invalid and absf(thin.areaM2-0.1)<0.00001,"narrow native contour preserved")
	var inner=ring([[4,4],[6,4],[6,6],[4,6]],offset)
	var nested=S.triangulate([outer,hole,inner],origin,1000,1000)
	check(absf(nested.areaM2-88.0)<0.000001,"nested island adds back evenodd area")
	check(S.triangulate([outer,hole],origin,3,10000).budgetLimited,"vertex budget exact bound")
	check(S.triangulate([outer,hole],origin,10000,1).get("workBudgetLimited",false),"active-edge work budget exact bound")
	check(hash([outer,hole,separate])==snapshot,"source rings unchanged")
	print(JSON.stringify({"failures":failures,"simpleVertices":simple.vertices.size(),"simpleAreaErrorM2":simple.floatAreaErrorM2,"nestedAreaM2":nested.areaM2}))
	quit(0 if failures.is_empty() else 1)
