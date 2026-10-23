extends SceneTree
const P=preload("res://adapters/surface_water_projection.gd")
var failures: Array=[]
func check(ok: bool, label: String):
	if not ok:failures.append(label)
func _initialize():
	var classes=Image.create(2,2,false,Image.FORMAT_RF);classes.fill(Color(2,0,0))
	var coverage=Image.create(2,2,false,Image.FORMAT_RF);coverage.fill(Color(1,0,0))
	var geometry={"vertices":PackedVector3Array([Vector3(0,-20,0),Vector3(10,-20,10),Vector3(10,-20,0)]),"anchor":{"x":1000000000.,"y":0.,"z":1000000000.},"classImage":classes,"classOrigin":{"x":1000000000.,"z":1000000000.},"classSpacingM":20.,"coverageImage":coverage,"coverageOrigin":{"x":1000000000.,"z":1000000000.},"coverageSpacingM":20.}
	var focus={"x":1000000000.,"y":1000000000.};var colors={"lake":Vector3(.1,.2,.8)};var options={"sourceKey":"source-id:source-version","resolution":256}
	var key=P.cache_key(geometry,focus,40.,colors,options)
	classes.set_pixel(0,0,Color(3,0,0));check(key!=P.cache_key(geometry,focus,40.,colors,options),"class ID bytes invalidate cached texture");classes.set_pixel(0,0,Color(2,0,0))
	coverage.set_pixel(0,0,Color(0,0,0));check(key!=P.cache_key(geometry,focus,40.,colors,options),"coverage bytes invalidate cached texture");coverage.set_pixel(0,0,Color(1,0,0))
	var shifted=focus.duplicate();shifted.x+=.01;check(key!=P.cache_key(geometry,shifted,40.,colors,options),"double canonical focus invalidates cache before Float32 rebase")
	var changed=options.duplicate();changed.sourceKey="different-generation";check(key!=P.cache_key(geometry,focus,40.,colors,changed),"source lineage invalidates cache")
	changed=options.duplicate();changed.msaa=4;check(key!=P.cache_key(geometry,focus,40.,colors,changed),"sampling policy invalidates cache")
	check(key==P.cache_key(geometry,focus,40.,colors,options),"restored exact inputs reproduce cache key")
	print(JSON.stringify({"CPUOnly":true,"failures":failures}));quit(0 if failures.is_empty() else 1)
