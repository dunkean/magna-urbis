# B06 : cause observée des deux petits gains

**Diagnostic root réel V4 : un test PASS,8.70s,267sources stables.** Toutes les archives parents et leur ordre, refus/open/matériaux et les compteurs de chaque ACK restauré correspondent au run diagnostic V1. Aucune autre géométrie ou pose n'a été essayée pour cette analyse. Les deux goldens historiques et cinq pertes B14/B15 restent bloquants ; ce n'est pas une activation.

Preuves : `web/out/single-growth-b06-trace-proof-v4/root-verification.json`, `run-01/{0012,0100}/dimension-trace-lossless.json`. Extraction des seuls événements exécutés, avec SHA des inputs : `web/out/b06-actual-trace-causal-analysis-v1/causal-flow.json`. Reproduction sans moteur : `python web/out/b06-actual-trace-causal-analysis-v1/summarize-traces.py`.

##0012 / parcel-a2848c9e721f48be

Besoin utile indicatif160.56m² ; souhait de masse58.6m² ; étages demandés/réels1. Le growth sort **sans aucun essai** parce que58.017119m² est déjà dans la tolérance de masse. La continuation utile est bien exécutée ensuite.

Corps initial9.547×6.077m, orientation270°, ratio1.571005 autorisé. Axes permis [9.547,44] et [6.077,44] ; aspect source14/22..22/14. Les1396.63m² du buildable ont une bbox locale longue89.062m mais seulement15.682m de profondeur. L'ancre choisie est le bord+y du corps, maintenu à6.077 ; la bbox des droits commence ày=-0.363454.

Le point visant le besoin,15.882×10.109=160.551138m², passe l'aspect puis échoue immédiatement sur **buildable**. L'origine locale de ce corps descend ày=-4.032 : la surface disponible derrière/lateralement n'est pas exploitée par cet ancrage. Son terrain n'est pas évalué. Même premier rejet pour103.101427,79.124453 et68.330795m². Les points63.224304 et60.743642 passent le corps mais échouent sur **droits du toit**, toujours avant terrain/voisins/préfixe.

Seuls l'initial et le petit hint passent tous ces contrôles et atteignent le terrain : steps0.7480102687320596 et0.7497856397227736m, sous0.75 ; pentes6.34657/6.34738°, sous12°. Bilan :8checks dimensionnels,2terrains,1construction/1préparation/1admission,0résolution de source. Petit gain réel58.017119→58.322196m². **Aucun grand candidat n'a été refusé par le terrain dans cette trace** ; le terrain de l'initial est proche du seuil mais cela ne prouve pas une impossibilité ailleurs.

##0100 / parcel-74af988d1376171d

Besoin166.56m² ; souhait de masse424.4m² ; niveau réel1. Initial6.129×9.631=59.028399m², orientation150.83342964035498°, bord+y ancré. Axes [6.129,44] et [9.631,44], même aspect source. Buildable449.45m² ; bbox locale29.665×26.484m, qui n'est pas une preuve de remplissage du polygone.

Le haut16.434×25.824=424.391616m² passe l'aspect puis échoue sur **buildable**. Les points119.896610 et87.262920m² ont le même premier rejet. Trois autres points n'atteignent même pas la géométrie :

| Aire m² | Dimensions m | Ratio obtenu | Premier rejet |
|---|---|---|---|
|200.694459|11.301×17.759|0.6363533983|aspect, inférieur à14/22=0.6363636364|
|72.880620|6.810×10.702|0.6363296580|aspect|
|66.174822|6.489×10.198|0.6363012355|aspect|

Le facteur uniforme continu conserve les proportions ; c'est le `floor` indépendant de chaque axe au millimètre qui sort ces points du domaine. `check(None)` réduit ensuite la borne haute de la bissection comme pour une impossibilité physique. Cet effet discret n'est ni un manque de place démontré ni une monotonie géométrique prouvée.

Seuls l'initial et le hint59.796117 atteignent le terrain : steps0.7451278937263055 et0.7486079577581677m ; pente7.0299176°.8checks/2terrains/1construction/1préparation/1admission/0source. Gain59.028399→59.796117m². La continuation utile sort ensuite **sans essai** car cette masse est hors±10% du souhait424.4, même si le besoin166.56 demeure insuffisant. Le besoin n'est donc pas la cible de recherche de ce growth.

## Petite correction proposée, sans nouveau catalogue

Premier correctif borné : générer le couple millimétrique par **`SourceAspectBudget::project` existant**, puis garder `contains` strict, au lieu de considérer le couple issu des deux `floor` comme la seule représentation de ce point. Même aire visée, vrais axes autorisés, même source/seed/niveau/orientation/ancre, mêmes8slots et1construction/préparation/admission. Projection impossible : slot refusé, jamais de clamp hors style. Toutes les gardes géométriques/terrain/préfixe restent identiques et le parent entier demeure le fallback. Cela corrige les trois faux échecs de représentation0100 ; **aucun gain utile n'est encore prouvé** et0012 ne bénéficierait pas de ce seul changement. Tester ces trois couples puis le vrai pipeline, et garder le contre-témoin0099 ratio2.918 refusé. Le ratio de son empreinte contrainte n'est pas une permission pour élargir le domaine du source.

Pour une proposition réellement plus grande sur ces deux sites, le prochain test constructif peut être unique : un rectangle visant le besoin utile validé, projeté dans ces mêmes bornes, puis une translation analytique à angle fixé dans les droits réellement convexes via l'opérateur existant (pas de hull/trou rempli). Il remplacerait un slot de priorité existant, sans baisser le souhait de masse archivé ; au plus une reconstruction/préparation/admission avec accès natif réel et ancien parent entier sur échec. Ne pas l'implémenter comme acquis : la convexité native, l'accès et le terrain doivent d'abord confirmer ou refuser ce témoin. Une grande aire cadastrale ne permet pas de supprimer l'ancrage sans reconstruire et réadmettre l'entrée. Si ce témoin échoue au vrai terrain, poursuivre les fondations séparées du compound, pas assouplir0.75m/aspect ni inventer des étages.

Les cinq pertes de parents composés restent un problème de choix entier distinct : aucun de ces correctifs de points ne les résout. Avant acceptation, audit physique des936 changements et protocole de conservation du meilleur parent réellement valide nécessaires. Brut/utile/ménages restent des quantités distinctes ; aucun ménage logé ni capacité résolue annoncé.
