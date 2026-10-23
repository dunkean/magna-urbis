# C7921 — nominal d’abord, terrain V3 réservé hors frontage

23 octobre 2026. CLI isolé `web/out/nominal-first-terrain-v3-isolated-proof/plan_replay.exe`, SHA `38889dfb63da51fa5c94b80b2fcdf9e2da634c79dd63de319c1e47b6bec0842a`. **La reconnaissance nanométrique de `supported` n’est pas incluse.** Rejeu unique par le vrai `streamArchitectureSource`, 124 lots, occupation reconstruite indépendamment, mêmes 7 921 demandes/graines/header ; aucune ville recalculée, aucun intérieur en masse.

## Conservation vérifiée

- **6 177 admis / 1 737 refus / 7 ouverts** : mêmes identités admises que le combiné `525e`, soit **98 gains et zéro perte** face à B11 `c786`.
- **6 177 droits, 6 177 assises réelles Ground Single et zéro collision globale** ; les 2 150 assises marquées préparées passent également. Sources, variantes et étages des anciens plans inchangés.
- Face à B11, **aucune dégradation de cible** parmi les anciens admis : 1 136 améliorations (1 084 B06, 24 B14, 28 B15). 3 835 objets byte-identiques ; les 2 244 autres ne sont pas déclarés identiques.
- **Les 36 portails perdus avec `525e` sont tous retrouvés.** Face à B11 : zéro portail ancien perdu, six gagnés ; les 98 nouveaux plans comprennent toujours 50 portails conservés. Total 2 150. Face à `525e`, 27 de ses nouveaux portails disparaissent : ce sont des gains expérimentaux non conservés, pas des pertes par rapport à B11. Aucun succès d’intérieur supplémentaire n’est inféré.

| Même corpus | B11 `c786` | Combiné `525e` | Nominal-first `38889` |
|---|---:|---:|---:|
| Plancher domestic+mixed admis | 367 549,45 m² | 455 165,61 m² | **433 370,26 m²** |
| Plancher comparable, référence connue | 360 325,64 m² | 447 877,28 m² | **426 081,93 m²** |
| Référence dérivée du programme | 1 593 811,30 m² | identique | identique |
| Écart absolu aux cibles des mêmes 5 799 anciens admis | 904 752,97 m² | 821 526,89 m² | **843 344,75 m²** |

Le compromis est explicite : **21 795,35 m² de moins que `525e`**, mais aucun ancien budget ni portail dégradé sur ce corpus. Face à B11, B06 gagne 60 258,30 m² ; son ratio médian emprise/cible passe de 0,06655 à **0,11324**, contre 0,15379 dans l’expérience précédente. Cela reste loin d’un remplissage satisfaisant de tous les programmes. La référence est connue sur 7 490 sites et inconnue sur 287 ; les refus apportent zéro surface admise. Aucune capacité d’habitants n’est calculée.

## Témoins et budgets

Les trois témoins reviennent **exactement à l’aire B11** dans le rejeu complet avec leur vrai contexte cumulatif :

| Index | Source | B11 → `525e` → `38889` | Portail final |
|---|---|---|---|
| 6 495 | B06 | 515,596896 → 222,506200 → **515,596896 m²** | absent, comme B11 |
| 6 577 | B14 | 53,080965 → 29,979180 → **53,080965 m²** | conservé |
| 1 409 | B15 | 64,995000 → 33,691104 → **64,995000 m²** | conservé |

**2 204 traces de phases** vérifiées : compteurs nominaux ≤ compteurs globaux, phase adaptée seulement sous 8 dimensions/24 admissions, terrain global ≤8. Totaux ordinaires : **19 700 dimensions /54 428 admissions**, contre 14 080 /39 941 pour B11 ; aucune promesse de gain de vitesse. Les 901 traces de récupération terrain restent 98 succès/803 refus, 5 844 évaluations, 309 constructions/admissions, maxima8/1/1 inchangés.

**1 115 appels supplémentaires demandés au finaliseur nominal**, dont 1 084 B06 que le préfiltre source laisse unsupported ; ce ne sont pas 1 115 admissions physiques. Le getter évite de déplier l’archive pour lire l’entrée. Trois appels conservent effectivement le nominal pour son portail. Les autres maintiennent le meilleur plan admissible sans fabriquer d’entrée.

Le contrôle brut conserve 506 drapeaux source : mêmes 458 ratios hors plage hérités et 86 minima avec écart ≤7,27nm (deux corps B11 retrouvés ajoutent deux drapeaux par rapport à `525e`). Le comparateur confirme **contrôles, minima et dimensions exacts déjà présents dans B11** ; aucun nouveau cas parmi les gains. Les écarts de minimum passent à la grille native millimétrique, sans modification de tolérance du moteur. Les rapports bruts et leur assertion conservatrice restent intacts.

## Preuves

Dossier nouveau et figé : `web/out/java-c-nominal-first-terrain-v3-proof/`. Source C SHA `1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53`, moteur urbain producteur inconnu ; **pas un résultat R5 final**.

- `independent-audit/comparison.json` SHA `a9ba1d787a388e21f231364f89b68349cf16a0d04ead5d106a72fa283646b31f` : B11, droits/terrain/collisions, sources et budgets.
- `independent-audit/findings.json` SHA `2a8e868524dcf40a485ff4df717fd1e77c6007fbbc9e224645ee85719bf94557` : héritage des drapeaux, qualité commune.
- `independent-audit/comparison-to-525e.json` SHA `8e86c7778901aef71c64bf9a56f1927019d91881d9d7903127d45a1bda3b15d4` : comparaison scalaire séparée, témoins et transitions d’entrée. Le champ `finalAdditionalEntryChecks` compte des demandes au finaliseur, avec le préfiltre décrit ci-dessus.
- `structural-floor-programme-evidence.json` SHA `b0b415fa1cba2f0c1c3b449c4d239addb3a39d46839d73cdd4079565cd6faaa5`.

Les 124 payloads enrichis/sorties/stdout/stderr/hash restent sous `after/`. Aucun autre natif, Cargo ou serveur ; les 10 744ms cumulées du runner sont un singleton sur machine partagée, hors transport/UI, pas un benchmark.
