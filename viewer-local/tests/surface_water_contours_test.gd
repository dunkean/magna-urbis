extends SceneTree
const C=preload("res://adapters/surface_water_contours.gd")
const P=preload("res://adapters/surface_water_projection.gd")
var failures:Array=[]
func check(ok:bool,message:String):
	if not ok:failures.append(message)
func _initialize():
	var ring=PackedFloat64Array([1000000000.25,1000000000.5,1000000001.25,1000000000.5,1000000001.25,1000000002.5,1000000000.25,1000000000.5])
	var rings=[ring];var geometry={"sourceWaterContours":rings,"sourceContourComplete":true,"sourceContourBudgetLimited":false,"sourceContourPointCount":4,"sourceContourRingCount":1,"sourceContourSha256":C.digest(rings)}
	var info=C.info(geometry);check(not info.has("error") and info.estimatedBytes<=info.budgetBytes,"complete bounded packed source contours")
	var pixels=C.pixel_points(ring,{"x":1000000020.,"y":1000000020.},40.,400)
	check(pixels.size()==3 and pixels[0]==Vector2(2.5,5.) and pixels[1].x-pixels[0].x==10.,"double rebase before Vector2 preserves one metre banks at world1e9")
	check(ring[0]==1000000000.25,"projection does not modify source ring")
	var bad=geometry.duplicate(false);bad.sourceContourComplete=false;check(C.info(bad).has("error"),"partial contours never qualify")
	bad=geometry.duplicate(false);bad.sourceWaterContours=[PackedVector2Array([Vector2.ZERO,Vector2.ONE,Vector2.RIGHT])];check(C.info(bad).has("error"),"reject FP32 world vectors")
	var changed=ring.duplicate();changed[0]+=.125;bad=geometry.duplicate(false);bad.sourceWaterContours=[changed];check(C.info(bad).has("error"),"actual coordinate bytes must match declared contour hash")
	var key=P.cache_key(geometry,{"x":1000000020.,"y":1000000020.},40.,{},{"sourceKey":"same-source"})
	check(key!=P.cache_key(bad,{"x":1000000020.,"y":1000000020.},40.,{},{"sourceKey":"same-source"}),"actual ring bytes invalidate projection cache")
	var too_many:Array=[];too_many.resize(C.MAX_RINGS+1);bad=geometry.duplicate(false);bad.sourceWaterContours=too_many;check(C.info(bad).has("error"),"reject node budget before creating Line2D nodes")
	var large=PackedFloat64Array();large.resize(524290);bad=geometry.duplicate(false);bad.sourceWaterContours=[large];check(C.info(bad).has("error"),"reject render workspace estimate before GPU allocation")
	print(JSON.stringify({"CPUOnly":true,"failures":failures,"info":info,"pixels":str(pixels)}));quit(0 if failures.is_empty() else 1)
