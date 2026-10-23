# C7921 — non-régression du correctif de matière du linteau

23 octobre 2026. **Les124 payloads enrichis et les124 résultats natifs sont tous identiques octet par octet à la production `ad10…`.** Aucun changement d’occupation en chaîne, d’admission, d’aire, de source, d’étage, de portail ou de feature compacte.

Comparaison hors natif du rejeu lancé par root :

- Avant : `web/out/java-c-nominal-terrain-production-proof/`, CLI `ad10d1f7f41dcf407d4832039da147586d460b1d4e8cf201b3379cfb35e23077`.
- Après : `web/out/java-c-lintel-material-proof/`, CLI `f116432baabe3e2bfbea1635cc0cf871676190fa326de123d4aded16fd55acb9`.
- Même C7921 intermédiaire, même ordre, graines, bridge et occupation cumulative ; source SHA `1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53`. Aucun nouveau replay natif exécuté pour cet audit.

## Résultats

| Vérification | Avant et après |
|---|---:|
| Plans admis / refus / ouverts | **6 225 / 1 689 / 7** |
| Objets admis strictement identiques | **6 225 sur6 225** |
| Admissions gagnées/perdues | **0/0** |
| Sources, variantes, étages, poses, surfaces modifiés | **0** |
| Portails gagnés/perdus | **0/0** |
| Droits GEOS | **6 225 vérifiés,0 violation** |
| Terrain des corps réels Ground Single | **6 225 vérifiés,0 violation** |
| Assises préparées | **2 174 vérifiées,0 violation** |
| Collisions globales d’occupation | **0** |

Les506 alertes brutes de source restent exactement héritées :458 écarts de proportion préexistants,86 écarts de minima dus à la soustraction de coordonnées (recouvrement entre catégories), maximum7,27nm et conformes à la grille native du millimètre. L’audit brut conserve son statut non nul ; le complément `findings.json` confirme l’antériorité et l’identité des dimensions/minima. Aucun assouplissement du contrôle natif ou du rapport pour ce correctif.

## Portée de la preuve

Dans ce corpus, **aucune feature n’est exportée dans `structural_features` ni dans `resolved.features`**, avant comme après. Le correctif de `PortalLintel` concerne la construction structurelle détaillée du portail, pas nécessairement ces plans compacts. La préparation légère B06 reste exclue ; les2 207 plans B06 sont eux aussi strictement identiques. L’absence de variation est donc une bonne preuve de non-régression de la planification, **pas une preuve que les détails de tous les styles sont inchangés**. Les tests dédiés aux linteaux, profils/coquilles et réalisations détaillées restent la preuve séparée de la correction matérielle.

Les surfaces et références du bilan C restent inchangées par identité des données : domestic+mixed435 443,72m² de plancher admis ; sous-ensemble comparable428 091,26m² pour1 593 811,30m² de référence dérivée,287 références inconnues. Aucune capacité habitante ou nouvelle validité intérieure annoncée. Aucun benchmark de temps ajouté.

Preuves : `web/out/java-c-lintel-material-proof/independent-audit/{comparison,batches,sites,rights-terrain,simple-ground-source,source-findings-history,findings}.json`, journaux `audit-stdout.log` et `findings-stdout.log`. SHA `comparison.json` : `c0012d6a7c589244749a92e6840818c0c94a5d83d27385911d5680a7a72242f5`.

Commandes hors natif employées :

```powershell
python web/scripts/java_combined_capacity_audit.py web/out/java-c-lintel-material-proof --before web/out/java-c-nominal-terrain-production-proof
python web/scripts/java_combined_capacity_findings.py web/out/java-c-lintel-material-proof
```

Le second script vérifie l’historique des alertes contre B11 ; la comparaison principale porte bien sur la production `ad10…`. Aucun fichier produit, core, catalogue ou corpus figé modifié.

## Export complet des profils natifs : identique

Contrôle complémentaire demandé pour la promotion : l’exemple `admission` a été compilé dans `web/out/houses-entry-feature-workspace/rust`, en `release/offline`, avec le target réservé `web/out/houses-next-proposal-target`. Les131 fichiers Rust/Cargo suivis sont restés identiques pendant la compilation, terminée sans avertissement. Le target a été libéré immédiatement après copie de l’exécutable ; aucun autre build ni serveur lancé.

Exécutable figé : `web/out/b06-feature-rights-isolated-proof-v2/admission-export/admission.exe`, SHA `7b09ad826d5ee7344a745cbe61e461d46288afb8c8961818e24eb32ff56783db`. Il a écrit uniquement le nouveau `candidate-lintel.json` dans ce dossier. Le fichier est **identique octet par octet** au canonique `rust/crates/houses/data/urban-admission.json` et au même fichier figé de la copie baseline0406 :

- 1 898 677 octets,225 profils minimum et421 profils de faisabilité ; registres et tous les autres champs également identiques.
- SHA commun `f9bbb5b4df9b18cf3a869cde96989075dce467a560c9e141a3b1363c362486ec`.
- `generator_version=houses-3` ; `source_sha256=2bfac9ffe776e3284affce17afa1abf67eae9378b822125cd3c4764f44715aaa`, égal aux octets recettes des deux copies.
- Comparaison JSON récursive complète : **zéro champ différent**. Il n’est pas nécessaire de reconstruire l’export0406 pour séparer un héritage absent de ce résultat.

Preuves figées dans `admission-export/` : les deux références, candidat, `before.json`, `build-proof.json`, `export-proof.json`, `comparison.json`, commande de comparaison et stdout/stderr. Les deux fichiers admission originaux ont été rehachés après l’export : inchangés. Aucun candidat publié dans `data/urban-admission.json`.
