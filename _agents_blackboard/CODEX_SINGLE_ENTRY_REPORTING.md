# Proposition de reporting Single, séparé du Strip

Extension appliquée après autorisation dans `web/scripts/native_entry_report.py` et `native_foundation_compare.py`. Aucun moteur ni rejeu natif. Le parseur Single précède désormais celui des traces `/4` ; ces dernières conservent leurs compteurs historiques.

Validation : **8/8 tests** (`python -m unittest native_entry_report_test native_single_reporting_test` depuis `web/scripts/`), dont les quatre précédents inchangés et quatre ajoutés. Reporting Python recalculé sur les deux corpus figés `native-entry-existing-door-cli-proof/replay/` : **tous les anciens agrégats et tous les anciens champs des lignes sont exactement identiques**, entrée et terrain, pour 125 + 111 admis. Fondations Strip : 101/83 ; Single : 0/0 dans ces anciens corpus ; totaux explicites 101/83. Preuve : `web/out/single-native-entry-reporting/legacy-compatibility.json`. Aucun rapport historique réécrit.

## Marqueurs produits

- Fondation réellement préparée/admission réussie : `Native ground-single foundation:`. Le marqueur Strip historique `Native ground-strip foundation:` reste inchangé.
- Succès : `Native planning entrance upgrade: final Single source, dimensions, floors and pose retained; 1/1 existing pose checked. No alternative door, rigid-pose retry, source selection or dimension search.`
- Échec après visual : `Native planning entrance deferred: final Single 1/1 existing pose; …`.
- Hors périmètre après décompression : `Native planning entrance deferred: final Single preparation unsupported: …`.
- Erreur pendant construction/préparation : `Native planning entrance deferred: final Single preparation failed before pose admission: …` (préfixe ajouté après la première compilation).

Les deux derniers cas ont **0 pose admise/testée par visual**, pas 1. Ils peuvent avoir payé une préparation ; le diagnostic ne permet pas d'en inventer le temps. Une recette inéligible au préfiltre, telle B01/flat_earth dans cette tranche, garde ses diagnostics historiques et demeure `outside_supported_scope`.

## `native_entry_report.py` : extension additive proposée

Conserver `parse_upgrade` historique et ses tests/regex pour Strip. Ajouter un parseur Single strict appelé **avant** celui-ci. Il reconnaît le texte `final Single` et exige le contrat `1/1 existing pose checked` pour un succès ; toute forme inconnue doit être signalée, jamais interprétée comme une pose Strip.

Une ligne Single ajoute :

```json
{
  "entryFamily": "single",
  "status": "upgraded",
  "entrySelection": "canonical_fixed_single",
  "posesChecked": 1,
  "alternativeDoorsChecked": 0,
  "successfulPose": "initial"
}
```

Pas de `canonicalPosesChecked`, `successfulAttempt`, `alternativeAttempt` ou `alternativeCount` sur Single : ces champs conservent leur sens historique Strip. Un report après visual a `posesChecked:1`, préparation impossible/erronée a `posesChecked:0`. Aucun champ `successfulPose` sur un échec. `entryFamily` est `strip` pour les deux traces historiques ou le marqueur de fondation Strip ; `single` pour les marqueurs ci-dessus ; autrement `outside_supported_scope` ou `unclassified` si une nouvelle trace d'entrée ne peut pas être interprétée. Ne pas inférer la famille d'après un seul volume, la culture ou le nom de recette.

Garder les agrégats historiques au même niveau :

- `successfulAttempts`, `entrySelections`, `successfulPoseKinds` et `successfulExistingAlternativeAttempts` reçoivent uniquement les lignes Strip ; un Single ne doit jamais alimenter leur branche `else` destinée aux portes alternatives.
- `entryOutcomes` garde la projection historique Strip : les lignes Single sont comptées `outside_supported_scope` dans cet agrégat de compatibilité. Exposer `legacyEntryMetricsScope:"strip"` pour lever l'ambiguïté.
- Ajouter `allEntryOutcomes` pour les vrais statuts toutes familles, et `singleEntry` contenant `outcomes`, `posesCheckedTotal`, `successfulInitialPoseCount`, `alternativeDoorsCheckedTotal:0`, `preparedBeforePoseFailureCount`, `unsupportedBeforePoseCount` et `sites` (IDs).
- Garder globaux `admittedBefore/After`, `lost/gained`, `changedPoses`, `localArchitectureChanges`, `areaChanges`, `styleChanges` et toutes les lignes individuelles. Ces invariants portent sur la scène entière, pas seulement sur Strip.

