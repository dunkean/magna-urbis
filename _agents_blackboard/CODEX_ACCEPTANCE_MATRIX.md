# City Bench — matrice opérationnelle d’acceptation

Lecture des sources et artefacts existants, 22 octobre 2026. Aucun nouveau test,
build ou lancement de ville effectué pour cette matrice. « Tous les styles » est
un périmètre de vérification ; ce n’est pas un état atteint ni une garantie de
perfection. Une compilation verte ou un taux d’admission élevé ne valide pas le
résultat visuel. Chaque constat doit conserver décor, code MU1/requête, graine,
version du moteur, culture, population, caméra et mode d’affichage.

## 1. Couverture exacte des styles

`core/src/urban/catalogue.json` contient **53 cultures**, toutes présentes dans
`urban/culture.rs::MAPPINGS`. Elles utilisent **26 des 32 packs maisons**. Voici
la correspondance actuelle, groupée par **famille foncière**, qui ne suffit pas à
décrire la géométrie de la maison. `*` = emprunt fantastique déclaré ; ce n’est pas
une nouvelle tradition architecturale documentée, et le mode strict doit le refuser.

| Famille | Cultures → packs |
|---|---|
| frontage (3) | european-organic, venetian-lagoon, hanseatic → EUR-MED |
| compact (9) | bastide → EUR-MED ; japanese-jokamachi → AS-JAP ; dwarven*, duergar-hold* → EUR-EAST ; gnomish* → EUR-MED ; native-pueblo → AM-PUEB ; egyptian-planned → AF-NILE ; himalayan-terraces → AS-HIM ; indus-planned → AS-IND |
| courtyard (16) | medina, ksar-oasis → AF-MAG ; chinese → AS-CHI ; indian-temple → AS-IND ; roman-core → MED-ANT ; aztec → AM-MESO ; byzantine-greek → EUR-EAST ; persian, ottoman, drow-enclave*, mesopotamian, levantine-tell → AS-MIDE ; korean → AS-KOR ; swahili-stone-town → AF-EAST ; oasis-caravan → AS-STEP ; newar → AS-HIM |
| inherited (6) | elven*, barbarian-norse → EUR-NOR ; barbarian*, celtic-oppidum → ATL-CEL ; halfling* → EUR-MED ; native-plains → AM-WOODS |
| compound (19) | necropolis*, nubian-fortified → AF-NILE ; russian-kremlin → EUR-EAST ; inca → AM-AND ; sahel → AF-SAHEL ; wizard-city* → EUR-MED ; stilt-town*, javanese-courts → AS-ISL ; barbarian-celtic, orcish* → ATL-CEL ; norse-ringfort → EUR-NOR ; maya → AM-MESO ; khmer → AS-SEA ; kraal → AF-SOUTH ; native-iroquoian → AM-WOODS ; nomad-camp* → AS-STEP ; myconid-colony* → AM-TROP ; yoruba → AF-WEST ; mississippian → AM-MISS |

Exceptions explicites : sahel utilise la famille architecturale `common`,
stilt-town `platform`, tout en partageant une famille foncière `compound`.
Les presets déclarent cinq opérateurs parcellaires : `burgage`, `compound`,
`courtyard`, `machiya`, `siheyuan` ; les opérations de rue de base sont `organic`
et `grid`. Ni ces deux rues ni ces cinq opérateurs ne remplacent les 53 cultures.

Maisons : **262 recettes + 153 variantes = 415 bundles**, 32 packs.
`AM-ARC`, `AM-PNW`, `AM-SOUTH`, `AS-SIB`, `OC-AUS`, `OC-PAC` existent côté maisons
sans culture City Bench correspondante dans MAPPINGS : couverture urbaine absente,
pas six styles supplémentaires validés. Le fichier d’enveloppes d’admission
contient 221 profils, dont 194 `supported` et 27 `refused` ; ce témoin de dimensions
minimales ne certifie ni les 415 bundles ni leur adaptation à tout terrain.

## 2. Échelles et fonctions à distinguer

| Cas représentatif | Classe native / contrôle indispensable |
|---|---|
| Ferme seule, population indicative 5–12 | `farmstead` <15 ; `isolated-farm` doit produire une intention sur un domaine non subdivisé, avec accès et espace rural conservé |
| Moulin seul au bord de l’eau | `isolated-mill` / `craft.mill` / `workshop` ; vérifier rive et accès. L’allocation fonctionnelle ne prouve pas la présence d’une roue, d’un bief ou d’une architecture de moulin |
| Hameau 40 ; village 300 | `hamlet` 15–149 ; `village` 150–999 ; maisons, dépendances et espace commun lisibles, sans remplir artificiellement chaque m² |
| Bourg 5 000 ; ville 30 000 | `town` 1 000–19 999 ; `city` 20 000–99 999 ; fronts, hiérarchie des voies et gradients centre/périphérie |
| 100 000 ; 1 000 000 habitants | `metropolis` 100 000–999 999 ; `megacity` ≥1 000 000 ; compter séparément population, allocations, requêtes, maisons acceptées, refus et plans affichés |

