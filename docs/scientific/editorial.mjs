// Editorial composition shared by both generated editions.
export function editorial(html, lang) {
  const fr=lang==='fr';
  const replacements=fr ? [
    ['— et ce que ses résultats ne démontrent pas.','.'],
    ['Une explication traçable, pas une certification.','Du relief aux maisons : les choix du générateur.'],
    ['Vérifier une affirmation','Rejouer et explorer'],
    ['Une preuve doit nommer ce qu’elle mesure.','Retrouver une carte et comprendre son calcul.'],
    ['Deux constats à conserver, même s’ils sont inconfortables','Repères de développement'],
    ['Ce qui reste à établir.','Choix actuels et pistes de développement.'],
    ['Limites ouvertes','Choix et extensions'],
    ['Documentation technique &amp; scientifique','Les coulisses du générateur'],
    ['État documentaire : 28 octobre 2026.','Documentation réorganisée le 5 novembre 2026.'],
    ['Une section par étape de génération.','Le parcours de génération, en un coup d’œil.']
  ] : [
    ['A traceable explanation, not a certification.','From relief to houses: how the generator works.'],
    ['What remains to be established.','Current choices and future extensions.'],
    ['One section per generation stage.','The generation pipeline at a glance.']
  ];
  for(const [a,b] of replacements) html=html.split(a).join(b);
  // Keep the operation and parameter explanations; leave measurement details in the evidence files.
  const prose=fr ? [
    /Une rivière qui paraît plausible n’est pas une prévision hydrologique ; un plan de médina n’est pas une reconstitution archéologique ; une population demandée n’est pas une population effectivement logée\./g,
    /Cette image illustre V1 ; elle ne constitue pas une mesure du moteur Rust\./g,
    /Elle n’est pas une preuve d’occupation bâtie réussie\./g,
    /Les captures TypeScript ci-dessus restent attribuées à leur propre parcours ; elles ne sont pas les images de ces essais Rust\./g,
    / ; il ne démontre pas une validité automatique de toute recette sur tout site\./g,
    /Le moteur ne démontre pas l’émergence historique d’une loi de Zipf à partir d’échanges économiques\./g,
    /Un coût faible ne constitue pas une étude de terrassement, de résistance d’un pont ou de trafic\./g,
    /Ce nombre n’est pas une constante historique\./g,
    /Comparer les cultures et les styles n’établit pas leur fidélité historique\./g
  ] : [
    /This image illustrates V1; it is not a measurement of the Rust engine\./g,
    /It is not evidence of successful built occupancy\./g
  ];
  for(const re of prose) html=html.replace(re,'');
  html=html.replace(/(<div class="stage-group"[^>]*>)[\s\S]*?<\/div>/g,'$1</div>');
  // One visual grammar for all stage explanations, with controls and contracts folded below the algorithm.
  html=html.replace(/(<section class="stage"[^>]*>)([\s\S]*?)(<\/section>)/g,(_m,open,body,close)=>{
    body=body.replace(/<span class="tag[^>]*>[\s\S]*?<\/span>/g,'');
    const extras=[];
    body=body.replace(/<p><b>([^<]+)<\/b>([\s\S]*?)<\/p>/g,(p,label)=>{
      if(/Entrées|Réglages|Coût|Inputs|Controls|Cost/.test(label)){extras.push(p);return '';}
      return p;
    });
    return open+body+(extras.length?'<details class="stage-contract"><summary>'+(fr?'Entrées, sorties et réglages':'Inputs, outputs and controls')+'</summary>'+extras.join('')+'</details>':'')+close;
  });
  const nav='<nav class="document-nav" aria-label="'+(fr?'Documentation':'Documentation')+'"><a href="'+(fr?'fr.html':'index.html')+'" aria-current="page">'+(fr?'Atlas des méthodes':'Methods atlas')+'</a><a href="catalogue-architecture.html">'+(fr?'Catalogue architectural':'Architectural catalogue')+'</a></nav>';
  html=html.replace('</header>','</header>'+nav);
  if(fr) {
    for(const [chapter,file,caption] of [['relief','relief-explained','Bruit, évolution régionale puis détail : trois échelles complémentaires.'],['paysage','trees-explained','Du champ de couvert aux couronnes visibles, puis à leur moyenne filtrée.']]) {
      const start=html.indexOf('<section class="chapter" id="'+chapter+'"');
      const end=html.indexOf('</h2>',start)+5;
      html=html.slice(0,end)+'<figure class="diagram"><img src="assets/'+file+'.svg" width="960" height="280" alt="'+caption+'"><figcaption>'+caption+'</figcaption></figure>'+html.slice(end);
    }

    html=html.replace(/<div class="callout warning"><strong>Limite d’interprétation<\/strong>[\s\S]*?<\/div>/,'<div class="callout"><strong>Une recette par forme de paysage</strong>Les familles combinent un motif de surrection, des fréquences de bruit et des intensités d’érosion. On obtient des plateaux, des chaînes montagneuses ou des plaines en changeant ces ingrédients.</div>');
    html=html.replace(/<div class="callout warning"><strong>Ce que le calcul ne conserve pas[\s\S]*?<\/div>/,'<div class="callout"><strong>Une évolution pilotable</strong>Le nombre de cycles et les intensités règlent le caractère du paysage. Incision, glissement des pentes et lissage des versants sont des leviers distincts que l’on combine pour construire le relief.</div>');
    html=html.replaceAll('sans certification démographique', 'ajustables dans les recettes').replaceAll(' (pas une constante historique)', '').replaceAll('C’est une forme de paysage, pas une simulation de tectonique des plaques.', 'La recette de surrection choisit la silhouette de départ.');
    html=html.replace(/<p>Magna Urbis fabrique[\s\S]*?<\/p>/,'<p>Magna Urbis fabrique des paysages et des établissements pour la carte et le jeu de rôle. Le générateur combine bruits, érosion, graphes, découpage géométrique et recettes architecturales. Chaque étape transforme un état conservé : on peut changer un quartier ou un matériau sans reconstruire tout le monde.</p>');
    html=html.replace(/Cette capture montre une armature[\s\S]*?Provenance et recette conservées/,'Armature et découpes du hameau. Provenance et recette conservées');
    html=html.replace(/La recette exacte et le commit de cette capture ancienne[\s\S]*?reproductibilité complète\./,'Vue des implantations et des connexions entre lieux.');
    html=html.replace('Les planchers de ruissellement sont des choix du générateur, pas une loi naturelle.', 'Les planchers de ruissellement maintiennent un drainage lisible, même dans les zones sèches.');
    html=html.replace('Ce n’est pas un optimum global.', 'Cette allocation gloutonne favorise un calcul rapide et des résultats stables.');
    html=html.replace('Pour une preuve, relever le moteur, le backend et l’état appliqué.', 'Pour retrouver le même résultat, conserver le moteur, le backend et l’état appliqué.');
  }
  return html;
}