Publier la version `native-entry-replay-comparison-3` et expliquer la projection historique dans `scope`. Un ancien corpus sans nouveau marqueur doit reproduire exactement les anciens agrégats et champs de lignes existants ; seuls les nouveaux champs/version changent. Ne pas réécrire les rapports historiques déjà publiés.

## `native_foundation_compare.py` : audit physique explicite

Conserver `NATIVE_MARKER` comme alias du marqueur Strip pour les scripts qui l'importent ; ajouter `NATIVE_SINGLE_MARKER = "Native ground-single foundation:"` et une classification explicite. Deux marqueurs contradictoires sur le même bâtiment doivent produire une erreur d'audit, pas une préférence silencieuse.

Pour chaque ligne :

```python
strip = any(d.startswith(NATIVE_MARKER) for d in diagnostics)
single = any(d.startswith(NATIVE_SINGLE_MARKER) for d in diagnostics)
if strip and single:
    raise ValueError("Conflicting native foundation families")
row["nativeFoundation"] = strip  # ancien sens, pour comparabilité
row["nativeFoundationFamily"] = "strip" if strip else "single" if single else None
row["preparedFoundation"] = strip or single
if row["preparedFoundation"]:
    # Corps + structures natives exportées, mêmes calculs GEOS/raster existants.
    # Le passage nu ne devient pas une assise plane.
    ...
```

Conserver les agrégats historiques `nativeFoundationBuildings`, `nativeTerrainViolationBuildings`, `nativeGroundMaxErrorM`, `retainedPlanWouldExceedStepCount` et `retainedPlanTerrainErrorCount` calculés sur **Strip seulement**. Ajouter `singleFoundation` avec les mêmes informations sous des noms locaux (`buildings`, `terrainViolationBuildings`, `groundMaxErrorM`, `retainedPlanWouldExceedStepCount`, `retainedPlanTerrainErrorCount`). Ajouter `preparedFoundationBuildings` pour le total Strip+Single ; éventuellement `allPreparedTerrainViolationBuildings` pour la liste de sécurité commune. `rightsViolationBuildings` reste global et inchangé.

L'audit reconnaît uniquement les **Single admis avec ce marqueur**. Les reports restent des anciens plans proxy, donc aucune assise native n'est affirmée pour eux. La première tranche Single interdit tout feature supplémentaire et toute cour ; son assise est son corps réel, sa circulation complète reste soumise aux contrôles de droits existants. Pas de nouvelle tolérance géométrique ou de terrain.

## Contrôles hors moteur avant activation des deux scripts

1. Parser un succès Single, un échec visual et les deux échecs avant pose : comptes respectifs 1/1/0/0, zéro alternative ; trace Single malformée refusée.
2. Rejouer seulement le **reporting Python** sur les deux lots128 déjà figés `native-entry-existing-door-cli-proof/replay/` : mêmes métriques Strip qu'avec les scripts actuels, aucun calcul natif.
3. Une fois le nouveau CLI5 publié, rapport mixte sur ses fichiers : les succès Single alimentent uniquement `singleEntry`/`singleFoundation`; le nombre de préparations ne doit pas être présenté comme un nombre d'intérieurs validés.
4. Le rapport de détail `interiors:true/false` demeure la seule preuve des résultats intérieur/extérieur. Un marqueur d'entrée n'en tient pas lieu.

## Note numérique du test figé

Le token mondial original a416 est `9461.814304288533`, bits IEEE-754 correctement arrondis `40c27ae83b1f781f`. Le parseur historique `serde_json` sans `float_roundtrip` le lit ici comme `9461.814304288531`, bits `40c27ae83b1f781e`. La reprojection depuis l'archive locale bit-exacte donne le premier. Écart : **1 ULP = 1,8189894035458565e-12 m**. Le test autorise cette seule ULP pour les champs mondiaux figés, avec topologie exacte ; archive/paramètres/pose restent stricts. Ni Cargo/serde ni les gardes d'admission n'ont changé.