Six intentions isolées existent dans `urban/services.json` : `isolated-farm`,
`roadside-temple`, `isolated-shrine`, `isolated-mill`, `isolated-inn`, `isolated-tower`.
Les services ont 14 familles de règles (`european`, `islamic`, `chinese`, `japanese`,
`indian`, `mesoamerican`, `andean`, `norse`, `steppe`, `african`, `native`, `classical`,
`ancient`, `fantasy`) et quatre états (`thriving`, `declining`, `abandoned`, `ruined`).
Un libellé « ruine » ne certifie pas une géométrie ruinée.

**Lacune fonctionnelle :** les 145 `functional_mappings` du catalogue maisons sont
encore marqués `planned`. Une recette domestique réelle peut exister derrière une
association prévue ; le statut de l’association ne certifie pas son usage spécialisé.
Les programmes workshop/warehouse/collective actuels adaptent un volume natif ; ils
ne démontrent pas un catalogue complet de moulins, temples, forges, auberges ou
monuments. Les six intentions isolées demandent donc deux statuts séparés :
« site/programme correct » et « architecture spécialisée effectivement implémentée ».

## 3. Terrains et témoins disponibles

Les **30 décors présents et leurs fichiers vérifiés** dans `web/decors/index.json`
suivent `city-NN-nom-{s,l}`. `s` = carte 4 km, population préremplie 5 000,
étiquette jusqu’à 10 000 ; `l` = carte 16 km, population 100 000, étiquette jusqu’à
400 000. Ce sont des cadres disponibles, pas des performances certifiées.

| Numéros / noms exacts | Contraste |
|---|---|
| 01 river-plain ; 02 atlantic-coast ; 03 aegean-hills | plaine fluviale ; côte vallonnée ; collines méditerranéennes |
| 04 mountain-bay ; 05 arid-plateau ; 06 desert-valley | baie montagneuse ; plateau aride ; vallée fluviale désertique |
| 07 arid-shore ; 08 cold-peaks ; 09 boreal-river | littoral aride ; haute montagne ; rivière boréale |
| 10 tropical-island ; 11 monsoon-plain ; 12 rainforest-ridges | île ; plaine humide ; relief tropical forestier |
| 13 temperate-valley ; 14 oceanic-archipelago ; 15 lake-plateau | vallée ; archipel ; plateau lacustre |

Pas de décor prérempli « million », ferme ou moulin : dériver une situation
explicite, sans interpréter le suffixe `l` comme une garantie d’espace suffisant.
Le million demande un terrain/domaine assez grand ; un refus de domaine trop petit
ne doit pas être masqué par une densité arbitraire.

Témoins réutilisables : `city-visual-audit/01-l/` (100k, centre 8000/8000) et
`city-visual-audit/04-mountain/` (5k, position **2640/2669**) contiennent requêtes,
plans, partitions, métriques et trois vues. Sources enregistrées sur :8810.
`web/out/city-bench/r1/` couvre 01-s/l, 03-s, 05-s, 13-s ; `b/` couvre 01-s, 03-s ;
`bug2-before/` conserve le cas 04. `city_replay.mjs` et les situations MU1 évitent
de recréer un scénario légèrement différent.

Le corpus architectural réel `compact-refusals-auto/` contient 745 requêtes :
dernier replay **567 maisons / 67 refus / 111 espaces libres**, sans perte d’un ID
anciennement accepté. Les 67 refus restent visibles : 45 templates non adaptables,
10 réserves microscopiques invalides, 8 accès, 3 recherches bornées, 1 largeur.
Ce résultat concerne un bourg européen ; il ne valide pas les 52 autres cultures.

## 4. Portes de sortie mesurables, par priorité

**Livrable visuel final demandé : environ 50 captures contrastées** par biome,
relief, taille et culture, avec manifeste reproductible (décor, seed, population,
culture, cadrage, mode réellement montré). Le manifeste est confié à render_scale ;
produire les captures après les correctifs P0, puis relever les défauts encore
visibles. Une galerie de previews ne valide pas les architectures natives.

