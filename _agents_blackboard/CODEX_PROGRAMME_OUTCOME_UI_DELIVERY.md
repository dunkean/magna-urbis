# Bilan natif — consommateurs UI promus

Promotion autorisée par root après le gel frontend. Les neuf fichiers de `web/out/programme-outcome-ui-proposal-v2/manifest.json` ont été publiés aux empreintes exactes V2, après vérification de toutes les bases. La proposition avait huit tests isolés verts selon root ; ses modules sont identiques à V1 dont le contrôle TypeScript isolé était vert. Aucun Vitest, tsc, Cargo, natif, navigateur ou serveur exécuté par l’auteur pendant cette promotion.

Preuve reproductible : [manifest](../web/out/programme-outcome-ui-production-delivery/manifest.json), SHA256 `2e4306ab6bf379edd27ba71dd23c65fd0f30681e548ccd2bb8a89e30c1858a19` ; [patch](../web/out/programme-outcome-ui-production-delivery/promoted.patch), [vérification des dix empreintes publiées](../web/out/programme-outcome-ui-production-delivery/verification.json). Les octets avant/après sont conservés dans `before/` et `after/`. Diffcheck limité vert ; les avertissements Git LF/CRLF ne changent pas les octets publiés.

| Fichier produit | Delta limité |
|---|---|
| `rust/bridge/urbanArchitecture.ts` | Type facultatif rétrocompatible du rapport natif, sans modification du transport. |
| `web/src/render/programmeOutcome.ts` | Validation/version et copie immuable de scalaires ; lignes de présentation communes. |
| `web/src/ui/urbanBuildingProjection.ts` | Copie facultative du rapport, sans parents ni archive. |
| `web/src/render/buildingInspection.ts` | Rapport conservé séparément du programme actuel ; absent sur les previews. |
| `web/src/ui/cityInspector.ts` | Présentation du rapport dans l’inspection. |
| `web/src/ui/urbanBuildingsPanel.ts` | Import ligne11, helper lignes82–85, appel dans la sélection ligne292 ; aucun autre handler changé. |
| `web/tests/programmeOutcomeConsumers.test.ts` et deux fixtures | Huit tests V2 exacts, dont C1358 minuscule, anciennes données sans rapport et passage par les chunks froids. |
| `web/src/ui/terrainUrban.ts` | Une substitution de texte dans `appendArchitectureOutcome` ligne1207 : « demande actuelle du site ». Le calcul et les handlers sont inchangés. |

Le rapport porte sur l’emprise finale native et sa cible conservée, avec déficit/excès et tolérance ±10 %. Il ne certifie ni programme complet ni capacité habitante ; les ménages logés restent inconnus. Les anciens plans restent explicitement sans rapport. Aucune modification de géométrie, recette, sélection, édition, annulation, export froid, rendu ou génération.

`parameters_ui` a reçu le SHA256 du panel final `79ab9d426003c8814e007c79b9ca4919b39bca5e9dbeb56c0b0f76fecde708f0` et les trois régions. Son futur delta intention/fonctions devra préserver ces ajouts par intégration ciblée.

## Validation centrale proposée

Depuis `web`, exécuter sur l’état final coordonné :

```powershell
npx vitest run --project fast tests/programmeOutcomeConsumers.test.ts tests/buildingInspection.test.ts tests/urbanBuildingProjection.test.ts tests/urbanBuildingsPanelState.test.ts tests/urbanProgrammeEvidence.test.ts tests/urbanColdCitySession.test.ts tests/urbanColdCityEdit.test.ts tests/urbanBuildingDetails.test.ts tests/city3dColdConsumer.test.ts
npm run typecheck
```

Les cinq premiers fichiers sont les consommateurs directement concernés ; les quatre derniers couvrent les interactions de sélection/chunks/détails conservées. Une construction CityBench peut être ajoutée par root à son lot final. Les tests antérieurs isolés et la suite fast en cours ne constituent pas une validation de ce nouvel état fusionné. Aucun résultat navigateur n’est revendiqué.
