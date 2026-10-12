# Atlas mondial des morphologies de settlements et des styles architecturaux
## Référentiel de styles pour un city mapper historique ou fantasy (Antiquité → XVe siècle)

> **But :** choisir une **tradition de peuplement** et produire des **empreintes bâties** visuellement reconnaissables par leur disposition, leur plan, leur volume, leur toiture, leur système porteur et leurs matériaux. Ce document complète le catalogue fonctionnel des bâtiments : il ne répète pas les métiers ou équipements.
>
> **Périmètre :** le monde entier, en privilégiant les formes attestées avant le XVIe siècle ; les traditions dont les meilleurs exemples conservés sont postérieurs sont clairement signalées. **Ce n'est pas un inventaire littéralement exhaustif de toutes les cultures**, mais une couverture mondiale volontairement large, ordonnée pour l'implémentation.

## Mode d'emploi : quatre échelles, et non un unique « style »

1. **Culture / époque / milieu** : limite les combinaisons historiques possibles. Une région ne signifie jamais un style unique.
2. **Morphologie du settlement** : réseaux de routes et chemins, trame parcellaire, organisation du centre, enclos, places, terrasses, accès à l'eau.
3. **Morphologie des ensembles** : propriété familiale avec plusieurs huttes, pâté de maisons, *siheyuan*, *kancha*, cour-palais, longhouse et dépendances.
4. **Morphologie des bâtiments** : empreinte, étages, structure, remplissage, couverture et détails (au minimum lisibles sur un plan 2D).

**Ordre de développement — pas une hiérarchie des civilisations :**

- **P0 — Indispensable** : primitives à fort rendement, réutilisables à l'échelle mondiale.
- **P1 — Essentiel régional** : identité architecturale nécessaire pour reconnaître une tradition.
- **P2 — Distinctif** : davantage de variété et de spécificité historique/culturelle.
- **P3 — Rare / avancé** : architecture complexe, sites exceptionnels, usages contraints, périodes frontières.

**Convention temporelle :** `A` = Antiquité locale ; `M` = période médiévale / équivalent local avant ~1500 ; `T` = tradition longue ou datation large ; `L` = **attestation caractéristique surtout postérieure à 1500**, option *late / fantasy* (ne pas utiliser par défaut dans le corpus pré-Renaissance). Les noms de cultures servent à contextualiser les modèles, **pas** à assigner une forme unique à un peuple. Certains édifices connus aujourd'hui sont des reconstructions tardives.

**Lecture des tableaux :** les descriptions sont des **presets de génération top-down**, non des plans archéologiques garantis. Lorsqu'un détail de toiture ou d'élévation est hypothétique pour une période donnée, cela doit rester configurable ou simplifié.

---

# I. Grammaire morphologique universelle

## I.1. Morphologies de settlements indépendantes des cultures

| Prio | ID | Morphologie | Géométrie / contraintes cartographiques |
|---|---|---|---|
| P0 | `SET-NUCLEATED` | Village nucléé | Habitat groupé autour d'un centre, rues rayonnantes et parcelles irrégulières. |
| P0 | `SET-DISPERSED` | Habitat dispersé | Maisons éloignées, parcelles agricoles et chemins de desserte. |
| P0 | `SET-LINEAR` | Village-rue | Emprises alignées sur un axe ; parcelles allongées perpendiculaires. |
| P0 | `SET-RIVER` | Village-rivière | Habitations en bande, débarcadères, traversées et berges. |
| P0 | `SET-CLUSTER` | Hameaux en grappes | Quelques noyaux reliés ; espaces cultivés interstitiels. |
| P0 | `SET-RADIAL` | Village radial | Accès rayonnants depuis place, puits ou enclos central. |
| P0 | `SET-IRREGULAR` | Trame organique | Ruelles courbes et impasses, îlots de taille variable. |
| P0 | `SET-GRID` | Ville orthogonale | Axes hiérarchisés, intersections proches de l'angle droit, îlots répétables. |
| P0 | `SET-HILL` | Village perché | Courbes de niveau, terrasses, murailles et accès en lacets. |
| P0 | `SET-WALLED` | Ville en enceinte | Limite défensive et portes conditionnant tous les axes traversants. |
| P0 | `SET-COURTYARDS` | Tissu de concessions | Enclos composés de plusieurs petits volumes autour de cours. |
| P0 | `SET-COASTAL` | Agglomération littorale | Quai/plage de halage, implantation en retrait des submersions. |
| P1 | `SET-AXIAL` | Capitale axiale | Axe cérémoniel majeur, séquences de portes et enceintes emboîtées. |
| P1 | `SET-MULTICORE` | Ville polycentrique | Plusieurs places/pouvoirs/nœuds, quartiers autonomes. |
| P1 | `SET-CIRCULAR` | Enclos concentriques | Palissades/cours circulaires, entrées limitées, volumes périphériques. |
| P1 | `SET-TERRACE` | Agglomération en terrasses | Murs de soutènement, escaliers, îlots épousant les courbes de niveau. |
| P1 | `SET-CANAL` | Ville-canal | Canaux navigables hiérarchisés, ponts, quais et îlots irréguliers. |
| P1 | `SET-OASIS` | Ville d'oasis | Noyau compact, irrigation, palmeraie, terroir et point d'eau. |
| P1 | `SET-CEREMONIAL` | Ville à centre rituel | Esplanades et complexes monumentaux, habitat périphérique séparé. |
| P1 | `SET-COMPOUND` | Village d'enclos familiaux | Propriétés clôturées avec bâtiment principal et dépendances. |
| P1 | `SET-MOUND` | Centre à plateformes | Tertres artificiels, esplanades, édifices dominants et habitats autour. |
| P1 | `SET-PASTORAL` | Village pastoral | Points d'eau, réserves fourragères, bétail et accès aux pâtures. |
| P2 | `SET-WATER-STILT` | Village sur pilotis | Passerelles et quais, constructions sur eau peu profonde ou berges inondables. |
| P2 | `SET-FLOATING` | Village flottant | Habitats sur radeaux/barques amarrés ; ancrages et chenaux. |
| P2 | `SET-CLIFF` | Habitat de falaise | Niches, abris et habitats adossés ; circulation verticale contrainte. |
| P2 | `SET-SUBTERRANEAN` | Habitat troglodytique | Excavations, patios creusés, escaliers et puits de lumière. |
| P2 | `SET-ISLANDS` | Ville d'îlots artificiels | Digues, terre-pleins, canaux entre unités bâties. |
| P2 | `SET-NOMAD` | Camp mobile | Cercle/ligne de tentes ou yourtes, dégagements, mobilité saisonnière. |
| P2 | `SET-TERRESTRIAL-RITUAL` | Paysage rituel diffus | Villages séparés d'un sanctuaire, mounds ou enclos cérémoniels. |
| P3 | `SET-LAKE` | Cité lacustre | Digues, chaussées, canaux et berges productives. |
| P3 | `SET-VERTICAL` | Ville de maisons-tours | Parcelles étroites très denses, accès compacts, plusieurs niveaux. |
| P3 | `SET-NESTED-CITADEL` | Citadelles autonomes juxtaposées | Grands blocs enclos, cours successives et chemins sélectifs. |
| P3 | `SET-MEGAHOUSE` | Implantation à maison géante | Un ou quelques bâtiments collectifs portent l'essentiel de l'habitat. |
| P3 | `SET-ICE` | Camp polaire d'hiver | Petites unités isolées par neige/vents, accès saisonniers. |

## I.2. Formes de parcelles et d'ensembles

| Prio | ID | Forme | Traduction en 2D |
|---|---|---|---|
| P0 | `LOT-STRIP` | Lanière / parcelle profonde | Une façade étroite, cour et dépendances en arrière. |
| P0 | `LOT-BLOCK` | Îlot bâti dense | Volumes jointifs, cour(s) intérieure(s) résiduelles. |
| P0 | `LOT-COMPOUND` | Enclos domestique | Clôture distincte des toits et sous-bâtiments. |
| P0 | `LOT-CENTRAL-YARD` | Cour centrale | Vide structurant bordé sur 2 à 4 côtés. |
| P0 | `LOT-FARM` | Concession rurale | Cour, granges, jardin, petit enclos, cultures. |
| P1 | `LOT-ATRIUM` | Maison à atrium | Cour centrale interne ouverte, toiture périphérique. |
| P1 | `LOT-PERISTYLE` | Cour à portiques | Cour ouverte, galerie couverte annulaire. |
| P1 | `LOT-SIHEYUAN` | Cour chinoise axiale | Pavillons autour d'une cour, hiérarchie nord/sud. |
| P1 | `LOT-KANCHA` | Kancha andine | Plusieurs pièces rectangulaires dans un même mur périmétral. |
| P1 | `LOT-KRAAL` | Concession/enclos pastoral | Clôture circulaire/elliptique, parc central ou associé pour le bétail. |
| P1 | `LOT-LONGHOUSE` | Grande maison commune | Emprise allongée et foyers ou travées internes. |
| P1 | `LOT-PLATFORM` | Complexe sur plateforme | Bâtiments sur une dalle/terrasse commune. |
| P2 | `LOT-MULTIYARD` | Cours en cascade | Séquences cour d'entrée → cour familiale → cour privée. |
| P2 | `LOT-TRIANGLE` | Parcelle d'angle | Bâtiment irrégulier contraint par voies convergentes. |
| P2 | `LOT-CLIFF` | Terrasse de falaise | Bande de circulation étroite et adossement au roc. |
| P2 | `LOT-WATER` | Îlot sur pilotis | Dalle, passerelle et accès par l'eau. |
| P3 | `LOT-RING` | Maison annulaire à cour | Anneau habité continu, une entrée, cour centrale. |
| P3 | `LOT-CELLULAR` | Complexe alvéolaire | Pièces accolées au gré des générations, peu de rues véritables. |

## I.3. Bibliothèque de formes de bâtiments (*building primitives*)

### Emprises au sol

| Prio | ID | Emprise | Construction procédurale |
|---|---|---|---|
| P0 | `FP-ROUND` | Circulaire | Disque polygonalisé ; rayon, ouverture orientée, éventuelle couronne. |
| P0 | `FP-OVAL` | Ovale | Ellipse, généralement orientation longitudinale marquée. |
| P0 | `FP-SQUARE` | Carrée | 4 murs orthogonaux, éventuel auvent. |
| P0 | `FP-RECT` | Rectangulaire | Ratio configurable, courants en habitat et halls. |
| P0 | `FP-LONG` | Très allongée | Longhouse, halle, basilique ; travées répétitives. |
| P0 | `FP-L` | En L | Deux ailes, cour ouverte sur deux côtés. |
| P0 | `FP-U` | En U | Trois ailes encadrant une cour. |
| P0 | `FP-COMPLEX` | Composée / additive | Union de plusieurs rectangles, jointifs ou dissociés. |
| P1 | `FP-COURT` | Anneau autour d'une cour | Emprise pleine moins vide central. |
| P1 | `FP-POLYGON` | Polygonale | 5 à 12 côtés, habitat et tours. |
| P1 | `FP-TOWER` | Tour étroite | Empreinte carrée, ronde ou polygonale ; hauteur élevée. |
| P1 | `FP-APSIDAL` | Terminaison en abside | Rectangulaire + extrémité semi-circulaire. |
| P1 | `FP-TRICONCH` | Plan trèflé | Volume central + 3 absides. |
| P1 | `FP-CROSS` | En croix | Intersection de volumes perpendiculaires. |
| P1 | `FP-TERRACE` | Terrasses superposées | Polygones emboîtés décroissants, escalier axial. |
| P2 | `FP-ELLIPTICAL-RING` | Couronne elliptique | Habitat et dépendances sur le pourtour d'un enclos. |
| P2 | `FP-ROCKCUT` | Excavée | Vide à soustraire du relief plutôt qu'objet posé. |
| P2 | `FP-MULTICELL` | Cellules adjacentes | Répétition de petites pièces compactes et cours. |
| P2 | `FP-CLUSTER-ROUND` | Groupe de huttes rondes | 3 à 12 disques dans un enclos. |
| P3 | `FP-IRREGULAR` | Emprise courbe irrégulière | Construction ajustée au terrain et aux rochers. |

### Volumes et toiture

| Prio | ID | Silhouette | Paramètres utiles |
|---|---|---|---|
| P0 | `RF-CONE` | Conique | Rayon d'égout, pente, pointe, chaume. |
| P0 | `RF-GABLE` | Deux pans | Direction du faîtage, pente, débords, pignons. |
| P0 | `RF-HIP` | Quatre pans | Pentes, arêtiers, hauteur faîtage. |
| P0 | `RF-FLAT` | Terrasse plate | Acrotère, accès, évacuation des eaux. |
| P0 | `RF-SHED` | Appentis | Pente unique ; bâtiments secondaires. |
| P0 | `RF-DOME` | Dôme/hémisphère | Rayon, oculus possible, couverture. |
| P0 | `RF-THATCH-VAULT` | Berceau végétal | Toit cintré sur ossature souple. |
| P1 | `RF-VAULT` | Voûte en berceau | Axe de la voûte, extrémités fermées/ouvertes. |
| P1 | `RF-CROSSVAULT` | Voûte d'arêtes | Croisement orthogonal. |
| P1 | `RF-STEP` | Volumes étagés | Terrasses/réductions de plan par niveau. |
| P1 | `RF-EAVES` | Grands avant-toits | Porte-à-faux et galerie périphérique. |
| P1 | `RF-CURVED` | Toiture à rives relevées | Pente courbe, arêtiers relevés, tuiles ; **pas universel en Asie**. |
| P1 | `RF-TIERED` | Plusieurs toits superposés | 2–5 pavillons d'emprises décroissantes. |
| P1 | `RF-REED-HIP` | Croupe raide végétale | Haut volume de chaume, large débord. |
| P1 | `RF-TENT` | Couverture conique textile | Perches, toile/feutre, montage démontable. |
| P2 | `RF-SADDLE` | Selle / extrémités relevées | Courbe longitudinale, faîtage en selle. |
| P2 | `RF-GAMBREL` | Deux versants brisés | Rare/chronologiquement filtré avant l'époque moderne. |
| P2 | `RF-DOME-CONE` | Coupole sur tambour | Tambour circulaire/polygonal, dôme. |
| P2 | `RF-STEEP-STEP` | Pignon à redents | Profil de façade en marches. |
| P2 | `RF-MULTIPAV` | Toitures imbriquées | Plusieurs corps orthogonaux, raccords multiples. |
| P3 | `RF-SNOW` | Voûte de neige | Habitat saisonnier arctique. |
| P3 | `RF-SHELL` | Coque végétale | Grande nappe courbe de chaume sur arcs bois/bambou. |

### Structure et matériaux : **ne pas fusionner le porteur avec le remplissage**

| Prio | Code | Technique / matériau | Rendu structurel / usage typique |
|---|---|---|---|
| P0 | `MAT-WATTLE-DAUB` | Clayonnage + torchis | Poteaux/branchages enduits de terre ; nombreuses régions. |
| P0 | `MAT-COB` | Bauge (terre massive) | Murs épais façonnés en couches, enduit terre. |
| P0 | `MAT-ADOBE` | Adobe / briques crues | Appareil de blocs terre séchée, murs porteurs. |
| P0 | `MAT-RAMMED-EARTH` | Pisé | Murs de terre compactée en coffrage. |
| P0 | `MAT-MUD-PLASTER` | Enduit de terre | Finition, réparations, pigments, reliefs décoratifs. |
| P0 | `MAT-TIMBER-POST` | Poteaux/poutres bois | Ossature bois, murs indépendants ou remplis. |
| P0 | `MAT-LOG` | Bois empilé / rondins | Fûts horizontaux, angles assemblés. |
| P0 | `MAT-STONE-DRY` | Pierre sèche | Moellons sans mortier, souvent pierre locale. |
| P0 | `MAT-STONE-MORTAR` | Maçonnerie de moellons | Pierre et mortier ; murs porteurs. |
| P0 | `MAT-STONE-ASHLAR` | Pierre de taille | Appareil régulier, coûteux/monumental. |
| P0 | `MAT-THATCH` | Chaume de graminées | Couverture épaisse, bonne pente. |
| P0 | `MAT-REED` | Roseaux / joncs | Couverture, claies, panneaux. |
| P0 | `MAT-TILE-CLAY` | Tuiles de terre cuite | Pente suffisante et filière céramique. |
| P0 | `MAT-WOOD-SHINGLES` | Bardeaux bois | Pays forestiers, toits inclinés. |
| P0 | `MAT-SLATE` | Ardoise / lauze | Pierre en plaques, toits chargés. |
| P1 | `MAT-HALF-TIMBER` | Colombage apparent | Trame porteuse visible + torchis/brique. |
| P1 | `MAT-BURNT-BRICK` | Brique cuite | Trame de briques, mortier ; production spécialisée. |
| P1 | `MAT-BAMBOO` | Bambou | Charpente, éclisses, murs tressés. |
| P1 | `MAT-PALM` | Palmes | Couverture, nattes, murs, poutres légères. |
| P1 | `MAT-RAISED-POST` | Pieux/pilotis bois | Plancher surélevé, inondation/ventilation. |
| P1 | `MAT-PLASTER-LIME` | Chaux/stuc | Enduit hydrofuge/décoratif, support minéral. |
| P1 | `MAT-CORAL` | Calcaire corallien | Maçonnerie côtière tropicale, mortier chaux. |
| P1 | `MAT-BASALT` | Basalte | Moellons ou gros blocs, îles/volcans. |
| P1 | `MAT-BARK` | Écorce | Bardeaux, couvertures, parements. |
| P1 | `MAT-FELT` | Feutre | Revêtement textile de yourtes ; non porteur. |
| P1 | `MAT-HIDE` | Peaux | Membrane de tentes, abris nomades. |
| P1 | `MAT-TURF` | Tourbe / mottes herbeuses | Isolation, murs et couvertures froides. |
| P2 | `MAT-CHALK` | Craie | Moellons/enduits régionaux. |
| P2 | `MAT-SHELLSTONE` | Pierre coquillière | Maçonnerie de zones littorales. |
| P2 | `MAT-CLINKER` | Roche volcanique scoriacée | Maçonnerie légère locale. |
| P2 | `MAT-ICE-SNOW` | Neige compactée | Blocs découpés, coupole temporaire. |
| P2 | `MAT-MEGALITH` | Monolithes mégalithiques | Plateformes, seuils, tombes, piliers. |
| P2 | `MAT-WOOD-MORTISE` | Bois à assemblages complexes | Tenons-mortaises, consoles et charpentes élaborées. |
| P3 | `MAT-ROCKCUT` | Excavation dans roc | Soustraction de matière au terrain naturel. |
| P3 | `MAT-DRIFTWOOD` | Bois flotté | Charpente de régions arctiques sans forêt. |

### Assemblages / élévations minimales

| Prio | Prototype | Exemple lisible en carte |
|---|---|---|
| P0 | **Rond + torchis + cône de chaume** | Hutte ronde à porte unique, cheminée/foyer central. |
| P0 | **Rectangle + poteaux/torchis + double pente** | Maison ou atelier à un étage, pignon sur rue. |
| P0 | **Rectangle + murs de pierre + double pente** | Maison maçonnée, bardeaux, tuiles ou lauzes. |
| P0 | **Carré + adobe + toit-terrasse** | Maison de climat sec, petites ouvertures. |
| P0 | **Plusieurs bâtiments + cour + clôture** | Concession familiale, cour partagée. |
| P0 | **Volume long + toiture en croupe** | Grande habitation collective, halle ou grange. |
| P1 | **Rond + clayonnage + toiture bombée de chaume** | Rondavel ou habitat de grande tradition végétale. |
| P1 | **Rectangle + bois sur pilotis + toiture raide** | Habitation humide tropicale, escalier extérieur. |
| P1 | **Rectangle + bois + étage débordant + toit en tuiles** | Maison commerçante de ville dense. |
| P1 | **Carré + cour centrale + galeries** | Maison méditerranéenne, persane, indienne ou chinoise selon la configuration. |
| P1 | **Pierre sèche + rectangles regroupés en terrasses** | Habitat andin, méditerranéen montagnard ou pueblo. |
| P1 | **Bois + 2–3 pavillons superposés + rives relevées** | Édifice prestigieux d'Asie de l'Est ; contrôle culturel/chronologique. |
| P1 | **Hutte allongée à toit cintré végétal** | Maison collective sur arcs et poteaux. |
| P1 | **Maison à toiture-selle** | Signature toraja / variantes insulaires, jamais « toute l'Asie ». |
| P2 | **Tour de terre + toiture plate** | Habitat vertical en zone sèche, murs massifs. |
| P2 | **Cercle en mur continu + cour intérieure** | *Tulou* ou enceinte habitable, tardif selon le preset. |
| P2 | **Salle hypostyle + toiture plate / terrassée** | Monument à trame régulière de colonnes. |
| P2 | **Maison creusée + cour excavée** | Habitat troglodytique, vues top-down spécifiques. |
| P3 | **Architecture en rondins de basalte sur îlots** | Ensembles mégalithiques insulaires de Micronésie. |

**Règle capitale :** une forme universelle (« hutte ronde ») n'est pas un style culturel complet ; elle devient une tradition identifiable grâce à l'**organisation des lots, aux proportions, au système de toiture, aux clôtures, aux matériaux et à la distribution sociale des bâtiments**.

---

# II. Packs culturels de settlements et bâtiments

**Colonnes settlements :** priorité, nom, **plan du lieu**, implantation/temps. **Colonnes bâtiments :** priorité, type, **plan/volume**, **structure/murs**, **toit/finitions**. Les entrées sont classées des plus utiles aux plus spécialisées, **à l'intérieur de chaque région**.


## 01. Méditerranée antique — Grèce, Rome, Phénicie et Étrurie `MED-ANT`

**Périmètre et signature :** A → Antiquité tardive. Rues de *polis*, axes publics romains, patios et péristyles, maisons jointives en pierre/brique, toits de tuiles. Ne pas confondre un **castrum** militaire et toute ville romaine.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `MED-ANT-S01` — **Polis grecque compacte** | Acropole haute + agora basse, rues de pente, tissu irrégulier | Grèce continentale, îles égéennes, A |
| P1 | `MED-ANT-S02` — **Polis hippodamienne** | Réseau orthogonal, îlots résidentiels, agora réservée | Colonies grecques et fondations planifiées, A |
| P1 | `MED-ANT-S03` — **Colonie romaine à trame régulière** | Deux axes structurants et forum, îlots rectangulaires | Cité fondée/recadrée, A |
| P1 | `MED-ANT-S04` — **Vicus romain** | Village-rue marchand, bandes bâties de chaque côté | Le long des chaussées et postes frontaliers, A |
| P1 | `MED-ANT-S05` — **Castrum et canabae** | Rectangle défensif hiérarchisé + faubourg de marchands extérieur | Présence d'une garnison, A |
| P1 | `MED-ANT-S06` — **Port phénicien/punique** | Darse, fronts de mer et terrasses, noyaux marchands | Côtes méditerranéennes, A |
| P2 | `MED-ANT-S07` — **Village d'île grecque ancienne** | Petites terrasses rocheuses, ruelles resserrées, constructions en grappes | Cyclades et autres îles, A ; éviter les clichés modernes |
| P2 | `MED-ANT-S08` — **Domaine rural de villa** | Ensemble à cour + dépendances et parcellaire agricole | Campagnes romanisées, A |
| P3 | `MED-ANT-S09` — **Ville étrusque de hauteur** | Plateau défensif, rues et complexes funéraires périphériques | Italie centrale, A |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `MED-ANT-B01` — **Maison de maçonnerie antique** | Rectangle 1–2 niveaux, parfois maison mitoyenne | Moellons/brique crue ou cuite, enduit | Deux pans de tuiles ou toit plat selon région |
| P1 | `MED-ANT-B02` — **Domus à atrium** | Enveloppe presque carrée, cour intérieure éclairante | Murs de maçonnerie, poteaux et colonnades | Pans de tuiles inclinés vers impluvium |
| P1 | `MED-ANT-B03` — **Domus à péristyle** | Salle et pièces autour d'une grande cour à portiques | Brique/pierre et colonnes | Tuiles, galerie périphérique |
| P1 | `MED-ANT-B04` — **Insula urbaine** | Grand bloc rectangulaire mitoyen, jusqu'à plusieurs niveaux | Brique, maçonnerie et charpente bois | Tuiles, boutiques en RDC, cours/escaliers |
| P1 | `MED-ANT-B05` — **Maison grecque à cour** | Rectangle à pièces en couronne d'un patio | Brique crue sur solin de pierre | Pente faible ou tuiles, galerie partielle |
| P1 | `MED-ANT-B06` — **Stoa / portique à colonnes** | Bâtiment linéaire long, une façade ouverte | Poteaux/colonnes en pierre ou bois | Toiture à pans réguliers, rythme des travées |
| P1 | `MED-ANT-B07` — **Basilique civile** | Grande nef rectangulaire à rangées de colonnes | Maçonnerie et charpente de grande portée | Toit allongé à niveaux ou combles hauts |
| P2 | `MED-ANT-B08` — **Maison punique à patio** | Volume compact et cour distribuante | Pierre, enduit, éléments en bois | Terrasses et dalles, contexte local |
| P2 | `MED-ANT-B09` — **Halle voûtée romaine** | Trame de rectangles et travées en berceau/arêtes | Brique/béton antique et pierres | Voûtes visibles sur grandes masses |
| P2 | `MED-ANT-B10` — **Tholos / rotonde** | Plan circulaire entouré ou non de colonnes | Pierre de taille | Toit conique ou dôme selon monument |
| P3 | `MED-ANT-B11` — **Villa de terrasse colonnadée** | Plusieurs ailes en U autour d'esplanade | Maçonnerie décorée, galeries | Tuiles à plusieurs hauteurs |


