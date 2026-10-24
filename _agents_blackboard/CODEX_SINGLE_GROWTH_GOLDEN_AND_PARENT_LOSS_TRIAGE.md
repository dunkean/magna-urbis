# Clone descriptor : triage des goldens et pertes de parents

État : **V1 non promouvable**. Aucun produit, garde, référence ni gel modifié. Lecture des exports root uniquement ; extraction reproductible : `python web/out/single-growth-parent-choice-triage-v1/extract-existing-evidence.py`.

## Les deux anciens goldens

Root a exécuté la capture V2 : un test PASS, 265 sources stables, `contract_failures=[]`. Les changements de transport sont bien antérieurs à la continuation : six parents du lot0002 et cinq du lot0080 changent avec NeedOFF comme avec NeedON. Le témoin0080 `parcel-03e9d3cd725f0063` conserve **l'objet final entier** NeedOFF/ON, entrée native et 28.104489047847746 m². Ce n'est pas une rupture du fallback de ce témoin.

Les quatre fichiers `*-changed-parent-audit.json` contiennent 44 lignes before/after (11 parents distincts, deux modes). Toutes les réadmissions natives ont exactement les mêmes corps/toits/circulation/entrée/bits de sol ; toutes les archives passent leur validation source. Intersections land-land et deux sens roof-land avec les autres membres du même lot : zéro. Maximum step après : 0.7499154786547138 m ; pente : 8.554476683804511°. Les checks de continuation restent vrais. Ce contrôle ne reconstruit pas les anciens toits inter-lots absents des fixtures historiques ; ce n'est pas une preuve physique des 936 changements de ville.

**Ne pas remplacer les SHA maintenant.** Les anciennes références prouvent toujours l'ancien chemin. Si l'on conserve finalement ce changement global, de nouvelles références versionnées peuvent être ajoutées après validation, en conservant les quatre transports historiques, leurs hashes et la capture physique. Si la permission descriptor devient un candidat au niveau parent, les anciens tests legacy peuvent rester inchangés.

Preuves : `web/out/single-growth-golden-capture-proof-v2/root-verification.json`, `run-01/capture-summary.json`, `web/out/single-growth-parent-choice-triage-v1/capture-physical-stage-summary.json`.

## Les cinq pertes réelles Assembly → Single

Même besoin et programme avant/après, composition compound et étages demandés [1,1] ; chaque ancien membre et chaque nouveau corps a réellement un niveau. Aucun ménage n'est crédité. Toutes les sources/variantes/seeds/wealth communes restent identiques. Besoin utile indicatif insular générique, non calibré culturellement.

| Lot / parcelle | Source | Ménages demandés ; besoin utile ; souhait d'emprise m² | Brut ancien → nouveau m² | Rejet réel du deuxième membre après croissance |
|---|---|---|---|---|
|0013 / d8754935b0af92a1|B14|4 ; 214.08 ; 642.2|45.386642 → 21.224500|8 nécessités, aucun passage au terrain : garde combinée droits/ancien portail/occupation/toit|
|0041 / 51dd2a34f11d5246|B14|3 ; 268.56 ; 705.8|51.784500 → 43.106445|8 nécessités, 2 terrains, 1 rebuild/prep/admission ; accès interne refusé : aucun connecteur non obstrué vers la frontage|
|0042 / 3653eac982d528d7|B14|4 ; 358.08 ; 693.1|43.400283 → 30.253080|8 nécessités, aucun terrain : même garde combinée|
|0111 / cbc2ab8fb5094e58|B14|3 ; 176.4 ; 567.8|52.203552 → 38.398500|4 nécessités seulement, aucun terrain : même garde combinée ; aucun second slot de dimensions produit|
|0120 / 0ea6fb210e131b5a|B15|3 ; 270 ; 689.2|59.400594 → 31.054648|8 nécessités, aucun terrain : même garde combinée|

Les anciens ajouts admis mesurent 27 m² (B14) ou 45 m² (B15). Le premier corps gagne seulement 2.837858 /18.321945 /13.852797 /13.194948 /16.654054 m² : sa croissance locale ne compense pas leur disparition. Perte totale de ces cinq parents : **88.138398 m²**, donc augmentation identique de leur manque nécessaire. Tous restent très insuffisants, avant comme après. Le code `single_incumbent_growth::finish` compare l'emprise du Single, puis `native_parent_batch::plan_parent_batch_impl` tente l'assemblage depuis ce seul Single déjà choisi. `native_assembly_builder::pose` place relativement à ses dimensions : la croissance change aussi les positions du nouveau membre et les connecteurs. Les contextes d'autres parents ont aussi changé dans le rejeu ; la seule garde combinée ne prouve pas lequel de ses termes a échoué, ni une impossibilité du site. Le slot absent0111 n'est pas un minimum culturel prouvé.

Détail exact, IDs complets, programmes, poses et rapports : `web/out/single-growth-parent-choice-triage-v1/five-losses.json`. Inputs SHA : `input-hashes.json`. Les données de base proviennent des réponses natives V2 et V1 aux mêmes ordinaux, jamais d'anciens plans injectés dans un nouveau calcul.

## Contrat de choix à retenir, implémentation différée

Avant une nouvelle activation, choisir un **parent entier** sous le contexte réel courant. Petite option à évaluer, sans plateforme supplémentaire : garder la Phase1 produit, puis, pour un compound couvert, former l'ancien candidat pair depuis le vrai Single final et au plus une proposition descriptor-growth depuis ce même Single. Un seul pair et un seul growth, chacun avec ses bornes actuelles, aucun deuxième pair, sourceResolve, redraw, étage ou membre ajouté au-delà de deux. Ne réserver que le parent choisi ; chaque alternative consulte le même préfixe natif et tous les autres parents finalisés, avec chemins/features et deux sens roof-land. Conserver l'ancien parent entier sur échec, inventaire inconnu ou incomparabilité. Cette option n'est pas codée et ne promet pas l'optimum.

Comparer dette utile nécessaire connue ET distance au souhait de masse ; remplacer seulement par dominance explicite, avec entrée native/préparations/fondations valides et programme identique. Ne pas favoriser un enum Assembly par son nom ni considérer du brut suffisant comme capacité utile. Un ancien assemblage de fichier peut être invalide dans un nouveau contexte : il ne doit jamais être injecté comme autorité d'admission.

Priorité root désormais : mesurer les limites géométriques réelles des B06 avant ce changement d'ordre. Le full diagnostic donne +0.8923 % brut et sept pertes, pas une résolution. **Tous les 936 parents physiquement changés**, y compris descendants et transitions, restent à auditer dans leur scène finale avant toute acceptation. Les deux captures locales ne les remplacent pas.
