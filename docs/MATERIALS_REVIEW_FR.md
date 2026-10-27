# Atlas des textures naturelles terrestres — Catalogue pour Neural Earth

[English translation](MATERIALS_REVIEW.md)

Pour un générateur procédural mondial, je distinguerais environ 15 grandes familles de paysages, déclinées en plus de 200 types et variantes de surfaces visuellement reconnaissables.

L'objectif n'est pas de classer les biomes, mais de répondre à cette question :

> Lorsqu'on observe n'importe quel endroit de la Terre depuis le ciel, quels types de surfaces, de couleurs, de structures et de motifs naturels peut-on rencontrer ?

Je prends comme échelle de référence une observation aérienne ou satellite de 0,2 à 5 m/pixel, avec des motifs pouvant s'étendre de quelques mètres à plusieurs kilomètres.

Une classification classique comme ESA WorldCover distingue seulement 11 classes d'occupation du sol, à 10 m/pixel : insuffisant pour représenter la diversité visuelle recherchée.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.google.com\&sz=32)

Google for Developers

+1



Il faut également distinguer trois choses :

- Texture de surface : sable, granite, herbe, canopée, glace, boue, eau…
- Motif spatial : rayures, taches, polygones, ondulations, ramifications, bandes, fractales…
- Contexte géomorphologique : plaine, pente, sommet, vallée, littoral, delta, plateau, dépression…

Une côte rocheuse et un sommet granitique peuvent partager une matière, mais nécessiter des distributions, structures et transitions différentes.

## 1. Catalogue mondial des surfaces naturelles

Les tableaux ci-dessous décrivent des familles d'apparences satellitaires, et non des catégories géographiques mutuellement exclusives.

### 1.1. Plaines et sols minéraux nus

| Type de surface  | Variantes à distinguer                            | Aspect vu du ciel                            |
| ---------------- | ------------------------------------------------- | -------------------------------------------- |
| Terre fine sèche | Brune, ocre, rouge, beige, noire                  | Surface homogène ou légèrement granuleuse    |
| Terre argileuse  | Compacte, fissurée, gonflante, croûteuse          | Plages lisses, polygones de dessiccation     |
| Terre limoneuse  | Loess, poussière, limon alluvial                  | Grandes surfaces claires, texture très fine  |
| Sol organique nu | Terre noire, humus, tourbe exposée                | Surfaces sombres, irrégulières               |
| Sol ferrugineux  | Latérite, cuirasse ferrallitique, terre rouge     | Rouge intense, brun rouille, plages indurées |
| Sol carbonaté    | Calcrète, encroûtement calcaire, caliche          | Beige ou blanc, plaques claires              |
| Sol caillouteux  | Gravier fin, gravier grossier, galets dispersés   | Granularité visible, distribution hétérogène |
| Sol pierreux     | Pierres plates, blocs épars, roche subaffleurante | Mosaïque minérale avec petites ombres        |
| Sol hydromorphe  | Saturé d'eau, boueux, marbré                      | Gris-brun, taches humides sombres            |
| Sol salin        | Efflorescences, croûtes blanches, argile salée    | Plaques claires, cristallisations            |
| Sol gypseux      | Gypse blanc, terre gypsifère                      | Blanc crème, gris, poussiéreux               |
| Sol sableux      | Sable fin, grossier, mélange sable-terre          | Grain régulier, couleurs variables           |

### 1.2. Affleurements rocheux et substrats géologiques

| Type de surface                  | Variantes à distinguer                          | Aspect vu du ciel                              |
| -------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Granite massif                   | Poli, altéré, fracturé, en dalles               | Grandes plaques rocheuses, joints irréguliers  |
| Chaos granitique                 | Boules, blocs arrondis, tors                    | Amas de rochers à ombres ponctuelles           |
| Grès                             | Rouge, jaune, blanc, stratifié                  | Bandes colorées, érosion douce ou en marches   |
| Calcaire massif                  | Blanc, gris, beige, fissuré                     | Surfaces pâles, pavements fracturés            |
| Schiste et ardoise               | Feuilleté, incliné, fracturé                    | Fines lignes parallèles, plaques anguleuses    |
| Gneiss et roches métamorphiques  | Rubané, plissé, fortement déformé               | Rubans courbes, alternance claire/sombre       |
| Quartzite                        | Massif, en arêtes, fracturé                     | Dalles résistantes, reliefs anguleux           |
| Conglomérat                      | Galets cimentés, roche érodée                   | Roche grumeleuse à érosion différentielle      |
| Roches sédimentaires stratifiées | Couches horizontales, inclinées, plissées       | Bandes, gradins, alternances colorées          |
| Roches multicolores              | Couches ferrugineuses, argileuses, minéralisées | Rayures et grands aplats rouges, verts, blancs |
| Pavement rocheux                 | Dalles régulières, fractures polygonales        | Réseau de lignes orthogonales ou irrégulières  |
| Roches fortement altérées        | Arènes, saprolites, affleurements résiduels     | Transition diffuse roche-sol, aspect moucheté  |

### 1.3. Déserts sableux et formes éoliennes

Le désert n'est pas une texture : un erg sableux, un reg de graviers et une hamada rocheuse produisent des paysages radicalement différents.