## 02. Europe atlantique et celte — âge du Fer, castros, oppida `ATL-CEL`

**Périmètre et signature :** A → début M. Villages défensifs de hauteur, maisons rondes dans certaines zones atlantiques, mais aussi maisons rectangulaires et habitats de pierre ; la « hutte gauloise ronde » n’est pas un modèle universel.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `ATL-CEL-S01` — **Hameau de maisons rondes** | Disques espacés, jardins/foyers, sentes organiques | Îles Britanniques et régions atlantiques, A |
| P1 | `ATL-CEL-S02` — **Oppidum fortifié** | Grand plateau clos, voies internes, quartiers d'artisanat | Europe celtique et régions voisines, fin A |
| P1 | `ATL-CEL-S03` — **Castro atlantique** | Sommet ou pente close, huttes rondes/ovalaires serrées | Nord-Ouest ibérique, âge du Fer |
| P1 | `ATL-CEL-S04` — **Village à enceinte de terre** | Habitats groupés, fossé/palissade périphérique | Europe tempérée, A |
| P2 | `ATL-CEL-S05` — **Crannog lacustre** | Petit îlot artificiel et passerelle/embarcadère | Écosse, Irlande, A/M |
| P2 | `ATL-CEL-S06` — **Village sur terrasse rocheuse** | Maisons contiguës en pierre et cours étroites | Zones d'oppida ou collines rocheuses, A |
| P2 | `ATL-CEL-S07` — **Village brittonique côtier** | Habitat dispersé derrière murets et enclos | Littoraux atlantiques, A/M |
| P3 | `ATL-CEL-S08` — **Site de broch** | Tour massive dominant enclos et petits bâtiments | Écosse septentrionale, âge du Fer |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `ATL-CEL-B01` — **Roundhouse en torchis** | Disque/ovale simple, 1 niveau | Poteaux, clayonnage, torchis | Cône de chaume épais |
| P1 | `ATL-CEL-B02` — **Maison ronde à soubassement pierre** | Disque à mur épais, une ouverture | Pierre sèche en bas, ossature légère au-dessus | Cône de chaume ou couverture végétale |
| P1 | `ATL-CEL-B03` — **Longue maison agricole** | Rectangle allongé, divisions internes | Bois/terre sur assise de pierre | Double pente de chaume |
| P1 | `ATL-CEL-B04` — **Maison de castro jointive** | Rond, ovale ou rectangle dans îlot irrégulier | Granite/maçonnerie de moellons | Chaume ou couverture locale |
| P1 | `ATL-CEL-B05` — **Grenier surélevé** | Petit rectangle séparé ou sur quatre pieds | Bois sur socles, parois légères | Petit toit raide en végétal |
| P2 | `ATL-CEL-B06` — **Bâtiment d'oppidum rectangulaire** | Rectangle dense, façade sur rue | Pans de bois et terre ou pierre | Double pente, cour arrière |
| P2 | `ATL-CEL-B07` — **Hutte au toit en coque** | Rectangle court ou ovale | Arceaux/poteaux bois | Toit continu arrondi en roseaux |
| P3 | `ATL-CEL-B08` — **Broch écossais** | Tour circulaire épaisse à double parement | Pierre sèche monumentale | Couronne maçonnée ; couverture haute débattue |
| P3 | `ATL-CEL-B09` — **Cellule sèche à encorbellement** | Petit plan circulaire/ovale | Assises de pierres sèches en retrait | Pseudo-coupole de pierre |


## 03. Europe occidentale et centrale médiévale — France, Empire, Italie, péninsule Ibérique chrétienne `EUR-MED`

**Périmètre et signature :** M. Variation fondamentale entre bourg agglutiné, lotissement planifié, maisons à pans de bois, ville de pierre, montagne et campagne. Un style « village européen » unique est insuffisant.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `EUR-MED-S01` — **Village compact autour d'une église** | Place ou parvis, rayons de ruelles, parcelles profondes | Europe occidentale rurale, M |
| P0 | `EUR-MED-S02` — **Bourg-rue commerçant** | Rue marchande unique, façades serrées et arrière-cours | Routes et franchissements, M |
| P1 | `EUR-MED-S03` — **Ville médiévale organique** | Îlots irréguliers densifiés, rues hiérarchiques, enceintes multiples | Croissance longue, M |
| P1 | `EUR-MED-S04` — **Bastide / ville neuve** | Quadrillage adapté au relief, place du marché, lots répétitifs | Europe occidentale, surtout XIIIe–XIVe |
| P1 | `EUR-MED-S05` — **Bourg castral** | Château en surplomb et habitat serré sur pente | Plateaux, éperons, M |
| P1 | `EUR-MED-S06` — **Village alpin** | Bandes le long du torrent, terrasses, dépendances en hauteur | Massifs montagneux, M |
| P2 | `EUR-MED-S07` — **Village-rue germanique avec lanières** | Longs lots agricoles derrière maisons sur rue | Colonisation agraire planifiée, M |
| P2 | `EUR-MED-S08` — **Bourg marchand à maisons-galeries** | Alignements de façades et portiques continus | Italie et centres marchands régionaux, M |
| P2 | `EUR-MED-S09` — **Cité italienne de maisons-tours** | Parcelles étroites et tours dans îlots massifs | Villes communales, XIe–XIVe |
| P2 | `EUR-MED-S10` — **Village circulaire autour du château** | Anneaux de voies et couronnes parcellaires | Exemples régionaux, M |
| P3 | `EUR-MED-S11` — **Village perché en gradins** | Escaliers, maisons adossées, murs mitoyens | Rocheuses méditerranéennes, M |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `EUR-MED-B01` — **Chaumière rectangulaire** | Rectangle 1 niveau, parfois pignon en rue | Torchis/clayonnage ou moellons | Deux pans en chaume |
| P0 | `EUR-MED-B02` — **Maison mitoyenne étroite** | Façade courte sur rue, profondeur forte, 1–3 niveaux | Bois et terre, pierre ou brique | Deux pans, souvent faîtage perpendiculaire à rue |
| P1 | `EUR-MED-B03` — **Maison à pans de bois en encorbellement** | Rectangle, étage avançant sur rue | Ossature bois visible, remplissage terre/brique | Tuiles/ardoises, pignon parfois sculpté |
| P1 | `EUR-MED-B04` — **Maison de pierre villageoise** | Rectangle 1–2 niveaux, appentis ajoutés | Moellons, chaux, petits percements | Double pente tuiles ou lauzes |
| P1 | `EUR-MED-B05` — **Maison-halle marchande** | Ligne de boutiques au RDC, étage de logement | Bois/pierre, arcades ou piliers | Pignon ou faîtage parallèle, tuiles |
| P1 | `EUR-MED-B06` — **Cour de ferme en U ou quadrilatère** | Cour large bordée de volumes longitudinaux | Moellons/charpentes bois | Grands toits à deux pans |
| P1 | `EUR-MED-B07` — **Maison forte à tour** | Bloc rectangulaire et tour d'escalier/guet | Pierre massive et meurtrières | Toit raide ou terrasse crénelée |
| P2 | `EUR-MED-B08` — **Maison-tour toscane** | Petit carré, 3–6 niveaux, densité urbaine | Pierre appareillée | Couronnement maçonné ou toiture basse |
| P2 | `EUR-MED-B09` — **Maison de portique italien** | Rectangle en rangée, rez-de-chaussée ouvert | Pierre/brique, colonnes et voûtes | Faîtage parallèle à l'axe de rue |
| P2 | `EUR-MED-B10` — **Maison alpine à soubassement mixte** | Rectangle assez large, étage en bois sur base minérale | Pierre au RDC, rondins/bois à l'étage | Grand toit débordant en bardeaux/lauzes |
| P2 | `EUR-MED-B11` — **Maison aux pignons à redents** | Rectangle de ville avec façade étagée | Brique et pierre | Toit deux pans masqué par redents |
| P2 | `EUR-MED-B12` — **Longère de chaume** | Rectangle très allongé, cour ouverte | Moellons/torchis/bois | Deux pans très étirés en végétal |
| P3 | `EUR-MED-B13` — **Demeure-pont** | Volume construit sur arche/accès au cours d'eau | Pierre et bois | Toitures raccordées, fondations hydrauliques |


## 04. Scandinavie, Islande, Baltique et monde nordique médiéval `EUR-NOR`

**Périmètre et signature :** A tardive → M. Longues maisons, rondins, tourbe en zones sans arbres, bois en pile et bâtiments détachés. La forme des forteresses circulaires danoises n’est pas un modèle de village courant.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `EUR-NOR-S01` — **Hameau de longues maisons** | Longs volumes parallèles, cours et petits greniers | Scandinavie agropastorale, A/M |
| P1 | `EUR-NOR-S02` — **Village côtier nordique** | Maisons face au fjord ou mouillage, chantiers/bateaux | Scandinavie et Atlantique nord, M |
| P1 | `EUR-NOR-S03` — **Ferme islandaise en tourbe** | Cour entourée de volumes bas, implantation à l'abri du vent | Islande, M |
| P1 | `EUR-NOR-S04` — **Comptoir portuaire nordique** | Alignement d'étroites parcelles face au quai | Villes commerciales nordiques, M |
| P1 | `EUR-NOR-S05` — **Village forestier de rondins** | Volumes compacts avec enclos, voie centrale | Baltique et forêts nordiques, M |
| P2 | `EUR-NOR-S06` — **Camp sami saisonnier** | Tentes espacées, abri commun, parc à rennes variable | Fennoscandie septentrionale, T |
| P2 | `EUR-NOR-S07` — **Enclos/fort sur promontoire** | Bâtiments sous protection d'un rempart pierre/bois | Côtes et îles, A/M |
| P3 | `EUR-NOR-S08` — **Forteresse viking annulaire** | Grand rempart circulaire, géométrie interne régulière | Danemark, Xe siècle, militaire |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `EUR-NOR-B01` — **Maison longue nordique** | Très long rectangle à allée ou foyer longitudinal | Poteaux et bois, solins pierre possibles | Grand toit deux pans de chaume/tourbe |
| P1 | `EUR-NOR-B02` — **Maison de rondins empilés** | Rectangle compact, 1–2 niveaux | Rondins à angles croisés | Double pente, bardeaux/tourbe |
| P1 | `EUR-NOR-B03` — **Maison islandaise à pignons de tourbe** | Plusieurs rectangles parallèles étroits | Pierre/tourbe et ossature de bois | Couverture végétalisée lourde |
| P1 | `EUR-NOR-B04` — **Boathouse côtier** | Très long volume ouvert vers mer | Poteaux, pierre locale ou bois | Double pente basse, entrée large |
| P1 | `EUR-NOR-B05` — **Grenier nordique surélevé** | Petit carré/rectangle sur poteaux | Bois empilé ou charpente | Toit à deux pans en bardeaux |
| P2 | `EUR-NOR-B06` — **Église en bois debout ancienne** | Nef rectangulaire et noyau central parfois haut | Poteaux bois massifs, assemblages sophistiqués | Toits superposés raides (stave church, M) |
| P2 | `EUR-NOR-B07` — **Kota / goahti sami** | Ovale ou rond bas, entrée étroite | Perches cintrées ou troncs | Couverture toile, tourbe ou écorce |
| P2 | `EUR-NOR-B08` — **Lavvu sami mobile** | Cercle de perches, intérieur unique | Mâts/perches démontables | Cône textile et peau |
| P2 | `EUR-NOR-B09` — **Maison baltique à colombage/bois** | Rectangle à cour agricole | Bois, torchis et pierre selon secteur | Double pente raide, végétal/bardeaux |
| P3 | `EUR-NOR-B10` — **Maison de tourbe intégrée au terrain** | Groupe de petites pièces en parallèles reliées | Terre/tourbe, charpente de bois limitée | Toitures végétalisées à niveaux décalés |


## 05. Europe orientale, Byzance, Balkans et Caucase `EUR-EAST`

**Périmètre et signature :** A tardive → M. Croisement de traditions romano-byzantines, paysannes de bois, pierre montagnarde, monastères à coupoles ; des styles ottomans très tardifs ne sont pas injectés rétroactivement.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `EUR-EAST-S01` — **Village de clairière forestière** | Rues linéaires et unités agricoles bois dispersées | Zones slaves, Europe de l'Est, M |
| P1 | `EUR-EAST-S02` — **Bourg palissadé slave** | Remblais bois/terre, route marchande et cours familiales | Régions slaves, M |
| P1 | `EUR-EAST-S03` — **Cité byzantine sur collines** | Ruelles courbes en pente, enceintes et citadelle | Balkans, Asie mineure, M |
| P1 | `EUR-EAST-S04` — **Ville fortifiée de pierre caucasienne** | Maisons massives serrées, tours dominantes | Vallées de montagne, M |
| P1 | `EUR-EAST-S05` — **Village de montagne en terrasses** | Murs de soutènement, ruelles-escaliers | Caucase, Balkans, M |
| P2 | `EUR-EAST-S06` — **Village de sanctuaire monastique** | Enceintes de bâtiments près d'une église à coupole | Europe orientale et Caucase, M |
| P2 | `EUR-EAST-S07` — **Cité troglodytique anatolienne** | Cours en surface et habitats excavés | Cappadoce, T |
| P3 | `EUR-EAST-S08` — **Agglomération de tours svanes** | Maisons jointives et nombreuses tours-clans | Svanétie, Caucase, M |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `EUR-EAST-B01` — **Isba/maison forestière en rondins** | Rectangle, 1–2 niveaux avec porche | Troncs croisés et solin de pierre | Double pente en bardeaux |
| P1 | `EUR-EAST-B02` — **Maison rurale à galerie** | Rectangle long, porche abrité | Bois/terre et maçonnerie locale | Tuiles ou chaume |
| P1 | `EUR-EAST-B03` — **Maison caucasienne en pierre** | Rectangle compact autour de foyer | Moellons épais et poutres bois | Toit-terrasse ou pente légère selon région |
| P1 | `EUR-EAST-B04` — **Tour svane défensive** | Petit carré, plusieurs niveaux | Maçonnerie pierre très épaisse | Couronnement sous toiture de pierre |
| P1 | `EUR-EAST-B05` — **Église byzantine en croix inscrite** | Carré avec bras et abside | Brique/pierre, voûtes maçonnées | Dôme central sur tambour |
| P1 | `EUR-EAST-B06` — **Maison urbaine byzantine** | Rectangle avec cour et loggia | Maçonnerie mixte, bois de planchers | Tuiles canal, volumes dissociés |
| P2 | `EUR-EAST-B07` — **Église arménienne en pierre** | Croix compacte ou plan central | Pierre de taille, voûtes | Cône/coupole sur tambour polyédrique |
| P2 | `EUR-EAST-B08` — **Église géorgienne en croix** | Nef et bras, carré central | Pierre de taille | Coupole haute sur tambour polygonal |
| P2 | `EUR-EAST-B09` — **Maison troglodytique** | Cellules excavées + escalier | Roc tendre, renforts maçonnerie | Aucun toit séparé ou auvent léger |
| P3 | `EUR-EAST-B10` — **Complexe monastique rupestre** | Salles creusées en réseau avec façades de roche | Excavation et cloisons | Galéries, escaliers et seuils dénivelés |


## 06. Vallée du Nil — Égypte pharaonique, Nubie, Méroé et royaumes nubiens `AF-NILE`

**Périmètre et signature :** A → M (chronologies locales). Densité en briques crues, rues resserrées, villes du Nil, complexes monumentaux en pierre et villages insérés entre le fleuve et les zones cultivées. La pyramide n’est pas une habitation.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AF-NILE-S01` — **Village nilotique de briques crues** | Maisons rectangulaires compactes en bordure de cultures | Nil, bords de canaux, A/T |
| P1 | `AF-NILE-S02` — **Ville égyptienne planifiée** | Trame rectiligne de quartiers denses, axes au temple/palais | Centres administratifs, A |
| P1 | `AF-NILE-S03` — **Ville-temple du Nil** | Grand enclos sacré, rues et résidences périphériques | Égypte, A |
| P1 | `AF-NILE-S04` — **Ville fortifiée nubienne** | Enceinte de brique/pierre, habitats en blocs | Nubie, Nil moyen, A |
| P1 | `AF-NILE-S05` — **Domaine agricole irrigué** | Habitation à cour et greniers sur levée | Terres alluviales, A/T |
| P2 | `AF-NILE-S06` — **Bourg méroïtique** | Noyau civique/rituel et quartiers bâtis en brique | Soudan ancien, A |
| P2 | `AF-NILE-S07` — **Établissement d'oasis égyptienne** | Noyau de murs en terre, irrigation/palmeraie | Dépressions désertiques, A/T |
| P3 | `AF-NILE-S08` — **Nécropole royale satellite** | Groupe de tombes pyramidales avec temples funéraires | Égypte/Nubie, A ; **pas un settlement habité** |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AF-NILE-B01` — **Maison égyptienne en adobe** | Rectangle mitoyen, 1–2 niveaux, cour | Briques crues enduites, bois rare | Toit plat de poutres et terre |
| P1 | `AF-NILE-B02` — **Maison à cour nilotique** | Blocs autour de cour ouverte | Adobe/enduit terre | Terrasses plates, escaliers |
| P1 | `AF-NILE-B03` — **Habitat ouvrier planifié** | Petits rectangles répétés en rues rectilignes | Adobe sur trame uniforme | Terrasses, quelques puits de lumière |
| P1 | `AF-NILE-B04` — **Grenier cylindrique à céréales** | Petits cylindres groupés en cour | Briques crues | Couverture en dôme/voûte de terre locale |
| P1 | `AF-NILE-B05` — **Temple égyptien à pylônes** | Grand rectangle de cours et salles hypostyles | Pierre de taille monumentale | Toits plats lourds, pylônes à seuil |
| P1 | `AF-NILE-B06` — **Maison nubienne voûtée** | Rectangle bas et long | Brique crue autoportante | Voûte en berceau de brique |
| P2 | `AF-NILE-B07` — **Temple nubien/méroïtique** | Petit rectangle axial + cour | Pierre et brique | Terrasses plates/pylônes modestes |
| P2 | `AF-NILE-B08` — **Maison à salle haute** | Rectangles imbriqués autour d'un noyau couvert | Adobe et poteaux de bois | Toiture terrasse avec hauteur variable |
| P3 | `AF-NILE-B09` — **Pyramide nubienne** | Carré base étroite, élévation très pointue | Pierre maçonnée | Sommet pyramidal ; monument funéraire |
| P3 | `AF-NILE-B10` — **Mastaba** | Rectangle à murs inclinés | Brique crue ou pierre | Toit plat monumental funéraire |


## 07. Maghreb, Atlas, oasis présahariennes et Sahara `AF-MAG`

**Périmètre et signature :** A → M et quelques formes L. Urbanisme compact en terre, maisons autour de cours, kasbahs (forteresses) et ksour (établissements fortifiés), villages de pente en pierre. « Ksar » et « kasbah » ne sont pas synonymes.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AF-MAG-S01` — **Village de maisons à terrasse** | Ruelles serrées entre ensembles de terre et patios | Maroc, Algérie, Tunisie, M/T |
| P1 | `AF-MAG-S02` — **Ksar d'oasis** | Agglomération compacte entourée de murs, entrée défensive | Présahara, M ; exemples conservés souvent L |
| P1 | `AF-MAG-S03` — **Médina maghrébine** | Axes marchands et ruelles secondaires/impasses | Villes médiévales du Maghreb, M |
| P1 | `AF-MAG-S04` — **Village amazigh de montagne** | Maisons en gradins suivant la pente, ruelles-escaliers | Atlas et régions montagneuses, T |
| P1 | `AF-MAG-S05` — **Kasbah urbaine** | Citadelle/enclos de pouvoir au sein/au bord de la ville | Fortification maghrébine, M/T |
| P1 | `AF-MAG-S06` — **Village-palmeraie fortifié** | Noyau bâti + réseau de canaux/puits + jardins | Oasis sahariennes, T |
| P2 | `AF-MAG-S07` — **Village de greniers collectifs** | Petites maisons et grand *agadir* fortifié | Sous et Anti-Atlas, M/T |
| P2 | `AF-MAG-S08` — **Camp nomade saharien** | Tentes à espacement variable autour des animaux | Pastoralisme mobile, T |
| P2 | `AF-MAG-S09` — **Village troglodytique de cour** | Patios excavés et pièces taillées dans la terre/roche | Sites tunisiens spécifiques, T ; prudence dates |
| P3 | `AF-MAG-S10` — **Citadelle de terre à tours d'angle** | Enclos géométrique flanqué, maisons serrées | Prérégions sahariennes ; formes conservées surtout L |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AF-MAG-B01` — **Maison de terre à terrasse** | Rectangle/carré, cour facultative | Adobe, pisé, enduits | Toit plat à parapet |
| P1 | `AF-MAG-B02` — **Dar à patio** | Anneau ou U de pièces, patio ouvert | Maçonnerie/terre et bois | Terrasse, galeries intérieures |
| P1 | `AF-MAG-B03` — **Riad ancien / maison à jardin clos** | Cour végétalisée, ailes autour du jardin | Brique/pisé/chaux/bois | Terrasses, galeries, fontaine optionnelle |
| P1 | `AF-MAG-B04` — **Maison de montagne en pierre sèche** | Rectangle épaulé au versant | Moellons secs, poutres bois | Terrasse ou pente locale |
| P1 | `AF-MAG-B05` — **Maison-tour de ksar** | Rectangle haut, 2–4 niveaux | Terre massive, murs épais | Toit plat, tourelles d'angle régionales |
| P1 | `AF-MAG-B06` — **Mosquée maghrébine à cour** | Grand rectangle, salle de prières à travées | Maçonnerie et colonnes | Terrasses et toitures locales, minaret distinct |
| P1 | `AF-MAG-B07` — **Agadir / grenier-forteresse** | Enceinte murée et nombreuses cellules-réserves | Pierre sèche et bois | Toits plats/terrasses |
| P2 | `AF-MAG-B08` — **Grenier de cour cylindrique** | Petits silos ronds ou fours réunis | Terre et tiges végétales | Dômes bas de terre |
| P2 | `AF-MAG-B09` — **Maison à portique intérieur** | Rectangle à cour et galerie sur colonnes | Brique, pierre, enduit chaux | Toits en terrasse/tuiles selon secteur |
| P2 | `AF-MAG-B10` — **Tente saharienne basse** | Ovale/carré aplati | Mâts et cordages, textile tissé | Membrane tendue à double courbure |
| P3 | `AF-MAG-B11` — **Habitat excavé à patio** | Cour profonde creusée, pièces périphériques | Roc/terre consolidés | Couverture du terrain naturel |

