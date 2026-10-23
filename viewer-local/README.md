# Visualiseur local SurfaceWorld

Visualiseur Godot indépendant de l'interface Magna Urbis. Il consomme le paquet
JSON `magna-surface-packet` v1 (ou un `SurfaceWorld` v1), ses hauteurs, son contexte,
ses niveaux d'eau, ses candidats déterministes et les triangles urbains natifs.
Il ne génère pas le relief.

## Installer et lancer

Version testée : **Godot 4.7.2 stable**, **Terrain3D 1.0.2 stable**, Windows,
OpenGL Compatibility, NVIDIA RTX 5090. Terrain3D est téléchargé hors Git par le
bootstrap, vérifié par SHA-256, puis installé sous `addons/terrain_3d`.

```powershell
$env:GODOT = 'C:/tools/Godot_v4.7.2-stable_win64_console.exe'
./viewer-local/bootstrap.ps1 -Godot $env:GODOT
node web/scripts/surface_viewer.mjs --world C:/data/surface-world.json --assets C:/data/surface-assets/resolved.json
```

Le lanceur accepte aussi `--godot <exécutable>`. Sans catalogue, il utilise une
matière analytique neutre, explicitement distincte des six matériaux PBR réels.
Le catalogue `resolved.json` issu de `web/scripts/surface_assets.mjs` contient
des chemins locaux ; aucun réseau n'est utilisé pendant le rendu hors ligne.

Sur Linux/macOS : décompresser le même zip Terrain3D dans `viewer-local/` pour
obtenir `addons/terrain_3d/terrain.gdextension`, puis importer le projet avec
`godot --headless --path viewer-local --editor --import --quit`. Ces plateformes
ne sont pas qualifiées par les mesures Windows.

Contrôles : molette zoom, glisser bouton gauche pour déplacer le centre, `O`
dessus/oblique, `1` à `7` pour 40 km/10 km/2,56 km/640 m/160 m/40 m/10 m,
`D` matériaux/couverts/roche mère/état, `F` inspection JSON du centre, `S` capture,
Échap pour statistiques et fermeture. Le dessus est orthographique ; sa largeur
et son pas en m/px sont exacts. En perspective, le pas affiché est celui du plan
passant par le centre visé, pas une résolution uniforme de toute l'image.

## Captures et profil

```powershell
node web/scripts/surface_viewer.mjs --check
node web/scripts/surface_viewer.mjs --world C:/data/surface-world.json --assets C:/data/surface-assets/resolved.json --width 10 --top --frames 180 --capture C:/data/close.png --metrics C:/data/close.json
node web/scripts/surface_viewer.mjs --world C:/data/surface-world.json --assets C:/data/surface-assets/resolved.json --top --tour C:/data/tour --metrics C:/data/tour.json
```

`--x` / `--z` fixent le centre canonique en mètres. `--tour` enregistre les sept
échelles, avec 60 images de stabilisation entre remplacements. `--frames` et
`--tour` désactivent l'entrée clavier/souris pour des captures reproductibles.
Les images et profils générés restent sous `captures/` ou la destination choisie.
Les profils séparent préparation CPU hors thread, transfert/réinstanciation,
mémoire graphique déclarée, draw calls et quantiles des durées d'image.
Le backend OpenGL n'expose pas ici les timestamps GPU : `gpuTimeMs` reste `null`.
Les durées d'image comprennent la synchronisation verticale ; ce ne sont pas
des mesures isolées de coût GPU.

## Alimentation à la demande

Le lecteur conserve le `sourceLOD`, `nativeSpacingM` et l'identité du paquet.
Un ancien niveau non enregistré s'affiche comme « unknown (retained) ». Une
subdivision ou interpolation d'affichage ne devient jamais un niveau source.

