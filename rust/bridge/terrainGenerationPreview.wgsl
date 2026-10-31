// Inspector-only readout. It never modifies simulation heights or drainage.
@compute @workgroup_size(256)
fn generationPreview(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=1048576u){return;}let mode=p.values[7].w;
  if(mode==1.0){outputHeight[i]=fine[i].x;}
  else if(mode==2.0){outputHeight[i]=fine[i].w;}
  // Show the calibrated height now, without changing fine.x read by detail's gradients.
  else if(mode==4.0){outputHeight[i]=max(.3,fine[i].x*p.values[3].x*(1.-.2*p.values[4].z)/control.p99);}
  else if(mode==5.0){outputHeight[i]=fine[i].x*p.values[3].x*(1.-.2*p.values[4].z)/control.p99;}
  else{let xy=(vec2<f32>(f32(i%1024u),f32(i/1024u))+.5)*p.values[2].w;outputHeight[i]=sample((xy-p.values[1].y)/p.values[1].x-.5,false);}
}

@compute @workgroup_size(256)
fn generationPlainPack(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<1048576u){outputHeight[id.x]=fine[id.x].x;}}

// Preserve the other simulation channels when applying an early coast.
@compute @workgroup_size(256)
fn generationRegionalRead(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<count()){outputHeight[id.x]=nodes[id.x].h;}}
@compute @workgroup_size(256)
fn generationCut(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;let mode=p.values[7].w;
  if(mode==0.0){if(i<count()){nodes[i].h=outputHeight[i];}return;}
  if(i>=1048576u){return;}
  if(mode==4.0){fine[i].x=outputHeight[i]*control.p99/max(.0001,p.values[3].x*(1.-.2*p.values[4].z));}
  else if(mode==2.0){fine[i].w=outputHeight[i];}
  else{fine[i].x=outputHeight[i];}
}
@compute @workgroup_size(256)
fn generationPhasorPack(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<1048576u){outputHeight[id.x]=compactPhasor(id.x);}}

@compute @workgroup_size(1)
fn generationUnitScale(){control.p99=max(.0001,p.values[3].x*(1.0-.2*p.values[4].z));}
@compute @workgroup_size(256)
fn generationKeepDatum(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<1048576u){fine[id.x].x=max(.3,fine[id.x].w);}}
@compute @workgroup_size(256)
fn generationReconstruct(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=1048576u){return;}let xy=(vec2<f32>(f32(i%1024u),f32(i/1024u))+.5)*p.values[2].w;
 let pos=(compactReconstructionPoint(xy)-p.values[1].y)/p.values[1].x-.5;
 var h=0.;if(p.values[7].w==1.0){h=compactRegional(pos);}else{h=sample(pos,false);}
 var r=0.;if(p.values[4].x>0.){r=ridge(xy/p.values[2].y,u32(p.values[2].z));}
 let drainage=sample((xy-p.values[1].y)/p.values[1].x-.5,true);
 fine[i]=vec4<f32>(h,1.-.85*p.values[4].z*smooth01((drainage-4.)/max(12.,f32(count())*.001-4.)),r,0.);
}
