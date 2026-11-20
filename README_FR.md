<p align="center">
  <img src="docs/logo_magna_urbis.png" alt="Logo de Magna Urbis : un plan de ville dans une boussole" width="220">
</p>

<h1 align="center">Magna Urbis</h1>

<p align="center">
  <b>Régions, villes et cités procédurales pour les cartes et le jeu de rôle sur table.</b><br>
  Relief, rivières, routes, campagnes et 115 cultures urbaines, de la première colline au dernier toit, en 2D et en 3D.
</p>

<p align="center">
  <a href="https://magna-urbis.org/"><b>Ouvrir l'alpha V2</b></a> ·
  <a href="https://magna-urbis.org/scientific/fr.html">Comment ça marche ?</a> ·
  <a href="https://github.com/dunkean/magna-urbis/releases">Téléchargements desktop</a> ·
  <a href="https://github.com/dunkean/magna-urbis/releases/download/desktop-v0.3.10/Magna.Urbis.V2_0.3.10_aarch64.dmg">macOS (Apple Silicon)</a> ·
  <a href="https://magna-urbis.org/gallery/v2/">Galerie</a> ·
  <a href="https://github.com/dunkean/magna-urbis/discussions">Discussions</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="docs/images/readme/italian-comune-satellite.webp" alt="Vue satellite d’une commune italienne entourée de bois et de champs dans une vallée fluviale" width="100%">
</p>

---

## Magna Urbis V2 est en alpha

**Magna Urbis V2 est désormais disponible en alpha**, dans le navigateur et comme application de bureau pour Windows, Linux et macOS sur Apple Silicon. Créez une région, placez ses établissements, faites grandir leurs villes, puis explorez et modifiez le résultat en carte ou en 3D.