| Type                   | Variantes                               | Aspect vu du ciel                    |
| ---------------------- | --------------------------------------- | ------------------------------------ |
| Erg sableux            | Sable uniforme, sable mêlé de roche     | Grands champs sableux                |
| Dunes barkhanes        | Isolées, alignées, coalescentes         | Croissants répétitifs                |
| Dunes transversales    | Simples, multiples, superposées         | Ondes parallèles de grande amplitude |
| Dunes longitudinales   | Seifs, dunes linéaires géantes          | Longues crêtes parallèles            |
| Dunes étoilées         | Complexes, pyramidales                  | Étoiles ou réseaux rayonnants        |
| Dunes paraboliques     | Fixées ou semi-fixées par végétation    | Formes en U, bras allongés           |
| Dunes en dôme          | Arrondies, sans crête dominante         | Bosses douces isolées                |
| Dunes composites       | Dunes sur dunes, champs imbriqués       | Motifs à plusieurs échelles          |
| Sable ridé             | Rides éoliennes, mégarides              | Fines ondulations régulières         |
| Couloirs interdunaires | Sable compact, gravier, zones humides   | Bandes plates séparant les dunes     |
| Reg désertique         | Graviers, cailloux, pavement désertique | Surface sombre et granuleuse         |
| Hamada                 | Plateau rocheux nu, roches fracturées   | Grandes surfaces minérales dures     |
| Désert de loess        | Dépôts poussiéreux, reliefs disséqués   | Beige uniforme, ravines très fines   |
| Désert de sable coloré | Rouge, noir volcanique, blanc gypseux   | Variation chromatique spectaculaire  |

### 1.4. Reliefs érodés, déserts rocheux et surfaces arides

| Type                      | Variantes                                     | Aspect vu du ciel                             |
| ------------------------- | --------------------------------------------- | --------------------------------------------- |
| Badlands                  | Argileux, marneux, multicolores               | Réseau dense de ravines et petites crêtes     |
| Yardangs                  | Petits, longs, géants                         | Nervures rocheuses parallèles au vent         |
| Inselbergs                | Dômes, massifs résiduels, monolithes          | Reliefs rocheux isolés dans une plaine        |
| Mesas                     | Plateaux isolés, buttes tabulaires            | Sommets plats, bords abrupts                  |
| Plateaux disséqués        | Canyons, ravins, escarpements                 | Réseau ramifié entaillant une surface plane   |
| Plaines de déflation      | Cuvettes éoliennes, surfaces décapées         | Grandes dépressions irrégulières              |
| Playas                    | Argile sèche, boue durcie, sel                | Étendues planes à bordures diffuses           |
| Salars                    | Sel homogène, polygones, bassins humides      | Blanc intense et réseaux géométriques         |
| Sebkhas                   | Dépressions salées, côtières ou continentales | Sol clair, croûtes, taches d'humidité         |
| Croûtes de dessiccation   | Fissures fines, grandes plaques polygonales   | Maillage polygonal                            |
| Dépôts de crue désertique | Épandages sableux, graviers, boues            | Éventails et chenaux intermittents            |
| Réseaux d'oueds secs      | Simples, dendritiques, anastomosés            | Lignes sinueuses plus claires ou plus sombres |
| Pavements désertiques     | Vernis sombre, pierres sur sol clair          | Mosaïques minérales contrastées               |

### 1.5. Montagnes, pentes et dépôts gravitaires

Ici, le modèle de relief détermine fortement la distribution des textures.

| Type                            | Variantes                                     | Aspect vu du ciel                            |
| ------------------------------- | --------------------------------------------- | -------------------------------------------- |
| Versant rocheux                 | Lisse, fissuré, stratifié, feuilleté          | Roche continue orientée selon les pentes     |
| Falaise continentale            | Verticale, étagée, fracturée                  | Bandes rocheuses avec ombres fortes          |
| Éboulis                         | Fin, grossier, blocs géants                   | Granularité en pied de pente                 |
| Cône de déjection rocheux       | Isolé, coalescent                             | Triangle granuleux au pied d'une paroi       |
| Coulée de blocs                 | Stable, récente, végétalisée                  | Langues de blocs anguleux                    |
| Glissement de terrain           | Translation, rotation, complexe               | Cicatrice claire et masse déplacée           |
| Coulée de débris                | Boue, roche, mélange                          | Traînée irrégulière le long d'un versant     |
| Couloir d'avalanche             | Rocheux, herbacé, traversant la forêt         | Bande rectiligne ou sinueuse dans le couvert |
| Éboulis végétalisé              | Herbes, lichens, arbustes pionniers           | Mélange irrégulier de végétal et minéral     |
| Crêtes rocheuses                | Dentelées, arrondies, stratifiées             | Lignes rocheuses étroites                    |
| Surface alpine érodée           | Sol mince, petites pierres, roche affleurante | Mosaïque fine verte, grise et brune          |
| Formations morainiques          | Frontales, latérales, de fond                 | Bourrelets pierreux sinueux                  |
| Terrasses naturelles de versant | Structurales, d'érosion, dépôts anciens       | Gradins suivant les courbes du terrain       |

### 1.6. Reliefs karstiques et dissolution

