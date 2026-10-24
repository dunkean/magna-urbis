# Couverture profil × échelle : décision depuis le code courant

24 octobre 2026 — lecture/recalcul de tables seulement. Prototype B06 suspendu : aucune implémentation écrite, aucune mutation produit/build/test/recherche historique.

**Décision : aucun des79 profils natifs ne possède aujourd’hui un plafond démographique culturel justifié et exploitable.** On ne peut ni déclarer Java100k incompatible depuis son déficit, ni recommander un autre profil comme capable de loger la même population. Le remplacement explicite de profil peut être proposé, avec population conservée et couverture inconnue affichée.

| Fait encodé / fichiers | Interprétation autorisée |
|---|---|
| `docs/CITY_VARIATION_VARIABLES.md` §§1.2–1.5 ; `urban/catalogue.json`79 profils,38 textes `scope` | Recettes artistiques et profils de plan ; aucun champ de plage culturelle démographique. `scope` n’est pas une borne. |
| `web/src/gen/urban/cultures*.ts`28 déclarations `scale`, toutes `max:megacity` ; `culture.ts:23`, `pipeline.ts:29–32`, `urban/index.ts:179` | Ancien clamp de population, pas couverture différenciée ; ne pas le réactiver pour réduire la demande. Les autres profils n’acquièrent pas une preuve par défaut. |
| `core/src/settlements/demographic_classes.json` ; `urban/kinds.rs:127–190` | Classe Métropole dès100k, morphologie multicentre dès200k ; camp automatique nomad/plains sous5k. Seuils de routage génériques, pas maxima culturels. Le forçage explicite précède ces règles. |
| `urban/composition.rs:14`, catalogue13 objets `growth.minPop` ; TS `culture.ts:177` | Changement de recette de croissance, pas preuve historique ni capacité ni limite supérieure. |
| `urban/culture.rs:985–1046`, `programme.rs:1336` | Correspondances source/pack/période ; emprunt déclaré refusé en strict. `coverage=shared-pack/declared-borrowing` décrit le routage, pas l’échelle couverte. |
| `houses/data/urban-admission.json`225 témoins,198supported/27refused ; `core/urban/functional-source-coverage.json` | Limites techniques réelles mais locales au contrat d’admission témoin/fonction/source. Emprise minimale, accès, niveaux/périodes/opérateurs ne certifient ni toutes dimensions ni un nombre d’habitants. Une recette témoin refusée n’établit pas l’impossibilité culturelle entière. |
| `terrainSettlements.ts:193`, `gen/options.ts:169` | `decor.maxPopulation` et5millions sont des limites carte/éditeur, pas culturelles ; hors objectif courant. |

Les plages de recettes permettent donc un **profil technique architectural** explicite (source/variante, mode/période, opérateur, niveaux, support, contraintes métriques, provenance). Elles ne donnent aucun plafond de population : il manque notamment nombre réel de parcelles admissibles, terrain/accès/occupation, surface utile et modèle démographique calibré. Les logements génériques ou les enveloppes ne deviennent pas des habitants logés. Java100k dispose de preuves datées d’exécution/admission sur corpus figé, avec refus et déficit réel ; couverture de sa capacité demandée et pertinence culturelle restent inconnues, pas interdites.

**Contrat commun proposé.** Une source future unique `rust/crates/core/src/urban/technical-coverage.json`, chargée par Rust et importée/projetée avec SHA côté TS, séparée de `CultureMapping.coverage`, contient des affirmations limitées à un chemin, une étape et une configuration versionnée :

```ts
{ schemaVersion:'technical-coverage-1',
  status:'established'|'not_covered'|'unknown',
  scope:{profileId,population,demographicClass,morphology,
    stage:'layout'|'architecture'|'physical_scene'|'detail',
    mode,period,executionPath:'native'|'legacy'|'unknown'},
  reasonCode:'no_scoped_evidence'|'declared_policy_refusal'|
    'native_operator_unsupported'|'verified_scoped_run',
  provenance:{kind:'native_contract'|'frozen_run'|'none',
    sourceVersion,sourceSha256,evidenceId} }
```

**Établie** : preuve/critères satisfaits à l’étape et au point/range réellement démontré, jamais interpolation automatique d’un essai à100k. **Non couverte** : refus ou capacité manquante explicitement encodé pour ce contrat précis ; absence de test ou déficit ne suffit pas. **Inconnue** : défaut en l’absence de preuve correspondante ; cela ne signifie ni interdiction ni garantie. Une exécution partiellement réussie peut être établie pour un export mesuré tout en restant inconnue pour capacité utile/détails. Aucun plafond numérique nouveau dans cette tranche.

**UI minimale immédiatement utilisable** : `unknown/no_scoped_evidence`, provenance `none`, catalogue existant non classé ; choix utilisateur d’un seul axe plan/parcelles/architecture, aperçu avant/après, validation explicite. Population/position/graines/période/mix/pins restent exacts ; valeurs inconnues importées conservées. Aucun fallback automatique, substitution à partir d’un déficit, remise à auto des autres axes ni alternative « garantie ». Un changement de modèle dérivé lors d’une régénération doit apparaître dans le nouveau contexte appliqué, jamais être attribué à l’ancien plan. Contrat transmis à parameters_ui ; aucun nouveau registre positif n’est nécessaire pour ce premier raccord.

## Décision produit ultérieure approuvée par Root

Un plafond historique reste absent. Root autorise désormais une politique éditoriale explicite, distincte : `local-profile-policy-1`. Les profils `maori-pa`, `inuit-camp`, `siberian-camp` sont proposés jusqu’à la classe canonique `town` incluse ; `city/metropolis/megacity` sont hors de cette portée PRODUIT, avec avertissement et choix explicite non bloquants, population conservée. Leur grammaire déclare core/village/hamlet, une phase, sans ring ni growth. Ce n’est pas une règle déduite pour tous les profils : `bastide` est un contre-exemple urbain à une phase. Java reste indéterminé et non bloqué.

Les candidats `european-organic`, `roman-core`, `medina`, `chinese` ont un motif vérifiable : ring/faubourg et plusieurs phases de croissance déclarées ; aucune capacité habitante n’est garantie. Les profils à croissance explicite depuis un camp, tels nomad/kraal, ne sont pas arbitrairement reclassés locaux par leur seul nom.

Petit catalogue source : `web/out/profile-intentions-contract-v1/profile-intentions.json`, SHA `8263d626373aef4b5a974db43b621e9814a1a80bfdec5b468b212f056ed23d96`. Fixtures limites/inconnus : `fixtures.json`, SHA `c62900fcf50537e5a07b116d5eece7f0f0a2163ba5de47f1d5dec1bc439ffdad`. Le maximum politique est un ID de classe partagé, aucun nouveau nombre de population dupliqué ; les points de fixtures dérivent des minima canoniques. Aucun benchmark million/scène n’est préparé. JSON transmis byte-exact à parameters_ui pour sa copie isolée PLAN ; import direct depuis une seule source. Aucune certification technique ou enforcement natif nouveau n’est annoncé par la seule présence de ce catalogue. Aucune modification produit de cet auteur.