**Point d’attention :** Le ksar d’Aït-Ben-Haddou conservé illustre des constructions principalement **à partir du XVIIe siècle**. Utiliser un ksar médiéval comme **archetype** est possible, mais ne pas reproduire automatiquement ses détails tardifs.


## 08. Mésopotamie, Levant, Anatolie méridionale, Arabie et Iran `AS-MIDE`

**Périmètre et signature :** A → M, **plusieurs traditions séparables dans le logiciel**. La maison à cour en terre est très réutilisable ; villes à ziggourats (A), médinas (M), cités fortifiées de l’Iran et villages de désert n’ont ni la même époque ni les mêmes toits.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-MIDE-S01` — **Ville de terre à rues étroites** | Ilots massifs de maisons à patio, impasses et venelles | Mésopotamie, Levant intérieur, A/T |
| P1 | `AS-MIDE-S02` — **Cité mésopotamienne à temple haut** | Quartiers denses, ensemble sacré dominant, canaux | Sumer/Akkad/Babylone, A |
| P1 | `AS-MIDE-S03` — **Ville levantine fortifiée** | Centre sur tell, remparts, rues en pente et portes | Levant ancien, A |
| P1 | `AS-MIDE-S04` — **Ville à bazar et quartiers** | Routes de bazar, rues secondaires et maisons à cours | Syrie, Iran, Anatolie, M |
| P1 | `AS-MIDE-S05` — **Carrefour caravanier** | Enclos de caravanes, souk, citerne, quartiers en bande | Routes intérieures, A/M |
| P1 | `AS-MIDE-S06` — **Village désertique arabe** | Blocs terre/pierre en bord de wadi, cours cachées | Arabie et Proche-Orient, T |
| P1 | `AS-MIDE-S07` — **Ville persane à citadelle** | Enceinte, place centrale et axes commerciaux | Iran et régions voisines, M |
| P2 | `AS-MIDE-S08` — **Ville antique à grands axes sacrés** | Avenues processionnelles, palais/temples murés | Babylonie/Assyrie, A |
| P2 | `AS-MIDE-S09` — **Ville de canyon à maisons-tours** | Tissu compact étagé dans vallée aride | Yémen/Hadramaout, traits L à filtrer |
| P2 | `AS-MIDE-S10` — **Village à badgirs** | Cours et volumes bas avec capteurs de vent verticaux | Plateau iranien, M/T |
| P3 | `AS-MIDE-S11` — **Cité verticale du Hadramaout** | Maison-tours contiguës et enceinte quadrangulaire | Shibam conservée **XVIe siècle** et suivants : L |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-MIDE-B01` — **Maison levantine à cour** | Bloc rectangulaire 1–2 niveaux, patio | Pierre/terre/enduit | Toit plat, galerie ombragée |
| P1 | `AS-MIDE-B02` — **Maison mésopotamienne à cour** | Pièces autour d'une cour unique | Adobe/brique cuite selon richesse | Terrasses de terre, parfois voûtes |
| P1 | `AS-MIDE-B03` — **Maison persane à iwans** | Cour rectangulaire avec 1–4 grandes niches voûtées | Brique, stuc, terre | Voûtes et toits plats |
| P1 | `AS-MIDE-B04` — **Maison en pierre du Levant** | Blocs accolés, petites cours | Calcaire/moellons et chaux | Terrasses ou voûtes en pierre |
| P1 | `AS-MIDE-B05` — **Caravansérail à cour** | Grand carré, cellules autour d'un grand vide | Pierre/brique, portails monumentaux | Terrasses et voûtes autour de cour |
| P1 | `AS-MIDE-B06` — **Maison en brique voûtée** | Rectangle linéaire ou cellule de cour | Briques crues ou cuites | Berceau de brique ou coupole |
| P1 | `AS-MIDE-B07` — **Mosquée à cour / salle hypostyle** | Grand carré/rectangle avec cour + nef sur colonnes | Pierre/brique et bois | Portiques, dômes ciblés selon époque |
| P1 | `AS-MIDE-B08` — **Ziggourat** | Étages de plateformes superposées | Briques crues avec parements cuits | Terrasses, escaliers/rampes ; temple, A |
| P2 | `AS-MIDE-B09` — **Maison à tour à vent** | Carré autour de patio + tour ventilée | Adobe/brique, conduits | Terrasse et badgir vertical |
| P2 | `AS-MIDE-B10` — **Maison de bazar à galerie** | Volume étroit mitoyen, cour arrière | Brique/pierre et charpente bois | Voûte sur rue ou couverture locale |
| P2 | `AS-MIDE-B11` — **Médersa à iwans** | Cour carrée et 2/4 grandes niches à portique | Brique, céramique, stuc | Voûtes et petits dômes |
| P2 | `AS-MIDE-B12` — **Tour du désert à plusieurs étages** | Petit rectangle massif, accès restreint | Terre/pierre et poutres | Toit-terrasse, parapets |
| P3 | `AS-MIDE-B13` — **Maison-tour hadramie haute** | Rectangle étroit, 4–7 étages | Briques de boue séchées, poutres | Terrasse haute, enduits blancs ; **L** |

**Point d’attention :** La silhouette classique de **Shibam** date surtout du XVIe siècle : conserver comme extension tardive, pas comme maison-type de l’Arabie antique.


## 09. Asie centrale, steppes eurasiennes et villes d’oasis `AS-STEP`

**Périmètre et signature :** A → M. Distinguer **camp pastoral mobile** (feutre/bois, sol sans trame viaire) et **ville d’oasis** (terre/brique, remparts, bazar). Une yourte n’est pas une maison de ville permanente.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-STEP-S01` — **Camp nomade de yourtes** | Unités rondes espacées, clairière et enclos mobiles | Steppes mongoles/centrasiatiques, T |
| P1 | `AS-STEP-S02` — **Camp tribal autour d'un noyau** | Grandes yourtes dominantes, petites unités en arc | Steppes, T |
| P1 | `AS-STEP-S03` — **Ville d'oasis sur route caravanière** | Noyau muré, grand marché, canaux, portes | Transoxiane, Tarim, M |
| P1 | `AS-STEP-S04` — **Village irrigué d'oasis** | Maisons rectangulaires en bord de canaux et champs | Asie centrale aride, T |
| P1 | `AS-STEP-S05` — **Cité de terre à citadelle** | Ville basse, enceinte/citadelle séparée, souk | Asie centrale urbaine, M |
| P2 | `AS-STEP-S06` — **Caravansérail isolé** | Grand enclos carré adossé à la voie | Trajets de commerce, M |
| P2 | `AS-STEP-S07` — **Village de vallée montagnarde** | Terrasses de murs en pierre, pâtures en amont | Pamirs/Tian Shan, M/T |
| P2 | `AS-STEP-S08` — **Camp mixte tente + adobe** | Enclos légers, maison permanente et tentes saisonnières | Marges oasis/steppe, T |
| P3 | `AS-STEP-S09` — **Capitale de steppe fortifiée** | Ville fixée à plan plus structuré, quartiers par fonctions | Empires turco-mongols, M |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-STEP-B01` — **Yourte / ger** | Cercle avec foyer central et porte orientée | Treillis de bois, perches, revêtement de feutre | Dôme-cone bas à couronne sommitale |
| P1 | `AS-STEP-B02` — **Tente allongée de steppe** | Ovale/rectangle avec faîtage souple | Armature de perches, feutre ou peau | Double pente textile tendue |
| P1 | `AS-STEP-B03` — **Maison d'oasis en adobe** | Rectangle compact de 1–2 niveaux | Brique crue et enduit | Toit-terrasse |
| P1 | `AS-STEP-B04` — **Maison à cour de Transoxiane** | Bâtiments rectangulaires autour d'un patio | Adobe/brique et bois | Terrasses, auvents sur cour |
| P1 | `AS-STEP-B05` — **Caravansérail fortifié** | Carré à cour ouverte, cellules périphériques | Terre massive et brique cuite | Toits plats/voûtés, portail d'axe |
| P1 | `AS-STEP-B06` — **Mausolée de coupole turco-persane** | Carré bas portant dôme sur tambour | Brique cuite, stuc, céramique | Coupole et décor de façade |
| P2 | `AS-STEP-B07` — **Grenier de vallée en pierre** | Petit rectangle détaché | Maçonnerie sèche et bois | Toit plat ou double pente |
| P2 | `AS-STEP-B08` — **Tente principale de chef** | Grand ovale/ronde, entrée axiale | Treillis et feutre décoré | Couronne de toit plus haute |
| P2 | `AS-STEP-B09` — **Maison de vallée en pisé** | Rectangle de cour avec annexes | Terre compactée et peupliers | Toit plat de perches |
| P3 | `AS-STEP-B10` — **Pavillon monumental d'oasis** | Rectangle à porche haut et cour | Briques vernissées, bois, plâtre | Dôme ou voûte ; dépend étroitement de l'époque |


## 10. Afrique sahélienne — Niger, boucle du Niger, Hausa, Songhaï, Mali `AF-SAHEL`

**Périmètre et signature :** A locale → M et survivances. Maisons à cour en banco, implantation liée aux crues, rues de terre, formes soudano-sahéliennes. Les grandes mosquées connues ont souvent été **reconstruites**, même si les traditions de terre sont anciennes.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AF-SAHEL-S01` — **Village de concessions en banco** | Enclos composés de pièces et petites cours, chemins de terre | Savane sahélienne, T |
| P1 | `AF-SAHEL-S02` — **Ville fluviale du Niger** | Quartiers sur îlots/levées protégés des crues, marchés | Djenné et vallée du Niger, A/M |
| P1 | `AF-SAHEL-S03` — **Cité marchande sahélienne** | Noyau dense d'adobe, quartiers de métiers et caravanes | Sahel occidental, M |
| P1 | `AF-SAHEL-S04` — **Ville-hausa en enceinte de terre** | Rues vers portes, grandes concessions et palais | Hausaland, M/T |
| P1 | `AF-SAHEL-S05` — **Hameau pastoral saisonnier** | Enclos pour bétail, tentes/huttes écartées | Zones semi-arides, T |
| P2 | `AF-SAHEL-S06` — **Village dogon d'escarpement** | Petits hameaux en gradins et sous falaises | Pays dogon, M/T |
| P2 | `AF-SAHEL-S07` — **Ville de terre sur tertre** | Bâti perché sur relief peu marqué, agricoles autour | Plaine d'inondation, M/T |
| P2 | `AF-SAHEL-S08` — **Village d'artisans de potiers/forgerons** | Concessions serrées autour de cours de travail | Sahel, T |
| P3 | `AF-SAHEL-S09` — **Village de huttes-obus** | Volumes de terre coniques regroupés | Nord Cameroun et région musgum ; forme documentée tardivement |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AF-SAHEL-B01` — **Hutte sahélienne ronde** | Disque à cour adjacente, 1 niveau | Terre, poteaux et enduits | Toit conique de chaume |
| P0 | `AF-SAHEL-B02` — **Maison de banco à terrasse** | Rectangle compact autour d'une cour | Brique crue, bauge, mortier terre | Toit plat en perches/enduit |
| P1 | `AF-SAHEL-B03` — **Concession familiale sahélienne** | Cour murée et plusieurs pièces rondes/carrées | Murs terre et clôtures végétales | Cônes de chaume + terrasses |
| P1 | `AF-SAHEL-B04` — **Maison urbaine djennenké** | Rectangle de 1–2 niveaux, façade sur rue | Brique d'adobe et enduit terre | Toit plat, contreforts et décor en relief |
| P1 | `AF-SAHEL-B05` — **Maison hausa à cour** | Enclos rectangulaire compartimenté | Terre massive, enduit décoré | Terrasse, portiques et pièces voûtées selon région |
| P1 | `AF-SAHEL-B06` — **Mosquée soudano-sahélienne** | Grande salle de prière + cour, volumes massifs | Banco, contreforts et bois saillant | Terrasses et tourelles ; variations fortes |
| P1 | `AF-SAHEL-B07` — **Grenier cylindrique en terre** | Petit cylindre autonome, parfois surélevé | Terre / vannerie enduite | Dôme de terre ou cône de chaume |
| P1 | `AF-SAHEL-B08` — **Maison en gradins dogon** | Petits rectangles agglutinés sur pente | Pierre et terre | Terrasses de terre et greniers coniques |
| P2 | `AF-SAHEL-B09` — **Maison de chef à grand vestibule** | Cour et séquence de pièces hiérarchisées | Terre enduite, poteaux sculptés | Toits plats ou coniques combinés |
| P2 | `AF-SAHEL-B10` — **Camp de tentes peules régionales** | Quelques ovales mobiles et enclos de bétail | Mâts, perches et nattes | Couvertures végétales/textiles selon groupe |
| P3 | `AF-SAHEL-B11` — **Case-obus musgum** | Petit à grand plan rond, murs profilés | Terre façonnée à nervures verticales | Coque ogivale terre ; usage daté à documenter |

**Point d’attention :** « Soudano-sahélien » est un **ensemble de traditions**, non une recette uniforme. La Grande Mosquée de Djenné actuelle est une reconstruction du début du XXe siècle : choisir une variante régionale/médiévale plutôt que copier systématiquement sa silhouette exacte.


## 11. Afrique de l’Ouest forestière et golfe de Guinée — Yoruba, Edo, Akan, Fon, etc. `AF-WEST`

**Périmètre et signature :** M → traditions plus tardives. La **concession à cour** est centrale dans plusieurs régions ; grandes villes et palais existaient, mais certains ensembles iconiques visibles datent surtout des XVIIe–XIXe siècles (tag L).

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AF-WEST-S01` — **Village de concessions lignagères** | Enclos autour de cours, chemins organiques, plantations | Zones forestières d'Afrique occidentale, T |
| P1 | `AF-WEST-S02` — **Ville yoruba à quartiers** | Vastes enclos résidentiels et axes menant au marché/palais | Sud-Ouest du Nigeria, M/T |
| P1 | `AF-WEST-S03` — **Cité royale à enceinte** | Palais et marchés dans noyau protégé, quartiers périphériques | Aire edo/yoruba selon période, M/T |
| P1 | `AF-WEST-S04` — **Village de grands toits de chaume** | Habitat rectangulaire à cours ouvertes et bosquets | Forêt et savanes humides, T |
| P1 | `AF-WEST-S05` — **Ville à rues de concessions** | Alignements de murs et portes, bâtiments invisibles depuis rue | Zones soudanaises/forestières, T |
| P2 | `AF-WEST-S06` — **Centre royal akan** | Cour/palais et maisons de clans avec espaces cérémoniels | Ghana, traditions précoloniales et tardives |
| P2 | `AF-WEST-S07` — **Village de maisons peintes** | Concessions ornées avec géométries de façade | Cultures et époques précises à choisir |
| P3 | `AF-WEST-S08` — **Complexe palatial d'Abomey** | Grande enceinte et cours emboîtées successives | Fon/Dahomey, **XVIIe–XIXe : L** |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AF-WEST-B01` — **Maison à cour et galerie** | Rectangles en L/U, cour partagée | Terre/bois et enduits | Toits végétaux ou terrasses selon climat |
| P1 | `AF-WEST-B02` — **Cour familiale yoruba** | Carré/rectangle fermé sur cour centrale | Maçonnerie de terre et bois | Toits raides en chaume puis tuiles régionales |
| P1 | `AF-WEST-B03` — **Grande salle communautaire à poteaux** | Rectangle allongé avec avant-toit abrité | Charpente bois, cloisons tressées | Large couverture de chaume |
| P1 | `AF-WEST-B04` — **Maison de forêt à toit très débordant** | Rectangle bas à ouvertures protégées | Poteaux bois et clayonnage enduit | Croupe de chaume épaisse |
| P1 | `AF-WEST-B05` — **Maison de chef à cour(s) successives** | Plusieurs bâtiments alignés vers cour centrale | Terre, bois sculpté et clôture | Grandes toitures en chaume |
| P2 | `AF-WEST-B06` — **Façade en relief géométrique** | Volume rectangulaire à entrée marquée | Bauge/enduit sculpté | Chaume ou toiture basse |
| P2 | `AF-WEST-B07` — **Maison de clan akan à cour** | Concession à enceinte et pavillons | Terre/bois, piliers et enduits | Toits de chaume, décor de façade |
| P2 | `AF-WEST-B08` — **Temple domestique de cour** | Petit pavillon/cellule dédié dans enceinte | Terre, bois, poteaux | Toit léger de chaume |
| P2 | `AF-WEST-B09` — **Maison d'artisan dans enclos** | Cellules de travail liées à la cour | Terre crue et bois | Chaume, sheds et espaces ouverts |
| P3 | `AF-WEST-B10` — **Palais d'Abomey** | Grandes successions de 3 cours hiérarchisées | Bauge, reliefs polychromes, murs hauts | Toits adaptés à chaque salle ; **L** |


## 12. Afrique centrale et australe — enclos pastoraux, royaumes de pierre, forêts `AF-SOUTH`

**Périmètre et signature :** M → T. Inclut **kraal** comme motif pastoral sud-africain, enceintes d’habitat, huttes rondes, rondavels et architecture en pierre sèche de Great Zimbabwe. « Kraal » peut désigner l’enclos à bétail **ou**, dans des usages historiques anglophones, un groupe d’habitations : il faut enregistrer les deux sens.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AF-SOUTH-S01` — **Village pastoral à kraal** | Huttes encerclant ou jouxtant une cour à bétail | Afrique australe, T |
| P1 | `AF-SOUTH-S02` — **Umuzi nguni** | Organisation concentrique/semicirculaire de huttes et enclos | Afrique australe, modèles observés surtout périodes tardives |
| P1 | `AF-SOUTH-S03` — **Village de concessions circulaires** | Plusieurs concessions familiales séparées, sentiers courbes | Zones de savane et vallées, T |
| P1 | `AF-SOUTH-S04` — **Enclos royaux en pierre sèche** | Grands murs courbes ou elliptiques et cours internes | Région Zimbabwe, XIe–XVe |
| P1 | `AF-SOUTH-S05` — **Agglomération Great Zimbabwe** | Enclos majeurs, habitats dispersés, noyau de colline | Plateau du Zimbabwe, XIe–XVe |
| P2 | `AF-SOUTH-S06` — **Village de rondavels** | Disques réguliers avec petites cours et chemins | Afrique australe, tradition longue, détails variables |
| P2 | `AF-SOUTH-S07` — **Village de cases forestières** | Unités végétales ovales/rectangulaires avec cours modestes | Afrique centrale équatoriale, traditions diverses |
| P2 | `AF-SOUTH-S08` — **Établissement de chasse/forêt mobile** | Petits abris légers dispersés près d'un point d'eau | Groupes/localités spécifiques, saisonnier |
| P3 | `AF-SOUTH-S09` — **Grand enclos à tour conique** | Mur elliptique monumental avec passages et espaces internes | Great Enclosure, Zimbabwe, XIVe |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AF-SOUTH-B01` — **Hutte ronde en terre et chaume** | Disque autonome, 1 niveau | Poteaux/terre, parfois pierre | Cône de chaume |
| P0 | `AF-SOUTH-B02` — **Clôture de kraal** | Enclos circulaire, sans toiture | Branches épineuses, bois, terre ou pierre | Portail orienté, intérieur libre pour bétail |
| P1 | `AF-SOUTH-B03` — **Rondavel maçonné** | Disque à mur épais, 1 niveau | Bauge, adobe ou pierre selon région | Cône de chaume très régulier |
| P1 | `AF-SOUTH-B04` — **Hutte en dôme végétal** | Disque avec paroi/toit parfois presque continus | Arceaux bois, tressage végétal | Dôme épais de chaume |
| P1 | `AF-SOUTH-B05` — **Concession familiale à plusieurs huttes** | Groupe de disques autour d'une cour | Enclos végétal/terre, petites annexes | Cônes de tailles différentes |
| P1 | `AF-SOUTH-B06` — **Maison de daga** | Disque/rectangle de pièce autour d'espace commun | Terre, arène granitique et argile | Chaume, espaces sur terrasses |
| P1 | `AF-SOUTH-B07` — **Mur monumental Zimbabwe** | Longues courbes de mur, entrées en chicane | Blocs de granit posés à sec | Pas de toiture, chevrons de maçonnerie |
| P2 | `AF-SOUTH-B08` — **Maison bois/végétal de forêt** | Rectangle bas ou ovale | Poteaux, écorce, tressage | Chaume/feuillage en croupe |
| P2 | `AF-SOUTH-B09` — **Grenier de réserve enclos** | Petit carré ou cercle protégé des animaux | Bauge et bois surélevé | Chaume conique |
| P3 | `AF-SOUTH-B10` — **Tour conique de Zimbabwe** | Petit cercle solide non habitable | Granit sec, assises régulières | Pointe tronquée maçonnée |

**Point d’attention :** Le **kraal** relève avant tout de l’organisation de l’espace pastoral. Il ne faut ni en faire un édifice couvert, ni en déduire que les sociétés africaines vivent toutes en huttes rondes.


## 13. Afrique orientale, Corne de l’Afrique et côte swahilie `AF-EAST`

**Périmètre et signature :** A → M. Mélange de cités portuaires en pierre corallienne, hauts plateaux de pierre/adobe, monuments éthiopiens et campements pastoraux semi-arides. Les longs contacts avec l’océan Indien expliquent certains patios et salles voûtées swahilis.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AF-EAST-S01` — **Village de huttes du plateau** | Huttes rondes/carrées espacées autour de cultures | Afrique de l'Est agricole, T |
| P1 | `AF-EAST-S02` — **Cité swahilie de pierre** | Parcelles serrées, mosquées et places, front de mer | Kilwa/Songo Mnara, IXe–XVe |
| P1 | `AF-EAST-S03` — **Village côtier swahili végétal** | Ruelles sableuses, maisons à cour et jardins | Littoral est-africain, M/T |
| P1 | `AF-EAST-S04` — **Cité d'altitude éthiopienne** | Ruelles en pente et ensembles de pierre/terre | Hauts plateaux, M |
| P1 | `AF-EAST-S05` — **Village de pierre/tukul éthiopien** | Huttes circulaires et maisons rectangulaires en jardin | Éthiopie, T |
| P1 | `AF-EAST-S06` — **Camp pastoral de boma** | Enclos pour animaux, petits groupes de huttes | Régions de savane et Corne, T |
| P2 | `AF-EAST-S07` — **Ville aksumite** | Ensembles bâtis en pierre, monuments de stèles | Aksoum, A |
| P2 | `AF-EAST-S08` — **Hameau des églises rupestres** | Habitat de pente autour d'espaces excavés | Lalibela et hauts plateaux, M |
| P2 | `AF-EAST-S09` — **Port marchand insulaire** | Mosquée, palais et maisons aux rues/places compactes | Kilwa et îles de la côte, M |
| P3 | `AF-EAST-S10` — **Village-palais baganda** | Séquences de cours et édifice circulaire monumental | Ouganda, tradition longue, exemple Kasubi **L** |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AF-EAST-B01` — **Tukul du plateau** | Hutte ronde avec petite véranda | Terre/pierre et poteaux bois | Cône de chaume |
| P1 | `AF-EAST-B02` — **Maison swahilie de corail** | Rectangle dense et pièces en enfilade, petite cour | Corail/calcaire corallien, chaux et bois | Toit-terrasse ou charpente locale |
| P1 | `AF-EAST-B03` — **Maison swahilie végétale** | Rectangle à cour et véranda | Clayonnage, boue, bois et palmes | Toit de palmes/chaume |
| P1 | `AF-EAST-B04` — **Maison des hauts plateaux** | Rectangle massif ou rond | Pierre et terre, bois | Toit conique/chaume ou terrasse régionale |
| P1 | `AF-EAST-B05` — **Église éthiopienne taillée dans le roc** | Croix ou rectangle excavé dans plateau | Roche vivante entièrement creusée | Couverture au niveau du terrain, tranchées d'accès |
| P1 | `AF-EAST-B06` — **Salle swahilie voûtée** | Salle rectangulaire de prestige | Calcaire corallien et mortier | Voûtes/dômes de maçonnerie |
| P1 | `AF-EAST-B07` — **Boma pastoral** | Cercle/ellipse sans bâtiment central imposé | Branches épineuses, palissades | Enclos bétail, accès étroit |
| P2 | `AF-EAST-B08` — **Maison axoumite à décrochements** | Plan composé, élévations en retraits | Pierre et bois en bandes horizontales | Toiture plate/terrassée hypothétique selon édifice |
| P2 | `AF-EAST-B09` — **Mosquée côtière à travées** | Rectangle à rangées de petites pièces | Calcaire corallien et colonnes | Voûtes, dômes, terrasse |
| P2 | `AF-EAST-B10` — **Case semi-ouverte de savane** | Ovale sous grand auvent | Poteaux, terre et vannerie | Chaume à large débord |
| P2 | `AF-EAST-B11` — **Stèle monumentale aksumite** | Plaque haute dressée rectangulaire | Monolithe de pierre sculpté | Sans toiture ; élément de place |
| P3 | `AF-EAST-B12` — **Grand édifice baganda en matériaux végétaux** | Plan circulaire monumental, cour d'accès | Poteaux bois, claies, roseaux | Très large dôme de chaume ; exemple conservé **L** |


