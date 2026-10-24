//! Autonomous synthetic controls; the real64 context is separate below.
use super::*;
use crate::plans::assembly::builder::{FrontageSelectionMode,retained_public_front};
fn wrong(a:&ArchitectureAccess)->ArchitectureAccess{let mut a=a.clone();for p in &mut a.segment{p.x+=10000.;p.y+=10000.;}a}
fn payload(d:&AssemblyDecision)->Vec<u8>{match d{AssemblyDecision::Retained{building,..}=>serde_json::to_vec(building).unwrap(),AssemblyDecision::Assembled{archive,..}=>serde_json::to_vec(archive).unwrap()}}
fn report(d:&AssemblyDecision)->&AssemblyAttemptReport{match d{AssemblyDecision::Retained{report,..}|AssemblyDecision::Assembled{report,..}=>report}}
fn budgets(r:&AssemblyAttemptReport){assert!(r.incumbent_preparations<=1&&r.incumbent_admissions<=1&&r.incumbent_connector_evaluations<=2);assert!(r.necessary_checks<=8&&r.new_body_rebuilds<=1&&r.new_native_preparations<=1&&r.new_admissions<=4);assert_eq!(r.source_resolutions,0);}
fn decision(input:AssemblePairRequest,enabled:bool)->AssemblyDecision{let _mode=FrontageSelectionMode::new(enabled);let d=assemble_pair(input).unwrap();budgets(report(&d));d}
fn retained(d:&AssemblyDecision,bytes:&[u8]){let AssemblyDecision::Retained{building,report}=d else{panic!("control must keep whole incumbent")};assert_eq!(serde_json::to_vec(building).unwrap(),bytes);assert_eq!((report.necessary_checks,report.new_body_rebuilds,report.new_native_preparations,report.new_admissions),(0,0,0,0));}
fn duplicated()->AssemblePairRequest{let mut x=synthetic_input();let first=x.site.accesses[0].clone();x.site.accesses.push(wrong(&first));x}
#[test]fn frontage_selection_first_already_good_archive_byte_exact(){
 let before=decision(duplicated(),false);let after=decision(duplicated(),true);
 assert!(matches!(before,AssemblyDecision::Assembled{..}));assert_eq!(payload(&before),payload(&after));
 assert_eq!(report(&before).incumbent_connector_evaluations,2);assert_eq!(report(&after).incumbent_connector_evaluations,2);
}
#[test]fn frontage_selection_wrong_first_unique_actual_native_group(){
 let mut x=synthetic_input();let good=x.site.accesses[0].clone();x.site.accesses.insert(0,wrong(&good));let before=decision(x.clone(),false);let after=decision(x,true);
 assert!(report(&before).reason.contains("different declared frontage segment"));
 let AssemblyDecision::Assembled{assembly,..}=after else{panic!("unique real contact should reopen original synthetic group")};assert_eq!(serde_json::to_vec(&assembly.circulation.public_access).unwrap(),serde_json::to_vec(&good).unwrap());
}
#[test]fn frontage_selection_ambiguous_contact_retains_whole_without_member_work(){
 let mut x=synthetic_input();let good=x.site.accesses[0].clone();x.site.accesses=vec![wrong(&good),good.clone(),good];let old=serde_json::to_vec(&x.incumbent).unwrap();let after=decision(x,true);retained(&after,&old);assert!(report(&after).reason.contains("ambiguous public segments"));assert_eq!(report(&after).incumbent_admissions,0);
}
#[test]fn frontage_selection_changed_retained_path_refuses_without_repair(){
 let mut x=synthetic_input();let good=x.site.accesses[0].clone();x.site.accesses.insert(0,wrong(&good));x.incumbent.circulation=vec![];let old=serde_json::to_vec(&x.incumbent).unwrap();let after=decision(x,true);retained(&after,&old);assert!(report(&after).reason.contains("not the retained branch"));
}
#[test]fn frontage_selection_source_identity_altered_zero_work(){
 let mut x=duplicated();x.site.seed.push_str("-not-the-retained-source");let old=serde_json::to_vec(&x.incumbent).unwrap();let after=decision(x,true);retained(&after,&old);assert_eq!(report(&after).incumbent_preparations,0);assert_eq!(report(&after).incumbent_connector_evaluations,0);
}
#[test]fn frontage_selection_public_id_absent_retains_whole(){
 let mut x=synthetic_input();x.site.accesses[0].id.push_str("-different-public-id");let old=serde_json::to_vec(&x.incumbent).unwrap();let after=decision(x,true);retained(&after,&old);assert_eq!(report(&after).incumbent_connector_evaluations,0);
}
#[test]fn frontage_selection_single_target_control_keeps_old_byte_exact(){
 // Represents the unchanged one-public-target branch; not proof that all135
 // real single-target failures have the same geometric cause.
 let mut x=synthetic_input();let only=wrong(&x.site.accesses[0]);x.site.accesses=vec![only];let before=decision(x.clone(),false);let after=decision(x,true);assert_eq!(payload(&before),payload(&after));assert_eq!(report(&before).reason,report(&after).reason);assert_eq!(report(&before).incumbent_connector_evaluations,report(&after).incumbent_connector_evaluations);
}
#[test]fn frontage_selection_exact_path_and_portal_evidence_required_for_different_segment(){
 let x=synthetic_input();let good=x.site.accesses[0].clone();let wrong=wrong(&good);let mut r=x.site.clone();r.accesses=vec![wrong.clone(),good.clone()];let contact=point((good.segment[0].x+good.segment[1].x)*0.5,(good.segment[0].y+good.segment[1].y)*0.5);
 assert!(retained_public_front(&r,&x.incumbent,&r.accesses[0],x.incumbent.entrance,&good.id,&x.incumbent.circulation,contact).is_ok());
 let altered=point(x.incumbent.entrance.x+1.,x.incumbent.entrance.y);
 assert!(retained_public_front(&r,&x.incumbent,&r.accesses[0],altered,&good.id,&x.incumbent.circulation,contact).unwrap_err().contains("exact path/portal"));
}
