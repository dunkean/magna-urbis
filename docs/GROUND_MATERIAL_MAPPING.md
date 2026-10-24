# Relations entre informations de carte et matériaux du sol visible

Étude de conception pour Test-Render, 24 octobre 2026.

Le résultat recherché est une **carte de composition du sol naturel**, visible en survol lorsque l'on retire les plantes, les arbres et les constructions. Les informations déjà générées permettent d'en produire une première version : elles contraignent la roche exposée, la terre, les sables, les matériaux pierreux, les dépôts et les états humides. Elles ne déterminent pas une matière unique à chaque endroit. La sortie doit conserver plusieurs matériaux admissibles, leurs proportions et leur organisation locale.

La solution proposée est un petit compilateur de règles sur les champs existants. Il ne requiert ni nouveau moteur, ni simulation géologique, ni génération complète des paysages du catalogue. **Les règles fixent ce qui est possible ; un hasard spatial stable choisit parmi les possibilités restantes.** Les cas qui exigent une information absente reçoivent un scénario explicite ou restent désactivés. Un climat sec ne suffit pas à créer du sable, du sel ou du gypse ; une roche basaltique ne suffit pas à identifier une coulée de lave récente.

Le contrat ci-dessous concerne la décision de matière. Les textures PBR, leur synthèse fine et l'éclairage consommeront ensuite cette décision. Il ne constitue pas une nouvelle implémentation du rendu.

## 1 Sources et périmètre

### 1.1 Documents de référence

Les trois documents définissent des rôles complémentaires :

| Document | Apport retenu |
| --- | --- |
| [MATERIALS_REVIEW.md](MATERIALS_REVIEW.md), §1 à §5 | Catalogue des apparences, variantes, contextes et motifs à couvrir |
| [RENDER_SURFACE_DESIGN.md](RENDER_SURFACE_DESIGN.md), §5 et §7 | Relations entre formes, substrat, dépôts, eau, sol et recettes ; distinction entre contexte et rendu |
| [RENDER_REVIEW.md](RENDER_REVIEW.md), §3 et §7 à §9 | Composition probabiliste `{poids, orientation, échelle}`, agencement des composants, choix des techniques selon la matière et stabilité au zoom |
| [SURFACE_RENDER_LAYERS.md](SURFACE_RENDER_LAYERS.md) | Séparation physique entre support, couvert bas et arbres ; litière distincte de l'humus |

L'état des entrées est celui du [compilateur de Test-Render](../../magna-urbis-render-godot-original/godot-render/tools/surface_context.py) et de son [contrat de tuiles](../../magna-urbis-render-godot-original/docs/surface/TILE_VIEWER.md), dans le worktree `magna-urbis-render-godot-original`. Son schéma `ground.version=2` ne doit pas être confondu avec les contrats SurfaceWorld développés dans les autres worktrees.

Les règles et valeurs proposées ici sont des règles de **synthèse d'apparence**, issues de l'organisation décrite dans ces documents. Elles ne constituent pas une classification pédologique ni un modèle de transport calibré. Aucune source extérieure supplémentaire n'est nécessaire à ce lot.

### 1.2 Ce que signifie retirer la végétation

On retire l'occultation et le dessin des organismes vivants : couronnes, herbes, arbustes, mousses, lichens, algues et végétation aquatique. On conserve le support qui existe à leur emplacement. On ne transforme pas automatiquement une forêt en sable ni une prairie en roche ; la composition du support reste la même quand on masque le vivant.

L'humus et la tourbe sont des matières du sol. La **litière morte mince** — feuilles, aiguilles, petites brindilles et laisses mortes — peut appartenir à l'apparence demandée, mais reste un étage séparé du support. La convention de cette étude est `includeDeadLitter=true` quand sa présence est connue ou déclarée ; `false` donne le support nu. Faute d'information de litière, on affiche le support sans inventer un tapis forestier à partir du seul climat. Les gros troncs, arbres morts dressés, animaux et objets associés restent hors périmètre.

On retire aussi les couches artificielles de bâtiments, chaussées et pavages. Si le terrain a déjà été terrassé, le relief naturel antérieur ne se reconstruit pas à partir de cette opération de masquage : le support est alors une hypothèse sous l'aménagement, signalée comme telle.

### 1.3 Eau et solides à la surface

L'eau conserve son masque et son niveau. Une zone sous eau permanente ne devient pas du sol sec parce que la végétation est masquée. La sortie distingue :

- **Sol émergé** : composition de support, dépôts et états de surface.
- **Fond subaquatique** : composition distincte, seulement si le fond est qualifié ; sa visibilité dépend de profondeur et de transparence.
- **Eau masquant le fond** : aucune couleur de sol ne remplace la surface liquide.
- **Neige ou glace déclarée** : couche d'état ou support glacé selon le cas ; jamais une conséquence automatique de la température annuelle.

Le catalogue contient aussi des phénomènes d'eau et des couverts vivants. L'annexe leur donne un statut explicite plutôt que de les rebaptiser matériaux de sol.

## 2 Ce que la carte doit contenir

Une zone de sol est décrite par cinq éléments indépendants :

| Élément | Question | Exemple |
| --- | --- | --- |
| Matières | Qu'est-ce qui occupe la surface du support ? | 60 % gravier, 25 % sable, 15 % limon |
| Provenance | D'où viennent ces matières ? | Roche locale, apports fluviaux granitiques, débris de paroi |
| Agencement | Comment sont-elles distribuées ? | Bancs, amas, matrice entre pierres, poches dans les fractures |
| État | Comment se présente cette surface maintenant ? | Sèche, humide, boueuse, encroûtée, gelée ou enneigée |
| Variation | Quelles variantes compatibles sont présentes ? | Gravier fin ou grossier, galets arrondis, teinte minérale locale |

« Dune », « falaise », « delta », « moraine » ou « doline » ne sont pas des matériaux. Ce sont des formes et des contextes portant des matières. « Polygonal » est un motif qui peut appartenir à l'argile, au sel, à la roche ou au gel ; le motif ne révèle pas à lui seul sa cause. « Humide » est un état commun à de nombreuses matières.

### 2.1 Fractions qui ne doivent pas être confondues

`bedrockGranite..bedrockBasalt` décrivent le contexte lithologique synthétique. `sand+silt+clay=1` décrit la matrice minérale fine. La pierrosité décrit un potentiel de présence de fragments, pas encore une couverture de cailloux mesurée. Les fractions de matériaux visibles décrivent une **part de surface**. Ces nombres ne se substituent pas les uns aux autres.

De même, `organic` enrichit la description de la matrice ; il ne donne pas directement la part de surface d'un tapis d'humus nu. Une couverture organique dominante doit être autorisée par l'exposition et la nature du support dans N1.

Pour le support, on cherche `sum(surfaceAreaFraction)=1`. Les couches de litière et de neige ont leur propre couverture. Avec seulement ces deux couches, une composition visible possible est :

```text
neige visible   = snowCover
litière visible = (1 - snowCover) * litterCover
support i      = (1 - snowCover) * (1 - litterCover) * supportWeight[i]
```

Cette somme vaut 1 dans le domaine émergé. Elle n'impose pas `sol + arbres + herbes = 1`. Le support existe sous les autres étages. Le cas de la glace est traité selon sa fonction : support glaciaire, couche sur sol ou eau gelée.

### 2.2 Sortie proposée

```text
VisibleGround
  domain: emerged | qualified_bed | water_occluded | unresolved
  support[]: {materialId, recipeFamily, group, areaWeight, parentComposition,
              arrangement?: {process, direction, physicalScales, clustering, featureId?}}
  state: {surfaceWetness, snowCover, iceState, crustState}
  deadCover?: {litterKind, cover, thicknessClass}
  variantSeed: stable world address
  explanation: {supportingInputs, exclusions, assumptions, missingInputs}
  evidence: {inputCompleteness, providedOrDerivedOrSynthetic}
```

Un matériau dominant peut être calculé pour la légende, mais il ne remplace pas les proportions qui pilotent le rendu. L'inspecteur doit pouvoir expliquer « gravier et sable d'origine fluviale, banc émergé, faible fraction de fines », y compris lorsque la roche sous-jacente est marneuse.

Chaque composant peut avoir son propre agencement : dalles orientées suivant les strates, galets suivant l'écoulement et rides dans les plages sableuses. Le statut « fourni, dérivé ou synthétique » est distinct de la complétude des entrées. Ni ce statut ni le `confidence` actuel ne sont une probabilité de justesse géologique.

## 3 Informations disponibles et portée réelle

Les grilles de Test-Render ont 1334² échantillons pour 40 km, soit environ 30 m. Les motifs plus fins seront une synthèse conditionnée ; interpoler cette grille ne crée pas de nouvelle observation du terrain.

| Entrées actuelles | Utilisation pour les matériaux | Limite à conserver |
| --- | --- | --- |
| `height.f32`, pente, exposition, courbures | Support, stabilité, exposition, accumulation relative | Le DEM ne nomme ni la matière ni l'histoire du paysage |
| `geomorphon150/600/2000`, `tpi150/600/2000` | Crête, versant, creux, pied de pente ; intensité des préférences | Les classes ne doivent pas tracer des frontières matérielles nettes ; une dépression n'est pas nécessairement un lac, une doline ou une tourbière |
| Cinq fractions de roche mère, `bedrockVariation` | Compatibilité des affleurements et des résidus ; variation des propriétés | Seulement granite, calcaire, grès, argilo-marneux et basalte ; aucune identification de gneiss, quartzite, sel, gypse, ponce ou cendres |
| `hardness`, `weatherability`, `structureAzimuth` | Résistance relative, altération, direction de strates | Proxys synthétiques ; pas de pendage, de réseaux de fractures ni de minéralogie chromatique détaillée |
| Receveurs, bassins, `contributingArea`, accumulation | Connexion au drainage, apports et contexte fluvial | L'accumulation pondérée par ruissellement n'est pas l'aire géométrique ; aucun débit instantané mesuré |
| `hand`, référence et type de référence | Hauteur au drainage connecté | HAND est parfois indéfini ; ce n'est ni une cote de crue ni une durée d'inondation |
| `distanceToWater`, `channel`, `sea`, `lake`, `lakeLevel`, `lakeKind` | Contraintes d'émergence, proximité des eaux, lacs ouverts ou fermés | Distance commune à toutes les eaux ; `channel` est un diagnostic de graphe, pas l'emprise exacte des rivières dessinées |
| `alluvialPotential`, `colluvialPotential`, `aeolianPotential`, `coastalPotential`, `frostPotential` | Préférences de processus | Potentiels et non preuve de dépôts. L'alluvial actuel utilise la proximité de toute eau ; il ne prouve pas une connexion à un apport fluvial |
| `upstreamGranite..upstreamBasalt`, `sedimentProvenance` | Provenance fluviale des matériaux remaniés | Le mélange est pondéré par un potentiel d'érosion. Le mélange utilisé latéralement vient de l'eau la plus proche ; il faut vérifier son lien hydraulique. Le transport gravitaire actuel ne transporte pas de composition lithologique |
| `depositDepth`, `soilDepth`, `stoniness` | Préférences pour dépôt, matrice et support exposé | Épaisseurs de synthèse ; les deux profondeurs ne sont pas deux couches indépendantes à additionner. La pierrosité ne donne ni taille, ni forme, ni part de surface des fragments |
| `sand`, `silt`, `clay` | Compatibilité des matrices fines, sable, terre argileuse ou limoneuse | Une fraction de sable n'est pas un stock meuble disponible ; pas de distribution des graviers, galets ou blocs |
| `organic`, `moisture`, `drainage`, `storage`, `permeability` | Humus, capacité de rétention et potentiel de sol humide | Pas d'histoire d'engorgement, de nappe, de tourbe, de litière ni d'humidité instantanée observée |
| Température, précipitations, aridité, vent régional à 70° | Préférences climatiques et directionnelles | Climat annuel et vent simplifié ; pas de saison complète, pluie récente, régime de vents ou historique de gel |
| `soilMask`, `boundaryAffected`, `confidence` | Validité des données et confiance de la décision | `soilMask` exclut mer et lacs ; les valeurs archivées sous ces masques ne sont pas un fond subaquatique qualifié. Les bassins amont extérieurs sont inconnus |

Le relief de fond reste `height.f32`. `surface.f32` relève les cellules lacustres au niveau d'eau pour l'affichage : il ne faut pas l'utiliser comme bathymétrie.

## 4 Compléments minimaux et informations optionnelles

### 4.1 Quatre blocs pour le sol courant