## 14. Sous-continent indien — vallée de l’Indus, Inde ancienne et médiévale, Sri Lanka `AS-IND`

**Périmètre et signature :** A → M. Ne pas fusionner l’urbanisme de l’Indus (IIIe millénaire av. notre ère), les villes de royaumes médiévaux, les temples dravidiens/nagara et les maisons de villages tropicaux.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-IND-S01` — **Village de maisons à cour** | Enclos rectangulaires en grappes, rues organiques | Inde, Pakistan, Bangladesh, Sri Lanka selon climat, T |
| P1 | `AS-IND-S02` — **Cité harappéenne planifiée** | Quadrillage et hiérarchie des rues, quartiers de brique, drains | Civilisation de l'Indus, A |
| P1 | `AS-IND-S03` — **Ville royale fortifiée** | Quartier de palais/fort, marchés et extensions suburbaines | Royaumes indiens, M |
| P1 | `AS-IND-S04` — **Ville de temple dravidien** | Enceintes sacrées emboîtées, grandes rues rituelles | Inde du Sud, M |
| P1 | `AS-IND-S05` — **Ville de temple nagara** | Sanctuaire compact et tissu dense de cours autour | Nord et centre de l'Inde, M |
| P1 | `AS-IND-S06` — **Village de mousson** | Maisons à toit débordant, cours, chemins de terre | Plaines humides tropicales, T |
| P1 | `AS-IND-S07` — **Village désertique du Rajasthan** | Maisons compactes, forts, réserves d'eau et cours | Régions sèches, M/T |
| P2 | `AS-IND-S08` — **Ville-tank et ghats** | Quais/escaliers rituels autour d'un grand bassin | Inde urbaine, M/T |
| P2 | `AS-IND-S09` — **Ville royale du Deccan** | Ensembles de cours fortifiés, sanctuaires et marchés | Deccan, M |
| P2 | `AS-IND-S10` — **Village de plantations du Sri Lanka ancien** | Maison à cour, réservoir d'irrigation et temples séparés | Sri Lanka, A/M |
| P3 | `AS-IND-S11` — **Cité de stepwells** | Bassin profond maçonné et quartiers autour | Zones sèches, ouvrages régionaux M |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-IND-B01` — **Maison rectangulaire indienne** | Rectangle de 1 niveau, cour optionnelle | Adobe/brique, terre et bois | Tuiles, chaume ou toit-terrasse selon mousson |
| P1 | `AS-IND-B02` — **Maison harappéenne en brique** | Pièces fermées autour de petite cour | Brique cuite et crue | Terrasse/structure bois, évacuation des eaux |
| P1 | `AS-IND-B03` — **Maison à cour intérieure** | Anneau de pièces autour de vide central | Brique, pierre et bois | Tuiles ou terrasse selon région |
| P1 | `AS-IND-B04` — **Maison sur pilotis de région humide** | Rectangle à plancher haut et escalier extérieur | Bois/bambou, panneaux tressés | Croupe raide en palmes/chaume |
| P1 | `AS-IND-B05` — **Hutte conique rurale** | Rond/carré modeste | Bauge/terre et bambou | Cône végétal épais |
| P1 | `AS-IND-B06` — **Temple nagara à shikhara** | Carré sanctuaire, avant-salles sur axe | Pierre ou brique | Tour curviligne / flèche de pierre au-dessus de cella |
| P1 | `AS-IND-B07` — **Temple dravidien à vimana** | Carré cella avec salles et cours d'enceinte | Pierre appareillée | Pyramide de niveaux décroissants sur sanctuaire |
| P1 | `AS-IND-B08` — **Stupa bouddhique** | Cercle ou carré axial avec parcours de circumambulation | Brique/pierre, enduit | Dôme plein, balustrades et portails |
| P1 | `AS-IND-B09` — **Mandapa hypostyle** | Salle rectangulaire rythmée de piliers | Pierre sculptée | Dalles / volumes étagés en pierre |
| P2 | `AS-IND-B10` — **Maison marchande à balcon** | Rectangle à cour, étage sur rue | Brique/pierre, poutres bois, treillis | Toit plat ou tuiles |
| P2 | `AS-IND-B11` — **Baoli / puits à degrés** | Long puits excavé, galeries et escaliers multiples | Pierre maçonnée | Ouvert à ciel ouvert, pavillons |
| P2 | `AS-IND-B12` — **Maison rurale en latérite** | Rectangle bas à patio | Blocs de latérite et bois | Tuiles inclinées, larges avant-toits |
| P3 | `AS-IND-B13` — **Palais en cours multiples** | Blocs en U et cours successives | Pierre, brique, plafonds bois | Terrasses, pavillons et tours régionalement variables |

**Point d’attention :** Les gigantesques **gopurams** des grands complexes méridionaux et beaucoup de **havelis** célèbres ont des formes tardives. Ne pas appliquer automatiquement la silhouette la plus connue à une ville de l’Antiquité.


## 15. Himalaya — Tibet, Népal newar, Ladakh, Bhoutan `AS-HIM`

**Périmètre et signature :** M et traditions de longue durée. Pierre, terre, épais murs blanchis, rues de pente, cours et toits plats tibétains ; au Népal des villes de **brique + bois** avec temples à plusieurs toits. Les grands dzongs bhoutanais bien conservés sont surtout des XVIIe siècles et après.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-HIM-S01` — **Village de montagne en terrasses** | Maisons en gradins, passage par escaliers et toitures | Himalaya de haute altitude, M/T |
| P1 | `AS-HIM-S02` — **Village tibétain à maisons-terrasses** | Volumes rectangulaires agglutinés, cours encloses | Tibet/Ladakh secs et froids, M/T |
| P1 | `AS-HIM-S03` — **Cité newar à places-palais** | Denses îlots en brique, place rituelle à pavillons | Vallée de Kathmandu, M |
| P1 | `AS-HIM-S04` — **Ville monastique de pente** | Enclos de temples sur promontoire, habitat étagé | Tibet et Himalaya, M |
| P1 | `AS-HIM-S05` — **Village de vallée à toiture raide** | Unités moins compactes, champs et greniers | Népal central et versants humides, T |
| P2 | `AS-HIM-S06` — **Monastère fortifié himalayen** | Grand ensemble de cours et enceintes sur crête | Tibet/Ladakh, M |
| P2 | `AS-HIM-S07` — **Bourg de caravanes d'altitude** | Rue unique avec maisons et cours de commerce | Passages himalayens, M |
| P3 | `AS-HIM-S08` — **Dzong monumental bhoutanais** | Forteresse-monastère massive à cours et tours | Forme emblématique surtout **XVIIe–XVIIIe : L** |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-HIM-B01` — **Maison tibétaine blanchie** | Bloc rectangulaire de 2–3 niveaux, petite cour | Pierre/terre massive enduite, bois | Toit plat avec parapet |
| P1 | `AS-HIM-B02` — **Maison ladakhi en gradins** | Volumes rectangulaires étagés sur pente | Pierre/adobe, branches et terre | Terrasses à différentes hauteurs |
| P1 | `AS-HIM-B03` — **Maison newar de ville** | Rectangle étroit et haut, souvent 2–4 niveaux | Brique cuite, ossature/charpente bois | Toit de petites tuiles incliné, fenêtres sculptées |
| P1 | `AS-HIM-B04` — **Maison himalayenne à galerie** | Rectangle 1–2 niveaux | Pierre + charpente et galeries bois | Double pente raide en bardeaux/ardoises |
| P1 | `AS-HIM-B05` — **Temple newar à toits multiples** | Pavillon carré, étages emboîtés et décroissants | Brique et bois à poutres/étais sculptés | Plusieurs toitures de tuiles superposées |
| P1 | `AS-HIM-B06` — **Gompa / monastère tibétain** | Coussin de volumes à salles et cour(s) | Pierre/terre enduite, grandes salles en bois | Toits plats, bords peints et bannières |
| P1 | `AS-HIM-B07` — **Chorten / stupa tibétain** | Base carrée et volume central en dôme | Pierre, adobe, enduit blanc | Flèche composée de disques |
| P2 | `AS-HIM-B08` — **Maison-tour de l'Himalaya** | Petit carré haut, volumes superposés | Pierre massive et poutres | Toit plat / couverture locale |
| P2 | `AS-HIM-B09` — **Pavillon de palais newar** | Galeries en rectangle ou U sur cour | Brique, bois sculpté et soubassement pierre | Toiture tuilée à plusieurs niveaux |
| P2 | `AS-HIM-B10` — **Habitat troglodytique de falaise** | Cellules excavées avec galeries | Falaises de conglomérat/roche | Couverture naturelle |
| P3 | `AS-HIM-B11` — **Dzong à murs talutés** | Vastes enceintes et tours avec cour centrale | Pierre massive blanchie, charpentes bois | Toits légèrement relevés et grands bandeaux ; **L** |


## 16. Chine ancienne et médiévale — capitales impériales, bourgs, villages régionaux `AS-CHI`

**Périmètre et signature :** A → M, avec extensions L. **Le pack le plus important pour les bâtiments à plusieurs étages/toits imbriqués** : pavillons axiaux en charpente, cours *siheyuan*, avant-toits puissants, maisons de terre du nord, pilotis du sud et structures rupestres. Prévoir plusieurs sous-styles (Han/Tang/Song/Yuan/Ming) plutôt qu’un vague « chinois ».

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-CHI-S01` — **Village rural chinois à cours** | Pavillons rectangulaires en groupes, chemins structurés | Nord et centre, T |
| P1 | `AS-CHI-S02` — **Capitale impériale orthogonale** | Grande enceinte, axes N–S, quartiers et palais axial | Chang'an/Tang et Dadu/Yuan, périodes spécifiques |
| P1 | `AS-CHI-S03` — **Ville de district fortifiée** | Murs rectangulaires/irréguliers, portes, rues marchandes | Chine médiévale, M |
| P1 | `AS-CHI-S04` — **Ville marchande de canaux** | Trame de rues et ponts, parcelles en longueur | Jiangnan / bas Yangzi, M |
| P1 | `AS-CHI-S05` — **Village de montagne méridional** | Bâti sur terrasses, chemins sinueux et galeries | Sud/Sud-Ouest, T |
| P1 | `AS-CHI-S06` — **Bourg à cours en enfilade** | Ruelle étroite, murs mitoyens, plusieurs patios | Zones urbaines han, M |
| P2 | `AS-CHI-S07` — **Village de maisons sur pilotis** | Maisons alignées sur versants et rivières | Sud et régions de minorités, T |
| P2 | `AS-CHI-S08` — **Village à grottes yaodong** | Habitat excavé dans talus/plateau, cours creusées | Plateau de lœss, T |
| P2 | `AS-CHI-S09` — **Ville-port littorale chinoise** | Entre entrepôts, rues de commerce et quais | Côtes du sud, Song/Yuan, M |
| P2 | `AS-CHI-S10` — **Village clos de grands clans** | Enclos familial composé, habitat hiérarchisé | Chine du sud, tard M → L |
| P3 | `AS-CHI-S11` — **Village de tulou** | Plusieurs très grands anneaux/carrés habités avec cours | Fujian, **XVe–XXe**, surtout L |
| P3 | `AS-CHI-S12` — **Palais-cité à enceintes successives** | Superposition d'enceintes, portes et places sur axe | Capitale impériale, rare à l'échelle d'une carte |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-CHI-B01` — **Maison bois à deux pans** | Rectangle 1 niveau, travées régulières | Ossature bois, remplissage terre/brique | Tuiles grises avec avant-toits |
| P1 | `AS-CHI-B02` — **Siheyuan de cour** | Quatre pavillons en carré autour de cour axiale | Charpente bois, brique et murs de clôture | Toits de tuiles à deux pans |
| P1 | `AS-CHI-B03` — **Pavillon bois sur soubassement** | Rectangle/carré 1–2 niveaux | Poteaux bois, poutres et consoles dougong selon statut | Toit en croupe ou à deux pans, grands débords |
| P1 | `AS-CHI-B04` — **Maison marchande sur rue** | Rectangle étroit, 1–3 niveaux avec arrière-cour | Bois et brique | Tuiles, toiture raccordée à annexes |
| P1 | `AS-CHI-B05` — **Maison paysanne d'adobe** | Rectangle à cour et annexes agricoles | Murs de terre massive, bois | Toit-terrasse ou tuiles selon région |
| P1 | `AS-CHI-B06` — **Pagode à étages superposés** | Carré, hexagone ou octogone, 3–9 niveaux et plus | Bois, brique ou pierre selon époque | Toits indépendants à chaque niveau, retraits et avant-toits |
| P1 | `AS-CHI-B07` — **Grand hall palatial** | Large rectangle élevé sur plateforme | Ossature bois sur terrasse maçonnée | Immense croupe tuilée, faîtages ornés |
| P1 | `AS-CHI-B08` — **Maison sur pilotis du Sud** | Rectangle élevé sur pente/eau, galerie | Poteaux bois/bambou, cloisons tressées | Toit raide végétal ou tuiles régionales |
| P2 | `AS-CHI-B09` — **Tour de guet chinoise** | Carré/rectangle sur 2–4 niveaux | Brique/bois sur maçonnerie | Un ou plusieurs toits à avant-toits |
| P2 | `AS-CHI-B10` — **Yaodong excavé** | Cellules voûtées dans une façade de falaise | Creusement dans lœss ou voûtes en brique | Couverture de la terre naturelle |
| P2 | `AS-CHI-B11` — **Résidence de clan à cours successives** | Blocs et cours en enfilade axiale | Brique et bois | Toitures imbriquées à niveaux différents |
| P2 | `AS-CHI-B12` — **Pont couvert à pavillons** | Long rectangle de pont avec travées bâties | Charpente bois et piles de pierre | Couverture inclinée à pavillons ponctuels |
| P3 | `AS-CHI-B13` — **Tulou circulaire / carré** | Grand anneau ou carré fermé, 3–5 niveaux | Épais murs de pisé, bois intérieur | Toiture annulaire en tuiles, **majoritairement L** |
| P3 | `AS-CHI-B14` — **Pavillon complexe à toits imbriqués** | Corps carré central + ailes/galeries en retraits | Bois à assemblages complexes, consoles | 2–4 toits superposés et croisés, prestigieux |

**Point d’attention :** L’axe de **Beijing** est issu de Dadu/Yuan (XIIIe siècle), avec un patrimoine Ming/Qing postérieur. Les **tulou** classés datent du **XVe au XXe siècle**, beaucoup de leurs silhouettes les plus célèbres étant modernes ; les placer en P3/tardif.


## 17. Péninsule coréenne — royaumes anciens, Goryeo et Joseon ancien `AS-KOR`

**Périmètre et signature :** A → M. Trames villageoises adaptées au terrain, cours *madang*, bâtis en bois, ondol/chauffage au sol et toits en tuiles ou chaume, monastères de montagne. Distinguer maison élitaire et rurale.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-KOR-S01` — **Village coréen à cours** | Maisons disposées autour de cours à clôtures | Péninsule coréenne, M/T |
| P1 | `AS-KOR-S02` — **Bourg de marché de vallée** | Rue marchande et grappes de cours domestiques | Vallées agricoles, M |
| P1 | `AS-KOR-S03` — **Ville fortifiée de royaume** | Enceinte de pierre/terre, portes et palais | Silla/Goryeo/Joseon ancien, dates variables |
| P1 | `AS-KOR-S04` — **Village de versant** | Cours en terrasses, toits orientés au soleil | Montagnes tempérées, T |
| P2 | `AS-KOR-S05` — **Monastère sansa de montagne** | Cour *madang* entre hall, pavillons et cellules | À partir VIIe–IXe, M |
| P3 | `AS-KOR-S06` — **Palais à cours hiérarchisées** | Portes, grands halls et cours sur axe | Capitale ou siège royal, M |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-KOR-B01` — **Maison de bois et terre coréenne** | Rectangle 1 niveau, cour extérieure | Charpente bois et remplissage terre | Toit de chaume à quatre pans |
| P1 | `AS-KOR-B02` — **Hanok à cour** | Ailes en L ou U autour d'un *madang* | Ossature bois sur soubassement pierre, terre | Tuiles ou chaume selon statut |
| P1 | `AS-KOR-B03` — **Pavillon ouvert coréen** | Rectangle sur pilotis/soubassement, côtés ouverts | Piliers en bois, poutres assemblées | Grand toit débordant, souvent tuiles |
| P1 | `AS-KOR-B04` — **Hall de monastère sansa** | Rectangle à travées donnant sur cour | Bois, socle de pierre | Toit en croupe/deux pans, tuiles |
| P1 | `AS-KOR-B05` — **Maison de paysan avec ondol** | Rectangle bas, pièces isolées et pièce chauffée | Terre, bois, soubassement minéral | Croupe végétale / tuiles |
| P2 | `AS-KOR-B06` — **Tour de cloche/pavillon de palais** | Carré sur base surélevée | Ossature bois visible | Double toiture optionnelle, tuiles |
| P2 | `AS-KOR-B07` — **Pagode coréenne de pierre** | Base carrée et 3–5 niveaux de dalles | Pierre taillée | Toits de pierre superposés, silhouettes basses |
| P3 | `AS-KOR-B08` — **Complexe résidentiel aristocratique** | Plusieurs ailes en cours successives | Bois/brique terre enduite | Toits de tuiles, portes différenciées |


## 18. Archipel japonais — Yayoi, Kofun, Heian, Kamakura, Muromachi `AS-JAP`

**Périmètre et signature :** A → M. Habitants des villages et des villes sous **charpentes bois**, toits de chaume/écorce/bardeaux/tuiles, dépendances surélevées. Ne pas projeter sans filtre toutes les **machiya d’Edo**, les grandes tours de château et les pagodes iconiques sur le Japon de l’an 800.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-JAP-S01` — **Village de maisons à cour ouverte** | Petites unités en bois entourées de jardins/rizières | Japon rural, A/M |
| P1 | `AS-JAP-S02` — **Capitale de Heian-kyō** | Quadrillage d'inspiration chinoise, quartiers et palais | Kyoto à partir 794, M |
| P1 | `AS-JAP-S03` — **Ville de temples et monastères** | Axes vers sanctuaires, rues et jardins | Kansai et autres centres, M |
| P1 | `AS-JAP-S04` — **Bourg-port japonais** | Parcelles étroites adossées au quai, marchés | Ports médiévaux, M |
| P1 | `AS-JAP-S05` — **Village de pêcheurs côtier** | Bandes sur littoral avec espaces pour bateaux | Archipel, M/T |
| P2 | `AS-JAP-S06` — **Village de montagne** | Maisons séparées, terrasses et sentes | Régions boisées, M/T |
| P2 | `AS-JAP-S07` — **Ville de sanctuaire shinto** | Axe d'approche et enclos religieux dans tissu habité | Époques locales, M |
| P2 | `AS-JAP-S08` — **Centre de résidence guerrière** | Résidences encloses, petit fortin à relief dominant | Époque Kamakura–Muromachi, M |
| P3 | `AS-JAP-S09` — **Ville de château à donjon monumental** | Cercle fortifié + vastes quartiers ordonnés | Grande silhouette typique surtout **XVIe–XVIIe : L** |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-JAP-B01` — **Maison paysanne bois et chaume** | Rectangle 1 niveau, annexes | Poteaux bois, torchis/tressage | Grand toit deux pans ou croupe végétale |
| P1 | `AS-JAP-B02` — **Minka archaïsante de campagne** | Rectangle à plusieurs pièces sur plancher | Ossature bois et terre | Chaume raide en croupe ; détails variables selon période |
| P1 | `AS-JAP-B03` — **Maison aristocratique de style shinden** | Pavillon central avec ailes et galeries | Bois sur pilotis bas, cloisons mobiles | Toiture écorce/bois, grand avant-toit |
| P1 | `AS-JAP-B04` — **Maison urbaine de bois en rangée** | Rectangle étroit et profond, cour arrière | Bois, terre, galerie de devanture | Deux pans en tuiles/planchettes, style médiéval simplifié |
| P1 | `AS-JAP-B05` — **Grenier takayuka surélevé** | Petit carré haut sur poteaux | Poteaux bois et bardage bois | Toit en chaume/écorce |
| P1 | `AS-JAP-B06` — **Temple bouddhiste à pagode** | Carré vertical 3–5 niveaux | Charpente bois à poteau central possible | Toitures superposées et débordantes |
| P1 | `AS-JAP-B07` — **Sanctuaire shinto à galerie** | Rectangle surélevé à entrée marquée | Bois de charpente, socle pierre | Toit haut en écorce/chaume/bardeaux, faîtage orné |
| P1 | `AS-JAP-B08` — **Monastère bouddhiste à cour** | Série de halls rectangulaires autour d'axes | Bois et pierre de soubassement | Toitures tuilées, corps multiples |
| P2 | `AS-JAP-B09` — **Maison samouraï précoce à enceinte** | Pavillon en cour close et petites dépendances | Bois/terre, clôture bois ou maçonnerie | Toitures multiples en chaume/tuiles |
| P2 | `AS-JAP-B10` — **Pavillon à étages bois imbriqués** | Carré haut et pavillons en retraits | Ossature bois, consoles | 2–3 toitures successives ; élitaire/religieux |
| P2 | `AS-JAP-B11` — **Maison de ville machiya tardive** | Bande étroite et arrière-cours | Bois, murs coupe-feu terre | Tuiles et pignon/égout sur rue ; modèles conservés surtout **L** |
| P3 | `AS-JAP-B12` — **Donjon tenshu à niveaux retraits** | Tour haute à plans décroissants | Pierre de base + charpente bois | Toits multiples débordants ; **XVIe–XVIIe : L** |


## 19. Asie du Sud-Est continentale — Khmer, Thaï, Lao, Môn, Birmans, Cham, Viet `AS-SEA`