| Type                   | Variantes                               | Aspect vu du ciel                        |
| ---------------------- | --------------------------------------- | ---------------------------------------- |
| Lapiaz                 | Fissuré, rainuré, à rigoles             | Réseaux de rainures dans la roche claire |
| Doline                 | Petite, grande, sèche, humide           | Dépressions circulaires ou elliptiques   |
| Ouvala                 | Fusion de plusieurs dolines             | Grandes dépressions irrégulières         |
| Poljé                  | Plaine karstique fermée                 | Grande surface plane bordée de reliefs   |
| Karst à pitons         | Tours isolées, pitons densément groupés | Aiguilles ou dômes avec fortes ombres    |
| Karst conique          | Cônes serrés, cônes isolés              | Texture dense de bosses régulières       |
| Karst à cockpit        | Dépressions jointives entre collines    | Réseau de cuvettes fermées               |
| Effondrement karstique | Gouffre, puits, effondrement récent     | Trou sombre, bordures abruptes           |
| Source karstique       | Résurgence, bassin turquoise            | Petits plans d'eau très contrastés       |
| Travertin              | Bassins étagés, terrasses calcaires     | Gradins blancs ou turquoise              |
| Tuf calcaire           | Dépôts poreux, cascades pétrifiantes    | Petites formations claires irrégulières  |

### 1.7. Terrains volcaniques et géothermiques

| Type                     | Variantes                        | Aspect vu du ciel                          |
| ------------------------ | -------------------------------- | ------------------------------------------ |
| Lave basaltique pāhoehoe | Cordée, lobée, plissée           | Ondulations et lobes de roche sombre       |
| Lave ʻaʻā                | Scoriacée, chaotique             | Blocs noirs très rugueux                   |
| Coulée solidifiée        | Ancienne, récente, superposée    | Langues sombres avec fronts distincts      |
| Champ de scories         | Noires, rouges, brunes           | Granularité minérale très sombre           |
| Plaine de cendres        | Fine, consolidée, remaniée       | Surface grise ou noire presque uniforme    |
| Dépôt de ponce           | Blanc, beige, gris               | Surface très claire et granuleuse          |
| Tuf et ignimbrite        | Compact, stratifié, raviné       | Plateaux clairs, surfaces cannelées        |
| Cône volcanique          | Scories, cendres, roches nues    | Pentes radiales régulières                 |
| Caldeira                 | Sèche, lacustre, végétalisée     | Grande dépression annulaire                |
| Cratère secondaire       | Petits cônes, maars, évents      | Marques circulaires dispersées             |
| Dôme de lave             | Compact, fracturé, en éboulis    | Bosse irrégulière fortement fissurée       |
| Lahar                    | Sec, humide, ancien              | Dépôt boueux ramifié depuis un volcan      |
| Champ hydrothermal       | Argiles altérées, soufre, silice | Taches blanches, jaunes, ocre, vertes      |
| Bassins géothermiques    | Chauds, siliceux, multicolores   | Petites piscines de couleurs vives         |
| Solfatares et fumerolles | Minéralisées, croûtées           | Taches minérales et parfois vapeur visible |

### 1.8. Rivières, torrents et plaines alluviales

| Type                | Variantes                               | Aspect vu du ciel                            |
| ------------------- | --------------------------------------- | -------------------------------------------- |
| Ruisseau naturel    | Rectiligne, sinueux, encaissé           | Fin ruban d'eau                              |
| Rivière à méandres  | Faiblement ou fortement sinueuse        | Grandes courbes dans la végétation ou le sol |
| Rivière en tresses  | Quelques bras, réseau très dense        | Entrelacs d'eau et de bancs de gravier       |
| Rivière anastomosée | Plusieurs chenaux stables végétalisés   | Réseau ramifié entre îles couvertes          |
| Torrent montagnard  | Rocheux, graveleux, à cascades          | Ruban turbulent clair avec gros blocs        |
| Bancs alluviaux     | Sable, gravier, galets                  | Croissants ou langues claires                |
| Îles fluviales      | Sableuses, boisées, rocheuses           | Surfaces isolées au milieu de l'eau          |
| Méandres abandonnés | Bras morts, lacs en fer à cheval        | Arcs d'eau ou de végétation                  |
| Paléochenaux        | Humides, secs, comblés                  | Traces sinueuses fossiles                    |
| Plaine d'inondation | Limoneuse, marécageuse, boisée          | Mosaïque de chenaux et bassins               |
| Levées naturelles   | Bourrelets riverains, berges surélevées | Bandes linéaires longeant le cours d'eau     |
| Cônes alluviaux     | Petits, géants, actifs, fossiles        | Éventails ramifiés au débouché des vallées   |
| Bajadas             | Cônes de piémont coalescents            | Large bande de dépôts en éventail            |
| Terrasses fluviales | Anciennes, récentes, étagées            | Bandes planes parallèles aux vallées         |
| Ravines et rigoles  | Peu profondes, très incisées            | Branches fines découpant les sols            |
| Cascades et rapides | Rocheux, en marches, à seuils           | Taches d'écume blanche dans le chenal        |

### 1.9. Lacs et eaux intérieures

