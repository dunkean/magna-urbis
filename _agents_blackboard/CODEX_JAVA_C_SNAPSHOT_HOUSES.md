# Java — snapshot intermédiaire C, bâtiments natifs

23 octobre 2026. **6 079 plans admis, 1 835 refus, 7 espaces ouverts sur 7 921 demandes.** Ce résultat évalue les parcelles du snapshot C déjà archivé ; ce n’est ni la ville R5 fusionnée finale, ni une reproduction de l’interface utilisateur, ni une capacité de 100 000 habitants démontrée.

## Provenance et protocole

- Entrée : `web/out/capacity-sweep/java100k/after/requests.json`, 52 698 748 octets, SHA-256 `1d3fc52454e46a080d186aaa75a3fa99cde9b5291ef85b483860a0a04c39df53`. Le producteur urbain exact reste **inconnu au niveau du SHA du binaire**. Le snapshot correspond à 2 429 blocs / 9 028 parcelles ; seuls les 7 921 sites exportés sont évalués ici.
- Maisons : CLI figé `web/out/b11-native-entry-isolated-proof/plan_replay.exe`, SHA `c786a95f5e995a0e3ce2529f0733e0dbbe9566b2de9737b1e51b3da6e554268e`.
- Appel réel de `streamArchitectureSource`, **124 lots ordonnés** (123 × 64 + 49), graines et configurations d’origine conservées. `urban_case_replay` exporte un tableau sans réglages de maisons : header utilisé `{schema_version:"1"}`, sans réglages reconstruits. `parcel_fit` absent conserve son défaut natif.
- Une occupation cumulative continue, puis occupation intra-lot native. Les 427 références de voisins ajoutées entre lots sont comparées à un inventaire indépendant des emprises. Mutation du clone consommateur et immutabilité des entrées contrôlées. Pas d’accumulateur de toutes les scènes.
- Tous les payloads enrichis, sorties, stdout/stderr et hashes sont conservés dans [la preuve](../web/out/java-r5-capacity-houses-proof/manifest.json), sous `after/000` à `after/123`. Aucun serveur, génération urbaine ou détail intérieur supplémentaire.

## Résultats et limites géométriques

| Fonction | Admis | Refus |
|---|---:|---:|
| Domestic | 5 547 | 1 532 |
| Mixed | 467 | 231 |
| Workshop | 21 | 14 |
| Collective | 28 | 28 |
| Warehouse | 16 | 30 |

Les sept `open_space` sont ouverts. Styles effectivement admis : B06 Joglo **2 207**, B14 Kampung **2 125**, B15 Limasan **1 747** ; aucune autre source. [Rapport détaillé](../web/out/java-r5-capacity-houses-proof/audit-summary.json).

**GEOS : aucun dépassement des droits sur 6 079 plans, aucune collision globale des occupations.** Les 2 094 assises explicitement préparées Single passent aussi l’audit raster indépendant (erreur maximale d’altitude 2,95 × 10⁻⁹ m). Les 3 985 assises non marquées ne reçoivent pas cette certification indépendante. Tolérances : 10⁻⁴ m² pour les droits/collisions, 10⁻⁶ m/degré pour le terrain. [Audit complet](../web/out/java-r5-capacity-houses-proof/rights-terrain-audit.json).

2 094 plans retiennent une entrée native ; cela ne prouve pas un intérieur réalisable. Aucun intérieur n’a été demandé. Les recherches budgétaires observées respectent 8 dimensions / 24 admissions ; guides terrain au plus 8 évaluations / 1 réduction. Somme des temps natifs : **10 404 ms**, un seul passage de processus séparés ; hors démarrage, bridge, JSON et interface, sans conclusion de performance.

## Plancher structurel : le déficit reste visible

Sur **7 777 sites domestic + mixed** : 6 014 admis, 1 763 refus, aucun résultat ni niveau inconnu. Surface des niveaux réels : **367 549,45 m²**. Les usages commerciaux du mixed restent inclus ; ce n’est pas une surface habitable nette.

Sur les **7 490 sites à référence complète** (5 799 admis / 1 691 refus), le plancher admis vaut **360 325,64 m²**, face à **1 593 811,30 m² de référence dérivée** : cible d’emprise × préférence d’étages, ici `[1,1]`. Les 287 sites sans référence restent séparés. Refus = zéro plancher admis. Aucun habitant ou ménage n’est extrapolé. [Mesure et provenance](../web/out/java-r5-capacity-houses-proof/structural-floor-programme-evidence.json), SHA `2389e0e12196d8cef79187b999dfed93e79cc262bdbf970e8715d357c76b35f0`.

## Causes finales des refus et alerte fonctionnelle

| Famille du dernier refus | Sites |
|---|---:|
| Fondation / pente | 1 542 |
| Connexion à l’accès | 217 |
| Domaine / composition | 41 |
| Cible hors plages de l’enveloppe fonctionnelle déclarée | 35 |

Ce classement regroupe les préfixes des messages finaux, pas toutes les sources tentées. Les messages complets et les causes précédentes restent dans [refusals.json](../web/out/java-r5-capacity-houses-proof/refusals.json) ; [regroupement, rôles et témoins](../web/out/java-r5-capacity-houses-proof/refusal-categories.json). Les 35 incompatibilités fonctionnelles concernent 11 auberges et 24 greniers. Résultat de ces rôles : auberges 0/12, greniers 2/30.

**Alerte à Opus : 26 `worship.shrine` sont admis via un pin B14 hérité du producteur, plus un `civic.hall` et un `civic.bathhouse`, également B14.** Le moteur dit explicitement `unsupported functional composition; retained native fallback`. Ce sont des enveloppes admises, pas des sanctuaires, halles ou bains réellement décrits. Les **28 identités exactes, dont les 26 sanctuaires**, pins d’entrée, sources résultantes, diagnostics et hashes des lots sont dans [legacy-service-pins.json](../web/out/java-r5-capacity-houses-proof/legacy-service-pins.json). Ne pas compter cette admission comme une réussite fonctionnelle.

La suite prioritaire vient des **maisons admises trop petites**, distinctes de ces refus : voir [diagnostic par recette et rôle](CODEX_JAVA_C_UNDERSIZING.md). Aucun dénominateur de l’ancien corpus 1 752 n’a été réutilisé.

Reproduction : `npx tsx scripts/java_capacity_snapshot_replay.ts` depuis `web` (refuse un dossier déjà présent), puis `python web/scripts/java_capacity_snapshot_audit.py`, `node web/scripts/architecture_floor_programme_proof.mjs web/out/java-r5-capacity-houses-proof` et `python web/scripts/java_capacity_undersizing.py` depuis la racine. Les trois dernières opérations ne font aucun calcul natif.