Ces ajouts enrichissent le compilateur existant. Un indice relatif de disponibilité ou un état déclaré suffit pour cette étape ; il n'est pas nécessaire d'introduire des volumes transportés ou une météorologie simulée.

| Code | Information à produire | Construction légère proposée | Ce qu'elle débloque et repli |
| --- | --- | --- | --- |
| N1 | Exposition du support et couverture de matrice : `exposedRock`, `matrixCover`, rugosité structurelle | Combiner profondeur effective de couverture, pente, courbure, altération et petites variations stables ; calibrer ensemble les valeurs, pas une soustraction aveugle de `soilDepth` et `depositDepth` | Roche massive, mosaïque roche-terre, sol mince. Si inconnu : mosaïque générique compatible et confiance réduite |
| N2 | Matériaux meubles disponibles : sable, poussière/fines, graviers, galets, blocs ; tailles, arrondi et origine | Indices 0..1 conditionnés par roche altérable, source de versant et réseau ; conserver une provenance gravitaire ; autoriser un dépôt hérité déclaré. Arrondi conditionné par le mode de transport | Distingue terre sableuse et nappe de sable, gravier et éboulis. Si les gros éléments sont inconnus : pas de champ de blocs ; sol minéral avec petites inclusions seulement |
| N3 | Eaux typées et zones de rive : distances rivière/lac/mer séparées, connexion au tronçon source, emprises mouillées et bancs émergés | Réutiliser les vecteurs et niveaux conservés ; rasteriser les emprises au pas utile ; garder les distances signées pour les détails proches | Sols de berge, bancs fluviaux, rives lacustres et côtes distincts. Sans banc identifié : rive générique, pas de croissant de gravier inventé |
| N4 | État d'affichage déclaré : sec / moyen / humide, saison froide éventuelle et cycle humide-sec si utilisé | Un préréglage de carte et des corrections locales par les proxys actuels ; les coordonnées des motifs restent stables lorsque l'état change | Variantes sèche, humide et boueuse. En l'absence d'état : vue moyenne explicitement synthétique ; neige, glace et grandes fissures historiques restent désactivées |

N1 et N2 sont des champs synthétiques nouveaux. Une partie de N3 est dérivable des données déjà archivées. N4 peut d'abord être un paramètre de scène. Les motifs de fissures, l'arrangement des fragments et les limites de bancs peuvent être évalués à la demande ; une carte géante au centimètre n'est pas requise.

### 4.2 Extensions qui débloquent seulement certaines variantes

| Code | Information optionnelle | Cas concernés | Valeur en l'absence de déclaration |
| --- | --- | --- | --- |
| O1 | Lithologies et caractères minéraux supplémentaires : feuilletage, quartzite, conglomérat, couleurs minérales, oxydes, carbonates secondaires, gypse, sels | Roches spéciales, sols rouges, croûtes carbonatées, gypse et sel | Inconnu ; la roche générique actuelle reste autorisée, pas les variantes chimiques spécifiques |
| O2 | Dépôts hérités et âge relatif : loess, terrasses, till/moraine, paléochenal, pavement stable, niveau d'altération | Héritages fluviaux, éoliens, désertiques et glaciaires | Aucun héritage revendiqué ; utiliser le matériau courant compatible |
| O3 | Durée d'engorgement, intermittence, nappe ou saturation persistante, potentiel tourbeux | Tourbe, hydromorphie durable, marais, lacs temporaires | Potentiel humide seulement ; ni tourbe épaisse ni mare permanente déduite de `moisture` |
| O4 | Contexte littoral : apport sédimentaire, salinité, énergie eau/houle, marée, état du niveau marin | Vasières, estrans, plages triées, sebkhas, dépôts coquilliers | Côte générique rocheuse ou sédimentaire selon stock ; pas d'estran de marée nommé sans marée déclarée |
| O5 | Unités volcaniques et hydrothermales déclarées : forme de lave, scories, cendres, ponce, tuf, silice, soufre | Volcanisme et dépôts géothermiques | Basalte générique ; pas de lave cordée, de ponce ou de soufre à partir du seul poids basaltique |
| O6 | Régime froid et histoire : gel-dégel, pergélisol, couverture neigeuse, glace, héritage glaciaire | Neige, glace, motifs périglaciaires, moraines | Sol froid compatible et débris de gel potentiels ; pas de glacier ni de pingo automatique |
| O7 | Source biologique morte et perturbations : litière, laisses, coquilles, corail mort, guano, incendie | Litière, débris naturels, dépôts biogéniques, cendres et charbon | Pas de tapis ou de dépôt spécifique inventé ; `organic` peut encore modifier le sol |
| O8 | Fond subaquatique qualifié, profondeur, transparence et charge en suspension | Fonds sableux, rocheux ou vaseux visibles | Eau masquant le fond ; ne pas utiliser les valeurs de sol hors `soilMask` |
| O9 | Forme ou événement identifié et géométrie compatible : dune, cône, banc, glissement, karst, récif, cratère | Types du catalogue qui sont des paysages et non des matières | Matériau parent possible ; forme nommée non produite. Un simple drapeau ne crée pas la géométrie correspondante |
| O10 | Propriétés de surface spécifiques : retrait-gonflement, cimentation, réseau de fractures, pendage, tri et vernis | Grandes fissures, dalles, schiste feuilleté, pavement et patines | Motif discret générique ; les variantes structurées fortes restent conditionnelles |

Ces informations peuvent être des masques, attributs de régions ou scénarios tirés une fois. Elles ne demandent pas nécessairement de nouvelles simulations. Leur absence doit rester visible dans l'explication de la recette.

## 5 Règles communes de décision

### 5.1 Ordre de résolution

1. **Fixer le domaine** à partir des autorités d'eau et de la validité des données. Retirer l'occultation du vivant et des constructions sans modifier les entrées du support.
2. **Déterminer le support exposé et les matières disponibles**, avec N1 et N2. La roche mère contraint l'origine, mais un dépôt peut la masquer complètement.
3. **Combiner les processus**, en conservant leurs potentiels : résiduel, versant, fluvial, éolien, littoral, hérité. Ne pas passer par le seul `process` dominant. Vérifier source, stock et connexion avant de placer un dépôt nommé.
4. **Établir les recettes admissibles** avec les conditions de la section 6. Une condition nécessaire absente n'est pas réparée par le hasard.
5. **Calculer des proportions continues dans les budgets de couverture**, puis une organisation : matrice, plaques, amas, bancs, poches ou fragments orientés.
6. **Appliquer l'état et les couvertures mortes autorisées**. L'humidité peut assombrir une matière ou transformer une matrice fine en boue sans changer sa provenance.
7. **Produire la carte et son explication**, puis laisser le renderer réaliser les grains et motifs résolus à son échelle.

### 5.2 Nécessité et préférence

N1 et la couverture des fragments issue de N2 fixent d'abord, ou bornent si elles sont incertaines, les parts **roche exposée, fragments meubles et matrice**. La matrice peut être minérale ou organique. Ces parts forment le budget du support visible. Les préférences choisissent ensuite les matières à l'intérieur de chaque part : le hasard ne peut pas effacer une exposition rocheuse connue pour installer du sable sans dépôt.

Une règle sépare trois niveaux : une éligibilité forte, un stock disponible et des préférences graduelles. Pour un groupe de support `g`, une expression de départ est :

```text
score[m in g] = eligible[m] * availability[m] * suitability[m]
score[m] *= stableVariation(m, worldPosition)   # positif, par exemple 0,85..1,15
supportWeight[m] = cover[g] * score[m] / sum(score[k in g])
```

`eligible` désigne un fait de domaine ou de scénario : une source de gypse, un dépôt glaciaire déclaré, un fond qualifié, etc. `availability` interdit de fabriquer une nappe de sable ou de blocs sans matière disponible. `suitability` combine les préférences de pente, position, eau et climat. Ces facteurs sont des scores de synthèse, **pas des probabilités physiques indépendantes** : pente, TPI et géomorphons sont corrélés et ne doivent pas compter trois fois le même signal.

Cette normalisation porte sur les matières de support émises par les recettes, pas sur tous les identifiants M01–M28 pris comme concurrents. Les états, motifs, couches mortes et assemblages sont résolus selon les rôles décrits en section 6.

Une donnée manquante prend l'état « inconnu », distinct de « présent » et « absent ». Un cas spécialisé inconnu ne s'active pas ; une matière générique reste possible, avec une explication et une confiance réduite. Si les scores d'un groupe non vide sont tous nuls, le repli reste compatible avec le domaine, l'exposition et la source : roche générique sur roche exposée, matrice générique sur manteau meuble, fragments génériques si leur présence est connue. À défaut on conserve `unresolved`. Le repli ne transforme pas une eau ou un fond inconnu en terre et n'active aucune spécialité.

Les préférences sont lissées sur des plages, non découpées par classes. Des rampes de pente autour de 10–25° ou de profondeur relative autour de quelques dizaines de centimètres peuvent servir à une première calibration, mais ne sont pas des seuils universels. Les valeurs exactes seront ajustées sur les 42 tuiles.

### 5.3 Place du hasard

| Décision | Règle | Part aléatoire autorisée |
| --- | --- | --- |
| Lithologie et unité spéciale | Scénario régional connu | Choix stable de scénario avant la classification, jamais une lithologie différente à chaque pixel |
| Matériau parmi plusieurs possibilités | Tirage pondéré entre candidats admissibles | À l'échelle d'une plage de dépôt ou d'une unité locale, avec raccords continus |
| Proportions à contexte semblable | Variation bornée des scores et stocks relatifs | Champs cohérents qui préservent la dominance des contraintes |
| Taille, orientation et regroupement des éléments | Distribution conditionnée par source, pente, transport et échelle | Candidats déterministes, amas et textons |
| Couleur et usure | Palette de la matière, minéralogie et état | Variation dans une famille compatible ; sel blanc, sol noir et terre rouge ne sont pas des couleurs libres interchangeables |
| Dune, tourbe, glacier, source hydrothermale | Information nécessaire explicite | Aucun tirage ne remplace le stock, l'histoire ou la forme manquante |

La clé aléatoire est du type `hash(worldSeed, recipeFamily, canonicalRegionOrCell, candidateId)`. Elle ne dépend ni de la caméra, ni du pixel écran, ni du LOD, ni de l'ordre des requêtes. Un changement d'humidité ne reroule pas toutes les positions des pierres. Une tuile affichée n'est pas une unité géologique.

### 5.4 Éviter les bruits seuillés et la soupe de matériaux

Les proportions continues ne sont pas une moyenne uniforme des couleurs PBR. Suivant RENDER_REVIEW §8, « 60 % gravier, 25 % sable, 15 % limon » doit devenir des fragments, des interstices et des plages. Dans cet exemple, les fragments occupent 60 % du support et les 40 % de matrice se répartissent entre sable et limon. La matrice remplit les espaces entre les pierres ; un dépôt recouvre un support ; des plaques de roche affleurent à travers une couverture. L'opérateur d'agencement dépend du processus.

Les limites de classe servent à la légende. À l'intérieur d'un domaine compatible, l'exposition, les stocks et les poids varient graduellement. Les masques d'eau et les emprises physiques explicites peuvent garder une frontière localisée ; il ne s'agit pas de flouter un rivage ni de déplacer les autorités du terrain. Les détails fins varient aussi à l'intérieur d'une unité ; ils ne sont pas concentrés dans une couronne de bruit autour de son contour. Les données à 30 m déterminent le contexte, tandis que les détails de 1–50 m puis centimétriques sont des recettes stables et identifiées comme synthétiques. Les fractures, les rides et les bancs utilisent une direction ou une géométrie causale.

La représentation distante conserve la fraction de surface et l'apparence moyenne des détails. Un affleurement ou une pierre ne change pas d'identité lorsque sa représentation change. Cette contrainte vient de RENDER_REVIEW §9 ; elle n'impose pas de précalculer une image au centimètre.

## 6 Matériaux et conditions de production

Les identifiants M01 à M28 nomment des **familles de recettes de sol visible**. Certaines correspondent à une matière ; d'autres ajoutent un état, un motif ou un assemblage à des matières déjà présentes. Elles ne demandent pas 28 shaders indépendants. Les identifiants N/O renvoient aux informations de la section 4.

Les renvois tels que `N2/N3/N4` ou `O1/O3/O4` désignent les informations pertinentes selon l'origine et la variante, pas une conjonction obligatoire de toutes ces entrées. Les colonnes de conditions nécessaires précisent les alternatives. De même, `M04/M05` désigne des candidats à combiner selon les données, pas leur présence obligatoire.

