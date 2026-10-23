# Domaine de fondation : raccord natif vérifié

23 octobre 2026,00:36. Le raccord ciblé et ses cinq tests préparation/intégration passent ; les337 tests unitaires Houses passent (313 horsplans+24 plans). Le comparatif CLI des128 demandes exactes conserve125 admissions et3refus, mêmes styles. Sept emprises se rapprochent de leur cible, aucune ne s'en éloigne ; cibles±10%36→37. L'audit indépendant GEOS/raster contrôle125 plans sans dépassement de droits, dont101 assises natives sans dépassement de pente/pas/eau ; écart maximal de cote1,41e-9m. La réalisation détaillée des témoins réels reste à vérifier séparément. Pas de nouveau moteur ni taux d'admission de ville extrapolé.

Preuves : `web/out/strip-initial-budget-proof/after-native-foundation/`, CLI figé `web/out/native-foundation-cli-proof/plan_replay.exe`, SHA`3f257109abea839addb0e6346ea43866d4d6004ee128680fc11a7481d87a413c`. La planche géométrique a été ouverte et relue. Temps ponctuel280→330ms, sans conclusion de vitesse ; poses budgétaires1213→1173. Huit poses retenues dépasseraient0,75m si l'on traitait encore leur cour/passage nu comme une assise horizontale. Après cette mesure, deux unions locales inutilisées ont été retirées du chemin production : seules les parts transformées puis unies sont utilisées ; les unions locales restent des témoins de test.

**00:39 — détail réel vérifié.** Les huit témoins1491,2471,2665,3537,11111,11307,11976,12272 rejouent leur extérieur8/8 avant et après. Les plans du lot réduit sont identiques à ceux du lot128 dans chaque phase. Intérieurs0/8 avant et après, même refus préexistant : raccord du plan distinct de la porte intérieure native. Le garde reste actif ; ce défaut est un chantier séparé inscrit au TODO, aucune certification intérieure revendiquée. Artefacts `web/out/native-foundation-detail-proof/`.

## Écart confirmé

`plans::visual_with_front_access` applique `foundation_bounds` à `plan_domain` : union des niveaux de corps, cours, chemins et features déjà retenues. Une cour nue ou la fin nue d'un passage peut donc fixer la cote horizontale de toute la maison et provoquer un refus0,75m.

`placement` utilise niveaux de corps + `native_site_features(unit)` ; `native_candidate` réutilise exactement cette union exportée dans le témoin. Ces voies ne rajoutent pas les surfaces de cour/chemin nues au domaine porteur. Elles ont cependant déjà préparé des structures que le plan compact brut n'a pas nécessairement : enclos, galeries, porches, appuis, bases et murs coupés aux vrais portails. `native_site_features` est actuellement une union conservatrice de toutes les features natives et murs ; ce n'est pas encore une taxonomie mécanique fine des appuis.

Le remplacement global de `all` par le corps serait faux. Exemple concret même dans B02 : `side_corridor` déclenche `front_gallery`, soit une bande latérale de0,85m le long de chaque corps et deux poteaux. Les dimensions du corps seul ne représentent pas le programme structurel natif. Autre risque : `build_layout` définit son lot d'atelier par bbox+6m ; un enclos non central suit `offset(unit.lot,-0.25)`. Une préparation structurelle peut donc agrandir significativement le domaine effectif.

## Contrat cohérent et palier minimal

Préparer une seule fois par plan immuable un paquet local distinct :

- corps/niveaux conservés ;
- structures natives requises, avec identité et surfaces exactes ;
- domaine de fondation = corps/niveaux + ces structures ;
- domaine d'occupation = corps/niveaux + cours + passages + ces structures ;
- droits de toit séparés, inchangés.

`foundation_bounds`, la cote `ground_z_m`, le contrôle12° et le contrôle d'eau utilisent uniquement le domaine de fondation. Cadastral, réserves et voisins continuent de contrôler **tout** le domaine d'occupation. Une cour reste une réservation réelle, même quand elle n'impose pas un plateau de fondation. Ne jamais ajouter une structure au calcul terrain sans vérifier aussi son emprise.

Premier palier sûr : plans Ground/Walled simples, sans enclos, shell, programme structurel, galerie couverte ni détail susceptible d'ajouter des bases/terrasses/ouvrages extérieurs non préparés. Le Strip B02 peut être couvert à condition de passer par la préparation native partagée de sa galerie latérale et ses poteaux ; ne pas recopier la formule0,85m dans un second générateur. Les détails inconnus conservent le domaine actuel conservateur ou un statut non certifié. Le contrat ne doit pas dépendre du nom B02 mais de capacités déclarées.

Une fonction extraite de `engine::structural_unit` peut fournir ces structures sans intérieurs ni mesh de toit, en utilisant `add_body_supports` et `add_structural_circulation`. Pour le périmètre sans enclos, les appuis sont connus avant le graphe de portes. Les programmes avec enclos/gates nécessitent ensuite la même préparation et les mêmes coupures que `native_site_features`, ou une enveloppe conservatrice explicitement annoncée ; pas de suppression d'un mur pour sauver un lot.