**Périmètre et signature :** A → M. **Pilotis et matériaux végétaux** dans l'habitat ordinaire humide ; **grands ensembles en pierre/brique** surtout religieux/politiques. L’Angkor habité n’était pas une forêt de temples en pierre : la majorité du bâti ordinaire était périssable.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-SEA-S01` — **Village de pilotis riverain** | Rangées sur berge, sentiers/passerelles, jardins | Vallées et plaines de mousson, T |
| P1 | `AS-SEA-S02` — **Capitale hydraulique khmère** | Grands axes et enceintes, barays, canaux et quartiers diffus | Angkor, IXe–XVe |
| P1 | `AS-SEA-S03` — **Cité-temple khmère close** | Enceinte carrée, portes cardinales, temple axial | Cambodge médiéval, M |
| P1 | `AS-SEA-S04` — **Cité birmane de plaine** | Rues, fortifications en terre/brique et stupas | Pagan/Bagan, XIe–XIIIe |
| P1 | `AS-SEA-S05` — **Village lacustre de maisons sur pilotis** | Maisons alignées sur chenaux, pirogues et passerelles | Zones lacustres et deltaïques, T |
| P1 | `AS-SEA-S06` — **Bourg de marché fluvial** | Quais, rues-parallèles à l'eau et sanctuaire | Mékong/Chao Phraya/Irrawaddy, M/T |
| P1 | `AS-SEA-S07` — **Centre cham à tours-sanctuaires** | Bâtiments rituels sur hauteur et habitat diffus | Champa, VIIe–XVe |
| P2 | `AS-SEA-S08` — **Ville-monastère du Laos/Thaïlande** | Temple dans enclos, bourg compact près de rizières | XIIIe–XVe et traditions plus tardives |
| P2 | `AS-SEA-S09` — **Village de plateau sec** | Bâtiments plus bas, cours dégagées et puits | Hautes terres continentales, T |
| P3 | `AS-SEA-S10` — **Métropole d'île/lagune hydraulique** | Chaussées, digues, îles artificielles et larges bassins | Rare, fortement dépendante du site |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-SEA-B01` — **Maison sur pilotis de mousson** | Rectangle sur poteaux, 1 plancher haut, escalier | Bois et bambou, panneaux tressés | Double pente/croupe raide en chaume |
| P0 | `AS-SEA-B02` — **Maison basse en bambou** | Rectangle 1 niveau, galerie | Poteaux et cloisons bambou | Palmes/chaume, longs débords |
| P1 | `AS-SEA-B03` — **Maison thaïe/loase sur pilotis** | Rectangles groupés autour de plateforme ouverte | Bois sur pilotis, planches | Grand toit aigu à deux pans, détails régionaux |
| P1 | `AS-SEA-B04` — **Maison vietnamienne traditionnelle à cour** | Rectangle long, cour et annexes | Bois, terre/brique, bambou | Tuiles et avant-toits |
| P1 | `AS-SEA-B05` — **Maison de village khmer** | Rectangle sur pilotis, escalier extérieur | Bois et panneaux légers | Croupe ou deux pans végétaux |
| P1 | `AS-SEA-B06` — **Prasat khmer** | Carré de sanctuaire, galeries et cours emboîtées | Grès/latérite/brique | Tours en niveaux décroissants, fausses voûtes |
| P1 | `AS-SEA-B07` — **Stupa birman / zedi** | Base carrée ou ronde, terrasses décroissantes | Brique maçonnée et enduit | Dôme et flèche effilée |
| P1 | `AS-SEA-B08` — **Tour cham de brique** | Carré à porte axiale et base ornée | Brique cuite appareillée | Tour en retraits, parements sculptés |
| P1 | `AS-SEA-B09` — **Monastère en pavillons bois** | Salles rectangulaires autour de cour | Bois, poteaux et plancher surélevé | Toits multiples raides, tuiles ou chaume |
| P2 | `AS-SEA-B10` — **Salle cérémonielle à toits superposés** | Rectangle/long volume sur socle | Bois ou maçonnerie selon tradition | 2–4 toitures superposées, pignons aigus |
| P2 | `AS-SEA-B11` — **Grenier à riz sur pilotis** | Petit carré/rectangle isolé | Bois/bambou sur poteaux hauts | Très grand toit végétal débordant |
| P2 | `AS-SEA-B12` — **Pavillon flottant ou halle d'eau** | Long rectangle sur flotteurs ou pieux | Bambou et bois | Toit léger en palmes |
| P3 | `AS-SEA-B13` — **Bibliothèque rituelle surélevée** | Petit carré sur socle/pilotis | Bois/pierre selon temple | Toiture élancée, édifice marginal |

**Point d’attention :** L’urbanisme d’Angkor associe **bassins, digues, canaux, chaussées et noyaux monumentaux**. Le matériau de l’habitat ordinaire doit rester distinct de celui des temples.


## 20. Insulinde et Asie du Sud-Est maritime — Java, Bali, Sumatra, Sulawesi, Bornéo, Philippines `AS-ISL`

**Périmètre et signature :** A locale → M/T. Bois ou bambou, pilotis, grandes maisons collectives, toitures courbes/très hautes, pavillons de cour, temples de pierre à Java. De nombreux exemplaires survivants de styles vernaculaires sont tardifs : une reconstitution médiévale doit rester prudente.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-ISL-S01` — **Village austronésien sur pilotis** | Maisons séparées reliées par sentiers, quais/passerelles | Archipels tropicaux, T |
| P1 | `AS-ISL-S02` — **Village de longhouses de Bornéo** | Quelques longues maisons parallèles au fleuve, débarcadères | Bornéo, traditions longues documentées tardivement |
| P1 | `AS-ISL-S03` — **Village de maisons familiales toraja** | Rangs de maisons et greniers en vis-à-vis, place cérémonielle | Sulawesi, T |
| P1 | `AS-ISL-S04` — **Village balinais de concessions** | Enclos familiaux multipavillons, cheminements réguliers | Bali, tradition longue |
| P1 | `AS-ISL-S05` — **Village javanais de cours** | Cour familiale, maison principale et ateliers | Java, M/T |
| P1 | `AS-ISL-S06` — **Village malais de berge** | Maisons sur pilotis écartées autour de vergers | Malaisie/Sumatra, T |
| P1 | `AS-ISL-S07` — **Ville royale javanaise** | Enclos de palais, places publiques et temples séparés | Royaumes hindou-bouddhistes, VIIIe–XVe |
| P2 | `AS-ISL-S08` — **Village niassien en alignement** | Grand axe central/pavé, maisons en rangées | Nias, traditions historiques, exemplaires tardifs |
| P2 | `AS-ISL-S09` — **Village fortifié de hauteurs indonésiennes** | Maisons de crête et enclos, mégalithes | Plusieurs îles, traditions locales |
| P2 | `AS-ISL-S10` — **Bourg littoral commerçant nusantarien** | Maisons/entrepôts sur pilotis, quais de bois | Ports des archipels, M |
| P3 | `AS-ISL-S11` — **Village sur grande plateforme commune** | Maison(s) communautaires, pontons et cours | Traditions localisées d'archipels |
| P3 | `AS-ISL-S12` — **Village de toits de selle monumentaux** | Rangs très ordonnés de grands pavillons | Iconographie typique toraja, état historique à dater |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-ISL-B01` — **Maison austronésienne sur pilotis** | Rectangle sur plateforme, 1 étage habitable | Poteaux bois, bambou, cloisons végétales | Deux pans très raides en palmes |
| P1 | `AS-ISL-B02` — **Longhouse de Bornéo** | Très long rectangle à dizaines de travées | Bois sur pilotis, partition en cellules | Longue couverture de chaume/bardeaux |
| P1 | `AS-ISL-B03` — **Tongkonan toraja** | Rectangle haut sur pilotis, plateforme entre colonnes | Charpente bois, panneaux décorés | Très grande selle à extrémités dressées |
| P1 | `AS-ISL-B04` — **Alang (grenier toraja)** | Petit rectangle en vis-à-vis du tongkonan | Bois sur poteaux | Toiture-selle réduite |
| P1 | `AS-ISL-B05` — **Maison balinaise en concession** | Petits rectangles séparés dans un mur d'enclos | Maçonnerie basse, bois et bambou | Tuiles végétales/argile, petites couvertures |
| P1 | `AS-ISL-B06` — **Joglo javanais (halle à noyau)** | Carré central à quatre piliers + annexes | Charpente bois sur poteaux majeurs | Pyramide centrale haute à pans composés |
| P1 | `AS-ISL-B07` — **Maison malaisienne surélevée** | Rectangle à galerie et véranda, plancher haut | Bois/bambou sur poteaux | Grand toit double pente en palmes/tuiles |
| P1 | `AS-ISL-B08` — **Temple javanais type candi** | Carré sanctuaire sur socle étagé | Pierre volcanique, blocs appareillés | Volumes étagés ascendants |
| P2 | `AS-ISL-B09` — **Maison de Nias / omo hada** | Rectangle ou ovale sur pilotis puissants | Gros poteaux bois obliques et assemblages | Très haut toit à deux pans, extrémités relevées |
| P2 | `AS-ISL-B10` — **Rumah gadang minangkabau** | Rectangle large, plusieurs travées | Charpente bois à piliers | Toits en cornes recourbées ; formes connues surtout tardives |
| P2 | `AS-ISL-B11` — **Maison batak à hauts pignons** | Grand rectangle sur pilotis | Bois, façades décorées | Haut toit incurvé et pignons projetés |
| P2 | `AS-ISL-B12` — **Salle/temple balinais à toiture multi-tier** | Carré/petit rectangle sur socle | Piliers bois et maçonnerie | Toiture *meru* empilée en niveaux décroissants |
| P3 | `AS-ISL-B13` — **Grand maison-tambaran analogue** | Très haut rectangle de rassemblement | Charpente de bois et panneaux tissés | Façade / faîtage exceptionnellement élevés, région à préciser |

**Point d’attention :** La **longhouse** et la maison **tongkonan** sont des *ensembles sociaux*, pas seulement des toits originaux : orienter les rangées, accès au fleuve, greniers et espaces rituels en conséquence.


## 21. Océanie et Pacifique — Mélanésie, Polynésie, Micronésie, Aotearoa `OC-PAC`

**Périmètre et signature :** A locale → M/T ; exemples étudiés jusqu’aux époques récentes. Beaucoup de bâtiments en matériaux périssables, mais aussi des monuments mégalithiques, des *marae/ahu* et la cité d’îlots de Nan Madol. Les types océaniens varient énormément entre îles.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `OC-PAC-S01` — **Village côtier polynésien** | Maisons rectangulaires/ovalaires près des arbres et d'une plage | Polynésie, T |
| P1 | `OC-PAC-S02` — **Village mélanésien à place centrale** | Maisons et grande maison rituelle autour d'espace commun | Mélanésie, selon île |
| P1 | `OC-PAC-S03` — **Village de pirogues / mangrove** | Pilotis/ponts et zones de mise à l'eau | Zones littorales humides, T |
| P1 | `OC-PAC-S04` — **Pā maori fortifié** | Terrasses de crête, palissades, fossés, habitations | Aotearoa, précontact et plus tard |
| P1 | `OC-PAC-S05` — **Village maori non fortifié** | Maisons dans des enclos, jardins, zones de stockage | Aotearoa, précontact |
| P1 | `OC-PAC-S06` — **Village de plateau papou** | Maisons proches des jardins, grandes voies de crête | Nouvelle-Guinée, traditions localisées |
| P1 | `OC-PAC-S07` — **Centre cérémoniel polynésien** | Habitat dispersé autour de *marae* ou terrasse sacrée | Îles Polynésiennes, T |
| P2 | `OC-PAC-S08` — **Village de maisons sur plateformes pierre** | Terrasses de lave et enclos, lieux rituels | Îles volcaniques, T |
| P2 | `OC-PAC-S09` — **Village de maison des esprits** | Grande halle cérémonielle détachée de l'habitat | Papouasie, traditions localisées |
| P3 | `OC-PAC-S10` — **Nan Madol — îlots mégalithiques** | 100+ îlots artificiels, canaux et grands murs en basalte | Pohnpei, vers 1200–1500 |
| P3 | `OC-PAC-S11` — **Village rituélisé de chefs insulaires** | Enclos d'élite, cours et accès par canaux | Micronésie, sites précis |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `OC-PAC-B01` — **Fale samoan ouvert** | Ovale/rectangle sous toiture, côtés ouverts | Poteaux bois et ligatures végétales | Toit bombé/chaume en croupe |
| P1 | `OC-PAC-B02` — **Maison polynésienne de chaume** | Rectangle/ovale et terrasse basse | Poteaux bois, nattes et végétaux | Croupe très raide de palmes |
| P1 | `OC-PAC-B03` — **Whare maori précontact** | Petit rectangle bas avec seuil et porche | Ossature bois, panneaux végétaux | Double pente en chaume/roseaux |
| P1 | `OC-PAC-B04` — **Pataka maori surélevé** | Petit carré/rectangle sur poteaux sculptés | Charpente bois | Toiture deux pans de végétaux |
| P1 | `OC-PAC-B05` — **Maison de chef fidjienne / bure** | Rectangle ou ovale assez grand | Bois, tressage et végétaux | Toit raide de palmes/chaume |
| P1 | `OC-PAC-B06` — **Halle rituelle de Nouvelle-Guinée** | Très long/haut rectangle avec façade marquée | Bois, bambou, tressage | Double pente hyper-accentuée |
| P1 | `OC-PAC-B07` — **Plateforme marae / ahu** | Grand rectangle de pierres, place ouverte | Blocs de pierre/basalte | Pas de toiture ; enceinte rituelle |
| P2 | `OC-PAC-B08` — **Maison sur pilotis de lagune** | Rectangle léger sur pieux | Bois local et bambou | Croupe végétale, ponton attenant |
| P2 | `OC-PAC-B09` — **Maison à coque végétale mélanésienne** | Ovale et entrée basse | Arcs végétaux, branchages | Voûte continue de chaume |
| P2 | `OC-PAC-B10` — **Hare paenga rapanui** | Plan de barque très allongé, seuil frontal | Soubassement de basalte, bois et joncs | Toit bas en coque végétale |
| P2 | `OC-PAC-B11` — **Maison cérémonielle sculptée** | Rectangle long à galerie avant | Poteaux bois sculptés et panneaux | Double pente décorée ; formes conservées souvent tardives |
| P3 | `OC-PAC-B12` — **Enclos mégalithique Nan Madol** | Murs hauts rectangulaires sur îlot artificiel | Colonnes de basalte et corail | Espaces ouverts, éléments bâtis ponctuels |
| P3 | `OC-PAC-B13` — **Monument funéraire sur plateforme** | Socle pierre et muret d'accès | Basalte/pierre coralienne | Ouvrage non couvert, dépend du rituel local |

**Point d’attention :** Pour la **pā maori**, des palissades et des terrasses sont des éléments constitutifs du settlement. Pour **Nan Madol**, l’îlot/canal est le module primaire, pas la parcelle de maison individuelle.


## 22. Australie autochtone et îles du détroit de Torres `OC-AUS`

**Périmètre et signature :** Préhistoire longue → XVe siècle et continuité ultérieure. **Grande diversité locale** : abris temporaires, villages liés à l'eau, constructions en pierre et grands systèmes aquacoles. Éviter absolument le modèle unique du « camp nomade sans architecture ».

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `OC-AUS-S01` — **Camp de groupes de huttes végétales** | Petits abris espacés autour de foyers avec voies d'accès au point d'eau | Régions et saisons variables, T |
| P1 | `OC-AUS-S02` — **Établissement de pêche lagunaire** | Ensembles à proximité des berges et points de capture | Régions humides et côtières, T |
| P1 | `OC-AUS-S03` — **Paysage aquacole Gunditjmara** | Canaux, barrages, étangs et digues hiérarchisés dans coulées de lave | Budj Bim, Australie du Sud-Est, plusieurs millénaires |
| P1 | `OC-AUS-S04` — **Village avec structures de pierre** | Groupes de petits enclos et cabanes près de ressources stables | Sites particuliers du Sud-Est, T |
| P2 | `OC-AUS-S05` — **Village côtier de grandes maisons végétales** | Volumes ovales/longs autour d'une plage | Australie tropicale, variations locales |
| P2 | `OC-AUS-S06` — **Village insulaire du détroit de Torres** | Maisons végétales sur zones hautes et cheminements côtiers | Torres Strait, T |
| P2 | `OC-AUS-S07` — **Camp sous abri rocheux** | Habitation partiellement adossée à falaises, foyers séparés | Zones rocheuses continentales, T |
| P3 | `OC-AUS-S08` — **Établissement intégré à pièges à poissons** | Habitat discontinu relié à réseaux de bassins/chenaux | Milieux humides spécialisés, T |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `OC-AUS-B01` — **Abri de branches et d'écorces** | Petit ovale/rectangle, parfois très ouvert | Perches et plaques d'écorce | Appentis ou voûte basse végétale |
| P0 | `OC-AUS-B02` — **Abri de feuillage en dôme** | Disque/ovale, accès latéral | Arceaux de branchages et feuilles | Coque végétale arrondie |
| P1 | `OC-AUS-B03` — **Cabane de pierre locale** | Petit rond ou ovale, mur bas | Basalte/roche locale en pierre sèche | Couverture végétale hypothétique/configurable |
| P1 | `OC-AUS-B04` — **Mur de canal aquacole** | Structure linéaire courbe/ramifiée | Pierres volcaniques posées à sec | Pas de toiture ; seuils et vannes |
| P1 | `OC-AUS-B05` — **Piège à poissons en pierre** | Bassins/emprises annulaires en eau | Petits murets et digues en pierre | Ouvrage de paysage, non bâtiment |
| P2 | `OC-AUS-B06` — **Abri de plateau sur poteaux** | Rectangle léger avec côté sous auvent | Poteaux bois, fibres, végétaux | Double pente simple |
| P2 | `OC-AUS-B07` — **Grande hutte végétale littorale** | Ovale allongé | Ossature d'arcs et natte végétale | Toit continu de feuilles épaisses |
| P3 | `OC-AUS-B08` — **Plateforme de rencontre extérieure** | Place/terre-plein aménagé, foyers groupés | Sol, pierre et structures temporaires | Sans toiture fixe |

**Point d’attention :** Le paysage de **Budj Bim** est d’abord une **infrastructure hydroécologique**, pas une ville de maisons-tours ou une trame romaine. Il couvre des réseaux élaborés sur des millénaires ; les formes d’habitation précises méritent une source locale.


## 23. Arctique et Subarctique d’Amérique — Inuit, Yupik, Aléoutes et peuples voisins `AM-ARC`

**Périmètre et signature :** A locale → M/T. Type de logement **très saisonnier**, souvent semi-enterré pour l’hiver, tentes pour les déplacements et abris de neige dans certaines régions. L’igloo de neige n’est pas l’habitation annuelle universelle des Inuit.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-ARC-S01` — **Camp de tentes d'été** | Petites unités espacées autour d'une rive ou ressource | Arctique et Subarctique, saison chaude |
| P1 | `AM-ARC-S02` — **Village hivernal semi-enterré** | Grappes d'habitats aux vestibules étroits, stockage séparé | Alaska et Arctique, T |
| P1 | `AM-ARC-S03` — **Village maritime aléoute** | Habitat partiellement enterré en bande littorale | Aléoutiennes, T |
| P1 | `AM-ARC-S04` — **Camp de chasse de banquise** | Petites unités temporaires sur neige ou côte | Hiver, régions particulières |
| P1 | `AM-ARC-S05` — **Village subarctique de rivière** | Cabanes de bois/écorce et espaces de séchage | Forêts boréales, T |
| P2 | `AM-ARC-S06` — **Hameau de maisons collectives** | Grandes maisons divisées, accès communs | Arctique nord-américain, traditions localisées |
| P2 | `AM-ARC-S07` — **Camp de transition de tentes et neige** | Mix d'abris légers et stockage saisonnier | Déplacements printaniers/automnaux |
| P3 | `AM-ARC-S08` — **Village de tourbe adossé à dune** | Maisons en dépression près de grève | Sites arctiques spécifiques |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-ARC-B01` — **Tente de peaux arctique** | Disque/ovale, 1 espace de couchage | Perches/os et peaux tendues | Dôme ou cône textile |
| P1 | `AM-ARC-B02` — **Maison de tourbe semi-enterrée** | Rectangle/ovale sous niveau du sol, tunnel d'entrée | Tourbe, pierres, bois flotté/os | Toit massif isolé de tourbe |
| P1 | `AM-ARC-B03` — **Maison de bois flotté et terre** | Rectangle bas avec vestibule | Bois flotté, terre et pierres | Couverture tourbeuse |
| P1 | `AM-ARC-B04` — **Qarmaq / abri saisonnier** | Petit rectangle/ovale semi-enterré | Pierre/tourbe/peau et supports bois | Toit de peau ou couverture mixte |
| P1 | `AM-ARC-B05` — **Igloo de neige** | Petit disque avec couloir d'entrée et coupole | Blocs de neige compactée | Dôme de neige, temporaire/saisonnier |
| P1 | `AM-ARC-B06` — **Maison semi-souterraine aléoute** | Grand ovale/rectangle enterré | Bois flotté, tourbe et os | Dôme/terrasse végétalisée |
| P2 | `AM-ARC-B07` — **Abri subarctique en écorce** | Ovale ou tente basse | Perches, écorces et peaux | Cône ou appentis |
| P2 | `AM-ARC-B08` — **Structure de séchage côtière** | Long rectangle ouvert sur poteaux | Bois flotté/os | Claires-voies sans toiture continue |
| P2 | `AM-ARC-B09` — **Cache surélevée** | Petit carré sur poteaux | Bois flotté ou perches | Couverture légère, accès difficile |
| P3 | `AM-ARC-B10` — **Habitat collectif allongé arctique** | Grand rectangle bas semi-creusé, travées | Bois/terre/pierre/os | Toiture tourbée avec tunnels d'accès |


## 24. Amérique du Nord — Nord-Est boisé, Grands Lacs et Plaines `AM-WOODS`

**Périmètre et signature :** A locale → M/T. **Longhouses** en groupes agricoles, villages palissadés, wickiups/wigwams dans certains secteurs, tipi dans les Plaines. Un wigwam et un tipi sont des géométries différentes ; le tipi n’est pas universel avant l’arrivée du cheval.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-WOODS-S01` — **Hameau de huttes en forêt** | Petites unités sous arbres, sentes et jardins | Woodlands, périodes variables |
| P1 | `AM-WOODS-S02` — **Village agricole de longhouses** | Grandes maisons parallèles et jardins, palissade optionnelle | Haudenosaunee et sociétés voisines selon époque |
| P1 | `AM-WOODS-S03` — **Village palissadé du Nord-Est** | Anneau/ovale de palissades, logements longs à l'intérieur | Régions iroquoiennes, M/T |
| P1 | `AM-WOODS-S04` — **Camp mobile des Plaines** | Tipis en cercle ou en arc, bétail/ressources et circulation | Plaines, traditions et saisons variables |
| P1 | `AM-WOODS-S05` — **Village de terre des Plaines** | Grandes huttes rondes groupées, champs et place | Mandan/Hidatsa et voisins, traditions locales |
| P1 | `AM-WOODS-S06` — **Village forestier au bord du lac** | Huttes et quais légers sous couvert végétal | Région des Grands Lacs, T |
| P2 | `AM-WOODS-S07` — **Camp de chasse subarctique** | Petits abris transportables et réserves hautes | Régions boréales, T |
| P2 | `AM-WOODS-S08` — **Village à maison du conseil** | Longhouse cérémonielle élargie et place de rassemblement | Nord-Est, traditions localisées |
| P3 | `AM-WOODS-S09` — **Village fortifié sur promontoire** | Fossés, palissade et rues internes réduites | Sites de défense, T |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-WOODS-B01` — **Wigwam / wickiup en dôme** | Petit plan rond/ovale | Arceaux de jeunes arbres, nattes/écorce | Coque basse d'écorce/végétal |
| P1 | `AM-WOODS-B02` — **Longhouse iroquoienne** | Très long rectangle, plusieurs foyers successifs | Arceaux/poteaux et panneaux d'écorce | Berceau ou double pente arrondie |
| P1 | `AM-WOODS-B03` — **Tipi des Plaines** | Plan circulaire à entrée orientée | Perches longues et peaux, plus tard autres toiles | Cône textile haut, démontable |
| P1 | `AM-WOODS-B04` — **Earth lodge des Plaines** | Rond de grand diamètre, vestibule | Poteaux bois, claies, épaisse terre | Dôme bas couvert de gazon |
| P1 | `AM-WOODS-B05` — **Maison longue à écorce** | Rectangle allongé à portiques bas | Charpente poteaux et grandes plaques d'écorce | Double pente très peu élevée |
| P1 | `AM-WOODS-B06` — **Maison du conseil** | Long rectangle élargi | Poteaux et écorce/bois | Toit cintré, foyer/entrée commune |
| P2 | `AM-WOODS-B07` — **Wickiup de branches** | Ovale de petite taille | Perches et chaume/broussailles | Coupole sommaire |
| P2 | `AM-WOODS-B08` — **Cache alimentaire haute** | Petit rectangle sur 4 à 6 poteaux | Bois et cordes | Toit léger, escalier amovible |
| P2 | `AM-WOODS-B09` — **Palissade du village** | Anneau épais avec une ou plusieurs portes | Troncs plantés, fossé de défense | Sans couverture continue |
| P3 | `AM-WOODS-B10` — **Loge cérémonielle sudation** | Petit dôme de faible hauteur | Arcs souples, couvertures/peaux | Coque provisoire, élément cérémoniel |