| Familles de recettes | Rôle dans le budget de surface |
| --- | --- |
| M01–M10, M13–M20 et M25 | Émettent des matières de support dans les groupes roche, fragments ou matrice. Une recette telle que M19 se développe en cendre fine, ponce granulaire ou tuf rocheux selon son sous-type ; ces variantes ne forment pas une classe unique interchangeable |
| M11 et M12 | État ou variante de la matrice parente : par exemple argile boueuse ou argile à croûte fissurée. Ne pas ajouter un poids de boue ou de fissures au poids déjà présent de l'argile |
| M21 et M23 | Recouvrements morts et neige, séparés du budget du support selon la section 2.1 |
| M24 | Support glacé, couche de glace sur sol ou état d'eau gelée selon le domaine. Le névé/firn reste M23 tant qu'il est décrit comme manteau neigeux transformé ; il devient M24 seulement lorsque le scénario le décrit comme support glacé. Un même emplacement ne compte pas les deux pour la même couche |
| M26–M28 | Assemblage, motif ou origine qui organise et qualifie les matières parentes. Un dépôt morainique émet ses terres, sables et fragments avec l'origine glaciaire ; « moraine » n'est pas une fraction ajoutée une seconde fois |

### 6.1 Matrices minérales et support rocheux

| ID et recette | Conditions nécessaires | Conditions favorables | Exclusions et variantes | Information à compléter |
| --- | --- | --- | --- | --- |
| M01 Terre minérale et mélange terre-sable | Matrice fine exposée, hors eau masquant le fond | Couverture stable ; altération et dépôts fins ; relief peu ou moyennement pentu | Teintes brune, ocre, beige ; noir ou rouge spécifique seulement avec source compatible. Fraction de sable ≠ nappe de sable libre | N1/N2 ; O1 pour couleur minérale spécifique |
| M02 Terre argileuse | Fraction argileuse significative dans la matrice exposée | Matériau argilo-marneux local ou fines remaniées ; zones calmes | Compacte/croûteuse selon état ; gonflante et grandes fissures demandent O10. Ni toute plaine ni toute marne n'impose de l'argile nue | N1/N4 ; O10 |
| M03 Limon et poussière | Fines limoneuses disponibles, couverture exposée | Alluvions fines, zones de dépôt peu énergétiques ; apport poussiéreux déclaré | Le loess exige un dépôt éolien limoneux hérité ou une source déclarée ; un sol clair seul ne l'identifie pas | N2/N3 ; O2 pour loess |
| M04 Sable meuble ou nappe sableuse | Sable libre disponible, matrice peu cohésive et surface exposée | Tri fluvial/littoral, transport éolien, arène remaniée | Sec ou humide selon N4. Blanc coquillier/gypseux, noir volcanique ou rouge ferrugineux demandent la provenance correspondante. Le climat aride seul ne suffit pas | N2/N3/N4 ; O1/O4/O5/O7 pour variantes |
| M05 Gravier et galets | Stock grossier et part de surface suffisants | Chenaux et bancs grossiers, plages énergétiques, dépôts remaniés | Fin/grossier via tailles ; galets arrondis via histoire de transport. La pierrosité actuelle seule ne distingue pas les tailles ni l'arrondi | N2/N3 ; O2/O4 selon contexte |
| M06 Pierres et blocs anguleux | Fragments rocheux disponibles, source ou dépôt hérité, appui compatible | Rupture de pente, pied de paroi, convergence et runout de versant | Blocs plats selon feuilletage ; blocs géants et chaos imposent dimensions et support. Une pente forte sans source ne crée pas d'éboulis | N1/N2, provenance gravitaire ; O2/O10 |
| M07 Roche massive exposée | Roche accessible et faible couverture effective | Crêtes, épaules, parois, sols minces, abrasion ou décapage | Lithologie locale continue : granite, calcaire, grès, marne ou basalte actuels. Schiste, ardoise, gneiss, quartzite, conglomérat et bandes minéralisées demandent O1. Le froid/sec n'est pas une lithologie | N1 ; O1/O10 pour sous-types et motifs |
| M08 Roche altérée, arène et saprolite | Substrat altérable et altération/ancienneté compatibles | Climat et stabilité permettant l'altération ; transitions roche-matrice | L'arène reste liée à sa roche parentale. Une saprolite profonde ou des tors/chaos ne se déduisent pas de `weatherability` seul | N1/N2 ; O2/O9 pour profil hérité et forme |

Pour M07, la lithologie choisit les familles de matière et de fracturation, pas un aplat de couleur. Le feuilletage de schiste, les rubans de gneiss, les galets cimentés d'un conglomérat et les couches d'un grès restent des structures distinctes. « Stratifié », « multicolore », « fissuré », « en dalles » ou « poli » sont des variantes conditionnelles, jamais une obligation de générer un autre shader complet.

### 6.2 Sol organique et états de surface

| ID et recette | Conditions nécessaires | Conditions favorables | Exclusions et variantes | Information à compléter |
| --- | --- | --- | --- | --- |
| M09 Sol organique et humus exposé | Matière organique du support, surface accessible | Accumulation et conservation de matière organique ; stabilité ; sol peu décapé | Terre noire/humus ne signifie pas tourbe ; l'humus ne remplace pas le limon dans la texture minérale | `organic` + N1 ; origine organique à qualifier si dominante |
| M10 Tourbe exposée | Dépôt tourbeux connu ou scénario de formation et conservation persistante | Engorgement durable et accumulation ; contexte froid ou tropical compatible | `moisture` élevé, TWI élevé ou basse température seuls insuffisants ; tourbières structurées demandent aussi forme/microrelief | O3 ; O9 pour bombements, lanières et buttes |
| M11 Boue, vase et matrice hydromorphe | Matrice fine disponible et état suffisamment humide/saturé ; domaine émergé ou fond qualifié | Dépressions, faibles pentes, fines alluviales/lacustres/littorales, drainage lent | La boue est un état/assemblage des M01–M03. Marbrures hydromorphes et vase organique demandent une histoire ou origine spécifique | N2/N3/N4 ; O3/O4/O8 |
| M12 Croûte et fissures de dessiccation | Matrice cohésive compatible et cycle de dessiccation déclaré | Argile, dépôt fin calme, contraste humide-sec | Un état sec seul ne prouve pas un cycle ; grand retrait-gonflement demande O10. Ne pas réutiliser indistinctement les motifs du sel et du gel | N4 ; O10 ; motif physique stable |
| M13 Terre ferrugineuse et cuirasse | Source/stock d'oxydes et niveau d'altération ou dépôt ferrugineux déclaré | Altération prolongée, surfaces stables ; climat régional compatible | Le tropical humide seul n'impose pas une latérite. Terre rouge meuble et cuirasse indurée sont deux états/profils | O1/O2/O10 |
| M14 Sol carbonaté et encroûtement calcaire | Carbonates disponibles et accumulation/cimentation déclarée | Circulation puis évaporation, dépôt ou héritage compatible | Une roche calcaire n'est pas automatiquement du calcrète ; distinguer roche M07, dépôt M14 et travertin M20 | O1/O2/O10 ; N4 |
| M15 Sol salin et croûte saline | Source de sels et concentration/stock salin déclaré | Évaporation, bassin fermé ou contexte côtier compatible, alternance humide-sec | Ni endoréisme ni aridité seuls suffisants. Une playa peut rester argileuse sans sel | O1/O3/O4 ; N4 |
| M16 Sol et dépôt gypseux | Gypse disponible ou unité gypsifère déclarée | Évaporites, dépôts hérités et remaniement compatible | Gypse blanc ≠ sable coquillier blanc ≠ neige ; couleur commune, causes différentes | O1/O2 ; N2 pour sable gypseux |

### 6.3 Volcanisme et dépôts spécifiques

| ID et recette | Conditions nécessaires | Conditions favorables | Exclusions et variantes | Information à compléter |
| --- | --- | --- | --- | --- |
| M17 Lave compacte à structure déclarée | Unité de coulée et type de surface connus | Forme cordée, lobée ou plissée compatible | Le basalte seul autorise M07.basalt, pas la distinction pāhoehoe/ʻaʻā. Le matériau ne fabrique pas une coulée ni un cratère | O5/O9 ; direction et échelle |
| M18 Scories et lave bréchique | Stock scoriacé ou surface de lave fragmentée déclarée | Dépôts volcaniques, ʻaʻā, fronts et fragments de coulée | Noir/rouge/brun selon source et altération ; pas un simple gravier sombre tiré au hasard | O5 ; N2 ; O9 pour forme |
| M19 Cendres, ponce, tuf et ignimbrite | Nature du produit volcanique et dépôt déclarés | Dépôts pyroclastiques, consolidation et remaniement | Cendres fines, ponce granulaire et tuf rocheux ne partagent ni tailles ni cohésion. Ils ne sont pas fournis par la seule fraction basaltique | O5/O2 ; N2 ; O9 si plateau/forme |
| M20 Dépôt hydrothermal ou carbonate précipité | Source et substance déclarées : silice, soufre, carbonate, argiles altérées | Source hydrothermale ou résurgence compatible | Travertin et tuf calcaire diffèrent du tuf volcanique M19. Les bassins colorés sont aussi des eaux, pas des taches de sol librement choisies | O5 ou O1+O3 ; O9 |
| M21 Litière morte mince et laisses | Source morte connue, couverture et type déclarés ; option active | Accumulation en poches et à proximité de la source, piégeage, rive | Feuilles, aiguilles, brindilles et algues mortes sont un recouvrement distinct de M09. Gros troncs et vivant exclus | O7 ; transport/localisation ; couvert séparé |
| M22 Sol brûlé, charbon et cendres d'incendie | Événement/incendie et résidu déclaré | Âge relatif, dépôt de cendres, substrat brûlé accessible | Pas d'incendie déduit d'un climat sec ou d'une terre sombre ; cendres d'incendie distinctes des cendres volcaniques | O7 ; N4 et support antérieur |
| M25 Débris biogéniques et dépôts animaux | Source/coquilles/corail mort/guano déclarés | Plage coquillière, support récifal connu, accumulation locale | Vivant et animaux non rendus ; corail mort peut constituer un support minéral. Le guano n'est pas une couleur de sol tirée sans source | O7 ; O4/O8/O9 selon cas |

### 6.4 Froid et assemblages de paysage

| ID et recette | Conditions nécessaires | Conditions favorables | Exclusions et variantes | Information à compléter |
| --- | --- | --- | --- | --- |
| M23 Neige et névé | Présence/stock de neige déclaré | Rétention, exposition, vent, altitude et température compatibles | Fraîche, ancienne, granuleuse, soufflée et regelée selon état/histoire. Une température annuelle basse seule ne donne ni couverture ni épaisseur | O6 + état ; O9 pour congère/corniche |
| M24 Glace exposée ou support glacé | Glace présente et domaine identifié : sol, glacier, eau gelée | Régime froid et histoire compatibles | Glace bleue, firn et glace lacustre sont des variantes différentes. Banquise et icebergs restent des objets/eaux extérieurs au sol ; glacier non créé par la recette | O6 ; O8/O9 selon domaine |
| M26 Pavement et patine désertiques | Fragments disponibles, surface stable et contexte de décapage/héritage | Déflation, faible couverture, temps de résidence déclaré | Assemblage de M01/M05/M06, avec vernis si O10 ; aridité seule insuffisante | N2 ; O2/O10 |
| M27 Sol structuré par le gel | Sol minéral et régime gel-dégel/pergélisol déclaré selon le motif | Eau disponible, tailles de fragments et pente compatibles | Cercles/bandes triés, polygones à coins de glace et lobes de solifluxion ont des conditions et structures distinctes ; `frostPotential` seul ne les identifie pas | O6/O9/O10 ; N2/N4 |
| M28 Dépôt glaciaire et proglaciaire | Héritage ou dépôt glaciaire déclaré et matériaux disponibles | Moraines, till, épandages remaniés et surface déglacée | Assemblage M01–M06 et support M07. Une moraine ne se déduit pas du froid actuel ; till peu trié et dépôt fluvioglaciaire trié à distinguer | O2/O6 ; N2/N3 ; O9 pour forme |

Les sols sous un couvert vivant du catalogue restent des combinaisons de ces familles. Une forêt ne crée pas une famille « sol forêt » universelle. Le sol sous mangrove demande notamment un contexte sédimentaire et hydrique ; la canopée ne décide pas si la matrice est sableuse, vaseuse ou organique.

## 7 Passage du contexte à la composition

L'annexe B reprend les 28 contextes de MATERIALS_REVIEW §3. La règle générale reste : **le contexte choisit des candidats, les stocks et la surface exposée choisissent leurs proportions**.

