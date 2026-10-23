extends SceneTree
const WaterProjection=preload("res://adapters/surface_water_projection.gd")
func _initialize():call_deferred("run")
func run():
	var parent=Node3D.new();root.add_child(parent)
	var geometry={"vertices":PackedVector3Array(),"anchor":{"x":0.0,"y":0.0,"z":0.0},"authority":"authored-empty-test","sourceVectorAreaM2":0.0,"sourceVectorRequestedAreaM2":0.0,"sourceVectorMissingAreaM2":0.0,"sourceVectorCoverageComplete":true,"missingLevelTriangles":0,"budgetLimited":false,"sourceLevelBoundaryQueriesResolved":51,"sourceLevelMaximumBoundaryQueryRoundoffM":.0001220703125,"sourceLevelBoundaryPolicy":"authored-boundary-policy","sourceVectorClipBounds":{"minX":0.0,"minZ":0.0,"maxX":10.0,"maxZ":10.0}}
	var projection=await WaterProjection.bake(parent,geometry,{"x":0.0,"y":0.0,"z":0.0},{"x":0.0,"y":0.0},10.0,{}, {"sourceKey":"authored-empty-source"})
	var diagnostics:Dictionary=projection.get("diagnostics",{})
	assert(WaterProjection._sha(PackedByteArray())=="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
	var passed=not projection.has("error") and diagnostics.get("empty",false) and diagnostics.get("subpixelPolicy")=="original contour coverage only; no minimum stroke or physical-width edits" and diagnostics.get("minimumRiverStrokeApplied")==false and diagnostics.get("physicalWaterSurfaceClaimed")==false and diagnostics.get("projectionCullMask")==1 and diagnostics.get("sourceVectorCoverageComplete")==true and diagnostics.get("sourceLevelBoundaryQueriesResolved")==51 and diagnostics.get("sourceLevelMaximumBoundaryQueryRoundoffM")==.0001220703125 and diagnostics.get("sourceLevelBoundaryPolicy")=="authored-boundary-policy" and diagnostics.get("sourceVectorClipBounds")==geometry.sourceVectorClipBounds
	print(JSON.stringify({"passed":passed,"diagnostics":diagnostics,"scope":"Empty projection metadata contract only; no raster bake or GPU draw"}));quit(0 if passed else 1)
