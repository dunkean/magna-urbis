from pathlib import Path
import json,re,html,math,random,hashlib
from collections import defaultdict
from catalogue_render import building
ROOT=Path(__file__).resolve().parents[2]
D=ROOT/'docs/scientific'; A=D/'assets/architecture'; A.mkdir(exist_ok=True)
esc=lambda s:html.escape(str(s))
source=ROOT/'rust/crates/core/src/urban/catalogue.json'
j=json.loads(source.read_text(encoding='utf-8'))
rust=(ROOT/'rust/crates/core/src/urban/culture.rs').read_text(encoding='utf-8')
mapping_rows=re.findall(r'\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(true|false)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,?\s*\)',rust.split('const MAPPINGS:')[1].split('];')[0])
mappings={r[0]:r for r in mapping_rows}
preferred=dict(re.findall(r'\("([^"]+)", "([^"]+)"\)',rust.split('const PREFERRED:')[1].split('];')[0]))
houses=json.loads((ROOT/'rust/crates/houses/data/recipes.json').read_text(encoding='utf-8'))
house_by_id={r['id']:r for r in houses['recipes']}
reference=(ROOT/'docs/styles_architecturaux_mondiaux_city_mapper_FR.md').read_text(encoding='utf-8')
source_descriptions={}
for line in reference.splitlines():
 match=re.search(r'`([A-Z]+-[A-Z]+-B[0-9]+)`',line)
 if match and line.startswith('|'):
  cells=[re.sub(r'[*`]', '',v.strip()) for v in line.strip('|').split('|')]
  if len(cells)>=5:source_descriptions[match[1]]=' ; '.join(cells[2:])
source_labels=dict(re.findall(r'`([A-Z]+-[A-Z]+-B[0-9]+)`[^|]*?\*\*([^*]+)\*\*',reference))
for r in houses['recipes']:
 if r['id'] in source_labels:r['label']=source_labels[r['id']]
def native_examples(cid):
 row=mappings[cid];pack=row[2];family=row[5]
 candidates=[r for r in houses['recipes'] if r['pack_id']==pack and r['role'] in ['dwelling','mixed_residential','communal_dwelling','residential_ensemble']]
 allowed={'frontage':['strip'],'courtyard':['courtyard','siheyuan','atrium','peristyle','iwan_court'],'platform':['platform'],'compound':['hut_compound','kancha','multiyard','kraal']}.get(family,[])
 ranked=sorted(candidates,key=lambda r:(r['id']!=preferred.get(cid),bool(allowed) and r['parameters']['layout'] not in allowed,r['priority'],r['id']))
 return ranked
native={cid:native_examples(cid) for cid in j['cultures']}
shared=defaultdict(list)
for cid,rs in native.items():shared[rs[0]['id']].append(cid)
assert len(mappings)==len(j['cultures'])==len(native)
def fmt(v,unit=''):
 if isinstance(v,list):return '–'.join(str(x) for x in v)+unit
 return str(v)+unit