### 7.1 Six exemples de décisions complètes

| Entrées de carte et compléments | Composition plausible | Variantes et hasard autorisés | Décisions interdites faute d'entrée |
| --- | --- | --- | --- |
| Épaule/versant calcaire, sol mince, faible potentiel hydrique, support exposé | M07.calcaire avec poches de M01/M02 et M06 selon fragments | Taille des poches, espacement des joints et pierres, teintes compatibles | Pas de calcrète, dolines ou lapiaz automatique sans O1/O9/O10 |
| Pied de paroi basaltique, chemin gravitaire connecté, stock grossier | M06 basaltique et matrice M01/M04 issue du même apport | Amas, tri longitudinal et tailles ; résidu local dans les interstices | Pas de scories ou ʻaʻā simplement parce que le parent est basaltique |
| Banc fluvial émergé, faible HAND, apport amont granitique, tri grossier | M05/M04/M03 : par exemple 60/25/15 en surface | Position des galets et plages de fines ; humidité selon état | La roche sous-jacente locale ne remplace pas la provenance des galets ; pas de banc sans emprise émergée |
| Plaine aride, matrice argileuse, pas de sable libre ni sel déclaré | M02 ; M12 seulement si cycle sec-humide et retrait compatibles | Plages compactes et petites variations ; fissures conditionnelles | Pas d'erg, de salar ni de sable uniforme |
| Creux humide sous une forêt masquée, matrice fine et organique connus | M01/M02/M09, M11 selon état ; M21 seulement si litière déclarée | Humidité en poches, répartition des débris morts autorisés | Pas de tourbe épaisse, mousse ou tapis de feuilles déduit du seul climat |
| Côte basse proche de l'eau, stock fin et faible énergie déclarée | M11/M03, éventuellement M04, sur les parties émergées | Chenaux existants, granulométrie, teinte organique et humidité | Pas de plage sableuse automatique ; pas d'estran de marée sans O4 |

L'exemple 60/25/15 est une recette illustrative de RENDER_REVIEW, pas une constante à appliquer à toutes les rivières.

### 7.2 Questions qui lèvent une ambiguïté

| Apparence possible | Information qui la décide |
| --- | --- |
| Plaine sableuse ou terre sableuse | Disponibilité et couverture de sable meuble, pas seulement `sand` |
| Roche massive ou sol pierreux | Exposition du support, épaisseur de matrice et distribution des fragments |
| Gravier roulé ou éboulis anguleux | Origine et trajet du dépôt, tailles et arrondi |
| Argile sèche ou salar | Source et concentration de sels ; le bassin fermé ne suffit pas |
| Sol noir, basalte, tourbe ou charbon | Matière minérale, accumulation organique, histoire d'engorgement ou incendie |
| Calcaire, calcrète, travertin ou sable coquillier | Roche, accumulation secondaire, précipitation ou apport biogénique |
| Basalte ancien, lave cordée ou scories | Identité et état de l'unité volcanique |
| Boue actuelle, marbrures hydromorphes ou tourbe | État instantané synthétique, durée d'engorgement et histoire organique |
| Polygones d'argile, de sel, de gel ou de fractures rocheuses | Cause, support et état ; ne pas choisir au seul motif |
| Rivage sableux ou vaseux | Nature et stock des apports, énergie et immersion, pas seulement distance à l'eau |

## 8 Agencement selon le matériau

Cette table traduit RENDER_REVIEW §3 et §7 sans choisir une technologie obligatoire pour cette étude.

| Recettes | Agencement à demander au rendu | Entrées de la recette |
| --- | --- | --- |
| Terre fine, limon, arène, sable sans grande forme | Matière stochastique et grains filtrés | Composition, échelle des grains, variation et humidité |
| Gravier, galets, pierres, scories, ponce | Fragments ou textons, tailles distribuées, matrice entre éléments | Stock grossier, couverture, tailles, arrondi, agrégation et provenance |
| Roche massive, feuilletée ou stratifiée | Matériau de roche avec structures orientées et fractures cohérentes | Parent lithologique, exposition, orientation, pendage/fractures si connus |
| Fissures, pavement et grands polygones | Réseau ou motif structuré raccordable | Cause, échelle, état, orientation ; pas une nouvelle sélection de matériau |
| Rides de sable et stries | Motif directionnel cohérent | Vent/courant, humidité, grains et support |
| Dépôts fluviaux, gravitaires et littoraux | Bancs, amas, nappes et langues liés à leurs sources | Emprises, distances signées, direction de transport et stocks |
| Litière morte | Petits éléments et amas séparés du support | Type de débris, couverture, taille et piégeage |
| Neige/glace | Couche ou support cohérent avec son domaine | Présence, épaisseur relative, état, vent et accumulation |

Une photo de sable ne crée pas une dune ; un motif de fractures ne crée pas une falaise ; une texture de gravier ne crée pas le cône qui la porte. Ces formes sont reconnues si elles existent ou fournies par un scénario géométriquement compatible. Leur fabrication n'est pas une dépendance du premier compilateur de matière.

## 9 Livraison progressive proposée

### 9.1 Première carte de sol visible

1. Ajouter N1–N4 et les explications de validité aux données actuelles.
2. Produire M01–M09 et M11 pour les cas courants, avec les parents lithologiques actuels. M12 reste conditionnel à son état ; les types spéciaux ne sont pas tirés par défaut.
3. Afficher « composition du sol », « matière dominante », « origine », « état » et « information manquante » dans Informations. Conserver les couches explicatives actuelles.
4. Vérifier d'abord que les données du support restent identiques quand les visibilités du vivant et des constructions changent. La nouvelle carte de matières se compare au fond historique comme référence ; elle ne nécessite pas de séparer après coup les composants déjà aplatis dans son image. Lorsque les étages sont rendus séparément, vérifier aussi l'image au même cadrage avec et sans occultation.

Cette première carte peut être affichée avec une palette de recettes et des proportions. Elle ne nécessite pas de constituer toute la bibliothèque PBR. La carte Render actuelle contient déjà des apparences compositées ; ses pixels ne sont pas la source des nouvelles décisions de matière.

### 9.2 Extension du catalogue sans changer le contrat

Activer ensuite les familles spécialisées par O1–O10 selon les paysages souhaités. Une carte peut déclarer un dépôt de loess, un secteur gypsifère, une unité de scories ou un héritage glaciaire sans simuler leur formation. Les mêmes règles consomment ces entrées. Une forme absente reste absente même si sa matière est disponible.

Le travail de matière peut rester dans une fonction `compileVisibleGround(context, sceneState, declaredScenarios, worldSeed)`. Les tableaux du présent document servent de catalogue de règles et de conditions, avec leurs références N/O ; les recopier en listes indépendantes dans plusieurs renderers créerait des divergences.

## 10 Critères de validation

| Vérification | Résultat attendu |
| --- | --- |
| Couverture du catalogue | Chaque type et ses variantes ont un renvoi de matière, de forme, d'état ou une exclusion explicite dans l'annexe A ; aucune prétention à 235 matériaux indépendants |
| Budgets distincts | Proportions lithologiques, texture fine, stocks et couverture visible ne sont pas confondus ; chaque mélange applicable est normalisé |
| Dépôts | Matière disponible et source compatible ; provenance remaniée conservée ; gravitaire et fluvial ne sont pas assimilés |
| Eau | Banc émergé distinct de chenal mouillé ; mer, lac et rivière typés ; données sous masque non qualifiées non utilisées comme fond |
| Cas ambigus | Plaine sèche sans stock sableux ≠ erg ; bassin fermé sans sel ≠ salar ; basalte seul ≠ scories ; creux humide seul ≠ tourbe |
| Continuité | Variations graduelles à domaine compatible et motifs stables à la caméra, au zoom et aux limites ; les emprises explicites et masques d'eau restent respectés |
| Contrefactuel sans couvert | Masquer arbre, herbe ou bâtiment conserve la matière du support et son identité |
| État | Passer de sec à humide ne déplace pas toutes les pierres ; une couche de neige ne modifie pas la lithologie |
| Informations absentes | Repli explicite, confiance réduite et liste des cas spécialisés désactivés ; pas de remplissage silencieux par du bruit |
| Formes | Les dunes, moraines, falaises, récifs et dépôts en éventail nommés ont une forme compatible ; une texture seule ne revendique pas leur existence |

Les 42 tuiles fournissent des comparaisons utiles : même géologie entre les six climats d'une famille, aride contre tropical, côte contre intérieur, sommet contre vallée et zone de dépôt contre roche locale. Des scénarios ciblés supplémentaires peuvent tester les matières rares sans les injecter arbitrairement dans toutes les cartes.

## 11 Lecture des annexes

L'annexe A couvre les **235 lignes de types** de MATERIALS_REVIEW §1, avec leurs variantes conservées. Les références M donnent les conditions inverses de la section 6 ; N/O précisent l'information à produire. Les autres annexes couvrent les 28 contextes, les 22 motifs et les 12 familles exceptionnelles des §2–4.

Statuts : **C** = combinaison du socle courant avec N1–N4 ; **O** = information/scénario optionnel nécessaire ; **F** = forme à reconnaître ou fournir, sans la générer par la matière ; **W** = autorité eau ou fond qualifié ; **E** = apparence vivante/objet hors périmètre. Un statut F ou E n'empêche pas de calculer le support minéral sous-jacent. Tous les renvois sont des règles proposées ; ils ne déclarent pas ces recettes déjà implémentées.

## Annexe A Couverture des types et variantes du catalogue

Chaque ligne reprend le type et toutes les variantes de MATERIALS_REVIEW §1. Les conditions complètes sont celles des familles M de la section 6 ; la colonne centrale précise les prérequis propres à cette ligne. Les termes de végétation dans les variantes sont conservés pour la traçabilité mais leur dessin est exclu.

### Catalogue 1.1 Plaines et sols minéraux nus

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Terre fine sèche** — Brune, ocre, rouge, beige, noire | M01 | N1/N2/N4 ; palette minérale compatible ; variante humique M09 ou ferrugineuse M13 si qualifiée | C/O |
| **Terre argileuse** — Compacte, fissurée, gonflante, croûteuse | M02/M12 | N4 ; gonflante et grandes fissures : O10 ; pas de fissures sous eau | C/O |
| **Terre limoneuse** — Loess, poussière, limon alluvial | M03 | Alluvial : N3 ; loess/poussière éolienne : N2/O2 | C/O |
| **Sol organique nu** — Terre noire, humus, tourbe exposée | M09/M10 | Humus distinct de tourbe ; tourbe : O3 | C/O |
| **Sol ferrugineux** — Latérite, cuirasse ferrallitique, terre rouge | M13 | O1/O2/O10 ; latérite et cuirasse déclarées | O |
| **Sol carbonaté** — Calcrète, encroûtement calcaire, caliche | M14 | O1/O2/O10 ; pas de caliche automatique sur calcaire | O |
| **Sol caillouteux** — Gravier fin, gravier grossier, galets dispersés | M05 | N2 ; tailles et couverture de fragments ; galets selon transport | C |
| **Sol pierreux** — Pierres plates, blocs épars, roche subaffleurante | M06/M07 | N1/N2 ; pierres plates selon O10 ; affleurement via couverture | C/O |
| **Sol hydromorphe** — Saturé d'eau, boueux, marbré | M11 | N4 ; hydromorphie et marbrures durables : O3 | C/O |
| **Sol salin** — Efflorescences, croûtes blanches, argile salée | M15 | Source de sels O1/O4 ; état et concentration N4/O3 | O |
| **Sol gypseux** — Gypse blanc, terre gypsifère | M16 | Gypse O1 ; grain selon N2 ; blanc non suffisant | O |
| **Sol sableux** — Sable fin, grossier, mélange sable-terre | M01/M04 | N2 ; proportion sableuse de matrice distincte du sable meuble libre | C |

