/** Explicit readings only. Unknown scripts stay unchanged rather than receiving an invented reading. */
const letters: Record<string,string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',і:'i',ї:'yi',є:'ye',ґ:'g',
  α:'a',β:'v',γ:'g',δ:'d',ε:'e',ζ:'z',η:'i',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'f',χ:'ch',ψ:'ps',ω:'o',
};
export function latinReading(value:string):string|undefined {
  if(!/[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}\p{Symbol}\s]/u.test(value))return value;
  let result='';
  for(const char of value.normalize('NFD')){
    const lower=char.toLowerCase(),reading=letters[lower];
    if(reading!==undefined)result+=char===lower?reading:reading[0]?.toUpperCase()+(reading.slice(1));
    else if(/[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Mark}\p{Symbol}\s]/u.test(char))result+=char;
    else return;
  }
  return result.normalize('NFC');
}
