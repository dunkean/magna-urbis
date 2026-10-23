extends SceneTree
const G=preload("res://adapters/surface_geometry.gd")
var failures:Array=[]
func old_height(world:Dictionary,x:float,z:float)->float:
	var layers:Array=world._heightLayers;var value=NAN
	for index in range(layers.size()-1,-1,-1):
		var layer:Dictionary=layers[index]
		if not G._contains(layer.bounds,x,z):continue
		var child=G.sample_height(layer.terrain,x,z)
		if not is_finite(child):continue
		if is_finite(value):
			var edge=minf(minf(x-float(layer.bounds.minX),float(layer.bounds.maxX)-x),minf(z-float(layer.bounds.minZ),float(layer.bounds.maxZ)-z))
			var band=maxf(float(layer.terrain.spacingM)*4.0,float(world.get("_displaySpacing",0))*2.0)
			value=lerpf(value,child,smoothstep(0,maxf(band,0.0001),edge))
		else:value=child
	return value if is_finite(value) else G.sample_height(world.terrain,x,z)
func grid(n:int,s:float,start:float,kernel:String)->Dictionary:
	var values=PackedFloat32Array()
	for z in n:
		for x in n:values.append(100+sin((start+x*s)*0.2)*7+cos((start+z*s)*0.3)*9)
	return {"width":n,"height":n,"originX":start,"originZ":start,"spacingM":s,"heights":values,"reconstruction":kernel}
func _initialize():
	var rng=RandomNumberGenerator.new();rng.seed=731
	var count=0;var maximum=0.0;var sampler_count=0
	for kernel in ["bilinear-samples","cubic-bspline-controls"]:
		var source_grid=grid(33,0.5,0.0,kernel)
		var packed:PackedFloat32Array=source_grid.heights;var generic=Array(packed)
		for i in 2000:
			var x=rng.randf_range(-4,20);var z=rng.randf_range(-4,20)
			var old=G.sample_grid_values(source_grid,generic,x,z);var current=G.sample_grid_values(source_grid,packed,x,z)
			if old!=current:failures.append("packed versus generic float64 kernel changed")
			if PackedFloat32Array([old]).to_byte_array()!=PackedFloat32Array([current]).to_byte_array():failures.append("packed versus generic Float32 sample changed")
			sampler_count+=1
		for bad in [NAN,INF,-INF]:
			var invalid=packed.duplicate();invalid[0]=bad
			for coord in [0.0,0.01,0.5,1.0,16.0]:
				var old=G.sample_grid_values(source_grid,Array(invalid),coord,coord);var current=G.sample_grid_values(source_grid,invalid,coord,coord)
				if not (is_nan(old) and is_nan(current)) and old!=current:failures.append("non-finite source propagation changed")
				sampler_count+=1

	for child_kernel in ["bilinear-samples","cubic-bspline-controls"]:
		for parent_kernel in ["bilinear-samples","cubic-bspline-controls"]:
			var fine=grid(33,0.5,0.0,child_kernel);var parent=grid(33,2.0,-24.0,parent_kernel)
			var world={"terrain":fine,"bounds":{"minX":0.0,"minZ":0.0,"maxX":16.0,"maxZ":16.0},"_terrainParents":[{"terrain":parent,"bounds":{"minX":-24.0,"minZ":-24.0,"maxX":40.0,"maxZ":40.0}}],"_displaySpacing":0.25}
			world._heightLayers=G.prepare_height_layers(world)
			var snapshot=hash([fine.heights,parent.heights])
			var points=[]
			for i in 1000:points.append([rng.randf_range(-30,45),rng.randf_range(-30,45)])
			for x in [-0.00001,0.0,0.00001,1.99999,2.0,2.00001,13.99999,14.0,14.00001,15.99999,16.0,16.00001]:points.append([x,8.0])
			for p in points:
				var a=old_height(world,p[0],p[1]);var b=G.height_at(world,p[0],p[1]);maximum=maxf(maximum,absf(a-b));count+=1
				if absf(a-b)>0.000000000001:failures.append("double height changed")
				if PackedFloat32Array([a]).to_byte_array()!=PackedFloat32Array([b]).to_byte_array():failures.append("Float32 height changed")
			if hash([fine.heights,parent.heights])!=snapshot:failures.append("source heights changed")
	print(JSON.stringify({"failures":failures,"samples":count,"packedVsGenericSamples":sampler_count,"maximumDoubleError":maximum,"allFloat32Identical":failures.is_empty()}));quit(0 if failures.is_empty() else 1)
