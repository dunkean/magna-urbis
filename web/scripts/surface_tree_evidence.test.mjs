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
