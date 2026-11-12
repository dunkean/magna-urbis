import type { NameParts } from './types';
import { resolveToponymProfile } from './profiles';
import { CULTURAL_TERMS, formatToponym, culturalBuildingName } from './syntax';
import { vocabularyForProfile } from './culturalVocabulary';
import { VOCAB } from './grammar';

/** Recompose an author-supplied proper name using the recorded profile, never a search/replace. */
export function renameParts(parts:NameParts,proper:string):NameParts {
  const profile=resolveToponymProfile(parts.profile ?? 'english',parts.profile ?? 'english');
  const v=vocabularyForProfile(profile,VOCAB[profile.family]),t=CULTURAL_TERMS[profile.id];
  let cultural:string;
  if(parts.kind==='town'||parts.kind==='village')cultural=proper;
  else if(parts.kind==='castle')cultural=v.castle(proper);
  else if(parts.kind==='church')cultural=v.worship(proper,parts.generic==='cathedral',parts.role ?? parts.generic);
  else if(parts.kind==='building')cultural=culturalBuildingName(profile,proper);
  else if(parts.kind==='quarter'||parts.kind==='square'){
    const term=parts.kind==='quarter'?t.ward:t.square;
    cultural=t.order==='prefix'?`${term} ${proper}`:`${proper} ${term}`;
  }else if(parts.kind==='bridge')cultural=proper;
  else cultural=formatToponym(profile,parts.kind==='street'&&parts.meaning?.viaGate?'gate-street':parts.kind,proper);
  return {...parts,proper,cultural,opaque:false,meaning:parts.meaning?.viaGate?parts.meaning:undefined};
}
