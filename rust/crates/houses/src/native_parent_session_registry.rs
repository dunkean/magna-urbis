//! Short registry leases; no registry/global quota lock during native planning.
use super::*;
use super::leaf_index::{LeafIndex,BatchLeaves};
use sha2::{Digest,Sha256};
use std::collections::VecDeque;
use std::sync::{Mutex,atomic::{AtomicBool,AtomicU64,Ordering}};
const MAX_RUNS:usize=4;
const MAX_TOTAL:usize=1_000_000;
const MAX_ID_BYTES:usize=128*1024*1024;
const HISTORY:usize=256;
const IDLE_MS:u64=15*60*1000;
const MAX_OUTPUT:usize=64*1024*1024;
#[derive(Clone,Copy)]
pub enum ParentSessionOperation{Begin,Plan,Ack,Abort,Release}
#[derive(Clone)]
pub struct ParentSessionRuntime{inner:Arc<Registry>}
struct Registry{incarnation:String,sequence:AtomicU64,slots:Mutex<Slots>,quota:Arc<Mutex<ParentPrefixCounts>>,
    #[cfg(test)]gate:Mutex<Option<(String,Arc<ComputeTestGate>)>>,
}
struct Slots{runs:BTreeMap<String,Arc<Run>>,closed:VecDeque<(String,ParentSessionSource)>}
struct Run{
    id:String,begin_digest:String,run_id:String,source:ParentSessionSource,total:usize,settings:Option<PlacementBatchSettings>,
    last_touch:AtomicU64,closing:AtomicBool,state:Mutex<RunState>,quota:Arc<Mutex<ParentPrefixCounts>>,reserved:Mutex<ParentPrefixCounts>,
}
struct RunState{offset:usize,phase:Phase,history:VecDeque<ParentSessionReceipt>,seen:BTreeSet<String>,seen_keys:BTreeSet<String>,id_bytes:usize}
enum Phase{Ready(Arc<LeafIndex>),Computing{key:String,digest:String,offset:usize},Pending(Pending),Closed}
struct Pending{index:Arc<LeafIndex>,leaves:BatchLeaves,reply:Arc<Vec<u8>>,receipt:ParentSessionReceipt,request_ids:Vec<String>}
fn err(code:&str,message:&str)->String{format!("[parent_session_{code}] {message}")}
fn version(s:&str)->Result<(),String>{if s!=PARENT_SESSION_SCHEMA{Err(err("version","Unsupported session schema"))}else{Ok(())}}
fn text(s:&str,max:usize)->bool{!s.is_empty()&&s.len()<=max}
fn token(s:&str,max:usize)->bool{text(s,max)&&s.bytes().all(|b|b.is_ascii_graphic()&&b!=b'"'&&b!=b'\\')}
fn digest(v:&impl Serialize)->Result<String,String>{
    let mut v=serde_json::to_value(v).map_err(|e|e.to_string())?;crate::compact::encode_floats(&mut v);
    Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(&v).map_err(|e|e.to_string())?)))
}
fn raw_success(v:&impl Serialize)->Result<Arc<Vec<u8>>,String>{
    let bytes=serde_json::to_vec(&serde_json::json!({"ok":true,"data":v})).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_OUTPUT{return Err(err("budget","Actual session response exceeds64MiB"));}Ok(Arc::new(bytes))
}
fn fail_reply(message:String)->Arc<Vec<u8>>{Arc::new(serde_json::to_vec(&serde_json::json!({"ok":false,"error":{"code":"parent_session_refused","field":null,"message":message}})).unwrap())}
fn add(a:&mut ParentPrefixCounts,b:&ParentPrefixCounts){a.parents+=b.parents;a.members+=b.members;a.leaves+=b.leaves;a.vertices+=b.vertices;a.index_references+=b.index_references;a.retained_index_bytes+=b.retained_index_bytes;}
fn sub(a:&mut ParentPrefixCounts,b:&ParentPrefixCounts){a.parents-=b.parents;a.members-=b.members;a.leaves-=b.leaves;a.vertices-=b.vertices;a.index_references-=b.index_references;a.retained_index_bytes-=b.retained_index_bytes;}
impl Drop for Run{fn drop(&mut self){let reserved=self.reserved.get_mut().unwrap();let mut global=self.quota.lock().unwrap();sub(&mut global,reserved);}}
struct ComputeLease{registry:Arc<Registry>,run:Arc<Run>,index:Option<Arc<LeafIndex>>,done:bool}
impl Drop for ComputeLease{fn drop(&mut self){if !self.done{self.run.closing.store(true,Ordering::SeqCst);self.registry.remove(&self.run.id);}}}
impl Registry{
    fn remove(&self,id:&str){
        let removed={let mut slots=self.slots.lock().unwrap();let removed=slots.runs.remove(id);
            if let Some(r)=&removed{slots.closed.push_back((id.into(),r.source.clone()));while slots.closed.len()>HISTORY{slots.closed.pop_front();}}removed};
        drop(removed); // large state/index/response cleanup OUTSIDE registry lock
    }
    fn sweep(&self,now:u64){
        let mut removed=vec![];
        {let mut slots=self.slots.lock().unwrap();let expired=slots.runs.iter().filter(|(_,r)|now.saturating_sub(r.last_touch.load(Ordering::SeqCst))>IDLE_MS)
            .map(|(id,r)|(id.clone(),r.clone())).collect::<Vec<_>>();
            for(id,r)in expired{r.closing.store(true,Ordering::SeqCst);
                let idle=r.state.try_lock().ok().is_some_and(|s|!matches!(s.phase,Phase::Computing{..}));
                if idle{if let Some(run)=slots.runs.remove(&id){slots.closed.push_back((id,run.source.clone()));removed.push(run);}}
            }while slots.closed.len()>HISTORY{slots.closed.pop_front();}
        }drop(removed);
    }
    fn lookup(&self,id:&str,fingerprint:&str,revision:&str,now:u64)->Result<Arc<Run>,String>{
        self.sweep(now);
        let run=self.slots.lock().unwrap().runs.get(id).cloned().ok_or_else(||err("missing","Session absent, expired, released or from another engine incarnation"))?;
        if run.source.fingerprint!=fingerprint||run.source.revision!=revision{return Err(err("identity","Source fingerprint/revision changed"));}
        if run.closing.load(Ordering::SeqCst){return Err(err("closed","Session is closing/draining"));}
        run.last_touch.fetch_max(now,Ordering::SeqCst);Ok(run)
    }
}
impl ParentSessionRuntime{
    pub fn new(incarnation:String)->Result<Self,String>{
        if !token(&incarnation,128){return Err(err("identity","Invalid engine incarnation nonce"));}
        Ok(Self{inner:Arc::new(Registry{incarnation,sequence:AtomicU64::new(0),slots:Mutex::new(Slots{runs:BTreeMap::new(),closed:VecDeque::new()}),quota:Arc::new(Mutex::new(ParentPrefixCounts::default())),
            #[cfg(test)]gate:Mutex::new(None),
        })})
    }
    pub fn limits()->ParentSessionLimits{ParentSessionLimits{
        max_parents_per_batch:64,max_input_bytes:24*1024*1024,max_raw_bytes:32*1024*1024,
        max_std_rewritten_bytes:64*1024*1024,max_std_float_slots:262144,max_output_bytes:MAX_OUTPUT,
        max_hit_parts:leaf_index::MAX_QUERY_PARTS,max_hit_vertices:leaf_index::MAX_QUERY_VERTICES,max_runs:MAX_RUNS,max_total_requests:MAX_TOTAL,
        max_retained_vertices:leaf_index::MAX_RETAINED_VERTICES,max_index_references:leaf_index::MAX_INDEX_REFERENCES,max_retained_index_bytes:leaf_index::MAX_RETAINED_BYTES,
        max_identity_bytes:MAX_ID_BYTES,ack_history_entries:HISTORY,idle_timeout_ms:IDLE_MS,
    }}
    fn begin_reply(&self,r:&Run,offset:usize)->BeginParentSessionReply{BeginParentSessionReply{
        schema_version:PARENT_SESSION_SCHEMA.into(),session_id:r.id.clone(),source:r.source.clone(),generator_version:PARENT_SESSION_GENERATOR.into(),
        batch_schema_version:parent_batch::PARENT_BATCH_SCHEMA.into(),partition:PARENT_SESSION_PARTITION.into(),offset,total_requests:r.total,
        state:if offset==r.total{"complete"}else{"ready"}.into(),limits:Self::limits(),
    }}
    pub fn begin(&self,input:BeginParentSessionRequest,now:u64)->Result<BeginParentSessionReply,String>{
        version(&input.schema_version)?;
        if !token(&input.run_id,128)||!token(&input.source.fingerprint,1024)||!token(&input.source.revision,1024)||input.source.coordinate_space!="world-metres"||input.total_requests>MAX_TOTAL{
            return Err(err("identity","Invalid run/source identity, coordinate space or total request budget"));}
        parent_batch::encoded_budget(&input)?;
        let begin_digest=digest(&input)?;self.inner.sweep(now);
        let mut slots=self.inner.slots.lock().unwrap();
        let existing=slots.runs.values().find(|r|r.run_id==input.run_id).cloned();
        if let Some(r)=existing{
            drop(slots);
            if r.begin_digest!=begin_digest{return Err(err("identity","Run nonce reused with changed source/settings"));}
            if r.closing.load(Ordering::SeqCst){return Err(err("closed","Run nonce is closing"));}
            // No planning occurs under this short state lock.
            let offset=r.state.lock().unwrap().offset;return Ok(self.begin_reply(&r,offset));
        }
        if slots.runs.len()>=MAX_RUNS{return Err(err("budget","Active native run registry is full; release an old run"));}
        let sequence=self.inner.sequence.fetch_add(1,Ordering::SeqCst);if sequence==u64::MAX{return Err(err("budget","Engine session sequence exhausted"));}
        let id=format!("native-parent-session-1/{}/{}/{}",self.inner.incarnation,input.run_id,sequence);
        let run=Arc::new(Run{id:id.clone(),begin_digest,run_id:input.run_id,source:input.source,total:input.total_requests,settings:input.settings,
            last_touch:AtomicU64::new(now),closing:AtomicBool::new(false),
            state:Mutex::new(RunState{offset:0,phase:Phase::Ready(Arc::new(LeafIndex::default())),history:VecDeque::new(),seen:BTreeSet::new(),seen_keys:BTreeSet::new(),id_bytes:0}),
            quota:self.inner.quota.clone(),reserved:Mutex::new(ParentPrefixCounts::default())});
        let reply=self.begin_reply(&run,0);slots.runs.insert(id,run);Ok(reply)
    }
    pub fn plan(&self,input:PlanParentSessionRequest,now:u64)->Result<Arc<Vec<u8>>,String>{
        version(&input.schema_version)?;
        if !token(&input.key,128)||input.requests.is_empty()||input.requests.len()>64{return Err(err("budget","Invalid batch key/count; empty plan is not EOF"));}
        parent_batch::encoded_budget(&input)?;
        let hash=digest(&input)?;let run=self.inner.lookup(&input.session_id,&input.source_fingerprint,&input.revision,now)?;
        let request_ids=input.requests.iter().map(|r|r.id.clone()).collect::<Vec<_>>();
        let index={let mut state=run.state.lock().unwrap();
            match &state.phase{
                Phase::Pending(p)=>{if p.receipt.key==input.key&&p.receipt.request_sha256==hash&&p.receipt.offset==input.expected_offset{return Ok(p.reply.clone());}
                    return Err(err("pending_ack","Previous pending output must be durably ACKed before any changed batch"));},
                Phase::Computing{key,digest,offset}=>{return Err(if key==&input.key&&digest==&hash&&*offset==input.expected_offset{err("inflight","Same native batch is still computing; no second calculation started")}else{err("busy","Another native batch is computing")});},
                Phase::Closed=>return Err(err("closed","Run closed")),Phase::Ready(_)=>{},
            }
            if state.seen_keys.contains(&input.key){return Err(err("already_acked","This batch key was already committed; retry ACK instead"));}
            if input.expected_offset!=state.offset||state.offset.checked_add(input.requests.len()).is_none_or(|n|n>run.total){return Err(err("offset","Plan offset/count does not match native committed prefix"));}
            let bytes=request_ids.iter().map(String::len).sum::<usize>().saturating_add(input.key.len());
            if state.id_bytes.saturating_add(bytes)>MAX_ID_BYTES{return Err(err("budget","Processed request identity byte budget exceeded"));}
            let mut unique=BTreeSet::new();for id in &request_ids{if !text(id,2048)||state.seen.contains(id)||!unique.insert(id){return Err(err("identity","Duplicate/invalid request identity in native run"));}}
            let Phase::Ready(index)=std::mem::replace(&mut state.phase,Phase::Computing{key:input.key.clone(),digest:hash.clone(),offset:input.expected_offset})else{unreachable!()};index
        };
        let mut lease=ComputeLease{registry:self.inner.clone(),run:run.clone(),index:Some(index),done:false};
        let scope=prefix_scope::Scope::enter(lease.index.as_ref().unwrap().clone(),&input.requests)?;
        #[cfg(test)]
        {let gate=self.inner.gate.lock().unwrap().as_ref().filter(|(id,_)|id==&run.id).map(|(_,g)|g.clone());
            if let Some(g)=gate{g.entered.wait();g.proceed.wait();assert!(!g.panic_after,"test-only compute unwind");}}
        let mut batch=parent_batch::plan_parent_batch(ParentPlanBatchRequest{schema_version:parent_batch::PARENT_BATCH_SCHEMA.into(),
            batch:PlanBatchRequest{schema_version:"1".into(),requests:input.requests,settings:run.settings.clone(),footprints:input.footprints},
            prior_occupation:PriorOccupation{land_parts:vec![],roof_parts:vec![]}})?;
        let context_report=scope.finish()?;drop(scope);
        if run.closing.load(Ordering::SeqCst){return Err(err("closed","Calculation drained after abort/expiration; no pending output published"));}
        batch.generator_version=PARENT_SESSION_GENERATOR.into();
        let leaves=BatchLeaves::from_batch(&batch,lease.index.as_ref().unwrap().counts.parents as u64)?;
        lease.index.as_ref().unwrap().preflight_append(&leaves)?;
        let batch_json=serde_json::to_string(&batch).map_err(|e|e.to_string())?;
        let receipt=ParentSessionReceipt{session_id:run.id.clone(),source_fingerprint:run.source.fingerprint.clone(),revision:run.source.revision.clone(),key:input.key,
            offset:input.expected_offset,completed:input.expected_offset+request_ids.len(),total:run.total,request_sha256:hash,
            batch_sha256:format!("{:x}",Sha256::digest(batch_json.as_bytes()))};
        // Exact opaque native batch bytes, hashable before any JS JSON.parse.
        let reply=raw_success(&serde_json::json!({"receipt":receipt,"batch_json":batch_json,"context_report":context_report}))?;
        drop(batch); // no native parent/archive graph persists into next batch
        let mut state=run.state.lock().unwrap();
        if run.closing.load(Ordering::SeqCst){return Err(err("closed","Closing run cannot publish/ACK pending output"));}
        state.phase=Phase::Pending(Pending{index:lease.index.take().unwrap(),leaves,reply:reply.clone(),receipt,request_ids});lease.done=true;
        Ok(reply)
    }
    pub fn ack(&self,input:AckParentSessionRequest,now:u64)->Result<AckParentSessionReply,String>{
        version(&input.schema_version)?;let receipt=&input.receipt;
        let run=self.inner.lookup(&receipt.session_id,&receipt.source_fingerprint,&receipt.revision,now)?;
        let mut state=run.state.lock().unwrap();
        if state.history.iter().any(|r|r==receipt){return Ok(Self::ack_reply(&run,&state,"already_acked"));}
        if receipt.completed<=state.offset{return Err(err("ack_history_expired","Receipt is outside the retained acknowledgement window; no insertion performed"));}
        let Phase::Pending(p)=&state.phase else{return Err(err("ack","No matching pending output"));};
        if &p.receipt!=receipt{return Err(err("ack","ACK receipt key/hash/offset/completed does not match exact pending output"));}
        let next=p.index.preflight_append(&p.leaves)?;let old=p.index.counts.clone();
        let mut delta=next.clone();sub(&mut delta,&old);
        {let mut global=self.inner.quota.lock().unwrap();
            if global.vertices.saturating_add(delta.vertices)>leaf_index::MAX_RETAINED_VERTICES||global.index_references.saturating_add(delta.index_references)>leaf_index::MAX_INDEX_REFERENCES
                ||global.retained_index_bytes.saturating_add(delta.retained_index_bytes)>leaf_index::MAX_RETAINED_BYTES{return Err(err("budget","Complete native registry index budget exhausted before ACK"));}
            add(&mut global,&delta);add(&mut run.reserved.lock().unwrap(),&delta);
        } // global quota lock released BEFORE inserting geometry/index leaves
        let Phase::Pending(mut p)=std::mem::replace(&mut state.phase,Phase::Closed)else{unreachable!()};
        let append=match Arc::get_mut(&mut p.index){Some(index)=>index.append(p.leaves),None=>Err(err("invariant","Prefix index lease still shared at ACK"))};
        if let Err(error)=append{
            run.closing.store(true,Ordering::SeqCst);
            {let mut global=self.inner.quota.lock().unwrap();let mut reserved=run.reserved.lock().unwrap();sub(&mut global,&reserved);*reserved=ParentPrefixCounts::default();}
            drop(state);self.inner.remove(&run.id);return Err(error);
        }
        if run.closing.load(Ordering::SeqCst){drop(state);self.inner.remove(&run.id);return Err(err("closed","ACK drained after closure; no next batch permitted"));}
        for id in p.request_ids{state.id_bytes+=id.len();state.seen.insert(id);}
        state.id_bytes+=receipt.key.len();state.seen_keys.insert(receipt.key.clone());
        state.offset=receipt.completed;state.history.push_back(receipt.clone());while state.history.len()>HISTORY{state.history.pop_front();}
        state.phase=Phase::Ready(p.index);Ok(Self::ack_reply(&run,&state,if state.offset==run.total{"complete"}else{"ready"}))
    }
    fn ack_reply(run:&Run,state:&RunState,status:&str)->AckParentSessionReply{
        AckParentSessionReply{session_id:run.id.clone(),source_fingerprint:run.source.fingerprint.clone(),revision:run.source.revision.clone(),
            completed:state.offset,total:run.total,state:status.into(),prefix:run.reserved.lock().unwrap().clone()}
    }
    pub fn close(&self,input:CloseParentSessionRequest,now:u64)->Result<CloseParentSessionReply,String>{
        version(&input.schema_version)?;self.inner.sweep(now);
        let run={let slots=self.inner.slots.lock().unwrap();
            if let Some(run)=slots.runs.get(&input.session_id){run.clone()}
            else if slots.closed.iter().any(|(id,s)|id==&input.session_id&&s.fingerprint==input.source_fingerprint&&s.revision==input.revision){return Ok(CloseParentSessionReply{session_id:input.session_id,state:"already_released".into()});}
            else{return Err(err("missing","Unknown session/engine incarnation"));}
        };
        if run.source.fingerprint!=input.source_fingerprint||run.source.revision!=input.revision{return Err(err("identity","Close source identity changed"));}
        run.closing.store(true,Ordering::SeqCst);
        let busy=run.state.try_lock().ok().is_none_or(|s|matches!(s.phase,Phase::Computing{..}));
        if !busy{self.inner.remove(&run.id);}
        Ok(CloseParentSessionReply{session_id:run.id.clone(),state:if busy{"draining"}else{"released"}.into()})
    }
    pub fn json(&self,op:ParentSessionOperation,bytes:&[u8],now:u64)->Arc<Vec<u8>>{
        use super::super::assembly::transport;
        let result=(||match op{
            ParentSessionOperation::Begin=>raw_success(&self.begin(transport::parse_parent_session_begin(bytes)?,now)?),
            ParentSessionOperation::Plan=>self.plan(transport::parse_parent_session_plan(bytes)?,now),
            ParentSessionOperation::Ack=>raw_success(&self.ack(transport::parse_parent_session_ack(bytes)?,now)?),
            ParentSessionOperation::Abort|ParentSessionOperation::Release=>raw_success(&self.close(transport::parse_parent_session_close(bytes)?,now)?),
        })();result.unwrap_or_else(fail_reply)
    }
}

#[cfg(test)]
pub(super) struct ComputeTestGate{pub entered:std::sync::Barrier,pub proceed:std::sync::Barrier,pub panic_after:bool}
#[cfg(test)]
impl ParentSessionRuntime{
    pub(super) fn test_gate(&self,id:&str,panic_after:bool)->Arc<ComputeTestGate>{
        let g=Arc::new(ComputeTestGate{entered:std::sync::Barrier::new(2),proceed:std::sync::Barrier::new(2),panic_after});
        *self.inner.gate.lock().unwrap()=Some((id.into(),g.clone()));g
    }
}

#[cfg(test)]
impl ParentSessionRuntime{
    pub(super) fn test_hold_pending_index(&self,id:&str)->Arc<LeafIndex>{
        let run=self.inner.slots.lock().unwrap().runs[id].clone();let state=run.state.lock().unwrap();
        let Phase::Pending(p)=&state.phase else{panic!("pending required")};p.index.clone()
    }
    pub(super) fn test_quota(&self)->ParentPrefixCounts{self.inner.quota.lock().unwrap().clone()}
}