- **Web :** [magna-urbis.org](https://magna-urbis.org/). Sans compte ni installation. La génération tourne dans votre navigateur (Rust compilé en WebAssembly, avec WebGPU quand il est disponible).
- **Bureau.** Les versions Windows x64 (installateur ou ZIP portable) et Linux x64 (AppImage ou DEB) sont disponibles sur [GitHub](https://github.com/dunkean/magna-urbis/releases). Le moteur Rust et le relief neuronal natif sont inclus. Aucune installation de Rust, Node.js ou Python n’est nécessaire.
- **macOS sur Apple Silicon.** L’aperçu expérimental est disponible au format DMG dès l’alpha 0.3.10. Le DMG est signé ad hoc et distribué sans notarisation Apple. La validation de l’inférence GPU sur un Mac physique reste à faire. [Télécharger le DMG](https://github.com/dunkean/magna-urbis/releases/download/desktop-v0.3.10/Magna.Urbis.V2_0.3.10_aarch64.dmg)
- **V1 :** la première version reste en ligne sur [v1.magna-urbis.org](https://v1.magna-urbis.org/).

C'est une alpha. Les résultats, les réglages et les projets enregistrés peuvent encore changer d'une version à l'autre. Si quelque chose casse, un signalement avec le code de partage aide beaucoup.

### Ce que contient l'alpha V2

- **Une seule chaîne, du relief au toit :** relief procédural, neuronal ou importé, rivières et lacs, climat et occupation du sol, établissements, routes, villes et bâtiments, en 2D et en 3D.
- **Des régions crédibles :** établissements placés selon l'accès à l'eau, la place disponible et la culture ; une population régionale qui garde habitées même les cartes alpines, arctiques, désertiques et de l'Underdark ; des villages avec environ un logement par foyer ; des ports avec quais, pontons et grues ; des champs qui suivent les fermes, les rivières et les routes.
- **Des villes posées sur leur terrain :** sol, bâtiments, routes, ponts, quais, remparts et douves reposent sur le relief dessiné en 3D, avec un même trait de côte pour la carte 2D et la vue 3D.
- **115 cultures**, villages et campements, de l'Europe médiévale aux forteresses naines, aux enclaves drows et aux villes myconides de l'Underdark, à mélanger dans des feuilles de style hybrides.
- **Édition à tous les niveaux :** ville, quartier, îlot, parcelle et bâtiment, avec un outil de fusion de parcelles, des toponymes modifiables et le renommage des établissements.
- **Styles de carte** (parchemin, atlas, topographique, cadastre, satellite, satellite peint, minimal), de jour et de nuit, au fil des saisons, avec neige et banquise en hiver.
- **Relief neuronal** dans le navigateur sur WebGPU et en natif dans l'application de bureau, avec des téléchargements de modèles vérifiés et réutilisés hors ligne.
- **Projets et exports :** projets binaires `.muproj`, codes de partage, recettes, PNG, SVG et cartes d'élévation.

Les changements de chaque version desktop sont listés dans les [notes de version](docs/DESKTOP_RELEASE_NOTES.md) (en anglais).

## Ce que Magna Urbis génère

Une seule chaîne, du sol vers le haut. Chaque étape peut être relancée, réglée ou modifiée séparément.

1. **Relief** : terrain procédural avec érosion, zones peintes (plaines, collines, montagnes), volcans et caldeiras, ou **relief neuronal** issu de Terrain Diffusion. Vous pouvez aussi importer une carte d'élévation.
2. **Eau et climat** : drainage, rivières, lacs issus d'un bilan hydrique climatique, embouchures et côtes, puis végétation et occupation du sol pilotées par le climat. Une couche **Underdark** facultative creuse cavernes, tunnels et lacs dans n'importe quel relief.
3. **Établissements et routes** : choix des sites, hiérarchie rang-taille, un réseau routier régional unique, fermes, hameaux, chapelles, auberges, bacs et lieux isolés sur des sommets, des îlots ou des corniches.
4. **Villes et cités** : composition et phases de croissance, quartiers et rues, remparts, portes et châteaux, ponts, parcelles, un programme qui décide qui habite et travaille où, puis des volumes bâtis avec étages et toitures composées. Les villes voisines partagent leurs limites. Le moteur va du bâtiment isolé à la métropole d'un million d'habitants.
5. **Cartes** : styles parchemin, atlas, topographique, cadastre, satellite et satellite peint, de jour ou de nuit, au fil des saisons, avec les noms et étiquettes comme couche à part entière. Survol en orbite, à pied ou en vol libre en 3D.
6. **Édition et export** : changez les styles par quartier, parcelle ou bâtiment, relancez une portée, modifiez routes, rivières et étiquettes. Exportez en PNG, SVG, carte d'élévation, projet et recette. Avec le module local facultatif, transformez une vue en illustration ou en battlemap.

**115 cultures :** 79 traditions historiques, fantastiques et de campements (Europe médiévale, bastides, médinas, plans chinois et japonais, Maya, Inca, swahili, nains, elfes, drows et bien d'autres), 27 modernes, 8 futuristes et 1 extraterrestre. Vous pouvez les mélanger dans des feuilles de style hybrides. Parcourez-les toutes dans le [catalogue des styles architecturaux](https://magna-urbis.org/scientific/catalogue-architecture-fr.html).

## Galerie

Toutes les images ci-dessous sont des captures V2 sans retouche.

### Vues satellite

<table>
  <tr>
    <td width="50%"><img src="docs/images/readme/desert-medina-satellite.webp" alt="Médina dans le désert entre des crêtes rocheuses et un méandre bordé de champs irrigués"><br><sub>Médina et vallée désertique</sub></td>
    <td width="50%"><img src="docs/images/readme/riverside-quarter-satellite.webp" alt="Vue de dessus d’un quartier au bord de l’eau avec des toits de tuiles, des rues et un pont"><br><sub>Quartier au bord de l’eau, en détail</sub></td>
  </tr>
</table>

### Villes

<table>
  <tr>
    <td width="50%"><img src="docs/images/readme/venetian-lagoon-3d.webp" alt="Ville lagunaire vénitienne sur les deux rives d'une rivière, avec canaux et toits rouges"><br><sub>Ville lagunaire vénitienne, 10 000 habitants</sub></td>
    <td width="50%"><img src="docs/images/readme/dwarven-3d.webp" alt="Ville naine dans une enceinte de pierre anguleuse, coupée par une rivière"><br><sub>Forteresse naine derrière son rempart anguleux</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/chinese-3d.webp" alt="Ville chinoise rectangulaire et fortifiée sur une grille orthogonale, traversée de canaux"><br><sub>Ville chinoise planifiée, plan rectangulaire</sub></td>
    <td><img src="docs/images/readme/bastide-3d.webp" alt="Bastide médiévale dense aux toits rouges dans une enceinte polygonale"><br><sub>Bastide, plan polygonal</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/wizard-city-night-3d.webp" alt="Cité des mages de nuit, rues éclairées et hautes tours"><br><sub>Cité des mages, de nuit</sub></td>
    <td><img src="docs/images/readme/tibetan-monastery-3d.webp" alt="Ville monastique tibétaine aux bâtiments blancs dans la neige"><br><sub>Ville monastique tibétaine en hiver</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/persian-3d.webp" alt="Ville perse ronde dans une enceinte circulaire, traversée par une rivière"><br><sub>Ville ronde perse</sub></td>
    <td><img src="docs/images/readme/drow-enclave-3d.webp" alt="Enclave drow aux bâtiments pâles sur une roche sombre"><br><sub>Enclave drow</sub></td>
  </tr>
</table>

### Villages, campements et campagne

<table>
  <tr>
    <td width="25%"><img src="docs/images/readme/village-norse-ringfort-3d.webp" alt="Village fortifié nordique avec maisons longues dans une palissade"><br><sub>Fort circulaire nordique</sub></td>
    <td width="25%"><img src="docs/images/readme/camp-mongol-ordu-3d.webp" alt="Campement mongol de yourtes blanches dans la steppe"><br><sub>Ordu mongol</sub></td>
    <td width="25%"><img src="docs/images/readme/village-venetian-lagoon-3d.webp" alt="Village lagunaire vénitien aux toits rouges le long d'un canal"><br><sub>Village lagunaire</sub></td>
    <td width="25%"><img src="docs/images/readme/village-elven-3d.webp" alt="Village elfe caché sous une canopée forestière dense"><br><sub>Village elfe</sub></td>
  </tr>
</table>

### Styles de carte

<table>
  <tr>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-parchment.webp" alt="Ville en style parchemin"><br><sub>Parchemin</sub></td>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-topographic.webp" alt="Ville en style topographique avec courbes de niveau"><br><sub>Topographique</sub></td>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-cadastre.webp" alt="Ville en style cadastre"><br><sub>Cadastre</sub></td>
    <td width="25%"><img src="docs/scientific/assets/atlas/style-satellite.webp" alt="Ville en style satellite"><br><sub>Satellite</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/readme/metropolis-150k-topographic.webp" alt="Métropole européenne dense sur une rivière, style topographique"><br><sub>Métropole de 150 000 habitants</sub></td>
    <td><img src="docs/images/readme/medina-150k-atlas.webp" alt="Quartiers de médina le long d'une rivière, style atlas"><br><sub>Hybride perse et médina, atlas</sub></td>
    <td><img src="docs/scientific/assets/atlas/style-night.webp" alt="Ville de nuit aux rues éclairées le long d'une rivière"><br><sub>Nuit</sub></td>
    <td><img src="docs/scientific/assets/atlas/underdark.webp" alt="Carte de l'Underdark : cavernes, tunnels et lacs souterrains"><br><sub>Underdark</sub></td>
  </tr>
</table>

Beaucoup d'autres dans la [galerie V2](https://magna-urbis.org/gallery/v2/).

## Comment ça marche

- **[Comment ça marche ? L'atlas illustré](https://magna-urbis.org/scientific/fr.html)** ([English](https://magna-urbis.org/scientific/index.html)) : suit un monde depuis le champ de hauteur jusqu'au dernier toit, étape par étape, avec schémas et sources. Chaque bouton **?** de l'application ouvre le chapitre correspondant.
- **[Catalogue des styles architecturaux](https://magna-urbis.org/scientific/catalogue-architecture-fr.html)** ([English](https://magna-urbis.org/scientific/catalogue-architecture.html)) : les 115 cultures en 2D et en 3D.
- [Vue d'ensemble technique et scientifique](docs/TECHNICAL_AND_SCIENTIFIC_OVERVIEW.md) (en anglais) : couches du système, érosion, hydrologie, terrain neuronal, établissements, références.
- [Notes de méthode](docs/methods/README.md) (en anglais) : une note courte par technique implémentée, avec ses sources et ses limites.
- [Index de la documentation](docs/README.md) (en anglais) : rendu, recettes, cultures, conceptions et études.

Sous le capot : un moteur **Rust** (terrain, eau, établissements, villes, bâtiments) compilé deux fois, en **WebAssembly** pour le navigateur et en service local **natif** pour l'application de bureau. L'interface et les moteurs de rendu sont en **TypeScript**, avec **WebGL2** et **WebGPU**. Le relief neuronal tourne aussi en Rust, avec [Burn](https://burn.dev/) sur le desktop et un petit moteur WGSL dédié dans le navigateur.

## Inspiré par Watabou

Magna Urbis s'inspire de **[Watabou (Oleg Dolya)](https://watabou.itch.io/)** et de son [Medieval Fantasy City Generator](https://watabou.itch.io/medieval-fantasy-city-generator) ([TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)). Le projet a commencé comme un portage Python de TownGeneratorOS. Ce prototype a disparu depuis longtemps, mais les générateurs de Watabou restent la référence de ce qu'une ville générée doit donner : lisible, variée et agréable à lire. Merci.

## Projets liés

Magna Urbis fait partie d'une petite famille d'outils de création de mondes.

### Neural Earth

**[Neural Earth](https://github.com/dunkean/neural-earth)** génère des planètes procédurales entières, des plaques tectoniques jusqu'au terrain local. Il combine la géographie planétaire de [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation) avec le raffinement appris de [Terrain Diffusion](https://arxiv.org/abs/2512.08309) (Goslin), et ajoute climat, hydrologie, biomes, sols et rendu saisonnier, avec des chemins Python/CUDA ou Rust/WASM/WebGPU dans le navigateur.

Le relief neuronal de Magna Urbis vient de ce travail : le portage Rust de la chaîne Terrain Diffusion et les modèles distillés et quantifiés publiés sur [Hugging Face](https://huggingface.co/dunkean/neural-earth-distilled). L'objectif à long terme est de placer les villes et les routes de Magna Urbis dans les mondes de Neural Earth. Cette intégration n'est pas encore livrée.

### Autres projets

- **[Namebench](https://github.com/dunkean/namebench)** : un bac à sable pour les noms de personnes et les noms de lieux. Magna Urbis en embarque un extrait (environ 550 000 toponymes et 51 générateurs de noms, reliés à ses cultures) pour nommer établissements, rivières, lacs, reliefs et régions.
- **[Lineage Lab](https://github.com/dunkean/lineage-lab)** : un bac à sable pour les histoires de populations et les généalogies.
- **[Chronos](https://github.com/dunkean/chronos)** : un générateur d'histoire déterministe en Rust et un atelier de chronologie pour mondes procéduraux.
- **[AI RPG Generator](https://github.com/dunkean/AI_RPG_Generator)** : une expérience plus ancienne de génération de contenu de jeu de rôle avec des modèles de langage et la diffusion latente.

## Lancer depuis les sources

Prérequis : Node.js LTS et npm, Rust via rustup (la toolchain est fixée dans `rust/rust-toolchain.toml`) et `wasm-pack`. Sous Windows, installez aussi les outils de compilation C++ de Visual Studio.

```sh
cd web
npm ci
npm run prepare:v2   # compile les paquets WebAssembly Rust du terrain et des maisons
npm run dev:v2       # ouvrir http://127.0.0.1:5174/v2.html
```

Autres commandes, depuis `web/` :

```sh
npm run build:v2       # site statique dans web/dist-v2
npm run app:v2:dev     # application de bureau en développement
npm run app:v2:build   # application de bureau et installateur pour cet OS
npm run test:v2        # tests V2
```

Le [guide de lancement et de packaging V2](rust/desktop-v2/README.md) couvre le moteur natif, le relief neuronal du navigateur et les modules Python facultatifs. Le [README Rust](rust/README.md) décrit les crates du moteur. Les versions suivent le [guide de release desktop](docs/DESKTOP_RELEASE.md) ; la version web suit le [guide de publication web](docs/WEB_PUBLICATION_FR.md).

```text
rust/crates/terrain/   relief, érosion, hydrologie, Underdark
rust/crates/core/      établissements, routes, villes et bâtiments (réexporte terrain)
rust/crates/local/     service moteur local natif
rust/crates/neural*/   relief neuronal : inférence native et navigateur
rust/desktop-v2/       application de bureau Tauri
web/src/v2/            application V2
web/src/render/        moteurs de rendu 2D/3D partagés
docs/                  documentation, notes de méthode et atlas illustré
```

## Contribuer et donner son avis

Idées, questions et cartes générées sont les bienvenues dans les [Discussions](https://github.com/dunkean/magna-urbis/discussions). Pour un bug, ouvrez une [issue](https://github.com/dunkean/magna-urbis/issues) avec la version, le code de partage ou la recette, et une capture si possible. Lisez le [guide de contribution](CONTRIBUTING.md) (en anglais) avant une pull request.

Magna Urbis est en grande partie écrit par des agents de code IA (Claude et Codex), sous la direction d'un architecte et relecteur humain. Les [devlogs Ko-fi](docs/devlog/kofi-devlogs_FR.md) racontent comment il est construit, ce qui a cassé et ce qui a marché.

## Licence et crédits

Magna Urbis est un logiciel libre sous **GNU Affero General Public License v3 uniquement** (`AGPL-3.0-only`) ; voir [LICENSE](LICENSE). L'usage commercial est autorisé. Si vous exploitez une version modifiée comme service réseau, vous devez en proposer le code source à ses utilisateurs (section 13).

Le code, les données, les textures et les poids de modèles tiers conservent leurs propres conditions : voir les [mentions tierces](THIRD_PARTY_NOTICES.md), l'[inventaire verrouillé des dépendances](licenses/dependency-inventory.json) et les [textes de licence conservés](licenses/DEPENDENCY_LICENSES.txt). Les modèles de relief neuronal dérivent de [Terrain Diffusion](https://huggingface.co/xandergos/terrain-diffusion-30m) (MIT). Merci à Watabou, à Alexander Goslin et à tous les auteurs des articles, jeux de données et bibliothèques sur lesquels ce projet s'appuie.

## Liens

- **Magna Urbis V2 :** [magna-urbis.org](https://magna-urbis.org/)
- **Magna Urbis V1 :** [v1.magna-urbis.org](https://v1.magna-urbis.org/) ([sources](https://github.com/dunkean/magna-urbis-v1))
- **Comment ça marche ?** [magna-urbis.org/scientific](https://magna-urbis.org/scientific/fr.html)
- **Soutenir le projet sur Ko-fi :** [ko-fi.com/dunkean](https://ko-fi.com/dunkean). Le code reste gratuit, sans offre premium ; les dons aident à payer les agents IA qui le construisent.
