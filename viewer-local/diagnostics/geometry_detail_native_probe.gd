extends SceneTree
const Detail=preload("res://adapters/surface_geometry_detail.gd")
var failures=[]
func _initialize():call_deferred("run")
func check(value,label):
	if not value:failures.append(label)
func run():
	var n=81;var heights=PackedFloat32Array();heights.resize(n)
	var source={"id":"real-source-contract-probe","version":"1","sourceLOD":0,"nativeSpacingM":1.0}
	var grid={"width":9,"height":9,"originX":1000000000.0,"originZ":1000000000.0,"spacingM":1.0}
	var detail={"format":"surface-geometry-detail","version":1,"id":"geometry-detail:probe","grid":grid,"source":source,"reconstruction":"bilinear-samples","supportM":1.0,"fullSupportBounds":{"minX":1000000001.0,"minZ":1000000001.0,"maxX":1000000007.0,"maxZ":1000000007.0},"limitations":["Synthetic physical-validation probe, not production terrain"]}
	for key in ["slopeRadians","aspectRadians","rockExposurePotential","edgeConfidence","bedrockExposure","treeSupport"]:detail[key]=PackedFloat32Array();detail[key].resize(n)
	detail.normalXYZ=PackedFloat32Array();detail.normalXYZ.resize(n*3)
	var exposure=PackedFloat32Array();exposure.resize(n);var ids=PackedInt32Array();ids.resize(n);ids.fill(1)
	var zero=PackedFloat32Array();zero.resize(n);var stone=zero.duplicate();stone.fill(1)
	for i in n:
		var x=i%9;var z=floori(float(i)/9);var confidence=clampf(mini(mini(x,8-x),mini(z,8-z)),0,1)
		heights[i]=x*3;detail.slopeRadians[i]=atan(3.0);detail.aspectRadians[i]=-PI;detail.rockExposurePotential[i]=1;detail.edgeConfidence[i]=confidence;detail.bedrockExposure[i]=confidence;detail.treeSupport[i]=int(confidence<1)
		detail.normalXYZ[i*3]=-3/sqrt(10.0);detail.normalXYZ[i*3+1]=1/sqrt(10.0);exposure[i]=confidence
	detail.statistics={"minimumHeightM":0,"maximumHeightM":24,"meanSlopeRadians":atan(3.0),"meanRockExposurePotential":1,"fullSupportFraction":49.0/81}
	detail.supportDescriptor={"format":"surface-source-support","version":1,"geometryDetailId":detail.id,"source":source,"supportM":1.0,"treeMaximumSlopeRadians":deg_to_rad(65.0),"vetoMinimumConfidence":1,"exposureRecipe":{"minimumSlopeRadians":deg_to_rad(22.0),"maximumSlopeRadians":deg_to_rad(60.0)},"provenance":"explicit test plane"}
	detail.surfaceConditioning={"version":"surface-conditioning-1","canonicalEnvironmentVersion":"env1","bedrockExposure":exposure}
	var terrain=grid.duplicate();terrain.heights=heights;terrain.source=source
	var world={"terrain":terrain,"geometryDetail":detail,"versions":{"environment":"env1"},"geology":{"units":[{"id":1,"colorLinear":[0.2,0.3,0.4]}]},"fields":{"sourceRock":ids,"soilDepthM":zero,"depositDepthM":zero,"stoniness":stone,"waterClass":zero,"occupation":zero},"materials":[{"id":"fractured-bedrock"}]}
	check(Detail.validate(detail,world),"real derivative contract")
	for key in ["slopeRadians","normalXYZ","bedrockExposure","treeSupport"]:
		var changed=detail.duplicate(true);changed[key][40]=0.2
		check(not Detail.validate(changed,world),"forged "+key)
	var changed=detail.duplicate(true);changed.surfaceConditioning.bedrockExposure[40]=0.3
	check(not Detail.validate(changed,world),"forged canonical conditioning")
	var packet={"candidates":[{"stableId":"cliff","family":"tree","x":1000000004.0,"z":1000000004.0},{"stableId":"uncertain-edge","family":"tree","x":1000000000.0,"z":1000000004.0},{"stableId":"outside","family":"tree","x":1000000012.0,"z":1000000004.0}]}
	var before=JSON.stringify(packet);var private_packet=Detail.population_packet(packet,world)
	check(private_packet._unsupportedTreeIDs=={"cliff":true},"full confidence cliff veto only")
	check(JSON.stringify(packet)==before and not packet.has("_unsupportedTreeIDs"),"inventory unchanged")
	check(is_same(private_packet,Detail.population_packet(packet,world)),"private snapshot cached")
	var info=Detail.prepare(world);var pixel=info.image.get_pixel(4,4)
	check(info.image.get_format()==Image.FORMAT_RGBAF and absf(pixel.g-1)<0.000001 and pixel.b==0 and pixel.a==1,"RGBA effective exposure and catalogue index")
	check(info.colors[0]==Vector4(0.2,0.3,0.4,1) and info.recipe==0,"linear rock palette and exact recipe binding")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures}));quit(0 if failures.is_empty() else 1)
