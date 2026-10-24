# Java 100k — prochain levier constructif

2026-10-24. Recalcul des **132 réponses existantes**, sans génération/test/produit. [Référence frontage V2](../web/out/native-retained-frontage-full132-proof-v2/run-01/summary.json) : 8 395 demandes, 6 530 parents, 1 359 groupes / 7 889 membres ; brut logement 536 997,997 m², **5 479 insuffisants**, manque utile nécessaire **620 993,340 m²**. Besoin insular générique non calibré ; utile réel et ménages logés inconnus. Les 1 713 refus /152 espaces ouverts ne reçoivent aucun crédit.

| Source / résultat | Parents | Insuffisants | Manque nécessaire m² | Médianes brut / besoin m² |
|---|---:|---:|---:|---:|
| B06 Single | 1 683 | 1 540 | 238 159,94 | 38,49 / 210,96 |
| B14 Single | 1 966 | 1 607 | 157 351,74 | 62,52 / 151,92 |
| B15 Single | 1 522 | 1 363 | 138 011,04 | 69,30 / 157,68 |
| Groupes, toutes sources | 1 359 | 969 | 87 470,62 | 126,00 / 164,88 |

**85,9 % du manque reste dans les Singles.** Tous les membres ont un niveau ; 6 482 parents demandent compound. La prépose isolée des 712 entrées ajoute zéro brut, mais lève un prérequis de composition.

**Cause constructive ciblable.** Le [builder](../rust/crates/houses/src/native_assembly_builder.rs:208) verrouille le second membre sur la recette du premier, clone son descripteur (:218), exige les mêmes non-dimensions (:400). Pour B06, son nouveau membre nominal commence à 14×14 (:231) ; après échec, seul le petit descripteur déjà possédé est rejoué. Cette borne du chemin n’est **pas un minimum historique**. Sur 480 B06 arrêtés aux nécessaires (81 801,33 m² de manque), **276 ont un manque <196 m²**. Le garde commun ne distingue pas droits/portail/occupation/toit : aucun échec ne prouve une parcelle impossible.

Témoins exacts : [0012](../web/out/native-retained-frontage-full132-proof-v2/run-01/batches/0012/outcomes.json), `parcel-a2848c9e721f48be`, deux B06 : brut **116,644392 / besoin160,56** ; [0100](../web/out/native-retained-frontage-full132-proof-v2/run-01/batches/0100/outcomes.json), `parcel-74af988d1376171d` : **118,056798 /166,56**. Dans chacun, quatre propositions 14×14 refusées au garde commun, puis une copie native ~58–59 m² admise. Cela ne démontre pas la place d’un plus grand pavillon.

**Proposition bornée : second corps résidentiel hétérogène, toujours deux membres.** Seulement après échec de l’assemblage actuel, conserver le B06 entier ; choisir avant résultat **une seule** source B14 ou B15 selon une compatibilité d’assemblage explicite, puis dimensionner ce vrai corps pour le manque dans ses permissions natives. Au plus un resolve déterministe propre au membre, une construction/préparation, mêmes huit contrôles/quatre admissions et vrais terrain/liaison/portails/index. Aucun essai successif des deux recettes, étage ajouté, baisse de besoin ou remplacement d’un groupe réussi. Ancien parent entier sur échec ; programme unique. Les archives portent déjà une source par membre ; changer le choix et les invariants du builder, pas le nombre de membres.

**Palette admise ≠ style composé prouvé.** Les deux témoins sont inspired/era=any ; [palette](../rust/crates/houses/src/cultural_palettes.rs:18) et [catalogue](../rust/crates/houses/tests/javanese_data.rs:10) autorisent B06/B14/B15, mais pas B14/B15 en strict/ère M. Le [programme](../rust/crates/houses/src/programme.rs:59) leur donne, comme B06, rang Single=2 pour compound et compatibilité d’étage, pas un compound déclaré. La [provenance locale](../docs/sources/javanese-domestic-architecture.md) distingue corps domestique et gandok ; elle ne justifie pas un Joglo+annexe universel. Déclarer cette compatibilité avant code ; dimensions artistiques, aucune promesse d’habitabilité. Premier contrôle sur cas fixes, puis full132 et audit global de tous changements ; aucun gain présumé.

[Recalcul court](../web/out/java100k-capacity-review-current-v1/analyze.py), [agrégats](../web/out/java100k-capacity-review-current-v1/aggregates.json). Métriques de transport archivées ; archives lossless seules autorités physiques. **Aucune promotion autorisée.**
