/* @ts-self-types="./magna_urbis_wasm.d.ts" */

/**
 * Grids of one flood; each `take_*` hands its array to JavaScript once.
 */
export class Flood {
    static __wrap(ptr) {
        const obj = Object.create(Flood.prototype);
        obj.__wbg_ptr = ptr;
        FloodFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FloodFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_flood_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get outlets() {
        const ret = wasm.flood_outlets(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Float32Array}
     */
    take_accumulation() {
        const ret = wasm.flood_take_accumulation(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Int32Array}
     */
    take_basin() {
        const ret = wasm.flood_take_basin(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    take_filled() {
        const ret = wasm.flood_take_filled(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Int32Array}
     */
    take_order() {
        const ret = wasm.flood_take_order(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Int32Array}
     */
    take_receiver() {
        const ret = wasm.flood_take_receiver(this.__wbg_ptr);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    take_sea() {
        const ret = wasm.flood_take_sea(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) Flood.prototype[Symbol.dispose] = Flood.prototype.free;

export class GenerationNoisePlan {
    static __wrap(ptr) {
        const obj = Object.create(GenerationNoisePlan.prototype);
        obj.__wbg_ptr = ptr;
        GenerationNoisePlanFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GenerationNoisePlanFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_generationnoiseplan_free(ptr, 0);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif
     * @param {number} mix
     * @returns {GenerationNoisePlan}
     */
    static erosion(seed, width, relief, erosion, motif, mix) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.generationnoiseplan_erosion(ptr0, len0, width, ptr1, len1, erosion, motif, mix);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return GenerationNoisePlan.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif
     * @param {number} mix
     * @param {number} n
     * @returns {GenerationNoisePlan}
     */
    static erosion_at_resolution(seed, width, relief, erosion, motif, mix, n) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.generationnoiseplan_erosion_at_resolution(ptr0, len0, width, ptr1, len1, erosion, motif, mix, n);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return GenerationNoisePlan.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} motif
     * @param {string} relief
     * @param {number} erosion
     * @returns {GenerationNoisePlan}
     */
    static finite_shape(seed, motif, relief, erosion) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.generationnoiseplan_finite_shape(ptr0, len0, motif, ptr1, len1, erosion);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return GenerationNoisePlan.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} motif
     * @returns {GenerationNoisePlan}
     */
    static generation(seed, width, relief, motif) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.generationnoiseplan_generation(ptr0, len0, width, ptr1, len1, motif);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return GenerationNoisePlan.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} motif
     * @param {number} n
     * @returns {GenerationNoisePlan}
     */
    static generation_at_resolution(seed, width, relief, motif, n) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.generationnoiseplan_generation_at_resolution(ptr0, len0, width, ptr1, len1, motif, n);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return GenerationNoisePlan.__wrap(ret[0]);
    }
    /**
     * @returns {Float32Array}
     */
    gradients() {
        const ret = wasm.generationnoiseplan_gradients(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {number} motif
     */
    constructor(seed, width, motif) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.generationnoiseplan_new(ptr0, len0, width, motif);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        GenerationNoisePlanFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float32Array}
     */
    parameters() {
        const ret = wasm.generationnoiseplan_parameters(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    permutations() {
        const ret = wasm.generationnoiseplan_permutations(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) GenerationNoisePlan.prototype[Symbol.dispose] = GenerationNoisePlan.prototype.free;

/**
 * Cached terrain drainage. Vector regeneration does not repeat terrain/coast preparation.
 */
export class HydrologyEngine {
    static __wrap(ptr) {
        const obj = Object.create(HydrologyEngine.prototype);
        obj.__wbg_ptr = ptr;
        HydrologyEngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HydrologyEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hydrologyengine_free(ptr, 0);
    }
    /**
     * @returns {Float32Array}
     */
    accumulation() {
        const ret = wasm.hydrologyengine_accumulation(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    filled() {
        const ret = wasm.hydrologyengine_filled(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} main
     * @param {number} density
     * @param {number} wetness
     * @param {string} lakes
     * @param {string} meanders
     * @param {number} meander_intensity
     * @param {string} estuary
     * @param {number} width_scale
     * @param {number} incision
     * @param {number} min_lake_area
     * @param {number | null} [lake_abundance]
     * @param {number | null} [lake_coverage]
     * @param {number | null} [max_lake_area]
     * @param {string | null} [depression_policy]
     * @param {number | null} [max_breach_depth]
     * @param {number | null} [max_breach_length]
     * @param {number | null} [min_lake_depth]
     * @param {number | null} [temperature]
     * @param {number | null} [precipitation]
     * @param {number | null} [coastal_streams]
     * @param {number | null} [shore_cell]
     * @returns {HydrologyOutput}
     */
    generate(main, density, wetness, lakes, meanders, meander_intensity, estuary, width_scale, incision, min_lake_area, lake_abundance, lake_coverage, max_lake_area, depression_policy, max_breach_depth, max_breach_length, min_lake_depth, temperature, precipitation, coastal_streams, shore_cell) {
        const ptr0 = passStringToWasm0(main, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lakes, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(meanders, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(estuary, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(depression_policy) ? 0 : passStringToWasm0(depression_policy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len4 = WASM_VECTOR_LEN;
        const ret = wasm.hydrologyengine_generate(this.__wbg_ptr, ptr0, len0, density, wetness, ptr1, len1, ptr2, len2, meander_intensity, ptr3, len3, width_scale, incision, min_lake_area, isLikeNone(lake_abundance) ? Number.MAX_SAFE_INTEGER : Math.fround(lake_abundance), isLikeNone(lake_coverage) ? Number.MAX_SAFE_INTEGER : Math.fround(lake_coverage), isLikeNone(max_lake_area) ? Number.MAX_SAFE_INTEGER : Math.fround(max_lake_area), ptr4, len4, isLikeNone(max_breach_depth) ? Number.MAX_SAFE_INTEGER : Math.fround(max_breach_depth), isLikeNone(max_breach_length) ? Number.MAX_SAFE_INTEGER : Math.fround(max_breach_length), isLikeNone(min_lake_depth) ? Number.MAX_SAFE_INTEGER : Math.fround(min_lake_depth), isLikeNone(temperature) ? Number.MAX_SAFE_INTEGER : Math.fround(temperature), isLikeNone(precipitation) ? Number.MAX_SAFE_INTEGER : Math.fround(precipitation), isLikeNone(coastal_streams) ? Number.MAX_SAFE_INTEGER : Math.fround(coastal_streams), isLikeNone(shore_cell) ? Number.MAX_SAFE_INTEGER : Math.fround(shore_cell));
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return HydrologyOutput.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {number} resolution
     * @param {Float32Array} height
     * @param {boolean} sea_enabled
     */
    constructor(seed, width, resolution, height, sea_enabled) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.hydrologyengine_new(ptr0, len0, width, resolution, ptr1, len1, sea_enabled);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        HydrologyEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint32Array}
     */
    receivers() {
        const ret = wasm.hydrologyengine_receivers(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {number} resolution
     * @param {Float32Array} height
     * @param {boolean} sea_enabled
     * @param {Float32Array} filled
     * @param {Uint32Array} receivers
     * @param {Float32Array} accumulation
     * @returns {HydrologyEngine}
     */
    static with_drainage(seed, width, resolution, height, sea_enabled, filled, receivers, accumulation) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(filled, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(receivers, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF32ToWasm0(accumulation, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.hydrologyengine_with_drainage(ptr0, len0, width, resolution, ptr1, len1, sea_enabled, ptr2, len2, ptr3, len3, ptr4, len4);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return HydrologyEngine.__wrap(ret[0]);
    }
}
if (Symbol.dispose) HydrologyEngine.prototype[Symbol.dispose] = HydrologyEngine.prototype.free;

/**
 * Batch-copy getters; JS owns arrays independently of this wrapper's lifetime.
 */
export class HydrologyOutput {
    static __wrap(ptr) {
        const obj = Object.create(HydrologyOutput.prototype);
        obj.__wbg_ptr = ptr;
        HydrologyOutputFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HydrologyOutputFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hydrologyoutput_free(ptr, 0);
    }
    /**
     * @returns {Float32Array}
     */
    get accumulation() {
        const ret = wasm.hydrologyoutput_accumulation(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get adjusted_height() {
        const ret = wasm.hydrologyoutput_adjusted_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get avoided_fill_volume_m3() {
        const ret = wasm.hydrologyoutput_avoided_fill_volume_m3(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint32Array}
     */
    get basins() {
        const ret = wasm.hydrologyoutput_basins(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get breach_count() {
        const ret = wasm.hydrologyoutput_breach_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get breach_cut_volume_m3() {
        const ret = wasm.hydrologyoutput_breach_cut_volume_m3(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float32Array}
     */
    get drainage_height() {
        const ret = wasm.hydrologyoutput_drainage_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get external_inflow_area() {
        const ret = wasm.hydrologyoutput_external_inflow_area(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float32Array}
     */
    get filled() {
        const ret = wasm.hydrologyoutput_filled(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get flat_labels() {
        const ret = wasm.hydrologyoutput_flat_labels(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get flat_rank() {
        const ret = wasm.hydrologyoutput_flat_rank(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get lake_closed() {
        const ret = wasm.hydrologyoutput_lake_closed(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get lake_depth() {
        const ret = wasm.hydrologyoutput_lake_depth(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get lake_labels() {
        const ret = wasm.hydrologyoutput_lake_labels(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get lake_meta() {
        const ret = wasm.hydrologyoutput_lake_meta(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get lake_offsets() {
        const ret = wasm.hydrologyoutput_lake_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get lake_points() {
        const ret = wasm.hydrologyoutput_lake_points(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get lake_ring_meta() {
        const ret = wasm.hydrologyoutput_lake_ring_meta(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get node_meta() {
        const ret = wasm.hydrologyoutput_node_meta(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get node_points() {
        const ret = wasm.hydrologyoutput_node_points(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get raw_accumulation() {
        const ret = wasm.hydrologyoutput_raw_accumulation(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get raw_basins() {
        const ret = wasm.hydrologyoutput_raw_basins(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get raw_drainage_height() {
        const ret = wasm.hydrologyoutput_raw_drainage_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get raw_filled() {
        const ret = wasm.hydrologyoutput_raw_filled(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get raw_receivers() {
        const ret = wasm.hydrologyoutput_raw_receivers(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get receivers() {
        const ret = wasm.hydrologyoutput_receivers(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get resolution() {
        const ret = wasm.hydrologyoutput_resolution(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Float32Array}
     */
    get river_flare() {
        const ret = wasm.hydrologyoutput_river_flare(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get river_meta() {
        const ret = wasm.hydrologyoutput_river_meta(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get river_offsets() {
        const ret = wasm.hydrologyoutput_river_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get river_points() {
        const ret = wasm.hydrologyoutput_river_points(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string}
     */
    get stage_labels() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.hydrologyoutput_stage_labels(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Float64Array}
     */
    get stage_ms() {
        const ret = wasm.hydrologyoutput_stage_ms(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get surface_height() {
        const ret = wasm.hydrologyoutput_surface_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get water_field() {
        const ret = wasm.hydrologyoutput_water_field(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.hydrologyoutput_width(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) HydrologyOutput.prototype[Symbol.dispose] = HydrologyOutput.prototype.free;

/**
 * The adapted terrain and its derived fields, kept between calls: placement and routing are
 * separate, so moving a settlement or changing a road option only reroutes.
 * All placement, scoring and routing runs in Rust. JSON only carries editable properties.
 * Urban products (layouts, partitions) stay resident here, addressed by ids
 * (`resident.rs`): stages pass handles, not geometry.
 */
export class SettlementTerrain {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SettlementTerrainFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_settlementterrain_free(ptr, 0);
    }
    drop_resident() {
        wasm.settlementterrain_drop_resident(this.__wbg_ptr);
    }
    /**
     * MessagePack image of resident products (`partitions_id` 0: layouts only)
     * for `import_resident` in another instance.
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @returns {Uint8Array}
     */
    export_resident(layouts_id, partitions_id) {
        const ret = wasm.settlementterrain_export_resident(this.__wbg_ptr, layouts_id, partitions_id);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Replace the resident products by an `export_resident` image; returns the
     * new layouts id (`resident_partitions_id()` is 0 without partitions).
     * @param {Uint8Array} image
     * @returns {number}
     */
    import_resident(image) {
        const ptr0 = passArray8ToWasm0(image, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_import_resident(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {number} width
     * @param {number} resolution
     * @param {Float32Array} height
     * @param {Uint8Array} water
     * @param {Float32Array} water_level
     * @param {Float32Array} river_width
     * @param {Int32Array} river_ids
     */
    constructor(width, resolution, height, water, water_level, river_width, river_ids) {
        const ptr0 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(water, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(water_level, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF32ToWasm0(river_width, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(river_ids, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_new(width, resolution, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        SettlementTerrainFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Settlement points from a placement configuration (JSON).
     * @param {string} seed
     * @param {string} config
     * @returns {string}
     */
    place(seed, config) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_place(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    resident_layouts_id() {
        const ret = wasm.settlementterrain_resident_layouts_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    resident_layouts_len() {
        const ret = wasm.settlementterrain_resident_layouts_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    resident_partitions_id() {
        const ret = wasm.settlementterrain_resident_partitions_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Compact resource payload for the view layers (JSON, same shape as the native `resources` reply).
     * @returns {string}
     */
    resources() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.settlementterrain_resources(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Retain layouts given as JSON (explicit plans, or pool slices merged as
     * text). Returns their id; partitions are dropped.
     * @param {string} layouts
     * @returns {number}
     */
    retain_layouts_json(layouts) {
        const ptr0 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_retain_layouts_json(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Retain partitions given as JSON next to the current resident layouts.
     * @param {string} partitions
     * @returns {number}
     */
    retain_partitions_json(partitions) {
        const ptr0 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_retain_partitions_json(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Retain the partitions of a full pack (`urban_parcel_pack_resident` with
     * every group, or a native pack reply) next to the current resident
     * layouts. Returns their new id.
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    retain_partitions_pack(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_retain_partitions_pack(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Road network between `sites` (JSON array of placed settlements) from a road configuration.
     * @param {string} seed
     * @param {string} sites
     * @param {string} config
     * @returns {string}
     */
    roads(seed, sites, config) {
        let deferred5_0;
        let deferred5_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(sites, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_roads(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Full-resolution physical metres for local urban elevations and foundations.
     * @param {number} resolution
     * @param {Float32Array} height
     */
    set_physical_height(resolution, height) {
        const ptr0 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_set_physical_height(this.__wbg_ptr, resolution, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} resolution
     * @param {Float32Array} height
     * @param {number} floor
     */
    set_physical_height_spline(resolution, height, floor) {
        const ptr0 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_set_physical_height_spline(this.__wbg_ptr, resolution, ptr0, len0, floor);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Seed, climate (°C, mm), biome and world position of the map for the resource model.
     * @param {string} seed
     * @param {number} temperature
     * @param {number} precipitation
     * @param {string} biome
     * @param {number} x
     * @param {number} y
     */
    set_region(seed, temperature, precipitation, biome, x, y) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(biome, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.settlementterrain_set_region(this.__wbg_ptr, ptr0, len0, temperature, precipitation, ptr1, len1, x, y);
    }
    /**
     * @param {string} geometry
     */
    set_urban_geometry(geometry) {
        const ptr0 = passStringToWasm0(geometry, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_set_urban_geometry(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Display rows of the building sites of resident products: the
     * `magna-city-sites` blob of the native `buildingSiteVisuals` read (origin =
     * first layout centre), generated in chunks without the request trees.
     * @param {string} seed
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @param {string | null | undefined} architecture_culture
     * @param {number} version
     * @returns {Uint8Array}
     */
    urban_building_site_display_resident(seed, layouts_id, partitions_id, architecture_culture, version) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(architecture_culture) ? 0 : passStringToWasm0(architecture_culture, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_urban_building_site_display_resident(this.__wbg_ptr, ptr0, len0, layouts_id, partitions_id, ptr1, len1, version);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * @param {string} seed
     * @param {string} layouts
     * @param {string} partitions
     * @param {string | null} [architecture_culture]
     * @returns {string}
     */
    urban_building_sites(seed, layouts, partitions, architecture_culture) {
        let deferred6_0;
        let deferred6_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            var ptr3 = isLikeNone(architecture_culture) ? 0 : passStringToWasm0(architecture_culture, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len3 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_building_sites(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Sites `start..end` of `urban_building_sites` as a JSON array: worker
     * pools split one city's sites and concatenate the ranges in order.
     * @param {string} seed
     * @param {string} layouts
     * @param {string} partitions
     * @param {string | null | undefined} architecture_culture
     * @param {number} start
     * @param {number} end
     * @returns {string}
     */
    urban_building_sites_range(seed, layouts, partitions, architecture_culture, start, end) {
        let deferred6_0;
        let deferred6_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            var ptr3 = isLikeNone(architecture_culture) ? 0 : passStringToWasm0(architecture_culture, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len3 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_building_sites_range(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, start, end);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Building sites `start..end` (clamped) of resident products, as a JSON
     * array: the houses planner consumes placement requests as JSON.
     * @param {string} seed
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @param {string | null | undefined} architecture_culture
     * @param {number} start
     * @param {number} end
     * @returns {string}
     */
    urban_building_sites_resident(seed, layouts_id, partitions_id, architecture_culture, start, end) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(architecture_culture) ? 0 : passStringToWasm0(architecture_culture, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_building_sites_resident(this.__wbg_ptr, ptr0, len0, layouts_id, partitions_id, ptr1, len1, start, end);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Number of building sites `urban_building_sites` emits for these inputs.
     * @param {string} layouts
     * @param {string} partitions
     * @returns {number}
     */
    static urban_building_sites_total(layouts, partitions) {
        const ptr0 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_urban_building_sites_total(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @returns {number}
     */
    urban_building_sites_total_resident(layouts_id, partitions_id) {
        const ret = wasm.settlementterrain_urban_building_sites_total_resident(this.__wbg_ptr, layouts_id, partitions_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {string} partitions
     * @param {string} scene
     * @returns {string}
     */
    urban_built_capacity(partitions, scene) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(scene, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_built_capacity(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * `urban_built_capacity` on resident partitions (`scene`: the same JSON).
     * The result is not retained; it is packed as computed with the groups
     * `reconcile_built` changes (`partitionsId` 0).
     * @param {number} partitions_id
     * @param {string} scene
     * @returns {Uint8Array}
     */
    urban_built_capacity_resident(partitions_id, scene) {
        const ptr0 = passStringToWasm0(scene, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_urban_built_capacity_resident(this.__wbg_ptr, partitions_id, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Compact display buffers of a plan (same blob as the native `displayBuffers`
     * read): typed geometry and attribute codes for drawing, no JSON geometry.
     * @param {string} layouts
     * @param {string} partitions
     * @param {boolean} ids
     * @returns {Uint8Array}
     */
    urban_display_buffers(layouts, partitions, ids) {
        const ptr0 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_urban_display_buffers(this.__wbg_ptr, ptr0, len0, ptr1, len1, ids);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * Display buffers (`urban::display`, same blob as the native
     * `displayBuffers` read) of resident products; `partitions_id` 0: none.
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @param {boolean} ids
     * @returns {Uint8Array}
     */
    urban_display_buffers_resident(layouts_id, partitions_id, ids) {
        const ret = wasm.settlementterrain_urban_display_buffers_resident(this.__wbg_ptr, layouts_id, partitions_id, ids);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Pack of the resident partitions `partitions_id`; `groups` is a
     * comma-separated list of `parcel_pack::GROUPS` (empty: all).
     * @param {number} partitions_id
     * @param {string} groups
     * @returns {Uint8Array}
     */
    urban_parcel_pack_resident(partitions_id, groups) {
        const ptr0 = passStringToWasm0(groups, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_urban_parcel_pack_resident(this.__wbg_ptr, partitions_id, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * JSON text of `parcel_pack::record`: parcel `index` of the resident
     * partition `key` with its allocations, adjacency and environment.
     * @param {number} partitions_id
     * @param {string} key
     * @param {number} index
     * @returns {string}
     */
    urban_parcel_record_resident(partitions_id, key, index) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_parcel_record_resident(this.__wbg_ptr, partitions_id, ptr0, len0, index);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Recut parcels from retained blocks without modifying streets, terrain or sites.
     * @param {string} seed
     * @param {string} layouts
     * @param {string} config
     * @returns {string}
     */
    urban_parcels(seed, layouts, config) {
        let deferred5_0;
        let deferred5_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_parcels(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Parcels of resident layouts `start..end` (clamped; all: `0, u32::MAX`).
     * The full range is retained under `resident_partitions_id()`; a slice
     * (pool participant) is only returned.
     * @param {string} seed
     * @param {number} layouts_id
     * @param {string} config
     * @param {number} start
     * @param {number} end
     * @returns {string}
     */
    urban_parcels_resident(seed, layouts_id, config, start, end) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_parcels_resident(this.__wbg_ptr, ptr0, len0, layouts_id, ptr1, len1, start, end);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * `urban_parcels_resident` returning a full pack instead of the JSON text.
     * The full range is normalised, retained and packed from the retained
     * values (`partitionsId` in the header); a slice is packed as computed,
     * not retained (`partitionsId` 0).
     * @param {string} seed
     * @param {number} layouts_id
     * @param {string} config
     * @param {number} start
     * @param {number} end
     * @returns {Uint8Array}
     */
    urban_parcels_resident_pack(seed, layouts_id, config, start, end) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.settlementterrain_urban_parcels_resident_pack(this.__wbg_ptr, ptr0, len0, layouts_id, ptr1, len1, start, end);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * Reconcile only allocation on retained blocks and parcels.
     * @param {string} layouts
     * @param {string} partitions
     * @returns {string}
     */
    urban_programme(layouts, partitions) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(layouts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(partitions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_programme(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Feature handshake before a caller sends explicit composable weights.
     * Old generated JS/WASM lacks this static method and must fail closed.
     * @returns {number}
     */
    static urban_programme_functions_version() {
        const ret = wasm.settlementterrain_urban_programme_functions_version();
        return ret >>> 0;
    }
    /**
     * Programme reallocation of resident products; the result replaces them.
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @returns {string}
     */
    urban_programme_resident(layouts_id, partitions_id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.settlementterrain_urban_programme_resident(this.__wbg_ptr, layouts_id, partitions_id);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * `urban_programme_resident` returning a full pack of the retained
     * result (`partitionsId` in the header) instead of the JSON text.
     * @param {number} layouts_id
     * @param {number} partitions_id
     * @returns {Uint8Array}
     */
    urban_programme_resident_pack(layouts_id, partitions_id) {
        const ret = wasm.settlementterrain_urban_programme_resident_pack(this.__wbg_ptr, layouts_id, partitions_id);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Native urban cuts on the retained terrain. Inputs and outputs use metric JSON.
     * @param {string} seed
     * @param {string} sites
     * @param {string} config
     * @param {string} roads
     * @returns {string}
     */
    urban_quarters(seed, sites, config, roads) {
        let deferred6_0;
        let deferred6_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(sites, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(roads, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len3 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_quarters(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * Quarters of several independent towns in one call, each job exactly the
     * call `urban_quarters_resident(seed, sites, config, roads)` would make. The
     * jobs run as parallel items of the rayon pool (threads build), so towns share
     * one instance and one pool. Replies each job's layouts JSON, in job order,
     * separated by U+001E (never present in JSON text); nothing is made resident.
     * The first error in job order wins.
     * @param {string} jobs
     * @returns {string}
     */
    urban_quarters_batch(jobs) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(jobs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_quarters_batch(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Quarters as `urban_quarters`, retained under `resident_layouts_id()`.
     * Returns the JSON text for the UI (the only copy that crosses to JS).
     * @param {string} seed
     * @param {string} sites
     * @param {string} config
     * @param {string} roads
     * @returns {string}
     */
    urban_quarters_resident(seed, sites, config, roads) {
        let deferred6_0;
        let deferred6_1;
        try {
            const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(sites, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(config, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(roads, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len3 = WASM_VECTOR_LEN;
            const ret = wasm.settlementterrain_urban_quarters_resident(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var ptr5 = ret[0];
            var len5 = ret[1];
            if (ret[3]) {
                ptr5 = 0; len5 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
        }
    }
}
if (Symbol.dispose) SettlementTerrain.prototype[Symbol.dispose] = SettlementTerrain.prototype.free;

/**
 * Owns the prepared physical erosion field. Retain this object across camera changes.
 */
export class TerrainEngine {
    static __wrap(ptr) {
        const obj = Object.create(TerrainEngine.prototype);
        obj.__wbg_ptr = ptr;
        TerrainEngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TerrainEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_terrainengine_free(ptr, 0);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif_size
     * @param {number} mountain_mix
     * @param {string | null | undefined} environment
     * @param {number} source_n
     * @returns {TerrainEngine}
     */
    static at_resolution(seed, width, relief, erosion, motif_size, mountain_mix, environment, source_n) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_at_resolution(ptr0, len0, width, ptr1, len1, erosion, motif_size, mountain_mix, ptr2, len2, source_n);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
    /**
     * Underdark: carve the retained relief into caves and tunnels (rock mask in `physical_cave_field`).
     * `natural_tunnels`: natural and side tunnels amount (0 none); `caverns`: share of the map the caverns open;
     * `lakes`: lakes amount (0 none). Absent, the defaults of `UnderdarkOptions`.
     * @param {string} seed
     * @param {number | null} [natural_tunnels]
     * @param {number | null} [caverns]
     * @param {number | null} [lakes]
     */
    carve_underdark(seed, natural_tunnels, caverns, lakes) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_carve_underdark(this.__wbg_ptr, ptr0, len0, !isLikeNone(natural_tunnels), isLikeNone(natural_tunnels) ? 0 : natural_tunnels, !isLikeNone(caverns), isLikeNone(caverns) ? 0 : caverns, !isLikeNone(lakes), isLikeNone(lakes) ? 0 : lakes);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {Float32Array}
     */
    coast_erosion_parameters() {
        const ret = wasm.terrainengine_coast_erosion_parameters(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    coast_parameters() {
        const ret = wasm.terrainengine_coast_parameters(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} mask
     * @param {string} mode
     * @param {string | null} [profile]
     */
    configure_coast(mask, mode, profile) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(profile) ? 0 : passStringToWasm0(profile, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_configure_coast(this.__wbg_ptr, mask, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number | undefined}
     */
    erosion_spacing() {
        const ret = wasm.terrainengine_erosion_spacing(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * @returns {number}
     */
    get max_height() {
        const ret = wasm.terrainengine_max_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get min_height() {
        const ret = wasm.terrainengine_min_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get motif_size() {
        const ret = wasm.terrainengine_motif_size(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif_size
     * @param {number | null} [mountain_mix]
     * @param {string | null} [environment]
     */
    constructor(seed, width, relief, erosion, motif_size, mountain_mix, environment) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_new(ptr0, len0, width, ptr1, len1, erosion, motif_size, !isLikeNone(mountain_mix), isLikeNone(mountain_mix) ? 0 : mountain_mix, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        TerrainEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint8Array}
     */
    physical_cave_field() {
        const ret = wasm.terrainengine_physical_cave_field(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    physical_height_field() {
        const ret = wasm.terrainengine_physical_height_field(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif
     * @returns {Float32Array}
     */
    static prepare_environment(seed, width, relief, erosion, motif) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_prepare_environment(ptr0, len0, width, ptr1, len1, erosion, motif);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif
     * @param {number} source_n
     * @returns {Float32Array}
     */
    static prepare_environment_at_resolution(seed, width, relief, erosion, motif, source_n) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_prepare_environment_at_resolution(ptr0, len0, width, ptr1, len1, erosion, motif, source_n);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} extent
     * @param {number} resolution
     * @returns {TerrainOutput}
     */
    sample_region(x, y, extent, resolution) {
        const ret = wasm.terrainengine_sample_region(this.__wbg_ptr, x, y, extent, resolution);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainOutput.__wrap(ret[0]);
    }
    /**
     * @returns {Float32Array}
     */
    sampling_base_field() {
        const ret = wasm.terrainengine_sampling_base_field(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    sampling_branches() {
        const ret = wasm.terrainengine_sampling_branches(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    sampling_field() {
        const ret = wasm.terrainengine_sampling_field(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    sampling_gradients() {
        const ret = wasm.terrainengine_sampling_gradients(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    sampling_parameters() {
        const ret = wasm.terrainengine_sampling_parameters(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    sampling_permutations() {
        const ret = wasm.terrainengine_sampling_permutations(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} mask
     * @param {string} mode
     * @param {string | null} [profile]
     */
    set_coast(mask, mode, profile) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(profile) ? 0 : passStringToWasm0(profile, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_set_coast(this.__wbg_ptr, mask, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Float32Array} heights
     */
    set_coast_surface(heights) {
        const ptr0 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_set_coast_surface(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Float32Array} heights
     */
    set_edited_surface(heights) {
        const ptr0 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_set_edited_surface(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    source_resolution() {
        const ret = wasm.terrainengine_source_resolution(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Natural Underdark tunnels, flattened `[kind, half_width, count, x0, y0, …]` in metres.
     * @returns {Float32Array}
     */
    underdark_tunnels() {
        const ret = wasm.terrainengine_underdark_tunnels(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.terrainengine_width(this.__wbg_ptr);
        return ret;
    }
    /**
     * Temporary interchange: externally evaluated FP32 noises, unchanged CPU erosion.
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif_size
     * @param {number} mountain_mix
     * @param {Float32Array} coarse
     * @param {Float32Array} fine
     * @param {string | null} [environment]
     * @returns {TerrainEngine}
     */
    static with_generation_noise(seed, width, relief, erosion, motif_size, mountain_mix, coarse, fine, environment) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(coarse, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF32ToWasm0(fine, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len4 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_with_generation_noise(ptr0, len0, width, ptr1, len1, erosion, motif_size, mountain_mix, ptr2, len2, ptr3, len3, ptr4, len4);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif_size
     * @param {number} mountain_mix
     * @param {Float32Array} source
     * @param {string | null} [environment]
     * @returns {TerrainEngine}
     */
    static with_source(seed, width, relief, erosion, motif_size, mountain_mix, source, environment) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(source, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len3 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_with_source(ptr0, len0, width, ptr1, len1, erosion, motif_size, mountain_mix, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
    /**
     * Prepared signed square surface (neural relief) in metres over the map.
     * @param {string} seed
     * @param {number} width
     * @param {Float32Array} heights
     * @returns {TerrainEngine}
     */
    static with_surface(seed, width, heights) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_with_surface(ptr0, len0, width, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {number} motif_size
     * @param {Float32Array} heights
     * @param {string} zones_json
     * @returns {TerrainEngine}
     */
    static with_zoned_surface(seed, width, motif_size, heights, zones_json) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(zones_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_with_zoned_surface(ptr0, len0, width, motif_size, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif_size
     * @param {number} mountain_mix
     * @param {string | null | undefined} environment
     * @param {string} zones_json
     * @returns {TerrainEngine}
     */
    static with_zones(seed, width, relief, erosion, motif_size, mountain_mix, environment, zones_json) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(zones_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_with_zones(ptr0, len0, width, ptr1, len1, erosion, motif_size, mountain_mix, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {string} relief
     * @param {number} erosion
     * @param {number} motif_size
     * @param {number} mountain_mix
     * @param {string | null | undefined} environment
     * @param {string} zones_json
     * @param {number} source_n
     * @returns {TerrainEngine}
     */
    static with_zones_at_resolution(seed, width, relief, erosion, motif_size, mountain_mix, environment, zones_json, source_n) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(zones_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.terrainengine_with_zones_at_resolution(ptr0, len0, width, ptr1, len1, erosion, motif_size, mountain_mix, ptr2, len2, ptr3, len3, source_n);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TerrainEngine.__wrap(ret[0]);
    }
}
if (Symbol.dispose) TerrainEngine.prototype[Symbol.dispose] = TerrainEngine.prototype.free;

/**
 * A square raster in meters. Cell centers are ((x + .5) * width / resolution, ...).
 * Array getters copy in a single batch: JS owns them independently of free().
 */
export class TerrainOutput {
    static __wrap(ptr) {
        const obj = Object.create(TerrainOutput.prototype);
        obj.__wbg_ptr = ptr;
        TerrainOutputFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TerrainOutputFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_terrainoutput_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    get cave_mask() {
        const ret = wasm.terrainoutput_cave_mask(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get height() {
        const ret = wasm.terrainoutput_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get max_height() {
        const ret = wasm.terrainoutput_max_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get min_height() {
        const ret = wasm.terrainoutput_min_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float32Array}
     */
    get normal_x() {
        const ret = wasm.terrainoutput_normal_x(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get normal_y() {
        const ret = wasm.terrainoutput_normal_y(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float32Array}
     */
    get normal_z() {
        const ret = wasm.terrainoutput_normal_z(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    get resolution() {
        const ret = wasm.terrainoutput_resolution(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get width() {
        const ret = wasm.terrainoutput_width(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.terrainoutput_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.terrainoutput_y(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) TerrainOutput.prototype[Symbol.dispose] = TerrainOutput.prototype.free;

export class TerrainPipeline {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TerrainPipelineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_terrainpipeline_free(ptr, 0);
    }
    /**
     * @param {number} stage
     */
    advance(stage) {
        const ret = wasm.terrainpipeline_advance(this.__wbg_ptr, stage);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} slot
     */
    checkpoint(slot) {
        const ret = wasm.terrainpipeline_checkpoint(this.__wbg_ptr, slot);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} slot
     * @returns {Float32Array}
     */
    checkpoint_height(slot) {
        const ret = wasm.terrainpipeline_checkpoint_height(this.__wbg_ptr, slot);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} mask
     * @param {string} mode
     * @param {string | null} [profile]
     */
    cut_coast(mask, mode, profile) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(profile) ? 0 : passStringToWasm0(profile, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainpipeline_cut_coast(this.__wbg_ptr, mask, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} seed
     * @param {number} width
     * @param {number} motif
     * @param {number} amplitude
     * @param {number} mask
     * @param {string} mode
     * @param {number} n
     * @param {number} origin
     * @param {number} cell
     * @param {Float32Array} heights
     * @param {string | null} [profile]
     * @returns {Float32Array}
     */
    static cut_field(seed, width, motif, amplitude, mask, mode, n, origin, cell, heights, profile) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(heights, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(profile) ? 0 : passStringToWasm0(profile, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len3 = WASM_VECTOR_LEN;
        const ret = wasm.terrainpipeline_cut_field(ptr0, len0, width, motif, amplitude, mask, ptr1, len1, n, origin, cell, ptr2, len2, ptr3, len3);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v5 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v5;
    }
    /**
     * @returns {Float32Array}
     */
    height() {
        const ret = wasm.terrainpipeline_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} seed
     * @param {Float32Array} parameters
     * @param {Float32Array} surface
     * @param {Uint32Array} flags
     */
    constructor(seed, parameters, surface, flags) {
        const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(parameters, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(surface, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(flags, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.terrainpipeline_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        TerrainPipelineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} slot
     * @param {Float32Array} parameters
     * @param {Float32Array} surface
     * @param {Uint32Array} flags
     */
    restore(slot, parameters, surface, flags) {
        const ptr0 = passArrayF32ToWasm0(parameters, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(surface, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(flags, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.terrainpipeline_restore(this.__wbg_ptr, slot, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Float32Array} coarse
     * @param {Float32Array} fine
     */
    set_noise(coarse, fine) {
        const ptr0 = passArrayF32ToWasm0(coarse, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(fine, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.terrainpipeline_set_noise(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} json
     */
    set_step_seeds(json) {
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.terrainpipeline_set_step_seeds(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Final field moved out of the pipeline (one copy into JS instead of two).
     * @returns {Float32Array}
     */
    take_height() {
        const ret = wasm.terrainpipeline_take_height(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) TerrainPipeline.prototype[Symbol.dispose] = TerrainPipeline.prototype.free;

/**
 * @param {Uint8Array} request
 * @returns {Uint8Array}
 */
export function build_forest_field(request) {
    const ptr0 = passArray8ToWasm0(request, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.build_forest_field(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The pre-hydrology stream-power erosion (`erode` of `web/src/ui/reliefConditioning.ts`):
 * one call instead of one flood copy-out per step.
 * @param {Float32Array} height
 * @param {number} n
 * @param {number} cell_area
 * @param {number} steps
 * @param {number} deposit
 */
export function erode_relief(height, n, cell_area, steps, deposit) {
    var ptr0 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.erode_relief(ptr0, len0, height, n, cell_area, steps, deposit);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Effective erosion settings of a relief without overrides.
 * @param {string} relief
 * @param {number} width
 * @param {number} motif
 * @param {number} mix
 * @returns {Float64Array}
 */
export function erosion_defaults(relief, width, motif, mix) {
    const ptr0 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.erosion_defaults(ptr0, len0, width, motif, mix);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * Priority-flood from the sea, the map edge and the `outlet` cells, then D8
 * on the filled surface, upstream areas and basins. Empty `weight`, `outlet`
 * and `loss` slices mean none.
 * @param {Float32Array} height
 * @param {number} n
 * @param {number} cell_area
 * @param {Float32Array} weight
 * @param {Uint8Array} outlet
 * @param {Float32Array} loss
 * @returns {Flood}
 */
export function flood_hydrology(height, n, cell_area, weight, outlet, loss) {
    const ptr0 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(weight, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(outlet, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF32ToWasm0(loss, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.flood_hydrology(ptr0, len0, n, cell_area, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Flood.__wrap(ret[0]);
}

/**
 * @param {string} seed
 * @param {number} width
 * @param {string} relief
 * @param {number} erosion
 * @param {number} resolution
 * @returns {TerrainOutput}
 */
export function generate_terrain(seed, width, relief, erosion, resolution) {
    const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(relief, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.generate_terrain(ptr0, len0, width, ptr1, len1, erosion, resolution);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return TerrainOutput.__wrap(ret[0]);
}

/**
 * @param {string} request
 * @returns {string}
 */
export function landuse_farm(request) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(request, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.landuse_farm(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * @param {string} request
 * @returns {string}
 */
export function landuse_farm_tool(request) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(request, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.landuse_farm_tool(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * @param {string} request
 * @param {(x: number, y: number) => number} dir
 * @param {(x: number, y: number) => number} slope
 * @param {(x: number, y: number) => number} strips
 * @param {(ax: number, ay: number, bx: number, by: number) => boolean} clear
 * @param {(x: number, y: number) => number} noise
 * @param {() => number} random
 * @returns {string}
 */
export function landuse_field_tool(request, dir, slope, strips, clear, noise, random) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(request, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.landuse_field_tool(ptr0, len0, dir, slope, strips, clear, noise, random);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * @param {Uint8Array} base
 * @param {number} n
 * @param {number} cell
 * @param {string} footprints
 * @returns {Uint8Array}
 */
export function landuse_growth_reserve(base, n, cell, footprints) {
    const ptr0 = passArray8ToWasm0(base, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(footprints, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.landuse_growth_reserve(ptr0, len0, n, cell, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {string} header
 * @param {Uint8Array} planes
 * @returns {Uint8Array}
 */
export function landuse_stage(header, planes) {
    const ptr0 = passStringToWasm0(header, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(planes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.landuse_stage(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Float32Array} ind
 * @param {number} w
 * @param {number} h
 * @param {number} cell
 * @param {number} min_area
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {Uint8Array}
 */
export function landuse_vectorize(ind, w, h, cell, min_area, x0, y0, x1, y1) {
    const ptr0 = passArrayF32ToWasm0(ind, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.landuse_vectorize(ptr0, len0, w, h, cell, min_area, x0, y0, x1, y1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Canal pieces of a city's vector water: each group (a "shape" of the input
 * list whose rings are the group's rings) xor-ed. Returns a shape list.
 * @param {Float64Array} groups
 * @returns {Float64Array}
 */
export function render_city_canals(groups) {
    const ptr0 = passArrayF64ToWasm0(groups, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.render_city_canals(ptr0, len0);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * `CityGround.clip` of many subjects. `canals`: a shape list from
 * `render_city_canals`. Returns, per subject, -1 when the subject is unchanged,
 * otherwise its pieces as a shape list (piece count first).
 * @param {number} n
 * @param {number} width
 * @param {Uint8Array} water
 * @param {Float64Array} canals
 * @param {Float64Array} subjects
 * @returns {Float64Array}
 */
export function render_city_ground_clip(n, width, water, canals, subjects) {
    const ptr0 = passArray8ToWasm0(water, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(canals, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(subjects, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.render_city_ground_clip(n, width, ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * Signed distance to the zero contour of an n × n field, capped at `band`
 * (`coastDistances` of web/src/render/terrainSea.ts).
 * @param {Float32Array} height
 * @param {number} n
 * @param {number} cell
 * @param {number} band
 * @returns {Float32Array}
 */
export function render_coast_distances(height, n, cell, band) {
    const ptr0 = passArrayF32ToWasm0(height, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.render_coast_distances(ptr0, len0, n, cell, band);
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * Contour lines of several levels. Returns, per level, the path count then
 * per path `closed (0/1), points, x0, y0, ...`.
 * @param {Float32Array} field
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} levels
 * @param {number} cell
 * @param {number} ox
 * @param {number} oy
 * @returns {Float64Array}
 */
export function render_contour_levels(field, w, h, levels, cell, ox, oy) {
    const ptr0 = passArrayF32ToWasm0(field, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(levels, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.render_contour_levels(ptr0, len0, w, h, ptr1, len1, cell, ox, oy);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}

/**
 * Erosion overrides (NaN: relief default) for the engines and GPU plans built next,
 * in `EROSION_TUNING` order (`crates/core/src/erosion.rs`).
 * @param {Float64Array} values
 */
export function set_erosion_tuning(values) {
    const ptr0 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.set_erosion_tuning(ptr0, len0);
}

/**
 * Framed request in (u32 header length, JSON header, planes), framed reply out: see `core/src/site.rs`.
 * @param {Uint8Array} request
 * @returns {Uint8Array}
 */
export function site_choose(request) {
    const ptr0 = passArray8ToWasm0(request, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.site_choose(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * u32 LE header length, padded JSON, then LE planes (same as /terrain/water).
 * @param {Uint8Array} body
 * @returns {Uint8Array}
 */
export function vector_water_request(body) {
    const ptr0 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vector_water_request(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Whether this build runs the urban stages on a rayon pool (`threads`
 * feature, shared memory). The JS loader still has to call `initThreadPool`.
 * @returns {boolean}
 */
export function wasm_threads() {
    const ret = wasm.wasm_threads();
    return ret !== 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_88899a52af046901: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_6ed8c2cd62bb734d: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        },
        __wbg_call_7bd515d15def364d: function(arg0, arg1, arg2, arg3, arg4, arg5) {
            const ret = arg0.call(arg1, arg2, arg3, arg4, arg5);
            return ret;
        },
        __wbg_call_abb4c168c5062dc3: function(arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        },
        __wbg_now_96248082994f0927: function() {
            const ret = performance.now();
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./magna_urbis_wasm_bg.js": import0,
    };
}

const FloodFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_flood_free(ptr, 1));
const GenerationNoisePlanFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_generationnoiseplan_free(ptr, 1));
const HydrologyEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hydrologyengine_free(ptr, 1));
const HydrologyOutputFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hydrologyoutput_free(ptr, 1));
const SettlementTerrainFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_settlementterrain_free(ptr, 1));
const TerrainEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_terrainengine_free(ptr, 1));
const TerrainOutputFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_terrainoutput_free(ptr, 1));
const TerrainPipelineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_terrainpipeline_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('magna_urbis_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
