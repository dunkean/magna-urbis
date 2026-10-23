# Réduction uniforme et terrain : contrat de guide

Relecture de `placement.rs::ArchitectureTerrain::foundation_bounds` (ligne96) et de son usage dans `plans.rs::visual_with_front_access_prepared` (vers1247), sans modification produit, Cargo ou rejeu natif. Java Sources propose un rectangle simple, angle et centre de façade fixes, sans cour, chemin, structure ou niveaux débordants.

**Avis : guide mathématiquement fondé dans ce périmètre, sous admission native finale obligatoire. Aucune certification de monotonie flottante exacte ni d'impossibilité globale.**

## Pourquoi cela fonctionne

Dans le même repère, `R(s)=[cx−sW/2,cx+sW/2]×[front,front+sD]`. Pour `0<s1≤s2`, `R(s1)⊆R(s2)`. Le transform rigide reste strictement fixe. Sur le même terrain : en diminuant `s`, minimum d'altitude non décroissant, maximum non croissant, plage `max−min` non croissante ; maximum de norme du gradient non croissant. L'eau à cote fixe et un support Ground inchangé rendent également la contrainte plus facile quand le minimum monte. Cela ne vaut pas si on recentre au nouveau centroïde du terrain, change l'angle, change le front ou décale le corps pour chaque échelle.

Le raster est bilinéaire dans chaque cellule. Sa fonction possède un point stationnaire intérieur de type selle, sauf cas affine/constant : les extrema d'altitude sont sur les arêtes. Le code ajoute les extrema quadratiques internes des arêtes découpées. Le gradient est affine ; sa norme est convexe, donc son maximum sur chaque polygone découpé se trouve parmi les sommets. Les coupures de pente entre cellules ne cassent pas cette propriété : le maximum est pris sur toutes les cellules couvertes. Sur terrain sans grille, l'altitude est affine et la pente constante ; réduire ne répare donc jamais une pente plane uniformément excessive.

## Conditions d'intégration

1. Conserver source/variante/graine/étages/supports, angle et centre de façade. Le domaine testé doit être **le même corps réel** que l'admission : Single/RECT, tous niveaux identiques, aucun élément porteur omis. Toit et raccord d'entrée restent vérifiés par leurs gardes habituelles ; le corps seul ne les certifie pas. Les préparations actuelles d'un Single sans structure ont bien le corps comme domaine porteur.
2. Plage d'échelle continue `s≥max(Wmin/W,Dmin/D)` et bornes hautes existantes ; aucune extension de source. La proportion continue ne change pas. Après grille millimétrique, vérifier les dimensions effectivement construites et le rapport. Utiliser **le même mode d'arrondi monotone pour chaque axe à toutes les échelles** : changer dynamiquement floor/ceil peut casser l'emboîtement. Une violation de rapport/minimum due à l'arrondi n'est pas une preuve de défaut terrain monotone.
3. Terrain et grille déjà validés, dimensions finies et positives, domaine non vide. Le rectangle supérieur entièrement dans la grille assure la couverture des emboîtés. Ne jamais tronquer un corps au bord du raster ni remplacer une cellule absente par le gradient de secours. Un `Err` générique (couverture, dégénérescence) signifie Unknown pour ce guide ; il ne suffit pas à déclarer toutes les échelles impossibles.
4. Au plus8 appels : haut, bas et6 dichotomies ; conserver une borne effectivement évaluée comme admissible, jamais un milieu non vérifié. Les plateaux de quantification peuvent donner deux rectangles identiques et n'autorisent aucun essai supplémentaire. Une seule construction/admission ordinaire ensuite, avec les gardes exactes existantes : pente≤12°, dénivelé≤limite+1e−8, eau Ground `low≥water−0.01`, puis tous droits/toitures/voisins/accès. Aucun échec du guide ne retire l'incumbent ou les autres voies existantes.

## Limites numériques concrètes

Le code ignore les intersections de cellule d'aire<1e−9 et les extrema d'arête lorsque `|qa|≤1e−14`; clipping et sommes restent flottants. La monotonie bit-à-bit n'est donc pas un théorème du code.

Contre-exemple scalaire minimal, sans appel natif : cellule unité, altitudes `(z00,z10,z01,z11)=(+c/4,−c/4,−c/4,+c/4)` avec `c=1e−14`. Grand rectangle tourné45° aux sommets `(0.5,1),(1,0.5),(0.5,0),(0,0.5)`, réduction×0.5 autour du centre de façade `(0.75,0.75)`. Le seuil d'arête omet les extrema : grande plage calculée0, petite plage≈6.25e−16m, donc croissance numérique malgré inclusion. En incluant tous les extrema, les plages sont1.25e−15 puis7.8125e−16m, monotones. Cette échelle est très inférieure à la garde existante1e−8m ; ce n'est pas un défaut d'admission physique démontré et il ne justifie aucun relâchement de garde. Il interdit seulement de promettre une monotonie exacte du calcul flottant.

## Comptes observés, sans causalité temporelle inventée

Java128,60 traces de budget : couples178→166, poses complètes580→574, admissions de pose49→42 ; maxima8/24 inchangés. Le cas054a passe1couple/3poses à7/24 (+21 poses) ; d'autres diminuent (c25e :20→10 poses ; ae8b :20→13). Une pose arrêtée aux droits coûte autrement qu'une pose atteignant terrain/toiture/accès. Les comptes n'instrumentent ni les appels du guide ni les cellules raster découpées.