### Catalogue 1.2 Affleurements rocheux et substrats géologiques

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Granite massif** — Poli, altéré, fracturé, en dalles | M07/M08 | Granite exposé N1 ; dalles/fractures/poli : O10 ; altération M08 | C/O |
| **Chaos granitique** — Boules, blocs arrondis, tors | M06/M07/M08 | Source granitique et altération ; tors/boules/chaos : O9 | C/O/F |
| **Grès** — Rouge, jaune, blanc, stratifié | M07 | Source gréseuse ; couleur et strates O1/O10 | C/O |
| **Calcaire massif** — Blanc, gris, beige, fissuré | M07 | Calcaire exposé N1 ; fractures/pavement O10 | C/O |
| **Schiste et ardoise** — Feuilleté, incliné, fracturé | M07 | Unité schiste/ardoise O1 ; feuilletage et inclinaison O10 | O |
| **Gneiss et roches métamorphiques** — Rubané, plissé, fortement déformé | M07 | Unité métamorphique O1 ; rubans/plis O10 | O |
| **Quartzite** — Massif, en arêtes, fracturé | M07 | Unité quartzitique O1 ; arêtes et fractures compatibles | O/F |
| **Conglomérat** — Galets cimentés, roche érodée | M07 | Conglomérat cimenté O1 ; éléments et érosion O10 | O |
| **Roches sédimentaires stratifiées** — Couches horizontales, inclinées, plissées | M07 | Couches et orientation O1/O10 ; gradins seulement si forme existante | C/O/F |
| **Roches multicolores** — Couches ferrugineuses, argileuses, minéralisées | M07/M13/M16 | Palettes/couches minéralisées O1 ; pas de rayures colorées libres | O |
| **Pavement rocheux** — Dalles régulières, fractures polygonales | M07 | Roche exposée N1 ; réseau de dalles et joints O10 | C/O |
| **Roches fortement altérées** — Arènes, saprolites, affleurements résiduels | M08/M07/M01 | Altération liée au parent ; saprolite ou résidu hérité : O2 | C/O |

### Catalogue 1.3 Déserts sableux et formes éoliennes

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Erg sableux** — Sable uniforme, sable mêlé de roche | M04/M07 | N2 : manteau de sable ; mélange roche selon N1 ; champ déclaré O9 | C/F |
| **Dunes barkhanes** — Isolées, alignées, coalescentes | M04 | N2 + vent ; barkhanes O9 ; isolées/alignées/coalescentes = forme | C/F |
| **Dunes transversales** — Simples, multiples, superposées | M04 | N2 + vent ; rides/crêtes et superposition de dunes O9 | C/F |
| **Dunes longitudinales** — Seifs, dunes linéaires géantes | M04 | N2 ; régime de vent/direction et crêtes longitudinales O9 | C/O/F |
| **Dunes étoilées** — Complexes, pyramidales | M04 | N2 ; régime de vents et forme étoilée O9 | C/O/F |
| **Dunes paraboliques** — Fixées ou semi-fixées par végétation | M04 | N2/O9 ; géométrie fixée héritée conservée, plantes retirées | C/O/F |
| **Dunes en dôme** — Arrondies, sans crête dominante | M04 | N2 ; bosses arrondies de dunes O9 | C/F |
| **Dunes composites** — Dunes sur dunes, champs imbriqués | M04 | N2 ; formes imbriquées O9, non produites par le grain de sable | C/F |
| **Sable ridé** — Rides éoliennes, mégarides | M04 | N2/N4 ; vent/courant et support ; mégarides structurées O9 | C/O/F |
| **Couloirs interdunaires** — Sable compact, gravier, zones humides | M04/M05/M11 | N2/N3/N4 ; dépression entre dunes identifiée O9 | C/F |
| **Reg désertique** — Graviers, cailloux, pavement désertique | M26 | Fragments disponibles N2 ; pavement/ancienneté O2/O10 | O |
| **Hamada** — Plateau rocheux nu, roches fracturées | M07/M06 | Support rocheux N1 ; plateau/formes préexistantes O9 | C/F |
| **Désert de loess** — Dépôts poussiéreux, reliefs disséqués | M03 | Poussière/loess O2 ; formes de dissection O9 | O/F |
| **Désert de sable coloré** — Rouge, noir volcanique, blanc gypseux | M04 | Palette/source rouge O1 ; noir via provenance basaltique N2 ; gypse blanc M16/O1 ; grain N2 | C/O |

### Catalogue 1.4 Reliefs érodés, déserts rocheux et surfaces arides

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Badlands** — Argileux, marneux, multicolores | M02/M07/M13 | Matrice marneuse/argileuse ; couleurs O1 ; ravinement O9 | C/O/F |
| **Yardangs** — Petits, longs, géants | M07/M03 | Substrat et vent érosif ; nervures/forme O9/O10 | O/F |
| **Inselbergs** — Dômes, massifs résiduels, monolithes | M07/M06 | Source et exposition ; dôme/monolithe résiduel O9 | C/F |
| **Mesas** — Plateaux isolés, buttes tabulaires | M07/M01 | Couches et couverture ; forme tabulaire O9 | C/F |
| **Plateaux disséqués** — Canyons, ravins, escarpements | M07/M06/M01 | Substrat, exposition et versant ; canyon/ravins O9 | C/F |
| **Plaines de déflation** — Cuvettes éoliennes, surfaces décapées | M01/M03/M05/M26 | Déflation et stock N2 ; surface décapée/héritage O2/O9 | O/F |
| **Playas** — Argile sèche, boue durcie, sel | M02/M11/M15 | Fines et état N4 ; sel seulement avec O1/O3 ; cuvette O9 | C/O/F |
| **Salars** — Sel homogène, polygones, bassins humides | M15 | Stock salin O1 ; état N4/O3 ; motifs et bassin O9/O10 | O/F |
| **Sebkhas** — Dépressions salées, côtières ou continentales | M02/M11/M15 | Salinité O1/O3/O4 ; fin humide ou croûte selon état | O/F |
| **Croûtes de dessiccation** — Fissures fines, grandes plaques polygonales | M12 | Matrice cohésive, cycle N4 et retrait O10 ; tailles des plaques | O |
| **Dépôts de crue désertique** — Épandages sableux, graviers, boues | M04/M05/M11 | Apport et événement de crue O2/O3 ; chenaux/éventails O9 | O/F |
| **Réseaux d'oueds secs** — Simples, dendritiques, anastomosés | M04/M05/M03 | Réseau sec/intermittent déclaré N3/O3 ; héritage O2 | O/F |
| **Pavements désertiques** — Vernis sombre, pierres sur sol clair | M26 | Stock de fragments N2 ; vernis et surface stable O2/O10 | O |

### Catalogue 1.5 Montagnes, pentes et dépôts gravitaires

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Versant rocheux** — Lisse, fissuré, stratifié, feuilleté | M07 | N1 ; lisse/fracturé/stratifié/feuilleté par O10 | C/O/F |
| **Falaise continentale** — Verticale, étagée, fracturée | M07/M06 | Paroi existante O9 ; parent lithologique et fragments N2 | C/F |
| **Éboulis** — Fin, grossier, blocs géants | M06/M05/M01 | Source gravitaire, N2 ; fin/grossier/géant par tailles | C |
| **Cône de déjection rocheux** — Isolé, coalescent | M06/M01 | Source et chemin de dépôt N2 ; cônes/coalescence O9 | C/F |
| **Coulée de blocs** — Stable, récente, végétalisée | M06/M01 | Runout et dépôt hérités O2/O9 ; plantes retirées | O/F |
| **Glissement de terrain** — Translation, rotation, complexe | M06/M01/M02 | Cicatrice et masse déplacée O2/O9 ; source conservée | O/F |
| **Coulée de débris** — Boue, roche, mélange | M06/M11 | Dépôt/événement O2/O9 ; matrice fine et état N4 | O/F |
| **Couloir d'avalanche** — Rocheux, herbacé, traversant la forêt | M07/M06/M01 | Couloir identifié O9 ; retrait du contraste vivant sans inventer une matière | C/O/F |
| **Éboulis végétalisé** — Herbes, lichens, arbustes pionniers | M06/M01 | Dépôt source N2 ; herbes, lichens et arbustes retirés | C |
| **Crêtes rocheuses** — Dentelées, arrondies, stratifiées | M07/M06 | Crête existante O9 ; roche et fracturation O10 | C/F |
| **Surface alpine érodée** — Sol mince, petites pierres, roche affleurante | M01/M06/M07 | Sol mince N1 ; petits fragments N2 ; vivant retiré | C |
| **Formations morainiques** — Frontales, latérales, de fond | M28 | Héritage glaciaire O2/O6 ; bourrelets O9 ; tri N2 | O/F |
| **Terrasses naturelles de versant** — Structurales, d'érosion, dépôts anciens | M07/M01/M05 | Origine structurale/érosive/héritée O2/O9 ; matériaux selon source | O/F |

### Catalogue 1.6 Reliefs karstiques et dissolution

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Lapiaz** — Fissuré, rainuré, à rigoles | M07/M01 | Roche soluble et dissolution O1/O10 ; rainures/rigoles O9 | O/F |
| **Doline** — Petite, grande, sèche, humide | M07/M01/M11 | Doline O9 ; sèche/humide selon eau N3/O3, pas selon calcaire seul | O/F |
| **Ouvala** — Fusion de plusieurs dolines | M07/M01/M11 | Dépressions karstiques fusionnées O9 ; fond selon dépôt et état | O/F |
| **Poljé** — Plaine karstique fermée | M01/M02/M11/M07 | Plaine karstique O9 ; apport et drainage distincts O3 | O/F |
| **Karst à pitons** — Tours isolées, pitons densément groupés | M07/M06 | Roche et pitons/tours O1/O9 ; ombres hors décision de matière | O/F |
| **Karst conique** — Cônes serrés, cônes isolés | M07/M01 | Cônes et dépressions existants O9 ; matériaux de surface N1/N2 | O/F |
| **Karst à cockpit** — Dépressions jointives entre collines | M07/M01/M11 | Cuvettes karstiques O9 ; fond selon drainage et dépôts | O/F |
| **Effondrement karstique** — Gouffre, puits, effondrement récent | M07/M06 | Effondrement/gouffre O9 ; volume absent non simulé par couleur sombre | O/F |
| **Source karstique** — Résurgence, bassin turquoise | Eau et fond qualifié ; M20 conditionnel | Résurgence O3/O9 ; fond O8 ; M20 seulement si dépôt carbonaté/minéralisé déclaré | O/F/W |
| **Travertin** — Bassins étagés, terrasses calcaires | M20 | Dépôt carbonaté de source O1/O3 ; terrasses et bassins O9 | O/F/W |
| **Tuf calcaire** — Dépôts poreux, cascades pétrifiantes | M20 | Tuf calcaire précipité O1/O3 ; porosité/forme O9/O10 | O/F |

### Catalogue 1.7 Terrains volcaniques et géothermiques

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Lave basaltique pāhoehoe** — Cordée, lobée, plissée | M17 | Unité pāhoehoe O5 ; cordée/lobée/plissée O9/O10 | O/F |
| **Lave ʻaʻā** — Scoriacée, chaotique | M18 | Unité ʻaʻā O5 ; fragments et rugosité N2/O10 | O/F |
| **Coulée solidifiée** — Ancienne, récente, superposée | M17/M18/M07 | Coulée et âge O5/O9 ; succession ancienne/récente déclarée | O/F |
| **Champ de scories** — Noires, rouges, brunes | M18 | Scories O5 ; grains N2 ; noir/rouge/brun selon source | O |
| **Plaine de cendres** — Fine, consolidée, remaniée | M19 | Cendres O5 ; fines/consolidation/remaniement N2/O2/O10 | O |
| **Dépôt de ponce** — Blanc, beige, gris | M19 | Ponce O5 ; granularité N2 ; palette compatible | O |
| **Tuf et ignimbrite** — Compact, stratifié, raviné | M19/M07 | Tuf/ignimbrite O5 ; consolidation et ravins O9/O10 | O/F |
| **Cône volcanique** — Scories, cendres, roches nues | M18/M19/M07 | Cône O9 et produits volcaniques O5 ; pentes radiales préexistantes | O/F |
| **Caldeira** — Sèche, lacustre, végétalisée | M07/M19/M01 | Caldeira O9 ; état sec/lacustre via N3/N4 ; vivant retiré | O/F/W |
| **Cratère secondaire** — Petits cônes, maars, évents | M18/M19/M07 | Cône/maar/évent O5/O9 ; eau des maars indépendante | O/F/W |
| **Dôme de lave** — Compact, fracturé, en éboulis | M17/M07/M06 | Dôme O9 ; roche et éboulis N1/N2/O5 | O/F |
| **Lahar** — Sec, humide, ancien | M19/M11/M06 | Dépôt de lahar O5/O9 ; état et âge N4/O2 | O/F |
| **Champ hydrothermal** — Argiles altérées, soufre, silice | M20 | Hydrothermalisme et substances O5 ; argiles/soufre/silice distincts | O |
| **Bassins géothermiques** — Chauds, siliceux, multicolores | M20 ; fond qualifié | Bassin/source O5/O9 ; eau chaude/minéralisée hors matière du sol | O/F/W |
| **Solfatares et fumerolles** — Minéralisées, croûtées | M20 | Solfatare/fumerolle O5 ; croûtes minérales admises, vapeur hors périmètre | O/F/E |

