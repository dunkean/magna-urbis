type Row=Record<string,any>;
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validDisplay=(v:unknown):v is Row=>record(v)&&typeof v.worldId==='string'&&!!v.worldId&&record(v.source)
  &&v.source.sourceLODKnown===true&&typeof v.source.id==='string'&&!!v.source.id&&typeof v.source.version==='string'&&!!v.source.version
  &&Number.isSafeInteger(v.liveSerial)&&Number.isSafeInteger(v.appliedTickMs)&&typeof v.sourceEpoch==='string'&&!!v.sourceEpoch&&typeof v.sceneEpoch==='string'&&!!v.sceneEpoch;

/** Independently join the probe observations to production renderer applications
 * and fresh accepted packets. Acceptance alone or an old parent redraw cannot pass. */
export function verifyMotionLiveDisplay(proof:unknown,metrics:unknown):{displayedLiveWorlds:Row[];discardedPreparations:unknown} {
  if(!record(proof)||proof.version!==2||!record(metrics)||!Array.isArray(proof.motionDisplayEvents)||!Array.isArray(metrics.renderEvents)||!Array.isArray(metrics.liveAcceptance)
    ||!Number.isSafeInteger(proof.motionStartTickMs)||!Number.isSafeInteger(proof.motionEndTickMs)||proof.motionEndTickMs<=proof.motionStartTickMs
    ||!record(proof.initial)||!record(proof.initial.rendered)||!Number.isSafeInteger(proof.initial.rendered.liveSerial))throw new Error('Missing authoritative rendered navigation evidence');
  const displayedLiveWorlds:Row[]=[];
  for(const display of proof.motionDisplayEvents){
    if(!validDisplay(display)||display.liveSerial<=proof.initial.rendered.liveSerial||display.appliedTickMs<=proof.motionStartTickMs||display.appliedTickMs>proof.motionEndTickMs)continue;
    const actual=metrics.renderEvents.some((e:unknown)=>validDisplay(e)&&e.worldId===display.worldId&&e.liveSerial===display.liveSerial&&e.appliedTickMs===display.appliedTickMs
      &&e.source.id===display.source.id&&e.source.version===display.source.version&&e.sourceEpoch===display.sourceEpoch&&e.sceneEpoch===display.sceneEpoch);
    const freshAccepted=metrics.liveAcceptance.some((e:unknown)=>record(e)&&Number.isSafeInteger(e.tickMs)&&e.tickMs>proof.motionStartTickMs&&e.tickMs<=display.appliedTickMs
      &&e.worldId===display.worldId&&e.requestSerial===display.liveSerial&&e.sourceEpoch===display.sourceEpoch&&e.sceneEpoch===display.sceneEpoch);
    if(actual&&freshAccepted)displayedLiveWorlds.push(display);
  }
  if(!displayedLiveWorlds.length)throw new Error('No fresh accepted live world was actually rendered during continuous input');
  if(!record(metrics.discardedPreparations))throw new Error('Missing discarded-preparation counters');
  return{displayedLiveWorlds,discardedPreparations:metrics.discardedPreparations};
}
