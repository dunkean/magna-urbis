/** Syntax/binding-only translation of the original WebGL Render programs.
 * node --import tsx scripts/export_render_original_shaders.ts --reference-root PATH
 * No shader maths, orientation, material policy or source texture is changed. */
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';

type Stage='vertex'|'fragment';
export interface OriginalProgram {vertex:string;fragment:string}
interface Span {start:number;end:number}
interface Declaration {name:string;type:string;count:number;array:boolean;stages:Stage[]}
interface InterfaceDeclaration extends Declaration,Span {direction:'in'|'out';qualifier:string;location?:number}
export interface UniformLayout extends Declaration {offset:number;stride:number;byteLength:number;alignment:number;matrixStride?:number}
interface SamplerLayout extends Declaration {binding:number}
export interface ProgramLayout {
  vertex:string;fragment:string;uniformByteLength:number;uniforms:UniformLayout[];
  samplers:SamplerLayout[];buffers:Array<{name:string;binding:number;type:'storage';strideBytes:number;scalarsPerInstance:number;scalarType:'float';stages:Stage[]}>;
  attributes:Array<{name:string;type:string;location:number}>;
  varyings:Array<{name:string;type:string;count:number;location:number;qualifier:string}>;
  stages:Record<Stage,{originalSha256:string;translatedSha256:string;mathFunctionsSha256:string;functionCount:number}>;
}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const normalise=(s:string)=>s.replace(/\r\n/g,'\n');
const round=(v:number,a:number)=>Math.ceil(v/a)*a;
function maskComments(source:string):string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g,s=>s.replace(/[^\n\r]/g,' '));
}
function depths(source:string):{code:string;brace:Uint16Array;paren:Uint16Array} {
  const code=maskComments(source),brace=new Uint16Array(code.length),paren=new Uint16Array(code.length);let b=0,p=0;
  for(let i=0;i<code.length;i++){brace[i]=b;paren[i]=p;if(code[i]==='{')b++;if(code[i]==='}')b--;if(code[i]==='(')p++;if(code[i]===')')p--;if(b<0||p<0)throw Error('Unbalanced GLSL source');}
  if(b||p)throw Error('Unbalanced GLSL source');return{code,brace,paren};
}
function applyEdits(source:string,edits:Array<Span&{text:string}>):string {
  const sorted=[...edits].sort((a,b)=>b.start-a.start);let previous=source.length;
  for(const e of sorted){if(e.end>previous)throw Error('Overlapping shader syntax edits');source=source.slice(0,e.start)+e.text+source.slice(e.end);previous=e.start;}
  return source;
}
function names(type:string,body:string,stage:Stage):Declaration[] {
  return body.split(',').map(value=>{
    const m=value.trim().match(/^([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?$/);
    if(!m)throw Error(`Unsupported GLSL declaration: ${type} ${value}`);
    const count=m[2]===undefined?1:Number(m[2]);if(count<1||count>65536)throw Error('Invalid GLSL array count');
    return{name:m[1],type,count,array:m[2]!==undefined,stages:[stage]};
  });
}
function uniforms(source:string,stage:Stage):{declarations:Declaration[];spans:Span[]} {
  const {code,brace,paren}=depths(source),declarations:Declaration[]=[],spans:Span[]=[];
  const pattern=/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([^;]+);/g;
  for(const m of code.matchAll(pattern)){const start=m.index!;if(brace[start]||paren[start])continue;declarations.push(...names(m[1],m[2],stage));spans.push({start,end:start+m[0].length});}
  return{declarations,spans};
}
function interfaces(source:string,stage:Stage):InterfaceDeclaration[] {
  const {code,brace,paren}=depths(source),result:InterfaceDeclaration[]=[];
  const pattern=/(?:layout\s*\([^)]*\)\s*)?((?:(?:flat|smooth|noperspective|centroid|sample|invariant)\s+)*)(in|out)\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([^;]+);/g;
  for(const m of code.matchAll(pattern)){
    const start=m.index!;if(brace[start]||paren[start])continue;
    const declarations=names(m[3],m[4],stage);if(declarations.length!==1)throw Error('Multiple names in stage interface require explicit handling');
    const explicit=m[0].match(/location\s*=\s*(\d+)/);
    result.push({...declarations[0],start,end:start+m[0].length,direction:m[2] as 'in'|'out',qualifier:m[1].trim(),location:explicit?Number(explicit[1]):undefined});
  }
  return result;
}
export function std140(type:string,count=1,array=false):{alignment:number;stride:number;byteLength:number;matrixStride?:number} {
  let alignment:number,size:number,matrixStride:number|undefined;
  if(/^(float|int|uint|bool)$/.test(type)){alignment=4;size=4;}
  else {
    const vector=type.match(/^[biu]?vec([234])$/),matrix=type.match(/^mat([234])(?:x([234]))?$/);
    if(vector){const n=Number(vector[1]);alignment=n===2?8:16;size=n*4;}
    else if(matrix){alignment=16;matrixStride=16;size=Number(matrix[1])*matrixStride;}
    else throw Error(`Unsupported std140 uniform type: ${type}`);
  }
  if(array){alignment=round(alignment,16);const stride=round(size,16);return{alignment,stride,byteLength:stride*count,...(matrixStride?{matrixStride}:{})};}
  return{alignment,stride:size,byteLength:size,...(matrixStride?{matrixStride}:{})};
}
function locationSlots(d:Declaration):number {return Number(d.type.match(/^mat([234])/)?.[1]??1)*d.count;}
function unionDeclarations(groups:Declaration[][]):Declaration[] {
  const result:Declaration[]=[];
  for(const group of groups)for(const d of group){
    const previous=result.find(p=>p.name===d.name);
    if(previous){if(previous.type!==d.type||previous.count!==d.count||previous.array!==d.array)throw Error(`Conflicting uniform ${d.name}`);for(const s of d.stages)if(!previous.stages.includes(s))previous.stages.push(s);}
    else result.push({...d,stages:[...d.stages]});
  }
  return result;
}
function functionBodies(source:string):string[] {
  const {code,brace,paren}=depths(source),result:string[]=[];
  const pattern=/\b[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/g;
  for(const m of code.matchAll(pattern)){
    const start=m.index!;if(brace[start]||paren[start])continue;
    const open=start+m[0].lastIndexOf('{');let end=open+1,depth=1;
    while(end<code.length&&depth){if(code[end]==='{')depth++;if(code[end]==='}')depth--;end++;}
    if(depth)throw Error('Unbalanced shader function');result.push(source.slice(start,end));
  }
  return result;
}
export function convertProgram(name:string,original:OriginalProgram):{layout:ProgramLayout;vertex:string;fragment:string} {
  const source:OriginalProgram={vertex:normalise(original.vertex),fragment:normalise(original.fragment)};
  if(/\buRenderV2\b/.test(source.fragment))throw Error('RenderV2 is not the original Render reference');
  const parsed={vertex:uniforms(source.vertex,'vertex'),fragment:uniforms(source.fragment,'fragment')};
  const all=unionDeclarations([parsed.vertex.declarations,parsed.fragment.declarations]);
  const regular=all.filter(d=>!/^([iu]?sampler)/.test(d.type)),textures=all.filter(d=>/^([iu]?sampler)/.test(d.type));
  let end=0;const uniformLayout=regular.map(d=>{const shape=std140(d.type,d.count,d.array);end=round(end,shape.alignment);const value={...d,...shape,offset:end};end+=shape.byteLength;return value;});
  const samplers=textures.map((d,i)=>({...d,binding:i+1}));
  const io={vertex:interfaces(source.vertex,'vertex'),fragment:interfaces(source.fragment,'fragment')};
  const vertexOut=io.vertex.filter(d=>d.direction==='out'),fragmentIn=io.fragment.filter(d=>d.direction==='in');
  let nextLocation=0;const varyings=vertexOut.map(d=>{
    const other=fragmentIn.find(v=>v.name===d.name);if(!other||other.type!==d.type||other.count!==d.count||other.qualifier!==d.qualifier)throw Error(`Stage varying mismatch: ${d.name}`);
    const location=d.location??other.location??nextLocation;
    if(d.location!==undefined&&other.location!==undefined&&d.location!==other.location)throw Error(`Location mismatch: ${d.name}`);
    nextLocation=Math.max(nextLocation,location+locationSlots(d));return{name:d.name,type:d.type,count:d.count,qualifier:d.qualifier,location};
  });
  if(fragmentIn.some(d=>!vertexOut.some(v=>v.name===d.name)))throw Error('Unmatched fragment input');
  const attributes=io.vertex.filter(d=>d.direction==='in');
  const buffers:ProgramLayout['buffers']=[];let riverInjection='';
  if(name==='river'){
    for(const [i,n,t]of [[0,'aSeg','vec4'],[1,'aWidth','vec2'],[2,'aColor','vec3']]as const){const d=attributes.find(v=>v.name===n);if(!d||d.type!==t||d.location!==i)throw Error('Unexpected original river vertex layout');}
    if(attributes.length!==3)throw Error('Unexpected extra river vertex input');
    buffers.push({name:'RiverInstances',binding:samplers.length+1,type:'storage',strideBytes:36,scalarType:'float',scalarsPerInstance:9,stages:['vertex']});
    riverInjection='\n  int riverOffset = gl_InstanceIndex * 9;\n  vec4 aSeg = vec4(riverData[riverOffset], riverData[riverOffset+1], riverData[riverOffset+2], riverData[riverOffset+3]);\n  vec2 aWidth = vec2(riverData[riverOffset+4], riverData[riverOffset+5]);\n  vec3 aColor = vec3(riverData[riverOffset+6], riverData[riverOffset+7], riverData[riverOffset+8]);\n';
  }else if(attributes.length)throw Error(`Unexpected vertex input in ${name}`);
  const layouts:ProgramLayout={vertex:`${name}.vert.glsl`,fragment:`${name}.frag.glsl`,uniformByteLength:round(end,16),uniforms:uniformLayout,samplers,buffers,attributes:[],varyings,stages:{} as ProgramLayout['stages']};
  const converted={} as OriginalProgram;
  for(const stage of ['vertex','fragment']as const){
    const edits:Array<Span&{text:string}>=parsed[stage].spans.map(span=>({...span,text:''}));
    for(const d of io[stage]){
      if(stage==='vertex'&&d.direction==='in'&&name==='river'){edits.push({...d,text:''});continue;}
      const varying=varyings.find(v=>v.name===d.name);const location=varying?.location??d.location??0;
      edits.push({...d,text:`layout(location = ${location}) ${d.qualifier?d.qualifier+' ':''}${d.direction} ${d.type} ${d.name}${d.array?`[${d.count}]`:''};`});
    }
    let body=applyEdits(source[stage],edits).replace(/^\s*#version\s+300\s+es\s*$/m,'').replace(/\bprecision\s+(?:lowp|mediump|highp)\s+\w+\s*;/g,'').replace(/\bgl_VertexID\b/g,'gl_VertexIndex');
    if(/\buniform\b/.test(maskComments(body)))throw Error(`Unconverted uniform declaration in ${name}/${stage}`);
    if(stage==='vertex'&&riverInjection)body=body.replace(/(void\s+main\s*\(\s*\)\s*\{)/,`$1${riverInjection}`);
    const block=uniformLayout.length?'layout(set = 0, binding = 0, std140) uniform RenderUniforms {\n'+uniformLayout.map(d=>`  layout(offset = ${d.offset}) ${d.type} ${d.name}${d.array?`[${d.count}]`:''};`).join('\n')+'\n};\n':'';
    const samplerText=samplers.filter(d=>d.stages.includes(stage)).map(d=>`layout(set = 0, binding = ${d.binding}) uniform ${d.type} ${d.name}${d.array?`[${d.count}]`:''};`).join('\n');
    const bufferText=buffers.filter(d=>d.stages.includes(stage)).map(d=>`layout(set = 0, binding = ${d.binding}, std430) readonly buffer ${d.name} { float riverData[]; };`).join('\n');
    converted[stage]='#version 450\n// Generated syntax/binding translation; original shader maths and orientation retained.\n'+block+samplerText+'\n'+bufferText+'\n'+body.trimStart();
    const expected=functionBodies(source[stage].replace(/\bgl_VertexID\b/g,'gl_VertexIndex'));
    const actual=functionBodies(converted[stage].replace(riverInjection,''));
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error(`Original function bytes changed in ${name}/${stage}`);
    layouts.stages[stage]={originalSha256:sha(source[stage]),translatedSha256:sha(converted[stage]),mathFunctionsSha256:sha(JSON.stringify(expected)),functionCount:expected.length};
  }
  return{layout:layouts,...converted};
}
export async function exportRenderOriginalShaders(referenceRoot:string,outputRoot:string):Promise<unknown> {
  const modulePath=join(referenceRoot,'web/src/ui/terrainGl.ts');
  const api=await import(pathToFileURL(modulePath).href);
  if(typeof api.renderOriginalShaderSources!=='function')throw Error('Original reference must expose renderOriginalShaderSources()');
  const sources=api.renderOriginalShaderSources() as Record<string,OriginalProgram>;
  const programs:Record<string,ProgramLayout>={};mkdirSync(outputRoot,{recursive:true});
  for(const name of ['terrain','river','composite','renderWater']){
    if(!sources[name]?.vertex||!sources[name]?.fragment)throw Error('Missing original shader program '+name);
    const converted=convertProgram(name,sources[name]);programs[name]=converted.layout;
    writeFileSync(join(outputRoot,converted.layout.vertex),converted.vertex);writeFileSync(join(outputRoot,converted.layout.fragment),converted.fragment);
  }
  const result={format:'magna-render-original-shader-layout',version:1,upstreamOriginalRevision:'f2298841d9fe09729df02f8ecc92e7ffbefa6505',referenceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:referenceRoot,encoding:'utf8'}).trim(),referenceModule:'web/src/ui/terrainGl.ts',referenceExport:'renderOriginalShaderSources',descriptorSet:0,uniformBinding:0,orientation:'Original gl_Position and gl_FragCoord untouched; final display orientation belongs to adapter',programs};
  writeFileSync(join(outputRoot,'shader_layout.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  const{values}=parseArgs({options:{'reference-root':{type:'string'},out:{type:'string'}}});
  if(!values['reference-root'])throw Error('Required --reference-root ORIGINAL_REFERENCE_WORKTREE');
  const result=await exportRenderOriginalShaders(resolve(values['reference-root']),resolve(values.out??'../godot-render/shaders')) as {programs:Record<string,ProgramLayout>};
  console.log(JSON.stringify({programs:Object.fromEntries(Object.entries(result.programs).map(([name,p])=>[name,{uniformByteLength:p.uniformByteLength,uniforms:p.uniforms.length,samplers:p.samplers.length,buffers:p.buffers.length}]))}));
}
