# Golden maison : migration contrôlée vers houses-3

23 octobre 2026. Le candidat a été **reconstruit nativement deux fois**, depuis la configuration conservée, avec le CLI figé avant l’optimisation des propositions. Les deux sorties sont identiques octet pour octet ; contrat TypeScript valide et trois entrées invalides refusées. Aucun Cargo, serveur ou export catalogue lancé. Copie canonique autorisée puis effectuée : mêmes octets et checksum relu ; ancien golden conservé dans la preuve.

## Identité et preuve conservée

- CLI : `web/out/native-entry-contact-cli-proof/houses.exe`, SHA256 `d494aa3c874cff6e67819b1786bedebc7cf17e3f427cd04ccbd72e423617b9ce`.
- Commande depuis `rust` : `houses.exe --input fixtures/houses/config-reference.json`. Stdout capturé en octets par Python, sans réencodage PowerShell.
- Ancien `house-contract-v3-proof/before.json` : SHA256 `a5bf95bd8b88d764e6abc9b0dc8301eacda21d056711aecb6475116d61eabd4a`, 19 556 octets.
- Configuration identique : SHA256 `aed6d7e0cfdc9e61f52cce796abfdf50eef1fc8573f925d4ec6dad14d3009fce`.
- Candidat `house-contract-v3-proof/candidate.json` : SHA256 `9d97cabf1fc8ab85ec0f2aa19a9d1a54edc55223379229449e1823b8230924ca`, 19 704 octets.

EUR-MED-B01/default, un étage, graine UTF-8 `étoile 🏠`, variation zéro : 1 corps, 1 pièce, 2 murs, 8 features, 1 portail, 16 sommets de toit avant et après. `native-runs.json` conserve les deux invocations et leurs checksums ; leurs durées ne constituent pas un benchmark.

## Les 28 changements exacts

| Groupe | Changements | Cause et portée |
|---|---:|---|
| Versions | 2 | `houses-2→houses-3`, `atlas-houses-2→atlas-houses-3` |
| Passage + opening_surface | 4 coordonnées | Bord extérieur y=10,05→9,700000000000001 m ; l’ouverture physique reste y=9,5 m, largeur 0,85 m, mêmes nœuds/mur/id. La profondeur extérieure est désormais 0,20 m au lieu de recopier le gap intérieur. |
| Feature du linteau | 2 coordonnées | Même passage natif copié par `portal_with_profile`, même réduction extérieure de 0,35 m. |
| Empreintes des deux murs | 16 coordonnées | Résultats des `intersection(wall, passage)`/`difference(wall, passage)` recalculés avec ce passage. Écarts numériques de l’ordre de 3×10⁻⁹ m, aucun sommet ajouté/supprimé. |
| Partitions de niveau | 4 coordonnées | Occupation/résiduel dérivés des murs recalculés ; écart maximal exact 0,000000014901161 m. |

Toutes les valeurs sont listées sans epsilon dans `comparison.json`. Les écarts des booléens sont décrits, pas masqués dans le checker. **Recette, variante, rôle, transform, lot, partition principale, niveaux, corps, pièces, site_context, toit, diagnostics, settings et matériaux sont identiques.** Les seuls déplacements macroscopiques sont les six coordonnées de la coupe/du linteau. Aucun ancien Resolved n’a été relabellisé.

Le code causal est `access.rs::portal_with_profile` : le passage devient ouverture et feature du linteau, découpe le mur par différence et son linteau par intersection. `engine.rs` recalcule ensuite les partitions de niveau depuis les murs. Cette propagation explique la localisation des petits écarts ; il n’existe aucune tolérance générale autorisant des changements supplémentaires.

## Contrôles et actualisation effectuée

```powershell
python _agents_blackboard/audit_house_contract_fixture.py compare _agents_blackboard/house-contract-v3-proof/candidate.json
node _agents_blackboard/check_house_contract_candidate.mjs _agents_blackboard/house-contract-v3-proof/candidate.json
```

Les deux passent (le premier indique volontairement `review_required` dès qu’un delta existe). Le validateur natif TS accepte le candidat, conserve la graine Unicode et refuse null, mauvais schéma et une orientation null dans un JSON valide. `ts-contract.json` conserve ce résultat.

Après accord root, les octets exacts du candidat ont été copiés vers `rust/fixtures/houses/batch-reference.json` ; son checksum relu correspond au candidat, et l’ancien `before.json` est intact (`canonical-copy.json`). Le contrat TS a été réexécuté sur la fixture canonique : PASS. Les trois consommateurs web `urbanBuildingDetails`, `urbanBuildingExport`, `urbanBuildingLod` passent : **20/20 tests**. Après compilation de l’optimisation d’accès, root vérifiera les mêmes octets sur cette fixture et les sorties retenues du corpus. Le script officiel `rust/scripts/check-house-contract.mjs` appelle Cargo : il n’a donc pas été exécuté par cet agent pendant la compilation commune.