| Type                       | Variantes                                   | Aspect vu du ciel                          |
| -------------------------- | ------------------------------------------- | ------------------------------------------ |
| Lac profond clair          | Bleu foncé, bleu-noir                       | Surface homogène, berges nettes            |
| Lac peu profond            | Fond sableux, rocheux, vaseux               | Variations de couleur liées au fond        |
| Lac glaciaire              | Turquoise, laiteux, chargé en sédiments     | Bleu-vert opaque                           |
| Lac volcanique             | Acide, minéralisé, chaud                    | Couleurs parfois inhabituelles             |
| Lac salé                   | Permanent, saisonnier, hypersalin           | Rose, brun, bleu, ou bordures salines      |
| Lac organique              | Eau chargée en tanins                       | Brun foncé à noir                          |
| Lac turbide                | Charge argileuse, limoneuse                 | Vert ou brun opaque                        |
| Lac à végétation aquatique | Plantes submergées, flottantes              | Taches et masses végétales                 |
| Lac de barrage naturel     | Glaciaire, volcanique, éboulement           | Eau retenue par un obstacle naturel        |
| Lac temporaire             | Flaques, bassins saisonniers, playa inondée | Alternance sol sec/eau                     |
| Mare forestière            | Claire, sombre, couverte de feuilles        | Petites taches dans la canopée             |
| Réseau de lacs             | Thermokarst, glaciaire, tourbeux            | Mosaïque de petits plans d'eau             |
| Lac à dépôts littoraux     | Plages, bancs, deltas lacustres             | Franges claires et éventails sédimentaires |

### 1.10. Marais, tourbières et zones humides

| Type                           | Variantes                           | Aspect vu du ciel                           |
| ------------------------------ | ----------------------------------- | ------------------------------------------- |
| Marais herbacé                 | Dense, clairsemé, inondé            | Texture végétale fine entre chenaux         |
| Marais à roseaux               | Roselières homogènes ou fragmentées | Masses végétales uniformes                  |
| Marécage boisé                 | Arbres dispersés, forêt inondée     | Canopée tachetée avec eau sombre            |
| Tourbière bombée               | À sphaignes, à mares                | Mosaïque de mousses et petits bassins       |
| Tourbière réticulée            | Tourbière à lanières (aapa)         | Alternance de bandes humides et végétales   |
| Tourbière à buttes             | Buttes de sphaignes, creux humides  | Taches répétitives en relief                |
| Prairie humide                 | Joncs, graminées, zones engorgées   | Végétation verte avec taches sombres        |
| Marais salé                    | Prés salés, salicornes, chenaux     | Végétation basse traversée de ramifications |
| Vasière intérieure             | Boue nue, eau peu profonde          | Surfaces très lisses et sombres             |
| Plaine saisonnièrement inondée | Savane inondable, cuvette herbacée  | Alternance terre, eau et végétation         |
| Marais de papyrus              | Dense, fragmenté, flottant          | Masses vertes dans des eaux sombres         |
| Marais tourbeux tropical       | Tourbière boisée, tourbière ouverte | Canopée ou végétation basse sur sol humide  |

### 1.11. Littoraux sableux, vaseux et sédimentaires

Les formes côtières constituent une famille majeure, car les mêmes matériaux prennent des motifs très différents selon les vagues, les marées et les apports fluviaux.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://oceanservice.noaa.gov\&sz=32)

Service national des océans NOAA

+1



| Type                        | Variantes                                           | Aspect vu du ciel                               |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Plage sableuse              | Blanche, dorée, noire, rouge, grossière             | Bande de sable entre terre et mer               |
| Plage de galets             | Fins, grossiers, mélangés au sable                  | Bande minérale granuleuse                       |
| Plage à coquillages         | Débris coquilliers, sable coquillier                | Frange très claire                              |
| Haut de plage               | Sable sec, laisses naturelles, végétation pionnière | Bande irrégulière parallèle au rivage           |
| Estran sableux              | Sec, humide, parcouru de chenaux                    | Vastes surfaces lisses à marée basse            |
| Estran vaseux               | Vases grises, brunes, noires                        | Grandes surfaces sombres parcourues de chenaux  |
| Banc de sable littoral      | Émergé, submergé, mobile                            | Langue claire dans l'eau                        |
| Flèche littorale            | Droite, recourbée, multiple                         | Long cordon sableux courbé                      |
| Tombolo                     | Simple, double, temporairement submergé             | Pont sableux reliant une île au continent       |
| Île-barrière                | Avec dunes, lagune, marais arrière-littoral         | Bande sableuse parallèle à la côte              |
| Cordon dunaire              | Dune embryonnaire, haute dune, dune fixée           | Bourrelets parallèles à la mer                  |
| Plaines à cordons littoraux | Crêtes de plage successives                         | Nombreuses lignes concentriques ou parallèles   |
| Dépression interdunaire     | Sèche, humide, marécageuse                          | Creux entre bandes sableuses                    |
| Lagune littorale            | Ouverte, fermée, salée, saumâtre                    | Eau calme derrière un cordon                    |
| Delta                       | Digité, lobé, arqué, estuarien                      | Ramifications d'eau et de dépôts                |
| Estuaire                    | Vaseux, sableux, à bancs multiples                  | Large embouchure avec chenaux et zones turbides |
| Chenaux de marée            | Rectilignes, sinueux, dendritiques                  | Réseaux arborescents dans les vasières          |
| Sabkha côtière              | Saline, humide, encroûtée                           | Plaine claire à texture fine                    |
| Littoral de mangrove        | Dense, fragmenté, entrecoupé de chenaux             | Canopée sombre sur réseau aquatique             |

