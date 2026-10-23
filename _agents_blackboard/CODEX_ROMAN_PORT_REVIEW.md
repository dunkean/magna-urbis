# Port romain : sites réels, faux rejet côtier et visibilité — 22 octobre

**Priorité démontrée : corriger le faux rejet `wet` de blocs déjà découpés sur le rivage. Ne pas forcer les équipements dans le district étiqueté port, ni augmenter son bonus.** Lecture seule du code et des JSON ; aucune génération, aucun serveur ni fichier moteur modifié. Les trois états ci-dessous sont distincts : le runtime UI 8791 est plus ancien que les deux replays de la source actuelle.

## 1. Ce que contient réellement chaque état

| État enregistré | District port | Sites dans ce district | Emporium | Horreum |
|---|---|---:|---|---|
| `web/out/roman-user-04-8791/` : URL exacte, 158 blocs/451 sites | id4, quartiers 2/4/6/8/10/17/18 | 32, dont 28 domestiques | bloc47, commoner, 358 m², bord de mer | bloc25, civic, 2 839 m², bord de mer |
| `web/out/roman-port-proof/before/` : source actuelle, 151 blocs/442 sites | id1, quartiers 1/2/15/19 | 133, dont 128 domestiques | **bloc45 dans le port**, 698 m² | bloc3, civic, 1 898 m², bord de mer |
| `web/out/roman-port-proof/quay-profile/` : seul waterfront activé, 5 quais | même id1 | 131, dont 126 domestiques | bloc19, civic, 919 m² | bloc17, civic, 2 743 m², bord de mer |

L’emporium est `market` dans le catalogue (`services.json:309`), puis **`open_space`** dans `building_sites.rs:581`. Son preview est vide et `urbanSilhouettes.ts:27` le garde dans `open_spaces` : l’absence d’une silhouette de bâtiment est normale pour ce programme de marché ouvert. Ce n’est pas une halle/entrepôt généré. Le horreum possède, lui, un preview bâti (environ 650/587/685 m² selon ces trois états). Un district maritime peut ainsi paraître vide d’installations malgré un marché alloué ; l’étiquette « port » et les quais sont encore des mécanismes séparés.

## 2. Preuve du faux rejet humide dans le cas utilisateur

`programme.rs:526–540` marque un bloc humide si son centroïde **ou un seul sommet** est humide. `roles.rs:618–658,794–796` attribue le rôle port d’après la part de blocs riverains, sans exclure ces blocs humides. La réservation et l’allocation refusent ensuite les blocs `wet` (`programme.rs:647,1191`).

Reconstruction Shapely de la géographie exacte de `fixture.json` : XOR des contours de terre, union des groupes XOR d’eau, puis terre moins eau. Tous les centroïdes des six blocs maritimes `wet=true` du district port live sont secs. Les écarts sont uniquement une frange de précision sur le rivage :

| Bloc live | Aire du bloc m² | Aire hors sec m² | Sommets hors sec | Distance maximale hors sec |
|---:|---:|---:|---:|---:|
| 52 | 2 204,14 | 0,00001291 | 16 | 2,95 µm |
| 53 | 3 118,99 | 0,00005528 | 30 | 2,59 µm |
| 55 | 3 931,49 | 0,00007062 | 35 | 2,82 µm |
| 155 | 775,39 | 0,00003323 | 29 | 3,19 µm |
| 156 | 857,92 | 0,00002602 | 27 | 2,54 µm |
| 157 | 1 605,65 | 0,00002554 | 32 | 2,61 µm |

**Total : seulement 0,000224 m² hors sec sur 12 494 m².** Le septième bloc maritime, 54, est réellement sec mais trop pentu (0,283 > limite 0,213) et minuscule (50 m²) : son refus doit rester. Le même défaut numérique existe sur les huit petits blocs côtiers marqués humides de chacun des replays récents (distance maximale 3,52 µm). Il ne suffit toutefois pas, à lui seul, à expliquer leur allocation différente.

Preuve reproductible sans moteur : `python _agents_blackboard/roman_port_wet_proof.py`. Résultats détaillés avec coordonnées, provenance et distances : `_agents_blackboard/roman-port-wet-proof.json`.

## 3. Quels terrains sont utilisables, sans extrapoler l’admission ?