### Catalogue 1.8 Rivières, torrents et plaines alluviales

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Ruisseau naturel** — Rectiligne, sinueux, encaissé | Fond M04/M05/M07/M11 | Réseau et emprise N3 ; eau séparée ; fond seulement si O8 | C/F/W |
| **Rivière à méandres** — Faiblement ou fortement sinueuse | M04/M05/M03 ; fond | Méandres existants N3/O9 ; dépôts selon source et tri | C/F/W |
| **Rivière en tresses** — Quelques bras, réseau très dense | M05/M04/M03 | Bras et bancs émergés N3/O9 ; eau entre bancs | C/F/W |
| **Rivière anastomosée** — Plusieurs chenaux stables végétalisés | M04/M03/M11 | Chenaux stables O9 ; retirer vivant des îles, garder dépôts et eau | C/F/W |
| **Torrent montagnard** — Rocheux, graveleux, à cascades | M07/M06/M05 | Source grossière et réseau N2/N3 ; cascades/eau hors matière | C/F/W |
| **Bancs alluviaux** — Sable, gravier, galets | M04/M05 | Emprise de banc émergé N3 ; courbure seule non suffisante | C/F |
| **Îles fluviales** — Sableuses, boisées, rocheuses | M04/M05/M07 | Île existante N3/O9 ; sable/roche selon source, boisements retirés | C/F |
| **Méandres abandonnés** — Bras morts, lacs en fer à cheval | M11/M03/M04 ; fond | Bras abandonné O2/O9 ; eau/état N3/O3 ; vivant retiré | O/F/W |
| **Paléochenaux** — Humides, secs, comblés | M03/M04/M11 | Paléochenal O2/O9 ; humide/sec/comblé selon état, non déduit du seul HAND | O/F |
| **Plaine d'inondation** — Limoneuse, marécageuse, boisée | M03/M02/M11 | Plaine connectée N3 et inondation O3 ; boisements retirés | C/O/F |
| **Levées naturelles** — Bourrelets riverains, berges surélevées | M04/M03 | Levée naturelle O9 ; tri/dépôt fluvial N2/N3 | C/O/F |
| **Cônes alluviaux** — Petits, géants, actifs, fossiles | M05/M04/M03 | Cône alluvial O9 ; apport N2/N3 ; actif/fossile O2/O3 | C/O/F |
| **Bajadas** — Cônes de piémont coalescents | M05/M04/M03 | Cônes coalescents O9 ; stock et apport N2/N3 | C/O/F |
| **Terrasses fluviales** — Anciennes, récentes, étagées | M05/M04/M03/M01 | Terrasse/héritage O2/O9 ; état récent/ancien déclaré | O/F |
| **Ravines et rigoles** — Peu profondes, très incisées | M01/M02/M07 | Incision présente O9 ; matière selon substrat/dépôt N1/N2 | C/F |
| **Cascades et rapides** — Rocheux, en marches, à seuils | M07/M06 ; fond | Seuils et géométrie N3/O9 ; écume et animation d'eau hors matière | C/F/W |

### Catalogue 1.9 Lacs et eaux intérieures

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Lac profond clair** — Bleu foncé, bleu-noir | Fond non visible | Eau profonde claire : W ; support seulement si fond O8 et visibilité suffisante | W |
| **Lac peu profond** — Fond sableux, rocheux, vaseux | M04/M07/M11 | Fond et profondeur O8 ; pas de fond qualifié à partir du seul masque lac | O/W |
| **Lac glaciaire** — Turquoise, laiteux, chargé en sédiments | M28 ; fond éventuel | Eau glaciaire chargée : W ; support glaciaire seulement O2/O6/O8 | O/W |
| **Lac volcanique** — Acide, minéralisé, chaud | Fond qualifié éventuel | Chimie/température d'eau hors sol ; O5/O8 pour dépôts et fond | O/W |
| **Lac salé** — Permanent, saisonnier, hypersalin | M15/M11 ; fond | Salinité et immersion O1/O3 ; pas de sel automatique pour lac fermé | O/W |
| **Lac organique** — Eau chargée en tanins | M09/M11 ; fond | Tanins/couleur appartiennent à l'eau ; organique du fond séparé O3/O8 | O/W |
| **Lac turbide** — Charge argileuse, limoneuse | M03/M02/M11 ; fond | Charge en suspension dans l'eau ; dépôt/fond seulement N2/O8 | O/W |
| **Lac à végétation aquatique** — Plantes submergées, flottantes | Fond qualifié éventuel | Plantes flottantes/submergées retirées ; eau et fond O8 conservés | E/W |
| **Lac de barrage naturel** — Glaciaire, volcanique, éboulement | M06/M28/M17 selon obstacle | Obstacle naturel et origine déclarés O2/O5/O6/O9 ; eau W | O/F/W |
| **Lac temporaire** — Flaques, bassins saisonniers, playa inondée | M02/M11/M15 | État temporairement inondé O3/N4 ; émergé selon masque, sel conditionnel | O/F/W |
| **Mare forestière** — Claire, sombre, couverte de feuilles | M11/M09 ; M21 optionnel | Mare et fond O3/O8 ; feuilles mortes O7 ; canopée retirée | O/W |
| **Réseau de lacs** — Thermokarst, glaciaire, tourbeux | Fond qualifié éventuel | Thermokarst/glaciaire/tourbeux O2/O3/O6/O9 ; réseau ≠ matière | O/F/W |
| **Lac à dépôts littoraux** — Plages, bancs, deltas lacustres | M04/M05/M03 | Dépôts lacustres et apports N2/N3 ; delta/plage/banc O9 | C/O/F/W |

### Catalogue 1.10 Marais, tourbières et zones humides

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Marais herbacé** — Dense, clairsemé, inondé | M01/M02/M09/M11 | Herbes retirées ; fond minéral/organique selon N2/O3 ; inondation W | C/O/E/W |
| **Marais à roseaux** — Roselières homogènes ou fragmentées | M01/M11/M09 | Roseaux retirés ; fond et état selon N2/O3, pas selon densité des plantes | C/O/E/W |
| **Marécage boisé** — Arbres dispersés, forêt inondée | M01/M09/M11 | Arbres retirés ; eau conservée ; tourbe seulement si O3 | C/O/E/W |
| **Tourbière bombée** — À sphaignes, à mares | M10/M11 | Tourbe et bombement O3/O9 ; sphaignes retirées ; mares W | O/F/E/W |
| **Tourbière réticulée** — Tourbière à lanières (aapa) | M10/M11 | Tourbe et lanières O3/O9 ; vivant retiré ; bandes non créées par texture | O/F/E/W |
| **Tourbière à buttes** — Buttes de sphaignes, creux humides | M10/M11 | Tourbe et buttes/creux O3/O9 ; sphaignes retirées | O/F/E/W |
| **Prairie humide** — Joncs, graminées, zones engorgées | M01/M02/M09/M11 | Joncs/graminées retirés ; engorgement O3 et état N4 | C/O/E |
| **Marais salé** — Prés salés, salicornes, chenaux | M11/M03 ; M15 conditionnel | Régime salin O4 ; végétation retirée ; chenaux eau W | O/F/E/W |
| **Vasière intérieure** — Boue nue, eau peu profonde | M11/M03/M02 | Matrice fine N2 ; saturation/émersion N3/N4 ; fond sous eau O8 | C/O/W |
| **Plaine saisonnièrement inondée** — Savane inondable, cuvette herbacée | M01/M03/M11 | Inondation saisonnière O3/N4 ; végétation retirée | O/E/W |
| **Marais de papyrus** — Dense, fragmenté, flottant | M09/M11 ; fond | Papyrus et tapis flottants retirés ; tourbe non automatique ; fond O3/O8 | O/E/W |
| **Marais tourbeux tropical** — Tourbière boisée, tourbière ouverte | M10/M11/M09 | Dépôt tourbeux tropical O3 ; bois/végétation retirés | O/E/W |

### Catalogue 1.11 Littoraux sableux, vaseux et sédimentaires

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Plage sableuse** — Blanche, dorée, noire, rouge, grossière | M04 | Stock/provenance N2/O4 ; blanc ou doré selon palette claire, noir via apport basaltique ; O7 si coquillier, O1 si couleur spéciale ; grain N2 | C/O/F |
| **Plage de galets** — Fins, grossiers, mélangés au sable | M05/M04 | Stock grossier, arrondi, tri et énergie N2/O4 | C/O/F |
| **Plage à coquillages** — Débris coquilliers, sable coquillier | M25/M04 | Apport coquillier O7 ; sable coquillier et débris selon N2 | O/F |
| **Haut de plage** — Sable sec, laisses naturelles, végétation pionnière | M04 ; M21 optionnel | Émergence N3/N4 ; laisses O7 ; pionnières vivantes retirées | C/O/F/E |
| **Estran sableux** — Sec, humide, parcouru de chenaux | M04/M11 | Estran et marée O4 ; sec/humide/chenaux via niveau et état | O/F/W |
| **Estran vaseux** — Vases grises, brunes, noires | M11/M03 | Fines disponibles et faible énergie O4 ; marée/niveau N3/N4 | O/F/W |
| **Banc de sable littoral** — Émergé, submergé, mobile | M04 | Banc identifié O9 ; émersion/immersion N3/O4 ; mobilité déclarée | C/O/F/W |
| **Flèche littorale** — Droite, recourbée, multiple | M04/M05 | Apport/transport littoral O4 ; forme droite/recourbée/multiple O9 | O/F |
| **Tombolo** — Simple, double, temporairement submergé | M04/M05 | Connexion littorale existante O9 ; niveau/marée O4 | O/F/W |
| **Île-barrière** — Avec dunes, lagune, marais arrière-littoral | M04/M11 | Île-barrière O9 ; dunes/lagune selon forme, marais selon O3/O4 | O/F/W |
| **Cordon dunaire** — Dune embryonnaire, haute dune, dune fixée | M04 | Sable N2 ; cordon O9 et histoire O2 ; vivant des dunes fixées retiré | O/F/E |
| **Plaines à cordons littoraux** — Crêtes de plage successives | M04/M05 | Cordons hérités O2/O9 ; source et grain N2/O4 | O/F |
| **Dépression interdunaire** — Sèche, humide, marécageuse | M04/M11/M09 | Dépression O9 ; état N4/O3 ; tourbe M10 seulement déclarée | C/O/F |
| **Lagune littorale** — Ouverte, fermée, salée, saumâtre | Fond M04/M11 qualifié | Lagune O9 ; salinité et connexion O4 ; fond O8 | O/F/W |
| **Delta** — Digité, lobé, arqué, estuarien | M04/M05/M03/M11 | Delta O9 ; apport/tri N2/N3 ; régime côtier O4 ; eau séparée | O/F/W |
| **Estuaire** — Vaseux, sableux, à bancs multiples | M04/M03/M11 | Estuaire O9 ; mélange et énergie O4 ; turbidité dans l'eau | O/F/W |
| **Chenaux de marée** — Rectilignes, sinueux, dendritiques | M11/M04 | Chenaux de marée O4/O9 ; fond/berge selon apports et émergence | O/F/W |
| **Sabkha côtière** — Saline, humide, encroûtée | M15/M11/M02 | Salinité et concentration O1/O4 ; croûte seulement selon état | O/F |
| **Littoral de mangrove** — Dense, fragmenté, entrecoupé de chenaux | M11/M04/M09 | Mangrove retirée ; fond selon N2/O3/O4 ; tourbe seulement déclarée | O/F/E/W |