### 1.12. Côtes rocheuses, falaises et littoraux découpés

| Type                      | Variantes                                      | Aspect vu du ciel                         |
| ------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Côte rocheuse basse       | Dalles, blocs, surfaces fracturées             | Frange minérale irrégulière               |
| Falaise marine            | Calcaire, grès, granite, volcanique            | Bordure abrupte, ombres prononcées        |
| Plateforme d'abrasion     | Roche nue, algues, cuvettes                    | Bande rocheuse plate au pied des falaises |
| Côte à blocs              | Éboulis, chaos rocheux, gros galets            | Bande très granuleuse                     |
| Côte en fjord             | Étroit, ramifié, glaciaire                     | Bras de mer encaissés entre reliefs       |
| Côte à rias               | Vallées fluviales noyées                       | Nombreuses ramifications marines          |
| Côte à calanques          | Calcaire, étroite, profonde                    | Échancrures rocheuses étroites            |
| Côte à skerries           | Îlots rocheux, récifs affleurants              | Mosaïque complexe terre-mer               |
| Côte en arches et pitons  | Arches, aiguilles, stacks                      | Petites masses rocheuses isolées          |
| Côte volcanique           | Basalte noir, coulées, falaises                | Contacts sombres et découpés              |
| Côte soulevée             | Anciennes plages, terrasses marines            | Gradins parallèles au littoral            |
| Côte polaire rocheuse     | Roches nues, neige, glace littorale            | Franges minérales alternant avec le blanc |
| Littoral à blocs glaciels | Blocs échoués, sédiments remaniés par la glace | Pierres éparses et marques d'arrachement  |

### 1.13. Fonds marins visibles, récifs et surfaces océaniques

À faible profondeur, une partie de la « texture d'eau » visible depuis le ciel est en réalité celle du fond sous-marin, modifiée par l'absorption et la diffusion de la lumière.

| Type                         | Variantes                                   | Aspect vu du ciel                               |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------- |
| Eau océanique profonde       | Bleu foncé, presque noir                    | Grande surface homogène                         |
| Eau océanique côtière        | Bleue, verte, turbide                       | Dégradés liés à la profondeur et aux particules |
| Fond sableux immergé         | Blanc, beige, ondulé                        | Turquoise clair à motifs diffus                 |
| Fond rocheux immergé         | Rochers, dalles, blocs                      | Taches sombres sous l'eau                       |
| Herbiers marins              | Denses, fragmentés, en mosaïque             | Grandes taches vert sombre                      |
| Forêt de kelp                | Dense, dispersée, en franges                | Rubans ou masses brun-vert                      |
| Récif frangeant              | Continu, discontinu                         | Bande rugueuse parallèle au rivage              |
| Barrière corallienne         | Linéaire, percée de passes                  | Bande récifale séparée de la côte               |
| Atoll                        | Anneau simple, complexe, interrompu         | Motif annulaire autour d'un lagon               |
| Récifs coralliens internes   | Patates de corail, récifs en plaques        | Taches ponctuelles sur fond clair               |
| Platier récifal              | Corail mort, algues, sable                  | Plaques beige-brun peu profondes                |
| Récifs à sillons             | Éperons et sillons coralliens               | Alternance de bandes radiales                   |
| Bancs sableux sous-marins    | Mobiles, ondulés, en chenaux                | Rubans clairs et turquoise                      |
| Panache sédimentaire         | Fluvial, côtier, glaciaire                  | Nuages bruns, verts ou turquoise dans l'eau     |
| Prolifération planctonique   | Phytoplancton, cyanobactéries               | Volutes ou nappes colorées                      |
| Sargasses flottantes         | Dispersées, concentrées                     | Traînées végétales brunâtres                    |
| Vagues et houle              | Petites vagues, déferlantes, vagues longues | Lignes parallèles, écume blanche                |
| Tourbillons et fronts marins | Convergences, fronts de turbidité           | Grandes courbes ou limites de couleur           |
| Eau à glace dérivante        | Glaçons, petits floes, brash ice            | Mouchetures blanches sur fond sombre            |

### 1.14. Couvert végétal naturel

Ici, je ne sépare pas les surfaces en « forêt tropicale », « toundra », « savane », etc., mais selon leur architecture visible du dessus : taille des couronnes, densité, hauteur et organisation.

