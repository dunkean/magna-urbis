import test from 'node:test';
import assert from 'node:assert/strict';
import {runSurfaceNavigationRetainingVisuals,canRetainSurfaceNavigationVisuals,assertNoRetainedNavigationFailure} from './surface_visual_retention.mjs';

async function flow({enabled=false,fail=true,finalReady=true,errors=[]}={}) {
  const report={navigation:{code:0,result:{finalReady,status:'complete'},finalDisplayEvidence:{verified:true}}};
  report.navigation.visualRetentionEligible=canRetainSurfaceNavigationVisuals(report.navigation,errors);
  const collected=[];
  try {
    await runSurfaceNavigationRetainingVisuals(report,enabled,async()=>{if(fail)throw Error('nominal 20s gate failed');report.navigation.status='complete';});
    collected.push('tour','probe10000','probe160');
    assertNoRetainedNavigationFailure(report);
    report.status='complete';
  } catch(error) {report.status='failed';report.failure=String(error);}
  return {report,collected};
}

test('opt-in keeps valid final visuals and still fails the run',async()=>{
  const {report,collected}=await flow({enabled:true});
  assert.deepEqual(collected,['tour','probe10000','probe160']);
  assert.equal(report.status,'failed');assert.equal(report.navigation.status,'failed');
  assert.match(report.failure,/Navigation FAILED/);assert.equal(report.visualsAfterNavigationFailure.overallSuccessAllowed,false);
});

test('default navigation failure aborts before independent visuals',async()=>{
  const {report,collected}=await flow();assert.deepEqual(collected,[]);assert.equal(report.status,'failed');assert.equal(report.retainedNavigationFailure,undefined);
});

test('unready final or any integrity failure blocks opt-in continuation',async()=>{
  for(const options of [{finalReady:false},{errors:['native error']},{errors:['source/binding error']},{errors:['HTTP transport failure']}]) {
    const {report,collected}=await flow({enabled:true,...options});assert.deepEqual(collected,[]);assert.equal(report.status,'failed');
  }
  const phase={code:0,result:{finalReady:true},finalDisplayEvidence:{}};
  for(const patch of [{timedOut:true},{signal:'SIGTERM'},{code:2},{finalDisplayEvidence:undefined}])assert.equal(canRetainSurfaceNavigationVisuals({...phase,...patch},[]),false);
});

test('successful navigation leaves ordinary completion unchanged',async()=>{
  for(const enabled of [false,true]){const {report,collected}=await flow({enabled,fail:false});assert.equal(report.status,'complete');assert.equal(collected.length,3);assert.equal(report.retainedNavigationFailure,undefined);}
});
