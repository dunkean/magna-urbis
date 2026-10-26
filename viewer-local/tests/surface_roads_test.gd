extends SceneTree
const R=preload("res://adapters/surface_roads.gd")
var failures: Array=[]
func check(ok: bool,label: String):
	if not ok: failures.append(label)
func _initialize():
	var base=1000000000.001
	var origin={"x":base,"y":20.0,"z":base}
	var world={"_heightRange":Vector2(10,110),"terrain":{"spacingM":0.47}}
	var road={"id":"native-road","sourceIndex":42,"surface":"cobble","class":"street","profile":{"edited":true},"widthM":10.0,"points":[[base,base],[base+1000.0,base]]}
	var packet={"urban":{"roads":[road]}}
	var snapshot=JSON.stringify(packet)
	var records=R.prepareRoadProjectors(packet,world,origin,{"x":base+500,"y":base},1024.0)
	check(records.size()==16,"1km source interval produces sixteen bounded projectors")
	var total=0.0
	for record in records:
		total+=record.size.z
		check(record.size.z<=64.0 and record.size.x==10 and record.cullMask==1,"source width bounded chunks and terrain-only layer")
		check(record.sourceIndex==42 and record.id=="native-road" and record.surface=="cobble" and record.class=="street" and record.metadata.profile.edited,"source metadata retained")
		check(absf(float(record.position.x)-(float(record.sourceEndpoints[0][0])+float(record.sourceEndpoints[1][0]))*0.5+base)<0.00001,"double precision before rebasing")
		check(absf(record.yaw-PI/2)<0.000001 and record.size.y>=104,"downward decal localZ aligned with road and full height extent")
	check(absf(total-1000.0)<0.00001,"source length conserved")
	check(JSON.stringify(packet)==snapshot,"source metadata and coordinates unchanged")
	var clipped=R.prepareRoadProjectors(packet,world,origin,{"x":base+500,"y":base},16.0)
	check(clipped.size()<=2 and not clipped.is_empty(),"cross-window source road clipped rather than dropped")
	var many=[]
	for i in 600: many.append({"id":str(i),"widthM":1.0,"points":[[base+float(600-i),base],[base+float(600-i),base+1]]})
	var capped=R.prepareRoadProjectors({"_roadProjectorLimit":32,"urban":{"roads":many}},world,origin,{"x":base,"y":base},1024.0)
	check(capped.size()==32 and capped[0].id=="599" and capped[31].id=="568","cap selects nearest geometry despite source iteration order")
	print(JSON.stringify({"failures":failures,"kilometreProjectors":records.size(),"clippedProjectors":clipped.size(),"nearestCap":capped.size()}))
	quit(0 if failures.is_empty() else 1)
