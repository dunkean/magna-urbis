# Translation minimale d'une architecture conservée — helper isolé

23 octobre 2026. `rigid_translation_fit.rs` reste isolé de la production. Ses six tests mathématiques passent dans la compilation commune root ; son diagnostic réel sur huit plans ne récupère aucun cas. Aucun Cargo, serveur ni rejeu lancé par cet agent. Le diagnostic antérieur aux paliers opposés signalait six passages hors droits et deux échecs de raccord public ; les résultats ci-dessous distinguent les deux corrections.

## Contrat

`solve(&TranslationProblem)` reçoit trois paires de surfaces déjà orientées dans les mêmes coordonnées : corps/constructible, occupation complète/droits cadastraux admissibles, toit/droits de toit. L'occupation comprend les deux passages natifs quand ils sont distincts et tous les appuis requis. Les droits sont les vraies surfaces après réserves, et après voisins pour l'occupation au sol ; la toiture conserve ses droits explicites comme dans `visual`. Aucun convex hull, agrandissement des droits, découpage du bâtiment ni changement d'orientation ou de dimensions.

Chaque domaine de droits doit être un polygone simple réellement convexe, sans trou, d'au plus 64 sommets. Topologie et convexité sont contrôlées séparément. Concavité, trou, multipolygone ou complexité non prise en charge donnent `Unsupported`. Les composants mobiles peuvent être disjoints ou se chevaucher : chaque polygone doit être valide, mais leur support est calculé sans union supplémentaire. Maximum total : 4 096 sommets mobiles, 192 contraintes et 196 sommets du domaine de translation. Les coordonnées finies sont bornées à ±10 millions de mètres.

Pour chaque arête de droits, la contrainte est `n·delta ≤ bord − max(n·sommet_mobile)`. Elle contient exactement tous les composants mobiles dans ce demi-plan. La réunion des contraintes des trois paires définit le domaine convexe de translations faisables. Sa boîte initiale vient des projections des domaines réels sur x/y ; ce n'est pas une limite arbitraire de déplacement.

Si zéro est admissible, le résultat est zéro. Sinon, le helper intersecte les demi-plans puis calcule la projection de zéro sur chaque arête du domaine faisable et choisit le point le plus proche. Une ligne ou un point admissible restent des résultats valides. Les contacts décimaux exacts utilisent une tolérance numérique absolue de 1e-9 m, également vérifiée à la fin ; aucun seuil physique ou garde natif n'est changé.

Le résultat distingue `Fit`, `EmptyFixedDomains` et `Unsupported`. `Fit.delta` s'ajoute directement à l'origine du Transform courant : tous les corps, cours, galeries, passages et toits restent solidaires. Il n'y a qu'un candidat, aucun balayage de poses, aucune construction de maison. L'absence de solution ne vaut que pour ces domaines complets et cette orientation.

## Gardes encore nécessaires

Le candidat doit repasser l'admission native complète. Terrain, eau, vrai raccord public, passages/obstacles à leur altitude et réalisation du toit ne sont pas certifiés par la translation. Une entrée déjà à l'intérieur du cadastre mais incapable de rejoindre la rue peut donc rester impossible. Une translation supérieure à 2 m est mathématiquement autorisée ; elle ne dispense d'aucun contrôle et n'est pas annoncée comme amélioration esthétique.

Insertion proposée après accord : sur le seul plan final déjà accepté, préparer son vrai passage une fois, conserver orientation/dimensions et calculer cette translation avant les trois poses de front existantes. Vérifier une fois le résultat dans `visual`, puis conserver l'ancien plan si le gain d'entrée n'est pas admissible. Le helper n'est pas encore raccordé et n'a supprimé aucun repli.

## Témoins mathématiques — 6/6 passent

1. Une maison entière avec passage débordant de 0,25 m requiert exactement une translation de 0,25 m ; corps, occupation et toit restent identiques à translation près.
2. Une limite oblique `x+y≥4` donne le vrai plus proche déplacement `(1,1)`, invariant sous inversion du contour et décalage des coordonnées urbaines.
3. Les droits de toit distincts imposent leur propre déplacement ; zéro et une distance supérieure à 2 m sont traités sans cap caché.
4. Contacts exacts laissant un segment ou un point.
5. Contraintes convexes incompatibles malgré une boîte englobante assez grande.
6. Trous, concavités, anneaux croisés/doublement parcourus, valeurs invalides et bornes de complexité donnent `Unsupported`.