| Type                               | Variantes                                   | Aspect vu du ciel                                 |
| ---------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Forêt feuillue fermée              | Canopée continue, irrégulière, stratifiée   | Texture bosselée dense                            |
| Forêt feuillue ouverte             | Arbres espacés, sous-bois visible           | Grandes couronnes séparées                        |
| Forêt de conifères fermée          | Conifères réguliers, irréguliers            | Texture fine, sombre et ponctuée                  |
| Forêt de conifères claire          | Mélèzes, pins dispersés                     | Petites taches sombres sur fond clair             |
| Forêt tropicale à canopée complexe | Couronnes multiples, émergents              | Mosaïque dense de grandes couronnes               |
| Forêt sèche                        | Caducifoliée, épineuse                      | Couronnes espacées et saisonnièrement brunes      |
| Forêt riparienne                   | Dense, discontinue, en galerie              | Rubans arborés suivant les cours d'eau            |
| Forêt marécageuse                  | Dense, trouée, inondée                      | Canopée entrecoupée d'eau sombre                  |
| Mangrove                           | Dense, basse, haute, zonée                  | Masses vert foncé et chenaux sinueux              |
| Forêt de palmiers naturelle        | Dense, dispersée, mixte                     | Couronnes étoilées ou circulaires                 |
| Bambouseraie naturelle             | Dense, mixte, en bosquets                   | Canopée fine et assez homogène                    |
| Forêt rabougrie                    | Krummholz, arbres tortueux                  | Taches basses irrégulières                        |
| Broussailles hautes                | Denses, buissonnantes                       | Surface granuleuse à couronnes imbriquées         |
| Maquis ou matorral                 | Dense, clairsemé, rocheux                   | Mélange de taches végétales et rocheuses          |
| Fourrés épineux                    | Acacias, arbustes épineux, buissons secs    | Taches séparées sur sol nu                        |
| Végétation arbustive basse         | Continue, dispersée                         | Texture mouchetée, faible relief apparent         |
| Arbres isolés                      | Solitaires, petits groupes, bouquets        | Points avec ombres et couronnes individuelles     |
| Formation herbeuse continue        | Haute, courte, dense, sèche                 | Surface assez lisse, à grain fin                  |
| Formation herbeuse en touffes      | Tussocks, grandes graminées                 | Points ou petites bosses répétés                  |
| Prairie alpine                     | Rase, fleurie, rocheuse                     | Tapis végétal fragmenté                           |
| Steppe clairsemée                  | Herbes basses, petits buissons              | Fond minéral ponctué de vert                      |
| Végétation désertique ponctuelle   | Buissons isolés, plantes succulentes        | Points espacés, souvent alignés sur des drains    |
| Végétation en bandes               | Tiger bush, broussailles en bandes          | Alternance périodique de bandes végétales et nues |
| Mosaïque arborée-herbacée          | Arbres dispersés, herbes continues          | Texture à deux tailles de grain                   |
| Mousses et lichens                 | Tapis, plaques, croûtes biologiques         | Couvert ras vert, brun ou gris                    |
| Landes                             | Bruyères, plantes basses et ligneuses       | Tapis moucheté, peu de grandes ombres             |
| Végétation aquatique flottante     | Nénuphars, lentilles d'eau, tapis flottants | Plaques végétales sur l'eau                       |
| Végétation pionnière               | Lichens, mousses, herbes sur dépôts neufs   | Taches clairsemées sur substrat minéral           |

À noter : une forêt peut aussi présenter des textures de chablis, trouées naturelles, arbres morts, canopées brûlées, indépendamment des essences présentes.

### 1.15. Neige, glace et paysages périglaciaires

| Type                        | Variantes                                        | Aspect vu du ciel                               |
| --------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| Neige fraîche               | Continue, poudreuse, peu ventée                  | Blanche, presque sans structure                 |
| Neige ancienne              | Transformée, granuleuse, regelée                 | Blanche à grise, plus texturée                  |
| Neige soufflée              | Congères, corniches, sastrugi                    | Ondulations et crêtes orientées                 |
| Neige discontinue           | Sur herbe, forêt, roche                          | Mosaïque blanc-sol-végétation                   |
| Névé et firn                | Compact, ancien, en accumulation                 | Plages blanches compactes                       |
| Glacier de vallée           | Propre, strié, chargé de débris                  | Langue de glace avec lignes d'écoulement        |
| Glacier à crevasses         | Parallèles, transversales, entrecroisées         | Réseau de fractures sombres ou bleues           |
| Séracs                      | Fracturés, en cascades                           | Blocs de glace chaotiques                       |
| Glacier couvert de débris   | Dépôts morainiques, blocs, poussière             | Langue grise ou brune ressemblant à de la roche |
| Glacier rocheux             | Actif, fossile, végétalisé                       | Langue rocheuse à bourrelets transversaux       |
| Calotte glaciaire           | Uniforme, fissurée, traversée de flux            | Grande surface blanche                          |
| Glace bleue                 | Compacte, exposée, polie                         | Bleu soutenu, parfois strié                     |
| Glace lacustre              | Lisse, fissurée, enneigée                        | Surfaces planes avec réseaux de fractures       |
| Banquise compacte           | Continue, bosselée                               | Vaste nappe blanche                             |
| Banquise fragmentée         | Floes, chenaux d'eau libre, crêtes de pression   | Mosaïque de plaques blanches                    |
| Glace de rive               | Fixe, fissurée, partiellement rompue             | Bande de glace longeant la côte                 |
| Polynie                     | Ouverture d'eau dans la banquise                 | Grande tache sombre                             |
| Icebergs                    | Isolés, nombreux, tabulaires                     | Blocs blancs dans l'eau                         |
| Sol polygonal périglaciaire | Polygones à coins de glace, centrés hauts ou bas | Maillage géométrique naturel                    |
| Sol trié par le gel         | Cercles de pierres, bandes de pierres            | Motifs répétitifs minéraux                      |
| Buttes de pergélisol        | Palses, lithalses, pingos                        | Buttes isolées ou groupées                      |
| Thermokarst                 | Affaissements, mares, lacs de dégel              | Réseau irrégulier de dépressions humides        |
| Toundra à microrelief       | Buttes herbeuses, mousses, mares                 | Mosaïque de petites bosses et d'eau             |
| Solifluxion                 | Lobes, terrassettes, coulées lentes              | Lignes courbes parallèles aux versants          |
| Stries et dépôts glaciaires | Roches moutonnées, moraines, drumlins            | Lignes ou reliefs arrondis orientés             |

