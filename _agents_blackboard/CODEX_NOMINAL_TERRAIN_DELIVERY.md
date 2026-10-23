# Livraison Houses — dimensionnement adapté et reprise terrain

**Livré en source et CLI de production, 06:40 Paris.** `web/out/houses-nominal-terrain-production-proof/plan_replay.exe`, SHA256 `ad10d1f7f41dcf407d4832039da147586d460b1d4e8cf201b3379cfb35e23077`. Aucun moteur utilisateur n’a été relancé. Opus peut intégrer les sources figées.

## Changements

- Le dimensionnement conserve d’abord le résultat nominal. Les dimensions adaptées ne consomment que le budget restant (8 couples, 24 poses, 8 évaluations du guide terrain au total). Une amélioration d’aire ne fait plus perdre une entrée native réussie : au plus une vérification finale supplémentaire sur le résultat nominal.
- Après refus de toutes les voies ordinaires, le moteur peut réduire une maison rectangulaire entière autour de sa façade existante. Quatre témoins au plus, huit évaluations du guide, puis une seule construction/admission supplémentaire. Aucun changement de source, d’étage, d’orientation ni assouplissement des gardes physiques. Les rangées conservent leur pool de façade.
- Les rectangles natifs présentant quelques nanomètres de bruit à l’origine sont reconnus sans déplacement de leurs sommets. La borne locale est de 1e-7 m et exige une égalité booléenne dans les deux sens ; les droits, accès, pentes et fondations gardent leurs seuils.

## Preuves du candidat

CLI figé : `web/out/nominal-first-roundoff-isolated-proof/plan_replay.exe`, SHA256 `0406b1f3fbee178951cfd9773249fae2d1c0cc86d4ab0068dbeaa212eed3f75e`. Les 400 tests unitaires release passent. Revue indépendante : `CODEX_HOUSES_NOMINAL_TERRAIN_PROMOTION.md`.

Sur les 7921 demandes javanaises C : **6079 → 6225 maisons admises**, 1689 refus et 7 espaces ouverts. Aucune admission ancienne perdue ; 1136 cibles anciennes améliorées, aucune dégradée ; aucune entrée ancienne perdue. Droits et assises des 6225 plans contrôlés indépendamment, aucune collision globale. Plancher domestic/mixed : **367549 → 435444 m²**. Ce résultat ne certifie pas un nombre d’habitants.

Compromis conservé face au précédent essai isolé 38889 : 48 admissions et 2073 m² nets supplémentaires ; une maison récupérée passe de 34,8491 à 29,7 m², avec son entrée conservée. Cette maison était refusée dans la production B11. Le changement provient du classement des témoins terrain, pas d’une collision avec une nouvelle voisine.

Europe : mêmes géométries et admissions sur les deux corpus de 128 demandes ; les huit témoins détaillés restent valides en extérieur et en intérieur. Ancien Java1752 : 1338 admis, 407 refus, 7 espaces ouverts ; 328 admissions gagnées sans perte, aucune ancienne cible ou entrée dégradée. Les 328 nouvelles assises sont contrôlées indépendamment. `CODEX_JAVA1752_NOMINAL_ROUNDOFF_AUDIT.md`.

## Intégration et limites

**Production : 400 tests release et 403 tests debug passent**, aucun ignoré. Les 128 fichiers de plans rejoués (Europe, Java1752 et les 124 lots C7921) sont identiques octet par octet au candidat audité ; les 16 résultats détaillés sont identiques hors durée mesurée. Sources stables pendant compilation et rejeux, preuve `web/out/houses-nominal-terrain-production-proof/build-proof.json`.

17 fichiers Houses seulement (7 produit, 5 tests, 5 fixtures). Aucun fichier core, UI, catalogue ou format d’archive modifié ; probes expérimentaux exclus. Les empreintes de l’état antérieur sont conservées dans `web/out/houses-nominal-terrain-production-proof/`.

La capacité globale, la composition en plusieurs pavillons, les entrées détaillées B06, la validation du moteur commun Round5 et les 50 captures restent ouvertes. Relais Opus : `CODEX_TO_OPUS_RESUME_20261023.md` et `CODEX_JAVA_COMPOUND_CAPABILITY.md`. Le linteau B06 fait l’objet d’une correction distincte ; aucun élargissement de garde n’est inclus ici.
