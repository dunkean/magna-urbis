extends SceneTree
const S=preload("res://adapters/surface_water_symbols.gd")
const P=preload("res://adapters/surface_water_projection.gd")
var failures:Array=[]
func check(ok:bool,message:String):
	if not ok:failures.append(message)
func _initialize():
	var old=S.plan(50000.,{"resolution":2048,"msaa":2})
	check(old.widthM==50000. and old.resolution==2048 and old.msaa==2 and old.paddingM==0.,"zero mode retains original dimensions and sampling")
	var options={"resolution":2048,"symbolWidthPx":1.25,"screenMetresPerPixel":40000./2048.}
	var p=S.plan(50000.,options)
	check(not p.has("error") and p.resolution<=4096 and p.widthM/p.resolution<=p.screenMPP,"symbol bake texel no larger than screen footprint")
	check(is_equal_approx(p.paddingM,12.20703125) and p.msaa==4,"declared pixel radius and AA")
	check(p.estimatedImageBytes<=p.imageBudgetBytes,"image memory bounded")
	var d=S.diagnostics(p)
	check(d.sourceGeometryUnchanged and not d.symbolicPhysicalWidthClaim and d.symbolCoverageSeparateFromSourceArea,"symbol is not physical source area")
	for bad in [{"symbolWidthPx":-1.},{"symbolWidthPx":1.26},{"symbolWidthPx":NAN},{"symbolWidthPx":1.25},{"symbolWidthPx":1.25,"screenMetresPerPixel":1.}]:
		check(S.plan(50000.,bad).has("error"),"reject invalid or undersampled symbol plan "+str(bad))
	var geometry={"vertices":PackedVector3Array([Vector3.ZERO,Vector3.RIGHT,Vector3.FORWARD])}
	var focus={"x":20000.,"y":20000.};var colors={};var cache_options=options.duplicate();cache_options.sourceKey="physical-source-v1"
	var key=P.cache_key(geometry,focus,50000.,colors,cache_options)
	var changed=cache_options.duplicate();changed.symbolWidthPx=0.
	check(key!=P.cache_key(geometry,focus,50000.,colors,changed),"symbol width invalidates cache")
	changed=cache_options.duplicate();changed.screenMetresPerPixel=20.
	check(key!=P.cache_key(geometry,focus,50000.,colors,changed),"actual screen scale invalidates cache")
	changed=cache_options.duplicate();changed.screenScalePolicy="oblique-ground-scale-approximation"
	check(key!=P.cache_key(geometry,focus,50000.,colors,changed),"scale approximation declaration invalidates cache")
	print(JSON.stringify({"CPUOnly":true,"failures":failures,"plan":p,"symbol":d}));quit(0 if failures.is_empty() else 1)
