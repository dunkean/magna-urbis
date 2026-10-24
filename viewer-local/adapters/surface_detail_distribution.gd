extends RefCounted
const VERSION="surface-detail-distribution-2"
const SCALES=[12.0,1.7,.17]
const WEIGHTS=[.4,.35,.25]
# Only twelve float phase values, independent of field resolution and view LOD.
# Double modulo happens before values enter shader FP32/local coordinates.
static func _seed(seed:int,band:int,lane:String)->int:
	var h:int=2166136261
	for byte in (VERSION+":"+str(seed)+":"+str(band)+":"+lane).to_utf8_buffer():h=((h^int(byte))*16777619)&0xffffffff
	return h
static func phases(origin:Dictionary,seed:int=0)->PackedVector4Array:
	var result=PackedVector4Array()
	for band in SCALES.size():
		var scale=float(SCALES[band])
		var x=float(origin.x)/scale+float(_seed(seed,band,"x")&0xffffff)/16777216.0
		var z=float(origin.z)/scale+float(_seed(seed,band,"z")&0xffffff)/16777216.0
		result.append(Vector4(fposmod(x,1.0),fposmod(z,1.0),fposmod(floorf(x)+(_seed(seed,band,"cx")&4095),4096.0),fposmod(floorf(z)+(_seed(seed,band,"cz")&4095),4096.0)))
	return result
static func metadata(seed:int=0)->Dictionary:
	return {"version":VERSION,"availability":"renderer-procedural","sourceEvidence":"existing GR component weights and explicit low-cover fractions; native geometry support unchanged","interpretation":"inferred metric patches, not observed fine soils or extra scatter","scalesM":SCALES,"cellSideRangeFactor":[.5,1.0],"bandWeights":WEIGHTS,"probabilityMeasure":"area-preserving shears and exact homothetic-cell area rank; hashed patch centres only","filter":"circular rank-interval convolution, constant2x footprint guard for half-cell subdivisions; exact input fractions at the unresolved horizon","meanAnchor":"original GR/low-cover source target, not asset means; one gamut gain from original probabilities/colours only; exact3m probability/alpha horizon","sourceFieldsChanged":false,"populationChanged":false,"additionalImageBytes":0,"phaseUniformBytes":48,"cellHashPeriodCells":4096,"repeatPolicy":"full multi-band pattern repeats only beyond the40km source; source parameters and registered PBR vary independently","layoutSeed":seed,"seedPolicy":"versioned FNV32(world.seed, band, lane), layout only, not a source/candidate identity; no camera/source request/world-id seed"}
