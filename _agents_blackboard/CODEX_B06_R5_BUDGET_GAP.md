# B06 R5/C : déficit d'aire et rupture entre deux bornes

État : diagnostic de code et archives exactes ; proposition appliquée/testée par root dans la copie isolée seulement. Le snapshot C est intermédiaire R5, pas une capture UI finale. Aucun natif/build lancé par l'auteur de cette note.

Sur5 799 domestic/mixed admis à cible connue, B06 représente2 152 plans et677 382m² des904 753m² d'erreur absolue. Médiane aire/cible0,0665 ;2 034 sont sous90 %. Seulement68 atteignent une des limites8 dimensions/24 poses. Aucun de ces targets ne dépasse le maximum théorique44×44m ; ce maximum n'est pas une preuve de faisabilité du lot.

La cause dominante est le passage par l'adaptation :2 085/2 152 portent `Constrained morphology`, dont2 033 des2 034 sous90 %.1 993 ont un axe réel sous14m ;1 952 ont les deux. Toutes les1 993 ont cette trace. Source : `web/out/java-r5-capacity-houses-proof/b06-origin-evidence.json`.

| Témoin exact | Cible | Corps natif | Paramètres nominaux conservés | Budget actuel |
|---|---:|---:|---:|---:|
|4804 / parcel6eb3a97789ba9002|253,8m²|3,848×5,921 =22,784m²|14×18,1286|4 dimensions/10 poses,0 admis|
|2427 / parcelbd9402b6933ca702|726,8m²|4,995×5,113 =25,539m²|22×22|4/9,0 admis|
|1262 / parcelad8c122686be00df|465,3m²|21,15×22 =465,3m²|21,15×22|0/0, cible initiale atteinte|

Le troisième témoin montre que B06 n'est pas systématiquement interdite au dimensionnement initial. Tous ont un seul corps, un niveau, support Ground hauteur0 ; `elevation_family=platform` n'est pas `Layout::Platform`. Les tags quatre poteaux/pyramide/côtés ouverts interviennent au détail, mais ne constituent pas plusieurs pavillons ni un contrat de ménages.

`engine::resolve_architecture_for_site` applique d'abord les minima nominaux14m et maxima inspired44m. Après échec de placement, `adapt_resolved_architecture` appelle `morphology::synthesize` en mode inspired : les minima sont explicitement `minimum_domain` (murs, pièces, escalier), sans minimum14m. L'adaptateur peut donc admettre les petits corps observés. `plans::improve_domestic_budget` réintroduit ensuite14m par axe et ne propose aucun intermédiaire. Ce n'est pas un manque général d'essais ni un support-platform incompatible ; les2 152 traces budgétaires sont supportées.

La proposition `_agents_blackboard/proposals/adapted_single_budget/` partage le contrat structurel existant et limite le nouveau budget aux rectangles déjà sous nominal. La révision v2 fixe `max(minimum_structurel, dimension_retenue)` sur les deux axes, y compris quand un seul axe était sous nominal. Les proportions source, topologie, plafonds8/24 et contrôles physiques restent inchangés. Le premier patch v1 est conservé séparément ; sa différence de borne mixte n'affecte aucun des trois témoins.

## Première preuve native isolée v1

Root a exécuté les deux tests :2/2 verts,0,10s pour ce seul petit test, sans conclusion de performance ville. Les trois requêtes utilisent leur vraie occupation antérieure4/57/31 plans. Source : `web/out/houses-next-proposal-workspace/b06-adapted-minima-tests.log` et trois JSON `web/out/b06-adapted-minima-isolated-proof/`.

| Témoin | Avant → après | Dimensions après | Minima structurels réels | Budget / assise |
|---|---:|---:|---:|---|
|4804 /6eb3a9…|22,784 →22,784m²|3,848×5,921m|3,652×3,652m|6 couples/13 poses,0 admis ; step0,508m|
|2427 /bd9402…|25,539 →219,781m²|11,827×18,583m|3,426×3,426m|5/14,2 admis ; step0,735742m, pente5,970°|
|1262 /ad8c12…|465,300 →465,300m²|21,15×22m|2×2m|0/0 ; géométries/archive retenues identiques|

Le grand déficit gagne194,242m² et atteint30,2 % de sa cible726,8m², **pas la cible**. La correction remet effectivement une dimension intermédiaire dans le parcours natif, avec vraie toiture/assise/accès de plan et mêmes source/étage. Le guide terrain existant consomme8 évaluations sur les deux déficits ; une seule réduction est retenue pour le grand cas. Le modéré reste refusé aux nouvelles propositions : ce n'est pas une impossibilité du lot démontrée.

Les3 extérieurs natifs passent. Les3 intérieurs restent refusés par `Native interior entrance differs from the retained planning connection` ; cette limite proxy est distincte du gain d'aire. Aucun garde n'a été supprimé. La planche `native-geometry-before-after.png` a été produite exclusivement depuis ces JSON natifs, avec cadastre, buildable, réserves, toiture, accès et caméra identiques dans chaque paire.

Reste avant promotion : test v2 de l'axe mixte, comparatif des7921 requêtes (admissions/gains/régressions/occupation aval/coût), puis décision explicite sur le périmètre. Les maxima et la logique budgétaire sont inchangés, mais les nouveaux couples réallouent les mêmes créneaux : aucune promesse de conservation globale des résultats n'est faite.

Le helper de minima est **générique**, pas réservé à B06 : il vise tout Single/RECT automatique déjà sous nominal et conforme au scope. Le rejeu européen256 combiné exécuté par root conserve admissions/refus et toutes les géométries du baseline B11 ;8 extérieurs et8 intérieurs passent. Cinq diagnostics budgétaires du corpus secondaire changent (dimensions/poses). Source : `web/out/b06-v2-terrain-v3-isolated-proof/european-replay/exact-field-comparison.json`. Cela confirme une portée hors Java ; cela ne remplace pas la mesure complète de C.

Précaution culturelle et de programme : les trois demandes sont `compound`, mais le catalogue exécuté est `Single`. Une surface plus grande ne certifie pas les2/4/3 ménages demandés et ne remplace pas des pavillons absents. Aucun espace réservé/cour/part du site ne peut être occupé pour satisfaire artificiellement le target. La correction proposée vise uniquement le trou de dimensions intermédiaires ; l'absence de topologie compound reste distincte.
