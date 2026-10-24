extends RefCounted
const VERSION="surface-low-cover-geometry-1"
const VARIANTS=4
const MAX_TRIANGLES={"shrub":256,"debris":96}
# Authored botanical approximations, not additional candidates or measured plants.
# Normalised support matches the existing source-sized instance transform.
static func _triangle(tool:SurfaceTool,a:Vector3,b:Vector3,c:Vector3)->void:
	var n=(b-a).cross(c-a).normalized()
	for p in [a,b,c]:
		tool.set_normal(n);tool.set_uv(Vector2(p.x+.5,p.z+.5));tool.add_vertex(p)
static func _leaf(tool:SurfaceTool,root:Vector3,direction:Vector3,width:float)->void:
	var side=direction.normalized().cross(Vector3.UP).normalized()*width
	if side.length_squared()<.00001:side=Vector3(width,0,0)
	var centre=root+direction*.48+Vector3(0,.012,0)
	var edge=[root,root+direction*.22+side*.7,root+direction*.58+side,root+direction,root+direction*.58-side,root+direction*.22-side*.7]
	for i in edge.size():_triangle(tool,centre,edge[i],edge[(i+1)%edge.size()])
static func _stem(tool:SurfaceTool,from:Vector3,to:Vector3,radius:float)->void:
	var along=(to-from).normalized();var side=along.cross(Vector3.RIGHT).normalized()
	if side.length_squared()<.001:side=along.cross(Vector3.FORWARD).normalized()
	var other=along.cross(side).normalized()
	for i in 3:
		var a=side*cos(TAU*i/3.0)*radius+other*sin(TAU*i/3.0)*radius
		var b=side*cos(TAU*(i+1)/3.0)*radius+other*sin(TAU*(i+1)/3.0)*radius
		_triangle(tool,from+a,from+b,to+a*.5);_triangle(tool,from+b,to+b*.5,to+a*.5)
static func mesh(family:String,variant:int)->ArrayMesh:
	assert(family in ["shrub","debris"])
	var tool=SurfaceTool.new();tool.begin(Mesh.PRIMITIVE_TRIANGLES)
	if family=="shrub":
		for stem in 5:
			var angle=TAU*(stem/5.0+variant*.073)
			var radial=Vector3(cos(angle),0,sin(angle))
			var root=Vector3(radial.x*.035,-.485,radial.z*.035)
			var tip=radial*(.12+stem*.017)+Vector3(0,.14+stem*.035,0)
			_stem(tool,root,tip,.007)
			for whorl in 3:
				var centre=root.lerp(tip,.38+whorl*.23)
				var rotation=angle+whorl*2.399963+variant*.19
				var length=.14+whorl*.018
				for sign in [-1.0,1.0]:
					var direction=Vector3(cos(rotation)*sign,.2,sin(rotation)*sign)*length
					_leaf(tool,centre,direction,.04+whorl*.009)
	else:
		for leaf in 8:
			var angle=leaf*2.399963+variant*.41
			var root=Vector3(cos(angle)*.23,-.33+leaf*.002,sin(angle)*.23)
			var direction=Vector3(cos(angle+.8),.03,sin(angle+.8))*(.13+float(leaf%3)*.025)
			_leaf(tool,root,direction,.045)
		_stem(tool,Vector3(-.3,-.32,-.1),Vector3(.27,-.29,.15),.009)
	tool.generate_tangents();var result=tool.commit()
	assert(result.surface_get_arrays(0)[Mesh.ARRAY_VERTEX].size()/3<=MAX_TRIANGLES[family])
	return result
static func partition(candidates:Array,buffer:PackedFloat32Array)->Array:
	assert(buffer.size()==candidates.size()*20)
	var groups=[]
	for variant in VARIANTS:groups.append({"variant":variant,"ids":[],"buffer":PackedFloat32Array()})
	for i in candidates.size():
		var candidate:Dictionary=candidates[i];var variant=posmod(int(candidate.get("variant",0)),VARIANTS)
		groups[variant].ids.append(str(candidate.stableId));groups[variant].buffer.append_array(buffer.slice(i*20,i*20+20))
	return groups
static func metadata()->Dictionary:
	return {"version":VERSION,"interpretation":"authored multi-stem leaf/twig shrub and fallen-leaf/twig debris; not measured botany or additional scatter","variants":VARIANTS,"triangleBudgets":MAX_TRIANGLES,"populationChanged":false,"instanceBufferChanged":false,"sourceHeightChanged":false,"registeredPbr":"existing vegetation-litter for shrub, forest-litter for fallen litter; no new asset claim"}