### Catalogue 1.12 Côtes rocheuses, falaises et littoraux découpés

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Côte rocheuse basse** — Dalles, blocs, surfaces fracturées | M07/M06 | Roche accessible N1 ; dalles/fractures O10 ; état de rive N3/N4 | C/O/F |
| **Falaise marine** — Calcaire, grès, granite, volcanique | M07/M06 | Falaise existante O9 ; source lithologique ou unité O1/O5 | C/O/F |
| **Plateforme d'abrasion** — Roche nue, algues, cuvettes | M07 ; fond éventuel | Plateforme O9 ; algues retirées ; cuvettes eau N3/O4 | C/O/F/E/W |
| **Côte à blocs** — Éboulis, chaos rocheux, gros galets | M06/M05 | Stock et source N2 ; arrondi selon remaniement O4 | C/O/F |
| **Côte en fjord** — Étroit, ramifié, glaciaire | M07/M28 ; fond | Fjord et héritage O6/O9 ; eau séparée | O/F/W |
| **Côte à rias** — Vallées fluviales noyées | M07/M03 ; fond | Vallée noyée O2/O9 ; eau actuelle N3/O4 | O/F/W |
| **Côte à calanques** — Calcaire, étroite, profonde | M07/M06 ; fond | Source calcaire et forme O9 ; fond O8 si visible | O/F/W |
| **Côte à skerries** — Îlots rocheux, récifs affleurants | M07 ; fond | Îlots/récifs affleurants O9 ; masque eau N3/O4 | O/F/W |
| **Côte en arches et pitons** — Arches, aiguilles, stacks | M07/M06 | Arches/pitons/stacks existants O9 ; pas de volume créé par la matière | O/F |
| **Côte volcanique** — Basalte noir, coulées, falaises | M07/M17/M18 | Basalte O1 actuel ; coulée/falaise spécifiques O5/O9 | C/O/F |
| **Côte soulevée** — Anciennes plages, terrasses marines | M04/M05/M07 | Soulèvement et plage/terrasse héritée O2/O9 | O/F |
| **Côte polaire rocheuse** — Roches nues, neige, glace littorale | M07/M06 ; M23/M24 optionnels | Roche selon source ; neige/glace selon état O6, pas selon nom polaire seul | C/O/F |
| **Littoral à blocs glaciels** — Blocs échoués, sédiments remaniés par la glace | M06/M28 | Apport par glace/héritage O2/O6 ; blocs et remaniement N2 | O/F |

### Catalogue 1.13 Fonds marins visibles, récifs et surfaces océaniques

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Eau océanique profonde** — Bleu foncé, presque noir | Aucune matière visible imposée | Eau profonde ; fond seulement si O8 conclut réellement à sa visibilité | W |
| **Eau océanique côtière** — Bleue, verte, turbide | Fond qualifié éventuel | Couleur/turbidité d'eau W ; composition de fond O8 indépendante | O/W |
| **Fond sableux immergé** — Blanc, beige, ondulé | M04 | Fond sableux disponible O8 ; couleur de source ; rides selon courant/motif | O/W |
| **Fond rocheux immergé** — Rochers, dalles, blocs | M07/M06 | Fond rocheux et profondeur O8 ; blocs/dalles selon N2/O10 | O/W |
| **Herbiers marins** — Denses, fragmentés, en mosaïque | Support minéral qualifié | Herbiers vivants retirés ; fond O8 inchangé | E/W |
| **Forêt de kelp** — Dense, dispersée, en franges | Support minéral qualifié | Kelp vivant retiré ; fond O8 inchangé | E/W |
| **Récif frangeant** — Continu, discontinu | M25/M07/M04 | Support récifal déclaré O7/O9 ; vivant retiré ; visibilité O8 | O/F/E/W |
| **Barrière corallienne** — Linéaire, percée de passes | M25/M07/M04 | Barrière et passes O7/O9 ; fond O8 ; vivant retiré | O/F/E/W |
| **Atoll** — Anneau simple, complexe, interrompu | M25/M04/M07 | Anneau et lagon O9 ; support biogénique O7 ; eau O8 | O/F/E/W |
| **Récifs coralliens internes** — Patates de corail, récifs en plaques | M25/M07/M04 | Récifs internes et formes O7/O9 ; vivant retiré ; fond O8 | O/F/E/W |
| **Platier récifal** — Corail mort, algues, sable | M25/M04 | Corail mort admissible O7 ; algues vivantes retirées ; platier O9/O8 | O/F/E/W |
| **Récifs à sillons** — Éperons et sillons coralliens | M25/M04/M07 | Support et sillons/éperons O7/O9 ; vivant retiré ; fond O8 | O/F/E/W |
| **Bancs sableux sous-marins** — Mobiles, ondulés, en chenaux | M04 | Stock sableux N2 ; bancs et courant O4/O9 ; fond O8 | O/F/W |
| **Panache sédimentaire** — Fluvial, côtier, glaciaire | Aucune matière de sol nouvelle | Particules en suspension et colonne d'eau ; dépôt ultérieur exige N2/N3 | W |
| **Prolifération planctonique** — Phytoplancton, cyanobactéries | Aucune matière de sol nouvelle | Plancton/cyanobactéries vivants hors vue du sol ; eau conservée | E/W |
| **Sargasses flottantes** — Dispersées, concentrées | Aucune matière de sol nouvelle | Sargasses vivantes/flottantes exclues ; laisses mortes seulement M21/O7 | E/W |
| **Vagues et houle** — Petites vagues, déferlantes, vagues longues | Aucune matière de sol nouvelle | Vagues/houle/écume dans l'eau ; ne sélectionnent pas un fond | W |
| **Tourbillons et fronts marins** — Convergences, fronts de turbidité | Aucune matière de sol nouvelle | Fronts et tourbillons dans l'eau ; fond éventuel indépendant O8 | W |
| **Eau à glace dérivante** — Glaçons, petits floes, brash ice | Aucune matière de sol nouvelle | Glace flottante et floes : état/objets de l'eau O6, hors support terrestre | O/E/W |

### Catalogue 1.14 Couvert végétal naturel

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Forêt feuillue fermée** — Canopée continue, irrégulière, stratifiée | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt feuillue ouverte** — Arbres espacés, sous-bois visible | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt de conifères fermée** — Conifères réguliers, irréguliers | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt de conifères claire** — Mélèzes, pins dispersés | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt tropicale à canopée complexe** — Couronnes multiples, émergents | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt sèche** — Caducifoliée, épineuse | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt riparienne** — Dense, discontinue, en galerie | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt marécageuse** — Dense, trouée, inondée | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Mangrove** — Dense, basse, haute, zonée | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt de palmiers naturelle** — Dense, dispersée, mixte | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Bambouseraie naturelle** — Dense, mixte, en bosquets | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Forêt rabougrie** — Krummholz, arbres tortueux | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Broussailles hautes** — Denses, buissonnantes | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Maquis ou matorral** — Dense, clairsemé, rocheux | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Fourrés épineux** — Acacias, arbustes épineux, buissons secs | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Végétation arbustive basse** — Continue, dispersée | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Arbres isolés** — Solitaires, petits groupes, bouquets | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Formation herbeuse continue** — Haute, courte, dense, sèche | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Formation herbeuse en touffes** — Tussocks, grandes graminées | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Prairie alpine** — Rase, fleurie, rocheuse | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Steppe clairsemée** — Herbes basses, petits buissons | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Végétation désertique ponctuelle** — Buissons isolés, plantes succulentes | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Végétation en bandes** — Tiger bush, broussailles en bandes | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Mosaïque arborée-herbacée** — Arbres dispersés, herbes continues | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Mousses et lichens** — Tapis, plaques, croûtes biologiques | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Landes** — Bruyères, plantes basses et ligneuses | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Végétation aquatique flottante** — Nénuphars, lentilles d'eau, tapis flottants | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |
| **Végétation pionnière** — Lichens, mousses, herbes sur dépôts neufs | Support inchangé et états déclarés | Vivant masqué ; humus conservé si présent ; litière M21 seulement via O7 | E |

### Catalogue 1.15 Neige, glace et paysages périglaciaires

| Type et variantes du catalogue | Recettes de sol ou traitement | Condition particulière et information requise | Statut |
| --- | --- | --- | --- |
| **Neige fraîche** — Continue, poudreuse, peu ventée | M23 | Stock neigeux et état O6 ; poudreuse/ventée selon état, pas altitude seule | O |
| **Neige ancienne** — Transformée, granuleuse, regelée | M23 | Neige et transformation O6 ; grain/regel déclarés | O |
| **Neige soufflée** — Congères, corniches, sastrugi | M23 | Stock, vent et formes O6/O9 ; corniches ne viennent pas d'un albédo | O/F |
| **Neige discontinue** — Sur herbe, forêt, roche | M23 sur support conservé | Couverture neigeuse O6 ; herbe/forêt retirées, roche/sol conservés | O/E |
| **Névé et firn** — Compact, ancien, en accumulation | M23/M24 | Stock ancien et transformation O6 ; accumulation selon forme O9 | O/F |
| **Glacier de vallée** — Propre, strié, chargé de débris | M24 ; M28/M06 en débris | Glacier existant/déclaré O6/O9 ; stries et débris selon origine | O/F |
| **Glacier à crevasses** — Parallèles, transversales, entrecroisées | M24 | Glacier et crevasses O6/O9 ; pas de glacier généré par un réseau de lignes | O/F |
| **Séracs** — Fracturés, en cascades | M24 | Séracs et support de glace O6/O9 ; volumes préexistants | O/F |
| **Glacier couvert de débris** — Dépôts morainiques, blocs, poussière | M28/M06/M01 sur glace | Stock et emprise de débris O2/O6 ; glace sous couverture conservée | O/F |
| **Glacier rocheux** — Actif, fossile, végétalisé | M06/M28/M01 | Langue active/fossile O2/O6/O9 ; vivant retiré, glace éventuelle distincte | O/F/E |
| **Calotte glaciaire** — Uniforme, fissurée, traversée de flux | M23/M24 | Calotte et flux O6/O9 ; neige ou glace selon état de surface | O/F |
| **Glace bleue** — Compacte, exposée, polie | M24 | Glace exposée O6 ; compacte/polie/striée selon O10 | O |
| **Glace lacustre** — Lisse, fissurée, enneigée | M24 sur eau gelée ; M23 si enneigée | Gel et neige déclarés O6 ; couvert neigeux propre ; domaine eau et niveau conservés | O/W |
| **Banquise compacte** — Continue, bosselée | Hors support terrestre | Banquise O6 ; glace/eau et bosses, pas recette de terre | O/F/W |
| **Banquise fragmentée** — Floes, chenaux d'eau libre, crêtes de pression | Hors support terrestre | Floes/chenaux/crêtes de pression O6/O9 ; objets et eau | O/F/E/W |
| **Glace de rive** — Fixe, fissurée, partiellement rompue | M24 au domaine de rive | Glace fixée O6 ; niveau/côte N3/O4 ; état de rupture déclaré | O/F/W |
| **Polynie** — Ouverture d'eau dans la banquise | Aucune matière de sol nouvelle | Ouverture d'eau dans glace O6/O9 ; autorité eau | O/F/W |
| **Icebergs** — Isolés, nombreux, tabulaires | Hors support terrestre | Icebergs O6 ; objets flottants/échoués, non générés dans la carte de sol | O/E/W |
| **Sol polygonal périglaciaire** — Polygones à coins de glace, centrés hauts ou bas | M27 avec M01/M02/M05 | Pergélisol/coins de glace O6 ; polygones hauts/bas O9/O10 | O/F |
| **Sol trié par le gel** — Cercles de pierres, bandes de pierres | M27 avec M05/M06/M01 | Gel-dégel O6 et grains N2 ; cercles/bandes O9/O10 | O/F |
| **Buttes de pergélisol** — Palses, lithalses, pingos | M27/M10/M01 | Pergélisol/nappe et forme O3/O6/O9 ; palses/lithalses/pingos distincts | O/F |
| **Thermokarst** — Affaissements, mares, lacs de dégel | M27/M11 ; fond | Dégradation et affaissements O6/O9 ; mares/eaux séparées | O/F/W |
| **Toundra à microrelief** — Buttes herbeuses, mousses, mares | M01/M09/M10/M27 | Microrelief O6/O9 ; mousses/herbes retirées ; tourbe seulement O3 | O/F/E/W |
| **Solifluxion** — Lobes, terrassettes, coulées lentes | M27/M06/M01 | Gel-dégel/eau et versant O6 ; lobes/terrassettes O9 | O/F |
| **Stries et dépôts glaciaires** — Roches moutonnées, moraines, drumlins | M28/M07 | Héritage et direction glaciaires O2/O6 ; moraines/drumlins O9 | O/F |

## Annexe B Contextes de carte vers compositions de sol

Cette lecture directe reprend les 28 situations de MATERIALS_REVIEW §3. Elle ne transforme pas les noms de paysages en classes de matière.

