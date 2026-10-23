# Java1752 : les 681 refus initiaux de terrain

23 octobre 2026. Lecture hors ligne de `web/out/java-full-setback-proof`, CLI livré `44999adab6a61cc8420e2cb587ba1dfca3fe132b5595212155757085e17f8fac`. Aucun appel natif, build ou changement produit. [Données et hashes](CODEX_JAVA_TERRAIN_REFUSALS.json), [diagnostic Python](java_terrain_refusals_probe.py.proposed).

**Le dénivelé domine, et le guide actuel arrive après le point qui refuse ces demandes.** `plan_one` exige d'abord un succès de `plan_one_initial` (`plans.rs:2382`), puis appelle `improve_domestic_budget`. Son guide terrain ne peut donc récupérer aucun de ces 681 refus initiaux.

| Cause primaire, nombres arrondis du message | Nombre |
|---|---:|
| Dénivelé seul supérieur à 0,75 m | 630 |
| Dénivelé et pente supérieurs à 0,75 m / 12° | 49 |
| Pente seule supérieure à 12° | 1 |
| Seuil indécidable après arrondi à trois décimales | 1 |

Les refus se répartissent entre **525 demandes automatiques** (448 domestic, 77 mixed) et **156 demandes avec recette imposée** (132 B06, 24 B05). Le dénivelé imprimé médian est 1,324 m, le quartile supérieur 1,788 m. **66 cas** ont un dénivelé imprimé dans ]0,75 ; 0,85] m et une pente ≤12° : 55 automatiques, 10 B06, 1 B05. Ce sont des témoins proches du seuil, pas 66 récupérations promises.

610 messages conservent une erreur antérieure ; dans 145 cas, son dénivelé est inférieur au dernier. Le dernier message ne décrit donc pas forcément le candidat le moins défavorable. Il peut aussi s'agir d'une autre forme/source. Les 50 refus primaires d'accès/domaine qui citent une ancienne erreur terrain restent hors de ce total : compter les simples occurrences donnerait à tort 731.

## Ce que les archives permettent de conclure

Chaque refus conserve seulement ID, code, message et `attempts:0`. **Aucune dimension, assise, pose ou architecture native refusée n'est archivée.** Les champs preview/placement_hint sont des indications du parcellaire ; ils ne peuvent remplacer le corps réellement construit. Les champs correspondants restent explicitement `null` dans le diagnostic.

Pour les 681 droits constructibles moins réserves, le diagnostic calcule indépendamment le minimum de norme du gradient bilinéaire sur chaque cellule raster découpée par les vrais droits, sans enveloppe convexe. **Aucun lot n'est partout au-dessus de 12°.** Cela n'établit ni une place suffisante pour un corps autorisé ni une assise passant 0,75 m. Aucune impossibilité globale, et aucune faisabilité globale, n'est donc démontrée ici.

## Cinq témoins exacts

Indices à base zéro du fichier `after-enriched-requests.json`. Les mesures « refus » sont celles du message, pas celles de l'ensemble du lot. Tous les témoins ont `config.size=1`.

| Index / suffixe de parcelle | Source et cible | Refus : dénivelé / pente | Interprétation vérifiable |
|---|---|---|---|
| 3 / `5e00e93877974acf` | automatique ; 98,4 m² | 1,288 m / 7,291° ; antérieur 0,871 m / 6,341° | Deux candidats échouent différemment ; assise et dimensions inconnues. Le terrain du lot varie de 4,408° à 9,323°. |
| 63 / `c5bc2f619b02a193` | B06 imposée ; 218,3 m² | 0,643 m / 14,595° | Pente seule en échec ; minimum de pente du lot 3,665°. Une autre pose admissible n'est pas prouvée. |
| 1050 / `c0e41a922af6458c` | automatique ; 484,3 m² | 0,751 m / 5,215° | Témoin prioritaire du futur raccord initial, sans modifier le seuil ; corps et minima réels à capturer. |
| 1515 / `8adc9ff792b122c8` | B05 imposée ; 2217 m² | 0,813 m / 3,116° | Risque distinct de cour nue incluse dans l'assise ; pas de faux refus prouvé sans géométrie native. |
| 1622 / `17f4cb90ee39d26a` | B06 imposée ; 102,4 m² | 0,750 m / 4,803° | Arrondi insuffisant pour connaître l'écart réel ; aucun fondement pour supprimer le garde. |

Les bornes **nominales de source**, seules dimensions disponibles, sont B06 Single/RECT : W et D 14–22 m, un corps/un étage ; B05 Kancha : W et D 20–30 m, 4–8 corps/un étage, cour et enceinte. Ce ne sont ni les dimensions adaptées refusées ni des minima universels de placement. Les 525 sources automatiques effectivement sélectionnées ne sont pas conservées dans leurs refus.

## Assise physique ou domaine de plan

`plans.rs:1195–1265` prépare l'assise native seulement pour l'automatique inspired domestic/mixed sans recette/workshop/overrides originaux. Sinon, il contrôle `plan_domain` : union des corps/niveaux, cours, chemins et features (`plans.rs:125`). `plan.lot` et le raccord public ajouté ensuite n'y figurent pas.

Pour les 24 Kancha B05 imposées, inclure une cour nue peut donc surestimer la surface à niveler. Une correction exigerait les vrais murs d'enceinte, appuis et occupation ; enlever toutes les cours ou tous les chemins sans constructeur certifié serait incorrect. Pour un Single/RECT nu, la cour native est vide et le domaine est déjà le corps : cette cause ne doit pas être attribuée indistinctement aux 132 B06. Relecture indépendante morphology concordante.

## Suite bornée proposée

Priorité : retenir **un candidat Single/Ground automatique réellement construit et refusé**, avec source/variante/seed, dimensions, pose et accès courants ; vérifier directement son terrain, sans analyser le texte d'erreur. Après épuisement des voies existantes, appliquer une seule réduction à façade et angle fixes, avec le guide déjà borné à huit évaluations, les minima réels et les rapports complets de source. Une construction réduite puis une admission native complète ; aucun nouveau style, pin modifié, seuil relâché ou capacité déduite. Les réussites actuelles sortent avant ce repli.

Le premier test proposé doit utiliser le témoin1050 et son occupation réelle de batch. Il doit publier les dimensions/assises natives qui manquent actuellement, l'encadrement terrain, le nombre d'évaluations et le résultat droits/toit/accès. Si sa forme, son ancrage, ses minima ou son terrain ne permettent pas la réduction, il reste refusé ; ce résultat ne prouve pas l'impossibilité d'une autre pose. Le cas B05 reste un chantier physique distinct, hors de ce raccord.