`foundation_bounds` n'est **pas une opération scalaire de coût constant** : chaque appel boucle sur les cellules de la boîte et calcule une intersection polygonale par cellule. Huit appels peuvent économiser des constructions, mais leur coût dépend de la grille. Les cinq alternances mesurées (médianes199→248ms, étendues153–259/154–413ms) sont trop dispersées pour attribuer le surcoût au helper d'aspect ; elles ne prouvent aucun gain. Une future mesure du guide doit conserver ces comptes et distinguer nombre d'évaluations terrain et nombre d'admissions natives.

## Relecture du raccord livré par Java Sources

Lecture de `source_terrain_budget.rs::reduce`, `source_terrain_budget_tests.rs` et de la branche dans `improve_domestic_budget`, sans édition Rust ni exécution. Aucun blocage identifié.

- Le guide intervient après un échec ordinaire, uniquement si la projection d'aspect a changé le couple ; il examine directement le terrain, sans analyser le texte du refus. `None` sur erreur de couverture interrompt le guide et n'est pas traité comme un terrain défavorable.
- Les dimensions originales et réduites sont comptées dans8, chaque admission échouée ou réduite dans24. Un indicateur global autorise une seule reconstruction réduite ; les évaluations terrain consommées sont cumulées et plafonnées à8, même si plusieurs couples étaient examinés sans proposition.
- Le rectangle réduit est reconstruit à l'origine locale, avec translation exacte de `(W−Wréduit)/2` dans le même repère : centre de façade et orientation fixes. `floor(Ws)` borné par le minimum est monotone ; `round(Ds)` borné entre les deux limites monotones de profondeur l'est également. Les axes restent inférieurs aux dimensions originales et sont revérifiés après grille. Les niveaux locaux sont unis et transformés comme dans la voie d'admission ordinaire.
- Eau, pente et dénivelé reprennent les mêmes comparaisons. Les droits préliminaires sont conservateurs et la proposition traverse ensuite la construction et l'admission complètes ; aucun résultat du guide n'est pris pour un certificat final.
- La boucle conserve les candidats pleins et reprend leur parcours après l'essai réduit. Précision : elle conserve leur géométrie et leur ordre **dans le budget restant** ; consommer un slot réduit peut supprimer un essai tardif ou le dernier couple sous les plafonds8/24. Aucune monotonie de résultat par rapport à tous les anciens essais n'est promise.

Java propose aussi d'expliciter Ground/hauteur0 dans `body.parameters`, en plus du principal et de `body.z==0` déjà vérifiés : garde défensive pertinente pour le helper autonome. Les tests couvrent le cas réel054, eau, pente trop forte au minimum, couverture inconnue, budget restant0/1 et paramètres non mutés. Une assertion d'inclusion sur une pose tournée serait un complément ciblé utile, sans nécessité d'une nouvelle suite générale.

## Pourquoi le témoin natif054 ne reproduit pas les62,973m² du prototype

Le log figé `web/out/single-entry-terrain-plans-tests.log` rapporte **27,796149996→57,725224051m²**, cible75,2,8dimensions/24admissions/8évaluations, une réduction et une admission améliorée. Il n'archive pas la pose ni les dimensions pleines ayant déclenché le guide.

Le prototype `_agents_blackboard/CODEX_SINGLE_TERRAIN_BUDGET_SCALAR.json` connaissait une **ancienne pose admise avant la correction d'aspect** : origine `(8868.15130704011,9480.676776503875)`, angle265,200582067566°, centre de façade local `(6.2665,0)`. Il projetait l'aire historique75,198m² vers9,695×7,757, consacrait ses8évaluations à cet unique ancrage et retenait8,872×7,098=62,973456m². C'était un témoin d'existence terrain/droits à une pose connue, sans construction ni admission d'entrée native.

La production ne reçoit pas cette ancienne solution : elle garde les poses et couples courants, puis tente la réduction au **premier échec éligible effectivement rencontré**. Le budget8évaluations est global ; des évaluations antérieures sans proposition peuvent réduire les dichotomies disponibles. La cible de départ est celle du couple actuel, pas nécessairement l'aire historique75,198. La quantification est aussi légèrement différente : prototypefloorW/ceilD sur le rapport limite, productionfloorW puis profondeur arrondie et bornée par les limites source monotones.

Les deux nombres ne comparent donc pas le même ancrage ni forcément le même rectangle initial ou la même séquence de huit évaluations. La différence de5,248m² n'est pas à elle seule un défaut du calcul terrain. **La cause précise et sa répartition entre pose, couple et budget ne sont pas démontrées par le log disponible** : on ne peut pas affirmer une nouvelle origine exacte ni attribuer tout l'écart à l'arrondi. Le CLI final doit fournir les dimensions/pose finales et le rejeu comparatif ; les62,973m² restent une possibilité du prototype, pas un résultat natif exigible à ce point du parcours. Aucun nouveau test ou calcul natif exécuté pour cette analyse.

Complément après le CLI final figé : le corps retenu054 mesure8,494×6,796m, à l'origine `(8867.506730926953,9472.999788967456)`, angle265,200582067566°. Son centre de façade mondial est `(8867.151394120276,9468.767680184140)`, contre `(8867.627003272972,9474.432248674666)` pour le prototype : **5,6845m d'écart**, calculés depuis les deux transformations et centres locaux déclarés. La différence d'ancrage est donc maintenant démontrée ; la répartition entre tous les couples/évaluations reste inconnue faute de trace détaillée des essais. Le [rapport final](../web/out/java-terrain-entry-proof/RESULTS.md) et sa planche à trois étapes conservent cette limite.
