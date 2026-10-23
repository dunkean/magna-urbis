# V2 terrain — complément des 288 gains de l’ancien corpus Java

23 octobre 2026. CLI isolé `9f11cd2f66f27141f40e9755f628573202468d00c1c60bc9e63896cb43ed3791`. Ce complément utilise le rejeu complet déjà réalisé par root dans `web/out/initial-terrain-v2-isolated-proof/java-full`. Il ne relance ni les 1 752 demandes, ni l’audit global droits/collisions, ni un benchmark de coût.

**Les 288 gains sont tous des B14/default, un étage, Single/Ground.** L’audit indépendant supplémentaire du corps réel confirme, pour les 288 : minima de source × taille et minima natifs de pièces, maxima inspirés existants, proportions, identité des niveaux, support au sol et graine conservée. Les bornes raster bilinéaires calculées sur l’emprise réelle passent : pente, différence d’altitude autorisée, eau et altitude du bâtiment. Aucun de ces gains n’a de structure porteuse externe à ajouter au corps. Cela couvre aussi **les 76 gains sans assise préparée/entrée native retenue**, en plus des 212 marqués. Erreur d’altitude maximale : **1,602 × 10⁻⁹ m**.

Les **463 traces** sont contrôlées dans tous les résultats, y compris les refus : **288 succès et 175 refus**, 3 622 évaluations du guide au total, **au plus 8 par site, 1 construction et 1 admission supplémentaires**. Les 175 refus n’ont produit aucune construction ; tous les gains ont leur trace. Ces compteurs excluent les contrôles ordinaires du terrain lors de l’admission finale. [Résumé](../web/out/initial-terrain-v2-isolated-proof/java-full/audit-detail/gain-audit-summary.json), [288 fiches](../web/out/initial-terrain-v2-isolated-proof/java-full/audit-detail/gain-audit-sites.json), [traces exactes](../web/out/initial-terrain-v2-isolated-proof/java-full/audit-detail/recovery-traces.json).

## Les anciens plans ne sont pas tous identiques octet par octet

Sur **1 010 anciens admis**, **978 objets JSON sont byte-identiques**, **32 diffèrent**. Aucune perte d’admission ni changement de source/étage n’est introduit, mais la formulation « tous les anciens objets inchangés » serait fausse.

- 30 différences concernent `roof_footprint`, 20 des surfaces compactes, 17 les coordonnées de pose/sol/corps/circulation/entrée et volumes associés.
- Écart numérique décodé maximal : **7,153 × 10⁻⁷**, sur un sommet de surface locale de lot conservé dans `resolved`. Aucun epsilon n’est utilisé pour déclarer ces objets identiques ; les différences exactes restent archivées.
- Un diagnostic change : retrait non disponible parce que l’intersection arrière était déconnectée/trouée/trop complexe, puis parce qu’aucun droit arrière ne reste derrière tous les segments d’accès. Le résultat retenu conserve son admission. L’occupation cumulée a changé avec les nouveaux bâtiments ; ce changement de contexte ne doit pas être masqué par une comparaison limitée aux recettes et aux aires arrondies.

[Différences complètes des 32 objets](../web/out/initial-terrain-v2-isolated-proof/java-full/audit-detail/old-object-differences.json). L’audit global précédent de root reste vert : 1 298 droits, 858 assises préparées, aucune collision. Il n’a pas été recalculé inutilement ici.

## Deux réalisations sur les archives exactes

Le préfixe **des cinq demandes originales du lot 005** conserve les voisins enrichis et l’ordre intra-lot. Seuls deux plans y sont admis, indices **320** et **324** ; leurs fragments JSON sont **byte-identiques aux plans du rejeu complet**, y compris l’archive compacte. Les trois autres résultats restent les mêmes refus.

| Témoin | Entrée native retenue | Extérieur | Intérieur |
|---|---|---|---|
| 320 — `parcel-72539774c3788002` | Oui | Passe | Passe |
| 324 — `parcel-571f6fddf3b9f0aa` | Non | Passe | Refus : `Native interior entrance differs from the retained planning connection` |

Ce refus préserve le plan urbain ; aucun garde n’a été relâché. **L’admission d’un nouveau corps ne garantit donc pas son intérieur**, surtout sans entrée retenue. [Manifest et preuve de reproduction](../web/out/initial-terrain-v2-isolated-proof/java-full/audit-detail/details/manifest.json).

Cette amélioration concerne **l’ancien corpus à souhait `row`** : 1 010 → 1 298 admis, 735 → 447 refus, 7 ouverts. Sur **C 7 921**, les 124 lots restent entièrement identiques et aucune récupération ne s’exécute, faute de souhait `row` ou forte continuité. Ne pas transposer les 288 gains à cette nouvelle ville ni en déduire une capacité de population.

Scripts propres au complément : `web/scripts/java_v2_gain_audit.py` (hors natif) et `web/scripts/java_v2_detail_proof.py` (un préfixe de cinq demandes, deux détails extérieurs/intérieurs). Aucun fichier produit, catalogue ou Rust modifié.