| Contexte | Recettes candidates ou traitement | Conditions et portée | Statut |
| --- | --- | --- | --- |
| Plaine continentale sèche | M01/M02/M03 ; M04/M05/M06 selon stock | N1/N2/N4 ; humidité localisée ; sel et sable libre non automatiques | C |
| Plaine continentale humide | M01/M02/M09/M11 | N1/N4 ; mares selon N3/O3 ; tourbe seulement déclarée | C/O |
| Plateau rocheux | M07/M06/M01 | N1/N2 ; roche accessible, couverture mince et poches de terre | C |
| Plateau disséqué | M07/M06/M01/M03 | N1/N2 ; stratification et formes si O1/O9/O10 | C/O/F |
| Collines arrondies | M01/M08/M07/M11 | N1/N4 ; affleurements localisés et vallons ; pas de sol uniforme | C |
| Montagne tempérée | M01/M09/M07/M06 ; M23 optionnel | Vivant retiré ; neige O6 ; stock pierreux N2 | C/O |
| Montagne tropicale | M01/M09/M11/M07 | Vivant retiré ; humide selon N4 ; ferrugineux M13 seulement O1/O2 | C/O |
| Haute montagne aride | M07/M06/M01 ; M23 optionnel | N1/N2 ; poussière si disponible ; neige seulement O6 | C/O |
| Haute montagne polaire | M07/M06/M28 ; M23/M24 conditionnels | O6 pour glace/pergélisol ; froid seul insuffisant | C/O |
| Piémont | M05/M04/M03/M06 | Apports N2/N3 ; cônes et ravines O9 ; héritage O2 | C/O/F |
| Vallée fluviale | M05/M04/M03/M02/M11 | Connexion et emprises N3 ; terrasses O2 ; vivant retiré | C/O/F/W |
| Bassin endoréique | M02/M11 ; M15/M04 conditionnels | Stock salin/sableux O1/N2 ; cuvette/niveaux O3/O9 | C/O/F/W |
| Désert sableux | M04 ; M05/M11 en interdunes | Stock sableux N2 ; dunes O9 ; vent et état déclarés | C/O/F |
| Désert rocheux | M07/M06/M26 ; M04 ponctuel | Exposition N1 ; fragments N2 ; pavement O2/O10 | C/O |
| Karst humide | M07.calcaire/M01/M11 | Karst et eau O3/O9 ; végétation retirée ; dissolution O10 | C/O/F |
| Karst tropical | M07.calcaire/M01/M11 | Pitons et dépressions O9 ; couverture réelle, pas calcaire nu partout | C/O/F |
| Plaine côtière sableuse | M04/M05/M11 | N2/O4 ; dunes/lagunes/marais selon O3/O9 ; eau W | C/O/F/W |
| Côte rocheuse tempérée | M07/M06/M05 ; M04 local | N1/N2/O4 ; algues retirées ; petites plages selon apport | C/O/F/E |
| Côte tropicale | M04/M11/M25/M07 | O4/O7/O9 ; vivant retiré ; récifs et mangrove ne dictent pas un sable blanc | O/F/E/W |
| Côte glaciaire | M07/M28/M06 ; M23/M24 | Héritage O2/O6 ; fjord O9 ; neige/glace déclarées | O/F/W |
| Delta fluvial | M04/M05/M03/M11 | Apports N2/N3 ; delta O9 ; eau et vivant séparés | C/O/F/W |
| Estuaire | M04/M03/M11 | O4/O9 ; bancs selon emprise et tri ; turbidité dans eau | O/F/W |
| Archipel rocheux | M07/M06 ; fond qualifié | Îlots et eau O9/N3 ; roche source N1 ; fond O8 | C/O/F/W |
| Archipel corallien | M25/M04/M07 ; fond | Support biogénique O7/O9 ; vivant retiré ; fond O8 | O/F/E/W |
| Zone de volcanisme actif | M17/M18/M19/M20 | Unités et dépôts O5 ; pas d'activité déduite du basalte seul | O/F |
| Plaine arctique | M01/M09/M11/M27 ; M10 conditionnel | Régime froid O6 ; tourbe O3 ; vivant retiré ; lacs W | O/F/E/W |
| Inlandsis | M23/M24 ; M28 aux marges | Glace et formes O6/O9 ; pas d'inlandsis dessiné par texture seule | O/F |
| Mer peu profonde | M04/M07/M11/M25 | Fond O8 ; vivant retiré ; eau conserve visibilité et niveaux | O/E/W |

## Annexe C Motifs compatibles avec les matières

Les 22 motifs de MATERIALS_REVIEW §2 précisent un agencement. Le choix de leur cause appartient aux règles de matière et de scénario.

| Motif et variantes | Recettes candidates ou traitement | Conditions et portée | Statut |
| --- | --- | --- | --- |
| **Homogène** — Lisse, légèrement bruité | M01/M03/M04/M23 | Échelle et variations internes ; eau hors sol ; pas de nouvelle cause | C/O |
| **Granulaire** — Fin, grossier, multiscalaire | M05/M06/M18/M19 | Distribution des grains N2 ; couvert forestier exclu | C/O |
| **Tacheté** — Petites taches, larges taches, amas | M01/M07/M09/M11 | Taches liées à exposition/état/stock ; taches vivantes exclues | C/O |
| **Ponctuel** — Aléatoire, agrégé, répulsif | M06 ; petites dépressions | Blocs selon N2 ; mares selon eau ; arbres/buissons exclus | C/O/F |
| **Rayé** — Parallèle, ondulé, interrompu | M07/M04 | Strates ou rides avec source et direction ; bandes végétales exclues | C/O/F |
| **Nervuré** — Parallèle, divergent, convergent | M07/M24 | Direction et forme compatibles O9/O10 ; yardangs préexistants | O/F |
| **Ondulatoire** — Rides, crêtes, ondes superposées | M04/M23 | Vent/courant, grains/stock et échelle ; vagues restent eau | C/O |
| **Polygonal** — Régulier, irrégulier, hiérarchique | M12/M15/M27/M07 | Cause et échelle séparées : dessiccation/sel/gel/fracture | O |
| **Réticulé** — Mailles fines, larges, irrégulières | M10/M07/M11 | Réseau de lanières/fractures/chenaux O3/O9/O10 | O/F |
| **Dendritique** — Ramifié, fractal, hiérarchique | M01/M03/M11 avec réseau | Écoulement ou incision existants N3/O9 ; pas un matériau en soi | C/O/F |
| **Radial** — Divergent, convergent | M18/M19/M05/M28 | Volcan/cône/glacier identifié O9 ; direction issue de sa forme | O/F |
| **Concentrique** — Anneaux, arcs, couronnes partielles | M04/M05/M03 | Cordons/dépôts et histoire O2/O9 ; anneaux non créés par texture | O/F |
| **Lobé** — Langues, coulées, digitations | M17/M06/M24 | Coulée/glissement/glacier O9 ; matière selon source et état | O/F |
| **En éventail** — Rayonnant, superposé | M05/M04/M03/M06 | Source, transport et forme d'éventail N2/N3/O9 | C/O/F |
| **Rubané** — Continu, sinueux, interrompu | M04/M05/M11 | Bandes suivant réseau/emprises N3 ; forêt-galerie retirée | C/O/F |
| **Cellulaire** — Cellules jointives, séparées | M27 ; support récifal M25 | Cellules par gel ou structure O6/O9 ; canopée exclue | O/F/E |
| **Fracturé** — Rectiligne, angulaire, ramifié | M07/M24/M12 | Fractures et cause O10 ; roche/glace/argile restent distinctes | C/O |
| **Moucheté multiscalaire** — Texture fine sur grandes taches | M01/M07/M09 | Variation de support sur plusieurs échelles ; canopée/steppe retirées | C/O/E |
| **Tressé** — Canaux entrecroisés | M05/M04 | Forme de chenaux O9/N3 ; dépôt entre eaux, pas eau transformée en gravier | C/O/F/W |
| **Directionnel** — Aligné sur pente, vent ou écoulement | M04/M07/M06 | Direction physique de vent/pente/écoulement ; végétation retirée | C/O |
| **Graduel** — Transition progressive, auréoles | M01/M11/M15 | Transitions de stocks/états ; salinité seulement déclarée | C/O |
| **Chaotique** — Éboulis, débris, fractures multiples | M06/M18/M24 | Source et tailles connues ; désordre conditionné, pas bruit libre | C/O |

## Annexe D Phénomènes spéciaux et périmètre du sol

Les 12 familles de MATERIALS_REVIEW §4 sont couvertes par une recette, une condition de scénario ou une exclusion du vivant/de l’eau/des objets.

| Famille et exemples | Recettes candidates ou traitement | Conditions et portée | Statut |
| --- | --- | --- | --- |
| **Sols biologiques** — Croûtes biologiques désertiques, biofilms, tapis microbiens | Support sous vivant ; dépôt minéral éventuel | Biofilms/tapis/croûtes vivants exclus ; minéraux support conservés selon source | E/O |
| **Motifs végétaux spontanés** — Cercles de fées, végétation en bandes, mosaïques de broussailles | Support inchangé | Plantes retirées ; éventuelles différences du support seulement si données propres | E |
| **Formations animales** — Grandes termitières, récifs biogéniques, colonies d'oiseaux et dépôts de guano | M25/M01/M02 | Guano et support biogénique O7 ; termitières/structures O9 ; animaux exclus | O/F/E |
| **Bois mort** — Chablis, accumulations de troncs, embâcles, forêts mortes | M21 pour petits débris | Gros troncs/chablis/embâcles et arbres dressés hors sol ; dépôt mort séparé | O/E |
| **Incendies naturels** — Sol brûlé, canopée carbonisée, cendres, reprise végétale | M22/M01 ; M21 éventuel | Incendie et âge O7 ; canopée carbonisée/reprise vivante exclues | O/E |
| **Érosion récente** — Coulées de boue, cicatrices de glissement, ravines nouvelles | M06/M11/M01 | Événement et emprise O2/O9 ; support/source et état conservés | O/F |
| **Inondations** — Sols submergés, sédiments déposés, débris végétaux | M03/M04/M05/M11 ; M21 éventuel | Eau et événement O3 ; dépôt après crue N2 ; débris morts O7 | O/F/W |
| **Proliférations biologiques** — Algues de surface, tapis flottants, floraisons planctoniques | Support qualifié éventuel | Algues/plancton/tapis flottants vivants exclus ; eau indépendante | E/W |
| **Dépôts organiques côtiers** — Algues échouées, laisses naturelles, accumulations coquillières | M21/M25/M04 | Laisses mortes/coquilles O7 et apport littoral O4 ; vivant exclu | O |
| **Dépôts minéraux exceptionnels** — Soufre, silice, croûtes hydrothermales, oxydes de fer | M20/M13/M15/M16 | Substance et emprise O1/O5 ; pas de taches minérales libres | O |
| **Textures de cratère** — Cratères d'impact, dépôts d'éjectas, anneaux de débris | M06/M07/M01 | Impact, éjectas et anneaux déclarés O2/O9 ; pas de cratère par couleur | O/F |
| **Événements glaciaires** — Vidanges de lacs, épandages proglaciaires, icebergs échoués | M28/M04/M05 ; état eau | Vidange/épandage O2/O6/O9 ; iceberg reste un objet hors sol | O/F/E/W |

## Annexe E Contrôle de couverture

| Partie de MATERIALS_REVIEW | Lignes couvertes | Portée |
| --- | --- | --- |
| 1.1 | 12 | Toutes les variantes de chaque ligne sont reprises |
| 1.2 | 12 | Toutes les variantes de chaque ligne sont reprises |
| 1.3 | 14 | Toutes les variantes de chaque ligne sont reprises |
| 1.4 | 13 | Toutes les variantes de chaque ligne sont reprises |
| 1.5 | 13 | Toutes les variantes de chaque ligne sont reprises |
| 1.6 | 11 | Toutes les variantes de chaque ligne sont reprises |
| 1.7 | 15 | Toutes les variantes de chaque ligne sont reprises |
| 1.8 | 16 | Toutes les variantes de chaque ligne sont reprises |
| 1.9 | 13 | Toutes les variantes de chaque ligne sont reprises |
| 1.10 | 12 | Toutes les variantes de chaque ligne sont reprises |
| 1.11 | 19 | Toutes les variantes de chaque ligne sont reprises |
| 1.12 | 13 | Toutes les variantes de chaque ligne sont reprises |
| 1.13 | 19 | Toutes les variantes de chaque ligne sont reprises |
| 1.14 | 28 | Toutes les variantes de chaque ligne sont reprises |
| 1.15 | 25 | Toutes les variantes de chaque ligne sont reprises |
| Total du §1 | **235** | Types et variantes associés à une matière, une forme, un état ou une exclusion |
| §2 | 22 | Motifs |
| §3 | 28 | Contextes |
| §4 | 12 | Phénomènes spéciaux |

La couverture du catalogue ne signifie pas que toutes ces surfaces sont présentes dans une carte donnée, ni que leurs formes et matériaux sont déjà implémentés. Elle signifie que chaque entrée a une place explicite dans le sélecteur, une condition de production et une réponse lorsque l’information manque.