**Point d’attention :** Les *tipis* sont des habitats mobiles attestés avant la colonisation dans plusieurs régions, mais l’iconographie tardive des campements équestres ne doit pas être reportée partout ni à toutes les époques.


## 25. Sud-Ouest nord-américain — Pueblo ancestraux, Hohokam, Mogollon `AM-PUEB`

**Périmètre et signature :** A locale → M. Bâti **adobe/pierre**, empilement de cellules, cours/kivas, villages de mesa et falaises ; irrigation dans les bassins désertiques. Chaco (IXe–XIIIe) et Taos (tard XIIIe et suivants) sont des ensembles distincts.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-PUEB-S01` — **Pueblo de maisons en terrasse** | Amas de rectangles/étages autour de cours | Arizona/Nouveau-Mexique, M |
| P1 | `AM-PUEB-S02` — **Great House chacoane** | Immense plan en arc/rectangle segmenté, vaste cour et kivas | Chaco Canyon, IXe–XIIIe |
| P1 | `AM-PUEB-S03` — **Village de falaise mesa-verde** | Cellules serrées sous surplombs de roche, passages verticaux | XIIe–XIIIe, Colorado Plateau |
| P1 | `AM-PUEB-S04` — **Pueblo de mesa** | Agglomération en blocs sur un sommet plat | Sud-Ouest aride, M |
| P1 | `AM-PUEB-S05` — **Ville irriguée hohokam** | Groupes résidentiels près de canaux, cours et plateformes | Arizona antique/médiéval local |
| P1 | `AM-PUEB-S06` — **Pueblo le long du río** | Deux ou plusieurs masses à étages séparées par une cour/rivière | Rio Grande, XIIIe et après |
| P2 | `AM-PUEB-S07` — **Village semi-enterré de pithouses** | Petites cellules ovales/rectangulaires creusées | Formes plus anciennes, A locale |
| P2 | `AM-PUEB-S08` — **Village à kivas centrales** | Habitats sur pourtour, chambres rituelles rondes au centre | Chaco/Pueblo, M |
| P3 | `AM-PUEB-S09` — **Cliff palace géant** | Grand complexe en alcôve sous falaise | Mesa Verde, site d'exception |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-PUEB-B01` — **Maison pueblo en adobe** | Rectangle compact 1–3 niveaux | Adobe et enduit terre | Toit-terrasse en bois et terre |
| P1 | `AM-PUEB-B02` — **Bloc pueblo à étages en retrait** | Assemblage d'alvéoles en marches, accès par échelles | Adobe ou pierre/terre | Toitures terrasses servant de circulations |
| P1 | `AM-PUEB-B03` — **Great House en maçonnerie** | Grande courbe/carré à centaines de pièces | Grès appareillé et mortier de terre | Toits plats à poutres bois |
| P1 | `AM-PUEB-B04` — **Kiva rituelle** | Disque semi-enterré, bancs et fosse | Pierre et terre, piliers bois | Toit plat/charpente, accès vertical |
| P1 | `AM-PUEB-B05` — **Cliff dwelling** | Rectangles accolés sous voûte naturelle | Maçonnerie de grès et terre | Protection par surplomb, toitures plates |
| P1 | `AM-PUEB-B06` — **Maison à fosse / pithouse** | Rectangle arrondi excavé | Terre, poteaux et bois | Couverture de branches/terre basse |
| P1 | `AM-PUEB-B07` — **Plateforme et cour hohokam** | Cour enclose ou terrasse en terre | Adobe / briques crues | Toit ouvert, murs périphériques |
| P2 | `AM-PUEB-B08` — **Maison-tour pueblo** | Carré/rectangulaire étroit 2–3 niveaux | Grès/pierre et terre | Toit terrasse compact |
| P2 | `AM-PUEB-B09` — **Granary de falaise** | Petit rectangle haut placé dans alcôve | Pierre/terre | Toit protégé par la roche |
| P3 | `AM-PUEB-B10` — **Conjonction maisons/kiva** | Bloc rectangulaire adossé à grand disque | Pierre/terre | Terrasses en périphérie, trou central |


## 26. Amérique du Nord — tradition mississippienne et grands centres à tertres `AM-MISS`

**Périmètre et signature :** Principalement ~800–1400. Les grands **mounds/tertres** sont de la topographie artificielle à intégrer à la génération ; les habitats courants sont plus petits et en bois/terre/chaume. Cahokia n’est pas une ville de pyramides de pierre.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-MISS-S01` — **Village de palissades et maisons** | Maisons rectangulaires autour de petites places | Centre/Est nord-américain, M local |
| P1 | `AM-MISS-S02` — **Centre mississippien à mounds** | Place ouverte, monticules à plateformes, palais/temples au sommet | Cahokia et sites apparentés, ~800–1400 |
| P1 | `AM-MISS-S03` — **Village satellite des mounds** | Maisons et jardins reliés à grand centre cérémoniel | Vallées fluviales, M local |
| P1 | `AM-MISS-S04` — **Agglomération palissadée mississippienne** | Anneau de défense et place cérémonielle centrale | Sites localisés, M local |
| P2 | `AM-MISS-S05` — **Centre à alignements/astronomie** | Places, tertres et cercles de poteaux | Tradition mississippienne selon région |
| P2 | `AM-MISS-S06` — **Village de rive sur levée** | Maisons proches rivière avec greniers et champs | Mississippi/Ohio, M |
| P3 | `AM-MISS-S07` — **Grande ville régionale type Cahokia** | Hiérarchie de plateformes, zones de production et faubourgs | Site exceptionnel XIe–XIIIe |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-MISS-B01` — **Maison mississippienne rectangulaire** | Rectangle 1 niveau, foyer intérieur | Poteaux/terre, clayonnage torchis | Toit deux pans de chaume |
| P1 | `AM-MISS-B02` — **Maison sur monticule** | Rectangle cérémoniel sur plateforme artificielle | Bois et torchis | Toit incliné végétal |
| P1 | `AM-MISS-B03` — **Grande salle de chef** | Grand rectangle avec portique | Poteaux puissants, torchis | Grand double pente |
| P1 | `AM-MISS-B04` — **Monticule à plateforme** | Grand rectangle/ovale terrassé à pentes de terre | Remblais, gradins ou rampes | Sommet ouvert ou bâtiment léger |
| P1 | `AM-MISS-B05` — **Palissade d'enceinte** | Courbe fermée et portails | Troncs de bois, fossé | Sans toiture continue |
| P2 | `AM-MISS-B06` — **Plateforme funéraire** | Petit monticule rond ou conique | Remblais de terre | Sans toiture permanente |
| P2 | `AM-MISS-B07` — **Cercle de poteaux Woodhenge** | Anneau de poteaux alignés | Gros poteaux bois | Sans toiture |
| P2 | `AM-MISS-B08` — **Maison-grenier attenante** | Petit rectangle détaché des maisons | Bois, terre, stockage haut | Petit toit de chaume |
| P3 | `AM-MISS-B09` — **Grand tertre à gradins multiples** | Pyramide tronquée en étages de terre | Massif de remblais compactés | Esplanade supérieure, temple éventuel |


## 27. Mésoamérique — Olmèques, Teotihuacan, Zapotèques, Mayas, Toltèques, Mexicas `AM-MESO`

**Périmètre et signature :** A locale → XVe siècle. Au-delà des **temples à gradins**, villages de chaume et de terre, ensembles domestiques à cour, places rituelles, terrains de jeu de balle, et quelques villes de canaux. Ne jamais remplacer les quartiers ordinaires par des pyramides.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-MESO-S01` — **Village mésoaméricain de maisons dispersées** | Petites maisons autour de patios et jardins, chemins organiques | Mexique/Central America, T |
| P1 | `AM-MESO-S02` — **Cité maya à places cérémonielles** | Noyau de plateformes/pyramides et places, habitats périphériques diffus | Aires mayas, périodes classiques et postclassiques |
| P1 | `AM-MESO-S03` — **Teotihuacan orthogonale** | Axes monumentaux, complexes résidentiels répétés en quadrangles | Mexique central, Ier–VIIe siècle |
| P1 | `AM-MESO-S04` — **Ville zapotèque de montagne** | Terrasses de sommet, grande place, plateformes | Monte Albán et sites apparentés, A locale |
| P1 | `AM-MESO-S05` — **Cité mexica à îles et chaussées** | Quartiers lacustres, canaux, digues et zone sacrée | Tenochtitlan, XIVe–XVIe |
| P1 | `AM-MESO-S06` — **Village maya de basse altitude** | Maisons sur petites plateformes, patios et végétation | Yucatán/Guatemala, T |
| P1 | `AM-MESO-S07` — **Ville fortifiée maya postclassique** | Noyau plus compact, murs défensifs et places | Postclassique, M local |
| P2 | `AM-MESO-S08` — **Centre olmèque à plateformes de terre** | Esplanades, monticules et noyau cérémoniel | Golfe du Mexique, A locale |
| P2 | `AM-MESO-S09` — **Ville maya de style Puuc** | Séries de palais en quadrangles avec façades élaborées | Yucatán, VIIIe–Xe |
| P2 | `AM-MESO-S10` — **Ville de terrain de balle central** | Places à grands terrains en I, quartiers rituels | Plusieurs civilisations, périodes spécifiques |
| P3 | `AM-MESO-S11` — **Cité maya de jungle à chaussées** | Temples monumentaux séparés, *sacbeob* et habitats dispersés | Grands sites, schéma exceptionnel |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-MESO-B01` — **Maison maya rurale végétale** | Rectangle aux angles arrondis ou ovale, patio | Poteaux bois, clayonnage/enduit | Grand toit de palmes/chaume en croupe |
| P1 | `AM-MESO-B02` — **Maison mésoaméricaine sur plateforme** | Rectangle léger sur socle de terre/pierre | Bois, terre, petits moellons | Toiture végétale raide |
| P1 | `AM-MESO-B03` — **Ensemble résidentiel teotihuacain** | Gros rectangle à plusieurs cours et suites de pièces | Pierre/adobe et enduits peints | Terrasses plates et volumes composés |
| P1 | `AM-MESO-B04` — **Maison urbaine en adobe** | Petits rectangles jointifs et patios | Brique crue et pierre | Toits plats ou faible pente |
| P1 | `AM-MESO-B05` — **Temple-pyramide mésoaméricain** | Base carrée/rectangulaire, gradins vers petite cella | Terre/pierre parementée | Sommet plat, sanctuaire avec couverture |
| P1 | `AM-MESO-B06` — **Temple maya à voûte en encorbellement** | Petit rectangle massif sur socle | Maçonnerie de pierre et stuc | Fausse voûte, grande crête faîtière possible |
| P1 | `AM-MESO-B07` — **Palais maya à nombreuses portes** | Très long rectangle, galeries et cours | Pierre/stuc, supports maçonnés | Toits-terrasses et voûtes en encorbellement |
| P1 | `AM-MESO-B08` — **Terrain de jeu de balle** | Long I ou double T ouvert, murs latéraux | Pierre maçonnée et enduit | Aucune couverture, murs en pente |
| P1 | `AM-MESO-B09` — **Temple mexica double** | Grande plateforme à deux sanctuaires sommitaux | Pierre et maçonnerie enduite | Marches axiales, deux petits édifices |
| P2 | `AM-MESO-B10` — **Maison maya sur soubassement calcaire** | Rectangle à porche | Moellons calcaires, poutres bois | Chaume végétal |
| P2 | `AM-MESO-B11` — **Façade Puuc à mosaïques géométriques** | Bloc de palais rectangulaire | Pierre de taille et revêtement sculpté | Façade à frise supérieure dense |
| P2 | `AM-MESO-B12` — **Palais à grand quadrilatère** | Cour centrale et salles périphériques | Pierre/adobe/stuc | Portiques, toitures plates |
| P3 | `AM-MESO-B13` — **Complexe lacustre à chinampas** | Habitat sur îlots, jardins rectangulaires et canaux | Pieux, terre rapportée, plantes | Maisons légères à toit végétal |


## 28. Andes — Tiwanaku, Wari, Mochica/Chimú et Empire inca `AM-AND`

**Périmètre et signature :** A locale → XVe–début XVIe. **Kancha** (cour entourée de bâtiments rectangulaires), maçonnerie andine, terrasses de pente, places d’État ; sur la côte désertique, puissantes villes en adobe. Une cité inca n’est pas une cité maya à pyramides.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-AND-S01` — **Village andin de terrasses** | Petits rectangles de pierre/terre groupés sur pente | Hautes terres andines, T |
| P1 | `AM-AND-S02` — **Ville impériale inca** | Grandes places, blocs de kanchas, secteurs cérémoniels | XVe–début XVIe, Andes |
| P1 | `AM-AND-S03` — **Centre inca de crête** | Terrasses concentriques/linéaires, escaliers, zones résidentielles | Machu Picchu, XVe |
| P1 | `AM-AND-S04` — **Ville inca de vallée** | Trame relativement orthogonale adaptée aux reliefs, cours-kanchas | Ollantaytambo et centres d'État, XVe |
| P1 | `AM-AND-S05` — **Ville chimú de citadelles** | Grands complexes rectangulaires murés et rues contrôlées | Chan Chan, XIIIe–XVe |
| P1 | `AM-AND-S06` — **Centre tiwanaku planifié** | Plates-formes rituelles sur axes cardinalisés, quartiers en adobe | Altiplano, IVe–Xe |
| P1 | `AM-AND-S07` — **Ville cérémonielle côtière de terre** | Grandes plateformes et enclos, zones d'habitat à côté | Côte péruvienne préinca, A locale |
| P2 | `AM-AND-S08` — **Centre wari de blocs cloisonnés** | Grandes unités orthogonales et enceintes séparées | Hautes terres péruviennes, VIe–XIe |
| P2 | `AM-AND-S09` — **Domaine inca agricole** | Kanchas/terrasses, greniers isolés et canaux | Vallées et pentes, XVe |
| P2 | `AM-AND-S10` — **Halte inca de route / tambo** | Grand enclos, quelques blocs et place d'accueil | Sur réseau routier andin, XVe |
| P3 | `AM-AND-S11` — **Citadelle d'argile à cours successives** | Fortes enceintes, cours cloisonnées à accès filtrés | Chimú, caractère monumental |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-AND-B01` — **Maison andine rectangulaire** | Rectangle 1 niveau, intérieur peu cloisonné | Moellons de pierre ou adobe | Toit double pente de chaume |
| P1 | `AM-AND-B02` — **Kancha inca** | Enclos rectangulaire avec 3–8 bâtiments orientés vers cour | Pierre ou adobe, portes à encadrement trapézoïdal | Toits à deux pans de chaume sur corps séparés |
| P1 | `AM-AND-B03` — **Maison inca en pierre polygonale** | Rectangle au parement précis | Pierre appareillée polygonale (prestige), ou moellons ordinaires | Double pente végétale |
| P1 | `AM-AND-B04` — **Kallanka inca** | Très long rectangle, plusieurs portes donnant sur place | Pierre/adobe, grande charpente bois | Grand toit double pente de chaume |
| P1 | `AM-AND-B05` — **Qollqa / grenier inca** | Petit cercle ou rectangle ventilé, séries régulières | Pierre/terre, sol sec | Cône de chaume ou double pente |
| P1 | `AM-AND-B06` — **Terrasse agricole andine** | Bande/polygone long soutenu | Murs de soutènement pierre, terre | Aucune toiture ; canalisation |
| P1 | `AM-AND-B07` — **Maison chimú à cour** | Rectangle de salles, cours et dépôts | Adobe / terre sculptée | Terrasses, plateformes et murs hauts |
| P1 | `AM-AND-B08` — **Ushnu de place inca** | Plateforme rectangulaire à escaliers | Pierre maçonnée | Sommet ouvert, contexte rituel |
| P2 | `AM-AND-B09` — **Temple andin semi-souterrain** | Cour enterrée carrée | Monolithes et blocs pierre, drainage | Ouvert au ciel |
| P2 | `AM-AND-B10` — **Mur polygonal inca de prestige** | Long mur à joints ajustés, ouvertures trapézoïdales | Pierre de taille irrégulière hautement ajustée | Façade, non toit |
| P2 | `AM-AND-B11` — **Chullpa funéraire** | Tour ronde ou carrée, plusieurs mètres | Pierre/adobe, chambre interne | Dôme/terrasse de pierre ; sépulture |
| P2 | `AM-AND-B12` — **Temple tiwanaku en plateformes** | Grand carré avec gradins et cour | Grès/andésite appareillés | Sommet ouvert et monument(s) |
| P3 | `AM-AND-B13` — **Huaca côtière à gradins** | Massif de terrasses en terre | Millions de briques crues, enduits | Plateformes et rampes, non habitation |

**Point d’attention :** L’hypothèse « tout l’Empire inca = rues en grille » est fausse : les implantations sont **adaptées à la topographie**. Pour des unités domestiques, une **kancha** est d’abord un *compound*, pas un seul bâtiment.


## 29. Amazonie, Orénoque, Caraïbes et basses terres d’Amérique du Sud `AM-TROP`

**Périmètre et signature :** Avant 1500 et traditions longues, avec attestations archéologiques très variables. Grandes maisons collectives végétales, villages en couronne, habitats riverains et aménagements de terre. Ne pas supposer absence de planification ni de réseaux hydrauliques.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-TROP-S01` — **Village tropical de maisons végétales** | Maisons autour d'une clairière ou place commune | Amazonie/Caraïbes, traditions spécifiques |
| P1 | `AM-TROP-S02` — **Village circulaire du Haut Xingu** | Anneau d'habitations autour d'une très grande place, chemins rayonnants | Bassin du Xingu, traditions anciennes documentées |
| P1 | `AM-TROP-S03` — **Village amazonien de grandes maisons** | Quelques malocas et jardins de culture attenants | Zones forestières, traditions localisées |
| P1 | `AM-TROP-S04` — **Village riverain d'Amazonie** | Maisons alignées sur berge, pirogues et cultures | Bassins fluviaux, T |
| P1 | `AM-TROP-S05` — **Village palafitte de l'Orénoque** | Maisons sur pilotis et pirogues, passages en bois | Delta/lacunes, traditions locales |
| P1 | `AM-TROP-S06` — **Village taïno à batey** | Maisons autour d'une place publique/terrain rituel | Grandes Antilles, avant 1492 |
| P2 | `AM-TROP-S07` — **Établissement sur tertres amazoniens** | Habitat/places sur levées et monticules anthropiques | Marajó et autres systèmes régionaux, A locale |
| P2 | `AM-TROP-S08` — **Village de longues maisons en forêt** | Grands bâtiments séparés, clairières et sentiers | Sociétés spécifiques, T |
| P2 | `AM-TROP-S09` — **Village de savane à chemins radiaux** | Noyau entouré de fossés/levées et voies droites | Sites précolombiens particuliers |
| P3 | `AM-TROP-S10` — **Système de villages reliés par chaussées** | Anneaux d'habitat, routes géométriques, ouvrages de terre | Sud-ouest amazonien / haut Xingu selon sites |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-TROP-B01` — **Maison de palmes légère** | Rectangle/ovale, 1 niveau | Poteaux bois, nattes et claies | Croupe de palmes très débordante |
| P1 | `AM-TROP-B02` — **Maloca amazonienne** | Grand rectangle/ovale collectif, foyer(s) et travées | Poteaux bois, perches, végétal tressé | Toit long et continu de palmes |
| P1 | `AM-TROP-B03` — **Maison circulaire taïno / bohío** | Disque, entrée marquée | Poteaux bois, tressage végétal | Cône/croupe de palmes |
| P1 | `AM-TROP-B04` — **Maison longue de chef taïno / caney** | Grand rectangle/ovale donnant sur place | Bois et panneaux de fibre | Très grand toit végétal |
| P1 | `AM-TROP-B05` — **Maison sur pilotis de lagune** | Rectangle à plateforme haute | Pieux bois, tressage | Croupe légère en palmes |
| P1 | `AM-TROP-B06` — **Maison xinguana longue** | Ovale ou rectangle arrondi, grande hauteur | Ossature bois tressée | Grande coque végétale en croupe |
| P1 | `AM-TROP-B07` — **Place/terrain batey** | Grand quadrilatère libre, bordures de pierre possibles | Terre battue/pierres | Sans toiture |
| P2 | `AM-TROP-B08` — **Maison semi-ouverte de forêt** | Volume ovale à côté non entièrement clos | Bois, poteaux, hamacs intérieurs | Faîtage raide végétal |
| P2 | `AM-TROP-B09` — **Plateforme artificielle amazonienne** | Grand polygone de terrasse surélevée | Terre rapportée, rebords | Sommet d'habitats légers |
| P2 | `AM-TROP-B10` — **Grenier/séchoir surélevé** | Petit rectangle détaché | Bois/bambou sur poteaux | Petit toit de palmes |
| P3 | `AM-TROP-B11` — **Ouvrage de levée et chaussée** | Long ruban de terre surélevé entre quartiers | Terrassement terre, drains | Sans couverture |

**Point d’attention :** **Maloca**, **bohío**, **caney** et **maison xinguana** ne sont pas synonymes : les volumes peuvent sembler proches vus du ciel, mais les règles de composition communautaire et de placement sont différentes.


## 30. Sibérie et Extrême-Orient boréal — taïga, toundra et rivages `AS-SIB`

