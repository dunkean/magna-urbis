# État de l'art — Génération procédurale de textures à très haute résolution

Revue technique et scientifique · 23 octobre 2026 · Neural Earth / Magna Urbis

[English translation](RENDER_REVIEW.md)

## 1. Synthèse : ce qui existe et ce qui est pertinent

Pour Neural Earth et Magna Urbis, l'objectif est assez particulier : produire des détails de surface réalistes à des échelles de 10 cm à 1 cm, sur des territoires potentiellement immenses, en restant capable de zoomer librement, sans rupture ni répétition visible.

La bonne nouvelle est qu'il existe de nombreuses solutions open source. Elles ne résolvent toutefois pas toutes le même problème.

On peut distinguer cinq familles :

1. Shaders mathématiques purs : bruit procédural, Voronoï, domain warping, fonctions de distance. Évaluation directe en coordonnées mondiales, sans texture précalculée.
2. Synthèse de textures par exemples : création d'une surface infinie à partir d'une petite texture de référence, sans répétition évidente.
3. Génération structurée et contextuelle : cailloux, fissures, galets, herbes, pavés, dépôts de sable, etc., positionnés en fonction de règles physiques ou spatiales.
4. Générateurs de matériaux PBR : production de couleurs, reliefs, normales, rugosité et autres propriétés de surface à partir de graphes procéduraux.
5. Méthodes neuronales et diffusion : apprentissage de la distribution visuelle d'un matériau, génération de variantes, éventuellement conditionnées par l'environnement.

Pour tes projets, je privilégierais une architecture hybride où le shader fait l'essentiel du travail en temps réel et où les modèles génératifs servent surtout à créer les matériaux, les variantes et les détails structurés.

Le point important : à l'échelle centimétrique, ajouter des octaves de bruit n'est généralement plus suffisant pour produire un rendu convaincant. Il faut commencer à représenter des objets reconnaissables — grains, pierres, débris, touffes végétales, fissures et joints — ainsi que leur organisation spatiale.

## 2. Les grandes approches, comparées

| Approche                           | Réalisme potentiel        | Temps réel GPU               | Zoom déterministe | Intérêt                |
| ---------------------------------- | ------------------------- | ---------------------------- | ----------------- | ---------------------- |
| Noise / fBm / Voronoï / warping    | Moyen à bon               | Excellent                    | Excellent         | Base indispensable     |
| Textures stochastiques par tuilage | Très bon                  | Très bon                     | Excellent         | Prioritaire            |
| Wang tiles / synthèse par patches  | Très bon                  | Très bon                     | Excellent         | Prioritaire            |
| Scatter de primitives / SDF        | Très bon                  | Bon à excellent              | Excellent         | Prioritaire à 1–10 cm  |
| Matériaux procéduraux PBR          | Très bon                  | Bon, selon complexité        | Excellent         | Création des matériaux |
| Diffusion de textures              | Très bon à excellent      | Faible en génération directe | Difficile         | Production hors ligne  |
| Réseaux neuronaux de textures      | Potentiellement excellent | Variable                     | À concevoir       | R&D à explorer         |

Il existe d'ailleurs une bonne synthèse académique des approches classiques : Survey of Procedural Methods for Two-Dimensional Texture Generation (2020). Elle couvre les textures structurées et non structurées, ainsi que leur combinaison.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://pmc.ncbi.nlm.nih.gov\&sz=32)

PMC



Pour ton besoin, je regarderais d'abord deux techniques qui reçoivent parfois moins d'attention que les modèles génératifs récents : le stochastic tiling et les Wang tiles.

Ces méthodes permettent de générer de très grandes surfaces avec une diversité visuelle élevée, tout en conservant une évaluation rapide et reproductible.

## 3. Méthodes classiques à étudier en priorité

### 3.1. Stochastic texturing : du photoréalisme sans répétition

Priorité très élevée · 2D et 3D · Compatible shader temps réel

La famille la plus directement applicable est celle des travaux d'Eric Heitz et Fabrice Neyret.

Publications fondamentales :