Compilation et exécution communes réalisées par root. Aucun gain de temps n'est mesuré par ces tests.

## Diagnostic isolé des huit plans

`native_translation_probe_tests.rs` est prêt comme enfant de `plans`, uniquement sous `cfg(test)`. Il reconstruit les huit demandes brutes de `native-strip-entry-eight.json` avec le parcours initial + budget courant, prépare leurs vrais passages, puis produit `Unsupported`, `EmptyFixedDomains` ou une seule translation et son verdict d'admission complet. Les voisins du témoin suivant restent ceux de la séquence initiale ; le candidat expérimental ne modifie pas cette référence. Chaque admission déclenche réalisation extérieure et intérieure, avec invariants de source, dimensions, orientation et aire. Tous les résultats sont consignés avant l'éventuelle assertion de détail.

La revue indépendante du calcul n'a relevé aucun défaut concret. Après correction séparée des paliers opposés dans le builder natif, le diagnostic enregistré dans `native-entry-plans-opposed.log` donne : **6 Unsupported** pour droits constructibles concaves réels, **1 EmptyFixedDomains**, **1 Fit(delta=0)** refusé ensuite par le raccord public. Donc **0/8 admission par translation**, aucune réalisation détaillée déclenchée par ce probe ; la liste vide de refus de détails n'est pas une preuve de détails réussis. Le helper reste expérimental, sans activation ni substitution par une enveloppe convexe.

Dans le parcours normal, la correction des paliers natifs permet séparément **3/8 certificats d'entrée et intérieurs réussis** (indices 1491, 2665, 11307) ; les cinq autres plans admis sont conservés avec limitation explicite. Les tests plans passent 26/26. Ces résultats sont propres aux huit témoins, sans extrapolation à la ville.

## Coût de la conservation finale du portail — revue de code

La portée actuelle est filtrée avant décompactage par le diagnostic de fondation Strip déjà admise. Un plan éligible est décompacté une fois, puis une nouvelle préparation structurale avec accès est faite une fois ; les quatre poses éventuelles partagent son `OnceCell`. Il n'y a ni nouveau tirage, ni construction d'intérieurs, ni tessellation de toit à ce stade. Les domaines locaux, contours de toit séparés, aires d'étages et archive restent cachés pendant ces poses.

Doublon immédiat corrigé dans la seule fonction `retain_final_native_entry` : auparavant les replis étaient calculés avant la première validation, avec droits et union d'enveloppe puis jusqu'à huit poses produites avant d'en conserver trois. Désormais un itérateur paresseux valide d'abord la pose courante ; il ne calcule les mêmes trois replis, dans le même ordre, qu'après échec. Le plafond reste **une pose courante + trois replis = quatre validations**. Le bloc d'acceptation et ses diagnostics restent identiques. Cette modification ne démontre encore aucun gain chronométré ; comparaison avec CLI eager attendue.

Les doublons restants sont plus coûteux à supprimer sans changer l'architecture interne : la dernière source avait déjà une préparation de fondation dans le parcours de choix/budget, mais ce cache a été perdu lors du retour de `PlanBuilding` ; l'upgrade reconstruit donc la même unité pour ajouter son accès. De même, l'archive est restaurée puis recréée sur succès alors que seule son entrée locale change. Conserver un résultat de préparation éphémère jusqu'au choix final, ou réutiliser l'archive en ne remplaçant que son champ entrée, pourrait éviter ces travaux ; ne pas ajouter de cache global ni contourner les contrôles de version.

Chaque validation refait légitimement les transformations et unions en coordonnées monde, l'assise/terrain, les droits complets et le raccord public. Les soustractions statiques `cadastral − réserves`, `buildable − réserves` et les droits de toit sont répétées entre validations et dans le raccord ; un contexte local réutilisable est envisageable. Ne pas remplacer union-après-transformation par transformation-après-union : leur quantification n'est pas strictement commutative. Le raccord peut examiner au plus 64 accès avec deux formes de connexion, donc le plafond de quatre poses ne décrit pas tout son coût géométrique.

Pour les 128 demandes, relever séparément : éligibles à cette préparation, succès à la pose 1, succès aux poses 2–4, préparations refusées, replis sans gain, nombre total de validations et temps. Une variante « même pose seulement » économiserait au plus trois validations par échec, mais pourrait perdre des certificats ; aucune suppression des replis n'est décidée sans ce différentiel. Les admissions ordinaires, les empreintes et les limites physiques doivent rester identiques.