**Périmètre et signature :** A locale → M/T. Couverture modulaire des formes mobiles et semi-permanentes **propres à des groupes et climats particuliers** : chum, yaranga, huttes de rondins, caches sur pilotis ; éviter de tout appeler « yourte ».

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AS-SIB-S01` — **Camp forestier de tentes coniques** | Quelques unités autour d'un foyer/cours d'eau | Taïga sibérienne, T |
| P1 | `AS-SIB-S02` — **Camp de toundra à grandes tentes** | Volumes espacés, espace pour traîneaux/rennes | Nord sibérien, saisonnier |
| P1 | `AS-SIB-S03` — **Village littoral de semi-enterrés** | Habitations de tourbe/bois côte à côte près d'une grève | Tchoukotka et littoraux, régions spécifiques |
| P1 | `AS-SIB-S04` — **Village de rondins de taïga** | Bâtiments bas alignés sur berge, réserve de bois | Régions boisées, T |
| P2 | `AS-SIB-S05` — **Camp de transhumance de rennes** | Tentes démontables, cercles d'attache, parcours saisonniers | Toundra/taïga, T |
| P2 | `AS-SIB-S06` — **Hameau à maisons sur poteaux** | Logements/stockages surélevés pour l'humidité/neige | Zones forestières humides, T |
| P3 | `AS-SIB-S07` — **Village de maisons souterraines** | Cellules creusées, couloirs protégés, foyers | Sites archéologiques précis de l'Extrême-Orient |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AS-SIB-B01` — **Chum conique** | Rond à poteau central implicite | Longues perches, écorces/peaux/toile | Cône aigu démontable |
| P1 | `AS-SIB-B02` — **Yaranga tchouktche** | Grand cercle à armature complexe | Bois, peaux de renne, câbles | Dôme/cone bas à isolation intérieure |
| P1 | `AS-SIB-B03` — **Maison de rondins taïga** | Petit rectangle isolé du sol | Troncs à angles assemblés | Double pente en écorce/bois |
| P1 | `AS-SIB-B04` — **Maison de tourbe littorale** | Rectangle bas partiellement enterré | Bois flotté et tourbe | Voûte/terrasse basse végétalisée |
| P1 | `AS-SIB-B05` — **Cache sur poteaux** | Petit carré au-dessus du sol | Bois et pieux | Double pente en écorce |
| P2 | `AS-SIB-B06` — **Tente de peaux compacte** | Ovale démontable | Perches et membranes de peau | Coque tendue et basse |
| P2 | `AS-SIB-B07` — **Hutte de bois fendu** | Rectangle bas, petit vestibule | Lattes bois et boue | Couverture d'écorce |
| P3 | `AS-SIB-B08` — **Maison semi-souterraine complexe** | Réseau de petites pièces excavées | Bois, pierre et terre | Voûtes plates sous butte |


## 31. Nord-Ouest Pacifique américain — côte de cèdres et villages de planches `AM-PNW`

**Périmètre et signature :** Avant 1500 puis tradition historique. Grandes maisons lignagères permanentes en **planches de cèdre**, axes de plages et villages reliés par canoës. Les totems monumentaux en façade sont documentés de manière variable et en partie tardive : module visuel optionnel.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-PNW-S01` — **Village de longues maisons littorales** | Rangées de grands rectangles parallèles au rivage, espace pour canoës | Colombie-Britannique/Alaska/État de Washington, T |
| P1 | `AM-PNW-S02` — **Village à façade maritime continue** | Grandes maisons proches côte, arrière-bois et ruisseaux | Nord-Ouest Pacifique, T |
| P1 | `AM-PNW-S03` — **Village de baie abritée** | Bâtiments longs alignés sur plage, postes de pêche | Baies et estuaires, T |
| P1 | `AM-PNW-S04` — **Village saisonnier de pêche** | Cabanes simples, séchoirs et quais de bois | Migrations saisonnières, T |
| P2 | `AM-PNW-S05` — **Village de grands clans** | Plusieurs maisons monumentales associées à lignages | Cultures et lieux précis, T |
| P2 | `AM-PNW-S06` — **Village de rivière à saumon** | Habitat en bande et installations de capture/séchage | Rivières du Pacifique nord, T |
| P3 | `AM-PNW-S07` — **Centre de cérémonies de potlatch** | Maison de prestige et place pour rassemblements | Traditions régionales, documentation historique |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-PNW-B01` — **Longhouse côtière en planches** | Très grand rectangle, travées et foyers | Poteaux/poutres de cèdre, planches verticales | Deux pans longs en planches de bois |
| P1 | `AM-PNW-B02` — **Maison de clan haute** | Large rectangle à façade axiale | Gros bois fendu, poteaux sculptables | Grand toit de bois en deux pans |
| P1 | `AM-PNW-B03` — **Maison semi-enterrée de côte** | Rectangle légèrement excavé, salle commune | Bois de cèdre, terre de remblai | Toit bas en planches |
| P1 | `AM-PNW-B04` — **Séchoir à saumon** | Rectangle long et ouvert | Poteaux bois, clayonnage | Toit léger en planches/écorce |
| P1 | `AM-PNW-B05` — **Écran brise-vent de rivage** | Ligne de poteaux et panneaux | Bois en planches | Pas de toiture ou auvent |
| P2 | `AM-PNW-B06` — **Maison à façade peinte** | Long rectangle et porche central | Bois massif, panneaux décorés | Grand double pente à avant-toit |
| P2 | `AM-PNW-B07` — **Hangar à canoës** | Long rectangle ouvert sur plage | Poteaux et planches | Toit faiblement incliné |
| P3 | `AM-PNW-B08` — **Ensemble de maisons imbriquées** | Grand carré/rectangle à salles rajoutées | Poteaux en cèdre, planches | Toits jointifs, hauteurs variables |


## 32. Cône Sud et piémonts du sud de l’Amérique — Mapuche, Guaraní, Patagonie `AM-SOUTH`

**Périmètre et signature :** Avant 1500 puis traditions observées beaucoup plus tard. Architecture végétale, bois et terre dans les vallées forestières ; structures démontables des plaines froides. Les ethnonymes recouvrent des différences très fortes.

### Morphologies de settlements

| Prio | ID et archetype | Organisation du plan | Milieu et période |
|---|---|---|---|
| P0 | `AM-SOUTH-S01` — **Hameau de clairière forestière** | Petites unités et champs, voies de sentier | Cône Sud boisé, T |
| P1 | `AM-SOUTH-S02` — **Village mapuche de rukas** | Maisons grandes et espacées autour d'un espace communautaire | Centre-sud chilien/argentin, T |
| P1 | `AM-SOUTH-S03` — **Village guaraní à grande maison** | Grande(s) maisons collectives et clairière centrale | Régions tropicales/subtropicales, T |
| P1 | `AM-SOUTH-S04` — **Camp mobile de plaine froide** | Petits abris de peaux, dispositions saisonnières | Patagonie, périodes localisées |
| P1 | `AM-SOUTH-S05` — **Hameau riverain guaraní** | Habitat le long d'eau et de jardins | Bassin du Paraná/Paraguay, T |
| P2 | `AM-SOUTH-S06` — **Village de bord de lagune** | Maisons basses sur terrain élevé, canoës | Sud du continent, selon écosystème |
| P2 | `AM-SOUTH-S07` — **Camp fuégien côtier** | Petites huttes écartées près de la grève | Terre de Feu, T |
| P3 | `AM-SOUTH-S08` — **Grande clairière cérémonielle** | Habitat périphérique et aire collective ouverte | Site/culture à vérifier selon configuration |

### Morphologies de bâtiments / ensembles

| Prio | ID et archetype | Emprise et élévation | Structure / parois | Toit / détails distinctifs |
|---|---|---|---|---|
| P0 | `AM-SOUTH-B01` — **Maison rurale végétale** | Ovale/rectangle bas, 1 niveau | Bois, terre/torchis selon région | Chaume en croupe raide |
| P1 | `AM-SOUTH-B02` — **Ruka mapuche** | Grand ovale/rectangle arrondi, salle commune | Poteaux de bois et panneaux végétaux | Très grand toit continu en chaume |
| P1 | `AM-SOUTH-B03` — **Longhouse guaraní** | Très long rectangle avec travées | Bois, feuillage, armature ligaturée | Grande croupe en palmes |
| P1 | `AM-SOUTH-B04` — **Toldo patagonien** | Petit rectangle/ovale à accès bas | Perches et peaux tendues | Membrane inclinée ou arrondie |
| P1 | `AM-SOUTH-B05` — **Hutte fuégienne en dôme** | Petit disque/ovale | Perches arquées et écorce/végétal | Coupole légère de végétaux |
| P2 | `AM-SOUTH-B06` — **Granero de village forestier** | Petit rectangle sur supports | Poteaux et végétaux | Double pente végétale |
| P2 | `AM-SOUTH-B07` — **Abri de pêche côtier** | Ovale allongé, parfois ouvert | Perches et peaux/végétal | Appentis court |
| P3 | `AM-SOUTH-B08` — **Grande maison de rassemblement** | Long rectangle, place attenante | Gros poteaux de bois | Large croupe, détails dépendants du groupe |


---

# III. Index priorisé : les styles à implémenter dans le moteur

La priorité des **primitives** et la priorité des **packs culturels** sont deux axes différents. Un style P1 régional n'est pas « moins important » culturellement : il apporte une signature forte mais suppose des primitives générales déjà codées. Les niveaux ci-dessous décrivent l'ordre de **développement**, pas une fréquence archéologique ou une valeur patrimoniale.

## III.1. P0 — Socle architectural mondial indispensable

Avant d'avoir 32 packs pleinement opérationnels, ces **18 silhouettes/assemblages** permettent déjà de construire une grande diversité de cartes sans multiplier artificiellement les objets 3D.

| Nº | Style visuel | Forme | Structure / murs | Couverture | Générateur / familles concernées |
|---|---|---|---|---|---|
| 01 | **Hutte ronde de terre et chaume** | Disque ; 1 volume | Poteaux + torchis ou terre massive | Cône végétal | Fer européen, Afrique rurale, variantes régionales ; `FP-ROUND` + `RF-CONE`. |
| 02 | **Hutte ovale et croupe haute** | Ovale ; salle unique | Bois, végétaux, enduit terre | Croupe de chaume | Afrique australe, Océanie, monde végétal. |
| 03 | **Maison rectangulaire bois et torchis** | Rectangle ; 1 niveau | Pans de bois, clayonnage | Deux pans de chaume | Europe, Asie tempérée, habitats modestes. |
| 04 | **Maison de pierre rurale** | Rectangle ; 1–2 niveaux | Moellons locaux | Deux pans de tuiles, chaume ou lauzes | Europe, Méditerranée, Andes (adapter le toit). |
| 05 | **Maison de terre à toit plat** | Rectangle ou carré | Adobe, bauge, pisé | Terrasse et acrotère | Afrique du Nord, Sahel, Moyen-Orient, Nord de l'Inde, Pueblo selon variantes. |
| 06 | **Maison de bois à toit de bardeaux** | Rectangle | Rondins ou ossature | Deux pans raides en bois | Europe du Nord, Sibérie, forêts asiatiques. |
| 07 | **Maison étroite urbaine à étage** | Rectangle étroit | Bois/torchis, pierre ou brique | Toit à deux pans ; pignon ou gouttereau sur rue | Villes denses européennes et asiatiques avec variantes. |
| 08 | **Bâtiment sur pilotis** | Rectangle, terrasse élevée | Pieux + poteaux/poutres | Croupe végétale ou tuiles | Asie du Sud-Est, Chine du Sud, Océanie, littoraux. |
| 09 | **Maison à cour fermée** | Anneau, U ou pavillons autour d'un vide | Terre, pierre, brique ou bois | Toitures périphériques | *Siheyuan*, *kancha*, maisons à patio, concessions. |
| 10 | **Concession de huttes avec enclos** | Plusieurs disques/ovales | Huttes + clôture en terre, branches ou bois | Toits coniques indépendants | Kraals, concessions ouest-africaines, villages dispersés. |
| 11 | **Grande maison communautaire** | Rectangle très allongé | Gros poteaux, bois, terre ou végétal | Long toit à deux pans ou croupe | Longhouses eurasiennes, américaines, asiatiques. |
| 12 | **Dôme / tente circulaire** | Disque | Armature bois/treillis, membrane feutre/peau | Dôme textile | Steppes, camps saisonniers, nombreuses variantes distinctes. |
| 13 | **Habitat partiellement enterré** | Rectangle/ovale creusé | Bois + terre + pierre | Couverture de gazon, terre ou matériau léger | Froid, Arctique, Europe ancienne, Asie septentrionale. |
| 14 | **Maison-palais à pavillons axiaux** | Pavillons rectangulaires séparés | Ossature bois et cour close | Toits à larges avant-toits | Chine, Corée, Japon : dimensions et profils spécifiques. |
| 15 | **Maison-temple à toit de tuiles** | Rectangle/carré sur plateforme | Pierre/brique + charpente ou poteaux bois | Toit croupé ou pignon avec débords | Monde sinisé et régionalisations voisines. |
| 16 | **Maison dense à murs mitoyens** | Emprises composées, cour réduite | Pierre, brique ou terre | Terrasses raccordées ou plusieurs petits toits | Médina, cité romaine, bourgs et villes fortifiées. |
| 17 | **Plateforme monumentale en terrasses** | Rectangles emboîtés | Terre, brique crue, pierre | Généralement ouverte au ciel ; temple éventuel au sommet | Mésoamérique, Andes préincas, Mésopotamie (formes distinctes). |
| 18 | **Maison à pignon sculpté / très haut** | Grand rectangle sur poteaux ou pilotis | Bois sculpté, panneaux | Toit à pente forte / pignon haut | Insulinde, sociétés régionales d'Océanie et d'Asie. |

**Règle :** un toit conique ne signifie pas toujours « hutte africaine », de même qu'un toit à rives relevées n'est pas un attribut générique de toute l'Asie. Le *style* naît de l'association **plan + matériau + toiture + composition des bâtiments + parcelle + environnement**.

## III.2. P1 — Packs culturels indispensables à la reconnaissance

Une première couverture mondiale représentative peut utiliser les **20 presets** suivants. Chaque ligne désigne un archétype à combiner avec son pack détaillé en II.

| Signature recherchée | Settlement de référence | Corps de bâti à privilégier | Indices spatiaux décisifs |
|---|---|---|---|
| Village à enclos pastoral (*kraal*) | `AF-SOUTH-S01` et familles | `AF-SOUTH-B01`, `AF-SOUTH-B02` | Cercle/ellipse de clôtures, zone de bétail, huttes périphériques. |
| Village sahélien | `AF-SAHEL-S01` | `AF-SAHEL-B01`, `AF-SAHEL-B02` | Concessions de terre, murs arrondis, espaces ouverts. |
| Ville ancienne en terre du Sahel | `AF-SAHEL-S03` | `AF-SAHEL-B05`, `AF-SAHEL-B07` | Parcelles compactes, masses sculptées d'adobe, ruelles. |
| Ksar ou village d'oasis | `AF-MAG-S01`, `AF-MAG-S02` | `AF-MAG-B01` à `B04` | Habitat groupé, murs mitoyens, terrasses, palmeraie. |
| Bourg européen médiéval | `EUR-MED-S01` | `EUR-MED-B01` à `B05` | Rue-marché, parcelles profondes, toits à pans. |
| Oppidum de l'âge du Fer | `ATL-CEL-S03` | `ATL-CEL-B01`, `ATL-CEL-B02` | Remparts suivant relief, maisons basses, enclos. |
| Cité gréco-romaine | `MED-ANT-S02`, `MED-ANT-S03` | `MED-ANT-B01` à `B07` | Grille/axes, places civiques, cours, toit de tuile. |
| Ville de Mésopotamie | `AS-MIDE-S01` et suivantes | `AS-MIDE-B01` à `B04` | Blocs d'adobe, cours intérieures, toits plats. |
| Ville impériale chinoise | `AS-CHI-S02` | `AS-CHI-B02`, `B03`, `B07` | Axe N–S, enceintes hiérarchisées, cours et grands toits. |
| Village chinois méridional | `AS-CHI-S05`, `S07` | `AS-CHI-B08`, `B11` | Relief, cours/clans ou pilotis selon sous-région. |
| Ville japonaise ancienne/médiévale | `AS-JAP-S02` et suivantes | `AS-JAP-B01` à `B07` | Parcelles orientées vers rues, toits de tuiles/bois. |
| Cité indienne ancienne | `AS-IND-S01`, `S02` | `AS-IND-B01` à `B05` | Blocs et cours de brique, évacuation, rues structurées. |
| Cité-temple khmère | `AS-SEA-S01` | `AS-SEA-B01` à `B05` | Eau, grands bassins, causeways, enceintes et sanctuaires. |
| Village austronésien sur pilotis | `AS-ISL-S01`, `S02` | `AS-ISL-B01` à `B06` | Grandes toitures végétales, escaliers, cours communes. |
| Village côtier du Pacifique | `OC-PAC-S01`, `S02` | `OC-PAC-B01` à `B07` | Alignements de cases/pavillons, espaces communautaires. |
| Pueblo nord-américain | `AM-PUEB-S01`, `S02` | `AM-PUEB-B01` à `B05` | Volumes en terrasses, toits plats, cours/places. |
| Cité à tertres mississippienne | `AM-MISS-S01`, `S02` | `AM-MISS-B01` à `B04` | Grandes plateformes en terre, places et habitat autour. |
| Cité maya de collines et places | `AM-MESO-S03` | `AM-MESO-B03` à `B08` | Places cérémonielles, pyramides, groupes de palais. |
| Cité inca de montagne | `AM-AND-S02`, `S03` | `AM-AND-B01` à `B06` | Terrasses, pierres, *kanchas*, toits inclinés végétaux. |
| Village amazonien de grandes maisons | `AM-TROP-S01`, `S02` | `AM-TROP-B01` à `B05` | Clairière centrale, maisons collectives, chemins de forêt. |

## III.3. P2 — Variantes distinctives à introduire ensuite

- **Nord-Ouest américain :** grands rectangles collectifs en **planches de cèdre**, façades sur plage (`AM-PNW`).
- **Népal newar :** maisons de **brique et bois sculpté**, cours et pagodes (`AS-HIM`).
- **Himalaya tibétain :** volumes compacts pierre/terre, **toits-terrasses** et villages fortifiés (`AS-HIM`).
- **Swahili médiéval :** cours maçonnées en **corail et chaux**, rues côtières (`AF-EAST`).
- **Japon d'avant 1500 :** *machiya* et maisons à charpentes régionales, **sans donjon de l'époque moderne par défaut** (`AS-JAP`).
- **Grande maison d'Insulinde :** *tongkonan*, maisons Minangkabau, habitats batak — **toits en selle/cornus différenciés** (`AS-ISL`).
- **Hausa :** maisons à cours avec volumes de terre et décoration régionale (`AF-SAHEL`).
- **Pueblo troglodytique :** **maisons de falaise** et cellules creusées/adossées (`AM-PUEB`).
- **Chimú :** immenses **composés murés en adobe** et cours successives (`AM-AND`).
- **Oasis d'Asie centrale :** quartiers en terre, coupoles, caravansérails et cours (`AS-STEP`).
- **Nubie :** volumes et enceintes en brique crue, divers toits plats/voûtés (`AF-NILE`).
- **Complexes iroquoiens :** grandes *longhouses* multiples dans palissades (`AM-WOODS`).
- **Polynésie :** *marae* et maisons d'assemblée, ouverts/fermés selon archipel (`OC-PAC`).
- **Australie autochtone :** **ouvrages de pêche, bassins et canaux** en paysage habité plutôt que ville fictivement orthogonale (`OC-AUS`).

## III.4. P3 — Rares, complexes, extraordinaires ou chronologiquement tardifs

| Cas | Pourquoi P3 | Filtre indispensable |
|---|---|---|
| `AS-CHI-B13` — Tulou monumental | Anneau/carré fortifié multiétagé très caractéristique | Région Fujian ; origines médiévales possibles, exemples emblématiques surtout postérieurs à 1500. |
| `AS-MIDE` — Maisons-tours de Shibam | Élévation de brique crue sur plusieurs étages | La silhouette urbaine UNESCO est surtout du **XVIe siècle et après**. |
| `AS-JAP` — Donjon de château *tenshu* | Grand volume à toitures étagées | Monument de l'époque des châteaux à donjons, essentiellement **XVIe–XVIIe**. |
| `AF-MAG` — Grands ksour conservés | Plans fortifiés complexes en terre | Construction/réfections visibles souvent tardives ; classifier tradition et exemplaire séparément. |
| `AM-PUEB` — Habitat creusé dans falaise | Géométrie volumique soustractive, accès verticaux | Terrain et chronologie de site nécessaires. |
| `AM-MESO` — Grand complexe maya monumental | Multiples plateformes, temples, frises, terrains de jeu | Culture/période et taille de capitale ; non générer dans tous les villages. |
| `AM-AND-B10` — Maçonnerie inca polygonale de prestige | Détails coûteux, non visibles à petit zoom | Réserver aux sites de statut élevé et parements remarquables. |
| `AS-CHI-B14` — Pavillon à toitures imbriquées | Toits raccordés, consoles et galeries multiples | Statut élevé ; profil régional et période. |
| `AF-SOUTH` — Enceintes monumentales du Grand Zimbabwe | Masses courbes de pierre sèche | Lieu/pouvoir spécifique, pas un village africain générique. |
| `OC-PAC` — Plateformes funéraires monumentales | Géométries massives, mégalithiques ou insulaires | Traditions insulaires précises, pas tous archipels. |
| `OC-PAC` — Nan Madol | Îlots artificiels et murailles de basalte | Site unique, milieu lacustre et chronologie propres. |
| `AS-IND` — Temple rupestre excavé | Volumes négatifs, sculpture du relief | Géologie adaptée et chantier monumental. |

---

# IV. Presets de génération immédiatement exploitables

Ces **12 scènes de référence** donnent le résultat que le joueur doit reconnaître depuis une carte de village/ville. Elles sont indépendantes de la fonction précise de chaque bâtiment : on pourra ensuite y instancier chaumière, grenier, temple, palais, caserne, etc. Les ratios proposés sont des **heuristiques graphiques** et non des relevés archéologiques.

| Preset | Settlement / structure | Signature en vue zénithale | Modules de bâti / matériaux | Restriction et piège à éviter |
|---|---|---|---|---|
| **Kraal pastoral** | Enclos circulaire/elliptique, bétail au centre ou dans parc associé, accès contrôlé | Grands cercles emboîtés, 5–30 petits volumes ronds autour de cour | Huttes rondes terre/torchis, toits coniques/arrondis de chaume, clôtures bois/branches | Selon groupes, *kraal* peut désigner principalement l'enclos à bétail ; **ne pas confondre systématiquement unité domestique et village**. |
| **Village du Sahel** | Concessions agglomérées, cour centrale et passages irréguliers | Volumes ronds et carrés séparés par grands murs de terre | Pisé, bauge, adobe, charpente et couverture végétale | Nombreuses différences entre villages mandé, dogon, hausa, etc. |
| **Ville impériale chinoise** | Enceinte principale, axe N–S, zones du palais, quartiers avec cours | Rectangles orientés, portes successives, grands vides axiaux | Pavillons carrés/rectangulaires, toitures tuilées 2/4 pans, bois/terre/brique | Ne pas peupler tous les îlots de pagodes ; statut et époque conditionnent les toits sophistiqués. |
| **Cité inca** | Places, *kanchas* dans des enclos, rues/escaliers adaptés au relief | Blocs rectangulaires adossés à terrasses et cours | Pierre/moellons/adobe ; **toits de chaume à deux pans**, pas en pierre plate | Les murs conservés sont souvent sans toit : restituer charpente et couverture disparues. |
| **Bourg médiéval dense** | Rue dominante, marché, îlots étroits, mur d'enceinte parfois | Parcelles profondes, petits rectangles accolés, toitures alternées | Colombage/torchis, pierre, tuiles, ardoises, chaume selon milieu | Distinguer ville du nord en bois et ville du sud maçonnée ; pas de style européen universel. |
| **Polis hellénique / cité antique** | Agora, sanctuaires, quartiers plus ou moins orthogonaux | Cour centrale de maison, portiques sur grande place | Maçonnerie pierre/terre, stuc, tuiles, cours | Une cité antique n'a pas systématiquement une grille parfaite. |
| **Médina d'oasis** | Réseau de ruelles étroites et impasses, compacité élevée | Grappes de toits-terrasses et patios discrets | Terre crue, maçonnerie pierre/terre, enduits, toits plats | Distinguer Maghreb, Mashreq, Arabie méridionale, Sahara. |
| **Cité swahilie de pierre** | Tissu de ruelles, portes et cours proches du littoral | Petits rectangles jointifs, patios, mosquée et front portuaire | Calcaire corallien, chaux, bois, toits plats et charpentes régionales | Architecture particulière aux villes côtières, pas à toute l'Afrique orientale. |
| **Cité khmère hydraulique** | Réservoirs/barays, digues, chaussées et enclos de temples | Longues lignes d'eau, grands rectangles de murs, masse de forêt | Maisons en bois sur pilotis/végétales ; monuments en pierre | Le bâti résidentiel périssable était très différent des temples conservés. |
| **Pueblo en terrasses** | Ensemble compact de cellules à plusieurs niveaux | Rectangles jointifs étagés, vides de cours et échelles | Adobe ou pierre et terre, toits plats poutres/végétal/terre | Les maisons de falaise sont un sous-type régional, pas une norme. |
| **Cité maya à acropole** | Groupes de places cérémonielles, plateformes et zones résidentielles diffuses | Pyramides/gradins autour de places, chemins sur terrain | Maçonnerie pierre et stuc monumentale, maisons communes en végétal/bois | Éviter de représenter chaque maison comme une petite pyramide de pierre. |
| **Village austronésien sur pilotis** | Maisons familiales espacées/alignées, plateforme ou espace collectif | Rectangles longs avec escaliers/galeries ; grands toits | Bois/bambou, feuilles de palmier, parfois tuiles régionales | Forte diversité entre Java, Bali, Borneo, Sulawesi, îles philippines et Pacifique. |