Les motifs polygonaux, les bandes triées et les sols structurés par le gel méritent de véritables générateurs de motifs, plutôt qu'un simple bruit aléatoire.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.erdc.usace.army.mil\&sz=32)

erdc.usace.army.mil

+1



## 2. Les motifs spatiaux fondamentaux

C'est probablement la distinction la plus importante pour Neural Earth. Des paysages géographiquement très différents peuvent partager le même type de motif.

| Motif                  | Variantes géométriques               | Surfaces concernées                      |
| ---------------------- | ------------------------------------ | ---------------------------------------- |
| Homogène               | Lisse, légèrement bruité             | Sol, sable, eau, neige                   |
| Granulaire             | Fin, grossier, multiscalaire         | Gravier, éboulis, scories, forêt         |
| Tacheté                | Petites taches, larges taches, amas  | Végétation, roche, zones humides         |
| Ponctuel               | Aléatoire, agrégé, répulsif          | Arbres, buissons, rochers, mares         |
| Rayé                   | Parallèle, ondulé, interrompu        | Strates, dunes, végétation               |
| Nervuré                | Parallèle, divergent, convergent     | Roche, glaces, yardangs                  |
| Ondulatoire            | Rides, crêtes, ondes superposées     | Sable, neige, eau                        |
| Polygonal              | Régulier, irrégulier, hiérarchique   | Argile, sel, pergélisol, roche           |
| Réticulé               | Mailles fines, larges, irrégulières  | Marais, tourbières, fractures            |
| Dendritique            | Ramifié, fractal, hiérarchique       | Rivières, érosion, chenaux               |
| Radial                 | Divergent, convergent                | Volcans, cônes alluviaux, glaciers       |
| Concentrique           | Anneaux, arcs, couronnes partielles  | Dunes, dépôts, lacs, cônes               |
| Lobé                   | Langues, coulées, digitations        | Lave, glaciers, glissements              |
| En éventail            | Rayonnant, superposé                 | Alluvions, dépôts de versants            |
| Rubané                 | Continu, sinueux, interrompu         | Rivières, forêt galerie, bancs           |
| Cellulaire             | Cellules jointives, séparées         | Canopées, sols polygonaux, récifs        |
| Fracturé               | Rectiligne, angulaire, ramifié       | Roche, glace, argile                     |
| Moucheté multiscalaire | Texture fine sur grandes taches      | Forêt, savane, toundra                   |
| Tressé                 | Canaux entrecroisés                  | Rivières, deltas, écoulements glaciaires |
| Directionnel           | Aligné sur pente, vent ou écoulement | Dunes, érosion, végétation               |
| Graduel                | Transition progressive, auréoles     | Humidité, salinité, végétation           |
| Chaotique              | Éboulis, débris, fractures multiples | Pentes, volcanisme, glaces               |

Pour beaucoup de ces motifs, une texture de bruit seule ne suffit pas : il faut intégrer un processus spatial, comme l'écoulement, la croissance, la sédimentation, la fracture ou l'érosion.

## 3. Matrice par contexte géographique

Cette table est le pendant géographique du catalogue précédent. Elle répond à la question : quels mélanges de surfaces vais-je réellement rencontrer lorsque je génère une région ?

| Situation                  | Textures et motifs à assembler                            |
| -------------------------- | --------------------------------------------------------- |
| Plaine continentale sèche  | Sols fins, herbes basses, buissons, cailloux, ravines     |
| Plaine continentale humide | Herbes, arbres épars, mares, sols saturés, chenaux        |
| Plateau rocheux            | Roche massive, sol mince, fractures, végétation rare      |
| Plateau disséqué           | Roche stratifiée, ravines, escarpements, éboulis          |
| Collines arrondies         | Sol, végétation, affleurements localisés, vallons         |
| Montagne tempérée          | Forêts, prairies, roche, éboulis, neige saisonnière       |
| Montagne tropicale         | Forêts denses, roche humide, érosion, cours d'eau         |
| Haute montagne aride       | Roche nue, éboulis, poussière, neige localisée            |
| Haute montagne polaire     | Glaciers, neige, roche, pergélisol                        |
| Piémont                    | Cônes alluviaux, graviers, ravines, végétation dispersée  |
| Vallée fluviale            | Rivière, bancs, dépôts, terrasses, végétation riveraine   |
| Bassin endoréique          | Sols salés, playas, dunes, eaux temporaires               |
| Désert sableux             | Dunes, rides, couloirs interdunaires, surfaces minérales  |
| Désert rocheux             | Pavements, roches, yardangs, oueds                        |
| Karst humide               | Roche calcaire, dolines, forêt, cours d'eau intermittents |
| Karst tropical             | Pitons, végétation, petites vallées, eau                  |
| Plaine côtière sableuse    | Plages, dunes, lagunes, marais                            |
| Côte rocheuse tempérée     | Roches, falaises, algues, plages localisées               |
| Côte tropicale             | Plages, mangroves, récifs, herbiers                       |
| Côte glaciaire             | Fjords, roche, glace, moraines, eaux turbides             |
| Delta fluvial              | Chenaux, vasières, bancs sableux, marais, végétation      |
| Estuaire                   | Eau turbide, bancs, vasières, marais salés                |
| Archipel rocheux           | Îlots, chenaux, roche, végétation, eau                    |
| Archipel corallien         | Récifs, sable blanc, lagons, herbiers                     |
| Zone de volcanisme actif   | Lave, cendres, scories, dépôts hydrothermaux              |
| Plaine arctique            | Toundra, tourbières, sols polygonaux, lacs                |
| Inlandsis                  | Neige, glace, crevasses, écoulements                      |
| Mer peu profonde           | Sable immergé, roche, algues, herbiers, récifs            |