Réutiliser le paquet via le cache éphémère `PreparedPlan` proposé par Java Sources évite une préparation par pose. Le cache doit contenir la nouvelle union porteuse, séparée de l'union d'occupation, sans changer la géométrie après sa première utilisation. Les détails doivent rejouer la même préparation et le même lot, puis conserver la cote native retenue. Un support ou un mur ajouté tardivement hors du certificat doit invalider le détail, pas être accepté silencieusement.

## Preuve et risques

Le test analytique utilise une pente affine10% (<12°), un corps4×4m et une cour nue jusqu'à12m : domaine d'occupation dénivelé1,20m, corps+vraie galerie0,40m. Ajouter un vrai poteau ày=10m rétablit un refus1,02m ; ajouter un enclos plus large impose aussi de contrôler le terrain **et** les droits cadastraux. Le test caractérise le contrat physique, sans prétendre certifier un constructeur particulier.

Risques à contrôler au raccord : changement de cote verticale des plans/détails ; nouvelles erreurs légitimes quand un support natif auparavant omis déborde ; conservation de murs d'enclos au lot+6m ; passages qui doivent garder leur propre pente/accessibilité, distincte d'une fondation horizontale ; galeries supérieures et poteaux projetés ; eau/pilotis et supports à niveaux distincts (hors premier palier). Ne pas annoncer une fréquence de récupération sur les128 ni les deux pertes : leurs candidats refusés ne sont pas sauvegardés, et la reprise historique reste une correction indépendante.

## Helper isolé prêt à vérifier

`engine::prepare_foundation_domains(&ResolvedArchitecture) -> Result<FoundationPreparation,String>` retourne `Supported(PreparedFoundationDomains)` ou `Unsupported(reason)`. Les données production sont `native_features` et surtout `bearing_parts`/`occupation_parts` : le caller doit transformer les parts puis unir dans le monde, comme le placement natif, sans supposer que union et transformation commutent après quantification. `body_domain`, `occupation_domain`, `bearing_domain` sont des témoins locaux de test uniquement.

Le premier périmètre exige Strip FP-RECT/FP-LONG, Ground/Walled, corps rectangulaires entiers sans variation d'étage, pas d'enclos/coque/programme structurel/galerie couverte ni accès vertical extérieur. Les détails autorisés sont party_walls, rear_yard, shopfront, side_corridor. Les corps d'infill conservés ne sont pas supprimés. Features préexistantes admises : galerie, poteau, mur mitoyen sans couverture ; toute autre structure retourne Unsupported. La préparation native existante fournit les galeries/poteaux, sans copie de leurs formules. Le helper ne choisit ni seed ni style et ne modifie pas le plan reçu.

Deux tests natifs ciblés sont écrits dans `foundation_preparation_tests.rs` et enregistrés sous engine : B02 natif W8/D16, pente longitudinale5% (assise0,60m, occupation0,80m), pente transversale10% (corps seul0,675m mais assise native complète au-dessus de0,75m), poteau éloigné conservé (0,81m), enclos et structure Retaining inconnue refusés explicitement. Ils vérifient aussi l'égalité avec les features natives, les parts et l'immutabilité. Une première assertion à exactement0,76m a été remplacée par la mesure de l'union réelle galerie/poteaux et le franchissement de la même limite0,75m, sans modification physique.

Compilation commune suivante : les deux tests de préparation passent. Les tests d'intégration de droits et d'exclusions passent également. Le test d'extérieur a identifié une différence de catégorie, sans support manquant : après `structural_unit`, `volume_unit` ajoute par `roofs::end_profile` les deux pignons `roof:unit-0:body:0:0:end:RF-GABLE:{0,1}`. Leur vraie géométrie verticale est au sommet des murs, sur les bords du corps ; leur bande 2D de 8 cm sert à les indexer. Elle n'est pas un nouvel appui au sol. Le test exige maintenant l'identité des cinq structures préparées et limite les extras à ces deux pignons avec vérification de leurs sommets 3D et de leur cote. Cette correction de test attend la compilation root ; le helper et la production restent inchangés.

## Raccord et tests d'intégration préparés

Le raccord est limité aux demandes automatiques `historical_inspired`, domestiques ou mixtes, dont les contrôles originaux n'imposent ni recette, ni atelier, ni override. Les poses exactes, empreintes imposées, pins et modes stricts gardent l'admission conservatrice. Le contrôle historique d'occupation reste préalable ; les parts natives complètes sont ensuite contrôlées contre cadastre, réserves et voisins avant de calculer l'assise depuis les parts porteuses transformées puis unies. La préparation est mise en cache uniquement pour ce plan immuable. Les features natives sont aussi retenues dans la sortie cartographique.

`foundation_integration_tests.rs` est enregistré sous `plans` par root, sans modification de ce dernier fichier par l'agent. Ses trois tests utilisent un B02 natif réel W8/D16 à un étage, sélectionné de façon fixe, avec des contrôles de requête urbaine originaux sans pin. Ils vérifient l'admission sur pente longitudinale de 5 %, le refus sur pente transversale de 10 % lorsque galerie et poteaux font dépasser 0,75 m, le refus d'un poteau hors cadastre, la limite inchangée de 12°, les exclusions explicites/strictes, et l'identité des galeries/poteaux dans l'extérieur natif rejoué. L'accès intérieur n'est pas certifié par ce test. **Deux tests d'intégration passent ; le troisième attend le rejeu après la correction de comparaison des pignons décrite ci-dessus.**
