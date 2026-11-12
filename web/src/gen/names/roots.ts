import authored from './data/cultural-roots.json';
import type { Rng } from '../core/rng';
import type { ToponymProfile } from './profiles';
import type { ToponymKind } from './toponyms';

type RootKind = 'habitation' | 'river' | 'lake' | 'sea' | 'forest' | 'hill' | 'region' | 'farm';
interface RootForm { suffixes: string[]; culturalTemplate?: string }
interface RootGrammar { onsets: string[]; vowels: string[]; codas: string[]; syllables: number[]; roots: Record<RootKind, RootForm> }
const grammars: Record<string, RootGrammar> = authored.profiles;
const SETTLEMENT_KINDS = new Set<ToponymKind>(['place','town','city','village','hamlet']);

/** Small authored palettes can also name standalone render scenes without loading the geographic corpus. */
export function authoredProper(profile:ToponymProfile,kind:ToponymKind,rng:Rng):{proper:string;template?:string} {
  const grammar=grammars[profile.rootGrammar];
  if(!grammar)throw new Error(`Missing authored root grammar: ${profile.rootGrammar}`);
  const rootKind:RootKind=SETTLEMENT_KINDS.has(kind)?'habitation':kind as RootKind;
  const form=grammar.roots[rootKind],count=rng.fork('syllable-count').pick(grammar.syllables);
  let stem='';
  for(let i=0;i<count;i++){const r=rng.fork(`syllable:${i}`);stem+=r.pick(grammar.onsets)+r.pick(grammar.vowels)+r.pick(grammar.codas);}
  const ending=rng.fork(`typed-root:${rootKind}`).pick(form.suffixes);
  const proper=(stem+(stem.endsWith(ending[0])?ending.slice(1):ending)).normalize('NFC');
  return {proper:proper[0].toUpperCase()+proper.slice(1),template:form.culturalTemplate};
}
