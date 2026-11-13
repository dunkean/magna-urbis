# Outreterre

L'Outreterre (*Underdark*) est une couche du monde, pas un relief : tout relief, procédural ou neuronal, peut être creusé en réseau de cavernes. Dans la V2, c'est le contrôle **Couche du monde** (`options.layer`) : *Surface* ou *Outreterre*. Outreterre règle `options.biome = 'underdark'`.

## Génération

Le relief fini (côtes, sculpture et érosion comprises) passe par une étape Rust unique, `magna_urbis_terrain::underdark::carve` (`rust/crates/terrain/src/underdark.rs`), appelée par `TerrainGenerator::carve_underdark`. Le moteur du navigateur l'expose en WASM sous `carve_underdark`, et le service local comme opération `underdark` de `/terrain/relief`. Le bridge (`rust/bridge/terrain.ts`) l'exécute une fois par relief quand `TerrainSettings.underdark` est actif, puis l'hydrologie ordinaire tourne sur la surface creusée.

Le relief est lu comme le sol du monde souterrain. Il n'est pas inversé.

1. **Sol.** Le relief, relevé au-dessus de zéro. Son amplitude est comprimée au-delà de 600 m, ce qui préserve le drainage.
2. **Tunnels.** Le drainage du sol devient les couloirs. Leur rayon croît avec l'aire amont, s'élargit en salles fluviales irrégulières, et il est déformé pour que les diagonales D8 deviennent des méandres.
3. **Cavernes.** Les cuvettes et plaines plus basses que leurs abords, modelées par un bruit large, couvrent environ 20 % de la carte. Quelques piliers de roche s'y dressent.
4. **Galeries.** Les passages à zéro d'un bruit déformé donnent un labyrinthe clairsemé de passages secs.
5. **Nettoyage.** Les petites ouvertures se ferment et les petits grains de roche s'ouvrent. Chaque salle restante rejoint le réseau principal par son passage le moins coûteux (Dijkstra à travers la roche), pour que routes et rivières atteignent chaque salle.
6. **Parois.** La distance signée lissée à la paroi pilote la hauteur de roche. La roche monte continûment depuis le sol de l'ouverture la plus proche, à partir de deux cellules à l'intérieur de la roche, pour que le spline d'affichage ne pose aucune marche sur le sol. L'eau tombée sur la roche se draine vers la galerie la plus proche.
7. **Lacs et envasement.** Certaines cavernes proches d'une grande rivière s'enfoncent en cuvette de 8 à 18 m. Ensuite, chaque bassin fermé de taille moyenne (0,04 % à 2 % de la carte, au moins 4 m de profondeur) reste fermé et devient un lac souterrain ; tous les autres bassins, des petites fosses aux grandes vallées noyées, se comblent de sédiments en sols de caverne plats.

La sortie est la hauteur creusée et un **champ de roche doux** : 128 sur la paroi, ±96 par cellule source, saturé en moins d'une cellule. Interpolé, il trace des parois courbes à toute résolution. Le `caveMask` de région (0/1) reste pour la logique ; le champ physique `cave` (doux) alimente les sols GPU, les polygones de parois et le raster des peuplements (roche = `>= 128`).

## Conséquences

- **Eau.** La chaîne d'eau normale tourne : les rivières coulent dans les tunnels et les lacs remplissent les bassins gardés. Réglage d'eau par défaut de l'Outreterre : `condMode: 'none'`, puisque le creusement a déjà décidé quels bassins restent (les réglages explicites l'emportent).
- **Peuplements et routes.** La roche est de classe 2 au niveau du sol : on ne peut ni y bâtir ni la traverser. Les villes s'installent sur les sols de caverne et les routes suivent les tunnels.
- **Occupation du sol.** Pas de forêt climatique. La couverture naturelle donne des lits de mousse et de champignons (classe 7) et du sol nu (8). Les fermes sont des champignonnières.
- **Cultures.** Choisir Outreterre règle la culture principale sur `drow-enclave`, sauf si elle vaut déjà `duergar-hold` ou `myconid-colony`.
- **Noms.** Les étiquettes de sommets ne sont pas générées, car les masses rocheuses n'ont pas de sommet. Les plus vastes cavernes (maxima locaux de la distance à la roche) reçoivent un nom avec le rôle `terrain.cavern`, si bien que le terme générique suit la langue d'affichage (« Caverne … », "Cavern …").

## Rendu

- **Satellite et 3D** (`rust/bridge/terrainRenderUnderdark.ts`, partagé par le shader de carte 2D, son jumeau WebGPU et le sol 3D) :
  - Le sol de caverne est fait de calcaire, de basalte et de sédiments humides, sous une lumière principale froide.
  - La roche fracturée, presque noire, porte une corniche éclairée à la paroi et une occlusion ambiante sur le sol.
  - Mousses, champignons bioluminescents et bosquets de champignons géants poussent sur le sol, avec stalagmites et éboulis au zoom proche.
  - Des champignonnières entourent chaque ville : parcelles rectangulaires de buttes de compost avec des rangs de chapeaux pâles (`uFarmBeds`, issus de `underdarkFarmBeds`). L'Outreterre ne planifie pas d'exploitations rurales, donc c'est le rendu qui les place ; la roche et l'eau masquent celles qui tombent hors du sol.
  - L'eau est sombre et lumineuse sur ses bords.
  - Il n'y a ni arbres, ni neige, ni saisons, ni écume.
  - Les villes sont éclairées par les lampes de nuit et répandent une lueur chaude de lanternes sur le sol de caverne (`uTownGlow`, 2D et 3D).
  - En 3D, le ciel est le vide noir de la voûte.
- **Styles carte.** La surcouche trace le contour iso exact du champ doux : marching squares à 0,5 sans flou, pour coïncider avec la coupe GPU. La palette Outreterre (`render/biomes.ts`) et les marques fongiques (`render/underdark.ts`) s'appliquent.

## Outils

- `cargo run -p magna-urbis-terrain --example underdark_probe -- <graine> <largeur> <relief> <n> <sortie.ppm>` écrit un aperçu ombré et un recadrage des pentes.
- `node scripts/render_board.mjs --recipe-patch '{"options":{"biome":"underdark","culture":"drow-enclave"},"runtime":{"backend":"native"}}' …` photographie un board. Ajouter `--neural` avec une recette neuronale.