| Priorité et petit lot de vérification | Mesure et critère de sortie |
|---|---|
| **P0 — 01-l et 04 exacts, avant/après, 3 zooms** | Comparer aire/front/profondeur par zone et rôle, p10/p50/p90 et voisins comparables. Le couple du bloc 540 à 7290,72/7857,33 présente fronts 4,88/7,18 m et aires 1305,6/135,5 m² (×9,64) : corriger ou expliquer par un programme réel. Aucun nouveau lot résidentiel sous les minima d’admission ; chaque lot a front ou accès partagé explicite. Cible proposée : diviser au moins par deux les **157 couples strictement adjacents** à ratio d’aire ≥3, sans supprimer la diversité de rôles (le compte préliminaire de 167 incluait 10 contacts par un coin). Ne pas imposer des parcelles égales. |
| **P0 — formes du cœur 01-l** | Le témoin preview a 113 pièces longues de largeur <2,5 m, 132 cours avec aile estimée <1 m, 489 angles <20°. Auditer ces alertes individuellement par famille ; zéro aile habitable sous son minimum natif, zéro découpe en aiguille. Pour une maison orthogonale, angles des corps proches de 90°/270° (tolérance diagnostic ±5°), même dans une parcelle oblique. Ne pas convertir les huttes rondes, sites troglodytes ou formes documentées en rectangles pour améliorer un compteur. |
| **P0 — 100k puis million, une navigation de 30 s chacun** | Chronométrer séparément ville→parcelles, clic architecture→premier lot peint, premier détail visible et fin. Cibles de prototype proposées sur la machine de référence : premier plan utile <3 s après disponibilité des sites, navigation p95 <50 ms/frame, sélection visuellement prise en compte <200 ms. Publier chaque lot ≤64 ; aucun appel d’intérieurs pour la ville entière. Le million n’est essayé qu’après passage 100k ; arrêt si la machine approche la saturation, avec limitation explicite plutôt qu’une promesse de réussite. |
| **P0 — mémoire/annulation** | Relever heap et RSS navigateur/worker/moteur séparément, nombre réel de maisons et octets par maison. Respecter les budgets présents : détails ≤2 appels, file ≤32, cache ≤64 maisons/16 MiB/150k sommets ; raster ≤32 MiB ; archives décodées ≤2/8 MiB. Pan/zoom puis changement de scène : pas d’ancienne réponse publiée, pas de copie cumulative par lot, caches libérés. Une mesure Node ou un benchmark de rectangles ne remplace pas ce passage City Bench. |
| **P1 — ferme + moulin + hameau + village** | Une situation de chaque, sur 01-s ; moulin connecté à une vraie rive. Contrôler domaine unique des isolés, absence de quartier artificiel, accès, fonction affichée et limites d’architecture spécialisées. Puis 1 capture d’un bourg 5k dans chacune des cinq familles foncières (réutiliser les témoins existants). |
| **P1 — diversité architecturale, quelques maisons seulement** | Dans une enveloppe large puis serrée : row EUR-MED-B02, cour ouverte B06, cour fermée MED-ANT-B08, maison+tower B07 ; ajouter un compound/pilotis d’une autre culture en template natif. Corps entiers, matériaux/toits/composants conservés ; aucune fausse capacité d’adaptation. Réaliser l’extérieur d’une maison sélectionnée, comparer au plan retenu après JSON. |
| **P2 — reste des 53 cultures et 6 packs sans ville** | Tenir un statut par ID : non vu / preview vu / plan natif admis / extérieur vérifié / limitation explicitée. À chaque famille modifiée, vérifier seulement ses cultures impactées, avec un petit peuplement adapté et un lot contraint. Pas de produit cartésien 53×30×7 et pas de nouvelle suite géante. Les six packs sans mapping et les fonctions spécialisées restent des besoins d’auteur, pas des cases cochées par analogie. |

**Géométrie native :** le compositeur a des minima réels issus de `minimum_domain`
(pièces/escaliers), une cour libre de 1,8 m, un passage de rangée de 1,25 m et une
porte de cour de 1,6 m pour les familles concernées. Ces valeurs ne sont pas des
seuils universels pour toutes les architectures. Vérifier aussi trous/réserves,
droits de toiture, terrain, voisins et connexion au front ; un refus explicite
vaut mieux qu’une maison tronquée. Les programmes spécialisés non pris en charge
gardent leur template natif ou refusent ; le plan compact n’est pas une certification
des intérieurs. L’orthogonalité et les dimensions d’une **preview urbaine** doivent
être suivies séparément de celles d’un **plan natif** et de son **extérieur réalisé**.

Sources de décision : `urban/catalogue.json`, `urban/culture.rs`,
`urban/services.json`, `settlements/mod.rs`, `houses/data/{recipes,urban-admission}.json`,
`houses/src/morphology.rs`, `web/decors/index.json`, les deux contrôleurs de rendu
et les artefacts cités ci-dessus. Les seuils UX proposés sont des objectifs à
mesurer, non des résultats déjà observés. Les TODO qualité restent ouverts.
