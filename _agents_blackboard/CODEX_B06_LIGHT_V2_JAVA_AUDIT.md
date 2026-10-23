# B06 légère V2 : audit indépendant de l’ancien Java1752

Comparaison offline contre production39fcc : `web/out/portal-lintel-production-proof/java-full` → `web/out/b06-light-v2-native-proof/java-full`. CLI V2 figé `da619c6695287c562db6b18c69bf471ad92ffe0a6d1ebddc745b9fc6384bcf09`. Aucun nouveau natif/Cargo exécuté par l’auditeur. Preuves neuves dans `independent-audit/` du dossier V2 : `comparison.json`, les deux rapports physiques et `context-and-geometry.json`.

**Les quatre pertes de surface V1 sont corrigées.** Chaque corps retrouve exactement son aire baseline : index86 =162,802925720 m² ;1003 =225,269690097 ;1142 =242,401139617 ;1407 =159,621123065. Pose et architecture locale de ces quatre cas reviennent à la baseline. Leurs entrées restent explicitement différées ; aucune porte n’est inventée pour conserver la capacité.

- **1 338 admis /407 refus /7 espaces ouverts**, identiques individuellement ; zéro gain/perte d’admission.
- Aucune recette, variante ou nombre de niveaux modifié ; aucune cible dégradée ou améliorée au-delà de0,0001 m². Somme des deltas d’aire : **0 m²** ;448 cibles atteintes à±10 % avant/après.
- **890 anciennes entrées exactes conservées**, zéro perte ou changement de leur certificat ;**102 entrées natives gagnées**. La V1 en gagnait106 en sacrifiant quatre surfaces.
- Droits vérifiés sur les **1 338 bâtiments**, assises sur **992 préparations natives** et indépendamment sur **1 335 Single Ground** ; zéro violation terrain/eau/cote ou collision globale. Erreur maximale de cote2,522×10⁻⁹ m. Trois autres bâtiments restent hors de cette seconde couverture.
- **16 avertissements source/minima hérités**, exactement les mêmes IDs et contrôles avant/après ; aucune nouvelle erreur source.

Le calcul d’assise conserve uniquement les vrais contacts au niveau `ground_z+0,01 m` pour le Single partagé. Les102 cadres, quatre linteaux et quatre fragments de murs supérieurs élevés restent dans l’occupation mais ne deviennent pas des fondations. La section des murs ordinaires est issue de leurs empreintes réellement découpées et de leurs hauteurs ; aucune feature inconnue n’est supprimée silencieusement.

Sur les six différences physiques corps/toit de V1, quatre disparaissent avec les régressions corrigées. Deux choix de pose subsistent à aire identique :

| Index / parcelle | Corps m² | Différence symétrique du corps m² | Constat |
|---|---:|---:|---|
|529 /`e7208c8751a41a32`|167,149650|1,672500|Orientation422,713° →242,713°, corps local exact, entrée gagnée|
|1412 /`d5f43aa00feb9691`|106,678944|2,963304|Orientation152,753° →332,753°, corps local exact, entrée gagnée|

Ce ne sont pas des écarts numériques. Le finaliseur Single reçoit et conserve la pose courante ; le choix différent se produit donc en amont. Les voisins fournis interlots sont identiques, mais l’occupation native antérieure locale change réellement : trois voisins pour529, un pour1412. Les nouvelles sorties passent tous les droits et gardes d’assise. Le calcul offline ne trouve pas de collision de l’ancienne occupation avec ces nouvelles occupations : il ne prouve donc pas que l’ancienne pose serait impossible. Les fichiers `remaining-pose-changes.json`, `remaining-pose-causes.json` et `remaining-pose-access-overlaps.json` gardent cette limite explicitement.

Au total27 sorties présentent une différence de pose ou d’archive locale, dont ces deux différences physiques. Aucun bilan « géométrie globalement byte-identique » n’est revendiqué. Temps natifs des passages enregistrés :3 288 →3 310 ms ; comparaison de deux runs uniques, aucune conclusion de performance isolée.

Conclusion bornée : la V2 préserve l’ensemble des admissions, surfaces, sources, étages et anciennes entrées sur cet ancien corpus, tout en ajoutant102 entrées. Le corpus C et la décision de promotion restent pilotés par root ; cet audit ne certifie ni tous les intérieurs du corpus ni une capacité en habitants.