`--live-url http://127.0.0.1:PORT/surface-live/terrain` connecte le visualiseur au
broker local et au navigateur Terrain Bench actif. Il envoie
`{region:{x:minX,y:minZ,extent,resolution:512}}` ; `--session-id` est optionnel et
désigne la session du navigateur, pas l'identité du monde. Une requête maximum est
en vol ; les réponses dépassées après navigation sont rejetées. Le parent reste
affiché pendant le calcul et une erreur réseau conserve le dernier monde valide.
La qualification du raffinement source réel est séparée de celle du viewer :
un paquet hors ligne n'en constitue pas une preuve.

`--stream-dir <répertoire>` offre aussi un transport par fichiers :
`requests/<id>.json` contient `id,worldId,bounds,resolutionM,sourceLOD` ; le
fournisseur écrit atomiquement `responses/<id>.json`, un paquet avec facultativement
`requestId` et `baseWorldId`. Le viewer ignore les réponses d'anciennes requêtes.
Remplacer atomiquement le fichier `--world` permet également le rechargement.

## Choix de rendu et limites J0

La caméra et l'origine canonique sont gardées dans des scalaires GDScript double
précision. Le repère GPU est relatif : une fenêtre de quatre régions 256² est
reconstruite sur un thread CPU, puis ses cartes sont remplacées avec les objets,
l'eau et la caméra. Le nœud Terrain3D n'est jamais simplement translaté. Les
phases UV sont reconstruites par couche en coordonnées canoniques réduites ; les
catégories du contexte restent au pas source. Les trous marquent les données
absentes hors emprise, sans inventer une extension du paquet.

Terrain3D 1.0.2 limite l'espacement du maillage à 0,25–100 m. La représentation
peut donc interpoler une source plus grossière sans altérer sa provenance.
Les textures PBR empaquettent couleur/hauteur et normale OpenGL/rugosité dans
deux tableaux 512² avec mips. Trois transformations stochastiques partagent UV,
rotation et pondération de hauteur pour toutes les cartes ; la normale est
tournée en sens inverse. L'empreinte filtre les normales et le couvert lointain.
Le proche utilise MultiMesh pour arbres, troncs, blocs, débris et touffes.
Un index mondial de cellules 128 m évite de parcourir tous les candidats à
chaque sélection. Le budget visible est 16 000 candidats ; aucune nouvelle
population n'est tirée par le renderer.

La décision J0 est **conserver Godot/Terrain3D pour cette tranche**, avec réserves
mesurées : le transfert initial et les remplacements peuvent dépasser 16,7 ms ;
le profil l'indique. Il n'y a pas encore de microgéométrie centimétrique ni de
raccord avec un patch déplacé complémentaire. Les arbres sont des représentants
géométriques simples ; le couvert analytique distant n'est pas une synthèse
forestière photographique. Les transitions de représentation et la réponse
moyenne demandent encore les tests quantitatifs du design. L'eau utilise les
classes/niveaux fournis sur leur support natif ; les rives sont limitées par ce
support. Les routes sont des rubans appuyés au terrain, sans terrassement.
Les matériaux urbains sont une teinte neutre : les volumes/triangles natifs sont
préservés, mais leurs familles de matériaux ne sont pas encore réinterprétées.

La campagne complète de six milieux à 40 km, les séquences sans popping,
les seuils de continuité d'albédo/couverture et les profils GPU par passe restent
des critères d'acceptation distincts. Un zoom matériel à 1 cm/px ne signifie pas
qu'un DEM de 15 m possède une géométrie centimétrique.

Références primaires : [versions Terrain3D](https://github.com/TokisanGames/Terrain3D/releases/tag/v1.0.2-stable),
[données/régions et mises à jour](https://terrain3d.readthedocs.io/en/stable/api/class_terrain3ddata.html),
[double précision expérimentale](https://terrain3d.readthedocs.io/en/stable/docs/double_precision.html).
Le shader minimum de l'addon est utilisé sous sa licence MIT conservée par le bootstrap.
