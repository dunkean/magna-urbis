# Archives au zoom : preuve bornée sur 64 plans réels

23 octobre 2026. **Le décodage ne matérialise pas les 64 architectures : seul l'enregistrement demandé est décodé en texte puis parsé.** Un accès froid décompresse cependant l'archive entière et scanne ses séparateurs avant cette sélection. Aucun changement de production ne paraît nécessaire sur ce point.

Source : les 64 plans Java admis de `web/out/java-row-selection-proof/after-plans.json`, SHA `64b51e448a1eff6b47b3507bcabc870db6bbeaa4e52e04530685687bb6699b1c`. Corps, graines et `resolved` inchangés ; seuls refus/espaces ouverts sont omis de ce lot de stockage. Aucune ville, UI, génération native ou serveur lancé.

Le harness utilise les vrais `archivePlanBatch`, `registerPlanArchives` et `resolveArchivedPlan`, puis le même lot après JSON export/restore et `structuredClone`. Les mesures de latence sont séparées de l'instrumentation temporaire de `JSON.parse`/`TextDecoder`, limitée au processus de benchmark. Les fichiers de production restent intacts.

| Mesure Node24, voie asynchrone | Résultat |
|---|---:|
| Archive brute NDJSON / gzip | 341 102 / 22 187 octets |
| Un enregistrement froid, 7 répétitions | médiane 26,474 ms ; min25,167 / max27,175 |
| Huit sélections concurrentes, archive froide, 5 répétitions | médiane 27,063 ms ; min24,773 / max27,593 |
| Sélections chaudes des 64 enregistrements | médiane 0,0191 ms ; min0,0132 / max0,0488 |
| Cache après sélection | 1 entrée / 400 936 octets comptabilisés |
| Limites du module | 2 entrées / 8 MiB |

La trace froide donne **un seul parse de 5 443 octets**, au lieu des 341 102 octets de l'archive. Les huit sélections concurrentes donnent huit parses totalisant 39 500 octets, **un seul décodage froid partagé** ; l'accès chaud donne un parse et aucun nouveau décodage froid. Le compteur utilise `stats.misses` sur ces données valides : `decodeUncached` appelle exactement une fois `gunzipPlanBytes` après vérification d'intégrité. Il ne s'agit pas d'un spy sur fflate.

`compactPlanArchive.ts:215` conserve les offsets des lignes ; `:265` décompresse et compte les octets retenus ; `:296` sélectionne `raw.subarray(start,end)` avant `TextDecoder` et `JSON.parse`. Chaque lecture chaude alloue encore un objet indépendant pour le seul plan choisi, volontairement : les callers ne peuvent pas muter un objet global partagé. L'archive/cache ne conserve pas ces objets parsés.

Les 64 résultats passent `deepStrictEqual`, l'entrée est inchangée, les registres restaurés fonctionnent et les résultats successifs sont indépendants. Les **5 529 f64 encodés, dont 58 zéros négatifs**, restent exacts. Le fixture ne contient aucun `-0` natif non encodé dans `resolved` ; on ne généralise pas cette preuve à du JSON arbitraire, dont `JSON.stringify` normalise le `-0` ordinaire.

Rapport : `web/out/frozen-plan-archive-bench/report.json`, scène archivée adjacente. Script : `web/scripts/benchmark_frozen_plan_archive.ts` ; il refuse de réécrire le dossier. Exécuté depuis `web` avec `node --expose-gc --import tsx scripts/benchmark_frozen_plan_archive.ts`. Typecheck isolé du script passé. Les snapshots mémoire de processus ne mesurent pas le heap isolé du cache et excluent celui des workers fflate ; la taille comptabilisée du cache est la mesure stable. Ces latences Node ne sont ni un gain avant/après, ni un temps de frame navigateur, ni une estimation de mémoire d'une ville.