- **Live52 et55 : vrais candidats après correction numérique**, pentes 0,058/0,150, accès publics. Six parcelles sont déjà `plot` avec témoins natifs 6,1 × 8,3 m ; quatre ont aussi un contact public individuel dépassant les 9 m demandés par le horreum : `parcel-954e60a585c6dd6c` (bloc52, 683 m²), `parcel-3e1789025886fc4f`, `parcel-273eeb96fe7e190a`, `parcel-edb5f4d07d9db250` (bloc55, 714/629/757 m²). Cela prouve l’admission d’un corps compact et l’accès, **pas celle d’un horreum complet** : à 0,55 de capacité, aucune n’atteint seule la cible de 1 078 m² utiles. Une réservation du bloc entier doit encore passer le témoin natif de bloc, actuellement 28,1 × 29,15 m ; ne pas affirmer cette validation sans la relancer.
- **Live53** reste `reserve`/jardins `edge-enclosure`, malgré sa surface sèche ; **live155** n’offre qu’un petit plot à front 6,12 m ; **live156** est une place à contact public maximal 5,95 m ; **live157** ne fournit aucun plot ni accès servi. Corriger `wet` ne les autorise pas automatiquement à recevoir les deux équipements.
- **Source before : bloc32** (2 039 m², mer, pente 0,126) reste un résidu `cadastral-operator-failed`, non servi, contact maximal 3,37 m, sans témoin : le forcer serait incorrect. **Blocs116 et118**, eux, sont secs, peu pentus (0,066/0,086), ont accès publics et des plots admis, mais leurs surfaces entières 5 618/5 528 m² dépassent le garde-fou `a > target * 4` de `programme.rs:750`. Seuils : 3 909 m² pour l’emporium, 4 310 m² pour le horreum. Ils sont éliminés **avant** le bonus de district. Leurs parcelles portent des témoins compacts, pas une certification de grand entrepôt. Les équivalents après ajout des quais sont les blocs119/121.

## 4. Correctif minimal cohérent

1. **Corriger la définition d’un bloc réellement humide**, dans le chemin vectoriel uniquement : après le test rapide, distinguer l’intersection d’eau réelle d’une frange de découpe à précision numérique. Une tolérance spatiale minuscule, documentée et bornée, doit couvrir seulement la frontière ; conserver le contrôle surfacique des traversées d’eau, la pente, les accès et toutes les vérifications d’emprise finale. Éviter un pourcentage permissif de parcelle immergée ou la suppression générale de `wet`. Vérifier un bloc côtier de ce corpus et un bloc qui traverse réellement l’eau.
2. Refaire ensuite **un seul replay du cas exact**, puis lire les réservations légales avant toute autre retouche. Le port doit être choisi parmi des rives réellement exploitables, avec les mêmes faits d’admission que les installations ; augmenter `district bonus=1` ne répare ni `wet`, ni l’absence d’accès, ni le garde-fou de surface. Si l’équipement légal reste au bord de l’eau dans le district civic, ce résultat peut être correct : l’étiquette ne prime pas sur la géographie.
3. Conserver le garde-fou anti-absorption des grands blocs. Si l’on veut utiliser 116/118 pour une installation plus petite, la vraie suite est une **réservation partielle contrôlée avec accès et emprise certifiés**, ou un équipement fonctionnel plus petit explicitement déclaré ; ce n’est pas un simple changement de score. Les cinq quais ajoutés par `waterfront=true` modifient les découpes et déplacent l’emporium ; ils ne valident pas encore un port fonctionnel. Un quai doit relier une rive accostable à une circulation et à un terrain sec utilisable, sans présumer qu’un marché ouvert doit devenir un bâtiment.

### Relecture du helper root `block_is_wet` en cours

Le helper traite les six cas prouvés par une tolérance d’aire `périmètre × 0,1 mm`, après centroïde et test rapide des sommets. Aucun blocage constaté pour ces cas. Précision à conserver : cette formule borne une **aire**, pas la profondeur maximale d’une intrusion. Exemple concret : une pointe triangulaire de 2 cm de profondeur sur 2 mm de base ne couvre que 0,00002 m² ; elle passerait sur un bloc de 100 m de périmètre (tolérance 0,01 m²). Le test d’une bande rectangulaire de 2 cm ne couvre pas ce cas. Si le contrat veut une tolérance *spatiale* stricte, ajouter une borne de distance au domaine sec pour les sommets suspects ; sinon documenter honnêtement la tolérance d’aire de cette préadmission, sans promettre que toute intrusion réelle est refusée ici. Les contrôles finaux des bâtiments restent nécessaires dans les deux cas. Observation transmise à root, aucun edit du helper.

### Contrôle final hors ligne — `shore-safe`

Root a depuis ajouté la borne spatiale de 0,1 mm, conservé la largeur des quais dans `widths::fixed`, puis validé le ruban complet contre le domaine sec avant admission. Contrôle indépendant de `web/out/roman-port-proof/shore-safe/layouts.json` contre la géographie vectorielle exacte de `fixture.json` : **les 8 quais 34–41 ont tous une largeur constante de 4,5 m ; les 8 rubans ont chacun 0 m² hors terre sèche**. Reconstruction conforme à `g::ribbon` (trapèzes de segments, jonctions circulaires à 12 côtés). Leurs axes sont également entièrement secs ; longueurs respectives 37,53 / 24,42 / 27,03 / 23,39 / 49,37 / 14,96 / 10,51 / 11,86 m, soit **199,09 m**. Ce contrôle remplace le constat antérieur de rubans trop larges après harmonisation. Aucun nouveau run moteur, serveur ou UI. Il valide la sécurité physique de ces huit rubans ; il ne transforme pas l’emporium ouvert en entrepôt ni ne prouve à lui seul un programme portuaire complet.