## IV.1. Définition d'un style dans un fichier de données

**Ne pas enregistrer simplement** `style: chinese`. La donnée génératrice minimale devrait dissocier :

```yaml
schema_version: '0.1'
pack_id: AS-CHI
label: "Capitale impériale chinoise (période Yuan, simplifiée)"
chronology:
  from_year: 1271
  to_year: 1368
  temporal_flag: M
cultural_context:
  region: "Chine du Nord"
  subtradition: "Capitale impériale des Yuan / Dadu"
environment:
  landform: plain
  hydrology: [river, canal]
  material_availability: [timber, rammed_earth, fired_brick, clay_tile]
settlement:
  archetype: AS-CHI-S02
  base_geometry: SET-AXIAL
  optional_geometry: [SET-GRID, SET-WALLED]
  layout_rules:
    primary_axis: north_south
    outer_wall: true
    gates_align_with_major_routes: true
    ceremonial_compound_on_axis: true
    neighborhood_courtyards: true
  parcel_mix: [LOT-SIHEYUAN, LOT-MULTIYARD, LOT-COMPOUND]
building_palette:
  common:
    - archetype: AS-CHI-B01
      weight: 50
    - archetype: AS-CHI-B02
      weight: 35
    - archetype: AS-CHI-B04
      weight: 15
  landmarks:
    - archetype: AS-CHI-B07
      count_range: [1, 5]
    - archetype: AS-CHI-B06
      count_range: [0, 2]
constraints:
  forbidden_if_strict_before_1500: [AS-CHI-B13]
  notes: "Pondérations purement illustratives, non démographiques."
```

```yaml
schema_version: '0.1'
pack_id: AF-SOUTH
label: "Concession pastorale / kraal, variante illustrative"
chronology:
  temporal_flag: T
environment:
  landform: rolling_plain
  material_availability: [wood, earth, grasses]
settlement:
  archetype: AF-SOUTH-S01
  base_geometry: SET-CIRCULAR
  compound_geometry: LOT-KRAAL
  layout_rules:
    perimeter: oval_or_round
    livestock_enclosure: center_or_adjacent
    residential_units: peripheral_clusters
    entrance_count_range: [1, 3]
    orient_access_by_terrain_and_social_rule: true
building_palette:
  common:
    - archetype: AF-SOUTH-B01
      footprint: FP-ROUND
      roof: RF-CONE
      weight: 70
    - archetype: AF-SOUTH-B02
      weight: 30
constraints:
  notes: "Exemple abstrait ; préciser communauté/région avant reconstruction historique."
```

```yaml
schema_version: '0.1'
pack_id: AM-AND
label: "Centre inca de montagne, fin XVe"
chronology:
  from_year: 1450
  to_year: 1500
  temporal_flag: M
environment:
  landform: steep_mountain
  hydrology: [spring, irrigation_canal]
  material_availability: [stone, earth, thatch, timber]
settlement:
  archetype: AM-AND-S03
  base_geometry: SET-TERRACE
  layout_rules:
    contour_following_paths: true
    stairs_between_levels: true
    retain_walls_as_first_class_features: true
    ceremonial_plaza: true
    residential_compounds: LOT-KANCHA
building_palette:
  common:
    - archetype: AM-AND-B01
      weight: 65
    - archetype: AM-AND-B02
      weight: 35
  landmarks:
    - archetype: AM-AND-B04
      count_range: [0, 2]
    - archetype: AM-AND-B08
      count_range: [0, 1]
constraints:
  do_not_replace_thatch_with_stone_roof: true
  reserve_fine_polygonal_stone_for_prestige: true
```

## IV.2. Exemple de **recette de bâtiment**, distincte du pack

```yaml
id: BLD-HUT-ROUND-WATTLE
label: "Hutte ronde, torchis, toit conique en chaume"
priority: P0
form:
  footprint: FP-ROUND
  plan_radius_m: [2.0, 4.5]   # heuristique de rendu, pas typologie universelle
  floors: 1
  entrance_count: 1
  orientation: towards_courtyard_or_path
structure:
  frame: MAT-TIMBER-POST
  wall_infill: MAT-WATTLE-DAUB
  coating: MAT-MUD-PLASTER
  base: earth_or_stone
roof:
  type: RF-CONE
  cladding: MAT-THATCH
  overhang_m: [0.15, 0.65]
  pitch_deg: [35, 60]
usage_tags: [domestic, utility, workshop]
allowed_regions: [ATL-CEL, AF-SAHEL, AF-SOUTH, AF-WEST]
constraints:
  must_match_region_specific_variant: true
  note: "Générique : les dimensions et formes réelles dépendent de la culture."
```

```yaml
id: BLD-TIMBER-TIERED-PAVILION
label: "Pavillon à niveaux et toits de bois/tuiles imbriqués"
priority: P2
form:
  footprint: FP-SQUARE
  floors: [2, 3]
  volumes: stacked_offset_rectangles
  upper_floors_setback: true
structure:
  frame: MAT-TIMBER-POST
  joinery: MAT-WOOD-MORTISE
  wall_infill: regional_timber_or_brick
  platform: stone_or_brick
roof:
  type: RF-TIERED
  underroof_form: RF-EAVES
  cladding: MAT-TILE-CLAY
  each_tier_gets_own_roof: true
  ridge_upturn: culture_specific_only
allowed_regions: [AS-CHI, AS-KOR, AS-JAP]
constraints:
  role: [pagoda, pavilion, palace_gate]
  rarity: exceptional
  culture_specific_profiles_required: true
  note: "Archétype de géométrie, pas un modèle historiquement interchangeable."
```

---

# V. Règles de composition spatiale et de compatibilité

## V.1. Les sept champs obligatoires du style

1. `settlement_pattern` : géométrie générale et réseau de circulation.
2. `compound_pattern` : partition des propriétés, murs, cours et dépendances.
3. `footprint_family` : plans carrés, ronds, longs, en L/U, composites ou excavés.
4. `elevation_family` : 1–N niveaux, retraits, débords, plateformes, pilotis.
5. `structure_system` : murs porteurs de terre/pierre, poteaux/poutres, rondins, bambou, etc.
6. `roof_system` : type, pente, orientation, couverture et détails.
7. `surface_language` : enduits, pigments, ouvertures, charpentes visibles et modénatures.

Le **matériau du mur** ne suffit pas à identifier sa **structure porteuse** : un enduit blanc peut cacher du torchis, de la pierre ou de l'adobe ; un toit en chaume peut couvrir une charpente complexe ou une hutte simple.

## V.2. Contraintes minimales pour qu'une carte paraisse réaliste

| Contraintes | Effet dans le générateur |
|---|---|
| Relief | Ville en pente → terrasses, escaliers, bâtiments orientés sur courbes de niveau, accès plus étroits. |
| Hydrologie | Village rivière → chemins de berge, quais, ponts ; bassins et canaux pour les cultures hydrauliques concernées. |
| Climat | Pluie/neige → pentes adaptées ; climat sec → toits-terrasses possibles, sans en faire une règle universelle. |
| Matériaux locaux | Probabilités de pierre/terre/bois/bambou/chaume par région et période ; importation limitée aux statuts élevés. |
| Densité | Village pastoral → volumes et enclos espacés ; métropole → murs mitoyens et rues/cours compactes. |
| Hiérarchie sociale | Monument, temple, palais et résidence notable ont accès aux grandes portées et décorations coûteuses. |
| Âge urbain | Croissance organique, trames recoupées, remparts successifs ; fondation planifiée si contexte justifié. |
| Parcelle | L'unité de génération peut être un **enclos familial de 8 cases**, pas simplement 8 maisons indépendantes. |
| Taille du settlement | Un hameau n'a ni palais impérial ni ziggourat par simple tirage uniforme. |
| Temporalité | Aucune silhouette identifiée surtout après 1500 en monde strictement antique/médiéval. |
| Monuments | Distinguer habitat quotidien et architecture du pouvoir ; ne pas déduire tous les bâtiments du style des vestiges monumentaux. |
| Assemblage des toits | Rendre faîtage, débords, hiérarchie des niveaux, ombre et ouvertures, sinon tous les styles se ressemblent. |

## V.3. Ordre de génération recommandé

1. Sélectionner `culture_pack`, fenêtre chronologique, sous-tradition, climat, terrain et ressources.
2. Générer l'**enveloppe** (vallée, plateau, berges, lignes de crête, terres cultivables, défense possible).
3. Instancier le **pattern settlement** (axes, chemins, places, eau, murs, canaux, terrasses).
4. Diviser les **grands îlots en compounds/parcelles** selon le modèle régional (cour, lanières, concession, longue maison, *kancha*, etc.).
5. Générer d'abord les **volumes structurants** : maison commune, palais, temple, grand enclos, plateforme, tertre ; réserver leurs marges et accès.
6. Dans chaque parcelle, instancier les **building recipes** admissibles, en respectant l'orientation des entrées sur rues/cours.
7. Résoudre les couvertures et les élévations ; prévoir les **débords de toit** comme géométrie distincte de l'emprise murale.
8. Ajouter les interfaces : escaliers, échelles, galeries, portiques, passerelles, murets, rives et soutènements.
9. Rendre les matériaux et les détails d'époque ; renforcer la lisibilité *top-down* par l'ombre, la couleur et les toitures.
10. Mesurer diversité, cohérence et densité ; contrôler qu'aucun bâtiment ne bloque une voie/porte ou ne viole les contraintes du pack.

## V.4. Pour les besoins du jeu de rôle : mélange culturel contrôlé

Le moteur peut proposer trois modes, au choix de la campagne :

- `historical_strict` : cultures, matériaux, bâtiments, trames et périodes compatibles, avec exceptions documentées.
- `historical_inspired` : base culturelle stable, latitude sur la taille et les variantes ; utile en univers pseudo-historique.
- `fantasy_mix` : combinaisons libres **mais techniquement et spatialement cohérentes** (par exemple une ville de marchands aux cours chinoises, des huttes de chaume sahéliennes et une enceinte de pierre andine), avec paramètres de cohérence plutôt qu'une fusion visuelle aléatoire.

**Ne pas fusionner automatiquement** Chine, Corée et Japon dans un seul `East Asian`, Afrique subsaharienne dans `African huts`, ni Mésoamérique et Andes dans `Pre-Columbian pyramids`. Les différences de planification, de structure et de toiture sont précisément la raison d'être de cet atlas.

---

# VI. Glossaire des termes qui changent réellement la géométrie

| Terme | Sens procédural utile | À ne pas confondre avec |
|---|---|---|
| **Kraal** | Enclos, surtout pastoral ; selon usage linguistique, concession ou village clôturé. | Toute hutte ronde africaine ; enceinte de bétail ≠ settlement entier dans tous les contextes. |
| **Rondavel** | Maison ronde, généralement avec toit conique ; archétype associé à l'Afrique australe. | Village circulaire : c'est un **bâtiment**, pas un pattern urbain. |
| **Compound / concession** | Parcelle avec plusieurs habitations, cours, clôtures, dépendances. | Maison individuelle simple. |
| **Oppidum** | Centre fortifié de l'âge du Fer, plan contraint par remparts et relief. | N'importe quel village à une palissade. |
| **Castro** | Établissement fortifié ibérique, souvent perché, morphologie locale variable. | Château féodal. |
| **Ksar / ksour** | Ensemble fortifié de terre/pierre, souvent oasis ou milieu présaharien. | Kasbah au sens de citadelle/résidence fortifiée ; les mots ne sont pas synonymes parfaits. |
| **Medina** | Tissu urbain ancien à rues, cours et fonctions multiples. | « Tout en adobe » ou forcément labyrinthique. |
| **Siheyuan** | Ensemble de pavillons encadrant une cour rectangulaire ordonnée. | Bâtiment carré unique ou pagode. |
| **Pagode** | Tour/édifice religieux avec étages/couvertures superposées selon pays. | Tous les temples ou toutes les maisons chinoises. |
| **Tulou** | Grand volume collectif défensif en terre, circulaire **ou carré**, à cour intérieure. | Yourte, village de huttes rondes, simple mur d'enceinte. |
| **Kancha** | Enclos andin contenant plusieurs bâtiments rectangulaires autour d'une cour. | Un seul bâtiment inca. |
| **Kallanka** | Grande halle inca allongée souvent liée aux centres administratifs. | Maison ordinaire. |
| **Qollqa / colca** | Grenier-entrepôt andin, souvent répété par séries. | Tour résidentielle. |
| **Huaca** | Site/élément sacré andin ; parfois complexe de plateformes monumentales. | « Pyramide » de n'importe quelle civilisation américaine. |
| **Baray** | Grand réservoir artificiel dans certains systèmes urbains khmers. | Simple douve de fortification. |
| **Longhouse** | Grande habitation ou maison collective allongée. | Un type unique : charpentes et organisations varient énormément. |
| **Tongkonan** | Maison toraja à toiture expressive en selle, surélevée. | Maison générique de toute l'Indonésie. |
| **Marae** | Espace cérémoniel polynésien, souvent plateforme ou cour. | Maison d'habitation. |
| **Pueblo** | Ensemble architectural de cellules d'habitat, souvent terre/pierre en terrasses dans le Sud-Ouest américain. | N'importe quelle maison adobe du monde. |
| **Ziggourat** | Masse de terrasses monumentales mésopotamiennes avec sanctuaire supérieur. | Pyramide funéraire égyptienne ou maya. |
| **Maloca** | Grande maison communautaire de certaines sociétés amazoniennes. | Tout habitat autochtone amazonien, ou toute longue maison. |
| **Great house (Chaco)** | Complexe monumental multifamilial/fonctionnel en maçonnerie, avec cours et plusieurs étages. | La totalité des maisons d'un village pueblo. |

---

# VII. Périodes et garde-fous historiques

| Risque de confusion | Règle de génération |
|---|---|
| **Tulou du Fujian** | Tradition ancienne, mais la série classée comprend des bâtiments du XVe–XXe siècle et les exemples les plus élaborés sont surtout XVIIe–XVIIIe ; profil emblématique filtré *late* par défaut. |
| **Cité de Shibam** | Implantation plus ancienne, mais l'urbanisme vertical des tours de terre conservé est associé au XVIe siècle ; ne pas le traiter comme un décor typique de l'Antiquité. |
| **Axe impérial de Beijing** | Axe structurant initié sous les Yuan ; beaucoup de bâtiments actuels sont Ming/Qing ; ne pas projeter le palais visible aujourd'hui sur la Chine antique. |
| **Machu Picchu** | Ensemble inca du XVe siècle ; murs de pierre souvent préservés mais **toitures végétales disparues** ; restitution nécessaire. |
| **Donjons japonais** | Ne pas introduire automatiquement la silhouette du *tenshu* des XVIe–XVIIe dans un décor Heian/Kamakura. |
| **Ksar d'Aït-Ben-Haddou** | Le site atteste une tradition ancienne mais une bonne part du bâti conservé a été renouvelée ou reconstruite tardivement. |
| **Palais d'Abomey / tombes de Kasubi** | Exemplaires célèbres majoritairement modernes ; employer les formes dans leur tradition pertinente sans « vieillissement » fictif automatique. |
| **Amériques** | Avant 1500, aucune équivalence automatique « médiéval = féodal européen ». Employer les chronologies locales et traditions architecturales propres. |
| **Monuments vs maisons communes** | Les vestiges en pierre donnent une image biaisée des cités anciennes : beaucoup d'habitations étaient en terre/bois/végétal et se conservent mal. |

---

# VIII. Sources de départ et vérifications documentaires

Sources institutionnelles utiles à la **validation des morphologies et des datations**, pas à une reconstruction fidèle de chaque bâtiment. Certaines entrées de l'atlas sont volontairement synthétiques ou heuristiques ; pour une reconstitution historique stricte, compléter par des plans de fouilles et monographies des cultures concernées.

### Urbanisme, cours et villes d'Asie

- UNESCO — [Axe central de Beijing](https://whc.unesco.org/fr/list/1714/) : rôle de l'axe nord-sud, origine Yuan et phases Ming/Qing.
- UNESCO — [Tulou du Fujian](https://whc.unesco.org/fr/list/1113/) : anneaux et carrés de terre, habité collectif, chronologie tardive fréquente.
- UNESCO — [Monuments historiques de l'ancienne Kyoto](https://whc.unesco.org/en/list/688/) : architecture en bois, espaces rituels et urbains.
- UNESCO — [Monuments historiques de la vallée de Katmandou](https://whc.unesco.org/en/list/121/) : cours, bois sculpté, brique et formes de temples newar.
- UNESCO — [Angkor](https://whc.unesco.org/en/list/668/) : hydraulique et monuments en milieu paysager.
- UNESCO — [Sites archéologiques de Mohenjo-Daro](https://whc.unesco.org/en/list/138/) : trame de ville, infrastructure et brique de la civilisation de l'Indus.
- UNESCO — [Sansa, monastères bouddhiques de montagne en Corée](https://whc.unesco.org/en/list/1562/) : bâtiments et ensembles religieux régionaux (beaucoup de phases postérieures).
- UNESCO, liste indicative — [Établissements traditionnels toraja](https://whc.unesco.org/en/tentativelists/5462/) : maisons et architecture régionale.
- UNESCO, liste indicative — [Établissements traditionnels de Nias](https://whc.unesco.org/en/tentativelists/5463/) : formes et implantation, URL de liste indicative à revérifier lors d'un usage académique.

### Afrique, Arabie et Méditerranée

- UNESCO — [Ancienne ville de Shibam et son mur d'enceinte](https://whc.unesco.org/fr/list/192/) : murs en briques crues et maisons-tours XVIe siècle.
- UNESCO — [Ksar d'Aït-Ben-Haddou](https://whc.unesco.org/fr/list/444/) : ensemble fortifié en terre sud-marocaine.
- UNESCO — [Villes anciennes de Djenné](https://whc.unesco.org/fr/list/116/) : traditions urbaines de terre au Sahel.
- UNESCO — [Grand Zimbabwe](https://whc.unesco.org/fr/list/364/) : maçonnerie en pierre sèche et enceintes courbes.
- UNESCO — [Koutammakou, pays des Batammariba](https://whc.unesco.org/fr/list/1140/) : maisons-forteresses en terre et organisation du paysage.
- UNESCO — [Ruines de Kilwa Kisiwani et de Songo Mnara](https://whc.unesco.org/fr/list/144/) : ville swahilie côtière, pierre corallienne et chaux.
- UNESCO — [Tombes des rois du Buganda à Kasubi](https://whc.unesco.org/fr/list/1022/) : construction végétale monumentale, exemplaire historique tardif.
- UNESCO — [Palais royaux d'Abomey](https://whc.unesco.org/fr/list/323/) : ensembles royaux en terre, période surtout XVIIe–XIXe.
- Oxford Learner's Dictionaries — [*Kraal*](https://www.oxfordlearnersdictionaries.com/definition/english/kraal) : diversité des acceptions du terme.

### Amériques et Océanie

- UNESCO — [Sanctuaire historique de Machu Picchu](https://whc.unesco.org/fr/list/274/) : terrasses andines, zones fonctionnelles, chronologie inca.
- UNESCO — [Zone archéologique de Chan Chan](https://whc.unesco.org/fr/list/366/) : quartiers/chantiers maçonnés en adobe, grands compounds.
- UNESCO — [Cité de Tiwanaku](https://whc.unesco.org/fr/list/567/) : architecture cérémonielle altiplanique.
- UNESCO — [Cité préhispanique de Teotihuacan](https://whc.unesco.org/fr/list/414/) : trame monumentale, temples et compounds.
- UNESCO — [Cité préhispanique et parc national de Palenque](https://whc.unesco.org/fr/list/411/) : palais et temples maya.
- UNESCO — [Parc historique national de Chaco Culture](https://whc.unesco.org/fr/list/353/) : *great houses* et cours.
- UNESCO — [Site historique d'État des Cahokia Mounds](https://whc.unesco.org/fr/list/198/) : urbanisme à tertres mississippien.
- UNESCO — [Pueblo de Taos](https://whc.unesco.org/fr/list/492/) : agglomération de cellules en adobe en terrasses.
- UNESCO — [Nan Madol](https://whc.unesco.org/fr/list/1503/) : îlots artificiels et structures massives en basalte.
- UNESCO — [Paysage culturel Budj Bim](https://whc.unesco.org/fr/list/1577/) : paysage aquacole construit aborigène.
- UNESCO — [Sites préhistoriques Jomon du nord du Japon](https://whc.unesco.org/fr/list/1632/) : habitats et occupations anciennes.
- Smithsonian National Museum of the American Indian — [Collection *Infinity of Nations*, Northwest Coast](https://americanindian.si.edu/exhibitions/infinityofnations/northwest-coast.html) : contexte des peuples et matériaux de la côte nord-ouest.
- Yale eHRAF — [Synthèse Inca](https://ehrafarchaeology.yale.edu/traditions/se80/summary) : contexte ethnographique et organisation des ensembles.

---

# IX. Contrat de données / maintenance du catalogue

- Les `ID` de l'atlas sont **des identifiants internes pour ton application**, pas des termes de classification scientifique standardisés.
- La définition d'une recette **doit pouvoir s'appliquer à une habitation ou à un bâtiment de fonction différente** ; la fonction (`house`, `granary`, `temple`, etc.) est un champ indépendant.
- Un `pack_id` devrait comprendre à terme `sources`, `confidence`, `start_year`, `end_year`, `biome`, `materials`, `roof_variants`, `compound_rules`, `settlement_rules`, `asset_requirements` et `exceptions`.
- Utiliser trois niveaux de fiabilité : `attested` (plan/texte/vestige documenté), `reconstructed` (élévation/toiture plausible), `stylized` (abstraction pour JDR).
- Les noms de peuples, de régions et de périodes **ne remplacent pas** la description de la forme architecturale : deux cultures peuvent partager la même primitive sans partager leur organisation urbaine.
- Pour les extensions, créer de nouvelles sous-traditions sans casser les primitives communes : un pack `AF-SAHEL/hausa` hérite du lexique de la terre crue, mais conserve ses propres cours et silhouettes.
- Ne pas transformer des exemples iconiques en fréquence générale : **un temple monumental par type de cité**, pas un temple dans chaque groupe de cinq maisons.
- Tester les presets à trois échelles : **carte régionale** (pattern de village), **plan de ville** (trame/parcelles), **zoom bâtiment** (toitures/matériaux).

**Synthèse :** générer la **forme de l'agglomération**, puis les **concessions/îlots**, puis les **volumes** et leurs **structures/toitures**. L'identité culturelle émerge d'une combinaison contrainte de ces niveaux et non d'un simple jeu de textures.