labels={'organic':'Organique','grid':'Grille','radial':'Radial','linear':'Linéaire','terraces':'Terrasses','dispersed':'Dispersé'}
def plate(cid,c,p,native_recipe):
 rng=random.Random(cid); pattern=c['plan']['pattern']; arch=p.get('arch',{}); roof=arch.get('roof','gable')
 z=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" role="img">',f'<title>{esc(c["label"])} : plan {esc(pattern)}, bâti {esc(arch.get("typology",""))}, toit {esc(roof)}</title>', '<rect width="640" height="300" rx="12" fill="#eef0e6"/><path d="M330 25V270" stroke="#c4cec1"/><g stroke="#9b8c72" fill="none" stroke-width="9" stroke-linecap="round">']
 if pattern=='grid':
  for v in [70,130,190,250]: z += [f'<path d="M{v} 40V245M35 {v}H300"/>']
 elif pattern=='radial':
  z+=['<circle cx="165" cy="145" r="64"/>']
  for a in range(0,360,45):
   x=165+125*math.cos(math.radians(a)); y=145+110*math.sin(math.radians(a)); z+=[f'<path d="M165 145L{x} {y}"/>']
 elif pattern in ['linear','terraces']:
  for v in ([130] if pattern=='linear' else [75,140,205]): z+=[f'<path d="M30 {v} Q140 {v-35} 300 {v+12}"/>']
 else:
  z+=['<path d="M30 170Q90 90 170 145T300 110M75 245Q140 180 170 145T225 35"/>']
 z+=['</g><g fill="#bd7651" stroke="#76553f" stroke-width="1.2">']
 density=p.get('density',{}).get('core',120)
 count=max(12,min(65,round(density/5)))
 for i in range(count):
  x=rng.uniform(38,285); y=rng.uniform(45,235)
  if pattern=='grid': x=46+(i%6)*40; y=48+(i//6)*18
  elif pattern=='radial':
   a=i*2.4; r=42+(i%4)*21; x=165+r*math.cos(a); y=145+r*math.sin(a)
  elif pattern=='linear': y=90 if i%2 else 175
  front=p.get('frontage',{}).get('core',[8,12]); depth=p.get('plotDepth',{}).get('core',[14,24])
  w=max(6,min(20,sum(front)/2)); h=max(6,min(24,sum(depth)/4))
  z+=[f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="1" transform="rotate({0 if pattern=="grid" else rng.randrange(-20,21)} {x:.1f} {y:.1f})"/>']
 z+=['</g>']
 enclosure=c['plan'].get('enclosure','none')
 if enclosure in ['rect','square']:z+=['<rect x="23" y="39" width="285" height="210" rx="7" fill="none" stroke="#747d68" stroke-width="3"/>']
 elif enclosure not in ['none','open','']:z+=['<ellipse cx="165" cy="145" rx="143" ry="105" fill="none" stroke="#747d68" stroke-width="3"/>']
 z+=['<rect x="154" y="134" width="23" height="22" fill="#e7d39b" stroke="#9c7d47"/>',building(native_recipe),f'<text x="24" y="278" font-family="system-ui" font-size="11" fill="#304c41">TRAME · {esc(labels[pattern])}</text></svg>']
 return ''.join(z)
intro='Le catalogue suit les cultures proposées par le moteur. Chaque culture combine un plan, des recettes de quartiers et des paramètres architecturaux. Les planches sont des schémas de lecture : à gauche le principe de trame, à droite une maison du pack natif avec ses proportions, niveaux et toiture. Plusieurs cultures peuvent partager un pack de maisons tout en ayant des trames, lots et densités différents. Les réglages chiffrés proviennent du catalogue du projet.'
cards=[]; md=['# Catalogue architectural — 79 cultures','',intro,'','[Atlas des méthodes](scientific/fr.html) · [Catalogue illustré](scientific/catalogue-architecture.html)','','Source : `rust/crates/core/src/urban/catalogue.json`.','']
for cid,c in j['cultures'].items():
 recipes=c.get('recipes',[]); recipe=next((r for r in recipes if r.get('id')=='core'),recipes[0] if recipes else {})
 p=j['presets'].get(recipe.get('preset'),{}).get('params',{}); arch=p.get('arch',{}); pack=mappings[cid][2]; nr=native[cid][0]; np=nr['parameters']
 svg=plate(cid,c,p,nr); (A/(cid+'.svg')).write_text(svg,encoding='utf-8')
 rows=[('Plan',labels[c['plan']['pattern']]),('Maison illustrée',nr['label']),('Recette native',nr['id']),('Agencement',np['layout']),('Toiture native',np['roof_system']),('Structure',np['structure_system']),('Étages',fmt(np['floors'])),('Dimensions',fmt(np['width_m'],' m')+' × '+fmt(np['depth_m'],' m')),('Famille architecturale',pack),('Parcellaire',p.get('plotOp','—')),('Bâti urbain',p.get('buildingOp','—')),('Matériau porteur',np['materials'].get('frame','—')),('Remplissage',np['materials'].get('infill','—')),('Couverture',np['materials'].get('cladding','—'))]
 plan=c['plan']; nucleus=c.get('nucleus',{})
 identity=f"Le plan {labels[plan['pattern']].lower()} s’organise autour du noyau « {nucleus.get('kind','—')} », de forme {nucleus.get('shape','—')}. Enceinte : {plan.get('enclosure','—')} ; fortification : {plan.get('fortification','—')} ; orientation : {plan.get('orientation','—')}."
 if plan.get('waterfront'):identity+=' Le front d’eau participe à la composition.'
 if plan.get('stairs'):identity+=' Les escaliers accompagnent les différences de niveau.'
 peers=[other for other in shared[nr['id']] if other!=cid]
 sharing=''
 if peers:sharing='<p class="shared-recipe">Même exemple de maison que '+', '.join('<a href="#'+other+'">'+esc(j['cultures'][other]['label'])+'</a>' for other in peers)+'. Les paramètres urbains de la fiche précisent la composition propre à cette culture.</p>'
 columns=['Recette · zone','Densité (hab./ha)','Façade (m)','Profondeur (m)','Couverture']
 urban_rows=[]
 for r in recipes:
  q=j['presets'][r['preset']]['params']
  zone=r.get('zone','core')
  vals=[r['id']+' · '+zone,q.get('density',{}).get(zone,'—'),q.get('frontage',{}).get(zone,'—'),q.get('plotDepth',{}).get(zone,'—'),q.get('coverage',{}).get(zone,'—')]
  urban_rows.append('<tr>'+''.join('<td>'+esc(fmt(v))+'</td>' for v in vals)+'</tr>')
 urban_table='<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+col+'</th>' for col in columns)+'</tr></thead><tbody>'+''.join(urban_rows)+'</tbody></table></div>'
 traits=source_descriptions.get(nr['id'],', '.join(np.get('details',[])))
 native_list='<ul>'+''.join('<li><b>'+esc(r['id'])+' — '+esc(r['label'])+'</b> : '+esc(r['parameters']['layout'])+', '+esc(r['parameters']['roof_system'])+', '+esc(fmt(r['parameters']['floors']))+' niveaux.</li>' for r in native[cid][:4])+'</ul>'
 priority='<p><b>Recette prioritaire déclarée :</b> '+esc(preferred[cid])+'.</p>' if cid in preferred else '<p>La maison illustrée est un exemple du pack ; le placement choisit sa recette selon le programme, la période et la place disponible.</p>'
 details='<div class="culture-description"><p>'+esc(identity)+'</p>'+priority+'<p><b>Détails de la maison :</b> '+esc(traits or np['structure_system'])+'.</p></div>'
 details+='<details><summary>Recettes et dimensions urbaines</summary>'+urban_table+'<p>Phases par seuil de population : '+esc(str(c.get('phaseCount',[])))+'. Part de faubourgs : '+esc(str(c.get('faubShare',[])))+'.</p></details>'
 details+='<details><summary>Exemples de maisons du pack '+pack+'</summary>'+native_list+'<p><a href="https://github.com/dunkean/magna-urbis/blob/main/rust/crates/houses/data/recipes.json">Recettes natives : composants, dimensions, variantes et matériaux</a></p></details>'+sharing
 defs=''.join(f'<div><dt>{esc(k)}</dt><dd>{esc(v)}</dd></div>' for k,v in rows)
 rec=', '.join(esc(r['preset']) for r in recipes)
 cards.append(f'<article class="culture-card" id="{cid}"><p class="eyebrow">{esc(cid)}</p><h2>{esc(c["label"])}</h2><figure><img src="assets/architecture/{cid}.svg" alt="Plan de principe et volume : {esc(c["label"])}" loading="lazy" width="640" height="300"><figcaption>Trame urbaine et schéma de la recette native {esc(nr["id"])}. Dimensions moyennes des plages de la recette.</figcaption></figure><dl class="catalogue-facts">{defs}</dl>{details}<p class="sources"><a href="fr.html#ville">Construction des villes</a> · <a href="fr.html#maisons">Architecture</a> · <a href="https://github.com/dunkean/magna-urbis/blob/main/rust/crates/core/src/urban/catalogue.json">Paramètres du catalogue</a></p></article>')
 md += ['## '+c['label']+' (`'+cid+'`)','',f'![Plan et volume](scientific/assets/architecture/{cid}.svg)','', ' · '.join(k+' : '+str(v) for k,v in rows),'', identity, '', 'Détails : '+traits, '', 'Recettes : '+', '.join(r['preset'] for r in recipes), '']
head='''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>79 cultures · Catalogue architectural · Magna Urbis</title><link rel="stylesheet" href="styles.css"></head><body><header class="masthead"><a href="fr.html">Magna Urbis / Documentation</a><nav class="document-nav"><a href="fr.html">Atlas des méthodes</a><a href="catalogue-architecture.html" aria-current="page">Catalogue architectural</a></nav></header><main class="catalogue-main"><div class="hero"><p class="eyebrow">Plans · bâtiments · matériaux</p><h1>79 cultures à construire.</h1><p class="lead">'''+intro+'''</p><p><a href="https://github.com/dunkean/magna-urbis/blob/main/docs/styles_architecturaux_mondiaux_city_mapper_FR.md">Référentiel des 32 familles régionales</a> · <a href="fr.html#sites">Placement des établissements</a></p><label for="culture-search">Chercher une culture, un toit, un matériau</label><input class="search" id="culture-search" type="search" placeholder="Bastide, roman, flat, wood…"><p id="culture-count">79 cultures</p></div><div class="culture-grid">'''
script='''</div></main><script>const input=document.querySelector('#culture-search');input.addEventListener('input',()=>{let n=0;for(const card of document.querySelectorAll('.culture-card')){card.hidden=!card.textContent.toLowerCase().includes(input.value.toLowerCase());if(!card.hidden)n++;}document.querySelector('#culture-count').textContent=n+' cultures';});</script></body></html>'''
references='<section class="reference-links"><h2>Photographies de référence</h2><p>Observer les enceintes, les trames et les volumes dans des villes réelles :</p><ul><li><a href="https://commons.wikimedia.org/wiki/File:1_carcassonne_aerial_2016_(cropped).jpg">Carcassonne — vue aérienne, Chensiyuan</a></li><li><a href="https://commons.wikimedia.org/wiki/File:1_pingyao_ancient_city_aerial_pano_2019.jpg">Pingyao — panorama aérien, Chensiyuan</a></li><li><a href="https://commons.wikimedia.org/wiki/File:Old_Walled_City_of_Shibam-109039.jpg">Shibam — maisons-tours, collection UNESCO</a></li></ul></section>'
script=script.replace('</main>',references+'</main>')
(D/'catalogue-architecture.html').write_text(head+'\n'.join(cards)+script,encoding='utf-8')
(ROOT/'docs/CATALOGUE_ARCHITECTURE_FR.md').write_text('\n'.join(md),encoding='utf-8')
print(f'Generated {len(cards)} cultures and illustrations; catalogue SHA-256 {hashlib.sha256(source.read_bytes()).hexdigest()}')