- Heitz & Neyret, High-Performance By-Example Noise Using a Histogram-Preserving Blending Operator, HPG 2018.
- Deliot & Heitz, Procedural Stochastic Textures by Tiling and Blending, GPU Zen 2.
- Mikkelsen, Practical Real-Time Hex-Tiling, JCGT 2022.&#x20;

  [image](https://www.google.com/s2/favicons?domain=https://eheitzresearch.wordpress.com\&sz=32)

  eheitzresearch.wordpress.com

  +1



Le problème : une texture de roche de 512 × 512 pixels, répétée sur une montagne, devient vite reconnaissable.

La solution consiste à utiliser une grille triangulaire ou hexagonale pour échantillonner la texture avec des transformations pseudo-aléatoires et mélanger les échantillons aux frontières.

Le procédé :

- Ne nécessite pas de générer une nouvelle image géante.
- Peut évaluer directement le matériau en fonction des coordonnées mondiales.
- Produit une immense variété de surfaces à partir de quelques échantillons.
- Préserve plus ou moins bien les statistiques du matériau selon la méthode.

La méthode Heitz utilise notamment une transformation d'histogramme pour éviter que le mélange ne diminue les contrastes. Mikkelsen propose une version simplifiée, plus facile à intégrer et particulièrement intéressante pour les normal maps.

[Unity Labs | Unity](https://images.openai.com/static-rsc-4/WFBZXpTSm5XHwPy-V3LOErnvArB4P_QanNE2RYA3v1hzFIBFD7PFdILZiCf5Uvqt251kRSQVbdRX7iJQv-0Rlq3GyY26xiCMlGykU1eHhyaBgCevWZ-H3fWRS8gz6JRWf73M-w3NcBpm2SMHzl52h0a1TYVyOAj4sEpCcIvrE-o?purpose=inline)

Code directement exploitable

[mmikk/hextile-demo](https://github.com/mmikk/hextile-demo?utm_source=chatgpt.com) — MIT, implémentation associée à Mikkelsen, avec une variante qui maintient la précision loin de l'origine.

[UnityLabs/procedural-stochastic-texturing](https://github.com/UnityLabs/procedural-stochastic-texturing?utm_source=chatgpt.com) — exemple complet Heitz/Deliot, archivé depuis 2025 mais toujours exploitable comme référence.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Limite importante : cette approche marche très bien pour la terre, le sable, les roches granuleuses ou le gravier fin. Elle est moins adaptée aux motifs fortement structurés : gros pavés, fissures longues, sillons agricoles. Le mélange peut casser leur géométrie.

### 3.2. Wang tiles : les matériaux structurés sur des surfaces infinies

Priorité très élevée pour sols, pavés, murs et chemins

La référence est Cohen et al., Wang Tiles for Image and Texture Generation, SIGGRAPH 2003.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://graphics.uni-konstanz.de\&sz=32)

graphics.uni-konstanz.de



L'idée est de constituer un petit atlas de tuiles dont les côtés portent des contraintes de raccord. Les tuiles sont assemblées selon ces contraintes, produisant une grande surface non périodique sans joint visible.

C'est particulièrement intéressant pour Magna Urbis :

| Matériau      | Usage des Wang tiles                               |
| ------------- | -------------------------------------------------- |
| Rue pavée     | Variation dans le placement et l'usure des pierres |
| Sol rocheux   | Assemblage de plaques fissurées                    |
| Sol forestier | Distribution de feuilles, mousse, pierres          |
| Champs        | Petits motifs cohérents et répétition contrôlée    |
| Toitures      | Variations de tuiles ou bardeaux                   |
| Sol antique   | Mosaïques et pavages irréguliers                   |

Le choix d'une tuile peut être déterministe à partir des cellules mondiales et d'une graine, sans sauvegarder la carte générée. Pour une génération à la demande et dans un ordre arbitraire, il faut toutefois construire un schéma de sélection compatible avec les contraintes de voisinage.

L'autre référence intéressante est Order-Independent Texture Synthesis de Wei & Levoy (2003), qui aborde explicitement la génération de texels dans un ordre quelconque grâce à une représentation pyramidale et un cache. C'est très proche du problème d'exploration par zoom.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://graphics.stanford.edu\&sz=32)

graphics.stanford.edu



### 3.3. Bruits plus sophistiqués que Perlin et fBm

Il existe des algorithmes mieux adaptés à certaines structures matérielles que le bruit fractal classique.

| Technique          | Particularité                        | Applications                          |
| ------------------ | ------------------------------------ | ------------------------------------- |
| Worley / Cellular  | Distances à des sites                | Galets, pierres, cellules de boue     |
| Domain warping     | Distorsion spatiale de motifs        | Roche, marbre, sols organiques        |
| Gabor noise        | Contrôle fréquentiel et directionnel | Stries, sable, anisotropie            |
| Wavelet noise      | Contrôle des fréquences              | Microrelief, détails filtrables       |
| Reaction–diffusion | Structures biologiques émergentes    | Mousses, lichens, motifs de dépôts    |
| Sparse textons     | Primitives distribuées dans l'espace | Cailloux, feuilles, grains, débris    |
| SDF                | Distances signées aux formes         | Fissures, joints, contours de pierres |

Le Gabor noise mérite une attention particulière. Lagae et al. (SIGGRAPH 2009) proposent un bruit procédural à convolution parcimonieuse avec contrôle spectral. Cette représentation est intéressante pour les matériaux dont les motifs ont une orientation dominante, comme des stratifications rocheuses ou des rides éoliennes.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://graphics.cs.kuleuven.be\&sz=32)

graphics.cs.kuleuven.be



Pour le noise mathématique, les deux bases pratiques sont [FastNoiseLite](https://github.com/Auburn/FastNoiseLite?utm_source=chatgpt.com) (MIT, Rust, JS, GLSL, HLSL, etc.) et [procedural-tileable-shaders](https://github.com/tuxalin/procedural-tileable-shaders?utm_source=chatgpt.com) (MIT, GLSL, avec warping et bruit cellulaire).&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



### 3.4. Texture bombing et textons : la couche des objets centimétriques

C'est probablement ce qui manque le plus à un rendu exclusivement fondé sur des bandes de bruit.

Plutôt que de simuler visuellement des pierres avec une fonction continue, on place des pierres explicitement :

\\[ P_i = f(\operatorname{hash}(\text{cellule}\_i,\text{seed})) \\]

Chaque objet possède une position, une orientation, une taille, une forme et éventuellement un matériau.

Le shader n'évalue que les objets présents dans le voisinage du pixel. On peut associer des sprites, des fonctions de distance ou des reliefs analytiques à ces objets.

Cela permet de produire de véritables distributions de :

- Cailloux de 1 à 10 cm dans un sol.
- Feuilles et brindilles sur la terre.
- Touffes d'herbe et plantes basses.
- Galets disposés par l'eau.
- Débris et gravats autour des habitations.

Pour éviter un aspect trop aléatoire, on utilise des distributions spatiales dépendant du contexte : Poisson disk / blue noise, agrégations, distributions conditionnées par la pente, les écoulements ou les chemins.

On est alors davantage dans la génération procédurale d'une scène microscopique en 2D que dans la texturation traditionnelle. Pour ton usage, cette distinction est fondamentale.

## 4. Projets open source concrets

Voici les outils que je retiendrais, avec leur valeur réelle pour tes projets.

| Projet                                                                                            | Technologie          | Intérêt                                |
| ------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------- |
| [Material Maker](https://github.com/RodZill4/material-maker?utm_source=chatgpt.com)               | Godot, GLSL, graphes | Excellent pour fabriquer des matériaux |
| [Hex-Tile Demo](https://github.com/mmikk/hextile-demo?utm_source=chatgpt.com)                     | C++ / shaders        | Excellent pour casser le tuilage       |
| [FastNoiseLite](https://github.com/Auburn/FastNoiseLite?utm_source=chatgpt.com)                   | Multilangage         | Base de bruit reproductible            |
| [Tileable Shaders](https://github.com/tuxalin/procedural-tileable-shaders?utm_source=chatgpt.com) | GLSL                 | Primitives de shaders                  |
| [TextureLab](https://github.com/njbrown/texturelab?utm_source=chatgpt.com)                        | Electron, GPU        | Éditeur de textures tuilables          |
| [VFX Texture Lab](https://github.com/MattyGWS/VFXTextureLab?utm_source=chatgpt.com)               | WGSL, GPU            | Graphes et matériaux expérimentaux     |
| [DiffMat](https://github.com/mit-gfx/diffmat?utm_source=chatgpt.com)                              | PyTorch              | Optimisation de graphes de matériaux   |
| [MatFuse](https://github.com/giuvecchio/matfuse?utm_source=chatgpt.com)                           | PyTorch, diffusion   | Génération neuronale de PBR            |
| [MatLat](https://github.com/KAIST-Visual-AI-Group/MatLat?utm_source=chatgpt.com)                  | PyTorch, diffusion   | Recherche récente sur les latents PBR  |
| [Water Shader](https://github.com/tuxalin/water-shader?utm_source=chatgpt.com)                    | HLSL                 | Référence pour une eau procédurale     |
| [Unity Voronoi Water](https://github.com/cbunt/unity-voronoi-water?utm_source=chatgpt.com)        | Shader Graph         | Eau stylisée et flow maps              |

Les derniers projets neuronaux seront discutés dans la section suivante.

### Zoom sur Material Maker

[Material Maker – Godot Engine](https://images.openai.com/static-rsc-4/xdzphVfRdnHd4Dsx0sIy-rsKwRRN1UT5rd5lby6_0tpiUJTqvzbEL4tn73Eq2DqkAPXicFbbugfMSIqvN7hTC2U24R109mubarYHUHSRudexIb56TalXy4OvqkSbr0ZJmTJi6GTRq9xrO2EWqjiTIDk36r8rMIGqoGTg2fWX6rg?purpose=inline)

&#x20;Material Maker&#x20;

C'est probablement le meilleur point de départ pratique.

L'application fournit plus de 200 nœuds, des matériaux PBR, une bibliothèque communautaire et la possibilité de créer des nœuds en GLSL. Son dépôt est sous licence MIT.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://materialmaker.org\&sz=32)

materialmaker.org

+1



Tu peux concevoir une texture de terre, roche ou pierre, puis exporter les différentes cartes et les utiliser dans un moteur 2D WebGPU.

Ce que j'apprécie ici, c'est la séparation entre création d'un matériau et application de ce matériau à un monde procédural. Tu peux disposer d'une bibliothèque de matériaux travaillés et conserver un moteur de rendu très généraliste.

Il ne faut toutefois pas considérer qu'un graphe Material Maker s'exécute automatiquement dans WGSL : exporter les cartes est simple, porter les graphes dynamiquement est un travail supplémentaire.

### Deux autres outils à surveiller

VFX Texture Lab possède une architecture de graphe utilisant WGSL pour l'évaluation GPU, avec des nœuds de bruit, formes, érosion, hauteur, normales et matériaux. C'est intéressant pour une chaîne WebGPU, mais le projet est encore en bêta publique.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



DiffMat, du MIT, est plus orienté recherche. Il permet de rendre différentiables des graphes de matériaux et d'optimiser leurs paramètres pour reproduire une image de référence. C'est prometteur pour transformer une photo de sol en recette procédurale. Attention : la licence du dépôt est non commerciale et certaines fonctions nécessitent encore des outils propriétaires Adobe.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



## 5. L'état de l'art neuronal : 2024–2026

C'est la partie la plus intéressante en termes de recherche. On observe une évolution des modèles capables de produire seulement une image RGB vers des modèles capables de générer des matériaux complets et cohérents, avec albédo, hauteur, normales et rugosité.

Mais il faut bien distinguer deux problèmes :

- Générer un excellent matériau de 2 × 2 mètres.
- Générer ce matériau sur un territoire infini, avec une cohérence spatiale, climatique et géologique.

La recherche progresse fortement sur le premier. Le deuxième reste largement à assembler.

### Travaux récents à suivre

[CVPR Poster MatFuse: Controllable Material Generation with Diffusion Models](https://images.openai.com/static-rsc-4/nQx8zoEF8F4a1byDgMGl-1nbZpPvgX3hF2FJW0tOB7jKHoQsuAYguY_u8zK76ImYUzRGQqJkslXQJ7Pdzf0l3paPjQq1pUQXWa_DCaPVvZpwUfJA44Trtb5LTKLmrva4ydagq7bbGtBgQrjvihQR151M3iOzE-aHKUpo0qCiZA4?purpose=inline)

[MatFuse](https://github.com/giuvecchio/matfuse?utm_source=chatgpt.com) — CVPR 2024

Génération de SVBRDF par diffusion, conditionnée par du texte, une image, une esquisse ou une palette. Les différentes cartes de matériau sont représentées dans un espace latent appris.

Code PyTorch disponible sous MIT. Très intéressant comme base expérimentale pour générer des bibliothèques de matériaux.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



[TileGen: Tileable, Controllable Material Generation and Capture](https://images.openai.com/static-rsc-4/cR_v7u2PyYOtdDQsUboysbIBTUCpQyAgQzJ4AUNXfuN5NB0jg_ajjpWN4p4V5QIwPti5O9eycKAhHF1tVl407L2X4w_gi7Cj-JR8aELexkHV2Gh-p3BsmjQ-SsrWJRWIpteo1p885yAS23AAmCLy-qpn-_8zsfbw7mtqzU5po9g?purpose=inline)

[StableMaterials](https://openaccess.thecvf.com/content/CVPR2026/html/Vecchio_StableMaterials_Enhancing_Diversity_in_Material_Generation_via_Semi-Supervised_Learning_CVPR_2026_paper.html?utm_source=chatgpt.com) — CVPR 2026

À mon avis, le travail récent le plus pertinent pour ta problématique.

Utilise une diffusion latente, un apprentissage semi-supervisé pour accroître la diversité des matériaux et une distillation permettant une génération en quatre étapes. Introduit également une technique de tuilage sans coutures.

L'approche est directement centrée sur la variété des matériaux PBR, contrairement à beaucoup de travaux consacrés aux maillages 3D. La publication et sa présentation sont disponibles ; je n'ai pas confirmé la disponibilité d'un dépôt complet réutilisable.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://openaccess.thecvf.com\&sz=32)

CVF Open Access



[MaterialPicker: Multi-Modal Material Generation with Diffusion Transformers](https://images.openai.com/static-rsc-4/Xckp1govyuyeGjb-Tf7B2LLG5T8WgornLlCwB0LAM-vs0NmrsAoB_U9utQR6jEVXgGtlxO-23hhD5GCt3IwGV7VbLrJATxIkw7uJukJpROLonhNAAIkwwDzJDr2bQn3-mEe_o4lncVT_8e0lu87Qx1ukAuNxh0GXPfO5GWn4srs?purpose=inline)

[MatLat](https://github.com/KAIST-Visual-AI-Group/MatLat?utm_source=chatgpt.com) — CVPR 2026

Introduit un espace latent spécialisé pour les matériaux PBR, construit à partir d'un VAE préentraîné. Il permet de mieux conserver les informations locales entre les différentes cartes de matériau.

Le code et les checkpoints sont publiés. C'est principalement un modèle de texturation d'objets 3D, donc moins directement transposable à un monde 2D infini.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



[ProcTex: Consistent and Interactive Text-to-texture Synthesis for Procedural Models | AI Research Paper Details](https://images.openai.com/static-rsc-4/KcADMt1mYJjmKchrKcXKrorcQF0mC0drk0S6t3sat4JHIcdYAdk9Rh3PTFUOw2-MkfbWVakT4rCR34zIVHUoI5-1L5jv2nKygaMNc1CCrBbZ4EJiaHpbKZo1WjR5FKYJFwf2mbuGbDVJ15SYt2uFJ_yAuY4J6ai5oy45Zt8QBeo?purpose=inline)

[ProcTex](https://github.com/ruiqixu37/ProcTex?utm_source=chatgpt.com) — Eurographics 2026

Problème particulièrement intéressant pour Magna Urbis : conserver une apparence cohérente entre différentes instances d'un modèle procédural.

La méthode génère une texture sur une forme de référence, puis apprend des correspondances pour la transférer à des variantes de cette forme.

Code MIT. Le dépôt mentionne des configurations testées sur RTX 4090 et 5090. Ce serait davantage applicable à tes familles de bâtiments qu'aux sols continus.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://onlinelibrary.wiley.com\&sz=32)

Wiley Online Library

+1



[MaterialPicker: Multi-Modal Material Generation with Diffusion Transformers](https://images.openai.com/static-rsc-4/_0PlHT_2pJXWhcAOigDxodqfuTCZjCxeqW9VKqwGDmksUNykCb_SInl7KdzSMgTgDS0Ovrsno4GbQek4ggoj0y4z4a-tzQ7FTcRQeu0sBYpdFUOYy3zXebP_K1zpRDvm1QCBESoOuaJEPUUnedZdDJKZs8WNXLp-A8DKJYa5Imc?purpose=inline)

[Texture Space Material Diffusion](https://nvlabs.github.io/texdiffusion/?utm_source=chatgpt.com) — NVIDIA, septembre 2026

Génération de cartes PBR jusqu'à 8K par diffusion directement dans l'espace des textures.

Peut être conditionné par du texte, des photographies et des cartes de matériau basse résolution. L'approche est intéressante pour la génération et le raffinement de matériaux, mais n'est pas conçue pour générer à la volée les pixels d'un territoire infini.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://arxiv.org\&sz=32)

arXiv



Deux autres publications méritent une mention : MaTi — Make PBR Materials Tileable With Latent Diffusion Inpainting (2025), qui transforme des matériaux non tuilables en matériaux raccordables, et TexPro (2025), qui cherche à reconstruire des matériaux PBR procéduraux à partir de descriptions textuelles.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://pubmed.ncbi.nlm.nih.gov\&sz=32)

PubMed

+1



### Ce que ces travaux suggèrent pour Neural Earth

Je vois trois utilisations réalistes de l'IA :

Génération hors ligne de matériaux. On crée, par exemple, 20 variantes de sol volcanique, 30 variantes de roche sédimentaire, 15 de boue, etc. Ces matériaux deviennent une bibliothèque réutilisable dans un shader déterministe.

Optimisation de matériaux procéduraux. Au lieu de générer des pixels définitifs, on apprend les paramètres d'un graphe (densité de cailloux, distribution de tailles, couleurs, fréquence des fissures). C'est la voie illustrée par les travaux MATch, DiffMat et Generating Procedural Materials from Text or Image Prompts (SIGGRAPH 2023).&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Génération conditionnée localement. Une approche plus exploratoire consisterait à entraîner un modèle produisant des détails de surface à partir de variables de contexte : géologie, humidité, pente, occupation du sol, proximité de l'eau, etc. Il faudrait imposer explicitement la cohérence spatiale et multi-échelle.

Cette dernière voie est potentiellement originale scientifiquement, mais ce n'est pas le point de départ le plus économique pour obtenir rapidement un rendu convaincant.

## 6. Les datasets utiles

Pour constituer une bibliothèque réaliste sans tout générer soi-même :

[Textures: Aerial > Outdoor > Terrain • Poly Haven](https://images.openai.com/static-rsc-4/Jo8po5fb4mMp59VY1tvXgj2FKSxhRegzlRWT3QkKt4QtVp41T3pHDQILUmcWZLm_m-ox7qxAYnhRJnNP-eX-g_ZQvIbo3_EAA7VmTKtRrWl7VP8Ln9jw3TdZgp9JCCpmH5Pf7hBa-ClpChYRB1ckp8fR3ivWxAuXLBS00WrY8kM?purpose=inline)

[Poly Haven](https://polyhaven.com/textures?utm_source=chatgpt.com)

Matériaux PBR photographiques, généralement en haute résolution, avec licence CC0. Très bon choix pour la roche, la terre, les pavés et les surfaces naturelles.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://polyhaven.com\&sz=32)

Poly Haven



[Ground 062 S | ambientCG](https://images.openai.com/static-rsc-4/_AnhZ6T2ZqmkDxPhWQVsqdMPu2UF1Rf8baH3suCdJyA7ghezDZINeTQOigOHLW52l1IfyYkn78RIH9MQBxc8kGln9KP9cWZcAw5zUrJEH2Gs-JZoLYcWHQL_uCVi19aaCFxEH0RC6IGrhURVqmupIsJD3mtl1FwYwnB-iabro20?purpose=inline)

[ambientCG](https://ambientcg.com?utm_source=chatgpt.com)

Grande bibliothèque CC0 avec matériaux de sol, gravier, pierre, boue et surfaces architecturales. Très utile pour alimenter automatiquement des atlas.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://tmhsdigital.github.io\&sz=32)

CC0



[MATch: Differentiable Material Graphs for Procedural Material Capture](https://images.openai.com/static-rsc-4/bcTMRrzm6ZtGHRekncB8B3oR7p-71fAQvGVBHhTYlxkcbf3l1pjtKe9x2trVx0ngKyjSPHG54Eut0kKdP_-07fuUNfBugBpGRGpaPgg-xpIQfmoAGzRWUasfi4eXXMI-VNyLv5nSqAlXQyJ00UJxGnQ4pV-zLxfLt968Qt-fYo4?purpose=inline)

[MatSynth](https://www.gvecchio.com/matsynth?utm_source=chatgpt.com) — CVPR 2024

Plus de 4 000 matériaux PBR haute résolution sous CC0, avec métadonnées et rendus associés. C'est une des meilleures bases publiques pour entraîner ou évaluer un générateur spécialisé.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ieeexplore.ieee.org\&sz=32)

IEEE Xplore



Attention à conserver les métadonnées d'échelle physique quand elles existent. Une image 2K couvrant 50 cm n'a pas du tout la même signification qu'une image 2K couvrant 5 m. Il faut aussi conserver une échelle cohérente entre les cartes de relief et les normales.

## 7. Approche par type de surface

À l'échelle centimétrique, chaque famille de matériau nécessite une stratégie différente. Je proposerais cette classification pour ton moteur.

| Surface             | Technique privilégiée                      | Informations contextuelles     |
| ------------------- | ------------------------------------------ | ------------------------------ |
| Terre sèche         | Stochastic tiling + grains + fissures      | Texture du sol, humidité       |
| Terre humide / boue | Voronoï, height map, variation de rugosité | Eau, drainage, passages        |
| Sable               | Bruit directionnel, rides, grains          | Vent, pente, humidité          |
| Gravier             | Placement de textons + atlas               | Granulométrie, transport       |
| Roche massive       | Matériau PBR + fissures SDF                | Lithologie, fracturation       |
| Éboulis             | Scatter hiérarchique de fragments          | Pente, érosion                 |
| Herbe courte        | Sprites / textons + matériau de fond       | Climat, piétinement            |
| Litière forestière  | Scatter feuilles et brindilles             | Type de végétation             |
| Neige               | Surface irrégulière, creux et croûtes      | Vent, fonte, ombrage           |
| Pavés / dallages    | Pavage structurel + usure PBR              | Voirie, culture, âge           |
| Eau calme           | Normales animées + réflexion               | Vent, profondeur               |
| Eau courante        | Flow map + normales + écume                | Vitesse, profondeur, obstacles |

### Cas particulier : l'eau

Je ne traiterais pas l'eau comme un simple matériau tuilable.

Pour les rivières et les littoraux, il faut distinguer la géométrie de l'eau et ses détails visuels. On peut produire ces derniers avec :

\\[ C(x,y,t) = F\big(d\_{\text{rive}},h\_{\text{eau}},\vec v,\nabla z,N(x,y,t)\big) \\]

où :

- \\(d\_{\text{rive}}\\) est la distance signée au rivage ;
- \\(h\_{\text{eau}}\\) est la profondeur ;
- \\(\vec v\\) est le champ de vitesse du courant ;
- \\(\nabla z\\) représente les variations du relief ;
- \\(N\\) est un champ de bruit animé.

Pour les petits cours d'eau, cela permet d'orienter les vaguelettes selon le courant, de générer des turbulences près des obstacles et de placer des bandes d'écume près des berges.

Pour les océans, on peut ajouter des composantes spectrales, voire une simulation FFT si tu passes à une véritable surface 3D. Mais une FFT océanique complète me semble disproportionnée pour une vue cartographique de dessus.

Les projets [water-shader](https://github.com/tuxalin/water-shader?utm_source=chatgpt.com) et [unity-voronoi-water](https://github.com/cbunt/unity-voronoi-water?utm_source=chatgpt.com) fournissent respectivement des exemples d'effets d'eau procédurale et de flow maps.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



### Cas particulier : les routes et sols urbains

Pour Magna Urbis, je ne chercherais surtout pas à générer une rue pavée uniquement avec une texture.

La structure du pavage doit dépendre de la géométrie de la rue : orientation des pierres, bordures, caniveaux, transitions avec les murs, etc.

Le générateur urbain définirait les pavés ou leurs cellules. Le shader interviendrait ensuite pour ajouter la matière, les petites fissures, l'usure, les variations chromatiques et les salissures.

Cela évite de demander au shader de reconstruire une structure que ton générateur connaît déjà.

## 8. Architecture que je retiendrais pour tes deux projets

J'ai regardé en particulier la documentation de [Render3D de Neural Earth](https://github.com/dunkean/neural-earth/blob/main/docs/render3d.md?utm_source=chatgpt.com).

Tu as déjà résolu une bonne partie des problèmes difficiles :

- Évaluation des matériaux en coordonnées physiques.
- Gestion de la précision numérique loin de l'origine.
- Apparition progressive des détails selon l'empreinte du pixel.
- Intégration de l'éclairage GGX.
- Grains, petits reliefs et végétation déterministes.

Ton implémentation actuelle utilise notamment quatre bandes de détail au sol, de 8 m, 2,2 m, 0,32 m et 0,055 m. Le rendu peut descendre à 1/128 m par pixel, et les fréquences non résolues contribuent à la rugosité plutôt qu'à un détail visuel aliasé.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



C'est une base tout à fait adaptée. Je ne la remplacerais pas.

### Proposition de pipeline

Neural Earth / Magna Urbis

Biomes · géologie · pente · hydrologie · occupation du sol · voirie

Champ de matériaux contextuel

Poids des matériaux, humidité, directionnalité, densité d'objets

Shader procédural

Noise · SDF · relief analytique · scatter déterministe

Atlas de matériaux

Photogrammétrie · Material Maker · textures génératives

Composition stochastique

Hex tiling · Wang tiles · blending de matériaux · masques physiques

Render3D / WebGPU

Albédo · relief · normales · rugosité · éclairage · anti-aliasing multi-échelle

Ce pipeline pourrait être commun aux deux projets, malgré leurs différences de représentation du territoire.

### Une représentation intéressante : un matériau probabiliste

Plutôt que d'associer une seule texture à un pixel, tu pourrais représenter localement une composition :

\\[ M(x,y)=\\{(w_i,\theta_i,s_i)\\}\_{i=1}^{K} \\]

avec \\(w_i\\) la proportion d'un matériau, \\(\theta_i\\) son orientation et \\(s_i\\) son échelle physique.

Par exemple, un sol au bord d'une rivière pourrait être composé de 60 % de gravier, 25 % de sable et 15 % de limon. Le moteur produirait un agencement spatial de ces composantes, sans les mélanger uniformément pixel par pixel.

La géologie et l'hydrologie détermineraient les proportions et les distributions. Le shader réaliserait la synthèse fine.

C'est un moyen de garder une continuité physique depuis l'échelle du paysage jusqu'aux petits détails.

## 9. Le vrai problème : la cohérence entre 10 m et 1 cm

Le point délicat n'est pas la résolution maximale. C'est le passage entre les échelles.

| Échelle caractéristique | Représentation dominante                         |
| ----------------------- | ------------------------------------------------ |
| 100–10 m                | Géologie, relief, couverture du sol              |
| 10–1 m                  | Affleurements, grandes pierres, touffes, chemins |
| 1 m–10 cm               | Cailloux, racines, plaques de boue, fissures     |
| 10–1 cm                 | Petits graviers, feuilles, joints, relief fin    |
| Moins de 1 cm           | Microstructure filtrée, rugosité statistique     |

Le système doit éviter deux défauts récurrents.

Premièrement, l'apparition arbitraire des détails. Si une pierre devient visible à 5 cm/px, sa contribution globale doit idéalement déjà être représentée dans l'image à 20 cm/px. Autrement dit, le changement de niveau de détail doit préserver l'apparence moyenne et, dans la mesure du possible, les propriétés de rugosité.

Deuxièmement, les incohérences au zoom et aux frontières. Le même grain doit conserver sa position lors d'un déplacement de la caméra, et les objets ne doivent pas être coupés ou rééchantillonnés différemment entre deux tuiles.

Pour une implémentation mondiale, j'utiliserais systématiquement les coordonnées de cellules entières et des graines hiérarchiques, avec évaluation locale dans le shader. Ton traitement actuel de l'origine des tuiles va déjà dans ce sens.

Il resterait notamment à traiter les limites que tu documentes toi-même : dérive possible des détails entre certains LOD, déformations sur la projection planétaire vers les pôles et discontinuités à l'antiméridien.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



### Pourquoi il ne faut pas tout précalculer

À seulement 1 cm par pixel, un carré de 1 km de côté représente 10 milliards de pixels, soit environ 40 Go pour une seule image RGBA8 non compressée.

Il faut donc évaluer les matériaux à la demande, en fonction de l'empreinte des pixels affichés, et non générer systématiquement la résolution maximale.

Un tile de 512 × 512 pixels à 1 cm/px ne représente finalement que 5,12 × 5,12 m au sol. Le vrai budget mémoire dépend de la portion visible, des caches et des cartes de matériau chargées, pas de la surface totale de la planète.

## 10. Feuille de route expérimentale

Je ferais un benchmark en quatre étapes, en réutilisant directement le rendu Render3D existant.

| Étape | Expérience                                                       | Critère de réussite                                            |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 1     | Intégrer un matériau photographique et un hex tiling dans WebGPU | Rendu crédible sans répétition ni couture                      |
| 2     | Ajouter une hauteur, des normales et une rugosité cohérentes     | Bon rendu sous plusieurs directions lumineuses                 |
| 3     | Ajouter le scatter déterministe d'objets centimétriques          | Sol rocheux / forestier convaincant au zoom                    |
| 4     | Conditionner les matériaux par le contexte local                 | Transitions naturelles entre roche, sable, terre et végétation |

Pour comparer correctement les méthodes, je choisirais trois scènes représentatives : un sol volcanique avec éboulis, une rive de rivière avec sédiments et une rue médiévale pavée et usée.

Je mesurerais la fluidité en 1080p, les discontinuités entre tuiles et LOD, la stabilité au déplacement de la caméra, et surtout la répétition perceptible sur de grandes surfaces. Les temps de calcul déjà documentés dans Neural Earth offrent un point de comparaison de départ, sans constituer une garantie pour les nouvelles méthodes.

## 11. Mon classement des pistes à explorer

| Rang | Piste                                                        | Apport probable                      | Effort estimé  |
| ---- | ------------------------------------------------------------ | ------------------------------------ | -------------- |
| 1    | Hex tiling de Mikkelsen                                      | Très fort sur les matériaux naturels | Faible à moyen |
| 2    | Bibliothèque PBR issue de Material Maker et Poly Haven       | Très fort sur le réalisme immédiat   | Faible à moyen |
| 3    | Texture bombing / textons déterministes                      | Très fort à l'échelle centimétrique  | Moyen          |
| 4    | Wang tiles pour structures                                   | Fort pour Magna Urbis                | Moyen          |
| 5    | Conditionnement géologique et hydrologique                   | Fort sur la cohérence mondiale       | Moyen à élevé  |
| 6    | MatFuse / StableMaterials en génération hors ligne           | Fort pour la diversité               | Moyen          |
| 7    | Apprentissage direct d'un champ neuronal infini de matériaux | Incertain mais intéressant en R&D    | Élevé          |

### Conclusion

Pour les résultats à court terme, je combinerais des textures PBR photographiques ou synthétiques, un échantillonnage stochastique sans répétition, et des détails structurés procéduralement.

Tu disposes déjà de la partie difficile : un moteur de rendu multi-échelle avec gestion des coordonnées, filtrage et éclairage.

L'amélioration qui devrait changer le plus visiblement le rendu n'est pas un nouveau réseau de diffusion. C'est le passage de bandes de bruit à une véritable description de la composition physique du sol, où le shader sait qu'il doit dessiner du sable, des pierres, des fissures, des feuilles ou des pavés.

Pour la recherche neuronale, je regarderais en priorité StableMaterials, MatFuse et les modèles de génération de graphes procéduraux. Ils pourraient permettre de créer automatiquement des centaines de matériaux cohérents à partir de quelques références et de paramètres environnementaux.

C'est probablement le meilleur équilibre entre qualité visuelle, générativité, temps réel et compatibilité avec l'ambition de Neural Earth : pouvoir zoomer sur n'importe quel endroit du monde, sans avoir précalculé ce qui s'y trouve.