## 4. Textures spéciales et phénomènes naturels à ne pas oublier

Ces surfaces sont souvent omises des catalogues de terrains, alors qu'elles peuvent donner une identité très forte à une région.

| Famille                       | Exemples                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Sols biologiques              | Croûtes biologiques désertiques, biofilms, tapis microbiens                    |
| Motifs végétaux spontanés     | Cercles de fées, végétation en bandes, mosaïques de broussailles               |
| Formations animales           | Grandes termitières, récifs biogéniques, colonies d'oiseaux et dépôts de guano |
| Bois mort                     | Chablis, accumulations de troncs, embâcles, forêts mortes                      |
| Incendies naturels            | Sol brûlé, canopée carbonisée, cendres, reprise végétale                       |
| Érosion récente               | Coulées de boue, cicatrices de glissement, ravines nouvelles                   |
| Inondations                   | Sols submergés, sédiments déposés, débris végétaux                             |
| Proliférations biologiques    | Algues de surface, tapis flottants, floraisons planctoniques                   |
| Dépôts organiques côtiers     | Algues échouées, laisses naturelles, accumulations coquillières                |
| Dépôts minéraux exceptionnels | Soufre, silice, croûtes hydrothermales, oxydes de fer                          |
| Textures de cratère           | Cratères d'impact, dépôts d'éjectas, anneaux de débris                         |
| Événements glaciaires         | Vidanges de lacs, épandages proglaciaires, icebergs échoués                    |

## 5. Comment je structurerais cette bibliothèque dans Neural Earth

Je ne ferais surtout pas 200 shaders indépendants. Je construirais un système combinatoire autour de plusieurs couches.

Contexte géographique

Climat · altitude · pente · exposition · géologie · hydrologie · proximité du littoral

1\. Matériau

Sol, roche, sable, eau, glace, végétal

2\. Morphologie

Dune, vallée, falaise, plage, pente

3\. Motif

Bandes, taches, fissures, rides, réseaux

4\. Couverture

Arbres, herbes, blocs, mousses, algues

5\. État

Humide, sec, enneigé, inondé, gelé

6\. Variation locale

Grain, couleur, densité, rugosité

Texture finale et cartes auxiliaires

Albedo · Roughness · Normales · Height · Masques de matériaux · Densité végétale

### Répartition selon l'échelle

| Résolution au sol | Ce qu'il faut générer                                              |
| ----------------- | ------------------------------------------------------------------ |
| 100–10 m          | Grands motifs : dunes, méandres, fronts forestiers, vallées, bancs |
| 10–1 m            | Organisation : arbres, blocs, mares, ravines, crevasses            |
| 1 m–10 cm         | Texture locale : herbes, pierres, fissures, détails végétaux       |
| 10–1 cm           | Microtexture : grains, rugosité de roche, sol, feuilles, mousses   |

Les derniers niveaux ne sont généralement pas identifiables directement sur les images satellitaires classiques. Ils doivent être synthétisés de façon cohérente avec les matériaux et les processus des niveaux supérieurs.

### Dimensionnement du catalogue

Pour une première version avancée, je viserais plutôt :

| Composant                                   | Taille indicative de la bibliothèque |
| ------------------------------------------- | ------------------------------------ |
| Matériaux fondamentaux                      | 30–50                                |
| Variantes visuelles de matériaux            | 100–150                              |
| Générateurs de motifs spatiaux              | 20–30                                |
| Générateurs de structures géomorphologiques | 30–50                                |
| Modèles de couvert végétal                  | 20–30                                |
| Modificateurs d'état et de saison           | 15–25                                |

Il ne s'agit pas de nombres issus d'une classification scientifique standardisée, mais d'une estimation de dimensionnement logiciel à partir du catalogue.

Le point essentiel pour Neural Earth : ce ne sont pas les biomes qui devraient sélectionner directement les textures. Le système devrait d'abord déterminer la géomorphologie locale, le substrat et la dynamique de surface, puis distribuer les matériaux et motifs compatibles avec le climat et l'hydrologie.

Cela permettrait, par exemple, à un même contexte climatique d'engendrer une plaine sableuse, un plateau basaltique, un canyon de grès, une sebkha ou une vallée alluviale, avec des surfaces satellitaires réellement différentes — sans multiplier artificiellement les biomes.
