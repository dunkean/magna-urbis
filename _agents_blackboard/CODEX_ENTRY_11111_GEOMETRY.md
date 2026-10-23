# Entrée 11111 — obstacle et construction possible, pose inchangée

Témoin `e099cf700f812cc3`, source `web/out/native-entry-contact-cli-proof/eight-plans.json`, requête brute `native-strip-entry-eight.json`, portails existants consignés dans `web/out/native-entry-alternatives-probe.log`. Analyse GEOS hors ligne ; aucun appel natif, changement de pose ou suppression de cour/galerie. Le plan extérieur est accepté ; l'intérieur figé refuse encore la divergence entre entrée proxy et porte native.

**Le passage natif n'est plus hors cadastre.** Les deux passages existants ont zéro dépassement et zéro recouvrement solide dans le probe précédent. Ses quatre raccords directs (deux portails sur chacun des deux témoins) échouaient ; ils ne sont pas rejoués ici.

## Porte arrière actuellement choisie

Entrée locale E=(1,203 ; 11,488), passage rectangulaire [0,778 ; 10,935 ; 1,628 ; 11,688]. Le corps principal couvre x=[0 ; 7,886], y=[2,872 ; 11,488].

Un seul coude avec premier tronçon **normal à cette porte vers l'extérieur** ne suffit pas. Le rayon x=1,203 quitte le cadastre à y=15,163483643. Même en ignorant toute largeur, les retours vers n'importe quel point des deux segments publics croisent la section y=10 dans x=[0,6415094 ; 5,2328127], entièrement à l'intérieur du corps principal et sous le passage natif (y minimal 10,935). Cette preuve concerne cette famille de raccords ; elle ne démontre pas l'impossibilité de tous les chemins obliques.

## Autre porte déjà construite : priorité au même opérateur à un coude

Le portail `unit-0:portal:0` est sur le côté de l'aile, E=(3,778 ; 2,154), passage [3,225 ; 1,729 ; 3,978 ; 2,579]. Le même calcul d'appui que pour 11976 donne, pour une largeur 0,8 m :

- coude (9,106 ; 2,154), puis contact rue (9,106 ; −0,4780646275) ;
- marges du contact aux extrémités réelles de rue : 9,5839914 m et 2,5144058 m ;
- aire du raccord : 6,3680517 m² ; hors droits, corps hors passage et recouvrement Post/PartyWall : **0 m²** ;
- distance minimale aux poteaux/murs mitoyens : **0,088 m** ; recouvrement du passage natif : 0,16 m² ;
- traversée de la galerie marchable : 0,6800000 m², sans poteau touché.

Ce calcul utilise les corps et les structures publiées, avec voisins/réserves inchangés. Il ne remplace pas la vérification des vraies sections de murs ni le rejeu intérieur. Le test non enregistré `existing_wing_portal_one_bend_probe.rs.proposed` prépare ces géométries natives et appelle le chemin `visual` complet, puis extérieur/intérieur si admis. Aucun changement de sélection de portail n'est activé.

## Alternative distincte : deux coudes depuis la porte arrière

Sans toucher la galerie, une construction passe par (1,203 ; 12,088), puis (9,135999998 ; 12,088), jusqu'à (9,135999998 ; −0,4780646275). Les positions viennent du bord externe du passage et du bord externe de toute la galerie, chacun augmenté d'une demi-largeur ; aucune marge ajustée par essais. Largeur 0,8 m, joints pleins : aire 16,8792517 m², hors droits/corps/postes/galerie **0 m²**, distance minimale aux solides 0,03 m, passage commun 0,16 m². Les quatre plans précédents restent les mêmes voisins. Cette alternative reste une preuve géométrique hors ligne, sans activation ni certificat natif ; elle est moins prioritaire que l'autre portail réel avec l'opérateur existant.
