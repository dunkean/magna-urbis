# Diagnostic CPU de la couverture forestière V4

Ces rapports examinent le vrai paquet `native-e2e-40km-v4/fresh-source.surfacebin`
en lecture seule. Ils ne constituent ni une nouvelle génération, ni une preuve
GPU. Le script utilise les modules de production du worktree d'intégration ; ses
chemins absolus décrivent l'environnement de la mesure. Les empreintes des
artefacts et du paquet figurent dans [SHA256.json](SHA256.json).

Le contexte canonique est un raster 512² au pas de 78,125 m, dont le premier
échantillon se trouve à (39,0625 ; 39,0625) m. Son champ `treeCover` est identique
dans le paquet initial et le contexte du paquet de raffinement examiné.

Hors du carré central de 480 m, la couverture canonique moyenne vaut 24,3903 %
dans la fenêtre de 640 m (28 échantillons) et 24,3507 % dans celle de 2 560 m
(988 échantillons). Tous ces échantillons sont non nuls. La disparition visuelle
hors du carré n'est donc pas une disparition du champ source.

| Fenêtre | Arbres réels | Nombre moyen attendu | Couverture cible | Union des couronnes |
| --- | ---: | ---: | ---: | ---: |
| 320 m | 476 | 466,46 | 29,1866 % | 29,4632 % |
| 480 m | 963 | 996,22 | 27,8722 % | 26,6891 % |
| 512 m | 1 096 | 1 118,55 | 27,5440 % | 26,3840 % |

La requête 320 m reproduit exactement les 476 arbres du paquet initial. Les
couvertures sont des unions de disques de rayon physique `crownRadiusM`, mesurées
sur 256² sondes déterministes ; la somme des aires des disques surestime la
couverture lorsque les couronnes se chevauchent. L'écart maximal mesuré vaut
1,1831 point de pourcentage. Ce contrôle porte sur ces trois fenêtres précises,
sans prétendre valider tous les biomes ni l'apparence du rendu.

Le worker borne l'inventaire local avec `radius = min(240, extent / 2)` : la
fenêtre de 480 m, complétée par le halo d'affichage, explique une frontière proche
de 512 m. Une représentation lointaine doit utiliser le champ canonique hors de
cet inventaire, sans présenter ses motifs approximatifs comme des arbres avec
identités sources. Aucun changement du rendu n'est inclus dans ce dossier.

## Références historiques consultées sans modification

Dans Magna `bf3ccc7`, `rust/bridge/terrainRenderV2.ts:90–126` filtre le champ
forestier à l'empreinte physique, construit les poids sol/litière/canopée et
mélange les réponses en lumière linéaire. `rust/bridge/terrainForest.ts:720–800`
contient la transition motifs de peuplements / grain / couronnes résolues.

Dans Neural Earth `ce7f8cb`, `web/terrain_render3d.js:540–638` contient
`applyForest`, et `web/terrain_render_v2.js:309–346` la correction BRDF moyenne
`v2CanopyMeanRatio`. Le contrôle technique correspondant est
`tools/verification/verify_render_v2_canopy_mean.cjs:1–36`. Ces références décrivent
des méthodes de représentation ; elles n'autorisent pas à remplacer les champs
canoniques actuels par un nouvel environnement procédural.
