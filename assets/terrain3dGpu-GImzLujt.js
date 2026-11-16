import{r as _e,b as ne}from"./boxMips-DsLaOiwJ.js";import{u as le,i as te,o as fe,j as ae,k as re}from"./__vite-browser-external-D__LGgrB.js";import{a as A,g as oe,b as ce}from"./rendererOverride-V4g9Uz3w.js";import{V as ie,X as Z}from"./terrainFingerprint-Dkjm8AnE.js";import{a as ve,T as se,f as de,p as ue,c as pe,b as ge,d as he,U as me,S as xe}from"./terrain3d-Dm27AbNI.js";import"./v2-2hlGoQKW.js";import"./terrainGround-Bjaols_p.js";import"./vectorWaterRender-D9UHeAs_.js";import"./riverHeadwaters-B3inT2I_.js";import"./terrain3dBillboards-CEwQxVLK.js";/*! polygon-clipping 0.15.7
The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca> - covers everything not specially attributed to others below.

Copyright (c) 2016 Alexander Milevski <info@w8r.name> - covers all portions originally part of github:w8r/martinez, from which this project was forked on Febuary 2, 2018.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/const Y={groundEnabled:0,uRenderV2:1,uForest:2,uForestBrushes:3},W={terrain:{size:1680,fields:{matrix:{offset:0,type:"mat4",count:0},exaggeration:{offset:64,type:"float",count:0},morph:{offset:68,type:"float",count:0},patchOffset:{offset:80,type:"vec3",count:0},physicalOrigin:{offset:96,type:"vec3",count:0},textureRect:{offset:112,type:"vec4",count:0},previousRect:{offset:128,type:"vec4",count:0},textureBlend:{offset:144,type:"float",count:0},eye:{offset:160,type:"vec3",count:0},fogDistance:{offset:172,type:"float",count:0},proceduralPreview:{offset:176,type:"int",count:0},showTileBounds:{offset:180,type:"int",count:0},groundEye:{offset:192,type:"vec3",count:0},groundLight:{offset:208,type:"vec3",count:0},groundLight2:{offset:224,type:"vec3",count:0},groundStrength:{offset:236,type:"float",count:0},macroRect:{offset:240,type:"vec3",count:0},uShoreRingRect:{offset:256,type:"vec3",count:0},macroN:{offset:268,type:"int",count:0},patchRect:{offset:272,type:"vec3",count:0},groundContours:{offset:284,type:"int",count:0},groundContourColor:{offset:288,type:"vec3",count:0},groundContourStep:{offset:300,type:"float",count:0},groundContourOpacity:{offset:304,type:"float",count:0},groundFlatSlope:{offset:308,type:"float",count:0},hasSemanticTile:{offset:312,type:"int",count:0},hasPreviousSemanticTile:{offset:316,type:"int",count:0},semanticRect:{offset:320,type:"vec4",count:0},previousSemanticRect:{offset:336,type:"vec4",count:0},groundRect:{offset:352,type:"vec4",count:0},previousGroundRect:{offset:368,type:"vec4",count:0},hasGroundTile:{offset:384,type:"int",count:0},hasPreviousGroundTile:{offset:388,type:"int",count:0},uUnderdark:{offset:392,type:"int",count:0},uHasCave:{offset:396,type:"int",count:0},uTownGlow:{offset:400,type:"vec4",count:16},uTownGlowCount:{offset:656,type:"int",count:0},uNaturalWater:{offset:660,type:"int",count:0},uNight:{offset:664,type:"int",count:0},displayWaterVisible:{offset:668,type:"int",count:0},displayWaterBand:{offset:672,type:"float",count:0},hasCanopyWater:{offset:676,type:"int",count:0},hasPreviousCanopyWater:{offset:680,type:"int",count:0},canopyWaterRect:{offset:688,type:"vec3",count:0},previousCanopyWaterRect:{offset:704,type:"vec3",count:0},uWaterSeason:{offset:720,type:"vec2",count:0},hasRaisedMaterial:{offset:728,type:"int",count:0},hasPreviousRaisedMaterial:{offset:732,type:"int",count:0},raisedBlend:{offset:736,type:"float",count:0},uV2Season:{offset:740,type:"float",count:0},uV2WaterVisible:{offset:744,type:"int",count:0},uMaterialZone:{offset:748,type:"int",count:0},uV2Calendar:{offset:752,type:"int",count:0},uV2CalLeaf:{offset:768,type:"vec4",count:0},uV2CalIce:{offset:784,type:"vec4",count:0},uV2CalThaw:{offset:800,type:"vec4",count:0},uV2CalClimate:{offset:816,type:"vec4",count:0},uV2CalSnow:{offset:832,type:"vec4",count:0},uForestTrees:{offset:848,type:"vec4",count:0},uForestRect:{offset:864,type:"vec3",count:0},uHasForestBank:{offset:876,type:"int",count:0},uForestBankDensity:{offset:880,type:"float",count:0},uHasOccupation:{offset:884,type:"int",count:0},uOccupationRect:{offset:896,type:"vec3",count:0},uOccupationN:{offset:908,type:"float",count:0},uHasForestBeach:{offset:912,type:"int",count:0},uForestBeachRect:{offset:928,type:"vec3",count:0},uQuality:{offset:940,type:"int",count:0},uMaterialSeed:{offset:944,type:"uint",count:0},uMaterialClimate:{offset:952,type:"vec2",count:0},uGroundCover:{offset:960,type:"vec4",count:0},uHasLandDetail:{offset:976,type:"int",count:0},uLandDetailRect:{offset:992,type:"vec3",count:0},uLandDetailN:{offset:1004,type:"float",count:0},uHasAux:{offset:1008,type:"int",count:0},uPaperMap:{offset:1012,type:"int",count:0},uV2GlacierSources:{offset:1024,type:"vec4",count:8},uFarmBeds:{offset:1152,type:"vec4",count:32},uFarmBedCount:{offset:1664,type:"int",count:0}}},sky:{size:16,fields:{height:{offset:0,type:"float",count:0},uNight:{offset:4,type:"int",count:0}}},building:{size:144,fields:{matrix:{offset:0,type:"mat4",count:0},offset:{offset:64,type:"vec3",count:0},exaggeration:{offset:76,type:"float",count:0},sectorOrigin:{offset:80,type:"vec2",count:0},uNight:{offset:88,type:"int",count:0},material:{offset:96,type:"vec3",count:0},tint:{offset:112,type:"vec3",count:0},recolored:{offset:124,type:"int",count:0},useTex:{offset:128,type:"int",count:0},softFrom:{offset:132,type:"float",count:0}}},billboard:{size:128,fields:{matrix:{offset:0,type:"mat4",count:0},cameraOrigin:{offset:64,type:"vec3",count:0},cameraRight:{offset:80,type:"vec2",count:0},exaggeration:{offset:88,type:"float",count:0},raisedBlend:{offset:92,type:"float",count:0},eye:{offset:96,type:"vec3",count:0},fogDistance:{offset:108,type:"float",count:0},uNight:{offset:112,type:"int",count:0}}},tree:{size:144,fields:{matrix:{offset:0,type:"mat4",count:0},cameraOrigin:{offset:64,type:"vec3",count:0},exaggeration:{offset:76,type:"float",count:0},treeFade:{offset:80,type:"vec4",count:0},eye:{offset:96,type:"vec3",count:0},treeLight:{offset:112,type:"vec3",count:0},fogDistance:{offset:124,type:"float",count:0},uNight:{offset:128,type:"int",count:0}}}},$={material:5,previousMaterial:6,macroField:7,uShoreRing:8,canopyWater:9,previousCanopyWater:10,uForestField:11,uForestBank:12,uOccupation:13,uForestBeach:14,uForestBrushAtlas:15,albedoTex:16,normalTex:17,uAux:18,semanticTile:19,previousSemanticTile:20,drapedMaterial:21,previousDrapedMaterial:22,billboardAtlas:23,uLandDetail:24},we=`struct TerrainParams {
    matrix: mat4x4<f32>,
    exaggeration: f32,
    morph: f32,
    patchOffset: vec3<f32>,
    physicalOrigin: vec3<f32>,
    textureRect: vec4<f32>,
    previousRect: vec4<f32>,
    textureBlend: f32,
    eye: vec3<f32>,
    fogDistance: f32,
    proceduralPreview: i32,
    showTileBounds: i32,
    groundEye: vec3<f32>,
    groundLight: vec3<f32>,
    groundLight2_: vec3<f32>,
    groundStrength: f32,
    macroRect: vec3<f32>,
    uShoreRingRect: vec3<f32>,
    macroN: i32,
    patchRect: vec3<f32>,
    groundContours: i32,
    groundContourColor: vec3<f32>,
    groundContourStep: f32,
    groundContourOpacity: f32,
    groundFlatSlope: f32,
    hasSemanticTile: i32,
    hasPreviousSemanticTile: i32,
    semanticRect: vec4<f32>,
    previousSemanticRect: vec4<f32>,
    groundRect: vec4<f32>,
    previousGroundRect: vec4<f32>,
    hasGroundTile: i32,
    hasPreviousGroundTile: i32,
    uUnderdark: i32,
    uHasCave: i32,
    uTownGlow: array<vec4<f32>, 16>,
    uTownGlowCount: i32,
    uNaturalWater: i32,
    uNight: i32,
    displayWaterVisible: i32,
    displayWaterBand: f32,
    hasCanopyWater: i32,
    hasPreviousCanopyWater: i32,
    canopyWaterRect: vec3<f32>,
    previousCanopyWaterRect: vec3<f32>,
    uWaterSeason: vec2<f32>,
    hasRaisedMaterial: i32,
    hasPreviousRaisedMaterial: i32,
    raisedBlend: f32,
    uV2Season: f32,
    uV2WaterVisible: i32,
    uMaterialZone: i32,
    uV2Calendar: i32,
    uV2CalLeaf: vec4<f32>,
    uV2CalIce: vec4<f32>,
    uV2CalThaw: vec4<f32>,
    uV2CalClimate: vec4<f32>,
    uV2CalSnow: vec4<f32>,
    uForestTrees: vec4<f32>,
    uForestRect: vec3<f32>,
    uHasForestBank: i32,
    uForestBankDensity: f32,
    uHasOccupation: i32,
    uOccupationRect: vec3<f32>,
    uOccupationN: f32,
    uHasForestBeach: i32,
    uForestBeachRect: vec3<f32>,
    uQuality: i32,
    uMaterialSeed: u32,
    uMaterialClimate: vec2<f32>,
    uGroundCover: vec4<f32>,
    uHasLandDetail: i32,
    uLandDetailRect: vec3<f32>,
    uLandDetailN: f32,
    uHasAux: i32,
    uPaperMap: i32,
    uV2GlacierSources: array<vec4<f32>, 8>,
    uFarmBeds: array<vec4<f32>, 32>,
    uFarmBedCount: i32,
}

struct VertexOutput {
    @location(0) texcoord: vec2<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) world: vec3<f32>,
    @location(3) physical: vec3<f32>,
    @location(4) physicalSlope: vec2<f32>,
    @builtin(position) gl_Position: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: TerrainParams;
var<private> position_1: vec3<f32>;
var<private> uv_1: vec2<f32>;
var<private> gradient_1: vec2<f32>;
var<private> parentHeight_1: f32;
var<private> parentGradient_1: vec2<f32>;
var<private> seamCorrection_1: vec3<f32>;
var<private> texcoord: vec2<f32>;
var<private> normal: vec3<f32>;
var<private> world: vec3<f32>;
var<private> physical: vec3<f32>;
var<private> physicalSlope: vec2<f32>;
var<private> gl_Position: vec4<f32>;

fn main_1() {
    var height: f32;
    var slope: vec2<f32>;

    let _e169 = parentHeight_1;
    let _e170 = position_1;
    let _e172 = global.morph;
    let _e174 = seamCorrection_1;
    height = (mix(_e169, _e170.y, _e172) + _e174.x);
    let _e178 = parentGradient_1;
    let _e179 = gradient_1;
    let _e180 = global.morph;
    let _e183 = seamCorrection_1;
    slope = (mix(_e178, _e179, vec2(_e180)) + _e183.yz);
    let _e187 = position_1;
    let _e189 = height;
    let _e190 = global.exaggeration;
    let _e192 = position_1;
    let _e195 = global.patchOffset;
    world = (vec3<f32>(_e187.x, (_e189 * _e190), _e192.z) + _e195);
    let _e197 = slope;
    let _e200 = global.exaggeration;
    let _e203 = slope;
    let _e206 = global.exaggeration;
    normal = normalize(vec3<f32>((-(_e197.x) * _e200), 1f, (-(_e203.y) * _e206)));
    let _e210 = position_1;
    let _e212 = height;
    let _e213 = position_1;
    let _e216 = global.physicalOrigin;
    physical = (vec3<f32>(_e210.x, _e212, _e213.z) + _e216);
    let _e218 = slope;
    physicalSlope = _e218;
    let _e219 = uv_1;
    texcoord = _e219;
    let _e221 = global.matrix;
    let _e222 = world;
    gl_Position = (_e221 * vec4<f32>(_e222.x, _e222.y, _e222.z, 1f));
    let _e230 = gl_Position;
    let _e232 = gl_Position;
    gl_Position.z = ((_e230.z + _e232.w) * 0.5f);
    return;
}

@vertex 
fn main(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>, @location(2) gradient: vec2<f32>, @location(3) parentHeight: f32, @location(4) parentGradient: vec2<f32>, @location(5) seamCorrection: vec3<f32>) -> VertexOutput {
    position_1 = position;
    uv_1 = uv;
    gradient_1 = gradient;
    parentHeight_1 = parentHeight;
    parentGradient_1 = parentGradient;
    seamCorrection_1 = seamCorrection;
    main_1();
    let _e193 = texcoord;
    let _e195 = normal;
    let _e197 = world;
    let _e199 = physical;
    let _e201 = physicalSlope;
    let _e203 = gl_Position;
    return VertexOutput(_e193, _e195, _e197, _e199, _e201, _e203);
}
`,be=`diagnostic(off, derivative_uniformity);
struct TerrainParams {
    matrix: mat4x4<f32>,
    exaggeration: f32,
    morph: f32,
    patchOffset: vec3<f32>,
    physicalOrigin: vec3<f32>,
    textureRect: vec4<f32>,
    previousRect: vec4<f32>,
    textureBlend: f32,
    eye: vec3<f32>,
    fogDistance: f32,
    proceduralPreview: i32,
    showTileBounds: i32,
    groundEye: vec3<f32>,
    groundLight: vec3<f32>,
    groundLight2_: vec3<f32>,
    groundStrength: f32,
    macroRect: vec3<f32>,
    uShoreRingRect: vec3<f32>,
    macroN: i32,
    patchRect: vec3<f32>,
    groundContours: i32,
    groundContourColor: vec3<f32>,
    groundContourStep: f32,
    groundContourOpacity: f32,
    groundFlatSlope: f32,
    hasSemanticTile: i32,
    hasPreviousSemanticTile: i32,
    semanticRect: vec4<f32>,
    previousSemanticRect: vec4<f32>,
    groundRect: vec4<f32>,
    previousGroundRect: vec4<f32>,
    hasGroundTile: i32,
    hasPreviousGroundTile: i32,
    uUnderdark: i32,
    uHasCave: i32,
    uTownGlow: array<vec4<f32>, 16>,
    uTownGlowCount: i32,
    uNaturalWater: i32,
    uNight: i32,
    displayWaterVisible: i32,
    displayWaterBand: f32,
    hasCanopyWater: i32,
    hasPreviousCanopyWater: i32,
    canopyWaterRect: vec3<f32>,
    previousCanopyWaterRect: vec3<f32>,
    uWaterSeason: vec2<f32>,
    hasRaisedMaterial: i32,
    hasPreviousRaisedMaterial: i32,
    raisedBlend: f32,
    uV2Season: f32,
    uV2WaterVisible: i32,
    uMaterialZone: i32,
    uV2Calendar: i32,
    uV2CalLeaf: vec4<f32>,
    uV2CalIce: vec4<f32>,
    uV2CalThaw: vec4<f32>,
    uV2CalClimate: vec4<f32>,
    uV2CalSnow: vec4<f32>,
    uForestTrees: vec4<f32>,
    uForestRect: vec3<f32>,
    uHasForestBank: i32,
    uForestBankDensity: f32,
    uHasOccupation: i32,
    uOccupationRect: vec3<f32>,
    uOccupationN: f32,
    uHasForestBeach: i32,
    uForestBeachRect: vec3<f32>,
    uQuality: i32,
    uMaterialSeed: u32,
    uMaterialClimate: vec2<f32>,
    uGroundCover: vec4<f32>,
    uHasLandDetail: i32,
    uLandDetailRect: vec3<f32>,
    uLandDetailN: f32,
    uHasAux: i32,
    uPaperMap: i32,
    uV2GlacierSources: array<vec4<f32>, 8>,
    uFarmBeds: array<vec4<f32>, 32>,
    uFarmBedCount: i32,
}

struct GroundMaterial {
    albedo: vec3<f32>,
    normal: vec3<f32>,
    roughness: f32,
    occlusion: f32,
}

struct ForestStand {
    p: vec2<f32>,
    cover: f32,
    height: f32,
    needle: f32,
    tone: f32,
    kappa: f32,
    trop: f32,
    dry: f32,
    open: f32,
    forced: f32,
    allow: f32,
    hedge: f32,
    orchard: bool,
    rows: vec2<f32>,
}

struct ForestPatch {
    base: vec2<i32>,
    centre: vec2<f32>,
    glade: vec3<f32>,
}

struct ForestCrown {
    c: vec2<f32>,
    r: f32,
    h: f32,
    depth: f32,
    needle: bool,
    alive: bool,
    riparian: bool,
    edge: f32,
    id: u32,
}

struct ForestHit {
    cover: f32,
    top: f32,
    second: f32,
    slope: vec2<f32>,
    rel: f32,
    local: vec2<f32>,
    r: f32,
    needle: bool,
    riparian: bool,
    edge: f32,
    id: u32,
    level: i32,
    near: f32,
    ink: f32,
}

struct ForestPrep {
    st: ForestStand,
    fp: f32,
    lod: f32,
    standLod: f32,
    reveal: f32,
    openA: f32,
    openW: f32,
    forcedA: f32,
    hedgeA: f32,
    humid: f32,
    cold: f32,
    radius: f32,
    crownVis: f32,
    fringe: f32,
    galleryNear: f32,
    valid: bool,
}

struct ForestCanopy {
    cover: f32,
    shade: f32,
    near: f32,
    rel: f32,
    slope: vec2<f32>,
    edge: f32,
    tint: f32,
    ink: f32,
    needle: bool,
    riparian: bool,
}

struct V2Env {
    temperature: f32,
    potential: f32,
    moisture: f32,
    exposure: f32,
    mineral: f32,
    sand: f32,
    clay: f32,
    organic: f32,
    rock: f32,
    grass: f32,
    woody: f32,
    height: f32,
    needle: f32,
    leaf: f32,
    snow: f32,
    ice: f32,
    tone: f32,
    glacier: f32,
    world: vec2<f32>,
    slope: f32,
    footprint: f32,
    seed: u32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

const V2_ZONE_FOREST: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(1f, 0.12f, 0.45f, 0.25f), vec4<f32>(0.62f, 0.3f, 0.45f, 0f), vec4<f32>(1f, 0.55f, 0.55f, 0.15f), vec4<f32>(1f, 0.92f, 0.75f, 0.45f), vec4<f32>(1f, 0.9f, 0.85f, 0.05f), vec4<f32>(0.05f, 0.98f, 0.95f, 0.45f), vec4<f32>(0.22f, 0.2f, 0.5f, 0.08f), vec4<f32>(0.12f, 0f, 1f, 0f), vec4<f32>(0.42f, 0f, 1f, 0.1f), vec4<f32>(1f, 0f, 1f, 0.55f), vec4<f32>(0.55f, 0.08f, 0.7f, 1f));
const V2_ZONE_SOIL: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0f, 0f, 0.05f, 1f), vec4<f32>(0.35f, 0f, -0.1f, 0.75f), vec4<f32>(0f, 0f, 0.05f, 1f), vec4<f32>(0.6f, 0f, 0.12f, 0.95f), vec4<f32>(0.3f, 0f, 0f, 1f), vec4<f32>(0.45f, 0f, 0.15f, 0.9f), vec4<f32>(0f, 0.06f, 0f, 1f), vec4<f32>(0.25f, 0.55f, -0.2f, 0.12f), vec4<f32>(0f, 0.1f, 0f, 1f), vec4<f32>(0f, 0f, 0.1f, 1f), vec4<f32>(-0.4f, 0f, 0.45f, 1f));
const V2_ZONE_SWARD: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0.29f, 0.39f, 0.17f, 0.35f), vec4<f32>(0.5f, 0.5f, 0.36f, 0.6f), vec4<f32>(0.33f, 0.4f, 0.2f, 0.3f), vec4<f32>(0.3f, 0.36f, 0.21f, 0.4f), vec4<f32>(0.33f, 0.45f, 0.19f, 0.45f), vec4<f32>(0.44f, 0.44f, 0.33f, 0.6f), vec4<f32>(0.58f, 0.56f, 0.34f, 0.65f), vec4<f32>(0.66f, 0.6f, 0.46f, 0.7f), vec4<f32>(0.72f, 0.61f, 0.33f, 0.8f), vec4<f32>(0.22f, 0.37f, 0.14f, 0.45f), vec4<f32>(0.31f, 0.38f, 0.2f, 0.45f));
const V2_ZONE_BARE: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0.42f, 0.36f, 0.27f, 0.2f), vec4<f32>(0.78f, 0.75f, 0.66f, 0.72f), vec4<f32>(0.4f, 0.35f, 0.27f, 0.2f), vec4<f32>(0.52f, 0.5f, 0.48f, 0.55f), vec4<f32>(0.6f, 0.6f, 0.58f, 0.55f), vec4<f32>(0.34f, 0.33f, 0.31f, 0.55f), vec4<f32>(0.58f, 0.52f, 0.4f, 0.4f), vec4<f32>(0.77f, 0.69f, 0.55f, 0.82f), vec4<f32>(0.67f, 0.46f, 0.31f, 0.5f), vec4<f32>(0.52f, 0.34f, 0.23f, 0.4f), vec4<f32>(0.23f, 0.21f, 0.15f, 0.5f));
const V2_ZONE_CANOPY: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(1f, 1f, 1f, 0.1f), vec4<f32>(1.06f, 1.03f, 0.86f, 0.55f), vec4<f32>(0.97f, 1f, 1f, 0.05f), vec4<f32>(0.86f, 0.95f, 1.02f, 0.1f), vec4<f32>(0.9f, 0.97f, 1f, 0.05f), vec4<f32>(1.05f, 1f, 0.9f, 0.15f), vec4<f32>(1.05f, 1.03f, 0.86f, 0.2f), vec4<f32>(1f, 1.06f, 0.86f, 0f), vec4<f32>(1.1f, 1.05f, 0.76f, 0.6f), vec4<f32>(0.86f, 1.1f, 0.86f, 0.1f), vec4<f32>(1f, 1.02f, 0.9f, 0.2f));
const V2_ZONE_WET: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0.27f, 0.38f, 0.18f, 0f), vec4<f32>(0.4f, 0.42f, 0.28f, 0f), vec4<f32>(0.28f, 0.36f, 0.2f, 0.5f), vec4<f32>(0.36f, 0.33f, 0.22f, 1f), vec4<f32>(0.3f, 0.4f, 0.2f, 3.5f), vec4<f32>(0.42f, 0.4f, 0.27f, 2f), vec4<f32>(0.42f, 0.46f, 0.27f, 0f), vec4<f32>(0.3f, 0.4f, 0.2f, 0f), vec4<f32>(0.36f, 0.42f, 0.22f, 0f), vec4<f32>(0.36f, 0.56f, 0.24f, 0f), vec4<f32>(0.3f, 0.29f, 0.18f, 0f));
const V2_ZONE_UNITS: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4(0f), vec4<f32>(0f, 0f, 0.05f, 0f), vec4(0f), vec4<f32>(0f, 0.04f, 0.08f, 0f), vec4<f32>(0f, 0.06f, 0.1f, 0f), vec4<f32>(0f, 0.14f, 0.12f, 0f), vec4<f32>(0f, 0.05f, 0f, 0.04f), vec4<f32>(0.45f, 0.3f, 0.06f, 0.03f), vec4<f32>(0f, 0f, 0.05f, 0.02f), vec4(0f), vec4(0f));
const V2_ZONE_PAVEMENT: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0.45f, 0.43f, 0.4f, 0f), vec4<f32>(0.63f, 0.6f, 0.53f, 0f), vec4<f32>(0.45f, 0.43f, 0.4f, 0f), vec4<f32>(0.34f, 0.35f, 0.33f, 0.6f), vec4<f32>(0.42f, 0.42f, 0.41f, 0.8f), vec4<f32>(0.34f, 0.33f, 0.31f, 1f), vec4<f32>(0.5f, 0.46f, 0.4f, 0f), vec4<f32>(0.36f, 0.31f, 0.27f, 0f), vec4<f32>(0.45f, 0.32f, 0.24f, 0f), vec4<f32>(0.45f, 0.3f, 0.22f, 0f), vec4<f32>(0.4f, 0.38f, 0.34f, 0f));
const V2_ZONE_GRAVEL: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0.5f, 0.46f, 0.4f, 0f), vec4<f32>(0.66f, 0.62f, 0.54f, 0f), vec4<f32>(0.5f, 0.46f, 0.4f, 0f), vec4<f32>(0.58f, 0.57f, 0.54f, 0f), vec4<f32>(0.64f, 0.63f, 0.61f, 0f), vec4<f32>(0.54f, 0.53f, 0.5f, 0f), vec4<f32>(0.6f, 0.55f, 0.45f, 0.25f), vec4<f32>(0.69f, 0.61f, 0.48f, 0.8f), vec4<f32>(0.6f, 0.44f, 0.32f, 0.3f), vec4<f32>(0.5f, 0.4f, 0.3f, 0f), vec4<f32>(0.45f, 0.42f, 0.36f, 0f));
const V2_ZONE_PAN: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.76f, 0.73f, 0.66f, 0.6f), vec4<f32>(0.85f, 0.81f, 0.72f, 1f), vec4<f32>(0.74f, 0.67f, 0.55f, 0.7f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f), vec4<f32>(0.8f, 0.78f, 0.72f, 0f));
const V2_SEASON_HERB: array<vec3<f32>, 44> = array<vec3<f32>, 44>(vec3<f32>(0.86f, 0.8f, 0.7f), vec3<f32>(0.98f, 1.12f, 0.9f), vec3<f32>(0.96f, 1.06f, 0.92f), vec3<f32>(1.06f, 0.96f, 0.78f), vec3<f32>(0.9f, 1.08f, 0.86f), vec3<f32>(0.92f, 1.12f, 0.84f), vec3<f32>(1.18f, 1.02f, 0.74f), vec3<f32>(1.1f, 0.98f, 0.78f), vec3<f32>(0.85f, 0.8f, 0.72f), vec3<f32>(0.96f, 1.12f, 0.9f), vec3<f32>(0.97f, 1.05f, 0.93f), vec3<f32>(1.08f, 0.94f, 0.74f), vec3<f32>(0.8f, 0.76f, 0.72f), vec3<f32>(0.94f, 1.04f, 0.88f), vec3<f32>(0.98f, 1.04f, 0.96f), vec3<f32>(1.08f, 0.94f, 0.76f), vec3<f32>(0.85f, 0.82f, 0.76f), vec3<f32>(0.98f, 1.1f, 0.9f), vec3<f32>(1f, 1.06f, 0.96f), vec3<f32>(1.07f, 0.95f, 0.78f), vec3<f32>(0.9f, 0.88f, 0.86f), vec3<f32>(0.92f, 0.92f, 0.84f), vec3<f32>(0.98f, 1.02f, 0.88f), vec3<f32>(1.12f, 0.9f, 0.72f), vec3<f32>(0.92f, 0.86f, 0.76f), vec3<f32>(0.86f, 1.14f, 0.82f), vec3<f32>(1.06f, 0.98f, 0.84f), vec3<f32>(1.04f, 0.94f, 0.8f), vec3<f32>(0.9f, 0.9f, 0.92f), vec3<f32>(0.96f, 1.02f, 0.9f), vec3<f32>(1.08f, 1f, 0.88f), vec3<f32>(1.02f, 0.97f, 0.9f), vec3<f32>(1.12f, 1f, 0.74f), vec3<f32>(1.04f, 1.02f, 0.8f), vec3<f32>(0.72f, 1.14f, 0.74f), vec3<f32>(0.92f, 1.08f, 0.78f), vec3<f32>(1.1f, 1.02f, 0.82f), vec3<f32>(1f, 1.02f, 0.96f), vec3<f32>(0.92f, 1.06f, 0.92f), vec3<f32>(0.96f, 1.04f, 0.94f), vec3<f32>(0.92f, 0.84f, 0.7f), vec3<f32>(0.92f, 1.14f, 0.9f), vec3<f32>(0.96f, 1.07f, 0.92f), vec3<f32>(1.08f, 0.95f, 0.74f));
const V2_SEASON_LEAF: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0f, 0.62f, 1f, 0.85f), vec4<f32>(0.82f, 0.92f, 1f, 0.95f), vec4<f32>(0f, 0.55f, 1f, 0.8f), vec4<f32>(0f, 0.4f, 1f, 0.75f), vec4<f32>(0f, 0.4f, 1f, 0.75f), vec4<f32>(0f, 0.3f, 1f, 0.65f), vec4<f32>(0f, 0.6f, 1f, 0.7f), vec4<f32>(0.9f, 1f, 1f, 0.95f), vec4<f32>(0.3f, 0.55f, 1f, 0.8f), vec4<f32>(0.85f, 0.95f, 1f, 1f), vec4<f32>(0f, 0.62f, 1f, 0.85f));
const V2_SEASON_ICE: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0.55f, 0.1f, 0f, 0f), vec4<f32>(0.75f, 0.3f, 0f, 0.05f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0.82f, 0.82f, 0.76f, 0.8f), vec4<f32>(0.3f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0.1f, 0f, 0f, 0f));
const V2_SEASON_WET: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(1f, 1f, 1f, 1f), vec4<f32>(0.2f, 0.6f, 1.6f, 1.1f), vec4<f32>(0.7f, 0.9f, 1.3f, 1.2f), vec4<f32>(0.9f, 1.35f, 0.75f, 1f));
const V2_SEASON_THAW: array<vec4<f32>, 11> = array<vec4<f32>, 11>(vec4<f32>(0f, 5.3f, 0f, 3f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 10.5f, 0f, 4f), vec4<f32>(0f, 4.5f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, -3.5f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 0f, 0f, 0f), vec4<f32>(0f, 5.3f, 0f, 3f));
const V2_SEASON_CLIMATE: array<vec3<f32>, 11> = array<vec3<f32>, 11>(vec3<f32>(0.1f, 1f, 0f), vec3<f32>(-0.75f, 0f, 0f), vec3<f32>(0.25f, 6f, 0.1f), vec3<f32>(0f, 7f, 0.12f), vec3<f32>(0.15f, 9f, 0.35f), vec3<f32>(0.2f, 6f, 0f), vec3<f32>(0.3f, 6f, 0f), vec3<f32>(0f, 0f, 0f), vec3<f32>(0.95f, 0f, 0f), vec3<f32>(0.45f, 0f, 0f), vec3<f32>(0f, 2f, 0f));
const ROCK_STRATA: f32 = 1f;
const ROCK_FACETS: f32 = 1f;
const ROCK_STREAKS: f32 = 1f;
const groundWavelength: array<f32, 4> = array<f32, 4>(8f, 2.2f, 0.32f, 0.055f);
const groundAmplitude: array<f32, 4> = array<f32, 4>(0.17f, 0.04f, 0.012f, 0.002f);
const groundAspect: array<f32, 4> = array<f32, 4>(0.35f, 0.24f, 0.85f, 0.72f);
const groundFilterWidth: array<f32, 4> = array<f32, 4>(1f, 0.5f, 0.5f, 1f);
const groundRotationC: array<f32, 4> = array<f32, 4>(0.8f, -0.6f, 0.28f, -0.96f);
const groundRotationS: array<f32, 4> = array<f32, 4>(0.6f, 0.8f, 0.96f, 0.28f);
const groundVarianceFactor: array<f32, 4> = array<f32, 4>(0.2f, 1.8f, 1.3f, 0.4f);
const forestTauTable: array<f32, 33> = array<f32, 33>(0f, 0.0211f, 0.0446f, 0.066f, 0.0881f, 0.1113f, 0.1338f, 0.1573f, 0.182f, 0.2051f, 0.2303f, 0.2538f, 0.2796f, 0.3045f, 0.3293f, 0.3546f, 0.3816f, 0.4091f, 0.435f, 0.4636f, 0.4895f, 0.5188f, 0.5472f, 0.5668f, 0.586f, 0.6063f, 0.6289f, 0.6524f, 0.6805f, 0.7112f, 0.751f, 0.8099f, 1f);
const forestPatchCdf: array<f32, 17> = array<f32, 17>(0f, 0f, 0.0001f, 0.001f, 0.0085f, 0.0401f, 0.1202f, 0.2729f, 0.5009f, 0.7274f, 0.8801f, 0.9598f, 0.9914f, 0.999f, 0.9999f, 1f, 1f);
const forestCrownCdf: array<f32, 17> = array<f32, 17>(0f, 0f, 0f, 0.0005f, 0.0063f, 0.0336f, 0.1125f, 0.2742f, 0.4998f, 0.7261f, 0.8874f, 0.9665f, 0.9936f, 0.9994f, 1f, 1f, 1f);
const FOREST_PATCH: f32 = 56f;
const FOREST_LOBE: f32 = 14f;
const FOREST_LONE: f32 = 24f;
const FOREST_GLADE: f32 = 210f;
const FOREST_GLADE_FRAME: mat2x2<f32> = mat2x2<f32>(vec2<f32>(0.83f, 0.39f), vec2<f32>(-0.21f, 1.27f));
const FOREST_BARE: f32 = 0.335f;
const GARDEN_BEDS: array<vec3<f32>, 8> = array<vec3<f32>, 8>(vec3<f32>(0.34f, 0.28f, 0.21f), vec3<f32>(0.37f, 0.42f, 0.25f), vec3<f32>(0.28f, 0.36f, 0.21f), vec3<f32>(0.32f, 0.37f, 0.26f), vec3<f32>(0.4f, 0.45f, 0.25f), vec3<f32>(0.5f, 0.45f, 0.33f), vec3<f32>(0.48f, 0.46f, 0.31f), vec3<f32>(0.27f, 0.36f, 0.2f));
const V2_CROWN_AMBIENT: vec2<f32> = vec2<f32>(0.3766294f, 0.34189487f);
const V2_CROWN_RESPONSE: array<vec4<f32>, 19> = array<vec4<f32>, 19>(vec4<f32>(0.05495809f, 0.0013764778f, 0.08137881f, 0.0020390463f), vec4<f32>(0.066055395f, 0.001541067f, 0.08850629f, 0.0020669752f), vec4<f32>(0.07783681f, 0.0017119818f, 0.095201634f, 0.0020981387f), vec4<f32>(0.09020807f, 0.0018873867f, 0.10143083f, 0.0021297745f), vec4<f32>(0.10311157f, 0.0020662295f, 0.10719746f, 0.002161111f), vec4<f32>(0.11649999f, 0.002247855f, 0.112457864f, 0.002190355f), vec4<f32>(0.13033146f, 0.002432014f, 0.11722252f, 0.002217979f), vec4<f32>(0.14456406f, 0.002618785f, 0.121541254f, 0.0022458134f), vec4<f32>(0.15913282f, 0.0028080365f, 0.12548193f, 0.0022760672f), vec4<f32>(0.17388634f, 0.002997934f, 0.12920947f, 0.0023133466f), vec4<f32>(0.18827625f, 0.003177238f, 0.13293578f, 0.002362944f), vec4<f32>(0.20132901f, 0.0033263683f, 0.13726775f, 0.0024406172f), vec4<f32>(0.21284945f, 0.0034477315f, 0.14394931f, 0.0025913042f), vec4<f32>(0.22274995f, 0.0035451497f, 0.15064499f, 0.0027281195f), vec4<f32>(0.2309552f, 0.0036214865f, 0.15619417f, 0.0028264131f), vec4<f32>(0.23740272f, 0.0036788688f, 0.1605546f, 0.002895476f), vec4<f32>(0.24204347f, 0.0037188304f, 0.16369313f, 0.0029412308f), vec4<f32>(0.24484213f, 0.0037424085f, 0.16558585f, 0.002967349f), vec4<f32>(0.24577738f, 0.0037502022f, 0.16621836f, 0.0029758415f));
const V2_SEASON_LAG: f32 = 0.08f;
const V2_ICE_ZOOM: f32 = 5f;
const V2_SEA_ICE_ZOOM: f32 = 8f;
const V2_WATER_ARIDITY: array<f32, 11> = array<f32, 11>(0f, 0.3f, 0f, 0f, 0f, 0f, 0.5f, 1f, 0.72f, 0f, 0f);
const V2_WATER_TEA: array<f32, 11> = array<f32, 11>(0f, 0f, 0.3f, 0.65f, 0f, 0.25f, 0f, 0f, 0f, 0f, 0.55f);
const V2_WATER_GLACIAL: array<f32, 11> = array<f32, 11>(0f, 0f, 0f, 0f, 1f, 0.2f, 0f, 0f, 0f, 0f, 0f);
const V2_WATER_SEDIMENT: array<f32, 11> = array<f32, 11>(0.45f, 0.35f, 0.45f, 0.2f, 0.25f, 0.1f, 0.3f, 0.1f, 1f, 1f, 0.7f);

@id(0) override groundEnabled: i32 = 0i;
@id(2) override uForest: i32 = 0i;
@id(1) override uRenderV2_: i32 = 0i;
@id(3) override uForestBrushes: i32 = 0i;

@group(0) @binding(0) 
var<storage> global: TerrainParams;
@group(0) @binding(1) 
var sNearest: sampler;
@group(0) @binding(2) 
var sLinear: sampler;
@group(0) @binding(3) 
var sAniso: sampler;
@group(0) @binding(5) 
var material_1: texture_2d<f32>;
@group(0) @binding(6) 
var previousMaterial: texture_2d<f32>;
@group(0) @binding(7) 
var macroField: texture_2d<f32>;
@group(0) @binding(8) 
var uShoreRing: texture_2d<f32>;
@group(0) @binding(19) 
var semanticTile: texture_2d<f32>;
@group(0) @binding(20) 
var previousSemanticTile: texture_2d<f32>;
var<private> texcoord_1: vec2<f32>;
var<private> normal_3: vec3<f32>;
var<private> world_135: vec3<f32>;
var<private> physical_1: vec3<f32>;
var<private> physicalSlope_1: vec2<f32>;
var<private> color_13: vec4<f32>;
@group(0) @binding(9) 
var canopyWater: texture_2d<f32>;
@group(0) @binding(10) 
var previousCanopyWater: texture_2d<f32>;
@group(0) @binding(21) 
var drapedMaterial: texture_2d<f32>;
@group(0) @binding(22) 
var previousDrapedMaterial: texture_2d<f32>;
var<private> surfaceGroundWaterCached: bool = false;
var<private> surfaceGroundWaterPoint: vec2<f32> = vec2(0f);
var<private> surfaceGroundWaterSample: f32 = 0f;
var<private> v2Foliage: f32 = 1f;
var<private> v2CrownGuide: vec3<f32> = vec3(0f);
var<private> v2ZoneWet: f32 = 0f;
var<private> v2ZoneBare: f32 = 0f;
var<private> v2FloorModulation: f32 = 1f;
var<private> v2MacroNormal: vec3<f32> = vec3<f32>(0f, 1f, 0f);
var<private> v2MacroCanopy: vec3<f32> = vec3(0f);
var<private> v2GroundSnow: f32 = 0f;
var<private> v2MeanEnabled: f32 = 0f;
var<private> v2ForestReveal: f32 = 0f;
@group(0) @binding(15) 
var uForestBrushAtlas: texture_2d_array<f32>;
@group(0) @binding(11) 
var uForestField: texture_2d<f32>;
@group(0) @binding(12) 
var uForestBank: texture_2d<f32>;
@group(0) @binding(13) 
var uOccupation: texture_2d<f32>;
@group(0) @binding(14) 
var uForestBeach: texture_2d<f32>;
var<private> renderGuideColor: vec3<f32> = vec3(0f);
var<private> renderGuideOpen: vec3<f32> = vec3(0f);
var<private> renderGuideClosed: vec3<f32> = vec3(0f);
var<private> renderGuideBaseOpen: vec3<f32> = vec3(0f);
var<private> renderGuideBaseClosed: vec3<f32> = vec3(0f);
var<private> renderGuideSediment: vec3<f32> = vec3(0f);
var<private> renderGuideWoods: f32 = 0f;
var<private> renderGuideBeach: f32 = 0f;
var<private> renderGuideFlats: f32 = 0f;
var<private> renderGuideShore: f32 = 1000000000f;
var<private> renderGuideOpenness: f32 = 0f;
var<private> surfaceFall: vec2<f32> = vec2<f32>(1f, 0f);
var<private> surfaceRockTone: vec3<f32> = vec3<f32>(0.43f, 0.42f, 0.39f);
var<private> surfaceSoilTone: vec3<f32> = vec3<f32>(0.4f, 0.32f, 0.22f);
var<private> surfaceHerbTone: vec3<f32> = vec3(1f);
var<private> surfaceMicroTone: vec3<f32> = vec3(1f);
var<private> surfaceMicroSlope: vec2<f32> = vec2(0f);
var<private> surfaceRise: f32 = 0f;
var<private> surfaceBedded: f32 = 0f;
var<private> surfaceStrataWeight: f32 = 0f;
var<private> surfaceFacetWeight: f32 = 1f;
var<private> surfaceStreakWeight: f32 = 1f;
var<private> surfaceRockMassive: f32 = 0f;
var<private> surfaceRockShatter: f32 = 0f;
var<private> surfaceChuteSlope: vec2<f32> = vec2(0f);
var<private> surfaceRockSlope: vec2<f32> = vec2(0f);
var<private> surfaceRockCavity: vec2<f32> = vec2(0f);
var<private> surfaceFineGrain: vec3<f32> = vec3(0f);
var<private> surfaceFineBreak: f32 = 1f;
var<private> surfaceGroundDry: f32 = 1f;
var<private> surfaceGroundStony: f32 = 0f;
var<private> surfaceGroundClasts: f32 = 1f;
var<private> surfaceGroundSlope: vec2<f32> = vec2(0f);
var<private> surfaceGroundGradient: vec2<f32> = vec2(0f);
var<private> surfaceGroundEnv: vec4<f32> = vec4(0f);
var<private> surfaceGroundHeight: f32 = 0f;
var<private> surfaceGroundShore: f32 = 1000000000f;
var<private> surfaceGroundBeach: f32 = 0f;
var<private> surfaceGroundNormalGain: f32 = 1f;
var<private> surfaceGroundHasInputs: bool = false;
var<private> surfaceGroundPoint: vec2<f32> = vec2(0f);
var<private> surfaceGroundOccupation: vec3<f32> = vec3(0f);
var<private> surfaceGroundBank: f32 = 1000000000f;
var<private> surfaceGroundWet: f32 = 0f;
var<private> surfaceGroundBankCached: bool = false;
var<private> surfaceGroundBankPoint: vec2<f32> = vec2(0f);
var<private> surfaceGroundBankSample: vec4<f32> = vec4(0f);
var<private> surfaceGroundSand: f32 = 0f;
var<private> groundReliefLight: vec3<f32> = vec3(1f);
@group(0) @binding(24) 
var uLandDetail: texture_2d<f32>;
var<private> v2OrchardShare: f32 = 1f;
var<private> groundOccupationCached: bool = false;
var<private> groundOccupationPoint: vec2<f32> = vec2(0f);
var<private> groundOccupationSample: vec3<f32> = vec3(0f);
var<private> forestResolvedCover: f32 = 0f;
var<private> forestResolvedShade: f32 = 0f;
var<private> forestMapCover: f32 = 0f;
var<private> mapCanopy: ForestCanopy;
var<private> landFieldCrop: f32 = -1f;
var<private> landFieldEdge: f32 = 6f;
var<private> paperCommonsShare: f32 = 0f;
var<private> paperTendedShare: f32 = 0f;
var<private> v2IceWhole: f32 = 0.31f;
var<private> v2Relief: vec4<f32> = vec4(0f);
var<private> v2ReliefLive: f32 = 0f;
var<private> v2WinterFresh: f32 = 0f;
var<private> v2WinterThin: f32 = 0f;
var<private> v2GroundFormSlope: vec2<f32> = vec2(0f);
var<private> v2GroundUnit: vec4<f32> = vec4(0f);
var<private> v2GroundSite: vec4<f32> = vec4(0f);
var<private> v2MeanOpen: GroundMaterial;
var<private> v2MeanLitter: GroundMaterial;
var<private> v2MeanCrown: GroundMaterial;
var<private> v2MeanWeights: vec3<f32> = vec3<f32>(1f, 0f, 0f);

fn glDFdy(v: f32) -> f32 {
    var v_1: f32;

    v_1 = v;
    let _e163 = v_1;
    let _e164 = dpdy(_e163);
    return -(_e164);
}

fn glDFdy_1(v_2: vec2<f32>) -> vec2<f32> {
    var v_3: vec2<f32>;

    v_3 = v_2;
    let _e163 = v_3;
    let _e164 = dpdy(_e163);
    return -(_e164);
}

fn glDFdy_2(v_4: vec3<f32>) -> vec3<f32> {
    var v_5: vec3<f32>;

    v_5 = v_4;
    let _e163 = v_5;
    let _e164 = dpdy(_e163);
    return -(_e164);
}

fn glDFdy_3(v_6: vec4<f32>) -> vec4<f32> {
    var v_7: vec4<f32>;

    v_7 = v_6;
    let _e163 = v_7;
    let _e164 = dpdy(_e163);
    return -(_e164);
}

fn waterSurfaceHash(p: vec2<f32>) -> f32 {
    var p_1: vec2<f32>;

    p_1 = p;
    let _e178 = p_1;
    p_1 = fract((_e178 * vec2<f32>(123.34f, 456.21f)));
    let _e184 = p_1;
    let _e185 = p_1;
    let _e186 = p_1;
    p_1 = (_e184 + vec2(dot(_e185, (_e186 + vec2(45.32f)))));
    let _e193 = p_1;
    let _e195 = p_1;
    return fract((_e193.x * _e195.y));
}

fn waterSurfaceNoise(p_2: vec2<f32>) -> f32 {
    var p_3: vec2<f32>;
    var i: vec2<f32>;
    var f: vec2<f32>;
    var u: vec2<f32>;

    p_3 = p_2;
    let _e178 = p_3;
    i = floor(_e178);
    let _e181 = p_3;
    f = fract(_e181);
    let _e184 = f;
    let _e185 = f;
    let _e189 = f;
    u = ((_e184 * _e185) * (vec2(3f) - (2f * _e189)));
    let _e195 = i;
    let _e196 = waterSurfaceHash(_e195);
    let _e197 = i;
    let _e202 = waterSurfaceHash((_e197 + vec2<f32>(1f, 0f)));
    let _e203 = u;
    let _e206 = i;
    let _e211 = waterSurfaceHash((_e206 + vec2<f32>(0f, 1f)));
    let _e212 = i;
    let _e217 = waterSurfaceHash((_e212 + vec2<f32>(1f, 1f)));
    let _e218 = u;
    let _e221 = u;
    return mix(mix(_e196, _e202, _e203.x), mix(_e211, _e217, _e218.x), _e221.y);
}

fn waterSurfaceShade(color: vec3<f32>, world_1: vec2<f32>, px: f32, shelf: f32, rim: f32, wide: f32) -> vec3<f32> {
    var color_1: vec3<f32>;
    var world_2: vec2<f32>;
    var px_1: f32;
    var shelf_1: f32;
    var rim_1: f32;
    var wide_1: f32;
    var fine: f32;
    var n: f32;

    color_1 = color;
    world_2 = world_1;
    px_1 = px;
    shelf_1 = shelf;
    rim_1 = rim;
    wide_1 = wide;
    let _e188 = color_1;
    let _e193 = shelf_1;
    let _e196 = wide_1;
    color_1 = mix(_e188, vec3<f32>(0.16f, 0.33f, 0.32f), vec3(((_e193 * 0.3f) * _e196)));
    let _e200 = color_1;
    let _e205 = rim_1;
    let _e208 = wide_1;
    color_1 = mix(_e200, vec3<f32>(0.4f, 0.55f, 0.52f), vec3(((_e205 * 0.18f) * _e208)));
    let _e215 = px_1;
    fine = (1f - smoothstep(2f, 6f, _e215));
    let _e219 = world_2;
    let _e223 = waterSurfaceNoise((_e219 / vec2(170f)));
    let _e226 = world_2;
    let _e233 = waterSurfaceNoise(((_e226 / vec2(45f)) + vec2(7.3f)));
    let _e236 = fine;
    let _e240 = fine;
    n = (((_e223 * 0.6f) + ((_e233 * 0.4f) * _e236)) + ((1f - _e240) * 0.2f));
    let _e246 = color_1;
    let _e249 = n;
    return (_e246 * (0.9f + (0.2f * _e249)));
}

fn materialWaterRamp(position: f32) -> vec3<f32> {
    var position_1: f32;
    var color_2: vec3<f32> = vec3<f32>(0.101960786f, 0.3019608f, 0.36078432f);

    position_1 = position;
    let _e191 = color_2;
    let _e206 = position_1;
    color_2 = mix(_e191, vec3<f32>(0.043137256f, 0.16078432f, 0.27058825f), vec3(smoothstep(0f, 0.4f, _e206)));
    let _e210 = color_2;
    let _e225 = position_1;
    color_2 = mix(_e210, vec3<f32>(0.019607844f, 0.06666667f, 0.14901961f), vec3(smoothstep(0.4f, 1f, _e225)));
    let _e229 = color_2;
    return _e229;
}

fn materialWater(world_3: vec2<f32>, position_2: f32, px_2: f32) -> vec3<f32> {
    var world_4: vec2<f32>;
    var position_3: f32;
    var px_3: f32;
    var shelf_2: f32;
    var rim_2: f32;
    var color_3: vec3<f32>;
    var ice: f32;

    world_4 = world_3;
    position_3 = position_2;
    px_3 = px_2;
    let _e185 = position_3;
    shelf_2 = (1f - smoothstep(0f, 0.035f, _e185));
    let _e191 = position_3;
    let _e196 = position_3;
    rim_2 = (smoothstep(0.002f, 0.006f, _e191) * (1f - smoothstep(0.012f, 0.025f, _e196)));
    let _e201 = position_3;
    let _e202 = materialWaterRamp(_e201);
    let _e203 = world_4;
    let _e204 = px_3;
    let _e205 = shelf_2;
    let _e206 = rim_2;
    let _e208 = waterSurfaceShade(_e202, _e203, _e204, _e205, _e206, 1f);
    color_3 = _e208;
    let _e210 = color_3;
    let _e211 = color_3;
    let _e223 = global.uWaterSeason;
    color_3 = mix(_e210, ((_e211 * vec3<f32>(0.8f, 0.9f, 1f)) + vec3<f32>(0f, 0.01f, 0.02f)), vec3((0.35f * _e223.x)));
    let _e229 = global.uWaterSeason;
    ice = step(0.5f, _e229.y);
    let _e233 = color_3;
    let _e238 = ice;
    return mix(_e233, vec3<f32>(0.84f, 0.89f, 0.91f), vec3(_e238));
}

fn moonlight(c: vec3<f32>) -> vec3<f32> {
    var c_1: vec3<f32>;
    var y: f32;

    c_1 = c;
    let _e178 = c_1;
    y = dot(_e178, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
    let _e185 = c_1;
    let _e196 = y;
    return ((_e185 * vec3<f32>(0.16f, 0.23f, 0.38f)) + (vec3<f32>(0.018f, 0.029f, 0.065f) * (0.35f + _e196)));
}

fn displayWaterCover(p_4: vec2<f32>) -> f32 {
    var p_5: vec2<f32>;
    var q: vec2<f32>;

    p_5 = p_4;
    let _e178 = p_5;
    let _e179 = global.canopyWaterRect;
    let _e182 = global.canopyWaterRect;
    q = ((_e178 - _e179.xy) / vec2(_e182.z));
    let _e187 = global.hasCanopyWater;
    if (_e187 == 1i) {
        let _e190 = q;
        let _e197 = textureSampleLevel(canopyWater, sLinear, clamp(_e190, vec2(0f), vec2(1f)), 0f);
        return _e197.x;
    }
    let _e199 = p_5;
    let _e200 = global.previousCanopyWaterRect;
    let _e203 = global.previousCanopyWaterRect;
    q = ((_e199 - _e200.xy) / vec2(_e203.z));
    let _e207 = global.hasPreviousCanopyWater;
    if (_e207 == 1i) {
        let _e210 = q;
        let _e217 = textureSampleLevel(previousCanopyWater, sLinear, clamp(_e210, vec2(0f), vec2(1f)), 0f);
        return _e217.x;
    }
    return 0f;
}

fn naturalMapWater(base: vec3<f32>, p_6: vec3<f32>, footprint: f32) -> vec3<f32> {
    var base_1: vec3<f32>;
    var p_7: vec3<f32>;
    var footprint_1: f32;
    var cover: f32;
    var band: f32;
    var position_4: f32 = 0f;
    var i_1: i32 = 0i;
    var local: f32;
    var local_1: f32;
    var r: f32;
    var water: vec3<f32>;

    base_1 = base;
    p_7 = p_6;
    footprint_1 = footprint;
    let _e182 = global.uNaturalWater;
    let _e185 = global.displayWaterVisible;
    if ((_e182 == 0i) || (_e185 == 0i)) {
        let _e189 = base_1;
        return _e189;
    }
    let _e190 = p_7;
    let _e192 = displayWaterCover(_e190.xz);
    cover = _e192;
    let _e194 = cover;
    if (_e194 <= 0f) {
        let _e197 = base_1;
        return _e197;
    }
    let _e200 = cover;
    cover = smoothstep(0.2f, 0.8f, _e200);
    let _e202 = global.displayWaterBand;
    band = max(_e202, 1f);
    loop {
        let _e210 = i_1;
        if !((_e210 < 3i)) {
            break;
        }
        {
            let _e217 = band;
            let _e218 = i_1;
            if (_e218 == 0i) {
                local_1 = 0.025f;
            } else {
                let _e222 = i_1;
                if (_e222 == 1i) {
                    local = 0.15f;
                } else {
                    local = 0.6f;
                }
                let _e228 = local;
                local_1 = _e228;
            }
            let _e230 = local_1;
            r = (_e217 * _e230);
            let _e233 = position_4;
            let _e234 = p_7;
            let _e236 = r;
            let _e240 = displayWaterCover((_e234.xz + vec2<f32>(_e236, 0f)));
            let _e241 = p_7;
            let _e243 = r;
            let _e247 = displayWaterCover((_e241.xz - vec2<f32>(_e243, 0f)));
            let _e249 = p_7;
            let _e252 = r;
            let _e255 = displayWaterCover((_e249.xz + vec2<f32>(0f, _e252)));
            let _e257 = p_7;
            let _e260 = r;
            let _e263 = displayWaterCover((_e257.xz - vec2<f32>(0f, _e260)));
            position_4 = (_e233 + ((((_e240 + _e247) + _e255) + _e263) / 12f));
        }
        continuing {
            let _e214 = i_1;
            i_1 = (_e214 + 1i);
        }
    }
    let _e268 = p_7;
    let _e270 = position_4;
    let _e271 = footprint_1;
    let _e272 = materialWater(_e268.xz, _e270, _e271);
    water = _e272;
    let _e274 = global.uNight;
    if (_e274 == 1i) {
        let _e277 = water;
        let _e278 = moonlight(_e277);
        water = _e278;
    }
    let _e279 = base_1;
    let _e280 = water;
    let _e281 = cover;
    return mix(_e279, _e280, vec3(_e281));
}

fn reliefCurrent(uv: vec2<f32>) -> vec4<f32> {
    var uv_1: vec2<f32>;

    uv_1 = uv;
    let _e180 = global.hasRaisedMaterial;
    let _e183 = global.raisedBlend;
    if ((_e180 == 0i) || (_e183 >= 1f)) {
        let _e187 = uv_1;
        let _e188 = textureSample(material_1, sAniso, _e187);
        return _e188;
    }
    let _e189 = global.raisedBlend;
    if (_e189 <= 0f) {
        let _e192 = uv_1;
        let _e193 = textureSample(drapedMaterial, sAniso, _e192);
        return _e193;
    }
    let _e194 = uv_1;
    let _e195 = textureSample(drapedMaterial, sAniso, _e194);
    let _e196 = uv_1;
    let _e197 = textureSample(material_1, sAniso, _e196);
    let _e198 = global.raisedBlend;
    return mix(_e195, _e197, vec4(_e198));
}

fn reliefPrevious(uv_2: vec2<f32>) -> vec4<f32> {
    var uv_3: vec2<f32>;

    uv_3 = uv_2;
    let _e180 = global.hasPreviousRaisedMaterial;
    let _e183 = global.raisedBlend;
    if ((_e180 == 0i) || (_e183 >= 1f)) {
        let _e187 = uv_3;
        let _e188 = textureSample(previousMaterial, sAniso, _e187);
        return _e188;
    }
    let _e189 = global.raisedBlend;
    if (_e189 <= 0f) {
        let _e192 = uv_3;
        let _e193 = textureSample(previousDrapedMaterial, sAniso, _e192);
        return _e193;
    }
    let _e194 = uv_3;
    let _e195 = textureSample(previousDrapedMaterial, sAniso, _e194);
    let _e196 = uv_3;
    let _e197 = textureSample(previousMaterial, sAniso, _e196);
    let _e198 = global.raisedBlend;
    return mix(_e195, _e197, vec4(_e198));
}

fn surfaceGroundRetainWater(world_5: vec2<f32>, coverage: f32) -> f32 {
    var world_6: vec2<f32>;
    var coverage_1: f32;

    world_6 = world_5;
    coverage_1 = coverage;
    surfaceGroundWaterCached = true;
    let _e186 = world_6;
    surfaceGroundWaterPoint = _e186;
    let _e187 = coverage_1;
    surfaceGroundWaterSample = _e187;
    let _e188 = coverage_1;
    return _e188;
}

fn v2Zoned() -> bool {
    let _e193 = global.uMaterialZone;
    return ((_e193 > 0i) && (uRenderV2_ > 0i));
}

fn v2Zone() -> i32 {
    let _e193 = global.uMaterialZone;
    return clamp((_e193 - 1i), 0i, 10i);
}

fn v2SeasonZone() -> i32 {
    var local_2: i32;

    let _e199 = global.uMaterialZone;
    if (_e199 > 0i) {
        let _e202 = global.uMaterialZone;
        local_2 = clamp((_e202 - 1i), 0i, 10i);
    } else {
        local_2 = 0i;
    }
    let _e210 = local_2;
    return _e210;
}

fn v2SeasonWeights() -> vec4<f32> {
    var at: f32;

    let _e199 = global.uV2Season;
    at = (fract(_e199) * 4f);
    let _e207 = at;
    let _e216 = at;
    return max(vec4(0f), (vec4(1f) - min(abs((vec4(_e207) - vec4<f32>(0f, 1f, 2f, 3f))), abs((vec4(_e216) - vec4<f32>(4f, 5f, 6f, 7f))))));
}

fn v2SeasonHerb() -> vec3<f32> {
    var z: i32;
    var w: vec4<f32>;
    var local_3: array<vec3<f32>, 44> = V2_SEASON_HERB;
    var local_4: array<vec3<f32>, 44> = V2_SEASON_HERB;
    var local_5: array<vec3<f32>, 44> = V2_SEASON_HERB;
    var local_6: array<vec3<f32>, 44> = V2_SEASON_HERB;
    var herb: vec3<f32>;
    var local_7: vec3<f32>;

    let _e199 = v2SeasonZone();
    z = (_e199 * 4i);
    let _e203 = v2SeasonWeights();
    w = _e203;
    let _e205 = z;
    let _e209 = local_3[_e205];
    let _e210 = w;
    let _e213 = z;
    let _e219 = local_4[(_e213 + 1i)];
    let _e220 = w;
    let _e224 = z;
    let _e230 = local_5[(_e224 + 2i)];
    let _e231 = w;
    let _e235 = z;
    let _e241 = local_6[(_e235 + 3i)];
    let _e242 = w;
    herb = ((((_e209 * _e210.x) + (_e219 * _e220.y)) + (_e230 * _e231.z)) + (_e241 * _e242.w));
    let _e247 = global.uV2Calendar;
    if (_e247 == 1i) {
        let _e252 = herb;
        let _e253 = global.uV2CalClimate;
        local_7 = mix(vec3(1f), _e252, vec3(_e253.w));
    } else {
        let _e257 = herb;
        local_7 = _e257;
    }
    let _e259 = local_7;
    return _e259;
}

fn v2SeasonLeaf() -> f32 {
    var local_8: array<vec4<f32>, 11> = V2_SEASON_LEAF;
    var local_9: vec4<f32>;

    let _e199 = global.uV2Calendar;
    if (_e199 == 1i) {
        let _e202 = global.uV2CalLeaf;
        local_9 = _e202;
    } else {
        let _e203 = v2SeasonZone();
        let _e207 = local_8[_e203];
        local_9 = _e207;
    }
    let _e209 = local_9;
    let _e210 = v2SeasonWeights();
    return dot(_e209, _e210);
}

fn v2SeasonSeaIce() -> f32 {
    var local_10: array<vec4<f32>, 11> = V2_SEASON_ICE;
    var local_11: vec4<f32>;

    let _e199 = global.uV2Calendar;
    if (_e199 == 1i) {
        let _e202 = global.uV2CalIce;
        local_11 = _e202;
    } else {
        let _e203 = v2SeasonZone();
        let _e207 = local_10[_e203];
        local_11 = _e207;
    }
    let _e209 = local_11;
    let _e210 = v2SeasonWeights();
    return dot(_e209, _e210);
}

fn v2SeasonSnowPatches() -> f32 {
    var local_12: f32;

    let _e199 = global.uV2Calendar;
    if (_e199 == 1i) {
        let _e202 = global.uV2CalSnow;
        local_12 = _e202.x;
    } else {
        local_12 = 0.4f;
    }
    let _e206 = local_12;
    return _e206;
}

fn v2SeasonCrownSnow() -> f32 {
    var local_13: f32;

    let _e199 = global.uV2Calendar;
    if (_e199 == 1i) {
        let _e202 = global.uV2CalSnow;
        local_13 = _e202.y;
    } else {
        local_13 = 0.7f;
    }
    let _e206 = local_13;
    return _e206;
}

fn v2SeasonWet() -> f32 {
    var local_14: array<vec4<f32>, 11> = V2_SEASON_WET;

    let _e199 = v2SeasonZone();
    let _e203 = local_14[_e199];
    let _e204 = v2SeasonWeights();
    return dot(_e203, _e204);
}

fn v2SeasonThaw() -> f32 {
    var local_15: array<vec4<f32>, 11> = V2_SEASON_THAW;
    var local_16: vec4<f32>;

    let _e199 = global.uV2Calendar;
    if (_e199 == 1i) {
        let _e202 = global.uV2CalThaw;
        local_16 = _e202;
    } else {
        let _e203 = v2SeasonZone();
        let _e207 = local_15[_e203];
        local_16 = _e207;
    }
    let _e209 = local_16;
    let _e210 = v2SeasonWeights();
    return dot(_e209, _e210);
}

fn v2SeasonClimate() -> vec3<f32> {
    var local_17: array<vec3<f32>, 11> = V2_SEASON_CLIMATE;
    var local_18: vec3<f32>;

    let _e199 = global.uV2Calendar;
    if (_e199 == 1i) {
        let _e202 = global.uV2CalClimate;
        local_18 = _e202.xyz;
    } else {
        let _e204 = v2SeasonZone();
        let _e208 = local_17[_e204];
        local_18 = _e208;
    }
    let _e210 = local_18;
    return _e210;
}

fn v2ZoneForest(f_1: vec4<f32>) -> vec4<f32> {
    var f_2: vec4<f32>;
    var local_19: array<vec4<f32>, 11> = V2_ZONE_FOREST;
    var z_1: vec4<f32>;
    var local_20: f32;
    var stature: f32;

    f_2 = f_1;
    let _e201 = v2Zoned();
    if !(_e201) {
        let _e203 = f_2;
        return _e203;
    }
    let _e204 = v2Zone();
    let _e208 = local_19[_e204];
    z_1 = _e208;
    let _e210 = v2Zone();
    if (_e210 == 5i) {
        local_20 = 0.35f;
    } else {
        local_20 = 1f;
    }
    let _e216 = local_20;
    stature = _e216;
    let _e218 = f_2;
    let _e220 = z_1;
    let _e226 = f_2;
    let _e228 = stature;
    let _e230 = f_2;
    let _e232 = z_1;
    let _e234 = z_1;
    let _e237 = f_2;
    return vec4<f32>(clamp((_e218.x * _e220.x), 0f, 1f), (_e226.y * _e228), mix(_e230.z, _e232.y, _e234.z), _e237.w);
}

fn auxPack4x8_(v_8: vec4<f32>) -> u32 {
    var v_9: vec4<f32>;
    var b: vec4<u32>;

    v_9 = v_8;
    let _e217 = v_9;
    b = vec4<u32>(((clamp(_e217, vec4(0f), vec4(1f)) * 255f) + vec4(0.5f)));
    let _e230 = b;
    let _e232 = b;
    let _e238 = b;
    let _e244 = b;
    return (((_e230.x | (_e232.y << 8u)) | (_e238.z << 16u)) | (_e244.w << 24u));
}

fn auxUnpack4x8_(u_1: u32) -> vec4<f32> {
    var u_2: u32;

    u_2 = u_1;
    let _e217 = u_2;
    let _e221 = u_2;
    let _e228 = u_2;
    let _e235 = u_2;
    return (vec4<f32>(f32((_e217 & 255u)), f32(((_e221 >> 8u) & 255u)), f32(((_e228 >> 16u) & 255u)), f32((_e235 >> 24u))) / vec4(255f));
}

fn forestBeach(world_7: vec2<f32>) -> f32 {
    var world_8: vec2<f32>;
    var local_21: f32;

    world_8 = world_7;
    let _e217 = global.uHasForestBeach;
    if (_e217 == 1i) {
        let _e220 = world_8;
        let _e221 = global.uForestBeachRect;
        let _e224 = global.uForestBeachRect;
        let _e229 = textureSampleLevel(uForestBeach, sLinear, ((_e220 - _e221.xy) / vec2(_e224.z)), 0f);
        local_21 = _e229.x;
    } else {
        local_21 = 0f;
    }
    let _e233 = local_21;
    return _e233;
}

fn forestWaterCoverage(p_8: vec2<f32>) -> f32 {
    var p_9: vec2<f32>;
    var current: vec2<f32>;
    var previous: vec2<f32>;
    var uv_4: vec2<f32>;

    p_9 = p_8;
    let _e217 = surfaceGroundWaterCached;
    let _e218 = p_9;
    let _e219 = surfaceGroundWaterPoint;
    if (_e217 && all((_e218 == _e219))) {
        let _e223 = surfaceGroundWaterSample;
        return _e223;
    }
    let _e224 = p_9;
    let _e225 = global.canopyWaterRect;
    let _e228 = global.canopyWaterRect;
    current = ((_e224 - _e225.xy) / vec2(_e228.z));
    let _e233 = global.hasCanopyWater;
    let _e236 = current;
    let _e242 = current;
    if (((_e233 == 1i) && all((_e236 >= vec2(0f)))) && all((_e242 <= vec2(1f)))) {
        let _e248 = p_9;
        let _e249 = current;
        let _e251 = textureSampleLevel(canopyWater, sLinear, _e249, 0f);
        let _e253 = surfaceGroundRetainWater(_e248, _e251.x);
        return _e253;
    }
    let _e254 = p_9;
    let _e255 = global.previousCanopyWaterRect;
    let _e258 = global.previousCanopyWaterRect;
    previous = ((_e254 - _e255.xy) / vec2(_e258.z));
    let _e263 = global.hasPreviousCanopyWater;
    let _e266 = previous;
    let _e272 = previous;
    if (((_e263 == 1i) && all((_e266 >= vec2(0f)))) && all((_e272 <= vec2(1f)))) {
        let _e278 = p_9;
        let _e279 = previous;
        let _e281 = textureSampleLevel(previousCanopyWater, sLinear, _e279, 0f);
        let _e283 = surfaceGroundRetainWater(_e278, _e281.x);
        return _e283;
    }
    if (groundEnabled == 0i) {
        return 0f;
    }
    let _e287 = p_9;
    let _e288 = global.patchRect;
    let _e291 = global.patchRect;
    uv_4 = ((_e287 - _e288.xy) / vec2(_e291.z));
    let _e296 = p_9;
    let _e297 = global.previousRect;
    let _e299 = uv_4;
    let _e300 = global.previousRect;
    let _e305 = textureSampleLevel(previousMaterial, sAniso, (_e297.xy + (_e299 * _e300.zw)), 0f);
    let _e307 = global.textureRect;
    let _e309 = uv_4;
    let _e310 = global.textureRect;
    let _e315 = textureSampleLevel(material_1, sAniso, (_e307.xy + (_e309 * _e310.zw)), 0f);
    let _e317 = global.textureBlend;
    let _e319 = surfaceGroundRetainWater(_e296, mix(_e305.w, _e315.w, _e317));
    return _e319;
}

fn groundSpline(t: f32) -> vec4<f32> {
    var t_1: f32;
    var u_3: f32;

    t_1 = t;
    let _e218 = t_1;
    u_3 = (1f - _e218);
    let _e221 = u_3;
    let _e222 = u_3;
    let _e224 = u_3;
    let _e227 = t_1;
    let _e229 = t_1;
    let _e231 = t_1;
    let _e234 = t_1;
    let _e236 = t_1;
    let _e243 = t_1;
    let _e245 = t_1;
    let _e247 = t_1;
    let _e250 = t_1;
    let _e252 = t_1;
    let _e256 = t_1;
    let _e261 = t_1;
    let _e262 = t_1;
    let _e264 = t_1;
    return (vec4<f32>(((_e221 * _e222) * _e224), (((((3f * _e227) * _e229) * _e231) - ((6f * _e234) * _e236)) + 4f), ((((((-3f * _e243) * _e245) * _e247) + ((3f * _e250) * _e252)) + (3f * _e256)) + 1f), ((_e261 * _e262) * _e264)) / vec4(6f));
}

fn groundSplineDerivative(t_2: f32) -> vec4<f32> {
    var t_3: f32;

    t_3 = t_2;
    let _e220 = t_3;
    let _e224 = t_3;
    let _e228 = t_3;
    let _e230 = t_3;
    let _e233 = t_3;
    let _e238 = t_3;
    let _e240 = t_3;
    let _e242 = t_3;
    let _e247 = t_3;
    let _e249 = t_3;
    return vec4<f32>(((-0.5f * (1f - _e220)) * (1f - _e224)), (((1.5f * _e228) * _e230) - (2f * _e233)), ((((-1.5f * _e238) * _e240) + _e242) + 0.5f), ((0.5f * _e247) * _e249));
}

fn groundMacroSurface(p_10: vec2<f32>) -> vec3<f32> {
    var p_11: vec2<f32>;
    var cell: f32;
    var g: vec2<f32>;
    var t_4: vec2<f32>;
    var b_1: vec2<i32>;
    var wx: vec4<f32>;
    var wy: vec4<f32>;
    var dx: vec4<f32>;
    var dy: vec4<f32>;
    var s: vec3<f32> = vec3(0f);
    var y_1: i32 = 0i;
    var x: i32;
    var h: f32;

    p_11 = p_10;
    let _e217 = global.macroRect;
    let _e219 = global.macroN;
    cell = (_e217.z / f32(_e219));
    let _e223 = p_11;
    let _e224 = global.macroRect;
    let _e227 = cell;
    g = (((_e223 - _e224.xy) / vec2(_e227)) - vec2(0.5f));
    let _e234 = g;
    t_4 = fract(_e234);
    let _e237 = g;
    b_1 = (vec2<i32>(floor(_e237)) - vec2(1i));
    let _e244 = t_4;
    let _e246 = groundSpline(_e244.x);
    wx = _e246;
    let _e248 = t_4;
    let _e250 = groundSpline(_e248.y);
    wy = _e250;
    let _e252 = t_4;
    let _e254 = groundSplineDerivative(_e252.x);
    dx = _e254;
    let _e256 = t_4;
    let _e258 = groundSplineDerivative(_e256.y);
    dy = _e258;
    loop {
        let _e265 = y_1;
        if !((_e265 < 4i)) {
            break;
        }
        x = 0i;
        loop {
            let _e274 = x;
            if !((_e274 < 4i)) {
                break;
            }
            {
                let _e281 = b_1;
                let _e282 = x;
                let _e283 = y_1;
                let _e288 = global.macroN;
                let _e294 = textureLoad(macroField, clamp((_e281 + vec2<i32>(_e282, _e283)), vec2(0i), vec2((_e288 - 1i))), 0i);
                h = _e294.x;
                let _e297 = s;
                let _e298 = h;
                let _e299 = x;
                let _e301 = wx[_e299];
                let _e302 = y_1;
                let _e304 = wy[_e302];
                let _e306 = x;
                let _e308 = dx[_e306];
                let _e309 = y_1;
                let _e311 = wy[_e309];
                let _e313 = cell;
                let _e315 = x;
                let _e317 = wx[_e315];
                let _e318 = y_1;
                let _e320 = dy[_e318];
                let _e322 = cell;
                s = (_e297 + (_e298 * vec3<f32>((_e301 * _e304), ((_e308 * _e311) / _e313), ((_e317 * _e320) / _e322))));
            }
            continuing {
                let _e278 = x;
                x = (_e278 + 1i);
            }
        }
        continuing {
            let _e269 = y_1;
            y_1 = (_e269 + 1i);
        }
    }
    let _e327 = s;
    return _e327;
}

fn forestRootSurface(p_12: vec2<f32>) -> vec3<f32> {
    var p_13: vec2<f32>;

    p_13 = p_12;
    let _e217 = p_13;
    let _e218 = groundMacroSurface(_e217);
    return _e218;
}

fn forestRootCell() -> f32 {
    let _e215 = global.macroRect;
    let _e217 = global.macroN;
    return (_e215.z / f32(_e217));
}

fn sstep(a: f32, b_2: f32, x_1: f32) -> f32 {
    var a_1: f32;
    var b_3: f32;
    var x_2: f32;
    var t_5: f32;

    a_1 = a;
    b_3 = b_2;
    x_2 = x_1;
    let _e232 = x_2;
    let _e233 = a_1;
    let _e235 = b_3;
    let _e236 = a_1;
    t_5 = clamp(((_e232 - _e233) / (_e235 - _e236)), 0f, 1f);
    let _e243 = t_5;
    let _e244 = t_5;
    let _e248 = t_5;
    return ((_e243 * _e244) * (3f - (2f * _e248)));
}

fn surfaceMix(a_2: vec3<f32>, b_4: vec3<f32>, t_6: f32) -> vec3<f32> {
    var a_3: vec3<f32>;
    var b_5: vec3<f32>;
    var t_7: f32;

    a_3 = a_2;
    b_5 = b_4;
    t_7 = t_6;
    let _e232 = a_3;
    let _e234 = t_7;
    let _e237 = b_5;
    let _e238 = t_7;
    return ((_e232 * (1f - _e234)) + (_e237 * _e238));
}

fn surfaceHash(c_2: vec3<i32>, salt: u32) -> u32 {
    var c_3: vec3<i32>;
    var salt_1: u32;
    var v_10: vec3<u32>;
    var h_1: u32;

    c_3 = c_2;
    salt_1 = salt;
    let _e230 = c_3;
    v_10 = vec3<u32>(_e230);
    let _e233 = v_10;
    let _e237 = v_10;
    let _e242 = v_10;
    let _e247 = salt_1;
    h_1 = ((((_e233.x * 2654435769u) ^ (_e237.y * 2246822507u)) ^ (_e242.z * 3266489909u)) ^ _e247);
    let _e250 = h_1;
    let _e251 = h_1;
    h_1 = ((_e250 ^ (_e251 >> 16u)) * 2146121005u);
    let _e257 = h_1;
    let _e258 = h_1;
    h_1 = ((_e257 ^ (_e258 >> 15u)) * 2221713035u);
    let _e264 = h_1;
    let _e265 = h_1;
    return (_e264 ^ (_e265 >> 16u));
}

fn surfaceCorner(c_4: vec3<i32>, f_3: vec3<f32>, o: vec3<i32>, salt_2: u32) -> f32 {
    var c_5: vec3<i32>;
    var f_4: vec3<f32>;
    var o_1: vec3<i32>;
    var salt_3: u32;
    var h_2: u32;
    var d: vec3<f32>;
    var g_1: vec3<f32>;

    c_5 = c_4;
    f_4 = f_3;
    o_1 = o;
    salt_3 = salt_2;
    let _e234 = c_5;
    let _e235 = o_1;
    let _e237 = salt_3;
    let _e238 = surfaceHash((_e234 + _e235), _e237);
    h_2 = _e238;
    let _e240 = f_4;
    let _e241 = o_1;
    d = (_e240 - vec3<f32>(_e241));
    let _e245 = h_2;
    let _e249 = h_2;
    let _e255 = h_2;
    g_1 = ((vec3<f32>(f32((_e245 & 1023u)), f32(((_e249 >> 10u) & 1023u)), f32(((_e255 >> 20u) & 1023u))) / vec3(511.5f)) - vec3(1f));
    let _e269 = g_1;
    let _e271 = d;
    let _e274 = g_1;
    let _e276 = d;
    let _e280 = g_1;
    let _e282 = d;
    return (((_e269.x * _e271.x) + (_e274.y * _e276.y)) + (_e280.z * _e282.z));
}

fn surfaceNoise(p_14: vec3<f32>, salt_4: u32) -> f32 {
    var p_15: vec3<f32>;
    var salt_5: u32;
    var fl: vec3<f32>;
    var c_6: vec3<i32>;
    var f_5: vec3<f32>;
    var u_4: vec3<f32>;
    var a_4: vec4<f32> = vec4(0f);
    var b_6: vec4<f32> = vec4(0f);
    var local_22: i32;
    var corners: i32;
    var k: i32 = 0i;
    var v_11: f32;
    var j: i32;
    var x0_: f32;
    var x1_: f32;
    var y0_: f32;
    var x2_: f32;
    var x3_: f32;
    var y1_: f32;

    p_15 = p_14;
    salt_5 = salt_4;
    let _e230 = p_15;
    fl = floor(_e230);
    let _e233 = fl;
    c_6 = vec3<i32>(_e233);
    let _e236 = p_15;
    let _e237 = fl;
    f_5 = (_e236 - _e237);
    let _e240 = f_5;
    let _e241 = f_5;
    let _e243 = f_5;
    let _e245 = f_5;
    let _e246 = f_5;
    u_4 = (((_e240 * _e241) * _e243) * ((_e245 * ((_e246 * 6f) - vec3(15f))) + vec3(10f)));
    let _e264 = u_4;
    if (_e264.z == 0f) {
        local_22 = 4i;
    } else {
        local_22 = 8i;
    }
    let _e271 = local_22;
    corners = _e271;
    loop {
        let _e275 = k;
        let _e276 = corners;
        if !((_e275 < _e276)) {
            break;
        }
        {
            let _e282 = c_6;
            let _e283 = f_5;
            let _e284 = k;
            let _e287 = k;
            let _e293 = k;
            let _e298 = salt_5;
            let _e299 = surfaceCorner(_e282, _e283, vec3<i32>((_e284 & 1i), ((_e287 >> 1u) & 1i), (_e293 >> 2u)), _e298);
            v_11 = _e299;
            let _e301 = k;
            j = (_e301 & 3i);
            let _e305 = k;
            if (_e305 < 4i) {
                {
                    let _e308 = j;
                    if (_e308 == 0i) {
                        let _e312 = v_11;
                        a_4.x = _e312;
                    } else {
                        let _e313 = j;
                        if (_e313 == 1i) {
                            let _e317 = v_11;
                            a_4.y = _e317;
                        } else {
                            let _e318 = j;
                            if (_e318 == 2i) {
                                let _e322 = v_11;
                                a_4.z = _e322;
                            } else {
                                let _e324 = v_11;
                                a_4.w = _e324;
                            }
                        }
                    }
                }
            } else {
                {
                    let _e325 = j;
                    if (_e325 == 0i) {
                        let _e329 = v_11;
                        b_6.x = _e329;
                    } else {
                        let _e330 = j;
                        if (_e330 == 1i) {
                            let _e334 = v_11;
                            b_6.y = _e334;
                        } else {
                            let _e335 = j;
                            if (_e335 == 2i) {
                                let _e339 = v_11;
                                b_6.z = _e339;
                            } else {
                                let _e341 = v_11;
                                b_6.w = _e341;
                            }
                        }
                    }
                }
            }
        }
        continuing {
            let _e279 = k;
            k = (_e279 + 1i);
        }
    }
    let _e342 = a_4;
    let _e344 = a_4;
    let _e346 = a_4;
    let _e349 = u_4;
    x0_ = (_e342.x + ((_e344.y - _e346.x) * _e349.x));
    let _e354 = a_4;
    let _e356 = a_4;
    let _e358 = a_4;
    let _e361 = u_4;
    x1_ = (_e354.z + ((_e356.w - _e358.z) * _e361.x));
    let _e366 = x0_;
    let _e367 = x1_;
    let _e368 = x0_;
    let _e370 = u_4;
    y0_ = (_e366 + ((_e367 - _e368) * _e370.y));
    let _e375 = u_4;
    if (_e375.z == 0f) {
        {
            let _e379 = y0_;
            return (_e379 * 5.25f);
        }
    }
    let _e382 = b_6;
    let _e384 = b_6;
    let _e386 = b_6;
    let _e389 = u_4;
    x2_ = (_e382.x + ((_e384.y - _e386.x) * _e389.x));
    let _e394 = b_6;
    let _e396 = b_6;
    let _e398 = b_6;
    let _e401 = u_4;
    x3_ = (_e394.z + ((_e396.w - _e398.z) * _e401.x));
    let _e406 = x2_;
    let _e407 = x3_;
    let _e408 = x2_;
    let _e410 = u_4;
    y1_ = (_e406 + ((_e407 - _e408) * _e410.y));
    let _e415 = y0_;
    let _e416 = y1_;
    let _e417 = y0_;
    let _e419 = u_4;
    return ((_e415 + ((_e416 - _e417) * _e419.z)) * 5.25f);
}

fn surfacePlane(p_16: vec2<f32>, salt_6: u32) -> vec3<f32> {
    var p_17: vec2<f32>;
    var salt_7: u32;
    var fl_1: vec2<f32>;
    var c_7: vec2<i32>;
    var f_6: vec2<f32>;
    var u_5: vec2<f32>;
    var du: vec2<f32>;
    var h0_: u32;
    var h1_: u32;
    var h2_: u32;
    var h3_: u32;
    var g0_: vec2<f32>;
    var g1_: vec2<f32>;
    var g2_: vec2<f32>;
    var g3_: vec2<f32>;
    var a_5: f32;
    var b_7: f32;
    var d_1: f32;
    var e: f32;
    var k_1: f32;
    var gradient: vec2<f32>;

    p_17 = p_16;
    salt_7 = salt_6;
    let _e230 = p_17;
    fl_1 = floor(_e230);
    let _e233 = fl_1;
    c_7 = vec2<i32>(_e233);
    let _e236 = p_17;
    let _e237 = fl_1;
    f_6 = (_e236 - _e237);
    let _e240 = f_6;
    let _e241 = f_6;
    let _e243 = f_6;
    let _e245 = f_6;
    let _e246 = f_6;
    u_5 = (((_e240 * _e241) * _e243) * ((_e245 * ((_e246 * 6f) - vec2(15f))) + vec2(10f)));
    let _e259 = f_6;
    let _e261 = f_6;
    let _e263 = f_6;
    let _e264 = f_6;
    du = (((30f * _e259) * _e261) * ((_e263 * (_e264 - vec2(2f))) + vec2(1f)));
    let _e274 = c_7;
    let _e279 = salt_7;
    let _e280 = surfaceHash(vec3<i32>(_e274.x, _e274.y, 0i), _e279);
    h0_ = _e280;
    let _e282 = c_7;
    let _e286 = (_e282 + vec2<i32>(1i, 0i));
    let _e291 = salt_7;
    let _e292 = surfaceHash(vec3<i32>(_e286.x, _e286.y, 0i), _e291);
    h1_ = _e292;
    let _e294 = c_7;
    let _e298 = (_e294 + vec2<i32>(0i, 1i));
    let _e303 = salt_7;
    let _e304 = surfaceHash(vec3<i32>(_e298.x, _e298.y, 0i), _e303);
    h2_ = _e304;
    let _e306 = c_7;
    let _e310 = (_e306 + vec2<i32>(1i, 1i));
    let _e315 = salt_7;
    let _e316 = surfaceHash(vec3<i32>(_e310.x, _e310.y, 0i), _e315);
    h3_ = _e316;
    let _e318 = h0_;
    let _e322 = h0_;
    g0_ = ((vec2<f32>(f32((_e318 & 1023u)), f32(((_e322 >> 10u) & 1023u))) / vec2(511.5f)) - vec2(1f));
    let _e336 = h1_;
    let _e340 = h1_;
    g1_ = ((vec2<f32>(f32((_e336 & 1023u)), f32(((_e340 >> 10u) & 1023u))) / vec2(511.5f)) - vec2(1f));
    let _e354 = h2_;
    let _e358 = h2_;
    g2_ = ((vec2<f32>(f32((_e354 & 1023u)), f32(((_e358 >> 10u) & 1023u))) / vec2(511.5f)) - vec2(1f));
    let _e372 = h3_;
    let _e376 = h3_;
    g3_ = ((vec2<f32>(f32((_e372 & 1023u)), f32(((_e376 >> 10u) & 1023u))) / vec2(511.5f)) - vec2(1f));
    let _e390 = g0_;
    let _e391 = f_6;
    a_5 = dot(_e390, _e391);
    let _e394 = g1_;
    let _e395 = f_6;
    b_7 = dot(_e394, (_e395 - vec2<f32>(1f, 0f)));
    let _e402 = g2_;
    let _e403 = f_6;
    d_1 = dot(_e402, (_e403 - vec2<f32>(0f, 1f)));
    let _e410 = g3_;
    let _e411 = f_6;
    e = dot(_e410, (_e411 - vec2<f32>(1f, 1f)));
    let _e418 = a_5;
    let _e419 = b_7;
    let _e421 = d_1;
    let _e423 = e;
    k_1 = (((_e418 - _e419) - _e421) + _e423);
    let _e426 = g0_;
    let _e427 = g1_;
    let _e428 = g0_;
    let _e430 = u_5;
    let _e434 = g2_;
    let _e435 = g0_;
    let _e437 = u_5;
    let _e441 = g0_;
    let _e442 = g1_;
    let _e444 = g2_;
    let _e446 = g3_;
    let _e448 = u_5;
    let _e451 = u_5;
    let _e455 = du;
    let _e456 = b_7;
    let _e457 = a_5;
    let _e459 = k_1;
    let _e460 = u_5;
    let _e464 = d_1;
    let _e465 = a_5;
    let _e467 = k_1;
    let _e468 = u_5;
    gradient = ((((_e426 + ((_e427 - _e428) * _e430.x)) + ((_e434 - _e435) * _e437.y)) + (((((_e441 - _e442) - _e444) + _e446) * _e448.x) * _e451.y)) + (_e455 * vec2<f32>(((_e456 - _e457) + (_e459 * _e460.y)), ((_e464 - _e465) + (_e467 * _e468.x)))));
    let _e476 = a_5;
    let _e477 = b_7;
    let _e478 = a_5;
    let _e480 = u_5;
    let _e484 = d_1;
    let _e485 = a_5;
    let _e487 = u_5;
    let _e491 = k_1;
    let _e492 = u_5;
    let _e495 = u_5;
    let _e499 = gradient;
    return (vec3<f32>((((_e476 + ((_e477 - _e478) * _e480.x)) + ((_e484 - _e485) * _e487.y)) + ((_e491 * _e492.x) * _e495.y)), _e499.x, _e499.y) * 5.25f);
}

fn surfaceGroundBankTexel(world_9: vec2<f32>, uv_5: vec2<f32>) -> vec4<f32> {
    var world_10: vec2<f32>;
    var uv_6: vec2<f32>;

    world_10 = world_9;
    uv_6 = uv_5;
    let _e269 = surfaceGroundBankCached;
    let _e270 = world_10;
    let _e271 = surfaceGroundBankPoint;
    if (_e269 && all((_e270 == _e271))) {
        let _e275 = surfaceGroundBankSample;
        return _e275;
    }
    surfaceGroundBankCached = true;
    let _e277 = world_10;
    surfaceGroundBankPoint = _e277;
    let _e278 = uv_6;
    let _e280 = textureSampleLevel(uForestBank, sLinear, _e278, 0f);
    surfaceGroundBankSample = _e280;
    let _e281 = surfaceGroundBankSample;
    return _e281;
}

fn surfaceGroundInputs(world_11: vec2<f32>, occupation: vec3<f32>, bankDistance: f32) {
    var world_12: vec2<f32>;
    var occupation_1: vec3<f32>;
    var bankDistance_1: f32;

    world_12 = world_11;
    occupation_1 = occupation;
    bankDistance_1 = bankDistance;
    surfaceGroundHasInputs = true;
    let _e272 = world_12;
    surfaceGroundPoint = _e272;
    let _e273 = occupation_1;
    surfaceGroundOccupation = _e273;
    let _e274 = bankDistance_1;
    surfaceGroundBank = _e274;
    return;
}

fn surfaceBed(z_2: f32, salt_8: u32) -> f32 {
    var z_3: f32;
    var salt_9: u32;
    var i_2: f32;
    var a_6: f32;
    var b_8: f32;

    z_3 = z_2;
    salt_9 = salt_8;
    let _e269 = z_3;
    i_2 = floor(_e269);
    let _e272 = i_2;
    let _e277 = salt_9;
    let _e278 = surfaceHash(vec3<i32>(i32(_e272), 0i, 0i), _e277);
    a_6 = f32((_e278 & 1023u));
    let _e283 = i_2;
    let _e290 = salt_9;
    let _e291 = surfaceHash(vec3<i32>((i32(_e283) + 1i), 0i, 0i), _e290);
    b_8 = f32((_e291 & 1023u));
    let _e296 = a_6;
    let _e297 = b_8;
    let _e298 = a_6;
    let _e302 = z_3;
    let _e303 = i_2;
    let _e305 = sstep(0.3f, 0.7f, (_e302 - _e303));
    return (((_e296 + ((_e297 - _e298) * _e305)) / 1023f) - 0.5f);
}

fn surfaceBand(world_13: vec2<f32>, wavelength: f32, salt_10: u32) -> vec3<f32> {
    var world_14: vec2<f32>;
    var wavelength_1: f32;
    var salt_11: u32;
    var n_1: vec3<f32>;

    world_14 = world_13;
    wavelength_1 = wavelength;
    salt_11 = salt_10;
    let _e272 = world_14;
    let _e276 = world_14;
    let _e281 = world_14;
    let _e285 = world_14;
    let _e290 = wavelength_1;
    let _e293 = salt_11;
    let _e294 = surfacePlane((vec2<f32>(((0.8f * _e272.x) + (0.6f * _e276.y)), ((0.8f * _e281.y) - (0.6f * _e285.x))) / vec2(_e290)), _e293);
    n_1 = _e294;
    let _e296 = n_1;
    let _e299 = n_1;
    let _e303 = n_1;
    let _e308 = n_1;
    let _e312 = n_1;
    let _e317 = wavelength_1;
    let _e319 = (vec2<f32>(((0.8f * _e299.y) - (0.6f * _e303.z)), ((0.6f * _e308.y) + (0.8f * _e312.z))) / vec2(_e317));
    return vec3<f32>(_e296.x, _e319.x, _e319.y);
}

fn surfaceCrack(n_2: f32, fp: f32, wavelength_2: f32) -> f32 {
    var n_3: f32;
    var fp_1: f32;
    var wavelength_3: f32;
    var k_2: f32;

    n_3 = n_2;
    fp_1 = fp;
    wavelength_3 = wavelength_2;
    let _e273 = wavelength_3;
    let _e275 = wavelength_3;
    let _e277 = fp_1;
    let _e278 = fp_1;
    k_2 = min(40f, (((0.02f * _e273) * _e275) / max((_e277 * _e278), 0.0001f)));
    let _e287 = k_2;
    let _e291 = k_2;
    let _e293 = n_3;
    let _e295 = n_3;
    return (inverseSqrt((1f + (1.6f * _e287))) - exp2(((-(_e291) * _e293) * _e295)));
}

fn surfaceFacets(q_1: vec2<f32>, salt_12: u32) -> vec4<f32> {
    var q_2: vec2<f32>;
    var salt_13: u32;
    var fl_2: vec2<f32>;
    var c_8: vec2<i32>;
    var f_7: vec2<f32>;
    var first: f32 = 9f;
    var second: f32 = 9f;
    var id: u32 = 0u;
    var j_1: i32 = -1i;
    var i_3: i32;
    var h_3: u32;
    var d_2: vec2<f32>;
    var r_1: f32;

    q_2 = q_1;
    salt_13 = salt_12;
    let _e269 = q_2;
    fl_2 = floor(_e269);
    let _e272 = fl_2;
    c_8 = vec2<i32>(_e272);
    let _e275 = q_2;
    let _e276 = fl_2;
    f_7 = (_e275 - _e276);
    loop {
        let _e288 = j_1;
        if !((_e288 <= 1i)) {
            break;
        }
        {
            i_3 = -1i;
            loop {
                let _e298 = i_3;
                if !((_e298 <= 1i)) {
                    break;
                }
                {
                    let _e305 = c_8;
                    let _e306 = i_3;
                    let _e307 = j_1;
                    let _e309 = (_e305 + vec2<i32>(_e306, _e307));
                    let _e314 = salt_13;
                    let _e315 = surfaceHash(vec3<i32>(_e309.x, _e309.y, 0i), _e314);
                    h_3 = _e315;
                    let _e317 = i_3;
                    let _e319 = j_1;
                    let _e326 = h_3;
                    let _e330 = h_3;
                    let _e342 = f_7;
                    d_2 = (((vec2<f32>(f32(_e317), f32(_e319)) + vec2(0.1f)) + ((0.8f * vec2<f32>(f32((_e326 & 255u)), f32(((_e330 >> 8u) & 255u)))) / vec2(255f))) - _e342);
                    let _e345 = d_2;
                    let _e346 = d_2;
                    r_1 = dot(_e345, _e346);
                    let _e349 = r_1;
                    let _e350 = first;
                    if (_e349 < _e350) {
                        {
                            let _e352 = first;
                            second = _e352;
                            let _e353 = r_1;
                            first = _e353;
                            let _e354 = h_3;
                            id = _e354;
                        }
                    } else {
                        let _e355 = r_1;
                        let _e356 = second;
                        if (_e355 < _e356) {
                            {
                                let _e358 = r_1;
                                second = _e358;
                            }
                        }
                    }
                }
                continuing {
                    let _e302 = i_3;
                    i_3 = (_e302 + 1i);
                }
            }
        }
        continuing {
            let _e292 = j_1;
            j_1 = (_e292 + 1i);
        }
    }
    let _e359 = id;
    let _e369 = second;
    let _e371 = first;
    let _e374 = id;
    let _e380 = id;
    let _e390 = ((vec2<f32>(f32(((_e374 >> 24u) & 15u)), f32((_e380 >> 28u))) / vec2(15f)) - vec2(0.5f));
    return vec4<f32>(((f32(((_e359 >> 16u) & 255u)) / 255f) - 0.5f), (sqrt(_e369) - sqrt(_e371)), _e390.x, _e390.y);
}

fn surfaceStones(q_3: vec2<f32>, salt_14: u32) -> vec2<f32> {
    var q_4: vec2<f32>;
    var salt_15: u32;

    q_4 = q_3;
    salt_15 = salt_14;
    let _e269 = q_4;
    let _e270 = salt_15;
    let _e271 = surfaceFacets(_e269, _e270);
    return _e271.xy;
}

fn surfaceJoint(edge: f32, pixel: f32) -> f32 {
    var edge_1: f32;
    var pixel_1: f32;
    var a_7: f32;

    edge_1 = edge;
    pixel_1 = pixel;
    let _e269 = pixel_1;
    a_7 = max(_e269, 0.004f);
    let _e275 = a_7;
    let _e278 = a_7;
    let _e280 = edge_1;
    let _e281 = sstep((0.03f - _e275), (0.03f + _e278), _e280);
    let _e286 = pixel_1;
    let _e287 = sstep(0.03f, 0.07f, _e286);
    return ((1f - _e281) * (1f - _e287));
}

fn surfaceLithology(world_15: vec2<f32>, h_4: f32, grade: f32, fp_2: f32, m1_: f32, m2_: f32, grove: f32, crag: f32, salt_16: u32) -> vec3<f32> {
    var world_16: vec2<f32>;
    var h_5: f32;
    var grade_1: f32;
    var fp_3: f32;
    var m1_1: f32;
    var m2_1: f32;
    var grove_1: f32;
    var crag_1: f32;
    var salt_17: u32;
    var a_8: f32;
    var b_9: f32;
    var dip: f32;
    var tilt: f32;
    var rise: f32;
    var contact: f32;
    var wide_2: f32;
    var bands: f32;
    var crystal: f32;
    var sedimentary: vec3<f32>;
    var crystalline: vec3<f32>;

    world_16 = world_15;
    h_5 = h_4;
    grade_1 = grade;
    fp_3 = fp_2;
    m1_1 = m1_;
    m2_1 = m2_;
    grove_1 = grove;
    crag_1 = crag;
    salt_17 = salt_16;
    let _e284 = world_16;
    let _e288 = salt_17;
    let _e291 = surfacePlane((_e284 / vec2(9000f)), (_e288 + 21u));
    let _e297 = fp_3;
    let _e298 = sstep(1080f, 2700f, _e297);
    let _e302 = grove_1;
    let _e306 = crag_1;
    let _e310 = m1_1;
    let _e316 = h_5;
    let _e317 = sstep(300f, 1800f, _e316);
    a_8 = ((((((0.9f * _e291.x) * (1f - _e298)) + (0.75f * _e302)) + (0.3f * _e306)) + (0.35f * _e310)) + (0.7f * _e317));
    let _e322 = world_16;
    let _e326 = salt_17;
    let _e329 = surfacePlane((_e322 / vec2(6100f)), (_e326 + 22u));
    let _e335 = fp_3;
    let _e336 = sstep(730f, 1830f, _e335);
    let _e340 = world_16;
    let _e344 = salt_17;
    let _e347 = surfacePlane((_e340 / vec2(1900f)), (_e344 + 23u));
    let _e353 = fp_3;
    let _e354 = sstep(230f, 570f, _e353);
    let _e359 = crag_1;
    let _e363 = m2_1;
    b_9 = (((((0.8f * _e329.x) * (1f - _e336)) + ((0.7f * _e347.x) * (1f - _e354))) + (0.3f * _e359)) + (0.35f * _e363));
    let _e367 = salt_17;
    dip = (f32((_e367 & 1023u)) * 0.00613592f);
    let _e374 = world_16;
    let _e375 = dip;
    let _e377 = dip;
    tilt = dot(_e374, vec2<f32>(cos(_e375), sin(_e377)));
    let _e382 = h_5;
    let _e384 = tilt;
    let _e388 = grove_1;
    let _e392 = crag_1;
    rise = (((_e382 + (0.03f * _e384)) + (70f * _e388)) + (14f * _e392));
    let _e396 = rise;
    let _e398 = tilt;
    let _e402 = crag_1;
    surfaceRise = ((_e396 + (0.06f * _e398)) + (34f * _e402));
    let _e408 = fp_3;
    let _e409 = grade_1;
    let _e415 = sstep(0.125f, 0.25f, ((_e408 * (_e409 + 0.2f)) / 460f));
    contact = (1f - _e415);
    let _e420 = contact;
    wide_2 = (1.1f - (0.8f * _e420));
    let _e424 = wide_2;
    let _e426 = wide_2;
    let _e427 = b_9;
    let _e429 = contact;
    let _e431 = rise;
    let _e435 = rise;
    let _e438 = salt_17;
    let _e441 = surfaceBed((_e435 / 270f), (_e438 + 35u));
    let _e444 = salt_17;
    let _e447 = surfaceBed(((_e431 / 460f) + (0.9f * _e441)), (_e444 + 36u));
    let _e450 = sstep(-(_e424), _e426, (_e427 + ((2.2f * _e429) * _e447)));
    bands = _e450;
    let _e455 = a_8;
    let _e456 = sstep(-0.3f, 0.3f, _e455);
    crystal = _e456;
    let _e459 = crystal;
    surfaceBedded = (1f - _e459);
    let _e469 = bands;
    let _e470 = surfaceMix(vec3<f32>(0.76f, 0.72f, 0.62f), vec3<f32>(0.68f, 0.49f, 0.31f), _e469);
    sedimentary = _e470;
    let _e483 = b_9;
    let _e485 = a_8;
    let _e488 = sstep(-0.35f, 0.35f, (_e483 - (0.6f * _e485)));
    let _e489 = surfaceMix(vec3<f32>(0.62f, 0.54f, 0.52f), vec3<f32>(0.37f, 0.41f, 0.46f), _e488);
    crystalline = _e489;
    let _e491 = sedimentary;
    let _e492 = crystalline;
    let _e493 = crystal;
    let _e494 = surfaceMix(_e491, _e492, _e493);
    let _e502 = b_9;
    let _e503 = a_8;
    let _e506 = sstep(1.05f, 1.4f, (0.7f * (_e502 - _e503)));
    let _e507 = surfaceMix(_e494, vec3<f32>(0.21f, 0.21f, 0.22f), _e506);
    return _e507;
}

fn groundHash(cell_1: vec3<i32>, seed: u32) -> u32 {
    var cell_2: vec3<i32>;
    var seed_1: u32;
    var p_18: vec3<u32>;
    var h_6: u32;

    cell_2 = cell_1;
    seed_1 = seed;
    let _e270 = cell_2;
    p_18 = vec3<u32>(_e270);
    let _e273 = p_18;
    let _e277 = p_18;
    let _e282 = p_18;
    let _e287 = seed_1;
    h_6 = ((((_e273.x * 2654435769u) ^ (_e277.y * 2246822507u)) ^ (_e282.z * 3266489909u)) ^ _e287);
    let _e290 = h_6;
    let _e291 = h_6;
    h_6 = ((_e290 ^ (_e291 >> 16u)) * 2146121005u);
    let _e297 = h_6;
    let _e298 = h_6;
    h_6 = ((_e297 ^ (_e298 >> 15u)) * 2221713035u);
    let _e304 = h_6;
    let _e305 = h_6;
    return (_e304 ^ (_e305 >> 16u));
}

fn groundGravel(point: vec2<f32>, seed_2: u32) -> vec4<f32> {
    var point_1: vec2<f32>;
    var seed_3: u32;
    var cell_3: vec2<i32>;
    var f_8: vec2<f32>;
    var sum: f32 = 0f;
    var tone: f32 = 0f;
    var gradient_1: vec2<f32> = vec2(0f);
    var j_2: i32 = -1i;
    var i_4: i32;
    var neighbour: vec2<i32>;
    var h_7: u32;
    var offset: vec2<f32>;
    var d_3: vec2<f32>;
    var angle: i32;
    var local_23: f32;
    var local_24: f32;
    var local_25: f32;
    var c_9: f32;
    var local_26: f32;
    var local_27: f32;
    var s_1: f32;
    var uv_7: vec2<f32>;
    var radius: vec2<f32>;
    var inverse: vec2<f32>;
    var q_5: f32;
    var t_8: f32;
    var weight: f32;
    var attenuation: f32;

    point_1 = point;
    seed_3 = seed_2;
    let _e270 = point_1;
    cell_3 = vec2<i32>(floor(_e270));
    let _e274 = point_1;
    f_8 = fract(_e274);
    loop {
        let _e287 = j_2;
        if !((_e287 <= 1i)) {
            break;
        }
        i_4 = -1i;
        loop {
            let _e297 = i_4;
            if !((_e297 <= 1i)) {
                break;
            }
            {
                let _e304 = cell_3;
                let _e305 = i_4;
                let _e306 = j_2;
                neighbour = (_e304 + vec2<i32>(_e305, _e306));
                let _e310 = neighbour;
                let _e313 = neighbour;
                let _e316 = seed_3;
                let _e317 = groundHash(vec3<i32>(_e310.x, 0i, _e313.y), _e316);
                h_7 = _e317;
                let _e319 = h_7;
                if ((_e319 & 7u) > 4u) {
                    continue;
                }
                let _e324 = i_4;
                let _e325 = j_2;
                let _e332 = h_7;
                let _e336 = h_7;
                offset = ((vec2<f32>(f32(_e324), f32(_e325)) + vec2(0.5f)) + ((vec2<f32>(f32((_e332 & 255u)), f32(((_e336 >> 8u) & 255u))) / vec2(255f)) - vec2(0.5f)));
                let _e351 = f_8;
                let _e352 = offset;
                d_3 = (_e351 - _e352);
                let _e355 = h_7;
                angle = i32(((_e355 >> 24u) & 3u));
                let _e362 = angle;
                if (_e362 == 0i) {
                    local_25 = 1f;
                } else {
                    let _e366 = angle;
                    if (_e366 == 2i) {
                        local_24 = 0f;
                    } else {
                        let _e370 = angle;
                        if (_e370 == 1i) {
                            local_23 = 0.70710677f;
                        } else {
                            local_23 = -0.70710677f;
                        }
                        let _e377 = local_23;
                        local_24 = _e377;
                    }
                    let _e379 = local_24;
                    local_25 = _e379;
                }
                let _e381 = local_25;
                c_9 = _e381;
                let _e383 = angle;
                if (_e383 == 0i) {
                    local_27 = 0f;
                } else {
                    let _e387 = angle;
                    if (_e387 == 2i) {
                        local_26 = 1f;
                    } else {
                        local_26 = 0.70710677f;
                    }
                    let _e393 = local_26;
                    local_27 = _e393;
                }
                let _e395 = local_27;
                s_1 = _e395;
                let _e397 = c_9;
                let _e398 = d_3;
                let _e401 = s_1;
                let _e402 = d_3;
                let _e406 = s_1;
                let _e408 = d_3;
                let _e411 = c_9;
                let _e412 = d_3;
                uv_7 = vec2<f32>(((_e397 * _e398.x) + (_e401 * _e402.y)), ((-(_e406) * _e408.x) + (_e411 * _e412.y)));
                let _e420 = h_7;
                let _e426 = h_7;
                radius = (vec2(0.1f) + ((0.3f * vec2<f32>(f32(((_e420 >> 16u) & 15u)), f32(((_e426 >> 20u) & 15u)))) / vec2(15f)));
                let _e441 = radius;
                let _e442 = radius;
                inverse = (vec2(1f) / (_e441 * _e442));
                let _e447 = uv_7;
                let _e448 = uv_7;
                let _e450 = inverse;
                q_5 = dot((_e447 * _e448), _e450);
                let _e453 = q_5;
                if (_e453 >= 1f) {
                    continue;
                }
                let _e457 = q_5;
                t_8 = (1f - _e457);
                let _e462 = h_7;
                weight = (0.6f + ((1.8f * f32((_e462 >> 28u))) / 15f));
                let _e471 = sum;
                let _e472 = weight;
                let _e473 = t_8;
                let _e475 = t_8;
                sum = (_e471 + ((_e472 * _e473) * _e475));
                let _e478 = tone;
                let _e479 = weight;
                let _e480 = t_8;
                let _e482 = t_8;
                let _e484 = h_7;
                tone = (_e478 + (((_e479 * _e480) * _e482) * ((f32(((_e484 >> 12u) & 15u)) / 15f) - 0.5f)));
                let _e496 = gradient_1;
                let _e499 = weight;
                let _e501 = t_8;
                let _e503 = c_9;
                let _e504 = uv_7;
                let _e507 = inverse;
                let _e510 = s_1;
                let _e511 = uv_7;
                let _e514 = inverse;
                let _e518 = s_1;
                let _e519 = uv_7;
                let _e522 = inverse;
                let _e525 = c_9;
                let _e526 = uv_7;
                let _e529 = inverse;
                gradient_1 = (_e496 + (((-4f * _e499) * _e501) * vec2<f32>((((_e503 * _e504.x) * _e507.x) - ((_e510 * _e511.y) * _e514.y)), (((_e518 * _e519.x) * _e522.x) + ((_e525 * _e526.y) * _e529.y)))));
            }
            continuing {
                let _e301 = i_4;
                i_4 = (_e301 + 1i);
            }
        }
        continuing {
            let _e291 = j_2;
            j_2 = (_e291 + 1i);
        }
    }
    let _e536 = sum;
    attenuation = exp(-(_e536));
    let _e541 = attenuation;
    let _e543 = gradient_1;
    let _e545 = attenuation;
    let _e547 = tone;
    let _e548 = attenuation;
    let _e550 = gradient_1;
    let _e552 = attenuation;
    return vec4<f32>((1f - _e541), (_e543.x * _e545), (_e547 * _e548), (_e550.y * _e552));
}

fn surfaceGroundCap(d_4: vec2<f32>, radius_1: vec2<f32>) -> vec3<f32> {
    var d_5: vec2<f32>;
    var radius_2: vec2<f32>;
    var inverse_1: vec2<f32>;
    var t_9: f32;

    d_5 = d_4;
    radius_2 = radius_1;
    let _e271 = radius_2;
    let _e272 = radius_2;
    inverse_1 = (vec2(1f) / (_e271 * _e272));
    let _e278 = d_5;
    let _e279 = d_5;
    let _e281 = inverse_1;
    t_9 = max((1f - dot((_e278 * _e279), _e281)), 0f);
    let _e287 = t_9;
    let _e288 = t_9;
    let _e292 = t_9;
    let _e294 = d_5;
    let _e296 = inverse_1;
    let _e297 = (((-4f * _e292) * _e294) * _e296);
    return vec3<f32>((_e287 * _e288), _e297.x, _e297.y);
}

fn surfaceGroundCover(world_17: vec2<f32>, slope: f32, fp_4: f32, rock: f32, grass: f32, salt_18: u32, broad: vec3<f32>, fine_1: vec3<f32>) -> vec3<f32> {
    var world_18: vec2<f32>;
    var slope_1: f32;
    var fp_5: f32;
    var rock_1: f32;
    var grass_1: f32;
    var salt_19: u32;
    var broad_1: vec3<f32>;
    var fine_2: vec3<f32>;
    var tone_1: vec3<f32> = vec3(0f);
    var supplied: bool;
    var local_28: vec3<f32>;
    var occupation_2: vec3<f32>;
    var local_29: i32;
    var local_30: i32;
    var cls: i32;
    var local_31: f32;
    var snow: f32;
    var exposed: f32;
    var moisture: f32;
    var green: f32;
    var local_32: f32;
    var land: f32;
    var light: vec2<f32>;
    var local_33: vec2<f32>;
    var herb_1: f32;
    var swardKeep: f32;
    var local_34: f32;
    var local_35: f32;
    var density: f32;
    var phase: f32;
    var temperature: f32;
    var fineKeep: f32;
    var s1_: vec3<f32>;
    var local_36: vec3<f32>;
    var s2_: vec3<f32>;
    var amount: f32;
    var grain: f32;
    var local_37: f32;
    var sand: f32;
    var reach: f32 = 0.32f;
    var angle_1: f32;
    var wind: vec2<f32>;
    var flow: vec3<f32>;
    var phase_1: f32;
    var rate: vec2<f32>;
    var keep: f32;
    var ripple: f32;
    var rippleRate: vec2<f32>;
    var rippleKeep: f32;
    var local_38: f32;
    var bank: f32;
    var distance_: f32;
    var bankKeep: f32;
    var coarse: f32;
    var k_3: f32;
    var mediumKeep: f32;
    var fineKeep_1: f32;
    var level: i32 = 0i;
    var local_39: f32;
    var local_40: f32;
    var keep_1: f32;
    var local_41: f32;
    var local_42: f32;
    var cell_4: f32;
    var local_43: f32;
    var local_44: f32;
    var height: f32;
    var cap: vec4<f32>;
    var g_2: vec2<f32>;
    var amount_1: f32;
    var scree: f32;
    var blockKeep: f32;
    var q_6: vec2<f32>;
    var h_8: u32;
    var radius_3: vec2<f32>;
    var reach_1: f32;
    var centre: vec2<f32>;
    var d_6: vec2<f32>;
    var cap_1: vec3<f32>;
    var amount_2: f32;
    var shadowRadius: vec2<f32>;
    var shadowD: vec2<f32>;
    var shadowUv: vec2<f32>;
    var shadow: f32;
    var centredShadow: f32;
    var tip: f32;
    var shadowStrength: f32;

    world_18 = world_17;
    slope_1 = slope;
    fp_5 = fp_4;
    rock_1 = rock;
    grass_1 = grass;
    salt_19 = salt_18;
    broad_1 = broad;
    fine_2 = fine_1;
    surfaceGroundSlope = vec2(0f);
    let _e287 = global.uQuality;
    if (_e287 > 0i) {
        let _e290 = tone_1;
        return _e290;
    }
    let _e291 = global.uGroundCover;
    let _e304 = fp_5;
    let _e308 = surfaceGroundHeight;
    if ((((((_e291.w < 0.5f) || (uForest == 0i)) || (uForestBrushes != 0i)) || (uRenderV2_ > 1i)) || (_e304 >= 10f)) || (_e308 <= 0f)) {
        let _e312 = tone_1;
        return _e312;
    }
    let _e313 = fp_5;
    let _e316 = surfaceGroundEnv;
    if ((_e313 >= 3f) && (_e316.z < 0.01f)) {
        let _e321 = tone_1;
        return _e321;
    }
    if (uRenderV2_ == 1i) {
        let _e326 = rock_1;
        let _e331 = grass_1;
        let _e336 = v2GroundSnow;
        surfaceGroundNormalGain = mix(((0.02f + (0.43f * _e326)) + (0.07f * (1f - _e331))), 0.008f, _e336);
    }
    let _e338 = surfaceGroundHasInputs;
    let _e339 = world_18;
    let _e340 = surfaceGroundPoint;
    supplied = (_e338 && all((_e339 == _e340)));
    let _e345 = supplied;
    if _e345 {
        let _e346 = surfaceGroundOccupation;
        local_28 = _e346;
    } else {
        local_28 = vec3(0f);
    }
    let _e350 = local_28;
    occupation_2 = _e350;
    let _e352 = supplied;
    if _e352 {
        let _e353 = occupation_2;
        local_30 = i32(_e353.z);
    } else {
        let _e356 = global.uHasOccupation;
        if (_e356 == 1i) {
            local_29 = -1i;
        } else {
            local_29 = 0i;
        }
        let _e363 = local_29;
        local_30 = _e363;
    }
    let _e365 = local_30;
    cls = _e365;
    let _e367 = cls;
    let _e370 = cls;
    let _e374 = cls;
    let _e378 = cls;
    let _e382 = cls;
    let _e386 = cls;
    let _e390 = cls;
    let _e394 = cls;
    if ((((((((_e367 < 0i) || (_e370 == 1i)) || (_e374 == 4i)) || (_e378 == 5i)) || (_e382 == 7i)) || (_e386 == 8i)) || (_e390 == 9i)) || (_e394 == 10i)) {
        let _e398 = tone_1;
        return _e398;
    }
    if (uRenderV2_ == 1i) {
        let _e401 = v2GroundSnow;
        local_31 = _e401;
    } else {
        let _e402 = surfaceGroundEnv;
        local_31 = _e402.w;
    }
    let _e405 = local_31;
    snow = clamp(_e405, 0f, 1f);
    let _e411 = snow;
    exposed = (1f - _e411);
    let _e414 = exposed;
    if (_e414 <= 0f) {
        let _e417 = tone_1;
        return _e417;
    }
    let _e418 = surfaceGroundEnv;
    moisture = _e418.x;
    let _e421 = surfaceGroundEnv;
    green = _e421.y;
    let _e424 = supplied;
    let _e425 = cls;
    if (_e424 && (_e425 > 0i)) {
        let _e431 = fp_5;
        let _e433 = occupation_2;
        let _e435 = occupation_2;
        let _e439 = sstep(0f, max(0.3f, _e431), min(_e433.x, -(_e435.y)));
        local_32 = _e439;
    } else {
        local_32 = 1f;
    }
    let _e442 = local_32;
    land = _e442;
    let _e444 = exposed;
    let _e445 = land;
    let _e447 = surfaceGroundWet;
    exposed = (_e444 * (_e445 * (1f - _e447)));
    let _e451 = global.uGroundCover;
    light = _e451.xz;
    let _e454 = light;
    let _e455 = light;
    if (dot(_e454, _e455) > 0.0001f) {
        let _e459 = light;
        local_33 = normalize(_e459);
    } else {
        local_33 = vec2<f32>(1f, 0f);
    }
    let _e465 = local_33;
    light = _e465;
    let _e466 = grass_1;
    let _e468 = rock_1;
    let _e471 = exposed;
    let _e476 = slope_1;
    let _e477 = sstep(0.35f, 0.7f, _e476);
    herb_1 = (((_e466 * (1f - _e468)) * _e471) * (1f - _e477));
    let _e484 = fp_5;
    let _e485 = sstep(0.125f, 0.25f, _e484);
    swardKeep = (1f - _e485);
    let _e488 = herb_1;
    let _e491 = swardKeep;
    if ((_e488 > 0.01f) && (_e491 > 0f)) {
        {
            let _e499 = moisture;
            let _e500 = sstep(0.2f, 1.6f, _e499);
            let _e503 = cls;
            if (_e503 == 2i) {
                local_35 = 1f;
            } else {
                let _e507 = cls;
                if (_e507 == 3i) {
                    local_34 = 0.8f;
                } else {
                    local_34 = 0.72f;
                }
                let _e513 = local_34;
                local_35 = _e513;
            }
            let _e515 = local_35;
            density = ((0.38f + (0.55f * _e500)) * _e515);
            if (uRenderV2_ == 1i) {
                {
                    let _e523 = global.uV2Season;
                    phase = (0.5f - (0.5f * cos((6.2831855f * _e523))));
                    let _e529 = global.uMaterialClimate;
                    let _e532 = surfaceGroundHeight;
                    let _e537 = phase;
                    temperature = ((_e529.x - (0.0065f * _e532)) + (6f * ((2f * _e537) - 1f)));
                    let _e546 = moisture;
                    let _e547 = sstep(0.35f, 1.3f, _e546);
                    let _e550 = temperature;
                    let _e551 = sstep(1f, 13f, _e550);
                    green = (_e547 * _e551);
                }
            }
            let _e556 = fp_5;
            let _e557 = sstep(0.035f, 0.07f, _e556);
            fineKeep = (1f - _e557);
            let _e560 = world_18;
            let _e562 = salt_19;
            let _e565 = surfaceBand(_e560, 1f, (_e562 + 817u));
            s1_ = _e565;
            let _e567 = fineKeep;
            if (_e567 > 0f) {
                let _e570 = world_18;
                let _e572 = salt_19;
                let _e575 = surfaceBand(_e570, 0.28f, (_e572 + 818u));
                local_36 = _e575;
            } else {
                local_36 = vec3(0f);
            }
            let _e579 = local_36;
            s2_ = _e579;
            let _e581 = herb_1;
            let _e582 = density;
            amount = (_e581 * _e582);
            let _e585 = surfaceGroundSlope;
            let _e586 = amount;
            let _e588 = swardKeep;
            let _e590 = s1_;
            let _e594 = fineKeep;
            let _e596 = s2_;
            surfaceGroundSlope = (_e585 + (_e586 * (((0.03f * _e588) * _e590.yz) + ((0.012f * _e594) * _e596.yz))));
            let _e603 = swardKeep;
            let _e605 = s1_;
            let _e609 = fineKeep;
            let _e611 = s2_;
            grain = (((0.6f * _e603) * _e605.x) + ((0.4f * _e609) * _e611.x));
            let _e616 = tone_1;
            let _e618 = amount;
            let _e620 = grain;
            let _e630 = green;
            tone_1 = (_e616 + (((0.07f * _e618) * _e620) * mix(vec3<f32>(0.85f, 0.7f, 0.32f), vec3<f32>(0.55f, 0.85f, 0.38f), vec3(_e630))));
        }
    }
    if (uRenderV2_ == 1i) {
        let _e637 = surfaceGroundSand;
        local_37 = _e637;
    } else {
        let _e640 = surfaceGroundEnv;
        let _e642 = sstep(0.3f, 0.7f, _e640.z);
        local_37 = _e642;
    }
    let _e644 = local_37;
    let _e646 = rock_1;
    let _e650 = grass_1;
    let _e653 = exposed;
    let _e658 = slope_1;
    let _e659 = sstep(0.35f, 0.7f, _e658);
    sand = ((((_e644 * (1f - _e646)) * (1f - _e650)) * _e653) * (1f - _e659));
    if (uRenderV2_ == 0i) {
        reach = 10f;
    }
    let _e668 = sand;
    let _e671 = fp_5;
    let _e672 = reach;
    if ((_e668 > 0.01f) && (_e671 < _e672)) {
        {
            let _e675 = salt_19;
            angle_1 = (f32((_e675 & 1023u)) * 0.006135923f);
            let _e682 = angle_1;
            let _e684 = angle_1;
            wind = vec2<f32>(cos(_e682), sin(_e684));
            let _e688 = world_18;
            let _e690 = salt_19;
            let _e693 = surfaceBand(_e688, 1600f, (_e690 + 821u));
            flow = _e693;
            if (uRenderV2_ == 0i) {
                {
                    let _e697 = world_18;
                    let _e698 = wind;
                    let _e703 = flow;
                    let _e708 = surfaceGroundHeight;
                    phase_1 = (((dot(_e697, _e698) * 0.0698f) + (2.5f * _e703.x)) + (0.07f * _e708));
                    let _e712 = wind;
                    let _e716 = flow;
                    let _e721 = surfaceGroundGradient;
                    rate = (((_e712 * 0.0698f) + (2.5f * _e716.yz)) + (0.07f * _e721));
                    let _e728 = fp_5;
                    let _e729 = sstep(5f, 10f, _e728);
                    let _e734 = fp_5;
                    let _e735 = rate;
                    let _e740 = sstep(0.125f, 0.25f, ((_e734 * length(_e735)) / 6.2831855f));
                    keep = ((1f - _e729) * (1f - _e740));
                    let _e744 = surfaceGroundSlope;
                    let _e745 = sand;
                    let _e746 = keep;
                    let _e750 = phase_1;
                    let _e753 = rate;
                    surfaceGroundSlope = (_e744 + ((((_e745 * _e746) * 0.9f) * cos(_e750)) * _e753));
                    let _e756 = tone_1;
                    let _e757 = sand;
                    let _e758 = keep;
                    let _e762 = phase_1;
                    tone_1 = (_e756 + vec3((((_e757 * _e758) * 0.05f) * sin(_e762))));
                }
            }
            let _e767 = fp_5;
            if (_e767 < 0.32f) {
                {
                    let _e770 = world_18;
                    let _e771 = wind;
                    let _e776 = flow;
                    let _e781 = surfaceGroundHeight;
                    ripple = (((dot(_e770, _e771) * 4.4879894f) + (1400f * _e776.x)) + (0.6f * _e781));
                    let _e785 = wind;
                    let _e789 = flow;
                    let _e794 = surfaceGroundGradient;
                    rippleRate = (((_e785 * 4.4879894f) + (1400f * _e789.yz)) + (0.6f * _e794));
                    let _e801 = fp_5;
                    let _e802 = sstep(0.16f, 0.32f, _e801);
                    let _e807 = fp_5;
                    let _e808 = rippleRate;
                    let _e813 = sstep(0.125f, 0.25f, ((_e807 * length(_e808)) / 6.2831855f));
                    rippleKeep = ((1f - _e802) * (1f - _e813));
                    let _e817 = surfaceGroundSlope;
                    let _e818 = sand;
                    let _e819 = rippleKeep;
                    let _e823 = ripple;
                    let _e826 = rippleRate;
                    surfaceGroundSlope = (_e817 + ((((_e818 * _e819) * 0.065f) * cos(_e823)) * _e826));
                }
            }
        }
    }
    let _e829 = supplied;
    if _e829 {
        let _e830 = surfaceGroundBank;
        local_38 = _e830;
    } else {
        local_38 = 1000000000f;
    }
    let _e833 = local_38;
    bank = _e833;
    let _e835 = surfaceGroundShore;
    let _e836 = bank;
    distance_ = min(_e835, _e836);
    let _e839 = exposed;
    let _e842 = distance_;
    let _e843 = sstep(0f, 0.3f, _e842);
    let _e848 = distance_;
    let _e849 = sstep(8f, 36f, _e848);
    let _e855 = slope_1;
    let _e856 = sstep(0.5f, 0.9f, _e855);
    bankKeep = (((_e839 * _e843) * (1f - _e849)) * (1f - _e856));
    let _e860 = bankKeep;
    let _e861 = surfaceGroundBeach;
    let _e864 = grass_1;
    bankKeep = (_e860 * max(_e861, (1f - (0.55f * _e864))));
    let _e869 = bankKeep;
    let _e872 = fp_5;
    if ((_e869 > 0.01f) && (_e872 < 1f)) {
        {
            let _e879 = distance_;
            let _e880 = sstep(2f, 18f, _e879);
            coarse = (1f - _e880);
            let _e886 = fp_5;
            let _e887 = sstep(0.4f, 1f, _e886);
            k_3 = (1f - _e887);
            let _e893 = fp_5;
            let _e894 = sstep(0.12f, 0.3f, _e893);
            mediumKeep = (1f - _e894);
            let _e900 = fp_5;
            let _e901 = sstep(0.01f, 0.026f, _e900);
            fineKeep_1 = (1f - _e901);
            loop {
                let _e906 = level;
                if !((_e906 < 3i)) {
                    break;
                }
                {
                    let _e913 = level;
                    if (_e913 == 0i) {
                        let _e916 = k_3;
                        let _e918 = mediumKeep;
                        local_40 = (_e916 * (1f - _e918));
                    } else {
                        let _e921 = level;
                        if (_e921 == 1i) {
                            let _e924 = mediumKeep;
                            let _e926 = fineKeep_1;
                            local_39 = (_e924 * (1f - _e926));
                        } else {
                            let _e929 = fineKeep_1;
                            local_39 = _e929;
                        }
                        let _e931 = local_39;
                        local_40 = _e931;
                    }
                    let _e933 = local_40;
                    keep_1 = _e933;
                    let _e935 = keep_1;
                    if (_e935 <= 0f) {
                        continue;
                    }
                    let _e938 = level;
                    if (_e938 == 0i) {
                        local_42 = 8f;
                    } else {
                        let _e942 = level;
                        if (_e942 == 1i) {
                            local_41 = 2.4f;
                        } else {
                            local_41 = 0.26f;
                        }
                        let _e948 = local_41;
                        local_42 = _e948;
                    }
                    let _e950 = local_42;
                    cell_4 = _e950;
                    let _e952 = level;
                    if (_e952 == 0i) {
                        local_44 = 0.75f;
                    } else {
                        let _e956 = level;
                        if (_e956 == 1i) {
                            local_43 = 0.32f;
                        } else {
                            local_43 = 0.03f;
                        }
                        let _e962 = local_43;
                        local_44 = _e962;
                    }
                    let _e964 = local_44;
                    height = _e964;
                    let _e966 = world_18;
                    let _e967 = cell_4;
                    let _e970 = salt_19;
                    let _e973 = level;
                    let _e976 = groundGravel((_e966 / vec2(_e967)), ((_e970 + 827u) + u32(_e973)));
                    cap = _e976;
                    let _e978 = cap;
                    let _e980 = cell_4;
                    g_2 = (_e978.yw / vec2(_e980));
                    let _e984 = bankKeep;
                    let _e985 = keep_1;
                    let _e989 = coarse;
                    amount_1 = ((_e984 * _e985) * (0.45f + (0.55f * _e989)));
                    let _e994 = surfaceGroundSlope;
                    let _e995 = amount_1;
                    let _e996 = height;
                    let _e998 = g_2;
                    surfaceGroundSlope = (_e994 + ((_e995 * _e996) * _e998));
                    let _e1001 = tone_1;
                    let _e1002 = amount_1;
                    let _e1003 = height;
                    let _e1006 = g_2;
                    let _e1007 = light;
                    let _e1011 = cap;
                    let _e1016 = cap;
                    let _e1024 = cap;
                    tone_1 = (_e1001 + (_e1002 * ((vec3((((_e1003 * 0.2f) * dot(_e1006, _e1007)) - (0.1f * _e1011.x))) + (_e1016.z * vec3<f32>(0.28f, 0.25f, 0.2f))) + (_e1024.x * vec3<f32>(0.08f, 0.07f, 0.16f)))));
                }
                continuing {
                    let _e910 = level;
                    level = (_e910 + 1i);
                }
            }
        }
    }
    let _e1036 = slope_1;
    let _e1037 = sstep(0.22f, 0.42f, _e1036);
    let _e1041 = slope_1;
    let _e1042 = sstep(1.1f, 1.7f, _e1041);
    let _e1047 = grass_1;
    let _e1051 = exposed;
    scree = (((_e1037 * (1f - _e1042)) * (1f - (0.85f * _e1047))) * _e1051);
    let _e1057 = fp_5;
    let _e1058 = sstep(1.2f, 3f, _e1057);
    blockKeep = (1f - _e1058);
    let _e1061 = scree;
    let _e1064 = blockKeep;
    if ((_e1061 > 0.01f) && (_e1064 > 0f)) {
        {
            let _e1068 = world_18;
            q_6 = (_e1068 / vec2(16f));
            let _e1073 = q_6;
            let _e1075 = vec2<i32>(floor(_e1073));
            let _e1080 = salt_19;
            let _e1081 = groundHash(vec3<i32>(_e1075.x, _e1075.y, 839i), _e1080);
            h_8 = _e1081;
            let _e1083 = h_8;
            let _e1091 = rock_1;
            if ((f32((_e1083 >> 24u)) / 255f) < (0.12f + (0.16f * _e1091))) {
                {
                    let _e1097 = h_8;
                    let _e1103 = h_8;
                    radius_3 = (vec2(0.09f) + ((0.12f * vec2<f32>(f32(((_e1097 >> 16u) & 15u)), f32(((_e1103 >> 20u) & 15u)))) / vec2(15f)));
                    let _e1117 = radius_3;
                    let _e1119 = radius_3;
                    reach_1 = (max(_e1117.x, _e1119.y) * 1.9f);
                    let _e1125 = reach_1;
                    let _e1128 = reach_1;
                    let _e1131 = h_8;
                    let _e1135 = h_8;
                    centre = (vec2(_e1125) + (((1f - (2f * _e1128)) * vec2<f32>(f32((_e1131 & 255u)), f32(((_e1135 >> 8u) & 255u)))) / vec2(255f)));
                    let _e1149 = q_6;
                    let _e1151 = centre;
                    d_6 = (fract(_e1149) - _e1151);
                    let _e1154 = d_6;
                    let _e1155 = radius_3;
                    let _e1156 = surfaceGroundCap(_e1154, _e1155);
                    cap_1 = _e1156;
                    let _e1158 = scree;
                    let _e1159 = blockKeep;
                    amount_2 = (_e1158 * _e1159);
                    let _e1162 = surfaceGroundSlope;
                    let _e1163 = amount_2;
                    let _e1164 = cap_1;
                    surfaceGroundSlope = (_e1162 + (((_e1163 * _e1164.yz) * 1.3f) / vec2(16f)));
                    let _e1174 = radius_3;
                    let _e1176 = radius_3;
                    let _e1181 = radius_3;
                    let _e1183 = radius_3;
                    shadowRadius = vec2<f32>((1.2f * max(_e1174.x, _e1176.y)), (0.95f * min(_e1181.x, _e1183.y)));
                    let _e1189 = d_6;
                    let _e1190 = light;
                    let _e1193 = shadowRadius;
                    shadowD = (_e1189 + ((_e1190 * 0.55f) * _e1193.x));
                    let _e1198 = shadowD;
                    let _e1199 = light;
                    let _e1201 = shadowD;
                    let _e1202 = light;
                    let _e1205 = light;
                    shadowUv = vec2<f32>(dot(_e1198, _e1199), dot(_e1201, vec2<f32>(-(_e1202.y), _e1205.x)));
                    let _e1211 = shadowUv;
                    let _e1212 = shadowRadius;
                    let _e1213 = surfaceGroundCap(_e1211, _e1212);
                    shadow = _e1213.x;
                    let _e1216 = shadow;
                    let _e1217 = cap_1;
                    let _e1219 = shadowRadius;
                    let _e1221 = shadowRadius;
                    let _e1225 = radius_3;
                    let _e1227 = radius_3;
                    centredShadow = (_e1216 - ((_e1217.x * (_e1219.x * _e1221.y)) / (_e1225.x * _e1227.y)));
                    let _e1233 = cap_1;
                    let _e1235 = cap_1;
                    tip = (_e1233.x * (sqrt(_e1235.x) - 0.75f));
                    let _e1245 = global.uGroundCover;
                    let _e1247 = global.uGroundCover;
                    let _e1253 = sstep(0.85f, 0.99f, (_e1245.y / max(length(_e1247.xyz), 0.001f)));
                    shadowStrength = (1f - _e1253);
                    let _e1256 = tone_1;
                    let _e1257 = amount_2;
                    let _e1259 = tip;
                    let _e1262 = centredShadow;
                    let _e1264 = shadowStrength;
                    tone_1 = (_e1256 + vec3((_e1257 * ((0.3f * _e1259) - ((0.1f * _e1262) * _e1264)))));
                }
            }
        }
    }
    let _e1270 = tone_1;
    return _e1270;
}

fn surfaceChute(world_19: vec2<f32>, across: f32, along: f32, salt_20: u32) -> f32 {
    var world_20: vec2<f32>;
    var across_1: f32;
    var along_1: f32;
    var salt_21: u32;
    var turn: f32;
    var sector: f32;
    var w_1: f32;
    var value: f32 = 0f;
    var slope_2: vec2<f32> = vec2(0f);
    var i_5: i32 = 0i;
    var j_3: i32;
    var angle_2: f32;
    var d_7: vec2<f32>;
    var side: vec2<f32>;
    var n_4: vec3<f32>;
    var local_45: f32;
    var weight_1: f32;
    var unit: f32;

    world_20 = world_19;
    across_1 = across;
    along_1 = along;
    salt_21 = salt_20;
    let _e274 = surfaceFall;
    let _e276 = surfaceFall;
    turn = ((atan2(_e274.y, _e276.x) * 5.092958f) + 16f);
    let _e284 = turn;
    sector = floor(_e284);
    let _e287 = turn;
    let _e288 = sector;
    w_1 = (_e287 - _e288);
    let _e291 = w_1;
    let _e292 = w_1;
    let _e296 = w_1;
    w_1 = ((_e291 * _e292) * (3f - (2f * _e296)));
    loop {
        let _e307 = i_5;
        if !((_e307 < 2i)) {
            break;
        }
        {
            let _e314 = sector;
            let _e316 = i_5;
            j_3 = ((i32(_e314) + _e316) & 15i);
            let _e321 = j_3;
            angle_2 = (f32(_e321) * 0.19634955f);
            let _e326 = angle_2;
            let _e328 = angle_2;
            d_7 = vec2<f32>(cos(_e326), sin(_e328));
            let _e332 = d_7;
            let _e335 = d_7;
            side = vec2<f32>(-(_e332.y), _e335.x);
            let _e339 = world_20;
            let _e340 = side;
            let _e342 = across_1;
            let _e344 = world_20;
            let _e345 = d_7;
            let _e347 = along_1;
            let _e350 = salt_21;
            let _e351 = j_3;
            let _e356 = surfacePlane(vec2<f32>((dot(_e339, _e340) / _e342), (dot(_e344, _e345) / _e347)), (_e350 + (u32(_e351) * 40503u)));
            n_4 = _e356;
            let _e358 = i_5;
            if (_e358 == 0i) {
                let _e362 = w_1;
                local_45 = (1f - _e362);
            } else {
                let _e364 = w_1;
                local_45 = _e364;
            }
            let _e366 = local_45;
            weight_1 = _e366;
            let _e368 = value;
            let _e369 = weight_1;
            let _e370 = n_4;
            value = (_e368 + (_e369 * _e370.x));
            let _e374 = slope_2;
            let _e375 = weight_1;
            let _e376 = side;
            let _e377 = n_4;
            let _e380 = across_1;
            let _e383 = d_7;
            let _e384 = n_4;
            let _e387 = along_1;
            slope_2 = (_e374 + (_e375 * (((_e376 * _e377.y) / vec2(_e380)) + ((_e383 * _e384.z) / vec2(_e387)))));
        }
        continuing {
            let _e311 = i_5;
            i_5 = (_e311 + 1i);
        }
    }
    let _e395 = w_1;
    let _e398 = w_1;
    unit = inverseSqrt((1f - ((2f * _e395) * (1f - _e398))));
    let _e404 = slope_2;
    let _e405 = unit;
    surfaceChuteSlope = (_e404 * _e405);
    let _e407 = value;
    let _e408 = unit;
    return (_e407 * _e408);
}

fn surfaceMicro(world_21: vec2<f32>, slope_3: f32, fp_6: f32, rock_2: f32, grass_2: f32, salt_22: u32) -> vec3<f32> {
    var world_22: vec2<f32>;
    var slope_4: f32;
    var fp_7: f32;
    var rock_3: f32;
    var grass_3: f32;
    var salt_23: u32;
    var fallLength: f32;
    var local_46: vec2<f32>;
    var k1_: f32;
    var k2_: f32;
    var k3_: f32;
    var k4_: f32;
    var k5_: f32;
    var k6_: f32;
    var close: f32;
    var n1_: vec3<f32> = vec3(0f);
    var n2_: vec3<f32> = vec3(0f);
    var n3_: vec3<f32> = vec3(0f);
    var n4_: vec3<f32> = vec3(0f);
    var n5_: vec3<f32> = vec3(0f);
    var n6_: vec3<f32> = vec3(0f);
    var k_4: i32 = 0i;
    var local_47: vec2<f32>;
    var at_1: vec2<f32>;
    var local_48: f32;
    var local_49: f32;
    var local_50: f32;
    var local_51: f32;
    var local_52: f32;
    var local_53: u32;
    var n_5: vec3<f32>;
    var fineSlope: vec2<f32>;
    var dry: f32;
    var mottle: f32;
    var soil: f32;
    var herb_2: f32;
    var ragged: f32;
    var community: f32;
    var clump: f32;
    var worn: f32;
    var stand: f32;
    var tone_2: f32;
    var hue: vec3<f32>;
    var relief: f32;
    var steep: f32;
    var streaks: f32;
    var wear: f32 = 0f;
    var coarse_1: f32 = 0f;
    var hollow: f32 = 0f;
    var furrow: vec2<f32> = vec2(0f);
    var k_5: i32 = 0i;
    var local_54: f32;
    var local_55: f32;
    var across_2: f32;
    var keep_2: f32;
    var fall: vec2<f32>;
    var reach_2: f32;
    var local_56: vec2<f32>;
    var chute: f32;
    var local_57: f32;
    var amount_3: f32;
    var local_58: f32;
    var local_59: f32;
    var local_60: f32;
    var local_61: f32;
    var local_62: f32;
    var strike: f32;
    var run: vec2<f32>;
    var jointing: f32;
    var detail: f32;
    var cracks: f32 = 0f;
    var k_6: i32 = 0i;
    var local_63: f32;
    var local_64: f32;
    var spacing: f32;
    var local_65: vec2<f32>;
    var local_66: vec2<f32>;
    var d_8: vec2<f32>;
    var local_67: f32;
    var a_9: f32;
    var row: f32;
    var h_9: u32;
    var b_10: f32;
    var cell_5: f32;
    var g_3: u32;
    var t_10: f32;
    var w_2: f32;
    var gap: f32;
    var local_68: f32;
    var local_69: f32;
    var outcrop: f32;
    var local_70: f32;
    var local_71: f32;
    var blocky: f32;
    var block: f32 = 0f;
    var tilt_1: vec2<f32> = vec2(0f);
    var jointed: vec2<f32>;
    var k_7: i32 = 0i;
    var local_72: f32;
    var local_73: f32;
    var size: f32;
    var local_74: vec2<f32>;
    var local_75: vec2<f32>;
    var bent: vec2<f32>;
    var f_9: vec4<f32>;
    var thinned: f32;
    var local_76: f32;
    var local_77: f32;
    var joint: f32;
    var local_78: f32;
    var local_79: f32;
    var local_80: f32;
    var amount_4: f32;
    var local_81: f32;
    var local_82: f32;
    var local_83: f32;
    var local_84: f32;
    var face: f32;
    var rate_1: f32;
    var ledges: f32 = 0f;
    var k_8: i32 = 0i;
    var local_85: f32;
    var local_86: f32;
    var local_87: f32;
    var t_11: f32;
    var z_4: f32;
    var local_88: f32;
    var local_89: f32;
    var local_90: f32;
    var local_91: f32;
    var local_92: f32;
    var local_93: f32;
    var local_94: f32;
    var local_95: f32;
    var talus: f32;
    var stony: f32;
    var clastic: f32;
    var loose: f32;
    var kc: f32;
    var chip: vec4<f32> = vec4<f32>(0f, 1f, 0f, 0f);
    var k_9: i32 = 0i;
    var local_96: vec2<f32>;
    var local_97: vec2<f32>;
    var bend: vec2<f32>;
    var local_98: f32;
    var local_99: f32;
    var local_100: f32;
    var st: vec4<f32>;
    var local_101: f32;
    var local_102: f32;
    var sorted: f32;
    var grain_1: f32;
    var bare: f32;
    var speckled: f32;
    var inside: f32;
    var speck: f32;
    var crumb: f32;

    world_22 = world_21;
    slope_4 = slope_3;
    fp_7 = fp_6;
    rock_3 = rock_2;
    grass_3 = grass_2;
    salt_23 = salt_22;
    surfaceMicroSlope = vec2(0f);
    surfaceMicroTone = vec3(1f);
    surfaceGroundSlope = vec2(0f);
    surfaceGroundNormalGain = 1f;
    let _e285 = global.uQuality;
    if (_e285 > 0i) {
        {
            let _e288 = fp_7;
            if (_e288 < 2f) {
                let _e293 = world_22;
                let _e295 = salt_23;
                let _e298 = surfaceBand(_e293, 40f, (_e295 + 31u));
                let _e303 = fp_7;
                let _e304 = sstep(1f, 2f, _e303);
                let _e309 = grass_3;
                surfaceMicroTone = (vec3(1f) + ((_e298.x * (1f - _e304)) * (vec3(0.025f) + (_e309 * vec3<f32>(0.025f, 0.01f, -0.015f)))));
            }
            let _e319 = surfaceMicroTone;
            return _e319;
        }
    }
    let _e320 = fp_7;
    if (_e320 >= 10f) {
        {
            let _e323 = surfaceMicroTone;
            return _e323;
        }
    }
    let _e324 = surfaceGroundGradient;
    fallLength = length(_e324);
    let _e327 = fallLength;
    if (_e327 > 0.0001f) {
        let _e330 = surfaceGroundGradient;
        let _e331 = fallLength;
        local_46 = (_e330 / vec2(_e331));
    } else {
        local_46 = vec2<f32>(1f, 0f);
    }
    let _e338 = local_46;
    surfaceFall = _e338;
    let _e342 = fp_7;
    let _e343 = sstep(5f, 10f, _e342);
    k1_ = (1f - _e343);
    let _e349 = fp_7;
    let _e350 = sstep(1.4f, 2.8f, _e349);
    k2_ = (1f - _e350);
    let _e356 = fp_7;
    let _e357 = sstep(0.38f, 0.76f, _e356);
    k3_ = (1f - _e357);
    let _e363 = fp_7;
    let _e364 = sstep(0.1f, 0.2f, _e363);
    k4_ = (1f - _e364);
    let _e370 = fp_7;
    let _e371 = sstep(0.0375f, 0.075f, _e370);
    k5_ = (1f - _e371);
    let _e377 = fp_7;
    let _e378 = sstep(0.011f, 0.0225f, _e377);
    k6_ = (1f - _e378);
    let _e384 = fp_7;
    let _e385 = sstep(0.03f, 0.1f, _e384);
    close = (1f - _e385);
    loop {
        let _e408 = k_4;
        if !((_e408 < 6i)) {
            break;
        }
        {
            let _e415 = k_4;
            let _e418 = k2_;
            let _e422 = k_4;
            let _e425 = k3_;
            let _e430 = k_4;
            let _e433 = k4_;
            let _e438 = k_4;
            let _e441 = k5_;
            let _e446 = k_4;
            let _e449 = k6_;
            if ((((((_e415 == 1i) && (_e418 <= 0f)) || ((_e422 == 2i) && (_e425 <= 0f))) || ((_e430 == 3i) && (_e433 <= 0f))) || ((_e438 == 4i) && (_e441 <= 0f))) || ((_e446 == 5i) && (_e449 <= 0f))) {
                continue;
            }
            let _e454 = k_4;
            if (_e454 < 4i) {
                let _e457 = world_22;
                local_47 = _e457;
            } else {
                let _e459 = world_22;
                let _e463 = world_22;
                let _e468 = world_22;
                let _e472 = world_22;
                local_47 = vec2<f32>(((0.28f * _e459.x) - (0.96f * _e463.y)), ((0.96f * _e468.x) + (0.28f * _e472.y)));
            }
            let _e478 = local_47;
            at_1 = _e478;
            let _e480 = at_1;
            let _e481 = k_4;
            if (_e481 == 0i) {
                local_52 = 40f;
            } else {
                let _e485 = k_4;
                if (_e485 == 1i) {
                    local_51 = 11f;
                } else {
                    let _e489 = k_4;
                    if (_e489 == 2i) {
                        local_50 = 3f;
                    } else {
                        let _e493 = k_4;
                        if (_e493 == 3i) {
                            local_49 = 0.8f;
                        } else {
                            let _e497 = k_4;
                            if (_e497 == 4i) {
                                local_48 = 0.3f;
                            } else {
                                local_48 = 0.09f;
                            }
                            let _e503 = local_48;
                            local_49 = _e503;
                        }
                        let _e505 = local_49;
                        local_50 = _e505;
                    }
                    let _e507 = local_50;
                    local_51 = _e507;
                }
                let _e509 = local_51;
                local_52 = _e509;
            }
            let _e511 = local_52;
            let _e512 = salt_23;
            let _e513 = k_4;
            if (_e513 < 4i) {
                local_53 = 31u;
            } else {
                local_53 = 93u;
            }
            let _e519 = local_53;
            let _e521 = k_4;
            let _e524 = surfaceBand(_e480, _e511, ((_e512 + _e519) + u32(_e521)));
            n_5 = _e524;
            let _e526 = k_4;
            if (_e526 >= 4i) {
                let _e529 = n_5;
                let _e532 = n_5;
                let _e536 = n_5;
                let _e541 = n_5;
                let _e545 = n_5;
                n_5 = vec3<f32>(_e529.x, ((0.28f * _e532.y) + (0.96f * _e536.z)), ((0.28f * _e541.z) - (0.96f * _e545.y)));
            }
            let _e550 = k_4;
            if (_e550 == 0i) {
                let _e553 = n_5;
                n1_ = _e553;
            } else {
                let _e554 = k_4;
                if (_e554 == 1i) {
                    let _e557 = n_5;
                    n2_ = _e557;
                } else {
                    let _e558 = k_4;
                    if (_e558 == 2i) {
                        let _e561 = n_5;
                        n3_ = _e561;
                    } else {
                        let _e562 = k_4;
                        if (_e562 == 3i) {
                            let _e565 = n_5;
                            n4_ = _e565;
                        } else {
                            let _e566 = k_4;
                            if (_e566 == 4i) {
                                let _e569 = n_5;
                                n5_ = _e569;
                            } else {
                                let _e570 = n_5;
                                n6_ = _e570;
                            }
                        }
                    }
                }
            }
        }
        continuing {
            let _e412 = k_4;
            k_4 = (_e412 + 1i);
        }
    }
    let _e572 = k5_;
    let _e574 = n5_;
    let _e578 = k6_;
    let _e580 = n6_;
    fineSlope = (((0.3f * _e572) * _e574.yz) + ((0.09f * _e578) * _e580.yz));
    let _e586 = k5_;
    let _e588 = n5_;
    let _e592 = k6_;
    let _e594 = n6_;
    let _e599 = k5_;
    let _e601 = n5_;
    let _e605 = k6_;
    let _e607 = n6_;
    let _e610 = (((0.55f * _e599) * _e601.yz) + ((0.45f * _e605) * _e607.yz));
    surfaceFineGrain = vec3<f32>((((0.55f * _e586) * _e588.x) + ((0.45f * _e592) * _e594.x)), _e610.x, _e610.y);
    surfaceFineBreak = 0f;
    let _e619 = surfaceGroundHeight;
    let _e620 = sstep(0f, -0.5f, _e619);
    dry = (1f - _e620);
    let _e623 = surfaceGroundWaterCached;
    let _e624 = world_22;
    let _e625 = surfaceGroundWaterPoint;
    if (_e623 && all((_e624 == _e625))) {
        let _e629 = dry;
        let _e631 = surfaceGroundWaterSample;
        dry = (_e629 * (1f - clamp(_e631, 0f, 1f)));
    }
    let _e637 = dry;
    surfaceGroundDry = _e637;
    let _e640 = k1_;
    let _e642 = n1_;
    let _e646 = k2_;
    let _e648 = n2_;
    let _e653 = k3_;
    let _e655 = n3_;
    let _e660 = k4_;
    let _e662 = n4_;
    let _e666 = fineSlope;
    surfaceMicroSlope = (0.1f * ((((((40f * _e640) * _e642.yz) + ((11f * _e646) * _e648.yz)) + ((3f * _e653) * _e655.yz)) + ((0.8f * _e660) * _e662.yz)) + _e666));
    let _e670 = k1_;
    let _e672 = n1_;
    let _e676 = k2_;
    let _e678 = n2_;
    let _e684 = close;
    let _e688 = k3_;
    let _e690 = n3_;
    let _e694 = k4_;
    let _e696 = n4_;
    mottle = ((((0.5f * _e670) * _e672.x) + ((0.38f * _e676) * _e678.x)) + ((1f - (0.5f * _e684)) * (((0.3f * _e688) * _e690.x) + ((0.22f * _e694) * _e696.x))));
    let _e704 = rock_3;
    let _e707 = grass_3;
    soil = ((1f - _e704) * (1f - _e707));
    let _e712 = rock_3;
    let _e714 = grass_3;
    herb_2 = ((1f - _e712) * _e714);
    let _e719 = fp_7;
    ragged = (0.1f + (0.06f * _e719));
    let _e723 = k1_;
    let _e724 = ragged;
    let _e726 = ragged;
    let _e727 = n1_;
    let _e730 = k2_;
    let _e732 = n2_;
    let _e737 = k3_;
    let _e739 = n3_;
    let _e744 = k5_;
    let _e746 = n5_;
    let _e751 = k6_;
    let _e753 = n6_;
    let _e757 = sstep(-(_e724), _e726, ((((_e727.x + ((0.5f * _e730) * _e732.x)) + ((0.25f * _e737) * _e739.x)) + ((0.07f * _e744) * _e746.x)) + ((0.035f * _e751) * _e753.x)));
    community = (_e723 * (_e757 - 0.5f));
    let _e762 = k3_;
    let _e765 = n3_;
    let _e768 = k4_;
    let _e770 = n4_;
    let _e775 = k5_;
    let _e777 = n5_;
    let _e782 = k6_;
    let _e784 = n6_;
    let _e788 = sstep(0.15f, 0.45f, (((_e765.x + ((0.5f * _e768) * _e770.x)) + ((0.25f * _e775) * _e777.x)) + ((0.15f * _e782) * _e784.x)));
    let _e793 = k4_;
    let _e797 = n4_;
    let _e800 = n3_;
    let _e805 = k5_;
    let _e807 = n5_;
    let _e812 = k6_;
    let _e814 = n6_;
    let _e818 = sstep(0.2f, 0.5f, (((_e797.x - (0.4f * _e800.x)) + ((0.3f * _e805) * _e807.x)) + ((0.2f * _e812) * _e814.x)));
    clump = ((_e762 * (_e788 - 0.39f)) + ((0.6f * _e793) * (_e818 - 0.37f)));
    let _e824 = k2_;
    let _e825 = k3_;
    let _e829 = n2_;
    let _e832 = n3_;
    let _e838 = k5_;
    let _e840 = n5_;
    let _e845 = k6_;
    let _e847 = n6_;
    let _e851 = sstep(2f, 2.3f, ((-((_e829.x + (0.6f * _e832.x))) + ((0.2f * _e838) * _e840.x)) + ((0.1f * _e845) * _e847.x)));
    worn = ((_e824 * _e825) * _e851);
    let _e856 = close;
    stand = (1f - (0.35f * _e856));
    let _e861 = mottle;
    let _e863 = soil;
    let _e866 = herb_2;
    let _e870 = rock_3;
    let _e875 = herb_2;
    let _e876 = stand;
    let _e879 = community;
    let _e882 = clump;
    tone_2 = ((1f + (_e861 * (((0.05f * _e863) + (0.02f * _e866)) + (0.035f * _e870)))) + ((_e875 * _e876) * ((0.034f * _e879) + (0.05f * _e882))));
    let _e890 = mottle;
    let _e891 = soil;
    let _e900 = herb_2;
    let _e901 = stand;
    let _e903 = community;
    let _e906 = clump;
    let _e911 = mottle;
    let _e920 = worn;
    hue = ((vec3(1f) + ((_e890 * _e891) * vec3<f32>(0.012f, 0f, -0.016f))) + (_e900 * ((((_e901 * ((0.03f * _e903) + (0.022f * _e906))) + (0.02f * _e911)) * vec3<f32>(1f, 0.13f, -0.8f)) + (_e920 * vec3<f32>(0.1f, 0.04f, -0.03f)))));
    let _e931 = rock_3;
    if (_e931 > 0.02f) {
        {
            let _e938 = slope_4;
            let _e939 = sstep(0.5f, 1.2f, _e938);
            let _e945 = fp_7;
            let _e946 = sstep(1.5f, 5f, _e945);
            relief = (mix(1f, 0.65f, _e939) * mix(1f, 0.45f, _e946));
            let _e952 = slope_4;
            let _e953 = sstep(0.12f, 0.5f, _e952);
            steep = _e953;
            let _e955 = steep;
            let _e956 = surfaceStreakWeight;
            streaks = (_e955 * _e956);
            let _e968 = streaks;
            if (_e968 > 0.01f) {
                {
                    loop {
                        let _e973 = k_5;
                        if !((_e973 < 3i)) {
                            break;
                        }
                        {
                            let _e980 = k_5;
                            if (_e980 == 0i) {
                                local_55 = 30f;
                            } else {
                                let _e984 = k_5;
                                if (_e984 == 1i) {
                                    local_54 = 9f;
                                } else {
                                    local_54 = 2.8f;
                                }
                                let _e990 = local_54;
                                local_55 = _e990;
                            }
                            let _e992 = local_55;
                            across_2 = _e992;
                            let _e995 = across_2;
                            let _e998 = across_2;
                            let _e1001 = fp_7;
                            let _e1002 = sstep((_e995 * 0.125f), (_e998 * 0.25f), _e1001);
                            keep_2 = (1f - _e1002);
                            let _e1005 = keep_2;
                            if (_e1005 <= 0f) {
                                continue;
                            }
                            let _e1008 = surfaceGroundGradient;
                            fall = _e1008;
                            let _e1010 = k_5;
                            if (_e1010 > 0i) {
                                let _e1013 = fall;
                                let _e1015 = k1_;
                                let _e1017 = n1_;
                                fall = (_e1013 + ((4.8f * _e1015) * _e1017.yz));
                            }
                            let _e1021 = k_5;
                            if (_e1021 > 1i) {
                                let _e1024 = fall;
                                let _e1026 = k2_;
                                let _e1028 = n2_;
                                fall = (_e1024 + ((1.3f * _e1026) * _e1028.yz));
                            }
                            let _e1032 = fall;
                            reach_2 = length(_e1032);
                            let _e1035 = reach_2;
                            if (_e1035 > 0.0001f) {
                                let _e1038 = fall;
                                let _e1039 = reach_2;
                                local_56 = (_e1038 / vec2(_e1039));
                            } else {
                                local_56 = vec2<f32>(1f, 0f);
                            }
                            let _e1046 = local_56;
                            surfaceFall = _e1046;
                            let _e1047 = world_22;
                            let _e1048 = across_2;
                            let _e1050 = across_2;
                            let _e1052 = salt_23;
                            let _e1055 = k_5;
                            let _e1058 = surfaceChute(_e1047, _e1048, (6.5f * _e1050), ((_e1052 + 61u) + u32(_e1055)));
                            chute = _e1058;
                            let _e1060 = keep_2;
                            let _e1061 = k_5;
                            if (_e1061 == 0i) {
                                local_57 = 1f;
                            } else {
                                let _e1070 = coarse_1;
                                let _e1071 = sstep(-1f, 0.3f, _e1070);
                                local_57 = (0.45f + (0.55f * _e1071));
                            }
                            let _e1075 = local_57;
                            amount_3 = (_e1060 * _e1075);
                            let _e1078 = chute;
                            coarse_1 = _e1078;
                            let _e1079 = wear;
                            let _e1080 = k_5;
                            if (_e1080 == 0i) {
                                local_59 = 0.09f;
                            } else {
                                let _e1084 = k_5;
                                if (_e1084 == 1i) {
                                    local_58 = 0.07f;
                                } else {
                                    local_58 = 0.055f;
                                }
                                let _e1090 = local_58;
                                local_59 = _e1090;
                            }
                            let _e1092 = local_59;
                            let _e1093 = amount_3;
                            let _e1095 = chute;
                            wear = (_e1079 + ((_e1092 * _e1093) * _e1095));
                            let _e1098 = furrow;
                            let _e1099 = k_5;
                            if (_e1099 == 0i) {
                                local_61 = 0.16f;
                            } else {
                                let _e1103 = k_5;
                                if (_e1103 == 1i) {
                                    local_60 = 0.13f;
                                } else {
                                    local_60 = 0.1f;
                                }
                                let _e1109 = local_60;
                                local_61 = _e1109;
                            }
                            let _e1111 = local_61;
                            let _e1112 = across_2;
                            let _e1114 = amount_3;
                            let _e1116 = surfaceChuteSlope;
                            furrow = (_e1098 + (((_e1111 * _e1112) * _e1114) * _e1116));
                            let _e1119 = hollow;
                            let _e1120 = k_5;
                            if (_e1120 == 0i) {
                                local_62 = 0.5f;
                            } else {
                                local_62 = 0.3f;
                            }
                            let _e1126 = local_62;
                            let _e1127 = amount_3;
                            let _e1129 = chute;
                            hollow = (_e1119 + ((_e1126 * _e1127) * max(-(_e1129), 0f)));
                        }
                        continuing {
                            let _e977 = k_5;
                            k_5 = (_e977 + 1i);
                        }
                    }
                }
            }
            let _e1135 = surfaceMicroSlope;
            let _e1138 = rock_3;
            let _e1140 = streaks;
            let _e1144 = rock_3;
            let _e1145 = streaks;
            let _e1147 = furrow;
            surfaceMicroSlope = ((_e1135 * (1f - ((0.7f * _e1138) * _e1140))) + ((_e1144 * _e1145) * _e1147));
            let _e1151 = rock_3;
            let _e1152 = streaks;
            let _e1154 = hollow;
            let _e1156 = dry;
            surfaceRockCavity.y = (((_e1151 * _e1152) * _e1154) * _e1156);
            let _e1158 = salt_23;
            strike = (f32(((_e1158 >> 10u) & 1023u)) * 0.00613592f);
            let _e1167 = strike;
            let _e1169 = strike;
            run = vec2<f32>(cos(_e1167), sin(_e1169));
            let _e1175 = rock_3;
            let _e1176 = sstep(0.5f, 0.85f, _e1175);
            let _e1177 = k3_;
            let _e1181 = surfaceRockMassive;
            let _e1187 = surfaceRockShatter;
            jointing = (((_e1176 * _e1177) * (1f - (0.6f * _e1181))) * (0.75f + (0.5f * _e1187)));
            let _e1192 = streaks;
            let _e1193 = wear;
            detail = (_e1192 * _e1193);
            let _e1196 = jointing;
            if (_e1196 > 0.01f) {
                {
                    loop {
                        let _e1203 = k_6;
                        if !((_e1203 < 3i)) {
                            break;
                        }
                        {
                            let _e1210 = k_6;
                            let _e1213 = k4_;
                            if ((_e1210 == 2i) && (_e1213 <= 0f)) {
                                continue;
                            }
                            let _e1217 = k_6;
                            if (_e1217 == 0i) {
                                local_64 = 6f;
                            } else {
                                let _e1221 = k_6;
                                if (_e1221 == 1i) {
                                    local_63 = 9f;
                                } else {
                                    local_63 = 1.1f;
                                }
                                let _e1227 = local_63;
                                local_64 = _e1227;
                            }
                            let _e1229 = local_64;
                            spacing = _e1229;
                            let _e1231 = k_6;
                            if (_e1231 == 0i) {
                                let _e1234 = run;
                                local_66 = _e1234;
                            } else {
                                let _e1235 = k_6;
                                if (_e1235 == 1i) {
                                    let _e1239 = run;
                                    let _e1243 = run;
                                    let _e1248 = run;
                                    let _e1252 = run;
                                    local_65 = vec2<f32>(((0.37f * _e1239.x) - (0.93f * _e1243.y)), ((0.93f * _e1248.x) + (0.37f * _e1252.y)));
                                } else {
                                    let _e1258 = run;
                                    let _e1262 = run;
                                    let _e1267 = run;
                                    let _e1271 = run;
                                    local_65 = vec2<f32>(((0.86f * _e1258.x) + (0.51f * _e1262.y)), ((0.86f * _e1267.y) - (0.51f * _e1271.x)));
                                }
                                let _e1277 = local_65;
                                local_66 = _e1277;
                            }
                            let _e1279 = local_66;
                            d_8 = _e1279;
                            let _e1281 = world_22;
                            let _e1282 = d_8;
                            let _e1285 = d_8;
                            let _e1289 = spacing;
                            let _e1291 = k_6;
                            if (_e1291 == 2i) {
                                let _e1295 = n3_;
                                let _e1299 = n4_;
                                local_67 = ((0.35f * _e1295.x) + (0.12f * _e1299.x));
                            } else {
                                let _e1304 = n2_;
                                let _e1308 = n3_;
                                local_67 = ((0.25f * _e1304.x) + (0.05f * _e1308.x));
                            }
                            let _e1313 = local_67;
                            a_9 = ((dot(_e1281, vec2<f32>(-(_e1282.y), _e1285.x)) / _e1289) + _e1313);
                            let _e1316 = a_9;
                            row = floor(_e1316);
                            let _e1319 = row;
                            let _e1321 = k_6;
                            let _e1324 = salt_23;
                            let _e1327 = surfaceHash(vec3<i32>(i32(_e1319), _e1321, 7i), (_e1324 + 81u));
                            h_9 = _e1327;
                            let _e1329 = world_22;
                            let _e1330 = d_8;
                            let _e1332 = spacing;
                            let _e1335 = h_9;
                            let _e1346 = h_9;
                            b_10 = ((dot(_e1329, _e1330) / (_e1332 * (1.6f + ((2.4f * f32((_e1335 & 255u))) / 255f)))) + (0.37f * f32(((_e1346 >> 8u) & 255u))));
                            let _e1355 = b_10;
                            cell_5 = floor(_e1355);
                            let _e1358 = row;
                            let _e1360 = cell_5;
                            let _e1362 = k_6;
                            let _e1364 = salt_23;
                            let _e1367 = surfaceHash(vec3<i32>(i32(_e1358), i32(_e1360), _e1362), (_e1364 + 82u));
                            g_3 = _e1367;
                            let _e1369 = b_10;
                            let _e1370 = cell_5;
                            t_10 = (_e1369 - _e1370);
                            let _e1374 = fp_7;
                            let _e1380 = g_3;
                            w_2 = (max((0.75f * _e1374), 0.012f) * (0.7f + ((0.6f * f32(((_e1380 >> 16u) & 255u))) / 255f)));
                            let _e1392 = a_9;
                            let _e1393 = row;
                            let _e1398 = g_3;
                            let _e1409 = spacing;
                            let _e1411 = w_2;
                            gap = ((abs((((_e1392 - _e1393) - 0.25f) - ((0.5f * f32(((_e1398 >> 8u) & 255u))) / 255f))) * _e1409) / _e1411);
                            let _e1414 = k_6;
                            if (_e1414 == 0i) {
                                let _e1420 = n1_;
                                let _e1422 = sstep(-0.4f, 0.2f, _e1420.x);
                                local_69 = _e1422;
                            } else {
                                let _e1423 = k_6;
                                if (_e1423 == 1i) {
                                    let _e1430 = n1_;
                                    let _e1432 = sstep(-0.3f, 0.3f, _e1430.x);
                                    local_68 = (1f - _e1432);
                                } else {
                                    let _e1434 = k4_;
                                    let _e1438 = n2_;
                                    let _e1440 = sstep(-0.3f, 0.4f, _e1438.x);
                                    local_68 = (_e1434 * _e1440);
                                }
                                let _e1443 = local_68;
                                local_69 = _e1443;
                            }
                            let _e1445 = local_69;
                            outcrop = _e1445;
                            let _e1447 = cracks;
                            let _e1448 = g_3;
                            let _e1452 = k_6;
                            if (_e1452 == 0i) {
                                local_71 = 72f;
                            } else {
                                let _e1456 = k_6;
                                if (_e1456 == 1i) {
                                    local_70 = 64f;
                                } else {
                                    local_70 = 56f;
                                }
                                let _e1462 = local_70;
                                local_71 = _e1462;
                            }
                            let _e1464 = local_71;
                            let _e1466 = outcrop;
                            let _e1470 = w_2;
                            let _e1474 = gap;
                            let _e1476 = gap;
                            let _e1482 = t_10;
                            let _e1483 = sstep(0f, 0.12f, _e1482);
                            let _e1488 = t_10;
                            let _e1489 = sstep(0.88f, 1f, _e1488);
                            cracks = (_e1447 + (((((step(f32((_e1448 & 255u)), _e1464) * _e1466) * min(1f, (0.03f / _e1470))) * exp2((-(_e1474) * _e1476))) * _e1483) * (1f - _e1489)));
                        }
                        continuing {
                            let _e1207 = k_6;
                            k_6 = (_e1207 + 1i);
                        }
                    }
                    let _e1493 = detail;
                    let _e1495 = jointing;
                    let _e1497 = cracks;
                    detail = (_e1493 - ((0.4f * _e1495) * _e1497));
                }
            }
            let _e1500 = surfaceFacetWeight;
            let _e1503 = slope_4;
            let _e1504 = sstep(0.1f, 0.4f, _e1503);
            blocky = (_e1500 * _e1504);
            let _e1507 = blocky;
            if (_e1507 > 0.01f) {
                {
                    let _e1516 = world_22;
                    let _e1517 = run;
                    let _e1521 = world_22;
                    let _e1522 = run;
                    let _e1525 = run;
                    jointed = vec2<f32>((1.25f * dot(_e1516, _e1517)), (0.78f * dot(_e1521, vec2<f32>(-(_e1522.y), _e1525.x))));
                    loop {
                        let _e1534 = k_7;
                        if !((_e1534 < 3i)) {
                            break;
                        }
                        {
                            let _e1541 = k_7;
                            let _e1544 = k2_;
                            let _e1548 = k_7;
                            let _e1551 = k3_;
                            if (((_e1541 == 1i) && (_e1544 <= 0f)) || ((_e1548 == 2i) && (_e1551 <= 0f))) {
                                continue;
                            }
                            let _e1556 = k_7;
                            if (_e1556 == 0i) {
                                local_73 = 40f;
                            } else {
                                let _e1560 = k_7;
                                if (_e1560 == 1i) {
                                    local_72 = 11f;
                                } else {
                                    local_72 = 3f;
                                }
                                let _e1566 = local_72;
                                local_73 = _e1566;
                            }
                            let _e1568 = local_73;
                            size = _e1568;
                            let _e1570 = k_7;
                            if (_e1570 == 0i) {
                                let _e1574 = n1_;
                                let _e1576 = n1_;
                                local_75 = (0.22f * vec2<f32>(_e1574.x, -(_e1576.x)));
                            } else {
                                let _e1581 = k_7;
                                if (_e1581 == 1i) {
                                    let _e1585 = n1_;
                                    let _e1589 = n2_;
                                    local_74 = vec2<f32>((0.5f * _e1585.x), (0.22f * _e1589.x));
                                } else {
                                    let _e1594 = n2_;
                                    let _e1598 = n3_;
                                    let _e1603 = k5_;
                                    let _e1605 = n5_;
                                    local_74 = (vec2<f32>((0.5f * _e1594.x), (0.22f * _e1598.x)) + ((0.0036f * _e1603) * _e1605.yz));
                                }
                                let _e1610 = local_74;
                                local_75 = _e1610;
                            }
                            let _e1612 = local_75;
                            bent = _e1612;
                            let _e1614 = jointed;
                            let _e1615 = size;
                            let _e1618 = bent;
                            let _e1620 = salt_23;
                            let _e1623 = k_7;
                            let _e1626 = surfaceFacets(((_e1614 / vec2(_e1615)) + _e1618), ((_e1620 + 71u) + u32(_e1623)));
                            f_9 = _e1626;
                            let _e1631 = size;
                            let _e1634 = fp_7;
                            let _e1640 = close;
                            thinned = mix(1f, max(1f, ((0.03f * _e1631) / ((4f * _e1634) + 0.02f))), _e1640);
                            let _e1643 = f_9;
                            let _e1645 = thinned;
                            let _e1648 = fp_7;
                            let _e1650 = thinned;
                            let _e1652 = size;
                            let _e1654 = surfaceJoint((_e1643.y * _e1645), (((1.25f * _e1648) * _e1650) / _e1652));
                            let _e1658 = k_7;
                            if (_e1658 == 0i) {
                                let _e1661 = n2_;
                                local_77 = _e1661.x;
                            } else {
                                let _e1663 = k_7;
                                if (_e1663 == 1i) {
                                    let _e1666 = n3_;
                                    local_76 = _e1666.x;
                                } else {
                                    let _e1668 = n4_;
                                    local_76 = _e1668.x;
                                }
                                let _e1671 = local_76;
                                local_77 = _e1671;
                            }
                            let _e1673 = local_77;
                            let _e1674 = sstep(-0.4f, 0.5f, _e1673);
                            joint = (_e1654 * _e1674);
                            let _e1677 = k_7;
                            if (_e1677 == 0i) {
                                let _e1680 = k1_;
                                local_79 = _e1680;
                            } else {
                                let _e1681 = k_7;
                                if (_e1681 == 1i) {
                                    let _e1684 = k2_;
                                    local_78 = _e1684;
                                } else {
                                    let _e1685 = k3_;
                                    local_78 = _e1685;
                                }
                                let _e1687 = local_78;
                                local_79 = _e1687;
                            }
                            let _e1689 = local_79;
                            let _e1695 = k_7;
                            if (_e1695 == 2i) {
                                let _e1698 = n2_;
                                local_80 = _e1698.x;
                            } else {
                                let _e1700 = n1_;
                                local_80 = _e1700.x;
                            }
                            let _e1703 = local_80;
                            let _e1704 = sstep(-0.6f, 0.6f, _e1703);
                            amount_4 = (_e1689 * (0.45f + (0.55f * _e1704)));
                            let _e1709 = block;
                            let _e1710 = amount_4;
                            let _e1711 = k_7;
                            if (_e1711 == 0i) {
                                local_82 = 0.1f;
                            } else {
                                let _e1715 = k_7;
                                if (_e1715 == 1i) {
                                    local_81 = 0.08f;
                                } else {
                                    local_81 = 0.06f;
                                }
                                let _e1721 = local_81;
                                local_82 = _e1721;
                            }
                            let _e1723 = local_82;
                            let _e1724 = f_9;
                            let _e1728 = joint;
                            block = (_e1709 + (_e1710 * ((_e1723 * _e1724.x) - (0.045f * _e1728))));
                            let _e1733 = tilt_1;
                            let _e1734 = amount_4;
                            let _e1735 = k_7;
                            if (_e1735 == 0i) {
                                local_84 = 0.3f;
                            } else {
                                let _e1739 = k_7;
                                if (_e1739 == 1i) {
                                    local_83 = 0.4f;
                                } else {
                                    local_83 = 0.3f;
                                }
                                let _e1745 = local_83;
                                local_84 = _e1745;
                            }
                            let _e1747 = local_84;
                            let _e1749 = f_9;
                            tilt_1 = (_e1733 + ((_e1734 * _e1747) * _e1749.zw));
                        }
                        continuing {
                            let _e1538 = k_7;
                            k_7 = (_e1538 + 1i);
                        }
                    }
                    let _e1753 = detail;
                    let _e1754 = blocky;
                    let _e1755 = block;
                    detail = (_e1753 + (_e1754 * _e1755));
                    let _e1758 = surfaceMicroSlope;
                    let _e1759 = rock_3;
                    let _e1760 = blocky;
                    let _e1762 = tilt_1;
                    surfaceMicroSlope = (_e1758 + ((_e1759 * _e1760) * _e1762));
                }
            }
            let _e1765 = tone_2;
            let _e1766 = rock_3;
            let _e1767 = relief;
            let _e1769 = detail;
            let _e1771 = dry;
            tone_2 = (_e1765 + (((_e1766 * _e1767) * _e1769) * _e1771));
            let _e1774 = rock_3;
            let _e1777 = slope_4;
            let _e1778 = sstep(0.35f, 0.9f, _e1777);
            let _e1780 = surfaceStrataWeight;
            face = ((_e1774 * _e1778) * _e1780);
            let _e1783 = slope_4;
            rate_1 = (_e1783 + 0.3f);
            let _e1787 = face;
            if (_e1787 > 0.01f) {
                {
                    loop {
                        let _e1794 = k_8;
                        if !((_e1794 < 4i)) {
                            break;
                        }
                        {
                            let _e1801 = k_8;
                            let _e1804 = k5_;
                            if ((_e1801 == 3i) && (_e1804 <= 0f)) {
                                continue;
                            }
                            let _e1808 = k_8;
                            if (_e1808 == 0i) {
                                local_87 = 18f;
                            } else {
                                let _e1812 = k_8;
                                if (_e1812 == 1i) {
                                    local_86 = 4.5f;
                                } else {
                                    let _e1816 = k_8;
                                    if (_e1816 == 2i) {
                                        local_85 = 1.1f;
                                    } else {
                                        local_85 = 0.25f;
                                    }
                                    let _e1822 = local_85;
                                    local_86 = _e1822;
                                }
                                let _e1824 = local_86;
                                local_87 = _e1824;
                            }
                            let _e1826 = local_87;
                            t_11 = _e1826;
                            let _e1828 = surfaceRise;
                            let _e1829 = t_11;
                            z_4 = (_e1828 / _e1829);
                            let _e1832 = z_4;
                            let _e1835 = z_4;
                            let _e1841 = z_4;
                            let _e1849 = k_8;
                            if (_e1849 == 0i) {
                                let _e1852 = n1_;
                                local_90 = _e1852.x;
                            } else {
                                let _e1854 = k_8;
                                if (_e1854 == 1i) {
                                    let _e1857 = n2_;
                                    local_89 = _e1857.x;
                                } else {
                                    let _e1859 = k_8;
                                    if (_e1859 == 2i) {
                                        let _e1862 = n3_;
                                        local_88 = _e1862.x;
                                    } else {
                                        let _e1864 = n5_;
                                        let _e1867 = n6_;
                                        local_88 = (_e1864.x + (0.4f * _e1867.x));
                                    }
                                    let _e1872 = local_88;
                                    local_89 = _e1872;
                                }
                                let _e1874 = local_89;
                                local_90 = _e1874;
                            }
                            let _e1876 = local_90;
                            z_4 = (_e1832 + (((0.25f * sin((2.1f * _e1835))) + (0.08f * sin(((5.3f * _e1841) + 1.7f)))) + (0.3f * _e1876)));
                            let _e1880 = ledges;
                            let _e1881 = k_8;
                            if (_e1881 == 0i) {
                                local_93 = 0.3f;
                            } else {
                                let _e1885 = k_8;
                                if (_e1885 == 1i) {
                                    local_92 = 0.22f;
                                } else {
                                    let _e1889 = k_8;
                                    if (_e1889 == 2i) {
                                        local_91 = 0.14f;
                                    } else {
                                        local_91 = 0.1f;
                                    }
                                    let _e1895 = local_91;
                                    local_92 = _e1895;
                                }
                                let _e1897 = local_92;
                                local_93 = _e1897;
                            }
                            let _e1899 = local_93;
                            let _e1900 = z_4;
                            let _e1901 = salt_23;
                            let _e1904 = k_8;
                            let _e1907 = surfaceBed(_e1900, ((_e1901 + 41u) + u32(_e1904)));
                            let _e1912 = fp_7;
                            let _e1913 = rate_1;
                            let _e1916 = t_11;
                            let _e1919 = sstep(0.125f, 0.25f, ((_e1912 * _e1913) / (0.55f * _e1916)));
                            let _e1927 = k_8;
                            if (_e1927 == 3i) {
                                let _e1930 = n4_;
                                local_95 = -(_e1930.x);
                            } else {
                                let _e1933 = k_8;
                                if (_e1933 == 2i) {
                                    let _e1936 = n2_;
                                    local_94 = -(_e1936.x);
                                } else {
                                    let _e1939 = n1_;
                                    local_94 = -(_e1939.x);
                                }
                                let _e1943 = local_94;
                                local_95 = _e1943;
                            }
                            let _e1945 = local_95;
                            let _e1946 = sstep(-0.5f, 0.5f, _e1945);
                            ledges = (_e1880 + (((_e1899 * _e1907) * (1f - _e1919)) * (0.25f + (0.75f * _e1946))));
                        }
                        continuing {
                            let _e1798 = k_8;
                            k_8 = (_e1798 + 1i);
                        }
                    }
                    let _e1951 = tone_2;
                    let _e1952 = face;
                    let _e1953 = relief;
                    let _e1955 = ledges;
                    let _e1957 = dry;
                    tone_2 = (_e1951 + (((_e1952 * _e1953) * _e1955) * _e1957));
                }
            }
        }
    }
    let _e1962 = slope_4;
    let _e1963 = sstep(0.22f, 0.42f, _e1962);
    let _e1967 = slope_4;
    let _e1968 = sstep(0.8f, 1.2f, _e1967);
    let _e1973 = grass_3;
    let _e1979 = rock_3;
    let _e1980 = sstep(0.1f, 0.45f, _e1979);
    let _e1982 = dry;
    talus = ((((_e1963 * (1f - _e1968)) * (1f - (0.85f * _e1973))) * _e1980) * _e1982);
    let _e1985 = surfaceGroundStony;
    let _e1990 = grass_3;
    let _e1993 = dry;
    stony = ((clamp(_e1985, 0f, 1f) * (1f - _e1990)) * _e1993);
    let _e1996 = talus;
    let _e1997 = stony;
    clastic = max(_e1996, _e1997);
    let _e2000 = talus;
    let _e2002 = rock_3;
    let _e2005 = stony;
    loose = max((_e2000 * (1f - _e2002)), _e2005);
    let _e2008 = clastic;
    surfaceGroundClasts = _e2008;
    let _e2012 = fp_7;
    let _e2013 = sstep(0.00875f, 0.0175f, _e2012);
    let _e2015 = dry;
    let _e2018 = rock_3;
    let _e2019 = loose;
    kc = (((1f - _e2013) * _e2015) * step(0.02f, max(_e2018, _e2019)));
    loop {
        let _e2032 = k_9;
        if !((_e2032 < 4i)) {
            break;
        }
        {
            let _e2039 = k_9;
            let _e2042 = talus;
            let _e2045 = fp_7;
            let _e2051 = k_9;
            let _e2054 = talus;
            let _e2057 = fp_7;
            let _e2064 = k_9;
            let _e2067 = clastic;
            let _e2070 = fp_7;
            let _e2077 = k_9;
            let _e2080 = kc;
            if (((((_e2039 == 0i) && !(((_e2042 > 0.01f) && (_e2045 < 1.3f)))) || ((_e2051 == 1i) && !(((_e2054 > 0.01f) && (_e2057 < 0.34f))))) || ((_e2064 == 2i) && !(((_e2067 > 0.01f) && (_e2070 < 0.09f))))) || ((_e2077 == 3i) && (_e2080 <= 0f))) {
                continue;
            }
            let _e2085 = k_9;
            if (_e2085 == 2i) {
                let _e2089 = k5_;
                let _e2091 = n5_;
                local_97 = ((0.03f * _e2089) * _e2091.yz);
            } else {
                let _e2094 = k_9;
                if (_e2094 == 3i) {
                    let _e2098 = k6_;
                    let _e2100 = n6_;
                    local_96 = ((0.009f * _e2098) * _e2100.yz);
                } else {
                    local_96 = vec2(0f);
                }
                let _e2106 = local_96;
                local_97 = _e2106;
            }
            let _e2108 = local_97;
            bend = _e2108;
            let _e2110 = world_22;
            let _e2111 = k_9;
            if (_e2111 == 0i) {
                local_100 = 2.9f;
            } else {
                let _e2115 = k_9;
                if (_e2115 == 1i) {
                    local_99 = 0.78f;
                } else {
                    let _e2119 = k_9;
                    if (_e2119 == 2i) {
                        local_98 = 0.21f;
                    } else {
                        local_98 = 0.07f;
                    }
                    let _e2125 = local_98;
                    local_99 = _e2125;
                }
                let _e2127 = local_99;
                local_100 = _e2127;
            }
            let _e2129 = local_100;
            let _e2132 = bend;
            let _e2134 = salt_23;
            let _e2137 = k_9;
            let _e2140 = surfaceFacets(((_e2110 / vec2(_e2129)) + _e2132), ((_e2134 + 51u) + u32(_e2137)));
            st = _e2140;
            let _e2142 = k_9;
            if (_e2142 == 0i) {
                let _e2150 = n2_;
                let _e2152 = sstep(-0.6f, 0.6f, _e2150.x);
                local_102 = (0.45f + (0.55f * _e2152));
            } else {
                let _e2155 = k_9;
                if (_e2155 == 1i) {
                    let _e2163 = n3_;
                    let _e2165 = sstep(-0.6f, 0.6f, _e2163.x);
                    local_101 = (0.45f + (0.55f * _e2165));
                } else {
                    let _e2171 = st;
                    let _e2180 = close;
                    local_101 = mix(1f, (1.5f * step(0.4f, fract(((_e2171.x * 7.3f) + 4f)))), _e2180);
                }
                let _e2183 = local_101;
                local_102 = _e2183;
            }
            let _e2185 = local_102;
            sorted = _e2185;
            let _e2187 = k_9;
            if (_e2187 == 0i) {
                let _e2190 = tone_2;
                let _e2191 = talus;
                let _e2192 = sorted;
                let _e2197 = fp_7;
                let _e2198 = sstep(0.6f, 1.3f, _e2197);
                let _e2202 = st;
                let _e2207 = st;
                tone_2 = (_e2190 + (((_e2191 * _e2192) * (1f - _e2198)) * ((0.3f * _e2202.x) - (0.2f * (0.27f - _e2207.y)))));
            } else {
                let _e2214 = k_9;
                if (_e2214 == 1i) {
                    let _e2217 = tone_2;
                    let _e2218 = talus;
                    let _e2219 = sorted;
                    let _e2224 = fp_7;
                    let _e2225 = sstep(0.16f, 0.34f, _e2224);
                    let _e2229 = st;
                    let _e2234 = st;
                    tone_2 = (_e2217 + (((_e2218 * _e2219) * (1f - _e2225)) * ((0.26f * _e2229.x) - (0.16f * (0.27f - _e2234.y)))));
                } else {
                    let _e2241 = k_9;
                    if (_e2241 == 2i) {
                        let _e2244 = tone_2;
                        let _e2245 = clastic;
                        let _e2246 = sorted;
                        let _e2251 = fp_7;
                        let _e2252 = sstep(0.045f, 0.09f, _e2251);
                        let _e2256 = st;
                        let _e2261 = st;
                        tone_2 = (_e2244 + (((_e2245 * _e2246) * (1f - _e2252)) * ((0.22f * _e2256.x) - (0.12f * (0.27f - _e2261.y)))));
                    } else {
                        let _e2268 = st;
                        chip = _e2268;
                    }
                }
            }
        }
        continuing {
            let _e2036 = k_9;
            k_9 = (_e2036 + 1i);
        }
    }
    let _e2269 = k5_;
    if (_e2269 > 0f) {
        {
            let _e2272 = surfaceFineGrain;
            grain_1 = _e2272.x;
            let _e2275 = rock_3;
            let _e2278 = rock_3;
            let _e2279 = sstep(0.25f, 0.6f, _e2278);
            bare = (_e2275 * _e2279);
            let _e2283 = chip;
            speckled = step(0.22f, _e2283.x);
            let _e2287 = kc;
            let _e2290 = fp_7;
            let _e2294 = chip;
            let _e2296 = sstep(0f, (0.06f + (_e2290 / 0.07f)), _e2294.y);
            inside = (_e2287 * _e2296);
            let _e2299 = speckled;
            let _e2300 = kc;
            let _e2305 = fp_7;
            let _e2310 = chip;
            let _e2312 = sstep(0.03f, (0.14f + ((2f * _e2305) / 0.07f)), _e2310.y);
            let _e2316 = chip;
            speck = ((((_e2299 * _e2300) * _e2312) * 2f) * _e2316.z);
            let _e2321 = speckled;
            let _e2323 = inside;
            let _e2327 = chip;
            crumb = ((((1f - _e2321) * _e2323) * 2.8f) * (_e2327.x + 0.14f));
            let _e2333 = tone_2;
            let _e2335 = rock_3;
            let _e2337 = grain_1;
            let _e2339 = bare;
            let _e2341 = speck;
            let _e2344 = crumb;
            let _e2349 = loose;
            let _e2351 = speck;
            let _e2354 = crumb;
            let _e2360 = soil;
            let _e2362 = grain_1;
            let _e2366 = herb_2;
            let _e2368 = grain_1;
            tone_2 = (_e2333 + ((((((0.05f * _e2335) * _e2337) + (_e2339 * ((0.09f * _e2341) + (0.035f * _e2344)))) + (_e2349 * ((0.09f * _e2351) + (0.06f * _e2354)))) + ((0.07f * _e2360) * _e2362)) + ((0.045f * _e2366) * _e2368)));
            let _e2372 = hue;
            let _e2374 = herb_2;
            let _e2376 = grain_1;
            let _e2384 = bare;
            let _e2385 = speck;
            hue = (_e2372 + ((((0.03f * _e2374) * _e2376) * vec3<f32>(1f, 0.13f, -0.8f)) + ((_e2384 * _e2385) * vec3<f32>(0.009f, 0.015f, -0.03f))));
            let _e2395 = surfaceMicroSlope;
            let _e2397 = bare;
            let _e2400 = loose;
            let _e2403 = fineSlope;
            let _e2406 = speckled;
            let _e2408 = inside;
            let _e2410 = chip;
            let _e2414 = bare;
            let _e2417 = loose;
            surfaceMicroSlope = (_e2395 + ((((0.05f * _e2397) + (0.45f * _e2400)) * _e2403) + ((((1f - _e2406) * _e2408) * _e2410.zw) * ((0.5f * _e2414) + (2f * _e2417)))));
        }
    }
    let _e2423 = hue;
    let _e2424 = tone_2;
    let _e2429 = world_22;
    let _e2430 = slope_4;
    let _e2431 = fp_7;
    let _e2432 = rock_3;
    let _e2433 = grass_3;
    let _e2434 = salt_23;
    let _e2435 = n1_;
    let _e2436 = n2_;
    let _e2437 = surfaceGroundCover(_e2429, _e2430, _e2431, _e2432, _e2433, _e2434, _e2435, _e2436);
    surfaceMicroTone = ((_e2423 * clamp(_e2424, 0.55f, 1.45f)) + _e2437);
    let _e2439 = surfaceMicroSlope;
    let _e2440 = dry;
    let _e2442 = surfaceGroundSlope;
    surfaceMicroSlope = ((_e2439 * _e2440) + _e2442);
    let _e2444 = surfaceMicroTone;
    return _e2444;
}

fn surfaceFbm(p_19: vec3<f32>, scale: f32, octaves: i32, footprint_2: f32, salt_24: u32) -> vec2<f32> {
    var p_20: vec3<f32>;
    var scale_1: f32;
    var octaves_1: i32;
    var footprint_3: f32;
    var salt_25: u32;
    var value_1: f32 = 0f;
    var kept: f32 = 0f;
    var total: f32 = 0f;
    var s_2: f32;
    var a_10: f32 = 1f;
    var i_6: i32 = 0i;
    var fade: f32;

    p_20 = p_19;
    scale_1 = scale;
    octaves_1 = octaves;
    footprint_3 = footprint_2;
    salt_25 = salt_24;
    let _e282 = scale_1;
    s_2 = _e282;
    loop {
        let _e288 = i_6;
        let _e289 = octaves_1;
        if !((_e288 < _e289)) {
            break;
        }
        {
            let _e295 = global.uQuality;
            let _e298 = i_6;
            if ((_e295 > 0i) && (_e298 >= 1i)) {
                break;
            }
            let _e302 = total;
            let _e303 = a_10;
            let _e304 = a_10;
            total = (_e302 + (_e303 * _e304));
            let _e307 = footprint_3;
            let _e308 = s_2;
            if (_e307 < (_e308 * 0.25f)) {
                {
                    let _e313 = s_2;
                    let _e316 = s_2;
                    let _e319 = footprint_3;
                    let _e320 = sstep((_e313 * 0.125f), (_e316 * 0.25f), _e319);
                    fade = (1f - _e320);
                    let _e323 = value_1;
                    let _e324 = a_10;
                    let _e325 = fade;
                    let _e327 = p_20;
                    let _e328 = s_2;
                    let _e331 = salt_25;
                    let _e332 = i_6;
                    let _e337 = surfaceNoise((_e327 / vec3(_e328)), (_e331 + (u32(_e332) * 40503u)));
                    value_1 = (_e323 + ((_e324 * _e325) * _e337));
                    let _e340 = kept;
                    let _e341 = a_10;
                    let _e342 = fade;
                    let _e344 = a_10;
                    let _e346 = fade;
                    kept = (_e340 + (((_e341 * _e342) * _e344) * _e346));
                }
            }
            let _e349 = a_10;
            a_10 = (_e349 * 0.5f);
            let _e352 = s_2;
            s_2 = (_e352 * 0.5f);
        }
        continuing {
            let _e292 = i_6;
            i_6 = (_e292 + 1i);
        }
    }
    let _e355 = kept;
    if (_e355 > 0f) {
        {
            let _e358 = value_1;
            let _e359 = kept;
            value_1 = (_e358 / sqrt(_e359));
        }
    }
    let _e362 = value_1;
    let _e363 = kept;
    let _e364 = total;
    return vec2<f32>(_e362, (_e363 / _e364));
}

fn surfaceCover(fraction: f32, pattern: vec2<f32>, sharp: f32) -> f32 {
    var fraction_1: f32;
    var pattern_1: vec2<f32>;
    var sharp_1: f32;
    var c_10: f32;
    var v_12: f32;

    fraction_1 = fraction;
    pattern_1 = pattern;
    sharp_1 = sharp;
    let _e272 = fraction_1;
    c_10 = clamp(_e272, 0f, 1f);
    let _e277 = pattern_1;
    let _e280 = pattern_1;
    let _e282 = pattern_1;
    let _e288 = pattern_1;
    v_12 = ((_e277.x / sqrt((1f + (_e280.x * _e282.x)))) * sqrt(_e288.y));
    let _e293 = c_10;
    let _e294 = sharp_1;
    let _e298 = c_10;
    let _e301 = c_10;
    let _e304 = v_12;
    return (_e293 + (((clamp(_e294, 0f, 1f) * _e298) * (1f - _e301)) * _e304));
}

fn surfaceBeachWidth(reach_3: vec2<f32>, grove_2: vec2<f32>, fine_3: vec2<f32>, openness: f32) -> f32 {
    var reach_4: vec2<f32>;
    var grove_3: vec2<f32>;
    var fine_4: vec2<f32>;
    var openness_1: f32;
    var supply: f32;
    var along_2: f32;

    reach_4 = reach_3;
    grove_3 = grove_2;
    fine_4 = fine_3;
    openness_1 = openness;
    let _e278 = global.uMaterialClimate;
    let _e280 = sstep(8f, 22f, _e278.x);
    supply = (40f + (80f * _e280));
    let _e288 = reach_4;
    let _e291 = reach_4;
    let _e296 = grove_3;
    let _e299 = grove_3;
    let _e304 = sstep(-0.8f, 0.8f, (((0.65f * _e288.x) * sqrt(_e291.y)) + ((0.5f * _e296.x) * sqrt(_e299.y))));
    along_2 = _e304;
    let _e306 = supply;
    let _e309 = along_2;
    let _e315 = openness_1;
    let _e316 = sstep(0.15f, 0.4f, _e315);
    let _e320 = fine_4;
    let _e323 = fine_4;
    return (((_e306 * (0.4f + (0.8f * _e309))) * _e316) * (1f + ((0.35f * _e320.x) * sqrt(_e323.y))));
}

fn surfaceRootBeach(s_3: vec3<f32>, world_23: vec2<f32>, shore: f32, openness_2: f32) -> f32 {
    var s_4: vec3<f32>;
    var world_24: vec2<f32>;
    var shore_1: f32;
    var openness_3: f32;
    var point_2: vec3<f32>;
    var fp_8: f32 = 30f;
    var f_10: array<vec2<f32>, 3>;
    var k_10: i32 = 0i;
    var local_103: f32;
    var local_104: f32;
    var local_105: i32;
    var local_106: u32;
    var local_107: u32;
    var reach_5: vec2<f32>;
    var grove_4: vec2<f32>;
    var fine_5: vec2<f32>;
    var width: f32;

    s_4 = s_3;
    world_24 = world_23;
    shore_1 = shore;
    openness_3 = openness_2;
    let _e274 = world_24;
    point_2 = vec3<f32>(_e274.x, _e274.y, 0f);
    loop {
        let _e285 = k_10;
        if !((_e285 < 3i)) {
            break;
        }
        let _e292 = k_10;
        let _e294 = point_2;
        let _e295 = k_10;
        if (_e295 == 0i) {
            local_104 = 20000f;
        } else {
            let _e299 = k_10;
            if (_e299 == 1i) {
                local_103 = 4800f;
            } else {
                local_103 = 240f;
            }
            let _e305 = local_103;
            local_104 = _e305;
        }
        let _e307 = local_104;
        let _e308 = k_10;
        if (_e308 == 0i) {
            local_105 = 3i;
        } else {
            local_105 = 4i;
        }
        let _e314 = local_105;
        let _e315 = fp_8;
        let _e316 = global.uMaterialSeed;
        let _e317 = k_10;
        if (_e317 == 0i) {
            local_107 = 7u;
        } else {
            let _e321 = k_10;
            if (_e321 == 1i) {
                local_106 = 3u;
            } else {
                local_106 = 5u;
            }
            let _e327 = local_106;
            local_107 = _e327;
        }
        let _e329 = local_107;
        let _e331 = surfaceFbm(_e294, _e307, _e314, _e315, (_e316 + _e329));
        f_10[_e292] = _e331;
        continuing {
            let _e289 = k_10;
            k_10 = (_e289 + 1i);
        }
    }
    let _e334 = f_10[0];
    reach_5 = _e334;
    let _e338 = f_10[1];
    grove_4 = _e338;
    let _e342 = f_10[2];
    fine_5 = _e342;
    let _e344 = reach_5;
    let _e345 = grove_4;
    let _e346 = fine_5;
    let _e347 = openness_3;
    let _e348 = surfaceBeachWidth(_e344, _e345, _e346, _e347);
    width = _e348;
    let _e350 = width;
    let _e352 = fp_8;
    let _e355 = shore_1;
    let _e357 = fp_8;
    let _e359 = fp_8;
    let _e367 = s_4;
    let _e369 = sstep(4f, 12f, _e367.x);
    let _e375 = s_4;
    let _e378 = sstep(0.2f, 0.5f, length(_e375.yz));
    return ((clamp((((min(_e350, (20f * _e352)) - _e355) + _e357) / _e359), 0f, 1f) * (1f - _e369)) * (1f - _e378));
}

fn surfaceSeason() -> f32 {
    return 1f;
}

fn surfaceSeaIce(point_3: vec3<f32>, ts0_: f32, tw0_: f32, footprint_4: f32) -> f32 {
    var point_4: vec3<f32>;
    var ts0_1: f32;
    var tw0_1: f32;
    var footprint_5: f32;
    var regional: vec2<f32>;
    var m1_2: f32;
    var ts: f32;
    var tw: f32;
    var now: f32;

    point_4 = point_3;
    ts0_1 = ts0_;
    tw0_1 = tw0_;
    footprint_5 = footprint_4;
    let _e274 = point_4;
    let _e277 = footprint_5;
    let _e278 = global.uMaterialSeed;
    let _e281 = surfaceFbm(_e274, 64000f, 4i, _e277, (_e278 + 1u));
    regional = _e281;
    let _e283 = regional;
    let _e285 = regional;
    m1_2 = (_e283.x * sqrt(_e285.y));
    let _e290 = ts0_1;
    ts = clamp(_e290, -45f, 45f);
    let _e296 = tw0_1;
    tw = clamp(_e296, -45f, 45f);
    let _e302 = tw;
    let _e303 = ts;
    let _e304 = tw;
    let _e306 = surfaceSeason();
    now = (_e302 + ((_e303 - _e304) * _e306));
    let _e314 = now;
    let _e316 = m1_2;
    let _e319 = sstep(-1.5f, -6f, (_e314 + (0.4f * _e316)));
    return (clamp((_e319 * 1f), 0f, 1f) * 0.9f);
}

fn materialWater_1(position_5: f32) -> vec3<f32> {
    var position_6: f32;
    var color_4: vec3<f32> = vec3<f32>(0.101960786f, 0.3019608f, 0.36078432f);

    position_6 = position_5;
    let _e281 = color_4;
    let _e296 = position_6;
    color_4 = mix(_e281, vec3<f32>(0.043137256f, 0.16078432f, 0.27058825f), vec3(smoothstep(0f, 0.4f, _e296)));
    let _e300 = color_4;
    let _e315 = position_6;
    color_4 = mix(_e300, vec3<f32>(0.019607844f, 0.06666667f, 0.14901961f), vec3(smoothstep(0.4f, 1f, _e315)));
    let _e319 = color_4;
    return _e319;
}

fn surfaceWater(depth: f32, ice_1: f32) -> vec3<f32> {
    var depth_1: f32;
    var ice_2: f32;

    depth_1 = depth;
    ice_2 = ice_1;
    let _e270 = depth_1;
    let _e273 = materialWater_1((_e270 / 120f));
    let _e278 = ice_2;
    return mix(_e273, vec3<f32>(0.8f, 0.84f, 0.88f), vec3(_e278));
}

fn surfaceOcean(height_1: f32, color_5: vec3<f32>, now_1: f32, m1_3: f32, variation: f32) -> vec3<f32> {
    var height_2: f32;
    var color_6: vec3<f32>;
    var now_2: f32;
    var m1_4: f32;
    var variation_1: f32;
    var ice_3: f32;

    height_2 = height_1;
    color_6 = color_5;
    now_2 = now_1;
    m1_4 = m1_3;
    variation_1 = variation;
    let _e276 = height_2;
    if (_e276 >= 0f) {
        {
            let _e279 = color_6;
            return clamp(_e279, vec3(0f), vec3(1f));
        }
    }
    let _e289 = now_2;
    let _e291 = m1_4;
    let _e294 = sstep(-1.5f, -6f, (_e289 + (0.4f * _e291)));
    ice_3 = (clamp((_e294 * 1f), 0f, 1f) * 0.9f);
    let _e303 = height_2;
    let _e307 = ice_3;
    let _e308 = surfaceWater(max(-(_e303), 0f), _e307);
    let _e311 = variation_1;
    let _e313 = m1_4;
    return clamp((_e308 * (1f + ((0.04f * _e311) * _e313))), vec3(0f), vec3(1f));
}

fn surfaceMaterial(height_3: f32, gradient_2: vec2<f32>, tpi: f32, point_5: vec3<f32>, north: vec2<f32>, footprint_6: f32, soil_1: vec3<f32>, pedology: vec3<f32>, sandFraction: f32, ts0_2: f32, ps: f32, ls: f32, tw0_2: f32, pw: f32, lw: f32, bare_1: bool, shore_2: f32, openness_4: f32) -> vec3<f32> {
    var height_4: f32;
    var gradient_3: vec2<f32>;
    var tpi_1: f32;
    var point_6: vec3<f32>;
    var north_1: vec2<f32>;
    var footprint_7: f32;
    var soil_2: vec3<f32>;
    var pedology_1: vec3<f32>;
    var sandFraction_1: f32;
    var ts0_3: f32;
    var ps_1: f32;
    var ls_1: f32;
    var tw0_3: f32;
    var pw_1: f32;
    var lw_1: f32;
    var bare_2: bool;
    var shore_3: f32;
    var openness_5: f32;
    var season: f32 = 0.5f;
    var variation_2: f32 = 1f;
    var forestAmount: f32 = 1f;
    var rockTan: f32 = 0.8390996f;
    var snowAmount: f32 = 1f;
    var moisture_1: f32 = 0f;
    var salt_26: u32;
    var fp_9: f32;
    var phase_2: f32;
    var h_10: f32;
    var materialDetail: f32;
    var fields: array<vec2<f32>, 7>;
    var k_11: i32 = 0i;
    var local_108: f32;
    var local_109: f32;
    var local_110: f32;
    var local_111: f32;
    var local_112: f32;
    var local_113: f32;
    var scale_2: f32;
    var local_114: vec3<f32>;
    var local_115: i32;
    var regional_1: vec2<f32>;
    var regional2_: vec2<f32>;
    var grove_5: vec2<f32>;
    var crag_2: vec2<f32>;
    var fine_6: vec2<f32>;
    var province: vec2<f32>;
    var m1_5: f32;
    var m2_2: f32;
    var pv: f32;
    var ts_1: f32;
    var tw_1: f32;
    var locality: f32;
    var terrain: f32;
    var jitter: f32;
    var tHot: f32;
    var tCold: f32;
    var now_3: f32;
    var pth: f32;
    var wetShift: f32;
    var valley: f32;
    var ridge: f32;
    var humid: f32;
    var humidNow: f32;
    var grade_2: f32;
    var arid: f32;
    var wTrop: f32;
    var wBoreal: f32;
    var groveTone: f32;
    var cragTone: f32;
    var fineTone: f32;
    var lith: vec3<f32>;
    var lithLuma: f32;
    var frost: f32;
    var weathered: vec3<f32>;
    var local_116: vec3<f32>;
    var ground: vec3<f32>;
    var sand_1: vec3<f32>;
    var desert: vec3<f32>;
    var local_117: f32;
    var local_118: f32;
    var steppe: f32;
    var local_119: f32;
    var rock_4: vec3<f32>;
    var habit: f32;
    var layered: f32 = 0f;
    var gully: f32 = 0f;
    var bedRate: f32;
    var fold: f32;
    var thick: f32;
    var thin: f32;
    var gullyKeep: f32;
    var fallLength_1: f32;
    var local_120: vec2<f32>;
    var chute_1: f32;
    var rockPlain: vec3<f32>;
    var scree_1: f32;
    var rockTanEff: f32;
    var alpine: f32;
    var exposure: f32;
    var outcrop_1: f32;
    var color_7: vec3<f32>;
    var tint: vec3<f32> = vec3(1f);
    var green_1: f32;
    var grass_4: vec3<f32>;
    var slopeNow: f32;
    var sunward: f32;
    var herbs: f32;
    var local_121: vec2<f32>;
    var sward: vec2<f32>;
    var dryForest: f32;
    var canopy: vec3<f32>;
    var guideLeafCanopy: vec3<f32>;
    var deciduous: f32;
    var local_122: f32;
    var local_123: f32;
    var autumn: f32;
    var leafless: f32;
    var highland: f32;
    var canopyDetail: f32;
    var trees: f32;
    var woods: f32;
    var guideOpen: vec3<f32>;
    var flats: f32;
    var reach_6: vec2<f32>;
    var width_1: f32;
    var beachLimit: f32;
    var beach: f32;
    var shingle: f32;
    var sediment: vec3<f32>;
    var hemisphere: f32;
    var aspect: f32;
    var sun: f32;
    var tSnow: f32;
    var supply_1: f32;
    var perennial: f32;
    var seasonal: f32;
    var snow_1: f32;
    var slip: f32;
    var result: vec3<f32>;
    var guideSnow: f32;
    var local_124: f32;
    var local_125: vec3<f32>;
    var local_126: vec3<f32>;

    height_4 = height_3;
    gradient_3 = gradient_2;
    tpi_1 = tpi;
    point_6 = point_5;
    north_1 = north;
    footprint_7 = footprint_6;
    soil_2 = soil_1;
    pedology_1 = pedology;
    sandFraction_1 = sandFraction;
    ts0_3 = ts0_2;
    ps_1 = ps;
    ls_1 = ls;
    tw0_3 = tw0_2;
    pw_1 = pw;
    lw_1 = lw;
    bare_2 = bare_1;
    shore_3 = shore_2;
    openness_5 = openness_4;
    let _e302 = gradient_3;
    surfaceGroundGradient = _e302;
    let _e303 = height_4;
    surfaceGroundHeight = _e303;
    surfaceGroundShore = 1000000000f;
    surfaceGroundBeach = 0f;
    surfaceGroundEnv = vec4(0f);
    let _e322 = global.uMaterialSeed;
    salt_26 = _e322;
    let _e324 = footprint_7;
    fp_9 = _e324;
    let _e326 = surfaceSeason();
    phase_2 = _e326;
    let _e328 = height_4;
    h_10 = max(_e328, 0f);
    let _e334 = fp_9;
    let _e335 = sstep(30f, 60f, _e334);
    let _e339 = fp_9;
    let _e340 = sstep(120f, 240f, _e339);
    materialDetail = (_e335 * (1f - _e340));
    loop {
        let _e347 = k_11;
        if !((_e347 < 7i)) {
            break;
        }
        {
            let _e354 = k_11;
            if (_e354 == 0i) {
                local_113 = 64000f;
            } else {
                let _e358 = k_11;
                if (_e358 == 1i) {
                    local_112 = 48000f;
                } else {
                    let _e362 = k_11;
                    if (_e362 == 2i) {
                        local_111 = 4800f;
                    } else {
                        let _e366 = k_11;
                        if (_e366 == 3i) {
                            local_110 = 700f;
                        } else {
                            let _e370 = k_11;
                            if (_e370 == 4i) {
                                local_109 = 240f;
                            } else {
                                let _e374 = k_11;
                                if (_e374 == 5i) {
                                    local_108 = 900000f;
                                } else {
                                    local_108 = 20000f;
                                }
                                let _e380 = local_108;
                                local_109 = _e380;
                            }
                            let _e382 = local_109;
                            local_110 = _e382;
                        }
                        let _e384 = local_110;
                        local_111 = _e384;
                    }
                    let _e386 = local_111;
                    local_112 = _e386;
                }
                let _e388 = local_112;
                local_113 = _e388;
            }
            let _e390 = local_113;
            scale_2 = _e390;
            let _e392 = k_11;
            let _e394 = k_11;
            if (_e394 == 1i) {
                let _e397 = point_6;
                local_114 = (_e397 + vec3<f32>(5101f, -2297f, 3313f));
            } else {
                let _e404 = point_6;
                local_114 = _e404;
            }
            let _e406 = local_114;
            let _e407 = scale_2;
            let _e408 = k_11;
            if (_e408 >= 5i) {
                local_115 = 3i;
            } else {
                local_115 = 4i;
            }
            let _e414 = local_115;
            let _e415 = fp_9;
            let _e416 = salt_26;
            let _e419 = k_11;
            let _e422 = surfaceFbm(_e406, _e407, _e414, _e415, ((_e416 + 1u) + u32(_e419)));
            fields[_e392] = _e422;
        }
        continuing {
            let _e351 = k_11;
            k_11 = (_e351 + 1i);
        }
    }
    let _e425 = fields[0];
    regional_1 = _e425;
    let _e429 = fields[1];
    regional2_ = _e429;
    let _e433 = fields[2];
    grove_5 = _e433;
    let _e437 = fields[3];
    crag_2 = _e437;
    let _e441 = fields[4];
    fine_6 = _e441;
    let _e445 = fields[5];
    province = _e445;
    let _e447 = regional_1;
    let _e449 = regional_1;
    m1_5 = (_e447.x * sqrt(_e449.y));
    let _e454 = regional2_;
    let _e456 = regional2_;
    m2_2 = (_e454.x * sqrt(_e456.y));
    let _e461 = province;
    let _e463 = province;
    pv = (_e461.x * sqrt(_e463.y));
    let _e468 = ts0_3;
    let _e469 = ls_1;
    let _e470 = h_10;
    ts_1 = clamp((_e468 - (_e469 * _e470)), -45f, 45f);
    let _e478 = tw0_3;
    let _e479 = lw_1;
    let _e480 = h_10;
    tw_1 = clamp((_e478 - (_e479 * _e480)), -45f, 45f);
    let _e491 = fp_9;
    let _e492 = sstep(600f, 6000f, _e491);
    locality = (1f - _e492);
    let _e497 = tpi_1;
    let _e499 = sstep(0.015f, 0.12f, abs(_e497));
    terrain = _e499;
    let _e502 = m2_2;
    let _e504 = variation_2;
    let _e506 = locality;
    let _e510 = terrain;
    jitter = ((((0.8f * _e502) * _e504) * _e506) * (0.25f + (0.75f * _e510)));
    let _e515 = ts_1;
    let _e516 = tw_1;
    let _e518 = jitter;
    tHot = (max(_e515, _e516) + _e518);
    let _e521 = ts_1;
    let _e522 = tw_1;
    let _e524 = jitter;
    tCold = (min(_e521, _e522) + _e524);
    let _e527 = tw_1;
    let _e528 = ts_1;
    let _e529 = tw_1;
    let _e531 = phase_2;
    now_3 = (_e527 + ((_e528 - _e529) * _e531));
    let _e536 = ts_1;
    let _e537 = tw_1;
    pth = max((((20f * (_e536 + _e537)) * 0.5f) + 280f), 120f);
    let _e548 = moisture_1;
    let _e551 = variation_2;
    let _e553 = m1_5;
    let _e555 = locality;
    wetShift = exp(((0.6f * _e548) + (((0.1f * _e551) * _e553) * _e555)));
    let _e563 = tpi_1;
    let _e564 = sstep(0f, -0.12f, _e563);
    valley = _e564;
    let _e568 = tpi_1;
    let _e569 = sstep(0f, 0.12f, _e568);
    ridge = _e569;
    let _e571 = ps_1;
    let _e572 = pw_1;
    let _e576 = pth;
    let _e578 = wetShift;
    humid = ((max((_e571 + _e572), 0f) / _e576) * _e578);
    let _e581 = humid;
    let _e584 = valley;
    let _e589 = humid;
    let _e590 = sstep(1.5f, 3f, _e589);
    let _e595 = ridge;
    humid = (_e581 * ((1f + ((0.7f * _e584) * (1f - _e590))) - (0.18f * _e595)));
    let _e599 = pw_1;
    let _e600 = ps_1;
    let _e601 = pw_1;
    let _e603 = phase_2;
    let _e610 = pth;
    let _e612 = wetShift;
    let _e616 = valley;
    let _e620 = ridge;
    humidNow = ((((max((_e599 + ((_e600 - _e601) * _e603)), 0f) * 2f) / _e610) * _e612) * ((1f + (0.7f * _e616)) - (0.18f * _e620)));
    let _e625 = gradient_3;
    let _e627 = fp_9;
    grade_2 = (length(_e625) * pow((max(_e627, 30f) / 30f), 0.3f));
    let _e639 = humid;
    let _e640 = sstep(0.35f, 1f, _e639);
    arid = (1f - _e640);
    let _e645 = tCold;
    let _e646 = sstep(13f, 19f, _e645);
    wTrop = _e646;
    let _e653 = tCold;
    let _e654 = sstep(-14f, -3f, _e653);
    wBoreal = (1f - _e654);
    let _e657 = grove_5;
    let _e659 = grove_5;
    groveTone = (_e657.x * sqrt(_e659.y));
    let _e664 = crag_2;
    let _e666 = crag_2;
    cragTone = (_e664.x * sqrt(_e666.y));
    let _e671 = fine_6;
    let _e673 = fine_6;
    fineTone = (_e671.x * sqrt(_e673.y));
    let _e678 = point_6;
    let _e680 = h_10;
    let _e681 = grade_2;
    let _e682 = fp_9;
    let _e683 = m1_5;
    let _e684 = m2_2;
    let _e685 = groveTone;
    let _e686 = cragTone;
    let _e687 = salt_26;
    let _e688 = surfaceLithology(_e678.xy, _e680, _e681, _e682, _e683, _e684, _e685, _e686, _e687);
    lith = _e688;
    let _e690 = lith;
    lithLuma = dot(_e690, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
    let _e700 = tHot;
    let _e701 = sstep(2f, 10f, _e700);
    frost = (1f - _e701);
    let _e704 = lith;
    let _e705 = lithLuma;
    let _e708 = surfaceMix(_e704, vec3(_e705), 0.25f);
    let _e718 = humid;
    let _e719 = sstep(0.8f, 2.2f, _e718);
    weathered = ((_e708 * vec3<f32>(0.78f, 0.68f, 0.56f)) * (1f - (0.22f * _e719)));
    let _e724 = bare_2;
    if _e724 {
        let _e725 = soil_2;
        local_116 = _e725;
    } else {
        let _e726 = pedology_1;
        let _e727 = weathered;
        let _e729 = surfaceMix(_e726, _e727, 0.45f);
        local_116 = _e729;
    }
    let _e731 = local_116;
    ground = _e731;
    let _e744 = pv;
    let _e745 = sstep(-0.3f, 0.5f, _e744);
    let _e746 = surfaceMix(vec3<f32>(0.8f, 0.66f, 0.46f), vec3<f32>(0.7f, 0.5f, 0.33f), _e745);
    let _e747 = weathered;
    let _e751 = surfaceMix(_e746, (_e747 * 1.25f), 0.35f);
    sand_1 = _e751;
    let _e757 = sand_1;
    let _e761 = m2_2;
    let _e763 = groveTone;
    let _e767 = sandFraction_1;
    let _e773 = grade_2;
    let _e775 = rockTan;
    let _e778 = sstep(-0.4f, 0.4f, ((((_e761 + (0.6f * _e763)) + (1.5f * _e767)) - 0.5f) - ((0.8f * _e773) / _e775)));
    let _e779 = surfaceMix(vec3<f32>(0.55f, 0.46f, 0.36f), _e757, _e778);
    desert = _e779;
    let _e781 = ground;
    let _e782 = desert;
    let _e783 = arid;
    let _e784 = bare_2;
    if _e784 {
        local_117 = 0.8f;
    } else {
        local_117 = 0.6f;
    }
    let _e788 = local_117;
    let _e790 = surfaceMix(_e781, _e782, (_e783 * _e788));
    ground = _e790;
    let _e791 = ground;
    let _e796 = wTrop;
    let _e799 = humid;
    let _e800 = sstep(1f, 2f, _e799);
    let _e802 = bare_2;
    if _e802 {
        local_118 = 0.6f;
    } else {
        local_118 = 0.5f;
    }
    let _e806 = local_118;
    let _e808 = surfaceMix(_e791, vec3<f32>(0.5f, 0.29f, 0.17f), ((_e796 * _e800) * _e806));
    ground = _e808;
    let _e810 = arid;
    let _e813 = wTrop;
    let _e817 = wBoreal;
    let _e822 = humid;
    let _e823 = sstep(0.8f, 1.2f, _e822);
    let _e828 = humid;
    let _e829 = sstep(1.6f, 2.4f, _e828);
    steppe = (((((1f - _e810) * (1f - _e813)) * (1f - _e817)) * _e823) * (1f - _e829));
    let _e833 = ground;
    let _e838 = steppe;
    let _e839 = bare_2;
    if _e839 {
        local_119 = 0.5f;
    } else {
        local_119 = 0.35f;
    }
    let _e843 = local_119;
    let _e845 = surfaceMix(_e833, vec3<f32>(0.25f, 0.21f, 0.16f), (_e838 * _e843));
    ground = _e845;
    let _e846 = ground;
    let _e847 = ground;
    let _e853 = frost;
    let _e856 = surfaceMix(_e846, (_e847 * vec3<f32>(0.86f, 0.9f, 0.96f)), (_e853 * 0.6f));
    ground = _e856;
    let _e857 = ground;
    let _e860 = valley;
    let _e864 = ridge;
    ground = (_e857 * ((1f - (0.12f * _e860)) + (0.08f * _e864)));
    let _e868 = ground;
    let _e870 = variation_2;
    let _e872 = m1_5;
    let _e874 = locality;
    let _e877 = groveTone;
    let _e881 = fineTone;
    ground = (_e868 * (1f + (_e870 * ((((0.035f * _e872) * _e874) + (0.045f * _e877)) + (0.05f * _e881)))));
    let _e887 = lith;
    let _e888 = lith;
    let _e894 = lith;
    let _e903 = m2_2;
    let _e905 = groveTone;
    let _e908 = sstep(-0.2f, 0.6f, (_e903 + (0.5f * _e905)));
    let _e909 = surfaceMix((_e888 * vec3<f32>(0.7f, 0.66f, 0.62f)), (_e894 * vec3<f32>(1.1f, 0.84f, 0.64f)), _e908);
    let _e910 = arid;
    let _e913 = surfaceMix(_e887, _e909, (_e910 * 0.8f));
    rock_4 = _e913;
    let _e915 = rock_4;
    let _e916 = rock_4;
    let _e917 = lithLuma;
    let _e920 = surfaceMix(_e916, vec3(_e917), 0.55f);
    let _e926 = frost;
    let _e929 = surfaceMix(_e915, (_e920 * vec3<f32>(0.92f, 0.96f, 1.03f)), (_e926 * 0.7f));
    rock_4 = _e929;
    let _e930 = rock_4;
    let _e935 = humid;
    let _e936 = sstep(1.2f, 3f, _e935);
    rock_4 = (_e930 * (1f - (0.14f * _e936)));
    let _e941 = cragTone;
    let _e944 = groveTone;
    let _e949 = surfaceBedded;
    habit = (((0.9f * _e941) + (0.5f * _e944)) + (0.6f * (0.5f - _e949)));
    let _e956 = habit;
    let _e957 = sstep(0.15f, 0.75f, _e956);
    surfaceRockMassive = _e957;
    let _e960 = habit;
    let _e962 = sstep(0.2f, 0.8f, -(_e960));
    surfaceRockShatter = _e962;
    let _e965 = arid;
    let _e971 = frost;
    let _e977 = surfaceBedded;
    let _e983 = surfaceRockMassive;
    surfaceStrataWeight = ((((ROCK_STRATA * (0.3f + (0.7f * _e965))) * (1f - (0.5f * _e971))) * (0.25f + (0.75f * _e977))) * (1f - (0.7f * _e983)));
    let _e989 = frost;
    let _e994 = arid;
    let _e1000 = surfaceRockMassive;
    surfaceStreakWeight = (((ROCK_STREAKS * mix(0.85f, 1f, _e989)) * (1f - (0.2f * _e994))) * (1f - (0.35f * _e1000)));
    let _e1006 = frost;
    let _e1011 = surfaceRockMassive;
    let _e1015 = surfaceRockShatter;
    surfaceFacetWeight = ((ROCK_FACETS * mix(1f, 0.6f, _e1006)) * ((0.7f - (0.5f * _e1011)) + (0.6f * _e1015)));
    surfaceRockSlope = vec2(0f);
    surfaceRockCavity = vec2(0f);
    let _e1027 = global.uQuality;
    if (_e1027 == 0i) {
        {
            let _e1030 = fp_9;
            let _e1031 = grade_2;
            bedRate = (_e1030 * (_e1031 + 0.3f));
            let _e1036 = surfaceRise;
            let _e1039 = salt_26;
            let _e1042 = surfaceBed((_e1036 / 170f), (_e1039 + 26u));
            fold = _e1042;
            let _e1044 = surfaceRise;
            let _e1048 = fold;
            let _e1051 = salt_26;
            let _e1054 = surfaceBed(((_e1044 / 300f) + (0.9f * _e1048)), (_e1051 + 24u));
            let _e1058 = bedRate;
            let _e1061 = sstep(0.125f, 0.25f, (_e1058 / 110f));
            thick = (_e1054 * (1f - _e1061));
            let _e1065 = surfaceRise;
            let _e1069 = surfaceRise;
            let _e1072 = salt_26;
            let _e1075 = surfaceBed((_e1069 / 47f), (_e1072 + 28u));
            let _e1078 = salt_26;
            let _e1081 = surfaceBed(((_e1065 / 80f) + (1.1f * _e1075)), (_e1078 + 29u));
            let _e1085 = bedRate;
            let _e1088 = sstep(0.125f, 0.25f, (_e1085 / 40f));
            thin = (_e1081 * (1f - _e1088));
            let _e1093 = thick;
            let _e1096 = thin;
            let _e1100 = fold;
            let _e1109 = fineTone;
            let _e1112 = sstep(-0.5f, 0.5f, (_e1109 - 0.3f));
            let _e1117 = surfaceStrataWeight;
            let _e1121 = arid;
            let _e1127 = grade_2;
            let _e1128 = sstep(0.25f, 0.7f, _e1127);
            let _e1135 = fp_9;
            let _e1136 = sstep(2.5f, 6f, _e1135);
            layered = (((((0.24f * _e1093) + (((0.2f * _e1096) * (1f + (0.9f * _e1100))) * (0.35f + (0.65f * _e1112)))) * _e1117) * mix((0.3f + (0.5f * _e1121)), 1f, _e1128)) * mix(1f, 0.55f, _e1136));
            let _e1142 = fp_9;
            let _e1143 = sstep(14f, 28f, _e1142);
            let _e1145 = rockTan;
            let _e1148 = rockTan;
            let _e1151 = grade_2;
            let _e1152 = sstep((_e1145 * 0.3f), (_e1148 * 0.8f), _e1151);
            let _e1154 = surfaceStreakWeight;
            gullyKeep = (((1f - _e1143) * _e1152) * _e1154);
            let _e1157 = gullyKeep;
            if (_e1157 > 0.01f) {
                {
                    let _e1160 = gradient_3;
                    fallLength_1 = length(_e1160);
                    let _e1163 = fallLength_1;
                    if (_e1163 > 0.0001f) {
                        let _e1166 = gradient_3;
                        let _e1167 = fallLength_1;
                        local_120 = (_e1166 / vec2(_e1167));
                    } else {
                        local_120 = vec2<f32>(1f, 0f);
                    }
                    let _e1174 = local_120;
                    surfaceFall = _e1174;
                    let _e1175 = point_6;
                    let _e1179 = salt_26;
                    let _e1182 = surfaceChute(_e1175.xy, 110f, 700f, (_e1179 + 27u));
                    chute_1 = _e1182;
                    let _e1185 = gullyKeep;
                    let _e1187 = chute_1;
                    gully = ((0.05f * _e1185) * _e1187);
                    let _e1190 = gullyKeep;
                    let _e1192 = surfaceChuteSlope;
                    surfaceRockSlope = ((8.8f * _e1190) * _e1192);
                    let _e1196 = gullyKeep;
                    let _e1198 = chute_1;
                    surfaceRockCavity.x = ((0.5f * _e1196) * max(-(_e1198), 0f));
                }
            }
        }
    }
    let _e1203 = rock_4;
    rockPlain = _e1203;
    let _e1205 = rock_4;
    let _e1207 = variation_2;
    let _e1208 = layered;
    let _e1209 = gully;
    let _e1212 = cragTone;
    let _e1220 = variation_2;
    let _e1221 = layered;
    rock_4 = ((_e1205 * (1f + (_e1207 * ((_e1208 + _e1209) + (0.07f * _e1212))))) * (vec3(1f) + ((_e1220 * _e1221) * vec3<f32>(0.25f, 0f, -0.3f))));
    let _e1233 = grade_2;
    let _e1234 = sstep(0.3f, 0.5f, _e1233);
    let _e1238 = grade_2;
    let _e1239 = sstep(0.75f, 1.05f, _e1238);
    let _e1244 = valley;
    let _e1250 = surfaceRockMassive;
    scree_1 = (((_e1234 * (1f - _e1239)) * (0.35f + (0.65f * _e1244))) * (1f - (0.5f * _e1250)));
    let _e1255 = rock_4;
    let _e1256 = rockPlain;
    let _e1260 = scree_1;
    let _e1262 = surfaceMix(_e1255, (_e1256 * 1.06f), (0.7f * _e1260));
    let _e1265 = ridge;
    let _e1269 = valley;
    rock_4 = (_e1262 * ((1f + (0.03f * _e1265)) - (0.03f * _e1269)));
    let _e1273 = ground;
    let _e1274 = rockPlain;
    let _e1280 = grade_2;
    let _e1281 = sstep(0.22f, 0.42f, _e1280);
    let _e1286 = grade_2;
    let _e1287 = sstep(0.8f, 1.2f, _e1286);
    let _e1290 = surfaceMix(_e1273, (_e1274 * 1.06f), ((0.4f * _e1281) * (1f - _e1287)));
    ground = _e1290;
    let _e1291 = rock_4;
    surfaceRockTone = _e1291;
    let _e1292 = ground;
    surfaceSoilTone = _e1292;
    let _e1293 = rockTan;
    let _e1298 = humid;
    let _e1299 = sstep(0.3f, 1.3f, _e1298);
    rockTanEff = (_e1293 * (0.55f + (0.45f * _e1299)));
    let _e1307 = tHot;
    let _e1308 = sstep(2f, 9f, _e1307);
    alpine = (1f - _e1308);
    let _e1311 = rockTanEff;
    let _e1314 = rockTanEff;
    let _e1317 = grade_2;
    let _e1318 = sstep((_e1311 * 0.5f), (_e1314 * 1.3f), _e1317);
    let _e1320 = alpine;
    let _e1322 = rockTanEff;
    let _e1325 = rockTanEff;
    let _e1328 = grade_2;
    let _e1329 = sstep((_e1322 * 0.15f), (_e1325 * 0.7f), _e1328);
    let _e1333 = ridge;
    let _e1337 = grade_2;
    let _e1338 = rockTan;
    let _e1340 = sstep(0.35f, 0.9f, (_e1337 / _e1338));
    let _e1344 = valley;
    exposure = (((_e1318 + ((0.45f * _e1320) * _e1329)) + ((0.35f * _e1333) * _e1340)) - (0.3f * _e1344));
    let _e1348 = exposure;
    let _e1353 = crag_2;
    let _e1357 = grove_5;
    let _e1360 = grove_5;
    let _e1365 = crag_2;
    let _e1369 = surfaceCover(clamp(_e1348, 0f, 1f), vec2<f32>(((0.75f * _e1353.x) + ((0.25f * _e1357.x) * sqrt(_e1360.y))), _e1365.y), 0.35f);
    outcrop_1 = _e1369;
    let _e1371 = ground;
    let _e1372 = rock_4;
    let _e1373 = outcrop_1;
    let _e1374 = surfaceMix(_e1371, _e1372, _e1373);
    color_7 = _e1374;
    let _e1376 = bare_2;
    if _e1376 {
        {
            let _e1377 = height_4;
            let _e1378 = color_7;
            let _e1379 = now_3;
            let _e1380 = m1_5;
            let _e1381 = variation_2;
            let _e1382 = surfaceOcean(_e1377, _e1378, _e1379, _e1380, _e1381);
            return _e1382;
        }
    }
    let _e1388 = humidNow;
    let _e1389 = sstep(0.5f, 1.4f, _e1388);
    let _e1392 = now_3;
    let _e1393 = sstep(3f, 12f, _e1392);
    green_1 = (_e1389 * _e1393);
    let _e1404 = green_1;
    let _e1405 = surfaceMix(vec3<f32>(0.6f, 0.53f, 0.34f), vec3<f32>(0.29f, 0.37f, 0.16f), _e1404);
    grass_4 = _e1405;
    let _e1407 = grass_4;
    let _e1415 = tHot;
    let _e1416 = sstep(7f, 14f, _e1415);
    let _e1418 = surfaceMix(_e1407, vec3<f32>(0.4f, 0.38f, 0.27f), (1f - _e1416));
    let _e1419 = tint;
    grass_4 = (_e1418 * _e1419);
    let _e1421 = gradient_3;
    slopeNow = length(_e1421);
    let _e1424 = gradient_3;
    let _e1427 = slopeNow;
    let _e1432 = slopeNow;
    let _e1433 = sstep(0.03f, 0.25f, _e1432);
    sunward = ((_e1424.y / max(0.2f, _e1427)) * _e1433);
    let _e1439 = groveTone;
    let _e1442 = fineTone;
    let _e1446 = sunward;
    let _e1450 = valley;
    let _e1454 = ridge;
    let _e1460 = tpi_1;
    let _e1468 = valley;
    let _e1472 = ridge;
    surfaceHerbTone = (vec3(1f) - (clamp(((((((0.3f * _e1439) + (0.2f * _e1442)) - (0.7f * _e1446)) + (0.7f * _e1450)) - (0.4f * _e1454)) + (((0.5f * clamp((-30f * _e1460), -1f, 1f)) * (1f - _e1468)) * (1f - _e1472))), -1f, 1f) * vec3<f32>(0.19f, 0.07f, 0f)));
    let _e1486 = grass_4;
    let _e1487 = surfaceHerbTone;
    grass_4 = (_e1486 * _e1487);
    let _e1491 = humid;
    let _e1492 = sstep(0.2f, 0.85f, _e1491);
    let _e1495 = tHot;
    let _e1496 = sstep(0f, 7f, _e1495);
    let _e1499 = rockTan;
    let _e1502 = rockTan;
    let _e1505 = grade_2;
    let _e1506 = sstep((_e1499 * 0.8f), (_e1502 * 1.4f), _e1505);
    herbs = ((_e1492 * _e1496) * (1f - _e1506));
    let _e1510 = fine_6;
    if (_e1510.y > 0f) {
        let _e1514 = fine_6;
        local_121 = _e1514;
    } else {
        let _e1515 = grove_5;
        local_121 = _e1515;
    }
    let _e1517 = local_121;
    sward = _e1517;
    let _e1519 = color_7;
    let _e1520 = grass_4;
    let _e1521 = herbs;
    let _e1523 = outcrop_1;
    let _e1526 = sward;
    let _e1528 = variation_2;
    let _e1530 = surfaceCover((_e1521 * (1f - _e1523)), _e1526, (0.12f * _e1528));
    let _e1531 = surfaceMix(_e1519, _e1520, _e1530);
    color_7 = _e1531;
    let _e1535 = humid;
    let _e1536 = sstep(1.3f, 3f, _e1535);
    dryForest = (1f - _e1536);
    let _e1547 = wTrop;
    let _e1548 = surfaceMix(vec3<f32>(0.2f, 0.28f, 0.14f), vec3<f32>(0.16f, 0.255f, 0.13f), _e1547);
    canopy = _e1548;
    let _e1550 = canopy;
    let _e1555 = wBoreal;
    let _e1556 = surfaceMix(_e1550, vec3<f32>(0.15f, 0.22f, 0.16f), _e1555);
    canopy = _e1556;
    let _e1557 = canopy;
    let _e1562 = dryForest;
    let _e1565 = surfaceMix(_e1557, vec3<f32>(0.27f, 0.29f, 0.17f), (_e1562 * 0.75f));
    canopy = _e1565;
    let _e1566 = canopy;
    guideLeafCanopy = _e1566;
    let _e1569 = wTrop;
    let _e1573 = wBoreal;
    let _e1579 = dryForest;
    deciduous = (((1f - _e1569) * (1f - (0.7f * _e1573))) * (1f - (0.5f * _e1579)));
    let _e1584 = season;
    let _e1585 = ts_1;
    let _e1586 = tw_1;
    if (_e1585 >= _e1586) {
        local_122 = 0f;
    } else {
        local_122 = 0.5f;
    }
    let _e1591 = local_122;
    local_123 = fract((_e1584 + _e1591));
    let _e1597 = local_123;
    let _e1598 = sstep(0.66f, 0.76f, _e1597);
    let _e1602 = local_123;
    let _e1603 = sstep(0.84f, 0.92f, _e1602);
    autumn = (_e1598 * (1f - _e1603));
    let _e1607 = canopy;
    let _e1612 = autumn;
    let _e1613 = deciduous;
    let _e1617 = surfaceMix(_e1607, vec3<f32>(0.42f, 0.27f, 0.11f), ((_e1612 * _e1613) * 0.6f));
    canopy = _e1617;
    let _e1620 = now_3;
    let _e1621 = sstep(8f, 2f, _e1620);
    let _e1622 = deciduous;
    leafless = (_e1621 * _e1622);
    let _e1625 = canopy;
    let _e1630 = leafless;
    let _e1633 = surfaceMix(_e1625, vec3<f32>(0.36f, 0.33f, 0.28f), (_e1630 * 0.75f));
    canopy = _e1633;
    let _e1637 = tHot;
    let _e1638 = sstep(10f, 17f, _e1637);
    let _e1640 = materialDetail;
    highland = ((1f - _e1638) * _e1640);
    let _e1644 = highland;
    let _e1646 = crag_2;
    let _e1649 = crag_2;
    let _e1654 = fine_6;
    let _e1657 = fine_6;
    canopyDetail = clamp(((((0.12f * _e1644) * _e1646.x) * sqrt(_e1649.y)) + ((0.025f * _e1654.x) * sqrt(_e1657.y))), -0.18f, 0.18f);
    let _e1667 = canopy;
    let _e1668 = tint;
    let _e1672 = highland;
    let _e1677 = variation_2;
    let _e1678 = canopyDetail;
    canopy = (((_e1667 * _e1668) * (1f - (0.18f * _e1672))) * (1f + (_e1677 * _e1678)));
    let _e1684 = humid;
    let _e1685 = sstep(0.65f, 2.1f, _e1684);
    let _e1688 = tHot;
    let _e1690 = valley;
    let _e1693 = sstep(5.5f, 13.5f, (_e1688 + (0.8f * _e1690)));
    let _e1695 = forestAmount;
    let _e1698 = rockTan;
    let _e1701 = rockTan;
    let _e1704 = grade_2;
    let _e1705 = sstep((_e1698 * 0.9f), (_e1701 * 1.6f), _e1704);
    let _e1709 = outcrop_1;
    trees = ((((_e1685 * _e1693) * _e1695) * (1f - _e1705)) * (1f - _e1709));
    let _e1713 = trees;
    let _e1716 = ridge;
    let _e1721 = valley;
    let _e1725 = tHot;
    let _e1726 = sstep(2f, 10f, _e1725);
    let _e1730 = humid;
    let _e1731 = sstep(0.4f, 1.2f, _e1730);
    let _e1734 = outcrop_1;
    let _e1737 = forestAmount;
    trees = ((_e1713 * (1f - (0.22f * _e1716))) + (((((0.14f * _e1721) * _e1726) * _e1731) * (1f - _e1734)) * _e1737));
    let _e1740 = trees;
    let _e1744 = grove_5;
    let _e1746 = variation_2;
    let _e1748 = surfaceCover(clamp(_e1740, 0f, 1f), _e1744, (0.65f * _e1746));
    woods = _e1748;
    let _e1750 = color_7;
    guideOpen = _e1750;
    let _e1752 = color_7;
    let _e1753 = canopy;
    let _e1754 = woods;
    let _e1755 = surfaceMix(_e1752, _e1753, _e1754);
    color_7 = _e1755;
    let _e1759 = height_4;
    let _e1760 = sstep(1.5f, 6f, _e1759);
    let _e1765 = grade_2;
    let _e1766 = sstep(0.05f, 0.2f, _e1765);
    flats = ((1f - _e1760) * (1f - _e1766));
    let _e1772 = fields[6];
    reach_6 = _e1772;
    let _e1774 = reach_6;
    let _e1775 = grove_5;
    let _e1776 = fine_6;
    let _e1777 = openness_5;
    let _e1778 = surfaceBeachWidth(_e1774, _e1775, _e1776, _e1777);
    width_1 = _e1778;
    let _e1781 = fp_9;
    beachLimit = (20f * _e1781);
    if (uRenderV2_ > 0i) {
        let _e1787 = fp_9;
        beachLimit = (20f * max(_e1787, 30f));
    }
    let _e1791 = width_1;
    let _e1792 = beachLimit;
    let _e1794 = shore_3;
    let _e1796 = fp_9;
    let _e1798 = fp_9;
    let _e1806 = height_4;
    let _e1807 = sstep(4f, 12f, _e1806);
    let _e1813 = grade_2;
    let _e1814 = sstep(0.2f, 0.5f, _e1813);
    beach = ((clamp((((min(_e1791, _e1792) - _e1794) + _e1796) / _e1798), 0f, 1f) * (1f - _e1807)) * (1f - _e1814));
    let _e1821 = tHot;
    let _e1822 = sstep(4f, 14f, _e1821);
    let _e1826 = grade_2;
    let _e1827 = sstep(0.04f, 0.22f, _e1826);
    let _e1828 = terrain;
    shingle = max((1f - _e1822), (_e1827 * _e1828));
    let _e1843 = pv;
    let _e1844 = sstep(-0.2f, 0.9f, _e1843);
    let _e1845 = surfaceMix(vec3<f32>(0.8f, 0.75f, 0.61f), vec3<f32>(0.76f, 0.63f, 0.43f), _e1844);
    sediment = _e1845;
    let _e1847 = sediment;
    let _e1852 = wTrop;
    let _e1856 = pv;
    let _e1857 = sstep(0f, -0.8f, _e1856);
    let _e1861 = surfaceMix(_e1847, vec3<f32>(0.86f, 0.84f, 0.76f), ((_e1852 * _e1857) * 0.7f));
    sediment = _e1861;
    let _e1862 = sediment;
    let _e1863 = rockPlain;
    let _e1864 = shingle;
    let _e1867 = surfaceMix(_e1862, _e1863, (_e1864 * 0.9f));
    sediment = _e1867;
    let _e1868 = sediment;
    let _e1869 = ground;
    let _e1870 = rockPlain;
    let _e1872 = surfaceMix(_e1869, _e1870, 0.4f);
    let _e1877 = m2_2;
    let _e1878 = sstep(-0.9f, -1.5f, _e1877);
    let _e1881 = surfaceMix(_e1868, _e1872, (_e1878 * 0.85f));
    sediment = _e1881;
    let _e1882 = sediment;
    let _e1889 = m1_5;
    let _e1891 = shingle;
    let _e1894 = sstep(1.25f, 1.75f, (_e1889 + (0.35f * _e1891)));
    let _e1897 = surfaceMix(_e1882, vec3<f32>(0.27f, 0.26f, 0.25f), (_e1894 * 0.9f));
    sediment = _e1897;
    let _e1898 = color_7;
    let _e1899 = sediment;
    let _e1902 = flats;
    let _e1906 = fp_9;
    let _e1907 = sstep(240f, 960f, _e1906);
    let _e1912 = surfaceMix(_e1898, (_e1899 * 0.9f), ((_e1902 * (1f - _e1907)) * 0.8f));
    color_7 = _e1912;
    let _e1913 = color_7;
    let _e1914 = sediment;
    let _e1915 = beach;
    let _e1918 = surfaceMix(_e1913, _e1914, (_e1915 * 0.8f));
    color_7 = _e1918;
    let _e1919 = guideOpen;
    renderGuideBaseOpen = _e1919;
    let _e1920 = guideLeafCanopy;
    let _e1921 = tint;
    let _e1925 = highland;
    let _e1930 = variation_2;
    let _e1931 = canopyDetail;
    let _e1937 = valley;
    renderGuideBaseClosed = ((((_e1920 * _e1921) * (1f - (0.18f * _e1925))) * (1f + (_e1930 * _e1931))) * (1f - (0.06f * _e1937)));
    let _e1941 = renderGuideBaseOpen;
    let _e1942 = sediment;
    let _e1945 = flats;
    let _e1949 = fp_9;
    let _e1950 = sstep(240f, 960f, _e1949);
    let _e1955 = surfaceMix(_e1941, (_e1942 * 0.9f), ((_e1945 * (1f - _e1950)) * 0.8f));
    let _e1956 = sediment;
    let _e1957 = beach;
    let _e1960 = surfaceMix(_e1955, _e1956, (_e1957 * 0.8f));
    guideOpen = _e1960;
    let _e1961 = beach;
    renderGuideBeach = (_e1961 * 0.8f);
    let _e1964 = sediment;
    renderGuideSediment = _e1964;
    let _e1965 = flats;
    let _e1969 = fp_9;
    let _e1970 = sstep(240f, 960f, _e1969);
    renderGuideFlats = ((_e1965 * (1f - _e1970)) * 0.8f);
    let _e1975 = shore_3;
    renderGuideShore = _e1975;
    let _e1976 = openness_5;
    renderGuideOpenness = _e1976;
    let _e1977 = point_6;
    let _e1979 = point_6;
    let _e1981 = point_6;
    let _e1985 = point_6;
    let _e1986 = point_6;
    hemisphere = (_e1977.y / max(sqrt(((_e1979.y * _e1981.y) + (0.0064f * dot(_e1985, _e1986)))), 1f));
    let _e1995 = gradient_3;
    let _e1996 = north_1;
    let _e1998 = gradient_3;
    let _e2003 = hemisphere;
    aspect = ((dot(_e1995, _e1996) / max(length(_e1998), 0.00001f)) * _e2003);
    let _e2006 = aspect;
    let _e2007 = gradient_3;
    sun = (_e2006 * min(length(_e2007), 1f));
    let _e2013 = now_3;
    let _e2015 = sun;
    let _e2019 = m1_5;
    let _e2021 = variation_2;
    let _e2023 = locality;
    let _e2027 = ridge;
    let _e2031 = valley;
    tSnow = ((((_e2013 + (2.2f * _e2015)) + (((0.45f * _e2019) * _e2021) * _e2023)) + (0.25f * _e2027)) - (0.35f * _e2031));
    let _e2037 = ps_1;
    let _e2038 = pw_1;
    let _e2042 = wetShift;
    let _e2046 = valley;
    let _e2050 = ridge;
    let _e2054 = sstep(60f, 400f, ((max((_e2037 + _e2038), 0f) * _e2042) * ((1f + (0.5f * _e2046)) - (0.25f * _e2050))));
    supply_1 = _e2054;
    let _e2059 = ts_1;
    let _e2060 = tw_1;
    let _e2063 = sun;
    let _e2067 = m1_5;
    let _e2069 = variation_2;
    let _e2071 = locality;
    let _e2074 = sstep(2.5f, -2.5f, ((max(_e2059, _e2060) + (1.5f * _e2063)) + (((0.35f * _e2067) * _e2069) * _e2071)));
    let _e2075 = supply_1;
    perennial = (_e2074 * _e2075);
    let _e2081 = tSnow;
    let _e2082 = sstep(1f, -4f, _e2081);
    let _e2085 = humid;
    let _e2086 = sstep(0.15f, 0.5f, _e2085);
    let _e2088 = supply_1;
    seasonal = ((_e2082 * _e2086) * _e2088);
    let _e2091 = seasonal;
    let _e2092 = perennial;
    let _e2094 = snowAmount;
    snow_1 = clamp((max(_e2091, _e2092) * _e2094), 0f, 1f);
    let _e2102 = perennial;
    let _e2106 = perennial;
    let _e2108 = gradient_3;
    let _e2110 = sstep((1.25f + (0.65f * _e2102)), (3.5f + _e2106), length(_e2108));
    slip = _e2110;
    let _e2112 = snow_1;
    let _e2116 = perennial;
    let _e2119 = slip;
    let _e2125 = woods;
    let _e2128 = perennial;
    let _e2133 = leafless;
    snow_1 = ((_e2112 * (1f - ((0.88f - (0.18f * _e2116)) * _e2119))) * (1f - (((0.3f * _e2125) * (1f - _e2128)) * (1f - (0.7f * _e2133)))));
    let _e2139 = humidNow;
    let _e2140 = green_1;
    let _e2141 = arid;
    let _e2142 = sandFraction_1;
    let _e2144 = snow_1;
    surfaceGroundEnv = vec4<f32>(_e2139, _e2140, (_e2141 * _e2142), _e2144);
    let _e2146 = beach;
    surfaceGroundBeach = _e2146;
    let _e2147 = openness_5;
    let _e2150 = beach;
    if ((_e2147 > 0.02f) || (_e2150 > 0.01f)) {
        let _e2154 = shore_3;
        surfaceGroundShore = _e2154;
    }
    let _e2155 = color_7;
    let _e2160 = snow_1;
    let _e2161 = crag_2;
    let _e2163 = variation_2;
    let _e2165 = surfaceCover(_e2160, _e2161, (0.35f * _e2163));
    let _e2166 = surfaceMix(_e2155, vec3<f32>(0.94f, 0.96f, 0.97f), _e2165);
    color_7 = _e2166;
    let _e2167 = color_7;
    let _e2170 = valley;
    color_7 = (_e2167 * (1f - (0.06f * _e2170)));
    let _e2174 = height_4;
    let _e2175 = color_7;
    let _e2176 = now_3;
    let _e2177 = m1_5;
    let _e2178 = variation_2;
    let _e2179 = surfaceOcean(_e2174, _e2175, _e2176, _e2177, _e2178);
    result = _e2179;
    let _e2181 = snow_1;
    let _e2182 = crag_2;
    let _e2184 = variation_2;
    let _e2186 = surfaceCover(_e2181, _e2182, (0.35f * _e2184));
    guideSnow = _e2186;
    let _e2188 = result;
    renderGuideColor = _e2188;
    let _e2189 = height_4;
    if (_e2189 >= 0f) {
        let _e2192 = woods;
        local_124 = _e2192;
    } else {
        local_124 = 0f;
    }
    let _e2195 = local_124;
    renderGuideWoods = _e2195;
    let _e2196 = height_4;
    if (_e2196 >= 0f) {
        let _e2199 = guideOpen;
        let _e2204 = guideSnow;
        let _e2205 = surfaceMix(_e2199, vec3<f32>(0.94f, 0.96f, 0.97f), _e2204);
        let _e2208 = valley;
        local_125 = clamp((_e2205 * (1f - (0.06f * _e2208))), vec3(0f), vec3(1f));
    } else {
        let _e2217 = result;
        local_125 = _e2217;
    }
    let _e2219 = local_125;
    renderGuideOpen = _e2219;
    let _e2220 = height_4;
    if (_e2220 >= 0f) {
        let _e2223 = canopy;
        let _e2228 = guideSnow;
        let _e2229 = surfaceMix(_e2223, vec3<f32>(0.94f, 0.96f, 0.97f), _e2228);
        let _e2232 = valley;
        local_126 = clamp((_e2229 * (1f - (0.06f * _e2232))), vec3(0f), vec3(1f));
    } else {
        let _e2241 = result;
        local_126 = _e2241;
    }
    let _e2243 = local_126;
    renderGuideClosed = _e2243;
    let _e2244 = result;
    return _e2244;
}

fn earthMaterial(s_5: vec3<f32>, world_25: vec2<f32>, fp_10: f32, tpi_2: f32, shore_4: f32, openness_6: f32) -> vec3<f32> {
    var s_6: vec3<f32>;
    var world_26: vec2<f32>;
    var fp_11: f32;
    var tpi_3: f32;
    var shore_5: f32;
    var openness_7: f32;
    var t_12: f32;
    var p_21: f32;
    var arid_1: f32;
    var soil_3: vec3<f32>;

    s_6 = s_5;
    world_26 = world_25;
    fp_11 = fp_10;
    tpi_3 = tpi_2;
    shore_5 = shore_4;
    openness_7 = openness_6;
    let _e278 = global.uMaterialClimate;
    t_12 = _e278.x;
    let _e281 = global.uMaterialClimate;
    p_21 = _e281.y;
    let _e287 = p_21;
    let _e289 = t_12;
    let _e296 = sstep(0.35f, 1f, (_e287 / max(((20f * _e289) + 280f), 120f)));
    arid_1 = (1f - _e296);
    let _e307 = arid_1;
    soil_3 = mix(vec3<f32>(0.34f, 0.29f, 0.22f), vec3<f32>(0.7f, 0.5f, 0.33f), vec3(_e307));
    let _e311 = s_6;
    let _e313 = s_6;
    let _e315 = tpi_3;
    let _e316 = world_26;
    let _e323 = fp_11;
    let _e324 = soil_3;
    let _e325 = soil_3;
    let _e327 = t_12;
    let _e330 = p_21;
    let _e334 = t_12;
    let _e337 = p_21;
    let _e342 = shore_5;
    let _e343 = openness_7;
    let _e344 = surfaceMaterial(_e311.x, _e313.yz, _e315, vec3<f32>(_e316.x, _e316.y, 0f), vec2(0f), _e323, _e324, _e325, 0.5f, (_e327 + 6f), (_e330 * 0.5f), 0.0065f, (_e334 - 6f), (_e337 * 0.5f), 0.0065f, false, _e342, _e343);
    return _e344;
}

fn groundSmooth(a_11: f32, b_11: f32, x_3: f32) -> f32 {
    var a_12: f32;
    var b_12: f32;
    var x_4: f32;
    var t_13: f32;

    a_12 = a_11;
    b_12 = b_11;
    x_4 = x_3;
    let _e272 = x_4;
    let _e273 = a_12;
    let _e275 = b_12;
    let _e276 = a_12;
    t_13 = clamp(((_e272 - _e273) / (_e275 - _e276)), 0f, 1f);
    let _e283 = t_13;
    let _e284 = t_13;
    let _e288 = t_13;
    return ((_e283 * _e284) * (3f - (2f * _e288)));
}

fn groundToLinear(c_11: vec3<f32>) -> vec3<f32> {
    var c_12: vec3<f32>;

    c_12 = c_11;
    let _e268 = c_12;
    return pow(max(_e268, vec3(0f)), vec3(2.2f));
}

fn groundToDisplay(c_13: vec3<f32>) -> vec3<f32> {
    var c_14: vec3<f32>;

    c_14 = c_13;
    if (uRenderV2_ > 0i) {
        let _e270 = c_14;
        return pow(max(_e270, vec3(0f)), vec3(0.45454544f));
    }
    let _e279 = c_14;
    return pow(clamp(_e279, vec3(0f), vec3(1f)), vec3(0.45454544f));
}

fn groundNoise(point_7: vec3<f32>, seed_4: u32) -> vec4<f32> {
    var point_8: vec3<f32>;
    var seed_5: u32;
    var cell_6: vec3<i32>;
    var f_11: vec3<f32>;
    var u_6: vec3<f32>;
    var du_1: vec3<f32>;
    var n_6: vec4<f32> = vec4(0f);
    var k_12: i32 = 0i;
    var corner: vec3<i32>;
    var h_11: u32;
    var g_4: vec3<f32>;
    var w_3: vec3<f32>;
    var d_9: vec3<f32>;
    var v_13: f32;

    point_8 = point_7;
    seed_5 = seed_4;
    let _e270 = point_8;
    cell_6 = vec3<i32>(floor(_e270));
    let _e274 = point_8;
    f_11 = fract(_e274);
    let _e277 = f_11;
    let _e278 = f_11;
    let _e280 = f_11;
    let _e282 = f_11;
    let _e283 = f_11;
    u_6 = (((_e277 * _e278) * _e280) * ((_e282 * ((_e283 * 6f) - vec3(15f))) + vec3(10f)));
    let _e296 = f_11;
    let _e298 = f_11;
    let _e300 = f_11;
    let _e301 = f_11;
    du_1 = (((30f * _e296) * _e298) * ((_e300 * (_e301 - vec3(2f))) + vec3(1f)));
    loop {
        let _e316 = k_12;
        if !((_e316 < 8i)) {
            break;
        }
        {
            let _e323 = k_12;
            let _e326 = k_12;
            let _e332 = k_12;
            corner = vec3<i32>((_e323 & 1i), ((_e326 >> 1u) & 1i), (_e332 >> 2u));
            let _e338 = cell_6;
            let _e339 = corner;
            let _e341 = seed_5;
            let _e342 = groundHash((_e338 + _e339), _e341);
            h_11 = _e342;
            let _e344 = h_11;
            let _e348 = h_11;
            let _e354 = h_11;
            g_4 = ((vec3<f32>(f32((_e344 & 1023u)), f32(((_e348 >> 10u) & 1023u)), f32(((_e354 >> 20u) & 1023u))) / vec3(511.5f)) - vec3(1f));
            let _e369 = u_6;
            let _e372 = u_6;
            let _e373 = corner;
            w_3 = mix((vec3(1f) - _e369), _e372, vec3<f32>(_e373));
            let _e377 = du_1;
            let _e379 = du_1;
            let _e380 = corner;
            d_9 = mix(-(_e377), _e379, vec3<f32>(_e380));
            let _e384 = g_4;
            let _e385 = f_11;
            let _e386 = corner;
            v_13 = dot(_e384, (_e385 - vec3<f32>(_e386)));
            let _e391 = n_6;
            let _e392 = v_13;
            let _e393 = w_3;
            let _e396 = w_3;
            let _e399 = w_3;
            let _e402 = g_4;
            let _e403 = w_3;
            let _e406 = w_3;
            let _e409 = w_3;
            let _e412 = v_13;
            let _e413 = d_9;
            let _e415 = w_3;
            let _e418 = w_3;
            let _e421 = w_3;
            let _e423 = d_9;
            let _e426 = w_3;
            let _e429 = w_3;
            let _e431 = w_3;
            let _e434 = d_9;
            let _e439 = ((((_e402 * _e403.x) * _e406.y) * _e409.z) + (_e412 * vec3<f32>(((_e413.x * _e415.y) * _e418.z), ((_e421.x * _e423.y) * _e426.z), ((_e429.x * _e431.y) * _e434.z))));
            n_6 = (_e391 + vec4<f32>((((_e392 * _e393.x) * _e396.y) * _e399.z), _e439.x, _e439.y, _e439.z));
        }
        continuing {
            let _e320 = k_12;
            k_12 = (_e320 + 1i);
        }
    }
    let _e445 = n_6;
    return (_e445 * 1.7f);
}

fn groundVisibility(wavelength_4: f32, footprint_8: f32) -> f32 {
    var wavelength_5: f32;
    var footprint_9: f32;
    var t_14: f32;

    wavelength_5 = wavelength_4;
    footprint_9 = footprint_8;
    let _e277 = footprint_9;
    let _e278 = wavelength_5;
    t_14 = clamp((((_e277 / _e278) - 0.18f) / 0.24f), 0f, 1f);
    let _e289 = t_14;
    let _e290 = t_14;
    let _e292 = t_14;
    let _e294 = t_14;
    let _e295 = t_14;
    return (1f - (((_e289 * _e290) * _e292) * ((_e294 * ((_e295 * 6f) - 15f)) + 10f)));
}

fn groundSlopeVariance(footprint_10: f32) -> f32 {
    var footprint_11: f32;
    var variance: f32 = 0f;
    var k_13: i32 = 0i;
    var local_127: array<f32, 4> = groundAmplitude;
    var local_128: array<f32, 4> = groundWavelength;
    var a_13: f32;
    var local_129: array<f32, 4> = groundWavelength;
    var local_130: array<f32, 4> = groundAspect;
    var local_131: array<f32, 4> = groundFilterWidth;
    var keep_3: f32;
    var local_132: array<f32, 4> = groundAspect;
    var local_133: array<f32, 4> = groundAspect;
    var local_134: array<f32, 4> = groundVarianceFactor;

    footprint_11 = footprint_10;
    loop {
        let _e279 = k_13;
        if !((_e279 < 4i)) {
            break;
        }
        {
            let _e286 = k_13;
            let _e290 = local_127[_e286];
            let _e291 = k_13;
            let _e295 = local_128[_e291];
            a_13 = (_e290 / _e295);
            let _e298 = k_13;
            let _e302 = local_129[_e298];
            let _e303 = k_13;
            let _e307 = local_130[_e303];
            let _e309 = k_13;
            let _e313 = local_131[_e309];
            let _e315 = footprint_11;
            let _e318 = groundVisibility(((_e302 * _e307) * _e313), max(_e315, 0f));
            keep_3 = _e318;
            let _e320 = variance;
            let _e321 = a_13;
            let _e322 = a_13;
            let _e326 = k_13;
            let _e330 = local_132[_e326];
            let _e331 = k_13;
            let _e335 = local_133[_e331];
            let _e340 = k_13;
            let _e344 = local_134[_e340];
            let _e347 = keep_3;
            let _e348 = keep_3;
            variance = (_e320 + ((((_e321 * _e322) * (1f + (1f / (_e330 * _e335)))) * _e344) * (1f - (_e347 * _e348))));
        }
        continuing {
            let _e283 = k_13;
            k_13 = (_e283 + 1i);
        }
    }
    let _e353 = variance;
    return _e353;
}

fn groundFieldWithClasts(point_9: vec3<f32>, seed_6: u32, footprint_12: f32, clasts: ptr<function, f32>) -> vec4<f32> {
    var point_10: vec3<f32>;
    var seed_7: u32;
    var footprint_13: f32;
    var sum_1: vec4<f32> = vec4(0f);
    var turn_1: i32;
    var k_14: i32 = 0i;
    var local_135: array<f32, 4> = groundWavelength;
    var wavelength_6: f32;
    var local_136: array<f32, 4> = groundAspect;
    var local_137: array<f32, 4> = groundFilterWidth;
    var keep_4: f32;
    var local_138: array<f32, 4> = groundRotationC;
    var c_15: f32;
    var local_139: array<f32, 4> = groundRotationS;
    var s_7: f32;
    var local_140: array<f32, 4> = groundAspect;
    var aspect_1: f32;
    var old: f32;
    var old_1: f32;
    var r_2: vec3<f32>;
    var cap_2: vec4<f32>;
    var g_5: vec2<f32>;
    var local_141: array<f32, 4> = groundAmplitude;
    var a_14: f32;
    var q_7: vec3<f32>;
    var n_7: vec4<f32>;
    var inverse_2: f32;
    var v_14: f32;
    var value_2: f32;
    var derivative: f32;
    var rounded: f32;
    var groove: f32;
    var local_142: array<f32, 4> = groundAmplitude;
    var a_15: f32;
    var d_10: f32;
    var g_6: vec3<f32>;

    point_10 = point_9;
    seed_7 = seed_6;
    footprint_13 = footprint_12;
    (*clasts) = 0f;
    let _e284 = seed_7;
    turn_1 = i32(((_e284 >> 29u) & 3u));
    let _e291 = global.uQuality;
    if (_e291 > 0i) {
        let _e294 = sum_1;
        return _e294;
    }
    loop {
        let _e297 = k_14;
        if !((_e297 < 4i)) {
            break;
        }
        {
            let _e304 = k_14;
            let _e308 = local_135[_e304];
            wavelength_6 = _e308;
            let _e310 = wavelength_6;
            let _e311 = k_14;
            let _e315 = local_136[_e311];
            let _e317 = k_14;
            let _e321 = local_137[_e317];
            let _e323 = footprint_13;
            let _e326 = groundVisibility(((_e310 * _e315) * _e321), max(_e323, 0f));
            keep_4 = _e326;
            let _e328 = keep_4;
            if (_e328 <= 0f) {
                continue;
            }
            let _e331 = k_14;
            let _e335 = local_138[_e331];
            c_15 = _e335;
            let _e337 = k_14;
            let _e341 = local_139[_e337];
            s_7 = _e341;
            let _e343 = k_14;
            let _e347 = local_140[_e343];
            aspect_1 = _e347;
            let _e349 = turn_1;
            if (_e349 == 1i) {
                {
                    let _e352 = c_15;
                    old = _e352;
                    let _e354 = s_7;
                    c_15 = -(_e354);
                    let _e356 = old;
                    s_7 = _e356;
                }
            } else {
                let _e357 = turn_1;
                if (_e357 == 2i) {
                    {
                        let _e360 = c_15;
                        c_15 = -(_e360);
                        let _e362 = s_7;
                        s_7 = -(_e362);
                    }
                } else {
                    let _e364 = turn_1;
                    if (_e364 == 3i) {
                        {
                            let _e367 = c_15;
                            old_1 = _e367;
                            let _e369 = s_7;
                            c_15 = _e369;
                            let _e370 = old_1;
                            s_7 = -(_e370);
                        }
                    }
                }
            }
            let _e372 = c_15;
            let _e373 = point_10;
            let _e376 = s_7;
            let _e377 = point_10;
            let _e381 = point_10;
            let _e383 = s_7;
            let _e385 = point_10;
            let _e388 = c_15;
            let _e389 = point_10;
            r_2 = vec3<f32>(((_e372 * _e373.x) + (_e376 * _e377.z)), _e381.y, ((-(_e383) * _e385.x) + (_e388 * _e389.z)));
            let _e395 = k_14;
            if (_e395 == 2i) {
                {
                    let _e398 = r_2;
                    let _e400 = wavelength_6;
                    let _e401 = wavelength_6;
                    let _e402 = aspect_1;
                    let _e406 = seed_7;
                    let _e407 = k_14;
                    let _e414 = groundGravel((_e398.xz / vec2<f32>(_e400, (_e401 * _e402))), (_e406 + (u32((_e407 + 1i)) * 1821285621u)));
                    cap_2 = _e414;
                    let _e416 = cap_2;
                    let _e418 = wavelength_6;
                    let _e419 = wavelength_6;
                    let _e420 = aspect_1;
                    g_5 = (_e416.yw / vec2<f32>(_e418, (_e419 * _e420)));
                    let _e425 = k_14;
                    let _e429 = local_141[_e425];
                    let _e430 = keep_4;
                    let _e432 = surfaceGroundClasts;
                    a_14 = ((_e429 * _e430) * _e432);
                    let _e435 = sum_1;
                    let _e436 = cap_2;
                    let _e440 = a_14;
                    let _e442 = c_15;
                    let _e443 = g_5;
                    let _e446 = s_7;
                    let _e447 = g_5;
                    let _e451 = a_14;
                    let _e454 = s_7;
                    let _e455 = g_5;
                    let _e458 = c_15;
                    let _e459 = g_5;
                    let _e463 = a_14;
                    sum_1 = (_e435 + vec4<f32>(((_e436.x - 0.1f) * _e440), (((_e442 * _e443.x) - (_e446 * _e447.y)) * _e451), 0f, (((_e454 * _e455.x) + (_e458 * _e459.y)) * _e463)));
                    let _e467 = cap_2;
                    let _e469 = keep_4;
                    let _e471 = surfaceGroundClasts;
                    (*clasts) = ((_e467.x * _e469) * _e471);
                    continue;
                }
            }
            let _e473 = r_2;
            let _e480 = r_2;
            let _e486 = aspect_1;
            let _e488 = r_2;
            let _e496 = wavelength_6;
            q_7 = (vec3<f32>(dot(_e473, vec3<f32>(0.36f, -0.8f, 0.48f)), (dot(_e480, vec3<f32>(0.48f, 0.6f, 0.64f)) / _e486), dot(_e488, vec3<f32>(-0.8f, 0f, 0.6f))) / vec3(_e496));
            let _e500 = q_7;
            let _e506 = k_14;
            q_7 = (_e500 + (vec3<f32>(17.137f, 3.731f, -11.517f) + (f32(_e506) * vec3<f32>(9.173f, -5.731f, 7.337f))));
            let _e516 = q_7;
            let _e517 = seed_7;
            let _e518 = k_14;
            let _e525 = groundNoise(_e516, (_e517 + (u32((_e518 + 1i)) * 1821285621u)));
            n_7 = _e525;
            let _e528 = n_7;
            let _e530 = n_7;
            inverse_2 = inverseSqrt((1f + (_e528.x * _e530.x)));
            let _e537 = n_7;
            let _e540 = inverse_2;
            v_14 = ((0.72f * _e537.x) * _e540);
            let _e543 = v_14;
            value_2 = _e543;
            derivative = 1f;
            let _e547 = k_14;
            if (_e547 == 0i) {
                {
                    let _e550 = v_14;
                    let _e551 = v_14;
                    rounded = sqrt(((_e550 * _e551) + 0.02f));
                    let _e558 = v_14;
                    let _e561 = rounded;
                    let _e563 = surfaceFineBreak;
                    value_2 = mix((0.5f * _e558), (0.3f - _e561), _e563);
                    let _e566 = v_14;
                    let _e568 = rounded;
                    let _e570 = surfaceFineBreak;
                    derivative = mix(0.5f, (-(_e566) / _e568), _e570);
                }
            } else {
                let _e572 = k_14;
                if (_e572 == 1i) {
                    {
                        let _e577 = v_14;
                        let _e579 = v_14;
                        groove = exp2(((-32f * _e577) * _e579));
                        let _e584 = v_14;
                        let _e587 = groove;
                        let _e589 = surfaceFineBreak;
                        value_2 = mix((0.5f * _e584), (0.4f - _e587), _e589);
                        let _e593 = v_14;
                        let _e595 = groove;
                        let _e597 = surfaceFineBreak;
                        derivative = mix(0.5f, ((44.36142f * _e593) * _e595), _e597);
                    }
                }
            }
            let _e599 = k_14;
            let _e603 = local_142[_e599];
            let _e604 = keep_4;
            a_15 = (_e603 * _e604);
            let _e607 = a_15;
            let _e608 = derivative;
            let _e612 = inverse_2;
            let _e614 = inverse_2;
            let _e616 = inverse_2;
            let _e618 = wavelength_6;
            d_10 = ((((((_e607 * _e608) * 0.72f) * _e612) * _e614) * _e616) / _e618);
            let _e622 = n_7;
            let _e626 = n_7;
            let _e629 = aspect_1;
            let _e633 = n_7;
            let _e639 = n_7;
            let _e643 = n_7;
            let _e646 = aspect_1;
            let _e650 = n_7;
            let _e654 = n_7;
            let _e657 = aspect_1;
            let _e661 = n_7;
            g_6 = vec3<f32>((((0.36f * _e622.y) + ((0.48f * _e626.z) / _e629)) - (0.8f * _e633.w)), ((-0.8f * _e639.y) + ((0.6f * _e643.z) / _e646)), (((0.48f * _e650.y) + ((0.64f * _e654.z) / _e657)) + (0.6f * _e661.w)));
            let _e667 = sum_1;
            let _e668 = value_2;
            let _e669 = a_15;
            let _e671 = c_15;
            let _e672 = g_6;
            let _e675 = s_7;
            let _e676 = g_6;
            let _e680 = g_6;
            let _e682 = s_7;
            let _e683 = g_6;
            let _e686 = c_15;
            let _e687 = g_6;
            let _e692 = d_10;
            let _e693 = (vec3<f32>(((_e671 * _e672.x) - (_e675 * _e676.z)), _e680.y, ((_e682 * _e683.x) + (_e686 * _e687.z))) * _e692);
            sum_1 = (_e667 + vec4<f32>((_e668 * _e669), _e693.x, _e693.y, _e693.z));
        }
        continuing {
            let _e301 = k_14;
            k_14 = (_e301 + 1i);
        }
    }
    let _e699 = sum_1;
    let _e700 = surfaceGroundDry;
    return (_e699 * _e700);
}

fn groundField(point_11: vec3<f32>, seed_8: u32, footprint_14: f32) -> vec4<f32> {
    var point_12: vec3<f32>;
    var seed_9: u32;
    var footprint_15: f32;
    var slope_5: vec2<f32>;
    var clasts_1: f32;

    point_12 = point_11;
    seed_9 = seed_8;
    footprint_15 = footprint_14;
    let _e279 = surfaceMicroSlope;
    let _e280 = surfaceGroundSlope;
    let _e282 = surfaceGroundNormalGain;
    slope_5 = (_e279 + (_e280 * ((1f / max(_e282, 0.008f)) - 1f)));
    let _e292 = point_12;
    let _e293 = seed_9;
    let _e294 = footprint_15;
    let _e297 = groundFieldWithClasts(_e292, _e293, _e294, (&clasts_1));
    let _e299 = slope_5;
    let _e302 = slope_5;
    return (_e297 + vec4<f32>(0f, _e299.x, 0f, _e302.y));
}

fn groundCover(macro_: vec3<f32>, climate: vec2<f32>) -> vec4<f32> {
    var macro_1: vec3<f32>;
    var climate_1: vec2<f32>;
    var grade_3: f32;
    var temperature_1: f32;
    var wet: f32;
    var snow_2: f32;
    var exposed_1: f32;
    var rock_5: f32;
    var growth: f32;
    var grass_5: f32;
    var soil_4: f32;

    macro_1 = macro_;
    climate_1 = climate;
    let _e277 = macro_1;
    grade_3 = length(_e277.yz);
    let _e281 = climate_1;
    let _e284 = macro_1;
    temperature_1 = (_e281.x - (0.0065f * max(_e284.x, 0f)));
    let _e293 = climate_1;
    let _e295 = groundSmooth(250f, 1400f, _e293.y);
    wet = _e295;
    let _e301 = temperature_1;
    let _e302 = groundSmooth(-5f, 1f, _e301);
    let _e307 = grade_3;
    let _e308 = groundSmooth(0.55f, 1.3f, _e307);
    snow_2 = ((1f - _e302) * (1f - _e308));
    let _e313 = snow_2;
    exposed_1 = (1f - _e313);
    let _e318 = grade_3;
    let _e319 = groundSmooth(0.25f, 0.9f, _e318);
    let _e320 = exposed_1;
    rock_5 = (_e319 * _e320);
    let _e326 = temperature_1;
    let _e327 = groundSmooth(-8f, 4f, _e326);
    let _e331 = temperature_1;
    let _e332 = groundSmooth(28f, 42f, _e331);
    growth = (_e327 * (1f - _e332));
    let _e336 = wet;
    let _e337 = growth;
    let _e339 = exposed_1;
    let _e340 = rock_5;
    grass_5 = ((_e336 * _e337) * (_e339 - _e340));
    let _e344 = exposed_1;
    let _e345 = rock_5;
    let _e347 = grass_5;
    soil_4 = ((_e344 - _e345) - _e347);
    let _e350 = rock_5;
    let _e351 = soil_4;
    let _e352 = grass_5;
    let _e353 = snow_2;
    return vec4<f32>(_e350, _e351, _e352, _e353);
}

fn groundGain(macro_2: vec3<f32>, cover_1: vec4<f32>) -> f32 {
    var macro_3: vec3<f32>;
    var cover_2: vec4<f32>;

    macro_3 = macro_2;
    cover_2 = cover_1;
    let _e279 = macro_3;
    let _e282 = groundSmooth(0.025f, 0.18f, length(_e279.yz));
    let _e285 = macro_3;
    let _e287 = groundSmooth(0f, 2f, _e285.x);
    let _e289 = cover_2;
    return ((_e282 * _e287) * dot(_e289, vec4<f32>(1f, 0.16f, 0.045f, 0.018f)));
}

fn groundDisplacement(macro_4: vec3<f32>, world_27: vec2<f32>, footprint_16: f32, climate_2: vec2<f32>, seed_10: u32) -> vec3<f32> {
    var macro_5: vec3<f32>;
    var world_28: vec2<f32>;
    var footprint_17: f32;
    var climate_3: vec2<f32>;
    var seed_11: u32;
    var cover_3: vec4<f32>;
    var detail_1: vec4<f32>;

    macro_5 = macro_4;
    world_28 = world_27;
    footprint_17 = footprint_16;
    climate_3 = climate_2;
    seed_11 = seed_10;
    let _e283 = macro_5;
    let _e284 = climate_3;
    let _e285 = groundCover(_e283, _e284);
    cover_3 = _e285;
    let _e287 = world_28;
    let _e290 = world_28;
    let _e293 = seed_11;
    let _e294 = footprint_17;
    let _e295 = groundField(vec3<f32>(_e287.x, 0f, _e290.y), _e293, _e294);
    detail_1 = _e295;
    let _e297 = detail_1;
    let _e299 = detail_1;
    let _e301 = detail_1;
    let _e304 = macro_5;
    let _e305 = cover_3;
    let _e306 = groundGain(_e304, _e305);
    return (vec3<f32>(_e297.x, _e299.y, _e301.w) * _e306);
}

fn terrainGroundMaterial(macro_6: vec3<f32>, world_29: vec2<f32>, footprint_18: f32, macroColor: vec3<f32>, climate_4: vec2<f32>, seed_12: u32, meshFootprint: f32) -> GroundMaterial {
    var macro_7: vec3<f32>;
    var world_30: vec2<f32>;
    var footprint_19: f32;
    var macroColor_1: vec3<f32>;
    var climate_5: vec2<f32>;
    var seed_13: u32;
    var meshFootprint_1: f32;
    var fp_12: f32;
    var cover_4: vec4<f32>;
    var gain: f32;
    var micro: vec3<f32>;
    var clasts_2: f32;
    var meshClasts: f32;
    var detail_2: vec4<f32>;
    var gradient_4: vec2<f32>;
    var m: GroundMaterial;
    var form: f32;
    var cavity: f32;
    var rock_6: vec3<f32>;
    var soil_5: vec3<f32>;
    var grass_6: vec3<f32>;
    var snow_3: vec3<f32>;
    var color_8: vec3<f32>;
    var cap_3: f32;
    var wet_1: f32;
    var roughness: f32;
    var alpha2_: f32;

    macro_7 = macro_6;
    world_30 = world_29;
    footprint_19 = footprint_18;
    macroColor_1 = macroColor;
    climate_5 = climate_4;
    seed_13 = seed_12;
    meshFootprint_1 = meshFootprint;
    let _e288 = footprint_19;
    fp_12 = max(0f, _e288);
    let _e291 = macro_7;
    let _e292 = climate_5;
    let _e293 = groundCover(_e291, _e292);
    cover_4 = _e293;
    let _e295 = macro_7;
    let _e296 = cover_4;
    let _e297 = groundGain(_e295, _e296);
    gain = _e297;
    let _e299 = world_30;
    let _e300 = macro_7;
    let _e303 = fp_12;
    let _e304 = cover_4;
    let _e306 = cover_4;
    let _e308 = seed_13;
    let _e309 = surfaceMicro(_e299, length(_e300.yz), _e303, _e304.x, _e306.z, _e308);
    micro = _e309;
    let _e313 = world_30;
    let _e316 = world_30;
    let _e319 = seed_13;
    let _e320 = fp_12;
    let _e323 = groundFieldWithClasts(vec3<f32>(_e313.x, 0f, _e316.y), _e319, _e320, (&clasts_2));
    detail_2 = _e323;
    let _e325 = detail_2;
    let _e327 = surfaceMicroSlope;
    let _e329 = gain;
    let _e331 = surfaceGroundSlope;
    let _e333 = gain;
    gradient_4 = (((_e325.yw + _e327) * _e329) + (_e331 * (1f - _e333)));
    let _e338 = meshFootprint_1;
    if (_e338 > 0f) {
        let _e341 = gradient_4;
        let _e342 = world_30;
        let _e345 = world_30;
        let _e348 = seed_13;
        let _e349 = meshFootprint_1;
        let _e352 = groundFieldWithClasts(vec3<f32>(_e342.x, 0f, _e345.y), _e348, _e349, (&meshClasts));
        let _e354 = gain;
        gradient_4 = (_e341 - (_e352.yw * _e354));
    }
    let _e359 = macro_7;
    let _e362 = gradient_4;
    let _e366 = macro_7;
    let _e369 = gradient_4;
    m.normal = normalize(vec3<f32>((-(_e359.y) - _e362.x), 1f, (-(_e366.z) - _e369.y)));
    let _e374 = detail_2;
    form = clamp((_e374.x * 18f), -1f, 1f);
    let _e383 = detail_2;
    let _e391 = cover_4;
    cavity = (clamp((-(_e383.x) * 20f), 0f, 1f) * _e391.x);
    let _e395 = macroColor_1;
    let _e396 = surfaceRockTone;
    rock_6 = mix(_e395, _e396, vec3(0.7f));
    let _e401 = macroColor_1;
    let _e402 = surfaceSoilTone;
    soil_5 = mix(_e401, _e402, vec3(0.18f));
    let _e407 = macroColor_1;
    grass_6 = (_e407 * vec3<f32>(0.96f, 1.02f, 0.93f));
    let _e414 = macroColor_1;
    snow_3 = mix(_e414, vec3<f32>(0.87f, 0.91f, 0.95f), vec3(0.35f));
    let _e423 = rock_6;
    let _e424 = cover_4;
    let _e427 = soil_5;
    let _e428 = cover_4;
    let _e432 = grass_6;
    let _e433 = cover_4;
    let _e437 = snow_3;
    let _e438 = cover_4;
    color_8 = ((((_e423 * _e424.x) + (_e427 * _e428.y)) + (_e432 * _e433.z)) + (_e437 * _e438.w));
    let _e443 = color_8;
    let _e445 = form;
    let _e446 = cover_4;
    color_8 = (_e443 * (1f + (_e445 * dot(_e446, vec4<f32>(0.12f, 0.055f, 0.045f, 0.012f)))));
    let _e458 = clasts_2;
    let _e459 = groundSmooth(0.05f, 0.7f, _e458);
    cap_3 = _e459;
    let _e461 = color_8;
    let _e463 = cap_3;
    let _e466 = cover_4;
    color_8 = (_e461 * (1f + ((_e463 * 0.12f) * _e466.x)));
    let _e471 = color_8;
    let _e472 = micro;
    let _e474 = cavity;
    color_8 = (_e471 * (_e472 * (1f - (_e474 * 0.11f))));
    let _e482 = climate_5;
    let _e484 = groundSmooth(500f, 1800f, _e482.y);
    let _e486 = cover_4;
    wet_1 = (_e484 * (1f - _e486.w));
    let _e491 = cover_4;
    roughness = dot(_e491, vec4<f32>(0.52f, 0.83f, 0.91f, 0.76f));
    let _e499 = roughness;
    let _e500 = wet_1;
    let _e502 = cover_4;
    let _e506 = cavity;
    roughness = (_e499 - (_e500 * ((0.08f * _e502.y) + (0.1f * _e506))));
    let _e511 = roughness;
    let _e512 = form;
    let _e515 = cap_3;
    let _e519 = cover_4;
    roughness = (_e511 + (((_e512 * 0.025f) - (_e515 * 0.055f)) * _e519.x));
    let _e523 = roughness;
    let _e529 = gain;
    let _e530 = gain;
    let _e532 = fp_12;
    let _e533 = groundSlopeVariance(_e532);
    alpha2_ = (pow(clamp(_e523, 0.38f, 0.98f), 4f) + ((_e529 * _e530) * _e533));
    let _e538 = color_8;
    let _e544 = groundToLinear(clamp(_e538, vec3(0.015f), vec3(0.96f)));
    m.albedo = _e544;
    let _e546 = alpha2_;
    m.roughness = clamp(pow(_e546, 0.25f), 0.38f, 0.98f);
    let _e555 = cavity;
    let _e559 = form;
    let _e564 = cover_4;
    m.occlusion = clamp(((1f - (0.22f * _e555)) - ((0.04f * max(-(_e559), 0f)) * _e564.y)), 0.72f, 1f);
    let _e571 = m;
    return _e571;
}

fn terrainGroundMaterial_1(macro_8: vec3<f32>, world_31: vec2<f32>, footprint_20: f32, macroColor_2: vec3<f32>, climate_6: vec2<f32>, seed_14: u32) -> GroundMaterial {
    var macro_9: vec3<f32>;
    var world_32: vec2<f32>;
    var footprint_21: f32;
    var macroColor_3: vec3<f32>;
    var climate_7: vec2<f32>;
    var seed_15: u32;

    macro_9 = macro_8;
    world_32 = world_31;
    footprint_21 = footprint_20;
    macroColor_3 = macroColor_2;
    climate_7 = climate_6;
    seed_15 = seed_14;
    let _e285 = macro_9;
    let _e286 = world_32;
    let _e287 = footprint_21;
    let _e288 = macroColor_3;
    let _e289 = climate_7;
    let _e290 = seed_15;
    let _e292 = terrainGroundMaterial(_e285, _e286, _e287, _e288, _e289, _e290, 0f);
    return _e292;
}

fn groundBrdf(m_1: GroundMaterial, view: vec3<f32>, light_1: vec3<f32>) -> vec3<f32> {
    var m_2: GroundMaterial;
    var view_1: vec3<f32>;
    var light_2: vec3<f32>;
    var n_8: vec3<f32>;
    var v_15: vec3<f32>;
    var l: vec3<f32>;
    var halfVector: vec3<f32>;
    var nv: f32;
    var nl: f32;
    var nh: f32;
    var vh: f32;
    var a_16: f32;
    var a2_: f32;
    var denominator: f32;
    var distribution: f32;
    var visibility: f32;
    var fresnel: f32;

    m_2 = m_1;
    view_1 = view;
    light_2 = light_1;
    let _e279 = m_2;
    n_8 = _e279.normal;
    let _e282 = view_1;
    v_15 = normalize(_e282);
    let _e285 = light_2;
    l = normalize(_e285);
    let _e288 = v_15;
    let _e289 = l;
    halfVector = normalize((_e288 + _e289));
    let _e293 = n_8;
    let _e294 = v_15;
    nv = max(dot(_e293, _e294), 0.001f);
    let _e299 = n_8;
    let _e300 = l;
    nl = max(dot(_e299, _e300), 0f);
    let _e305 = n_8;
    let _e306 = halfVector;
    nh = max(dot(_e305, _e306), 0f);
    let _e311 = v_15;
    let _e312 = halfVector;
    vh = max(dot(_e311, _e312), 0f);
    let _e317 = m_2;
    let _e319 = m_2;
    a_16 = (_e317.roughness * _e319.roughness);
    let _e323 = a_16;
    let _e324 = a_16;
    a2_ = (_e323 * _e324);
    let _e327 = nh;
    let _e328 = nh;
    let _e330 = a2_;
    denominator = (((_e327 * _e328) * (_e330 - 1f)) + 1f);
    let _e337 = a2_;
    let _e339 = denominator;
    let _e341 = denominator;
    distribution = (_e337 / ((3.1415927f * _e339) * _e341));
    let _e346 = nl;
    let _e347 = nv;
    let _e348 = nv;
    let _e351 = a2_;
    let _e354 = a2_;
    let _e358 = nv;
    let _e359 = nl;
    let _e360 = nl;
    let _e363 = a2_;
    let _e366 = a2_;
    visibility = (0.5f / max(((_e346 * sqrt((((_e347 * _e348) * (1f - _e351)) + _e354))) + (_e358 * sqrt((((_e359 * _e360) * (1f - _e363)) + _e366)))), 0.001f));
    let _e378 = vh;
    fresnel = (0.04f + (0.96f * pow((1f - _e378), 5f)));
    let _e386 = fresnel;
    let _e388 = m_2;
    let _e394 = distribution;
    let _e395 = visibility;
    let _e397 = fresnel;
    let _e401 = nl;
    return (((((1f - _e386) * _e388.albedo) / vec3(3.1415927f)) + vec3(((_e394 * _e395) * _e397))) * _e401);
}

fn shadeTerrainGround(m_3: GroundMaterial, view_2: vec3<f32>, light_3: vec3<f32>, light2_: vec3<f32>, strength: f32) -> vec3<f32> {
    var m_4: GroundMaterial;
    var view_3: vec3<f32>;
    var light_4: vec3<f32>;
    var light2_1: vec3<f32>;
    var strength_1: f32;
    var sky: f32;
    var sun_1: f32;
    var form_1: f32;
    var diffuse: f32;
    var amount_5: f32;
    var ambient: vec3<f32>;
    var direct: vec3<f32>;

    m_4 = m_3;
    view_3 = view_2;
    light_4 = light_3;
    light2_1 = light2_;
    strength_1 = strength;
    let _e284 = groundReliefLight;
    sky = _e284.x;
    let _e287 = groundReliefLight;
    sun_1 = _e287.y;
    let _e290 = groundReliefLight;
    form_1 = _e290.z;
    let _e293 = global.uQuality;
    if (_e293 > 0i) {
        {
            let _e296 = m_4;
            let _e298 = light_4;
            let _e303 = sun_1;
            diffuse = (max(dot(_e296.normal, normalize(_e298)), 0f) * _e303);
            let _e306 = m_4;
            let _e310 = m_4;
            let _e313 = sky;
            let _e316 = diffuse;
            let _e319 = form_1;
            let _e321 = strength_1;
            let _e327 = groundToDisplay((_e306.albedo * mix(1f, ((((0.5f * _e310.occlusion) * _e313) + (0.75f * _e316)) * _e319), clamp(_e321, 0f, 1f))));
            return _e327;
        }
    }
    let _e328 = strength_1;
    amount_5 = clamp(_e328, 0f, 1f);
    let _e333 = m_4;
    let _e337 = m_4;
    let _e346 = m_4;
    let _e349 = sky;
    let _e357 = sun_1;
    ambient = ((((_e333.albedo * (0.34f + (0.16f * clamp(_e337.normal.y, 0f, 1f)))) * _e346.occlusion) * _e349) * mix(vec3<f32>(0.9f, 0.98f, 1.14f), vec3(1f), vec3(_e357)));
    let _e362 = m_4;
    let _e363 = view_3;
    let _e364 = light_4;
    let _e365 = groundBrdf(_e362, _e363, _e364);
    let _e367 = sun_1;
    let _e370 = m_4;
    let _e371 = view_3;
    let _e372 = light2_1;
    let _e373 = groundBrdf(_e370, _e371, _e372);
    let _e377 = sky;
    direct = ((_e365 * (2.2f * _e367)) + (_e373 * (0.58f * (0.5f + (0.5f * _e377)))));
    let _e384 = m_4;
    let _e386 = ambient;
    let _e387 = form_1;
    let _e389 = amount_5;
    let _e392 = direct;
    let _e393 = form_1;
    let _e394 = strength_1;
    let _e400 = groundToDisplay((mix(_e384.albedo, (_e386 * _e387), vec3(_e389)) + (_e392 * (_e393 * max(_e394, 0f)))));
    return _e400;
}

fn landDetailSample(uv_8: vec2<f32>, lod: f32) -> vec4<f32> {
    var uv_9: vec2<f32>;
    var lod_1: f32;

    uv_9 = uv_8;
    lod_1 = lod;
    let _e279 = uv_9;
    let _e280 = lod_1;
    let _e281 = textureSampleLevel(uLandDetail, sLinear, _e279, _e280);
    return _e281;
}

fn orchardDetail(world_33: vec2<f32>) -> vec4<f32> {
    var world_34: vec2<f32>;
    var uv_10: vec2<f32>;

    world_34 = world_33;
    let _e277 = global.uHasLandDetail;
    if (_e277 == 0i) {
        return vec4<f32>(0f, 1f, 0.5f, 1f);
    }
    let _e285 = world_34;
    let _e286 = global.uLandDetailRect;
    let _e289 = global.uLandDetailRect;
    uv_10 = ((_e285 - _e286.xy) / vec2(_e289.z));
    let _e294 = uv_10;
    let _e295 = global.uLandDetailN;
    let _e300 = global.uLandDetailN;
    let _e308 = global.uLandDetailN;
    uv_10 = ((clamp(floor((_e294 * _e295)), vec2(0f), vec2((_e300 - 1f))) + vec2(0.5f)) / vec2(_e308));
    let _e311 = uv_10;
    let _e313 = landDetailSample(_e311, 0f);
    return _e313;
}

fn landDetailRange() -> f32 {
    let _e277 = global.uLandDetailRect;
    let _e280 = global.uLandDetailN;
    return max(6f, ((2.5f * _e277.z) / _e280));
}

fn landDetailDist(a_17: f32) -> f32 {
    var a_18: f32;

    a_18 = a_17;
    let _e277 = a_18;
    let _e282 = landDetailRange();
    return (((_e277 * 2f) - 1f) * _e282);
}

fn orchardRows(world_35: vec2<f32>) -> vec2<f32> {
    var world_36: vec2<f32>;
    var d_11: vec4<f32>;
    var c_16: vec2<f32>;
    var a_19: f32;

    world_36 = world_35;
    let _e278 = world_36;
    let _e279 = orchardDetail(_e278);
    d_11 = _e279;
    let _e281 = d_11;
    c_16 = ((_e281.yz * 2f) - vec2(1f));
    let _e290 = c_16;
    let _e292 = c_16;
    a_19 = (0.5f * atan2(_e290.y, _e292.x));
    let _e297 = a_19;
    let _e299 = a_19;
    return vec2<f32>(cos(_e297), sin(_e299));
}

fn forestCrownSetback(radius_4: f32, u_7: f32) -> f32 {
    var radius_5: f32;
    var u_8: f32;

    radius_5 = radius_4;
    u_8 = u_7;
    let _e282 = u_8;
    let _e285 = radius_5;
    return ((0.7f + (0.3f * _e282)) * _e285);
}

fn groundOccupation(world_37: vec2<f32>) -> vec3<f32> {
    var world_38: vec2<f32>;
    var uv_11: vec2<f32>;
    var dist: vec2<f32>;
    var cls_1: f32;

    world_38 = world_37;
    let _e281 = groundOccupationCached;
    let _e282 = world_38;
    let _e283 = groundOccupationPoint;
    if (_e281 && all((_e282 == _e283))) {
        let _e287 = groundOccupationSample;
        return _e287;
    }
    let _e288 = global.uHasOccupation;
    if (_e288 == 0i) {
        return vec3<f32>(-1000f, -1000f, 0f);
    }
    let _e297 = world_38;
    let _e298 = global.uOccupationRect;
    let _e301 = global.uOccupationRect;
    uv_11 = ((_e297 - _e298.xy) / vec2(_e301.z));
    let _e306 = uv_11;
    let _e311 = uv_11;
    if (any((_e306 < vec2(0f))) || any((_e311 > vec2(1f)))) {
        return vec3<f32>(-1000f, -1000f, 0f);
    }
    let _e323 = uv_11;
    let _e325 = textureSampleLevel(uOccupation, sLinear, _e323, 0f);
    let _e335 = global.uOccupationRect;
    let _e337 = global.uOccupationN;
    dist = ((((_e325.xy * 255f) - vec2(128f)) / vec2(16f)) * (_e335.z / _e337));
    let _e341 = uv_11;
    let _e342 = global.uOccupationN;
    let _e347 = global.uOccupationN;
    let _e354 = textureLoad(uOccupation, clamp(vec2<i32>((_e341 * _e342)), vec2(0i), vec2((i32(_e347) - 1i))), 0i);
    cls_1 = (_e354.z * 255f);
    groundOccupationCached = true;
    let _e360 = world_38;
    groundOccupationPoint = _e360;
    let _e361 = dist;
    let _e362 = cls_1;
    groundOccupationSample = vec3<f32>(_e361.x, _e361.y, floor((_e362 + 0.5f)));
    let _e369 = groundOccupationSample;
    return _e369;
}

fn forestLookup17_(x_5: f32, table: i32) -> f32 {
    var x_6: f32;
    var table_1: i32;
    var u_9: f32;
    var k_15: i32;
    var local_143: array<f32, 17> = forestPatchCdf;
    var local_144: array<f32, 17> = forestCrownCdf;
    var local_145: f32;
    var a_20: f32;
    var local_146: array<f32, 17> = forestPatchCdf;
    var local_147: array<f32, 17> = forestCrownCdf;
    var local_148: f32;
    var b_13: f32;

    x_6 = x_5;
    table_1 = table;
    let _e292 = x_6;
    u_9 = (clamp(_e292, 0f, 1f) * 16f);
    let _e299 = u_9;
    k_15 = min(i32(_e299), 15i);
    let _e304 = table_1;
    if (_e304 == 0i) {
        let _e307 = k_15;
        let _e311 = local_143[_e307];
        local_145 = _e311;
    } else {
        let _e312 = k_15;
        let _e316 = local_144[_e312];
        local_145 = _e316;
    }
    let _e318 = local_145;
    a_20 = _e318;
    let _e320 = table_1;
    if (_e320 == 0i) {
        let _e323 = k_15;
        let _e329 = local_146[(_e323 + 1i)];
        local_148 = _e329;
    } else {
        let _e330 = k_15;
        let _e336 = local_147[(_e330 + 1i)];
        local_148 = _e336;
    }
    let _e338 = local_148;
    b_13 = _e338;
    let _e340 = a_20;
    let _e341 = b_13;
    let _e342 = u_9;
    let _e343 = k_15;
    return mix(_e340, _e341, (_e342 - f32(_e343)));
}

fn forestTau(d_12: f32) -> f32 {
    var d_13: f32;
    var u_10: f32;
    var k_16: i32;
    var local_149: array<f32, 33> = forestTauTable;
    var local_150: array<f32, 33> = forestTauTable;

    d_13 = d_12;
    let _e290 = d_13;
    u_10 = (clamp(_e290, 0f, 0.985f) * 32f);
    let _e297 = u_10;
    k_16 = min(i32(_e297), 31i);
    let _e302 = k_16;
    let _e306 = local_149[_e302];
    let _e307 = k_16;
    let _e313 = local_150[(_e307 + 1i)];
    let _e314 = u_10;
    let _e315 = k_16;
    return mix(_e306, _e313, (_e314 - f32(_e315)));
}

fn forestRho(tau: f32) -> f32 {
    var tau_1: f32;

    tau_1 = tau;
    let _e293 = tau_1;
    return (0.5f + (0.4f * max(0f, ((_e293 - 0.55f) / 0.45f))));
}

fn forestU8_(h_12: u32, shift: u32) -> f32 {
    var h_13: u32;
    var shift_1: u32;

    h_13 = h_12;
    shift_1 = shift;
    let _e292 = h_13;
    let _e293 = shift_1;
    return ((f32(((_e292 >> _e293) & 255u)) + 0.5f) / 256f);
}

fn forestGradient(c_17: vec2<i32>) -> vec2<f32> {
    var c_18: vec2<i32>;
    var h_14: u32;

    c_18 = c_17;
    let _e290 = c_18;
    let _e295 = global.uMaterialSeed;
    let _e298 = groundHash(vec3<i32>(_e290.x, _e290.y, 991i), (_e295 ^ 1779033703u));
    h_14 = _e298;
    let _e300 = h_14;
    let _e304 = h_14;
    return ((vec2<f32>(f32((_e300 & 255u)), f32(((_e304 >> 8u) & 255u))) * 0.0078125f) + vec2(-0.99609375f));
}

fn forestPerlin(f_12: vec2<f32>, g00_: vec2<f32>, g10_: vec2<f32>, g01_: vec2<f32>, g11_: vec2<f32>) -> vec3<f32> {
    var f_13: vec2<f32>;
    var g00_1: vec2<f32>;
    var g10_1: vec2<f32>;
    var g01_1: vec2<f32>;
    var g11_1: vec2<f32>;
    var n00_: f32;
    var n10_: f32;
    var n01_: f32;
    var n11_: f32;
    var k_17: f32;
    var u_11: vec2<f32>;
    var du_2: vec2<f32>;
    var g_7: vec2<f32>;

    f_13 = f_12;
    g00_1 = g00_;
    g10_1 = g10_;
    g01_1 = g01_;
    g11_1 = g11_;
    let _e298 = g00_1;
    let _e299 = f_13;
    n00_ = dot(_e298, _e299);
    let _e302 = g10_1;
    let _e303 = f_13;
    n10_ = dot(_e302, (_e303 - vec2<f32>(1f, 0f)));
    let _e310 = g01_1;
    let _e311 = f_13;
    n01_ = dot(_e310, (_e311 - vec2<f32>(0f, 1f)));
    let _e318 = g11_1;
    let _e319 = f_13;
    n11_ = dot(_e318, (_e319 - vec2(1f)));
    let _e325 = n00_;
    let _e326 = n10_;
    let _e328 = n01_;
    let _e330 = n11_;
    k_17 = (((_e325 - _e326) - _e328) + _e330);
    let _e333 = f_13;
    let _e334 = f_13;
    let _e336 = f_13;
    let _e338 = f_13;
    let _e339 = f_13;
    u_11 = (((_e333 * _e334) * _e336) * ((_e338 * ((_e339 * 6f) - vec2(15f))) + vec2(10f)));
    let _e352 = f_13;
    let _e354 = f_13;
    let _e356 = f_13;
    let _e357 = f_13;
    du_2 = (((30f * _e352) * _e354) * ((_e356 * (_e357 - vec2(2f))) + vec2(1f)));
    let _e367 = g00_1;
    let _e368 = u_11;
    let _e370 = g10_1;
    let _e371 = g00_1;
    let _e375 = u_11;
    let _e377 = g01_1;
    let _e378 = g00_1;
    let _e382 = u_11;
    let _e384 = u_11;
    let _e387 = g00_1;
    let _e388 = g10_1;
    let _e390 = g01_1;
    let _e392 = g11_1;
    let _e396 = du_2;
    let _e397 = n10_;
    let _e398 = n00_;
    let _e400 = u_11;
    let _e402 = k_17;
    let _e405 = n01_;
    let _e406 = n00_;
    let _e408 = u_11;
    let _e410 = k_17;
    g_7 = ((((_e367 + (_e368.x * (_e370 - _e371))) + (_e375.y * (_e377 - _e378))) + ((_e382.x * _e384.y) * (((_e387 - _e388) - _e390) + _e392))) + (_e396 * vec2<f32>(((_e397 - _e398) + (_e400.y * _e402)), ((_e405 - _e406) + (_e408.x * _e410)))));
    let _e417 = n00_;
    let _e418 = u_11;
    let _e420 = n10_;
    let _e421 = n00_;
    let _e425 = u_11;
    let _e427 = n01_;
    let _e428 = n00_;
    let _e432 = u_11;
    let _e434 = u_11;
    let _e437 = k_17;
    let _e440 = g_7;
    return vec3<f32>((((_e417 + (_e418.x * (_e420 - _e421))) + (_e425.y * (_e427 - _e428))) + ((_e432.x * _e434.y) * _e437)), _e440.x, _e440.y);
}

fn forestGlade(p_22: vec2<f32>) -> vec3<f32> {
    var p_23: vec2<f32>;
    var g_8: vec2<f32>;
    var c_19: vec2<i32>;
    var o_2: vec2<i32> = vec2<i32>(7919i, -4421i);
    var n_9: vec3<f32>;

    p_23 = p_22;
    let _e292 = p_23;
    g_8 = (((FOREST_GLADE_FRAME * _e292) / vec2(210f)) + vec2<f32>(43.1f, -17.7f));
    let _e303 = g_8;
    c_19 = vec2<i32>(floor(_e303));
    let _e312 = g_8;
    let _e313 = c_19;
    let _e316 = c_19;
    let _e317 = o_2;
    let _e319 = forestGradient((_e316 + _e317));
    let _e320 = c_19;
    let _e321 = o_2;
    let _e327 = forestGradient(((_e320 + _e321) + vec2<i32>(1i, 0i)));
    let _e328 = c_19;
    let _e329 = o_2;
    let _e335 = forestGradient(((_e328 + _e329) + vec2<i32>(0i, 1i)));
    let _e336 = c_19;
    let _e337 = o_2;
    let _e343 = forestGradient(((_e336 + _e337) + vec2<i32>(1i, 1i)));
    let _e344 = forestPerlin((_e312 - vec2<f32>(_e313)), _e319, _e327, _e335, _e343);
    n_9 = _e344;
    let _e346 = n_9;
    let _e348 = n_9;
    let _e353 = ((_e348.yz * FOREST_GLADE_FRAME) / vec2(210f));
    return vec3<f32>(_e346.x, _e353.x, _e353.y);
}

fn forestPatchNoise(fine_7: vec3<f32>, glade: vec3<f32>) -> vec3<f32> {
    var fine_8: vec3<f32>;
    var glade_1: vec3<f32>;

    fine_8 = fine_7;
    glade_1 = glade;
    let _e295 = fine_8;
    let _e298 = glade_1;
    return ((0.5f * _e295) + (0.866f * _e298));
}

fn forestPatchThreshold(p_24: vec2<f32>) -> vec2<f32> {
    var p_25: vec2<f32>;
    var g_9: vec2<f32>;
    var c_20: vec2<i32>;
    var f_14: vec3<f32>;
    var n_10: vec3<f32>;
    var u_12: f32;
    var x_7: f32;
    var k_18: i32;
    var local_151: array<f32, 17> = forestPatchCdf;
    var local_152: array<f32, 17> = forestPatchCdf;

    p_25 = p_24;
    let _e292 = p_25;
    g_9 = (_e292 / vec2(56f));
    let _e297 = g_9;
    c_20 = vec2<i32>(floor(_e297));
    let _e301 = g_9;
    let _e302 = c_20;
    let _e305 = c_20;
    let _e306 = forestGradient(_e305);
    let _e307 = c_20;
    let _e312 = forestGradient((_e307 + vec2<i32>(1i, 0i)));
    let _e313 = c_20;
    let _e318 = forestGradient((_e313 + vec2<i32>(0i, 1i)));
    let _e319 = c_20;
    let _e324 = forestGradient((_e319 + vec2<i32>(1i, 1i)));
    let _e325 = forestPerlin((_e301 - vec2<f32>(_e302)), _e306, _e312, _e318, _e324);
    f_14 = _e325;
    let _e327 = f_14;
    let _e329 = f_14;
    let _e333 = (_e329.yz / vec2(56f));
    let _e337 = p_25;
    let _e338 = forestGlade(_e337);
    let _e339 = forestPatchNoise(vec3<f32>(_e327.x, _e333.x, _e333.y), _e338);
    n_10 = _e339;
    let _e341 = n_10;
    u_12 = clamp(((_e341.x * 0.6f) + 0.5f), 0f, 1f);
    let _e351 = u_12;
    x_7 = (_e351 * 16f);
    let _e355 = x_7;
    k_18 = min(i32(_e355), 15i);
    let _e360 = u_12;
    let _e362 = forestLookup17_(_e360, 0i);
    let _e363 = k_18;
    let _e369 = local_151[(_e363 + 1i)];
    let _e370 = k_18;
    let _e374 = local_152[_e370];
    let _e380 = n_10;
    return vec2<f32>(_e362, ((((_e369 - _e374) * 16f) * 0.6f) * length(_e380.yz)));
}

fn forestField(world_39: vec2<f32>, lod_2: f32) -> vec4<f32> {
    var world_40: vec2<f32>;
    var lod_3: f32;

    world_40 = world_39;
    lod_3 = lod_2;
    let _e294 = world_40;
    let _e295 = global.uForestRect;
    let _e298 = global.uForestRect;
    let _e302 = lod_3;
    let _e303 = textureSampleLevel(uForestField, sLinear, ((_e294 - _e295.xy) / vec2(_e298.z)), _e302);
    let _e304 = v2ZoneForest(_e303);
    return _e304;
}

fn forestBankDensity(w_4: f32) -> f32 {
    var w_5: f32;
    var c_21: f32;

    w_5 = w_4;
    let _e296 = w_5;
    let _e297 = groundSmooth(8f, 36f, _e296);
    c_21 = (0.55f + (0.35f * _e297));
    let _e303 = c_21;
    let _e305 = global.uForestBankDensity;
    return (1f - pow((1f - _e303), max(_e305, 0f)));
}

fn forestBankGallery(b_14: vec2<f32>) -> f32 {
    var b_15: vec2<f32>;
    var local_153: f32;

    b_15 = b_14;
    let _e292 = b_15;
    if (_e292.x > 0f) {
        let _e296 = b_15;
        let _e298 = forestBankDensity(_e296.y);
        let _e304 = b_15;
        let _e306 = b_15;
        let _e312 = groundSmooth(0.35f, 1f, (1f - (_e304.x / max(_e306.y, 1f))));
        local_153 = (_e298 * (1f - (0.6f * _e312)));
    } else {
        local_153 = 0f;
    }
    let _e318 = local_153;
    return _e318;
}

fn forestBankAt(world_41: vec2<f32>) -> vec2<f32> {
    var world_42: vec2<f32>;
    var uv_12: vec2<f32>;
    var range: f32;
    var t_15: vec4<f32>;
    var w_6: f32;

    world_42 = world_41;
    let _e292 = global.uHasForestBank;
    if (_e292 == 0i) {
        return vec2<f32>(-1000f, 0f);
    }
    let _e299 = world_42;
    let _e300 = global.uForestRect;
    let _e303 = global.uForestRect;
    uv_12 = ((_e299 - _e300.xy) / vec2(_e303.z));
    let _e308 = uv_12;
    let _e313 = uv_12;
    if (any((_e308 < vec2(0f))) || any((_e313 > vec2(1f)))) {
        return vec2<f32>(-1000f, 0f);
    }
    let _e325 = global.uForestRect;
    let _e329 = textureDimensions(uForestBank, 0i);
    range = (48f + ((3f * _e325.z) / f32(vec2<i32>(_e329).x)));
    let _e336 = world_42;
    let _e337 = uv_12;
    let _e338 = surfaceGroundBankTexel(_e336, _e337);
    t_15 = _e338;
    let _e340 = t_15;
    w_6 = ((_e340.z * 255f) / 2f);
    let _e347 = w_6;
    if (_e347 <= 0f) {
        return vec2<f32>(-1000f, 0f);
    }
    let _e354 = w_6;
    let _e355 = t_15;
    let _e362 = range;
    let _e368 = w_6;
    return vec2<f32>((_e354 - length((((_e355.xy * 255f) - vec2(128f)) * (_e362 / 127f)))), _e368);
}

fn forestBankCover(world_43: vec2<f32>, fp_13: f32) -> f32 {
    var world_44: vec2<f32>;
    var fp_14: f32;
    var uv_13: vec2<f32>;
    var cell_7: f32;
    var range_1: f32;
    var t_16: vec4<f32>;
    var w_7: f32;
    var margin: f32;
    var sharp_2: f32;
    var area: f32;

    world_44 = world_43;
    fp_14 = fp_13;
    let _e294 = global.uHasForestBank;
    if (_e294 == 0i) {
        return 0f;
    }
    let _e298 = world_44;
    let _e299 = global.uForestRect;
    let _e302 = global.uForestRect;
    uv_13 = ((_e298 - _e299.xy) / vec2(_e302.z));
    let _e307 = uv_13;
    let _e312 = uv_13;
    if (any((_e307 < vec2(0f))) || any((_e312 > vec2(1f)))) {
        return 0f;
    }
    let _e319 = global.uForestRect;
    let _e322 = textureDimensions(uForestBank, 0i);
    cell_7 = (_e319.z / f32(vec2<i32>(_e322).x));
    let _e330 = cell_7;
    range_1 = (48f + (3f * _e330));
    let _e334 = world_44;
    let _e335 = uv_13;
    let _e336 = surfaceGroundBankTexel(_e334, _e335);
    t_16 = _e336;
    let _e338 = t_16;
    w_7 = ((_e338.z * 255f) / 2f);
    let _e345 = w_7;
    let _e346 = t_16;
    let _e353 = range_1;
    margin = (_e345 - length((((_e346.xy * 255f) - vec2(128f)) * (_e353 / 127f))));
    let _e361 = w_7;
    let _e363 = margin;
    let _e364 = fp_14;
    let _e374 = w_7;
    let _e375 = forestBankDensity(_e374);
    let _e382 = margin;
    let _e385 = w_7;
    let _e390 = groundSmooth(0.35f, 1f, (1f - (max(_e382, 0f) / max(_e385, 1f))));
    sharp_2 = (((step(0.001f, _e361) * clamp(((_e363 / max(_e364, 0.05f)) + 0.5f), 0f, 1f)) * _e375) * (1f - (0.6f * _e390)));
    let _e395 = uv_13;
    let _e396 = fp_14;
    let _e397 = cell_7;
    let _e402 = textureSampleLevel(uForestBank, sLinear, _e395, max(log2((_e396 / _e397)), 0f));
    area = _e402.w;
    let _e405 = sharp_2;
    let _e406 = area;
    let _e408 = cell_7;
    let _e411 = cell_7;
    let _e413 = fp_14;
    let _e414 = groundSmooth((0.5f * _e408), (2f * _e411), _e413);
    return mix(_e405, _e406, _e414);
}

fn forestShrubShare(h_15: f32) -> f32 {
    var h_16: f32;

    h_16 = h_15;
    let _e295 = h_16;
    let _e296 = groundSmooth(3f, 5.5f, _e295);
    return (1f - _e296);
}

fn forestDensity(c_22: f32, kappa: f32) -> f32 {
    var c_23: f32;
    var kappa_1: f32;

    c_23 = c_22;
    kappa_1 = kappa;
    let _e294 = c_23;
    let _e295 = kappa_1;
    let _e300 = c_23;
    let _e301 = groundSmooth(0.55f, 0.9f, _e300);
    let _e306 = c_23;
    let _e310 = c_23;
    return clamp((_e294 + ((_e295 * (1f - (0.5f * _e301))) * (0.985f - _e306))), _e310, 0.985f);
}

fn forestKind(trop: f32, dry_1: f32) -> vec3<f32> {
    var trop_1: f32;
    var dry_2: f32;
    var savanna: f32;

    trop_1 = trop;
    dry_2 = dry_1;
    let _e294 = trop_1;
    let _e297 = dry_2;
    let _e298 = groundSmooth(0.3f, 0.6f, _e297);
    savanna = (_e294 * _e298);
    let _e302 = trop_1;
    let _e306 = global.uMaterialClimate;
    let _e308 = groundSmooth(10f, 14f, _e306.x);
    let _e312 = dry_2;
    let _e313 = groundSmooth(0.35f, 0.7f, _e312);
    let _e315 = trop_1;
    let _e316 = savanna;
    let _e318 = savanna;
    return vec3<f32>((((1f - _e302) * _e308) * _e313), (_e315 - _e316), _e318);
}

fn forestRadius(height_5: f32, needle: f32, dry_3: f32) -> f32 {
    var height_6: f32;
    var needle_1: f32;
    var dry_4: f32;

    height_6 = height_5;
    needle_1 = needle;
    dry_4 = dry_3;
    let _e297 = height_6;
    let _e303 = dry_4;
    let _e308 = height_6;
    let _e312 = needle_1;
    return mix((((0.24f * _e297) + 1f) * (1f + (0.45f * _e303))), ((0.07f * _e308) + 0.55f), _e312);
}

fn forestKrummholz(height_7: f32, needle_2: f32) -> f32 {
    var height_8: f32;
    var needle_3: f32;

    height_8 = height_7;
    needle_3 = needle_2;
    let _e297 = height_8;
    let _e298 = groundSmooth(3f, 7f, _e297);
    let _e302 = needle_3;
    let _e303 = groundSmooth(0.35f, 0.7f, _e302);
    return ((1f - _e298) * _e303);
}

fn forestHeightGate(h_17: f32) -> f32 {
    var h_18: f32;

    h_18 = h_17;
    let _e294 = h_18;
    let _e295 = groundSmooth(2f, 6f, _e294);
    return _e295;
}

fn forestWoods(c_24: f32, h_19: f32) -> f32 {
    var c_25: f32;
    var h_20: f32;

    c_25 = c_24;
    h_20 = h_19;
    let _e294 = c_25;
    let _e296 = h_20;
    let _e297 = forestHeightGate(_e296);
    return max(_e294, (0.25f * _e297));
}

fn forestReveal(fp_15: f32) -> f32 {
    var fp_16: f32;

    fp_16 = fp_15;
    let _e295 = fp_16;
    let _e299 = groundSmooth(1f, 5f, log2(max(_e295, 0.001f)));
    return (1f - _e299);
}

fn forestPatchAround(cell_8: vec2<i32>, s_8: f32) -> ForestPatch {
    var cell_9: vec2<i32>;
    var s_9: f32;
    var q_8: ForestPatch;

    cell_9 = cell_8;
    s_9 = s_8;
    let _e296 = cell_9;
    let _e301 = s_9;
    q_8.base = vec2<i32>(floor(((vec2<f32>((_e296 - vec2(1i))) * _e301) / vec2(56f))));
    let _e309 = cell_9;
    let _e314 = s_9;
    q_8.centre = ((vec2<f32>(_e309) + vec2(0.5f)) * _e314);
    let _e317 = q_8;
    let _e319 = forestGlade(_e317.centre);
    q_8.glade = _e319;
    let _e320 = q_8;
    return _e320;
}

fn forestPatchValue(q_9: ForestPatch, p_26: vec2<f32>) -> f32 {
    var q_10: ForestPatch;
    var p_27: vec2<f32>;
    var g_10: vec2<f32>;
    var c_26: vec2<i32>;
    var b_16: vec2<i32>;
    var fine_9: f32;

    q_10 = q_9;
    p_27 = p_26;
    let _e294 = p_27;
    let _e298 = q_10;
    g_10 = ((_e294 / vec2(56f)) - vec2<f32>(_e298.base));
    let _e303 = g_10;
    c_26 = clamp(vec2<i32>(floor(_e303)), vec2(0i), vec2(1i));
    let _e312 = q_10;
    let _e314 = c_26;
    b_16 = (_e312.base + _e314);
    let _e317 = g_10;
    let _e318 = c_26;
    let _e321 = b_16;
    let _e322 = forestGradient(_e321);
    let _e323 = b_16;
    let _e328 = forestGradient((_e323 + vec2<i32>(1i, 0i)));
    let _e329 = b_16;
    let _e334 = forestGradient((_e329 + vec2<i32>(0i, 1i)));
    let _e335 = b_16;
    let _e340 = forestGradient((_e335 + vec2<i32>(1i, 1i)));
    let _e341 = forestPerlin((_e317 - vec2<f32>(_e318)), _e322, _e328, _e334, _e340);
    fine_9 = _e341.x;
    let _e344 = fine_9;
    let _e348 = q_10;
    let _e351 = q_10;
    let _e354 = p_27;
    let _e355 = q_10;
    let _e363 = forestPatchNoise(vec3<f32>(_e344, 0f, 0f), vec3<f32>((_e348.glade.x + dot(_e351.glade.yz, (_e354 - _e355.centre))), 0f, 0f));
    return clamp(((_e363.x * 0.6f) + 0.5f), 0f, 1f);
}

fn forestOpenAt(p_28: vec2<f32>) -> f32 {
    var p_29: vec2<f32>;

    p_29 = p_28;
    let _e292 = p_29;
    let _e293 = global.uOccupationRect;
    let _e296 = global.uOccupationRect;
    let _e301 = textureSampleLevel(uOccupation, sLinear, ((_e292 - _e293.xy) / vec2(_e296.z)), 0f);
    let _e309 = global.uOccupationRect;
    let _e312 = global.uOccupationN;
    return (((((_e301.x * 255f) - 128f) / 16f) * _e309.z) / _e312);
}

fn forestCrown(cell_10: vec2<i32>, level_1: i32, s_10: f32, st_1: ForestStand, lattice: ForestPatch) -> ForestCrown {
    var cell_11: vec2<i32>;
    var level_2: i32;
    var s_11: f32;
    var st_2: ForestStand;
    var lattice_1: ForestPatch;
    var k_19: ForestCrown;
    var seed_16: u32;
    var h_21: u32;
    var h2_1: u32;
    var centre_1: vec4<f32>;
    var cover_5: f32;
    var height_9: f32;
    var needle_4: f32;
    var open: f32 = -1000f;
    var forced: f32 = -1000f;
    var allow: f32 = 0f;
    var hedge: f32 = 0f;
    var openGallery: f32 = 0.5f;
    var occupied: bool = false;
    var tilledPlot: bool = false;
    var ouv: vec2<f32>;
    var dist_1: vec2<f32>;
    var cls_2: i32;
    var local_154: f32;
    var local_155: f32;
    var local_156: f32;
    var local_157: f32;
    var local_158: f32;
    var kappa_2: f32;
    var gallery: f32;
    var density_1: f32;
    var share: f32;
    var radius_6: f32;
    var e_1: f32;
    var g_11: vec2<f32>;
    var edge_2: vec2<f32>;
    var side_1: i32;
    var centreLevel: f32;
    var weight_2: f32;
    var tau_2: f32;
    var q_11: f32;
    var rho: f32;
    var threshold: f32;
    var krumm: f32;
    var beyond: f32;
    var stray: f32;
    var local_159: f32;
    var local_160: f32;
    var beachChoice: f32;
    var kind: vec3<f32>;
    var emergent: f32;
    var local_161: f32;
    var local_162: f32;

    cell_11 = cell_10;
    level_2 = level_1;
    s_11 = s_10;
    st_2 = st_1;
    lattice_1 = lattice;
    let _e301 = global.uMaterialSeed;
    seed_16 = (_e301 ^ 739982445u);
    k_19.riparian = false;
    let _e307 = cell_11;
    let _e308 = level_2;
    let _e314 = seed_16;
    let _e315 = groundHash(vec3<i32>(_e307.x, _e307.y, (_e308 * 2i)), _e314);
    h_21 = _e315;
    let _e317 = cell_11;
    let _e318 = level_2;
    let _e326 = seed_16;
    let _e327 = groundHash(vec3<i32>(_e317.x, _e317.y, ((_e318 * 2i) + 1i)), _e326);
    h2_1 = _e327;
    let _e330 = h2_1;
    k_19.id = _e330;
    let _e332 = cell_11;
    let _e338 = h_21;
    let _e340 = forestU8_(_e338, 0u);
    let _e341 = h_21;
    let _e343 = forestU8_(_e341, 8u);
    let _e347 = s_11;
    k_19.c = (((vec2<f32>(_e332) + vec2(0.15f)) + (0.7f * vec2<f32>(_e340, _e343))) * _e347);
    let _e349 = k_19;
    let _e352 = forestField(_e349.c, 0f);
    centre_1 = _e352;
    let _e354 = centre_1;
    cover_5 = _e354.x;
    let _e357 = centre_1;
    height_9 = (_e357.y * 50f);
    let _e362 = centre_1;
    needle_4 = _e362.z;
    let _e381 = global.uHasOccupation;
    if (_e381 == 1i) {
        {
            let _e384 = k_19;
            let _e386 = global.uOccupationRect;
            let _e389 = global.uOccupationRect;
            ouv = ((_e384.c - _e386.xy) / vec2(_e389.z));
            let _e394 = ouv;
            let _e399 = ouv;
            if (all((_e394 >= vec2(0f))) && all((_e399 <= vec2(1f)))) {
                {
                    let _e405 = ouv;
                    let _e407 = textureSampleLevel(uOccupation, sLinear, _e405, 0f);
                    let _e417 = global.uOccupationRect;
                    let _e420 = global.uOccupationN;
                    dist_1 = (((((_e407.xy * 255f) - vec2(128f)) / vec2(16f)) * _e417.z) / vec2(_e420));
                    let _e424 = dist_1;
                    open = _e424.x;
                    let _e426 = dist_1;
                    forced = _e426.y;
                    let _e428 = ouv;
                    let _e429 = global.uOccupationN;
                    let _e434 = global.uOccupationN;
                    let _e441 = textureLoad(uOccupation, clamp(vec2<i32>((_e428 * _e429)), vec2(0i), vec2((i32(_e434) - 1i))), 0i);
                    cls_2 = i32(((_e441.z * 255f) + 0.5f));
                    let _e449 = cls_2;
                    tilledPlot = (_e449 == 5i);
                    let _e452 = cls_2;
                    if (_e452 == 6i) {
                        local_157 = 0.12f;
                    } else {
                        let _e456 = cls_2;
                        if (_e456 == 3i) {
                            local_156 = 0.05f;
                        } else {
                            let _e460 = cls_2;
                            if (_e460 == 2i) {
                                local_155 = 0.02f;
                            } else {
                                let _e464 = cls_2;
                                if (_e464 == 7i) {
                                    local_154 = 0.03f;
                                } else {
                                    local_154 = 0f;
                                }
                                let _e470 = local_154;
                                local_155 = _e470;
                            }
                            let _e472 = local_155;
                            local_156 = _e472;
                        }
                        let _e474 = local_156;
                        local_157 = _e474;
                    }
                    let _e476 = local_157;
                    let _e477 = height_9;
                    let _e478 = forestHeightGate(_e477);
                    allow = (_e476 * _e478);
                    let _e480 = cls_2;
                    let _e483 = cls_2;
                    if ((_e480 >= 1i) && (_e483 <= 3i)) {
                        local_158 = 0.6f;
                    } else {
                        local_158 = 0f;
                    }
                    let _e490 = local_158;
                    let _e493 = height_9;
                    let _e494 = groundSmooth(3f, 8f, _e493);
                    let _e497 = st_2;
                    hedge = ((_e490 * _e494) * (1f - _e497.dry));
                    let _e501 = cls_2;
                    let _e504 = cls_2;
                    let _e508 = cls_2;
                    let _e512 = cls_2;
                    if ((((_e501 == 7i) || (_e504 == 8i)) || (_e508 == 9i)) || (_e512 == 11i)) {
                        openGallery = 0f;
                    }
                    let _e517 = cls_2;
                    let _e520 = cls_2;
                    let _e524 = cls_2;
                    let _e528 = cls_2;
                    let _e532 = cls_2;
                    occupied = (((((_e517 == 4i) || (_e520 == 8i)) || (_e524 == 9i)) || (_e528 == 11i)) || (_e532 == 12i));
                }
            }
        }
    }
    let _e536 = forced;
    if (_e536 > 0f) {
        let _e539 = cover_5;
        let _e540 = height_9;
        let _e541 = forestWoods(_e539, _e540);
        cover_5 = _e541;
    }
    let _e542 = st_2;
    let _e548 = height_9;
    let _e549 = groundSmooth(3f, 10f, _e548);
    let _e556 = st_2;
    let _e558 = groundSmooth(3f, 10f, _e556.height);
    let _e563 = needle_4;
    let _e568 = st_2;
    kappa_2 = ((((_e542.kappa * mix(0.55f, 1f, _e549)) / mix(0.55f, 1f, _e558)) * mix(1f, 0.85f, _e563)) / mix(1f, 0.85f, _e568.needle));
    let _e573 = k_19;
    let _e575 = forestBankAt(_e573.c);
    let _e576 = forestBankGallery(_e575);
    gallery = _e576;
    let _e578 = gallery;
    let _e579 = cover_5;
    if (_e578 > _e579) {
        {
            k_19.riparian = true;
            let _e583 = gallery;
            cover_5 = _e583;
            kappa_2 = 0f;
            let _e585 = needle_4;
            needle_4 = (_e585 * 0.3f);
        }
    }
    let _e588 = cover_5;
    let _e589 = kappa_2;
    let _e590 = forestDensity(_e588, _e589);
    density_1 = _e590;
    let _e592 = cover_5;
    let _e593 = density_1;
    share = (_e592 / max(_e593, 0.001f));
    let _e598 = height_9;
    let _e599 = needle_4;
    let _e600 = st_2;
    let _e602 = forestRadius(_e598, _e599, _e600.dry);
    radius_6 = _e602;
    let _e604 = global.uHasOccupation;
    let _e607 = open;
    let _e611 = open;
    let _e612 = radius_6;
    if (((_e604 == 1i) && (_e607 < 0f)) && (_e611 > -(_e612))) {
        {
            let _e616 = global.uOccupationRect;
            let _e618 = global.uOccupationN;
            e_1 = (_e616.z / _e618);
            let _e621 = k_19;
            let _e623 = e_1;
            let _e627 = forestOpenAt((_e621.c + vec2<f32>(_e623, 0f)));
            let _e628 = k_19;
            let _e630 = e_1;
            let _e634 = forestOpenAt((_e628.c - vec2<f32>(_e630, 0f)));
            let _e636 = k_19;
            let _e639 = e_1;
            let _e642 = forestOpenAt((_e636.c + vec2<f32>(0f, _e639)));
            let _e643 = k_19;
            let _e646 = e_1;
            let _e649 = forestOpenAt((_e643.c - vec2<f32>(0f, _e646)));
            g_11 = vec2<f32>((_e627 - _e634), (_e642 - _e649));
            let _e653 = k_19;
            let _e655 = g_11;
            let _e656 = g_11;
            let _e663 = e_1;
            let _e665 = open;
            let _e669 = global.uOccupationRect;
            let _e672 = global.uOccupationRect;
            edge_2 = (((_e653.c + ((_e655 / vec2(max(length(_e656), 0.0001f))) * ((0.5f * _e663) - _e665))) - _e669.xy) / vec2(_e672.z));
            let _e677 = edge_2;
            let _e678 = global.uOccupationN;
            let _e683 = global.uOccupationN;
            let _e690 = textureLoad(uOccupation, clamp(vec2<i32>((_e677 * _e678)), vec2(0i), vec2((i32(_e683) - 1i))), 0i);
            side_1 = i32(((_e690.z * 255f) + 0.5f));
            let _e698 = side_1;
            let _e701 = side_1;
            let _e705 = side_1;
            let _e709 = side_1;
            let _e713 = open;
            let _e714 = radius_6;
            let _e715 = h2_1;
            let _e717 = forestU8_(_e715, 16u);
            let _e718 = forestCrownSetback(_e714, _e717);
            if (((((_e698 == 4i) || (_e701 == 8i)) || (_e705 == 9i)) || (_e709 == 11i)) && (_e713 > -(_e718))) {
                occupied = true;
            }
        }
    }
    let _e724 = radius_6;
    let _e725 = density_1;
    let _e726 = forestTau(_e725);
    let _e727 = forestRho(_e726);
    centreLevel = clamp((2f * log2(((_e724 / _e727) / 2f))), 0f, 5.999f);
    let _e739 = centreLevel;
    let _e740 = level_2;
    weight_2 = max(0f, (1f - abs((_e739 - f32(_e740)))));
    let _e749 = density_1;
    let _e751 = weight_2;
    let _e754 = forestTau((1f - pow((1f - _e749), _e751)));
    tau_2 = _e754;
    let _e757 = tau_2;
    q_11 = min(1f, (_e757 / 0.55f));
    let _e762 = tau_2;
    let _e763 = forestRho(_e762);
    rho = _e763;
    let _e766 = lattice_1;
    let _e767 = k_19;
    let _e769 = forestPatchValue(_e766, _e767.c);
    let _e772 = h2_1;
    let _e774 = forestU8_(_e772, 0u);
    let _e778 = forestLookup17_(((0.8f * _e769) + (0.2f * _e774)), 1i);
    threshold = _e778;
    let _e780 = height_9;
    let _e781 = needle_4;
    let _e782 = forestKrummholz(_e780, _e781);
    krumm = _e782;
    let _e784 = threshold;
    let _e785 = h2_1;
    let _e787 = forestU8_(_e785, 0u);
    let _e788 = krumm;
    threshold = mix(_e784, _e787, _e788);
    let _e790 = open;
    let _e791 = h_21;
    let _e795 = forestU8_((_e791 * 374761393u), 8u);
    let _e798 = radius_6;
    beyond = (_e790 + ((_e795 - 0.5f) * _e798));
    k_19.alive = false;
    let _e804 = beyond;
    if (_e804 > 0f) {
        {
            let _e811 = radius_6;
            let _e813 = open;
            let _e814 = groundSmooth(0f, (4f * _e811), _e813);
            let _e817 = cover_5;
            stray = ((0.18f * (1f - _e814)) * min((_e817 * 3f), 1f));
            let _e825 = tilledPlot;
            let _e827 = h2_1;
            let _e831 = forestU8_((_e827 * 668265261u), 24u);
            let _e832 = allow;
            let _e833 = open;
            if (_e833 < 5f) {
                let _e836 = hedge;
                local_159 = _e836;
            } else {
                local_159 = 0f;
            }
            let _e839 = local_159;
            let _e841 = stray;
            let _e843 = openGallery;
            let _e844 = gallery;
            let _e848 = v2ZoneBare;
            k_19.alive = (!(_e825) && (_e831 < (max(((_e832 + _e839) + _e841), (_e843 * _e844)) * (1f - _e848))));
            k_19.edge = 1f;
        }
    } else {
        {
            let _e856 = h_21;
            let _e858 = forestU8_(_e856, 16u);
            let _e859 = q_11;
            let _e861 = threshold;
            let _e862 = share;
            let _e864 = v2ZoneBare;
            k_19.alive = ((_e858 < _e859) && (_e861 < (_e862 * (1f - _e864))));
            let _e873 = share;
            let _e874 = threshold;
            let _e876 = groundSmooth(0f, 0.1f, (_e873 - _e874));
            k_19.edge = (1f - _e876);
        }
    }
    let _e878 = occupied;
    let _e879 = k_19;
    let _e881 = k_19;
    let _e883 = forestWaterCoverage(_e881.c);
    if (uRenderV2_ > 0i) {
        local_160 = 0.05f;
    } else {
        local_160 = 0.5f;
    }
    let _e889 = local_160;
    if (_e878 || (_e879.alive && (_e883 >= _e889))) {
        k_19.alive = false;
    }
    let _e897 = k_19;
    if ((uRenderV2_ > 0i) && _e897.alive) {
        {
            let _e900 = cell_11;
            let _e901 = level_2;
            let _e909 = seed_16;
            let _e910 = groundHash(vec3<i32>(_e900.x, _e900.y, ((_e901 * 2i) + 37i)), _e909);
            let _e912 = forestU8_(_e910, 0u);
            beachChoice = _e912;
            let _e914 = beachChoice;
            let _e915 = k_19;
            let _e917 = forestBeach(_e915.c);
            if (_e914 < _e917) {
                k_19.alive = false;
            }
        }
    }
    let _e922 = k_19;
    let _e924 = k_19;
    k_19.riparian = (_e922.riparian && _e924.alive);
    k_19.needle = false;
    k_19.r = 0f;
    k_19.h = 0f;
    k_19.depth = 0f;
    let _e935 = k_19;
    if _e935.alive {
        {
            let _e938 = h2_1;
            let _e940 = forestU8_(_e938, 8u);
            let _e941 = needle_4;
            k_19.needle = (_e940 < _e941);
            let _e943 = st_2;
            let _e945 = st_2;
            let _e947 = forestKind(_e943.trop, _e945.dry);
            kind = _e947;
            let _e949 = kind;
            let _e953 = h2_1;
            let _e955 = forestU8_(_e953, 24u);
            let _e956 = groundSmooth(0.9f, 0.97f, _e955);
            emergent = (_e949.y * _e956);
            let _e960 = rho;
            let _e961 = s_11;
            let _e965 = h_21;
            let _e967 = forestU8_(_e965, 24u);
            let _e973 = k_19;
            let _e978 = beyond;
            if (_e978 > 0f) {
                local_161 = 0.75f;
            } else {
                local_161 = 1f;
            }
            let _e984 = local_161;
            let _e988 = emergent;
            let _e992 = krumm;
            let _e997 = s_11;
            k_19.r = min((((((_e960 * _e961) * (0.8f + (0.4f * _e967))) * (1f + (0.1f * _e973.edge))) * _e984) * ((1f + (0.6f * _e988)) + (0.3f * _e992))), (1.14f * _e997));
            let _e1001 = height_9;
            let _e1004 = kind;
            let _e1009 = kind;
            let _e1012 = h2_1;
            let _e1014 = forestU8_(_e1012, 16u);
            let _e1020 = emergent;
            k_19.h = ((_e1001 * (mix(0.82f, 0.66f, _e1004.y) + (mix(0.36f, 0.6f, _e1009.y) * _e1014))) * (1f + (0.45f * _e1020)));
            let _e1025 = k_19;
            let _e1027 = k_19;
            if _e1027.needle {
                let _e1031 = krumm;
                local_162 = mix(3.2f, 1.1f, _e1031);
            } else {
                let _e1035 = kind;
                local_162 = mix(0.55f, 0.22f, _e1035.z);
            }
            let _e1039 = local_162;
            k_19.depth = (_e1025.r * _e1039);
        }
    }
    let _e1041 = k_19;
    return _e1041;
}

fn orchardGrid(world_45: vec2<f32>, rows: vec2<f32>) -> vec2<f32> {
    var world_46: vec2<f32>;
    var rows_1: vec2<f32>;

    world_46 = world_45;
    rows_1 = rows;
    let _e294 = world_46;
    let _e295 = rows_1;
    let _e297 = world_46;
    let _e298 = rows_1;
    let _e301 = rows_1;
    return (vec2<f32>(dot(_e294, _e295), dot(_e297, vec2<f32>(-(_e298.y), _e301.x))) / vec2(8f));
}

fn orchardCrown(cell_12: vec2<i32>, st_3: ForestStand) -> ForestCrown {
    var cell_13: vec2<i32>;
    var st_4: ForestStand;
    var k_20: ForestCrown;
    var h_22: u32;
    var q_12: vec2<f32>;
    var detail_3: vec4<f32>;
    var c2_: vec2<f32>;
    var a_21: f32;
    var rows_2: vec2<f32>;

    cell_13 = cell_12;
    st_4 = st_3;
    let _e295 = cell_13;
    let _e300 = global.uMaterialSeed;
    let _e301 = groundHash(vec3<i32>(_e295.x, _e295.y, 877i), _e300);
    h_22 = _e301;
    let _e304 = cell_13;
    let _e309 = global.uMaterialSeed;
    let _e310 = groundHash(vec3<i32>(_e304.x, _e304.y, 878i), _e309);
    k_20.id = _e310;
    let _e311 = cell_13;
    let _e316 = h_22;
    let _e318 = forestU8_(_e316, 0u);
    let _e319 = h_22;
    let _e321 = forestU8_(_e319, 8u);
    q_12 = (((vec2<f32>(_e311) + vec2(0.5f)) + ((vec2<f32>(_e318, _e321) - vec2(0.5f)) * 0.12f)) * 8f);
    let _e333 = st_4;
    let _e335 = q_12;
    let _e338 = st_4;
    let _e342 = st_4;
    let _e346 = q_12;
    k_20.c = ((_e333.rows * _e335.x) + (vec2<f32>(-(_e338.rows.y), _e342.rows.x) * _e346.y));
    let _e353 = h_22;
    let _e355 = forestU8_(_e353, 16u);
    k_20.r = (2.3f + (0.4f * _e355));
    let _e361 = k_20;
    let _e364 = forestU8_(_e361.id, 16u);
    k_20.h = (6f + (1.2f * _e364));
    let _e368 = k_20;
    k_20.depth = (_e368.r * 0.8f);
    k_20.needle = false;
    k_20.riparian = false;
    k_20.edge = 0f;
    let _e378 = k_20;
    let _e380 = orchardDetail(_e378.c);
    detail_3 = _e380;
    let _e382 = detail_3;
    c2_ = ((_e382.yz * 2f) - vec2(1f));
    let _e391 = c2_;
    let _e393 = c2_;
    a_21 = (0.5f * atan2(_e391.y, _e393.x));
    let _e398 = a_21;
    let _e400 = a_21;
    rows_2 = vec2<f32>(cos(_e398), sin(_e400));
    let _e405 = k_20;
    let _e407 = groundOccupation(_e405.c);
    let _e412 = rows_2;
    let _e413 = st_4;
    let _e419 = detail_3;
    let _e423 = k_20;
    let _e429 = k_20;
    let _e432 = forestField(_e429.c, 0f);
    let _e436 = forestHeightGate((_e432.y * 50f));
    let _e440 = k_20;
    let _e442 = forestWaterCoverage(_e440.c);
    k_20.alive = (((((i32(_e407.z) == 4i) && (dot(_e412, _e413.rows) > 0.9999f)) && ((_e419.w * 6f) > (_e423.r * 1.2f))) && (_e436 > 0.5f)) && (_e442 < 0.05f));
    let _e446 = k_20;
    return _e446;
}

fn forestOutline(k_21: ForestCrown, n_11: vec2<f32>, aa: f32) -> f32 {
    var k_22: ForestCrown;
    var n_12: vec2<f32>;
    var aa_1: f32;
    var h_23: u32;
    var a_22: vec2<f32>;
    var local_163: f32;
    var amp: f32;
    var OVAL: f32 = 0.35f;
    var local_164: f32;
    var lobes: f32;
    var shape: vec4<f32>;
    var c2_1: vec2<f32>;
    var c3_: vec2<f32>;
    var star: f32;
    var c5_: vec2<f32>;
    var c7_: vec2<f32>;
    var phase_3: vec2<f32>;
    var local_165: f32;
    var tips: f32;
    var boughs: f32 = 0f;
    var branches: f32;
    var lobe: f32;
    var local_166: f32;

    k_22 = k_21;
    n_12 = n_11;
    aa_1 = aa;
    let _e296 = k_22;
    h_23 = (_e296.id * 2654435769u);
    let _e301 = h_23;
    let _e303 = forestU8_(_e301, 0u);
    let _e304 = h_23;
    let _e306 = forestU8_(_e304, 8u);
    a_22 = (vec2<f32>(_e303, _e306) * 6.2831855f);
    let _e311 = k_22;
    if _e311.needle {
        local_163 = 0.07f;
    } else {
        local_163 = 0.13f;
    }
    let _e316 = local_163;
    amp = _e316;
    let _e320 = k_22;
    if _e320.needle {
        local_164 = 0.6f;
    } else {
        local_164 = 0.28f;
    }
    let _e325 = local_164;
    lobes = _e325;
    let _e327 = OVAL;
    let _e328 = a_22;
    let _e332 = OVAL;
    let _e333 = a_22;
    let _e337 = lobes;
    let _e338 = a_22;
    let _e342 = lobes;
    let _e343 = a_22;
    let _e348 = amp;
    shape = (vec4<f32>((_e327 * cos(_e328.x)), (_e332 * sin(_e333.x)), (_e337 * cos(_e338.y)), (_e342 * sin(_e343.y))) * _e348);
    let _e351 = n_12;
    let _e353 = n_12;
    let _e356 = n_12;
    let _e358 = n_12;
    let _e363 = n_12;
    let _e366 = n_12;
    c2_1 = vec2<f32>(((_e351.x * _e353.x) - (_e356.y * _e358.y)), ((2f * _e363.x) * _e366.y));
    let _e371 = n_12;
    let _e374 = n_12;
    let _e377 = n_12;
    let _e383 = n_12;
    let _e387 = n_12;
    let _e390 = n_12;
    c3_ = vec2<f32>((_e371.x * (((4f * _e374.x) * _e377.x) - 3f)), (_e383.y * (3f - ((4f * _e387.y) * _e390.y))));
    let _e399 = k_22;
    let _e401 = aa_1;
    let _e405 = groundSmooth(1.5f, 5f, (_e399.r / max(_e401, 0.0001f)));
    star = _e405;
    let _e407 = c2_1;
    let _e409 = c3_;
    let _e412 = c2_1;
    let _e414 = c3_;
    let _e418 = c2_1;
    let _e420 = c3_;
    let _e423 = c2_1;
    let _e425 = c3_;
    c5_ = vec2<f32>(((_e407.x * _e409.x) - (_e412.y * _e414.y)), ((_e418.x * _e420.y) + (_e423.y * _e425.x)));
    let _e431 = c2_1;
    let _e433 = c5_;
    let _e436 = c2_1;
    let _e438 = c5_;
    let _e442 = c2_1;
    let _e444 = c5_;
    let _e447 = c2_1;
    let _e449 = c5_;
    c7_ = vec2<f32>(((_e431.x * _e433.x) - (_e436.y * _e438.y)), ((_e442.x * _e444.y) + (_e447.y * _e449.x)));
    let _e455 = shape;
    let _e457 = shape;
    let _e460 = shape;
    let _e462 = shape;
    let _e466 = shape;
    let _e468 = shape;
    let _e471 = shape;
    let _e473 = shape;
    let _e478 = OVAL;
    let _e479 = lobes;
    let _e481 = amp;
    let _e483 = amp;
    phase_3 = (vec2<f32>(((_e455.x * _e457.z) - (_e460.y * _e462.w)), ((_e466.x * _e468.w) + (_e471.y * _e473.z))) / vec2((((_e478 * _e479) * _e481) * _e483)));
    let _e488 = k_22;
    if _e488.needle {
        let _e490 = star;
        let _e493 = h_23;
        let _e495 = forestU8_(_e493, 16u);
        let _e498 = c5_;
        let _e499 = phase_3;
        let _e503 = c7_;
        let _e504 = shape;
        let _e508 = lobes;
        let _e509 = amp;
        let _e514 = n_12;
        let _e515 = shape;
        let _e519 = OVAL;
        let _e520 = amp;
        local_165 = (_e490 * ((((0.02f + (0.012f * _e495)) * dot(_e498, _e499)) + ((0.015f * dot(_e503, _e504.zw)) / (_e508 * _e509))) + ((0.015f * dot(_e514, _e515.xy)) / (_e519 * _e520))));
    } else {
        local_165 = 0f;
    }
    let _e527 = local_165;
    tips = _e527;
    let _e531 = k_22;
    let _e533 = star;
    if (_e531.needle && (_e533 > 0f)) {
        {
            let _e538 = h_23;
            let _e540 = forestU8_(_e538, 16u);
            branches = (8f + floor((_e540 * 4f)));
            let _e548 = n_12;
            let _e550 = n_12;
            let _e553 = branches;
            let _e555 = a_22;
            lobe = (0.5f + (0.5f * cos(((atan2(_e548.y, _e550.x) * _e553) + _e555.x))));
            let _e562 = star;
            let _e566 = lobe;
            boughs = (_e562 * (-0.035f + (0.055f * _e566)));
        }
    }
    let _e570 = k_22;
    let _e573 = c2_1;
    let _e574 = shape;
    let _e578 = c3_;
    let _e579 = shape;
    let _e582 = k_22;
    if _e582.needle {
        let _e586 = star;
        local_166 = mix(0.3f, 0.8f, _e586);
    } else {
        local_166 = 1f;
    }
    let _e590 = local_166;
    let _e593 = tips;
    let _e595 = boughs;
    return (_e570.r * ((((1f + dot(_e573, _e574.xy)) + (dot(_e578, _e579.zw) * _e590)) + _e593) + _e595));
}

fn forestBrush(k_23: ForestCrown, st_5: ForestStand, d_14: vec2<f32>, aa_2: f32, s_12: f32) -> vec2<f32> {
    var k_24: ForestCrown;
    var st_6: ForestStand;
    var d_15: vec2<f32>;
    var aa_3: f32;
    var s_13: f32;
    var extent: f32;
    var uv_14: vec2<f32>;
    var local_167: i32;
    var local_168: i32;
    var local_169: i32;
    var family: i32;
    var hs: u32;
    var local_170: f32;
    var local_171: i32;
    var layer: f32;
    var lod_4: f32;

    k_24 = k_23;
    st_6 = st_5;
    d_15 = d_14;
    aa_3 = aa_2;
    s_13 = s_12;
    let _e301 = k_24;
    let _e305 = s_13;
    extent = min((1.22f * _e301.r), (1.12f * _e305));
    let _e309 = d_15;
    let _e311 = extent;
    uv_14 = ((_e309 / vec2((2f * _e311))) + vec2(0.5f));
    let _e319 = uv_14;
    let _e324 = uv_14;
    if (any((_e319 < vec2(0f))) || any((_e324 > vec2(1f)))) {
        return vec2<f32>(0f, 0.5f);
    }
    let _e333 = st_6;
    if _e333.orchard {
        local_169 = 1i;
    } else {
        let _e336 = st_6;
        if (_e336.trop > 0.5f) {
            local_168 = 2i;
        } else {
            let _e341 = k_24;
            if _e341.needle {
                local_167 = 0i;
            } else {
                local_167 = 1i;
            }
            let _e346 = local_167;
            local_168 = _e346;
        }
        let _e348 = local_168;
        local_169 = _e348;
    }
    let _e350 = local_169;
    family = _e350;
    let _e352 = st_6;
    let _e355 = st_6;
    let _e360 = global.uMaterialClimate;
    let _e365 = k_24;
    let _e368 = forestU8_(_e365.id, 16u);
    if (((!(_e352.orchard) && (_e355.dry > 0.35f)) && (_e360.x > 10f)) && (_e368 < 0.35f)) {
        family = 3i;
    }
    let _e373 = k_24;
    hs = (_e373.id * 2246822507u);
    let _e378 = st_6;
    let _e381 = hs;
    let _e383 = forestU8_(_e381, 8u);
    let _e384 = k_24;
    let _e386 = forestShrubShare(_e384.h);
    if (!(_e378.orchard) && (_e383 < _e386)) {
        let _e389 = hs;
        let _e391 = forestU8_(_e389, 16u);
        let _e394 = st_6;
        let _e396 = groundSmooth(0.2f, 0.7f, _e394.dry);
        let _e397 = k_24;
        if _e397.riparian {
            local_170 = 0.3f;
        } else {
            local_170 = 1f;
        }
        let _e402 = local_170;
        if (_e391 < (_e396 * _e402)) {
            local_171 = 5i;
        } else {
            local_171 = 4i;
        }
        let _e408 = local_171;
        family = _e408;
    }
    let _e409 = k_24;
    if ((_e409.id & 1u) == 1u) {
        let _e417 = uv_14;
        uv_14.x = (1f - _e417.x);
    }
    let _e420 = family;
    let _e423 = k_24;
    layer = f32(((_e420 * 8i) + i32(((_e423.id >> 4u) & 7u))));
    let _e435 = aa_3;
    let _e438 = extent;
    lod_4 = max(0f, log2(((128f * _e435) / (2f * _e438))));
    let _e444 = uv_14;
    let _e445 = layer;
    let _e448 = vec3<f32>(_e444.x, _e444.y, _e445);
    let _e449 = lod_4;
    let _e453 = textureSampleLevel(uForestBrushAtlas, sLinear, _e448.xy, i32(_e448.z), _e449);
    return _e453.xy;
}

fn forestLeafSpan(needle_5: bool) -> f32 {
    var needle_6: bool;
    var local_172: f32;

    needle_6 = needle_5;
    let _e294 = needle_6;
    if ((uRenderV2_ > 0i) && !(_e294)) {
        let _e299 = v2SeasonLeaf();
        local_172 = mix(0.84f, 1f, _e299);
    } else {
        local_172 = 1f;
    }
    let _e303 = local_172;
    return _e303;
}

fn forestCrowns(hit: ptr<function, ForestHit>, level_3: i32, s_14: f32, st_7: ForestStand, aa_4: f32) {
    var level_4: i32;
    var s_15: f32;
    var st_8: ForestStand;
    var aa_5: f32;
    var local_173: vec2<f32>;
    var cell_14: vec2<i32>;
    var lattice_2: ForestPatch;
    var local_174: f32;
    var umbrella: f32;
    var j_4: i32 = -1i;
    var i_7: i32;
    var k_25: ForestCrown;
    var d_16: vec2<f32>;
    var lean: vec2<f32>;
    var reach_7: f32;
    var dist_2: f32;
    var r_3: f32;
    var a_23: f32;
    var ink: f32;
    var brushTexel: vec2<f32>;
    var delta: f32;
    var d2_: f32;
    var tip_1: f32;
    var local_175: f32;
    var z_5: f32;
    var local_176: f32;
    var g_12: f32;

    level_4 = level_3;
    s_15 = s_14;
    st_8 = st_7;
    aa_5 = aa_4;
    let _e299 = level_4;
    if (_e299 < 0i) {
        let _e302 = st_8;
        let _e304 = st_8;
        let _e306 = orchardGrid(_e302.p, _e304.rows);
        local_173 = _e306;
    } else {
        let _e307 = st_8;
        let _e309 = s_15;
        local_173 = (_e307.p / vec2(_e309));
    }
    let _e313 = local_173;
    cell_14 = vec2<i32>(floor(_e313));
    let _e317 = cell_14;
    let _e318 = s_15;
    let _e319 = forestPatchAround(_e317, _e318);
    lattice_2 = _e319;
    let _e321 = st_8;
    if _e321.orchard {
        local_174 = 0f;
    } else {
        let _e324 = st_8;
        let _e326 = st_8;
        let _e328 = forestKind(_e324.trop, _e326.dry);
        local_174 = _e328.z;
    }
    let _e331 = local_174;
    umbrella = _e331;
    loop {
        let _e336 = j_4;
        if !((_e336 <= 1i)) {
            break;
        }
        i_7 = -1i;
        loop {
            let _e346 = i_7;
            if !((_e346 <= 1i)) {
                break;
            }
            {
                let _e354 = level_4;
                if (_e354 < 0i) {
                    let _e357 = cell_14;
                    let _e358 = i_7;
                    let _e359 = j_4;
                    let _e362 = st_8;
                    let _e363 = orchardCrown((_e357 + vec2<i32>(_e358, _e359)), _e362);
                    k_25 = _e363;
                } else {
                    let _e364 = cell_14;
                    let _e365 = i_7;
                    let _e366 = j_4;
                    let _e369 = level_4;
                    let _e370 = s_15;
                    let _e371 = st_8;
                    let _e372 = lattice_2;
                    let _e373 = forestCrown((_e364 + vec2<i32>(_e365, _e366)), _e369, _e370, _e371, _e372);
                    k_25 = _e373;
                }
                let _e374 = k_25;
                if !(_e374.alive) {
                    continue;
                }
                let _e377 = st_8;
                let _e379 = k_25;
                d_16 = (_e377.p - _e379.c);
                let _e383 = k_25;
                if (_e383.needle && (uForestBrushes == 0i)) {
                    {
                        let _e388 = k_25;
                        let _e391 = forestU8_(_e388.id, 16u);
                        let _e392 = k_25;
                        let _e395 = forestU8_(_e392.id, 24u);
                        lean = (vec2<f32>(_e391, _e395) - vec2(0.5f));
                        let _e401 = d_16;
                        let _e403 = k_25;
                        reach_7 = clamp((length(_e401) / max(_e403.r, 0.001f)), 0f, 1f);
                        let _e412 = d_16;
                        let _e413 = lean;
                        let _e414 = k_25;
                        let _e420 = reach_7;
                        d_16 = (_e412 - (((_e413 * _e414.r) * 0.24f) * (1f - _e420)));
                    }
                }
                let _e424 = d_16;
                dist_2 = length(_e424);
                let _e427 = dist_2;
                let _e429 = k_25;
                let _e432 = aa_5;
                if (_e427 >= ((2f * _e429.r) + _e432)) {
                    continue;
                }
                let _e435 = k_25;
                r_3 = _e435.r;
                a_23 = 0f;
                ink = 0.5f;
                if (uForestBrushes == 1i) {
                    {
                        let _e444 = k_25;
                        let _e445 = st_8;
                        let _e446 = d_16;
                        let _e447 = aa_5;
                        let _e448 = s_15;
                        let _e449 = forestBrush(_e444, _e445, _e446, _e447, _e448);
                        brushTexel = _e449;
                        let _e451 = brushTexel;
                        a_23 = _e451.x;
                        let _e453 = brushTexel;
                        ink = _e453.y;
                        let _e456 = (*hit);
                        let _e458 = dist_2;
                        let _e459 = r_3;
                        (*hit).near = min(_e456.near, (_e458 / _e459));
                        let _e462 = a_23;
                        if (_e462 < 0.002f) {
                            continue;
                        }
                    }
                } else {
                    {
                        let _e465 = k_25;
                        let _e466 = d_16;
                        let _e467 = dist_2;
                        let _e472 = aa_5;
                        let _e473 = forestOutline(_e465, (_e466 / vec2(max(_e467, 0.0001f))), _e472);
                        let _e474 = k_25;
                        let _e476 = forestLeafSpan(_e474.needle);
                        r_3 = (_e473 * _e476);
                        let _e479 = (*hit);
                        let _e481 = dist_2;
                        let _e482 = r_3;
                        (*hit).near = min(_e479.near, (_e481 / _e482));
                        let _e485 = dist_2;
                        let _e486 = r_3;
                        let _e487 = aa_5;
                        if (_e485 >= (_e486 + _e487)) {
                            continue;
                        }
                        let _e490 = r_3;
                        let _e491 = dist_2;
                        let _e493 = aa_5;
                        a_23 = clamp((((_e490 - _e491) / _e493) + 0.5f), 0f, 1f);
                    }
                }
                let _e500 = dist_2;
                let _e501 = r_3;
                delta = min((_e500 / _e501), 1f);
                let _e506 = delta;
                let _e507 = delta;
                d2_ = (_e506 * _e507);
                let _e510 = d2_;
                tip_1 = sqrt((_e510 + 0.006f));
                let _e515 = k_25;
                let _e517 = k_25;
                let _e519 = k_25;
                if _e519.needle {
                    let _e521 = tip_1;
                    local_175 = _e521;
                } else {
                    let _e522 = d2_;
                    let _e523 = d2_;
                    let _e524 = d2_;
                    let _e526 = umbrella;
                    local_175 = mix(_e522, (_e523 * _e524), _e526);
                }
                let _e529 = local_175;
                z_5 = (_e515.h - (_e517.depth * _e529));
                let _e536 = (*hit);
                let _e540 = a_23;
                (*hit).cover = (1f - ((1f - _e536.cover) * (1f - _e540)));
                let _e544 = z_5;
                let _e545 = (*hit);
                if (_e544 > _e545.top) {
                    {
                        let _e549 = (*hit);
                        (*hit).second = _e549.top;
                        let _e552 = z_5;
                        (*hit).top = _e552;
                        let _e553 = k_25;
                        let _e555 = k_25;
                        let _e558 = k_25;
                        if _e558.needle {
                            let _e560 = delta;
                            let _e561 = tip_1;
                            local_176 = (_e560 / _e561);
                        } else {
                            let _e564 = delta;
                            let _e567 = delta;
                            let _e569 = d2_;
                            let _e571 = umbrella;
                            local_176 = mix((2f * _e564), ((4f * _e567) * _e569), _e571);
                        }
                        let _e574 = local_176;
                        g_12 = ((_e553.depth / _e555.r) * _e574);
                        let _e578 = g_12;
                        let _e580 = d_16;
                        let _e582 = dist_2;
                        (*hit).slope = ((-(_e578) * _e580) / vec2(max(_e582, 0.0001f)));
                        let _e588 = delta;
                        (*hit).rel = _e588;
                        let _e590 = d_16;
                        let _e591 = r_3;
                        (*hit).local = (_e590 / vec2(_e591));
                        let _e595 = r_3;
                        (*hit).r = _e595;
                        let _e597 = k_25;
                        (*hit).needle = _e597.needle;
                        let _e600 = k_25;
                        (*hit).riparian = _e600.riparian;
                        let _e603 = k_25;
                        (*hit).edge = _e603.edge;
                        let _e606 = k_25;
                        (*hit).id = _e606.id;
                        let _e609 = level_4;
                        (*hit).level = _e609;
                        let _e611 = ink;
                        (*hit).ink = _e611;
                    }
                } else {
                    let _e613 = (*hit);
                    let _e615 = z_5;
                    (*hit).second = max(_e613.second, _e615);
                }
            }
            continuing {
                let _e350 = i_7;
                i_7 = (_e350 + 1i);
            }
        }
        continuing {
            let _e340 = j_4;
            j_4 = (_e340 + 1i);
        }
    }
    return;
}

fn forestTaper(p_30: vec2<f32>, ab: vec2<f32>, ra: f32, rb: f32) -> f32 {
    var p_31: vec2<f32>;
    var ab_1: vec2<f32>;
    var ra_1: f32;
    var rb_1: f32;
    var h_24: f32;
    var b_17: f32;
    var q_13: vec2<f32>;
    var c_27: vec2<f32>;
    var k_26: f32;
    var local_177: f32;
    var local_178: f32;

    p_31 = p_30;
    ab_1 = ab;
    ra_1 = ra;
    rb_1 = rb;
    let _e298 = ab_1;
    let _e299 = ab_1;
    h_24 = dot(_e298, _e299);
    let _e302 = ra_1;
    let _e303 = rb_1;
    b_17 = (_e302 - _e303);
    let _e306 = h_24;
    let _e307 = b_17;
    let _e308 = b_17;
    if (_e306 <= ((_e307 * _e308) + 0.0001f)) {
        let _e313 = p_31;
        let _e315 = ra_1;
        return (length(_e313) - _e315);
    }
    let _e317 = p_31;
    let _e318 = ab_1;
    let _e320 = ab_1;
    let _e326 = p_31;
    let _e327 = ab_1;
    let _e330 = h_24;
    q_13 = (vec2<f32>(abs(dot(_e317, vec2<f32>(_e318.y, -(_e320.x)))), dot(_e326, _e327)) / vec2(_e330));
    let _e334 = h_24;
    let _e335 = b_17;
    let _e336 = b_17;
    let _e340 = b_17;
    c_27 = vec2<f32>(sqrt((_e334 - (_e335 * _e336))), _e340);
    let _e343 = c_27;
    let _e345 = q_13;
    let _e348 = c_27;
    let _e350 = q_13;
    k_26 = ((_e343.x * _e345.y) - (_e348.y * _e350.x));
    let _e355 = k_26;
    if (_e355 < 0f) {
        let _e358 = h_24;
        let _e359 = q_13;
        let _e360 = q_13;
        let _e364 = ra_1;
        local_178 = (sqrt((_e358 * dot(_e359, _e360))) - _e364);
    } else {
        let _e366 = k_26;
        let _e367 = c_27;
        if (_e366 > _e367.x) {
            let _e370 = h_24;
            let _e371 = q_13;
            let _e372 = q_13;
            let _e377 = q_13;
            let _e383 = rb_1;
            local_177 = (sqrt((_e370 * ((dot(_e371, _e372) + 1f) - (2f * _e377.y)))) - _e383);
        } else {
            let _e385 = c_27;
            let _e386 = q_13;
            let _e388 = ra_1;
            local_177 = (dot(_e385, _e386) - _e388);
        }
        let _e391 = local_177;
        local_178 = _e391;
    }
    let _e393 = local_178;
    return _e393;
}

fn forestShadow(hit_1: ForestHit, level_5: i32, s_16: f32, st_9: ForestStand, aa_6: f32, zp: f32, sun_2: vec2<f32>, cot: f32) -> f32 {
    var hit_2: ForestHit;
    var level_6: i32;
    var s_17: f32;
    var st_10: ForestStand;
    var aa_7: f32;
    var zp_1: f32;
    var sun_3: vec2<f32>;
    var cot_1: f32;
    var from_: vec2<f32>;
    var local_179: vec2<f32>;
    var cell_15: vec2<i32>;
    var lattice_3: ForestPatch;
    var shade: f32 = 0f;
    var j_5: i32 = -1i;
    var i_8: i32;
    var k_27: ForestCrown;
    var foot: f32;
    var apex: f32;
    var rb_2: f32;
    var low: f32;
    var p_32: vec2<f32>;
    var wedge: f32;
    var caster: f32;
    var o_3: f32;
    var local_180: f32;
    var penumbra: f32;
    var d_17: vec2<f32>;
    var sd: f32;

    hit_2 = hit_1;
    level_6 = level_5;
    s_17 = s_16;
    st_10 = st_9;
    aa_7 = aa_6;
    zp_1 = zp;
    sun_3 = sun_2;
    cot_1 = cot;
    let _e306 = st_10;
    let _e308 = sun_3;
    let _e309 = st_10;
    let _e313 = st_10;
    let _e317 = zp_1;
    let _e322 = cot_1;
    from_ = (_e306.p + ((_e308 * max(((_e309.height * mix(0.75f, 0.45f, _e313.needle)) - _e317), 0f)) * _e322));
    let _e326 = level_6;
    if (_e326 < 0i) {
        let _e329 = from_;
        let _e330 = st_10;
        let _e332 = orchardGrid(_e329, _e330.rows);
        local_179 = _e332;
    } else {
        let _e333 = from_;
        let _e334 = s_17;
        local_179 = (_e333 / vec2(_e334));
    }
    let _e338 = local_179;
    cell_15 = vec2<i32>(floor(_e338));
    let _e342 = cell_15;
    let _e343 = s_17;
    let _e344 = forestPatchAround(_e342, _e343);
    lattice_3 = _e344;
    loop {
        let _e351 = j_5;
        if !((_e351 <= 1i)) {
            break;
        }
        i_8 = -1i;
        loop {
            let _e361 = i_8;
            if !((_e361 <= 1i)) {
                break;
            }
            {
                let _e369 = level_6;
                if (_e369 < 0i) {
                    let _e372 = cell_15;
                    let _e373 = i_8;
                    let _e374 = j_5;
                    let _e377 = st_10;
                    let _e378 = orchardCrown((_e372 + vec2<i32>(_e373, _e374)), _e377);
                    k_27 = _e378;
                } else {
                    let _e379 = cell_15;
                    let _e380 = i_8;
                    let _e381 = j_5;
                    let _e384 = level_6;
                    let _e385 = s_17;
                    let _e386 = st_10;
                    let _e387 = lattice_3;
                    let _e388 = forestCrown((_e379 + vec2<i32>(_e380, _e381)), _e384, _e385, _e386, _e387);
                    k_27 = _e388;
                }
                let _e389 = k_27;
                let _e392 = hit_2;
                let _e394 = level_6;
                let _e396 = k_27;
                let _e398 = hit_2;
                let _e402 = hit_2;
                if (!(_e389.alive) || (((_e392.level == _e394) && (_e396.id == _e398.id)) && (_e402.cover > 0f))) {
                    continue;
                }
                let _e408 = k_27;
                if _e408.needle {
                    {
                        let _e410 = k_27;
                        let _e412 = k_27;
                        let _e416 = k_27;
                        foot = min((_e410.h - _e412.depth), (0.1f * _e416.h));
                        let _e421 = k_27;
                        let _e423 = zp_1;
                        let _e425 = cot_1;
                        let _e428 = k_27;
                        apex = min(((_e421.h - _e423) * _e425), (1.6f * _e428.r));
                        let _e433 = apex;
                        if (_e433 <= 0f) {
                            continue;
                        }
                        let _e436 = k_27;
                        let _e438 = k_27;
                        let _e440 = foot;
                        let _e441 = zp_1;
                        let _e444 = k_27;
                        let _e446 = foot;
                        rb_2 = (_e436.r * clamp(((_e438.h - max(_e440, _e441)) / max((_e444.h - _e446), 0.001f)), 0f, 1f));
                        let _e456 = foot;
                        let _e457 = zp_1;
                        let _e461 = cot_1;
                        low = (max((_e456 - _e457), 0f) * _e461);
                        let _e464 = st_10;
                        let _e466 = k_27;
                        let _e468 = sun_3;
                        let _e469 = low;
                        p_32 = (_e464.p - (_e466.c - (_e468 * _e469)));
                        let _e474 = p_32;
                        let _e475 = sun_3;
                        let _e477 = apex;
                        let _e478 = low;
                        let _e482 = k_27;
                        let _e483 = p_32;
                        let _e484 = p_32;
                        let _e490 = aa_7;
                        let _e491 = forestOutline(_e482, (_e483 / vec2(max(length(_e484), 0.0001f))), _e490);
                        let _e493 = rb_2;
                        let _e495 = k_27;
                        let _e501 = k_27;
                        let _e504 = forestTaper(_e474, (-(_e475) * (_e477 - _e478)), (((0.92f * _e491) * _e493) / max(_e495.r, 0.001f)), (0.04f * _e501.r));
                        wedge = _e504;
                        let _e506 = shade;
                        let _e508 = wedge;
                        let _e510 = aa_7;
                        let _e512 = k_27;
                        let _e516 = apex;
                        shade = max(_e506, (0.9f * clamp(((-(_e508) / max(_e510, ((0.12f * _e512.r) + (0.04f * _e516)))) + 0.5f), 0f, 1f)));
                        continue;
                    }
                }
                let _e528 = k_27;
                let _e531 = k_27;
                caster = (_e528.h - (0.5f * _e531.depth));
                let _e536 = caster;
                let _e537 = zp_1;
                let _e539 = cot_1;
                o_3 = ((_e536 - _e537) * _e539);
                let _e542 = o_3;
                if (_e542 <= 0f) {
                    continue;
                }
                let _e545 = aa_7;
                let _e546 = k_27;
                if _e546.needle {
                    local_180 = 0.12f;
                } else {
                    local_180 = 0.22f;
                }
                let _e551 = local_180;
                let _e552 = k_27;
                let _e556 = o_3;
                penumbra = max(_e545, ((_e551 * _e552.r) + (0.055f * _e556)));
                let _e561 = st_10;
                let _e563 = k_27;
                let _e565 = sun_3;
                let _e566 = o_3;
                d_17 = (_e561.p - (_e563.c - (_e565 * _e566)));
                let _e571 = d_17;
                sd = length(_e571);
                let _e574 = sd;
                let _e576 = k_27;
                let _e579 = penumbra;
                if (_e574 >= ((1.3f * _e576.r) + _e579)) {
                    continue;
                }
                let _e582 = shade;
                let _e584 = k_27;
                let _e585 = d_17;
                let _e586 = sd;
                let _e591 = aa_7;
                let _e592 = forestOutline(_e584, (_e585 / vec2(max(_e586, 0.0001f))), _e591);
                let _e594 = sd;
                let _e596 = penumbra;
                shade = max(_e582, clamp(((((0.92f * _e592) - _e594) / _e596) + 0.5f), 0f, 1f));
            }
            continuing {
                let _e365 = i_8;
                i_8 = (_e365 + 1i);
            }
        }
        continuing {
            let _e355 = j_5;
            j_5 = (_e355 + 1i);
        }
    }
    let _e604 = shade;
    return _e604;
}

fn forestPalette(st_11: ForestStand, needle_7: f32) -> vec3<f32> {
    var st_12: ForestStand;
    var needle_8: f32;
    var broad_2: vec3<f32>;

    st_12 = st_11;
    needle_8 = needle_7;
    let _e302 = st_12;
    broad_2 = mix(vec3<f32>(0.21f, 0.31f, 0.13f), vec3<f32>(0.16f, 0.3f, 0.11f), vec3(_e302.trop));
    let _e307 = broad_2;
    let _e312 = st_12;
    let _e316 = st_12;
    broad_2 = mix(_e307, vec3<f32>(0.31f, 0.32f, 0.19f), vec3((_e312.dry * (1f - (0.5f * _e316.trop)))));
    let _e323 = broad_2;
    let _e332 = st_12;
    let _e336 = needle_8;
    return mix(_e323, mix(vec3<f32>(0.15f, 0.25f, 0.16f), vec3<f32>(0.2f, 0.24f, 0.15f), vec3(_e332.dry)), vec3(_e336));
}

fn forestSeason() -> vec3<f32> {
    var local_181: f32;
    var t_17: f32;
    var s_18: f32;

    if (uRenderV2_ > 0i) {
        let _e293 = global.uV2Season;
        local_181 = _e293;
    } else {
        local_181 = 0.5f;
    }
    let _e296 = local_181;
    t_17 = (6.2831855f * _e296);
    let _e299 = t_17;
    s_18 = sin(_e299);
    let _e302 = s_18;
    let _e306 = s_18;
    let _e311 = t_17;
    return vec3<f32>(max(-(_e302), 0f), max(_e306, 0f), (0.5f - (0.5f * cos(_e311))));
}

fn forestGrade(st_13: ForestStand, needle_9: f32) -> vec3<f32> {
    var st_14: ForestStand;
    var needle_10: f32;
    var kind_1: vec3<f32>;
    var season_1: vec3<f32>;
    var temperate: vec3<f32>;
    var savanna_1: vec3<f32>;
    var broad_3: vec3<f32>;

    st_14 = st_13;
    needle_10 = needle_9;
    let _e294 = st_14;
    let _e296 = st_14;
    let _e298 = forestKind(_e294.trop, _e296.dry);
    kind_1 = _e298;
    let _e300 = forestSeason();
    season_1 = _e300;
    let _e310 = season_1;
    let _e319 = season_1;
    temperate = mix(mix(vec3<f32>(1.02f, 1.04f, 0.92f), vec3<f32>(1.1f, 1.1f, 0.82f), vec3(_e310.y)), vec3<f32>(1.5f, 0.98f, 0.5f), vec3((0.75f * _e319.x)));
    let _e333 = season_1;
    savanna_1 = mix(vec3<f32>(1.12f, 1f, 0.66f), vec3<f32>(0.94f, 1.02f, 0.76f), vec3(_e333.z));
    let _e338 = temperate;
    let _e340 = kind_1;
    let _e343 = kind_1;
    let _e346 = kind_1;
    let _e354 = kind_1;
    let _e362 = kind_1;
    let _e366 = savanna_1;
    let _e367 = kind_1;
    broad_3 = ((((_e338 * (((1f - _e340.x) - _e343.y) - _e346.z)) + (vec3<f32>(0.58f, 0.68f, 0.66f) * _e354.x)) + (vec3<f32>(0.7f, 1.06f, 0.62f) * _e362.y)) + (_e366 * _e367.z));
    let _e372 = broad_3;
    let _e381 = season_1;
    let _e385 = needle_10;
    return mix(_e372, mix(vec3<f32>(0.6f, 0.7f, 0.7f), vec3<f32>(0.62f, 0.76f, 0.74f), vec3(_e381.z)), vec3(_e385));
}

fn forestGuide() -> vec3<f32> {
    var local_182: vec3<f32>;

    if (uRenderV2_ > 0i) {
        let _e292 = v2CrownGuide;
        local_182 = _e292;
    } else {
        let _e293 = renderGuideClosed;
        local_182 = _e293;
    }
    let _e295 = local_182;
    return _e295;
}

fn forestSnowed(crown: vec3<f32>, load: f32) -> vec3<f32> {
    var crown_1: vec3<f32>;
    var load_1: f32;

    crown_1 = crown;
    load_1 = load;
    let _e294 = crown_1;
    let _e299 = load_1;
    return mix(_e294, vec3<f32>(0.84f, 0.88f, 0.9f), vec3(_e299));
}

fn forestSnowLoad(needle_11: f32) -> f32 {
    var needle_12: f32;
    var c_28: f32;

    needle_12 = needle_11;
    let _e292 = v2SeasonCrownSnow();
    c_28 = _e292;
    let _e296 = c_28;
    let _e300 = c_28;
    let _e302 = needle_12;
    return mix(mix(0.2f, 0.8f, _e296), mix(0.24f, 0.62f, _e300), _e302);
}

fn forestCrownShow(leaf: f32) -> f32 {
    var leaf_1: f32;

    leaf_1 = leaf;
    let _e293 = leaf_1;
    let _e295 = leaf_1;
    return (_e293 + (FOREST_BARE * (1f - _e295)));
}

fn forestBareColor(tint_1: f32, wood: f32) -> vec3<f32> {
    var tint_2: f32;
    var wood_1: f32;

    tint_2 = tint_1;
    wood_1 = wood;
    let _e303 = wood_1;
    let _e308 = tint_2;
    return (mix(vec3<f32>(0.37f, 0.33f, 0.315f), vec3<f32>(0.2f, 0.17f, 0.155f), vec3(_e303)) * (0.88f + (0.24f * _e308)));
}

fn forestLine(d_18: f32, w_8: f32) -> f32 {
    var d_19: f32;
    var w_9: f32;

    d_19 = d_18;
    w_9 = w_8;
    let _e295 = w_9;
    let _e300 = d_19;
    let _e306 = w_9;
    return (clamp(((max(_e295, 0.5f) + 0.5f) - _e300), 0f, 1f) * min((2f * _e306), 1f));
}

fn forestBareCrown(rel: f32, slope_6: vec2<f32>, tint_3: f32, pixels: f32) -> vec2<f32> {
    var rel_1: f32;
    var slope_7: vec2<f32>;
    var tint_4: f32;
    var pixels_1: f32;
    var bare_3: vec2<f32>;
    var detail_4: f32;
    var h_25: u32;
    var limbs: f32;
    var a_24: f32;
    var v_16: f32;
    var s_19: f32;
    var o_4: f32;
    var hl: u32;
    var rf: f32;
    var spread: f32;
    var local_183: f32;
    var side_2: f32;
    var t_18: f32;
    var split: f32;
    var scale_3: f32;
    var limb: f32;
    var o2_: f32;
    var twig: f32;
    var wood_2: f32;
    var cover_6: f32;

    rel_1 = rel;
    slope_7 = slope_6;
    tint_4 = tint_3;
    pixels_1 = pixels;
    let _e303 = rel_1;
    let _e304 = rel_1;
    bare_3 = vec2<f32>((0.67f * (1f - (_e303 * _e304))), 0.25f);
    let _e313 = pixels_1;
    let _e314 = groundSmooth(3f, 8f, _e313);
    detail_4 = _e314;
    let _e316 = detail_4;
    if (_e316 > 0f) {
        {
            let _e319 = tint_4;
            h_25 = (u32((_e319 * 65536f)) * 2654435769u);
            let _e327 = h_25;
            let _e329 = forestU8_(_e327, 0u);
            limbs = (3f + floor((_e329 * 4f)));
            let _e335 = slope_7;
            let _e337 = slope_7;
            a_24 = atan2(_e335.y, _e337.x);
            let _e341 = a_24;
            let _e343 = a_24;
            let _e345 = h_25;
            let _e347 = forestU8_(_e345, 8u);
            let _e354 = a_24;
            let _e357 = h_25;
            let _e359 = forestU8_(_e357, 16u);
            a_24 = (_e341 + ((0.3f * sin((_e343 + (6.2831855f * _e347)))) + (0.15f * sin(((2f * _e354) + (6.2831855f * _e359))))));
            let _e366 = a_24;
            let _e367 = limbs;
            let _e371 = h_25;
            let _e373 = forestU8_(_e371, 24u);
            v_16 = (((_e366 * _e367) / 6.2831855f) + _e373);
            let _e376 = v_16;
            s_19 = floor((_e376 + 0.5f));
            let _e381 = v_16;
            let _e382 = s_19;
            o_4 = (_e381 - _e382);
            let _e385 = s_19;
            let _e386 = limbs;
            let _e396 = h_25;
            hl = (((u32((_e385 - (floor((_e385 / _e386)) * _e386))) + 1u) * 2246822507u) ^ _e396);
            let _e401 = hl;
            let _e403 = forestU8_(_e401, 8u);
            rf = (0.3f + (0.35f * _e403));
            let _e409 = hl;
            let _e411 = forestU8_(_e409, 16u);
            spread = (0.18f + (0.14f * _e411));
            let _e415 = hl;
            let _e417 = forestU8_(_e415, 24u);
            if (_e417 < 0.5f) {
                local_183 = -1f;
            } else {
                local_183 = 1f;
            }
            let _e424 = local_183;
            side_2 = _e424;
            let _e426 = o_4;
            let _e427 = hl;
            let _e429 = forestU8_(_e427, 0u);
            let _e434 = rel_1;
            let _e436 = rel_1;
            let _e440 = rel_1;
            let _e443 = hl;
            let _e445 = forestU8_(_e443, 4u);
            o_4 = (_e426 - (((((_e429 - 0.5f) * 0.3f) * _e434) * _e436) + (0.035f * sin(((9f * _e440) + (6.2831855f * _e445))))));
            let _e452 = rel_1;
            let _e453 = rf;
            t_18 = max((_e452 - _e453), 0f);
            let _e458 = o_4;
            let _e459 = side_2;
            let _e460 = spread;
            let _e462 = t_18;
            let _e466 = o_4;
            let _e467 = side_2;
            let _e470 = spread;
            let _e472 = t_18;
            split = min(abs((_e458 - ((_e459 * _e460) * _e462))), abs((_e466 + (((_e467 * 0.3f) * _e470) * _e472))));
            let _e479 = limbs;
            let _e481 = rel_1;
            let _e483 = pixels_1;
            scale_3 = (((6.2831855f / _e479) * _e481) * _e483);
            let _e486 = split;
            let _e487 = scale_3;
            let _e489 = pixels_1;
            let _e492 = rel_1;
            let _e500 = t_18;
            let _e501 = groundSmooth(0f, 0.1f, _e500);
            let _e505 = forestLine((_e486 * _e487), ((_e489 * (0.045f - (0.035f * _e492))) * (1f - (0.25f * _e501))));
            limb = _e505;
            let _e508 = v_16;
            let _e511 = rel_1;
            let _e514 = a_24;
            let _e517 = h_25;
            let _e519 = forestU8_(_e517, 12u);
            o2_ = ((3f * _e508) + ((0.6f * _e511) * sin(((2f * _e514) + (6.2831855f * _e519)))));
            let _e526 = o2_;
            let _e527 = o2_;
            o2_ = (_e526 - floor((_e527 + 0.5f)));
            let _e533 = o2_;
            let _e535 = scale_3;
            let _e539 = pixels_1;
            let _e542 = forestLine(((abs(_e533) * _e535) / 3f), (_e539 * 0.007f));
            let _e546 = rel_1;
            let _e547 = groundSmooth(0.2f, 0.45f, _e546);
            twig = ((0.5f * _e542) * _e547);
            let _e550 = limb;
            let _e551 = rel_1;
            let _e552 = pixels_1;
            let _e555 = pixels_1;
            let _e559 = forestLine((_e551 * _e552), max((0.05f * _e555), 0.6f));
            wood_2 = max(_e550, _e559);
            let _e564 = wood_2;
            let _e569 = rel_1;
            let _e570 = rel_1;
            let _e572 = rel_1;
            let _e579 = twig;
            cover_6 = (1f - (((1f - _e564) * (1f - (0.45f * (1f - ((_e569 * _e570) * _e572))))) * (1f - _e579)));
            let _e584 = bare_3;
            let _e585 = cover_6;
            let _e586 = wood_2;
            let _e587 = cover_6;
            let _e592 = detail_4;
            bare_3 = mix(_e584, vec2<f32>(_e585, (_e586 / max(_e587, 0.001f))), vec2(_e592));
        }
    }
    let _e595 = bare_3;
    return _e595;
}

fn forestCanopy(st_15: ForestStand, needle_13: f32, jitter_1: vec2<f32>, special: f32) -> vec3<f32> {
    var st_16: ForestStand;
    var needle_14: f32;
    var jitter_2: vec2<f32>;
    var special_1: f32;
    var c_29: vec3<f32>;
    var kind_2: vec3<f32>;
    var temperate_1: f32;
    var t_19: f32;
    var amp_1: f32;
    var local_184: vec3<f32>;
    var local_185: vec3<f32>;
    var local_186: vec3<f32>;
    var accent: vec3<f32>;

    st_16 = st_15;
    needle_14 = needle_13;
    jitter_2 = jitter_1;
    special_1 = special;
    let _e299 = st_16;
    let _e300 = needle_14;
    let _e301 = forestPalette(_e299, _e300);
    c_29 = _e301;
    let _e303 = st_16;
    let _e305 = st_16;
    let _e307 = forestKind(_e303.trop, _e305.dry);
    kind_2 = _e307;
    let _e310 = kind_2;
    let _e313 = kind_2;
    let _e316 = kind_2;
    temperate_1 = (((1f - _e310.x) - _e313.y) - _e316.z);
    let _e320 = st_16;
    t_19 = (_e320.tone - 0.5f);
    let _e325 = c_29;
    let _e328 = t_19;
    c_29 = (_e325 * (1f + (0.34f * _e328)));
    let _e332 = c_29;
    let _e333 = c_29;
    let _e339 = t_19;
    c_29 = mix(_e332, (_e333 * vec3<f32>(1.12f, 1.07f, 0.78f)), vec3((max(_e339, 0f) * 0.9f)));
    let _e346 = c_29;
    let _e347 = c_29;
    let _e353 = t_19;
    c_29 = mix(_e346, (_e347 * vec3<f32>(0.9f, 0.97f, 1.08f)), vec3((max(-(_e353), 0f) * 0.7f)));
    let _e363 = temperate_1;
    let _e366 = st_16;
    let _e371 = needle_14;
    amp_1 = (mix(mix(0.09f, 0.14f, _e363), 0.2f, _e366.trop) * (1f - (0.45f * _e371)));
    let _e376 = c_29;
    let _e378 = amp_1;
    let _e379 = jitter_2;
    c_29 = (_e376 * (1f + (_e378 * _e379.x)));
    let _e384 = c_29;
    let _e385 = c_29;
    let _e391 = jitter_2;
    let _e395 = amp_1;
    c_29 = mix(_e384, (_e385 * vec3<f32>(1.12f, 1.06f, 0.72f)), vec3(((max(_e391.y, 0f) * _e395) * 2.2f)));
    let _e401 = c_29;
    let _e402 = c_29;
    let _e408 = jitter_2;
    let _e413 = amp_1;
    c_29 = mix(_e401, (_e402 * vec3<f32>(0.84f, 0.97f, 1.12f)), vec3(((max(-(_e408.y), 0f) * _e413) * 1.6f)));
    let _e419 = c_29;
    let _e422 = jitter_2;
    if (_e422.y > 0f) {
        local_184 = vec3<f32>(1.3f, 1.04f, 0.62f);
    } else {
        local_184 = vec3<f32>(1.3f, 0.72f, 0.66f);
    }
    let _e435 = local_184;
    let _e436 = jitter_2;
    let _e439 = forestSeason();
    let _e442 = temperate_1;
    let _e445 = needle_14;
    let _e450 = jitter_2;
    c_29 = (_e419 * mix(vec3(1f), _e435, vec3(((((abs(_e436.y) * _e439.x) * _e442) * (1f - _e445)) * (0.6f + (0.4f * _e450.x))))));
    let _e458 = special_1;
    if (_e458 < 0.45f) {
        local_186 = vec3<f32>(0.4f, 0.42f, 0.19f);
    } else {
        let _e465 = special_1;
        if (_e465 < 0.8f) {
            local_185 = vec3<f32>(0.4f, 0.3f, 0.22f);
        } else {
            local_185 = vec3<f32>(0.36f, 0.38f, 0.32f);
        }
        let _e477 = local_185;
        local_186 = _e477;
    }
    let _e479 = local_186;
    accent = _e479;
    let _e481 = c_29;
    let _e482 = accent;
    let _e483 = st_16;
    let _e487 = special_1;
    let _e491 = groundSmooth(0.965f, 0.99f, fract((_e487 * 7.31f)));
    return mix(_e481, _e482, vec3(((_e483.trop * _e491) * 0.6f)));
}

fn forestCrownColor(st_17: ForestStand, guide: vec3<f32>, needle_15: f32, jitter_3: vec2<f32>, special_2: f32) -> vec3<f32> {
    var st_18: ForestStand;
    var guide_1: vec3<f32>;
    var needle_16: f32;
    var jitter_4: vec2<f32>;
    var special_3: f32;

    st_18 = st_17;
    guide_1 = guide;
    needle_16 = needle_15;
    jitter_4 = jitter_3;
    special_3 = special_2;
    let _e301 = st_18;
    if _e301.orchard {
        let _e311 = forestSeason();
        let _e317 = jitter_4;
        return (mix(vec3<f32>(0.25f, 0.34f, 0.15f), vec3<f32>(0.22f, 0.37f, 0.16f), vec3(_e311.z)) * (0.86f + (0.28f * ((_e317.x * 0.5f) + 0.5f))));
    }
    let _e326 = guide_1;
    let _e327 = st_18;
    let _e328 = needle_16;
    let _e329 = forestGrade(_e327, _e328);
    let _e331 = st_18;
    let _e332 = needle_16;
    let _e333 = jitter_4;
    let _e334 = special_3;
    let _e335 = forestCanopy(_e331, _e332, _e333, _e334);
    let _e337 = st_18;
    let _e338 = st_18;
    let _e340 = forestPalette(_e337, _e338.needle);
    return (((_e326 * _e329) * _e335) / max(_e340, vec3(0.02f)));
}

fn forestFloor(ground_1: vec3<f32>, st_19: ForestStand, cold: f32) -> vec3<f32> {
    var ground_2: vec3<f32>;
    var st_20: ForestStand;
    var cold_1: f32;
    var litter: vec3<f32>;
    var kind_3: vec3<f32>;

    ground_2 = ground_1;
    st_20 = st_19;
    cold_1 = cold;
    let _e305 = st_20;
    litter = mix(vec3<f32>(0.26f, 0.21f, 0.15f), vec3<f32>(0.24f, 0.21f, 0.15f), vec3(_e305.needle));
    let _e310 = st_20;
    let _e312 = st_20;
    let _e314 = forestKind(_e310.trop, _e312.dry);
    kind_3 = _e314;
    let _e316 = litter;
    let _e321 = kind_3;
    litter = mix(_e316, vec3<f32>(0.15f, 0.24f, 0.1f), vec3(_e321.y));
    let _e325 = litter;
    let _e330 = kind_3;
    let _e332 = kind_3;
    litter = mix(_e325, vec3<f32>(0.6f, 0.54f, 0.42f), vec3((_e330.x + _e332.z)));
    let _e337 = litter;
    let _e347 = st_20;
    let _e352 = cold_1;
    let _e353 = st_20;
    litter = mix(_e337, mix(vec3<f32>(0.27f, 0.32f, 0.18f), vec3<f32>(0.58f, 0.58f, 0.48f), vec3((0.7f * _e347.dry))), vec3((_e352 * _e353.needle)));
    if (uRenderV2_ > 0i) {
        {
            let _e360 = ground_2;
            let _e363 = v2GroundSnow;
            let _e364 = st_20;
            ground_2 = (_e360 * mix(1f, 0.42f, (_e363 * _e364.needle)));
            let _e369 = litter;
            let _e370 = ground_2;
            let _e371 = v2GroundSnow;
            let _e374 = st_20;
            litter = mix(_e369, _e370, vec3((_e371 * (1f - (0.6f * _e374.needle)))));
        }
    }
    let _e381 = ground_2;
    let _e382 = litter;
    let _e386 = st_20;
    return mix(_e381, _e382, vec3((0.65f * (1f - (0.6f * _e386.dry)))));
}

fn forestFloorAlbedo(color_9: vec3<f32>) -> vec3<f32> {
    var color_10: vec3<f32>;
    var local_187: f32;

    color_10 = color_9;
    let _e293 = color_10;
    if (uRenderV2_ > 0i) {
        let _e296 = v2FloorModulation;
        local_187 = _e296;
    } else {
        local_187 = 1f;
    }
    let _e299 = local_187;
    let _e301 = groundToLinear((_e293 * _e299));
    return _e301;
}

fn forestClosure(cover_7: f32) -> f32 {
    var cover_8: f32;

    cover_8 = cover_7;
    let _e295 = cover_8;
    let _e296 = groundSmooth(0.12f, 0.45f, _e295);
    return _e296;
}

fn forestRiparianTint(st_21: ForestStand) -> vec3<f32> {
    var st_22: ForestStand;
    var w_10: ForestStand;

    st_22 = st_21;
    let _e293 = st_22;
    w_10 = _e293;
    let _e296 = w_10;
    w_10.dry = (_e296.dry * 0.45f);
    let _e300 = w_10;
    let _e302 = forestPalette(_e300, 0f);
    let _e303 = w_10;
    let _e305 = forestGrade(_e303, 0f);
    let _e307 = st_22;
    let _e309 = forestPalette(_e307, 0f);
    let _e310 = st_22;
    let _e312 = forestGrade(_e310, 0f);
    return ((_e302 * _e305) / max((_e309 * _e312), vec3(0.02f)));
}

fn forestTilt(n_13: vec3<f32>, l_1: vec3<f32>, s_20: f32) -> vec3<f32> {
    var n_14: vec3<f32>;
    var l_2: vec3<f32>;
    var s_21: f32;

    n_14 = n_13;
    l_2 = l_1;
    s_21 = s_20;
    let _e297 = n_14;
    let _e298 = n_14;
    let _e299 = l_2;
    let _e300 = n_14;
    let _e301 = l_2;
    let _e308 = s_21;
    return normalize(mix(_e297, normalize((_e298 - (_e299 * max(dot(_e300, _e301), 0f)))), vec3(clamp(_e308, 0f, 1f))));
}

fn forestPrep(world_47: vec2<f32>, footprint_22: f32) -> ForestPrep {
    var world_48: vec2<f32>;
    var footprint_23: f32;
    var p_33: ForestPrep;
    var uv_15: vec2<f32>;
    var fsize: vec2<f32>;
    var fcell: f32;
    var f_15: vec4<f32>;
    var standAt: vec2<f32>;
    var i_9: i32 = 0i;
    var q_14: vec2<f32>;
    var g_13: vec4<f32>;
    var st_23: ForestStand;
    var T: f32;
    var P: f32;
    var kind_4: vec3<f32>;
    var ouv_1: vec2<f32>;
    var texel: f32;
    var o_5: vec3<f32>;
    var cls_3: i32;
    var local_188: f32;
    var local_189: f32;
    var local_190: f32;
    var local_191: f32;
    var local_192: f32;
    var w_11: f32;
    var local_193: f32;
    var local_194: f32;
    var bank_1: vec2<f32>;
    var local_195: f32;

    world_48 = world_47;
    footprint_23 = footprint_22;
    p_33.valid = false;
    p_33.openA = 0f;
    p_33.openW = 1f;
    p_33.forcedA = 0f;
    p_33.hedgeA = 0f;
    let _e306 = world_48;
    let _e307 = global.uForestRect;
    let _e310 = global.uForestRect;
    uv_15 = ((_e306 - _e307.xy) / vec2(_e310.z));
    let _e317 = uv_15;
    let _e323 = uv_15;
    if (((uForest == 0i) || any((_e317 < vec2(0f)))) || any((_e323 > vec2(1f)))) {
        let _e329 = p_33;
        return _e329;
    }
    p_33.valid = true;
    let _e333 = footprint_23;
    p_33.fp = max(_e333, 0.02f);
    let _e337 = textureDimensions(uForestField, 0i);
    fsize = vec2<f32>(vec2<i32>(_e337));
    let _e341 = global.uForestRect;
    let _e343 = fsize;
    fcell = (_e341.z / _e343.x);
    let _e348 = p_33;
    let _e350 = forestReveal(_e348.fp);
    p_33.reveal = _e350;
    let _e352 = p_33;
    let _e354 = fcell;
    p_33.lod = max(log2((_e352.fp / _e354)), 0f);
    let _e360 = p_33;
    let _e364 = p_33;
    let _e370 = p_33;
    let _e372 = groundSmooth(4f, 16f, _e370.fp);
    p_33.standLod = (_e360.lod + ((2f * (1f - _e364.reveal)) * _e372));
    let _e375 = world_48;
    let _e376 = p_33;
    let _e378 = forestField(_e375, _e376.standLod);
    f_15 = _e378;
    let _e380 = world_48;
    standAt = _e380;
    let _e382 = global.uQuality;
    let _e388 = world_48;
    let _e389 = forestWaterCoverage(_e388);
    if (((_e382 == 0i) && (uRenderV2_ > 0i)) && (_e389 > 0.05f)) {
        loop {
            let _e395 = i_9;
            if !((_e395 < 8i)) {
                break;
            }
            {
                let _e402 = world_48;
                let _e404 = i_9;
                let _e409 = i_9;
                q_14 = (_e402 + (8f * vec2<f32>(cos((f32(_e404) * 0.7853982f)), sin((f32(_e409) * 0.7853982f)))));
                let _e418 = q_14;
                let _e419 = p_33;
                let _e421 = forestField(_e418, _e419.standLod);
                g_13 = _e421;
                let _e423 = g_13;
                let _e425 = f_15;
                if (_e423.x > _e425.x) {
                    {
                        let _e428 = g_13;
                        f_15 = _e428;
                        let _e429 = q_14;
                        standAt = _e429;
                    }
                }
            }
            continuing {
                let _e399 = i_9;
                i_9 = (_e399 + 1i);
            }
        }
    }
    st_23.orchard = false;
    st_23.rows = vec2<f32>(1f, 0f);
    let _e438 = world_48;
    st_23.p = _e438;
    let _e440 = f_15;
    st_23.cover = _e440.x;
    let _e443 = f_15;
    st_23.height = (_e443.y * 50f);
    let _e448 = f_15;
    st_23.needle = _e448.z;
    let _e451 = f_15;
    st_23.tone = _e451.w;
    let _e453 = global.uMaterialClimate;
    T = _e453.x;
    let _e456 = global.uMaterialClimate;
    P = _e456.y;
    let _e460 = P;
    let _e462 = T;
    p_33.humid = (_e460 / max(((20f * _e462) + 280f), 120f));
    let _e472 = T;
    let _e475 = groundSmooth(13f, 19f, (_e472 - 6f));
    st_23.trop = _e475;
    let _e480 = p_33;
    let _e482 = groundSmooth(0.8f, 2f, _e480.humid);
    st_23.dry = (1f - _e482);
    let _e488 = T;
    let _e491 = groundSmooth(8f, 16f, (_e488 + 6f));
    p_33.cold = (1f - _e491);
    let _e493 = st_23;
    let _e495 = st_23;
    let _e497 = forestKind(_e493.trop, _e495.dry);
    kind_4 = _e497;
    let _e504 = p_33;
    let _e506 = groundSmooth(0.9f, 1.8f, _e504.humid);
    let _e512 = st_23;
    let _e514 = groundSmooth(3f, 10f, _e512.height);
    let _e519 = st_23;
    let _e525 = st_23;
    let _e532 = kind_4;
    let _e539 = kind_4;
    st_23.kappa = (((((mix(0.25f, 0.78f, _e506) * mix(0.55f, 1f, _e514)) * mix(1f, 0.85f, _e519.needle)) * (1f - (0.6f * _e525.trop))) * (1f - (0.5f * _e532.x))) * (1f - (0.85f * _e539.z)));
    st_23.open = -1000f;
    st_23.forced = -1000f;
    st_23.allow = 0f;
    st_23.hedge = 0f;
    let _e554 = global.uHasOccupation;
    if (_e554 == 1i) {
        {
            let _e557 = world_48;
            let _e558 = global.uOccupationRect;
            let _e561 = global.uOccupationRect;
            ouv_1 = ((_e557 - _e558.xy) / vec2(_e561.z));
            let _e566 = ouv_1;
            let _e571 = ouv_1;
            if (all((_e566 >= vec2(0f))) && all((_e571 <= vec2(1f)))) {
                {
                    let _e577 = global.uOccupationRect;
                    let _e579 = global.uOccupationN;
                    texel = (_e577.z / _e579);
                    let _e582 = world_48;
                    let _e583 = groundOccupation(_e582);
                    o_5 = _e583;
                    let _e586 = o_5;
                    st_23.open = _e586.x;
                    let _e589 = o_5;
                    st_23.forced = _e589.y;
                    let _e591 = o_5;
                    cls_3 = i32(_e591.z);
                    let _e596 = cls_3;
                    st_23.orchard = (_e596 == 4i);
                    let _e600 = cls_3;
                    if (_e600 == 6i) {
                        local_191 = 0.12f;
                    } else {
                        let _e604 = cls_3;
                        if (_e604 == 3i) {
                            local_190 = 0.05f;
                        } else {
                            let _e608 = cls_3;
                            if (_e608 == 2i) {
                                local_189 = 0.02f;
                            } else {
                                let _e612 = cls_3;
                                if (_e612 == 7i) {
                                    local_188 = 0.03f;
                                } else {
                                    local_188 = 0f;
                                }
                                let _e618 = local_188;
                                local_189 = _e618;
                            }
                            let _e620 = local_189;
                            local_190 = _e620;
                        }
                        let _e622 = local_190;
                        local_191 = _e622;
                    }
                    let _e624 = local_191;
                    let _e625 = st_23;
                    let _e627 = forestHeightGate(_e625.height);
                    st_23.allow = (_e624 * _e627);
                    let _e630 = cls_3;
                    let _e633 = cls_3;
                    if ((_e630 >= 1i) && (_e633 <= 3i)) {
                        local_192 = 0.6f;
                    } else {
                        local_192 = 0f;
                    }
                    let _e640 = local_192;
                    let _e643 = st_23;
                    let _e645 = groundSmooth(3f, 8f, _e643.height);
                    let _e648 = st_23;
                    st_23.hedge = ((_e640 * _e645) * (1f - _e648.dry));
                    let _e652 = p_33;
                    let _e655 = texel;
                    w_11 = max(_e652.fp, (0.5f * _e655));
                    let _e660 = w_11;
                    p_33.openW = _e660;
                    let _e662 = st_23;
                    let _e664 = w_11;
                    p_33.openA = clamp(((_e662.open / _e664) + 0.5f), 0f, 1f);
                    let _e672 = st_23;
                    let _e674 = w_11;
                    let _e682 = p_33;
                    p_33.forcedA = (clamp(((_e672.forced / _e674) + 0.5f), 0f, 1f) * (1f - _e682.openA));
                    let _e687 = p_33;
                    let _e689 = st_23;
                    let _e693 = w_11;
                    p_33.hedgeA = (_e687.openA - clamp((((_e689.open - 5f) / _e693) + 0.5f), 0f, 1f));
                }
            }
        }
    }
    let _e701 = st_23;
    if _e701.orchard {
        {
            st_23.cover = 0f;
            st_23.needle = 0f;
            st_23.kappa = 0f;
            st_23.height = 7f;
            st_23.allow = 0f;
            st_23.hedge = 0f;
            let _e716 = world_48;
            let _e717 = orchardRows(_e716);
            st_23.rows = _e717;
            p_33.openA = 1f;
            p_33.forcedA = 0f;
            p_33.hedgeA = 0f;
        }
    }
    let _e725 = st_23;
    p_33.st = _e725;
    let _e727 = st_23;
    if _e727.orchard {
        local_193 = 2.5f;
    } else {
        let _e730 = st_23;
        let _e732 = st_23;
        let _e734 = st_23;
        let _e736 = forestRadius(_e730.height, _e732.needle, _e734.dry);
        local_193 = _e736;
    }
    let _e738 = local_193;
    p_33.radius = _e738;
    if (uForestBrushes == 1i) {
        let _e744 = p_33;
        let _e746 = p_33;
        let _e749 = groundSmooth(2f, 5f, (_e744.radius / _e746.fp));
        local_194 = _e749;
    } else {
        let _e752 = p_33;
        let _e754 = p_33;
        let _e757 = groundSmooth(0.9f, 2f, (_e752.radius / _e754.fp));
        local_194 = _e757;
    }
    let _e759 = local_194;
    p_33.crownVis = _e759;
    let _e764 = p_33;
    let _e766 = groundSmooth(0.38f, 0.85f, _e764.humid);
    let _e769 = p_33;
    p_33.fringe = ((1f - _e766) * (1f - _e769.crownVis));
    let _e773 = standAt;
    let _e774 = forestBankAt(_e773);
    bank_1 = _e774;
    let _e777 = st_23;
    let _e780 = bank_1;
    if (!(_e777.orchard) && (_e780.x > -16f)) {
        let _e786 = bank_1;
        let _e788 = forestBankDensity(_e786.y);
        local_195 = _e788;
    } else {
        local_195 = 0f;
    }
    let _e791 = local_195;
    p_33.galleryNear = _e791;
    let _e792 = p_33;
    return _e792;
}

fn forestPrepCover(p_34: ForestPrep) -> f32 {
    var p_35: ForestPrep;
    var cover_9: f32;

    p_35 = p_34;
    let _e293 = p_35;
    let _e296 = p_35;
    let _e299 = p_35;
    let _e302 = forestWoods(_e296.st.cover, _e299.st.height);
    let _e303 = p_35;
    cover_9 = mix(_e293.st.cover, _e302, _e303.forcedA);
    let _e307 = cover_9;
    let _e308 = cover_9;
    let _e309 = cover_9;
    let _e311 = p_35;
    return mix(_e307, (_e308 * _e309), _e311.fringe);
}

fn forestCanopyNear(p_36: ForestPrep, l_3: vec3<f32>) -> ForestCanopy {
    var p_37: ForestPrep;
    var l_4: vec3<f32>;
    var c_30: ForestCanopy;
    var st_24: ForestStand;
    var d_20: f32;
    var local_196: vec2<f32>;
    var sun_4: vec2<f32>;
    var cot_2: f32;
    var dl: f32;
    var rho_1: f32;
    var level_7: f32;
    var l0_: f32;
    var w_12: f32;
    var s0_: f32;
    var s1_1: f32;
    var local_197: f32;
    var d0_: f32;
    var local_198: f32;
    var d1_: f32;
    var aa_8: f32;
    var hit_3: ForestHit;
    var k_28: i32 = 0i;
    var local_199: f32;
    var local_200: f32;
    var local_201: f32;
    var zp_2: f32;
    var local_202: i32;
    var dominant: i32;
    var local_203: f32;
    var under: f32;

    p_37 = p_36;
    l_4 = l_3;
    c_30.cover = 0f;
    c_30.shade = 0f;
    c_30.near = 9f;
    c_30.rel = 1f;
    c_30.slope = vec2(0f);
    c_30.edge = 0f;
    c_30.tint = 0.5f;
    c_30.ink = 0.5f;
    c_30.needle = false;
    c_30.riparian = false;
    let _e317 = global.uQuality;
    let _e320 = p_37;
    let _e324 = p_37;
    if (((_e317 > 0i) || !(_e320.valid)) || (_e324.crownVis <= 0f)) {
        let _e329 = c_30;
        return _e329;
    }
    let _e330 = p_37;
    st_24 = _e330.st;
    let _e333 = p_37;
    let _e334 = forestPrepCover(_e333);
    let _e335 = st_24;
    let _e337 = forestDensity(_e334, _e335.kappa);
    d_20 = _e337;
    let _e339 = l_4;
    if (length(_e339.xz) > 0.0001f) {
        let _e344 = l_4;
        local_196 = normalize(_e344.xz);
    } else {
        local_196 = vec2(0f);
    }
    let _e350 = local_196;
    sun_4 = _e350;
    let _e352 = l_4;
    let _e355 = l_4;
    cot_2 = clamp((length(_e352.xz) / max(_e355.y, 0.05f)), 0f, 4f);
    let _e364 = d_20;
    let _e365 = p_37;
    dl = max(_e364, _e365.galleryNear);
    let _e369 = dl;
    let _e370 = forestTau(_e369);
    let _e371 = forestRho(_e370);
    rho_1 = _e371;
    let _e374 = p_37;
    let _e376 = rho_1;
    level_7 = clamp((2f * log2(((_e374.radius / _e376) / 2f))), 0f, 5.999f);
    let _e386 = level_7;
    l0_ = floor(_e386);
    let _e389 = level_7;
    let _e390 = l0_;
    w_12 = (_e389 - _e390);
    let _e394 = l0_;
    s0_ = (2f * exp2((_e394 * 0.5f)));
    let _e400 = s0_;
    s1_1 = (_e400 * 1.4142135f);
    let _e404 = st_24;
    if _e404.orchard {
        {
            l0_ = -1f;
            s0_ = 8f;
            s1_1 = 8f;
            w_12 = 0f;
        }
    }
    let _e411 = st_24;
    if _e411.orchard {
        local_197 = 1f;
    } else {
        let _e416 = dl;
        let _e419 = w_12;
        local_197 = (1f - pow((1f - _e416), (1f - _e419)));
    }
    let _e424 = local_197;
    d0_ = _e424;
    let _e426 = st_24;
    if _e426.orchard {
        local_198 = 0f;
    } else {
        let _e431 = dl;
        let _e433 = w_12;
        local_198 = (1f - pow((1f - _e431), _e433));
    }
    let _e437 = local_198;
    d1_ = _e437;
    let _e439 = p_37;
    aa_8 = (_e439.fp * 0.75f);
    hit_3.cover = 0f;
    hit_3.top = -1000000000f;
    hit_3.second = -1000000000f;
    hit_3.slope = vec2(0f);
    hit_3.rel = 1f;
    hit_3.local = vec2(0f);
    hit_3.r = 1f;
    hit_3.needle = false;
    hit_3.riparian = false;
    hit_3.edge = 0f;
    hit_3.id = 0u;
    hit_3.level = -1i;
    hit_3.near = 9f;
    hit_3.ink = 0.5f;
    loop {
        let _e480 = k_28;
        if !((_e480 < 2i)) {
            break;
        }
        {
            let _e487 = k_28;
            if (_e487 == 0i) {
                let _e490 = d0_;
                local_199 = _e490;
            } else {
                let _e491 = d1_;
                local_199 = _e491;
            }
            let _e493 = local_199;
            if (_e493 > 0.002f) {
                let _e497 = l0_;
                let _e499 = k_28;
                let _e501 = k_28;
                if (_e501 == 0i) {
                    let _e504 = s0_;
                    local_200 = _e504;
                } else {
                    let _e505 = s1_1;
                    local_200 = _e505;
                }
                let _e507 = local_200;
                let _e508 = st_24;
                let _e509 = aa_8;
                forestCrowns((&hit_3), (i32(_e497) + _e499), _e507, _e508, _e509);
            }
        }
        continuing {
            let _e484 = k_28;
            k_28 = (_e484 + 1i);
        }
    }
    let _e511 = hit_3;
    if (_e511.cover > 0f) {
        let _e515 = hit_3;
        local_201 = _e515.top;
    } else {
        local_201 = 0f;
    }
    let _e519 = local_201;
    zp_2 = _e519;
    if (uForestBrushes == 0i) {
        {
            let _e523 = w_12;
            if (_e523 < 0.5f) {
                local_202 = 0i;
            } else {
                local_202 = 1i;
            }
            let _e529 = local_202;
            dominant = _e529;
            let _e532 = hit_3;
            let _e533 = l0_;
            let _e535 = dominant;
            let _e537 = dominant;
            if (_e537 == 0i) {
                let _e540 = s0_;
                local_203 = _e540;
            } else {
                let _e541 = s1_1;
                local_203 = _e541;
            }
            let _e543 = local_203;
            let _e544 = st_24;
            let _e545 = aa_8;
            let _e546 = zp_2;
            let _e547 = sun_4;
            let _e548 = cot_2;
            let _e549 = forestShadow(_e532, (i32(_e533) + _e535), _e543, _e544, _e545, _e546, _e547, _e548);
            c_30.shade = _e549;
        }
    }
    let _e550 = st_24;
    let _e552 = st_24;
    let _e554 = forestKind(_e550.trop, _e552.dry);
    let _e559 = hit_3;
    let _e561 = st_24;
    let _e566 = groundSmooth(0.72f, 1f, (_e559.top / max(_e561.height, 1f)));
    under = (_e554.y * (1f - _e566));
    let _e571 = hit_3;
    c_30.cover = _e571.cover;
    let _e574 = hit_3;
    c_30.near = _e574.near;
    let _e577 = hit_3;
    c_30.rel = _e577.rel;
    let _e580 = hit_3;
    c_30.slope = _e580.slope;
    let _e583 = hit_3;
    let _e585 = under;
    c_30.edge = max(_e583.edge, _e585);
    let _e588 = hit_3;
    c_30.ink = _e588.ink;
    let _e591 = hit_3;
    c_30.needle = _e591.needle;
    let _e594 = hit_3;
    c_30.riparian = _e594.riparian;
    let _e597 = hit_3;
    let _e602 = forestU8_((_e597.id * 2654435769u), 0u);
    c_30.tint = _e602;
    let _e603 = c_30;
    return _e603;
}

fn forestCanopyAt(p_38: ForestPrep, l_5: vec3<f32>) -> ForestCanopy {
    var p_39: ForestPrep;
    var l_6: vec3<f32>;

    p_39 = p_38;
    l_6 = l_5;
    if (groundEnabled == 0i) {
        let _e298 = mapCanopy;
        return _e298;
    }
    let _e299 = p_39;
    let _e300 = l_6;
    let _e301 = forestCanopyNear(_e299, _e300);
    return _e301;
}

fn forestCanopyPack(c_31: ForestCanopy) -> vec3<u32> {
    var c_32: ForestCanopy;
    var local_204: f32;
    var tint_5: f32;
    var local_205: f32;
    var local_206: f32;

    c_32 = c_31;
    if (uForestBrushes == 1i) {
        let _e296 = c_32;
        local_204 = _e296.ink;
    } else {
        let _e298 = c_32;
        local_204 = _e298.tint;
    }
    let _e301 = local_204;
    tint_5 = min(_e301, 0.99f);
    let _e305 = c_32;
    let _e307 = c_32;
    let _e311 = c_32;
    let _e314 = c_32;
    let _e320 = c_32;
    let _e322 = c_32;
    let _e324 = c_32;
    if _e324.needle {
        local_205 = 1f;
    } else {
        local_205 = 0f;
    }
    let _e329 = local_205;
    let _e330 = c_32;
    if _e330.riparian {
        local_206 = 2f;
    } else {
        local_206 = 0f;
    }
    let _e335 = local_206;
    let _e337 = tint_5;
    let _e342 = auxPack4x8_(vec4<f32>((min(_e314.near, 9f) / 9f), _e320.rel, _e322.edge, (((_e329 + _e335) + _e337) / 4f)));
    return vec3<u32>(pack2x16float(vec2<f32>(_e305.cover, _e307.shade)), pack2x16float(_e311.slope), _e342);
}

fn forestSnowGrain(w_13: vec2<f32>, scale_4: f32, fp_17: f32) -> f32 {
    var w_14: vec2<f32>;
    var scale_5: f32;
    var fp_18: f32;
    var g_14: vec2<f32>;
    var c_33: vec2<i32>;

    w_14 = w_13;
    scale_5 = scale_4;
    fp_18 = fp_17;
    let _e298 = w_14;
    let _e299 = scale_5;
    g_14 = (_e298 / vec2(_e299));
    let _e303 = g_14;
    c_33 = vec2<i32>(floor(_e303));
    let _e307 = g_14;
    let _e308 = c_33;
    let _e311 = c_33;
    let _e312 = forestGradient(_e311);
    let _e313 = c_33;
    let _e318 = forestGradient((_e313 + vec2<i32>(1i, 0i)));
    let _e319 = c_33;
    let _e324 = forestGradient((_e319 + vec2<i32>(0i, 1i)));
    let _e325 = c_33;
    let _e330 = forestGradient((_e325 + vec2<i32>(1i, 1i)));
    let _e331 = forestPerlin((_e307 - vec2<f32>(_e308)), _e312, _e318, _e324, _e330);
    let _e334 = scale_5;
    let _e337 = scale_5;
    let _e340 = fp_18;
    let _e341 = groundSmooth((_e334 * 0.12f), (_e337 * 0.3f), _e340);
    return (_e331.x * (1f - _e341));
}

fn forestCrownSnow(hit_4: ForestCanopy, sun_5: vec2<f32>, bough: f32) -> f32 {
    var hit_5: ForestCanopy;
    var sun_6: vec2<f32>;
    var bough_1: f32;
    var c_34: f32;
    var side_3: f32;
    var cap_4: f32;
    var local_207: f32;
    var needle_17: f32;
    var thin_1: f32;
    var hold: f32;

    hit_5 = hit_4;
    sun_6 = sun_5;
    bough_1 = bough;
    let _e298 = v2SeasonCrownSnow();
    c_34 = _e298;
    let _e300 = hit_5;
    let _e302 = sun_6;
    let _e305 = hit_5;
    side_3 = (-(dot(_e300.slope, _e302)) / max(length(_e305.slope), 0.001f));
    let _e314 = c_34;
    let _e319 = c_34;
    let _e324 = hit_5;
    let _e329 = side_3;
    let _e335 = bough_1;
    let _e341 = hit_5;
    let _e350 = groundSmooth((0.2f - (0.2f * _e314)), (0.8f - (0.2f * _e319)), ((((0.75f * (1f - _e324.rel)) + (0.35f * max(_e329, 0f))) + (0.3f * (_e335 - 0.5f))) + (0.3f * (fract((_e341.tint * 9.71f)) - 0.5f))));
    cap_4 = _e350;
    let _e352 = hit_5;
    if _e352.needle {
        local_207 = 1f;
    } else {
        local_207 = 0f;
    }
    let _e357 = local_207;
    needle_17 = _e357;
    let _e361 = c_34;
    let _e364 = needle_17;
    thin_1 = mix(mix(0.15f, 0.5f, _e361), 0.12f, _e364);
    let _e367 = thin_1;
    let _e368 = needle_17;
    let _e369 = forestSnowLoad(_e368);
    let _e370 = thin_1;
    let _e374 = c_34;
    let _e377 = cap_4;
    hold = (_e367 + (((_e369 - _e370) / mix(0.356f, 0.619f, _e374)) * _e377));
    let _e381 = v2GroundSnow;
    let _e382 = hold;
    let _e385 = hit_5;
    return (_e381 * min((_e382 * (1f + (0.3f * (fract((_e385.tint * 4.37f)) - 0.5f)))), 0.97f));
}

fn forestClump(world_49: vec2<f32>, radius_7: f32, fp_19: f32, tint_6: f32) -> vec3<f32> {
    var world_50: vec2<f32>;
    var radius_8: f32;
    var fp_20: f32;
    var tint_7: f32;
    var e_2: f32;
    var e0_: f32;
    var w_15: f32;
    var n_15: f32 = 0f;
    var norm: f32 = 0f;
    var grad: vec2<f32> = vec2(0f);
    var offset_1: vec2<f32>;
    var i_10: i32 = 0i;
    var scale_6: f32;
    var local_208: f32;
    var a_25: f32;
    var g_15: vec2<f32>;
    var c_35: vec2<i32>;
    var o_6: vec3<f32>;
    var amp_2: f32;

    world_50 = world_49;
    radius_8 = radius_7;
    fp_20 = fp_19;
    tint_7 = tint_6;
    let _e301 = radius_8;
    e_2 = log2((0.7f * max(_e301, 0.5f)));
    let _e307 = e_2;
    e0_ = floor(_e307);
    let _e310 = e_2;
    let _e311 = e0_;
    w_15 = (_e310 - _e311);
    let _e321 = tint_7;
    let _e325 = tint_7;
    offset_1 = (vec2<f32>(fract((_e321 * 5.83f)), fract((_e325 * 11.37f))) * 97f);
    loop {
        let _e335 = i_10;
        if !((_e335 < 2i)) {
            break;
        }
        {
            let _e342 = e0_;
            let _e343 = i_10;
            scale_6 = exp2((_e342 + f32(_e343)));
            let _e348 = i_10;
            if (_e348 == 0i) {
                let _e352 = w_15;
                local_208 = (1f - _e352);
            } else {
                let _e354 = w_15;
                local_208 = _e354;
            }
            let _e356 = local_208;
            let _e358 = scale_6;
            let _e361 = scale_6;
            let _e364 = fp_20;
            let _e365 = groundSmooth((_e358 * 0.16f), (_e361 * 0.4f), _e364);
            a_25 = (_e356 * (1f - _e365));
            let _e369 = world_50;
            let _e370 = scale_6;
            let _e373 = offset_1;
            g_15 = ((_e369 / vec2(_e370)) + _e373);
            let _e376 = g_15;
            c_35 = vec2<i32>(floor(_e376));
            let _e380 = g_15;
            let _e381 = c_35;
            let _e384 = c_35;
            let _e385 = forestGradient(_e384);
            let _e386 = c_35;
            let _e391 = forestGradient((_e386 + vec2<i32>(1i, 0i)));
            let _e392 = c_35;
            let _e397 = forestGradient((_e392 + vec2<i32>(0i, 1i)));
            let _e398 = c_35;
            let _e403 = forestGradient((_e398 + vec2<i32>(1i, 1i)));
            let _e404 = forestPerlin((_e380 - vec2<f32>(_e381)), _e385, _e391, _e397, _e403);
            o_6 = _e404;
            let _e406 = n_15;
            let _e407 = a_25;
            let _e408 = o_6;
            n_15 = (_e406 + (_e407 * _e408.x));
            let _e412 = grad;
            let _e413 = a_25;
            let _e414 = o_6;
            let _e417 = scale_6;
            grad = (_e412 + ((_e413 * _e414.yz) / vec2(_e417)));
            let _e421 = norm;
            let _e422 = a_25;
            let _e423 = a_25;
            norm = (_e421 + (_e422 * _e423));
        }
        continuing {
            let _e339 = i_10;
            i_10 = (_e339 + 1i);
        }
    }
    let _e426 = norm;
    norm = sqrt(_e426);
    let _e430 = norm;
    let _e431 = groundSmooth(0f, 0.6f, _e430);
    let _e434 = radius_8;
    let _e435 = fp_20;
    let _e437 = groundSmooth(2.5f, 5f, (_e434 / _e435));
    amp_2 = (_e431 * _e437);
    let _e440 = n_15;
    let _e441 = norm;
    n_15 = (_e440 / max(_e441, 0.001f));
    let _e445 = grad;
    let _e446 = norm;
    grad = (_e445 / vec2(max(_e446, 0.001f)));
    let _e451 = amp_2;
    let _e454 = n_15;
    let _e456 = groundSmooth(0f, 0.26f, abs(_e454));
    let _e460 = e_2;
    let _e463 = n_15;
    let _e465 = n_15;
    let _e466 = n_15;
    let _e472 = grad;
    let _e473 = ((((0.7f * exp2(_e460)) * _e463) * inverseSqrt(((_e465 * _e466) + 0.0009f))) * _e472);
    return (_e451 * vec3<f32>((_e456 - 0.48f), _e473.x, _e473.y));
}

fn applyOrchard(m_5: ptr<function, GroundMaterial>, p_40: ForestPrep, light_5: vec3<f32>, hit_6: ForestCanopy, leafClump: vec3<f32>, bare_4: vec2<f32>) {
    var p_41: ForestPrep;
    var light_6: vec3<f32>;
    var hit_7: ForestCanopy;
    var leafClump_1: vec3<f32>;
    var bare_5: vec2<f32>;
    var st_25: ForestStand;
    var l_7: vec3<f32>;
    var nGround: vec3<f32>;
    var local_209: f32;
    var leaf_2: f32;
    var local_210: f32;
    var snow_4: f32;
    var crown_2: vec3<f32>;
    var cover_10: f32;
    var normal_1: vec3<f32>;
    var shade_1: f32;
    var tint_8: f32;
    var body: f32;
    var resolved: f32;
    var kind_5: vec3<f32>;
    var fall_1: f32;
    var foliageDetail: f32;
    var dome: vec2<f32>;

    p_41 = p_40;
    light_6 = light_5;
    hit_7 = hit_6;
    leafClump_1 = leafClump;
    bare_5 = bare_4;
    let _e303 = p_41;
    st_25 = _e303.st;
    let _e306 = light_6;
    l_7 = normalize(_e306);
    let _e309 = (*m_5);
    nGround = _e309.normal;
    if (uRenderV2_ > 0i) {
        let _e314 = v2SeasonLeaf();
        local_209 = _e314;
    } else {
        local_209 = 1f;
    }
    let _e317 = local_209;
    leaf_2 = _e317;
    if (uRenderV2_ > 0i) {
        let _e321 = v2GroundSnow;
        let _e323 = forestSnowLoad(0f);
        local_210 = (_e321 * _e323);
    } else {
        local_210 = 0f;
    }
    let _e327 = local_210;
    snow_4 = _e327;
    if (uRenderV2_ > 0i) {
        let _e332 = (*m_5);
        let _e334 = renderGuideOpen;
        let _e340 = forestFloorAlbedo(clamp(_e334, vec3(0f), vec3(1f)));
        let _e341 = v2OrchardShare;
        (*m_5).albedo = mix(_e332.albedo, _e340, vec3(_e341));
    }
    let _e344 = st_25;
    let _e345 = forestGuide();
    let _e350 = forestCrownColor(_e344, _e345, 0f, vec2(0f), 0f);
    let _e353 = forestBareColor(0.5f, 0.25f);
    let _e355 = leaf_2;
    let _e359 = snow_4;
    let _e360 = forestSnowed(mix(_e350, _e353, vec3((1f - _e355))), _e359);
    crown_2 = _e360;
    let _e363 = leaf_2;
    let _e364 = forestCrownShow(_e363);
    let _e366 = st_25;
    let _e369 = forestField(_e366.p, 0f);
    let _e373 = forestHeightGate((_e369.y * 50f));
    let _e375 = v2OrchardShare;
    cover_10 = (((0.31f * _e364) * _e373) * _e375);
    let _e378 = nGround;
    normal_1 = _e378;
    let _e380 = cover_10;
    shade_1 = (_e380 * 0.45f);
    let _e384 = p_41;
    let _e388 = global.uQuality;
    if ((_e384.crownVis > 0f) && (_e388 == 0i)) {
        {
            let _e392 = hit_7;
            tint_8 = _e392.tint;
            let _e395 = bare_5;
            let _e398 = leaf_2;
            body = mix(_e395.x, 1f, _e398);
            let _e401 = hit_7;
            let _e403 = body;
            resolved = (_e401.cover * _e403);
            let _e406 = st_25;
            let _e407 = forestGuide();
            let _e409 = tint_8;
            let _e417 = forestCrownColor(_e406, _e407, 0f, vec2<f32>(((_e409 * 2f) - 1f), 0f), 0f);
            crown_2 = _e417;
            let _e418 = st_25;
            let _e420 = st_25;
            let _e422 = forestKind(_e418.trop, _e420.dry);
            kind_5 = _e422;
            let _e424 = forestSeason();
            let _e427 = kind_5;
            let _e430 = kind_5;
            let _e433 = kind_5;
            fall_1 = (_e424.x * (((1f - _e427.x) - _e430.y) - _e433.z));
            let _e438 = crown_2;
            let _e443 = fall_1;
            crown_2 = mix(_e438, vec3<f32>(0.47f, 0.34f, 0.12f), vec3((_e443 * 0.65f)));
            let _e448 = leaf_2;
            let _e451 = hit_7;
            foliageDetail = (_e448 * mix(0.55f, 1f, _e451.rel));
            let _e456 = crown_2;
            let _e459 = foliageDetail;
            let _e461 = leafClump_1;
            crown_2 = (_e456 * (1f + ((0.3f * _e459) * _e461.x)));
            let _e466 = crown_2;
            let _e467 = tint_8;
            let _e468 = bare_5;
            let _e470 = forestBareColor(_e467, _e468.y);
            let _e472 = leaf_2;
            let _e476 = snow_4;
            let _e480 = bare_5;
            let _e484 = leaf_2;
            let _e490 = forestSnowed(mix(_e466, _e470, vec3((1f - _e472))), min((_e476 * mix(1f, mix(1.2f, 0.4f, _e480.y), (1f - _e484))), 0.97f));
            crown_2 = _e490;
            let _e491 = global.uForestTrees;
            if (_e491.w > 0f) {
                let _e495 = crown_2;
                let _e499 = global.uForestTrees;
                let _e501 = global.uForestTrees;
                let _e503 = st_25;
                let _e505 = global.uForestTrees;
                let _e508 = groundSmooth(_e499.z, _e501.w, distance(_e503.p, _e505.xy));
                crown_2 = (_e495 * mix(1f, 0.6f, (1f - _e508)));
            }
            let _e512 = hit_7;
            let _e516 = leaf_2;
            dome = (_e512.slope * mix(0.2f, 1f, _e516));
            let _e520 = dome;
            let _e523 = foliageDetail;
            let _e524 = leafClump_1;
            let _e529 = dome;
            let _e532 = foliageDetail;
            let _e533 = leafClump_1;
            normal_1 = normalize(vec3<f32>((-(_e520.x) - (_e523 * _e524.y)), 1f, (-(_e529.y) - (_e532 * _e533.z))));
            let _e539 = cover_10;
            let _e540 = resolved;
            let _e541 = p_41;
            cover_10 = mix(_e539, _e540, _e541.crownVis);
            let _e544 = shade_1;
            let _e545 = hit_7;
            let _e549 = leaf_2;
            let _e552 = p_41;
            shade_1 = mix(_e544, (_e545.shade * mix(0.25f, 1f, _e549)), _e552.crownVis);
            let _e555 = resolved;
            let _e556 = p_41;
            forestResolvedCover = (_e555 * _e556.crownVis);
        }
    }
    let _e559 = cover_10;
    forestMapCover = _e559;
    let _e560 = shade_1;
    forestResolvedShade = _e560;
    let _e562 = (*m_5);
    let _e566 = shade_1;
    let _e569 = cover_10;
    let _e574 = crown_2;
    let _e575 = groundToLinear(_e574);
    let _e576 = cover_10;
    (*m_5).albedo = mix((_e562.albedo * (1f - ((0.28f * _e566) * (1f - _e569)))), _e575, vec3(_e576));
    let _e580 = nGround;
    let _e581 = l_7;
    let _e582 = shade_1;
    let _e585 = forestTilt(_e580, _e581, (_e582 * 0.3f));
    let _e586 = normal_1;
    let _e587 = cover_10;
    (*m_5).normal = normalize(mix(_e585, _e586, vec3(_e587)));
    let _e592 = (*m_5);
    let _e596 = cover_10;
    (*m_5).occlusion = (_e592.occlusion * (1f - (0.18f * _e596)));
    let _e601 = (*m_5);
    let _e604 = cover_10;
    (*m_5).roughness = mix(_e601.roughness, 0.9f, _e604);
    return;
}

fn applyForest(m_6: ptr<function, GroundMaterial>, world_51: vec2<f32>, footprint_24: f32, light_7: vec3<f32>) {
    var world_52: vec2<f32>;
    var footprint_25: f32;
    var light_8: vec3<f32>;
    var p_42: ForestPrep;
    var hit_8: ForestCanopy;
    var leafClump_2: vec3<f32> = vec3(0f);
    var bare_6: vec2<f32> = vec2<f32>(0.335f, 0.25f);
    var st_26: ForestStand;
    var fp_21: f32;
    var openA: f32;
    var forcedA: f32;
    var hedgeA: f32;
    var crownVis: f32;
    var radius_9: f32;
    var reveal: f32;
    var local_211: f32;
    var foliage: f32;
    var ground_3: vec3<f32>;
    var local_212: vec3<f32>;
    var k_29: vec3<f32>;
    var openGround: vec3<f32>;
    var refAlbedo: vec3<f32>;
    var cover_11: f32;
    var available: f32;
    var mean: vec3<f32>;
    var floorColor: vec3<f32>;
    var stand_1: f32;
    var local_213: f32;
    var patchDetail: f32;
    var local_214: f32;
    var crisp: f32;
    var grainVis: f32;
    var edgeVis: f32;
    var lobe_1: f32 = 0f;
    var g_16: vec2<f32>;
    var c_36: vec2<i32>;
    var grain_2: f32;
    var lobeShift: f32;
    var hedgeShare: f32;
    var refWoods: f32;
    var woods_1: f32;
    var galleryArea: f32;
    var galleryMean: vec3<f32> = vec3(0f);
    var krumm_1: f32;
    var local_215: f32;
    var snowMosaic: f32;
    var local_216: f32;
    var l_8: vec3<f32>;
    var local_217: vec2<f32>;
    var sun_7: vec2<f32>;
    var cot_3: f32;
    var patchVis: f32;
    var fringe: f32;
    var cover_12: f32;
    var d_21: f32;
    var share_1: f32;
    var nGround_1: vec3<f32>;
    var q_15: vec2<f32>;
    var fq: vec4<f32>;
    var cq: f32;
    var dq: f32;
    var sq: f32;
    var mask: f32;
    var maskQ: f32;
    var edgeSd: f32;
    var pv_1: vec2<f32>;
    var pq: vec2<f32>;
    var feather: f32;
    var margin_1: f32;
    var lone: f32 = 0f;
    var c_37: vec2<i32>;
    var h_26: u32;
    var centre_2: vec2<f32>;
    var bare_7: f32;
    var natural: f32;
    var openTrees: f32;
    var canopy_1: f32;
    var stand_2: f32;
    var groundShadow: f32;
    var litter_1: vec3<f32>;
    var mean_1: vec3<f32>;
    var selfShade: f32;
    var albedo: vec3<f32>;
    var normal_2: vec3<f32>;
    var occlusion: f32;
    var roughness_1: f32;
    var local_218: f32;
    var shade_2: f32;
    var tint_9: f32;
    var jitter_5: vec2<f32>;
    var special_4: f32;
    var larch: bool;
    var local_219: f32;
    var leaf_3: f32;
    var body_1: f32;
    var local_220: f32;
    var local_221: f32;
    var clump_1: f32;
    var local_222: f32;
    var slope_8: vec2<f32>;
    var local_223: f32;
    var foliageDetail_1: f32;
    var local_224: vec3<f32>;
    var terrainNormal: vec3<f32>;
    var macroSlope: vec2<f32>;
    var nCrown: vec3<f32>;
    var local_225: f32;
    var occCrown: f32;
    var local_226: f32;
    var detailGain: f32;
    var branch: f32;
    var tiers: f32;
    var bough_2: f32;
    var local_227: f32;
    var whorl: f32;
    var flank: vec3<f32> = vec3(1f);
    var side_4: f32;
    var local_228: f32;
    var crown_3: vec3<f32>;
    var fallKind: vec3<f32>;
    var local_229: f32;
    var fall_2: f32;
    var pick: f32;
    var late: f32;
    var local_230: vec3<f32>;
    var local_231: vec3<f32>;
    var local_232: vec3<f32>;
    var hue_1: vec3<f32>;
    var local_233: f32;
    var local_234: f32;
    var local_235: f32;
    var lift: f32;
    var lum: f32;
    var hueLum: f32;
    var local_236: f32;
    var local_237: f32;
    var local_238: f32;
    var under_1: f32;
    var nearAlbedo: vec3<f32>;
    var nearNormal: vec3<f32>;
    var nearOcc: f32;
    var nearRough: f32;

    world_52 = world_51;
    footprint_25 = footprint_24;
    light_8 = light_7;
    forestResolvedCover = 0f;
    forestResolvedShade = 0f;
    forestMapCover = 0f;
    let _e302 = world_52;
    let _e303 = footprint_25;
    let _e304 = forestPrep(_e302, _e303);
    p_42 = _e304;
    let _e306 = p_42;
    if !(_e306.valid) {
        return;
    }
    let _e317 = p_42;
    let _e321 = global.uQuality;
    if ((_e317.crownVis > 0f) && (_e321 == 0i)) {
        {
            let _e325 = p_42;
            let _e326 = light_8;
            let _e328 = forestCanopyAt(_e325, normalize(_e326));
            hit_8 = _e328;
            if (uForestBrushes == 0i) {
                {
                    let _e331 = hit_8;
                    let _e335 = p_42;
                    let _e338 = p_42;
                    if ((_e331.cover > 0f) && (_e335.radius > (2.5f * _e338.fp))) {
                        let _e343 = world_52;
                        let _e344 = p_42;
                        let _e346 = p_42;
                        let _e348 = hit_8;
                        let _e350 = forestClump(_e343, _e344.radius, _e346.fp, _e348.tint);
                        leafClump_2 = _e350;
                    }
                    if (uRenderV2_ > 0i) {
                        {
                            let _e353 = hit_8;
                            let _e357 = v2SeasonLeaf();
                            if ((_e353.cover > 0f) && (_e357 < 1f)) {
                                let _e361 = hit_8;
                                let _e363 = hit_8;
                                let _e365 = hit_8;
                                let _e367 = p_42;
                                let _e369 = p_42;
                                let _e374 = forestBareCrown(_e361.rel, _e363.slope, _e365.tint, (_e367.radius / max(_e369.fp, 0.01f)));
                                bare_6 = _e374;
                            }
                        }
                    }
                }
            }
        }
    }
    let _e375 = p_42;
    if _e375.st.orchard {
        {
            let _e379 = p_42;
            let _e380 = light_8;
            let _e381 = hit_8;
            let _e382 = leafClump_2;
            let _e383 = bare_6;
            applyOrchard(m_6, _e379, _e380, _e381, _e382, _e383);
            return;
        }
    }
    let _e385 = p_42;
    st_26 = _e385.st;
    let _e388 = p_42;
    fp_21 = _e388.fp;
    let _e391 = p_42;
    openA = _e391.openA;
    let _e394 = p_42;
    forcedA = _e394.forcedA;
    let _e397 = p_42;
    hedgeA = _e397.hedgeA;
    let _e400 = p_42;
    crownVis = _e400.crownVis;
    let _e403 = p_42;
    radius_9 = _e403.radius;
    let _e406 = p_42;
    reveal = _e406.reveal;
    if (uRenderV2_ > 0i) {
        let _e411 = v2Foliage;
        let _e412 = forestCrownShow(_e411);
        local_211 = _e412;
    } else {
        local_211 = 1f;
    }
    let _e415 = local_211;
    foliage = _e415;
    let _e417 = (*m_6);
    let _e419 = groundToDisplay(_e417.albedo);
    ground_3 = _e419;
    if (uRenderV2_ > 0i) {
        local_212 = vec3(1f);
    } else {
        let _e425 = ground_3;
        let _e426 = renderGuideColor;
        local_212 = clamp((_e425 / max(_e426, vec3(0.02f))), vec3(0.25f), vec3(4f));
    }
    let _e437 = local_212;
    k_29 = _e437;
    let _e439 = renderGuideOpen;
    let _e440 = k_29;
    openGround = clamp((_e439 * _e440), vec3(0f), vec3(1f));
    let _e448 = (*m_6);
    refAlbedo = _e448.albedo;
    let _e451 = global.uQuality;
    if (_e451 > 0i) {
        {
            let _e454 = st_26;
            let _e456 = st_26;
            let _e459 = st_26;
            let _e461 = forestHeightGate(_e459.height);
            let _e464 = forcedA;
            cover_11 = mix(_e454.cover, max(_e456.cover, (0.25f * _e461)), _e464);
            let _e467 = cover_11;
            let _e468 = st_26;
            let _e472 = hedgeA;
            let _e475 = st_26;
            let _e479 = openA;
            cover_11 = mix(_e467, ((_e468.allow * 0.7f) + (min(_e472, 0.6f) * _e475.hedge)), _e479);
            let _e481 = cover_11;
            let _e482 = world_52;
            let _e483 = fp_21;
            let _e484 = forestBankCover(_e482, _e483);
            let _e487 = openA;
            cover_11 = max(_e481, (_e484 * (1f - (0.5f * _e487))));
            let _e493 = world_52;
            let _e494 = forestWaterCoverage(_e493);
            let _e497 = v2ZoneBare;
            available = ((1f - _e494) * (1f - _e497));
            if (uRenderV2_ > 0i) {
                let _e503 = available;
                let _e505 = renderGuideBeach;
                available = (_e503 * (1f - clamp((_e505 / 0.8f), 0f, 1f)));
            }
            let _e513 = cover_11;
            let _e514 = foliage;
            let _e516 = available;
            cover_11 = clamp(((_e513 * _e514) * _e516), 0f, 1f);
            let _e521 = st_26;
            let _e522 = forestGuide();
            let _e523 = st_26;
            let _e528 = forestCrownColor(_e521, _e522, _e523.needle, vec2(0f), 0f);
            mean = _e528;
            if (uRenderV2_ > 0i) {
                let _e532 = mean;
                let _e533 = v2GroundSnow;
                let _e534 = st_26;
                let _e536 = forestSnowLoad(_e534.needle);
                let _e538 = forestSnowed(_e532, (_e533 * _e536));
                mean = _e538;
            }
            let _e539 = openGround;
            let _e540 = st_26;
            let _e541 = p_42;
            let _e543 = forestFloor(_e539, _e540, _e541.cold);
            floorColor = _e543;
            let _e545 = st_26;
            let _e547 = forestClosure(_e545.cover);
            let _e549 = openA;
            let _e552 = available;
            stand_1 = ((_e547 * (1f - _e549)) * _e552);
            let _e556 = openGround;
            let _e557 = floorColor;
            let _e558 = stand_1;
            let _e561 = forestFloorAlbedo(mix(_e556, _e557, vec3(_e558)));
            let _e562 = mean;
            let _e563 = groundToLinear(_e562);
            let _e564 = cover_11;
            (*m_6).albedo = mix(_e561, _e563, vec3(_e564));
            (*m_6).roughness = 0.9f;
            let _e570 = (*m_6);
            let _e573 = stand_1;
            (*m_6).occlusion = mix(_e570.occlusion, 0.85f, _e573);
            let _e575 = cover_11;
            forestMapCover = _e575;
            let _e576 = cover_11;
            forestResolvedCover = _e576;
            return;
        }
    }
    if (uForestBrushes == 1i) {
        let _e579 = crownVis;
        local_213 = _e579;
    } else {
        let _e582 = radius_9;
        let _e583 = fp_21;
        let _e585 = groundSmooth(0.2f, 0.7f, (_e582 / _e583));
        local_213 = _e585;
    }
    let _e587 = local_213;
    patchDetail = _e587;
    if (uForestBrushes == 1i) {
        let _e591 = crownVis;
        local_214 = _e591;
    } else {
        let _e594 = radius_9;
        let _e595 = fp_21;
        let _e597 = groundSmooth(0.5f, 1.4f, (_e594 / _e595));
        local_214 = _e597;
    }
    let _e599 = local_214;
    crisp = _e599;
    let _e602 = crownVis;
    let _e606 = radius_9;
    let _e607 = fp_21;
    let _e609 = groundSmooth(0.35f, 1.2f, (_e606 / _e607));
    let _e614 = fp_21;
    let _e615 = groundSmooth(6f, 12f, _e614);
    grainVis = (((1f - _e602) * _e609) * (1f - _e615));
    let _e620 = crownVis;
    let _e622 = crisp;
    let _e627 = fp_21;
    let _e628 = groundSmooth(5f, 10f, _e627);
    edgeVis = (((1f - _e620) * _e622) * (1f - _e628));
    let _e634 = st_26;
    let _e638 = grainVis;
    let _e639 = edgeVis;
    if ((_e634.cover > 0.002f) && (max(_e638, _e639) > 0f)) {
        {
            let _e644 = world_52;
            g_16 = ((_e644 / vec2(14f)) + vec2<f32>(17.3f, -41.9f));
            let _e654 = g_16;
            c_36 = vec2<i32>(floor(_e654));
            let _e658 = g_16;
            let _e659 = c_36;
            let _e662 = c_36;
            let _e663 = forestGradient(_e662);
            let _e664 = c_36;
            let _e669 = forestGradient((_e664 + vec2<i32>(1i, 0i)));
            let _e670 = c_36;
            let _e675 = forestGradient((_e670 + vec2<i32>(0i, 1i)));
            let _e676 = c_36;
            let _e681 = forestGradient((_e676 + vec2<i32>(1i, 1i)));
            let _e682 = forestPerlin((_e658 - vec2<f32>(_e659)), _e663, _e669, _e675, _e681);
            lobe_1 = _e682.x;
        }
    }
    let _e684 = lobe_1;
    let _e685 = grainVis;
    grain_2 = (_e684 * _e685);
    let _e689 = radius_9;
    let _e691 = lobe_1;
    let _e693 = edgeVis;
    lobeShift = (((2f * _e689) * _e691) * _e693);
    let _e696 = global.uHasOccupation;
    if (_e696 == 1i) {
        let _e699 = st_26;
        let _e701 = lobeShift;
        let _e703 = p_42;
        openA = clamp((((_e699.open + _e701) / _e703.openW) + 0.5f), 0f, 1f);
    }
    let _e711 = hedgeA;
    let _e712 = openA;
    hedgeShare = min((_e711 / max(_e712, 0.001f)), 1f);
    let _e719 = renderGuideWoods;
    refWoods = _e719;
    let _e721 = global.uHasOccupation;
    let _e724 = openA;
    let _e725 = forcedA;
    if ((_e721 == 1i) && ((_e724 + _e725) > 0f)) {
        {
            let _e730 = renderGuideWoods;
            let _e731 = st_26;
            let _e735 = hedgeShare;
            let _e736 = st_26;
            let _e742 = openA;
            woods_1 = mix(_e730, ((_e731.allow * 0.7f) + ((_e735 * _e736.hedge) * 0.6f)), _e742);
            let _e745 = woods_1;
            let _e746 = woods_1;
            let _e748 = st_26;
            let _e750 = forestHeightGate(_e748.height);
            let _e753 = forcedA;
            woods_1 = mix(_e745, max(_e746, (0.25f * _e750)), _e753);
            if (uRenderV2_ > 0i) {
                {
                    let _e757 = woods_1;
                    let _e759 = renderGuideBeach;
                    woods_1 = (_e757 * (1f - clamp((_e759 / 0.8f), 0f, 1f)));
                    let _e767 = openGround;
                    let _e768 = forestFloorAlbedo(_e767);
                    let _e769 = v2MacroCanopy;
                    let _e770 = groundToLinear(_e769);
                    let _e771 = woods_1;
                    refAlbedo = mix(_e768, _e770, vec3(_e771));
                }
            } else {
                let _e774 = ground_3;
                let _e775 = woods_1;
                let _e776 = renderGuideWoods;
                let _e778 = renderGuideClosed;
                let _e779 = k_29;
                let _e781 = openGround;
                let _e785 = groundToLinear((_e774 + ((_e775 - _e776) * ((_e778 * _e779) - _e781))));
                refAlbedo = _e785;
            }
            let _e786 = woods_1;
            refWoods = _e786;
        }
    }
    let _e787 = refAlbedo;
    let _e790 = st_26;
    let _e791 = st_26;
    let _e793 = forestGrade(_e790, _e791.needle);
    let _e794 = groundToLinear(_e793);
    let _e795 = refWoods;
    refAlbedo = (_e787 * mix(vec3(1f), _e794, vec3(_e795)));
    let _e799 = world_52;
    let _e800 = fp_21;
    let _e801 = forestBankCover(_e799, _e800);
    let _e804 = openA;
    galleryArea = (_e801 * (1f - (0.5f * _e804)));
    if (uRenderV2_ > 0i) {
        let _e811 = galleryArea;
        let _e812 = foliage;
        let _e814 = renderGuideBeach;
        galleryArea = (_e811 * (_e812 * (1f - clamp((_e814 / 0.8f), 0f, 1f))));
    }
    let _e826 = galleryArea;
    if (_e826 > 0f) {
        let _e829 = st_26;
        let _e830 = forestGuide();
        let _e835 = forestCrownColor(_e829, _e830, 0f, vec2(0f), 0f);
        let _e836 = st_26;
        let _e837 = forestRiparianTint(_e836);
        let _e839 = groundToLinear((_e835 * _e837));
        galleryMean = _e839;
    }
    let _e840 = refAlbedo;
    let _e841 = galleryMean;
    let _e844 = reveal;
    let _e846 = galleryArea;
    refAlbedo = mix(_e840, _e841, vec3((mix(0.5f, 1f, _e844) * _e846)));
    let _e850 = st_26;
    let _e852 = st_26;
    let _e854 = forestKrummholz(_e850.height, _e852.needle);
    krumm_1 = _e854;
    if (uRenderV2_ > 0i) {
        let _e858 = v2GroundSnow;
        let _e862 = fp_21;
        let _e863 = groundSmooth(8f, 20f, _e862);
        let _e867 = krumm_1;
        local_215 = ((_e858 * (1f - _e863)) * (1f - _e867));
    } else {
        local_215 = 0f;
    }
    let _e872 = local_215;
    snowMosaic = _e872;
    let _e874 = reveal;
    let _e875 = snowMosaic;
    reveal = max(_e874, _e875);
    let _e877 = reveal;
    let _e880 = crownVis;
    let _e881 = crownVis;
    if (uForestBrushes == 1i) {
        local_216 = 0f;
    } else {
        let _e886 = patchDetail;
        let _e888 = krumm_1;
        local_216 = (_e886 * (1f - _e888));
    }
    let _e892 = local_216;
    let _e894 = snowMosaic;
    reveal = (_e877 * mix(0.06f, 1f, max(max((_e880 * _e881), _e892), _e894)));
    let _e900 = v2MeanEnabled;
    if ((uRenderV2_ > 0i) && (_e900 > 0.5f)) {
        {
            let _e904 = reveal;
            v2ForestReveal = _e904;
            let _e905 = reveal;
            if (_e905 > 0f) {
                reveal = 1f;
            }
        }
    }
    let _e909 = reveal;
    if (_e909 <= 0f) {
        {
            let _e913 = refAlbedo;
            (*m_6).albedo = _e913;
            return;
        }
    }
    let _e914 = st_26;
    let _e918 = p_42;
    let _e923 = global.uHasOccupation;
    let _e927 = world_52;
    let _e928 = p_42;
    let _e932 = forestField(_e927, max(_e928.lod, 1f));
    if ((((_e914.cover < 0.002f) && (_e918.galleryNear <= 0f)) && (_e923 == 0i)) && (_e932.x < 0.00001f)) {
        {
            let _e938 = refAlbedo;
            let _e939 = openGround;
            let _e940 = forestFloorAlbedo(_e939);
            let _e941 = reveal;
            (*m_6).albedo = mix(_e938, _e940, vec3(_e941));
            return;
        }
    }
    let _e944 = light_8;
    l_8 = normalize(_e944);
    let _e947 = l_8;
    if (length(_e947.xz) > 0.0001f) {
        let _e952 = l_8;
        local_217 = normalize(_e952.xz);
    } else {
        local_217 = vec2(0f);
    }
    let _e958 = local_217;
    sun_7 = _e958;
    let _e960 = l_8;
    let _e963 = l_8;
    cot_3 = clamp((length(_e960.xz) / max(_e963.y, 0.05f)), 0f, 4f);
    let _e975 = fp_21;
    let _e976 = groundSmooth(6f, 14f, _e975);
    let _e980 = patchDetail;
    let _e985 = crisp;
    let _e989 = krumm_1;
    let _e992 = snowMosaic;
    patchVis = max(((((1f - _e976) * mix(0.18f, 1f, _e980)) * mix(0.6f, 1f, _e985)) * (1f - _e989)), _e992);
    let _e995 = p_42;
    fringe = _e995.fringe;
    let _e998 = p_42;
    let _e999 = forestPrepCover(_e998);
    cover_12 = _e999;
    let _e1001 = cover_12;
    let _e1002 = st_26;
    let _e1004 = forestDensity(_e1001, _e1002.kappa);
    d_21 = _e1004;
    let _e1006 = cover_12;
    let _e1007 = d_21;
    share_1 = (_e1006 / max(_e1007, 0.001f));
    let _e1012 = (*m_6);
    nGround_1 = _e1012.normal;
    let _e1015 = world_52;
    let _e1016 = sun_7;
    let _e1017 = st_26;
    let _e1022 = cot_3;
    q_15 = (_e1015 + (((_e1016 * _e1017.height) * 0.6f) * _e1022));
    let _e1026 = q_15;
    let _e1027 = p_42;
    let _e1029 = forestField(_e1026, _e1027.standLod);
    fq = _e1029;
    let _e1031 = fq;
    let _e1033 = fq;
    let _e1035 = fq;
    let _e1038 = fringe;
    cq = mix(_e1031.x, (_e1033.x * _e1035.x), _e1038);
    let _e1041 = cq;
    let _e1042 = st_26;
    let _e1044 = forestDensity(_e1041, _e1042.kappa);
    dq = _e1044;
    let _e1046 = cq;
    let _e1047 = dq;
    sq = (_e1046 / max(_e1047, 0.001f));
    let _e1052 = share_1;
    mask = _e1052;
    let _e1054 = sq;
    maskQ = _e1054;
    let _e1056 = st_26;
    let _e1059 = lobeShift;
    edgeSd = (-(_e1056.open) - _e1059);
    let _e1062 = patchVis;
    if (_e1062 > 0f) {
        {
            let _e1065 = world_52;
            let _e1066 = forestPatchThreshold(_e1065);
            pv_1 = _e1066;
            let _e1068 = q_15;
            let _e1069 = forestPatchThreshold(_e1068);
            pq = _e1069;
            let _e1072 = share_1;
            let _e1074 = share_1;
            let _e1082 = crisp;
            let _e1085 = crownVis;
            feather = mix(mix(clamp((2f * min(_e1072, (1f - _e1074))), 0.12f, 0.5f), 0.04f, _e1082), 0.015f, _e1085);
            let _e1088 = share_1;
            let _e1089 = share_1;
            let _e1090 = pv_1;
            let _e1093 = pv_1;
            let _e1095 = lobeShift;
            let _e1098 = pv_1;
            let _e1100 = fp_21;
            let _e1102 = feather;
            let _e1110 = patchVis;
            mask = mix(_e1088, clamp(((((_e1089 - _e1090.x) + (_e1093.y * _e1095)) / max((_e1098.y * _e1100), _e1102)) + 0.5f), 0f, 1f), _e1110);
            let _e1112 = sq;
            let _e1113 = sq;
            let _e1114 = pq;
            let _e1117 = pq;
            let _e1119 = fp_21;
            let _e1121 = feather;
            let _e1129 = patchVis;
            maskQ = mix(_e1112, clamp((((_e1113 - _e1114.x) / max((_e1117.y * _e1119), _e1121)) + 0.5f), 0f, 1f), _e1129);
            let _e1131 = edgeSd;
            let _e1132 = share_1;
            let _e1133 = pv_1;
            let _e1136 = pv_1;
            let _e1141 = lobeShift;
            edgeSd = min(_e1131, (((_e1132 - _e1133.x) / max(_e1136.y, 0.001f)) + _e1141));
        }
    }
    let _e1145 = edgeSd;
    let _e1147 = radius_9;
    let _e1154 = edgeVis;
    margin_1 = ((1f - clamp((_e1145 / (2.5f * _e1147)), 0f, 1f)) * _e1154);
    let _e1159 = edgeVis;
    let _e1162 = edgeSd;
    let _e1166 = edgeSd;
    let _e1169 = radius_9;
    if (((_e1159 > 0f) && (_e1162 < 0f)) && (_e1166 > (-5f * _e1169))) {
        {
            let _e1173 = world_52;
            c_37 = vec2<i32>(floor((_e1173 / vec2(24f))));
            let _e1180 = c_37;
            let _e1185 = global.uMaterialSeed;
            let _e1188 = groundHash(vec3<i32>(_e1180.x, _e1180.y, 719i), (_e1185 ^ 739982445u));
            h_26 = _e1188;
            let _e1190 = c_37;
            let _e1196 = h_26;
            let _e1198 = forestU8_(_e1196, 0u);
            let _e1199 = h_26;
            let _e1201 = forestU8_(_e1199, 8u);
            centre_2 = (((vec2<f32>(_e1190) + vec2(0.3f)) + (0.4f * vec2<f32>(_e1198, _e1201))) * FOREST_LONE);
            let _e1207 = h_26;
            let _e1209 = forestU8_(_e1207, 16u);
            let _e1212 = edgeSd;
            let _e1214 = radius_9;
            let _e1219 = st_26;
            let _e1226 = st_26;
            let _e1228 = forestHeightGate(_e1226.height);
            if (_e1209 < (((0.35f * (1f + (_e1212 / (5f * _e1214)))) * min((_e1219.cover * 3f), 1f)) * _e1228)) {
                let _e1231 = radius_9;
                let _e1236 = world_52;
                let _e1237 = centre_2;
                let _e1240 = fp_21;
                let _e1247 = edgeVis;
                lone = (clamp((((min(_e1231, 7.2000003f) - distance(_e1236, _e1237)) / _e1240) + 0.5f), 0f, 1f) * _e1247);
            }
        }
    }
    if (uRenderV2_ > 0i) {
        {
            let _e1252 = renderGuideBeach;
            bare_7 = (1f - clamp((_e1252 / 0.8f), 0f, 1f));
            let _e1260 = mask;
            let _e1261 = bare_7;
            mask = (_e1260 * _e1261);
            let _e1263 = lone;
            let _e1264 = bare_7;
            lone = (_e1263 * _e1264);
            let _e1266 = maskQ;
            let _e1268 = q_15;
            let _e1269 = forestBeach(_e1268);
            maskQ = (_e1266 * (1f - _e1269));
        }
    }
    let _e1272 = mask;
    let _e1273 = d_21;
    let _e1276 = openA;
    natural = ((_e1272 * _e1273) * (1f - _e1276));
    let _e1280 = openA;
    let _e1281 = st_26;
    let _e1285 = hedgeShare;
    let _e1286 = st_26;
    openTrees = (_e1280 * ((_e1281.allow * 0.7f) + ((_e1285 * _e1286.hedge) * 0.6f)));
    let _e1294 = natural;
    let _e1295 = openTrees;
    let _e1300 = lone;
    canopy_1 = max(clamp((_e1294 + _e1295), 0f, 1f), _e1300);
    let _e1303 = mask;
    let _e1305 = openA;
    let _e1308 = st_26;
    let _e1310 = forestClosure(_e1308.cover);
    stand_2 = ((_e1303 * (1f - _e1305)) * _e1310);
    if (uRenderV2_ > 0i) {
        let _e1315 = canopy_1;
        let _e1316 = foliage;
        canopy_1 = (_e1315 * _e1316);
    }
    let _e1318 = canopy_1;
    forestMapCover = _e1318;
    let _e1319 = maskQ;
    let _e1320 = dq;
    let _e1323 = openA;
    let _e1326 = openTrees;
    groundShadow = clamp((((_e1319 * _e1320) * (1f - _e1323)) + (_e1326 * 0.6f)), 0f, 1f);
    if (uRenderV2_ > 0i) {
        let _e1336 = groundShadow;
        let _e1337 = v2Foliage;
        groundShadow = (_e1336 * _e1337);
    }
    let _e1339 = openGround;
    let _e1340 = st_26;
    let _e1341 = p_42;
    let _e1343 = forestFloor(_e1339, _e1340, _e1341.cold);
    litter_1 = _e1343;
    let _e1345 = st_26;
    let _e1346 = forestGuide();
    let _e1347 = st_26;
    let _e1352 = forestCrownColor(_e1345, _e1346, _e1347.needle, vec2(0f), 0f);
    mean_1 = _e1352;
    if (uRenderV2_ > 0i) {
        let _e1356 = mean_1;
        let _e1359 = forestBareColor(0.5f, 0.25f);
        let _e1361 = v2Foliage;
        let _e1364 = foliage;
        let _e1370 = v2GroundSnow;
        let _e1371 = st_26;
        let _e1373 = forestSnowLoad(_e1371.needle);
        let _e1375 = forestSnowed(mix(_e1356, _e1359, vec3((((1f - _e1361) * FOREST_BARE) / max(_e1364, 0.001f)))), (_e1370 * _e1373));
        mean_1 = _e1375;
    }
    let _e1378 = st_26;
    selfShade = mix(0.24f, 0.42f, _e1378.needle);
    let _e1382 = openGround;
    let _e1383 = litter_1;
    let _e1384 = stand_2;
    let _e1387 = forestFloorAlbedo(mix(_e1382, _e1383, vec3(_e1384)));
    let _e1388 = mean_1;
    let _e1389 = groundToLinear(_e1388);
    let _e1393 = st_26;
    let _e1396 = grain_2;
    let _e1402 = margin_1;
    let _e1406 = canopy_1;
    albedo = mix(_e1387, ((_e1389 * (1f + (mix(0.5f, 0.9f, _e1393.needle) * _e1396))) * (1f - (0.2f * _e1402))), vec3(_e1406));
    let _e1412 = v2GroundSnow;
    if ((uRenderV2_ > 0i) && (_e1412 > 0f)) {
        let _e1416 = albedo;
        let _e1418 = v2GroundSnow;
        let _e1419 = st_26;
        let _e1422 = stand_2;
        let _e1425 = world_52;
        let _e1427 = fp_21;
        let _e1428 = forestSnowGrain(_e1425, 38f, _e1427);
        let _e1431 = world_52;
        let _e1433 = fp_21;
        let _e1434 = forestSnowGrain(_e1431, 110f, _e1433);
        albedo = (_e1416 * (1f + (((_e1418 * _e1419.needle) * _e1422) * ((0.45f * _e1428) + (0.3f * _e1434)))));
    }
    let _e1440 = albedo;
    let _e1441 = galleryMean;
    let _e1442 = galleryArea;
    let _e1444 = canopy_1;
    albedo = mix(_e1440, _e1441, vec3((_e1442 * (1f - _e1444))));
    let _e1449 = nGround_1;
    let _e1450 = l_8;
    let _e1451 = canopy_1;
    let _e1452 = selfShade;
    let _e1456 = grain_2;
    let _e1461 = canopy_1;
    let _e1463 = groundShadow;
    let _e1471 = forestTilt(_e1449, _e1450, clamp((((_e1451 * _e1452) * (1f - (0.8f * _e1456))) + (((1f - _e1461) * _e1463) * 0.25f)), 0f, 1f));
    normal_2 = _e1471;
    let _e1473 = (*m_6);
    let _e1477 = stand_2;
    let _e1481 = canopy_1;
    let _e1485 = galleryArea;
    occlusion = (mix((_e1473.occlusion * mix(1f, 0.72f, _e1477)), 0.8f, _e1481) * (1f - (0.08f * _e1485)));
    let _e1490 = (*m_6);
    let _e1493 = canopy_1;
    roughness_1 = mix(_e1490.roughness, 0.9f, _e1493);
    let _e1496 = crownVis;
    if (_e1496 > 0f) {
        {
            let _e1499 = hit_8;
            let _e1501 = crownVis;
            let _e1505 = v2MeanEnabled;
            if ((uRenderV2_ > 0i) && (_e1505 > 0.5f)) {
                let _e1509 = v2ForestReveal;
                local_218 = _e1509;
            } else {
                let _e1510 = reveal;
                local_218 = _e1510;
            }
            let _e1512 = local_218;
            forestResolvedCover = ((_e1499.cover * _e1501) * _e1512);
            let _e1514 = hit_8;
            shade_2 = _e1514.shade;
            let _e1517 = hit_8;
            tint_9 = _e1517.tint;
            let _e1520 = tint_9;
            let _e1521 = tint_9;
            jitter_5 = ((vec2<f32>(_e1520, fract((_e1521 * 7.31f))) * 2f) - vec2(1f));
            let _e1532 = tint_9;
            special_4 = fract((_e1532 * 13.17f));
            let _e1539 = hit_8;
            let _e1542 = special_4;
            let _e1543 = v2SeasonClimate();
            larch = (((uRenderV2_ > 0i) && _e1539.needle) && (_e1542 < _e1543.z));
            let _e1550 = hit_8;
            let _e1553 = larch;
            if ((uRenderV2_ > 0i) && (!(_e1550.needle) || _e1553)) {
                let _e1556 = v2SeasonLeaf();
                local_219 = _e1556;
            } else {
                local_219 = 1f;
            }
            let _e1559 = local_219;
            leaf_3 = _e1559;
            let _e1561 = leaf_3;
            if (_e1561 < 1f) {
                {
                    let _e1564 = bare_6;
                    let _e1567 = leaf_3;
                    body_1 = mix(_e1564.x, 1f, _e1567);
                    let _e1571 = hit_8;
                    let _e1573 = body_1;
                    hit_8.cover = (_e1571.cover * _e1573);
                    let _e1575 = shade_2;
                    let _e1578 = leaf_3;
                    shade_2 = (_e1575 * mix(0.25f, 1f, _e1578));
                    let _e1581 = forestResolvedCover;
                    let _e1582 = body_1;
                    forestResolvedCover = (_e1581 * _e1582);
                }
            }
            let _e1584 = shade_2;
            let _e1588 = crownVis;
            let _e1592 = v2MeanEnabled;
            if ((uRenderV2_ > 0i) && (_e1592 > 0.5f)) {
                let _e1596 = v2ForestReveal;
                local_220 = _e1596;
            } else {
                let _e1597 = reveal;
                local_220 = _e1597;
            }
            let _e1599 = local_220;
            forestResolvedShade = ((clamp(_e1584, 0f, 1f) * _e1588) * _e1599);
            let _e1601 = forestMapCover;
            let _e1602 = forestResolvedCover;
            let _e1603 = crownVis;
            forestMapCover = mix(_e1601, _e1602, _e1603);
            if (uForestBrushes == 1i) {
                let _e1607 = hit_8;
                local_221 = ((_e1607.ink - 0.5f) * 2f);
            } else {
                local_221 = 0f;
            }
            let _e1615 = local_221;
            clump_1 = _e1615;
            if (uForestBrushes == 1i) {
                local_222 = 0.25f;
            } else {
                let _e1622 = leaf_3;
                local_222 = mix(0.2f, 1f, _e1622);
            }
            let _e1625 = local_222;
            let _e1626 = hit_8;
            slope_8 = (_e1625 * _e1626.slope);
            let _e1630 = hit_8;
            if _e1630.needle {
                local_223 = 0.3f;
            } else {
                let _e1633 = leaf_3;
                local_223 = _e1633;
            }
            let _e1635 = local_223;
            let _e1638 = hit_8;
            foliageDetail_1 = (_e1635 * mix(0.55f, 1f, _e1638.rel));
            let _e1643 = hit_8;
            if !(_e1643.needle) {
                let _e1646 = slope_8;
                let _e1647 = foliageDetail_1;
                let _e1648 = leafClump_2;
                slope_8 = (_e1646 + (_e1647 * _e1648.yz));
            }
            if (uRenderV2_ > 0i) {
                let _e1654 = v2MacroNormal;
                local_224 = _e1654;
            } else {
                let _e1655 = nGround_1;
                local_224 = _e1655;
            }
            let _e1657 = local_224;
            terrainNormal = _e1657;
            let _e1659 = terrainNormal;
            let _e1662 = terrainNormal;
            macroSlope = (-(_e1659.xz) / vec2(max(_e1662.y, 0.2f)));
            let _e1669 = macroSlope;
            let _e1671 = slope_8;
            let _e1676 = macroSlope;
            let _e1678 = slope_8;
            nCrown = normalize(vec3<f32>(-((_e1669.x + _e1671.x)), 1f, -((_e1676.y + _e1678.y))));
            let _e1685 = nCrown;
            let _e1686 = l_8;
            let _e1687 = shade_2;
            let _e1690 = forestTilt(_e1685, _e1686, (_e1687 * 0.3f));
            nCrown = _e1690;
            if (uForestBrushes == 1i) {
                local_225 = 0.94f;
            } else {
                let _e1698 = hit_8;
                let _e1700 = hit_8;
                let _e1708 = leaf_3;
                local_225 = mix(0.92f, max((0.6f + (0.4f * (1f - (_e1698.rel * _e1700.rel)))), 0.5f), _e1708);
            }
            let _e1711 = local_225;
            occCrown = _e1711;
            if (uForestBrushes == 1i) {
                local_226 = 0.36f;
            } else {
                local_226 = 0f;
            }
            let _e1718 = local_226;
            detailGain = _e1718;
            let _e1720 = hit_8;
            let _e1722 = jitter_5;
            let _e1725 = hit_8;
            let _e1727 = hit_8;
            branch = (dot(_e1720.slope, _e1722) * inverseSqrt((1f + dot(_e1725.slope, _e1727.slope))));
            let _e1734 = hit_8;
            let _e1738 = special_4;
            let _e1743 = tint_9;
            let _e1747 = branch;
            tiers = (((_e1734.rel * (19f + (11f * _e1738))) + (6.2831855f * _e1743)) + (0.9f * _e1747));
            let _e1751 = hit_8;
            let _e1754 = hit_8;
            let _e1759 = tint_9;
            let _e1765 = tint_9;
            bough_2 = abs(cos(((atan2(_e1751.slope.y, _e1754.slope.x) * (3.5f + floor((_e1759 * 3f)))) + (_e1765 * 6.2831855f))));
            let _e1772 = hit_8;
            if (_e1772.needle && (uForestBrushes == 0i)) {
                let _e1778 = tiers;
                let _e1780 = hit_8;
                let _e1784 = tint_9;
                let _e1793 = tiers;
                let _e1796 = special_4;
                let _e1805 = bough_2;
                let _e1806 = bough_2;
                let _e1811 = hit_8;
                let _e1817 = hit_8;
                let _e1824 = radius_9;
                let _e1825 = fp_21;
                let _e1827 = groundSmooth(2f, 6f, (_e1824 / _e1825));
                local_227 = ((((0.1f * (cos((_e1778 + (1.2f * sin(((_e1780.rel * 7f) + (_e1784 * 9f)))))) + (0.35f * cos(((_e1793 * 1.73f) + (_e1796 * 8f)))))) + ((0.05f * ((_e1805 * _e1806) - 0.45f)) * _e1811.rel)) - (0.12f * (1f - _e1817.rel))) * _e1827);
            } else {
                local_227 = 0f;
            }
            let _e1831 = local_227;
            whorl = _e1831;
            let _e1836 = hit_8;
            if (_e1836.needle && (uForestBrushes == 0i)) {
                {
                    let _e1841 = hit_8;
                    let _e1843 = sun_7;
                    let _e1846 = hit_8;
                    side_4 = (-(dot(_e1841.slope, _e1843)) / max(length(_e1846.slope), 0.001f));
                    let _e1859 = side_4;
                    let _e1860 = groundSmooth(-0.3f, 0.3f, _e1859);
                    let _e1864 = hit_8;
                    let _e1866 = groundSmooth(0.04f, 0.2f, _e1864.rel);
                    let _e1869 = radius_9;
                    let _e1870 = fp_21;
                    let _e1872 = groundSmooth(1f, 3f, (_e1869 / _e1870));
                    flank = vec3(mix(1f, mix(0.66f, 1.34f, _e1860), (_e1866 * _e1872)));
                    let _e1876 = flank;
                    let _e1883 = st_26;
                    flank = (_e1876 * mix(vec3<f32>(1.14f, 1.3f, 1.04f), vec3(1f), vec3(_e1883.needle)));
                }
            }
            let _e1888 = st_26;
            let _e1889 = forestGuide();
            let _e1890 = hit_8;
            if _e1890.needle {
                local_228 = 1f;
            } else {
                local_228 = 0f;
            }
            let _e1895 = local_228;
            let _e1896 = jitter_5;
            let _e1897 = special_4;
            let _e1898 = forestCrownColor(_e1888, _e1889, _e1895, _e1896, _e1897);
            let _e1900 = detailGain;
            let _e1901 = clump_1;
            let _e1904 = whorl;
            let _e1907 = flank;
            let _e1912 = st_26;
            let _e1915 = hit_8;
            crown_3 = (((_e1898 * ((1f + (_e1900 * _e1901)) + _e1904)) * _e1907) * (1f - (mix(0.12f, 0.3f, _e1912.trop) * _e1915.edge)));
            let _e1921 = crown_3;
            let _e1924 = foliageDetail_1;
            let _e1926 = leafClump_2;
            crown_3 = (_e1921 * (1f + ((0.3f * _e1924) * _e1926.x)));
            let _e1931 = hit_8;
            if _e1931.riparian {
                let _e1933 = crown_3;
                let _e1934 = st_26;
                let _e1935 = forestRiparianTint(_e1934);
                crown_3 = (_e1933 * _e1935);
            }
            let _e1937 = global.uForestTrees;
            if (_e1937.w > 0f) {
                let _e1941 = crown_3;
                let _e1945 = global.uForestTrees;
                let _e1947 = global.uForestTrees;
                let _e1949 = world_52;
                let _e1950 = global.uForestTrees;
                let _e1953 = groundSmooth(_e1945.z, _e1947.w, distance(_e1949, _e1950.xy));
                crown_3 = (_e1941 * mix(1f, 0.6f, (1f - _e1953)));
            }
            if (uRenderV2_ > 0i) {
                {
                    let _e1959 = st_26;
                    let _e1961 = st_26;
                    let _e1963 = forestKind(_e1959.trop, _e1961.dry);
                    fallKind = _e1963;
                    let _e1965 = hit_8;
                    if _e1965.needle {
                        local_229 = 0f;
                    } else {
                        let _e1968 = forestSeason();
                        let _e1971 = fallKind;
                        let _e1974 = fallKind;
                        let _e1977 = fallKind;
                        local_229 = (_e1968.x * (((1f - _e1971.x) - _e1974.y) - _e1977.z));
                    }
                    let _e1982 = local_229;
                    fall_2 = _e1982;
                    let _e1984 = fall_2;
                    if (_e1984 > 0f) {
                        {
                            let _e1987 = tint_9;
                            pick = fract((_e1987 * 5.31f));
                            let _e1992 = tint_9;
                            late = fract((_e1992 * 3.77f));
                            let _e1997 = pick;
                            if (_e1997 < 0.38f) {
                                local_232 = vec3<f32>(0.86f, 0.46f, 0.07f);
                            } else {
                                let _e2004 = pick;
                                if (_e2004 < 0.56f) {
                                    local_231 = vec3<f32>(0.64f, 0.18f, 0.07f);
                                } else {
                                    let _e2011 = pick;
                                    if (_e2011 < 0.86f) {
                                        local_230 = vec3<f32>(0.86f, 0.66f, 0.1f);
                                    } else {
                                        local_230 = vec3<f32>(0.3f, 0.4f, 0.12f);
                                    }
                                    let _e2023 = local_230;
                                    local_231 = _e2023;
                                }
                                let _e2025 = local_231;
                                local_232 = _e2025;
                            }
                            let _e2027 = local_232;
                            hue_1 = _e2027;
                            let _e2029 = pick;
                            if (_e2029 < 0.38f) {
                                local_235 = 1.35f;
                            } else {
                                let _e2033 = pick;
                                if (_e2033 < 0.56f) {
                                    local_234 = 1.08f;
                                } else {
                                    let _e2037 = pick;
                                    if (_e2037 < 0.86f) {
                                        local_233 = 1.4f;
                                    } else {
                                        local_233 = 1f;
                                    }
                                    let _e2043 = local_233;
                                    local_234 = _e2043;
                                }
                                let _e2045 = local_234;
                                local_235 = _e2045;
                            }
                            let _e2047 = local_235;
                            lift = _e2047;
                            let _e2049 = crown_3;
                            lum = dot(_e2049, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
                            let _e2056 = hue_1;
                            hueLum = dot(_e2056, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
                            let _e2063 = crown_3;
                            let _e2064 = hue_1;
                            let _e2065 = lum;
                            let _e2067 = lift;
                            let _e2069 = hueLum;
                            let _e2072 = fall_2;
                            let _e2073 = pick;
                            if (_e2073 < 0.86f) {
                                local_236 = 0.92f;
                            } else {
                                local_236 = 0.4f;
                            }
                            let _e2079 = local_236;
                            let _e2083 = late;
                            crown_3 = mix(_e2063, (((_e2064 * _e2065) * _e2067) / vec3(_e2069)), vec3(((_e2072 * _e2079) * (0.75f + (0.25f * _e2083)))));
                        }
                    }
                    let _e2089 = larch;
                    if _e2089 {
                        let _e2090 = crown_3;
                        let _e2097 = tint_9;
                        let _e2102 = forestSeason();
                        crown_3 = mix(_e2090, (vec3<f32>(0.7f, 0.52f, 0.17f) * (0.9f + (0.2f * _e2097))), vec3((0.85f * _e2102.x)));
                    }
                    let _e2107 = crown_3;
                    let _e2108 = tint_9;
                    let _e2109 = bare_6;
                    let _e2111 = forestBareColor(_e2108, _e2109.y);
                    let _e2113 = leaf_3;
                    crown_3 = mix(_e2107, _e2111, vec3((1f - _e2113)));
                    let _e2117 = crown_3;
                    let _e2118 = hit_8;
                    let _e2119 = sun_7;
                    let _e2120 = hit_8;
                    if _e2120.needle {
                        let _e2122 = bough_2;
                        local_237 = _e2122;
                    } else {
                        let _e2124 = foliageDetail_1;
                        let _e2125 = leafClump_2;
                        local_237 = (0.64f + (_e2124 * _e2125.x));
                    }
                    let _e2130 = local_237;
                    let _e2131 = forestCrownSnow(_e2118, _e2119, _e2130);
                    let _e2135 = bare_6;
                    let _e2139 = leaf_3;
                    let _e2145 = forestSnowed(_e2117, min((_e2131 * mix(1f, mix(1.2f, 0.4f, _e2135.y), (1f - _e2139))), 0.97f));
                    crown_3 = _e2145;
                }
            }
            if (uForestBrushes == 1i) {
                let _e2148 = hit_8;
                local_238 = _e2148.cover;
            } else {
                let _e2153 = hit_8;
                let _e2155 = groundSmooth(1f, 1.8f, _e2153.near);
                local_238 = (1f - _e2155);
            }
            let _e2158 = local_238;
            under_1 = _e2158;
            let _e2160 = openGround;
            let _e2161 = litter_1;
            let _e2162 = under_1;
            let _e2165 = forestFloorAlbedo(mix(_e2160, _e2161, vec3(_e2162)));
            let _e2166 = crown_3;
            let _e2167 = groundToLinear(_e2166);
            let _e2168 = hit_8;
            nearAlbedo = mix(_e2165, _e2167, vec3(_e2168.cover));
            let _e2173 = nGround_1;
            let _e2174 = l_8;
            let _e2175 = shade_2;
            let _e2178 = forestTilt(_e2173, _e2174, (_e2175 * 0.3f));
            let _e2179 = nCrown;
            let _e2180 = hit_8;
            nearNormal = normalize(mix(_e2178, _e2179, vec3(_e2180.cover)));
            let _e2186 = (*m_6);
            let _e2190 = under_1;
            let _e2193 = occCrown;
            let _e2194 = hit_8;
            nearOcc = mix((_e2186.occlusion * mix(1f, 0.72f, _e2190)), _e2193, _e2194.cover);
            let _e2198 = (*m_6);
            let _e2201 = hit_8;
            nearRough = mix(_e2198.roughness, 0.9f, _e2201.cover);
            let _e2205 = albedo;
            let _e2206 = nearAlbedo;
            let _e2207 = crownVis;
            albedo = mix(_e2205, _e2206, vec3(_e2207));
            let _e2210 = normal_2;
            let _e2211 = nearNormal;
            let _e2212 = crownVis;
            normal_2 = normalize(mix(_e2210, _e2211, vec3(_e2212)));
            let _e2216 = occlusion;
            let _e2217 = nearOcc;
            let _e2218 = crownVis;
            occlusion = mix(_e2216, _e2217, _e2218);
            let _e2220 = roughness_1;
            let _e2221 = nearRough;
            let _e2222 = crownVis;
            roughness_1 = mix(_e2220, _e2221, _e2222);
        }
    }
    let _e2225 = refAlbedo;
    let _e2226 = albedo;
    let _e2227 = reveal;
    (*m_6).albedo = mix(_e2225, _e2226, vec3(_e2227));
    let _e2231 = (*m_6);
    let _e2233 = normal_2;
    let _e2234 = reveal;
    (*m_6).normal = normalize(mix(_e2231.normal, _e2233, vec3(_e2234)));
    let _e2239 = (*m_6);
    let _e2241 = occlusion;
    let _e2242 = reveal;
    (*m_6).occlusion = mix(_e2239.occlusion, _e2241, _e2242);
    let _e2245 = (*m_6);
    let _e2247 = roughness_1;
    let _e2248 = reveal;
    (*m_6).roughness = mix(_e2245.roughness, _e2247, _e2248);
    return;
}

fn landCropTone(t_20: f32, green_2: f32) -> vec3<f32> {
    var t_21: f32;
    var green_3: f32;
    var plough: vec3<f32> = vec3<f32>(0.36f, 0.29f, 0.21f);
    var stubble: vec3<f32> = vec3<f32>(0.55f, 0.49f, 0.36f);
    var wheat: vec3<f32> = vec3<f32>(0.58f, 0.51f, 0.32f);
    var barley: vec3<f32> = vec3<f32>(0.53f, 0.51f, 0.32f);
    var oats: vec3<f32> = vec3<f32>(0.4f, 0.45f, 0.25f);
    var beans: vec3<f32> = vec3<f32>(0.27f, 0.36f, 0.2f);
    var local_239: vec3<f32>;
    var local_240: vec3<f32>;
    var local_241: vec3<f32>;
    var local_242: vec3<f32>;
    var c_38: vec3<f32>;
    var winter: vec3<f32>;

    t_21 = t_20;
    green_3 = green_2;
    let _e326 = t_21;
    if (_e326 < 0.18f) {
        let _e329 = plough;
        let _e330 = stubble;
        let _e331 = t_21;
        local_242 = mix(_e329, _e330, vec3((_e331 / 0.18f)));
    } else {
        let _e336 = t_21;
        if (_e336 < 0.36f) {
            let _e339 = stubble;
            let _e340 = wheat;
            let _e341 = t_21;
            local_241 = mix(_e339, _e340, vec3(((_e341 - 0.18f) / 0.18f)));
        } else {
            let _e348 = t_21;
            if (_e348 < 0.52f) {
                let _e351 = wheat;
                let _e352 = barley;
                let _e353 = t_21;
                local_240 = mix(_e351, _e352, vec3(((_e353 - 0.36f) / 0.16f)));
            } else {
                let _e360 = t_21;
                if (_e360 < 0.72f) {
                    let _e363 = barley;
                    let _e364 = oats;
                    let _e365 = t_21;
                    local_239 = mix(_e363, _e364, vec3(((_e365 - 0.52f) / 0.2f)));
                } else {
                    let _e372 = oats;
                    let _e373 = beans;
                    let _e374 = t_21;
                    local_239 = mix(_e372, _e373, vec3(((_e374 - 0.72f) / 0.28f)));
                }
                let _e382 = local_239;
                local_240 = _e382;
            }
            let _e384 = local_240;
            local_241 = _e384;
        }
        let _e386 = local_241;
        local_242 = _e386;
    }
    let _e388 = local_242;
    c_38 = _e388;
    let _e400 = t_21;
    let _e401 = groundSmooth(0.3f, 0.8f, _e400);
    winter = mix(vec3<f32>(0.31f, 0.25f, 0.19f), vec3<f32>(0.25f, 0.35f, 0.19f), vec3(_e401));
    let _e405 = winter;
    let _e406 = c_38;
    let _e407 = green_3;
    return mix(_e405, _e406, vec3(_e407));
}

fn landFieldTone(t_22: f32, green_4: f32) -> vec3<f32> {
    var t_23: f32;
    var green_5: f32;
    var ph: f32;
    var ripe: f32;
    var turned: vec3<f32> = vec3<f32>(0.31f, 0.25f, 0.19f);
    var plough_1: vec3<f32> = vec3<f32>(0.39f, 0.32f, 0.24f);
    var fallow: vec3<f32> = vec3<f32>(0.44f, 0.4f, 0.31f);
    var stubble_1: vec3<f32> = vec3<f32>(0.55f, 0.49f, 0.36f);
    var wheat_1: vec3<f32>;
    var barley_1: vec3<f32> = vec3<f32>(0.53f, 0.51f, 0.32f);
    var rye: vec3<f32> = vec3<f32>(0.45f, 0.47f, 0.34f);
    var oats_1: vec3<f32> = vec3<f32>(0.4f, 0.45f, 0.25f);
    var clover: vec3<f32> = vec3<f32>(0.33f, 0.44f, 0.22f);
    var beans_1: vec3<f32> = vec3<f32>(0.31f, 0.39f, 0.21f);
    var local_243: vec3<f32>;
    var local_244: vec3<f32>;
    var local_245: vec3<f32>;
    var local_246: vec3<f32>;
    var local_247: vec3<f32>;
    var local_248: vec3<f32>;
    var local_249: vec3<f32>;
    var local_250: vec3<f32>;
    var c_39: vec3<f32>;
    var winter_1: vec3<f32>;

    t_23 = t_22;
    green_5 = green_4;
    let _e296 = global.uV2Season;
    ph = fract(_e296);
    let _e301 = ph;
    let _e302 = groundSmooth(0.42f, 0.5f, _e301);
    let _e306 = ph;
    let _e307 = groundSmooth(0.62f, 0.68f, _e306);
    ripe = (_e302 * (1f - _e307));
    let _e339 = ripe;
    wheat_1 = mix(vec3<f32>(0.58f, 0.51f, 0.32f), vec3<f32>(0.6f, 0.54f, 0.37f), vec3(_e339));
    let _e368 = t_23;
    if (_e368 < 0.07f) {
        let _e371 = turned;
        let _e372 = plough_1;
        let _e373 = t_23;
        local_250 = mix(_e371, _e372, vec3((_e373 / 0.07f)));
    } else {
        let _e378 = t_23;
        if (_e378 < 0.14f) {
            let _e381 = plough_1;
            let _e382 = fallow;
            let _e383 = t_23;
            local_249 = mix(_e381, _e382, vec3(((_e383 - 0.07f) / 0.07f)));
        } else {
            let _e390 = t_23;
            if (_e390 < 0.21f) {
                let _e393 = fallow;
                let _e394 = stubble_1;
                let _e395 = t_23;
                local_248 = mix(_e393, _e394, vec3(((_e395 - 0.14f) / 0.07f)));
            } else {
                let _e402 = t_23;
                if (_e402 < 0.32f) {
                    let _e405 = stubble_1;
                    let _e406 = wheat_1;
                    let _e407 = t_23;
                    local_247 = mix(_e405, _e406, vec3(((_e407 - 0.21f) / 0.11f)));
                } else {
                    let _e414 = t_23;
                    if (_e414 < 0.43f) {
                        let _e417 = wheat_1;
                        let _e418 = barley_1;
                        let _e419 = t_23;
                        local_246 = mix(_e417, _e418, vec3(((_e419 - 0.32f) / 0.11f)));
                    } else {
                        let _e426 = t_23;
                        if (_e426 < 0.7f) {
                            let _e429 = barley_1;
                            let _e430 = rye;
                            let _e431 = t_23;
                            local_245 = mix(_e429, _e430, vec3(((_e431 - 0.43f) / 0.27f)));
                        } else {
                            let _e438 = t_23;
                            if (_e438 < 0.79f) {
                                let _e441 = rye;
                                let _e442 = oats_1;
                                let _e443 = t_23;
                                local_244 = mix(_e441, _e442, vec3(((_e443 - 0.7f) / 0.09f)));
                            } else {
                                let _e450 = t_23;
                                if (_e450 < 0.89f) {
                                    let _e453 = oats_1;
                                    let _e454 = clover;
                                    let _e455 = t_23;
                                    local_243 = mix(_e453, _e454, vec3(((_e455 - 0.79f) / 0.1f)));
                                } else {
                                    let _e462 = clover;
                                    let _e463 = beans_1;
                                    let _e464 = t_23;
                                    local_243 = mix(_e462, _e463, vec3(((_e464 - 0.89f) / 0.11f)));
                                }
                                let _e472 = local_243;
                                local_244 = _e472;
                            }
                            let _e474 = local_244;
                            local_245 = _e474;
                        }
                        let _e476 = local_245;
                        local_246 = _e476;
                    }
                    let _e478 = local_246;
                    local_247 = _e478;
                }
                let _e480 = local_247;
                local_248 = _e480;
            }
            let _e482 = local_248;
            local_249 = _e482;
        }
        let _e484 = local_249;
        local_250 = _e484;
    }
    let _e486 = local_250;
    c_39 = _e486;
    let _e498 = t_23;
    let _e499 = groundSmooth(0.3f, 0.8f, _e498);
    winter_1 = mix(vec3<f32>(0.31f, 0.25f, 0.19f), vec3<f32>(0.25f, 0.35f, 0.19f), vec3(_e499));
    let _e503 = winter_1;
    let _e504 = c_39;
    let _e505 = green_5;
    return mix(_e503, _e504, vec3(_e505));
}

fn landFieldDryTone(t_24: f32, green_6: f32, bare_8: vec3<f32>) -> vec3<f32> {
    var t_25: f32;
    var green_7: f32;
    var bare_9: vec3<f32>;
    var turned_1: vec3<f32>;
    var fallow_1: vec3<f32>;
    var stubble_2: vec3<f32> = vec3<f32>(0.66f, 0.59f, 0.42f);
    var irrigated: vec3<f32>;
    var c_40: vec3<f32>;
    var winter_2: vec3<f32>;

    t_25 = t_24;
    green_7 = green_6;
    bare_9 = bare_8;
    let _e298 = bare_9;
    turned_1 = mix(_e298, vec3<f32>(0.4f, 0.31f, 0.22f), vec3(0.55f));
    let _e307 = bare_9;
    fallow_1 = mix(_e307, vec3<f32>(0.58f, 0.5f, 0.37f), vec3(0.45f));
    let _e329 = green_7;
    irrigated = mix(vec3<f32>(0.33f, 0.38f, 0.2f), vec3<f32>(0.25f, 0.37f, 0.17f), vec3(_e329));
    let _e333 = turned_1;
    let _e334 = fallow_1;
    let _e337 = t_25;
    let _e338 = groundSmooth(0.03f, 0.17f, _e337);
    let _e341 = stubble_2;
    let _e344 = t_25;
    let _e345 = groundSmooth(0.17f, 0.3f, _e344);
    let _e348 = irrigated;
    let _e351 = t_25;
    let _e352 = groundSmooth(0.7f, 0.8f, _e351);
    c_40 = mix(mix(mix(_e333, _e334, vec3(_e338)), _e341, vec3(_e345)), _e348, vec3(_e352));
    let _e356 = turned_1;
    let _e363 = t_25;
    let _e364 = groundSmooth(0.3f, 0.8f, _e363);
    winter_2 = mix(_e356, vec3<f32>(0.31f, 0.37f, 0.2f), vec3(_e364));
    let _e368 = winter_2;
    let _e369 = c_40;
    let _e370 = green_7;
    return mix(_e368, _e369, vec3(_e370));
}

fn landYellowShare(t_26: f32) -> f32 {
    var t_27: f32;

    t_27 = t_26;
    let _e296 = t_27;
    let _e297 = groundSmooth(0.45f, 0.52f, _e296);
    let _e301 = t_27;
    let _e302 = groundSmooth(0.62f, 0.69f, _e301);
    return (_e297 * (1f - _e302));
}

fn landYellowCrop(t_28: f32) -> vec3<f32> {
    var t_29: f32;
    var ph_1: f32;
    var rape: vec3<f32>;
    var sun_8: vec3<f32>;

    t_29 = t_28;
    let _e294 = global.uV2Season;
    ph_1 = fract(_e294);
    let _e307 = ph_1;
    let _e308 = groundSmooth(0.12f, 0.22f, _e307);
    rape = mix(vec3<f32>(0.28f, 0.32f, 0.2f), vec3<f32>(0.33f, 0.42f, 0.21f), vec3(_e308));
    let _e312 = rape;
    let _e319 = ph_1;
    let _e320 = groundSmooth(0.28f, 0.32f, _e319);
    rape = mix(_e312, vec3<f32>(0.58f, 0.57f, 0.31f), vec3(_e320));
    let _e323 = rape;
    let _e330 = ph_1;
    let _e331 = groundSmooth(0.4f, 0.45f, _e330);
    rape = mix(_e323, vec3<f32>(0.47f, 0.46f, 0.29f), vec3(_e331));
    let _e334 = rape;
    let _e341 = ph_1;
    let _e342 = groundSmooth(0.58f, 0.63f, _e341);
    rape = mix(_e334, vec3<f32>(0.55f, 0.49f, 0.36f), vec3(_e342));
    let _e345 = rape;
    let _e352 = ph_1;
    let _e353 = groundSmooth(0.78f, 0.88f, _e352);
    rape = mix(_e345, vec3<f32>(0.28f, 0.32f, 0.2f), vec3(_e353));
    let _e366 = ph_1;
    let _e367 = groundSmooth(0.3f, 0.4f, _e366);
    sun_8 = mix(vec3<f32>(0.35f, 0.29f, 0.21f), vec3<f32>(0.35f, 0.42f, 0.23f), vec3(_e367));
    let _e371 = sun_8;
    let _e378 = ph_1;
    let _e379 = groundSmooth(0.45f, 0.5f, _e378);
    sun_8 = mix(_e371, vec3<f32>(0.53f, 0.5f, 0.31f), vec3(_e379));
    let _e382 = sun_8;
    let _e389 = ph_1;
    let _e390 = groundSmooth(0.6f, 0.66f, _e389);
    sun_8 = mix(_e382, vec3<f32>(0.37f, 0.33f, 0.24f), vec3(_e390));
    let _e393 = sun_8;
    let _e400 = ph_1;
    let _e401 = groundSmooth(0.76f, 0.84f, _e400);
    sun_8 = mix(_e393, vec3<f32>(0.42f, 0.36f, 0.27f), vec3(_e401));
    let _e404 = rape;
    let _e405 = sun_8;
    let _e408 = t_29;
    let _e409 = groundSmooth(0.555f, 0.585f, _e408);
    return mix(_e404, _e405, vec3(_e409));
}

fn landDetailInside(uv_16: vec2<f32>, footprint_26: f32, edge_3: ptr<function, f32>) -> vec2<f32> {
    var uv_17: vec2<f32>;
    var footprint_27: f32;
    var cell_16: f32;
    var r_4: f32;
    var sd_1: f32;
    var a0_: f32;
    var a1_: f32;
    var a2_1: f32;
    var g_17: vec2<f32>;
    var s_22: f32;

    uv_17 = uv_16;
    footprint_27 = footprint_26;
    let _e297 = global.uLandDetailRect;
    let _e299 = global.uLandDetailN;
    cell_16 = (_e297.z / _e299);
    let _e303 = global.uLandDetailN;
    r_4 = (0.5f / _e303);
    let _e306 = uv_17;
    let _e308 = landDetailSample(_e306, 0f);
    let _e310 = landDetailDist(_e308.w);
    sd_1 = _e310;
    let _e312 = sd_1;
    (*edge_3) = max(_e312, 0f);
    let _e315 = footprint_27;
    let _e316 = cell_16;
    let _e320 = sd_1;
    let _e322 = cell_16;
    if ((_e315 < (_e316 * 2f)) && (abs(_e320) < (_e322 * 1.2f))) {
        {
            let _e327 = uv_17;
            let _e329 = r_4;
            let _e333 = landDetailSample((_e327 + vec2<f32>(0f, _e329)), 0f);
            a0_ = _e333.w;
            let _e336 = uv_17;
            let _e342 = r_4;
            let _e346 = landDetailSample((_e336 + (vec2<f32>(-0.8660254f, -0.5f) * _e342)), 0f);
            a1_ = _e346.w;
            let _e349 = uv_17;
            let _e354 = r_4;
            let _e358 = landDetailSample((_e349 + (vec2<f32>(0.8660254f, -0.5f) * _e354)), 0f);
            a2_1 = _e358.w;
            let _e361 = a0_;
            let _e366 = a1_;
            let _e374 = a2_1;
            let _e383 = landDetailRange();
            let _e388 = cell_16;
            g_17 = (((((((_e361 * vec2<f32>(0f, 1f)) + (_e366 * vec2<f32>(-0.8660254f, -0.5f))) + (_e374 * vec2<f32>(0.8660254f, -0.5f))) * 2f) * _e383) * 2f) / vec2(((3f * _e388) * 0.5f)));
            let _e395 = g_17;
            s_22 = length(_e395);
            let _e398 = s_22;
            if (_e398 > 0.5f) {
                let _e401 = uv_17;
                let _e402 = g_17;
                let _e403 = s_22;
                let _e406 = cell_16;
                let _e409 = sd_1;
                let _e412 = global.uLandDetailRect;
                uv_17 = (_e401 + (((_e402 / vec2(_e403)) * ((_e406 * 1.2f) - _e409)) / vec2(_e412.z)));
            }
        }
    }
    let _e417 = uv_17;
    return _e417;
}

fn landField(world_53: vec2<f32>, footprint_28: f32, green_8: f32, bare_10: vec3<f32>, dry_5: f32, slope_9: ptr<function, vec2<f32>>, rough: ptr<function, f32>) -> vec3<f32> {
    var world_54: vec2<f32>;
    var footprint_29: f32;
    var green_9: f32;
    var bare_11: vec3<f32>;
    var dry_6: f32;
    var uv_18: vec2<f32>;
    var cell_17: f32;
    var edge_4: f32;
    var lod_5: f32;
    var d_22: vec4<f32>;
    var c2_2: vec2<f32>;
    var a_26: f32;
    var along_3: vec2<f32>;
    var across_3: vec2<f32>;
    var u_13: f32;
    var v_17: f32;
    var salt_27: u32;
    var patchy: f32;
    var soil_6: f32;
    var crop: f32;
    var c_41: vec3<f32>;
    var mottle_1: f32;
    var ridgeKeep: f32;
    var p_43: f32;
    var rowKeep: f32;
    var wander: f32;
    var p_44: f32;
    var row_1: f32;
    var grain_3: f32;
    var speckKeep: f32;
    var keep_5: f32;
    var balk: f32;
    var grass_7: vec3<f32>;
    var limit: f32;
    var contrast: f32;

    world_54 = world_53;
    footprint_29 = footprint_28;
    green_9 = green_8;
    bare_11 = bare_10;
    dry_6 = dry_5;
    (*slope_9) = vec2(0f);
    (*rough) = 0.94f;
    let _e309 = world_54;
    let _e310 = global.uLandDetailRect;
    let _e313 = global.uLandDetailRect;
    uv_18 = ((_e309 - _e310.xy) / vec2(_e313.z));
    let _e318 = global.uLandDetailRect;
    let _e320 = global.uLandDetailN;
    cell_17 = (_e318.z / _e320);
    let _e324 = footprint_29;
    let _e327 = cell_17;
    lod_5 = max(log2((max(_e324, 0.001f) / _e327)), 0f);
    landFieldCrop = -1f;
    let _e335 = uv_18;
    let _e336 = footprint_29;
    let _e339 = landDetailInside(_e335, _e336, (&edge_4));
    let _e340 = lod_5;
    let _e341 = landDetailSample(_e339, _e340);
    d_22 = _e341;
    let _e343 = d_22;
    if (_e343.w <= 0f) {
        let _e347 = bare_11;
        return mix(_e347, vec3<f32>(0.39f, 0.36f, 0.22f), vec3(0.5f));
    }
    let _e355 = d_22;
    landFieldCrop = _e355.x;
    let _e357 = edge_4;
    landFieldEdge = _e357;
    let _e358 = d_22;
    c2_2 = ((_e358.yz * 2f) - vec2(1f));
    let _e367 = c2_2;
    let _e369 = c2_2;
    a_26 = (0.5f * atan2(_e367.y, _e369.x));
    let _e374 = a_26;
    let _e376 = a_26;
    along_3 = vec2<f32>(cos(_e374), sin(_e376));
    let _e380 = along_3;
    let _e383 = along_3;
    across_3 = vec2<f32>(-(_e380.y), _e383.x);
    let _e387 = world_54;
    let _e388 = across_3;
    u_13 = dot(_e387, _e388);
    let _e391 = world_54;
    let _e392 = along_3;
    v_17 = dot(_e391, _e392);
    let _e395 = global.uMaterialSeed;
    salt_27 = (_e395 + 977u);
    let _e399 = world_54;
    let _e402 = (_e399 / vec2(70f));
    let _e403 = d_22;
    let _e410 = salt_27;
    let _e411 = surfaceNoise(vec3<f32>(_e402.x, _e402.y, (_e403.x * 23f)), _e410);
    patchy = _e411;
    let _e413 = world_54;
    let _e416 = (_e413 / vec2(23f));
    let _e417 = d_22;
    let _e424 = salt_27;
    let _e427 = surfaceNoise(vec3<f32>(_e416.x, _e416.y, (_e417.x * 23f)), (_e424 + 1u));
    soil_6 = _e427;
    let _e429 = d_22;
    let _e431 = patchy;
    crop = clamp((_e429.x + (_e431 * 0.012f)), 0f, 1f);
    let _e439 = crop;
    let _e440 = green_9;
    let _e441 = landFieldTone(_e439, _e440);
    let _e442 = crop;
    let _e443 = green_9;
    let _e444 = bare_11;
    let _e445 = landFieldDryTone(_e442, _e443, _e444);
    let _e446 = dry_6;
    c_41 = mix(_e441, _e445, vec3(_e446));
    let _e450 = c_41;
    let _e451 = crop;
    let _e452 = landYellowCrop(_e451);
    let _e453 = crop;
    let _e454 = landYellowShare(_e453);
    c_41 = mix(_e450, _e452, vec3(_e454));
    let _e461 = d_22;
    let _e470 = groundSmooth(0.25f, 0.9f, (0.5f + (0.5f * sin(((_e461.x * 157f) + 1.3f)))));
    mottle_1 = _e470;
    let _e472 = c_41;
    let _e474 = mottle_1;
    let _e476 = patchy;
    let _e479 = soil_6;
    c_41 = (_e472 * (1f + (_e474 * ((0.025f * _e476) + (0.02f * _e479)))));
    let _e488 = footprint_29;
    let _e489 = groundSmooth(2.4f, 5f, _e488);
    let _e494 = crop;
    let _e495 = groundSmooth(0.16f, 0.24f, _e494);
    let _e502 = d_22;
    let _e511 = groundSmooth(0.35f, 0.75f, (0.5f + (0.5f * sin(((_e502.x * 97f) + 0.4f)))));
    ridgeKeep = (((1f - _e489) * (1f - _e495)) * _e511);
    let _e514 = ridgeKeep;
    if (_e514 > 0f) {
        {
            let _e517 = u_13;
            p_43 = (_e517 * 0.6283185f);
            let _e521 = c_41;
            let _e524 = p_43;
            let _e527 = ridgeKeep;
            c_41 = (_e521 * (1f + ((0.018f * cos(_e524)) * _e527)));
            let _e531 = (*slope_9);
            let _e532 = across_3;
            let _e533 = p_43;
            let _e538 = ridgeKeep;
            (*slope_9) = (_e531 + (_e532 * ((-(sin(_e533)) * 0.04f) * _e538)));
        }
    }
    let _e545 = footprint_29;
    let _e546 = groundSmooth(0.35f, 0.95f, _e545);
    rowKeep = (1f - _e546);
    let _e549 = rowKeep;
    if (_e549 > 0f) {
        {
            let _e552 = v_17;
            let _e555 = u_13;
            let _e560 = salt_27;
            let _e563 = surfaceNoise(vec3<f32>((_e552 / 70f), (_e555 / 240f), 0f), (_e560 + 2u));
            wander = (_e563 * 3f);
            let _e567 = u_13;
            let _e568 = wander;
            p_44 = ((_e567 + (_e568 * 0.2f)) * 3.3069f);
            let _e575 = p_44;
            row_1 = cos(_e575);
            let _e578 = u_13;
            let _e581 = v_17;
            let _e586 = salt_27;
            let _e589 = surfaceNoise(vec3<f32>((_e578 * 2.4f), (_e581 * 0.35f), 0f), (_e586 + 3u));
            grain_3 = _e589;
            let _e591 = c_41;
            let _e593 = rowKeep;
            let _e595 = row_1;
            let _e598 = grain_3;
            c_41 = (_e591 * (1f + (_e593 * ((0.06f * _e595) + (0.05f * _e598)))));
            let _e604 = (*slope_9);
            let _e605 = across_3;
            let _e606 = p_44;
            let _e611 = rowKeep;
            (*slope_9) = (_e604 + (_e605 * ((-(sin(_e606)) * 0.14f) * _e611)));
        }
    }
    let _e618 = footprint_29;
    let _e619 = groundSmooth(0.25f, 0.7f, _e618);
    speckKeep = (1f - _e619);
    let _e622 = speckKeep;
    if (_e622 > 0f) {
        let _e625 = c_41;
        let _e627 = speckKeep;
        let _e630 = world_54;
        let _e632 = (_e630 * 1.7f);
        let _e637 = salt_27;
        let _e640 = surfaceNoise(vec3<f32>(_e632.x, _e632.y, 0f), (_e637 + 4u));
        c_41 = (_e625 * (1f + ((_e627 * 0.05f) * _e640)));
    }
    let _e647 = footprint_29;
    let _e648 = groundSmooth(0.7f, 2.6f, _e647);
    keep_5 = (1f - _e648);
    let _e651 = keep_5;
    if (_e651 > 0f) {
        {
            let _e654 = keep_5;
            let _e658 = patchy;
            let _e659 = groundSmooth(-0.15f, 0.35f, _e658);
            let _e664 = edge_4;
            let _e666 = soil_6;
            let _e669 = groundSmooth(0.12f, 0.55f, (_e664 + (0.15f * _e666)));
            balk = ((_e654 * _e659) * (1f - _e669));
            let _e681 = green_9;
            let _e686 = patchy;
            grass_7 = (mix(vec3<f32>(0.33f, 0.31f, 0.21f), vec3<f32>(0.32f, 0.38f, 0.22f), vec3(_e681)) * (1f + (0.08f * _e686)));
            let _e691 = c_41;
            let _e692 = grass_7;
            let _e693 = balk;
            c_41 = mix(_e691, _e692, vec3((_e693 * 0.45f)));
            let _e700 = balk;
            (*rough) = mix(0.94f, 0.86f, _e700);
        }
    }
    let _e704 = footprint_29;
    let _e709 = edge_4;
    let _e710 = groundSmooth(0f, max((_e704 * 0.8f), 1.2f), _e709);
    let _e714 = footprint_29;
    let _e715 = groundSmooth(0.7f, 2.6f, _e714);
    let _e720 = footprint_29;
    let _e721 = groundSmooth(14f, 40f, _e720);
    limit = (((1f - _e710) * _e715) * (1f - _e721));
    let _e725 = limit;
    if (_e725 > 0f) {
        {
            let _e730 = uv_18;
            let _e731 = lod_5;
            let _e734 = landDetailSample(_e730, (_e731 + 1.5f));
            let _e736 = d_22;
            let _e740 = groundSmooth(0.04f, 0.15f, abs((_e734.x - _e736.x)));
            contrast = _e740;
            let _e742 = c_41;
            let _e745 = limit;
            let _e747 = contrast;
            let _e752 = soil_6;
            let _e754 = patchy;
            let _e757 = groundSmooth(-0.3f, 0.3f, (_e752 + (0.5f * _e754)));
            c_41 = (_e742 * (1f - (((0.1f * _e745) * _e747) * _e757)));
        }
    }
    let _e761 = c_41;
    return _e761;
}

fn landGrass(world_55: vec2<f32>, footprint_30: f32, green_10: f32, bare_12: vec3<f32>, grazed: bool) -> vec3<f32> {
    var world_56: vec2<f32>;
    var footprint_31: f32;
    var green_11: f32;
    var bare_13: vec3<f32>;
    var grazed_1: bool;
    var salt_28: u32;
    var broad_4: f32;
    var mid: f32;
    var lush: vec3<f32>;
    var rank: vec3<f32>;
    var ragged_1: f32;
    var community_1: f32;
    var c_42: vec3<f32>;
    var keep_6: f32;

    world_56 = world_55;
    footprint_31 = footprint_30;
    green_11 = green_10;
    bare_13 = bare_12;
    grazed_1 = grazed;
    let _e304 = global.uMaterialSeed;
    salt_28 = (_e304 + 1013u);
    let _e308 = world_56;
    let _e311 = (_e308 / vec2(120f));
    let _e316 = salt_28;
    let _e317 = surfaceNoise(vec3<f32>(_e311.x, _e311.y, 0f), _e316);
    broad_4 = _e317;
    let _e319 = world_56;
    let _e322 = (_e319 / vec2(34f));
    let _e327 = salt_28;
    let _e330 = surfaceNoise(vec3<f32>(_e322.x, _e322.y, 0f), (_e327 + 1u));
    mid = _e330;
    let _e340 = green_11;
    lush = mix(vec3<f32>(0.36f, 0.38f, 0.24f), vec3<f32>(0.3f, 0.42f, 0.21f), vec3(_e340));
    let _e352 = green_11;
    rank = mix(vec3<f32>(0.4f, 0.37f, 0.25f), vec3<f32>(0.4f, 0.43f, 0.24f), vec3(_e352));
    let _e358 = footprint_31;
    ragged_1 = (0.12f + (0.05f * _e358));
    let _e365 = footprint_31;
    let _e366 = groundSmooth(4f, 14f, _e365);
    let _e368 = ragged_1;
    let _e370 = ragged_1;
    let _e371 = broad_4;
    let _e373 = mid;
    let _e376 = groundSmooth(-(_e368), _e370, (_e371 + (0.6f * _e373)));
    community_1 = ((1f - _e366) * (_e376 - 0.5f));
    let _e381 = lush;
    let _e382 = rank;
    let _e384 = community_1;
    c_42 = mix(_e381, _e382, vec3((0.5f + _e384)));
    let _e389 = grazed_1;
    if _e389 {
        {
            let _e390 = c_42;
            let _e399 = green_11;
            c_42 = mix(_e390, mix(vec3<f32>(0.42f, 0.39f, 0.28f), vec3<f32>(0.42f, 0.44f, 0.27f), vec3(_e399)), vec3(0.45f));
            let _e405 = c_42;
            let _e408 = community_1;
            c_42 = (_e405 * (1f + (0.03f * _e408)));
        }
    } else {
        {
            let _e415 = footprint_31;
            let _e416 = groundSmooth(0.8f, 2.2f, _e415);
            keep_6 = (1f - _e416);
            let _e419 = keep_6;
            if (_e419 > 0f) {
                let _e422 = c_42;
                let _e424 = keep_6;
                let _e427 = world_56;
                let _e435 = broad_4;
                c_42 = (_e422 * (1f + ((_e424 * 0.03f) * cos(((dot(_e427, vec2<f32>(0.31f, 0.95f)) * 1.05f) + (2f * _e435))))));
            }
        }
    }
    let _e442 = bare_13;
    let _e443 = c_42;
    let _e449 = community_1;
    return (mix(_e442, _e443, vec3(0.62f)) * (1f + (0.035f * _e449)));
}

fn landHeath(world_57: vec2<f32>, footprint_32: f32, green_12: f32, bare_14: vec3<f32>) -> vec3<f32> {
    var world_58: vec2<f32>;
    var footprint_33: f32;
    var green_13: f32;
    var bare_15: vec3<f32>;
    var salt_29: u32;
    var broad_5: f32;
    var mid_1: f32;
    var fine_10: f32;
    var t_30: f32;
    var bracken: vec3<f32>;
    var gorse: vec3<f32>;

    world_58 = world_57;
    footprint_33 = footprint_32;
    green_13 = green_12;
    bare_15 = bare_14;
    let _e302 = global.uMaterialSeed;
    salt_29 = (_e302 + 1039u);
    let _e306 = world_58;
    let _e309 = (_e306 / vec2(58f));
    let _e314 = salt_29;
    let _e315 = surfaceNoise(vec3<f32>(_e309.x, _e309.y, 0f), _e314);
    broad_5 = _e315;
    let _e317 = world_58;
    let _e320 = (_e317 / vec2(15f));
    let _e325 = salt_29;
    let _e328 = surfaceNoise(vec3<f32>(_e320.x, _e320.y, 0f), (_e325 + 1u));
    mid_1 = _e328;
    let _e330 = world_58;
    let _e333 = (_e330 / vec2(4.6f));
    let _e338 = salt_29;
    let _e341 = surfaceNoise(vec3<f32>(_e333.x, _e333.y, 0f), (_e338 + 2u));
    fine_10 = _e341;
    let _e345 = broad_5;
    let _e349 = mid_1;
    let _e353 = fine_10;
    let _e358 = footprint_33;
    let _e359 = groundSmooth(1f, 3f, _e358);
    t_30 = clamp((((0.5f + (0.8f * _e345)) + (0.5f * _e349)) + ((0.3f * _e353) * (1f - _e359))), 0f, 1f);
    let _e375 = green_13;
    bracken = mix(vec3<f32>(0.4f, 0.33f, 0.23f), vec3<f32>(0.34f, 0.37f, 0.21f), vec3(_e375));
    let _e387 = green_13;
    gorse = mix(vec3<f32>(0.28f, 0.3f, 0.2f), vec3<f32>(0.25f, 0.32f, 0.18f), vec3(_e387));
    let _e391 = bare_15;
    let _e392 = bracken;
    let _e393 = gorse;
    let _e396 = t_30;
    let _e397 = groundSmooth(0.35f, 0.75f, _e396);
    return mix(_e391, mix(_e392, _e393, vec3(_e397)), vec3(0.5f));
}

fn landMarsh(world_59: vec2<f32>, footprint_34: f32, bare_16: vec3<f32>, rough_1: ptr<function, f32>, pool: ptr<function, f32>) -> vec3<f32> {
    var world_60: vec2<f32>;
    var footprint_35: f32;
    var bare_17: vec3<f32>;
    var salt_30: u32;
    var broad_6: f32;
    var mid_2: f32;
    var keep_7: f32;
    var seen: f32;
    var ragged_2: f32;
    var local_251: f32;
    var tussock: f32;
    var channel: f32;
    var thread: f32;
    var sedge: f32;
    var rush: vec3<f32>;
    var water_1: vec3<f32> = vec3<f32>(0.24f, 0.29f, 0.26f);

    world_60 = world_59;
    footprint_35 = footprint_34;
    bare_17 = bare_16;
    let _e302 = global.uMaterialSeed;
    salt_30 = (_e302 + 1061u);
    let _e306 = world_60;
    let _e309 = (_e306 / vec2(41f));
    let _e314 = salt_30;
    let _e315 = surfaceNoise(vec3<f32>(_e309.x, _e309.y, 0f), _e314);
    broad_6 = _e315;
    let _e317 = world_60;
    let _e320 = (_e317 / vec2(13f));
    let _e325 = salt_30;
    let _e328 = surfaceNoise(vec3<f32>(_e320.x, _e320.y, 0f), (_e325 + 1u));
    mid_2 = _e328;
    let _e333 = footprint_35;
    let _e334 = groundSmooth(0.6f, 1.8f, _e333);
    keep_7 = (1f - _e334);
    let _e340 = footprint_35;
    let _e341 = groundSmooth(5f, 12f, _e340);
    seen = (1f - _e341);
    let _e345 = footprint_35;
    ragged_2 = clamp((0.06f * _e345), 0.04f, 0.5f);
    let _e351 = keep_7;
    if (_e351 > 0f) {
        let _e354 = world_60;
        let _e357 = (_e354 / vec2(2.1f));
        let _e362 = salt_30;
        let _e365 = surfaceNoise(vec3<f32>(_e357.x, _e357.y, 0f), (_e362 + 2u));
        let _e366 = keep_7;
        local_251 = (_e365 * _e366);
    } else {
        local_251 = 0f;
    }
    let _e370 = local_251;
    tussock = _e370;
    let _e372 = broad_6;
    let _e374 = mid_2;
    channel = (_e372 - (0.3f * _e374));
    let _e380 = footprint_35;
    let _e381 = footprint_35;
    let _e386 = channel;
    let _e388 = channel;
    let _e394 = footprint_35;
    let _e395 = groundSmooth(2.5f, 6f, _e394);
    thread = (exp2((((-1100f / max((_e380 * _e381), 1f)) * _e386) * _e388)) * (1f - _e395));
    let _e401 = ragged_2;
    let _e404 = ragged_2;
    let _e406 = broad_6;
    let _e408 = mid_2;
    let _e412 = tussock;
    let _e415 = groundSmooth((0.47f - _e401), (0.47f + _e404), ((_e406 + (0.45f * _e408)) + (0.1f * _e412)));
    let _e417 = thread;
    let _e420 = seen;
    (*pool) = mix(0.33f, max(_e415, (0.85f * _e417)), _e420);
    let _e423 = ragged_2;
    let _e425 = ragged_2;
    let _e426 = mid_2;
    let _e428 = broad_6;
    let _e432 = tussock;
    let _e435 = groundSmooth(-(_e423), _e425, ((_e426 - (0.4f * _e428)) + (0.3f * _e432)));
    let _e436 = seen;
    sedge = mix(0.5f, _e435, _e436);
    let _e447 = sedge;
    let _e454 = tussock;
    let _e455 = groundSmooth(0.1f, 0.4f, _e454);
    let _e457 = keep_7;
    rush = (mix(vec3<f32>(0.3f, 0.34f, 0.2f), vec3<f32>(0.38f, 0.36f, 0.22f), vec3(_e447)) * (1f + (0.09f * (_e455 - (0.4f * _e457)))));
    let _e471 = (*pool);
    (*rough_1) = mix(0.78f, 0.16f, _e471);
    let _e473 = bare_17;
    let _e474 = rush;
    let _e478 = water_1;
    let _e479 = (*pool);
    return mix(mix(_e473, _e474, vec3(0.6f)), _e478, vec3((_e479 * 0.55f)));
}

fn landOrchard(world_61: vec2<f32>, footprint_36: f32, green_14: f32, bare_18: vec3<f32>, rough_2: ptr<function, f32>) -> vec3<f32> {
    var world_62: vec2<f32>;
    var footprint_37: f32;
    var green_15: f32;
    var bare_19: vec3<f32>;

    world_62 = world_61;
    footprint_37 = footprint_36;
    green_15 = green_14;
    bare_19 = bare_18;
    (*rough_2) = 0.87f;
    let _e304 = bare_19;
    let _e313 = green_15;
    return mix(_e304, mix(vec3<f32>(0.45f, 0.43f, 0.27f), vec3<f32>(0.42f, 0.5f, 0.27f), vec3(_e313)), vec3(0.85f));
}

fn landTown(world_63: vec2<f32>, footprint_38: f32, green_16: f32, bare_20: vec3<f32>) -> vec3<f32> {
    var world_64: vec2<f32>;
    var footprint_39: f32;
    var green_17: f32;
    var bare_21: vec3<f32>;
    var salt_31: u32;
    var mid_3: f32;
    var fine_11: f32;
    var luminance: vec3<f32> = vec3<f32>(0.2126f, 0.7152f, 0.0722f);
    var earth: vec3<f32>;
    var soil_7: vec3<f32>;
    var grass_8: vec3<f32>;
    var yard: vec3<f32>;

    world_64 = world_63;
    footprint_39 = footprint_38;
    green_17 = green_16;
    bare_21 = bare_20;
    let _e302 = global.uMaterialSeed;
    salt_31 = (_e302 + 1103u);
    let _e306 = world_64;
    let _e309 = (_e306 / vec2(19f));
    let _e314 = salt_31;
    let _e315 = surfaceNoise(vec3<f32>(_e309.x, _e309.y, 0f), _e314);
    mid_3 = _e315;
    let _e317 = world_64;
    let _e320 = (_e317 / vec2(5.3f));
    let _e325 = salt_31;
    let _e328 = surfaceNoise(vec3<f32>(_e320.x, _e320.y, 0f), (_e325 + 1u));
    let _e332 = footprint_39;
    let _e333 = groundSmooth(1f, 3f, _e332);
    fine_11 = (_e328 * (1f - _e333));
    let _e343 = green_17;
    let _e344 = landCropTone(0.3f, _e343);
    earth = mix(_e344, vec3<f32>(0.56f, 0.5f, 0.38f), vec3(0.25f));
    let _e353 = bare_21;
    let _e355 = bare_21;
    let _e357 = bare_21;
    let _e359 = bare_21;
    let _e364 = bare_21;
    soil_7 = vec3<f32>(_e353.x, min(_e355.y, mix(_e357.x, _e359.z, 0.35f)), _e364.z);
    let _e368 = earth;
    let _e369 = soil_7;
    let _e370 = earth;
    let _e371 = luminance;
    let _e373 = soil_7;
    let _e374 = luminance;
    let _e385 = fine_11;
    earth = (mix(_e368, (_e369 * (dot(_e370, _e371) / max(dot(_e373, _e374), 0.001f))), vec3(0.4f)) * (1f + (0.08f * _e385)));
    let _e397 = green_17;
    grass_8 = mix(vec3<f32>(0.45f, 0.42f, 0.3f), vec3<f32>(0.41f, 0.44f, 0.28f), vec3(_e397));
    let _e401 = earth;
    let _e402 = grass_8;
    let _e407 = mid_3;
    let _e409 = fine_11;
    let _e412 = groundSmooth(-0.1f, 0.5f, (_e407 + (0.3f * _e409)));
    yard = mix(_e401, _e402, vec3((0.6f * _e412)));
    let _e417 = yard;
    let _e419 = bare_21;
    let _e420 = luminance;
    let _e422 = yard;
    let _e423 = luminance;
    return (_e417 * mix(1f, (dot(_e419, _e420) / max(dot(_e422, _e423), 0.001f)), 0.24f));
}

fn landGarden(world_65: vec2<f32>, footprint_40: f32, green_18: f32, bare_22: vec3<f32>) -> vec3<f32> {
    var world_66: vec2<f32>;
    var footprint_41: f32;
    var green_19: f32;
    var bare_23: vec3<f32>;
    var mean_2: vec3<f32>;
    var keep_8: f32;
    var d_23: vec4<f32>;
    var edge_5: f32 = 6f;
    var luv: vec2<f32>;
    var id_1: i32;
    var c2_3: vec2<f32>;
    var a_27: f32;
    var along_4: vec2<f32>;
    var across_4: vec2<f32>;
    var h_27: u32;
    var r_5: vec4<f32>;
    var fw: f32;
    var n_16: f32;
    var q_16: vec2<f32>;
    var bandW: f32;
    var band_1: f32;
    var fy: f32;
    var hb: u32;
    var len: f32;
    var x_8: f32;
    var block_1: f32;
    var fx: f32;
    var hk: u32;
    var kind_6: f32;
    var k2_1: f32;
    var k3_1: f32;
    var bedKeep: f32;
    var local_252: f32;
    var w_16: f32;
    var width_2: f32;
    var bed: f32;
    var fb: f32;
    var hbed: u32;
    var ci: i32;
    var bi: i32;
    var soil_8: vec3<f32>;
    var local_253: array<vec3<f32>, 8> = GARDEN_BEDS;
    var local_254: array<vec3<f32>, 8> = GARDEN_BEDS;
    var crop_1: vec3<f32>;
    var local_255: f32;
    var live: f32;
    var g_18: vec3<f32>;
    var furrow_1: f32;
    var rowKeep_1: f32;
    var grass_9: vec3<f32>;
    var shed: f32;
    var heap: f32;
    var local_256: vec3<f32>;
    var radius_10: f32;
    var crown_4: f32;
    var dy_1: f32;
    var local_257: f32;
    var line: f32;
    var local_258: f32;
    var pathW: f32;
    var lane: f32;
    var crosswise: f32;
    var trodden: vec3<f32>;
    var hedge_1: f32;
    var headland: f32;
    var wattle: f32;

    world_66 = world_65;
    footprint_41 = footprint_40;
    green_19 = green_18;
    bare_23 = bare_22;
    let _e311 = green_19;
    mean_2 = mix(vec3<f32>(0.39f, 0.35f, 0.25f), vec3<f32>(0.33f, 0.4f, 0.24f), vec3(_e311));
    let _e318 = footprint_41;
    let _e319 = groundSmooth(0.9f, 2.6f, _e318);
    keep_8 = (1f - _e319);
    let _e322 = keep_8;
    if (_e322 <= 0f) {
        let _e325 = bare_23;
        let _e326 = mean_2;
        return mix(_e325, _e326, vec3(0.75f));
    }
    let _e330 = world_66;
    let _e331 = orchardDetail(_e330);
    d_23 = _e331;
    let _e335 = global.uHasLandDetail;
    if (_e335 == 1i) {
        {
            let _e338 = world_66;
            let _e339 = global.uLandDetailRect;
            let _e342 = global.uLandDetailRect;
            luv = ((_e338 - _e339.xy) / vec2(_e342.z));
            let _e347 = world_66;
            let _e348 = luv;
            let _e349 = footprint_41;
            let _e352 = landDetailInside(_e348, _e349, (&edge_5));
            let _e353 = luv;
            let _e355 = global.uLandDetailRect;
            let _e359 = orchardDetail((_e347 + ((_e352 - _e353) * _e355.z)));
            d_23 = _e359;
        }
    }
    let _e360 = d_23;
    let _e367 = d_23;
    let _e377 = d_23;
    id_1 = ((i32(((_e360.x * 255f) + 0.5f)) + (i32(((_e367.y * 255f) + 0.5f)) * 256i)) + (i32(((_e377.z * 255f) + 0.5f)) * 65536i));
    let _e388 = d_23;
    c2_3 = ((_e388.yz * 2f) - vec2(1f));
    let _e397 = c2_3;
    let _e399 = c2_3;
    a_27 = (0.5f * atan2(_e397.y, _e399.x));
    let _e404 = a_27;
    let _e406 = a_27;
    along_4 = vec2<f32>(cos(_e404), sin(_e406));
    let _e410 = along_4;
    let _e413 = along_4;
    across_4 = vec2<f32>(-(_e410.y), _e413.x);
    let _e417 = id_1;
    let _e421 = global.uMaterialSeed;
    let _e422 = groundHash(vec3<i32>(_e417, 17i, 887i), _e421);
    h_27 = _e422;
    let _e424 = h_27;
    let _e425 = h_27;
    let _e429 = h_27;
    let _e433 = h_27;
    r_5 = (vec4<f32>((vec4<u32>(_e424, (_e425 >> 8u), (_e429 >> 16u), (_e433 >> 24u)) & vec4(255u))) / vec4(255f));
    let _e446 = footprint_41;
    fw = max(_e446, 0.04f);
    let _e450 = world_66;
    let _e453 = (_e450 / vec2(2.7f));
    let _e458 = global.uMaterialSeed;
    let _e461 = surfaceNoise(vec3<f32>(_e453.x, _e453.y, 0f), (_e458 + 1123u));
    n_16 = _e461;
    let _e463 = world_66;
    let _e464 = along_4;
    let _e466 = world_66;
    let _e467 = across_4;
    let _e470 = r_5;
    q_16 = (vec2<f32>(dot(_e463, _e464), dot(_e466, _e467)) + (_e470.xy * vec2<f32>(53f, 37f)));
    let _e480 = r_5;
    bandW = (4.5f + (5.5f * _e480.z));
    let _e485 = q_16;
    let _e487 = bandW;
    band_1 = floor((_e485.y / _e487));
    let _e491 = q_16;
    let _e493 = band_1;
    let _e494 = bandW;
    fy = (_e491.y - (_e493 * _e494));
    let _e498 = band_1;
    let _e500 = id_1;
    let _e503 = global.uMaterialSeed;
    let _e504 = groundHash(vec3<i32>(i32(_e498), _e500, 889i), _e503);
    hb = _e504;
    let _e508 = r_5;
    let _e514 = hb;
    len = ((6f + (8f * _e508.w)) * (0.65f + ((0.7f * f32((_e514 & 255u))) / 255f)));
    let _e524 = q_16;
    let _e526 = hb;
    let _e535 = len;
    x_8 = (_e524.x + ((f32(((_e526 >> 8u) & 255u)) / 255f) * _e535));
    let _e539 = x_8;
    let _e540 = len;
    block_1 = floor((_e539 / _e540));
    let _e544 = x_8;
    let _e545 = block_1;
    let _e546 = len;
    fx = (_e544 - (_e545 * _e546));
    let _e550 = block_1;
    let _e552 = band_1;
    let _e554 = id_1;
    let _e558 = global.uMaterialSeed;
    let _e559 = groundHash(vec3<i32>(i32(_e550), i32(_e552), (_e554 + 891i)), _e558);
    hk = _e559;
    let _e561 = hk;
    kind_6 = (f32((_e561 & 255u)) / 255f);
    let _e568 = hk;
    k2_1 = (f32(((_e568 >> 8u) & 255u)) / 255f);
    let _e578 = hk;
    k3_1 = (f32(((_e578 >> 16u) & 255u)) / 255f);
    let _e591 = footprint_41;
    let _e592 = groundSmooth(0.3f, 0.75f, _e591);
    bedKeep = (1f - _e592);
    let _e595 = k2_1;
    if (_e595 < 0.6f) {
        let _e598 = fy;
        local_252 = _e598;
    } else {
        let _e599 = fx;
        local_252 = _e599;
    }
    let _e601 = local_252;
    w_16 = _e601;
    let _e605 = k3_1;
    width_2 = (1.1f + (0.8f * _e605));
    let _e609 = w_16;
    let _e610 = width_2;
    bed = floor((_e609 / _e610));
    let _e614 = w_16;
    let _e615 = bed;
    let _e616 = width_2;
    fb = (_e614 - (_e615 * _e616));
    let _e620 = bed;
    let _e622 = block_1;
    let _e626 = band_1;
    let _e629 = id_1;
    let _e633 = global.uMaterialSeed;
    let _e634 = groundHash(vec3<i32>(i32(_e620), ((i32(_e622) * 64i) + i32(_e626)), (_e629 + 893i)), _e633);
    hbed = _e634;
    let _e636 = hk;
    ci = (i32((_e636 >> 24u)) & 7i);
    let _e644 = hbed;
    bi = i32((_e644 & 7u));
    let _e649 = bare_23;
    let _e654 = vec3<f32>(0.34f, 0.28f, 0.21f);
    soil_8 = mix(_e649, _e654, vec3(0.6f));
    let _e688 = ci;
    let _e692 = local_253[_e688];
    let _e693 = bi;
    let _e697 = local_254[_e693];
    let _e699 = bedKeep;
    crop_1 = mix(_e692, _e697, vec3((0.4f * _e699)));
    let _e704 = ci;
    let _e707 = ci;
    if ((_e704 == 2i) || (_e707 == 3i)) {
        local_255 = 0.7f;
    } else {
        local_255 = 0.25f;
    }
    let _e714 = local_255;
    let _e716 = green_19;
    live = mix(_e714, 1f, _e716);
    let _e719 = soil_8;
    let _e720 = crop_1;
    let _e721 = live;
    g_18 = mix(_e719, _e720, vec3(_e721));
    let _e727 = fw;
    let _e732 = fw;
    let _e736 = fb;
    let _e737 = width_2;
    let _e738 = fb;
    let _e741 = groundSmooth((0.15f - (_e727 * 0.5f)), (0.15f + (_e732 * 0.5f)), min(_e736, (_e737 - _e738)));
    let _e745 = fw;
    let _e749 = bedKeep;
    furrow_1 = (((1f - _e741) * min(1f, (0.3f / _e745))) * _e749);
    let _e752 = g_18;
    let _e753 = soil_8;
    let _e757 = furrow_1;
    g_18 = mix(_e752, (_e753 * 0.88f), vec3((0.6f * _e757)));
    let _e764 = footprint_41;
    let _e765 = groundSmooth(0.06f, 0.16f, _e764);
    rowKeep_1 = (1f - _e765);
    let _e768 = rowKeep_1;
    if (_e768 > 0f) {
        let _e771 = g_18;
        let _e773 = rowKeep_1;
        let _e776 = w_16;
        g_18 = (_e771 * (1f + ((_e773 * 0.06f) * cos((_e776 * 17.95f)))));
    }
    let _e791 = green_19;
    grass_9 = mix(vec3<f32>(0.4f, 0.4f, 0.26f), vec3<f32>(0.34f, 0.4f, 0.23f), vec3(_e791));
    let _e795 = kind_6;
    if (_e795 < 0.66f) {
        let _e798 = g_18;
        g_18 = (_e798 * 1f);
    } else {
        let _e801 = kind_6;
        if (_e801 < 0.78f) {
            let _e804 = grass_9;
            let _e807 = n_16;
            g_18 = (_e804 * (1f + (0.1f * _e807)));
        } else {
            let _e811 = kind_6;
            if (_e811 < 0.9f) {
                let _e814 = bare_23;
                let _e824 = n_16;
                let _e826 = bedKeep;
                g_18 = (mix(_e814, vec3<f32>(0.31f, 0.25f, 0.19f), vec3(0.6f)) * (1f + ((0.1f * _e824) * _e826)));
            } else {
                let _e830 = kind_6;
                if (_e830 < 0.94f) {
                    {
                        let _e836 = fw;
                        let _e838 = fx;
                        let _e839 = groundSmooth(2.6f, (2.6f + _e836), _e838);
                        let _e844 = fw;
                        let _e846 = fy;
                        let _e847 = groundSmooth(2.2f, (2.2f + _e844), _e846);
                        let _e852 = fw;
                        let _e854 = fx;
                        let _e855 = groundSmooth(0.3f, (0.3f + _e852), _e854);
                        let _e859 = fw;
                        let _e861 = fy;
                        let _e862 = groundSmooth(0.3f, (0.3f + _e859), _e861);
                        shed = ((((1f - _e839) * (1f - _e847)) * _e855) * _e862);
                        let _e867 = fw;
                        let _e869 = fx;
                        let _e870 = groundSmooth(2.9f, (2.9f + _e867), _e869);
                        let _e874 = fw;
                        let _e876 = fx;
                        let _e877 = groundSmooth(4.1f, (4.1f + _e874), _e876);
                        let _e883 = fw;
                        let _e885 = fy;
                        let _e886 = groundSmooth(1.4f, (1.4f + _e883), _e885);
                        let _e891 = fw;
                        let _e893 = fy;
                        let _e894 = groundSmooth(0.3f, (0.3f + _e891), _e893);
                        heap = (((_e870 * (1f - _e877)) * (1f - _e886)) * _e894);
                        let _e897 = g_18;
                        let _e898 = r_5;
                        if (_e898.z < 0.5f) {
                            local_256 = vec3<f32>(0.27f, 0.23f, 0.19f);
                        } else {
                            local_256 = vec3<f32>(0.4f, 0.34f, 0.25f);
                        }
                        let _e911 = local_256;
                        let _e914 = n_16;
                        let _e918 = shed;
                        g_18 = mix(_e897, (_e911 * (1f + (0.08f * _e914))), vec3(_e918));
                        let _e921 = g_18;
                        let _e928 = n_16;
                        let _e932 = heap;
                        g_18 = mix(_e921, (vec3<f32>(0.27f, 0.21f, 0.16f) * (1f + (0.15f * _e928))), vec3(_e932));
                    }
                } else {
                    let _e935 = kind_6;
                    if (_e935 < 0.97f) {
                        {
                            let _e940 = k3_1;
                            let _e943 = len;
                            let _e944 = bandW;
                            radius_10 = min((1.4f + (0.8f * _e940)), (min(_e943, _e944) * 0.45f));
                            let _e951 = radius_10;
                            let _e954 = fw;
                            let _e958 = radius_10;
                            let _e959 = fw;
                            let _e963 = fx;
                            let _e964 = len;
                            let _e968 = fy;
                            let _e969 = bandW;
                            let _e976 = n_16;
                            let _e979 = groundSmooth(((_e951 - 0.3f) - (_e954 * 0.5f)), (_e958 + (_e959 * 0.5f)), (length(vec2<f32>((_e963 - (_e964 * 0.5f)), (_e968 - (_e969 * 0.5f)))) + (0.25f * _e976)));
                            crown_4 = (1f - _e979);
                            let _e982 = grass_9;
                            let _e989 = n_16;
                            let _e993 = crown_4;
                            g_18 = mix(_e982, (vec3<f32>(0.21f, 0.28f, 0.16f) * (1f + (0.15f * _e989))), vec3(_e993));
                        }
                    } else {
                        let _e1020 = vec3<f32>(0.5f, 0.45f, 0.33f);
                        let _e1030 = soil_8;
                        g_18 = mix(_e1020, _e1030, vec3(0.25f));
                    }
                }
            }
        }
    }
    let _e1034 = fy;
    let _e1035 = bandW;
    let _e1036 = fy;
    dy_1 = min(_e1034, (_e1035 - _e1036));
    let _e1040 = fy;
    let _e1041 = bandW;
    if (_e1040 < (_e1041 * 0.5f)) {
        let _e1045 = band_1;
        local_257 = _e1045;
    } else {
        let _e1046 = band_1;
        local_257 = (_e1046 + 1f);
    }
    let _e1050 = local_257;
    line = _e1050;
    let _e1052 = line;
    let _e1053 = r_5;
    let _e1058 = (_e1052 + floor((_e1053.x * 3f)));
    if ((_e1058 - (floor((_e1058 / 3f)) * 3f)) < 0.5f) {
        local_258 = 1f;
    } else {
        local_258 = 0.5f;
    }
    let _e1069 = local_258;
    pathW = _e1069;
    let _e1072 = pathW;
    let _e1075 = fw;
    let _e1079 = pathW;
    let _e1082 = fw;
    let _e1086 = dy_1;
    let _e1088 = n_16;
    let _e1091 = groundSmooth(((_e1072 * 0.5f) - (_e1075 * 0.5f)), ((_e1079 * 0.5f) + (_e1082 * 0.5f)), (_e1086 + (0.06f * _e1088)));
    let _e1094 = pathW;
    let _e1095 = fw;
    lane = ((1f - _e1091) * min(1f, (_e1094 / _e1095)));
    let _e1102 = fw;
    let _e1107 = fw;
    let _e1111 = fx;
    let _e1112 = len;
    let _e1113 = fx;
    let _e1117 = n_16;
    let _e1120 = groundSmooth((0.2f - (_e1102 * 0.5f)), (0.2f + (_e1107 * 0.5f)), (min(_e1111, (_e1112 - _e1113)) + (0.05f * _e1117)));
    let _e1124 = fw;
    crosswise = ((1f - _e1120) * min(1f, (0.4f / _e1124)));
    let _e1129 = bare_23;
    trodden = mix(_e1129, vec3<f32>(0.43f, 0.38f, 0.29f), vec3(0.6f));
    let _e1138 = g_18;
    let _e1139 = trodden;
    let _e1141 = lane;
    let _e1142 = crosswise;
    g_18 = mix(_e1138, _e1139, vec3((0.85f * max(_e1141, _e1142))));
    let _e1147 = r_5;
    if (_e1147.x < 0.55f) {
        {
            let _e1153 = fw;
            let _e1158 = fw;
            let _e1162 = edge_5;
            let _e1164 = n_16;
            let _e1167 = groundSmooth((0.9f - (_e1153 * 0.5f)), (0.9f + (_e1158 * 0.5f)), (_e1162 + (0.2f * _e1164)));
            hedge_1 = (1f - _e1167);
            let _e1170 = g_18;
            let _e1177 = n_16;
            let _e1181 = hedge_1;
            g_18 = mix(_e1170, (vec3<f32>(0.22f, 0.28f, 0.16f) * (1f + (0.12f * _e1177))), vec3(_e1181));
        }
    } else {
        {
            let _e1186 = fw;
            let _e1191 = fw;
            let _e1195 = edge_5;
            let _e1196 = groundSmooth((0.9f - (_e1186 * 0.5f)), (0.9f + (_e1191 * 0.5f)), _e1195);
            let _e1200 = fw;
            headland = ((1f - _e1196) * min(1f, (0.6f / _e1200)));
            let _e1207 = fw;
            let _e1212 = fw;
            let _e1216 = edge_5;
            let _e1218 = n_16;
            let _e1221 = groundSmooth((0.25f - (_e1207 * 0.5f)), (0.25f + (_e1212 * 0.5f)), (_e1216 + (0.05f * _e1218)));
            let _e1225 = fw;
            wattle = ((1f - _e1221) * min(1f, (0.2f / _e1225)));
            let _e1230 = g_18;
            let _e1231 = trodden;
            let _e1233 = headland;
            let _e1241 = wattle;
            g_18 = mix(mix(_e1230, _e1231, vec3((0.7f * _e1233))), vec3<f32>(0.31f, 0.26f, 0.19f), vec3(_e1241));
        }
    }
    let _e1244 = g_18;
    let _e1247 = n_16;
    g_18 = (_e1244 * (1f + (0.04f * _e1247)));
    let _e1251 = bare_23;
    let _e1252 = mean_2;
    let _e1253 = g_18;
    let _e1254 = keep_8;
    return mix(_e1251, mix(_e1252, _e1253, vec3(_e1254)), vec3(0.75f));
}

fn occupationMaterial(cls_4: i32, world_67: vec2<f32>, footprint_42: f32, bare_24: vec3<f32>, micro_1: vec3<f32>, dry_7: f32, green_20: f32, pool_1: ptr<function, f32>) -> vec4<f32> {
    var cls_5: i32;
    var world_68: vec2<f32>;
    var footprint_43: f32;
    var bare_25: vec3<f32>;
    var micro_2: vec3<f32>;
    var dry_8: f32;
    var green_21: f32;
    var target_: vec3<f32>;
    var rough_3: f32 = 0.9f;

    cls_5 = cls_4;
    world_68 = world_67;
    footprint_43 = footprint_42;
    bare_25 = bare_24;
    micro_2 = micro_1;
    dry_8 = dry_7;
    green_21 = green_20;
    let _e310 = bare_25;
    target_ = _e310;
    (*pool_1) = 0f;
    let _e315 = cls_5;
    if (_e315 == 1i) {
        let _e326 = green_21;
        let _e329 = bare_25;
        target_ = mix(mix(vec3<f32>(0.39f, 0.32f, 0.19f), vec3<f32>(0.38f, 0.43f, 0.2f), vec3(_e326)), _e329, vec3(0.34f));
    } else {
        let _e333 = cls_5;
        if (_e333 == 2i) {
            {
                let _e336 = world_68;
                let _e337 = footprint_43;
                let _e338 = green_21;
                let _e339 = bare_25;
                let _e341 = landGrass(_e336, _e337, _e338, _e339, false);
                target_ = _e341;
                rough_3 = 0.84f;
            }
        } else {
            let _e343 = cls_5;
            if (_e343 == 3i) {
                {
                    let _e346 = world_68;
                    let _e347 = footprint_43;
                    let _e348 = green_21;
                    let _e349 = bare_25;
                    let _e351 = landGrass(_e346, _e347, _e348, _e349, true);
                    target_ = _e351;
                    rough_3 = 0.87f;
                }
            } else {
                let _e353 = cls_5;
                if (_e353 == 4i) {
                    let _e356 = world_68;
                    let _e357 = footprint_43;
                    let _e358 = green_21;
                    let _e359 = bare_25;
                    let _e362 = landOrchard(_e356, _e357, _e358, _e359, (&rough_3));
                    target_ = _e362;
                } else {
                    let _e363 = cls_5;
                    if (_e363 == 5i) {
                        {
                            let _e366 = world_68;
                            let _e367 = footprint_43;
                            let _e368 = green_21;
                            let _e369 = bare_25;
                            let _e370 = landGarden(_e366, _e367, _e368, _e369);
                            target_ = _e370;
                            rough_3 = 0.86f;
                        }
                    } else {
                        let _e372 = cls_5;
                        if (_e372 == 10i) {
                            let _e375 = world_68;
                            let _e376 = footprint_43;
                            let _e377 = bare_25;
                            let _e382 = landMarsh(_e375, _e376, _e377, (&rough_3), pool_1);
                            target_ = _e382;
                        } else {
                            let _e383 = cls_5;
                            if (_e383 == 6i) {
                                let _e386 = world_68;
                                let _e387 = footprint_43;
                                let _e388 = green_21;
                                let _e389 = bare_25;
                                let _e390 = landHeath(_e386, _e387, _e388, _e389);
                                target_ = _e390;
                            } else {
                                let _e391 = cls_5;
                                if (_e391 == 7i) {
                                    let _e394 = world_68;
                                    let _e395 = footprint_43;
                                    let _e396 = green_21;
                                    let _e397 = bare_25;
                                    let _e398 = landTown(_e394, _e395, _e396, _e397);
                                    target_ = _e398;
                                } else {
                                    {
                                        let _e399 = bare_25;
                                        target_ = mix(_e399, vec3<f32>(0.45f, 0.4f, 0.31f), vec3(0.55f));
                                        rough_3 = 0.91f;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let _e408 = cls_5;
    if (_e408 == 1i) {
        let _e411 = target_;
        let _e413 = green_21;
        let _e414 = bare_25;
        let _e415 = landFieldDryTone(0.32f, _e413, _e414);
        let _e416 = dry_8;
        target_ = mix(_e411, _e415, vec3(_e416));
    } else {
        let _e419 = cls_5;
        if (_e419 <= 5i) {
            let _e422 = target_;
            let _e423 = bare_25;
            let _e432 = dry_8;
            target_ = mix(_e422, mix(_e423, vec3<f32>(0.55f, 0.47f, 0.3f), vec3(0.55f)), vec3((0.9f * _e432)));
        }
    }
    let _e436 = target_;
    let _e437 = micro_2;
    let _e443 = clamp((_e436 * _e437), vec3(0f), vec3(1f));
    let _e444 = rough_3;
    return vec4<f32>(_e443.x, _e443.y, _e443.z, _e444);
}

fn applyPaperMap(m_7: ptr<function, GroundMaterial>, world_69: vec2<f32>, footprint_44: f32) {
    var world_70: vec2<f32>;
    var footprint_45: f32;
    var c_43: vec3<f32>;
    var l_9: f32;
    var wood_3: f32;
    var open_1: vec3<f32>;
    var forest: vec3<f32>;
    var uv_19: vec2<f32>;
    var local_259: f32;
    var share_2: f32;
    var local_260: f32;
    var near: f32;
    var shade_3: f32;
    var p_45: vec3<f32>;

    world_70 = world_69;
    footprint_45 = footprint_44;
    let _e302 = global.uPaperMap;
    if (_e302 == 0i) {
        return;
    }
    let _e305 = (*m_7);
    let _e307 = groundToDisplay(_e305.albedo);
    c_43 = _e307;
    let _e309 = c_43;
    l_9 = dot(_e309, vec3<f32>(0.3f, 0.59f, 0.11f));
    let _e319 = l_9;
    let _e320 = groundSmooth(0.19f, 0.31f, _e319);
    let _e325 = c_43;
    let _e327 = c_43;
    let _e330 = groundSmooth(0f, 0.07f, (_e325.x - _e327.y));
    wood_3 = ((1f - _e320) * (1f - _e330));
    let _e344 = l_9;
    let _e345 = groundSmooth(0.25f, 0.6f, _e344);
    open_1 = mix(vec3<f32>(0.6f, 0.55f, 0.38f), vec3<f32>(0.8f, 0.74f, 0.57f), vec3(_e345));
    let _e349 = open_1;
    let _e352 = c_43;
    let _e353 = l_9;
    open_1 = (_e349 * mix(vec3(1f), clamp((_e352 / vec3(max(_e353, 0.05f))), vec3(0.75f), vec3(1.25f)), vec3(0.25f)));
    let _e377 = l_9;
    let _e378 = groundSmooth(0.06f, 0.3f, _e377);
    forest = mix(vec3<f32>(0.16f, 0.18f, 0.05f), vec3<f32>(0.31f, 0.33f, 0.12f), vec3(_e378));
    let _e382 = world_70;
    let _e383 = global.uOccupationRect;
    let _e386 = global.uOccupationRect;
    uv_19 = ((_e382 - _e383.xy) / vec2(_e386.z));
    let _e391 = global.uHasOccupation;
    if (_e391 == 1i) {
        let _e396 = uv_19;
        let _e398 = textureSampleLevel(uOccupation, sLinear, _e396, 5f);
        let _e400 = groundSmooth(0.4f, 0.74f, _e398.y);
        local_259 = _e400;
    } else {
        local_259 = 0f;
    }
    let _e403 = local_259;
    share_2 = _e403;
    let _e405 = global.uHasOccupation;
    if (_e405 == 1i) {
        let _e410 = uv_19;
        let _e412 = textureSampleLevel(uOccupation, sLinear, _e410, 3.5f);
        let _e414 = groundSmooth(0.4f, 0.74f, _e412.y);
        local_260 = _e414;
    } else {
        local_260 = 0f;
    }
    let _e417 = local_260;
    near = _e417;
    let _e419 = share_2;
    let _e420 = near;
    let _e425 = paperTendedShare;
    shade_3 = (mix(_e419, _e420, 0.5f) * (1f - (0.85f * _e425)));
    let _e430 = open_1;
    let _e436 = paperCommonsShare;
    open_1 = mix(_e430, vec3<f32>(0.47f, 0.45f, 0.27f), vec3((0.6f * _e436)));
    let _e440 = open_1;
    let _e445 = shade_3;
    open_1 = mix(_e440, vec3<f32>(0.33f, 0.34f, 0.16f), vec3((_e445 * 0.9f)));
    let _e450 = forest;
    let _e458 = forest;
    let _e461 = share_2;
    let _e462 = groundSmooth(0.15f, 0.9f, _e461);
    forest = mix(mix(_e450, vec3<f32>(0.4f, 0.39f, 0.2f), vec3(0.75f)), _e458, vec3(_e462));
    let _e465 = open_1;
    let _e466 = forest;
    let _e467 = wood_3;
    p_45 = mix(_e465, _e466, vec3(_e467));
    let _e471 = p_45;
    let _e474 = world_70;
    let _e475 = footprint_45;
    let _e481 = (_e474 / vec2(max((_e475 * 2.3f), 0.4f)));
    let _e486 = global.uMaterialSeed;
    let _e489 = surfaceNoise(vec3<f32>(_e481.x, _e481.y, 0f), (_e486 + 1151u));
    p_45 = (_e471 * (1f + (0.022f * _e489)));
    let _e494 = p_45;
    let _e495 = groundToLinear(_e494);
    (*m_7).albedo = _e495;
    return;
}

fn paperWater(kind_7: f32, shore_6: f32) -> vec3<f32> {
    var kind_8: f32;
    var shore_7: f32;
    var edge_6: vec3<f32> = vec3<f32>(0.37f, 0.48f, 0.49f);
    var sea: vec3<f32> = vec3<f32>(0.74f, 0.8f, 0.78f);

    kind_8 = kind_7;
    shore_7 = shore_6;
    let _e311 = kind_8;
    if (_e311 > 1.5f) {
        let _e314 = edge_6;
        let _e315 = sea;
        return mix(_e314, _e315, vec3(0.25f));
    }
    let _e319 = sea;
    let _e320 = edge_6;
    let _e322 = shore_7;
    return mix(_e319, _e320, vec3((0.8f * _e322)));
}

fn applyGroundOccupation(m_8: ptr<function, GroundMaterial>, world_71: vec2<f32>, footprint_46: f32) {
    var world_72: vec2<f32>;
    var footprint_47: f32;
    var o_7: vec3<f32>;
    var cell_18: f32;
    var humid_1: f32;
    var dry_9: f32;
    var phase_4: f32;
    var green_22: f32;
    var micro_3: vec3<f32>;
    var bare_26: vec3<f32>;
    var uv_20: vec2<f32>;
    var grid: vec2<f32>;
    var f_16: vec2<f32>;
    var base_2: vec2<i32>;
    var top: vec2<i32>;
    var wField: f32 = 0f;
    var wOrchard: f32 = 0f;
    var wGarden: f32 = 0f;
    var wTown: f32 = 0f;
    var wLane: f32 = 0f;
    var wBuilt: f32 = 0f;
    var hardShare: f32 = 0f;
    var y_2: i32 = 0i;
    var x_9: i32;
    var cls_6: i32;
    var local_261: f32;
    var local_262: f32;
    var weight_3: f32;
    var detailed: f32;
    var dcell: f32;
    var near_1: f32;
    var sd_2: f32;
    var w_17: f32;
    var share_3: f32;
    var rest: f32;
    var local_263: f32;
    var other: f32;
    var k_30: f32;
    var tendedShare: f32;
    var tended: vec4<f32> = vec4(0f);
    var fieldShare: f32 = 0f;
    var fieldSlope: vec2<f32> = vec2(0f);
    var rough_4: f32;
    var c_44: vec3<f32>;
    var wildShare: f32;
    var wMeadow: f32 = 0f;
    var wPasture: f32 = 0f;
    var wHeath: f32 = 0f;
    var wMarsh: f32 = 0f;
    var salt_32: u32;
    var ws: f32;
    var wander_1: vec2<f32>;
    var wgrid: vec2<f32>;
    var wf: vec2<f32>;
    var wbase: vec2<i32>;
    var y_3: i32 = 0i;
    var x_10: i32;
    var cls_7: i32;
    var local_264: f32;
    var local_265: f32;
    var weight_4: f32;
    var wild: vec4<f32> = vec4(0f);
    var marsh: f32 = 0f;
    var poolShare: f32 = 0f;
    var i_11: i32 = 0i;
    var cls_8: i32;
    var w_18: f32;
    var d_24: f32;
    var local_266: f32;
    var pool_2: f32;
    var c_45: vec4<f32>;
    var covered: f32;
    var target_1: vec4<f32>;
    var local_267: f32;
    var edgeWidth: f32;
    var width_3: f32;
    var snow_5: f32;
    var h_28: f32;
    var limit_1: f32;
    var own: f32;
    var a_28: f32;
    var extra: f32;

    world_72 = world_71;
    footprint_47 = footprint_46;
    paperCommonsShare = 0f;
    paperTendedShare = 0f;
    v2OrchardShare = 1f;
    landFieldCrop = -1f;
    let _e309 = global.uHasOccupation;
    if ((uRenderV2_ != 1i) || (_e309 == 0i)) {
        return;
    }
    let _e313 = world_72;
    let _e314 = groundOccupation(_e313);
    o_7 = _e314;
    let _e316 = global.uOccupationRect;
    let _e318 = global.uOccupationN;
    cell_18 = (_e316.z / _e318);
    let _e321 = global.uMaterialClimate;
    let _e324 = global.uMaterialClimate;
    humid_1 = (_e321.y / max(((20f * _e324.x) + 280f), 120f));
    let _e336 = humid_1;
    let _e337 = groundSmooth(0.8f, 2f, _e336);
    let _e340 = v2ZoneWet;
    dry_9 = ((1f - _e337) * (1f - clamp(_e340, 0f, 1f)));
    let _e347 = global.uV2Season;
    phase_4 = clamp(_e347, 0f, 1f);
    let _e354 = phase_4;
    green_22 = (0.5f + (0.5f * sin(((_e354 * 6.2831855f) - 1.5707963f))));
    let _e363 = surfaceMicroTone;
    micro_3 = clamp(_e363, vec3(0.35f), vec3(1.65f));
    let _e370 = renderGuideOpen;
    let _e371 = micro_3;
    bare_26 = (_e370 / _e371);
    let _e374 = world_72;
    let _e375 = global.uOccupationRect;
    let _e378 = global.uOccupationRect;
    uv_20 = ((_e374 - _e375.xy) / vec2(_e378.z));
    let _e383 = uv_20;
    let _e384 = global.uOccupationN;
    grid = ((_e383 * _e384) - vec2(0.5f));
    let _e390 = grid;
    f_16 = fract(_e390);
    let _e393 = grid;
    base_2 = vec2<i32>(floor(_e393));
    let _e397 = global.uOccupationN;
    top = vec2((i32(_e397) - 1i));
    loop {
        let _e419 = y_2;
        if !((_e419 < 2i)) {
            break;
        }
        x_9 = 0i;
        loop {
            let _e428 = x_9;
            if !((_e428 < 2i)) {
                break;
            }
            {
                let _e435 = base_2;
                let _e436 = x_9;
                let _e437 = y_2;
                let _e442 = top;
                let _e445 = textureLoad(uOccupation, clamp((_e435 + vec2<i32>(_e436, _e437)), vec2(0i), _e442), 0i);
                cls_6 = i32(((_e445.z * 255f) + 0.5f));
                let _e453 = x_9;
                if (_e453 == 0i) {
                    let _e457 = f_16;
                    local_261 = (1f - _e457.x);
                } else {
                    let _e460 = f_16;
                    local_261 = _e460.x;
                }
                let _e463 = local_261;
                let _e464 = y_2;
                if (_e464 == 0i) {
                    let _e468 = f_16;
                    local_262 = (1f - _e468.y);
                } else {
                    let _e471 = f_16;
                    local_262 = _e471.y;
                }
                let _e474 = local_262;
                weight_3 = (_e463 * _e474);
                let _e477 = cls_6;
                let _e480 = cls_6;
                let _e484 = cls_6;
                if (((_e477 == 8i) || (_e480 < 1i)) || (_e484 > 11i)) {
                    {
                        let _e488 = hardShare;
                        let _e489 = weight_3;
                        hardShare = (_e488 + _e489);
                        let _e491 = cls_6;
                        if (_e491 == 8i) {
                            {
                                let _e494 = paperTendedShare;
                                let _e495 = weight_3;
                                paperTendedShare = (_e494 + _e495);
                                let _e497 = wBuilt;
                                let _e498 = weight_3;
                                wBuilt = (_e497 + _e498);
                            }
                        }
                    }
                } else {
                    let _e500 = cls_6;
                    if (_e500 == 1i) {
                        let _e503 = wField;
                        let _e504 = weight_3;
                        wField = (_e503 + _e504);
                    } else {
                        let _e506 = cls_6;
                        if (_e506 == 4i) {
                            let _e509 = wOrchard;
                            let _e510 = weight_3;
                            wOrchard = (_e509 + _e510);
                        } else {
                            let _e512 = cls_6;
                            if (_e512 == 5i) {
                                let _e515 = wGarden;
                                let _e516 = weight_3;
                                wGarden = (_e515 + _e516);
                            } else {
                                let _e518 = cls_6;
                                if (_e518 == 7i) {
                                    let _e521 = wTown;
                                    let _e522 = weight_3;
                                    wTown = (_e521 + _e522);
                                } else {
                                    let _e524 = cls_6;
                                    if (_e524 == 9i) {
                                        let _e527 = wLane;
                                        let _e528 = weight_3;
                                        wLane = (_e527 + _e528);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            continuing {
                let _e432 = x_9;
                x_9 = (_e432 + 1i);
            }
        }
        continuing {
            let _e423 = y_2;
            y_2 = (_e423 + 1i);
        }
    }
    let _e530 = wField;
    let _e531 = wOrchard;
    let _e533 = wGarden;
    detailed = ((_e530 + _e531) + _e533);
    let _e536 = global.uHasLandDetail;
    let _e539 = detailed;
    let _e543 = detailed;
    let _e547 = wTown;
    let _e548 = wBuilt;
    if ((((_e536 == 1i) && (_e539 > 0f)) && (_e543 < 1f)) && ((_e547 + _e548) < 0.001f)) {
        {
            let _e553 = global.uLandDetailRect;
            let _e555 = global.uLandDetailN;
            dcell = (_e553.z / _e555);
            let _e559 = dcell;
            let _e560 = dcell;
            let _e563 = footprint_47;
            let _e564 = groundSmooth(_e559, (_e560 * 2f), _e563);
            near_1 = (1f - _e564);
            let _e567 = near_1;
            if (_e567 > 0f) {
                {
                    let _e570 = world_72;
                    let _e571 = global.uLandDetailRect;
                    let _e574 = global.uLandDetailRect;
                    let _e579 = landDetailSample(((_e570 - _e571.xy) / vec2(_e574.z)), 0f);
                    let _e581 = landDetailDist(_e579.w);
                    sd_2 = _e581;
                    let _e584 = footprint_47;
                    w_17 = (0.5f * max(_e584, 0.25f));
                    let _e589 = detailed;
                    let _e590 = w_17;
                    let _e592 = w_17;
                    let _e593 = sd_2;
                    let _e594 = groundSmooth(-(_e590), _e592, _e593);
                    let _e595 = near_1;
                    share_3 = mix(_e589, _e594, _e595);
                    let _e599 = detailed;
                    rest = (1f - _e599);
                    let _e602 = rest;
                    if (_e602 > 0.001f) {
                        let _e606 = share_3;
                        let _e608 = rest;
                        local_263 = ((1f - _e606) / _e608);
                    } else {
                        local_263 = 0f;
                    }
                    let _e612 = local_263;
                    other = _e612;
                    let _e614 = hardShare;
                    let _e615 = other;
                    hardShare = (_e614 * _e615);
                    let _e617 = wLane;
                    let _e618 = other;
                    wLane = (_e617 * _e618);
                    let _e620 = share_3;
                    let _e621 = detailed;
                    k_30 = (_e620 / _e621);
                    let _e624 = wField;
                    let _e625 = k_30;
                    wField = (_e624 * _e625);
                    let _e627 = wOrchard;
                    let _e628 = k_30;
                    wOrchard = (_e627 * _e628);
                    let _e630 = wGarden;
                    let _e631 = k_30;
                    wGarden = (_e630 * _e631);
                }
            }
        }
    }
    let _e634 = wOrchard;
    v2OrchardShare = clamp(((2f * _e634) - 1f), 0f, 1f);
    let _e641 = wField;
    let _e642 = wOrchard;
    let _e644 = wGarden;
    let _e646 = wTown;
    let _e648 = wLane;
    tendedShare = ((((_e641 + _e642) + _e644) + _e646) + _e648);
    let _e651 = paperTendedShare;
    let _e652 = tendedShare;
    paperTendedShare = (_e651 + _e652);
    let _e662 = wField;
    let _e665 = global.uHasLandDetail;
    if ((_e662 > 0f) && (_e665 == 1i)) {
        {
            let _e670 = world_72;
            let _e671 = footprint_47;
            let _e672 = green_22;
            let _e673 = bare_26;
            let _e674 = dry_9;
            let _e679 = landField(_e670, _e671, _e672, _e673, _e674, (&fieldSlope), (&rough_4));
            c_44 = _e679;
            let _e681 = tended;
            let _e682 = wField;
            let _e683 = c_44;
            let _e684 = micro_3;
            let _e690 = clamp((_e683 * _e684), vec3(0f), vec3(1f));
            let _e691 = rough_4;
            tended = (_e681 + (_e682 * vec4<f32>(_e690.x, _e690.y, _e690.z, _e691)));
            let _e698 = wField;
            fieldShare = _e698;
        }
    }
    let _e700 = tendedShare;
    let _e702 = hardShare;
    wildShare = ((1f - _e700) - _e702);
    let _e713 = wildShare;
    if (_e713 > 0.001f) {
        {
            let _e716 = global.uMaterialSeed;
            salt_32 = (_e716 + 1091u);
            let _e721 = cell_18;
            ws = max(1f, (_e721 / 24f));
            let _e726 = world_72;
            let _e728 = ws;
            let _e731 = (_e726 / vec2((43f * _e728)));
            let _e736 = salt_32;
            let _e737 = surfaceNoise(vec3<f32>(_e731.x, _e731.y, 0f), _e736);
            let _e738 = world_72;
            let _e740 = ws;
            let _e743 = (_e738 / vec2((43f * _e740)));
            let _e748 = salt_32;
            let _e751 = surfaceNoise(vec3<f32>(_e743.x, _e743.y, 0f), (_e748 + 1u));
            let _e755 = world_72;
            let _e757 = ws;
            let _e760 = (_e755 / vec2((13f * _e757)));
            let _e765 = salt_32;
            let _e768 = surfaceNoise(vec3<f32>(_e760.x, _e760.y, 0f), (_e765 + 2u));
            let _e769 = world_72;
            let _e771 = ws;
            let _e774 = (_e769 / vec2((13f * _e771)));
            let _e779 = salt_32;
            let _e782 = surfaceNoise(vec3<f32>(_e774.x, _e774.y, 0f), (_e779 + 3u));
            let _e787 = ws;
            wander_1 = (((vec2<f32>(_e737, _e751) * 16f) + (vec2<f32>(_e768, _e782) * 6f)) * _e787);
            let _e790 = uv_20;
            let _e791 = wander_1;
            let _e792 = global.uOccupationRect;
            let _e797 = global.uOccupationN;
            wgrid = (((_e790 + (_e791 / vec2(_e792.z))) * _e797) - vec2(0.5f));
            let _e803 = wgrid;
            wf = fract(_e803);
            let _e806 = wgrid;
            wbase = vec2<i32>(floor(_e806));
            loop {
                let _e812 = y_3;
                if !((_e812 < 2i)) {
                    break;
                }
                x_10 = 0i;
                loop {
                    let _e821 = x_10;
                    if !((_e821 < 2i)) {
                        break;
                    }
                    {
                        let _e828 = wbase;
                        let _e829 = x_10;
                        let _e830 = y_3;
                        let _e835 = top;
                        let _e838 = textureLoad(uOccupation, clamp((_e828 + vec2<i32>(_e829, _e830)), vec2(0i), _e835), 0i);
                        cls_7 = i32(((_e838.z * 255f) + 0.5f));
                        let _e846 = x_10;
                        if (_e846 == 0i) {
                            let _e850 = wf;
                            local_264 = (1f - _e850.x);
                        } else {
                            let _e853 = wf;
                            local_264 = _e853.x;
                        }
                        let _e856 = local_264;
                        let _e857 = y_3;
                        if (_e857 == 0i) {
                            let _e861 = wf;
                            local_265 = (1f - _e861.y);
                        } else {
                            let _e864 = wf;
                            local_265 = _e864.y;
                        }
                        let _e867 = local_265;
                        weight_4 = (_e856 * _e867);
                        let _e870 = cls_7;
                        if (_e870 == 2i) {
                            let _e873 = wMeadow;
                            let _e874 = weight_4;
                            wMeadow = (_e873 + _e874);
                        } else {
                            let _e876 = cls_7;
                            if (_e876 == 3i) {
                                let _e879 = wPasture;
                                let _e880 = weight_4;
                                wPasture = (_e879 + _e880);
                            } else {
                                let _e882 = cls_7;
                                if (_e882 == 6i) {
                                    let _e885 = wHeath;
                                    let _e886 = weight_4;
                                    wHeath = (_e885 + _e886);
                                } else {
                                    let _e888 = cls_7;
                                    if (_e888 == 10i) {
                                        let _e891 = wMarsh;
                                        let _e892 = weight_4;
                                        wMarsh = (_e891 + _e892);
                                    }
                                }
                            }
                        }
                    }
                    continuing {
                        let _e825 = x_10;
                        x_10 = (_e825 + 1i);
                    }
                }
                continuing {
                    let _e816 = y_3;
                    y_3 = (_e816 + 1i);
                }
            }
            let _e894 = wMeadow;
            let _e897 = wMeadow;
            let _e899 = wPasture;
            let _e901 = wHeath;
            let _e903 = wMarsh;
            wMeadow = (_e894 + max(0f, ((((1f - _e897) - _e899) - _e901) - _e903)));
            let _e907 = wHeath;
            let _e908 = wildShare;
            paperCommonsShare = (_e907 * _e908);
        }
    }
    loop {
        let _e919 = i_11;
        if !((_e919 < 9i)) {
            break;
        }
        {
            let _e929 = i_11;
            if (_e929 == 0i) {
                {
                    cls_8 = 1i;
                    let _e933 = global.uHasLandDetail;
                    if (_e933 == 1i) {
                        local_266 = 0f;
                    } else {
                        let _e937 = wField;
                        local_266 = _e937;
                    }
                    let _e939 = local_266;
                    w_18 = _e939;
                    let _e940 = dry_9;
                    d_24 = _e940;
                }
            } else {
                let _e941 = i_11;
                if (_e941 == 1i) {
                    {
                        cls_8 = 4i;
                        let _e945 = wOrchard;
                        w_18 = _e945;
                        let _e946 = dry_9;
                        d_24 = (_e946 * 0.5f);
                    }
                } else {
                    let _e949 = i_11;
                    if (_e949 == 2i) {
                        {
                            cls_8 = 5i;
                            let _e953 = wGarden;
                            w_18 = _e953;
                            let _e954 = dry_9;
                            d_24 = (_e954 * 0.5f);
                        }
                    } else {
                        let _e957 = i_11;
                        if (_e957 == 3i) {
                            {
                                cls_8 = 7i;
                                let _e961 = wTown;
                                w_18 = _e961;
                                d_24 = 0f;
                            }
                        } else {
                            let _e963 = i_11;
                            if (_e963 == 4i) {
                                {
                                    cls_8 = 9i;
                                    let _e967 = wLane;
                                    w_18 = _e967;
                                    d_24 = 0f;
                                }
                            } else {
                                let _e969 = i_11;
                                if (_e969 == 5i) {
                                    {
                                        cls_8 = 2i;
                                        let _e973 = wMeadow;
                                        w_18 = _e973;
                                        let _e974 = dry_9;
                                        d_24 = _e974;
                                    }
                                } else {
                                    let _e975 = i_11;
                                    if (_e975 == 6i) {
                                        {
                                            cls_8 = 3i;
                                            let _e979 = wPasture;
                                            w_18 = _e979;
                                            let _e980 = dry_9;
                                            d_24 = _e980;
                                        }
                                    } else {
                                        let _e981 = i_11;
                                        if (_e981 == 7i) {
                                            {
                                                cls_8 = 6i;
                                                let _e985 = wHeath;
                                                w_18 = _e985;
                                                d_24 = 0f;
                                            }
                                        } else {
                                            {
                                                cls_8 = 10i;
                                                let _e988 = wMarsh;
                                                w_18 = _e988;
                                                d_24 = 0f;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let _e990 = w_18;
            if (_e990 <= 0f) {
                continue;
            }
            let _e994 = w_18;
            let _e995 = cls_8;
            let _e996 = world_72;
            let _e997 = footprint_47;
            let _e998 = bare_26;
            let _e999 = micro_3;
            let _e1000 = d_24;
            let _e1001 = green_22;
            let _e1004 = occupationMaterial(_e995, _e996, _e997, _e998, _e999, _e1000, _e1001, (&pool_2));
            c_45 = (_e994 * _e1004);
            let _e1007 = i_11;
            if (_e1007 < 5i) {
                let _e1010 = tended;
                let _e1011 = c_45;
                tended = (_e1010 + _e1011);
            } else {
                {
                    let _e1013 = wild;
                    let _e1014 = c_45;
                    wild = (_e1013 + _e1014);
                    let _e1016 = cls_8;
                    if (_e1016 == 10i) {
                        {
                            let _e1019 = w_18;
                            let _e1020 = pool_2;
                            let _e1022 = wildShare;
                            poolShare = ((_e1019 * _e1020) * _e1022);
                            let _e1024 = w_18;
                            let _e1025 = wildShare;
                            marsh = (_e1024 * _e1025);
                        }
                    }
                }
            }
        }
        continuing {
            let _e923 = i_11;
            i_11 = (_e923 + 1i);
        }
    }
    let _e1027 = tendedShare;
    let _e1028 = wildShare;
    covered = (_e1027 + _e1028);
    let _e1031 = tended;
    let _e1032 = wild;
    let _e1033 = wildShare;
    target_1 = (_e1031 + (_e1032 * _e1033));
    let _e1037 = covered;
    if (_e1037 <= 0f) {
        return;
    }
    let _e1040 = target_1;
    let _e1041 = covered;
    target_1 = (_e1040 / vec4(_e1041));
    let _e1044 = fieldShare;
    let _e1046 = covered;
    if (_e1044 > (0.5f * _e1046)) {
        let _e1049 = footprint_47;
        let _e1050 = cell_18;
        local_267 = max(_e1049, min((_e1050 * 0.6f), 12f));
    } else {
        let _e1056 = footprint_47;
        let _e1059 = cell_18;
        local_267 = max((_e1056 * 2f), min((_e1059 * 3f), 45f));
    }
    let _e1066 = local_267;
    edgeWidth = _e1066;
    let _e1068 = edgeWidth;
    let _e1071 = dry_9;
    let _e1075 = cell_18;
    width_3 = min((_e1068 * (1f + (1.5f * _e1071))), (_e1075 * 6f));
    let _e1080 = v2GroundSnow;
    snow_5 = _e1080;
    let _e1082 = fieldShare;
    let _e1085 = landFieldCrop;
    let _e1089 = snow_5;
    let _e1093 = snow_5;
    if ((((_e1082 > 0f) && (_e1085 >= 0f)) && (_e1089 > 0f)) && (_e1093 < 1f)) {
        {
            let _e1099 = landFieldCrop;
            h_28 = (0.5f + (0.5f * sin(((_e1099 * 211f) + 0.7f))));
            let _e1110 = footprint_47;
            let _e1115 = landFieldEdge;
            let _e1116 = groundSmooth(0f, max((_e1110 * 0.8f), 1.5f), _e1115);
            limit_1 = (1f - _e1116);
            let _e1119 = snow_5;
            let _e1120 = h_28;
            let _e1125 = snow_5;
            let _e1128 = snow_5;
            let _e1137 = limit_1;
            own = (clamp((_e1119 + ((((_e1120 - 0.5f) * 2.8f) * _e1125) * (1f - _e1128))), 0f, 1f) * (1f - (0.3f * _e1137)));
            let _e1142 = snow_5;
            let _e1143 = own;
            let _e1144 = fieldShare;
            let _e1145 = covered;
            snow_5 = mix(_e1142, _e1143, (_e1144 / _e1145));
        }
    }
    let _e1149 = width_3;
    let _e1150 = o_7;
    let _e1152 = o_7;
    let _e1156 = groundSmooth(0f, _e1149, min(_e1150.x, -(_e1152.y)));
    let _e1159 = dry_9;
    let _e1161 = wildShare;
    let _e1163 = covered;
    let _e1168 = snow_5;
    let _e1171 = wTown;
    let _e1173 = covered;
    let _e1181 = covered;
    a_28 = (((_e1156 * (1f - (((0.3f * _e1159) * _e1161) / _e1163))) * (1f - (_e1168 * (1f - ((0.35f * _e1171) / max(_e1173, 0.001f)))))) * _e1181);
    let _e1184 = snow_5;
    let _e1185 = v2GroundSnow;
    let _e1189 = covered;
    extra = (max((_e1184 - _e1185), 0f) * _e1189);
    let _e1192 = a_28;
    let _e1195 = extra;
    if ((_e1192 <= 0f) && (_e1195 <= 0f)) {
        return;
    }
    let _e1199 = renderGuideOpen;
    let _e1200 = target_1;
    let _e1202 = a_28;
    renderGuideOpen = mix(_e1199, _e1200.xyz, vec3(_e1202));
    let _e1206 = (*m_8);
    let _e1208 = target_1;
    let _e1210 = groundToLinear(_e1208.xyz);
    let _e1211 = v2FloorModulation;
    let _e1213 = a_28;
    (*m_8).albedo = mix(_e1206.albedo, (_e1210 * _e1211), vec3(_e1213));
    let _e1217 = (*m_8);
    let _e1219 = target_1;
    let _e1221 = a_28;
    (*m_8).roughness = mix(_e1217.roughness, _e1219.w, _e1221);
    let _e1224 = (*m_8);
    let _e1226 = v2MacroNormal;
    let _e1227 = a_28;
    let _e1228 = marsh;
    let _e1229 = poolShare;
    (*m_8).normal = normalize(mix(_e1224.normal, _e1226, vec3(((_e1227 * max(_e1228, _e1229)) * 0.6f))));
    let _e1237 = fieldShare;
    if (_e1237 > 0f) {
        let _e1241 = (*m_8);
        let _e1243 = fieldSlope;
        let _e1247 = fieldSlope;
        let _e1251 = a_28;
        let _e1253 = fieldShare;
        (*m_8).normal = normalize((_e1241.normal + ((vec3<f32>(-(_e1243.x), 0f, -(_e1247.y)) * _e1251) * _e1253)));
    }
    let _e1257 = extra;
    if (_e1257 > 0f) {
        {
            let _e1261 = (*m_8);
            let _e1267 = groundToLinear(vec3<f32>(0.88f, 0.91f, 0.91f));
            let _e1268 = v2FloorModulation;
            let _e1270 = extra;
            (*m_8).albedo = mix(_e1261.albedo, (_e1267 * _e1268), vec3(_e1270));
            let _e1273 = renderGuideOpen;
            let _e1278 = extra;
            renderGuideOpen = mix(_e1273, vec3<f32>(0.88f, 0.91f, 0.91f), vec3(_e1278));
            return;
        }
    } else {
        return;
    }
}

fn forestRasterLight(m_9: GroundMaterial, l_10: vec3<f32>) -> f32 {
    var m_10: GroundMaterial;
    var l_11: vec3<f32>;

    m_10 = m_9;
    l_11 = l_10;
    let _e303 = m_10;
    let _e311 = m_10;
    let _e315 = m_10;
    let _e317 = l_11;
    return (((0.34f + (0.16f * clamp(_e303.normal.y, 0f, 1f))) * _e311.occlusion) + (0.7f * max(dot(_e315.normal, _e317), 0f)));
}

fn terrain3dMaterial(s_23: vec3<f32>, world_73: vec2<f32>, footprint_48: f32, tpi_4: f32, shore_8: f32, openness_8: f32, light_9: vec3<f32>) -> vec3<f32> {
    var s_24: vec3<f32>;
    var world_74: vec2<f32>;
    var footprint_49: f32;
    var tpi_5: f32;
    var shore_9: f32;
    var openness_9: f32;
    var light_10: vec3<f32>;
    var macroColor_4: vec3<f32>;
    var material: GroundMaterial;
    var l_12: vec3<f32>;
    var bare_27: f32;

    s_24 = s_23;
    world_74 = world_73;
    footprint_49 = footprint_48;
    tpi_5 = tpi_4;
    shore_9 = shore_8;
    openness_9 = openness_8;
    light_10 = light_9;
    let _e311 = s_24;
    let _e312 = world_74;
    let _e313 = footprint_49;
    let _e316 = tpi_5;
    let _e317 = shore_9;
    let _e318 = openness_9;
    let _e319 = earthMaterial(_e311, _e312, max(_e313, 1f), _e316, _e317, _e318);
    macroColor_4 = _e319;
    let _e321 = s_24;
    let _e322 = world_74;
    let _e323 = footprint_49;
    let _e324 = macroColor_4;
    let _e325 = global.uMaterialClimate;
    let _e326 = global.uMaterialSeed;
    let _e327 = terrainGroundMaterial_1(_e321, _e322, _e323, _e324, _e325, _e326);
    material = _e327;
    if (uForest == 1i) {
        {
            let _e331 = light_10;
            l_12 = normalize(_e331);
            let _e334 = material;
            let _e335 = l_12;
            let _e336 = forestRasterLight(_e334, _e335);
            bare_27 = _e336;
            let _e339 = world_74;
            let _e340 = footprint_49;
            let _e341 = l_12;
            applyForest((&material), _e339, _e340, _e341);
            let _e343 = material;
            let _e345 = material;
            let _e346 = l_12;
            let _e347 = forestRasterLight(_e345, _e346);
            let _e349 = bare_27;
            let _e354 = groundToDisplay(((_e343.albedo * _e347) / vec3(max(_e349, 0.001f))));
            return _e354;
        }
    }
    let _e355 = material;
    let _e357 = groundToDisplay(_e355.albedo);
    return _e357;
}

fn terrain3dMaterial_1(s_25: vec3<f32>, world_75: vec2<f32>, footprint_50: f32, tpi_6: f32, shore_10: f32, openness_10: f32) -> vec3<f32> {
    var s_26: vec3<f32>;
    var world_76: vec2<f32>;
    var footprint_51: f32;
    var tpi_7: f32;
    var shore_11: f32;
    var openness_11: f32;

    s_26 = s_25;
    world_76 = world_75;
    footprint_51 = footprint_50;
    tpi_7 = tpi_6;
    shore_11 = shore_10;
    openness_11 = openness_10;
    let _e309 = s_26;
    let _e310 = world_76;
    let _e311 = footprint_51;
    let _e312 = tpi_7;
    let _e313 = shore_11;
    let _e314 = openness_11;
    let _e321 = terrain3dMaterial(_e309, _e310, _e311, _e312, _e313, _e314, vec3<f32>(-0.5f, 0.70710677f, -0.5f));
    return _e321;
}

fn surfaceGroundReadInputs(world_77: vec2<f32>, fp_22: f32) {
    var world_78: vec2<f32>;
    var fp_23: f32;
    var occupation_3: vec3<f32>;
    var local_268: vec2<f32>;
    var bank_2: vec2<f32>;
    var local_269: f32;
    var local_270: f32;
    var distance_1: f32;
    var local_271: f32;

    world_78 = world_77;
    fp_23 = fp_22;
    let _e301 = global.uQuality;
    if (_e301 > 0i) {
        return;
    }
    let _e304 = global.uGroundCover;
    let _e317 = fp_23;
    if (((((_e304.w < 0.5f) || (uForest == 0i)) || (uForestBrushes != 0i)) || (uRenderV2_ > 1i)) || (_e317 >= 10f)) {
        return;
    }
    let _e321 = surfaceGroundHasInputs;
    let _e322 = world_78;
    let _e323 = surfaceGroundPoint;
    if (_e321 && all((_e322 == _e323))) {
        return;
    }
    let _e327 = world_78;
    let _e328 = groundOccupation(_e327);
    occupation_3 = _e328;
    let _e330 = fp_23;
    if (_e330 < 1f) {
        let _e333 = world_78;
        let _e334 = forestBankAt(_e333);
        local_268 = _e334;
    } else {
        local_268 = vec2<f32>(-1000f, 0f);
    }
    let _e340 = local_268;
    bank_2 = _e340;
    if (uRenderV2_ == 1i) {
        let _e344 = world_78;
        let _e345 = forestWaterCoverage(_e344);
        local_269 = _e345;
    } else {
        local_269 = 0f;
    }
    let _e348 = local_269;
    surfaceGroundWet = _e348;
    let _e349 = bank_2;
    if (_e349.y > 0f) {
        let _e353 = bank_2;
        let _e355 = bank_2;
        local_270 = (_e353.y - _e355.x);
    } else {
        local_270 = 1000000000f;
    }
    let _e360 = local_270;
    distance_1 = _e360;
    let _e362 = world_78;
    let _e363 = occupation_3;
    let _e364 = surfaceGroundWet;
    if (_e364 >= 0.5f) {
        let _e367 = distance_1;
        local_271 = -(max(_e367, 0.3f));
    } else {
        let _e371 = distance_1;
        local_271 = _e371;
    }
    let _e373 = local_271;
    surfaceGroundInputs(_e362, _e363, _e373);
    return;
}

fn v2ClearingTarget(control: f32, humid_2: f32, trop_2: f32) -> f32 {
    var control_1: f32;
    var humid_3: f32;
    var trop_3: f32;

    control_1 = control;
    humid_3 = humid_2;
    trop_3 = trop_2;
    let _e303 = control_1;
    let _e308 = humid_3;
    let _e309 = sstep(0.8f, 1.8f, _e308);
    let _e314 = trop_3;
    return ((_e303 * mix(0.4f, 0.08f, _e309)) * (1f - (0.85f * _e314)));
}

fn v2ClearingFraction(score: f32, threshold_1: f32) -> f32 {
    var score_1: f32;
    var threshold_2: f32;
    var meanShare: f32;

    score_1 = score;
    threshold_2 = threshold_1;
    let _e303 = threshold_2;
    meanShare = (1f / (1f + exp(clamp(((_e303 * 1.702f) / 1.15f), -20f, 20f))));
    let _e318 = meanShare;
    let _e321 = score_1;
    return min(0.55f, ((2f * _e318) / (1f + exp(clamp((-(_e321) / 1.15f), -20f, 20f)))));
}

fn v2StandCoverage(cover_13: f32, stand_3: f32, disturbed: f32, trop_4: f32) -> f32 {
    var cover_14: f32;
    var stand_4: f32;
    var disturbed_1: f32;
    var trop_5: f32;
    var mosaic: f32;
    var density_2: f32;

    cover_14 = cover_13;
    stand_4 = stand_3;
    disturbed_1 = disturbed;
    trop_5 = trop_4;
    let _e308 = trop_5;
    mosaic = (0.22f * (1f - (0.75f * _e308)));
    let _e313 = mosaic;
    let _e314 = stand_4;
    let _e317 = stand_4;
    let _e320 = cover_14;
    let _e327 = disturbed_1;
    let _e331 = trop_5;
    density_2 = (exp(((_e313 * _e314) + ((0.05f * _e317) * (1f - _e320)))) * (1f - ((0.3f * _e327) * (1f - (0.7f * _e331)))));
    let _e340 = cover_14;
    let _e344 = density_2;
    return (1f - pow(max((1f - _e340), 0.001f), _e344));
}

fn v2Pattern(point_13: vec3<f32>, scale_7: f32, fp_24: f32, salt_33: u32) -> f32 {
    var point_14: vec3<f32>;
    var scale_8: f32;
    var fp_25: f32;
    var salt_34: u32;

    point_14 = point_13;
    scale_8 = scale_7;
    fp_25 = fp_24;
    salt_34 = salt_33;
    let _e305 = point_14;
    let _e306 = scale_8;
    let _e309 = salt_34;
    let _e310 = surfaceNoise((_e305 / vec3(_e306)), _e309);
    let _e312 = scale_8;
    let _e315 = scale_8;
    let _e318 = fp_25;
    let _e319 = sstep((_e312 * 0.12f), (_e315 * 0.3f), _e318);
    return (_e310 * (1f - _e319));
}

fn v2Snow(temperature_2: f32, potential: f32, slope_10: f32, valley_1: f32) -> f32 {
    var temperature_3: f32;
    var potential_1: f32;
    var slope_11: f32;
    var valley_2: f32;

    temperature_3 = temperature_2;
    potential_1 = potential;
    slope_11 = slope_10;
    valley_2 = valley_1;
    let _e308 = temperature_3;
    let _e310 = valley_2;
    let _e313 = sstep(2f, -5f, (_e308 - (0.8f * _e310)));
    let _e316 = potential_1;
    let _e317 = sstep(0.12f, 0.7f, _e316);
    let _e322 = slope_11;
    let _e323 = sstep(0.45f, 1.25f, _e322);
    return clamp(((_e313 * _e317) * (1f - _e323)), 0f, 1f);
}

fn v2PerennialSnow(warmest: f32, potential_2: f32, slope_12: f32) -> f32 {
    var warmest_1: f32;
    var potential_3: f32;
    var slope_13: f32;

    warmest_1 = warmest;
    potential_3 = potential_2;
    slope_13 = slope_12;
    let _e306 = warmest_1;
    let _e307 = sstep(2.5f, -2.5f, _e306);
    let _e310 = potential_3;
    let _e311 = sstep(0.12f, 0.7f, _e310);
    let _e316 = slope_13;
    let _e317 = sstep(0.45f, 1.25f, _e316);
    return clamp(((_e307 * _e311) * (1f - _e317)), 0f, 1f);
}

fn v2EvaluateDomains(point_15: vec3<f32>, landPoint: vec3<f32>, h_29: f32, gradient_5: vec2<f32>, tpi_8: f32, ts_2: f32, tw_2: f32, ps_2: f32, pw_2: f32, sand_2: f32, bank_3: f32, date: f32, footprint_52: f32, salt_35: u32) -> V2Env {
    var point_16: vec3<f32>;
    var landPoint_1: vec3<f32>;
    var h_30: f32;
    var gradient_6: vec2<f32>;
    var tpi_9: f32;
    var ts_3: f32;
    var tw_3: f32;
    var ps_3: f32;
    var pw_3: f32;
    var sand_3: f32;
    var bank_4: f32;
    var date_1: f32;
    var footprint_53: f32;
    var salt_36: u32;
    var e_3: V2Env;
    var provinceOffset: vec3<f32>;
    var phase_5: f32;
    var slope_14: f32;
    var province_1: f32;
    var mosaic_1: f32;
    var valley_3: f32;
    var ridge_1: f32;
    var thermal: f32;
    var annual: f32;
    var threshold_3: f32;
    var rain: f32;
    var grow: f32;
    var wetTropic: f32;
    var thermalGate: f32;
    var stands: f32;
    var deciduous_1: f32;
    var dryLeaf: f32;
    var snowSupply: f32;
    var snowExposure: f32;

    point_16 = point_15;
    landPoint_1 = landPoint;
    h_30 = h_29;
    gradient_6 = gradient_5;
    tpi_9 = tpi_8;
    ts_3 = ts_2;
    tw_3 = tw_2;
    ps_3 = ps_2;
    pw_3 = pw_2;
    sand_3 = sand_2;
    bank_4 = bank_3;
    date_1 = date;
    footprint_53 = footprint_52;
    salt_36 = salt_35;
    let _e326 = salt_36;
    let _e330 = salt_36;
    let _e336 = salt_36;
    provinceOffset = (vec3<f32>(f32((_e326 & 255u)), f32(((_e330 >> 8u) & 255u)), f32(((_e336 >> 16u) & 255u))) * 0.37f);
    let _e349 = date_1;
    phase_5 = (0.5f - (0.5f * cos((6.2831855f * _e349))));
    let _e355 = gradient_6;
    slope_14 = length(_e355);
    let _e359 = point_16;
    let _e363 = provinceOffset;
    let _e365 = salt_36;
    let _e368 = surfaceNoise(((_e359 / vec3(180000f)) + _e363), (_e365 + 601u));
    let _e373 = footprint_53;
    let _e374 = sstep(21600f, 54000f, _e373);
    let _e378 = point_16;
    let _e382 = provinceOffset;
    let _e384 = salt_36;
    let _e387 = surfaceNoise(((_e378 / vec3(690000f)) + _e382), (_e384 + 607u));
    let _e392 = footprint_53;
    let _e393 = sstep(82800f, 207000f, _e392);
    province_1 = (((0.72f * _e368) * (1f - _e374)) + ((0.28f * _e387) * (1f - _e393)));
    let _e399 = landPoint_1;
    let _e403 = salt_36;
    let _e406 = surfaceNoise((_e399 / vec3(2400f)), (_e403 + 613u));
    let _e411 = footprint_53;
    let _e412 = sstep(288f, 720f, _e411);
    let _e416 = landPoint_1;
    let _e420 = salt_36;
    let _e423 = surfaceNoise((_e416 / vec3(670f)), (_e420 + 617u));
    let _e428 = footprint_53;
    let _e429 = sstep(80.4f, 201f, _e428);
    mosaic_1 = (((0.72f * _e406) * (1f - _e412)) + ((0.28f * _e423) * (1f - _e429)));
    let _e437 = tpi_9;
    let _e438 = sstep(0f, -0.1f, _e437);
    valley_3 = _e438;
    let _e442 = tpi_9;
    let _e443 = sstep(0f, 0.1f, _e442);
    ridge_1 = _e443;
    let _e448 = gradient_6;
    let _e452 = slope_14;
    let _e457 = ridge_1;
    let _e461 = valley_3;
    e_3.exposure = clamp((((0.5f + ((0.28f * _e448.y) / max(0.2f, _e452))) + (0.22f * _e457)) - (0.22f * _e461)), 0f, 1f);
    let _e468 = e_3;
    let _e474 = mosaic_1;
    thermal = ((0.65f * (_e468.exposure - 0.5f)) + (0.35f * _e474));
    let _e479 = tw_3;
    let _e480 = ts_3;
    let _e481 = phase_5;
    let _e483 = thermal;
    e_3.temperature = (mix(_e479, _e480, _e481) + _e483);
    let _e485 = ts_3;
    let _e486 = tw_3;
    annual = ((_e485 + _e486) * 0.5f);
    let _e493 = annual;
    threshold_3 = max(120f, ((20f * _e493) + 280f));
    let _e500 = ps_3;
    let _e501 = pw_3;
    let _e503 = threshold_3;
    let _e506 = mosaic_1;
    let _e512 = valley_3;
    let _e516 = ridge_1;
    let _e520 = bank_4;
    e_3.potential = clamp((((((_e500 + _e501) / _e503) * exp((0.12f * _e506))) * ((1f + (0.45f * _e512)) - (0.14f * _e516))) + (_e520 * 0.8f)), 0f, 5f);
    let _e527 = pw_3;
    let _e528 = ps_3;
    let _e529 = phase_5;
    let _e533 = threshold_3;
    rain = ((mix(_e527, _e528, _e529) * 2f) / _e533);
    let _e538 = e_3;
    let _e542 = rain;
    let _e549 = e_3;
    let _e551 = sstep(16f, 34f, _e549.temperature);
    let _e556 = valley_3;
    let _e559 = bank_4;
    e_3.moisture = clamp((((((0.62f * _e538.potential) + (0.38f * _e542)) * (1f - (0.18f * _e551))) + (0.18f * _e556)) + (_e559 * 0.6f)), 0f, 4f);
    let _e569 = province_1;
    e_3.mineral = clamp((0.5f + (0.42f * _e569)), 0f, 1f);
    let _e576 = sand_3;
    let _e581 = slope_14;
    let _e582 = sstep(0.16f, 0.7f, _e581);
    let _e587 = valley_3;
    let _e592 = e_3;
    let _e594 = sstep(0.5f, 1.4f, _e592.potential);
    e_3.sand = clamp(((_e576 * (1f - (0.65f * _e582))) + ((0.13f * _e587) * (1f - _e594))), 0f, 1f);
    let _e604 = valley_3;
    let _e609 = e_3;
    let _e615 = slope_14;
    let _e620 = e_3;
    e_3.clay = clamp((((0.18f + (0.25f * _e604)) + (0.16f * (1f - _e609.sand))) - (0.12f * _e615)), 0f, (1f - _e620.sand));
    let _e626 = e_3;
    let _e629 = e_3;
    let _e635 = e_3;
    let _e637 = sstep(0.6f, 2f, _e635.potential);
    let _e642 = slope_14;
    let _e643 = sstep(0.12f, 0.7f, _e642);
    let _e647 = valley_3;
    e_3.organic = min(((1f - _e626.sand) - _e629.clay), clamp((((0.18f * _e637) * (1f - _e643)) + (0.13f * _e647)), 0f, 0.6f));
    let _e657 = slope_14;
    let _e658 = sstep(0.2f, 0.85f, _e657);
    let _e664 = mosaic_1;
    let _e665 = sstep(-0.5f, 0.9f, _e664);
    let _e670 = ridge_1;
    let _e675 = e_3;
    let _e677 = sstep(0.5f, 1.5f, _e675.potential);
    e_3.rock = clamp(((_e658 * (0.65f + (0.35f * _e665))) + ((0.12f * _e670) * (1f - _e677))), 0f, 1f);
    let _e684 = ts_3;
    let _e685 = tw_3;
    grow = max(_e684, _e685);
    let _e690 = ts_3;
    let _e691 = tw_3;
    let _e693 = sstep(16f, 23f, min(_e690, _e691));
    let _e696 = e_3;
    let _e698 = sstep(1.5f, 3f, _e696.potential);
    wetTropic = (_e693 * _e698);
    let _e703 = grow;
    let _e705 = mosaic_1;
    let _e709 = valley_3;
    let _e712 = sstep(5f, 9f, ((_e703 + (0.7f * _e705)) + (0.6f * _e709)));
    thermalGate = _e712;
    let _e717 = wetTropic;
    let _e720 = mosaic_1;
    let _e726 = mosaic_1;
    let _e727 = sstep(0.7f, 1.4f, _e726);
    let _e730 = wetTropic;
    stands = clamp(((1f + ((0.2f - (0.15f * _e717)) * _e720)) - ((0.17f * _e727) * (1f - _e730))), 0.55f, 1.15f);
    let _e741 = e_3;
    let _e743 = sstep(0.38f, 1.65f, _e741.potential);
    let _e746 = wetTropic;
    let _e750 = thermalGate;
    let _e752 = stands;
    let _e755 = e_3;
    let _e759 = bank_4;
    let _e762 = thermalGate;
    e_3.woody = clamp((((((_e743 * (0.72f + (0.25f * _e746))) * _e750) * _e752) * (1f - _e755.rock)) + ((_e759 * 0.5f) * _e762)), 0f, 0.985f);
    let _e773 = e_3;
    let _e775 = sstep(0.5f, 3f, _e773.potential);
    let _e779 = grow;
    let _e780 = sstep(5f, 22f, _e779);
    let _e785 = mosaic_1;
    let _e789 = thermalGate;
    e_3.height = (((2f + ((30f * _e775) * _e780)) * (1f + (0.15f * _e785))) * _e789);
    let _e795 = grow;
    let _e796 = sstep(9f, 19f, _e795);
    let _e801 = province_1;
    let _e802 = sstep(0.2f, 0.8f, _e801);
    let _e805 = wetTropic;
    e_3.needle = clamp((((1f - _e796) + (0.25f * _e802)) - _e805), 0f, 1f);
    let _e813 = e_3;
    let _e815 = sstep(-3f, 14f, _e813.temperature);
    deciduous_1 = _e815;
    let _e819 = e_3;
    let _e821 = sstep(0.28f, 0.9f, _e819.moisture);
    dryLeaf = _e821;
    let _e826 = deciduous_1;
    let _e829 = dryLeaf;
    let _e832 = ts_3;
    let _e833 = tw_3;
    let _e835 = sstep(16f, 23f, min(_e832, _e833));
    e_3.leaf = mix((0.12f + (0.88f * _e826)), _e829, _e835);
    let _e838 = e_3;
    let _e841 = e_3;
    e_3.leaf = mix(_e838.leaf, 1f, _e841.needle);
    let _e844 = ps_3;
    let _e845 = pw_3;
    let _e847 = threshold_3;
    snowSupply = clamp(((_e844 + _e845) / _e847), 0f, 5f);
    let _e854 = e_3;
    snowExposure = (0.65f * (_e854.exposure - 0.5f));
    let _e861 = tw_3;
    let _e862 = ts_3;
    let _e863 = phase_5;
    let _e865 = snowExposure;
    let _e867 = snowSupply;
    let _e868 = slope_14;
    let _e869 = valley_3;
    let _e870 = v2Snow((mix(_e861, _e862, _e863) + _e865), _e867, _e868, _e869);
    let _e871 = grow;
    let _e872 = snowExposure;
    let _e874 = snowSupply;
    let _e875 = slope_14;
    let _e876 = v2PerennialSnow((_e871 + _e872), _e874, _e875);
    e_3.snow = max(_e870, _e876);
    let _e883 = e_3;
    let _e885 = sstep(-1.8f, -8f, _e883.temperature);
    e_3.ice = _e885;
    let _e889 = e_3;
    let _e891 = sstep(0.12f, 0.8f, _e889.potential);
    let _e894 = grow;
    let _e895 = sstep(0f, 9f, _e894);
    let _e898 = e_3;
    let _e903 = e_3;
    e_3.grass = clamp((((_e891 * _e895) * (1f - _e898.rock)) * (1f - _e903.snow)), 0f, 1f);
    let _e913 = mosaic_1;
    let _e917 = valley_3;
    e_3.tone = clamp(((0.5f + (0.13f * _e913)) - (0.06f * _e917)), 0f, 1f);
    e_3.glacier = 0f;
    let _e926 = point_16;
    e_3.world = _e926.xy;
    let _e929 = slope_14;
    e_3.slope = _e929;
    let _e931 = footprint_53;
    e_3.footprint = _e931;
    let _e933 = salt_36;
    e_3.seed = _e933;
    let _e934 = e_3;
    return _e934;
}

fn v2Evaluate(point_17: vec3<f32>, h_31: f32, gradient_7: vec2<f32>, tpi_10: f32, ts_4: f32, tw_4: f32, ps_4: f32, pw_4: f32, sand_4: f32, bank_5: f32, date_2: f32, footprint_54: f32, salt_37: u32) -> V2Env {
    var point_18: vec3<f32>;
    var h_32: f32;
    var gradient_8: vec2<f32>;
    var tpi_11: f32;
    var ts_5: f32;
    var tw_5: f32;
    var ps_5: f32;
    var pw_5: f32;
    var sand_5: f32;
    var bank_6: f32;
    var date_3: f32;
    var footprint_55: f32;
    var salt_38: u32;

    point_18 = point_17;
    h_32 = h_31;
    gradient_8 = gradient_7;
    tpi_11 = tpi_10;
    ts_5 = ts_4;
    tw_5 = tw_4;
    ps_5 = ps_4;
    pw_5 = pw_4;
    sand_5 = sand_4;
    bank_6 = bank_5;
    date_3 = date_2;
    footprint_55 = footprint_54;
    salt_38 = salt_37;
    let _e323 = point_18;
    let _e324 = point_18;
    let _e325 = h_32;
    let _e326 = gradient_8;
    let _e327 = tpi_11;
    let _e328 = ts_5;
    let _e329 = tw_5;
    let _e330 = ps_5;
    let _e331 = pw_5;
    let _e332 = sand_5;
    let _e333 = bank_6;
    let _e334 = date_3;
    let _e335 = footprint_55;
    let _e336 = salt_38;
    let _e337 = v2EvaluateDomains(_e323, _e324, _e325, _e326, _e327, _e328, _e329, _e330, _e331, _e332, _e333, _e334, _e335, _e336);
    return _e337;
}

fn v2Appearance(e_4: V2Env, fp_26: f32) -> V2Env {
    var e_5: V2Env;
    var fp_27: f32;
    var shown: V2Env;

    e_5 = e_4;
    fp_27 = fp_26;
    let _e301 = e_5;
    shown = _e301;
    let _e305 = e_5;
    let _e310 = fp_27;
    let _e311 = sstep(600f, 2400f, _e310);
    shown.mineral = mix(0.5f, _e305.mineral, (1f - _e311));
    let _e316 = e_5;
    let _e321 = fp_27;
    let _e322 = sstep(120f, 500f, _e321);
    shown.tone = mix(0.5f, _e316.tone, (1f - _e322));
    let _e325 = shown;
    return _e325;
}

fn v2Mineral(e_6: V2Env) -> vec3<f32> {
    var e_7: V2Env;
    var dark: vec3<f32> = vec3<f32>(0.19f, 0.19f, 0.175f);
    var brown: vec3<f32> = vec3<f32>(0.39f, 0.335f, 0.27f);
    var cream: vec3<f32> = vec3<f32>(0.68f, 0.655f, 0.57f);
    var red: vec3<f32> = vec3<f32>(0.49f, 0.37f, 0.285f);

    e_7 = e_6;
    let _e319 = dark;
    let _e320 = brown;
    let _e323 = e_7;
    let _e325 = sstep(0.08f, 0.35f, _e323.mineral);
    let _e328 = cream;
    let _e329 = red;
    let _e332 = e_7;
    let _e334 = sstep(0.68f, 0.94f, _e332.mineral);
    let _e339 = e_7;
    let _e341 = sstep(0.34f, 0.66f, _e339.mineral);
    return mix(mix(_e319, _e320, vec3(_e325)), mix(_e328, _e329, vec3(_e334)), vec3(_e341));
}

fn v2GroundTint(base_3: vec3<f32>, e_8: V2Env) -> vec3<f32> {
    var base_4: vec3<f32>;
    var e_9: V2Env;
    var neutral: V2Env;
    var mineralRatio: vec3<f32>;
    var mineralWeight: f32;

    base_4 = base_3;
    e_9 = e_8;
    let _e301 = e_9;
    neutral = _e301;
    neutral.mineral = 0.5f;
    let _e305 = e_9;
    let _e306 = v2Mineral(_e305);
    let _e307 = neutral;
    let _e308 = v2Mineral(_e307);
    mineralRatio = clamp((_e306 / max(_e308, vec3(0.08f))), vec3(0.6f), vec3(1.4f));
    let _e320 = e_9;
    let _e323 = e_9;
    let _e327 = e_9;
    let _e332 = e_9;
    let _e341 = e_9;
    mineralWeight = ((0.35f * (_e320.rock + ((((1f - _e323.rock) * (1f - _e327.grass)) * (1f - _e332.organic)) * 0.35f))) * (1f - _e341.snow));
    let _e346 = base_4;
    let _e349 = mineralRatio;
    let _e350 = mineralWeight;
    let _e354 = e_9;
    let _e356 = e_9;
    let _e358 = e_9;
    let _e360 = e_9;
    let _e365 = e_9;
    let _e367 = e_9;
    let _e369 = surfaceMicro(_e354.world, _e356.slope, _e358.footprint, clamp(_e360.rock, 0f, 1f), _e365.grass, _e367.seed);
    return ((_e346 * mix(vec3(1f), _e349, vec3(_e350))) * _e369);
}

fn v2DisplayShoulder(rgb: vec3<f32>) -> vec3<f32> {
    var rgb_1: vec3<f32>;
    var peak: f32;
    var mapped: f32;

    rgb_1 = rgb;
    let _e299 = rgb_1;
    let _e301 = rgb_1;
    let _e303 = rgb_1;
    peak = max(_e299.x, max(_e301.y, _e303.z));
    let _e308 = peak;
    if (_e308 <= 0.8f) {
        {
            let _e311 = rgb_1;
            return _e311;
        }
    }
    let _e315 = peak;
    mapped = (0.8f + (0.2f * (1f - exp((-((_e315 - 0.8f)) / 0.2f)))));
    let _e326 = rgb_1;
    let _e327 = mapped;
    let _e328 = peak;
    return (_e326 * (_e327 / _e328));
}

fn v2Open(e_10: V2Env) -> vec3<f32> {
    var e_11: V2Env;
    var mineral: vec3<f32>;
    var sand_6: vec3<f32>;
    var soil_9: vec3<f32>;
    var green_23: f32;
    var grass_10: vec3<f32>;
    var color_11: vec3<f32>;

    e_11 = e_10;
    let _e299 = e_11;
    let _e300 = v2Mineral(_e299);
    mineral = _e300;
    let _e306 = mineral;
    sand_6 = mix(vec3<f32>(0.73f, 0.64f, 0.46f), _e306, vec3(0.24f));
    let _e311 = mineral;
    let _e318 = e_11;
    soil_9 = mix((_e311 * 0.8f), vec3<f32>(0.24f, 0.21f, 0.15f), vec3((_e318.organic * 1.2f)));
    let _e325 = soil_9;
    let _e326 = sand_6;
    let _e327 = e_11;
    soil_9 = mix(_e325, _e326, vec3(_e327.sand));
    let _e331 = soil_9;
    let _e336 = e_11;
    let _e338 = sstep(0.5f, 2f, _e336.moisture);
    soil_9 = (_e331 * (1f - (0.2f * _e338)));
    let _e344 = e_11;
    let _e346 = sstep(0.25f, 1.3f, _e344.moisture);
    let _e349 = e_11;
    let _e351 = sstep(1f, 13f, _e349.temperature);
    green_23 = (_e346 * _e351);
    let _e362 = green_23;
    grass_10 = mix(vec3<f32>(0.53f, 0.485f, 0.335f), vec3<f32>(0.265f, 0.355f, 0.175f), vec3(_e362));
    let _e366 = soil_9;
    let _e367 = grass_10;
    let _e368 = e_11;
    color_11 = mix(_e366, _e367, vec3((_e368.grass * 0.88f)));
    let _e375 = color_11;
    let _e376 = mineral;
    let _e377 = e_11;
    color_11 = mix(_e375, _e376, vec3(_e377.rock));
    let _e381 = color_11;
    let _e386 = e_11;
    return mix(_e381, vec3<f32>(0.88f, 0.91f, 0.91f), vec3(_e386.snow));
}

fn v2Canopy(e_12: V2Env) -> vec3<f32> {
    var e_13: V2Env;
    var evergreen: vec3<f32>;
    var senescent: vec3<f32>;
    var c_46: vec3<f32>;

    e_13 = e_12;
    let _e307 = e_13;
    evergreen = mix(vec3<f32>(0.16f, 0.235f, 0.14f), vec3<f32>(0.12f, 0.205f, 0.15f), vec3(_e307.needle));
    let _e322 = e_13;
    let _e324 = sstep(4f, 12f, _e322.temperature);
    senescent = mix(vec3<f32>(0.34f, 0.29f, 0.215f), vec3<f32>(0.43f, 0.335f, 0.205f), vec3(_e324));
    let _e328 = senescent;
    let _e329 = evergreen;
    let _e332 = e_13;
    let _e334 = sstep(0.3f, 0.9f, _e332.leaf);
    let _e339 = e_13;
    c_46 = (mix(_e328, _e329, vec3(_e334)) * (0.85f + (0.3f * _e339.tone)));
    let _e345 = c_46;
    let _e350 = e_13;
    let _e354 = e_13;
    return mix(_e345, vec3<f32>(0.72f, 0.79f, 0.77f), vec3((_e350.snow * mix(0.62f, 0.08f, _e354.needle))));
}

fn v2Color(e_14: V2Env, channel_1: f32) -> vec3<f32> {
    var e_15: V2Env;
    var channel_2: f32;
    var c_47: vec3<f32>;
    var m_11: f32;
    var c_48: vec3<f32>;
    var t_31: f32;
    var g_19: vec3<f32>;

    e_15 = e_14;
    channel_2 = channel_1;
    let _e301 = channel_2;
    if (_e301 == 1f) {
        {
            let _e304 = e_15;
            let _e305 = v2Mineral(_e304);
            let _e310 = e_15;
            let _e318 = e_15;
            c_47 = mix(mix(_e305, vec3<f32>(0.8f, 0.7f, 0.49f), vec3(_e310.sand)), vec3<f32>(0.22f, 0.18f, 0.13f), vec3(_e318.organic));
            let _e323 = c_47;
            let _e331 = e_15;
            let _e333 = sstep(0.35f, 0.7f, _e331.clay);
            c_47 = mix(_e323, vec3<f32>(0.62f, 0.38f, 0.26f), vec3((0.45f * _e333)));
            let _e337 = c_47;
            let _e343 = e_15;
            return mix(_e337, vec3<f32>(0.52f, 0.52f, 0.55f), vec3((0.7f * clamp(_e343.rock, 0f, 1f))));
        }
    }
    let _e351 = channel_2;
    if (_e351 == 2f) {
        {
            let _e354 = e_15;
            m_11 = _e354.moisture;
            let _e367 = m_11;
            let _e368 = sstep(0f, 0.5f, _e367);
            c_48 = mix(vec3<f32>(0.72f, 0.42f, 0.12f), vec3<f32>(0.86f, 0.72f, 0.44f), vec3(_e368));
            let _e372 = c_48;
            let _e379 = m_11;
            let _e380 = sstep(0.5f, 1.2f, _e379);
            c_48 = mix(_e372, vec3<f32>(0.45f, 0.62f, 0.3f), vec3(_e380));
            let _e383 = c_48;
            let _e390 = m_11;
            let _e391 = sstep(1.2f, 2.2f, _e390);
            c_48 = mix(_e383, vec3<f32>(0.1f, 0.48f, 0.52f), vec3(_e391));
            let _e394 = c_48;
            let _e401 = m_11;
            let _e402 = sstep(2.2f, 3.4f, _e401);
            return mix(_e394, vec3<f32>(0.05f, 0.22f, 0.5f), vec3(_e402));
        }
    }
    let _e405 = channel_2;
    if (_e405 == 3f) {
        {
            let _e408 = e_15;
            let _e412 = e_15;
            let _e414 = e_15;
            let _e418 = e_15;
            return vec3<f32>((_e408.grass * 0.55f), (_e412.woody * _e414.leaf), (0.16f + (_e418.needle * 0.6f)));
        }
    }
    let _e424 = channel_2;
    if (_e424 == 4f) {
        {
            let _e427 = e_15;
            t_31 = _e427.temperature;
            let _e441 = t_31;
            let _e442 = sstep(-10f, 0f, _e441);
            g_19 = mix(vec3<f32>(0.3f, 0.36f, 0.46f), vec3<f32>(0.2f, 0.26f, 0.3f), vec3(_e442));
            let _e446 = g_19;
            let _e453 = t_31;
            let _e454 = sstep(0f, 10f, _e453);
            g_19 = mix(_e446, vec3<f32>(0.3f, 0.34f, 0.26f), vec3(_e454));
            let _e457 = g_19;
            let _e464 = t_31;
            let _e465 = sstep(10f, 25f, _e464);
            g_19 = mix(_e457, vec3<f32>(0.55f, 0.38f, 0.22f), vec3(_e465));
            let _e468 = g_19;
            let _e473 = e_15;
            let _e476 = e_15;
            g_19 = mix(_e468, vec3<f32>(0.62f, 0.86f, 0.96f), vec3(clamp(max(_e473.glacier, (0.5f * _e476.ice)), 0f, 1f)));
            let _e485 = g_19;
            let _e490 = e_15;
            return mix(_e485, vec3<f32>(0.9f, 0.96f, 1f), vec3(_e490.snow));
        }
    }
    let _e494 = e_15;
    let _e495 = v2Open(_e494);
    let _e496 = e_15;
    let _e497 = v2Canopy(_e496);
    let _e498 = e_15;
    let _e500 = e_15;
    return mix(_e495, _e497, vec3((_e498.woody * _e500.leaf)));
}

fn v2Freeze(kind_9: f32, e_16: V2Env) -> f32 {
    var kind_10: f32;
    var e_17: V2Env;
    var local_272: f32;

    kind_10 = kind_9;
    e_17 = e_16;
    let _e301 = kind_10;
    if (_e301 < 1.5f) {
        let _e308 = e_17;
        let _e310 = sstep(-2f, -9f, _e308.temperature);
        local_272 = _e310;
    } else {
        local_272 = 0f;
    }
    let _e313 = local_272;
    return _e313;
}

fn v2PackMean(concentration: f32) -> f32 {
    var concentration_1: f32;

    concentration_1 = concentration;
    let _e299 = concentration_1;
    let _e302 = concentration_1;
    let _e309 = concentration_1;
    let _e310 = sstep(0.68f, 0.9f, _e309);
    return mix((_e299 * (0.55f + (0.5f * _e302))), 0.993f, _e310);
}

fn v2CellCore(point_19: vec3<f32>, scale_9: f32, salt_39: u32, bisector: bool) -> vec4<f32> {
    var point_20: vec3<f32>;
    var scale_10: f32;
    var salt_40: u32;
    var bisector_1: bool;
    var q_17: vec3<f32>;
    var cell_19: vec3<i32>;
    var local_273: vec3<f32>;
    var first_1: f32 = 10f;
    var second_1: f32 = 10f;
    var identity: f32 = 0f;
    var face_1: f32 = 0f;
    var firstDelta: vec3<f32> = vec3(0f);
    var secondDelta: vec3<f32> = vec3(0f);
    var z_6: i32 = -1i;
    var y_4: i32;
    var x_11: i32;
    var offset_2: vec3<i32>;
    var hash: u32;
    var jitter_6: vec3<f32>;
    var delta_1: vec3<f32>;
    var distance_2: f32;
    var edge_7: f32;

    point_20 = point_19;
    scale_10 = scale_9;
    salt_40 = salt_39;
    bisector_1 = bisector;
    let _e305 = point_20;
    let _e306 = scale_10;
    q_17 = (_e305 / vec3(_e306));
    let _e310 = q_17;
    cell_19 = vec3<i32>(floor(_e310));
    let _e314 = q_17;
    let _e315 = q_17;
    local_273 = (_e314 - floor(_e315));
    loop {
        let _e336 = z_6;
        if !((_e336 <= 1i)) {
            break;
        }
        {
            y_4 = -1i;
            loop {
                let _e346 = y_4;
                if !((_e346 <= 1i)) {
                    break;
                }
                {
                    x_11 = -1i;
                    loop {
                        let _e356 = x_11;
                        if !((_e356 <= 1i)) {
                            break;
                        }
                        {
                            let _e363 = x_11;
                            let _e364 = y_4;
                            let _e365 = z_6;
                            offset_2 = vec3<i32>(_e363, _e364, _e365);
                            let _e368 = cell_19;
                            let _e369 = offset_2;
                            let _e371 = salt_40;
                            let _e372 = surfaceHash((_e368 + _e369), _e371);
                            hash = _e372;
                            let _e374 = hash;
                            let _e378 = hash;
                            let _e384 = hash;
                            jitter_6 = (vec3<f32>(f32((_e374 & 1023u)), f32(((_e378 >> 10u) & 1023u)), f32(((_e384 >> 20u) & 1023u))) / vec3(1023f));
                            let _e395 = offset_2;
                            let _e401 = jitter_6;
                            let _e404 = local_273;
                            delta_1 = (((vec3<f32>(_e395) + vec3(0.12f)) + (0.76f * _e401)) - _e404);
                            let _e407 = delta_1;
                            let _e408 = delta_1;
                            distance_2 = dot(_e407, _e408);
                            let _e411 = distance_2;
                            let _e412 = first_1;
                            if (_e411 < _e412) {
                                {
                                    let _e414 = bisector_1;
                                    if _e414 {
                                        {
                                            let _e415 = firstDelta;
                                            secondDelta = _e415;
                                            let _e416 = delta_1;
                                            firstDelta = _e416;
                                        }
                                    }
                                    let _e417 = first_1;
                                    second_1 = _e417;
                                    let _e418 = distance_2;
                                    first_1 = _e418;
                                    let _e419 = hash;
                                    identity = (f32((_e419 & 65535u)) / 65535f);
                                    let _e425 = delta_1;
                                    face_1 = dot(_e425, vec3<f32>(0.65f, -0.3f, 0.7f));
                                }
                            } else {
                                let _e432 = distance_2;
                                let _e433 = second_1;
                                if (_e432 < _e433) {
                                    {
                                        let _e435 = distance_2;
                                        second_1 = _e435;
                                        let _e436 = bisector_1;
                                        if _e436 {
                                            {
                                                let _e437 = delta_1;
                                                secondDelta = _e437;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        continuing {
                            let _e360 = x_11;
                            x_11 = (_e360 + 1i);
                        }
                    }
                }
                continuing {
                    let _e350 = y_4;
                    y_4 = (_e350 + 1i);
                }
            }
        }
        continuing {
            let _e340 = z_6;
            z_6 = (_e340 + 1i);
        }
    }
    let _e438 = second_1;
    let _e440 = first_1;
    edge_7 = (sqrt(_e438) - sqrt(_e440));
    let _e444 = bisector_1;
    if _e444 {
        {
            let _e445 = second_1;
            let _e446 = first_1;
            let _e449 = secondDelta;
            let _e450 = firstDelta;
            edge_7 = ((_e445 - _e446) / max((2f * length((_e449 - _e450))), 0.00001f));
        }
    }
    let _e457 = edge_7;
    let _e458 = first_1;
    let _e460 = identity;
    let _e461 = face_1;
    return vec4<f32>(_e457, sqrt(_e458), _e460, _e461);
}

fn v2Cell(point_21: vec3<f32>, scale_11: f32, salt_41: u32) -> vec4<f32> {
    var point_22: vec3<f32>;
    var scale_12: f32;
    var salt_42: u32;

    point_22 = point_21;
    scale_12 = scale_11;
    salt_42 = salt_41;
    let _e303 = point_22;
    let _e304 = scale_12;
    let _e305 = salt_42;
    let _e307 = v2CellCore(_e303, _e304, _e305, false);
    return _e307;
}

fn v2Ice(depth_2: f32, kind_11: f32, e_18: V2Env, point_23: vec3<f32>, fp_28: f32, salt_43: u32) -> vec4<f32> {
    var depth_3: f32;
    var kind_12: f32;
    var e_19: V2Env;
    var point_24: vec3<f32>;
    var fp_29: f32;
    var salt_44: u32;
    var freeze: f32;
    var shore_12: f32;
    var province_2: f32;
    var concentration_2: f32;
    var pack: f32;
    var brightness: f32 = 0.88f;
    var rim_3: f32 = 0f;
    var shadow_1: f32 = 0f;
    var displacement: vec3<f32> = vec3(0f);
    var k_31: i32 = 0i;
    var local_274: f32;
    var local_275: f32;
    var warpX: f32;
    var warpY: f32;
    var warpZ: f32;
    var packKeep: f32;
    var resolved_1: f32 = 0f;
    var localLight: f32 = 0.88f;
    var localRim: f32 = 0f;
    var warped: vec3<f32>;
    var bent_1: vec3<f32>;
    var q_18: array<f32, 12>;
    var k_32: i32 = 0i;
    var local_276: f32;
    var local_277: f32;
    var local_278: f32;
    var local_279: f32;
    var local_280: f32;
    var local_281: f32;
    var local_282: f32;
    var local_283: f32;
    var local_284: f32;
    var local_285: f32;
    var local_286: f32;
    var scale_13: f32;
    var local_287: vec3<f32>;
    var local_288: vec3<f32>;
    var body_2: f32;
    var field: f32;
    var c_49: f32;
    var quantile: f32;
    var aa_9: f32;
    var floe: f32;
    var crackA: f32;
    var crackB: f32;
    var widthA: f32;
    var widthB: f32;
    var lineA: f32;
    var lineB: f32;
    var line_1: f32;
    var open_2: f32;
    var inner: f32;
    var warped_1: vec3<f32>;
    var plate: vec4<f32>;
    var shard: vec4<f32>;
    var fine_12: vec2<f32> = vec2(0f);
    var k_33: i32 = 0i;
    var local_289: f32;
    var local_290: u32;
    var edge_8: f32;
    var aa_10: f32;
    var lead: f32;
    var large: f32;
    var local_291: f32;
    var split_1: f32;
    var smallLead: f32;
    var smallAA: f32;
    var shards: f32;
    var smallKeep: f32;
    var subdivided: f32;
    var identity_1: f32;
    var local_292: f32;
    var selection: f32;
    var ridge_2: f32;
    var coarse_2: vec3<f32> = vec3(0f);
    var finer: vec3<f32> = vec3(0f);
    var k_34: i32 = 0i;
    var local_293: f32;
    var local_294: u32;
    var v_18: f32;
    var jitter_7: vec3<f32>;
    var grain_4: vec2<f32> = vec2(0f);
    var k_35: i32 = 0i;
    var local_295: f32;
    var local_296: f32;
    var local_297: u32;
    var compact: vec4<f32>;
    var edge_9: f32;
    var aa_11: f32;
    var lead_1: f32;
    var floe_1: f32;
    var pixelWidth: f32;
    var gap_1: f32;
    var opening: f32;
    var local_298: f32;
    var openLead: f32;
    var compactCover: f32;
    var ridge_3: f32;
    var dense: f32;
    var youngIce: f32;
    var compactLight: f32 = 0.88f;
    var compactRim: f32 = 0f;
    var snowGrain: f32;
    var ridgeKeep_1: f32;
    var pressure: f32;
    var snowGrain_1: f32;
    var local_299: f32;
    var source: f32;
    var berg: f32 = 0f;
    var bergLight: f32 = 0.95f;
    var bergRim: f32 = 0f;
    var grouping: f32;
    var density_3: f32;
    var meanBerg: f32;
    var bend_1: f32;
    var piece: vec4<f32>;
    var selected: f32;
    var lobe_2: f32;
    var cut: f32;
    var field_1: f32;
    var aa_12: f32;
    var cap_5: f32;
    var submerged: f32;
    var castShade: f32;
    var keep_9: f32;
    var plateau: f32;
    var coverage_2: f32;

    depth_3 = depth_2;
    kind_12 = kind_11;
    e_19 = e_18;
    point_24 = point_23;
    fp_29 = fp_28;
    salt_44 = salt_43;
    let _e310 = kind_12;
    let _e311 = e_19;
    let _e312 = v2Freeze(_e310, _e311);
    freeze = _e312;
    let _e316 = depth_3;
    let _e317 = sstep(900f, 15f, _e316);
    shore_12 = _e317;
    let _e319 = point_24;
    let _e321 = fp_29;
    let _e322 = salt_44;
    let _e325 = v2Pattern(_e319, 7200f, _e321, (_e322 + 631u));
    let _e329 = fp_29;
    let _e330 = sstep(100f, 500f, _e329);
    province_2 = (_e325 * (1f - _e330));
    let _e334 = freeze;
    let _e336 = shore_12;
    let _e338 = freeze;
    let _e341 = freeze;
    let _e346 = province_2;
    let _e348 = freeze;
    let _e351 = freeze;
    concentration_2 = clamp(((_e334 + (((0.12f * _e336) * _e338) * (1f - _e341))) + ((((0.045f * _e346) * _e348) * (1f - _e351)) * 4f)), 0f, 0.995f);
    let _e361 = concentration_2;
    let _e362 = v2PackMean(_e361);
    pack = _e362;
    let _e370 = concentration_2;
    let _e373 = fp_29;
    if ((_e370 > 0.002f) && (_e373 < 450f)) {
        {
            loop {
                let _e382 = k_31;
                if !((_e382 < 3i)) {
                    break;
                }
                let _e389 = k_31;
                let _e391 = point_24;
                let _e392 = k_31;
                if (_e392 == 0i) {
                    local_275 = 1800f;
                } else {
                    let _e396 = k_31;
                    if (_e396 == 1i) {
                        local_274 = 2100f;
                    } else {
                        local_274 = 1600f;
                    }
                    let _e402 = local_274;
                    local_275 = _e402;
                }
                let _e404 = local_275;
                let _e405 = fp_29;
                let _e406 = salt_44;
                let _e409 = k_31;
                let _e412 = v2Pattern(_e391, _e404, _e405, ((_e406 + 633u) + u32(_e409)));
                displacement[_e389] = _e412;
                continuing {
                    let _e386 = k_31;
                    k_31 = (_e386 + 1i);
                }
            }
            let _e413 = displacement;
            warpX = _e413.x;
            let _e416 = displacement;
            warpY = _e416.y;
            let _e419 = displacement;
            warpZ = _e419.z;
            let _e425 = fp_29;
            let _e426 = sstep(140f, 450f, _e425);
            packKeep = (1f - _e426);
            let _e435 = concentration_2;
            let _e438 = kind_12;
            if ((_e435 < 0.9f) && (_e438 < 1.5f)) {
                {
                    let _e442 = point_24;
                    let _e443 = displacement;
                    warped = (_e442 + (_e443 * 420f));
                    let _e448 = point_24;
                    let _e449 = displacement;
                    bent_1 = (_e448 + (_e449 * 160f));
                    loop {
                        let _e457 = k_32;
                        if !((_e457 < 12i)) {
                            break;
                        }
                        {
                            let _e464 = k_32;
                            if (_e464 == 0i) {
                                local_286 = 3400f;
                            } else {
                                let _e468 = k_32;
                                if (_e468 == 1i) {
                                    local_285 = 1300f;
                                } else {
                                    let _e472 = k_32;
                                    if (_e472 == 2i) {
                                        local_284 = 520f;
                                    } else {
                                        let _e476 = k_32;
                                        if (_e476 == 3i) {
                                            local_283 = 170f;
                                        } else {
                                            let _e480 = k_32;
                                            if (_e480 == 4i) {
                                                local_282 = 62f;
                                            } else {
                                                let _e484 = k_32;
                                                if (_e484 == 5i) {
                                                    local_281 = 2300f;
                                                } else {
                                                    let _e488 = k_32;
                                                    if (_e488 == 6i) {
                                                        local_280 = 640f;
                                                    } else {
                                                        let _e492 = k_32;
                                                        if (_e492 == 7i) {
                                                            local_279 = 900f;
                                                        } else {
                                                            let _e496 = k_32;
                                                            if (_e496 == 8i) {
                                                                local_278 = 240f;
                                                            } else {
                                                                let _e500 = k_32;
                                                                if (_e500 == 9i) {
                                                                    local_277 = 1700f;
                                                                } else {
                                                                    let _e504 = k_32;
                                                                    if (_e504 == 10i) {
                                                                        local_276 = 900f;
                                                                    } else {
                                                                        local_276 = 210f;
                                                                    }
                                                                    let _e510 = local_276;
                                                                    local_277 = _e510;
                                                                }
                                                                let _e512 = local_277;
                                                                local_278 = _e512;
                                                            }
                                                            let _e514 = local_278;
                                                            local_279 = _e514;
                                                        }
                                                        let _e516 = local_279;
                                                        local_280 = _e516;
                                                    }
                                                    let _e518 = local_280;
                                                    local_281 = _e518;
                                                }
                                                let _e520 = local_281;
                                                local_282 = _e520;
                                            }
                                            let _e522 = local_282;
                                            local_283 = _e522;
                                        }
                                        let _e524 = local_283;
                                        local_284 = _e524;
                                    }
                                    let _e526 = local_284;
                                    local_285 = _e526;
                                }
                                let _e528 = local_285;
                                local_286 = _e528;
                            }
                            let _e530 = local_286;
                            scale_13 = _e530;
                            let _e532 = k_32;
                            let _e534 = k_32;
                            if (_e534 < 3i) {
                                let _e537 = warped;
                                local_288 = _e537;
                            } else {
                                let _e538 = k_32;
                                let _e541 = k_32;
                                if ((_e538 >= 5i) && (_e541 < 8i)) {
                                    let _e545 = bent_1;
                                    local_287 = _e545;
                                } else {
                                    let _e546 = point_24;
                                    local_287 = _e546;
                                }
                                let _e548 = local_287;
                                local_288 = _e548;
                            }
                            let _e550 = local_288;
                            let _e551 = scale_13;
                            let _e552 = fp_29;
                            let _e553 = salt_44;
                            let _e556 = k_32;
                            let _e559 = v2Pattern(_e550, _e551, _e552, ((_e553 + 681u) + u32(_e556)));
                            q_18[_e532] = _e559;
                        }
                        continuing {
                            let _e461 = k_32;
                            k_32 = (_e461 + 1i);
                        }
                    }
                    let _e563 = q_18[0];
                    let _e568 = q_18[1];
                    let _e574 = q_18[2];
                    body_2 = (((0.52f * _e563) + (0.3f * _e568)) + (0.18f * _e574));
                    let _e578 = body_2;
                    let _e582 = q_18[3];
                    let _e588 = q_18[4];
                    field = ((_e578 + (0.07f * _e582)) + (0.035f * _e588));
                    let _e592 = concentration_2;
                    c_49 = clamp(_e592, 0.02f, 0.98f);
                    let _e599 = c_49;
                    let _e601 = c_49;
                    quantile = (0.11f * log(((1f - _e599) / _e601)));
                    let _e607 = fp_29;
                    aa_9 = max(0.002f, (_e607 * 0.0006f));
                    let _e612 = quantile;
                    let _e613 = aa_9;
                    let _e615 = quantile;
                    let _e616 = aa_9;
                    let _e618 = field;
                    let _e619 = sstep((_e612 - _e613), (_e615 + _e616), _e618);
                    floe = _e619;
                    let _e623 = q_18[5];
                    let _e627 = q_18[6];
                    crackA = (_e623 + (0.3f * _e627));
                    let _e633 = q_18[7];
                    let _e637 = q_18[8];
                    crackB = (_e633 + (0.25f * _e637));
                    let _e644 = c_49;
                    widthA = (0.016f + (0.04f * (1f - _e644)));
                    let _e652 = c_49;
                    widthB = (0.008f + (0.02f * (1f - _e652)));
                    let _e658 = widthA;
                    let _e660 = fp_29;
                    let _e665 = widthA;
                    let _e667 = fp_29;
                    let _e672 = crackA;
                    let _e674 = sstep((_e658 - max(0.004f, (_e660 * 0.0004f))), (_e665 + max(0.004f, (_e667 * 0.0004f))), abs(_e672));
                    let _e679 = fp_29;
                    let _e680 = sstep(110f, 230f, _e679);
                    lineA = ((1f - _e674) * (1f - _e680));
                    let _e685 = widthB;
                    let _e687 = fp_29;
                    let _e692 = widthB;
                    let _e694 = fp_29;
                    let _e699 = crackB;
                    let _e701 = sstep((_e685 - max(0.004f, (_e687 * 0.0009f))), (_e692 + max(0.004f, (_e694 * 0.0009f))), abs(_e699));
                    let _e706 = fp_29;
                    let _e707 = sstep(45f, 90f, _e706);
                    lineB = ((1f - _e701) * (1f - _e707));
                    let _e711 = lineA;
                    let _e712 = lineB;
                    let _e718 = q_18[9];
                    let _e719 = sstep(-0.2f, 0.2f, _e718);
                    line_1 = max(_e711, (_e712 * _e719));
                    let _e726 = warpX;
                    let _e728 = warpZ;
                    let _e731 = sstep(-0.25f, 0.25f, (_e726 + (0.3f * _e728)));
                    open_2 = _e731;
                    let _e733 = floe;
                    let _e735 = line_1;
                    let _e736 = open_2;
                    resolved_1 = (_e733 * (1f - (_e735 * _e736)));
                    let _e740 = quantile;
                    let _e741 = quantile;
                    let _e744 = field;
                    let _e745 = sstep(_e740, (_e741 + 0.06f), _e744);
                    inner = _e745;
                    let _e751 = q_18[10];
                    let _e757 = q_18[11];
                    let _e762 = inner;
                    let _e767 = line_1;
                    let _e770 = open_2;
                    localLight = clamp(((((0.86f + (0.05f * _e751)) + (0.025f * _e757)) - (0.06f * (1f - _e762))) - ((0.14f * _e767) * (1f - _e770))), 0.66f, 0.97f);
                    let _e777 = quantile;
                    let _e780 = aa_9;
                    let _e782 = quantile;
                    let _e785 = aa_9;
                    let _e787 = field;
                    let _e788 = sstep(((_e777 - 0.035f) - _e780), ((_e782 - 0.008f) + _e785), _e787);
                    let _e789 = floe;
                    localRim = (max((_e788 - _e789), 0f) * 0.25f);
                }
            } else {
                let _e795 = concentration_2;
                if (_e795 < 0.9f) {
                    {
                        let _e798 = point_24;
                        let _e799 = displacement;
                        warped_1 = (_e798 + (_e799 * 215f));
                        let _e804 = warped_1;
                        let _e806 = salt_44;
                        let _e809 = v2Cell(_e804, 2600f, (_e806 + 637u));
                        plate = _e809;
                        let _e811 = warped_1;
                        let _e813 = salt_44;
                        let _e816 = v2Cell(_e811, 470f, (_e813 + 638u));
                        shard = _e816;
                        loop {
                            let _e823 = k_33;
                            if !((_e823 < 2i)) {
                                break;
                            }
                            let _e830 = k_33;
                            let _e832 = point_24;
                            let _e833 = k_33;
                            if (_e833 == 0i) {
                                local_289 = 105f;
                            } else {
                                local_289 = 38f;
                            }
                            let _e839 = local_289;
                            let _e840 = fp_29;
                            let _e841 = salt_44;
                            let _e842 = k_33;
                            if (_e842 == 0i) {
                                local_290 = 639u;
                            } else {
                                local_290 = 643u;
                            }
                            let _e848 = local_290;
                            let _e850 = v2Pattern(_e832, _e839, _e840, (_e841 + _e848));
                            fine_12[_e830] = _e850;
                            continuing {
                                let _e827 = k_33;
                                k_33 = (_e827 + 1i);
                            }
                        }
                        let _e851 = plate;
                        let _e854 = fine_12;
                        edge_8 = (_e851.x + (0.012f * _e854.x));
                        let _e860 = fp_29;
                        aa_10 = max(0.0008f, ((_e860 / 2600f) * 0.75f));
                        let _e870 = concentration_2;
                        lead = (0.0025f + (0.02f * (1f - _e870)));
                        let _e875 = lead;
                        let _e876 = aa_10;
                        let _e878 = lead;
                        let _e879 = aa_10;
                        let _e881 = edge_8;
                        let _e882 = sstep((_e875 - _e876), (_e878 + _e879), _e881);
                        large = _e882;
                        let _e884 = plate;
                        let _e889 = v2IceWhole;
                        if (fract((_e884.z * 7.31f)) > _e889) {
                            local_291 = 1f;
                        } else {
                            local_291 = 0f;
                        }
                        let _e894 = local_291;
                        split_1 = _e894;
                        let _e899 = concentration_2;
                        smallLead = (0.007f + (0.09f * (1f - _e899)));
                        let _e905 = fp_29;
                        smallAA = max(0.002f, ((_e905 / 470f) * 0.8f));
                        let _e912 = smallLead;
                        let _e913 = smallAA;
                        let _e915 = smallLead;
                        let _e916 = smallAA;
                        let _e918 = shard;
                        let _e920 = sstep((_e912 - _e913), (_e915 + _e916), _e918.x);
                        shards = _e920;
                        let _e925 = fp_29;
                        let _e926 = sstep(45f, 135f, _e925);
                        smallKeep = (1f - _e926);
                        let _e929 = large;
                        let _e931 = split_1;
                        let _e933 = shards;
                        let _e936 = smallKeep;
                        subdivided = (_e929 * (1f - ((_e931 * (1f - _e933)) * _e936)));
                        let _e941 = plate;
                        let _e943 = shard;
                        let _e948 = split_1;
                        identity_1 = mix(_e941.z, fract((_e943.z * 3.17f)), (_e948 * 0.78f));
                        let _e953 = identity_1;
                        let _e955 = concentration_2;
                        if (_e953 >= (1f - _e955)) {
                            local_292 = 1f;
                        } else {
                            local_292 = 0f;
                        }
                        let _e961 = local_292;
                        selection = _e961;
                        let _e963 = subdivided;
                        let _e964 = selection;
                        resolved_1 = (_e963 * _e964);
                        let _e967 = lead;
                        let _e970 = aa_10;
                        let _e972 = lead;
                        let _e975 = aa_10;
                        let _e977 = edge_8;
                        let _e978 = sstep(((_e967 + 0.006f) + _e970), ((_e972 + 0.025f) + _e975), _e977);
                        let _e980 = large;
                        ridge_2 = ((1f - _e978) * _e980);
                        let _e985 = plate;
                        let _e990 = ridge_2;
                        let _e994 = plate;
                        let _e999 = fine_12;
                        localLight = clamp(((((0.84f + (0.08f * _e985.z)) + (0.07f * _e990)) - (0.065f * _e994.w)) + (0.02f * _e999.y)), 0.65f, 0.99f);
                        let _e1007 = lead;
                        let _e1010 = aa_10;
                        let _e1012 = lead;
                        let _e1015 = aa_10;
                        let _e1017 = edge_8;
                        let _e1018 = sstep(((_e1007 + 0.004f) + _e1010), ((_e1012 + 0.013f) + _e1015), _e1017);
                        let _e1020 = resolved_1;
                        localRim = (((1f - _e1018) * _e1020) * 0.3f);
                    }
                }
            }
            let _e1024 = concentration_2;
            if (_e1024 > 0.68f) {
                {
                    loop {
                        let _e1035 = k_34;
                        if !((_e1035 < 6i)) {
                            break;
                        }
                        {
                            let _e1042 = point_24;
                            let _e1043 = k_34;
                            if (_e1043 < 3i) {
                                local_293 = 240f;
                            } else {
                                local_293 = 70f;
                            }
                            let _e1049 = local_293;
                            let _e1050 = fp_29;
                            let _e1051 = salt_44;
                            let _e1052 = k_34;
                            if (_e1052 < 3i) {
                                let _e1056 = k_34;
                                local_294 = (639u + u32(_e1056));
                            } else {
                                let _e1060 = k_34;
                                local_294 = (666u + u32(_e1060));
                            }
                            let _e1064 = local_294;
                            let _e1066 = v2Pattern(_e1042, _e1049, _e1050, (_e1051 + _e1064));
                            v_18 = _e1066;
                            let _e1068 = k_34;
                            if (_e1068 < 3i) {
                                let _e1071 = k_34;
                                let _e1073 = v_18;
                                coarse_2[_e1071] = _e1073;
                            } else {
                                let _e1074 = k_34;
                                let _e1078 = v_18;
                                finer[(_e1074 - 3i)] = _e1078;
                            }
                        }
                        continuing {
                            let _e1039 = k_34;
                            k_34 = (_e1039 + 1i);
                        }
                    }
                    let _e1079 = coarse_2;
                    let _e1082 = finer;
                    jitter_7 = ((_e1079 * 40f) + (_e1082 * 7f));
                    loop {
                        let _e1092 = k_35;
                        if !((_e1092 < 2i)) {
                            break;
                        }
                        let _e1099 = k_35;
                        let _e1101 = point_24;
                        let _e1102 = k_35;
                        if (_e1102 == 0i) {
                            local_296 = 350f;
                        } else {
                            let _e1106 = kind_12;
                            if (_e1106 < 1.5f) {
                                local_295 = 90f;
                            } else {
                                local_295 = 110f;
                            }
                            let _e1112 = local_295;
                            local_296 = _e1112;
                        }
                        let _e1114 = local_296;
                        let _e1115 = fp_29;
                        let _e1116 = salt_44;
                        let _e1117 = k_35;
                        if (_e1117 == 0i) {
                            local_297 = 665u;
                        } else {
                            local_297 = 667u;
                        }
                        let _e1123 = local_297;
                        let _e1125 = v2Pattern(_e1101, _e1114, _e1115, (_e1116 + _e1123));
                        grain_4[_e1099] = _e1125;
                        continuing {
                            let _e1096 = k_35;
                            k_35 = (_e1096 + 1i);
                        }
                    }
                    let _e1126 = point_24;
                    let _e1127 = displacement;
                    let _e1131 = jitter_7;
                    let _e1134 = salt_44;
                    let _e1137 = kind_12;
                    let _e1140 = v2CellCore(((_e1126 + (_e1127 * 65f)) + _e1131), 1200f, (_e1134 + 637u), (_e1137 < 1.5f));
                    compact = _e1140;
                    let _e1142 = compact;
                    edge_9 = _e1142.x;
                    let _e1146 = fp_29;
                    aa_11 = max(0.001f, ((_e1146 / 1200f) * 0.8f));
                    let _e1156 = concentration_2;
                    let _e1165 = warpY;
                    let _e1166 = sstep(-0.6f, 0.6f, _e1165);
                    lead_1 = ((0.004f + (0.012f * (1f - _e1156))) * (0.72f + (0.44f * _e1166)));
                    let _e1171 = lead_1;
                    let _e1172 = aa_11;
                    let _e1174 = lead_1;
                    let _e1175 = aa_11;
                    let _e1177 = edge_9;
                    let _e1178 = sstep((_e1171 - _e1172), (_e1174 + _e1175), _e1177);
                    floe_1 = _e1178;
                    let _e1180 = kind_12;
                    if (_e1180 < 1.5f) {
                        {
                            let _e1186 = concentration_2;
                            let _e1195 = warpY;
                            let _e1196 = sstep(-0.6f, 0.6f, _e1195);
                            lead_1 = ((0.0015f + (0.004f * (1f - _e1186))) * (0.72f + (0.44f * _e1196)));
                            let _e1200 = fp_29;
                            pixelWidth = max((_e1200 / 1200f), 0.0001f);
                            let _e1206 = lead_1;
                            let _e1207 = pixelWidth;
                            let _e1211 = edge_9;
                            let _e1213 = pixelWidth;
                            let _e1218 = lead_1;
                            let _e1220 = pixelWidth;
                            let _e1224 = edge_9;
                            let _e1226 = pixelWidth;
                            gap_1 = (clamp((((_e1206 + (_e1207 * 0.5f)) - _e1211) / _e1213), 0f, 1f) - clamp((((-(_e1218) + (_e1220 * 0.5f)) - _e1224) / _e1226), 0f, 1f));
                            let _e1234 = gap_1;
                            floe_1 = (1f - _e1234);
                        }
                    }
                    let _e1239 = freeze;
                    let _e1244 = freeze;
                    let _e1247 = warpX;
                    let _e1249 = warpZ;
                    let _e1252 = sstep((-0.35f + (0.5f * _e1239)), (0.05f + (0.5f * _e1244)), (_e1247 + (0.28f * _e1249)));
                    opening = _e1252;
                    let _e1254 = opening;
                    let _e1255 = kind_12;
                    if (_e1255 < 1.5f) {
                        local_298 = 1f;
                    } else {
                        local_298 = 0.38f;
                    }
                    let _e1261 = local_298;
                    openLead = (_e1254 * _e1261);
                    let _e1266 = floe_1;
                    let _e1268 = openLead;
                    compactCover = (1f - ((1f - _e1266) * _e1268));
                    let _e1273 = lead_1;
                    let _e1276 = aa_11;
                    let _e1278 = lead_1;
                    let _e1281 = aa_11;
                    let _e1283 = edge_9;
                    let _e1284 = sstep(((_e1273 + 0.009f) + _e1276), ((_e1278 + 0.035f) + _e1281), _e1283);
                    let _e1286 = floe_1;
                    ridge_3 = ((1f - _e1284) * _e1286);
                    let _e1291 = concentration_2;
                    let _e1292 = sstep(0.68f, 0.9f, _e1291);
                    dense = _e1292;
                    let _e1294 = resolved_1;
                    let _e1295 = compactCover;
                    let _e1296 = dense;
                    resolved_1 = mix(_e1294, _e1295, _e1296);
                    let _e1299 = floe_1;
                    let _e1302 = openLead;
                    youngIce = ((1f - _e1299) * (1f - _e1302));
                    let _e1310 = kind_12;
                    if (_e1310 < 1.5f) {
                        {
                            let _e1314 = grain_4;
                            let _e1318 = grain_4;
                            snowGrain = ((0.005f * _e1314.x) + (0.014f * _e1318.y));
                            let _e1324 = lead_1;
                            let _e1329 = fp_29;
                            ridgeKeep_1 = min(1f, (((_e1324 + 0.01f) * 1200f) / max(_e1329, 1f)));
                            let _e1336 = lead_1;
                            let _e1337 = aa_11;
                            let _e1339 = lead_1;
                            let _e1342 = aa_11;
                            let _e1344 = edge_9;
                            let _e1345 = sstep((_e1336 + _e1337), ((_e1339 + 0.01f) + _e1342), _e1344);
                            let _e1347 = floe_1;
                            let _e1349 = ridgeKeep_1;
                            pressure = (((1f - _e1345) * _e1347) * _e1349);
                            let _e1354 = compact;
                            let _e1361 = compact;
                            let _e1366 = pressure;
                            let _e1368 = compact;
                            let _e1379 = snowGrain;
                            let _e1382 = youngIce;
                            compactLight = clamp((((((0.88f + (0.002f * (_e1354.z - 0.5f))) - (0.002f * _e1361.w)) + ((0.028f * _e1366) * clamp((-(_e1368.w) * 2f), -1f, 1f))) + _e1379) - (0.035f * _e1382)), 0.8f, 0.93f);
                            let _e1389 = lead_1;
                            let _e1392 = aa_11;
                            let _e1394 = lead_1;
                            let _e1397 = aa_11;
                            let _e1399 = edge_9;
                            let _e1400 = sstep(((_e1389 + 0.002f) + _e1392), ((_e1394 + 0.008f) + _e1397), _e1399);
                            let _e1402 = floe_1;
                            let _e1404 = openLead;
                            let _e1408 = ridgeKeep_1;
                            compactRim = (((((1f - _e1400) * _e1402) * _e1404) * 0.06f) * _e1408);
                        }
                    } else {
                        {
                            let _e1411 = grain_4;
                            let _e1415 = grain_4;
                            snowGrain_1 = ((0.012f * _e1411.x) + (0.006f * _e1415.y));
                            let _e1422 = compact;
                            let _e1429 = ridge_3;
                            let _e1433 = compact;
                            let _e1437 = snowGrain_1;
                            let _e1440 = youngIce;
                            compactLight = clamp((((((0.88f + (0.008f * (_e1422.z - 0.5f))) + (0.01f * _e1429)) - (0.006f * _e1433.w)) + _e1437) - (0.12f * _e1440)), 0.74f, 0.92f);
                            let _e1447 = lead_1;
                            let _e1450 = aa_11;
                            let _e1452 = lead_1;
                            let _e1455 = aa_11;
                            let _e1457 = edge_9;
                            let _e1458 = sstep(((_e1447 + 0.006f) + _e1450), ((_e1452 + 0.024f) + _e1455), _e1457);
                            let _e1460 = floe_1;
                            let _e1462 = openLead;
                            compactRim = ((((1f - _e1458) * _e1460) * _e1462) * 0.25f);
                        }
                    }
                    let _e1466 = localLight;
                    let _e1467 = compactLight;
                    let _e1468 = dense;
                    localLight = mix(_e1466, _e1467, _e1468);
                    let _e1470 = localRim;
                    let _e1471 = compactRim;
                    let _e1472 = dense;
                    localRim = mix(_e1470, _e1471, _e1472);
                }
            }
            let _e1474 = pack;
            let _e1475 = resolved_1;
            let _e1476 = packKeep;
            pack = mix(_e1474, _e1475, _e1476);
            let _e1479 = localLight;
            let _e1480 = packKeep;
            brightness = mix(0.88f, _e1479, _e1480);
            let _e1482 = localRim;
            let _e1483 = packKeep;
            rim_3 = (_e1482 * _e1483);
        }
    }
    let _e1485 = e_19;
    let _e1491 = depth_3;
    let _e1492 = sstep(1800f, 30f, _e1491);
    let _e1496 = kind_12;
    if (_e1496 < 1.5f) {
        local_299 = 1f;
    } else {
        local_299 = 0f;
    }
    let _e1502 = local_299;
    source = ((_e1485.glacier * (0.3f + (0.7f * _e1492))) * _e1502);
    let _e1511 = source;
    if (_e1511 > 0.001f) {
        {
            let _e1516 = point_24;
            let _e1518 = fp_29;
            let _e1519 = salt_44;
            let _e1522 = v2Pattern(_e1516, 2800f, _e1518, (_e1519 + 647u));
            grouping = clamp((0.65f + (0.23f * _e1522)), 0.15f, 1f);
            let _e1529 = source;
            let _e1530 = grouping;
            density_3 = (_e1529 * _e1530);
            let _e1534 = density_3;
            let _e1537 = pack;
            meanBerg = ((0.04f * _e1534) * (1f - (_e1537 * 0.65f)));
            let _e1543 = meanBerg;
            berg = _e1543;
            let _e1544 = fp_29;
            if (_e1544 < 290f) {
                {
                    let _e1547 = point_24;
                    let _e1549 = fp_29;
                    let _e1550 = salt_44;
                    let _e1553 = v2Pattern(_e1547, 380f, _e1549, (_e1550 + 651u));
                    bend_1 = _e1553;
                    let _e1555 = point_24;
                    let _e1556 = bend_1;
                    let _e1559 = bend_1;
                    let _e1562 = bend_1;
                    let _e1569 = salt_44;
                    let _e1572 = v2Cell((_e1555 + vec3<f32>((_e1556 * 70f), (_e1559 * 35f), (-(_e1562) * 55f))), 850f, (_e1569 + 653u));
                    piece = _e1572;
                    let _e1576 = density_3;
                    let _e1581 = density_3;
                    let _e1584 = piece;
                    let _e1586 = sstep((0.94f - (0.42f * _e1576)), (0.99f - (0.42f * _e1581)), _e1584.z);
                    let _e1589 = source;
                    let _e1590 = sstep(0.001f, 0.04f, _e1589);
                    selected = (_e1586 * _e1590);
                    let _e1594 = point_24;
                    let _e1596 = fp_29;
                    let _e1597 = salt_44;
                    let _e1600 = v2Pattern(_e1594, 68f, _e1596, (_e1597 + 659u));
                    let _e1603 = point_24;
                    let _e1605 = fp_29;
                    let _e1606 = salt_44;
                    let _e1609 = v2Pattern(_e1603, 29f, _e1605, (_e1606 + 661u));
                    lobe_2 = ((0.022f * _e1600) + (0.009f * _e1609));
                    let _e1615 = piece;
                    cut = (0.065f + (0.28f * fract((_e1615.z * 13.17f))));
                    let _e1623 = piece;
                    let _e1625 = cut;
                    let _e1627 = lobe_2;
                    field_1 = ((_e1623.x - _e1625) + _e1627);
                    let _e1631 = fp_29;
                    aa_12 = max(0.0015f, ((_e1631 / 850f) * 0.8f));
                    let _e1638 = aa_12;
                    let _e1640 = aa_12;
                    let _e1641 = field_1;
                    let _e1642 = sstep(-(_e1638), _e1640, _e1641);
                    cap_5 = _e1642;
                    let _e1646 = aa_12;
                    let _e1650 = aa_12;
                    let _e1652 = field_1;
                    let _e1653 = sstep((-0.035f - _e1646), (-0.012f + _e1650), _e1652);
                    submerged = _e1653;
                    let _e1655 = aa_12;
                    let _e1657 = aa_12;
                    let _e1658 = field_1;
                    let _e1660 = piece;
                    let _e1666 = sstep(-(_e1655), _e1657, ((_e1658 + (0.12f * _e1660.w)) - 0.006f));
                    let _e1668 = cap_5;
                    castShade = (_e1666 * (1f - _e1668));
                    let _e1675 = fp_29;
                    let _e1676 = sstep(115f, 290f, _e1675);
                    keep_9 = (1f - _e1676);
                    let _e1679 = meanBerg;
                    let _e1680 = cap_5;
                    let _e1681 = selected;
                    let _e1684 = pack;
                    let _e1689 = keep_9;
                    berg = mix(_e1679, ((_e1680 * _e1681) * (1f - (_e1684 * 0.65f))), _e1689);
                    let _e1691 = castShade;
                    let _e1692 = selected;
                    let _e1696 = keep_9;
                    let _e1699 = pack;
                    shadow_1 = ((((_e1691 * _e1692) * 0.42f) * _e1696) * (1f - _e1699));
                    let _e1703 = submerged;
                    let _e1704 = cap_5;
                    let _e1707 = selected;
                    let _e1711 = keep_9;
                    bergRim = (((max(0f, (_e1703 - _e1704)) * _e1707) * 0.75f) * _e1711);
                    let _e1715 = field_1;
                    let _e1716 = sstep(0.006f, 0.065f, _e1715);
                    plateau = _e1716;
                    let _e1721 = plateau;
                    let _e1725 = piece;
                    let _e1730 = point_24;
                    let _e1732 = fp_29;
                    let _e1733 = salt_44;
                    let _e1736 = v2Pattern(_e1730, 75f, _e1732, (_e1733 + 663u));
                    let _e1742 = keep_9;
                    bergLight = mix(0.95f, clamp((((0.68f + (0.29f * _e1721)) + (0.26f * _e1725.w)) + (0.035f * _e1736)), 0.48f, 1f), _e1742);
                }
            }
        }
    }
    let _e1744 = pack;
    let _e1746 = pack;
    let _e1748 = berg;
    coverage_2 = (_e1744 + ((1f - _e1746) * _e1748));
    let _e1752 = brightness;
    let _e1753 = bergLight;
    let _e1754 = berg;
    let _e1756 = coverage_2;
    brightness = mix(_e1752, _e1753, (_e1754 / max(0.001f, _e1756)));
    let _e1760 = coverage_2;
    let _e1761 = brightness;
    let _e1762 = rim_3;
    let _e1763 = bergRim;
    let _e1765 = shadow_1;
    return vec4<f32>(_e1760, _e1761, max(_e1762, _e1763), _e1765);
}

fn v2Water(depth_4: f32, kind_13: f32, cover_15: f32, e_20: V2Env, point_25: vec3<f32>, fp_30: f32, salt_45: u32) -> vec3<f32> {
    var depth_5: f32;
    var kind_14: f32;
    var cover_16: f32;
    var e_21: V2Env;
    var point_26: vec3<f32>;
    var fp_31: f32;
    var salt_46: u32;
    var sediment_1: f32;
    var bed_1: vec3<f32>;
    var shallow: vec3<f32>;
    var deep: vec3<f32> = vec3<f32>(0.025f, 0.12f, 0.21f);
    var local_300: f32;
    var attenuation_1: f32;
    var water_2: vec3<f32>;
    var frozen: vec4<f32>;
    var ice_4: vec3<f32>;

    depth_5 = depth_4;
    kind_14 = kind_13;
    cover_16 = cover_15;
    e_21 = e_20;
    point_26 = point_25;
    fp_31 = fp_30;
    salt_46 = salt_45;
    let _e314 = e_21;
    let _e316 = sstep(0.1f, 0.9f, _e314.sand);
    let _e319 = e_21;
    let _e321 = sstep(0.1f, 1f, _e319.moisture);
    sediment_1 = (_e316 * _e321);
    let _e324 = e_21;
    let _e325 = v2Mineral(_e324);
    let _e332 = sediment_1;
    bed_1 = mix((_e325 * 0.65f), vec3<f32>(0.2f, 0.33f, 0.24f), vec3(_e332));
    let _e336 = bed_1;
    shallow = mix(_e336, vec3<f32>(0.12f, 0.31f, 0.32f), vec3(0.6f));
    let _e350 = kind_14;
    if (_e350 < 1.5f) {
        {
            let _e363 = depth_5;
            let _e364 = sstep(150f, 3000f, _e363);
            deep = mix(vec3<f32>(0.045f, 0.16f, 0.27f), vec3<f32>(0.018f, 0.065f, 0.15f), vec3(_e364));
        }
    }
    let _e367 = kind_14;
    if (_e367 < 1.5f) {
        local_300 = 0.035f;
    } else {
        local_300 = 0.15f;
    }
    let _e373 = local_300;
    attenuation_1 = _e373;
    let _e375 = shallow;
    let _e376 = deep;
    let _e378 = depth_5;
    let _e382 = attenuation_1;
    let _e385 = cover_16;
    let _e386 = cover_16;
    water_2 = mix(_e375, _e376, vec3((1f - exp(((-(max(_e378, 0f)) * _e382) * max(0.08f, (_e385 * _e386)))))));
    let _e395 = depth_5;
    let _e396 = kind_14;
    let _e397 = e_21;
    let _e398 = point_26;
    let _e399 = fp_31;
    let _e400 = salt_46;
    let _e401 = v2Ice(_e395, _e396, _e397, _e398, _e399, _e400);
    frozen = _e401;
    let _e403 = water_2;
    let _e408 = frozen;
    let _e415 = frozen;
    water_2 = (mix(_e403, vec3<f32>(0.12f, 0.44f, 0.48f), vec3((_e408.z * 0.6f))) * (1f - _e415.w));
    let _e427 = frozen;
    ice_4 = mix(vec3<f32>(0.38f, 0.6f, 0.66f), vec3<f32>(0.98f, 0.99f, 0.97f), vec3(_e427.y));
    let _e432 = water_2;
    let _e433 = ice_4;
    let _e434 = frozen;
    return mix(_e432, _e433, vec3(_e434.x));
}

fn v2CrownResponse(light_11: vec3<f32>, needle_18: f32) -> vec2<f32> {
    var light_12: vec3<f32>;
    var needle_19: f32;
    var level_8: f32;
    var i_12: i32;
    var t_32: f32;
    var local_301: array<vec4<f32>, 19> = V2_CROWN_RESPONSE;
    var local_302: array<vec4<f32>, 19> = V2_CROWN_RESPONSE;
    var q_19: vec4<f32>;

    light_12 = light_11;
    needle_19 = needle_18;
    let _e304 = light_12;
    level_8 = (asin(clamp(normalize(_e304).y, 0f, 1f)) * 11.459156f);
    let _e314 = level_8;
    i_12 = min(i32(floor(_e314)), 17i);
    let _e320 = level_8;
    let _e321 = i_12;
    t_32 = clamp((_e320 - f32(_e321)), 0f, 1f);
    let _e328 = i_12;
    let _e332 = local_301[_e328];
    let _e333 = i_12;
    let _e339 = local_302[(_e333 + 1i)];
    let _e340 = t_32;
    q_19 = mix(_e332, _e339, vec4(_e340));
    let _e344 = q_19;
    let _e346 = q_19;
    let _e348 = needle_19;
    return mix(_e344.xy, _e346.zw, vec2(_e348));
}

fn v2CanopyMeanRatio(rgb_2: vec3<f32>, needle_20: f32, light_13: vec3<f32>, light2_2: vec3<f32>, strength_2: f32) -> vec3<f32> {
    var rgb_3: vec3<f32>;
    var needle_21: f32;
    var light_14: vec3<f32>;
    var light2_3: vec3<f32>;
    var strength_3: f32;
    var amount_6: f32;
    var albedo_1: vec3<f32>;
    var response: vec2<f32>;
    var ambient_1: f32;
    var mean_3: vec3<f32>;
    var referenceMaterial: GroundMaterial;
    var base_5: vec3<f32>;

    rgb_3 = rgb_2;
    needle_21 = needle_20;
    light_14 = light_13;
    light2_3 = light2_2;
    strength_3 = strength_2;
    let _e310 = strength_3;
    amount_6 = clamp(_e310, 0f, 1f);
    let _e315 = rgb_3;
    let _e316 = groundToLinear(_e315);
    albedo_1 = _e316;
    let _e319 = light_14;
    let _e320 = needle_21;
    let _e321 = v2CrownResponse(_e319, _e320);
    let _e324 = light2_3;
    let _e325 = needle_21;
    let _e326 = v2CrownResponse(_e324, _e325);
    response = ((2.2f * _e321) + (0.58f * _e326));
    let _e336 = needle_21;
    ambient_1 = mix(0.3766294f, 0.34189487f, _e336);
    let _e339 = albedo_1;
    let _e341 = amount_6;
    let _e343 = amount_6;
    let _e344 = ambient_1;
    let _e348 = strength_3;
    let _e351 = albedo_1;
    let _e352 = response;
    let _e355 = response;
    mean_3 = ((_e339 * ((1f - _e341) + (_e343 * _e344))) + (max(_e348, 0f) * ((_e351 * _e352.x) + vec3(_e355.y))));
    let _e364 = albedo_1;
    referenceMaterial.albedo = _e364;
    referenceMaterial.normal = vec3<f32>(0f, 1f, 0f);
    referenceMaterial.roughness = 0.9f;
    referenceMaterial.occlusion = 1f;
    let _e374 = referenceMaterial;
    let _e379 = light_14;
    let _e380 = light2_3;
    let _e381 = strength_3;
    let _e382 = shadeTerrainGround(_e374, vec3<f32>(0f, 1f, 0f), _e379, _e380, _e381);
    base_5 = _e382;
    let _e384 = mean_3;
    let _e393 = base_5;
    return (pow(max(_e384, vec3(0f)), vec3(0.45454544f)) / max(_e393, vec3(0.0001f)));
}

fn v2ReliefSet(baked: vec2<f32>, slope_15: vec2<f32>) {
    var baked_1: vec2<f32>;
    var slope_16: vec2<f32>;

    baked_1 = baked;
    slope_16 = slope_15;
    let _e306 = baked_1;
    let _e307 = slope_16;
    v2Relief = vec4<f32>(_e306.x, _e306.y, _e307.x, _e307.y);
    v2ReliefLive = 1f;
    return;
}

fn v2ReliefSun(light_15: vec3<f32>) -> f32 {
    var light_16: vec3<f32>;
    var sun_9: f32;
    var width_4: f32;

    light_16 = light_15;
    let _e304 = light_16;
    let _e306 = light_16;
    sun_9 = (_e304.y / max(length(_e306.xz), 0.001f));
    let _e314 = sun_9;
    width_4 = max(min(0.3f, _e314), 0.001f);
    let _e321 = width_4;
    let _e324 = width_4;
    let _e326 = sun_9;
    let _e327 = v2Relief;
    let _e330 = sstep((-0.3f * _e321), (0.7f * _e324), (_e326 - _e327.y));
    return _e330;
}

fn v2ReliefForm(light_17: vec3<f32>, cover_17: f32, sun_10: f32) -> f32 {
    var light_18: vec3<f32>;
    var cover_18: f32;
    var sun_11: f32;
    var g_20: vec2<f32>;
    var up: f32;
    var reach_8: f32;
    var d_25: f32;
    var local_303: f32;

    light_18 = light_17;
    cover_18 = cover_17;
    sun_11 = sun_10;
    let _e308 = v2Relief;
    g_20 = (_e308.zw * 2f);
    let _e313 = light_18;
    up = min(_e313.y, 0.643f);
    let _e319 = up;
    let _e320 = up;
    let _e324 = light_18;
    reach_8 = (sqrt((1f - (_e319 * _e320))) / max(length(_e324.xz), 0.001f));
    let _e331 = up;
    let _e332 = g_20;
    let _e333 = light_18;
    let _e336 = reach_8;
    let _e339 = g_20;
    let _e340 = g_20;
    let _e346 = up;
    d_25 = (((_e331 - (dot(_e332, _e333.xz) * _e336)) * inverseSqrt((dot(_e339, _e340) + 1f))) - _e346);
    let _e349 = d_25;
    if (_e349 > 0f) {
        let _e352 = d_25;
        let _e353 = sun_11;
        local_303 = (_e352 * _e353);
    } else {
        let _e355 = d_25;
        local_303 = (_e355 * 0.8f);
    }
    let _e359 = local_303;
    d_25 = _e359;
    let _e363 = cover_18;
    let _e365 = d_25;
    return clamp((1f + (mix(0.35f, 0.6f, _e363) * _e365)), 0.72f, 1.3f);
}

fn v2ReliefShade(light_19: vec3<f32>, cover_19: f32) -> vec3<f32> {
    var light_20: vec3<f32>;
    var cover_20: f32;
    var sun_12: f32;
    var shade_4: vec3<f32>;
    var local_304: vec3<f32>;

    light_20 = light_19;
    cover_20 = cover_19;
    let _e306 = light_20;
    let _e307 = v2ReliefSun(_e306);
    sun_12 = _e307;
    let _e311 = v2Relief;
    let _e317 = sun_12;
    let _e319 = light_20;
    let _e320 = cover_20;
    let _e321 = sun_12;
    let _e322 = v2ReliefForm(_e319, _e320, _e321);
    let _e325 = v2Relief;
    shade_4 = vec3<f32>((1f - (0.6f * _e311.x)), mix(0.14f, 1f, _e317), (_e322 * (1f - (0.12f * _e325.x))));
    let _e332 = v2ReliefLive;
    if (_e332 > 0.5f) {
        let _e335 = shade_4;
        local_304 = _e335;
    } else {
        local_304 = vec3(1f);
    }
    let _e339 = local_304;
    return _e339;
}

fn v2WinterClimate(altitude: f32, perennial_1: f32) -> f32 {
    var altitude_1: f32;
    var perennial_2: f32;
    var annual_1: f32;
    var amplitude: f32;
    var year: vec3<f32> = vec3(0f);
    var thaw: f32 = 0f;
    var warmest_2: f32;
    var coldest: f32;
    var phase_6: f32;
    var supply_2: f32;
    var seasonal_1: f32;

    altitude_1 = altitude;
    perennial_2 = perennial_1;
    let _e309 = global.uMaterialClimate;
    let _e312 = altitude_1;
    annual_1 = (_e309.x - (0.0065f * max(_e312, 0f)));
    let _e322 = global.uMaterialClimate;
    amplitude = (6f + (0.5f * max(0f, (10f - _e322.x))));
    let _e334 = v2Zoned();
    if _e334 {
        {
            let _e335 = v2SeasonClimate();
            year = _e335;
            let _e336 = v2SeasonThaw();
            thaw = _e336;
        }
    }
    let _e337 = annual_1;
    let _e338 = amplitude;
    warmest_2 = (_e337 + _e338);
    let _e341 = annual_1;
    let _e342 = amplitude;
    let _e344 = year;
    coldest = ((_e341 - _e342) - _e344.y);
    let _e351 = global.uV2Season;
    phase_6 = (0.5f - (0.5f * cos((6.2831855f * fract(((_e351 + 1f) - V2_SEASON_LAG))))));
    let _e361 = global.uMaterialClimate;
    let _e365 = warmest_2;
    let _e366 = coldest;
    supply_2 = clamp((_e361.y / max(120f, ((10f * (_e365 + _e366)) + 280f))), 0f, 5f);
    let _e377 = coldest;
    let _e378 = warmest_2;
    let _e379 = phase_6;
    let _e381 = thaw;
    let _e383 = supply_2;
    let _e386 = v2Snow((mix(_e377, _e378, _e379) + _e381), _e383, 0f, 0f);
    let _e389 = perennial_2;
    let _e393 = phase_6;
    let _e394 = sstep(0.5f, 0.8f, _e393);
    seasonal_1 = (_e386 * (1f - ((1f - _e389) * _e394)));
    let _e399 = seasonal_1;
    let _e400 = perennial_2;
    let _e401 = warmest_2;
    let _e402 = supply_2;
    let _e404 = v2PerennialSnow(_e401, _e402, 0f);
    return max(_e399, (_e400 * _e404));
}

fn v2WinterCover(snow_6: f32) -> f32 {
    var snow_7: f32;

    snow_7 = snow_6;
    let _e309 = snow_7;
    let _e310 = sstep(0.325f, 0.575f, _e309);
    return _e310;
}

fn v2WinterFreeze(snow_8: f32) -> f32 {
    var snow_9: f32;

    snow_9 = snow_8;
    let _e309 = snow_9;
    let _e310 = sstep(0.52f, 0.8f, _e309);
    return _e310;
}

fn v2WinterShelf(freeze_1: f32) -> f32 {
    var freeze_2: f32;

    freeze_2 = freeze_1;
    let _e309 = freeze_2;
    let _e311 = freeze_2;
    let _e317 = freeze_2;
    let _e318 = sstep(0.85f, 1f, _e317);
    return ((2f + ((90f * _e309) * _e311)) + (600f * _e318));
}

fn v2WinterSeaIce(potential_4: f32) -> vec2<f32> {
    var potential_5: f32;
    var coast: f32;
    var drift: f32;

    potential_5 = potential_4;
    let _e309 = v2WinterClimate(0f, 1f);
    let _e310 = v2WinterCover(_e309);
    coast = _e310;
    let _e313 = potential_5;
    let _e317 = potential_5;
    let _e318 = sstep(0.5f, 0.8f, _e317);
    drift = ((0.5f * _e313) * _e318);
    let _e321 = drift;
    let _e322 = potential_5;
    let _e323 = coast;
    let _e326 = coast;
    return vec2<f32>(mix(_e321, _e322, _e323), (1f - _e326));
}

fn v2WinterPackLimit(concentration_3: f32) -> f32 {
    var concentration_4: f32;

    concentration_4 = concentration_3;
    let _e311 = concentration_4;
    let _e312 = sstep(0.74f, 0.81f, _e311);
    return mix(2f, 0.3f, _e312);
}

fn v2FreshIce(world_79: vec2<f32>, fp_32: f32, freeze_3: f32, channel_3: f32, still: f32, shore_13: f32, edge_10: f32) -> vec4<f32> {
    var world_80: vec2<f32>;
    var fp_33: f32;
    var freeze_4: f32;
    var channel_4: f32;
    var still_1: f32;
    var shore_14: f32;
    var edge_11: f32;
    var closed: f32;
    var river: f32;
    var lake: f32;
    var tone_3: f32 = 0f;
    var ice_5: vec3<f32>;

    world_80 = world_79;
    fp_33 = fp_32;
    freeze_4 = freeze_3;
    channel_4 = channel_3;
    still_1 = still;
    shore_14 = shore_13;
    edge_11 = edge_10;
    let _e320 = freeze_4;
    closed = step(0.97f, _e320);
    let _e323 = closed;
    let _e325 = channel_4;
    let _e329 = freeze_4;
    let _e330 = sstep(0f, 0.08f, _e329);
    river = max(_e323, ((1f - _e325) * _e330));
    let _e334 = closed;
    let _e338 = freeze_4;
    let _e340 = shore_14;
    let _e343 = sstep(-0.05f, 0.05f, (_e338 - (0.92f * _e340)));
    lake = max(_e334, _e343);
    let _e348 = global.uQuality;
    if (_e348 == 0i) {
        let _e351 = world_80;
        let _e357 = fp_33;
        let _e358 = global.uMaterialSeed;
        let _e361 = v2Pattern(vec3<f32>(_e351.x, _e351.y, 0f), 150f, _e357, (_e358 + 771u));
        tone_3 = _e361;
    }
    let _e372 = tone_3;
    let _e376 = freeze_4;
    ice_5 = mix(vec3<f32>(0.62f, 0.71f, 0.78f), vec3<f32>(0.83f, 0.87f, 0.9f), vec3(clamp(((0.35f + (0.18f * _e372)) + (0.45f * _e376)), 0f, 1f)));
    let _e385 = ice_5;
    let _e391 = edge_11;
    let _e394 = closed;
    let _e395 = still_1;
    ice_5 = mix(_e385, vec3<f32>(0.36f, 0.46f, 0.55f), vec3(((0.85f * _e391) * mix(1f, _e394, _e395))));
    let _e400 = ice_5;
    let _e401 = river;
    let _e402 = lake;
    let _e403 = still_1;
    return vec4<f32>(_e400.x, _e400.y, _e400.z, mix(_e401, _e402, _e403));
}

fn v2GroundQuantile(share_4: f32) -> f32 {
    var share_5: f32;
    var p_46: f32;

    share_5 = share_4;
    let _e310 = share_5;
    p_46 = clamp(_e310, 0.001f, 0.999f);
    let _e317 = p_46;
    let _e319 = p_46;
    return (0.5f * log(((1f - _e317) / _e319)));
}

fn v2GroundUnits(U: vec4<f32>, wash: f32, s_27: vec3<f32>, world_81: vec2<f32>, tpi_12: f32, fp_34: f32, mottle_2: f32, mosaic_2: f32, open_3: f32) {
    var U_1: vec4<f32>;
    var wash_1: f32;
    var s_28: vec3<f32>;
    var world_82: vec2<f32>;
    var tpi_13: f32;
    var fp_35: f32;
    var mottle_3: f32;
    var mosaic_3: f32;
    var open_4: f32;
    var slope_17: f32;
    var rel_2: f32;
    var free: f32;
    var cls_9: i32;
    var edge_12: f32 = 0f;
    var k_36: i32 = 0i;
    var local_305: f32;
    var local_306: f32;
    var local_307: f32;
    var w_19: f32;
    var gentle: f32;
    var pan: f32 = 0f;
    var rim_4: f32 = 0f;
    var sand_7: f32 = 0f;
    var pave: f32 = 0f;
    var gravel: f32 = 0f;
    var f_17: f32;
    var q_20: f32;
    var floored: f32;
    var soft: f32;
    var q_21: f32;
    var q_22: f32;
    var q_23: f32;
    var fan: f32;

    U_1 = U;
    wash_1 = wash;
    s_28 = s_27;
    world_82 = world_81;
    tpi_13 = tpi_12;
    fp_35 = fp_34;
    mottle_3 = mottle_2;
    mosaic_3 = mosaic_2;
    open_4 = open_3;
    let _e326 = s_28;
    slope_17 = length(_e326.yz);
    let _e330 = tpi_13;
    rel_2 = clamp((_e330 * 40f), -1f, 1f);
    v2GroundUnit = vec4(0f);
    let _e342 = rel_2;
    let _e343 = mottle_3;
    v2GroundSite = vec4<f32>(0f, 0f, _e342, _e343);
    let _e345 = open_4;
    let _e348 = U_1;
    let _e350 = U_1;
    let _e353 = U_1;
    let _e356 = U_1;
    if ((_e345 > 0.003f) && ((((_e348.x + _e350.y) + _e353.z) + _e356.w) > 0f)) {
        {
            let _e362 = open_4;
            free = _e362;
            let _e364 = global.uHasOccupation;
            if (_e364 == 1i) {
                {
                    let _e367 = world_82;
                    let _e368 = groundOccupation(_e367);
                    cls_9 = i32(_e368.z);
                    let _e372 = cls_9;
                    let _e375 = cls_9;
                    let _e379 = cls_9;
                    let _e383 = cls_9;
                    let _e387 = cls_9;
                    let _e391 = cls_9;
                    if ((((((_e372 == 1i) || (_e375 == 4i)) || (_e379 == 5i)) || (_e383 == 7i)) || (_e387 == 8i)) || (_e391 == 9i)) {
                        free = 0f;
                    }
                }
            }
            let _e398 = global.uQuality;
            if (_e398 == 0i) {
                {
                    loop {
                        let _e403 = k_36;
                        if !((_e403 < 2i)) {
                            break;
                        }
                        {
                            let _e410 = fp_35;
                            let _e411 = k_36;
                            if (_e411 == 0i) {
                                local_305 = 63f;
                            } else {
                                local_305 = 14.4f;
                            }
                            let _e417 = local_305;
                            if (_e410 < _e417) {
                                let _e419 = edge_12;
                                let _e420 = k_36;
                                if (_e420 == 0i) {
                                    local_306 = 0.42f;
                                } else {
                                    local_306 = 0.2f;
                                }
                                let _e426 = local_306;
                                let _e427 = world_82;
                                let _e432 = k_36;
                                if (_e432 == 0i) {
                                    local_307 = 210f;
                                } else {
                                    local_307 = 48f;
                                }
                                let _e438 = local_307;
                                let _e439 = fp_35;
                                let _e440 = global.uMaterialSeed;
                                let _e443 = k_36;
                                let _e446 = v2Pattern(vec3<f32>(_e427.x, _e427.y, 0f), _e438, _e439, ((_e440 + 771u) + u32(_e443)));
                                edge_12 = (_e419 + (_e426 * _e446));
                            }
                        }
                        continuing {
                            let _e407 = k_36;
                            k_36 = (_e407 + 1i);
                        }
                    }
                }
            }
            let _e450 = fp_35;
            w_19 = clamp((0.006f * _e450), 0.035f, 0.6f);
            let _e459 = slope_17;
            let _e460 = sstep(0.1f, 0.28f, _e459);
            gentle = (1f - _e460);
            let _e473 = U_1;
            if (_e473.w > 0f) {
                {
                    let _e479 = mosaic_3;
                    let _e480 = mottle_3;
                    let _e484 = rel_2;
                    let _e488 = edge_12;
                    f_17 = (((-0.6f * (_e479 + _e480)) - (1.4f * _e484)) + (0.5f * _e488));
                    let _e492 = U_1;
                    let _e494 = v2GroundQuantile(_e492.w);
                    q_20 = _e494;
                    let _e499 = slope_17;
                    let _e500 = sstep(0.012f, 0.04f, _e499);
                    floored = (1f - _e500);
                    let _e503 = q_20;
                    let _e504 = w_19;
                    let _e506 = q_20;
                    let _e507 = w_19;
                    let _e509 = f_17;
                    let _e510 = sstep((_e503 - _e504), (_e506 + _e507), _e509);
                    let _e511 = floored;
                    pan = (_e510 * _e511);
                    let _e513 = q_20;
                    let _e516 = w_19;
                    let _e518 = q_20;
                    let _e521 = f_17;
                    let _e522 = sstep(((_e513 - 0.3f) - _e516), (_e518 - 0.1f), _e521);
                    let _e523 = floored;
                    let _e526 = pan;
                    rim_4 = ((_e522 * _e523) * (1f - _e526));
                }
            }
            let _e529 = w_19;
            soft = max(_e529, 0.3f);
            let _e533 = U_1;
            if (_e533.x > 0f) {
                {
                    let _e537 = U_1;
                    let _e539 = v2GroundQuantile(_e537.x);
                    q_21 = _e539;
                    let _e541 = q_21;
                    let _e542 = soft;
                    let _e544 = q_21;
                    let _e545 = soft;
                    let _e548 = mosaic_3;
                    let _e551 = rel_2;
                    let _e555 = edge_12;
                    let _e558 = sstep((_e541 - _e542), (_e544 + _e545), (((0.95f * _e548) - (0.8f * _e551)) + (0.3f * _e555)));
                    let _e562 = slope_17;
                    let _e563 = sstep(0.06f, 0.18f, _e562);
                    let _e567 = pan;
                    sand_7 = ((_e558 * (1f - _e563)) * (1f - _e567));
                }
            }
            let _e570 = U_1;
            if (_e570.z > 0f) {
                {
                    let _e574 = U_1;
                    let _e576 = v2GroundQuantile(_e574.z);
                    q_22 = _e576;
                    let _e578 = q_22;
                    let _e579 = w_19;
                    let _e581 = q_22;
                    let _e582 = w_19;
                    let _e585 = mosaic_3;
                    let _e588 = rel_2;
                    let _e591 = edge_12;
                    let _e593 = sstep((_e578 - _e579), (_e581 + _e582), (((0.6f * _e585) + (1.4f * _e588)) + _e591));
                    let _e594 = gentle;
                    let _e597 = pan;
                    let _e601 = sand_7;
                    pave = (((_e593 * _e594) * (1f - _e597)) * (1f - _e601));
                }
            }
            let _e604 = U_1;
            if (_e604.y > 0f) {
                {
                    let _e608 = U_1;
                    let _e610 = v2GroundQuantile(_e608.y);
                    q_23 = _e610;
                    let _e612 = q_23;
                    let _e613 = soft;
                    let _e615 = q_23;
                    let _e616 = soft;
                    let _e620 = mosaic_3;
                    let _e623 = rel_2;
                    let _e627 = edge_12;
                    let _e630 = sstep((_e612 - _e613), (_e615 + _e616), (((-0.95f * _e620) + (0.5f * _e623)) + (0.3f * _e627)));
                    let _e631 = gentle;
                    let _e634 = pan;
                    let _e638 = sand_7;
                    let _e642 = pave;
                    gravel = ((((_e630 * _e631) * (1f - _e634)) * (1f - _e638)) * (1f - _e642));
                }
            }
            let _e645 = wash_1;
            let _e648 = rel_2;
            let _e650 = sstep(0.15f, 0.6f, -(_e648));
            let _e654 = slope_17;
            let _e655 = sstep(0.015f, 0.06f, _e654);
            let _e660 = slope_17;
            let _e661 = sstep(0.2f, 0.4f, _e660);
            let _e665 = pan;
            let _e669 = sand_7;
            fan = (((((_e645 * _e650) * _e655) * (1f - _e661)) * (1f - _e665)) * (1f - _e669));
            let _e673 = pave;
            let _e676 = fan;
            pave = (_e673 * (1f - (0.85f * _e676)));
            let _e680 = gravel;
            let _e683 = fan;
            gravel = (_e680 * (1f - (0.7f * _e683)));
            let _e687 = sand_7;
            let _e688 = gravel;
            let _e689 = pave;
            let _e690 = pan;
            let _e692 = free;
            v2GroundUnit = (vec4<f32>(_e687, _e688, _e689, _e690) * _e692);
            let _e694 = rim_4;
            let _e695 = free;
            let _e697 = fan;
            let _e698 = free;
            let _e700 = rel_2;
            let _e701 = mottle_3;
            v2GroundSite = vec4<f32>((_e694 * _e695), (_e697 * _e698), _e700, _e701);
            return;
        }
    } else {
        return;
    }
}

fn v2GroundStreak(world_83: vec2<f32>, fall_3: vec2<f32>, across_5: f32, salt_47: u32) -> f32 {
    var world_84: vec2<f32>;
    var fall_4: vec2<f32>;
    var across_6: f32;
    var salt_48: u32;
    var n_17: f32 = 0f;
    var i_13: i32 = 0i;

    world_84 = world_83;
    fall_4 = fall_3;
    across_6 = across_5;
    salt_48 = salt_47;
    loop {
        let _e320 = i_13;
        if !((_e320 < 4i)) {
            break;
        }
        let _e327 = n_17;
        let _e328 = world_84;
        let _e329 = fall_4;
        let _e331 = across_6;
        let _e333 = i_13;
        let _e340 = across_6;
        let _e342 = ((_e328 + (_e329 * ((0.75f * _e331) * (f32(_e333) - 1.5f)))) / vec2(_e340));
        let _e347 = salt_48;
        let _e348 = surfaceNoise(vec3<f32>(_e342.x, _e342.y, 0f), _e347);
        n_17 = (_e327 + _e348);
        continuing {
            let _e324 = i_13;
            i_13 = (_e324 + 1i);
        }
    }
    let _e350 = n_17;
    return (_e350 * 0.38f);
}

fn v2GroundDunes(world_85: vec2<f32>, fp_36: f32, amount_7: f32) -> f32 {
    var world_86: vec2<f32>;
    var fp_37: f32;
    var amount_8: f32;
    var salt_49: u32;
    var tone_4: f32 = 0f;
    var lambda: f32;
    var angle_3: f32;
    var wind_1: vec2<f32>;
    var bend_2: vec3<f32> = vec3(0f);
    var kink: vec3<f32> = vec3(0f);
    var i_14: i32 = 0i;
    var local_308: f32;
    var n_18: vec3<f32>;
    var swell: f32;
    var k_37: i32 = 0i;
    var local_309: f32;
    var l_13: f32;
    var wave: f32;
    var local_310: f32;
    var b_18: f32;
    var local_311: f32;
    var c_50: f32;
    var local_312: vec2<f32>;
    var dir: vec2<f32>;
    var phase_7: f32;
    var rate_2: vec2<f32>;
    var keep_10: f32;
    var skew: f32;
    var gain_1: f32;
    var local_313: f32;
    var local_314: f32;

    world_86 = world_85;
    fp_37 = fp_36;
    amount_8 = amount_7;
    let _e314 = global.uMaterialSeed;
    salt_49 = _e314;
    let _e320 = salt_49;
    lambda = (150f + ((350f * f32(((_e320 >> 10u) & 255u))) / 255f));
    let _e331 = global.uQuality;
    let _e334 = amount_8;
    let _e338 = fp_37;
    let _e340 = lambda;
    if (((_e331 == 0i) && (_e334 > 0.01f)) && (_e338 < (0.3f * _e340))) {
        {
            let _e344 = salt_49;
            angle_3 = (f32((_e344 & 1023u)) * 0.006135923f);
            let _e351 = angle_3;
            let _e353 = angle_3;
            wind_1 = vec2<f32>(cos(_e351), sin(_e353));
            loop {
                let _e365 = i_14;
                if !((_e365 < 2i)) {
                    break;
                }
                {
                    let _e372 = world_86;
                    let _e373 = i_14;
                    if (_e373 == 0i) {
                        local_308 = 3.6f;
                    } else {
                        local_308 = 1.3f;
                    }
                    let _e379 = local_308;
                    let _e380 = lambda;
                    let _e382 = salt_49;
                    let _e385 = i_14;
                    let _e388 = surfaceBand(_e372, (_e379 * _e380), ((_e382 + 781u) + u32(_e385)));
                    n_18 = _e388;
                    let _e390 = i_14;
                    if (_e390 == 0i) {
                        let _e393 = n_18;
                        bend_2 = _e393;
                    } else {
                        let _e394 = n_18;
                        kink = _e394;
                    }
                }
                continuing {
                    let _e369 = i_14;
                    i_14 = (_e369 + 1i);
                }
            }
            let _e400 = bend_2;
            let _e403 = kink;
            let _e407 = sstep(-1.2f, 0.8f, (_e400.x - (0.6f * _e403.x)));
            let _e410 = amount_8;
            swell = ((0.55f + (0.45f * _e407)) * _e410);
            loop {
                let _e415 = k_37;
                if !((_e415 < 2i)) {
                    break;
                }
                {
                    let _e422 = k_37;
                    if (_e422 == 0i) {
                        let _e425 = lambda;
                        local_309 = _e425;
                    } else {
                        let _e427 = lambda;
                        local_309 = (0.23f * _e427);
                    }
                    let _e430 = local_309;
                    l_13 = _e430;
                    let _e433 = l_13;
                    wave = (6.2831855f / _e433);
                    let _e436 = k_37;
                    if (_e436 == 0i) {
                        local_310 = 3.2f;
                    } else {
                        local_310 = 5f;
                    }
                    let _e442 = local_310;
                    b_18 = _e442;
                    let _e444 = k_37;
                    if (_e444 == 0i) {
                        local_311 = 1.5f;
                    } else {
                        local_311 = 3.5f;
                    }
                    let _e450 = local_311;
                    c_50 = _e450;
                    let _e452 = k_37;
                    if (_e452 == 0i) {
                        let _e455 = wind_1;
                        local_312 = _e455;
                    } else {
                        let _e457 = wind_1;
                        let _e461 = wind_1;
                        let _e466 = wind_1;
                        let _e470 = wind_1;
                        local_312 = vec2<f32>(((0.906f * _e457.x) - (0.423f * _e461.y)), ((0.423f * _e466.x) + (0.906f * _e470.y)));
                    }
                    let _e476 = local_312;
                    dir = _e476;
                    let _e478 = world_86;
                    let _e479 = dir;
                    let _e481 = wave;
                    let _e483 = b_18;
                    let _e484 = bend_2;
                    let _e488 = c_50;
                    let _e489 = kink;
                    phase_7 = (((dot(_e478, _e479) * _e481) + (_e483 * _e484.x)) + (_e488 * _e489.x));
                    let _e494 = dir;
                    let _e495 = wave;
                    let _e497 = b_18;
                    let _e498 = bend_2;
                    let _e502 = c_50;
                    let _e503 = kink;
                    rate_2 = (((_e494 * _e495) + (_e497 * _e498.yz)) + (_e502 * _e503.yz));
                    let _e511 = fp_37;
                    let _e512 = rate_2;
                    let _e517 = sstep(0.125f, 0.25f, ((_e511 * length(_e512)) / 6.2831855f));
                    keep_10 = (1f - _e517);
                    let _e520 = keep_10;
                    if (_e520 > 0f) {
                        {
                            let _e523 = phase_7;
                            let _e525 = phase_7;
                            skew = (_e523 - (0.7f * sin(_e525)));
                            let _e530 = swell;
                            let _e531 = keep_10;
                            gain_1 = (_e530 * _e531);
                            let _e534 = v2GroundFormSlope;
                            let _e535 = k_37;
                            if (_e535 == 0i) {
                                local_313 = 0.03f;
                            } else {
                                local_313 = 0.022f;
                            }
                            let _e541 = local_313;
                            let _e542 = l_13;
                            let _e544 = gain_1;
                            let _e546 = skew;
                            let _e551 = phase_7;
                            let _e556 = rate_2;
                            v2GroundFormSlope = (_e534 + (((((_e541 * _e542) * _e544) * cos(_e546)) * (1f - (0.7f * cos(_e551)))) * _e556));
                            let _e559 = tone_4;
                            let _e560 = k_37;
                            if (_e560 == 0i) {
                                local_314 = 0.032f;
                            } else {
                                local_314 = 0.025f;
                            }
                            let _e566 = local_314;
                            let _e567 = gain_1;
                            let _e569 = skew;
                            tone_4 = (_e559 + ((_e566 * _e567) * sin(_e569)));
                        }
                    }
                }
                continuing {
                    let _e419 = k_37;
                    k_37 = (_e419 + 1i);
                }
            }
        }
    }
    let _e573 = tone_4;
    return _e573;
}

fn v2GroundPaint(c_51: vec3<f32>, z_7: i32, e_22: V2Env, world_87: vec2<f32>, fp_38: f32, stripe: f32, thread_1: f32) -> vec3<f32> {
    var c_52: vec3<f32>;
    var z_8: i32;
    var e_23: V2Env;
    var world_88: vec2<f32>;
    var fp_39: f32;
    var stripe_1: f32;
    var thread_2: f32;
    var U_2: vec4<f32>;
    var local_315: array<vec4<f32>, 11> = V2_ZONE_PAVEMENT;
    var pave_1: vec4<f32>;
    var local_316: array<vec4<f32>, 11> = V2_ZONE_GRAVEL;
    var grav: vec4<f32>;
    var local_317: array<vec4<f32>, 11> = V2_ZONE_PAN;
    var pan_1: vec4<f32>;
    var rim_5: f32;
    var fan_1: f32;
    var tone_5: f32;
    var micro_4: vec3<f32>;
    var grit: vec3<f32>;
    var local_318: array<vec4<f32>, 11> = V2_ZONE_BARE;
    var sand_8: vec3<f32>;
    var block_2: f32 = 0f;
    var joint_1: f32 = 0f;
    var border: f32 = 0f;
    var celled: f32;
    var wide_3: bool;
    var k_38: i32 = 0i;
    var local_319: f32;
    var local_320: f32;
    var local_321: f32;
    var size_1: f32;
    var keep_11: f32;
    var f_18: vec4<f32>;
    var local_322: f32;
    var gravel_1: vec3<f32>;
    var rock_7: vec3<f32>;
    var floored_1: vec3<f32>;

    c_52 = c_51;
    z_8 = z_7;
    e_23 = e_22;
    world_88 = world_87;
    fp_39 = fp_38;
    stripe_1 = stripe;
    thread_2 = thread_1;
    let _e322 = v2GroundUnit;
    U_2 = _e322;
    let _e324 = z_8;
    let _e328 = local_315[_e324];
    pave_1 = _e328;
    let _e330 = z_8;
    let _e334 = local_316[_e330];
    grav = _e334;
    let _e336 = z_8;
    let _e340 = local_317[_e336];
    pan_1 = _e340;
    let _e342 = v2GroundSite;
    rim_5 = _e342.x;
    let _e345 = v2GroundSite;
    fan_1 = _e345.y;
    let _e350 = e_23;
    tone_5 = (0.93f + (0.14f * _e350.tone));
    let _e355 = surfaceMicroTone;
    micro_4 = _e355;
    let _e360 = micro_4;
    grit = (vec3(1f) + (1.6f * (_e360 - vec3(1f))));
    let _e367 = z_8;
    let _e371 = local_318[_e367];
    sand_8 = (_e371.xyz * vec3<f32>(1.07f, 1.04f, 0.97f));
    let _e385 = U_2;
    let _e387 = U_2;
    let _e390 = U_2;
    let _e392 = pan_1;
    celled = ((_e385.y + _e387.z) + (_e390.w * _e392.w));
    let _e397 = global.uQuality;
    let _e400 = celled;
    let _e404 = fp_39;
    if (((_e397 == 0i) && (_e400 > 0.01f)) && (_e404 < 7.5f)) {
        {
            let _e408 = U_2;
            let _e410 = U_2;
            let _e412 = U_2;
            wide_3 = (_e408.w > (_e410.y + _e412.z));
            loop {
                let _e419 = k_38;
                if !((_e419 < 2i)) {
                    break;
                }
                {
                    let _e426 = k_38;
                    if (_e426 == 0i) {
                        let _e429 = wide_3;
                        if _e429 {
                            local_319 = 30f;
                        } else {
                            local_319 = 14f;
                        }
                        let _e433 = local_319;
                        local_321 = _e433;
                    } else {
                        let _e434 = wide_3;
                        if _e434 {
                            local_320 = 7f;
                        } else {
                            local_320 = 3.2f;
                        }
                        let _e438 = local_320;
                        local_321 = _e438;
                    }
                    let _e440 = local_321;
                    size_1 = _e440;
                    let _e443 = size_1;
                    let _e446 = size_1;
                    let _e449 = fp_39;
                    let _e450 = sstep((_e443 * 0.1f), (_e446 * 0.25f), _e449);
                    keep_11 = (1f - _e450);
                    let _e453 = keep_11;
                    if (_e453 > 0f) {
                        {
                            let _e456 = world_88;
                            let _e457 = size_1;
                            let _e460 = global.uMaterialSeed;
                            let _e463 = k_38;
                            let _e466 = surfaceFacets((_e456 / vec2(_e457)), ((_e460 + 791u) + u32(_e463)));
                            f_18 = _e466;
                            let _e468 = block_2;
                            let _e469 = keep_11;
                            let _e470 = k_38;
                            if (_e470 == 0i) {
                                local_322 = 0.1f;
                            } else {
                                local_322 = 0.07f;
                            }
                            let _e476 = local_322;
                            let _e478 = f_18;
                            block_2 = (_e468 + ((_e469 * _e476) * _e478.x));
                            let _e482 = k_38;
                            let _e485 = wide_3;
                            if ((_e482 == 1i) || _e485) {
                                let _e487 = joint_1;
                                let _e488 = keep_11;
                                let _e489 = f_18;
                                let _e491 = fp_39;
                                let _e492 = size_1;
                                let _e494 = surfaceJoint(_e489.y, (_e491 / _e492));
                                joint_1 = max(_e487, (_e488 * _e494));
                            }
                            let _e497 = k_38;
                            if (_e497 == 1i) {
                                let _e500 = keep_11;
                                let _e504 = f_18;
                                let _e506 = sstep(0.03f, 0.2f, _e504.y);
                                border = (_e500 * (0.55f - _e506));
                            }
                        }
                    }
                }
                continuing {
                    let _e423 = k_38;
                    k_38 = (_e423 + 1i);
                }
            }
        }
    }
    let _e509 = grav;
    let _e511 = tone_5;
    let _e513 = grit;
    let _e518 = pave_1;
    let _e522 = block_2;
    let _e525 = pave_1;
    let _e528 = stripe_1;
    let _e531 = border;
    gravel_1 = (((_e509.xyz * _e511) * _e513) * ((1f + ((0.35f + (0.25f * _e518.w)) * _e522)) + (_e525.w * ((0.09f * _e528) - (0.1f * _e531)))));
    let _e538 = pave_1;
    let _e540 = tone_5;
    let _e542 = micro_4;
    let _e546 = block_2;
    let _e550 = joint_1;
    let _e554 = pave_1;
    let _e557 = stripe_1;
    rock_7 = (((_e538.xyz * _e540) * _e542) * (((1f + (1.3f * _e546)) - (0.16f * _e550)) + ((0.07f * _e554.w) * _e557)));
    let _e562 = pan_1;
    let _e567 = micro_4;
    let _e575 = pan_1;
    let _e578 = block_2;
    let _e581 = joint_1;
    floored_1 = ((_e562.xyz * (vec3(1f) + (0.5f * (_e567 - vec3(1f))))) * (1f + (_e575.w * ((0.3f * _e578) - (0.22f * _e581)))));
    let _e588 = c_52;
    let _e589 = gravel_1;
    let _e590 = U_2;
    c_52 = mix(_e588, _e589, vec3(_e590.y));
    let _e594 = c_52;
    let _e595 = rock_7;
    let _e596 = U_2;
    c_52 = mix(_e594, _e595, vec3(_e596.z));
    let _e600 = c_52;
    let _e601 = sand_8;
    let _e602 = tone_5;
    let _e604 = micro_4;
    let _e606 = U_2;
    c_52 = mix(_e600, ((_e601 * _e602) * _e604), vec3(_e606.x));
    let _e610 = c_52;
    let _e611 = sand_8;
    let _e612 = micro_4;
    let _e616 = thread_2;
    let _e621 = fan_1;
    c_52 = mix(_e610, ((_e611 * _e612) * (1f + (0.1f * _e616))), vec3((0.6f * _e621)));
    let _e625 = c_52;
    let _e626 = pan_1;
    let _e630 = micro_4;
    let _e633 = rim_5;
    c_52 = mix(_e625, ((_e626.xyz * 0.56f) * _e630), vec3((0.75f * _e633)));
    let _e637 = c_52;
    let _e638 = floored_1;
    let _e639 = U_2;
    return mix(_e637, _e638, vec3(_e639.w));
}

fn v2GroundWetland(wet_2: vec3<f32>, z_9: i32, world_89: vec2<f32>, fp_40: f32) -> vec3<f32> {
    var wet_3: vec3<f32>;
    var z_10: i32;
    var world_90: vec2<f32>;
    var fp_41: f32;
    var c_53: vec3<f32>;
    var q_24: vec2<f32>;
    var h_33: u32;
    var u1_: f32;
    var u2_: f32;
    var keep_12: f32;
    var local_323: vec3<f32>;
    var local_324: vec3<f32>;
    var parcel: vec3<f32>;
    var broad_7: f32 = 0f;
    var fine_13: f32 = 0f;
    var k_39: i32 = 0i;
    var local_325: f32;
    var local_326: f32;
    var n_19: f32;
    var seen_1: f32;
    var w_20: f32;
    var low_1: f32;
    var sedge_1: f32;
    var pond: f32;
    var channel_5: f32;
    var tight: f32;
    var line_2: f32;

    wet_3 = wet_2;
    z_10 = z_9;
    world_90 = world_89;
    fp_41 = fp_40;
    let _e316 = wet_3;
    c_53 = _e316;
    let _e318 = z_10;
    if (_e318 == 9i) {
        {
            let _e329 = world_90;
            q_24 = ((mat2x2<f32>(vec2<f32>(0.94f, 0.34f), vec2<f32>(-0.34f, 0.94f)) * _e329) / vec2<f32>(170f, 75f));
            let _e336 = q_24;
            let _e338 = vec2<i32>(floor(_e336));
            let _e343 = global.uMaterialSeed;
            let _e344 = groundHash(vec3<i32>(_e338.x, _e338.y, 709i), _e343);
            h_33 = _e344;
            let _e346 = h_33;
            u1_ = (f32((_e346 & 255u)) / 255f);
            let _e353 = h_33;
            u2_ = (f32(((_e353 >> 8u) & 255u)) / 255f);
            let _e365 = fp_41;
            let _e366 = sstep(60f, 170f, _e365);
            keep_12 = (1f - _e366);
            let _e369 = wet_3;
            let _e372 = u1_;
            let _e376 = u2_;
            if (_e376 > 0.7f) {
                local_324 = vec3<f32>(0.49f, 0.46f, 0.32f);
            } else {
                let _e383 = u2_;
                if (_e383 < 0.1f) {
                    local_323 = vec3<f32>(0.2f, 0.27f, 0.28f);
                } else {
                    let _e390 = wet_3;
                    local_323 = _e390;
                }
                let _e392 = local_323;
                local_324 = _e392;
            }
            let _e394 = local_324;
            parcel = mix((_e369 * (0.82f + (0.36f * _e372))), _e394, vec3(0.55f));
            let _e399 = wet_3;
            let _e400 = parcel;
            let _e401 = keep_12;
            c_53 = mix(_e399, _e400, vec3(_e401));
        }
    } else {
        let _e404 = global.uQuality;
        if (_e404 == 0i) {
            {
                let _e407 = fp_41;
                if (_e407 < 45f) {
                    {
                        loop {
                            let _e416 = k_39;
                            if !((_e416 < 2i)) {
                                break;
                            }
                            {
                                let _e423 = fp_41;
                                let _e424 = k_39;
                                if (_e424 == 0i) {
                                    local_325 = 45f;
                                } else {
                                    local_325 = 10f;
                                }
                                let _e430 = local_325;
                                if (_e423 < _e430) {
                                    {
                                        let _e432 = world_90;
                                        let _e437 = k_39;
                                        if (_e437 == 0i) {
                                            local_326 = 150f;
                                        } else {
                                            local_326 = 34f;
                                        }
                                        let _e443 = local_326;
                                        let _e444 = fp_41;
                                        let _e445 = global.uMaterialSeed;
                                        let _e448 = k_39;
                                        let _e451 = v2Pattern(vec3<f32>(_e432.x, _e432.y, 0f), _e443, _e444, ((_e445 + 741u) + u32(_e448)));
                                        n_19 = _e451;
                                        let _e453 = k_39;
                                        if (_e453 == 0i) {
                                            let _e456 = n_19;
                                            broad_7 = _e456;
                                        } else {
                                            let _e457 = n_19;
                                            fine_13 = _e457;
                                        }
                                    }
                                }
                            }
                            continuing {
                                let _e420 = k_39;
                                k_39 = (_e420 + 1i);
                            }
                        }
                        let _e461 = fp_41;
                        let _e462 = sstep(18f, 45f, _e461);
                        seen_1 = (1f - _e462);
                        let _e466 = fp_41;
                        w_20 = clamp((0.02f * _e466), 0.05f, 0.5f);
                        let _e472 = v2GroundSite;
                        let _e475 = v2GroundSite;
                        low_1 = (_e472.w - (1.2f * _e475.z));
                        let _e480 = w_20;
                        let _e482 = w_20;
                        let _e483 = broad_7;
                        let _e485 = fine_13;
                        let _e489 = low_1;
                        let _e492 = sstep(-(_e480), _e482, ((_e483 + (0.5f * _e485)) + (0.25f * _e489)));
                        sedge_1 = (_e492 - 0.5f);
                        let _e496 = wet_3;
                        let _e499 = seen_1;
                        let _e503 = seen_1;
                        let _e504 = sedge_1;
                        c_53 = (_e496 * (vec3((1f + (0.05f * _e499))) + ((_e503 * _e504) * vec3<f32>(0.2f, 0.1f, -0.04f))));
                        let _e514 = w_20;
                        let _e516 = w_20;
                        let _e518 = low_1;
                        let _e521 = broad_7;
                        let _e525 = fine_13;
                        let _e530 = sstep(-(_e514), _e516, ((((0.45f * _e518) + (0.75f * _e521)) + (0.3f * _e525)) - 1.2f));
                        pond = _e530;
                        let _e532 = broad_7;
                        let _e534 = fine_13;
                        channel_5 = (_e532 - (0.3f * _e534));
                        let _e540 = fp_41;
                        let _e541 = fp_41;
                        tight = min(900f, (15000f / max((_e540 * _e541), 0.01f)));
                        let _e548 = tight;
                        let _e550 = channel_5;
                        let _e552 = channel_5;
                        let _e558 = fp_41;
                        let _e559 = sstep(8f, 20f, _e558);
                        line_2 = (exp2(((-(_e548) * _e550) * _e552)) * (1f - _e559));
                        let _e563 = c_53;
                        let _e569 = seen_1;
                        let _e571 = pond;
                        let _e574 = line_2;
                        c_53 = mix(_e563, vec3<f32>(0.13f, 0.17f, 0.17f), vec3(max(((0.9f * _e569) * _e571), (0.8f * _e574))));
                    }
                }
            }
        }
    }
    let _e579 = c_53;
    return _e579;
}

fn v2FlatSedimentExposure(herbs_1: f32, shore_15: f32, openness_12: f32) -> f32 {
    var herbs_2: f32;
    var shore_16: f32;
    var openness_13: f32;
    var coastal: f32;

    herbs_2 = herbs_1;
    shore_16 = shore_15;
    openness_13 = openness_12;
    let _e321 = shore_16;
    let _e322 = groundSmooth(160f, 400f, _e321);
    let _e326 = openness_13;
    let _e327 = groundSmooth(0f, 0.15f, _e326);
    coastal = ((1f - _e322) * _e327);
    let _e331 = herbs_2;
    let _e333 = coastal;
    return (1f - (_e331 * (1f - _e333)));
}

fn v2ZoneEnv(e_24: ptr<function, V2Env>, s_29: vec3<f32>, world_91: vec2<f32>, tpi_14: f32, fp_42: f32) {
    var s_30: vec3<f32>;
    var world_92: vec2<f32>;
    var tpi_15: f32;
    var fp_43: f32;
    var z_11: i32;
    var local_327: array<vec4<f32>, 11> = V2_ZONE_FOREST;
    var F: vec4<f32>;
    var local_328: array<vec4<f32>, 11> = V2_ZONE_SOIL;
    var S: vec4<f32>;
    var slope_18: f32;
    var level_9: f32;
    var low_2: f32;
    var mottle_4: f32;
    var woody: f32;
    var local_329: array<vec4<f32>, 11> = V2_ZONE_UNITS;
    var local_330: array<vec4<f32>, 11> = V2_ZONE_GRAVEL;
    var G: vec4<f32>;
    var knob: f32;
    var rock_8: f32;
    var local_331: array<vec4<f32>, 11> = V2_ZONE_WET;
    var shift_2: f32;
    var warm: f32;
    var above: f32;

    s_30 = s_29;
    world_92 = world_91;
    tpi_15 = tpi_14;
    fp_43 = fp_42;
    let _e321 = v2Zone();
    z_11 = _e321;
    let _e323 = z_11;
    let _e327 = local_327[_e323];
    F = _e327;
    let _e329 = z_11;
    let _e333 = local_328[_e329];
    S = _e333;
    let _e335 = s_30;
    slope_18 = length(_e335.yz);
    let _e342 = slope_18;
    let _e343 = sstep(0.012f, 0.06f, _e342);
    level_9 = (1f - _e343);
    let _e349 = tpi_15;
    let _e350 = sstep(0f, -0.05f, _e349);
    let _e353 = s_30;
    let _e355 = sstep(35f, 6f, _e353.x);
    low_2 = max(_e350, _e355);
    let _e358 = world_92;
    let _e364 = fp_43;
    let _e365 = global.uMaterialSeed;
    let _e368 = v2Pattern(vec3<f32>(_e358.x, _e358.y, 0f), 900f, _e364, (_e365 + 701u));
    mottle_4 = _e368;
    let _e370 = F;
    let _e372 = v2SeasonWet();
    let _e377 = level_9;
    let _e379 = low_2;
    let _e386 = mottle_4;
    let _e387 = sstep(-0.6f, 0.5f, _e386);
    let _e392 = s_30;
    let _e397 = (*e_24);
    v2ZoneWet = (((((clamp((_e370.w * _e372), 0f, 1f) * _e377) * _e379) * (0.35f + (0.65f * _e387))) * step(0f, _e392.x)) * (1f - _e397.snow));
    let _e402 = (*e_24);
    let _e405 = v2ZoneWet;
    (*e_24).moisture = clamp((_e402.moisture + (1.6f * _e405)), 0f, 4f);
    let _e411 = (*e_24);
    woody = _e411.woody;
    if (uForest == 0i) {
        let _e416 = woody;
        let _e417 = F;
        woody = (_e416 * _e417.x);
    }
    let _e420 = z_11;
    let _e424 = local_329[_e420];
    let _e425 = z_11;
    let _e429 = local_330[_e425];
    let _e431 = s_30;
    let _e432 = world_92;
    let _e433 = tpi_15;
    let _e434 = fp_43;
    let _e435 = mottle_4;
    let _e436 = (*e_24);
    let _e444 = tpi_15;
    let _e445 = sstep(0f, -0.1f, _e444);
    let _e453 = woody;
    let _e454 = sstep(0.15f, 0.5f, _e453);
    let _e457 = v2ZoneWet;
    let _e461 = s_30;
    v2GroundUnits(_e424, _e429.w, _e431, _e432, _e433, _e434, _e435, (((_e436.tone - 0.5f) + (0.06f * _e445)) / 0.13f), (((1f - _e454) * (1f - _e457)) * step(0f, _e461.x)));
    let _e465 = v2GroundUnit;
    G = _e465;
    let _e467 = G;
    surfaceGroundSand = _e467.x;
    let _e469 = G;
    let _e471 = G;
    surfaceGroundStony = clamp((_e469.y + _e471.z), 0f, 1f);
    let _e478 = (*e_24);
    let _e480 = S;
    let _e485 = slope_18;
    let _e486 = sstep(0.1f, 0.5f, _e485);
    let _e490 = v2ZoneWet;
    let _e495 = G;
    (*e_24).sand = clamp(((_e478.sand + ((_e480.y * (1f - _e486)) * (1f - _e490))) + (0.5f * _e495.x)), 0f, 1f);
    let _e504 = tpi_15;
    let _e505 = sstep(0f, 0.08f, _e504);
    let _e509 = mottle_4;
    let _e510 = sstep(-0.1f, 0.5f, _e509);
    let _e514 = slope_18;
    let _e515 = sstep(0.05f, 0.2f, _e514);
    knob = ((_e505 * _e510) * _e515);
    let _e518 = S;
    let _e522 = slope_18;
    let _e523 = sstep(0.05f, 0.35f, _e522);
    let _e525 = knob;
    let _e530 = v2ZoneWet;
    let _e534 = G;
    let _e538 = (*e_24);
    let _e542 = (*e_24);
    rock_8 = clamp((((_e518.x * max(_e523, (0.75f * _e525))) * (1f - _e530)) + (0.6f * _e534.z)), -(_e538.rock), (1f - _e542.rock));
    let _e547 = rock_8;
    let _e551 = v2ZoneWet;
    let _e554 = G;
    let _e557 = G;
    v2ZoneBare = clamp((((max(_e547, 0f) + (0.7f * _e551)) + _e554.x) + _e557.w), 0f, 1f);
    let _e563 = z_11;
    let _e567 = local_331[_e563];
    shift_2 = _e567.w;
    let _e570 = shift_2;
    if (_e570 > 0f) {
        {
            let _e573 = global.uMaterialClimate;
            let _e576 = s_30;
            let _e587 = global.uMaterialClimate;
            warm = (((_e573.x - (0.0065f * max(_e576.x, 0f))) + 6f) + (0.5f * max(0f, (10f - _e587.x))));
            let _e596 = shift_2;
            let _e599 = shift_2;
            let _e601 = warm;
            let _e602 = sstep((6f + _e596), (8f + _e599), _e601);
            above = (1f - _e602);
            let _e605 = v2ZoneBare;
            let _e606 = above;
            v2ZoneBare = max(_e605, _e606);
            let _e609 = (*e_24);
            let _e611 = above;
            let _e615 = warm;
            let _e616 = sstep(-1f, 3f, _e615);
            let _e619 = (*e_24);
            let _e624 = (*e_24);
            (*e_24).grass = max(_e609.grass, (((_e611 * _e616) * (1f - _e619.rock)) * (1f - _e624.snow)));
        }
    }
    let _e630 = (*e_24);
    let _e632 = rock_8;
    (*e_24).rock = (_e630.rock + _e632);
    let _e635 = (*e_24);
    let _e637 = S;
    let _e641 = rock_8;
    let _e647 = G;
    let _e650 = G;
    let _e654 = G;
    let _e657 = G;
    (*e_24).grass = clamp((((_e635.grass * _e637.w) * (1f - max(_e641, 0f))) * (1f - min((((_e647.x + (0.7f * _e650.y)) + _e654.z) + _e657.w), 1f))), 0f, 1f);
    let _e668 = (*e_24);
    let _e670 = S;
    let _e674 = v2ZoneWet;
    let _e681 = (*e_24);
    let _e684 = (*e_24);
    (*e_24).organic = clamp((_e668.organic + (_e670.z * (0.4f + (0.6f * _e674)))), 0f, max(((1f - _e681.sand) - _e684.clay), 0f));
    if (uForest == 0i) {
        {
            let _e693 = (*e_24);
            let _e695 = F;
            (*e_24).woody = (_e693.woody * _e695.x);
            let _e699 = (*e_24);
            let _e701 = F;
            let _e703 = F;
            (*e_24).needle = mix(_e699.needle, _e701.y, _e703.z);
            return;
        }
    } else {
        return;
    }
}

fn v2ZoneOpen(c_54: vec3<f32>, e_25: V2Env, world_93: vec2<f32>, fp_44: f32) -> vec3<f32> {
    var c_55: vec3<f32>;
    var e_26: V2Env;
    var world_94: vec2<f32>;
    var fp_45: f32;
    var z_12: i32;
    var local_332: array<vec4<f32>, 11> = V2_ZONE_SWARD;
    var sw: vec4<f32>;
    var local_333: array<vec4<f32>, 11> = V2_ZONE_BARE;
    var bare_28: vec4<f32>;
    var local_334: array<vec4<f32>, 11> = V2_ZONE_CANOPY;
    var can: vec4<f32>;
    var cover_21: f32;
    var p_47: vec3<f32>;
    var U_3: vec4<f32>;
    var streak: f32 = 0f;
    var rill: f32 = 0f;
    var stripe_2: f32 = 0f;
    var local_335: array<vec4<f32>, 11> = V2_ZONE_PAVEMENT;
    var stripes: bool;
    var local_336: f32;
    var across_7: f32;
    var keep_13: f32;
    var steepness: f32;
    var local_337: vec2<f32>;
    var scrub: f32;
    var speck_1: f32 = 0f;
    var crisp_1: f32 = 0f;
    var k_40: i32 = 0i;
    var local_338: f32;
    var local_339: f32;
    var local_340: f32;
    var local_341: f32;
    var local_342: u32;
    var local_343: u32;
    var local_344: array<vec4<f32>, 11> = V2_ZONE_WET;
    var wet_4: vec3<f32>;

    c_55 = c_54;
    e_26 = e_25;
    world_94 = world_93;
    fp_45 = fp_44;
    let _e320 = v2Zone();
    z_12 = _e320;
    let _e322 = z_12;
    let _e326 = local_332[_e322];
    sw = _e326;
    let _e328 = z_12;
    let _e332 = local_333[_e328];
    bare_28 = _e332;
    let _e334 = z_12;
    let _e338 = local_334[_e334];
    can = _e338;
    let _e340 = e_26;
    let _e343 = e_26;
    cover_21 = (_e340.grass * (1f - _e343.rock));
    let _e348 = c_55;
    let _e349 = bare_28;
    let _e353 = e_26;
    let _e358 = surfaceMicroTone;
    let _e360 = sw;
    let _e362 = surfaceHerbTone;
    let _e364 = surfaceMicroTone;
    let _e366 = cover_21;
    let _e369 = bare_28;
    let _e373 = e_26;
    let _e381 = sw;
    let _e383 = cover_21;
    c_55 = mix(_e348, mix(((_e349.xyz * (0.86f + (0.28f * _e353.tone))) * _e358), ((_e360.xyz * _e362) * _e364), vec3(_e366)), vec3(mix((_e369.w * (1f - (0.8f * clamp(_e373.rock, 0f, 1f)))), _e381.w, _e383)));
    let _e387 = world_94;
    p_47 = vec3<f32>(_e387.x, _e387.y, 0f);
    let _e393 = v2GroundUnit;
    U_3 = _e393;
    let _e401 = global.uQuality;
    if (_e401 == 0i) {
        {
            let _e404 = z_12;
            let _e408 = local_335[_e404];
            let _e410 = U_3;
            let _e412 = U_3;
            let _e418 = fp_45;
            stripes = (((_e408.w * (_e410.y + _e412.z)) > 0.2f) && (_e418 < 0.72f));
            let _e423 = stripes;
            if _e423 {
                local_336 = 2.4f;
            } else {
                local_336 = 30f;
            }
            let _e427 = local_336;
            across_7 = _e427;
            let _e431 = e_26;
            let _e433 = sstep(0.03f, 0.1f, _e431.slope);
            let _e437 = e_26;
            let _e439 = sstep(0.5f, 0.9f, _e437.slope);
            let _e443 = across_7;
            let _e446 = across_7;
            let _e449 = fp_45;
            let _e450 = sstep((_e443 * 0.12f), (_e446 * 0.3f), _e449);
            keep_13 = ((_e433 * (1f - _e439)) * (1f - _e450));
            let _e454 = keep_13;
            if (_e454 > 0f) {
                {
                    let _e457 = surfaceGroundGradient;
                    steepness = length(_e457);
                    let _e460 = keep_13;
                    let _e461 = world_94;
                    let _e462 = steepness;
                    if (_e462 > 0.0001f) {
                        let _e465 = surfaceGroundGradient;
                        let _e466 = steepness;
                        local_337 = (_e465 / vec2(_e466));
                    } else {
                        local_337 = vec2<f32>(1f, 0f);
                    }
                    let _e473 = local_337;
                    let _e474 = across_7;
                    let _e475 = global.uMaterialSeed;
                    let _e478 = v2GroundStreak(_e461, _e473, _e474, (_e475 + 731u));
                    streak = (_e460 * _e478);
                    let _e480 = stripes;
                    if _e480 {
                        {
                            let _e481 = streak;
                            stripe_2 = _e481;
                            streak = 0f;
                        }
                    } else {
                        let _e483 = keep_13;
                        let _e486 = streak;
                        let _e488 = streak;
                        let _e490 = keep_13;
                        let _e491 = keep_13;
                        rill = (_e483 * (exp2((((-14f * _e486) * _e488) / (_e490 * _e491))) - 0.22f));
                    }
                }
            }
        }
    }
    let _e498 = c_55;
    let _e502 = streak;
    let _e508 = v2GroundSite;
    let _e511 = sstep(0f, 0.5f, -(_e508.z));
    let _e514 = cover_21;
    let _e516 = rill;
    c_55 = (_e498 * (vec3(1f) + (((0.028f * _e502) - (((0.03f + (0.05f * _e511)) * _e514) * _e516)) * vec3<f32>(1f, 0.8f, 0.9f))));
    let _e526 = can;
    let _e528 = cover_21;
    scrub = (_e526.w * _e528);
    let _e531 = scrub;
    if (_e531 > 0.004f) {
        {
            let _e538 = global.uQuality;
            if (_e538 == 0i) {
                {
                    loop {
                        let _e543 = k_40;
                        if !((_e543 < 3i)) {
                            break;
                        }
                        let _e550 = speck_1;
                        let _e551 = k_40;
                        if (_e551 == 0i) {
                            local_339 = 0.45f;
                        } else {
                            let _e555 = k_40;
                            if (_e555 == 1i) {
                                local_338 = 0.35f;
                            } else {
                                local_338 = 0.2f;
                            }
                            let _e561 = local_338;
                            local_339 = _e561;
                        }
                        let _e563 = local_339;
                        let _e564 = p_47;
                        let _e565 = k_40;
                        if (_e565 == 0i) {
                            local_341 = 1600f;
                        } else {
                            let _e569 = k_40;
                            if (_e569 == 1i) {
                                local_340 = 220f;
                            } else {
                                local_340 = 60f;
                            }
                            let _e575 = local_340;
                            local_341 = _e575;
                        }
                        let _e577 = local_341;
                        let _e578 = fp_45;
                        let _e579 = global.uMaterialSeed;
                        let _e580 = k_40;
                        if (_e580 == 0i) {
                            local_343 = 711u;
                        } else {
                            let _e584 = k_40;
                            if (_e584 == 1i) {
                                local_342 = 713u;
                            } else {
                                local_342 = 717u;
                            }
                            let _e590 = local_342;
                            local_343 = _e590;
                        }
                        let _e592 = local_343;
                        let _e594 = v2Pattern(_e564, _e577, _e578, (_e579 + _e592));
                        speck_1 = (_e550 + (_e563 * _e594));
                        continuing {
                            let _e547 = k_40;
                            k_40 = (_e547 + 1i);
                        }
                    }
                    let _e600 = fp_45;
                    let _e601 = sstep(4f, 20f, _e600);
                    crisp_1 = (1f - _e601);
                }
            }
            let _e603 = c_55;
            let _e608 = can;
            let _e611 = scrub;
            let _e618 = crisp_1;
            let _e622 = crisp_1;
            let _e624 = speck_1;
            let _e625 = sstep(mix(-0.4f, -0.02f, _e618), mix(0.6f, 0.22f, _e622), _e624);
            c_55 = mix(_e603, (vec3<f32>(0.27f, 0.3f, 0.2f) * _e608.xyz), vec3((_e611 * (0.3f + (0.5f * _e625)))));
        }
    }
    let _e631 = U_3;
    let _e633 = U_3;
    let _e636 = U_3;
    let _e639 = U_3;
    let _e642 = v2GroundSite;
    let _e645 = v2GroundSite;
    if ((((((_e631.x + _e633.y) + _e636.z) + _e639.w) + _e642.x) + _e645.y) > 0.003f) {
        {
            let _e650 = c_55;
            let _e651 = z_12;
            let _e652 = e_26;
            let _e653 = world_94;
            let _e654 = fp_45;
            let _e655 = stripe_2;
            let _e656 = rill;
            let _e657 = v2GroundPaint(_e650, _e651, _e652, _e653, _e654, _e655, _e656);
            c_55 = _e657;
            let _e658 = c_55;
            let _e660 = world_94;
            let _e661 = fp_45;
            let _e662 = U_3;
            let _e664 = v2GroundDunes(_e660, _e661, _e662.x);
            c_55 = (_e658 * (1f + _e664));
        }
    }
    let _e667 = z_12;
    let _e671 = local_344[_e667];
    wet_4 = _e671.xyz;
    let _e674 = v2ZoneWet;
    if (_e674 > 0.003f) {
        let _e677 = wet_4;
        let _e678 = z_12;
        let _e679 = world_94;
        let _e680 = fp_45;
        let _e681 = v2GroundWetland(_e677, _e678, _e679, _e680);
        wet_4 = _e681;
    }
    let _e682 = c_55;
    let _e683 = wet_4;
    let _e685 = v2ZoneWet;
    return mix(_e682, _e683, vec3((0.8f * _e685)));
}

fn v2GlacierProximity(world_95: vec2<f32>) -> f32 {
    var world_96: vec2<f32>;
    var source_1: f32 = 0f;
    var i_15: i32 = 0i;

    world_96 = world_95;
    let _e316 = global.uQuality;
    if (_e316 > 0i) {
        let _e321 = global.uV2GlacierSources[0];
        let _e326 = world_96;
        let _e329 = global.uV2GlacierSources[0];
        let _e332 = sstep(0f, 80000f, distance(_e326, _e329.xy));
        return (_e321.z * (1f - _e332));
    }
    loop {
        let _e339 = i_15;
        if !((_e339 < 8i)) {
            break;
        }
        let _e346 = source_1;
        let _e347 = i_15;
        let _e349 = global.uV2GlacierSources[_e347];
        let _e354 = world_96;
        let _e355 = i_15;
        let _e357 = global.uV2GlacierSources[_e355];
        let _e360 = sstep(0f, 80000f, distance(_e354, _e357.xy));
        source_1 = max(_e346, (_e349.z * (1f - _e360)));
        continuing {
            let _e343 = i_15;
            i_15 = (_e343 + 1i);
        }
    }
    let _e364 = source_1;
    return _e364;
}

fn v2Local(s_31: vec3<f32>, world_97: vec2<f32>, tpi_16: f32, footprint_56: f32) -> V2Env {
    var s_32: vec3<f32>;
    var world_98: vec2<f32>;
    var tpi_17: f32;
    var footprint_57: f32;
    var annual_2: f32;
    var amplitude_1: f32;
    var rain_1: f32;
    var arid_2: f32;
    var local_345: f32;
    var bank_7: f32;
    var local_346: vec3<f32>;
    var year_1: vec3<f32>;
    var e_27: V2Env;
    var local_347: f32;
    var thaw_1: f32;
    var warmest_3: f32;
    var coldest_1: f32;
    var supply_3: f32;
    var slope_19: f32;
    var slope_20: f32;
    var steep_1: f32;
    var window: f32;
    var bend_3: f32 = 0f;
    var spread_1: f32 = 0f;
    var drift_1: f32 = 0f;
    var fine_14: f32 = 0f;
    var ragged_3: f32;
    var k_41: i32 = 0i;
    var local_348: f32;
    var local_349: f32;
    var local_350: f32;
    var local_351: f32;
    var local_352: f32;
    var local_353: f32;
    var scale_14: f32;
    var local_354: vec2<f32>;
    var local_355: vec2<f32>;
    var local_356: vec2<f32>;
    var local_357: vec2<f32>;
    var local_358: vec2<f32>;
    var local_359: vec2<f32>;
    var r_6: vec2<f32>;
    var local_360: u32;
    var v_19: f32;
    var local_361: f32;
    var local_362: f32;
    var local_363: f32;
    var local_364: f32;
    var local_365: f32;
    var a_29: f32;
    var keep_14: f32;
    var relief_1: f32;
    var cut_1: f32;
    var pack_1: f32;
    var f_19: vec4<f32>;
    var fringe_1: f32;
    var uv_21: vec2<f32>;
    var cls_10: i32;
    var water_3: f32;
    var beach_1: f32;

    s_32 = s_31;
    world_98 = world_97;
    tpi_17 = tpi_16;
    footprint_57 = footprint_56;
    let _e322 = global.uMaterialClimate;
    let _e325 = s_32;
    annual_2 = (_e322.x - (0.0065f * max(_e325.x, 0f)));
    let _e336 = global.uMaterialClimate;
    amplitude_1 = (6f + (0.5f * max(0f, (10f - _e336.x))));
    let _e343 = global.uMaterialClimate;
    rain_1 = _e343.y;
    let _e349 = rain_1;
    let _e352 = global.uMaterialClimate;
    let _e359 = sstep(0.35f, 1f, (_e349 / max(120f, ((20f * _e352.x) + 280f))));
    arid_2 = (1f - _e359);
    if (uForest == 1i) {
        let _e364 = world_98;
        let _e366 = footprint_57;
        let _e368 = forestBankCover(_e364, max(1f, _e366));
        local_345 = _e368;
    } else {
        local_345 = 0f;
    }
    let _e371 = local_345;
    bank_7 = _e371;
    let _e373 = v2Zoned();
    if _e373 {
        let _e374 = v2SeasonClimate();
        local_346 = _e374;
    } else {
        local_346 = vec3(0f);
    }
    let _e378 = local_346;
    year_1 = _e378;
    let _e380 = world_98;
    let _e385 = s_32;
    let _e387 = s_32;
    let _e389 = tpi_17;
    let _e390 = annual_2;
    let _e391 = amplitude_1;
    let _e393 = annual_2;
    let _e394 = amplitude_1;
    let _e396 = year_1;
    let _e399 = rain_1;
    let _e403 = year_1;
    let _e407 = rain_1;
    let _e411 = year_1;
    let _e417 = arid_2;
    let _e420 = bank_7;
    let _e421 = global.uV2Season;
    let _e426 = footprint_57;
    let _e427 = global.uMaterialSeed;
    let _e428 = v2Evaluate(vec3<f32>(_e380.x, _e380.y, 0f), _e385.x, _e387.yz, _e389, (_e390 + _e391), ((_e393 - _e394) - _e396.y), ((_e399 * 0.5f) * (1f + _e403.x)), ((_e407 * 0.5f) * (1f - _e411.x)), (0.15f + (0.5f * _e417)), _e420, fract(((_e421 + 1f) - V2_SEASON_LAG)), _e426, _e427);
    e_27 = _e428;
    let _e430 = v2Zoned();
    if _e430 {
        let _e431 = v2SeasonThaw();
        local_347 = _e431;
    } else {
        local_347 = 0f;
    }
    let _e434 = local_347;
    thaw_1 = _e434;
    let _e436 = thaw_1;
    if (_e436 != 0f) {
        {
            let _e439 = annual_2;
            let _e440 = amplitude_1;
            warmest_3 = (_e439 + _e440);
            let _e443 = annual_2;
            let _e444 = amplitude_1;
            let _e446 = year_1;
            coldest_1 = ((_e443 - _e444) - _e446.y);
            let _e450 = rain_1;
            let _e453 = warmest_3;
            let _e454 = coldest_1;
            supply_3 = clamp((_e450 / max(120f, ((10f * (_e453 + _e454)) + 280f))), 0f, 5f);
            let _e465 = s_32;
            slope_19 = length(_e465.yz);
            let _e470 = e_27;
            let _e472 = thaw_1;
            let _e474 = supply_3;
            let _e475 = slope_19;
            let _e479 = tpi_17;
            let _e480 = sstep(0f, -0.1f, _e479);
            let _e481 = v2Snow((_e470.temperature + _e472), _e474, _e475, _e480);
            let _e482 = warmest_3;
            let _e484 = e_27;
            let _e490 = supply_3;
            let _e491 = slope_19;
            let _e492 = v2PerennialSnow((_e482 + (0.65f * (_e484.exposure - 0.5f))), _e490, _e491);
            e_27.snow = max(_e481, _e492);
        }
    }
    let _e494 = s_32;
    slope_20 = length(_e494.yz);
    let _e500 = slope_20;
    let _e501 = sstep(0.35f, 0.9f, _e500);
    steep_1 = _e501;
    let _e505 = e_27;
    let _e507 = sstep(0f, 0.2f, _e505.snow);
    let _e511 = e_27;
    let _e513 = sstep(0.85f, 1f, _e511.snow);
    window = (_e507 * (1f - _e513));
    let _e521 = window;
    if (_e521 > 0f) {
        {
            let _e528 = global.uQuality;
            if (_e528 == 0i) {
                {
                    let _e533 = v2SeasonSnowPatches();
                    let _e538 = e_27;
                    ragged_3 = ((0.5f + (1.25f * _e533)) * mix(0.85f, 1.3f, clamp(_e538.rock, 0f, 1f)));
                    loop {
                        let _e548 = k_41;
                        if !((_e548 < 7i)) {
                            break;
                        }
                        {
                            let _e555 = k_41;
                            if (_e555 == 0i) {
                                local_353 = 640f;
                            } else {
                                let _e559 = k_41;
                                if (_e559 == 1i) {
                                    local_352 = 300f;
                                } else {
                                    let _e563 = k_41;
                                    if (_e563 == 2i) {
                                        local_351 = 140f;
                                    } else {
                                        let _e567 = k_41;
                                        if (_e567 == 3i) {
                                            local_350 = 60f;
                                        } else {
                                            let _e571 = k_41;
                                            if (_e571 == 4i) {
                                                local_349 = 24f;
                                            } else {
                                                let _e575 = k_41;
                                                if (_e575 == 5i) {
                                                    local_348 = 10f;
                                                } else {
                                                    local_348 = 4.2f;
                                                }
                                                let _e581 = local_348;
                                                local_349 = _e581;
                                            }
                                            let _e583 = local_349;
                                            local_350 = _e583;
                                        }
                                        let _e585 = local_350;
                                        local_351 = _e585;
                                    }
                                    let _e587 = local_351;
                                    local_352 = _e587;
                                }
                                let _e589 = local_352;
                                local_353 = _e589;
                            }
                            let _e591 = local_353;
                            scale_14 = _e591;
                            let _e593 = footprint_57;
                            let _e594 = scale_14;
                            if (_e593 < (_e594 * 0.3f)) {
                                {
                                    let _e598 = k_41;
                                    if (_e598 == 0i) {
                                        local_359 = vec2<f32>(0.8f, 0.6f);
                                    } else {
                                        let _e604 = k_41;
                                        if (_e604 == 1i) {
                                            local_358 = vec2<f32>(0.31f, -0.95f);
                                        } else {
                                            let _e611 = k_41;
                                            if (_e611 == 2i) {
                                                local_357 = vec2<f32>(-0.7f, 0.71f);
                                            } else {
                                                let _e618 = k_41;
                                                if (_e618 == 3i) {
                                                    local_356 = vec2<f32>(0.54f, 0.84f);
                                                } else {
                                                    let _e624 = k_41;
                                                    if (_e624 == 4i) {
                                                        local_355 = vec2<f32>(-0.91f, 0.41f);
                                                    } else {
                                                        let _e631 = k_41;
                                                        if (_e631 == 5i) {
                                                            local_354 = vec2<f32>(0.28f, -0.96f);
                                                        } else {
                                                            local_354 = vec2<f32>(-0.66f, -0.75f);
                                                        }
                                                        let _e644 = local_354;
                                                        local_355 = _e644;
                                                    }
                                                    let _e646 = local_355;
                                                    local_356 = _e646;
                                                }
                                                let _e648 = local_356;
                                                local_357 = _e648;
                                            }
                                            let _e650 = local_357;
                                            local_358 = _e650;
                                        }
                                        let _e652 = local_358;
                                        local_359 = _e652;
                                    }
                                    let _e654 = local_359;
                                    r_6 = _e654;
                                    let _e656 = r_6;
                                    let _e658 = world_98;
                                    let _e661 = r_6;
                                    let _e663 = world_98;
                                    let _e667 = r_6;
                                    let _e669 = world_98;
                                    let _e672 = r_6;
                                    let _e674 = world_98;
                                    let _e680 = scale_14;
                                    let _e681 = footprint_57;
                                    let _e682 = global.uMaterialSeed;
                                    let _e683 = k_41;
                                    if (_e683 < 3i) {
                                        local_360 = 723u;
                                    } else {
                                        local_360 = 1790u;
                                    }
                                    let _e689 = local_360;
                                    let _e691 = k_41;
                                    let _e694 = v2Pattern(vec3<f32>(((_e656.x * _e658.x) - (_e661.y * _e663.y)), ((_e667.y * _e669.x) + (_e672.x * _e674.y)), 0f), _e680, _e681, ((_e682 + _e689) + u32(_e691)));
                                    v_19 = _e694;
                                    let _e696 = k_41;
                                    if (_e696 < 3i) {
                                        let _e699 = drift_1;
                                        let _e700 = k_41;
                                        if (_e700 == 0i) {
                                            local_362 = 0.55f;
                                        } else {
                                            let _e704 = k_41;
                                            if (_e704 == 1i) {
                                                local_361 = 0.3f;
                                            } else {
                                                local_361 = 0.15f;
                                            }
                                            let _e710 = local_361;
                                            local_362 = _e710;
                                        }
                                        let _e712 = local_362;
                                        let _e713 = v_19;
                                        drift_1 = (_e699 + (_e712 * _e713));
                                    } else {
                                        {
                                            let _e716 = k_41;
                                            if (_e716 == 3i) {
                                                local_365 = 0.044f;
                                            } else {
                                                let _e720 = k_41;
                                                if (_e720 == 4i) {
                                                    local_364 = 0.035f;
                                                } else {
                                                    let _e724 = k_41;
                                                    if (_e724 == 5i) {
                                                        local_363 = 0.027f;
                                                    } else {
                                                        local_363 = 0.02f;
                                                    }
                                                    let _e730 = local_363;
                                                    local_364 = _e730;
                                                }
                                                let _e732 = local_364;
                                                local_365 = _e732;
                                            }
                                            let _e734 = local_365;
                                            let _e735 = ragged_3;
                                            a_29 = (_e734 * _e735);
                                            let _e739 = scale_14;
                                            let _e742 = scale_14;
                                            let _e745 = footprint_57;
                                            let _e746 = sstep((_e739 * 0.12f), (_e742 * 0.3f), _e745);
                                            keep_14 = (1f - _e746);
                                            let _e749 = fine_14;
                                            let _e750 = a_29;
                                            let _e751 = v_19;
                                            fine_14 = (_e749 + (_e750 * _e751));
                                            let _e754 = spread_1;
                                            let _e755 = a_29;
                                            let _e756 = a_29;
                                            let _e758 = keep_14;
                                            let _e760 = keep_14;
                                            spread_1 = (_e754 + (((_e755 * _e756) * _e758) * _e760));
                                        }
                                    }
                                }
                            }
                        }
                        continuing {
                            let _e552 = k_41;
                            k_41 = (_e552 + 1i);
                        }
                    }
                }
            }
            let _e765 = steep_1;
            let _e770 = tpi_17;
            let _e771 = sstep(0f, -0.1f, _e770);
            let _e774 = tpi_17;
            let _e775 = sstep(0f, 0.1f, _e774);
            let _e779 = s_32;
            let _e783 = slope_20;
            let _e789 = slope_20;
            let _e790 = sstep(0.35f, 0.8f, _e789);
            relief_1 = ((mix(0.16f, 0.24f, _e765) * (_e771 - _e775)) - (((0.08f * _e779.z) / max(0.2f, _e783)) * (1f - _e790)));
            let _e797 = v2SeasonSnowPatches();
            let _e799 = drift_1;
            let _e801 = relief_1;
            let _e803 = fine_14;
            let _e805 = window;
            bend_3 = ((((mix(0.12f, 0.3f, _e797) * _e799) + _e801) + _e803) * _e805);
        }
    }
    let _e809 = spread_1;
    cut_1 = sqrt(max((0.015625f - (4.6f * _e809)), 0.0004f));
    let _e816 = e_27;
    let _e818 = bend_3;
    pack_1 = (_e816.snow + _e818);
    let _e823 = cut_1;
    let _e826 = cut_1;
    let _e828 = pack_1;
    let _e829 = sstep((0.45f - _e823), (0.45f + _e826), _e828);
    e_27.snow = _e829;
    let _e833 = pack_1;
    let _e834 = sstep(0.45f, 0.56f, _e833);
    let _e839 = footprint_57;
    let _e840 = sstep(2f, 12f, _e839);
    v2WinterThin = ((1f - _e834) * (1f - _e840));
    let _e843 = s_32;
    let _e846 = v2WinterClimate(_e843.x, 0f);
    let _e847 = v2WinterFreeze(_e846);
    v2WinterFresh = _e847;
    if (uForest == 1i) {
        {
            let _e850 = world_98;
            let _e852 = forestField(_e850, 0f);
            f_19 = _e852;
            let _e855 = f_19;
            e_27.woody = _e855.x;
            let _e858 = f_19;
            e_27.height = (_e858.y * 50f);
            let _e863 = f_19;
            e_27.needle = _e863.z;
            let _e866 = e_27;
            let _e869 = e_27;
            e_27.leaf = mix(_e866.leaf, 1f, _e869.needle);
        }
    }
    let _e872 = v2Zoned();
    if _e872 {
        let _e874 = v2SeasonLeaf();
        let _e876 = e_27;
        e_27.leaf = mix(_e874, 1f, _e876.needle);
    }
    v2ZoneWet = 0f;
    v2ZoneBare = 0f;
    let _e881 = v2Zoned();
    if _e881 {
        let _e883 = s_32;
        let _e884 = world_98;
        let _e885 = tpi_17;
        let _e886 = footprint_57;
        v2ZoneEnv((&e_27), _e883, _e884, _e885, _e886);
    }
    let _e888 = v2Zoned();
    if _e888 {
        let _e889 = bank_7;
        if (_e889 > 0f) {
            {
                let _e892 = bank_7;
                let _e896 = slope_20;
                let _e897 = sstep(0.12f, 0.45f, _e896);
                let _e901 = e_27;
                let _e906 = s_32;
                let _e911 = e_27;
                fringe_1 = ((((_e892 * (1f - _e897)) * (1f - _e901.snow)) * step(0f, _e906.x)) * (1f - clamp(_e911.rock, 0f, 1f)));
                let _e920 = e_27;
                let _e923 = fringe_1;
                e_27.grass = max(_e920.grass, (0.9f * _e923));
                let _e926 = v2ZoneWet;
                let _e929 = arid_2;
                let _e931 = fringe_1;
                v2ZoneWet = max(_e926, (mix(0.4f, 0.8f, _e929) * _e931));
            }
        }
    }
    let _e934 = global.uHasOccupation;
    if (_e934 == 1i) {
        {
            let _e937 = world_98;
            let _e938 = global.uOccupationRect;
            let _e941 = global.uOccupationRect;
            uv_21 = ((_e937 - _e938.xy) / vec2(_e941.z));
            let _e946 = uv_21;
            let _e951 = uv_21;
            if (all((_e946 >= vec2(0f))) && all((_e951 <= vec2(1f)))) {
                {
                    let _e957 = world_98;
                    let _e958 = groundOccupation(_e957);
                    cls_10 = i32(_e958.z);
                    let _e962 = cls_10;
                    if (_e962 == 8i) {
                        e_27.woody = 0f;
                    }
                }
            }
        }
    }
    let _e967 = world_98;
    let _e968 = forestWaterCoverage(_e967);
    water_3 = _e968;
    let _e971 = e_27;
    let _e974 = water_3;
    e_27.woody = (_e971.woody * (1f - _e974));
    let _e978 = e_27;
    let _e981 = water_3;
    e_27.grass = (_e978.grass * (1f - _e981));
    let _e984 = renderGuideBeach;
    beach_1 = clamp((_e984 / 0.8f), 0f, 1f);
    let _e992 = e_27;
    let _e995 = beach_1;
    e_27.woody = (_e992.woody * (1f - _e995));
    let _e999 = e_27;
    let _e1002 = beach_1;
    e_27.grass = (_e999.grass * (1f - _e1002));
    let _e1006 = e_27;
    let _e1009 = beach_1;
    e_27.rock = (_e1006.rock * (1f - _e1009));
    let _e1012 = e_27;
    return _e1012;
}

fn v2GroundEnv(local_366: V2Env, s_33: vec3<f32>, world_99: vec2<f32>, footprint_58: f32, light_21: vec3<f32>, light2_4: vec3<f32>, strength_4: f32, macroOpen: vec3<f32>) -> GroundMaterial {
    var local_367: V2Env;
    var s_34: vec3<f32>;
    var world_100: vec2<f32>;
    var footprint_59: f32;
    var light_22: vec3<f32>;
    var light2_5: vec3<f32>;
    var strength_5: f32;
    var macroOpen_1: vec3<f32>;
    var macroWoods: f32;
    var baseClosed: vec3<f32>;
    var local_368: array<vec4<f32>, 11> = V2_ZONE_FOREST;
    var local_369: array<vec4<f32>, 11> = V2_ZONE_CANOPY;
    var woodsUv: vec2<f32>;
    var snowStands: f32 = 0f;
    var cell_20: f32;
    var stands_1: f32;
    var e_28: V2Env;
    var local_370: f32;
    var woods_2: f32;
    var opened: vec3<f32>;
    var snowDrift: f32 = 0f;
    var snowGrain_2: f32 = 0f;
    var snowLee: f32 = 0f;
    var sun_13: vec2<f32>;
    var k_42: i32 = 0i;
    var local_371: f32;
    var scale_15: f32;
    var local_372: vec2<f32>;
    var local_373: vec2<f32>;
    var q_25: vec2<f32>;
    var local_374: u32;
    var v_20: f32;
    var snowRelief: f32;
    var snowColor: vec3<f32>;
    var canopyPhase: V2Env;
    var leafOn: V2Env;
    var closed_1: vec3<f32>;
    var frost_1: f32;
    var meanClosed: vec3<f32>;
    var m_12: GroundMaterial;
    var detail_5: vec4<f32>;
    var gain_2: f32;
    var sward_1: f32;
    var form_2: f32;
    var standFloor: vec3<f32>;
    var crownGrain: f32 = 1f;
    var forestUv: vec2<f32>;
    var cell_21: f32;
    var f_20: vec4<f32>;
    var st_27: ForestStand;
    var T_1: f32;
    var humid_4: f32;
    var kind_15: vec3<f32>;
    var d_26: f32;
    var share_6: f32;
    var available_1: f32;
    var canopy_2: f32;
    var bareGuide: vec3<f32>;
    var crownBare: vec3<f32>;
    var crownMean: vec3<f32>;

    local_367 = local_366;
    s_34 = s_33;
    world_100 = world_99;
    footprint_59 = footprint_58;
    light_22 = light_21;
    light2_5 = light2_4;
    strength_5 = strength_4;
    macroOpen_1 = macroOpen;
    let _e330 = renderGuideWoods;
    let _e332 = renderGuideBeach;
    macroWoods = (_e330 * (1f - clamp((_e332 / 0.8f), 0f, 1f)));
    let _e341 = renderGuideBaseClosed;
    baseClosed = _e341;
    let _e343 = v2Zoned();
    if _e343 {
        {
            let _e344 = macroWoods;
            let _e345 = v2Zone();
            let _e349 = local_368[_e345];
            macroWoods = min((_e344 * _e349.x), 1f);
            let _e354 = baseClosed;
            let _e355 = v2Zone();
            let _e359 = local_369[_e355];
            baseClosed = (_e354 * _e359.xyz);
        }
    }
    let _e362 = world_100;
    let _e363 = global.uForestRect;
    let _e366 = global.uForestRect;
    woodsUv = ((_e362 - _e363.xy) / vec2(_e366.z));
    let _e375 = local_367;
    let _e380 = woodsUv;
    let _e386 = woodsUv;
    if ((((uForest == 1i) && (_e375.snow > 0f)) && all((_e380 >= vec2(0f)))) && all((_e386 <= vec2(1f)))) {
        {
            let _e392 = global.uForestRect;
            let _e395 = textureDimensions(uForestField, 0i);
            cell_20 = (_e392.z / f32(vec2<i32>(_e395).x));
            let _e401 = world_100;
            let _e402 = footprint_59;
            let _e405 = cell_20;
            let _e410 = forestField(_e401, max(log2((max(_e402, 0.02f) / _e405)), 0f));
            let _e413 = renderGuideBeach;
            stands_1 = (_e410.x * (1f - clamp((_e413 / 0.8f), 0f, 1f)));
            let _e422 = macroWoods;
            let _e423 = macroWoods;
            let _e424 = stands_1;
            let _e426 = local_367;
            macroWoods = mix(_e422, max(_e423, _e424), _e426.snow);
            let _e429 = stands_1;
            let _e430 = local_367;
            snowStands = (_e429 * _e430.snow);
        }
    }
    let _e433 = local_367;
    let _e434 = footprint_59;
    let _e435 = v2Appearance(_e433, _e434);
    e_28 = _e435;
    let _e437 = e_28;
    v2Foliage = _e437.leaf;
    let _e439 = e_28;
    v2GroundSnow = _e439.snow;
    v2GroundFormSlope = vec2(0f);
    if (uForest == 1i) {
        let _e445 = macroWoods;
        local_370 = _e445;
    } else {
        let _e446 = e_28;
        local_370 = _e446.woody;
    }
    let _e449 = local_370;
    let _e450 = e_28;
    let _e452 = forestCrownShow(_e450.leaf);
    let _e455 = v2ZoneBare;
    woods_2 = ((_e449 * _e452) * (1f - _e455));
    let _e459 = woods_2;
    let _e460 = snowStands;
    let _e461 = e_28;
    let _e463 = forestCrownShow(_e461.leaf);
    woods_2 = max(_e459, (_e460 * _e463));
    let _e466 = macroOpen_1;
    let _e467 = e_28;
    let _e468 = v2GroundTint(_e466, _e467);
    opened = _e468;
    let _e470 = v2Zoned();
    if _e470 {
        {
            let _e471 = opened;
            let _e472 = e_28;
            let _e473 = world_100;
            let _e474 = footprint_59;
            let _e475 = v2ZoneOpen(_e471, _e472, _e473, _e474);
            opened = _e475;
            let _e476 = opened;
            let _e479 = v2SeasonHerb();
            let _e480 = e_28;
            let _e485 = e_28;
            opened = (_e476 * mix(vec3(1f), _e479, vec3((max(_e480.grass, 0.3f) * (1f - _e485.rock)))));
        }
    }
    let _e492 = opened;
    let _e493 = renderGuideSediment;
    let _e496 = renderGuideFlats;
    let _e497 = e_28;
    let _e499 = renderGuideShore;
    let _e500 = renderGuideOpenness;
    let _e501 = v2FlatSedimentExposure(_e497.grass, _e499, _e500);
    opened = mix(_e492, (_e493 * 0.9f), vec3((_e496 * _e501)));
    let _e511 = global.uQuality;
    let _e514 = e_28;
    if ((_e511 == 0i) && (_e514.snow > 0f)) {
        {
            let _e519 = light_22;
            let _e521 = light_22;
            sun_13 = (_e519.xz / vec2(max(length(_e521.xz), 0.001f)));
            loop {
                let _e531 = k_42;
                if !((_e531 < 3i)) {
                    break;
                }
                {
                    let _e538 = k_42;
                    if (_e538 == 2i) {
                        local_371 = 3.2f;
                    } else {
                        local_371 = 11f;
                    }
                    let _e544 = local_371;
                    scale_15 = _e544;
                    let _e546 = footprint_59;
                    let _e547 = scale_15;
                    if (_e546 < (_e547 * 0.3f)) {
                        {
                            let _e551 = k_42;
                            if (_e551 == 2i) {
                                let _e554 = world_100;
                                local_373 = _e554;
                            } else {
                                let _e563 = world_100;
                                let _e564 = k_42;
                                if (_e564 == 1i) {
                                    let _e568 = sun_13;
                                    local_372 = (1.2f * _e568);
                                } else {
                                    local_372 = vec2(0f);
                                }
                                let _e573 = local_372;
                                local_373 = (mat2x2<f32>(vec2<f32>(0.8f, 0.6f), vec2<f32>(-0.6f, 0.8f)) * (_e563 + _e573));
                            }
                            let _e577 = local_373;
                            q_25 = _e577;
                            let _e579 = q_25;
                            let _e584 = scale_15;
                            let _e585 = footprint_59;
                            let _e586 = global.uMaterialSeed;
                            let _e587 = k_42;
                            if (_e587 == 2i) {
                                local_374 = 727u;
                            } else {
                                local_374 = 726u;
                            }
                            let _e593 = local_374;
                            let _e595 = v2Pattern(vec3<f32>(_e579.x, _e579.y, 0f), _e584, _e585, (_e586 + _e593));
                            v_20 = _e595;
                            let _e597 = k_42;
                            if (_e597 == 0i) {
                                let _e600 = v_20;
                                snowDrift = _e600;
                            } else {
                                let _e601 = k_42;
                                if (_e601 == 1i) {
                                    let _e604 = v_20;
                                    let _e605 = snowDrift;
                                    snowLee = (_e604 - _e605);
                                } else {
                                    let _e607 = v_20;
                                    snowGrain_2 = _e607;
                                }
                            }
                        }
                    }
                }
                continuing {
                    let _e535 = k_42;
                    k_42 = (_e535 + 1i);
                }
            }
        }
    }
    let _e610 = snowLee;
    let _e612 = light_22;
    let _e615 = light_22;
    snowRelief = clamp(((-0.2f * _e610) * min((length(_e612.xz) / max(_e615.y, 0.3f)), 2f)), -0.1f, 0.1f);
    let _e634 = snowDrift;
    let _e644 = snowGrain_2;
    let _e647 = snowRelief;
    snowColor = (vec3<f32>(0.88f, 0.91f, 0.91f) * (((1f + (0.035f * clamp((_e634 * 1.7f), -1f, 1f))) + (0.018f * _e644)) + _e647));
    let _e651 = opened;
    let _e652 = snowColor;
    let _e653 = e_28;
    let _e657 = v2WinterThin;
    opened = mix(_e651, _e652, vec3((_e653.snow * (1f - (0.35f * _e657)))));
    let _e663 = opened;
    let _e664 = renderGuideSediment;
    let _e665 = renderGuideBeach;
    let _e672 = e_28;
    opened = mix(_e663, _e664, vec3((clamp((_e665 / 0.8f), 0f, 1f) * (1f - _e672.snow))));
    let _e678 = e_28;
    canopyPhase = _e678;
    canopyPhase.snow = 0f;
    let _e682 = canopyPhase;
    leafOn = _e682;
    leafOn.leaf = 1f;
    let _e686 = baseClosed;
    let _e687 = canopyPhase;
    let _e688 = v2Canopy(_e687);
    let _e690 = leafOn;
    let _e691 = v2Canopy(_e690);
    closed_1 = ((_e686 * _e688) / max(_e691, vec3(0.02f)));
    let _e697 = closed_1;
    v2CrownGuide = _e697;
    let _e698 = e_28;
    let _e700 = e_28;
    let _e702 = forestSnowLoad(_e700.needle);
    frost_1 = (_e698.snow * _e702);
    let _e705 = closed_1;
    meanClosed = _e705;
    let _e707 = global.uQuality;
    if (_e707 == 0i) {
        let _e710 = closed_1;
        let _e713 = closed_1;
        let _e714 = e_28;
        let _e716 = light_22;
        let _e717 = light2_5;
        let _e718 = strength_5;
        let _e719 = v2CanopyMeanRatio(_e713, _e714.needle, _e716, _e717, _e718);
        let _e721 = e_28;
        let _e724 = e_28;
        meanClosed = (_e710 * mix(vec3(1f), _e719, vec3((1f - (_e721.snow * (1f - _e724.needle))))));
    }
    let _e732 = closed_1;
    let _e737 = frost_1;
    closed_1 = mix(_e732, vec3<f32>(0.72f, 0.79f, 0.77f), vec3(_e737));
    let _e740 = meanClosed;
    let _e745 = frost_1;
    meanClosed = mix(_e740, vec3<f32>(0.72f, 0.79f, 0.77f), vec3(_e745));
    let _e748 = meanClosed;
    let _e749 = renderGuideSediment;
    let _e752 = renderGuideFlats;
    let _e754 = e_28;
    v2MacroCanopy = mix(_e748, (_e749 * 0.9f), vec3((_e752 * (1f - _e754.snow))));
    let _e761 = world_100;
    let _e764 = world_100;
    let _e767 = global.uMaterialSeed;
    let _e768 = footprint_59;
    let _e769 = groundField(vec3<f32>(_e761.x, 0f, _e764.y), _e767, _e768);
    let _e771 = surfaceRockSlope;
    let _e774 = surfaceRockSlope;
    detail_5 = (_e769 + vec4<f32>(0f, _e771.x, 0f, _e774.y));
    let _e781 = e_28;
    let _e787 = e_28;
    let _e793 = e_28;
    gain_2 = mix(((0.02f + (0.43f * _e781.rock)) + (0.07f * (1f - _e787.grass))), 0.008f, _e793.snow);
    let _e798 = s_34;
    let _e801 = v2GroundFormSlope;
    let _e804 = detail_5;
    let _e806 = gain_2;
    let _e810 = s_34;
    let _e813 = v2GroundFormSlope;
    let _e816 = detail_5;
    let _e818 = gain_2;
    m_12.normal = normalize(vec3<f32>(((-(_e798.y) - _e801.x) - (_e804.y * _e806)), 1f, ((-(_e810.z) - _e813.y) - (_e816.w * _e818))));
    let _e823 = detail_5;
    let _e833 = e_28;
    let _e837 = e_28;
    let _e842 = footprint_59;
    let _e843 = groundVisibility(0.32f, _e842);
    sward_1 = ((((clamp((_e823.x * 4f), -1f, 1f) * 0.025f) * _e833.grass) * (1f - _e837.snow)) * _e843);
    let _e846 = detail_5;
    form_2 = clamp((_e846.x * 10f), -1f, 1f);
    let _e856 = form_2;
    let _e859 = e_28;
    let _e863 = e_28;
    let _e868 = sward_1;
    v2FloorModulation = ((1f + (_e856 * mix(mix(0.04f, 0.06f, _e859.rock), 0.006f, _e863.snow))) + _e868);
    let _e870 = s_34;
    let _e873 = v2GroundFormSlope;
    let _e877 = s_34;
    let _e880 = v2GroundFormSlope;
    v2MacroNormal = normalize(vec3<f32>((-(_e870.y) - _e873.x), 1f, (-(_e877.z) - _e880.y)));
    let _e885 = opened;
    let _e886 = opened;
    let _e897 = snowStands;
    let _e898 = e_28;
    standFloor = mix(_e885, ((_e886 * vec3<f32>(0.45f, 0.48f, 0.5f)) + vec3<f32>(0.03f, 0.04f, 0.03f)), vec3((_e897 * _e898.needle)));
    let _e906 = global.uQuality;
    if (_e906 == 0i) {
        let _e910 = snowStands;
        let _e912 = world_100;
        let _e918 = footprint_59;
        let _e919 = global.uMaterialSeed;
        let _e922 = v2Pattern(vec3<f32>(_e912.x, _e912.y, 0f), 45f, _e918, (_e919 + 761u));
        let _e925 = world_100;
        let _e931 = footprint_59;
        let _e932 = global.uMaterialSeed;
        let _e935 = v2Pattern(vec3<f32>(_e925.x, _e925.y, 0f), 14f, _e931, (_e932 + 762u));
        crownGrain = (1f + (_e910 * ((0.22f * _e922) + (0.14f * _e935))));
    }
    let _e941 = standFloor;
    let _e942 = forestFloorAlbedo(_e941);
    let _e943 = v2MacroCanopy;
    let _e944 = groundToLinear(_e943);
    let _e945 = crownGrain;
    let _e947 = woods_2;
    m_12.albedo = mix(_e942, (_e944 * _e945), vec3(_e947));
    let _e953 = e_28;
    let _e958 = gain_2;
    let _e959 = gain_2;
    let _e961 = footprint_59;
    let _e962 = groundSlopeVariance(_e961);
    m_12.roughness = clamp(pow((pow(mix(0.88f, 0.54f, _e953.rock), 4f) + ((_e958 * _e959) * _e962)), 0.25f), 0.4f, 0.98f);
    let _e973 = detail_5;
    let _e982 = surfaceRockCavity;
    let _e984 = surfaceRockCavity;
    let _e989 = e_28;
    let _e994 = e_28;
    m_12.occlusion = clamp((1f - (((0.1f * max((-(_e973.x) * 12f), 0f)) + ((0.09f * (_e982.x + _e984.y)) * (1f - _e989.snow))) * _e994.rock)), 0.8f, 1f);
    v2MeanEnabled = 0f;
    v2ForestReveal = 0f;
    let _e1003 = m_12;
    v2MeanOpen = _e1003;
    let _e1005 = opened;
    let _e1006 = forestFloorAlbedo(_e1005);
    v2MeanOpen.albedo = _e1006;
    let _e1007 = v2MeanOpen;
    v2MeanLitter = _e1007;
    let _e1008 = v2MeanOpen;
    v2MeanCrown = _e1008;
    v2MeanWeights = vec3<f32>(1f, 0f, 0f);
    let _e1013 = world_100;
    let _e1014 = global.uForestRect;
    let _e1017 = global.uForestRect;
    forestUv = ((_e1013 - _e1014.xy) / vec2(_e1017.z));
    let _e1022 = global.uQuality;
    let _e1028 = global.uHasOccupation;
    let _e1032 = world_100;
    let _e1034 = footprint_59;
    let _e1036 = forestBankCover(_e1032, max(1f, _e1034));
    let _e1040 = forestUv;
    let _e1046 = forestUv;
    if ((((((_e1022 == 0i) && (uForest == 1i)) && (_e1028 == 0i)) && (_e1036 < 0.001f)) && all((_e1040 >= vec2(0f)))) && all((_e1046 <= vec2(1f)))) {
        {
            let _e1052 = global.uForestRect;
            let _e1055 = textureDimensions(uForestField, 0i);
            cell_21 = (_e1052.z / f32(vec2<i32>(_e1055).x));
            let _e1061 = world_100;
            let _e1062 = footprint_59;
            let _e1065 = cell_21;
            let _e1070 = forestField(_e1061, max(log2((max(_e1062, 0.02f) / _e1065)), 0f));
            f_20 = _e1070;
            st_27.orchard = false;
            st_27.rows = vec2<f32>(1f, 0f);
            let _e1080 = world_100;
            st_27.p = _e1080;
            let _e1082 = f_20;
            st_27.cover = _e1082.x;
            let _e1085 = f_20;
            st_27.height = (_e1085.y * 50f);
            let _e1090 = f_20;
            st_27.needle = _e1090.z;
            let _e1093 = f_20;
            st_27.tone = _e1093.w;
            let _e1095 = global.uMaterialClimate;
            T_1 = _e1095.x;
            let _e1098 = global.uMaterialClimate;
            let _e1101 = T_1;
            humid_4 = (_e1098.y / max(((20f * _e1101) + 280f), 120f));
            let _e1112 = T_1;
            let _e1115 = groundSmooth(13f, 19f, (_e1112 - 6f));
            st_27.trop = _e1115;
            let _e1120 = humid_4;
            let _e1121 = groundSmooth(0.8f, 2f, _e1120);
            st_27.dry = (1f - _e1121);
            let _e1123 = st_27;
            let _e1125 = st_27;
            let _e1127 = forestKind(_e1123.trop, _e1125.dry);
            kind_15 = _e1127;
            let _e1134 = humid_4;
            let _e1135 = groundSmooth(0.9f, 1.8f, _e1134);
            let _e1141 = st_27;
            let _e1143 = groundSmooth(3f, 10f, _e1141.height);
            let _e1148 = st_27;
            let _e1154 = st_27;
            let _e1161 = kind_15;
            let _e1168 = kind_15;
            st_27.kappa = (((((mix(0.25f, 0.78f, _e1135) * mix(0.55f, 1f, _e1143)) * mix(1f, 0.85f, _e1148.needle)) * (1f - (0.6f * _e1154.trop))) * (1f - (0.5f * _e1161.x))) * (1f - (0.85f * _e1168.z)));
            st_27.open = -1000f;
            st_27.forced = -1000f;
            st_27.allow = 0f;
            st_27.hedge = 0f;
            let _e1183 = st_27;
            let _e1185 = st_27;
            let _e1187 = forestDensity(_e1183.cover, _e1185.kappa);
            d_26 = _e1187;
            let _e1189 = st_27;
            let _e1191 = d_26;
            share_6 = (_e1189.cover / max(_e1191, 0.001f));
            let _e1197 = renderGuideBeach;
            let _e1205 = world_100;
            let _e1206 = forestWaterCoverage(_e1205);
            let _e1210 = v2ZoneBare;
            available_1 = (((1f - clamp((_e1197 / 0.8f), 0f, 1f)) * (1f - _e1206)) * (1f - _e1210));
            let _e1214 = st_27;
            let _e1216 = e_28;
            let _e1218 = forestCrownShow(_e1216.leaf);
            let _e1220 = available_1;
            canopy_2 = ((_e1214.cover * _e1218) * _e1220);
            let _e1223 = share_6;
            let _e1224 = available_1;
            let _e1226 = st_27;
            let _e1228 = forestClosure(_e1226.cover);
            let _e1230 = canopy_2;
            share_6 = max(((_e1223 * _e1224) * _e1228), _e1230);
            let _e1233 = share_6;
            let _e1235 = share_6;
            let _e1236 = canopy_2;
            let _e1240 = canopy_2;
            v2MeanWeights = vec3<f32>((1f - _e1233), max((_e1235 - _e1236), 0f), _e1240);
            let _e1243 = opened;
            let _e1244 = st_27;
            let _e1248 = T_1;
            let _e1251 = groundSmooth(8f, 16f, (_e1248 + 6f));
            let _e1253 = forestFloor(_e1243, _e1244, (1f - _e1251));
            let _e1254 = forestFloorAlbedo(_e1253);
            v2MeanLitter.albedo = _e1254;
            let _e1256 = v2MeanLitter;
            v2MeanLitter.occlusion = (_e1256.occlusion * 0.72f);
            let _e1260 = baseClosed;
            let _e1261 = canopyPhase;
            let _e1262 = v2Canopy(_e1261);
            let _e1264 = leafOn;
            let _e1265 = v2Canopy(_e1264);
            bareGuide = ((_e1260 * _e1262) / max(_e1265, vec3(0.02f)));
            let _e1271 = st_27;
            let _e1272 = bareGuide;
            let _e1273 = st_27;
            let _e1278 = forestCrownColor(_e1271, _e1272, _e1273.needle, vec2(0f), 0f);
            crownBare = _e1278;
            let _e1280 = crownBare;
            let _e1283 = crownBare;
            let _e1284 = st_27;
            let _e1286 = light_22;
            let _e1287 = light2_5;
            let _e1288 = strength_5;
            let _e1289 = v2CanopyMeanRatio(_e1283, _e1284.needle, _e1286, _e1287, _e1288);
            let _e1291 = e_28;
            let _e1294 = st_27;
            crownMean = (_e1280 * mix(vec3(1f), _e1289, vec3((1f - (_e1291.snow * (1f - _e1294.needle))))));
            let _e1304 = crownMean;
            let _e1305 = e_28;
            let _e1307 = st_27;
            let _e1309 = forestSnowLoad(_e1307.needle);
            let _e1311 = forestSnowed(_e1304, (_e1305.snow * _e1309));
            let _e1312 = groundToLinear(_e1311);
            v2MeanCrown.albedo = _e1312;
            let _e1314 = v2MacroNormal;
            v2MeanCrown.normal = _e1314;
            v2MeanCrown.roughness = 0.9f;
            v2MeanCrown.occlusion = 1f;
            v2MeanEnabled = 1f;
        }
    }
    let _e1320 = m_12;
    let _e1322 = groundToDisplay(_e1320.albedo);
    renderGuideColor = _e1322;
    let _e1323 = opened;
    renderGuideOpen = _e1323;
    let _e1324 = closed_1;
    renderGuideClosed = _e1324;
    let _e1325 = woods_2;
    renderGuideWoods = _e1325;
    let _e1326 = m_12;
    return _e1326;
}

fn v2ShadeGround(resolved_2: GroundMaterial, view_4: vec3<f32>, light_23: vec3<f32>, light2_6: vec3<f32>, strength_6: f32) -> vec3<f32> {
    var resolved_3: GroundMaterial;
    var view_5: vec3<f32>;
    var light_24: vec3<f32>;
    var light2_7: vec3<f32>;
    var strength_7: f32;
    var color_12: vec3<f32>;
    var openResponse: vec3<f32>;
    var litterResponse: vec3<f32>;
    var crownResponse: vec3<f32>;
    var meanResponse: vec3<f32>;

    resolved_3 = resolved_2;
    view_5 = view_4;
    light_24 = light_23;
    light2_7 = light2_6;
    strength_7 = strength_6;
    let _e324 = light_24;
    let _e326 = forestMapCover;
    let _e327 = renderGuideWoods;
    let _e329 = v2MeanWeights;
    let _e335 = v2ReliefShade(normalize(_e324), clamp(max(max(_e326, _e327), _e329.z), 0f, 1f));
    groundReliefLight = _e335;
    let _e336 = resolved_3;
    let _e337 = view_5;
    let _e338 = light_24;
    let _e339 = light2_7;
    let _e340 = strength_7;
    let _e341 = shadeTerrainGround(_e336, _e337, _e338, _e339, _e340);
    color_12 = _e341;
    let _e343 = v2MeanEnabled;
    if (_e343 >= 0.5f) {
        {
            let _e346 = v2MeanOpen;
            let _e347 = view_5;
            let _e348 = light_24;
            let _e349 = light2_7;
            let _e350 = strength_7;
            let _e351 = shadeTerrainGround(_e346, _e347, _e348, _e349, _e350);
            let _e352 = groundToLinear(_e351);
            openResponse = _e352;
            let _e354 = v2MeanLitter;
            let _e355 = view_5;
            let _e356 = light_24;
            let _e357 = light2_7;
            let _e358 = strength_7;
            let _e359 = shadeTerrainGround(_e354, _e355, _e356, _e357, _e358);
            let _e360 = groundToLinear(_e359);
            litterResponse = _e360;
            let _e362 = v2MeanCrown;
            let _e363 = view_5;
            let _e364 = light_24;
            let _e365 = light2_7;
            let _e366 = strength_7;
            let _e367 = shadeTerrainGround(_e362, _e363, _e364, _e365, _e366);
            let _e368 = groundToLinear(_e367);
            crownResponse = _e368;
            let _e370 = openResponse;
            let _e371 = v2MeanWeights;
            let _e374 = litterResponse;
            let _e375 = v2MeanWeights;
            let _e379 = crownResponse;
            let _e380 = v2MeanWeights;
            meanResponse = (((_e370 * _e371.x) + (_e374 * _e375.y)) + (_e379 * _e380.z));
            let _e385 = meanResponse;
            let _e386 = color_12;
            let _e387 = groundToLinear(_e386);
            let _e388 = v2ForestReveal;
            let _e391 = groundToDisplay(mix(_e385, _e387, vec3(_e388)));
            color_12 = _e391;
        }
    }
    groundReliefLight = vec3(1f);
    let _e394 = color_12;
    return _e394;
}

fn v2Ground(s_35: vec3<f32>, world_101: vec2<f32>, footprint_60: f32, tpi_18: f32, light_25: vec3<f32>, light2_8: vec3<f32>, strength_8: f32, macroOpen_2: vec3<f32>) -> GroundMaterial {
    var s_36: vec3<f32>;
    var world_102: vec2<f32>;
    var footprint_61: f32;
    var tpi_19: f32;
    var light_26: vec3<f32>;
    var light2_9: vec3<f32>;
    var strength_9: f32;
    var macroOpen_3: vec3<f32>;

    s_36 = s_35;
    world_102 = world_101;
    footprint_61 = footprint_60;
    tpi_19 = tpi_18;
    light_26 = light_25;
    light2_9 = light2_8;
    strength_9 = strength_8;
    macroOpen_3 = macroOpen_2;
    let _e330 = s_36;
    let _e331 = world_102;
    let _e332 = tpi_19;
    let _e333 = footprint_61;
    let _e334 = v2Local(_e330, _e331, _e332, _e333);
    let _e335 = s_36;
    let _e336 = world_102;
    let _e337 = footprint_61;
    let _e338 = light_26;
    let _e339 = light2_9;
    let _e340 = strength_9;
    let _e341 = macroOpen_3;
    let _e342 = v2GroundEnv(_e334, _e335, _e336, _e337, _e338, _e339, _e340, _e341);
    return _e342;
}

fn v2ShoreIceProgress(c_56: f32, depth_6: f32) -> f32 {
    var c_57: f32;
    var depth_7: f32;
    var reach_9: f32;

    c_57 = c_56;
    depth_7 = depth_6;
    let _e320 = c_57;
    let _e322 = c_57;
    reach_9 = (2f + ((24f * _e320) * _e322));
    let _e326 = depth_7;
    let _e328 = reach_9;
    let _e332 = reach_9;
    return clamp(((_e326 - (0.5f * _e328)) / ((0.5f * _e332) + 40f)), 0f, 1f);
}

fn v2ShoreIceDrop(c_58: f32, t_33: f32) -> f32 {
    var c_59: f32;
    var t_34: f32;

    c_59 = c_58;
    t_34 = t_33;
    let _e320 = c_59;
    let _e323 = t_34;
    let _e324 = sstep(mix(0.15f, 0.45f, _e320), 1f, _e323);
    return _e324;
}

fn v2ShoreIceMean(c_60: f32, t_35: f32) -> f32 {
    var c_61: f32;
    var t_36: f32;

    c_61 = c_60;
    t_36 = t_35;
    let _e319 = c_61;
    let _e320 = t_36;
    let _e321 = v2ShoreIceDrop(_e319, _e320);
    let _e327 = t_36;
    let _e328 = sstep(0.3f, 1f, _e327);
    return ((1f - _e321) * (1f - (0.25f * _e328)));
}

fn v2IceLead(x_12: f32, margin_2: f32, pw_6: f32) -> f32 {
    var x_13: f32;
    var margin_3: f32;
    var pw_7: f32;

    x_13 = x_12;
    margin_3 = margin_2;
    pw_7 = pw_6;
    let _e320 = x_13;
    let _e322 = pw_7;
    let _e325 = margin_3;
    let _e327 = x_13;
    let _e329 = pw_7;
    let _e332 = margin_3;
    let _e336 = pw_7;
    return clamp(((min((_e320 + (0.5f * _e322)), _e325) - max((_e327 - (0.5f * _e329)), -(_e332))) / _e336), 0f, 1f);
}

fn v2IcePlate(world_103: vec2<f32>, scale_16: f32, salt_50: u32) -> vec4<f32> {
    var world_104: vec2<f32>;
    var scale_17: f32;
    var salt_51: u32;
    var q_26: vec2<f32>;
    var cell_22: vec2<i32>;
    var local_375: vec2<f32>;
    var first_2: f32 = 10f;
    var second_2: f32 = 10f;
    var identity_2: f32 = 0f;
    var firstDelta_1: vec2<f32> = vec2(0f);
    var secondDelta_1: vec2<f32> = vec2(0f);
    var y_5: i32 = -1i;
    var x_14: i32;
    var h_34: u32;
    var delta_2: vec2<f32>;
    var d_27: f32;

    world_104 = world_103;
    scale_17 = scale_16;
    salt_51 = salt_50;
    let _e320 = world_104;
    let _e321 = scale_17;
    q_26 = (_e320 / vec2(_e321));
    let _e325 = q_26;
    cell_22 = vec2<i32>(floor(_e325));
    let _e329 = q_26;
    let _e330 = q_26;
    local_375 = (_e329 - floor(_e330));
    loop {
        let _e349 = y_5;
        if !((_e349 <= 1i)) {
            break;
        }
        {
            x_14 = -1i;
            loop {
                let _e359 = x_14;
                if !((_e359 <= 1i)) {
                    break;
                }
                {
                    let _e366 = cell_22;
                    let _e367 = x_14;
                    let _e368 = y_5;
                    let _e370 = (_e366 + vec2<i32>(_e367, _e368));
                    let _e375 = salt_51;
                    let _e376 = surfaceHash(vec3<i32>(_e370.x, _e370.y, 0i), _e375);
                    h_34 = _e376;
                    let _e378 = x_14;
                    let _e380 = y_5;
                    let _e387 = h_34;
                    let _e391 = h_34;
                    let _e403 = local_375;
                    delta_2 = (((vec2<f32>(f32(_e378), f32(_e380)) + vec2(0.1f)) + ((0.8f * vec2<f32>(f32((_e387 & 1023u)), f32(((_e391 >> 10u) & 1023u)))) / vec2(1023f))) - _e403);
                    let _e406 = delta_2;
                    let _e407 = delta_2;
                    d_27 = dot(_e406, _e407);
                    let _e410 = d_27;
                    let _e411 = first_2;
                    if (_e410 < _e411) {
                        {
                            let _e413 = first_2;
                            second_2 = _e413;
                            let _e414 = firstDelta_1;
                            secondDelta_1 = _e414;
                            let _e415 = d_27;
                            first_2 = _e415;
                            let _e416 = delta_2;
                            firstDelta_1 = _e416;
                            let _e417 = h_34;
                            identity_2 = (f32((_e417 >> 20u)) / 4095f);
                        }
                    } else {
                        let _e423 = d_27;
                        let _e424 = second_2;
                        if (_e423 < _e424) {
                            {
                                let _e426 = d_27;
                                second_2 = _e426;
                                let _e427 = delta_2;
                                secondDelta_1 = _e427;
                            }
                        }
                    }
                }
                continuing {
                    let _e363 = x_14;
                    x_14 = (_e363 + 1i);
                }
            }
        }
        continuing {
            let _e353 = y_5;
            y_5 = (_e353 + 1i);
        }
    }
    let _e428 = second_2;
    let _e429 = first_2;
    let _e432 = secondDelta_1;
    let _e433 = firstDelta_1;
    let _e440 = scale_17;
    let _e442 = identity_2;
    let _e443 = firstDelta_1;
    let _e444 = scale_17;
    let _e445 = (_e443 * _e444);
    return vec4<f32>((((_e428 - _e429) / max((2f * length((_e432 - _e433))), 0.00001f)) * _e440), _e442, _e445.x, _e445.y);
}

fn v2WaterColor(local_376: V2Env, world_105: vec2<f32>, footprint_62: f32, cover_22: f32, kind_16: f32, depth_8: f32) -> vec3<f32> {
    var local_377: V2Env;
    var world_106: vec2<f32>;
    var footprint_63: f32;
    var cover_23: f32;
    var kind_17: f32;
    var depth_9: f32;
    var seaIce: vec2<f32> = vec2(0f);
    var local_378: f32;
    var optical: f32;
    var share_7: f32;
    var sea_1: bool;
    var local_379: f32;
    var sediment_2: f32;
    var shallow_1: vec3<f32>;
    var local_380: vec3<f32>;
    var deep_1: vec3<f32>;
    var local_381: f32;
    var water_4: vec3<f32>;
    var ice_6: f32;
    var e_29: V2Env;
    var sea_2: bool;
    var water_5: vec3<f32>;
    var iceCover: f32 = 0f;
    var T_2: f32;
    var warm_1: f32;
    var cold_2: f32;
    var arid_3: f32;
    var shelf_3: f32;
    var lagoon: f32;
    var c_62: f32;
    var reach_10: f32;
    var raw: f32;
    var t_37: f32;
    var dw1_: vec2<f32>;
    var dw2_: vec2<f32>;
    var dt1_: f32;
    var dt2_: f32;
    var det: f32;
    var local_382: vec2<f32>;
    var gradT: vec2<f32>;
    var pw_8: f32;
    var resolved_4: f32;
    var gate: f32;
    var g_21: vec3<f32>;
    var q_27: vec2<f32>;
    var erode: f32 = 0f;
    var floe_2: vec4<f32>;
    var tf: f32;
    var scale_18: f32 = 140f;
    var lead_2: f32;
    var body_3: f32;
    var id2_: f32;
    var id3_: f32;
    var radius_11: f32;
    var slush: f32;
    var local_383: f32;
    var brash: f32;
    var grain_5: f32;
    var iceTone: vec3<f32>;

    local_377 = local_376;
    world_106 = world_105;
    footprint_63 = footprint_62;
    cover_23 = cover_22;
    kind_17 = kind_16;
    depth_9 = depth_8;
    let _e329 = kind_17;
    if (_e329 < 1.5f) {
        let _e332 = v2Zoned();
        if _e332 {
            let _e333 = v2SeasonSeaIce();
            local_378 = _e333;
        } else {
            let _e334 = kind_17;
            let _e335 = local_377;
            let _e336 = v2Freeze(_e334, _e335);
            local_378 = _e336;
        }
        let _e338 = local_378;
        let _e339 = v2WinterSeaIce(_e338);
        seaIce = _e339;
    }
    let _e340 = depth_9;
    optical = max(_e340, 0f);
    let _e344 = cover_23;
    share_7 = _e344;
    let _e346 = kind_17;
    if (_e346 > 1.5f) {
        {
            let _e349 = depth_9;
            optical = max(_e349, 2.5f);
            share_7 = 1f;
        }
    }
    let _e353 = global.uQuality;
    if (_e353 > 0i) {
        {
            let _e356 = kind_17;
            sea_1 = (_e356 < 1.5f);
            let _e360 = sea_1;
            if _e360 {
                let _e363 = local_377;
                let _e365 = sstep(0.1f, 0.9f, _e363.sand);
                let _e368 = local_377;
                let _e370 = sstep(0.1f, 1f, _e368.moisture);
                local_379 = (_e365 * _e370);
            } else {
                local_379 = 0.5f;
            }
            let _e374 = local_379;
            sediment_2 = _e374;
            let _e376 = local_377;
            let _e377 = v2Mineral(_e376);
            let _e384 = sediment_2;
            shallow_1 = mix(mix((_e377 * 0.65f), vec3<f32>(0.2f, 0.33f, 0.24f), vec3(_e384)), vec3<f32>(0.12f, 0.31f, 0.32f), vec3(0.6f));
            let _e395 = sea_1;
            if _e395 {
                let _e406 = depth_9;
                let _e407 = sstep(150f, 3000f, _e406);
                local_380 = mix(vec3<f32>(0.045f, 0.16f, 0.27f), vec3<f32>(0.018f, 0.065f, 0.15f), vec3(_e407));
            } else {
                local_380 = vec3<f32>(0.025f, 0.12f, 0.21f);
            }
            let _e415 = local_380;
            deep_1 = _e415;
            let _e417 = shallow_1;
            let _e418 = deep_1;
            let _e420 = optical;
            let _e422 = sea_1;
            if _e422 {
                local_381 = 0.035f;
            } else {
                local_381 = 0.15f;
            }
            let _e426 = local_381;
            let _e429 = share_7;
            let _e430 = share_7;
            water_4 = mix(_e417, _e418, vec3((1f - exp(((-(_e420) * _e426) * max(0.08f, (_e429 * _e430)))))));
            let _e439 = seaIce;
            let _e441 = seaIce;
            let _e443 = depth_9;
            let _e444 = v2ShoreIceProgress(_e441.x, _e443);
            let _e445 = seaIce;
            let _e447 = v2WinterPackLimit(_e445.x);
            let _e450 = seaIce;
            let _e457 = v2ShoreIceMean(_e439.x, clamp((min(_e444, _e447) + (0.65f * _e450.y)), 0f, 1f));
            let _e460 = seaIce;
            let _e462 = sstep(0.05f, 0.25f, _e460.x);
            ice_6 = (_e457 * _e462);
            if (uRenderV2_ == 5i) {
                let _e475 = ice_6;
                return mix(vec3<f32>(0.08f, 0.17f, 0.24f), vec3<f32>(0.85f, 0.94f, 1f), vec3(_e475));
            }
            if (uRenderV2_ == 4i) {
                return vec3<f32>(0f, 0f, 0.13f);
            }
            let _e484 = water_4;
            let _e489 = ice_6;
            return mix(_e484, vec3<f32>(0.84f, 0.89f, 0.91f), vec3(_e489));
        }
    }
    let _e492 = local_377;
    e_29 = _e492;
    e_29.glacier = 0f;
    let _e496 = kind_17;
    sea_2 = (_e496 < 1.5f);
    let _e500 = sea_2;
    if _e500 {
        e_29.temperature = 10f;
    } else {
        {
            e_29.sand = 0.5f;
            e_29.moisture = 1f;
        }
    }
    let _e507 = optical;
    let _e508 = kind_17;
    let _e509 = share_7;
    let _e510 = e_29;
    let _e511 = world_106;
    let _e512 = (_e511 * V2_ICE_ZOOM);
    let _e517 = footprint_63;
    let _e519 = global.uMaterialSeed;
    let _e520 = v2Water(_e507, _e508, _e509, _e510, vec3<f32>(_e512.x, _e512.y, 0f), (_e517 * V2_ICE_ZOOM), _e519);
    water_5 = _e520;
    let _e524 = sea_2;
    if _e524 {
        {
            let _e525 = local_377;
            T_2 = _e525.temperature;
            let _e530 = T_2;
            let _e531 = sstep(17f, 25f, _e530);
            warm_1 = _e531;
            let _e536 = T_2;
            let _e537 = sstep(6f, -1f, _e536);
            cold_2 = _e537;
            let _e541 = global.uMaterialClimate;
            let _e543 = sstep(500f, 150f, _e541.y);
            arid_3 = _e543;
            let _e545 = depth_9;
            shelf_3 = exp((-(max(_e545, 0f)) * 0.06f));
            let _e553 = depth_9;
            lagoon = exp((-(max(_e553, 0f)) * 0.35f));
            let _e561 = water_5;
            let _e566 = warm_1;
            let _e567 = shelf_3;
            water_5 = mix(_e561, vec3<f32>(0.07f, 0.4f, 0.46f), vec3(((_e566 * _e567) * 0.65f)));
            let _e573 = water_5;
            let _e578 = warm_1;
            let _e579 = lagoon;
            water_5 = mix(_e573, vec3<f32>(0.36f, 0.7f, 0.66f), vec3(((_e578 * _e579) * 0.5f)));
            let _e585 = water_5;
            let _e590 = arid_3;
            let _e592 = shelf_3;
            water_5 = mix(_e585, vec3<f32>(0.03f, 0.16f, 0.33f), vec3(((_e590 * (1f - _e592)) * 0.35f)));
            let _e599 = water_5;
            let _e600 = water_5;
            let _e611 = cold_2;
            water_5 = mix(_e599, ((_e600 * vec3<f32>(0.8f, 0.9f, 1f)) + vec3<f32>(0f, 0.01f, 0.02f)), vec3((_e611 * 0.6f)));
            let _e616 = seaIce;
            c_62 = _e616.x;
            let _e621 = c_62;
            let _e623 = c_62;
            reach_10 = (2f + ((24f * _e621) * _e623));
            let _e627 = depth_9;
            let _e629 = reach_10;
            let _e633 = reach_10;
            let _e638 = c_62;
            let _e639 = v2WinterPackLimit(_e638);
            let _e642 = seaIce;
            raw = (min(((_e627 - (0.5f * _e629)) / ((0.5f * _e633) + 40f)), _e639) + (0.65f * _e642.y));
            let _e647 = raw;
            t_37 = clamp(_e647, 0f, 1f);
            let _e652 = world_106;
            let _e653 = dpdx(_e652);
            dw1_ = _e653;
            let _e655 = world_106;
            let _e656 = glDFdy_1(_e655);
            dw2_ = _e656;
            let _e658 = raw;
            let _e659 = dpdx(_e658);
            dt1_ = _e659;
            let _e661 = raw;
            let _e662 = glDFdy(_e661);
            dt2_ = _e662;
            let _e664 = dw1_;
            let _e666 = dw2_;
            let _e669 = dw1_;
            let _e671 = dw2_;
            det = ((_e664.x * _e666.y) - (_e669.y * _e671.x));
            let _e676 = det;
            if (abs(_e676) > 0.000000001f) {
                let _e680 = dw2_;
                let _e682 = dt1_;
                let _e684 = dw1_;
                let _e686 = dt2_;
                let _e689 = dw1_;
                let _e691 = dt2_;
                let _e693 = dw2_;
                let _e695 = dt1_;
                let _e699 = det;
                local_382 = (vec2<f32>(((_e680.y * _e682) - (_e684.y * _e686)), ((_e689.x * _e691) - (_e693.x * _e695))) / vec2(_e699));
            } else {
                local_382 = vec2(0f);
            }
            let _e705 = local_382;
            gradT = _e705;
            let _e707 = gradT;
            let _e710 = gradT;
            gradT = (_e707 * min(1f, (0.02f / max(length(_e710), 0.000001f))));
            let _e717 = c_62;
            let _e720 = raw;
            if ((_e717 > 0.05f) && (_e720 < 1.6f)) {
                {
                    let _e724 = footprint_63;
                    pw_8 = max(_e724, 0.3f);
                    let _e731 = footprint_63;
                    let _e732 = sstep(25f, 60f, _e731);
                    resolved_4 = (1f - _e732);
                    let _e737 = c_62;
                    let _e738 = sstep(0.05f, 0.25f, _e737);
                    gate = _e738;
                    let _e740 = world_106;
                    g_21 = vec3<f32>(_e740.x, _e740.y, 0f);
                    let _e746 = world_106;
                    q_27 = _e746;
                    let _e750 = resolved_4;
                    if (_e750 > 0f) {
                        {
                            let _e753 = q_27;
                            let _e755 = g_21;
                            let _e757 = footprint_63;
                            let _e758 = global.uMaterialSeed;
                            let _e761 = v2Pattern(_e755, 260f, _e757, (_e758 + 755u));
                            let _e762 = g_21;
                            let _e770 = footprint_63;
                            let _e771 = global.uMaterialSeed;
                            let _e774 = v2Pattern((_e762 + vec3<f32>(517f, -293f, 0f)), 260f, _e770, (_e771 + 756u));
                            q_27 = (_e753 + (38f * vec2<f32>(_e761, _e774)));
                            let _e778 = g_21;
                            let _e780 = footprint_63;
                            let _e781 = global.uMaterialSeed;
                            let _e784 = v2Pattern(_e778, 16f, _e780, (_e781 + 757u));
                            erode = _e784;
                        }
                    }
                    let _e785 = q_27;
                    let _e787 = global.uMaterialSeed;
                    let _e790 = v2IcePlate(_e785, 140f, (_e787 + 751u));
                    floe_2 = _e790;
                    let _e792 = raw;
                    let _e793 = gradT;
                    let _e794 = floe_2;
                    tf = clamp((_e792 + dot(_e793, _e794.zw)), 0f, 1f);
                    let _e806 = tf;
                    let _e807 = sstep(0f, 0.15f, _e806);
                    let _e811 = tf;
                    let _e814 = floe_2;
                    let _e824 = erode;
                    lead_2 = ((_e807 * (0.3f + ((0.6f + (1.6f * _e811)) * fract((_e814.y * 3.17f))))) * max((1f + (0.9f * _e824)), 0.15f));
                    let _e832 = floe_2;
                    let _e834 = lead_2;
                    let _e835 = pw_8;
                    let _e836 = v2IceLead(_e832.x, _e834, _e835);
                    body_3 = (1f - _e836);
                    let _e839 = resolved_4;
                    let _e842 = tf;
                    let _e845 = floe_2;
                    if ((_e839 > 0f) && (_e842 > (0.15f + (0.55f * _e845.y)))) {
                        {
                            let _e851 = q_27;
                            let _e853 = global.uMaterialSeed;
                            let _e856 = v2IcePlate(_e851, 52f, (_e853 + 754u));
                            floe_2 = _e856;
                            let _e857 = raw;
                            let _e858 = gradT;
                            let _e859 = floe_2;
                            tf = clamp((_e857 + dot(_e858, _e859.zw)), 0f, 1f);
                            scale_18 = 52f;
                            let _e870 = tf;
                            let _e873 = floe_2;
                            let _e882 = erode;
                            lead_2 = ((0.3f + ((0.5f + (1.4f * _e870)) * fract((_e873.y * 3.17f)))) * max((1f + (0.9f * _e882)), 0.15f));
                            let _e888 = body_3;
                            let _e890 = floe_2;
                            let _e892 = lead_2;
                            let _e893 = pw_8;
                            let _e894 = v2IceLead(_e890.x, _e892, _e893);
                            body_3 = (_e888 * (1f - _e894));
                        }
                    }
                    let _e897 = floe_2;
                    id2_ = fract((_e897.y * 7.13f));
                    let _e903 = floe_2;
                    id3_ = fract((_e903.y * 3.17f));
                    let _e909 = scale_18;
                    let _e914 = tf;
                    let _e915 = sstep(0.25f, 1f, _e914);
                    let _e920 = erode;
                    radius_11 = ((_e909 * mix(1.3f, 0.42f, _e915)) * (1f + (0.12f * _e920)));
                    let _e925 = body_3;
                    let _e926 = radius_11;
                    let _e927 = floe_2;
                    let _e931 = pw_8;
                    let _e938 = c_62;
                    let _e939 = tf;
                    let _e940 = v2ShoreIceDrop(_e938, _e939);
                    let _e941 = id2_;
                    body_3 = (_e925 * (clamp((((_e926 - length(_e927.zw)) / _e931) + 0.5f), 0f, 1f) * step(_e940, _e941)));
                    let _e945 = body_3;
                    let _e946 = c_62;
                    let _e947 = t_37;
                    let _e948 = v2ShoreIceMean(_e946, _e947);
                    let _e950 = resolved_4;
                    let _e953 = gate;
                    iceCover = (mix(_e945, _e948, (1f - _e950)) * _e953);
                    let _e958 = t_37;
                    let _e959 = sstep(0.1f, 0.8f, _e958);
                    let _e961 = gate;
                    slush = ((1f - _e959) * _e961);
                    let _e964 = water_5;
                    let _e970 = slush;
                    water_5 = mix(_e964, vec3<f32>(0.4f, 0.5f, 0.56f), vec3((0.65f * _e970)));
                    let _e974 = resolved_4;
                    if (_e974 > 0f) {
                        let _e979 = g_21;
                        let _e981 = footprint_63;
                        let _e982 = global.uMaterialSeed;
                        let _e985 = v2Pattern(_e979, 22f, _e981, (_e982 + 758u));
                        let _e986 = sstep(0.25f, 0.6f, _e985);
                        let _e987 = slush;
                        local_383 = (_e986 * _e987);
                    } else {
                        local_383 = 0f;
                    }
                    let _e991 = local_383;
                    brash = _e991;
                    let _e994 = g_21;
                    let _e996 = footprint_63;
                    let _e997 = global.uMaterialSeed;
                    let _e1000 = v2Pattern(_e994, 120f, _e996, (_e997 + 753u));
                    grain_5 = (0.008f * _e1000);
                    let _e1013 = id3_;
                    let _e1015 = resolved_4;
                    let _e1021 = t_37;
                    let _e1022 = sstep(0.1f, 0.45f, _e1021);
                    let _e1025 = grain_5;
                    iceTone = (mix(vec3<f32>(0.75f, 0.82f, 0.87f), (vec3<f32>(0.84f, 0.89f, 0.91f) * (0.96f + ((0.07f * _e1013) * _e1015))), vec3(_e1022)) + vec3(_e1025));
                    let _e1029 = water_5;
                    let _e1030 = iceTone;
                    let _e1034 = brash;
                    water_5 = mix(_e1029, (_e1030 * 0.92f), vec3((0.7f * _e1034)));
                    let _e1038 = water_5;
                    let _e1039 = iceTone;
                    let _e1040 = iceCover;
                    water_5 = mix(_e1038, _e1039, vec3(_e1040));
                }
            }
        }
    }
    if (uRenderV2_ == 5i) {
        let _e1053 = iceCover;
        water_5 = mix(vec3<f32>(0.08f, 0.17f, 0.24f), vec3<f32>(0.85f, 0.94f, 1f), vec3(_e1053));
    }
    if (uRenderV2_ == 4i) {
        water_5 = vec3<f32>(0f, 0f, 0.13f);
    }
    let _e1062 = water_5;
    return _e1062;
}

fn v2WaterAtEnv(local_384: V2Env, rgb_4: vec3<f32>, world_107: vec2<f32>, footprint_64: f32, cover_24: f32, kind_18: f32, depth_10: f32) -> vec3<f32> {
    var local_385: V2Env;
    var rgb_5: vec3<f32>;
    var world_108: vec2<f32>;
    var footprint_65: f32;
    var cover_25: f32;
    var kind_19: f32;
    var depth_11: f32;

    local_385 = local_384;
    rgb_5 = rgb_4;
    world_108 = world_107;
    footprint_65 = footprint_64;
    cover_25 = cover_24;
    kind_19 = kind_18;
    depth_11 = depth_10;
    let _e328 = global.uV2WaterVisible;
    let _e331 = cover_25;
    if ((_e328 == 0i) || (_e331 <= 0f)) {
        let _e335 = rgb_5;
        return _e335;
    }
    let _e336 = rgb_5;
    let _e337 = local_385;
    let _e338 = world_108;
    let _e339 = footprint_65;
    let _e340 = cover_25;
    let _e341 = kind_19;
    let _e342 = depth_11;
    let _e343 = v2WaterColor(_e337, _e338, _e339, _e340, _e341, _e342);
    let _e344 = cover_25;
    return mix(_e336, _e343, vec3(_e344));
}

fn v2WaterAt(rgb_6: vec3<f32>, s_37: vec3<f32>, world_109: vec2<f32>, footprint_66: f32, cover_26: f32, kind_20: f32, depth_12: f32) -> vec3<f32> {
    var rgb_7: vec3<f32>;
    var s_38: vec3<f32>;
    var world_110: vec2<f32>;
    var footprint_67: f32;
    var cover_27: f32;
    var kind_21: f32;
    var depth_13: f32;
    var local_386: V2Env;
    var base_6: vec3<f32>;
    var wet_5: f32;
    var sheet: vec4<f32>;

    rgb_7 = rgb_6;
    s_38 = s_37;
    world_110 = world_109;
    footprint_67 = footprint_66;
    cover_27 = cover_26;
    kind_21 = kind_20;
    depth_13 = depth_12;
    let _e328 = global.uV2WaterVisible;
    let _e331 = cover_27;
    if ((_e328 == 0i) || (_e331 <= 0f)) {
        let _e335 = rgb_7;
        return _e335;
    }
    let _e336 = s_38;
    let _e337 = world_110;
    let _e339 = footprint_67;
    let _e340 = v2Local(_e336, _e337, 0f, _e339);
    local_386 = _e340;
    let _e342 = rgb_7;
    base_6 = _e342;
    let _e344 = cover_27;
    wet_5 = _e344;
    let _e346 = kind_21;
    if (_e346 > 1.5f) {
        {
            let _e349 = world_110;
            let _e350 = footprint_67;
            let _e351 = v2WinterFresh;
            let _e352 = v2WinterFresh;
            let _e358 = v2FreshIce(_e349, _e350, _e351, step(_e352, 0.5f), 0f, 0f, 0f);
            sheet = _e358;
            let _e360 = rgb_7;
            let _e361 = sheet;
            let _e363 = cover_27;
            let _e364 = sheet;
            base_6 = mix(_e360, _e361.xyz, vec3((_e363 * _e364.w)));
            let _e369 = cover_27;
            let _e371 = sheet;
            wet_5 = (_e369 * (1f - _e371.w));
        }
    }
    let _e375 = local_386;
    let _e376 = base_6;
    let _e377 = world_110;
    let _e378 = footprint_67;
    let _e379 = wet_5;
    let _e380 = kind_21;
    let _e381 = depth_13;
    let _e382 = v2WaterAtEnv(_e375, _e376, _e377, _e378, _e379, _e380, _e381);
    return _e382;
}

fn v2DiagnosticEnv(local_387: V2Env, fp_46: f32) -> vec3<f32> {
    var local_388: V2Env;
    var fp_47: f32;

    local_388 = local_387;
    fp_47 = fp_46;
    let _e318 = local_388;
    let _e319 = fp_47;
    let _e320 = v2Appearance(_e318, _e319);
    let _e324 = v2Color(_e320, f32((uRenderV2_ - 1i)));
    return _e324;
}

fn v2Diagnostic(s_39: vec3<f32>, world_111: vec2<f32>, tpi_20: f32, fp_48: f32) -> vec3<f32> {
    var s_40: vec3<f32>;
    var world_112: vec2<f32>;
    var tpi_21: f32;
    var fp_49: f32;

    s_40 = s_39;
    world_112 = world_111;
    tpi_21 = tpi_20;
    fp_49 = fp_48;
    let _e322 = s_40;
    let _e323 = world_112;
    let _e324 = tpi_21;
    let _e325 = fp_49;
    let _e326 = v2Local(_e322, _e323, _e324, _e325);
    let _e327 = fp_49;
    let _e328 = v2DiagnosticEnv(_e326, _e327);
    return _e328;
}

fn udHash(p_48: vec2<f32>) -> f32 {
    var p_49: vec2<f32>;
    var q_28: vec2<u32>;
    var h_35: u32;

    p_49 = p_48;
    let _e316 = p_49;
    q_28 = vec2<u32>(vec2<i32>(floor(_e316)));
    let _e321 = q_28;
    let _e325 = q_28;
    h_35 = (((_e321.x * 374761393u) ^ (_e325.y * 668265263u)) ^ 2654435769u);
    let _e333 = h_35;
    let _e334 = h_35;
    h_35 = ((_e333 ^ (_e334 >> 13u)) * 1274126177u);
    let _e340 = h_35;
    let _e341 = h_35;
    h_35 = (_e340 ^ (_e341 >> 16u));
    let _e345 = h_35;
    return (f32(_e345) / 4294967300f);
}

fn udNoise(p_50: vec2<f32>) -> f32 {
    var p_51: vec2<f32>;
    var i_16: vec2<f32>;
    var f_21: vec2<f32>;
    var u_14: vec2<f32>;

    p_51 = p_50;
    let _e316 = p_51;
    i_16 = floor(_e316);
    let _e319 = p_51;
    let _e320 = i_16;
    f_21 = (_e319 - _e320);
    let _e323 = f_21;
    let _e324 = f_21;
    let _e328 = f_21;
    u_14 = ((_e323 * _e324) * (vec2(3f) - (2f * _e328)));
    let _e334 = i_16;
    let _e335 = udHash(_e334);
    let _e336 = i_16;
    let _e341 = udHash((_e336 + vec2<f32>(1f, 0f)));
    let _e342 = u_14;
    let _e345 = i_16;
    let _e350 = udHash((_e345 + vec2<f32>(0f, 1f)));
    let _e351 = i_16;
    let _e356 = udHash((_e351 + vec2<f32>(1f, 1f)));
    let _e357 = u_14;
    let _e360 = u_14;
    return mix(mix(_e335, _e341, _e342.x), mix(_e350, _e356, _e357.x), _e360.y);
}

fn udFbm(world_113: vec2<f32>, wavelength_7: f32, px_4: f32) -> f32 {
    var world_114: vec2<f32>;
    var wavelength_8: f32;
    var px_5: f32;
    var sum_2: f32 = 0f;
    var amp_3: f32 = 0.5f;
    var norm_1: f32 = 0f;
    var k_43: i32 = 0i;
    var w_21: f32;

    world_114 = world_113;
    wavelength_8 = wavelength_7;
    px_5 = px_4;
    loop {
        let _e328 = k_43;
        if !((_e328 < 4i)) {
            break;
        }
        {
            let _e335 = wavelength_8;
            let _e336 = px_5;
            w_21 = clamp((((_e335 / _e336) * 0.5f) - 1f), 0f, 1f);
            let _e346 = sum_2;
            let _e347 = amp_3;
            let _e348 = w_21;
            let _e350 = world_114;
            let _e351 = wavelength_8;
            let _e354 = k_43;
            let _e358 = k_43;
            let _e364 = udNoise(((_e350 / vec2(_e351)) + vec2<f32>((f32(_e354) * 17.31f), (f32(_e358) * 9.17f))));
            sum_2 = (_e346 + ((_e347 * _e348) * (_e364 - 0.5f)));
            let _e369 = norm_1;
            let _e370 = amp_3;
            norm_1 = (_e369 + _e370);
            let _e372 = wavelength_8;
            wavelength_8 = (_e372 * 0.5f);
            let _e375 = amp_3;
            amp_3 = (_e375 * 0.55f);
        }
        continuing {
            let _e332 = k_43;
            k_43 = (_e332 + 1i);
        }
    }
    let _e378 = sum_2;
    let _e379 = norm_1;
    return (_e378 / _e379);
}

fn udLight(gradient_9: vec2<f32>) -> f32 {
    var gradient_10: vec2<f32>;
    var n_20: vec3<f32>;

    gradient_10 = gradient_9;
    let _e316 = gradient_10;
    let _e319 = (-(_e316) * 3f);
    n_20 = normalize(vec3<f32>(_e319.x, _e319.y, 1f));
    let _e328 = n_20;
    return (0.3f + (0.95f * max(dot(_e328, vec3<f32>(-0.58319545f, -0.4771599f, 0.65742034f)), 0f)));
}

fn underdarkFungi(world_115: vec2<f32>, px_6: f32, moss: f32) -> vec3<f32> {
    var world_116: vec2<f32>;
    var px_7: f32;
    var moss_1: f32;
    var cluster: f32;
    var cyan: vec3<f32> = vec3<f32>(0.15f, 0.85f, 0.9f);
    var violet: vec3<f32> = vec3<f32>(0.62f, 0.3f, 0.95f);
    var CELL: f32 = 14f;
    var g_22: vec2<f32>;
    var i_17: vec2<f32>;
    var f_22: vec2<f32>;
    var h_36: f32;
    var c_63: vec2<f32>;
    var size_2: f32;
    var r_7: f32;
    var resolved_5: f32;
    var speck_2: f32;
    var tint_10: vec3<f32>;

    world_116 = world_115;
    px_7 = px_6;
    moss_1 = moss;
    let _e322 = world_116;
    let _e328 = px_7;
    let _e329 = udFbm((_e322 + vec2<f32>(911f, 377f)), 420f, _e328);
    let _e331 = moss_1;
    cluster = smoothstep(0.12f, 0.32f, (_e329 + (0.3f * _e331)));
    let _e346 = cluster;
    if (_e346 <= 0f) {
        return vec3(0f);
    }
    let _e353 = world_116;
    let _e354 = CELL;
    g_22 = (_e353 / vec2(_e354));
    let _e358 = g_22;
    i_17 = floor(_e358);
    let _e361 = g_22;
    let _e362 = i_17;
    f_22 = (_e361 - _e362);
    let _e365 = i_17;
    let _e370 = udHash((_e365 + vec2<f32>(53f, 7f)));
    h_36 = _e370;
    let _e372 = i_17;
    let _e377 = udHash((_e372 + vec2<f32>(1f, 91f)));
    let _e378 = i_17;
    let _e383 = udHash((_e378 + vec2<f32>(17f, 3f)));
    c_63 = ((vec2<f32>(_e377, _e383) * 0.6f) + vec2(0.2f));
    let _e393 = h_36;
    size_2 = (0.8f + (1.6f * _e393));
    let _e397 = f_22;
    let _e398 = c_63;
    let _e400 = CELL;
    r_7 = length(((_e397 - _e398) * _e400));
    let _e404 = size_2;
    let _e407 = px_7;
    resolved_5 = clamp((((_e404 * 2f) / _e407) - 0.5f), 0f, 1f);
    let _e416 = size_2;
    let _e419 = size_2;
    let _e420 = px_7;
    let _e422 = r_7;
    let _e426 = h_36;
    speck_2 = ((1f - smoothstep((_e416 * 0.35f), (_e419 + _e420), _e422)) * step(0.5f, _e426));
    let _e430 = cyan;
    let _e431 = violet;
    let _e433 = h_36;
    tint_10 = mix(_e430, _e431, vec3(step(0.82f, _e433)));
    let _e438 = cluster;
    let _e439 = tint_10;
    let _e440 = speck_2;
    let _e442 = resolved_5;
    let _e446 = cyan;
    let _e447 = violet;
    let _e454 = resolved_5;
    return (_e438 * ((((_e439 * _e440) * _e442) * 0.75f) + ((mix(_e446, _e447, vec3(0.25f)) * 0.035f) * (1f - _e454))));
}

fn underdarkFloorDetail(world_117: vec2<f32>, px_8: f32, wet_6: f32) -> vec2<f32> {
    var world_118: vec2<f32>;
    var px_9: f32;
    var wet_7: f32;
    var r_8: vec2<f32> = vec2(0f);
    var CELL_1: f32 = 2.5f;
    var g_23: vec2<f32>;
    var i_18: vec2<f32>;
    var f_23: vec2<f32>;
    var h_37: f32;
    var c_64: vec2<f32>;
    var size_3: f32;
    var d_28: f32;
    var resolved_6: f32;
    var cluster_1: f32;
    var CELL_2: f32 = 9f;
    var g_24: vec2<f32>;
    var i_19: vec2<f32>;
    var f_24: vec2<f32>;
    var h_38: f32;
    var c_65: vec2<f32>;
    var size_4: f32;
    var d_29: vec2<f32>;
    var resolved_7: f32;
    var cone: f32;
    var lit: f32;
    var shadow_2: f32;

    world_118 = world_117;
    px_9 = px_8;
    wet_7 = wet_6;
    {
        let _e325 = world_118;
        let _e326 = CELL_1;
        g_23 = (_e325 / vec2(_e326));
        let _e330 = g_23;
        i_18 = floor(_e330);
        let _e333 = g_23;
        let _e334 = i_18;
        f_23 = (_e333 - _e334);
        let _e337 = i_18;
        let _e342 = udHash((_e337 + vec2<f32>(5f, 77f)));
        h_37 = _e342;
        let _e344 = i_18;
        let _e349 = udHash((_e344 + vec2<f32>(9f, 1f)));
        let _e350 = i_18;
        let _e355 = udHash((_e350 + vec2<f32>(2f, 13f)));
        c_64 = ((vec2<f32>(_e349, _e355) * 0.7f) + vec2(0.15f));
        let _e365 = h_37;
        size_3 = (0.15f + (0.35f * _e365));
        let _e369 = f_23;
        let _e370 = c_64;
        let _e372 = CELL_1;
        d_28 = length(((_e369 - _e370) * _e372));
        let _e376 = size_3;
        let _e379 = px_9;
        resolved_6 = clamp((((_e376 * 3f) / _e379) - 0.6f), 0f, 1f);
        let _e388 = r_8;
        let _e392 = size_3;
        let _e395 = size_3;
        let _e396 = d_28;
        let _e401 = h_37;
        let _e404 = resolved_6;
        r_8.x = (_e388.x + (((0.3f * (1f - smoothstep((_e392 * 0.6f), _e395, _e396))) * step(0.82f, _e401)) * _e404));
    }
    let _e409 = world_118;
    let _e416 = px_9;
    let _e417 = udFbm((_e409 + vec2<f32>(311f, -57f)), 160f, _e416);
    let _e420 = wet_7;
    cluster_1 = (smoothstep(0f, 0.25f, _e417) * (1f - _e420));
    let _e424 = cluster_1;
    if (_e424 > 0f) {
        {
            let _e429 = world_118;
            let _e430 = CELL_2;
            g_24 = (_e429 / vec2(_e430));
            let _e434 = g_24;
            i_19 = floor(_e434);
            let _e437 = g_24;
            let _e438 = i_19;
            f_24 = (_e437 - _e438);
            let _e441 = i_19;
            let _e446 = udHash((_e441 + vec2<f32>(71f, 19f)));
            h_38 = _e446;
            let _e448 = h_38;
            let _e450 = cluster_1;
            if (_e448 < (0.55f * _e450)) {
                {
                    let _e453 = i_19;
                    let _e458 = udHash((_e453 + vec2<f32>(3f, 57f)));
                    let _e459 = i_19;
                    let _e464 = udHash((_e459 + vec2<f32>(41f, 8f)));
                    c_65 = ((vec2<f32>(_e458, _e464) * 0.6f) + vec2(0.2f));
                    let _e474 = i_19;
                    let _e479 = udHash((_e474 + vec2<f32>(88f, 4f)));
                    size_4 = (0.6f + (1.6f * _e479));
                    let _e483 = f_24;
                    let _e484 = c_65;
                    let _e486 = CELL_2;
                    d_29 = ((_e483 - _e484) * _e486);
                    let _e489 = size_4;
                    let _e492 = px_9;
                    resolved_7 = clamp((((_e489 * 2.5f) / _e492) - 0.6f), 0f, 1f);
                    let _e501 = size_4;
                    let _e504 = size_4;
                    let _e505 = d_29;
                    cone = (1f - smoothstep((_e501 * 0.7f), _e504, length(_e505)));
                    let _e510 = cone;
                    let _e511 = d_29;
                    let _e535 = d_29;
                    let _e537 = size_4;
                    lit = ((_e510 * clamp(((dot(normalize((_e511 + vec2(0.0001f))), vec2<f32>(-0.7739573f, -0.6332378f)) * 0.5f) + 0.5f), 0f, 1f)) * (1f - (length(_e535) / _e537)));
                    let _e543 = size_4;
                    let _e546 = size_4;
                    let _e549 = d_29;
                    let _e553 = size_4;
                    let _e562 = cone;
                    shadow_2 = ((1f - smoothstep((_e543 * 0.6f), (_e546 * 1.3f), length((_e549 - ((vec2<f32>(0.55f, 0.45f) * _e553) * 1.2f))))) * (1f - _e562));
                    let _e566 = r_8;
                    let _e567 = resolved_7;
                    let _e569 = shadow_2;
                    let _e572 = cone;
                    let _e576 = lit;
                    r_8 = (_e566 + (_e567 * vec2<f32>(((0.55f * _e569) + (0.25f * _e572)), (0.9f * _e576))));
                }
            }
        }
    }
    let _e581 = r_8;
    return _e581;
}

fn underdarkMushroomCell(world_119: vec2<f32>, px_10: f32, grove_6: f32, CELL_3: f32, seed_17: vec2<f32>, shadow_3: ptr<function, f32>) -> vec4<f32> {
    var world_120: vec2<f32>;
    var px_11: f32;
    var grove_7: f32;
    var CELL_4: f32;
    var seed_18: vec2<f32>;
    var g_25: vec2<f32>;
    var i_20: vec2<f32>;
    var f_25: vec2<f32>;
    var h_39: f32;
    var c_66: vec2<f32>;
    var room: f32;
    var size_5: f32;
    var d_30: vec2<f32>;
    var r_9: f32;
    var resolved_8: f32;
    var k_44: f32;
    var local_389: vec3<f32>;
    var local_390: vec3<f32>;
    var cap_6: vec3<f32>;
    var n_21: vec3<f32>;
    var lit_1: f32;
    var sp: vec2<f32>;
    var spot: f32;
    var col: vec3<f32>;

    world_120 = world_119;
    px_11 = px_10;
    grove_7 = grove_6;
    CELL_4 = CELL_3;
    seed_18 = seed_17;
    (*shadow_3) = 0f;
    let _e326 = world_120;
    let _e327 = CELL_4;
    let _e330 = seed_18;
    g_25 = ((_e326 / vec2(_e327)) + _e330);
    let _e333 = g_25;
    i_20 = floor(_e333);
    let _e336 = g_25;
    let _e337 = i_20;
    f_25 = (_e336 - _e337);
    let _e340 = i_20;
    let _e345 = seed_18;
    let _e347 = udHash(((_e340 + vec2<f32>(17f, 233f)) + _e345));
    h_39 = _e347;
    let _e349 = h_39;
    let _e351 = grove_7;
    if (_e349 > (0.7f * _e351)) {
        return vec4(0f);
    }
    let _e356 = i_20;
    let _e361 = udHash((_e356 + vec2<f32>(5f, 71f)));
    let _e362 = i_20;
    let _e367 = udHash((_e362 + vec2<f32>(61f, 2f)));
    c_66 = ((vec2<f32>(_e361, _e367) * 0.56f) + vec2(0.22f));
    let _e375 = c_66;
    let _e378 = c_66;
    let _e382 = c_66;
    let _e385 = c_66;
    let _e390 = CELL_4;
    room = (min(min(_e375.x, (1f - _e378.x)), min(_e382.y, (1f - _e385.y))) * _e390);
    let _e393 = room;
    let _e396 = CELL_4;
    let _e399 = i_20;
    let _e404 = udHash((_e399 + vec2<f32>(23f, 9f)));
    size_5 = min((_e393 * 0.95f), (_e396 * (0.16f + (0.2f * _e404))));
    let _e410 = f_25;
    let _e411 = c_66;
    let _e413 = CELL_4;
    d_30 = ((_e410 - _e411) * _e413);
    let _e416 = d_30;
    let _e418 = size_5;
    r_9 = (length(_e416) / _e418);
    let _e421 = size_5;
    let _e424 = px_11;
    resolved_8 = clamp((((_e421 * 2f) / _e424) - 0.5f), 0f, 1f);
    let _e432 = resolved_8;
    let _e436 = d_30;
    let _e440 = size_5;
    let _e446 = size_5;
    let _e452 = r_9;
    (*shadow_3) = ((_e432 * (1f - smoothstep(0.75f, 1.15f, (length((_e436 - ((vec2<f32>(0.5f, 0.42f) * _e440) * 0.55f))) / _e446)))) * step(1f, _e452));
    let _e455 = r_9;
    if (_e455 >= 1f) {
        return vec4(0f);
    }
    let _e460 = i_20;
    let _e465 = udHash((_e460 + vec2<f32>(88f, 13f)));
    k_44 = _e465;
    let _e467 = k_44;
    if (_e467 < 0.45f) {
        local_390 = vec3<f32>(0.3f, 0.19f, 0.33f);
    } else {
        let _e474 = k_44;
        if (_e474 < 0.8f) {
            local_389 = vec3<f32>(0.34f, 0.21f, 0.14f);
        } else {
            local_389 = vec3<f32>(0.2f, 0.3f, 0.27f);
        }
        let _e486 = local_389;
        local_390 = _e486;
    }
    let _e488 = local_390;
    cap_6 = _e488;
    let _e490 = cap_6;
    let _e493 = i_20;
    let _e498 = udHash((_e493 + vec2<f32>(1f, 301f)));
    cap_6 = (_e490 * (0.8f + (0.4f * _e498)));
    let _e502 = d_30;
    let _e503 = size_5;
    let _e507 = ((_e502 / vec2(_e503)) * 1.3f);
    let _e509 = r_9;
    let _e510 = r_9;
    n_21 = normalize(vec3<f32>(_e507.x, _e507.y, sqrt(max((1f - (_e509 * _e510)), 0f))));
    let _e523 = n_21;
    lit_1 = (0.3f + (0.85f * max(dot(_e523, vec3<f32>(-0.58319545f, -0.4771599f, 0.65742034f)), 0f)));
    let _e541 = d_30;
    let _e542 = size_5;
    let _e547 = k_44;
    let _e550 = h_39;
    sp = (((_e541 / vec2(_e542)) * 3.2f) + vec2<f32>((_e547 * 9f), (_e550 * 7f)));
    let _e557 = sp;
    let _e563 = udHash((floor(_e557) + vec2<f32>(3f, 3f)));
    let _e568 = sp;
    spot = (step(0.72f, _e563) * (1f - smoothstep(0.18f, 0.32f, length((fract(_e568) - vec2(0.5f))))));
    let _e578 = cap_6;
    let _e579 = lit_1;
    let _e585 = r_9;
    let _e594 = lit_1;
    let _e597 = spot;
    let _e600 = k_44;
    col = mix(((_e578 * _e579) * (1f - (0.35f * smoothstep(0.75f, 1f, _e585)))), (vec3<f32>(0.62f, 0.58f, 0.52f) * _e594), vec3(((0.5f * _e597) * step(0.55f, _e600))));
    let _e606 = col;
    let _e608 = i_20;
    let _e613 = udHash((_e608 + vec2<f32>(7f, 7f)));
    let _e617 = r_9;
    col = (_e606 + ((step(0.66f, _e613) * smoothstep(0.84f, 0.98f, _e617)) * vec3<f32>(0.08f, 0.42f, 0.4f)));
    let _e626 = col;
    let _e629 = px_11;
    let _e630 = size_5;
    let _e634 = r_9;
    let _e637 = resolved_8;
    return vec4<f32>(_e626.x, _e626.y, _e626.z, ((1f - smoothstep((1f - (_e629 / _e630)), 1f, _e634)) * _e637));
}

fn underdarkMushrooms(world_121: vec2<f32>, px_12: f32, grove_8: f32, shadow_4: ptr<function, f32>) -> vec4<f32> {
    var world_122: vec2<f32>;
    var px_13: f32;
    var grove_9: f32;
    var s1_2: f32;
    var s2_1: f32;
    var a_30: vec4<f32>;
    var b_19: vec4<f32>;
    var local_391: vec4<f32>;
    var cap_7: vec4<f32>;
    var mean_4: vec3<f32> = vec3<f32>(0.19f, 0.14f, 0.17f);
    var haze: f32;

    world_122 = world_121;
    px_13 = px_12;
    grove_9 = grove_8;
    (*shadow_4) = 0f;
    let _e322 = grove_9;
    if (_e322 <= 0f) {
        return vec4(0f);
    }
    let _e329 = world_122;
    let _e330 = px_13;
    let _e331 = grove_9;
    let _e337 = underdarkMushroomCell(_e329, _e330, _e331, 31f, vec2(0f), (&s1_2));
    a_30 = _e337;
    let _e339 = world_122;
    let _e340 = px_13;
    let _e341 = grove_9;
    let _e348 = underdarkMushroomCell(_e339, _e340, _e341, 19f, vec2<f32>(0.37f, 0.61f), (&s2_1));
    b_19 = _e348;
    let _e350 = s1_2;
    let _e351 = s2_1;
    (*shadow_4) = max(_e350, _e351);
    let _e353 = a_30;
    if (_e353.w > 0f) {
        let _e357 = a_30;
        local_391 = _e357;
    } else {
        let _e358 = b_19;
        local_391 = _e358;
    }
    let _e360 = local_391;
    cap_7 = _e360;
    let _e368 = grove_9;
    let _e372 = px_13;
    haze = ((0.16f * _e368) * (1f - clamp(((14f / _e372) - 0.5f), 0f, 1f)));
    let _e382 = mean_4;
    let _e383 = cap_7;
    let _e385 = cap_7;
    let _e388 = mix(_e382, _e383.xyz, vec3(_e385.w));
    let _e389 = cap_7;
    let _e391 = haze;
    return vec4<f32>(_e388.x, _e388.y, _e388.z, max(_e389.w, _e391));
}

fn underdarkFarmBeds(world_123: vec2<f32>, px_14: f32) -> vec4<f32> {
    var world_124: vec2<f32>;
    var px_15: f32;
    var k_45: i32 = 0i;
    var f_26: vec4<f32>;
    var d_31: vec2<f32>;
    var a_31: vec2<f32>;
    var l_14: vec2<f32>;
    var hs_1: vec2<f32>;
    var edge_13: f32;
    var cover_28: f32;
    var rows_3: f32;
    var ridge_4: f32;
    var compost: vec3<f32>;
    var walk: vec3<f32>;
    var g_26: vec2<f32>;
    var i_21: vec2<f32>;
    var q_29: vec2<f32>;
    var cap_8: f32;
    var capsOn: f32;
    var detail_6: vec3<f32>;
    var mean_5: vec3<f32>;

    world_124 = world_123;
    px_15 = px_14;
    loop {
        let _e320 = k_45;
        if !((_e320 < 32i)) {
            break;
        }
        {
            let _e327 = k_45;
            let _e328 = global.uFarmBedCount;
            if (_e327 >= _e328) {
                break;
            }
            let _e330 = k_45;
            let _e332 = global.uFarmBeds[_e330];
            f_26 = _e332;
            let _e334 = world_124;
            let _e335 = f_26;
            d_31 = (_e334 - _e335.xy);
            let _e339 = d_31;
            let _e340 = d_31;
            let _e342 = f_26;
            let _e344 = f_26;
            if (dot(_e339, _e340) > ((_e342.z * _e344.z) * 2f)) {
                continue;
            }
            let _e350 = f_26;
            let _e353 = f_26;
            a_31 = vec2<f32>(cos(_e350.w), sin(_e353.w));
            let _e358 = d_31;
            let _e359 = a_31;
            let _e361 = d_31;
            let _e362 = a_31;
            let _e365 = a_31;
            l_14 = vec2<f32>(dot(_e358, _e359), dot(_e361, vec2<f32>(-(_e362.y), _e365.x)));
            let _e371 = f_26;
            let _e373 = f_26;
            hs_1 = vec2<f32>(_e371.z, (_e373.z * 0.62f));
            let _e379 = hs_1;
            let _e381 = l_14;
            let _e385 = hs_1;
            let _e387 = l_14;
            edge_13 = min((_e379.x - abs(_e381.x)), (_e385.y - abs(_e387.y)));
            let _e393 = edge_13;
            if (_e393 <= 0f) {
                continue;
            }
            let _e398 = edge_13;
            cover_28 = smoothstep(0f, 2.5f, _e398);
            let _e401 = cover_28;
            if (_e401 <= 0f) {
                continue;
            }
            let _e405 = px_15;
            rows_3 = clamp(((3.2f / _e405) - 0.8f), 0f, 1f);
            let _e415 = l_14;
            let _e424 = l_14;
            ridge_4 = (smoothstep(0.12f, 0.22f, fract((_e415.y / 3.2f))) * (1f - smoothstep(0.62f, 0.72f, fract((_e424.y / 3.2f)))));
            compost = vec3<f32>(0.12f, 0.095f, 0.075f);
            walk = vec3<f32>(0.24f, 0.22f, 0.19f);
            let _e443 = l_14;
            let _e447 = l_14;
            g_26 = vec2<f32>((_e443.x / 1.3f), (_e447.y / 3.2f));
            let _e453 = g_26;
            i_21 = floor(_e453);
            let _e456 = g_26;
            q_29 = (fract(_e456) - vec2<f32>(0.5f, 0.42f));
            let _e466 = q_29;
            let _e478 = i_21;
            let _e479 = f_26;
            let _e481 = f_26;
            let _e487 = udHash((_e478 + (vec2<f32>(_e479.x, _e481.y) * 0.01f)));
            cap_8 = ((1f - smoothstep(0.16f, 0.26f, length(((_e466 * vec2<f32>(1.3f, 3.2f)) / vec2(1.3f))))) * step(0.25f, _e487));
            let _e492 = px_15;
            capsOn = clamp(((1.3f / _e492) - 0.7f), 0f, 1f);
            let _e500 = walk;
            let _e501 = compost;
            let _e502 = ridge_4;
            detail_6 = mix(_e500, _e501, vec3(_e502));
            let _e506 = detail_6;
            let _e511 = cap_8;
            let _e512 = ridge_4;
            let _e514 = capsOn;
            detail_6 = mix(_e506, vec3<f32>(0.58f, 0.53f, 0.45f), vec3(((_e511 * _e512) * _e514)));
            let _e518 = walk;
            let _e519 = compost;
            mean_5 = mix(_e518, _e519, vec3(0.55f));
            let _e524 = mean_5;
            let _e525 = detail_6;
            let _e526 = rows_3;
            let _e528 = mix(_e524, _e525, vec3(_e526));
            let _e529 = cover_28;
            return vec4<f32>(_e528.x, _e528.y, _e528.z, _e529);
        }
        continuing {
            let _e324 = k_45;
            k_45 = (_e324 + 1i);
        }
    }
    return vec4(0f);
}

fn underdarkFloor(s_41: vec3<f32>, world_125: vec2<f32>, px_16: f32, wet_8: f32, ao: f32) -> vec3<f32> {
    var s_42: vec3<f32>;
    var world_126: vec2<f32>;
    var px_17: f32;
    var wet_9: f32;
    var ao_1: f32;
    var slope_21: f32;
    var mineral_1: f32;
    var grain_6: f32;
    var fine_15: f32;
    var rocky: f32;
    var c_67: vec3<f32>;
    var moss_2: f32;
    var beds: vec4<f32>;
    var detail_7: vec2<f32>;
    var grove_10: f32;
    var shade_5: f32;
    var cap_9: vec4<f32>;

    s_42 = s_41;
    world_126 = world_125;
    px_17 = px_16;
    wet_9 = wet_8;
    ao_1 = ao;
    let _e324 = s_42;
    slope_21 = length(_e324.yz);
    let _e328 = world_126;
    let _e330 = px_17;
    let _e331 = udFbm(_e328, 900f, _e330);
    mineral_1 = _e331;
    let _e333 = world_126;
    let _e341 = px_17;
    let _e342 = udFbm(((_e333 * 1.7f) + vec2<f32>(31f, 5f)), 60f, _e341);
    grain_6 = _e342;
    let _e344 = world_126;
    let _e350 = px_17;
    let _e351 = udFbm((_e344 + vec2<f32>(73f, 41f)), 6f, _e350);
    fine_15 = _e351;
    let _e355 = slope_21;
    let _e357 = grain_6;
    rocky = smoothstep(0.12f, 0.45f, (_e355 + (0.15f * _e357)));
    let _e373 = mineral_1;
    c_67 = mix(vec3<f32>(0.27f, 0.24f, 0.2f), vec3<f32>(0.33f, 0.32f, 0.31f), vec3(smoothstep(-0.15f, 0.2f, _e373)));
    let _e378 = c_67;
    let _e383 = rocky;
    c_67 = mix(_e378, vec3<f32>(0.17f, 0.17f, 0.18f), vec3(_e383));
    let _e386 = c_67;
    let _e389 = grain_6;
    let _e393 = fine_15;
    c_67 = (_e386 * ((1f + (0.35f * _e389)) + (0.25f * _e393)));
    let _e397 = c_67;
    let _e405 = mineral_1;
    let _e409 = rocky;
    c_67 = mix(_e397, vec3<f32>(0.24f, 0.17f, 0.12f), vec3(((0.35f * smoothstep(0.18f, 0.3f, _e405)) * (1f - _e409))));
    let _e414 = c_67;
    let _e415 = c_67;
    let _e421 = wet_9;
    c_67 = mix(_e414, (_e415 * vec3<f32>(0.55f, 0.62f, 0.66f)), vec3(_e421));
    let _e426 = world_126;
    let _e432 = px_17;
    let _e433 = udFbm((_e426 + vec2<f32>(191f, 23f)), 240f, _e432);
    let _e435 = wet_9;
    let _e442 = rocky;
    moss_2 = (smoothstep(0.05f, 0.25f, ((_e433 + (0.25f * _e435)) - 0.1f)) * (1f - _e442));
    let _e446 = c_67;
    let _e453 = fine_15;
    let _e458 = moss_2;
    c_67 = mix(_e446, (vec3<f32>(0.15f, 0.24f, 0.2f) * (1f + (0.5f * _e453))), vec3((0.7f * _e458)));
    let _e462 = world_126;
    let _e463 = px_17;
    let _e464 = underdarkFarmBeds(_e462, _e463);
    beds = _e464;
    let _e466 = world_126;
    let _e467 = px_17;
    let _e468 = wet_9;
    let _e469 = underdarkFloorDetail(_e466, _e467, _e468);
    let _e471 = beds;
    detail_7 = (_e469 * (1f - _e471.w));
    let _e476 = c_67;
    let _e478 = detail_7;
    let _e486 = detail_7;
    c_67 = ((_e476 * (1f - _e478.x)) + (vec3<f32>(0.3f, 0.29f, 0.27f) * _e486.y));
    let _e490 = c_67;
    let _e491 = beds;
    let _e493 = beds;
    c_67 = mix(_e490, _e491.xyz, vec3(_e493.w));
    let _e497 = c_67;
    let _e498 = s_42;
    let _e500 = udLight(_e498.yz);
    let _e503 = ao_1;
    c_67 = (_e497 * (_e500 * (1f - (0.62f * _e503))));
    let _e510 = world_126;
    let _e517 = px_17;
    let _e518 = udFbm((_e510 + vec2<f32>(-517f, 233f)), 520f, _e517);
    let _e520 = wet_9;
    let _e524 = moss_2;
    let _e531 = rocky;
    let _e537 = wet_9;
    let _e542 = beds;
    grove_10 = (((smoothstep(0.04f, 0.2f, (((_e518 + (0.1f * _e520)) + (0.2f * _e524)) - 0.1f)) * (1f - _e531)) * (1f - smoothstep(0.15f, 0.45f, _e537))) * (1f - _e542.w));
    let _e548 = world_126;
    let _e549 = px_17;
    let _e550 = grove_10;
    let _e553 = underdarkMushrooms(_e548, _e549, _e550, (&shade_5));
    cap_9 = _e553;
    let _e555 = c_67;
    let _e558 = shade_5;
    c_67 = (_e555 * (1f - (0.55f * _e558)));
    let _e562 = c_67;
    let _e563 = cap_9;
    let _e567 = ao_1;
    let _e571 = cap_9;
    c_67 = mix(_e562, (_e563.xyz * (1f - (0.45f * _e567))), vec3(_e571.w));
    let _e575 = c_67;
    let _e576 = world_126;
    let _e577 = px_17;
    let _e578 = moss_2;
    let _e579 = underdarkFungi(_e576, _e577, _e578);
    let _e582 = ao_1;
    let _e587 = cap_9;
    return (_e575 + ((_e579 * (1f - (0.6f * _e582))) * (1f - _e587.w)));
}

fn underdarkRock(s_43: vec3<f32>, world_127: vec2<f32>, px_18: f32, rim_6: f32) -> vec3<f32> {
    var s_44: vec3<f32>;
    var world_128: vec2<f32>;
    var px_19: f32;
    var rim_7: f32;
    var t_38: f32;
    var c_68: vec3<f32>;
    var crack: f32 = 0f;
    var k_46: i32 = 0i;
    var local_392: f32;
    var local_393: f32;
    var len_1: f32;
    var w_22: f32;
    var q_30: vec2<f32>;
    var local_394: f32;
    var local_395: f32;
    var sharp_3: f32;
    var local_396: f32;
    var facet: f32;
    var e_30: f32;
    var q_31: vec2<f32>;
    var hx: f32;
    var hy: f32;
    var fn_: vec3<f32>;
    var lit_2: f32;

    s_44 = s_43;
    world_128 = world_127;
    px_19 = px_18;
    rim_7 = rim_6;
    let _e322 = world_128;
    let _e328 = px_19;
    let _e329 = udFbm((_e322 + vec2<f32>(401f, 13f)), 180f, _e328);
    let _e331 = world_128;
    let _e339 = px_19;
    let _e340 = udFbm(((_e331 * 1.3f) + vec2<f32>(17f, 88f)), 25f, _e339);
    t_38 = (_e329 + (0.6f * _e340));
    let _e350 = t_38;
    let _e356 = s_44;
    let _e358 = udLight(_e356.yz);
    c_68 = ((vec3<f32>(0.075f, 0.072f, 0.08f) * (1f + (0.8f * _e350))) * (0.18f + (0.95f * _e358)));
    loop {
        let _e367 = k_46;
        if !((_e367 < 3i)) {
            break;
        }
        {
            let _e374 = k_46;
            if (_e374 == 0i) {
                local_393 = 140f;
            } else {
                let _e378 = k_46;
                if (_e378 == 1i) {
                    local_392 = 38f;
                } else {
                    local_392 = 10f;
                }
                let _e384 = local_392;
                local_393 = _e384;
            }
            let _e386 = local_393;
            len_1 = _e386;
            let _e388 = len_1;
            let _e389 = px_19;
            w_22 = clamp((((_e388 / _e389) * 0.35f) - 1f), 0f, 1f);
            let _e399 = world_128;
            let _e400 = len_1;
            let _e403 = k_46;
            let _e407 = k_46;
            q_30 = ((_e399 / vec2(_e400)) + vec2<f32>((f32(_e403) * 41.7f), (f32(_e407) * 13.3f)));
            let _e414 = q_30;
            let _e416 = q_30;
            let _e422 = udNoise(((_e416 * 1.7f) + vec2(3.1f)));
            let _e423 = q_30;
            let _e429 = udNoise(((_e423 * 1.7f) - vec2(8.4f)));
            q_30 = (_e414 + (0.35f * vec2<f32>(_e422, _e429)));
            let _e433 = k_46;
            if (_e433 == 0i) {
                local_395 = 0.955f;
            } else {
                let _e437 = k_46;
                if (_e437 == 1i) {
                    local_394 = 0.965f;
                } else {
                    local_394 = 0.975f;
                }
                let _e443 = local_394;
                local_395 = _e443;
            }
            let _e445 = local_395;
            sharp_3 = _e445;
            let _e447 = crack;
            let _e448 = w_22;
            let _e449 = k_46;
            if (_e449 == 2i) {
                local_396 = 0.7f;
            } else {
                local_396 = 1f;
            }
            let _e455 = local_396;
            let _e457 = sharp_3;
            let _e460 = sharp_3;
            let _e463 = q_30;
            let _e464 = udNoise(_e463);
            crack = max(_e447, ((_e448 * _e455) * smoothstep((_e457 - 0.06f), _e460, (1f - abs(((2f * _e464) - 1f))))));
        }
        continuing {
            let _e371 = k_46;
            k_46 = (_e371 + 1i);
        }
    }
    let _e473 = c_68;
    let _e476 = world_128;
    let _e482 = px_19;
    let _e483 = udFbm((_e476 + vec2<f32>(5f, 61f)), 4f, _e482);
    let _e487 = world_128;
    let _e493 = px_19;
    let _e494 = udFbm((_e487 + vec2<f32>(29f, 3f)), 1.2f, _e493);
    c_68 = (_e473 * ((1f + (0.55f * _e483)) + (0.3f * _e494)));
    let _e499 = px_19;
    facet = clamp((((26f / _e499) * 0.25f) - 0.5f), 0f, 1f);
    let _e509 = facet;
    if (_e509 > 0f) {
        {
            let _e512 = px_19;
            e_30 = max(_e512, 0.8f);
            let _e516 = world_128;
            q_31 = (_e516 + vec2<f32>(71f, -13f));
            let _e523 = q_31;
            let _e524 = e_30;
            let _e529 = px_19;
            let _e530 = udFbm((_e523 + vec2<f32>(_e524, 0f)), 26f, _e529);
            let _e532 = q_31;
            let _e533 = e_30;
            let _e542 = px_19;
            let _e543 = udFbm(((_e532 + vec2<f32>(_e533, 0f)) + vec2<f32>(9f, 4f)), 8f, _e542);
            let _e546 = q_31;
            let _e547 = e_30;
            let _e552 = px_19;
            let _e553 = udFbm((_e546 - vec2<f32>(_e547, 0f)), 26f, _e552);
            let _e556 = q_31;
            let _e557 = e_30;
            let _e566 = px_19;
            let _e567 = udFbm(((_e556 - vec2<f32>(_e557, 0f)) + vec2<f32>(9f, 4f)), 8f, _e566);
            hx = (((_e530 + (0.5f * _e543)) - _e553) - (0.5f * _e567));
            let _e571 = q_31;
            let _e573 = e_30;
            let _e577 = px_19;
            let _e578 = udFbm((_e571 + vec2<f32>(0f, _e573)), 26f, _e577);
            let _e580 = q_31;
            let _e582 = e_30;
            let _e590 = px_19;
            let _e591 = udFbm(((_e580 + vec2<f32>(0f, _e582)) + vec2<f32>(9f, 4f)), 8f, _e590);
            let _e594 = q_31;
            let _e596 = e_30;
            let _e600 = px_19;
            let _e601 = udFbm((_e594 - vec2<f32>(0f, _e596)), 26f, _e600);
            let _e604 = q_31;
            let _e606 = e_30;
            let _e614 = px_19;
            let _e615 = udFbm(((_e604 - vec2<f32>(0f, _e606)) + vec2<f32>(9f, 4f)), 8f, _e614);
            hy = (((_e578 + (0.5f * _e591)) - _e601) - (0.5f * _e615));
            let _e619 = hx;
            let _e620 = hy;
            let _e624 = e_30;
            let _e629 = ((-(vec2<f32>(_e619, _e620)) / vec2((2f * _e624))) * 14f);
            fn_ = normalize(vec3<f32>(_e629.x, _e629.y, 1f));
            let _e636 = fn_;
            lit_2 = max(dot(_e636, vec3<f32>(-0.58319545f, -0.4771599f, 0.65742034f)), 0f);
            let _e652 = c_68;
            let _e656 = lit_2;
            let _e659 = facet;
            c_68 = (_e652 * mix(1f, (0.45f + (1.1f * _e656)), _e659));
        }
    }
    let _e662 = c_68;
    let _e665 = crack;
    c_68 = (_e662 * (1f - (0.6f * _e665)));
    let _e669 = c_68;
    let _e674 = rim_7;
    return (_e669 + (vec3<f32>(0.16f, 0.17f, 0.17f) * _e674));
}

fn underdarkWater(world_129: vec2<f32>, px_20: f32, depth_14: f32, edge_14: f32) -> vec3<f32> {
    var world_130: vec2<f32>;
    var px_21: f32;
    var depth_15: f32;
    var edge_15: f32;
    var c_69: vec3<f32>;

    world_130 = world_129;
    px_21 = px_20;
    depth_15 = depth_14;
    edge_15 = edge_14;
    let _e332 = depth_15;
    c_69 = mix(vec3<f32>(0.04f, 0.11f, 0.12f), vec3<f32>(0.016f, 0.055f, 0.065f), vec3(smoothstep(0f, 4f, _e332)));
    let _e337 = c_69;
    let _e340 = world_130;
    let _e346 = px_21;
    let _e347 = udFbm((_e340 + vec2<f32>(77f, 301f)), 40f, _e346);
    let _e351 = world_130;
    let _e361 = px_21;
    let _e362 = udFbm(((_e351 * vec2<f32>(1f, 2.3f)) + vec2<f32>(13f, 5f)), 9f, _e361);
    c_69 = (_e337 * ((1f + (0.3f * _e347)) + (0.25f * _e362)));
    let _e366 = c_69;
    let _e371 = edge_15;
    return (_e366 + (vec3<f32>(0.04f, 0.17f, 0.18f) * _e371));
}

fn underdarkPaper(c_70: vec3<f32>) -> vec3<f32> {
    var c_71: vec3<f32>;
    var l_15: f32;

    c_71 = c_70;
    let _e316 = c_71;
    l_15 = clamp((dot(_e316, vec3<f32>(0.3f, 0.55f, 0.15f)) * 2.6f), 0f, 1f);
    let _e336 = l_15;
    return mix(vec3<f32>(0.17f, 0.13f, 0.1f), vec3<f32>(0.66f, 0.58f, 0.44f), vec3(_e336));
}

fn groundTileSample(rect: vec4<f32>, previous_1: bool, slot: i32) -> vec4<f32> {
    var rect_1: vec4<f32>;
    var previous_2: bool;
    var slot_1: i32;
    var uv_22: vec2<f32>;
    var local_397: vec2<f32>;
    var size_6: vec2<f32>;
    var dx_1: vec2<f32>;
    var dy_2: vec2<f32>;
    var lod_6: f32;
    var margin_4: vec2<f32>;

    rect_1 = rect;
    previous_2 = previous_1;
    slot_1 = slot;
    let _e320 = rect_1;
    let _e322 = texcoord_1;
    let _e323 = rect_1;
    uv_22 = (_e320.xy + (_e322 * _e323.zw));
    let _e328 = slot_1;
    if (_e328 < 0i) {
        {
            let _e331 = previous_2;
            if _e331 {
                let _e332 = uv_22;
                let _e333 = textureSample(previousSemanticTile, sAniso, _e332);
                return _e333;
            }
            let _e334 = uv_22;
            let _e335 = textureSample(semanticTile, sAniso, _e334);
            return _e335;
        }
    }
    let _e336 = previous_2;
    if _e336 {
        let _e338 = textureDimensions(previousSemanticTile, 0i);
        local_397 = vec2<f32>(vec2<i32>(_e338));
    } else {
        let _e342 = textureDimensions(semanticTile, 0i);
        local_397 = vec2<f32>(vec2<i32>(_e342));
    }
    let _e346 = local_397;
    size_6 = _e346;
    let _e348 = uv_22;
    let _e349 = dpdx(_e348);
    let _e350 = size_6;
    dx_1 = (_e349 * _e350);
    let _e353 = uv_22;
    let _e354 = glDFdy_1(_e353);
    let _e355 = size_6;
    dy_2 = (_e354 * _e355);
    let _e358 = dx_1;
    let _e360 = dy_2;
    let _e367 = size_6;
    lod_6 = clamp(log2(max(max(length(_e358), length(_e360)), 1f)), 0f, max((log2(_e367.y) - 2f), 0f));
    let _e376 = lod_6;
    let _e382 = size_6;
    margin_4 = ((vec2(exp2(ceil(_e376))) * 1.25f) / _e382);
    let _e385 = uv_22;
    let _e386 = slot_1;
    let _e390 = margin_4;
    let _e393 = margin_4;
    let _e396 = slot_1;
    let _e402 = margin_4;
    let _e406 = margin_4;
    uv_22 = clamp(_e385, vec2<f32>(((f32(_e386) * 0.5f) + _e390.x), _e393.y), vec2<f32>(((f32((_e396 + 1i)) * 0.5f) - _e402.x), (1f - _e406.y)));
    let _e411 = previous_2;
    if _e411 {
        let _e412 = uv_22;
        let _e413 = lod_6;
        let _e414 = textureSampleLevel(previousSemanticTile, sAniso, _e412, _e413);
        return _e414;
    }
    let _e415 = uv_22;
    let _e416 = lod_6;
    let _e417 = textureSampleLevel(semanticTile, sAniso, _e415, _e416);
    return _e417;
}

fn cityGroundMaterial(m_13: ptr<function, GroundMaterial>, tile: vec4<f32>) {
    var tile_1: vec4<f32>;
    var a_32: f32;
    var albedo_2: vec3<f32>;
    var wear_1: f32;

    tile_1 = tile;
    let _e317 = tile_1;
    a_32 = clamp(_e317.w, 0f, 1f);
    let _e323 = a_32;
    if (_e323 <= 0f) {
        return;
    }
    let _e326 = tile_1;
    let _e328 = tile_1;
    albedo_2 = (_e326.xyz / vec3(max(_e328.w, 0.001f)));
    let _e335 = albedo_2;
    let _e338 = renderGuideOpen;
    albedo_2 = (_e335 * mix(vec3(1f), clamp((_e338 / vec3<f32>(0.42f, 0.4f, 0.3f)), vec3(0.65f), vec3(1.25f)), vec3(0.24f)));
    let _e353 = albedo_2;
    wear_1 = clamp((dot(_e353, vec3<f32>(0.21f, 0.72f, 0.07f)) - 0.5f), -0.4f, 0.4f);
    let _e366 = albedo_2;
    let _e371 = wear_1;
    let _e376 = v2GroundSnow;
    albedo_2 = mix(_e366, (vec3<f32>(0.68f, 0.73f, 0.77f) + vec3((_e371 * 0.18f))), vec3(_e376));
    let _e379 = renderGuideOpen;
    let _e380 = albedo_2;
    let _e381 = a_32;
    renderGuideOpen = mix(_e379, _e380, vec3(_e381));
    let _e385 = (*m_13);
    let _e387 = albedo_2;
    let _e388 = groundToLinear(_e387);
    let _e389 = v2FloorModulation;
    let _e391 = a_32;
    (*m_13).albedo = mix(_e385.albedo, (_e388 * _e389), vec3(_e391));
    let _e395 = (*m_13);
    let _e401 = albedo_2;
    let _e409 = a_32;
    (*m_13).roughness = mix(_e395.roughness, mix(0.93f, 0.74f, smoothstep(0.42f, 0.72f, dot(_e401, vec3<f32>(0.21f, 0.72f, 0.07f)))), _e409);
    let _e412 = (*m_13);
    let _e414 = v2MacroNormal;
    let _e415 = a_32;
    (*m_13).normal = normalize(mix(_e412.normal, _e414, vec3((_e415 * 0.4f))));
    v2MeanEnabled = 0f;
    return;
}

fn groundMacroHeight(p_52: vec2<f32>) -> f32 {
    var p_53: vec2<f32>;
    var q_32: vec2<i32>;

    p_53 = p_52;
    let _e316 = p_53;
    let _e317 = global.macroRect;
    let _e320 = global.macroRect;
    let _e324 = global.macroN;
    q_32 = vec2<i32>((((_e316 - _e317.xy) / vec2(_e320.z)) * f32(_e324)));
    let _e329 = q_32;
    let _e332 = global.macroN;
    let _e338 = textureLoad(macroField, clamp(_e329, vec2(0i), vec2((_e332 - 1i))), 0i);
    return _e338.x;
}

fn groundMacroBilinear(p_54: vec2<f32>) -> f32 {
    var p_55: vec2<f32>;
    var cell_23: f32;
    var g_27: vec2<f32>;
    var f_27: vec2<f32>;
    var b_20: vec2<i32>;
    var hi: vec2<i32>;
    var h00_: f32;
    var h10_: f32;
    var h01_: f32;
    var h11_: f32;

    p_55 = p_54;
    let _e316 = global.macroRect;
    let _e318 = global.macroN;
    cell_23 = (_e316.z / f32(_e318));
    let _e322 = p_55;
    let _e323 = global.macroRect;
    let _e326 = cell_23;
    g_27 = (((_e322 - _e323.xy) / vec2(_e326)) - vec2(0.5f));
    let _e333 = g_27;
    f_27 = fract(_e333);
    let _e336 = g_27;
    b_20 = vec2<i32>(floor(_e336));
    let _e340 = global.macroN;
    hi = vec2((_e340 - 1i));
    let _e345 = b_20;
    let _e348 = hi;
    let _e351 = textureLoad(macroField, clamp(_e345, vec2(0i), _e348), 0i);
    h00_ = _e351.x;
    let _e354 = b_20;
    let _e361 = hi;
    let _e364 = textureLoad(macroField, clamp((_e354 + vec2<i32>(1i, 0i)), vec2(0i), _e361), 0i);
    h10_ = _e364.x;
    let _e367 = b_20;
    let _e374 = hi;
    let _e377 = textureLoad(macroField, clamp((_e367 + vec2<i32>(0i, 1i)), vec2(0i), _e374), 0i);
    h01_ = _e377.x;
    let _e380 = b_20;
    let _e387 = hi;
    let _e390 = textureLoad(macroField, clamp((_e380 + vec2<i32>(1i, 1i)), vec2(0i), _e387), 0i);
    h11_ = _e390.x;
    let _e393 = h00_;
    let _e394 = h10_;
    let _e395 = f_27;
    let _e398 = h01_;
    let _e399 = h11_;
    let _e400 = f_27;
    let _e403 = f_27;
    return mix(mix(_e393, _e394, _e395.x), mix(_e398, _e399, _e400.x), _e403.y);
}

fn groundTpi(p_56: vec2<f32>, h_40: f32) -> f32 {
    var p_57: vec2<f32>;
    var h_41: f32;
    var r_10: f32;

    p_57 = p_56;
    h_41 = h_40;
    let _e320 = global.macroRect;
    let _e323 = global.macroN;
    r_10 = max(300f, ((2f * _e320.z) / f32(_e323)));
    let _e328 = h_41;
    let _e330 = p_57;
    let _e331 = r_10;
    let _e335 = groundMacroBilinear((_e330 + vec2<f32>(_e331, 0f)));
    let _e336 = p_57;
    let _e337 = r_10;
    let _e341 = groundMacroBilinear((_e336 - vec2<f32>(_e337, 0f)));
    let _e343 = p_57;
    let _e345 = r_10;
    let _e348 = groundMacroBilinear((_e343 + vec2<f32>(0f, _e345)));
    let _e350 = p_57;
    let _e352 = r_10;
    let _e355 = groundMacroBilinear((_e350 - vec2<f32>(0f, _e352)));
    let _e360 = r_10;
    return ((_e328 - (0.25f * (((_e335 + _e341) + _e348) + _e355))) / (6f * _e360));
}

fn waterZone() -> i32 {
    let _e318 = global.uMaterialZone;
    return clamp((_e318 - 1i), 0i, 10i);
}

fn waterLakeDrop() -> f32 {
    var w_23: vec4<f32>;
    var rain_2: f32;
    var local_398: array<f32, 11> = V2_WATER_ARIDITY;

    let _e318 = global.uMaterialZone;
    if (_e318 <= 0i) {
        return 0f;
    }
    let _e322 = v2SeasonWeights();
    w_23 = _e322;
    let _e326 = v2SeasonClimate();
    let _e328 = w_23;
    let _e330 = w_23;
    rain_2 = max(0f, (1f + (_e326.x * (_e328.z - _e330.x))));
    let _e337 = waterZone();
    let _e341 = local_398[_e337];
    let _e344 = rain_2;
    return (_e341 * clamp((1f - (0.8f * _e344)), 0f, 1f));
}

fn waterTea() -> f32 {
    var local_399: array<f32, 11> = V2_WATER_TEA;
    var local_400: f32;

    let _e318 = global.uMaterialZone;
    if (_e318 > 0i) {
        let _e321 = waterZone();
        let _e325 = local_399[_e321];
        local_400 = _e325;
    } else {
        local_400 = 0f;
    }
    let _e328 = local_400;
    return _e328;
}

fn waterGlacial() -> f32 {
    var local_401: array<f32, 11> = V2_WATER_GLACIAL;
    var local_402: f32;

    let _e318 = global.uMaterialZone;
    if (_e318 > 0i) {
        let _e321 = waterZone();
        let _e325 = local_401[_e321];
        local_402 = _e325;
    } else {
        local_402 = 0f;
    }
    let _e328 = local_402;
    return _e328;
}

fn waterSediment() -> f32 {
    var w_24: vec4<f32>;
    var rain_3: f32;
    var local_403: array<f32, 11> = V2_WATER_SEDIMENT;
    var local_404: array<f32, 11> = V2_WATER_ARIDITY;

    let _e318 = global.uMaterialZone;
    if (_e318 <= 0i) {
        return 0f;
    }
    let _e322 = v2SeasonWeights();
    w_24 = _e322;
    let _e326 = v2SeasonClimate();
    let _e328 = w_24;
    let _e330 = w_24;
    rain_3 = max(0f, (1f + (_e326.x * (_e328.z - _e330.x))));
    let _e337 = waterZone();
    let _e341 = local_403[_e337];
    let _e342 = rain_3;
    let _e344 = waterZone();
    let _e348 = local_404[_e344];
    let _e356 = v2WinterFresh;
    return ((_e341 * clamp((_e342 - (0.9f * _e348)), 0f, 1f)) * (1f - _e356));
}

fn cityWaterDepth(world_131: vec2<f32>, footprint_68: f32, cover_29: f32) -> vec2<f32> {
    var world_132: vec2<f32>;
    var footprint_69: f32;
    var cover_30: f32;
    var ramp: f32;
    var bank_8: f32 = 128f;
    var i_22: i32 = 0i;
    var turn_2: f32;
    var direction: vec2<f32>;
    var previous_3: f32;
    var k_47: i32;
    var r_11: f32;
    var lo: f32;
    var hi_1: f32;
    var j_6: i32;
    var mid_4: f32;

    world_132 = world_131;
    footprint_69 = footprint_68;
    cover_30 = cover_29;
    let _e324 = global.uQuality;
    if (_e324 > 0i) {
        {
            let _e327 = cover_30;
            let _e328 = dpdx(_e327);
            let _e329 = cover_30;
            let _e330 = glDFdy(_e329);
            ramp = max(length(vec2<f32>(_e328, _e330)), 0.001f);
            let _e337 = footprint_69;
            let _e341 = cover_30;
            let _e343 = ramp;
            let _e348 = cover_30;
            return vec2<f32>((clamp((((0.07f * max(_e337, 0.001f)) * _e341) / _e343), 0.4f, 6f) * _e348), -1f);
        }
    }
    loop {
        let _e357 = i_22;
        if !((_e357 < 8i)) {
            break;
        }
        {
            let _e364 = i_22;
            turn_2 = (f32(_e364) * 0.7853982f);
            let _e369 = turn_2;
            let _e371 = turn_2;
            direction = vec2<f32>(cos(_e369), sin(_e371));
            previous_3 = 0f;
            k_47 = 0i;
            loop {
                let _e379 = k_47;
                if !((_e379 < 7i)) {
                    break;
                }
                {
                    let _e387 = k_47;
                    r_11 = (2f * exp2(f32(_e387)));
                    let _e392 = world_132;
                    let _e393 = direction;
                    let _e394 = r_11;
                    let _e397 = displayWaterCover((_e392 + (_e393 * _e394)));
                    if (_e397 < 0.5f) {
                        {
                            let _e400 = previous_3;
                            lo = _e400;
                            let _e402 = r_11;
                            hi_1 = _e402;
                            j_6 = 0i;
                            loop {
                                let _e406 = j_6;
                                if !((_e406 < 3i)) {
                                    break;
                                }
                                {
                                    let _e413 = lo;
                                    let _e414 = hi_1;
                                    mid_4 = ((_e413 + _e414) * 0.5f);
                                    let _e419 = world_132;
                                    let _e420 = direction;
                                    let _e421 = mid_4;
                                    let _e424 = displayWaterCover((_e419 + (_e420 * _e421)));
                                    if (_e424 < 0.5f) {
                                        let _e427 = mid_4;
                                        hi_1 = _e427;
                                    } else {
                                        let _e428 = mid_4;
                                        lo = _e428;
                                    }
                                }
                                continuing {
                                    let _e410 = j_6;
                                    j_6 = (_e410 + 1i);
                                }
                            }
                            let _e429 = bank_8;
                            let _e430 = lo;
                            let _e431 = hi_1;
                            bank_8 = min(_e429, ((_e430 + _e431) * 0.5f));
                            break;
                        }
                    }
                    let _e436 = r_11;
                    previous_3 = _e436;
                }
                continuing {
                    let _e383 = k_47;
                    k_47 = (_e383 + 1i);
                }
            }
        }
        continuing {
            let _e361 = i_22;
            i_22 = (_e361 + 1i);
        }
    }
    let _e438 = bank_8;
    let _e443 = cover_30;
    let _e445 = bank_8;
    return vec2<f32>((clamp((0.07f * _e438), 0.4f, 6f) * _e443), _e445);
}

fn cityWaterAt(base_7: vec3<f32>, surface: vec3<f32>, world_133: vec2<f32>, footprint_70: f32, cover_31: f32) -> vec3<f32> {
    var base_8: vec3<f32>;
    var surface_1: vec3<f32>;
    var world_134: vec2<f32>;
    var footprint_71: f32;
    var cover_32: f32;
    var sea_3: bool;
    var depth_16: f32;
    var bank_9: f32 = -1f;
    var bed_2: vec2<f32>;
    var local_405: f32;
    var water_6: vec3<f32>;
    var freeze_5: f32;
    var shelf_4: f32;
    var line_3: f32;
    var local_406: f32;
    var channel_6: f32;
    var local_407: f32;
    var edge_16: f32;
    var sheet_1: vec4<f32>;

    base_8 = base_7;
    surface_1 = surface;
    world_134 = world_133;
    footprint_71 = footprint_70;
    cover_32 = cover_31;
    let _e328 = surface_1;
    sea_3 = (_e328.x < 0f);
    let _e333 = sea_3;
    let _e334 = global.uV2WaterVisible;
    let _e337 = cover_32;
    if (_e333 && ((_e334 == 0i) || (_e337 <= 0f))) {
        let _e342 = base_8;
        return _e342;
    }
    let _e343 = surface_1;
    depth_16 = -(_e343.x);
    let _e350 = sea_3;
    if !(_e350) {
        {
            let _e352 = world_134;
            let _e353 = footprint_71;
            let _e354 = cover_32;
            let _e355 = cityWaterDepth(_e352, _e353, _e354);
            bed_2 = _e355;
            let _e357 = bed_2;
            depth_16 = _e357.x;
            let _e359 = bed_2;
            bank_9 = _e359.y;
        }
    }
    let _e361 = surface_1;
    let _e362 = world_134;
    let _e364 = footprint_71;
    let _e365 = v2Local(_e361, _e362, 0f, _e364);
    let _e366 = world_134;
    let _e367 = footprint_71;
    let _e368 = cover_32;
    let _e369 = sea_3;
    if _e369 {
        local_405 = 1f;
    } else {
        local_405 = 3f;
    }
    let _e373 = local_405;
    let _e374 = depth_16;
    let _e375 = v2WaterColor(_e365, _e366, _e367, _e368, _e373, _e374);
    water_6 = _e375;
    let _e377 = sea_3;
    if !(_e377) {
        {
            let _e379 = water_6;
            let _e380 = water_6;
            let _e386 = waterTea();
            water_6 = mix(_e379, (_e380 * vec3<f32>(0.86f, 0.7f, 0.48f)), vec3(_e386));
            let _e389 = water_6;
            let _e395 = waterGlacial();
            water_6 = mix(_e389, vec3<f32>(0.38f, 0.62f, 0.62f), vec3((0.45f * _e395)));
            let _e399 = water_6;
            let _e405 = waterSediment();
            water_6 = mix(_e399, vec3<f32>(0.45f, 0.38f, 0.25f), vec3((0.275f * _e405)));
            let _e409 = v2WinterFresh;
            freeze_5 = _e409;
            let _e411 = freeze_5;
            if (_e411 > 0.001f) {
                {
                    let _e414 = freeze_5;
                    let _e415 = v2WinterShelf(_e414);
                    shelf_4 = _e415;
                    let _e417 = footprint_71;
                    line_3 = max(_e417, 1f);
                    let _e421 = bank_9;
                    if (_e421 < 0f) {
                        let _e424 = freeze_5;
                        local_406 = step(_e424, 0.5f);
                    } else {
                        let _e428 = shelf_4;
                        let _e430 = shelf_4;
                        let _e431 = bank_9;
                        let _e432 = sstep((0.85f * _e428), _e430, _e431);
                        local_406 = _e432;
                    }
                    let _e434 = local_406;
                    channel_6 = _e434;
                    let _e436 = bank_9;
                    if (_e436 < 0f) {
                        local_407 = 0f;
                    } else {
                        let _e442 = line_3;
                        let _e445 = line_3;
                        let _e447 = bank_9;
                        let _e448 = sstep((0.8f * _e442), (2.5f * _e445), _e447);
                        local_407 = (1f - _e448);
                    }
                    let _e451 = local_407;
                    edge_16 = _e451;
                    let _e453 = world_134;
                    let _e454 = footprint_71;
                    let _e455 = freeze_5;
                    let _e456 = channel_6;
                    let _e459 = edge_16;
                    let _e460 = v2FreshIce(_e453, _e454, _e455, _e456, 0f, 0f, _e459);
                    sheet_1 = _e460;
                    let _e462 = water_6;
                    let _e463 = sheet_1;
                    let _e465 = sheet_1;
                    water_6 = mix(_e462, _e463.xyz, vec3(_e465.w));
                }
            }
        }
    }
    let _e469 = base_8;
    let _e470 = water_6;
    let _e471 = cover_32;
    return mix(_e469, _e470, vec3(_e471));
}

fn main_1() {
    var projected: vec4<f32>;
    var base_9: vec3<f32>;
    var footprint_72: f32;
    var s_45: vec3<f32>;
    var rock_9: f32 = 0f;
    var rim_8: f32 = 0f;
    var ao_2: f32 = 0f;
    var rect_2: vec3<f32>;
    var cell_24: f32;
    var uv_23: vec2<f32>;
    var raw_1: f32;
    var near_2: f32 = 0f;
    var far: f32 = 0f;
    var k_48: i32 = 0i;
    var local_408: vec2<f32>;
    var local_409: vec2<f32>;
    var local_410: vec2<f32>;
    var d_32: vec2<f32>;
    var edge_17: f32;
    var ledge: f32;
    var local_411: f32;
    var local_412: f32;
    var cover_33: f32;
    var glow: f32 = 0f;
    var k_49: i32 = 0i;
    var g_28: vec4<f32>;
    var d_33: f32;
    var local_413: vec4<f32>;
    var local_414: vec4<f32>;
    var tile_2: vec4<f32>;
    var a_33: f32;
    var local_415: f32;
    var depth_17: f32;
    var rockColor: vec3<f32>;
    var local_416: vec3<f32>;
    var s_46: vec3<f32>;
    var shore_17: f32;
    var openness_14: f32 = 0f;
    var ring: vec4<f32>;
    var m_14: GroundMaterial;
    var macro_10: vec3<f32>;
    var previousGround: vec4<f32> = vec4(0f);
    var cityGround: vec4<f32> = vec4(0f);
    var local_417: vec3<f32>;
    var local_418: f32;
    var under_2: f32;
    var local_419: f32;
    var cover_34: f32;
    var local_420: f32;
    var bed_3: f32;
    var v_21: f32;
    var dv: f32;
    var k_50: f32;
    var major: bool;
    var local_421: f32;
    var local_422: f32;
    var line_4: f32;
    var local_423: f32;
    var thin_2: f32;
    var local_424: f32;
    var index: f32;
    var a_34: f32;
    var local_425: i32;
    var local_426: i32;
    var semantic: vec4<f32>;
    var altitude_2: f32;
    var rock_10: f32;
    var land_1: vec3<f32>;
    var light_27: f32;
    var footprint_73: f32;
    var prep: ForestPrep;
    var s_47: vec3<f32>;
    var shore_18: f32;
    var macro_11: vec3<f32>;
    var canopy_3: GroundMaterial;
    var crowns: vec3<f32>;
    var fog: f32;
    var local_427: vec3<f32>;
    var edge_18: vec2<f32>;
    var line_5: f32;

    let _e318 = global.previousRect;
    let _e320 = texcoord_1;
    let _e321 = global.previousRect;
    let _e325 = reliefPrevious((_e318.xy + (_e320 * _e321.zw)));
    let _e326 = global.textureRect;
    let _e328 = texcoord_1;
    let _e329 = global.textureRect;
    let _e333 = reliefCurrent((_e326.xy + (_e328 * _e329.zw)));
    let _e334 = global.textureBlend;
    projected = mix(_e325, _e333, vec4(_e334));
    let _e338 = projected;
    base_9 = _e338.xyz;
    if (groundEnabled == 1i) {
        {
            let _e344 = physical_1;
            let _e345 = dpdx(_e344);
            let _e347 = physical_1;
            let _e348 = glDFdy_2(_e347);
            footprint_72 = max(0.001f, max(length(_e345), length(_e348)));
            let _e353 = global.uUnderdark;
            if (_e353 == 1i) {
                {
                    let _e356 = physical_1;
                    let _e358 = groundMacroSurface(_e356.xz);
                    s_45 = _e358;
                    let _e366 = global.uHasCave;
                    if (_e366 == 1i) {
                        {
                            let _e369 = global.uForestBeachRect;
                            rect_2 = _e369;
                            let _e371 = rect_2;
                            let _e374 = textureDimensions(uForestBeach, 0i);
                            cell_24 = (_e371.z / f32(vec2<i32>(_e374).x));
                            let _e380 = physical_1;
                            let _e382 = rect_2;
                            let _e385 = rect_2;
                            uv_23 = ((_e380.xz - _e382.xy) / vec2(_e385.z));
                            let _e390 = uv_23;
                            let _e391 = textureSample(uForestBeach, sLinear, _e390);
                            raw_1 = _e391.x;
                            loop {
                                let _e400 = k_48;
                                if !((_e400 < 4i)) {
                                    break;
                                }
                                {
                                    let _e407 = k_48;
                                    if (_e407 == 0i) {
                                        local_410 = vec2<f32>(1f, 0f);
                                    } else {
                                        let _e413 = k_48;
                                        if (_e413 == 1i) {
                                            local_409 = vec2<f32>(-1f, 0f);
                                        } else {
                                            let _e420 = k_48;
                                            if (_e420 == 2i) {
                                                local_408 = vec2<f32>(0f, 1f);
                                            } else {
                                                local_408 = vec2<f32>(0f, -1f);
                                            }
                                            let _e431 = local_408;
                                            local_409 = _e431;
                                        }
                                        let _e433 = local_409;
                                        local_410 = _e433;
                                    }
                                    let _e435 = local_410;
                                    d_32 = _e435;
                                    let _e437 = near_2;
                                    let _e438 = uv_23;
                                    let _e439 = d_32;
                                    let _e442 = cell_24;
                                    let _e444 = rect_2;
                                    let _e449 = textureSample(uForestBeach, sLinear, (_e438 + (((_e439 * 1.5f) * _e442) / vec2(_e444.z))));
                                    near_2 = (_e437 + _e449.x);
                                    let _e452 = far;
                                    let _e453 = uv_23;
                                    let _e454 = d_32;
                                    let _e456 = d_32;
                                    let _e459 = d_32;
                                    let _e461 = d_32;
                                    let _e469 = cell_24;
                                    let _e471 = rect_2;
                                    let _e476 = textureSample(uForestBeach, sLinear, (_e453 + ((((vec2<f32>((_e454.x - _e456.y), (_e459.x + _e461.y)) * 0.7071f) * 4f) * _e469) / vec2(_e471.z))));
                                    far = (_e452 + _e476.x);
                                }
                                continuing {
                                    let _e404 = k_48;
                                    k_48 = (_e404 + 1i);
                                }
                            }
                            let _e480 = footprint_72;
                            let _e482 = cell_24;
                            edge_17 = max(((0.376f * _e480) / _e482), 0.001f);
                            let _e487 = raw_1;
                            let _e490 = edge_17;
                            rock_9 = clamp((((_e487 - 0.5f) / _e490) + 0.5f), 0f, 1f);
                            let _e498 = near_2;
                            let _e503 = far;
                            let _e512 = rock_9;
                            ao_2 = (clamp((((0.75f * _e498) * 0.25f) + ((0.35f * _e503) * 0.25f)), 0f, 1f) * (1f - _e512));
                            let _e518 = cell_24;
                            ledge = clamp((2.25f / _e518), 0.02f, 0.45f);
                            let _e526 = ledge;
                            let _e530 = raw_1;
                            let _e534 = ledge;
                            let _e539 = ledge;
                            let _e541 = raw_1;
                            let _e545 = cell_24;
                            let _e546 = footprint_72;
                            rim_8 = ((smoothstep(0.5f, (0.5f + (_e526 * 0.35f)), _e530) * (1f - smoothstep((0.5f + (_e534 * 0.35f)), (0.5f + _e539), _e541))) * clamp(((_e545 / _e546) * 0.25f), 0f, 1f));
                        }
                    }
                    let _e554 = global.displayWaterVisible;
                    if (_e554 == 0i) {
                        local_412 = 0f;
                    } else {
                        let _e558 = global.hasCanopyWater;
                        let _e561 = global.hasPreviousCanopyWater;
                        if ((_e558 == 1i) || (_e561 == 1i)) {
                            let _e565 = physical_1;
                            let _e567 = displayWaterCover(_e565.xz);
                            local_411 = _e567;
                        } else {
                            let _e568 = projected;
                            local_411 = _e568.w;
                        }
                        let _e571 = local_411;
                        local_412 = _e571;
                    }
                    let _e573 = local_412;
                    cover_33 = _e573;
                    let _e575 = s_45;
                    let _e576 = physical_1;
                    let _e578 = footprint_72;
                    let _e579 = cover_33;
                    let _e585 = ao_2;
                    let _e586 = underdarkFloor(_e575, _e576.xz, _e578, clamp((_e579 * 1.5f), 0f, 1f), _e585);
                    base_9 = _e586;
                    loop {
                        let _e591 = k_49;
                        if !((_e591 < 16i)) {
                            break;
                        }
                        {
                            let _e598 = k_49;
                            let _e599 = global.uTownGlowCount;
                            if (_e598 >= _e599) {
                                break;
                            }
                            let _e601 = k_49;
                            let _e603 = global.uTownGlow[_e601];
                            g_28 = _e603;
                            let _e605 = physical_1;
                            let _e607 = g_28;
                            let _e611 = g_28;
                            d_33 = (length((_e605.xz - _e607.xy)) / max(_e611.z, 1f));
                            let _e617 = glow;
                            let _e618 = d_33;
                            let _e620 = d_33;
                            glow = (_e617 + exp(((-(_e618) * _e620) * 0.9f)));
                        }
                        continuing {
                            let _e595 = k_49;
                            k_49 = (_e595 + 1i);
                        }
                    }
                    let _e626 = base_9;
                    let _e631 = glow;
                    let _e637 = ao_2;
                    base_9 = (_e626 + ((vec3<f32>(0.2f, 0.12f, 0.05f) * min(_e631, 1.2f)) * (1f - (0.5f * _e637))));
                    let _e644 = global.hasGroundTile;
                    let _e647 = global.hasPreviousGroundTile;
                    if ((uRenderV2_ == 1i) && ((_e644 == 1i) || (_e647 == 1i))) {
                        {
                            let _e652 = global.hasPreviousGroundTile;
                            if (_e652 == 1i) {
                                let _e655 = global.previousGroundRect;
                                let _e658 = groundTileSample(_e655, true, 0i);
                                local_413 = _e658;
                            } else {
                                local_413 = vec4(0f);
                            }
                            let _e662 = local_413;
                            let _e663 = global.hasGroundTile;
                            if (_e663 == 1i) {
                                let _e666 = global.groundRect;
                                let _e669 = groundTileSample(_e666, false, 0i);
                                local_414 = _e669;
                            } else {
                                local_414 = vec4(0f);
                            }
                            let _e673 = local_414;
                            let _e674 = global.textureBlend;
                            tile_2 = mix(_e662, _e673, vec4(_e674));
                            let _e678 = tile_2;
                            a_33 = clamp(_e678.w, 0f, 1f);
                            let _e684 = base_9;
                            let _e685 = tile_2;
                            let _e687 = tile_2;
                            let _e695 = s_45;
                            let _e697 = udLight(_e695.yz);
                            let _e699 = a_33;
                            base_9 = mix(_e684, (((_e685.xyz / vec3(max(_e687.w, 0.001f))) * 0.32f) * _e697), vec3(_e699));
                        }
                    }
                    let _e702 = s_45;
                    if (_e702.x < 0f) {
                        let _e706 = s_45;
                        local_415 = -(_e706.x);
                    } else {
                        let _e710 = cover_33;
                        local_415 = (6f * _e710);
                    }
                    let _e713 = local_415;
                    depth_17 = _e713;
                    let _e715 = base_9;
                    let _e716 = physical_1;
                    let _e718 = footprint_72;
                    let _e719 = depth_17;
                    let _e723 = cover_33;
                    let _e727 = depth_17;
                    let _e731 = underdarkWater(_e716.xz, _e718, _e719, (1f - (smoothstep(0f, 0.9f, _e723) * smoothstep(0f, 3f, _e727))));
                    let _e732 = cover_33;
                    base_9 = mix(_e715, _e731, vec3(_e732));
                    let _e735 = s_45;
                    let _e736 = physical_1;
                    let _e738 = footprint_72;
                    let _e739 = rim_8;
                    let _e740 = underdarkRock(_e735, _e736.xz, _e738, _e739);
                    rockColor = _e740;
                    let _e742 = global.uPaperMap;
                    if (_e742 == 1i) {
                        let _e745 = base_9;
                        let _e746 = underdarkPaper(_e745);
                        let _e747 = rockColor;
                        let _e748 = underdarkPaper(_e747);
                        let _e754 = rock_9;
                        local_416 = mix(_e746, (_e748 * vec3<f32>(0.42f, 0.38f, 0.36f)), vec3(_e754));
                    } else {
                        let _e757 = base_9;
                        let _e758 = rockColor;
                        let _e759 = rock_9;
                        local_416 = mix(_e757, _e758, vec3(_e759));
                    }
                    let _e763 = local_416;
                    base_9 = _e763;
                }
            } else {
                {
                    let _e764 = physical_1;
                    let _e766 = footprint_72;
                    surfaceGroundReadInputs(_e764.xz, _e766);
                    let _e767 = physical_1;
                    let _e769 = groundMacroSurface(_e767.xz);
                    s_46 = _e769;
                    let _e771 = s_46;
                    let _e775 = s_46;
                    shore_17 = (max(_e771.x, 0f) / max(length(_e775.yz), 0.0001f));
                    if (uRenderV2_ > 0i) {
                        {
                            let _e786 = physical_1;
                            let _e788 = global.uShoreRingRect;
                            let _e791 = global.uShoreRingRect;
                            let _e796 = textureSampleLevel(uShoreRing, sLinear, ((_e786.xz - _e788.xy) / vec2(_e791.z)), 0f);
                            ring = _e796;
                            let _e798 = s_46;
                            let _e802 = s_46;
                            let _e807 = s_46;
                            if (((_e798.x >= 0f) && (_e802.x < 12f)) && (length(_e807.yz) < 0.5f)) {
                                {
                                    let _e813 = shore_17;
                                    let _e814 = ring;
                                    shore_17 = min(_e813, _e814.x);
                                    let _e817 = ring;
                                    openness_14 = _e817.y;
                                }
                            }
                            let _e819 = ring;
                            let _e821 = s_46;
                            v2ReliefSet(_e819.zw, _e821.yz);
                        }
                    }
                    let _e824 = s_46;
                    let _e825 = physical_1;
                    let _e827 = footprint_72;
                    let _e831 = shore_17;
                    let _e832 = openness_14;
                    let _e833 = earthMaterial(_e824, _e825.xz, max(_e827, 1f), 0f, _e831, _e832);
                    macro_10 = _e833;
                    if (uRenderV2_ > 0i) {
                        let _e837 = s_46;
                        let _e838 = physical_1;
                        let _e840 = footprint_72;
                        let _e841 = physical_1;
                        let _e843 = s_46;
                        let _e845 = groundTpi(_e841.xz, _e843.x);
                        let _e846 = global.groundLight;
                        let _e847 = global.groundLight2_;
                        let _e848 = global.groundStrength;
                        let _e849 = renderGuideBaseOpen;
                        let _e850 = v2Ground(_e837, _e838.xz, _e840, _e845, _e846, _e847, _e848, _e849);
                        m_14 = _e850;
                    } else {
                        {
                            let _e851 = s_46;
                            let _e852 = physical_1;
                            let _e854 = footprint_72;
                            let _e855 = macro_10;
                            let _e856 = global.uMaterialClimate;
                            let _e857 = global.uMaterialSeed;
                            let _e858 = terrainGroundMaterial_1(_e851, _e852.xz, _e854, _e855, _e856, _e857);
                            m_14 = _e858;
                        }
                    }
                    let _e860 = physical_1;
                    let _e862 = footprint_72;
                    applyGroundOccupation((&m_14), _e860.xz, _e862);
                    let _e866 = global.hasGroundTile;
                    let _e869 = global.hasPreviousGroundTile;
                    if ((uRenderV2_ == 1i) && ((_e866 == 1i) || (_e869 == 1i))) {
                        {
                            let _e880 = global.hasPreviousGroundTile;
                            if (_e880 == 1i) {
                                let _e883 = global.previousGroundRect;
                                let _e886 = groundTileSample(_e883, true, 0i);
                                previousGround = _e886;
                            }
                            let _e887 = global.hasGroundTile;
                            if (_e887 == 1i) {
                                let _e890 = global.groundRect;
                                let _e893 = groundTileSample(_e890, false, 0i);
                                cityGround = _e893;
                            }
                            let _e895 = previousGround;
                            let _e896 = cityGround;
                            let _e897 = global.textureBlend;
                            cityGroundMaterial((&m_14), mix(_e895, _e896, vec4(_e897)));
                        }
                    }
                    if (uForest == 1i) {
                        let _e904 = physical_1;
                        let _e906 = footprint_72;
                        let _e907 = global.groundLight;
                        applyForest((&m_14), _e904.xz, _e906, _e907);
                    }
                    let _e910 = physical_1;
                    let _e912 = footprint_72;
                    applyPaperMap((&m_14), _e910.xz, _e912);
                    if (uRenderV2_ > 0i) {
                        let _e916 = m_14;
                        let _e917 = global.groundEye;
                        let _e918 = physical_1;
                        let _e921 = global.groundLight;
                        let _e922 = global.groundLight2_;
                        let _e923 = global.groundStrength;
                        let _e924 = v2ShadeGround(_e916, normalize((_e917 - _e918)), _e921, _e922, _e923);
                        local_417 = _e924;
                    } else {
                        let _e925 = m_14;
                        let _e926 = global.groundEye;
                        let _e927 = physical_1;
                        let _e930 = global.groundLight;
                        let _e931 = global.groundLight2_;
                        let _e932 = global.groundStrength;
                        let _e933 = shadeTerrainGround(_e925, normalize((_e926 - _e927)), _e930, _e931, _e932);
                        local_417 = _e933;
                    }
                    let _e935 = local_417;
                    base_9 = _e935;
                    if (uRenderV2_ > 0i) {
                        let _e938 = base_9;
                        let _e939 = v2DisplayShoulder(_e938);
                        base_9 = _e939;
                    }
                    if (uRenderV2_ > 0i) {
                        local_418 = 1f;
                    } else {
                        let _e944 = forestResolvedCover;
                        local_418 = (1f - _e944);
                    }
                    let _e947 = local_418;
                    under_2 = _e947;
                    if (uRenderV2_ > 1i) {
                        let _e951 = s_46;
                        let _e952 = physical_1;
                        let _e955 = footprint_72;
                        let _e956 = v2Diagnostic(_e951, _e952.xz, 0f, _e955);
                        base_9 = _e956;
                    }
                    if (uRenderV2_ > 0i) {
                        {
                            let _e959 = global.hasCanopyWater;
                            let _e962 = global.hasPreviousCanopyWater;
                            if ((_e959 == 1i) || (_e962 == 1i)) {
                                let _e966 = physical_1;
                                let _e968 = displayWaterCover(_e966.xz);
                                local_419 = _e968;
                            } else {
                                let _e969 = projected;
                                local_419 = _e969.w;
                            }
                            let _e972 = local_419;
                            cover_34 = _e972;
                            let _e974 = s_46;
                            if (_e974.x < 0f) {
                                let _e978 = cover_34;
                                local_420 = _e978;
                            } else {
                                let _e979 = cover_34;
                                let _e981 = forestResolvedCover;
                                local_420 = (_e979 * (1f - _e981));
                            }
                            let _e985 = local_420;
                            bed_3 = _e985;
                            let _e987 = base_9;
                            let _e988 = s_46;
                            let _e989 = physical_1;
                            let _e991 = footprint_72;
                            let _e992 = bed_3;
                            let _e993 = cityWaterAt(_e987, _e988, _e989.xz, _e991, _e992);
                            base_9 = _e993;
                            let _e994 = s_46;
                            if (_e994.x >= 0f) {
                                let _e998 = base_9;
                                let _e1001 = forestResolvedShade;
                                let _e1003 = bed_3;
                                base_9 = (_e998 * (1f - ((0.4f * _e1001) * _e1003)));
                            }
                        }
                    } else {
                        let _e1007 = base_9;
                        let _e1009 = projected;
                        let _e1011 = under_2;
                        let _e1015 = projected;
                        let _e1017 = under_2;
                        base_9 = ((_e1007 * (1f - (_e1009.w * _e1011))) + (_e1015.xyz * _e1017));
                    }
                    let _e1020 = global.groundContours;
                    let _e1023 = s_46;
                    if ((_e1020 == 1i) && (_e1023.x > 0f)) {
                        {
                            let _e1028 = s_46;
                            let _e1030 = global.groundContourStep;
                            v_21 = (_e1028.x / _e1030);
                            let _e1033 = v_21;
                            let _e1034 = fwidth(_e1033);
                            dv = max(_e1034, 0.000001f);
                            let _e1038 = v_21;
                            k_50 = floor((_e1038 + 0.5f));
                            let _e1043 = k_50;
                            major = ((_e1043 - (floor((_e1043 / 5f)) * 5f)) < 0.5f);
                            let _e1052 = k_50;
                            if (_e1052 < 0.5f) {
                                local_422 = 0f;
                            } else {
                                let _e1056 = major;
                                if _e1056 {
                                    local_421 = 1.25f;
                                } else {
                                    local_421 = 0.7f;
                                }
                                let _e1060 = local_421;
                                let _e1065 = v_21;
                                let _e1066 = k_50;
                                let _e1069 = dv;
                                local_422 = clamp((((_e1060 * 0.5f) + 0.5f) - (abs((_e1065 - _e1066)) / _e1069)), 0f, 1f);
                            }
                            let _e1076 = local_422;
                            line_4 = _e1076;
                            let _e1078 = major;
                            if _e1078 {
                                local_423 = 0f;
                            } else {
                                let _e1080 = line_4;
                                local_423 = (_e1080 * 0.5f);
                            }
                            let _e1084 = local_423;
                            let _e1087 = dv;
                            let _e1096 = dv;
                            thin_2 = mix(_e1084, (min(1f, ((0.8f * _e1087) * 0.7f)) * 0.5f), smoothstep(0.3f, 0.7f, _e1096));
                            let _e1100 = major;
                            if _e1100 {
                                let _e1101 = line_4;
                                local_424 = (_e1101 * 0.75f);
                            } else {
                                local_424 = 0f;
                            }
                            let _e1106 = local_424;
                            let _e1109 = dv;
                            let _e1118 = dv;
                            index = mix(_e1106, (min(1f, ((0.2f * _e1109) * 1.25f)) * 0.75f), smoothstep(0.3f, 0.7f, (_e1118 * 5f)));
                            let _e1126 = thin_2;
                            let _e1129 = index;
                            let _e1133 = global.groundContourOpacity;
                            a_34 = ((1f - ((1f - _e1126) * (1f - _e1129))) * _e1133);
                            let _e1136 = a_34;
                            let _e1138 = global.groundFlatSlope;
                            let _e1141 = global.groundFlatSlope;
                            let _e1143 = s_46;
                            a_34 = (_e1136 * smoothstep((0.25f * _e1138), (0.5f * _e1141), length(_e1143.yz)));
                            let _e1148 = base_9;
                            let _e1149 = global.groundContourColor;
                            let _e1150 = a_34;
                            base_9 = mix(_e1148, _e1149, vec3(_e1150));
                        }
                    }
                    let _e1153 = global.uNight;
                    if (_e1153 == 1i) {
                        let _e1156 = base_9;
                        let _e1157 = moonlight(_e1156);
                        base_9 = _e1157;
                    }
                }
            }
            let _e1158 = global.previousSemanticRect;
            let _e1160 = global.hasPreviousGroundTile;
            if (_e1160 == 1i) {
                local_425 = 1i;
            } else {
                local_425 = -1i;
            }
            let _e1167 = local_425;
            let _e1168 = groundTileSample(_e1158, true, _e1167);
            let _e1169 = global.hasPreviousSemanticTile;
            let _e1172 = global.semanticRect;
            let _e1174 = global.hasGroundTile;
            if (_e1174 == 1i) {
                local_426 = 1i;
            } else {
                local_426 = -1i;
            }
            let _e1181 = local_426;
            let _e1182 = groundTileSample(_e1172, false, _e1181);
            let _e1183 = global.hasSemanticTile;
            let _e1186 = global.textureBlend;
            semantic = mix((_e1168 * f32(_e1169)), (_e1182 * f32(_e1183)), vec4(_e1186));
            let _e1190 = base_9;
            let _e1192 = semantic;
            let _e1196 = semantic;
            base_9 = ((_e1190 * (1f - _e1192.w)) + _e1196.xyz);
        }
    } else {
        {
            let _e1199 = global.proceduralPreview;
            if (_e1199 == 1i) {
                {
                    let _e1204 = physical_1;
                    altitude_2 = smoothstep(300f, 2500f, _e1204.y);
                    let _e1210 = physicalSlope_1;
                    rock_10 = smoothstep(0.15f, 0.75f, length(_e1210));
                    let _e1222 = altitude_2;
                    let _e1223 = rock_10;
                    land_1 = mix(vec3<f32>(0.31f, 0.38f, 0.23f), vec3<f32>(0.48f, 0.46f, 0.39f), vec3(max(_e1222, _e1223)));
                    let _e1228 = projected;
                    let _e1230 = land_1;
                    let _e1232 = projected;
                    base_9 = (_e1228.xyz + (_e1230 * (1f - _e1232.w)));
                }
            }
            let _e1240 = normal_3;
            light_27 = (0.89f + (0.11f * max(0f, dot(normalize(_e1240), vec3<f32>(-0.42399913f, 0.84799826f, -0.31799936f)))));
            let _e1258 = base_9;
            let _e1259 = light_27;
            base_9 = (_e1258 * _e1259);
            let _e1261 = base_9;
            let _e1262 = physical_1;
            let _e1263 = physical_1;
            let _e1264 = dpdx(_e1263);
            let _e1266 = physical_1;
            let _e1267 = glDFdy_2(_e1266);
            let _e1270 = naturalMapWater(_e1261, _e1262, max(length(_e1264), length(_e1267)));
            base_9 = _e1270;
            if (uForest == 1i) {
                {
                    let _e1274 = physical_1;
                    let _e1275 = dpdx(_e1274);
                    let _e1277 = physical_1;
                    let _e1278 = glDFdy_2(_e1277);
                    footprint_73 = max(0.001f, max(length(_e1275), length(_e1278)));
                    let _e1283 = physical_1;
                    let _e1285 = footprint_73;
                    let _e1286 = forestPrep(_e1283.xz, _e1285);
                    prep = _e1286;
                    let _e1288 = prep;
                    let _e1290 = prep;
                    let _e1295 = prep;
                    if ((_e1288.valid && (_e1290.reveal > 0f)) && (_e1295.crownVis > 0f)) {
                        {
                            let _e1300 = prep;
                            let _e1301 = global.groundLight;
                            let _e1303 = forestCanopyNear(_e1300, normalize(_e1301));
                            mapCanopy = _e1303;
                            let _e1304 = mapCanopy;
                            if (_e1304.cover > 0f) {
                                {
                                    let _e1308 = physical_1;
                                    let _e1310 = groundMacroSurface(_e1308.xz);
                                    s_47 = _e1310;
                                    let _e1312 = s_47;
                                    let _e1316 = s_47;
                                    shore_18 = (max(_e1312.x, 0f) / max(length(_e1316.yz), 0.0001f));
                                    let _e1323 = s_47;
                                    let _e1324 = physical_1;
                                    let _e1326 = footprint_73;
                                    let _e1330 = shore_18;
                                    let _e1332 = earthMaterial(_e1323, _e1324.xz, max(_e1326, 1f), 0f, _e1330, 0f);
                                    macro_11 = _e1332;
                                    let _e1336 = base_9;
                                    let _e1337 = groundToLinear(_e1336);
                                    canopy_3.albedo = _e1337;
                                    let _e1339 = physicalSlope_1;
                                    let _e1343 = physicalSlope_1;
                                    canopy_3.normal = normalize(vec3<f32>(-(_e1339.x), 1f, -(_e1343.y)));
                                    canopy_3.roughness = 0.9f;
                                    canopy_3.occlusion = 1f;
                                    let _e1353 = physical_1;
                                    let _e1355 = footprint_73;
                                    let _e1356 = global.groundLight;
                                    applyForest((&canopy_3), _e1353.xz, _e1355, _e1356);
                                    let _e1358 = canopy_3;
                                    let _e1359 = global.groundEye;
                                    let _e1360 = physical_1;
                                    let _e1363 = global.groundLight;
                                    let _e1364 = global.groundLight2_;
                                    let _e1365 = global.groundStrength;
                                    let _e1366 = shadeTerrainGround(_e1358, normalize((_e1359 - _e1360)), _e1363, _e1364, _e1365);
                                    crowns = _e1366;
                                    let _e1368 = global.uNight;
                                    if (_e1368 == 1i) {
                                        let _e1371 = crowns;
                                        let _e1372 = moonlight(_e1371);
                                        crowns = _e1372;
                                    }
                                    let _e1373 = base_9;
                                    let _e1374 = crowns;
                                    let _e1375 = forestMapCover;
                                    base_9 = mix(_e1373, _e1374, vec3(_e1375));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let _e1379 = world_135;
    let _e1380 = global.eye;
    let _e1383 = global.fogDistance;
    fog = (1f - exp((-(pow((length((_e1379 - _e1380)) / _e1383), 2f)) * 0.11f)));
    let _e1393 = base_9;
    let _e1394 = global.uNight;
    if (_e1394 == 1i) {
        local_427 = vec3<f32>(0.018f, 0.028f, 0.065f);
    } else {
        local_427 = vec3<f32>(0.77f, 0.85f, 0.88f);
    }
    let _e1406 = local_427;
    let _e1408 = fog;
    base_9 = mix(_e1393, _e1406, vec3(min(0.62f, _e1408)));
    let _e1412 = global.showTileBounds;
    if (_e1412 == 1i) {
        {
            let _e1415 = texcoord_1;
            let _e1417 = texcoord_1;
            let _e1421 = texcoord_1;
            let _e1422 = fwidth(_e1421);
            edge_18 = (min(_e1415, (vec2(1f) - _e1417)) / max(_e1422, vec2(0.000001f)));
            let _e1431 = edge_18;
            let _e1433 = edge_18;
            line_5 = (1f - smoothstep(0.45f, 1.35f, min(_e1431.x, _e1433.y)));
            let _e1439 = base_9;
            let _e1444 = line_5;
            base_9 = mix(_e1439, vec3<f32>(1f, 0.55f, 0.12f), vec3((_e1444 * 0.85f)));
        }
    }
    let _e1449 = base_9;
    color_13 = vec4<f32>(_e1449.x, _e1449.y, _e1449.z, 1f);
    return;
}

@fragment 
fn main(@location(0) texcoord: vec2<f32>, @location(1) normal: vec3<f32>, @location(2) world: vec3<f32>, @location(3) physical: vec3<f32>, @location(4) physicalSlope: vec2<f32>) -> FragmentOutput {
    texcoord_1 = texcoord;
    normal_3 = normal;
    world_135 = world;
    physical_1 = physical;
    physicalSlope_1 = physicalSlope;
    main_1();
    let _e616 = color_13;
    return FragmentOutput(_e616);
}
`,ye=`diagnostic(off, derivative_uniformity);
struct TerrainParams {
    matrix: mat4x4<f32>,
    exaggeration: f32,
    morph: f32,
    patchOffset: vec3<f32>,
    physicalOrigin: vec3<f32>,
    textureRect: vec4<f32>,
    previousRect: vec4<f32>,
    textureBlend: f32,
    eye: vec3<f32>,
    fogDistance: f32,
    proceduralPreview: i32,
    showTileBounds: i32,
    groundEye: vec3<f32>,
    groundLight: vec3<f32>,
    groundLight2_: vec3<f32>,
    groundStrength: f32,
    macroRect: vec3<f32>,
    uShoreRingRect: vec3<f32>,
    macroN: i32,
    patchRect: vec3<f32>,
    groundContours: i32,
    groundContourColor: vec3<f32>,
    groundContourStep: f32,
    groundContourOpacity: f32,
    groundFlatSlope: f32,
    hasSemanticTile: i32,
    hasPreviousSemanticTile: i32,
    semanticRect: vec4<f32>,
    previousSemanticRect: vec4<f32>,
    groundRect: vec4<f32>,
    previousGroundRect: vec4<f32>,
    hasGroundTile: i32,
    hasPreviousGroundTile: i32,
    uUnderdark: i32,
    uHasCave: i32,
    uTownGlow: array<vec4<f32>, 16>,
    uTownGlowCount: i32,
    uNaturalWater: i32,
    uNight: i32,
    displayWaterVisible: i32,
    displayWaterBand: f32,
    hasCanopyWater: i32,
    hasPreviousCanopyWater: i32,
    canopyWaterRect: vec3<f32>,
    previousCanopyWaterRect: vec3<f32>,
    uWaterSeason: vec2<f32>,
    hasRaisedMaterial: i32,
    hasPreviousRaisedMaterial: i32,
    raisedBlend: f32,
    uV2Season: f32,
    uV2WaterVisible: i32,
    uMaterialZone: i32,
    uV2Calendar: i32,
    uV2CalLeaf: vec4<f32>,
    uV2CalIce: vec4<f32>,
    uV2CalThaw: vec4<f32>,
    uV2CalClimate: vec4<f32>,
    uV2CalSnow: vec4<f32>,
    uForestTrees: vec4<f32>,
    uForestRect: vec3<f32>,
    uHasForestBank: i32,
    uForestBankDensity: f32,
    uHasOccupation: i32,
    uOccupationRect: vec3<f32>,
    uOccupationN: f32,
    uHasForestBeach: i32,
    uForestBeachRect: vec3<f32>,
    uQuality: i32,
    uMaterialSeed: u32,
    uMaterialClimate: vec2<f32>,
    uGroundCover: vec4<f32>,
    uHasLandDetail: i32,
    uLandDetailRect: vec3<f32>,
    uLandDetailN: f32,
    uHasAux: i32,
    uPaperMap: i32,
    uV2GlacierSources: array<vec4<f32>, 8>,
    uFarmBeds: array<vec4<f32>, 32>,
    uFarmBedCount: i32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: TerrainParams;
@group(0) @binding(2) 
var sLinear: sampler;
@group(0) @binding(3) 
var sAniso: sampler;
var<private> texcoord_1: vec2<f32>;
var<private> normal_1: vec3<f32>;
var<private> world_5: vec3<f32>;
var<private> physical_1: vec3<f32>;
@group(0) @binding(5) 
var material: texture_2d<f32>;
@group(0) @binding(6) 
var previousMaterial: texture_2d<f32>;
var<private> color_4: vec4<f32>;
@group(0) @binding(9) 
var canopyWater: texture_2d<f32>;
@group(0) @binding(10) 
var previousCanopyWater: texture_2d<f32>;
@group(0) @binding(21) 
var drapedMaterial: texture_2d<f32>;
@group(0) @binding(22) 
var previousDrapedMaterial: texture_2d<f32>;

fn glDFdy(v: f32) -> f32 {
    var v_1: f32;

    v_1 = v;
    let _e162 = v_1;
    let _e163 = dpdy(_e162);
    return -(_e163);
}

fn glDFdy_1(v_2: vec2<f32>) -> vec2<f32> {
    var v_3: vec2<f32>;

    v_3 = v_2;
    let _e162 = v_3;
    let _e163 = dpdy(_e162);
    return -(_e163);
}

fn glDFdy_2(v_4: vec3<f32>) -> vec3<f32> {
    var v_5: vec3<f32>;

    v_5 = v_4;
    let _e162 = v_5;
    let _e163 = dpdy(_e162);
    return -(_e163);
}

fn glDFdy_3(v_6: vec4<f32>) -> vec4<f32> {
    var v_7: vec4<f32>;

    v_7 = v_6;
    let _e162 = v_7;
    let _e163 = dpdy(_e162);
    return -(_e163);
}

fn waterSurfaceHash(p: vec2<f32>) -> f32 {
    var p_1: vec2<f32>;

    p_1 = p;
    let _e171 = p_1;
    p_1 = fract((_e171 * vec2<f32>(123.34f, 456.21f)));
    let _e177 = p_1;
    let _e178 = p_1;
    let _e179 = p_1;
    p_1 = (_e177 + vec2(dot(_e178, (_e179 + vec2(45.32f)))));
    let _e186 = p_1;
    let _e188 = p_1;
    return fract((_e186.x * _e188.y));
}

fn waterSurfaceNoise(p_2: vec2<f32>) -> f32 {
    var p_3: vec2<f32>;
    var i: vec2<f32>;
    var f: vec2<f32>;
    var u: vec2<f32>;

    p_3 = p_2;
    let _e171 = p_3;
    i = floor(_e171);
    let _e174 = p_3;
    f = fract(_e174);
    let _e177 = f;
    let _e178 = f;
    let _e182 = f;
    u = ((_e177 * _e178) * (vec2(3f) - (2f * _e182)));
    let _e188 = i;
    let _e189 = waterSurfaceHash(_e188);
    let _e190 = i;
    let _e195 = waterSurfaceHash((_e190 + vec2<f32>(1f, 0f)));
    let _e196 = u;
    let _e199 = i;
    let _e204 = waterSurfaceHash((_e199 + vec2<f32>(0f, 1f)));
    let _e205 = i;
    let _e210 = waterSurfaceHash((_e205 + vec2<f32>(1f, 1f)));
    let _e211 = u;
    let _e214 = u;
    return mix(mix(_e189, _e195, _e196.x), mix(_e204, _e210, _e211.x), _e214.y);
}

fn waterSurfaceShade(color: vec3<f32>, world_1: vec2<f32>, px: f32, shelf: f32, rim: f32, wide: f32) -> vec3<f32> {
    var color_1: vec3<f32>;
    var world_2: vec2<f32>;
    var px_1: f32;
    var shelf_1: f32;
    var rim_1: f32;
    var wide_1: f32;
    var fine: f32;
    var n: f32;

    color_1 = color;
    world_2 = world_1;
    px_1 = px;
    shelf_1 = shelf;
    rim_1 = rim;
    wide_1 = wide;
    let _e181 = color_1;
    let _e186 = shelf_1;
    let _e189 = wide_1;
    color_1 = mix(_e181, vec3<f32>(0.16f, 0.33f, 0.32f), vec3(((_e186 * 0.3f) * _e189)));
    let _e193 = color_1;
    let _e198 = rim_1;
    let _e201 = wide_1;
    color_1 = mix(_e193, vec3<f32>(0.4f, 0.55f, 0.52f), vec3(((_e198 * 0.18f) * _e201)));
    let _e208 = px_1;
    fine = (1f - smoothstep(2f, 6f, _e208));
    let _e212 = world_2;
    let _e216 = waterSurfaceNoise((_e212 / vec2(170f)));
    let _e219 = world_2;
    let _e226 = waterSurfaceNoise(((_e219 / vec2(45f)) + vec2(7.3f)));
    let _e229 = fine;
    let _e233 = fine;
    n = (((_e216 * 0.6f) + ((_e226 * 0.4f) * _e229)) + ((1f - _e233) * 0.2f));
    let _e239 = color_1;
    let _e242 = n;
    return (_e239 * (0.9f + (0.2f * _e242)));
}

fn materialWaterRamp(position: f32) -> vec3<f32> {
    var position_1: f32;
    var color_2: vec3<f32> = vec3<f32>(0.101960786f, 0.3019608f, 0.36078432f);

    position_1 = position;
    let _e184 = color_2;
    let _e199 = position_1;
    color_2 = mix(_e184, vec3<f32>(0.043137256f, 0.16078432f, 0.27058825f), vec3(smoothstep(0f, 0.4f, _e199)));
    let _e203 = color_2;
    let _e218 = position_1;
    color_2 = mix(_e203, vec3<f32>(0.019607844f, 0.06666667f, 0.14901961f), vec3(smoothstep(0.4f, 1f, _e218)));
    let _e222 = color_2;
    return _e222;
}

fn materialWater(world_3: vec2<f32>, position_2: f32, px_2: f32) -> vec3<f32> {
    var world_4: vec2<f32>;
    var position_3: f32;
    var px_3: f32;
    var shelf_2: f32;
    var rim_2: f32;
    var color_3: vec3<f32>;
    var ice: f32;

    world_4 = world_3;
    position_3 = position_2;
    px_3 = px_2;
    let _e178 = position_3;
    shelf_2 = (1f - smoothstep(0f, 0.035f, _e178));
    let _e184 = position_3;
    let _e189 = position_3;
    rim_2 = (smoothstep(0.002f, 0.006f, _e184) * (1f - smoothstep(0.012f, 0.025f, _e189)));
    let _e194 = position_3;
    let _e195 = materialWaterRamp(_e194);
    let _e196 = world_4;
    let _e197 = px_3;
    let _e198 = shelf_2;
    let _e199 = rim_2;
    let _e201 = waterSurfaceShade(_e195, _e196, _e197, _e198, _e199, 1f);
    color_3 = _e201;
    let _e203 = color_3;
    let _e204 = color_3;
    let _e216 = global.uWaterSeason;
    color_3 = mix(_e203, ((_e204 * vec3<f32>(0.8f, 0.9f, 1f)) + vec3<f32>(0f, 0.01f, 0.02f)), vec3((0.35f * _e216.x)));
    let _e222 = global.uWaterSeason;
    ice = step(0.5f, _e222.y);
    let _e226 = color_3;
    let _e231 = ice;
    return mix(_e226, vec3<f32>(0.84f, 0.89f, 0.91f), vec3(_e231));
}

fn moonlight(c: vec3<f32>) -> vec3<f32> {
    var c_1: vec3<f32>;
    var y: f32;

    c_1 = c;
    let _e171 = c_1;
    y = dot(_e171, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
    let _e178 = c_1;
    let _e189 = y;
    return ((_e178 * vec3<f32>(0.16f, 0.23f, 0.38f)) + (vec3<f32>(0.018f, 0.029f, 0.065f) * (0.35f + _e189)));
}

fn displayWaterCover(p_4: vec2<f32>) -> f32 {
    var p_5: vec2<f32>;
    var q: vec2<f32>;

    p_5 = p_4;
    let _e171 = p_5;
    let _e172 = global.canopyWaterRect;
    let _e175 = global.canopyWaterRect;
    q = ((_e171 - _e172.xy) / vec2(_e175.z));
    let _e180 = global.hasCanopyWater;
    if (_e180 == 1i) {
        let _e183 = q;
        let _e190 = textureSampleLevel(canopyWater, sLinear, clamp(_e183, vec2(0f), vec2(1f)), 0f);
        return _e190.x;
    }
    let _e192 = p_5;
    let _e193 = global.previousCanopyWaterRect;
    let _e196 = global.previousCanopyWaterRect;
    q = ((_e192 - _e193.xy) / vec2(_e196.z));
    let _e200 = global.hasPreviousCanopyWater;
    if (_e200 == 1i) {
        let _e203 = q;
        let _e210 = textureSampleLevel(previousCanopyWater, sLinear, clamp(_e203, vec2(0f), vec2(1f)), 0f);
        return _e210.x;
    }
    return 0f;
}

fn naturalMapWater(base: vec3<f32>, p_6: vec3<f32>, footprint: f32) -> vec3<f32> {
    var base_1: vec3<f32>;
    var p_7: vec3<f32>;
    var footprint_1: f32;
    var cover: f32;
    var band: f32;
    var position_4: f32 = 0f;
    var i_1: i32 = 0i;
    var local: f32;
    var local_1: f32;
    var r: f32;
    var water: vec3<f32>;

    base_1 = base;
    p_7 = p_6;
    footprint_1 = footprint;
    let _e175 = global.uNaturalWater;
    let _e178 = global.displayWaterVisible;
    if ((_e175 == 0i) || (_e178 == 0i)) {
        let _e182 = base_1;
        return _e182;
    }
    let _e183 = p_7;
    let _e185 = displayWaterCover(_e183.xz);
    cover = _e185;
    let _e187 = cover;
    if (_e187 <= 0f) {
        let _e190 = base_1;
        return _e190;
    }
    let _e193 = cover;
    cover = smoothstep(0.2f, 0.8f, _e193);
    let _e195 = global.displayWaterBand;
    band = max(_e195, 1f);
    loop {
        let _e203 = i_1;
        if !((_e203 < 3i)) {
            break;
        }
        {
            let _e210 = band;
            let _e211 = i_1;
            if (_e211 == 0i) {
                local_1 = 0.025f;
            } else {
                let _e215 = i_1;
                if (_e215 == 1i) {
                    local = 0.15f;
                } else {
                    local = 0.6f;
                }
                let _e221 = local;
                local_1 = _e221;
            }
            let _e223 = local_1;
            r = (_e210 * _e223);
            let _e226 = position_4;
            let _e227 = p_7;
            let _e229 = r;
            let _e233 = displayWaterCover((_e227.xz + vec2<f32>(_e229, 0f)));
            let _e234 = p_7;
            let _e236 = r;
            let _e240 = displayWaterCover((_e234.xz - vec2<f32>(_e236, 0f)));
            let _e242 = p_7;
            let _e245 = r;
            let _e248 = displayWaterCover((_e242.xz + vec2<f32>(0f, _e245)));
            let _e250 = p_7;
            let _e253 = r;
            let _e256 = displayWaterCover((_e250.xz - vec2<f32>(0f, _e253)));
            position_4 = (_e226 + ((((_e233 + _e240) + _e248) + _e256) / 12f));
        }
        continuing {
            let _e207 = i_1;
            i_1 = (_e207 + 1i);
        }
    }
    let _e261 = p_7;
    let _e263 = position_4;
    let _e264 = footprint_1;
    let _e265 = materialWater(_e261.xz, _e263, _e264);
    water = _e265;
    let _e267 = global.uNight;
    if (_e267 == 1i) {
        let _e270 = water;
        let _e271 = moonlight(_e270);
        water = _e271;
    }
    let _e272 = base_1;
    let _e273 = water;
    let _e274 = cover;
    return mix(_e272, _e273, vec3(_e274));
}

fn reliefCurrent(uv: vec2<f32>) -> vec4<f32> {
    var uv_1: vec2<f32>;

    uv_1 = uv;
    let _e173 = global.hasRaisedMaterial;
    let _e176 = global.raisedBlend;
    if ((_e173 == 0i) || (_e176 >= 1f)) {
        let _e180 = uv_1;
        let _e181 = textureSample(material, sAniso, _e180);
        return _e181;
    }
    let _e182 = global.raisedBlend;
    if (_e182 <= 0f) {
        let _e185 = uv_1;
        let _e186 = textureSample(drapedMaterial, sAniso, _e185);
        return _e186;
    }
    let _e187 = uv_1;
    let _e188 = textureSample(drapedMaterial, sAniso, _e187);
    let _e189 = uv_1;
    let _e190 = textureSample(material, sAniso, _e189);
    let _e191 = global.raisedBlend;
    return mix(_e188, _e190, vec4(_e191));
}

fn reliefPrevious(uv_2: vec2<f32>) -> vec4<f32> {
    var uv_3: vec2<f32>;

    uv_3 = uv_2;
    let _e173 = global.hasPreviousRaisedMaterial;
    let _e176 = global.raisedBlend;
    if ((_e173 == 0i) || (_e176 >= 1f)) {
        let _e180 = uv_3;
        let _e181 = textureSample(previousMaterial, sAniso, _e180);
        return _e181;
    }
    let _e182 = global.raisedBlend;
    if (_e182 <= 0f) {
        let _e185 = uv_3;
        let _e186 = textureSample(previousDrapedMaterial, sAniso, _e185);
        return _e186;
    }
    let _e187 = uv_3;
    let _e188 = textureSample(previousDrapedMaterial, sAniso, _e187);
    let _e189 = uv_3;
    let _e190 = textureSample(previousMaterial, sAniso, _e189);
    let _e191 = global.raisedBlend;
    return mix(_e188, _e190, vec4(_e191));
}

fn main_1() {
    var base_2: vec3<f32>;
    var fog: f32;
    var local_2: vec3<f32>;
    var edge: vec2<f32>;
    var line: f32;

    let _e171 = global.previousRect;
    let _e173 = texcoord_1;
    let _e174 = global.previousRect;
    let _e178 = reliefPrevious((_e171.xy + (_e173 * _e174.zw)));
    let _e179 = global.textureRect;
    let _e181 = texcoord_1;
    let _e182 = global.textureRect;
    let _e186 = reliefCurrent((_e179.xy + (_e181 * _e182.zw)));
    let _e187 = global.textureBlend;
    base_2 = mix(_e178, _e186, vec4(_e187)).xyz;
    let _e192 = base_2;
    let _e196 = normal_1;
    base_2 = (_e192 * (0.89f + (0.11f * max(0f, dot(normalize(_e196), vec3<f32>(-0.42399913f, 0.84799826f, -0.31799936f))))));
    let _e214 = base_2;
    let _e215 = physical_1;
    let _e216 = physical_1;
    let _e217 = dpdx(_e216);
    let _e219 = physical_1;
    let _e220 = glDFdy_2(_e219);
    let _e223 = naturalMapWater(_e214, _e215, max(length(_e217), length(_e220)));
    base_2 = _e223;
    let _e225 = world_5;
    let _e226 = global.eye;
    let _e229 = global.fogDistance;
    fog = (1f - exp((-(pow((length((_e225 - _e226)) / _e229), 2f)) * 0.11f)));
    let _e239 = base_2;
    let _e240 = global.uNight;
    if (_e240 == 1i) {
        local_2 = vec3<f32>(0.018f, 0.028f, 0.065f);
    } else {
        local_2 = vec3<f32>(0.77f, 0.85f, 0.88f);
    }
    let _e252 = local_2;
    let _e254 = fog;
    base_2 = mix(_e239, _e252, vec3(min(0.62f, _e254)));
    let _e258 = global.showTileBounds;
    if (_e258 == 1i) {
        {
            let _e261 = texcoord_1;
            let _e263 = texcoord_1;
            let _e267 = texcoord_1;
            let _e268 = fwidth(_e267);
            edge = (min(_e261, (vec2(1f) - _e263)) / max(_e268, vec2(0.000001f)));
            let _e277 = edge;
            let _e279 = edge;
            line = (1f - smoothstep(0.45f, 1.35f, min(_e277.x, _e279.y)));
            let _e285 = base_2;
            let _e290 = line;
            base_2 = mix(_e285, vec3<f32>(1f, 0.55f, 0.12f), vec3((_e290 * 0.85f)));
        }
    }
    let _e295 = base_2;
    color_4 = vec4<f32>(_e295.x, _e295.y, _e295.z, 1f);
    return;
}

@fragment 
fn main(@location(0) texcoord: vec2<f32>, @location(1) normal: vec3<f32>, @location(2) world: vec3<f32>, @location(3) physical: vec3<f32>) -> FragmentOutput {
    texcoord_1 = texcoord;
    normal_1 = normal;
    world_5 = world;
    physical_1 = physical;
    main_1();
    let _e193 = color_4;
    return FragmentOutput(_e193);
}
`,ke=`struct SkyParams {
    height: f32,
    uNight: i32,
}

struct VertexOutput {
    @builtin(position) gl_Position: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: SkyParams;
var<private> gl_VertexIndex_1: u32;
var<private> gl_Position: vec4<f32>;

fn main_1() {
    var p: vec2<f32>;

    let _e5 = gl_VertexIndex_1;
    let _e13 = gl_VertexIndex_1;
    p = vec2<f32>(f32(((_e5 << 1u) & 2u)), f32((_e13 & 2u)));
    let _e21 = p;
    let _e26 = ((_e21 * 2f) - vec2(1f));
    gl_Position = vec4<f32>(_e26.x, _e26.y, 0.9999f, 1f);
    let _e33 = gl_Position;
    let _e35 = gl_Position;
    gl_Position.z = ((_e33.z + _e35.w) * 0.5f);
    return;
}

@vertex 
fn main(@builtin(vertex_index) gl_VertexIndex: u32) -> VertexOutput {
    gl_VertexIndex_1 = gl_VertexIndex;
    main_1();
    let _e7 = gl_Position;
    return VertexOutput(_e7);
}
`,Se=`diagnostic(off, derivative_uniformity);
struct SkyParams {
    height: f32,
    uNight: i32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: SkyParams;
var<private> color: vec4<f32>;
var<private> gl_FragCoord_1: vec4<f32>;

fn main_1() {
    var t: f32;
    var local: vec3<f32>;
    var local_1: vec3<f32>;

    let _e6 = global.height;
    let _e7 = gl_FragCoord_1;
    let _e10 = global.height;
    t = clamp(((_e6 - _e7.y) / _e10), 0f, 1f);
    let _e16 = global.uNight;
    if (_e16 == 2i) {
        let _e27 = t;
        local_1 = mix(vec3<f32>(0.022f, 0.02f, 0.024f), vec3<f32>(0.004f, 0.004f, 0.006f), vec3(pow(_e27, 0.6f)));
    } else {
        let _e32 = global.uNight;
        if (_e32 == 1i) {
            let _e43 = t;
            local = mix(vec3<f32>(0.035f, 0.046f, 0.09f), vec3<f32>(0.008f, 0.014f, 0.04f), vec3(pow(_e43, 0.8f)));
        } else {
            let _e56 = t;
            local = mix(vec3<f32>(0.89f, 0.92f, 0.91f), vec3<f32>(0.49f, 0.68f, 0.81f), vec3(pow(_e56, 0.8f)));
        }
        let _e62 = local;
        local_1 = _e62;
    }
    let _e64 = local_1;
    color = vec4<f32>(_e64.x, _e64.y, _e64.z, 1f);
    return;
}

@fragment 
fn main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e9 = color;
    return FragmentOutput(_e9);
}
`,Ce=`struct BuildingParams {
    matrix: mat4x4<f32>,
    offset: vec3<f32>,
    exaggeration: f32,
    sectorOrigin: vec2<f32>,
    uNight: i32,
    material: vec3<f32>,
    tint: vec3<f32>,
    recolored: i32,
    useTex: i32,
    softFrom: f32,
}

struct VertexOutput {
    @location(0) n: vec3<f32>,
    @location(1) base: vec3<f32>,
    @location(2) facadePosition: vec3<f32>,
    @location(3) grainPosition: vec3<f32>,
    @location(4) @interpolate(flat) materialClass: f32,
    @builtin(position) gl_Position: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: BuildingParams;
var<private> position_1: vec3<f32>;
var<private> normal_1: vec3<f32>;
var<private> albedo_1: vec3<f32>;
var<private> groundIn_1: f32;
var<private> n: vec3<f32>;
var<private> base: vec3<f32>;
var<private> facadePosition: vec3<f32>;
var<private> grainPosition: vec3<f32>;
var<private> materialClass: f32;
var<private> gl_Position: vec4<f32>;

fn main_1() {
    var local: f32;
    var k: f32;
    var local_1: f32;
    var local_2: f32;

    let _e29 = position_1;
    let _e31 = groundIn_1;
    if (_e29.y > (_e31 + 0.01f)) {
        local = 1f;
    } else {
        let _e36 = global.exaggeration;
        local = _e36;
    }
    let _e38 = local;
    k = _e38;
    let _e40 = normal_1;
    let _e42 = normal_1;
    let _e44 = k;
    let _e46 = normal_1;
    n = normalize(vec3<f32>(_e40.x, (_e42.y / _e44), _e46.z));
    let _e50 = albedo_1;
    base = _e50;
    let _e51 = position_1;
    let _e53 = global.sectorOrigin;
    let _e56 = groundIn_1;
    if (_e56 < 10000000000f) {
        let _e59 = position_1;
        let _e61 = groundIn_1;
        local_1 = (_e59.y - _e61);
    } else {
        local_1 = -10000f;
    }
    let _e66 = local_1;
    let _e67 = position_1;
    let _e69 = global.sectorOrigin;
    facadePosition = vec3<f32>((_e51.x + _e53.x), _e66, (_e67.z + _e69.y));
    let _e73 = normal_1;
    materialClass = floor((((length(_e73) - 1f) * 32f) + 0.5f));
    let _e82 = position_1;
    let _e84 = groundIn_1;
    if (_e84 < 10000000000f) {
        let _e87 = position_1;
        let _e89 = groundIn_1;
        local_2 = (_e87.y - _e89);
    } else {
        let _e91 = position_1;
        local_2 = _e91.y;
    }
    let _e94 = local_2;
    let _e95 = position_1;
    grainPosition = vec3<f32>(_e82.x, _e94, _e95.z);
    let _e99 = global.matrix;
    let _e100 = position_1;
    let _e102 = position_1;
    let _e104 = groundIn_1;
    let _e105 = global.exaggeration;
    let _e110 = position_1;
    let _e113 = global.offset;
    let _e114 = (vec3<f32>(_e100.x, (_e102.y + (_e104 * (_e105 - 1f))), _e110.z) + _e113);
    gl_Position = (_e99 * vec4<f32>(_e114.x, _e114.y, _e114.z, 1f));
    let _e122 = gl_Position;
    let _e124 = gl_Position;
    gl_Position.z = ((_e122.z + _e124.w) * 0.5f);
    return;
}

@vertex 
fn main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) albedo: vec3<f32>, @location(4) groundIn: f32) -> VertexOutput {
    position_1 = position;
    normal_1 = normal;
    albedo_1 = albedo;
    groundIn_1 = groundIn;
    main_1();
    let _e47 = n;
    let _e49 = base;
    let _e51 = facadePosition;
    let _e53 = grainPosition;
    let _e55 = materialClass;
    let _e57 = gl_Position;
    return VertexOutput(_e47, _e49, _e51, _e53, _e55, _e57);
}
`,ze=`diagnostic(off, derivative_uniformity);
struct BuildingParams {
    matrix: mat4x4<f32>,
    offset: vec3<f32>,
    exaggeration: f32,
    sectorOrigin: vec2<f32>,
    uNight: i32,
    material: vec3<f32>,
    tint: vec3<f32>,
    recolored: i32,
    useTex: i32,
    softFrom: f32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: BuildingParams;
var<private> n_1: vec3<f32>;
var<private> base_1: vec3<f32>;
var<private> facadePosition_1: vec3<f32>;
var<private> grainPosition_1: vec3<f32>;
var<private> materialClass_1: f32;
var<private> color_4: vec4<f32>;

fn baseOcclusion(normal: vec3<f32>, p: vec3<f32>) -> f32 {
    var normal_1: vec3<f32>;
    var p_1: vec3<f32>;

    normal_1 = normal;
    p_1 = p;
    let _e30 = normal_1;
    let _e36 = p_1;
    if ((abs(normalize(_e30).y) > 0.5f) || (_e36.y < -1000f)) {
        return 1f;
    }
    let _e47 = p_1;
    return mix(0.72f, 1f, smoothstep(0f, 2.4f, _e47.y));
}

fn moonlight(c: vec3<f32>) -> vec3<f32> {
    var c_1: vec3<f32>;
    var y: f32;

    c_1 = c;
    let _e28 = c_1;
    y = dot(_e28, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
    let _e35 = c_1;
    let _e46 = y;
    return ((_e35 * vec3<f32>(0.16f, 0.23f, 0.38f)) + (vec3<f32>(0.018f, 0.029f, 0.065f) * (0.35f + _e46)));
}

fn buildingLight(normal_2: vec3<f32>, plane: vec3<f32>) -> f32 {
    var normal_3: vec3<f32>;
    var plane_1: vec3<f32>;
    var oldSun: vec3<f32> = vec3<f32>(-0.40561607f, 0.8619342f, 0.30421206f);
    var detail: f32;
    var p_2: vec3<f32>;
    var sun: f32;
    var fill: f32;
    var h: f32;
    var local: f32;
    var facing: f32;
    var roof: f32;

    normal_3 = normal_2;
    plane_1 = plane;
    let _e43 = normal_3;
    let _e44 = oldSun;
    detail = (0.55f + (0.45f * abs(dot(_e43, _e44))));
    let _e50 = plane_1;
    if (_e50.y < 0.05f) {
        let _e54 = detail;
        return _e54;
    }
    let _e55 = plane_1;
    p_2 = normalize(_e55);
    let _e59 = p_2;
    sun = max(0f, dot(_e59, vec3<f32>(-0.7f, 0.62f, -0.36f)));
    let _e70 = p_2;
    fill = max(0f, (dot(_e70, vec3<f32>(0.35f, 0.76f, 0.55f)) / 1.0026f));
    let _e80 = p_2;
    h = length(_e80.xz);
    let _e84 = h;
    if (_e84 > 0.001f) {
        let _e88 = p_2;
        let _e92 = p_2;
        let _e97 = h;
        let _e102 = p_2;
        local = (((-(((0.8f * _e88.x) + (0.5f * _e92.z))) / _e97) * 0.2f) * min(1f, (_e102.y / 0.6f)));
    } else {
        local = 0f;
    }
    let _e110 = local;
    facing = _e110;
    let _e114 = sun;
    let _e118 = fill;
    let _e133 = facing;
    roof = ((((0.3f + (1.1f * _e114)) + (0.3f * _e118)) / 1.2094088f) + _e133);
    let _e136 = roof;
    let _e137 = detail;
    let _e141 = plane_1;
    let _e142 = oldSun;
    return ((_e136 * _e137) / (0.55f + (0.45f * abs(dot(_e141, _e142)))));
}

fn buildingNight(color: vec3<f32>, p_3: vec3<f32>, lit: bool) -> vec3<f32> {
    var color_1: vec3<f32>;
    var p_4: vec3<f32>;
    var lit_1: bool;

    color_1 = color;
    p_4 = p_3;
    lit_1 = lit;
    let _e32 = global.uNight;
    if (_e32 == 0i) {
        let _e35 = color_1;
        return _e35;
    }
    let _e36 = color_1;
    let _e37 = moonlight(_e36);
    color_1 = _e37;
    let _e38 = lit_1;
    if !(_e38) {
        let _e40 = color_1;
        return _e40;
    }
    let _e41 = color_1;
    let _e50 = p_4;
    let _e51 = fwidth(_e50);
    return mix(_e41, vec3<f32>(1f, 0.61f, 0.22f), vec3((0.93f * (1f - smoothstep(0.45f, 1.2f, length(_e51))))));
}

fn grainHash(p_5: vec2<f32>) -> f32 {
    var p_6: vec2<f32>;

    p_6 = p_5;
    let _e28 = p_6;
    return fract((sin(dot(_e28, vec2<f32>(127.1f, 311.7f))) * 43758.547f));
}

fn grainNoise(p_7: vec2<f32>) -> f32 {
    var p_8: vec2<f32>;
    var i: vec2<f32>;
    var f: vec2<f32>;

    p_8 = p_7;
    let _e28 = p_8;
    i = floor(_e28);
    let _e31 = p_8;
    f = fract(_e31);
    let _e34 = f;
    let _e35 = f;
    let _e39 = f;
    f = ((_e34 * _e35) * (vec2(3f) - (2f * _e39)));
    let _e44 = i;
    let _e45 = grainHash(_e44);
    let _e46 = i;
    let _e51 = grainHash((_e46 + vec2<f32>(1f, 0f)));
    let _e52 = f;
    let _e55 = i;
    let _e60 = grainHash((_e55 + vec2<f32>(0f, 1f)));
    let _e61 = i;
    let _e66 = grainHash((_e61 + vec2<f32>(1f, 1f)));
    let _e67 = f;
    let _e70 = f;
    return ((mix(mix(_e45, _e51, _e52.x), mix(_e60, _e66, _e67.x), _e70.y) * 2f) - 1f);
}

fn grainKeep(wavelength: f32, fp: f32) -> f32 {
    var wavelength_1: f32;
    var fp_1: f32;

    wavelength_1 = wavelength;
    fp_1 = fp;
    let _e33 = fp_1;
    let _e34 = wavelength_1;
    return (1f - smoothstep(0.12f, 0.3f, (_e33 / _e34)));
}

fn grainJoint(f_1: f32, w: f32) -> f32 {
    var f_2: f32;
    var w_1: f32;

    f_2 = f_1;
    w_1 = w;
    let _e31 = w_1;
    let _e34 = f_2;
    let _e38 = w_1;
    return (smoothstep((1f - _e31), 0.98f, _e34) - (0.01f + (0.5f * _e38)));
}

fn materialGrain(color_2: vec3<f32>, cls: f32, N: vec3<f32>, p_9: vec3<f32>, fp_2: f32) -> vec3<f32> {
    var color_3: vec3<f32>;
    var cls_1: f32;
    var N_1: vec3<f32>;
    var p_10: vec3<f32>;
    var fp_3: f32;
    var h_1: f32;
    var d: vec2<f32> = vec2<f32>(1f, 0f);
    var q: vec2<f32>;
    var c_2: i32;
    var cw: vec4<f32> = vec4<f32>(0.2f, 0.4f, 0.2f, 0.12f);
    var k: vec4<f32> = vec4<f32>(0.035f, 0.012f, 0.035f, 0f);
    var run: vec2<f32> = vec2(1f);
    var bond: f32 = 0.5f;
    var w_2: vec3<f32> = vec3<f32>(0.035f, 1f, 1f);
    var row: f32;
    var u: vec2<f32>;
    var f_3: vec2<f32>;
    var keepRow: f32;
    var keepColumn: f32;
    var g: f32;
    var level: f32;
    var lo: f32;
    var s: vec2<f32>;

    color_3 = color_2;
    cls_1 = cls;
    N_1 = N;
    p_10 = p_9;
    fp_3 = fp_2;
    let _e36 = cls_1;
    let _e39 = fp_3;
    if ((_e36 < 0.5f) || (_e39 > 1f)) {
        let _e43 = color_3;
        return _e43;
    }
    let _e44 = N_1;
    h_1 = length(_e44.xz);
    let _e52 = h_1;
    if (_e52 > 0.02f) {
        let _e55 = N_1;
        let _e57 = h_1;
        d = (_e55.xz / vec2(_e57));
    }
    let _e60 = p_10;
    let _e62 = d;
    let _e65 = d;
    let _e69 = p_10;
    q = vec2<f32>(dot(_e60.xz, vec2<f32>(-(_e62.y), _e65.x)), _e69.y);
    let _e73 = N_1;
    if (_e73.y > 0.3f) {
        let _e78 = p_10;
        let _e80 = d;
        let _e82 = N_1;
        q.y = (dot(_e78.xz, _e80) / _e82.y);
    }
    let _e85 = cls_1;
    c_2 = i32((_e85 + 0.5f));
    let _e107 = c_2;
    if (_e107 == 2i) {
        {
            bond = 0f;
            cw = vec4<f32>(0.2f, 0.4f, 0.15f, 0.35f);
            k = vec4<f32>(0.012f, 0.035f, 0.035f, 0f);
        }
    } else {
        let _e121 = c_2;
        if (_e121 == 3i) {
            {
                bond = 0f;
                cw = vec4<f32>(0.2f, 0.4f, 0.12f, 0.35f);
                k = vec4<f32>(0.006f, 0.04f, 0.012f, 0f);
            }
        } else {
            let _e135 = c_2;
            if (_e135 == 4i) {
                {
                    cw = vec4<f32>(0.25f, 0.22f, 0.15f, 0.1f);
                    k = vec4<f32>(0.03f, 0.012f, 0.02f, 0f);
                }
            } else {
                let _e148 = c_2;
                if (_e148 == 5i) {
                    {
                        cw = vec4<f32>(0.55f, 0.4f, 0.15f, 0.1f);
                        k = vec4<f32>(0.04f, 0.03f, 0.04f, 0f);
                    }
                } else {
                    let _e161 = c_2;
                    if (_e161 == 6i) {
                        {
                            cw = vec4<f32>(0.7f, 0.7f, 0.07f, 0.07f);
                            k = vec4<f32>(0.035f, 0.035f, 0.03f, 0f);
                        }
                    } else {
                        let _e174 = c_2;
                        if (_e174 == 7i) {
                            {
                                cw = vec4<f32>(0.08f, 1.5f, 0.12f, 0.3f);
                                k = vec4<f32>(0.02f, 0f, 0.03f, 0.03f);
                                run = vec2<f32>(0.12f, 1.2f);
                            }
                        } else {
                            let _e190 = c_2;
                            if (_e190 == 8i) {
                                {
                                    cw = vec4<f32>(0.05f, 2f, 0.1f, 0.3f);
                                    k = vec4<f32>(0.006f, 0f, 0.02f, 0.015f);
                                    run = vec2<f32>(0.08f, 1.6f);
                                }
                            } else {
                                let _e206 = c_2;
                                if (_e206 == 9i) {
                                    {
                                        cw = vec4<f32>(0.35f, 0.8f, 0.3f, 0.2f);
                                        k = vec4<f32>(0.05f, 0.012f, 0.03f, 0.02f);
                                        run = vec2<f32>(0.1f, 0.5f);
                                    }
                                } else {
                                    let _e222 = c_2;
                                    if (_e222 == 10i) {
                                        {
                                            cw = vec4<f32>(0.4f, 0.4f, 0.1f, 0.1f);
                                            k = vec4<f32>(0f, 0f, 0f, 0.05f);
                                            run = vec2(0.3f);
                                        }
                                    } else {
                                        let _e237 = c_2;
                                        if (_e237 == 11i) {
                                            {
                                                cw = vec4<f32>(0.14f, 0.3f, 0.2f, 0.12f);
                                                k = vec4<f32>(0.035f, 0.012f, 0.04f, 0f);
                                            }
                                        } else {
                                            let _e250 = c_2;
                                            if (_e250 == 12i) {
                                                {
                                                    cw = vec4<f32>(1.4f, 0.8f, 0.08f, 0.06f);
                                                    k = vec4<f32>(0.035f, 0.03f, 0.03f, 0.012f);
                                                    run = vec2<f32>(0.5f, 0.07f);
                                                }
                                            } else {
                                                let _e266 = c_2;
                                                if (_e266 == 13i) {
                                                    {
                                                        bond = 0f;
                                                        cw = vec4<f32>(0.1f, 2.2f, 0.05f, 0.35f);
                                                        k = vec4<f32>(0.012f, 0.04f, 0.02f, 0f);
                                                    }
                                                } else {
                                                    let _e280 = c_2;
                                                    if (_e280 == 14i) {
                                                        {
                                                            cw = vec4<f32>(0.9f, 0.9f, 0.1f, 0.1f);
                                                            k = vec4<f32>(0f, 0f, 0f, 0.045f);
                                                            run = vec2(0.5f);
                                                        }
                                                    } else {
                                                        let _e295 = c_2;
                                                        if (_e295 == 15i) {
                                                            {
                                                                cw = vec4<f32>(0.9f, 0.9f, 0.1f, 0.1f);
                                                                k = vec4<f32>(0f, 0f, 0f, 0.02f);
                                                                run = vec2(0.6f);
                                                            }
                                                        } else {
                                                            let _e310 = c_2;
                                                            if (_e310 == 16i) {
                                                                {
                                                                    bond = 0f;
                                                                    cw = vec4<f32>(0.6f, 2.4f, 0.03f, 0.08f);
                                                                    k = vec4<f32>(0.02f, 0.05f, 0.012f, 0f);
                                                                }
                                                            } else {
                                                                let _e324 = c_2;
                                                                if (_e324 == 17i) {
                                                                    {
                                                                        bond = 0f;
                                                                        cw = vec4<f32>(1.5f, 0.8f, 0.08f, 0.05f);
                                                                        k = vec4<f32>(0.03f, 0.025f, 0f, 0.012f);
                                                                        run = vec2(0.4f);
                                                                    }
                                                                } else {
                                                                    let _e340 = c_2;
                                                                    if (_e340 == 18i) {
                                                                        {
                                                                            cw = vec4<f32>(1.4f, 1.3f, 0.05f, 0.05f);
                                                                            k = vec4<f32>(0.03f, 0.03f, 0.03f, 0f);
                                                                        }
                                                                    } else {
                                                                        let _e353 = c_2;
                                                                        if (_e353 == 19i) {
                                                                            {
                                                                                cw = vec4<f32>(0.9f, 0.9f, 0.1f, 0.1f);
                                                                                k = vec4<f32>(0f, 0f, 0f, 0.025f);
                                                                                run = vec2<f32>(0.3f, 2.2f);
                                                                            }
                                                                        } else {
                                                                            let _e369 = c_2;
                                                                            if (_e369 == 20i) {
                                                                                {
                                                                                    bond = 0f;
                                                                                    cw = vec4<f32>(1.2f, 2.8f, 0.06f, 0.11f);
                                                                                    k = vec4<f32>(0.05f, 0.05f, 0f, 0.012f);
                                                                                    run = vec2<f32>(0.3f, 2.2f);
                                                                                }
                                                                            } else {
                                                                                let _e386 = c_2;
                                                                                if (_e386 == 21i) {
                                                                                    {
                                                                                        cw = vec4<f32>(2.4f, 0.25f, 0.18f, 0.04f);
                                                                                        k = vec4<f32>(0.035f, 0.012f, 0.03f, 0.01f);
                                                                                        run = vec2<f32>(1.2f, 0.06f);
                                                                                    }
                                                                                } else {
                                                                                    let _e402 = c_2;
                                                                                    if (_e402 == 22i) {
                                                                                        {
                                                                                            cw = vec4<f32>(0.22f, 0.075f, 0.2f, 0.1f);
                                                                                            k = vec4<f32>(0.025f, 0.01f, 0.035f, 0f);
                                                                                        }
                                                                                    } else {
                                                                                        let _e415 = c_2;
                                                                                        if (_e415 == 23i) {
                                                                                            {
                                                                                                cw = vec4<f32>(0.5f, 0.3f, 0.15f, 0.1f);
                                                                                                k = vec4<f32>(0.04f, 0.02f, 0.04f, 0f);
                                                                                            }
                                                                                        } else {
                                                                                            let _e428 = c_2;
                                                                                            if (_e428 == 24i) {
                                                                                                {
                                                                                                    cw = vec4<f32>(0.4f, 0.14f, 0.2f, 0.1f);
                                                                                                    k = vec4<f32>(0.015f, 0f, 0.012f, 0.03f);
                                                                                                    run = vec2<f32>(0.35f, 2.2f);
                                                                                                }
                                                                                            } else {
                                                                                                let _e444 = c_2;
                                                                                                if (_e444 == 25i) {
                                                                                                    {
                                                                                                        cw = vec4<f32>(0.5f, 0.9f, 0.1f, 0.1f);
                                                                                                        k = vec4<f32>(0f, 0.012f, 0.02f, 0.03f);
                                                                                                        run = vec2(0.4f);
                                                                                                    }
                                                                                                } else {
                                                                                                    let _e459 = c_2;
                                                                                                    if (_e459 == 26i) {
                                                                                                        {
                                                                                                            bond = 0f;
                                                                                                            cw = vec4<f32>(0.1f, 2.2f, 0.05f, 0.35f);
                                                                                                            k = vec4<f32>(0.012f, 0.04f, 0.02f, 0f);
                                                                                                        }
                                                                                                    } else {
                                                                                                        let _e473 = c_2;
                                                                                                        if (_e473 == 27i) {
                                                                                                            {
                                                                                                                cw = vec4<f32>(0.4f, 0.3f, 0.15f, 0.1f);
                                                                                                                k = vec4<f32>(0.015f, 0.01f, 0.03f, 0.02f);
                                                                                                                run = vec2(0.5f);
                                                                                                            }
                                                                                                        } else {
                                                                                                            let _e488 = c_2;
                                                                                                            if (_e488 == 28i) {
                                                                                                                {
                                                                                                                    cw = vec4<f32>(0.9f, 0.9f, 0.1f, 0.1f);
                                                                                                                    k = vec4<f32>(0f, 0f, 0f, 0.03f);
                                                                                                                    run = vec2(0.6f);
                                                                                                                }
                                                                                                            } else {
                                                                                                                let _e503 = c_2;
                                                                                                                if (_e503 == 29i) {
                                                                                                                    {
                                                                                                                        cw = vec4<f32>(0.9f, 0.45f, 0.06f, 0.05f);
                                                                                                                        k = vec4<f32>(0.03f, 0.02f, 0.025f, 0f);
                                                                                                                    }
                                                                                                                } else {
                                                                                                                    let _e516 = c_2;
                                                                                                                    if (_e516 == 30i) {
                                                                                                                        {
                                                                                                                            bond = 0f;
                                                                                                                            cw = vec4<f32>(1.2f, 2.6f, 0.03f, 0.03f);
                                                                                                                            k = vec4<f32>(0.012f, 0.012f, 0.01f, 0.03f);
                                                                                                                            run = vec2<f32>(0.5f, 2.2f);
                                                                                                                        }
                                                                                                                    } else {
                                                                                                                        let _e533 = c_2;
                                                                                                                        if (_e533 == 31i) {
                                                                                                                            {
                                                                                                                                bond = 0f;
                                                                                                                                cw = vec4<f32>(1.5f, 3.2f, 0.05f, 0.06f);
                                                                                                                                k = vec4<f32>(0.05f, 0.05f, 0.012f, 0f);
                                                                                                                            }
                                                                                                                        }
                                                                                                                    }
                                                                                                                }
                                                                                                            }
                                                                                                        }
                                                                                                    }
                                                                                                }
                                                                                            }
                                                                                        }
                                                                                    }
                                                                                }
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let _e552 = c_2;
    let _e555 = c_2;
    let _e559 = c_2;
    if (((_e552 == 3i) || (_e555 == 16i)) || (_e559 == 17i)) {
        w_2 = vec3<f32>(0.014f, 1f, 2.5f);
    } else {
        let _e567 = c_2;
        let _e570 = c_2;
        let _e574 = c_2;
        let _e578 = c_2;
        if ((((_e567 == 4i) || (_e570 == 15i)) || (_e574 == 19i)) || (_e578 == 22i)) {
            w_2 = vec3<f32>(0.02f, 1f, 1f);
        } else {
            let _e586 = c_2;
            let _e589 = c_2;
            let _e593 = c_2;
            let _e597 = c_2;
            if ((((_e586 == 7i) || (_e589 == 9i)) || (_e593 == 11i)) || (_e597 == 24i)) {
                w_2 = vec3<f32>(0.035f, 0.4f, 2.5f);
            } else {
                let _e605 = c_2;
                let _e608 = c_2;
                let _e612 = c_2;
                if (((_e605 == 8i) || (_e608 == 13i)) || (_e612 == 26i)) {
                    w_2 = vec3<f32>(0.02f, 0.3f, 3f);
                } else {
                    let _e620 = c_2;
                    if (_e620 == 10i) {
                        w_2 = vec3<f32>(0.05f, 1f, 1f);
                    } else {
                        let _e627 = c_2;
                        let _e630 = c_2;
                        if ((_e627 == 12i) || (_e630 == 21i)) {
                            w_2 = vec3<f32>(0.03f, 2.5f, 0.4f);
                        } else {
                            let _e638 = c_2;
                            if (_e638 == 29i) {
                                w_2 = vec3<f32>(0.02f, 1f, 1f);
                            } else {
                                let _e645 = c_2;
                                if (_e645 == 31i) {
                                    w_2 = vec3<f32>(0.008f, 1f, 1f);
                                } else {
                                    let _e652 = c_2;
                                    if (_e652 == 28i) {
                                        w_2.x = 0f;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let _e657 = q;
    let _e659 = cw;
    row = floor((_e657.y / _e659.y));
    let _e664 = q;
    let _e666 = cw;
    let _e669 = bond;
    let _e670 = row;
    let _e678 = q;
    let _e680 = cw;
    u = vec2<f32>(((_e664.x / _e666.x) + (_e669 * (_e670 - (floor((_e670 / 2f)) * 2f)))), (_e678.y / _e680.y));
    let _e685 = u;
    f_3 = fract(_e685);
    let _e688 = cw;
    let _e690 = fp_3;
    let _e691 = grainKeep(_e688.y, _e690);
    keepRow = _e691;
    let _e693 = cw;
    let _e695 = fp_3;
    let _e696 = grainKeep(_e693.x, _e695);
    keepColumn = _e696;
    let _e698 = k;
    let _e701 = f_3;
    let _e703 = cw;
    let _e705 = grainJoint(_e701.y, _e703.z);
    let _e707 = keepRow;
    let _e709 = k;
    let _e711 = f_3;
    let _e713 = cw;
    let _e715 = grainJoint(_e711.x, _e713.w);
    let _e717 = keepColumn;
    g = (((-(_e698.x) * _e705) * _e707) - ((_e709.y * _e715) * _e717));
    let _e721 = g;
    let _e722 = k;
    let _e724 = u;
    let _e726 = cls_1;
    let _e731 = grainHash((floor(_e724) + vec2((_e726 * 17f))));
    let _e737 = keepRow;
    let _e738 = keepColumn;
    g = (_e721 + ((_e722.z * ((_e731 * 2f) - 1f)) * min(_e737, _e738)));
    let _e742 = g;
    let _e743 = k;
    let _e745 = q;
    let _e746 = run;
    let _e748 = cls_1;
    let _e751 = grainNoise(((_e745 / _e746) + vec2(_e748)));
    let _e753 = run;
    let _e755 = run;
    let _e758 = fp_3;
    let _e759 = grainKeep(min(_e753.x, _e755.y), _e758);
    g = (_e742 + ((_e743.w * _e751) * _e759));
    let _e762 = fp_3;
    level = log2((max(_e762, 0.002f) * 6f));
    let _e769 = level;
    lo = floor(_e769);
    let _e772 = q;
    let _e773 = w_2;
    s = (_e772 / _e773.yz);
    let _e777 = g;
    let _e778 = w_2;
    let _e781 = keepRow;
    let _e782 = keepColumn;
    let _e789 = fp_3;
    let _e793 = s;
    let _e794 = lo;
    let _e798 = cls_1;
    let _e803 = grainNoise(((_e793 * exp2(-(_e794))) + vec2((_e798 * 3.7f))));
    let _e804 = s;
    let _e805 = lo;
    let _e811 = cls_1;
    let _e816 = grainNoise(((_e804 * exp2((-(_e805) - 1f))) + vec2((_e811 * 9.1f))));
    let _e817 = level;
    let _e818 = lo;
    g = (_e777 + (((_e778.x * (1f - min(_e781, _e782))) * (1f - smoothstep(0.5f, 1f, _e789))) * mix(_e803, _e816, (_e817 - _e818))));
    let _e823 = color_3;
    let _e825 = g;
    return (_e823 * (1f + _e825));
}

fn coverLight(light: f32, cls_2: f32, N_2: vec3<f32>) -> f32 {
    var light_1: f32;
    var cls_3: f32;
    var N_3: vec3<f32>;
    var up: f32 = 0.09f;
    var down: f32 = 0.14f;
    var d_1: f32;

    light_1 = light;
    cls_3 = cls_2;
    N_3 = N_2;
    let _e32 = N_3;
    let _e36 = cls_3;
    let _e40 = cls_3;
    let _e44 = cls_3;
    if ((((_e32.y < 0.05f) || (_e36 < 0.5f)) || (_e40 > 18.5f)) || (abs((_e44 - 16f)) < 0.5f)) {
        let _e51 = light_1;
        return _e51;
    }
    let _e56 = cls_3;
    if (_e56 < 6.5f) {
        {
            up = 0.14f;
            down = 0.2f;
        }
    }
    let _e61 = light_1;
    d_1 = (_e61 - 1f);
    let _e65 = d_1;
    if (_e65 > 0f) {
        let _e69 = up;
        let _e71 = d_1;
        let _e73 = up;
        return (1f + (_e69 * (1f - exp((-(_e71) / _e73)))));
    }
    let _e80 = down;
    let _e82 = d_1;
    let _e83 = down;
    return (1f - (_e80 * (1f - exp((_e82 / _e83)))));
}

fn main_1() {
    var N_4: vec3<f32>;
    var fp_4: f32;
    var lit_2: bool;
    var local_1: f32;
    var cls_4: f32;
    var light_2: f32;

    let _e26 = n_1;
    N_4 = normalize(_e26);
    let _e29 = grainPosition_1;
    let _e30 = fwidth(_e29);
    fp_4 = length(_e30);
    let _e33 = materialClass_1;
    lit_2 = (_e33 > 31.5f);
    let _e37 = lit_2;
    if _e37 {
        local_1 = 0f;
    } else {
        let _e39 = materialClass_1;
        local_1 = _e39;
    }
    let _e41 = local_1;
    cls_4 = _e41;
    let _e43 = N_4;
    let _e44 = N_4;
    let _e45 = buildingLight(_e43, _e44);
    let _e46 = cls_4;
    let _e47 = N_4;
    let _e48 = coverLight(_e45, _e46, _e47);
    light_2 = _e48;
    let _e50 = base_1;
    let _e51 = cls_4;
    let _e52 = N_4;
    let _e53 = grainPosition_1;
    let _e54 = fp_4;
    let _e55 = materialGrain(_e50, _e51, _e52, _e53, _e54);
    let _e56 = light_2;
    let _e58 = n_1;
    let _e59 = facadePosition_1;
    let _e60 = baseOcclusion(_e58, _e59);
    let _e62 = facadePosition_1;
    let _e63 = lit_2;
    let _e64 = buildingNight(((_e55 * _e56) * _e60), _e62, _e63);
    color_4 = vec4<f32>(_e64.x, _e64.y, _e64.z, 1f);
    return;
}

@fragment 
fn main(@location(0) n: vec3<f32>, @location(1) base: vec3<f32>, @location(2) facadePosition: vec3<f32>, @location(3) grainPosition: vec3<f32>, @location(4) @interpolate(flat) materialClass: f32) -> FragmentOutput {
    n_1 = n;
    base_1 = base;
    facadePosition_1 = facadePosition;
    grainPosition_1 = grainPosition;
    materialClass_1 = materialClass;
    main_1();
    let _e43 = color_4;
    return FragmentOutput(_e43);
}
`,Ge=`struct BuildingParams {
    matrix: mat4x4<f32>,
    offset: vec3<f32>,
    exaggeration: f32,
    sectorOrigin: vec2<f32>,
    uNight: i32,
    material: vec3<f32>,
    tint: vec3<f32>,
    recolored: i32,
    useTex: i32,
    softFrom: f32,
}

struct VertexOutput {
    @location(0) n: vec3<f32>,
    @location(1) wp: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) @interpolate(flat) layer: f32,
    @location(4) facadePosition: vec3<f32>,
    @location(5) @interpolate(flat) litWindow: f32,
    @builtin(position) gl_Position: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: BuildingParams;
var<private> position_1: vec3<f32>;
var<private> normal_1: vec3<f32>;
var<private> uvIn_1: vec2<f32>;
var<private> layerIn_1: f32;
var<private> groundIn_1: f32;
var<private> n: vec3<f32>;
var<private> wp: vec3<f32>;
var<private> uv: vec2<f32>;
var<private> layer: f32;
var<private> facadePosition: vec3<f32>;
var<private> litWindow: f32;
var<private> gl_Position: vec4<f32>;

fn main_1() {
    var local: f32;
    var k: f32;
    var local_1: f32;
    var p: vec3<f32>;
    var local_2: f32;

    let _e31 = position_1;
    let _e33 = groundIn_1;
    if (_e31.y > (_e33 + 0.01f)) {
        local = 1f;
    } else {
        let _e38 = global.exaggeration;
        local = _e38;
    }
    let _e40 = local;
    k = _e40;
    let _e42 = normal_1;
    let _e44 = normal_1;
    let _e46 = k;
    let _e48 = normal_1;
    n = normalize(vec3<f32>(_e42.x, (_e44.y / _e46), _e48.z));
    let _e52 = normal_1;
    if (length(_e52) > 1.5f) {
        local_1 = 1f;
    } else {
        local_1 = 0f;
    }
    let _e59 = local_1;
    litWindow = _e59;
    let _e60 = position_1;
    let _e62 = position_1;
    let _e64 = groundIn_1;
    let _e65 = global.exaggeration;
    let _e70 = position_1;
    let _e73 = global.offset;
    p = (vec3<f32>(_e60.x, (_e62.y + (_e64 * (_e65 - 1f))), _e70.z) + _e73);
    let _e76 = p;
    wp = _e76;
    let _e77 = uvIn_1;
    uv = _e77;
    let _e78 = layerIn_1;
    layer = _e78;
    let _e79 = position_1;
    let _e81 = global.sectorOrigin;
    let _e84 = groundIn_1;
    if (_e84 < 10000000000f) {
        let _e87 = position_1;
        let _e89 = groundIn_1;
        local_2 = (_e87.y - _e89);
    } else {
        local_2 = -10000f;
    }
    let _e94 = local_2;
    let _e95 = position_1;
    let _e97 = global.sectorOrigin;
    facadePosition = vec3<f32>((_e79.x + _e81.x), _e94, (_e95.z + _e97.y));
    let _e102 = global.matrix;
    let _e103 = p;
    gl_Position = (_e102 * vec4<f32>(_e103.x, _e103.y, _e103.z, 1f));
    let _e111 = gl_Position;
    let _e113 = gl_Position;
    gl_Position.z = ((_e111.z + _e113.w) * 0.5f);
    return;
}

@vertex 
fn main(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uvIn: vec2<f32>, @location(3) layerIn: f32, @location(4) groundIn: f32) -> VertexOutput {
    position_1 = position;
    normal_1 = normal;
    uvIn_1 = uvIn;
    layerIn_1 = layerIn;
    groundIn_1 = groundIn;
    main_1();
    let _e53 = n;
    let _e55 = wp;
    let _e57 = uv;
    let _e59 = layer;
    let _e61 = facadePosition;
    let _e63 = litWindow;
    let _e65 = gl_Position;
    return VertexOutput(_e53, _e55, _e57, _e59, _e61, _e63, _e65);
}
`,Re=`diagnostic(off, derivative_uniformity);
struct BuildingParams {
    matrix: mat4x4<f32>,
    offset: vec3<f32>,
    exaggeration: f32,
    sectorOrigin: vec2<f32>,
    uNight: i32,
    material: vec3<f32>,
    tint: vec3<f32>,
    recolored: i32,
    useTex: i32,
    softFrom: f32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: BuildingParams;
@group(0) @binding(4) 
var sRepeat: sampler;
var<private> n_1: vec3<f32>;
var<private> wp_1: vec3<f32>;
var<private> uv_1: vec2<f32>;
var<private> layer_1: f32;
var<private> facadePosition_1: vec3<f32>;
var<private> litWindow_1: f32;
@group(0) @binding(16) 
var albedoTex: texture_2d_array<f32>;
@group(0) @binding(17) 
var normalTex: texture_2d_array<f32>;
var<private> color_2: vec4<f32>;

fn glDFdy(v: f32) -> f32 {
    var v_1: f32;

    v_1 = v;
    let _e23 = v_1;
    let _e24 = dpdy(_e23);
    return -(_e24);
}

fn glDFdy_1(v_2: vec2<f32>) -> vec2<f32> {
    var v_3: vec2<f32>;

    v_3 = v_2;
    let _e23 = v_3;
    let _e24 = dpdy(_e23);
    return -(_e24);
}

fn glDFdy_2(v_4: vec3<f32>) -> vec3<f32> {
    var v_5: vec3<f32>;

    v_5 = v_4;
    let _e23 = v_5;
    let _e24 = dpdy(_e23);
    return -(_e24);
}

fn glDFdy_3(v_6: vec4<f32>) -> vec4<f32> {
    var v_7: vec4<f32>;

    v_7 = v_6;
    let _e23 = v_7;
    let _e24 = dpdy(_e23);
    return -(_e24);
}

fn baseOcclusion(normal: vec3<f32>, p: vec3<f32>) -> f32 {
    var normal_1: vec3<f32>;
    var p_1: vec3<f32>;

    normal_1 = normal;
    p_1 = p;
    let _e34 = normal_1;
    let _e40 = p_1;
    if ((abs(normalize(_e34).y) > 0.5f) || (_e40.y < -1000f)) {
        return 1f;
    }
    let _e51 = p_1;
    return mix(0.72f, 1f, smoothstep(0f, 2.4f, _e51.y));
}

fn moonlight(c: vec3<f32>) -> vec3<f32> {
    var c_1: vec3<f32>;
    var y: f32;

    c_1 = c;
    let _e32 = c_1;
    y = dot(_e32, vec3<f32>(0.2126f, 0.7152f, 0.0722f));
    let _e39 = c_1;
    let _e50 = y;
    return ((_e39 * vec3<f32>(0.16f, 0.23f, 0.38f)) + (vec3<f32>(0.018f, 0.029f, 0.065f) * (0.35f + _e50)));
}

fn buildingLight(normal_2: vec3<f32>, plane: vec3<f32>) -> f32 {
    var normal_3: vec3<f32>;
    var plane_1: vec3<f32>;
    var oldSun: vec3<f32> = vec3<f32>(-0.40561607f, 0.8619342f, 0.30421206f);
    var detail: f32;
    var p_2: vec3<f32>;
    var sun: f32;
    var fill: f32;
    var h: f32;
    var local: f32;
    var facing: f32;
    var roof: f32;

    normal_3 = normal_2;
    plane_1 = plane;
    let _e47 = normal_3;
    let _e48 = oldSun;
    detail = (0.55f + (0.45f * abs(dot(_e47, _e48))));
    let _e54 = plane_1;
    if (_e54.y < 0.05f) {
        let _e58 = detail;
        return _e58;
    }
    let _e59 = plane_1;
    p_2 = normalize(_e59);
    let _e63 = p_2;
    sun = max(0f, dot(_e63, vec3<f32>(-0.7f, 0.62f, -0.36f)));
    let _e74 = p_2;
    fill = max(0f, (dot(_e74, vec3<f32>(0.35f, 0.76f, 0.55f)) / 1.0026f));
    let _e84 = p_2;
    h = length(_e84.xz);
    let _e88 = h;
    if (_e88 > 0.001f) {
        let _e92 = p_2;
        let _e96 = p_2;
        let _e101 = h;
        let _e106 = p_2;
        local = (((-(((0.8f * _e92.x) + (0.5f * _e96.z))) / _e101) * 0.2f) * min(1f, (_e106.y / 0.6f)));
    } else {
        local = 0f;
    }
    let _e114 = local;
    facing = _e114;
    let _e118 = sun;
    let _e122 = fill;
    let _e137 = facing;
    roof = ((((0.3f + (1.1f * _e118)) + (0.3f * _e122)) / 1.2094088f) + _e137);
    let _e140 = roof;
    let _e141 = detail;
    let _e145 = plane_1;
    let _e146 = oldSun;
    return ((_e140 * _e141) / (0.55f + (0.45f * abs(dot(_e145, _e146)))));
}

fn buildingNight(color: vec3<f32>, p_3: vec3<f32>, lit: bool) -> vec3<f32> {
    var color_1: vec3<f32>;
    var p_4: vec3<f32>;
    var lit_1: bool;

    color_1 = color;
    p_4 = p_3;
    lit_1 = lit;
    let _e36 = global.uNight;
    if (_e36 == 0i) {
        let _e39 = color_1;
        return _e39;
    }
    let _e40 = color_1;
    let _e41 = moonlight(_e40);
    color_1 = _e41;
    let _e42 = lit_1;
    if !(_e42) {
        let _e44 = color_1;
        return _e44;
    }
    let _e45 = color_1;
    let _e54 = p_4;
    let _e55 = fwidth(_e54);
    return mix(_e45, vec3<f32>(1f, 0.61f, 0.22f), vec3((0.93f * (1f - smoothstep(0.45f, 1.2f, length(_e55))))));
}

fn main_1() {
    var N: vec3<f32>;
    var dp1_: vec3<f32>;
    var dp2_: vec3<f32>;
    var duv1_: vec2<f32>;
    var duv2_: vec2<f32>;
    var l: f32;
    var albedo: vec3<f32>;
    var tn: vec3<f32>;
    var uv2_: vec2<f32>;
    var w: f32;
    var a2_: vec3<f32>;
    var n2_: vec3<f32>;
    var local_1: f32;
    var soft: f32;
    var base: vec3<f32>;
    var dp2perp: vec3<f32>;
    var dp1perp: vec3<f32>;
    var T: vec3<f32>;
    var B: vec3<f32>;
    var invmax: f32;
    var local_2: vec3<f32>;
    var light: f32;

    let _e30 = n_1;
    N = normalize(_e30);
    let _e33 = wp_1;
    let _e34 = dpdx(_e33);
    dp1_ = _e34;
    let _e36 = wp_1;
    let _e37 = glDFdy_2(_e36);
    dp2_ = _e37;
    let _e39 = N;
    let _e40 = dp1_;
    let _e41 = dp2_;
    if (dot(_e39, normalize(cross(_e40, _e41))) < 0f) {
        let _e47 = N;
        N = -(_e47);
    }
    let _e49 = uv_1;
    let _e50 = dpdx(_e49);
    duv1_ = _e50;
    let _e52 = uv_1;
    let _e53 = glDFdy_1(_e52);
    duv2_ = _e53;
    let _e55 = layer_1;
    l = max(_e55, 0f);
    let _e59 = uv_1;
    let _e60 = l;
    let _e63 = vec3<f32>(_e59.x, _e59.y, _e60);
    let _e67 = textureSample(albedoTex, sRepeat, _e63.xy, i32(_e63.z));
    albedo = _e67.xyz;
    let _e70 = uv_1;
    let _e71 = l;
    let _e74 = vec3<f32>(_e70.x, _e70.y, _e71);
    let _e78 = textureSample(normalTex, sRepeat, _e74.xy, i32(_e74.z));
    tn = ((_e78.xyz * 2f) - vec3(1f));
    let _e86 = global.useTex;
    let _e89 = layer_1;
    if ((_e86 == 2i) && (_e89 >= 0f)) {
        {
            let _e93 = uv_1;
            let _e97 = uv_1;
            let _e102 = uv_1;
            let _e106 = uv_1;
            uv2_ = ((vec2<f32>(((_e93.x * 0.8660254f) - (_e97.y * 0.5f)), ((_e102.x * 0.5f) + (_e106.y * 0.8660254f))) * 1.37f) + vec2<f32>(0.37f, 0.61f));
            let _e121 = uv_1;
            let _e128 = uv_1;
            w = (0.5f + ((0.5f * sin(dot(_e121, vec2<f32>(0.9f, 0.55f)))) * sin((dot(_e128, vec2<f32>(-0.52f, 0.95f)) + 1.7f))));
            let _e140 = uv2_;
            let _e141 = l;
            let _e144 = vec3<f32>(_e140.x, _e140.y, _e141);
            let _e148 = textureSample(albedoTex, sRepeat, _e144.xy, i32(_e144.z));
            a2_ = _e148.xyz;
            let _e151 = uv2_;
            let _e152 = l;
            let _e155 = vec3<f32>(_e151.x, _e151.y, _e152);
            let _e159 = textureSample(normalTex, sRepeat, _e155.xy, i32(_e155.z));
            n2_ = ((_e159.xyz * 2f) - vec3(1f));
            let _e167 = n2_;
            let _e170 = n2_;
            let _e174 = n2_;
            let _e180 = n2_;
            let _e184 = n2_;
            let _e188 = vec2<f32>(((0.8660254f * _e170.x) + (0.5f * _e174.y)), ((-0.5f * _e180.x) + (0.8660254f * _e184.y)));
            n2_.x = _e188.x;
            n2_.y = _e188.y;
            let _e193 = layer_1;
            let _e194 = global.softFrom;
            if (_e193 >= _e194) {
                local_1 = 0.5f;
            } else {
                local_1 = 0.85f;
            }
            let _e199 = local_1;
            soft = _e199;
            let _e201 = uv_1;
            let _e202 = l;
            let _e205 = vec3<f32>(_e201.x, _e201.y, _e202);
            let _e210 = textureSampleLevel(albedoTex, sRepeat, _e205.xy, i32(_e205.z), 8f);
            let _e212 = albedo;
            let _e213 = a2_;
            let _e214 = w;
            let _e217 = soft;
            albedo = mix(_e210.xyz, mix(_e212, _e213, vec3(_e214)), vec3(_e217));
            let _e220 = tn;
            let _e222 = n2_;
            let _e224 = w;
            let _e227 = soft;
            let _e228 = (mix(_e220.xy, _e222.xy, vec2(_e224)) * _e227);
            let _e229 = tn;
            let _e231 = n2_;
            let _e233 = w;
            tn = normalize(vec3<f32>(_e228.x, _e228.y, mix(_e229.z, _e231.z, _e233)));
        }
    }
    let _e239 = global.material;
    base = _e239;
    let _e241 = global.useTex;
    let _e244 = layer_1;
    if ((_e241 >= 1i) && (_e244 >= 0f)) {
        {
            let _e248 = dp2_;
            let _e249 = N;
            dp2perp = cross(_e248, _e249);
            let _e252 = N;
            let _e253 = dp1_;
            dp1perp = cross(_e252, _e253);
            let _e256 = dp2perp;
            let _e257 = duv1_;
            let _e260 = dp1perp;
            let _e261 = duv2_;
            T = ((_e256 * _e257.x) + (_e260 * _e261.x));
            let _e266 = dp2perp;
            let _e267 = duv1_;
            let _e270 = dp1perp;
            let _e271 = duv2_;
            B = ((_e266 * _e267.y) + (_e270 * _e271.y));
            let _e276 = T;
            let _e277 = T;
            let _e279 = B;
            let _e280 = B;
            invmax = inverseSqrt(max(max(dot(_e276, _e277), dot(_e279, _e280)), 0.00000000000000000001f));
            let _e287 = global.recolored;
            if (_e287 == 1i) {
                let _e290 = global.material;
                let _e291 = albedo;
                let _e292 = global.tint;
                local_2 = clamp(mix(_e290, (_e291 * _e292), vec3(0.65f)), vec3(0f), vec3(1f));
            } else {
                let _e302 = albedo;
                let _e303 = global.tint;
                local_2 = (_e302 * _e303);
            }
            let _e306 = local_2;
            base = _e306;
            let _e307 = T;
            let _e308 = invmax;
            let _e309 = (_e307 * _e308);
            let _e310 = B;
            let _e312 = invmax;
            let _e313 = (-(_e310) * _e312);
            let _e314 = N;
            let _e328 = tn;
            N = normalize((mat3x3<f32>(vec3<f32>(_e309.x, _e309.y, _e309.z), vec3<f32>(_e313.x, _e313.y, _e313.z), vec3<f32>(_e314.x, _e314.y, _e314.z)) * normalize(_e328)));
        }
    }
    let _e332 = N;
    let _e333 = n_1;
    let _e335 = buildingLight(_e332, normalize(_e333));
    light = _e335;
    let _e337 = base;
    let _e338 = light;
    let _e340 = n_1;
    let _e341 = facadePosition_1;
    let _e342 = baseOcclusion(_e340, _e341);
    let _e344 = facadePosition_1;
    let _e345 = litWindow_1;
    let _e348 = buildingNight(((_e337 * _e338) * _e342), _e344, (_e345 > 0.5f));
    color_2 = vec4<f32>(_e348.x, _e348.y, _e348.z, 1f);
    return;
}

@fragment 
fn main(@location(0) n: vec3<f32>, @location(1) wp: vec3<f32>, @location(2) uv: vec2<f32>, @location(3) @interpolate(flat) layer: f32, @location(4) facadePosition: vec3<f32>, @location(5) @interpolate(flat) litWindow: f32) -> FragmentOutput {
    n_1 = n;
    wp_1 = wp;
    uv_1 = uv;
    layer_1 = layer;
    facadePosition_1 = facadePosition;
    litWindow_1 = litWindow;
    main_1();
    let _e53 = color_2;
    return FragmentOutput(_e53);
}
`,Fe=`struct BillboardParams {
    matrix: mat4x4<f32>,
    cameraOrigin: vec3<f32>,
    cameraRight: vec2<f32>,
    exaggeration: f32,
    raisedBlend: f32,
    eye: vec3<f32>,
    fogDistance: f32,
    uNight: i32,
}

struct VertexOutput {
    @location(0) texcoord: vec2<f32>,
    @location(1) world: vec3<f32>,
    @location(2) opacity: f32,
    @builtin(position) gl_Position: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: BillboardParams;
var<private> anchorWidth_1: vec4<f32>;
var<private> atlasRect_1: vec4<f32>;
var<private> shape_1: vec4<f32>;
var<private> texcoord: vec2<f32>;
var<private> world: vec3<f32>;
var<private> opacity: f32;
var<private> gl_VertexIndex_1: u32;
var<private> gl_Position: vec4<f32>;

fn main_1() {
    var i: i32;
    var local: f32;
    var local_1: f32;
    var q: vec2<f32>;
    var height: f32;
    var p: vec2<f32>;
    var local_2: f32;

    let _e23 = gl_VertexIndex_1;
    i = i32(_e23);
    let _e26 = i;
    let _e29 = i;
    let _e33 = i;
    if (((_e26 == 1i) || (_e29 == 2i)) || (_e33 == 4i)) {
        local = 1f;
    } else {
        local = 0f;
    }
    let _e40 = local;
    let _e41 = i;
    let _e44 = i;
    let _e48 = i;
    if (((_e41 == 2i) || (_e44 == 4i)) || (_e48 == 5i)) {
        local_1 = 1f;
    } else {
        local_1 = 0f;
    }
    let _e55 = local_1;
    q = vec2<f32>(_e40, _e55);
    let _e58 = shape_1;
    let _e62 = global.raisedBlend;
    height = (_e58.x * mix(0.35f, 1f, _e62));
    let _e66 = anchorWidth_1;
    let _e68 = global.cameraRight;
    let _e69 = q;
    let _e73 = anchorWidth_1;
    p = (_e66.xy + (_e68 * ((_e69.x - 0.5f) * _e73.w)));
    let _e79 = p;
    let _e81 = global.cameraOrigin;
    let _e84 = anchorWidth_1;
    let _e86 = global.exaggeration;
    let _e88 = global.cameraOrigin;
    let _e91 = q;
    let _e95 = height;
    let _e98 = p;
    let _e100 = global.cameraOrigin;
    world = vec3<f32>((_e79.x - _e81.x), (((_e84.z * _e86) - _e88.y) + ((_e91.y - 0.05f) * _e95)), (_e98.y - _e100.z));
    let _e104 = atlasRect_1;
    let _e106 = shape_1;
    if (_e106.y < 0f) {
        let _e111 = q;
        local_2 = (1f - _e111.x);
    } else {
        let _e114 = q;
        local_2 = _e114.x;
    }
    let _e117 = local_2;
    let _e119 = q;
    let _e123 = atlasRect_1;
    texcoord = (_e104.xy + (vec2<f32>(_e117, (1f - _e119.y)) * _e123.zw));
    let _e127 = shape_1;
    let _e129 = global.raisedBlend;
    opacity = (_e127.z * _e129);
    let _e132 = global.matrix;
    let _e133 = world;
    gl_Position = (_e132 * vec4<f32>(_e133.x, _e133.y, _e133.z, 1f));
    let _e141 = gl_Position;
    let _e143 = gl_Position;
    gl_Position.z = ((_e141.z + _e143.w) * 0.5f);
    return;
}

@vertex 
fn main(@location(0) anchorWidth: vec4<f32>, @location(1) atlasRect: vec4<f32>, @location(2) shape: vec4<f32>, @builtin(vertex_index) gl_VertexIndex: u32) -> VertexOutput {
    anchorWidth_1 = anchorWidth;
    atlasRect_1 = atlasRect;
    shape_1 = shape;
    gl_VertexIndex_1 = gl_VertexIndex;
    main_1();
    let _e37 = texcoord;
    let _e39 = world;
    let _e41 = opacity;
    let _e43 = gl_Position;
    return VertexOutput(_e37, _e39, _e41, _e43);
}
`,Te=`diagnostic(off, derivative_uniformity);
struct BillboardParams {
    matrix: mat4x4<f32>,
    cameraOrigin: vec3<f32>,
    cameraRight: vec2<f32>,
    exaggeration: f32,
    raisedBlend: f32,
    eye: vec3<f32>,
    fogDistance: f32,
    uNight: i32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: BillboardParams;
@group(0) @binding(2) 
var sLinear: sampler;
var<private> texcoord_1: vec2<f32>;
var<private> world_1: vec3<f32>;
var<private> opacity_1: f32;
@group(0) @binding(23) 
var billboardAtlas: texture_2d<f32>;
var<private> color: vec4<f32>;

fn main_1() {
    var brush: vec4<f32>;
    var alpha: f32;
    var base: vec3<f32>;
    var fog: f32;
    var local: vec3<f32>;

    let _e22 = texcoord_1;
    let _e23 = textureSample(billboardAtlas, sLinear, _e22);
    brush = _e23;
    let _e25 = brush;
    let _e27 = opacity_1;
    alpha = (_e25.w * _e27);
    let _e30 = alpha;
    if (_e30 < 0.015f) {
        discard;
    }
    let _e33 = brush;
    let _e35 = brush;
    base = (_e33.xyz / vec3(max(_e35.w, 0.001f)));
    let _e42 = global.uNight;
    if (_e42 == 1i) {
        let _e45 = base;
        base = (_e45 * vec3<f32>(0.149f, 0.196f, 0.31f));
    }
    let _e52 = world_1;
    let _e53 = global.eye;
    let _e56 = global.fogDistance;
    fog = (1f - exp((-(pow((length((_e52 - _e53)) / _e56), 2f)) * 0.11f)));
    let _e66 = base;
    let _e67 = global.uNight;
    if (_e67 == 1i) {
        local = vec3<f32>(0.018f, 0.028f, 0.065f);
    } else {
        local = vec3<f32>(0.77f, 0.85f, 0.88f);
    }
    let _e79 = local;
    let _e81 = fog;
    base = mix(_e66, _e79, vec3(min(0.62f, _e81)));
    let _e85 = base;
    let _e86 = alpha;
    color = vec4<f32>(_e85.x, _e85.y, _e85.z, _e86);
    return;
}

@fragment 
fn main(@location(0) texcoord: vec2<f32>, @location(1) world: vec3<f32>, @location(2) opacity: f32) -> FragmentOutput {
    texcoord_1 = texcoord;
    world_1 = world;
    opacity_1 = opacity;
    main_1();
    let _e35 = color;
    return FragmentOutput(_e35);
}
`,Me=`struct TreeParams {
    matrix: mat4x4<f32>,
    cameraOrigin: vec3<f32>,
    exaggeration: f32,
    treeFade: vec4<f32>,
    eye: vec3<f32>,
    treeLight: vec3<f32>,
    fogDistance: f32,
    uNight: i32,
}

struct VertexOutput {
    @location(0) world: vec3<f32>,
    @location(1) treeNormal: vec3<f32>,
    @location(2) tint: vec3<f32>,
    @location(3) treeLevel: f32,
    @location(4) crownChart: vec4<f32>,
    @location(5) crownInfo: vec4<f32>,
    @builtin(position) gl_Position: vec4<f32>,
}

const BROAD_U: array<f32, 5> = array<f32, 5>(0f, 0.22f, 0.5f, 0.8f, 1f);
const BROAD_R: array<f32, 5> = array<f32, 5>(0.5f, 0.93f, 1f, 0.74f, 0f);
const NEEDLE_U: array<f32, 5> = array<f32, 5>(0f, 0.34f, 0.37f, 0.68f, 1f);
const NEEDLE_R: array<f32, 5> = array<f32, 5>(1f, 0.62f, 0.82f, 0.42f, 0f);

@group(0) @binding(0) 
var<storage> global: TreeParams;
var<private> treeBase_1: vec4<f32>;
var<private> treeShape_1: vec4<f32>;
var<private> treeColor_1: vec4<f32>;
var<private> world: vec3<f32>;
var<private> treeNormal: vec3<f32>;
var<private> tint: vec3<f32>;
var<private> treeLevel: f32;
var<private> crownChart: vec4<f32>;
var<private> crownInfo: vec4<f32>;
var<private> gl_VertexIndex_1: u32;
var<private> gl_Position: vec4<f32>;

fn main_1() {
    var v: i32;
    var quad: i32;
    var corner: i32;
    var band: i32;
    var seg: i32;
    var local: i32;
    var dseg: i32;
    var local_1: i32;
    var dring: i32;
    var ring: i32;
    var fade: f32;
    var needle: bool;
    var r: f32;
    var h: f32;
    var local_2: f32;
    var bottom: f32;
    var angle: f32;
    var dir: vec2<f32>;
    var trunk: f32;
    var radius: f32;
    var y: f32;
    var load: f32;
    var cap: f32 = 0f;
    var arc: f32 = 0f;
    var local_3: f32;
    var k: i32;
    var local_4: array<f32, 5> = NEEDLE_U;
    var local_5: array<f32, 5> = BROAD_U;
    var local_6: f32;
    var u: f32;
    var j: i32;
    var local_7: array<f32, 5> = NEEDLE_U;
    var local_8: array<f32, 5> = NEEDLE_U;
    var local_9: array<f32, 5> = BROAD_U;
    var local_10: array<f32, 5> = BROAD_U;
    var local_11: f32;
    var du: f32;
    var local_12: array<f32, 5> = NEEDLE_R;
    var local_13: array<f32, 5> = NEEDLE_R;
    var local_14: array<f32, 5> = BROAD_R;
    var local_15: array<f32, 5> = BROAD_R;
    var local_16: f32;
    var dr: f32;
    var local_17: f32;
    var local_18: f32;
    var local_19: array<f32, 5> = NEEDLE_R;
    var local_20: array<f32, 5> = BROAD_R;
    var local_21: f32;
    var local_22: f32;
    var local_23: f32;
    var local_24: vec3<f32>;
    var mid: f32;
    var hd: f32;
    var local_25: vec3<f32>;
    var local_26: f32;
    var local_27: f32;
    var local_28: f32;
    var local_29: f32;

    let _e30 = gl_VertexIndex_1;
    v = i32(_e30);
    let _e33 = v;
    quad = (_e33 / 6i);
    let _e37 = v;
    let _e38 = quad;
    corner = (_e37 - (_e38 * 6i));
    let _e43 = quad;
    band = (_e43 / 12i);
    let _e47 = quad;
    let _e48 = band;
    seg = (_e47 - (_e48 * 12i));
    let _e53 = corner;
    let _e56 = corner;
    let _e60 = corner;
    if (((_e53 == 1i) || (_e56 == 2i)) || (_e60 == 4i)) {
        local = 1i;
    } else {
        local = 0i;
    }
    let _e67 = local;
    dseg = _e67;
    let _e69 = corner;
    let _e72 = corner;
    let _e76 = corner;
    if (((_e69 == 2i) || (_e72 == 4i)) || (_e76 == 5i)) {
        local_1 = 1i;
    } else {
        local_1 = 0i;
    }
    let _e83 = local_1;
    dring = _e83;
    let _e85 = band;
    let _e86 = dring;
    ring = (_e85 + _e86);
    let _e90 = global.treeFade;
    let _e92 = global.treeFade;
    let _e94 = treeBase_1;
    let _e96 = global.treeFade;
    fade = (1f - smoothstep(_e90.z, _e92.w, distance(_e94.xy, _e96.xy)));
    let _e102 = fade;
    if (_e102 <= 0f) {
        {
            gl_Position = vec4<f32>(2f, 2f, 2f, 1f);
            world = vec3(0f);
            treeNormal = vec3<f32>(0f, 1f, 0f);
            tint = vec3(0f);
            treeLevel = 0f;
            crownChart = vec4(0f);
            crownInfo = vec4<f32>(0f, 1f, 0f, 0f);
            return;
        }
    }
    let _e127 = treeShape_1;
    needle = (_e127.z > 0.5f);
    let _e132 = treeBase_1;
    r = _e132.w;
    let _e135 = treeShape_1;
    h = _e135.x;
    let _e138 = needle;
    if _e138 {
        let _e139 = h;
        let _e140 = treeShape_1;
        let _e144 = h;
        let _e148 = h;
        local_2 = min(max((_e139 - _e140.y), (0.05f * _e144)), (0.1f * _e148));
    } else {
        let _e151 = h;
        let _e152 = treeShape_1;
        let _e156 = h;
        let _e159 = h;
        local_2 = clamp((_e151 - _e152.y), (0.3f * _e156), (0.4f * _e159));
    }
    let _e163 = local_2;
    bottom = _e163;
    let _e165 = seg;
    let _e166 = dseg;
    let _e171 = treeShape_1;
    angle = ((f32((_e165 + _e166)) * 0.5235988f) + _e171.w);
    let _e175 = angle;
    let _e177 = angle;
    dir = vec2<f32>(cos(_e175), sin(_e177));
    let _e182 = r;
    trunk = max((0.07f * _e182), 0.12f);
    let _e189 = treeColor_1;
    load = (fract(_e189.w) / 0.45f);
    let _e199 = ring;
    if (_e199 < 2i) {
        {
            let _e202 = trunk;
            radius = _e202;
            let _e203 = ring;
            if (_e203 == 0i) {
                local_3 = -0.4f;
            } else {
                let _e208 = bottom;
                local_3 = _e208;
            }
            let _e210 = local_3;
            y = _e210;
        }
    } else {
        {
            let _e211 = ring;
            k = (_e211 - 2i);
            let _e215 = needle;
            if _e215 {
                let _e216 = k;
                let _e220 = local_4[_e216];
                local_6 = _e220;
            } else {
                let _e221 = k;
                let _e225 = local_5[_e221];
                local_6 = _e225;
            }
            let _e227 = local_6;
            u = _e227;
            let _e229 = k;
            j = _e229;
            loop {
                let _e231 = j;
                if !((_e231 < 4i)) {
                    break;
                }
                {
                    let _e238 = needle;
                    if _e238 {
                        let _e239 = j;
                        let _e245 = local_7[(_e239 + 1i)];
                        let _e246 = j;
                        let _e250 = local_8[_e246];
                        local_11 = (_e245 - _e250);
                    } else {
                        let _e252 = j;
                        let _e258 = local_9[(_e252 + 1i)];
                        let _e259 = j;
                        let _e263 = local_10[_e259];
                        local_11 = (_e258 - _e263);
                    }
                    let _e266 = local_11;
                    let _e267 = h;
                    let _e268 = bottom;
                    du = (_e266 * (_e267 - _e268));
                    let _e272 = needle;
                    if _e272 {
                        let _e273 = j;
                        let _e279 = local_12[(_e273 + 1i)];
                        let _e280 = j;
                        let _e284 = local_13[_e280];
                        local_16 = (_e279 - _e284);
                    } else {
                        let _e286 = j;
                        let _e292 = local_14[(_e286 + 1i)];
                        let _e293 = j;
                        let _e297 = local_15[_e293];
                        local_16 = (_e292 - _e297);
                    }
                    let _e300 = local_16;
                    let _e301 = r;
                    dr = (_e300 * _e301);
                    let _e304 = arc;
                    let _e305 = du;
                    let _e306 = du;
                    let _e308 = dr;
                    let _e309 = dr;
                    arc = (_e304 + sqrt(((_e305 * _e306) + (_e308 * _e309))));
                }
                continuing {
                    let _e235 = j;
                    j = (_e235 + 1i);
                }
            }
            let _e314 = needle;
            if _e314 {
                let _e315 = seg;
                let _e316 = dseg;
                if (((_e315 + _e316) % 2i) == 0i) {
                    local_17 = 1.3f;
                } else {
                    local_17 = 0.45f;
                }
                let _e325 = local_17;
                let _e328 = u;
                local_18 = (_e325 * mix(0.8f, 1.2f, _e328));
            } else {
                let _e333 = u;
                local_18 = mix(0.45f, 1.4f, _e333);
            }
            let _e336 = local_18;
            cap = _e336;
            let _e337 = r;
            let _e338 = needle;
            if _e338 {
                let _e339 = k;
                let _e343 = local_19[_e339];
                local_21 = _e343;
            } else {
                let _e344 = k;
                let _e348 = local_20[_e344];
                local_21 = _e348;
            }
            let _e350 = local_21;
            radius = (_e337 * _e350);
            let _e352 = bottom;
            let _e353 = u;
            let _e354 = h;
            let _e355 = bottom;
            y = (_e352 + (_e353 * (_e354 - _e355)));
            let _e359 = needle;
            if _e359 {
                let _e360 = radius;
                let _e361 = seg;
                let _e362 = dseg;
                if (((_e361 + _e362) % 2i) == 0i) {
                    local_22 = 1f;
                } else {
                    local_22 = 0.68f;
                }
                let _e371 = local_22;
                let _e375 = angle;
                let _e377 = treeShape_1;
                radius = (_e360 * (_e371 * (1f + (0.045f * sin(((3f * _e375) + _e377.w))))));
            }
            let _e385 = needle;
            if !(_e385) {
                let _e387 = radius;
                let _e391 = angle;
                let _e394 = treeShape_1;
                let _e401 = u;
                let _e410 = treeColor_1;
                if (_e410.w > 0.5f) {
                    local_23 = 0.8f;
                } else {
                    local_23 = 1f;
                }
                let _e417 = local_23;
                radius = (_e387 * ((1f + ((0.13f * sin(((3f * _e391) + (2f * _e394.w)))) * (1f - (abs((_e401 - 0.5f)) * 1.4f)))) * _e417));
            }
        }
    }
    let _e420 = dir;
    let _e422 = radius;
    let _e424 = y;
    let _e425 = fade;
    let _e427 = dir;
    let _e429 = radius;
    local_24 = vec3<f32>((_e420.x * _e422), (_e424 * _e425), (_e427.y * _e429));
    let _e433 = ring;
    if (_e433 < 2i) {
        let _e436 = dir;
        let _e439 = dir;
        treeNormal = vec3<f32>(_e436.x, 0f, _e439.y);
    } else {
        let _e442 = needle;
        if _e442 {
            let _e443 = dir;
            let _e444 = h;
            let _e445 = bottom;
            let _e447 = (_e443 * (_e444 - _e445));
            let _e448 = r;
            treeNormal = normalize(vec3<f32>(_e447.x, _e447.y, _e448).xzy);
        } else {
            {
                let _e455 = bottom;
                let _e456 = h;
                mid = (0.5f * (_e455 + _e456));
                let _e461 = h;
                let _e462 = bottom;
                hd = max((0.5f * (_e461 - _e462)), 0.1f);
                let _e468 = local_24;
                let _e470 = r;
                let _e471 = r;
                let _e474 = y;
                let _e475 = mid;
                let _e477 = hd;
                let _e478 = hd;
                let _e481 = local_24;
                let _e483 = r;
                let _e484 = r;
                treeNormal = normalize(vec3<f32>((_e468.x / (_e470 * _e471)), ((_e474 - _e475) / (_e477 * _e478)), (_e481.z / (_e483 * _e484))));
            }
        }
    }
    let _e489 = treeBase_1;
    let _e491 = global.cameraOrigin;
    let _e494 = local_24;
    let _e497 = treeBase_1;
    let _e499 = global.exaggeration;
    let _e501 = global.cameraOrigin;
    let _e504 = local_24;
    let _e507 = treeBase_1;
    let _e509 = global.cameraOrigin;
    let _e512 = local_24;
    world = vec3<f32>(((_e489.x - _e491.x) + _e494.x), (((_e497.z * _e499) - _e501.y) + _e504.y), ((_e507.y - _e509.z) + _e512.z));
    let _e516 = ring;
    if (_e516 < 2i) {
        local_25 = vec3<f32>(0.24f, 0.19f, 0.14f);
    } else {
        let _e523 = treeColor_1;
        local_25 = _e523.xyz;
    }
    let _e526 = local_25;
    tint = _e526;
    let _e527 = ring;
    if (_e527 < 2i) {
        local_26 = 0f;
    } else {
        let _e531 = y;
        let _e532 = bottom;
        let _e534 = h;
        let _e535 = bottom;
        local_26 = clamp(((_e531 - _e532) / max((_e534 - _e535), 0.1f)), 0f, 1f);
    }
    let _e544 = local_26;
    treeLevel = _e544;
    let _e545 = dir;
    let _e546 = arc;
    let _e547 = (_e545 * _e546);
    let _e548 = treeShape_1;
    let _e553 = r;
    crownChart = vec4<f32>(_e547.x, _e547.y, fract((_e548.w * 0.15915494f)), _e553);
    let _e557 = needle;
    if _e557 {
        local_27 = 1f;
    } else {
        local_27 = 0f;
    }
    let _e561 = local_27;
    let _e562 = ring;
    let _e565 = treeColor_1;
    if ((_e562 < 2i) || (_e565.w > 0.5f)) {
        local_28 = 1f;
    } else {
        local_28 = 0f;
    }
    let _e573 = local_28;
    let _e574 = ring;
    if (_e574 < 2i) {
        local_29 = 0f;
    } else {
        let _e578 = load;
        let _e579 = cap;
        local_29 = min((_e578 * _e579), 0.95f);
    }
    let _e584 = local_29;
    let _e585 = arc;
    let _e586 = r;
    crownInfo = vec4<f32>(_e561, _e573, _e584, min((_e585 / max(_e586, 0.1f)), 1f));
    let _e593 = global.matrix;
    let _e594 = world;
    gl_Position = (_e593 * vec4<f32>(_e594.x, _e594.y, _e594.z, 1f));
    let _e602 = gl_Position;
    let _e604 = gl_Position;
    gl_Position.z = ((_e602.z + _e604.w) * 0.5f);
    return;
}

@vertex 
fn main(@location(0) treeBase: vec4<f32>, @location(1) treeShape: vec4<f32>, @location(2) treeColor: vec4<f32>, @builtin(vertex_index) gl_VertexIndex: u32) -> VertexOutput {
    treeBase_1 = treeBase;
    treeShape_1 = treeShape;
    treeColor_1 = treeColor;
    gl_VertexIndex_1 = gl_VertexIndex;
    main_1();
    let _e51 = world;
    let _e53 = treeNormal;
    let _e55 = tint;
    let _e57 = treeLevel;
    let _e59 = crownChart;
    let _e61 = crownInfo;
    let _e63 = gl_Position;
    return VertexOutput(_e51, _e53, _e55, _e57, _e59, _e61, _e63);
}
`,Le=`diagnostic(off, derivative_uniformity);
struct TreeParams {
    matrix: mat4x4<f32>,
    cameraOrigin: vec3<f32>,
    exaggeration: f32,
    treeFade: vec4<f32>,
    eye: vec3<f32>,
    treeLight: vec3<f32>,
    fogDistance: f32,
    uNight: i32,
}

struct FragmentOutput {
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) 
var<storage> global: TreeParams;
var<private> world_3: vec3<f32>;
var<private> treeNormal_1: vec3<f32>;
var<private> tint_3: vec3<f32>;
var<private> treeLevel_1: f32;
var<private> crownChart_1: vec4<f32>;
var<private> crownInfo_1: vec4<f32>;
var<private> color: vec4<f32>;

fn glDFdy(v: f32) -> f32 {
    var v_1: f32;

    v_1 = v;
    let _e18 = v_1;
    let _e19 = dpdy(_e18);
    return -(_e19);
}

fn glDFdy_1(v_2: vec2<f32>) -> vec2<f32> {
    var v_3: vec2<f32>;

    v_3 = v_2;
    let _e18 = v_3;
    let _e19 = dpdy(_e18);
    return -(_e19);
}

fn glDFdy_2(v_4: vec3<f32>) -> vec3<f32> {
    var v_5: vec3<f32>;

    v_5 = v_4;
    let _e18 = v_5;
    let _e19 = dpdy(_e18);
    return -(_e19);
}

fn glDFdy_3(v_6: vec4<f32>) -> vec4<f32> {
    var v_7: vec4<f32>;

    v_7 = v_6;
    let _e18 = v_7;
    let _e19 = dpdy(_e18);
    return -(_e19);
}

fn groundSmooth(a: f32, b: f32, x: f32) -> f32 {
    var a_1: f32;
    var b_1: f32;
    var x_1: f32;
    var t: f32;

    a_1 = a;
    b_1 = b;
    x_1 = x;
    let _e29 = x_1;
    let _e30 = a_1;
    let _e32 = b_1;
    let _e33 = a_1;
    t = clamp(((_e29 - _e30) / (_e32 - _e33)), 0f, 1f);
    let _e40 = t;
    let _e41 = t;
    let _e45 = t;
    return ((_e40 * _e41) * (3f - (2f * _e45)));
}

fn forestGradient(c: vec2<i32>) -> vec2<f32> {
    var c_1: vec2<i32>;
    var p: vec2<u32>;
    var h: u32;

    c_1 = c;
    let _e25 = c_1;
    p = vec2<u32>(_e25);
    let _e28 = p;
    let _e32 = p;
    h = (((_e28.x * 2654435769u) ^ (_e32.y * 2246822507u)) ^ 1779033703u);
    let _e40 = h;
    let _e41 = h;
    h = ((_e40 ^ (_e41 >> 16u)) * 2146121005u);
    let _e47 = h;
    let _e48 = h;
    h = (_e47 ^ (_e48 >> 15u));
    let _e52 = h;
    let _e56 = h;
    return ((vec2<f32>(f32((_e52 & 255u)), f32(((_e56 >> 8u) & 255u))) * 0.0078125f) + vec2(-0.99609375f));
}

fn forestPerlin(f: vec2<f32>, g00_: vec2<f32>, g10_: vec2<f32>, g01_: vec2<f32>, g11_: vec2<f32>) -> vec3<f32> {
    var f_1: vec2<f32>;
    var g00_1: vec2<f32>;
    var g10_1: vec2<f32>;
    var g01_1: vec2<f32>;
    var g11_1: vec2<f32>;
    var n00_: f32;
    var n10_: f32;
    var n01_: f32;
    var n11_: f32;
    var k: f32;
    var u: vec2<f32>;
    var du: vec2<f32>;
    var g: vec2<f32>;

    f_1 = f;
    g00_1 = g00_;
    g10_1 = g10_;
    g01_1 = g01_;
    g11_1 = g11_;
    let _e33 = g00_1;
    let _e34 = f_1;
    n00_ = dot(_e33, _e34);
    let _e37 = g10_1;
    let _e38 = f_1;
    n10_ = dot(_e37, (_e38 - vec2<f32>(1f, 0f)));
    let _e45 = g01_1;
    let _e46 = f_1;
    n01_ = dot(_e45, (_e46 - vec2<f32>(0f, 1f)));
    let _e53 = g11_1;
    let _e54 = f_1;
    n11_ = dot(_e53, (_e54 - vec2(1f)));
    let _e60 = n00_;
    let _e61 = n10_;
    let _e63 = n01_;
    let _e65 = n11_;
    k = (((_e60 - _e61) - _e63) + _e65);
    let _e68 = f_1;
    let _e69 = f_1;
    let _e71 = f_1;
    let _e73 = f_1;
    let _e74 = f_1;
    u = (((_e68 * _e69) * _e71) * ((_e73 * ((_e74 * 6f) - vec2(15f))) + vec2(10f)));
    let _e87 = f_1;
    let _e89 = f_1;
    let _e91 = f_1;
    let _e92 = f_1;
    du = (((30f * _e87) * _e89) * ((_e91 * (_e92 - vec2(2f))) + vec2(1f)));
    let _e102 = g00_1;
    let _e103 = u;
    let _e105 = g10_1;
    let _e106 = g00_1;
    let _e110 = u;
    let _e112 = g01_1;
    let _e113 = g00_1;
    let _e117 = u;
    let _e119 = u;
    let _e122 = g00_1;
    let _e123 = g10_1;
    let _e125 = g01_1;
    let _e127 = g11_1;
    let _e131 = du;
    let _e132 = n10_;
    let _e133 = n00_;
    let _e135 = u;
    let _e137 = k;
    let _e140 = n01_;
    let _e141 = n00_;
    let _e143 = u;
    let _e145 = k;
    g = ((((_e102 + (_e103.x * (_e105 - _e106))) + (_e110.y * (_e112 - _e113))) + ((_e117.x * _e119.y) * (((_e122 - _e123) - _e125) + _e127))) + (_e131 * vec2<f32>(((_e132 - _e133) + (_e135.y * _e137)), ((_e140 - _e141) + (_e143.x * _e145)))));
    let _e152 = n00_;
    let _e153 = u;
    let _e155 = n10_;
    let _e156 = n00_;
    let _e160 = u;
    let _e162 = n01_;
    let _e163 = n00_;
    let _e167 = u;
    let _e169 = u;
    let _e172 = k;
    let _e175 = g;
    return vec3<f32>((((_e152 + (_e153.x * (_e155 - _e156))) + (_e160.y * (_e162 - _e163))) + ((_e167.x * _e169.y) * _e172)), _e175.x, _e175.y);
}

fn forestClump(world_1: vec2<f32>, radius: f32, fp: f32, tint_1: f32) -> vec3<f32> {
    var world_2: vec2<f32>;
    var radius_1: f32;
    var fp_1: f32;
    var tint_2: f32;
    var e: f32;
    var e0_: f32;
    var w: f32;
    var n: f32 = 0f;
    var norm: f32 = 0f;
    var grad: vec2<f32> = vec2(0f);
    var offset: vec2<f32>;
    var i: i32 = 0i;
    var scale: f32;
    var local: f32;
    var a_2: f32;
    var g_1: vec2<f32>;
    var c_2: vec2<i32>;
    var o: vec3<f32>;
    var amp: f32;

    world_2 = world_1;
    radius_1 = radius;
    fp_1 = fp;
    tint_2 = tint_1;
    let _e32 = radius_1;
    e = log2((0.7f * max(_e32, 0.5f)));
    let _e38 = e;
    e0_ = floor(_e38);
    let _e41 = e;
    let _e42 = e0_;
    w = (_e41 - _e42);
    let _e52 = tint_2;
    let _e56 = tint_2;
    offset = (vec2<f32>(fract((_e52 * 5.83f)), fract((_e56 * 11.37f))) * 97f);
    loop {
        let _e66 = i;
        if !((_e66 < 2i)) {
            break;
        }
        {
            let _e73 = e0_;
            let _e74 = i;
            scale = exp2((_e73 + f32(_e74)));
            let _e79 = i;
            if (_e79 == 0i) {
                let _e83 = w;
                local = (1f - _e83);
            } else {
                let _e85 = w;
                local = _e85;
            }
            let _e87 = local;
            let _e89 = scale;
            let _e92 = scale;
            let _e95 = fp_1;
            let _e96 = groundSmooth((_e89 * 0.16f), (_e92 * 0.4f), _e95);
            a_2 = (_e87 * (1f - _e96));
            let _e100 = world_2;
            let _e101 = scale;
            let _e104 = offset;
            g_1 = ((_e100 / vec2(_e101)) + _e104);
            let _e107 = g_1;
            c_2 = vec2<i32>(floor(_e107));
            let _e111 = g_1;
            let _e112 = c_2;
            let _e115 = c_2;
            let _e116 = forestGradient(_e115);
            let _e117 = c_2;
            let _e122 = forestGradient((_e117 + vec2<i32>(1i, 0i)));
            let _e123 = c_2;
            let _e128 = forestGradient((_e123 + vec2<i32>(0i, 1i)));
            let _e129 = c_2;
            let _e134 = forestGradient((_e129 + vec2<i32>(1i, 1i)));
            let _e135 = forestPerlin((_e111 - vec2<f32>(_e112)), _e116, _e122, _e128, _e134);
            o = _e135;
            let _e137 = n;
            let _e138 = a_2;
            let _e139 = o;
            n = (_e137 + (_e138 * _e139.x));
            let _e143 = grad;
            let _e144 = a_2;
            let _e145 = o;
            let _e148 = scale;
            grad = (_e143 + ((_e144 * _e145.yz) / vec2(_e148)));
            let _e152 = norm;
            let _e153 = a_2;
            let _e154 = a_2;
            norm = (_e152 + (_e153 * _e154));
        }
        continuing {
            let _e70 = i;
            i = (_e70 + 1i);
        }
    }
    let _e157 = norm;
    norm = sqrt(_e157);
    let _e161 = norm;
    let _e162 = groundSmooth(0f, 0.6f, _e161);
    let _e165 = radius_1;
    let _e166 = fp_1;
    let _e168 = groundSmooth(2.5f, 5f, (_e165 / _e166));
    amp = (_e162 * _e168);
    let _e171 = n;
    let _e172 = norm;
    n = (_e171 / max(_e172, 0.001f));
    let _e176 = grad;
    let _e177 = norm;
    grad = (_e176 / vec2(max(_e177, 0.001f)));
    let _e182 = amp;
    let _e185 = n;
    let _e187 = groundSmooth(0f, 0.26f, abs(_e185));
    let _e191 = e;
    let _e194 = n;
    let _e196 = n;
    let _e197 = n;
    let _e203 = grad;
    let _e204 = ((((0.7f * exp2(_e191)) * _e194) * inverseSqrt(((_e196 * _e197) + 0.0009f))) * _e203);
    return (_e182 * vec3<f32>((_e187 - 0.48f), _e204.x, _e204.y));
}

fn main_1() {
    var n_1: vec3<f32>;
    var l: vec3<f32>;
    var fp_2: f32;
    var albedo: vec3<f32>;
    var snow: f32;
    var r: f32;
    var foliage: f32;
    var clump: vec3<f32>;
    var local_1: f32;
    var detail: f32;
    var len: f32;
    var local_2: vec2<f32>;
    var d: vec2<f32>;
    var across: vec3<f32>;
    var down: vec3<f32>;
    var g_2: vec2<f32>;
    var lit: f32;
    var occ: f32;
    var base: vec3<f32>;
    var fog: f32;
    var local_3: vec3<f32>;

    let _e23 = treeNormal_1;
    n_1 = normalize(_e23);
    let _e26 = global.treeLight;
    l = normalize(_e26);
    let _e30 = world_3;
    let _e31 = dpdx(_e30);
    let _e33 = world_3;
    let _e34 = glDFdy_2(_e33);
    fp_2 = max(0.001f, max(length(_e31), length(_e34)));
    let _e39 = tint_3;
    albedo = _e39;
    let _e41 = crownInfo_1;
    snow = _e41.z;
    let _e44 = crownChart_1;
    r = _e44.w;
    let _e48 = crownInfo_1;
    foliage = (1f - _e48.y);
    let _e52 = foliage;
    let _e55 = r;
    let _e57 = fp_2;
    if ((_e52 > 0f) && (_e55 > (2.5f * _e57))) {
        {
            let _e61 = crownChart_1;
            let _e63 = r;
            let _e64 = fp_2;
            let _e65 = crownChart_1;
            let _e67 = forestClump(_e61.xy, _e63, _e64, _e65.z);
            clump = _e67;
            let _e69 = foliage;
            let _e70 = crownInfo_1;
            if (_e70.x > 0.5f) {
                local_1 = 0.3f;
            } else {
                local_1 = 1f;
            }
            let _e77 = local_1;
            let _e81 = crownInfo_1;
            detail = ((_e69 * _e77) * mix(0.55f, 1f, _e81.w));
            let _e86 = albedo;
            let _e89 = detail;
            let _e91 = clump;
            albedo = (_e86 * (1f + ((0.3f * _e89) * _e91.x)));
            let _e96 = snow;
            let _e99 = detail;
            let _e101 = clump;
            snow = min((_e96 * (1f + ((1.5f * _e99) * _e101.x))), 0.95f);
            let _e108 = crownInfo_1;
            if (_e108.x < 0.5f) {
                {
                    let _e112 = crownChart_1;
                    len = length(_e112.xy);
                    let _e116 = len;
                    if (_e116 > 0.0001f) {
                        let _e119 = crownChart_1;
                        let _e121 = len;
                        local_2 = (_e119.xy / vec2(_e121));
                    } else {
                        local_2 = vec2<f32>(1f, 0f);
                    }
                    let _e128 = local_2;
                    d = _e128;
                    let _e130 = d;
                    let _e134 = d;
                    across = vec3<f32>(-(_e130.y), 0f, _e134.x);
                    let _e138 = n_1;
                    let _e139 = across;
                    down = cross(_e138, _e139);
                    let _e142 = clump;
                    g_2 = _e142.yz;
                    let _e145 = n_1;
                    let _e146 = detail;
                    let _e147 = g_2;
                    let _e148 = d;
                    let _e150 = down;
                    let _e152 = g_2;
                    let _e153 = d;
                    let _e156 = d;
                    let _e160 = across;
                    n_1 = normalize((_e145 - (_e146 * ((dot(_e147, _e148) * _e150) + (dot(_e152, vec2<f32>(-(_e153.y), _e156.x)) * _e160)))));
                }
            }
        }
    }
    let _e166 = albedo;
    let _e171 = snow;
    albedo = mix(_e166, vec3<f32>(0.84f, 0.88f, 0.9f), vec3(_e171));
    let _e176 = n_1;
    let _e177 = l;
    let _e185 = l;
    lit = ((0.5f + (0.62f * max(dot(_e176, _e177), 0f))) / (0.5f + (0.62f * max(_e185.y, 0f))));
    let _e195 = treeLevel_1;
    occ = mix(0.58f, 1f, _e195);
    let _e198 = albedo;
    let _e199 = lit;
    let _e201 = occ;
    base = ((_e198 * _e199) * _e201);
    let _e204 = global.uNight;
    if (_e204 == 1i) {
        let _e207 = base;
        base = (_e207 * vec3<f32>(0.149f, 0.196f, 0.31f));
    }
    let _e214 = world_3;
    let _e215 = global.eye;
    let _e218 = global.fogDistance;
    fog = (1f - exp((-(pow((length((_e214 - _e215)) / _e218), 2f)) * 0.11f)));
    let _e228 = base;
    let _e229 = global.uNight;
    if (_e229 == 1i) {
        local_3 = vec3<f32>(0.018f, 0.028f, 0.065f);
    } else {
        local_3 = vec3<f32>(0.77f, 0.85f, 0.88f);
    }
    let _e241 = local_3;
    let _e243 = fog;
    base = mix(_e228, _e241, vec3(min(0.62f, _e243)));
    let _e247 = base;
    color = vec4<f32>(_e247.x, _e247.y, _e247.z, 1f);
    return;
}

@fragment 
fn main(@location(0) world: vec3<f32>, @location(1) treeNormal: vec3<f32>, @location(2) tint: vec3<f32>, @location(3) treeLevel: f32, @location(4) crownChart: vec4<f32>, @location(5) crownInfo: vec4<f32>) -> FragmentOutput {
    world_3 = world;
    treeNormal_1 = treeNormal;
    tint_3 = tint;
    treeLevel_1 = treeLevel;
    crownChart_1 = crownChart;
    crownInfo_1 = crownInfo;
    main_1();
    let _e43 = color;
    return FragmentOutput(_e43);
}
`,Pe=Object.freeze(Object.defineProperty({__proto__:null,WGSL3D_OVERRIDES:Y,WGSL3D_PARAMS:W,WGSL3D_TEXTURES:$,billboardFs:Te,billboardVs:Fe,buildingColorFs:ze,buildingColorVs:Ce,buildingTexFs:Re,buildingTexVs:Ge,groundFs:be,mapFs:ye,skyFs:Se,skyVs:ke,terrainVs:we,treeFs:Le,treeVs:Me},Symbol.toStringTag,{value:"Module"})),Be={float:1,int:1,uint:1,bool:1,vec2:2,ivec2:2,uvec2:2,vec3:3,ivec3:3,uvec3:3,vec4:4,ivec4:4,uvec4:4,mat4:16},Ve={float:4,int:4,uint:4,bool:4,vec2:8,ivec2:8,uvec2:8,vec3:16,ivec3:16,uvec3:16,vec4:16,ivec4:16,uvec4:16,mat4:64};class D{constructor(e){this.layout=e;const _=new ArrayBuffer(e.size);this.bytes=new Uint8Array(_),this.f32=new Float32Array(_),this.i32=new Int32Array(_),this.u32=new Uint32Array(_)}bytes;f32;i32;u32;set(e,..._){this.write(e,_)}setArray(e,_){this.write(e,_)}write(e,_){const n=this.layout.fields[e];if(!n)return;const l=Be[n.type],t=Ve[n.type]/4,r=Math.max(1,n.count),a=/^(u|uvec)/.test(n.type)?this.u32:/^(int|ivec|bool)/.test(n.type)?this.i32:this.f32;for(let c=0;c<_.length&&c<r*l;c++){const o=Math.floor(c/l),y=c%l;a[n.offset/4+o*t+y]=a===this.u32?_[c]>>>0:_[c]}}}class K{constructor(e,_,n,l,t){this.device=e,this.usage=_,this.chunkSize=n,this.align=l,this.label=t}chunks=[];at=0;begin(){for(const e of this.chunks)e.used=0;this.at=0}alloc(e){const _=e.byteLength,n=new Uint8Array(e.buffer,e.byteOffset,_);for(;;){let l=this.chunks[this.at];if(!l){const r=Math.max(this.chunkSize,Math.ceil(_/4)*4);l={buffer:this.device.createBuffer({label:this.label,size:r,usage:this.usage|GPUBufferUsage.COPY_DST}),staging:new Uint8Array(r),used:0},this.chunks.push(l)}const t=Math.ceil(l.used/this.align)*this.align;if(t+_<=l.staging.length)return l.staging.set(n,t),l.used=t+_,{buffer:l.buffer,offset:t};this.at++}}flush(){for(let e=0;e<=this.at&&e<this.chunks.length;e++){const _=this.chunks[e];_.used&&this.device.queue.writeBuffer(_.buffer,0,_.staging,0,Math.ceil(_.used/4)*4)}}destroy(){for(const e of this.chunks)e.buffer.destroy();this.chunks=[]}}const X=(b,e)=>Math.floor(Math.log2(Math.max(b,e,1)))+1,O=4,J="depth32float",q=$,ee=["material","previousMaterial","macroField","uShoreRing","canopyWater","previousCanopyWater","uForestField","uForestBank","uOccupation","uLandDetail","uForestBeach","uForestBrushAtlas","semanticTile","previousSemanticTile","drapedMaterial","previousDrapedMaterial"],Oe=[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x2"},{shaderLocation:2,offset:20,format:"float32x2"},{shaderLocation:3,offset:28,format:"float32"},{shaderLocation:4,offset:32,format:"float32x2"}]},{arrayStride:12,attributes:[{shaderLocation:5,offset:0,format:"float32x3"}]}],Ee=[{arrayStride:48,stepMode:"instance",attributes:[{shaderLocation:0,offset:0,format:"float32x4"},{shaderLocation:1,offset:16,format:"float32x4"},{shaderLocation:2,offset:32,format:"float32x4"}]}],Ae=[{arrayStride:ve*4,stepMode:"instance",attributes:[{shaderLocation:0,offset:0,format:"float32x4"},{shaderLocation:1,offset:16,format:"float32x4"},{shaderLocation:2,offset:32,format:"float32x4"}]}],We={color:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x3"},{shaderLocation:4,offset:36,format:"float32"}]}],tex:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x2"},{shaderLocation:3,offset:32,format:"float32"},{shaderLocation:4,offset:36,format:"float32"}]}]},De=`
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct Varying { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Varying {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return Varying(vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0), vec2<f32>(p.x, 1.0 - p.y));
}
@fragment fn fs(v: Varying) -> @location(0) vec4<f32> { return textureSampleLevel(source, linearSampler, v.uv, 0.0); }`,Ne=`
@group(0) @binding(0) var depth: texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> { return vec4<f32>(textureLoad(depth, vec2<i32>(p.xy), 0), 0.0, 0.0, 1.0); }`,C=b=>b,N=(b,e,_,n)=>`ground.${b}.${e}.${_}.${n}`,I=N(0,0,0,0);class qe{constructor(e){this.device=e;for(const a of["terrainVs","groundFs","mapFs","skyVs","skyFs","buildingColorVs","buildingColorFs","buildingTexVs","buildingTexFs","billboardVs","billboardFs","treeVs","treeFs"])this.modules[a]=e.createShaderModule({label:a,code:Pe[a]});this.mip=e.createShaderModule({label:"mipmaps",code:De}),this.depth=e.createShaderModule({label:"depth readback",code:Ne});const _={minFilter:"linear",magFilter:"linear",mipmapFilter:"linear"};this.samplers={nearest:e.createSampler({label:"nearest"}),linear:e.createSampler({label:"linear",..._}),aniso:e.createSampler({label:"material",..._,maxAnisotropy:8}),repeat:e.createSampler({label:"building materials",..._,maxAnisotropy:4,addressModeU:"repeat",addressModeV:"repeat"})},this.billboardSampler=e.createSampler({label:"relief brushes",..._,lodMaxClamp:4});const n=GPUShaderStage.FRAGMENT,l=GPUShaderStage.VERTEX|n,t=a=>({binding:q[a],visibility:n,texture:a==="macroField"?{sampleType:"unfilterable-float"}:a==="uForestBrushAtlas"||a==="albedoTex"||a==="normalTex"?{sampleType:"float",viewDimension:"2d-array"}:{sampleType:"float"}}),r=(a,c)=>({binding:a,visibility:n,sampler:{type:c}});this.layouts={terrain:e.createBindGroupLayout({label:"terrain 3d",entries:[{binding:0,visibility:l,buffer:{type:"read-only-storage"}},r(1,"non-filtering"),r(2,"filtering"),r(3,"filtering"),...ee.map(t)]}),sky:e.createBindGroupLayout({label:"sky",entries:[{binding:0,visibility:l,buffer:{type:"read-only-storage"}}]}),building:e.createBindGroupLayout({label:"buildings 3d",entries:[{binding:0,visibility:l,buffer:{type:"read-only-storage",hasDynamicOffset:!0}},r(4,"filtering"),t("albedoTex"),t("normalTex")]}),tree:e.createBindGroupLayout({label:"near trees",entries:[{binding:0,visibility:l,buffer:{type:"read-only-storage"}}]}),billboard:e.createBindGroupLayout({label:"relief brushes",entries:[{binding:0,visibility:l,buffer:{type:"read-only-storage"}},r(2,"filtering"),t("billboardAtlas")]})},this.pipelineLayouts=Object.fromEntries(Object.entries(this.layouts).map(([a,c])=>[a,e.createPipelineLayout({label:a,bindGroupLayouts:[c]})]))}format=navigator.gpu.getPreferredCanvasFormat();modules={};layouts;pipelineLayouts;billboardSampler;samplers;mip;depth;pipelines=new Map;listeners=new Set;lostListeners=new Set;lost=!1;pipeline(e,_=O){const n=`${_}:${e}`;let l=this.pipelines.get(n);if(!l){const t=l={},r=performance.now();this.pipelines.set(n,t),this.device.createRenderPipelineAsync(this.descriptor(e,_)).then(a=>{console.debug(`WebGPU 3D pipeline ${e}: ${Math.round(performance.now()-r)} ms`),t.pipeline=a;for(const c of this.listeners)c()},a=>{t.failed=!0,this.lost||console.error(`WebGPU 3D pipeline ${e}:`,a)})}return l.pipeline}async adopt(e,_=O){const n=performance.now();this.pipelines.set(`${_}:${e}`,{pipeline:await this.device.createRenderPipelineAsync(this.descriptor(e,_))}),console.debug(`WebGPU 3D pipeline ${e}: ${Math.round(performance.now()-n)} ms (prepare)`)}ready(e,_){return!!this.pipelines.get(`${_}:${e}`)?.pipeline}async settled(e,_=O){for(;;){if(this.lost)throw new Error("WebGPU 3D device lost while preparing the ground.");if(this.pipeline(e,_))return;if(this.pipelines.get(`${_}:${e}`)?.failed)throw new Error(`WebGPU 3D pipeline ${e} failed.`);await new Promise(n=>setTimeout(n,50))}}descriptor(e,_){const n={count:_},l=[{format:this.format}],t=g=>({format:J,depthWriteEnabled:g,depthCompare:g?"less-equal":"always"});if(e==="sky")return{label:e,layout:this.pipelineLayouts.sky,vertex:{module:this.modules.skyVs,entryPoint:"main"},fragment:{module:this.modules.skyFs,entryPoint:"main",targets:l},depthStencil:t(!1),multisample:n};if(e==="tree")return{label:e,layout:this.pipelineLayouts.tree,vertex:{module:this.modules.treeVs,entryPoint:"main",buffers:Ae},fragment:{module:this.modules.treeFs,entryPoint:"main",targets:l},depthStencil:t(!0),multisample:n};if(e==="billboard")return{label:e,layout:this.pipelineLayouts.billboard,vertex:{module:this.modules.billboardVs,entryPoint:"main",buffers:Ee},fragment:{module:this.modules.billboardFs,entryPoint:"main",targets:l},depthStencil:t(!0),multisample:{count:_,alphaToCoverageEnabled:_>1}};if(e.startsWith("buildingColor")||e.startsWith("buildingTex")){const g=e.startsWith("buildingTex")?"tex":"color",s=g==="tex"?"buildingTexVs":"buildingColorVs",L=g==="tex"?"buildingTexFs":"buildingColorFs";return{label:e,layout:this.pipelineLayouts.building,vertex:{module:this.modules[s],entryPoint:"main",buffers:We[g]},fragment:{module:this.modules[L],entryPoint:"main",targets:l},depthStencil:{...t(!0),...e.endsWith(".snow")?{depthBias:-2,depthBiasSlopeScale:-1}:{}},multisample:n}}const r={module:this.modules.terrainVs,entryPoint:"main",buffers:Oe};if(e==="map")return{label:e,layout:this.pipelineLayouts.terrain,vertex:r,fragment:{module:this.modules.mapFs,entryPoint:"main",targets:l},depthStencil:t(!0),multisample:n};const[a,c,o,y]=e.split(".").slice(1).map(Number),u=Y;return{label:e,layout:this.pipelineLayouts.terrain,vertex:r,depthStencil:t(!0),multisample:n,fragment:{module:this.modules.groundFs,entryPoint:"main",targets:l,constants:{[u.groundEnabled]:a,[u.uRenderV2]:c,[u.uForest]:o,[u.uForestBrushes]:y}}}}mipPipelines=new Map;generateMipmaps(e){if(e.mipLevelCount<2)return;let _=this.mipPipelines.get(e.format);_||this.mipPipelines.set(e.format,_=this.device.createRenderPipeline({label:`mipmaps ${e.format}`,layout:"auto",vertex:{module:this.mip,entryPoint:"vs"},fragment:{module:this.mip,entryPoint:"fs",targets:[{format:e.format}]}}));const n=this.device.createCommandEncoder({label:"mipmaps"});for(let l=0;l<e.depthOrArrayLayers;l++)for(let t=1;t<e.mipLevelCount;t++){const r=c=>e.createView({dimension:"2d",baseMipLevel:c,mipLevelCount:1,baseArrayLayer:l,arrayLayerCount:1}),a=n.beginRenderPass({colorAttachments:[{view:r(t),loadOp:"clear",storeOp:"store"}]});a.setPipeline(_),a.setBindGroup(0,this.device.createBindGroup({layout:_.getBindGroupLayout(0),entries:[{binding:0,resource:r(t-1)},{binding:1,resource:this.samplers.linear}]})),a.draw(3),a.end()}this.device.queue.submit([n.finish()])}depthPipeline;depthReadback(){return this.depthPipeline??=this.device.createRenderPipeline({label:"depth readback",layout:"auto",vertex:{module:this.depth,entryPoint:"vs"},fragment:{module:this.depth,entryPoint:"fs",targets:[{format:"r32float"}]}})}}let U,P;const Q=new WeakSet;function Ue(b){return U??=(async()=>{if(!navigator.gpu)return;const e=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!e||e.info?.isFallbackAdapter&&!b)return;const _=await e.requestDevice({label:"terrain 3d",requiredLimits:{maxTextureDimension2D:e.limits.maxTextureDimension2D}});try{const n=new qe(_);_.lost.then(l=>{if(n.lost=!0,!Q.has(_)){P===n&&(P=void 0,U=void 0),console.warn(`WebGPU 3D device lost (${l.reason}): ${l.message}`);for(const t of[...n.lostListeners])t()}}),_.addEventListener("uncapturederror",l=>console.error("WebGPU 3D:",l.error.message));for(const[l,t]of Object.entries(n.modules)){const r=(await t.getCompilationInfo()).messages.filter(a=>a.type==="error");if(r.length)throw new Error(`WGSL ${l}: ${r.map(a=>`${a.lineNum}:${a.linePos} ${a.message}`).join("; ")}`)}if(await Promise.all([1,O].flatMap(l=>["sky","map",I,"buildingColor","buildingTex","tree","billboard"].map(t=>n.adopt(t,l)))),n.lost)throw new Error("WebGPU : appareil perdu pendant la préparation de la vue 3D.");return P=n}catch(n){throw Q.add(_),_.destroy(),n}})().catch(e=>{throw U=void 0,e}),U.then(e=>!!e)}function n_(b,e,_){Ue(!1).then(n=>{n&&P&&!P.lost&&P.pipeline(N(1,b,e,_),O)},()=>{})}function l_(b,e,_,n={},l){return P&&!P.lost?new Ie(b,P,e,_,n,l):void 0}class Ie extends se{gpu;device;context;params;seamPool;terrainParams=new D(W.terrain);skyParams=new D(W.sky);billboardParams=new D(W.billboard);gpuBillboardBuffer;treeParams=new D(W.tree);gpuTreeBuffer;gpuBillboardAtlas;fullIndices;patchIndexCache=new Map;garbage=[];targets;blank;emptyUnfilterable;brushes;ring;lastGroundPipelines=new Map;get samples(){if(!(this.frameInteracting||this.frameQuality>0))return O;if(this.useMapShader)return 1;const e=this.groundKeyNow();return this.gpu.ready(e,1)?1:(this.gpu.pipeline(e,1),O)}groundKeyNow(){const e=this.groundSettings;return N(+!!e,e?.renderV2??0,+!!this.forest,+!!e?.forestBrushes)}pipeline(e){return this.gpu.pipeline(e,this.samples)}redraw=()=>this.request();onDeviceLost;deviceLost=()=>{const e=this.onDeviceLost;this.onDeviceLost=void 0,this.disposed||e?.()};constructor(e,_,n,l,t={},r){super(e,n,l,t),this.onDeviceLost=r;const a=e.getContext("webgpu");if(!a)throw new Error("WebGPU indisponible sur ce canevas.");this.gpu=_,this.device=_.device,this.context=a,this.maxFramebufferDimension=this.device.limits.maxTextureDimension2D,a.configure({device:this.device,format:_.format,alphaMode:"opaque"}),_.listeners.add(this.redraw),_.lostListeners.add(this.deviceLost),this.params=new K(this.device,GPUBufferUsage.STORAGE,256*1024,this.device.limits.minStorageBufferOffsetAlignment,"3d parameters"),this.seamPool=new K(this.device,GPUBufferUsage.VERTEX,4*1024*1024,4,"3d seams"),this.fullIndices=this.indexBuffer(de()),this.blank=this.image(1,1,"r8unorm",new Uint8Array(4),1),this.emptyUnfilterable=this.image(1,1,"r32float",new Float32Array(1),4),this.brushes={image:this.arrayImage(1,1,1,[new Uint8Array([255,128])]),full:!1},this.material=this.uploadTexture(new Uint8Array([203,211,182,255])),this.macroTexture=this.uploadMacroField(this.layer),this.caveTexture=this.uploadCaveMask(this.layer),this.buildings=new He(_,()=>this.request()),this.buildings.setScene(this.buildingsVisible?this.buildingScene:void 0,this.buildingAppearance),this.selectTerrainProgram(!1),this.mark("renderer","webgpu")}attach(){}prepareMapShader(){}contextLost(){return!!this.gpu?.lost}image(e,_,n,l,t,r){const a=r??[l],c=this.device.createTexture({size:[e,_],format:n,mipLevelCount:a.length,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});return a.forEach((o,y)=>{const u=Math.max(1,e>>y),g=Math.max(1,_>>y);this.device.queue.writeTexture({texture:c,mipLevel:y},o,{bytesPerRow:u*t,rowsPerImage:g},[u,g])}),{texture:c,view:c.createView()}}arrayImage(e,_,n,l){const t=this.device.createTexture({size:[e,e,_],format:"rg8unorm",mipLevelCount:n,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});return l.forEach((r,a)=>{const c=Math.max(1,e>>a);this.device.queue.writeTexture({texture:t,mipLevel:a},r,{bytesPerRow:c*2,rowsPerImage:c},[c,c,_])}),{texture:t,view:t.createView({dimension:"2d-array"})}}rgbaImage(e,_){return this.image(e.n,e.n,"rgba8unorm",e.rgba,4,_?_e(e.rgba,e.n,e.n,4):void 0)}indexBuffer(e){const _=this.device.createBuffer({label:"patch indices",size:Math.ceil(e.byteLength/4)*4,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0});return new Uint16Array(_.getMappedRange()).set(e),_.unmap(),{buffer:_,count:e.length}}patchIndices(e,_){const n=ue(e,_);if(!n)return this.fullIndices;let l=this.patchIndexCache.get(n);if(l)return this.patchIndexCache.delete(n),this.patchIndexCache.set(n,l),l;if(this.patchIndexCache.set(n,l=this.indexBuffer(pe(n))),this.patchIndexCache.size>64){const t=this.patchIndexCache.keys().next().value;this.garbage.push(this.patchIndexCache.get(t).buffer),this.patchIndexCache.delete(t)}return l}uploadCaveMask(e){if(!e?.cave?.length||e.cave.length!==e.n*e.n)return;const _=new Uint8Array(e.cave.length);return _.set(e.cave),this.image(e.n,e.n,"r8unorm",_,1)}uploadMacroField(e){const _=e?.n??1;return this.image(_,_,"r32float",e?.data??new Float32Array(1),4)}uploadTexture(e){if(e instanceof Uint8Array){const r=e[3]/255;return this.image(1,1,"rgba8unorm",new Uint8Array([Math.round(e[0]*r),Math.round(e[1]*r),Math.round(e[2]*r),e[3]]),4)}const _=ge(e),n=_.width,l=_.height,t=this.device.createTexture({label:"material",size:[n,l],format:"rgba8unorm",mipLevelCount:X(n,l),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});return this.device.queue.copyExternalImageToTexture({source:_},{texture:t,premultipliedAlpha:!0},[n,l]),this.gpu.generateMipmaps(t),{texture:t,view:t.createView()}}deleteTexture(e){C(e).texture.destroy()}uploadWaterMask(e){return this.image(e.n,e.n,"r8unorm",e.alpha,1)}uploadForest(e){return{field:e,texture:this.rgbaImage(e,!0),bank:e.bank?this.rgbaImage({n:e.n,rgba:e.bank},!0):void 0,beach:e.beach?this.image(e.beach.n,e.beach.n,"r8unorm",e.beach.data,1):void 0}}releaseForest(e){e&&(this.deleteTexture(e.texture),e.bank&&this.deleteTexture(e.bank),e.beach&&this.deleteTexture(e.beach))}uploadOccupation(e){return this.rgbaImage(e,!0)}uploadLandDetail(e){return this.rgbaImage(e,!0)}uploadMesh(e,_){const n=this.device.createBuffer({label:`patch ${e.tile.key}`,size:_.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(n,0,_.buffer,_.byteOffset,_.byteLength),e.vao=n,e.vertices=void 0}releaseMesh(e){e.vao?.destroy()}uploadBillboards(e,_){this.gpuBillboardBuffer?.destroy(),this.gpuBillboardBuffer=void 0,e.length&&(this.gpuBillboardBuffer=this.device.createBuffer({label:"relief instances",size:e.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.gpuBillboardBuffer,0,e.buffer,e.byteOffset,e.byteLength),_&&this.gpuBillboardAtlas?.source!==_&&(this.gpuBillboardAtlas&&this.deleteTexture(this.gpuBillboardAtlas.texture),this.gpuBillboardAtlas={source:_,texture:this.uploadTexture(_)}),this.pipeline("billboard"))}uploadTrees(e){this.gpuTreeBuffer?.destroy(),this.gpuTreeBuffer=void 0,e.length&&(this.gpuTreeBuffer=this.device.createBuffer({label:"near trees",size:e.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.gpuTreeBuffer,0,e.buffer,e.byteOffset,e.byteLength),this.pipeline("tree"))}recordTrees(e,_){if(!this.treesShown()||!this.gpuTreeBuffer||this.groundSettings?.underdark)return;const n=this.pipeline("tree");if(!n)return;const l=this.treeParams,t=this.camera;l.setArray("matrix",_.matrix),l.set("cameraOrigin",t.x,_.targetHeight,t.y),l.set("exaggeration",t.exaggeration),l.setArray("treeFade",this.forestTreesUniform(_)),l.setArray("eye",_.eye),l.setArray("treeLight",this.treeLight()),l.set("fogDistance",this.fogDistance()),l.set("uNight",this.lookSettings.ambience==="night"?1:0);const r=this.params.alloc(l.bytes);e.setPipeline(n),e.setBindGroup(0,this.device.createBindGroup({layout:this.gpu.layouts.tree,entries:[{binding:0,resource:{buffer:r.buffer,offset:r.offset,size:l.bytes.byteLength}}]})),e.setVertexBuffer(0,this.gpuTreeBuffer),e.draw(he,this.treeCount)}billboardsReady(){return!this.billboardCount||!!this.pipeline("billboard")}recordBillboards(e,_,n){if(!this.billboardCount||!this.gpuBillboardBuffer||!this.gpuBillboardAtlas||n<=0)return!1;const l=this.pipeline("billboard");if(!l)return!0;const t=this.billboardParams,r=this.camera;t.setArray("matrix",_.matrix),t.set("cameraOrigin",r.x,_.targetHeight,r.y),t.set("cameraRight",Math.cos(r.yaw),-Math.sin(r.yaw)),t.set("exaggeration",r.exaggeration),t.set("raisedBlend",n),t.setArray("eye",_.eye),t.set("fogDistance",this.fogDistance()),t.set("uNight",this.lookSettings.ambience==="night"?1:0);const a=this.params.alloc(t.bytes);return e.setPipeline(l),e.setBindGroup(0,this.device.createBindGroup({layout:this.gpu.layouts.billboard,entries:[{binding:0,resource:{buffer:a.buffer,offset:a.offset,size:t.bytes.byteLength}},{binding:2,resource:this.gpu.billboardSampler},{binding:q.billboardAtlas,resource:C(this.gpuBillboardAtlas.texture).view}]})),e.setVertexBuffer(0,this.gpuBillboardBuffer),e.draw(6,this.billboardCount),!1}ensureTargets(e,_){const n=this.samples;if(this.targets?.width===e&&this.targets.height===_&&this.targets.samples===n)return this.targets;this.targets?.color.destroy(),this.targets?.depth.destroy();const l=this.device.createTexture({label:"3d colour",size:[e,_],format:this.gpu.format,sampleCount:n,usage:GPUTextureUsage.RENDER_ATTACHMENT}),t=this.device.createTexture({label:"3d depth",size:[e,_],format:J,sampleCount:n,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});return this.targets={width:e,height:_,samples:n,color:l,colorView:l.createView(),depth:t,depthView:t.createView()}}terrainPipeline(){if(this.useMapShader)return this.pipeline("map");const e=this.groundSettings,_=!!this.forest&&!e?.underdark,n=this.pipeline(N(+!!e,e?.renderV2??0,+_,+!!e?.forestBrushes));return this.mark("groundVariant",n?"ready":"pending"),n?(this.lastGroundPipelines.set(this.samples,n),n):e?this.pipeline(I):this.lastGroundPipelines.get(this.samples)??this.pipeline(I)}async prepareVariant(){const e=this.groundSettings,_=this.useMapShader?"map":N(+!!e,e?.renderV2??0,+!!this.forest,+!!e?.forestBrushes);await this.gpu.settled(_,O),this.gpu.pipeline(_,1)}brushAtlas(e){if(e&&!this.brushes.full){const _=le(Uint8Array.from(atob(A.zlib),t=>t.charCodeAt(0))),n=A.families.length*A.variants,l=ne(_,A.size,A.size,2,n);this.brushes.image.texture.destroy(),this.brushes={image:this.arrayImage(A.size,n,l.length,l.map(t=>t.data)),full:!0}}return this.brushes.image.view}renderFrame(e,_,n,l){const t=this.device,r=this.gpu,a=this.layer,c=this.camera,o=this.groundSettings;this.prepareBillboards(),this.prepareTrees(e);const y=this.raisedBlend(e),u=this.ensureTargets(_,n);this.params.begin(),this.seamPool.begin();const g=t.createCommandEncoder({label:"terrain 3d"}),s=g.beginRenderPass({label:"terrain 3d",colorAttachments:[{view:u.samples>1?u.colorView:this.context.getCurrentTexture().createView(),resolveTarget:u.samples>1?this.context.getCurrentTexture().createView():void 0,clearValue:[0,0,0,1],loadOp:"clear",storeOp:u.samples>1?"discard":"store"}],depthStencilAttachment:{view:u.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}}),L=this.pipeline("sky");if(L){this.skyParams.set("height",n),this.skyParams.set("uNight",this.groundSettings?.underdark?2:this.lookSettings.ambience==="night"?1:0);const i=this.params.alloc(this.skyParams.bytes);s.setPipeline(L),s.setBindGroup(0,t.createBindGroup({layout:r.layouts.sky,entries:[{binding:0,resource:{buffer:i.buffer,offset:i.offset,size:this.skyParams.bytes.byteLength}}]})),s.draw(3)}const h=this.terrainPipeline(),f=this.terrainParams,d=this.blank.view;f.set("proceduralPreview",o?1:0);const p={macroField:C(this.macroTexture).view};f.set("uQuality",this.frameQuality),f.setArray("matrix",e.matrix),f.set("exaggeration",c.exaggeration),f.setArray("eye",e.eye),f.set("raisedBlend",y),f.set("fogDistance",this.fogDistance()),f.set("showTileBounds",this.tileBounds?1:0),f.set("uNight",this.lookSettings.ambience==="night"?1:0),f.set("uNaturalWater",this.lookSettings.waterLook==="natural"?1:0),f.set("displayWaterVisible",this.lookSettings.waterVisible===!1?0:1),f.set("displayWaterBand",a.width*.016),f.setArray("uWaterSeason",te(o?.v2Season,o?.climateZone,o?.v2Calendar));const G=o??this.forestSettings;if(G){const i=fe(G.lighting);f.set("uMaterialSeed",G.seed>>>0),f.set("uMaterialClimate",G.climate.temperature,G.climate.precipitation),f.setArray("uForestTrees",this.forestTreesUniform(e)),f.set("groundEye",c.x+e.eye[0],(e.targetHeight+e.eye[1])/c.exaggeration,c.y+e.eye[2]),f.set("groundLight",i.primary[0],i.primary[2],i.primary[1]),f.set("uGroundCover",i.primary[0],i.primary[2],i.primary[1],oe(o?.renderV2??0,!!o?.forestBrushes,!!o&&!!this.forest,this.lookSettings.groundCover)),f.set("groundLight2",i.secondary[0],i.secondary[2],i.secondary[1]),f.set("groundStrength",G.lighting.enabled?G.lighting.strength:0),f.set("macroRect",a.x,a.y,a.width),f.set("macroN",a.n)}if(o){const i=o.renderV2??0;f.set("uV2WaterVisible",o.waterVisible===!1?0:1),f.setArray("uV2GlacierSources",ce(a,o.climate)),f.set("uV2Season",o.v2Season??.5),ae(f,o.climateZone,o.v2Calendar),f.set("uMaterialZone",re(o.climateZone));const x=i>0?ie(a,o.lighting.azimuth,this.ringChanged):void 0;if(x&&(this.ring?.layer!==a||this.ring.revision!==x.revision)){this.ring&&this.deleteTexture(this.ring.image);const R=x.grid;this.ring={layer:a,revision:x.revision,image:this.image(R.n,R.n,"rgba16float",x.half,8),x:R.x,y:R.y,width:R.width}}const v=x?.grid;f.set("uShoreRingRect",v?.x??0,v?.y??0,v?.width??1);const w=o.contours;if(f.set("groundContours",w?1:0),f.set("groundContourStep",w?.step??1),f.set("groundContourOpacity",w?.opacity??0),f.set("groundFlatSlope",w?.flat?.004:.012),w){const R=w.color.replace("#","");f.set("groundContourColor",parseInt(R.slice(0,2),16)/255,parseInt(R.slice(2,4),16)/255,parseInt(R.slice(4,6),16)/255)}}p.uShoreRing=this.ring?.image.view??d;const k=this.forest,z=this.occupation,m=k?.field.beach;p.uForestField=k?C(k.texture).view:d,f.set("uForestRect",k?.field.x??0,k?.field.y??0,k?.field.width??1),p.uForestBank=k?.bank?C(k.bank).view:d,f.set("uHasForestBank",k?.bank?1:0),f.set("uForestBankDensity",k?.field.bankDensity??1),p.uForestBeach=k?.beach?C(k.beach).view:d,f.set("uHasForestBeach",k?.beach?1:0),f.set("uForestBeachRect",m?.x??0,m?.y??0,m?.width??1),p.uOccupation=z?C(z.texture).view:d,f.set("uHasOccupation",z?1:0),f.set("uOccupationRect",z?.data.x??0,z?.data.y??0,z?.data.width??1),f.set("uOccupationN",z?.data.n??1),f.set("uPaperMap",o?.paperMap?1:0),f.set("uUnderdark",o?.underdark?1:0),f.set("uHasCave",o?.underdark&&this.caveTexture?1:0);{const i=o?.townGlow??new Float32Array(0),x=new Float32Array(64);for(let v=0;v<Math.min(16,i.length/3|0);v++)x.set(i.subarray(v*3,v*3+3),v*4);f.setArray("uTownGlow",x),f.set("uTownGlowCount",Math.min(16,i.length/3|0))}{const i=o?.farmBeds??new Float32Array(128);f.setArray("uFarmBeds",i);let x=0;for(let v=0;v<32;v++)i[v*4+2]>0&&(x=v+1);f.set("uFarmBedCount",x)}o?.underdark&&(p.uForestBeach=this.caveTexture?C(this.caveTexture).view:d,f.set("uHasForestBeach",0),f.set("uForestBeachRect",a.x,a.y,a.width));const S=this.landDetail;if(p.uLandDetail=S?C(S.texture).view:d,f.set("uHasLandDetail",S?1:0),f.set("uLandDetailRect",S?.data.x??0,S?.data.y??0,S?.data.width??1),f.set("uLandDetailN",S?.data.n??1),p.uForestBrushAtlas=this.brushAtlas(!!o?.forestBrushes),h){s.setPipeline(h);for(const i of l){const{patch:x,material:v}=i,w=x.tile;f.set("patchOffset",w.x-c.x,x.heightOrigin*c.exaggeration-e.targetHeight,w.y-c.y),f.set("physicalOrigin",w.x,x.heightOrigin,w.y),f.set("patchRect",w.x,w.y,w.width),f.set("morph",i.morph),f.setArray("textureRect",i.textureRect),f.setArray("previousRect",i.previousRect),f.set("textureBlend",v.blend),p.material=C(v.to.texture).view,p.previousMaterial=C(v.from.texture).view;for(const[F,T,M]of[[v.to,"drapedMaterial","hasRaisedMaterial"],[v.from,"previousDrapedMaterial","hasPreviousRaisedMaterial"]]){const V=this.raisedMaterials.get(F.texture);p[T]=V?C(V).view:d,f.set(M,V?1:0)}for(const[F,T]of[[v.to,"canopyWater"],[v.from,"previousCanopyWater"]]){const M=this.waterMasks.get(F.texture);p[T]=M?C(M.texture).view:d,f.set(T==="canopyWater"?"hasCanopyWater":"hasPreviousCanopyWater",M?1:0),f.set(`${T}Rect`,M?.rect[0]??0,M?.rect[1]??0,M?.rect[2]??1)}for(const[F,T,M]of[[v.to,"semanticTile","hasSemanticTile"],[v.from,"previousSemanticTile","hasPreviousSemanticTile"]]){const V=this.semanticTiles.get(F.texture);p[T]=V?C(V.texture).view:d,f.set(M,V?.semantic?1:0),f.setArray(T==="semanticTile"?"semanticRect":"previousSemanticRect",this.overlayRect(F,w)),f.set(T==="semanticTile"?"hasGroundTile":"hasPreviousGroundTile",V?.atlas?1:0),f.setArray(T==="semanticTile"?"groundRect":"previousGroundRect",this.overlayRect(F,w,!0))}const R=this.params.alloc(f.bytes),H=this.seamPool.alloc(i.correction),j=this.patchIndices(w,i.clip);s.setBindGroup(0,t.createBindGroup({layout:r.layouts.terrain,entries:[{binding:0,resource:{buffer:R.buffer,offset:R.offset,size:f.bytes.byteLength}},{binding:1,resource:r.samplers.nearest},{binding:2,resource:r.samplers.linear},{binding:3,resource:r.samplers.aniso},...ee.map(F=>({binding:q[F],resource:F==="macroField"?p.macroField??this.emptyUnfilterable.view:p[F]??d}))]})),s.setVertexBuffer(0,x.vao),s.setVertexBuffer(1,H.buffer,H.offset,i.correction.byteLength),s.setIndexBuffer(j.buffer,"uint16"),s.drawIndexed(j.count)}}const E=this.buildings;E.target={pass:s,params:this.params,samples:this.samples};let B;try{B=E.draw(this.buildingFrame(e))}finally{E.target=void 0}this.recordTrees(s,e),B=this.recordBillboards(s,e,y)||B,s.end(),this.params.flush(),this.seamPool.flush(),t.queue.submit([g.finish()]);for(const i of this.garbage.splice(0))i.destroy();return B||!h}async captureFrame(e,_){const n=this.canvas.width,l=this.canvas.height,t=this.targets;if(!t||t.width!==n||t.height!==l)throw new Error("Capture 3D indisponible.");const r=document.createElement("canvas");r.width=n,r.height=l,r.getContext("2d").drawImage(this.canvas,0,0);const a=this.device,c=this.gpu.depthReadback(),o=a.createTexture({label:"depth readback",size:[n,l],format:"r32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),y=Math.ceil(n*4/256)*256,u=a.createBuffer({label:"depth readback",size:y*l,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const g=a.createCommandEncoder({label:"depth readback"}),s=g.beginRenderPass({colorAttachments:[{view:o.createView(),loadOp:"clear",storeOp:"store",clearValue:[1,0,0,1]}]});s.setPipeline(c),s.setBindGroup(0,a.createBindGroup({layout:c.getBindGroupLayout(0),entries:[{binding:0,resource:t.depth.createView({aspect:"depth-only"})}]})),s.draw(3),s.end(),g.copyTextureToBuffer({texture:o},{buffer:u,bytesPerRow:y,rowsPerImage:l},[n,l]),a.queue.submit([g.finish()]),await u.mapAsync(GPUMapMode.READ);const L=new Float32Array(u.getMappedRange()),h=new Float32Array(n*l),f=y/4;let d=1/0,p=-1/0;for(let m=0;m<l;m++)for(let S=0;S<n;S++){const E=L[m*f+S],B=m*n+S;E<1&&(h[B]=(_+e-(2*E-1)*(_-e))/(2*e*_),d=Math.min(d,h[B]),p=Math.max(p,h[B]))}u.unmap();const G=document.createElement("canvas");G.width=n,G.height=l;const k=G.getContext("2d"),z=k.createImageData(n,l);for(let m=0;m<h.length;m++){const S=h[m]?p>d?1+Math.round(254*(h[m]-d)/(p-d)):255:0;z.data[m*4]=z.data[m*4+1]=z.data[m*4+2]=S,z.data[m*4+3]=255}return k.putImageData(z,0,0),{color:r,depth:G}}finally{o.destroy(),u.destroy()}}disposeBackend(){this.gpu.listeners.delete(this.redraw),this.gpu.lostListeners.delete(this.deviceLost),this.releaseForest(this.forest),this.occupation&&this.deleteTexture(this.occupation.texture),this.landDetail&&this.deleteTexture(this.landDetail.texture),this.gpuBillboardBuffer?.destroy(),this.gpuBillboardAtlas&&this.deleteTexture(this.gpuBillboardAtlas.texture);for(const e of this.raisedMaterials.values())this.deleteTexture(e);this.raisedMaterials.clear();for(const e of[this.material,this.macroTexture,this.caveTexture,this.blank,this.emptyUnfilterable,this.brushes.image,this.ring?.image])e&&this.deleteTexture(e);this.fullIndices.buffer.destroy();for(const e of this.patchIndexCache.values())e.buffer.destroy();this.patchIndexCache.clear(),this.targets?.color.destroy(),this.targets?.depth.destroy(),this.targets=void 0,this.params.destroy(),this.seamPool.destroy(),this.context.unconfigure()}}class He extends me{constructor(e,_){super(void 0,_),this.gpu=e,this.placeholder=e.device.createTexture({label:"no building material",size:[1,1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING})}target;params=new D(W.building);atlases;placeholder;upload(e,_){const n=this.gpu.device.createBuffer({label:"building batch",size:_.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.gpu.device.queue.writeBuffer(n,0,_.buffer,_.byteOffset,_.byteLength),e.gpu=n}releaseBatch(e){e.gpu?.destroy(),e.gpu=void 0}uploadTextures(e){const _=Z.tile,n=Z.layers.length,l=this.gpu.device,t=(r,a)=>{const c=l.createTexture({label:a,size:[_,_,n],format:"rgba8unorm",mipLevelCount:X(_,_),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});for(let o=0;o<n;o++)l.queue.copyExternalImageToTexture({source:r,origin:{x:0,y:o*_}},{texture:c,origin:{x:0,y:0,z:o}},[_,_]);return this.gpu.generateMipmaps(c),c};this.atlases?.albedo.destroy(),this.atlases?.normal.destroy(),this.atlases={albedo:t(e.albedo,"building albedo"),normal:t(e.normal,"building normals")}}render(e,_,n){const l=this.target;if(!l||!_.length)return;const t=this.gpu.pipeline(n?"buildingTex":"buildingColor",l.samples),r=_.some(h=>h.cached?.batches.some(f=>f.snow))?this.gpu.pipeline(n?"buildingTex.snow":"buildingColor.snow",l.samples):void 0;if(!t)return;const{pass:a,params:c}=l,o=this.params,y=this.gpu.device,u=(this.atlases?.albedo??this.placeholder).createView({dimension:"2d-array"}),g=(this.atlases?.normal??this.placeholder).createView({dimension:"2d-array"});a.setPipeline(t),o.setArray("matrix",e.matrix),o.set("exaggeration",e.exaggeration),o.set("useTex",this.atlases?2:0),o.set("softFrom",xe),o.set("uNight",+this.night);let s,L;for(const h of _){o.set("offset",h.origin[0]-e.cameraX,-e.targetHeight,h.origin[1]-e.cameraY),o.set("sectorOrigin",h.origin[0],h.origin[1]);for(const f of h.cached.batches){if(!f.gpu)continue;a.setPipeline(f.snow&&r?r:t),n&&(o.setArray("material",f.color),o.setArray("tint",f.tint),o.set("recolored",f.recolored?1:0));const d=c.alloc(o.bytes);d.buffer!==L&&(L=d.buffer,s=y.createBindGroup({layout:this.gpu.layouts.building,entries:[{binding:0,resource:{buffer:d.buffer,offset:0,size:o.bytes.byteLength}},{binding:4,resource:this.gpu.samplers.repeat},{binding:q.albedoTex,resource:u},{binding:q.normalTex,resource:g}]})),a.setBindGroup(0,s,[d.offset]),a.setVertexBuffer(0,f.gpu),a.draw(f.count)}}}disposeBackend(){this.atlases?.albedo.destroy(),this.atlases?.normal.destroy(),this.atlases=void 0,this.placeholder.destroy()}}export{l_ as createTerrain3dGpu,Ue as prepareTerrain3dGpu,n_ as prewarmTerrain3dGround};
