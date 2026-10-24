import test from 'node:test';import assert from 'node:assert/strict';
import {verifyTreeAssetCapture} from './surface_tree_evidence.mjs';
const manifest={digest:'asset',sourceAssetDigest:'source',pipelineVersion:'pipeline',sourceGeometry:{actualTriangles:134295},highMaxInstances:14,highMinPixels:500,highTriangleBudget:2000000};
function fixture(){return {canopyView:{phase:2,transitionPending:false,activeAtlasSource:{rendererAssetDigest:'asset'},geometryFilterCompatible:true,geometryFilterRatio:4,geometryFilterMaximumRatio:8,
  treeAssets:{enabled:true,profile:{available:true,cpuOnly:false,digest:'asset',sourceAssetDigest:'source',pipelineVersion:'pipeline',triangles:134295,impostorTriangles:2,views:5},
  highCount:1,impostorCount:2,highTriangles:134295,impostorTriangles:4,retainedCount:3,droppedCount:0,highMinPixels:500,highBudget:2000000}},populationInstances:{families:{tree:{submitted:3,alphaPositiveInFrustum:2}}}};}
test('a settled requested tree asset joins its atlas and actually submitted buffers',()=>assert.equal(verifyTreeAssetCapture(fixture(),manifest,{requireGeometry:true}).retainedCount,3));
test('stale asset, unsafe filter, dropped identity, inflated triangles and absent geometry fail closed',()=>{
  for(const [path,value]of [['canopyView.treeAssets.enabled',false],['canopyView.treeAssets.profile.cpuOnly',true],['canopyView.activeAtlasSource.rendererAssetDigest','old'],['canopyView.geometryFilterRatio',9],['canopyView.transitionPending',true],['canopyView.treeAssets.droppedCount',1],['canopyView.treeAssets.highTriangles',1],['populationInstances.families.tree.submitted',4],['populationInstances.families.tree.alphaPositiveInFrustum',0]]){
    const data=fixture();let target=data;const keys=path.split('.');for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=value;
    assert.throws(()=>verifyTreeAssetCapture(data,manifest,{requireGeometry:true}),path);
  }
});

test('required geometry cannot be certified by missing, nonnumeric or impossible visible counts',()=>{
  for(const value of [undefined,null,NaN,Infinity,'2',true,-1,0,0.5,4]){
    const data=fixture();data.populationInstances.families.tree.alphaPositiveInFrustum=value;
    assert.throws(()=>verifyTreeAssetCapture(data,manifest,{requireGeometry:true}),String(value));
  }
});
test('common filter certificate has strict finite numeric bounds and a boolean compatibility result',()=>{
  for(const [key,values]of Object.entries({geometryFilterCompatible:['true',1,null],geometryFilterMaximumRatio:[undefined,null,NaN,Infinity,0,-1,'8',9],geometryFilterRatio:[NaN,Infinity,-1,'4']})){
    for(const value of values){const data=fixture();data.canopyView[key]=value;assert.throws(()=>verifyTreeAssetCapture(data,manifest),key+':'+String(value));}
  }
});
test('empty near framing or a disabled tree layer retains capability without claiming visible geometry',()=>{
  for(const hidden of [false,true]){
    const data=fixture();data.populationInstances.families.tree.alphaPositiveInFrustum=0;
    data.populationInstances.families.tree.nodeVisible=0;data.layerView={visibility:{trees:!hidden}};
    assert.equal(verifyTreeAssetCapture(data,manifest).retainedCount,3);
    assert.throws(()=>verifyTreeAssetCapture(data,manifest,{requireGeometry:true}));
  }
});
test('an ignored asset is rejected even when no visible geometry is required',()=>{
  const data=fixture();data.canopyView.treeAssets.enabled=false;
  assert.throws(()=>verifyTreeAssetCapture(data,manifest));
});
