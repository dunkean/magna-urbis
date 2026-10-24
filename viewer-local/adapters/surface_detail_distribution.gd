extends RefCounted
const VERSION="surface-detail-distribution-1"
const SCALES=[12.0,1.7,.17]
const WEIGHTS=[.4,.35,.25]
# Only six float phase values, independent of field resolution and view LOD.
# Double modulo happens before values enter shader FP32/local coordinates.
static func phases(origin:Dictionary)->PackedVector2Array:
	var result=PackedVector2Array()
	for scale in SCALES:result.append(Vector2(fposmod(float(origin.x)/scale,1.0),fposmod(float(origin.z)/scale,1.0)))
	return result
static func metadata()->Dictionary:
	return {"version":VERSION,"availability":"renderer-procedural","sourceEvidence":"existing GR component weights and explicit low-cover fractions; native geometry support unchanged","interpretation":"inferred metric patches, not observed fine soils or extra scatter","scalesM":SCALES,"bandWeights":WEIGHTS,"probabilityMeasure":"area-preserving periodic shears and analytic square-radius CDF","filter":"circular interval convolution; exact input fractions at the unresolved horizon","sourceFieldsChanged":false,"populationChanged":false,"additionalImageBytes":0,"phaseUniformBytes":24}
