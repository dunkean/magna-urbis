# Contrat d’édition urbaine

Ce document définit les commandes et leur portée dans la V2. Le panneau principal doit refléter ce contrat, sans demander de connaître les packs, les identifiants de rôles ou les étapes internes du moteur.

## Hiérarchie et commandes principales

**Ville → quartier → îlot → parcelle → bâtiment.** Un quartier contient plusieurs îlots ; un îlot contient plusieurs parcelles ; une parcelle peut contenir plusieurs bâtiments.

| Sélection | Réglages principaux | Ce qui est reconstruit | Ce qui sert de limite |
|---|---|---|---|
| Ville | Culture, population, densité, croissance, trame des rues | Plan urbain, quartiers, rues, îlots, parcelles et bâtiments | Terrain, implantation régionale et connexions extérieures |
| Quartier | Culture, densité, trame des rues intérieures | Rues intérieures, îlots, parcelles et bâtiments du quartier | Contour du quartier et routes qui le délimitent |
| Îlot | Culture, densité, découpage parcellaire, type des bâtiments | Parcelles et bâtiments de cet îlot | Contour de l’îlot et rues périphériques |
| Parcelle | Culture, type de bâtiment, occupation domestique si pertinente | Programme et bâtiments de la parcelle | Terrain disponible, accès et contour de la parcelle |
| Bâtiment | Culture, type de bâtiment, toit et étages si compatibles | Bâtiment sélectionné pour ses réglages architecturaux | Parcelle, accès et constructions voisines |

**Limite actuelle pour le type depuis un bâtiment :** le programme est porté par la parcelle. Changer son type agit donc sur sa parcelle et ses bâtiments. Le panneau doit l’annoncer, plutôt que prétendre modifier isolément un bâtiment lorsque plusieurs occupent le même terrain. Les réglages de toit, d’étages et de variation restent propres au bâtiment sélectionné.

Un quartier n’est pas un bâtiment agrandi : on peut lui donner une fonction dominante en avancé, mais pas proposer « arène » comme s’il s’agissait d’un type de quartier. Un îlot entier peut accueillir un seul ensemble si son découpage est « îlot entier » ; autrement, son type est appliqué à chacune de ses parcelles.

## Trois actions, sans ambiguïté

- **Régénérer** applique les réglages de la sélection avec la graine actuelle. Même version du moteur, mêmes entrées et même graine : même résultat.
- **Le gros dé** choisit une nouvelle graine locale et régénère la sélection et ses descendants avec les réglages choisis. Il ne signifie jamais « seulement les maisons ».
- **Réglages du parent** retire les modifications locales de ce périmètre et de ses descendants, puis régénère avec les valeurs héritées. Il n’y a qu’une commande de ce type par sélection.

Modifier un contrôle prépare une modification ; le panneau affiche **modifications en attente** jusqu’à la régénération. La commande indique la sélection concernée. Une régénération réussie remplace le résultat en une seule fois. Un refus conserve la carte précédente et explique le blocage.

## Propagation systématique vers le bas

Une modification appliquée à un niveau remplace les éditions des niveaux inférieurs dans **cette sélection seulement**. Les sélections voisines et les niveaux supérieurs conservent leurs réglages.

1. Identifier la sélection et ses descendants à partir des liens du moteur, pas des noms affichés.
2. Conserver les réglages explicites du niveau sélectionné.
3. Retirer les surcharges de ses descendants : cultures, types, modèles imposés et graines propres aux anciens objets.
4. Recalculer depuis le premier produit affecté jusqu’aux bâtiments.
5. Réinstaller le résultat et rétablir la sélection si elle existe encore.

**Changer la culture** signifie changer toute l’identité de la sélection : trame culturelle lorsqu’il existe des rues intérieures, découpage culturel et architecture. Les anciens packs, recettes et cultures architecturales imposés à ce niveau sont retirés ; une trame ou un découpage de l’ancienne culture revient au choix culturel. Un type explicitement demandé, par exemple un temple, est réévalué dans la nouvelle culture et doit être compatible.

Le rendu reste indépendant : textures, détail, palette, affichage 2D/3D, saison et éclairage ne sont pas remis à zéro par une édition urbaine.

## Options compatibles et valeurs affichées

Une liste principale n’est **jamais la liste brute des libellés du catalogue**. La présence du mot « arène » dans un fichier ne prouve ni une source disponible pour la culture, ni la place suffisante sur le terrain sélectionné.

Pour proposer un type, vérifier :

- sa déclaration effective dans le catalogue de génération et la culture concernée ;
- la politique historique et le contexte requis, notamment l’accès navigable ;
- la surface disponible, avec une exigence par parcelle si plusieurs sont modifiées ;
- la validation finale du moteur sur le contour réel, l’accès, le relief et les voisins.

Les contrôles principaux proposent les types déclarés pour la culture et compatibles avec la surface connue. La validation géométrique finale appartient au moteur : une entrée compatible sur le papier peut encore être refusée sur une parcelle étroite ou mal desservie. Le refus doit être expliqué et ne doit pas transformer silencieusement la sélection en terrain vide. Une incompatibilité connue ne doit pas être présentée comme une option normale.

Les contrôles affichent la valeur effective ou un choix automatique explicitement nommé. « Selon la culture » est une règle héritée, pas une donnée manquante. Ne pas inventer une valeur unique lorsque les bâtiments d’une zone ont des valeurs différentes. Les listes et libellés suivent la langue de l’interface ; les identifiants internes restent stables dans les données.

## Répartition de l’interface

