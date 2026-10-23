# B06 : préparation légère, preuve ciblée du 23 octobre 2026

**Prototype isolé, non promu.** Les quatre tests ciblés ont passé : deux tests d’exclusion, un test d’égalité des opérateurs structurels et un test sur trois plans réels. Les trois entrées préparées par le wrapper léger sont retenues, puis les trois réalisations extérieures et les trois réalisations intérieures réussissent. Journal : `web/out/b06-light-native-proof/targeted-tests.log` ; résultats détaillés : les trois JSON voisins. La suite complète et les replays de corpus restent à valider par root.

Mise à jour après cette preuve ciblée : la suite complète V1 a passé 408 tests, mais le rejeu Java1752 révèle quatre régressions de surface causées par le repli nominal désormais activable. **V1 non promouvable** ; voir `CODEX_B06_LIGHT_JAVA_AUDIT.md`. Une V2 isolée corrige cette sélection, en attente de ses propres tests/replays. Les mesures ci-dessous décrivent la V1 ciblée, pas un résultat global de V2.

Le portail testé est celui réellement choisi par la préparation légère. Aucun portail de l’oracle détaillé n’est substitué. Chaque cas conserve sa recette, sa variante, ses dimensions, ses niveaux, ses cours, son angle et sa translation. L’archive résolue est identique hors entrée. Les surfaces mondiales du corps et du toit restent identiques.

| Témoin / parcelle | Cible m² | Corps avant = après m² | Toit avant = après m² | Écart d’assise m |
|---|---:|---:|---:|---:|
| Modéré / `6eb3a97789ba9002` | 253,8 | 22,784008 | 33,824900 | 0,507767 |
| Grand déficit / `bd9402b6933ca702` | 726,8 | 219,781141 | 252,294237 | 0,735742 |
| Cible atteinte / `ad8c122686be00df` | 465,3 | 465,300000 | 490,397577 | 0,676282 |

Ce changement répare l’entrée et permet le rejeu intérieur ; il n’augmente pas les surfaces ni la capacité. Les deux déficits restent présents. Le nom d’élévation `platform` ne définit pas un support : ces trois corps sont réellement `Ground`, à hauteur zéro, sur un seul niveau. La limite d’assise de 0,75 m reste inchangée.

La cause corrigée est l’absence, dans l’ancien squelette léger, des opérations physiques `four_master_posts` et `open_sides` déjà exécutées par le détail. Le prototype partage leurs opérateurs natifs et la construction du mur extérieur, avec les mêmes paramètres effectifs, matériaux, identifiants et ordre. Il prépare quatre poteaux, le cadre de la face ouverte et le mur extérieur restant avant de choisir le portail. Les trois portails traversent cette face déjà ouverte : aucun nouveau `PortalLintel` n’est attendu dans cette unité légère. Le linteau générique corrigé appartient à la livraison précédente.

Le point d’entrée mondial se déplace respectivement de 5,999 m, 4,750 m et 23,937 m ; le bâtiment ne bouge pas. Le connecteur public est donc réellement recalculé et contrôlé. Toutes les pièces structurelles après découpe restent dans les droits et l’occupation ; seuls les éléments porteurs au sol participent à l’assise. Les gardes cadastre, réserves, voisins, toiture et terrain restent actives.

| Témoin | PlanBuilding JSON, octets avant → après | Archive compacte, octets avant → après | Occupation avant → après, m² |
|---|---:|---:|---:|
| Modéré | 9 705 → 20 725 | 4 720 → 5 274 | 23,408008 → 30,649677 |
| Grand déficit | 9 958 → 19 511 | 4 986 → 5 540 | 220,274841 → 220,284841 |
| Cible atteinte | 10 458 → 21 487 | 5 466 → 6 020 | 466,496693 → 488,353138 |

Chaque sortie passe de zéro à six features structurelles. L’archive augmente de 554 octets ; le plan complet de 9 553 à 11 029 octets. Les unités légères font 8 957 à 9 397 octets sérialisés, avec zéro pièce et zéro face de toit. Ce sont des volumes de transport JSON, pas une borne mémoire heap ou une mesure de vitesse. Le temps total des quatre tests est 0,20 s, sans comparaison chronométrée isolant le wrapper.

Le wrapper intervient seulement dans la finalisation d’entrée, pas dans les poses intermédiaires du budget. La préparation est réutilisée dans cet appel via `PreparedPlan.foundation`. La sauvegarde nominale existante peut finaliser l’adapté puis le nominal si l’adapté perd son entrée : une préparation par appel final ne signifie donc pas une seule préparation par bâtiment. L’occupation supplémentaire, surtout +7,242 et +21,856 m² dans deux cas, peut changer les voisins admis ensuite ; aucune identité globale des corpus n’est encore revendiquée.

Fichiers à promouvoir **si les corpus passent**, par hunks comparés à la production et non par copie complète du workspace isolé, préfixe `rust/crates/houses/` :

- `src/features.rs` : extraction et partage des opérateurs natifs ; détail complet conservé dans son ordre.
- `src/engine.rs` : primitives communes du mur, préparation finale Single sous gardes physiques, accès et deux registrations des nouveaux tests légers seulement. Exclure toute registration d’oracle héritée de la copie isolée.
- `src/plans.rs` : uniquement la registration du nouveau test dans ce patch, aucun nouveau routage de poses.
- `src/b06_light_entry_tests/structure.rs`, `negative.rs`, `positive.rs`.
- `src/b06_light_entry_tests/fixtures/moderate-deficit.json`, `large-deficit.json`, `target-met.json` : trois fixtures exactes avec contexte d’occupation.

Le delta du prototype contient aussi `src/b06_feature_rights_probe/feature_rights_probe.rs` (assertion d’éligibilité de l’oracle hérité). Ce fichier est absent de la production et volontairement exclu de la livraison générique des linteaux : **ne pas le promouvoir ni ajouter sa registration**. Le manifest énumère le delta de la copie isolée, pas un applicateur automatique sur la production. Les registrations `engine.rs` / `plans.rs` doivent être construites contre cette dernière.

Aucun changement de catalogue, schéma d’archive, UI, export, `access.rs` ou minimum d’admission dans cette tranche. Le commentaire de `budget_selection.rs` citant B06 comme non pris en charge devra être actualisé si promotion ; il ne fait pas partie du patch figé.

Manifest complet : `_agents_blackboard/proposals/b06_entry_feature_rights/structural_preparation/light-prototype-manifest.json`. Patch figé : `light_prototype.patch.proposed`, SHA-256 `e2e4ddfa7508325572a7fbb1be03577ab0be96b0fd909c7ad19679b5b64f3f2a`, base CLI `f116432baabe3e2bfbea1635cc0cf871676190fa326de123d4aded16fd55acb9`. Copie et sources produit laissées intactes pendant cette lecture.