Le panneau principal contient uniquement les réglages du tableau, le gros dé, Régénérer, le retour au parent et l’état des modifications. La trame se choisit par icônes, sans liste déroulante identique à côté.

**Avancé** contient les fonctions de quartier, paramètres fins de croissance, graines manuelles, modèles architecturaux, recettes, matériaux, politique historique et diagnostics. Un pack est une bibliothèque de modèles ; une recette est un modèle particulier ; ils ne constituent pas une deuxième culture. Le chargement technique du catalogue n’est pas une action principale.

Aucun tableau de sommets, coordonnées ou outil de modification de contour n’est exposé à ce stade.

Le contour de sélection 2D disparaît à la désactivation de « sélectionner sur la carte » et au passage en 3D. Les contrôles de saison et de lumière restent accessibles en 3D lorsqu’ils pilotent le rendu.

## Partage et vérification

Le code de partage conserve les réglages de chaque périmètre, les types choisis, les graines locales et les choix de rendu et de scène. Il transporte une recette, pas les géométries calculées. La reproduction s’entend avec la même version du moteur.

La validation couvre l’aller-retour du code, l’isolation d’une édition d’îlot, la propagation de culture, la régénération déterministe des rues intérieures, le changement de type compatible, le refus d’un type impossible sans terrain vide et la conservation du rendu complexe texturé.

Le profil elfique privilégie les habitations arboricoles : part cible de 85 %, contre 15 % de maisons ordinaires, avec un tirage reproductible par parcelle.

## Répartition régionale et limites de génération

La population régionale est un budget d’habitants, pas une instruction de multiplier les petits lieux. Les effectifs automatiques sont bornés à la fois par la surface de la carte et par une croissance en racine carrée de la population. Une population importante remplit d’abord les capacités des lieux existants ; si nécessaire, un centre plus grand est ajouté dans les mêmes plafonds. Le plafond culturel habituel guide la composition initiale, mais ne force plus une population imposée à se disperser dans des centaines de camps ou de fermes.

| Classe | Quota de surface : un lieu par tranche de | Maximum automatique par carte |
| --- | ---: | ---: |
| Ville / cité | 200 km² | 32 |
| Bourg | 100 km² | 8 |
| Village | 50 km² | 10 |
| Hameau | 100 km² | 6 |
| Ferme habitée | 150 km² | 4 |
| Site isolé sans habitants | 50 km² | 16 |

Les tranches sont arrondies au supérieur. Le quota de surface est un plafond, pas un objectif : la population, la culture et les terrains disponibles peuvent donner moins de lieux. Les sites isolés suivent également la population en racine carrée ; leur densité ne permet pas de dépasser le plafond automatique.

Exemple déterministe, culture européenne, plaine tempérée, graine `42`, carte de 40 × 40 km et population imposée de 10 000 : un bourg, deux villages, un hameau, une ferme habitée et trois sites isolés. Les 10 000 habitants restent répartis entre les cinq lieux habités. La ferme ne reçoit pas un budget agricole distinct : la surface cultivée reste liée à la population.

Des effectifs explicitement saisis ou une liste manuelle restent des choix de l’utilisateur. « Rétablir la répartition automatique » retire ces effectifs imposés. Si les plafonds de surface, les effectifs imposés ou les populations locales fixées ne permettent pas de loger toute la population demandée, le panneau indique la population effectivement répartie ; le calcul ne contourne pas les plafonds en ajoutant des centaines de petits lieux. Le plafond moteur d’un lieu reste de cinq millions d’habitants.

Les choix et les populations locales restent conservés dans le code MU3 ; les effectifs automatiques sont recalculés de façon déterministe avec la version du générateur. Une nouvelle génération régionale invalide les anciennes répartitions conservées par le moteur.

La construction automatique des petits lieux traite jusqu’à **32 lieux ou 8 000 habitants par lot**, avec une occupation du sol, un renommage et un redessin communs au lot. Les quatre sessions du moteur natif conservent le terrain entre les lots, puis sont libérées à la fin ou à l’arrêt de la passe. Une voie native prend un lieu dont les voisins préalables sont prêts ; les lieux indépendants peuvent avancer pendant qu’un autre attend son voisin. L’installation des résultats garde l’ordre canonique. Le navigateur WASM utilise un seul moteur urbain conservé, pour éviter quatre copies du terrain et quatre pools de travail sur le même thread JavaScript ; le moteur peut paralléliser ses étapes internes.

Les lots automatiques respectent les dépendances de voisinage : les lieux plus grands passent avant leurs petits voisins. Un lieu qui imposerait une ville non sélectionnée, la reconstruction de voisins déjà bâtis ou le dépassement du budget est reporté. Il reste disponible pour une construction explicite dans l’onglet Cités. Les modifications et constructions demandées explicitement gardent leur propagation normale.

Le benchmark reproductible `web/scripts/v2_small_places_bench.mjs` mesure uniquement le calcul urbain et les échanges avec le moteur natif, à géométrie identique. Sur l’essai local de 32 fermes et 142 bâtiments, après chauffe et ordre ABBA, la réutilisation des sessions réduit le temps moyen de 915 à 761 ms (environ 17 %) et les données raster envoyées de 4,46 à 1,12 Mo. Ce chiffre exclut le rendu et l’occupation du sol ; le regroupement de 64 petites fermes en deux lots au lieu de huit réduit aussi le nombre de ces traitements régionaux. Le coût total n’est pas garanti identique à celui d’une grande ville : chaque lieu conserve son implantation et son plan propre.
