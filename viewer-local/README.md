# Prévisualisation locale SurfaceWorld

Godot est un moteur de rendu candidat pour les cartes et plans JDR 2D/3D de
Magna Urbis. Les contrats de donn�es restent ind�pendants du moteur ; les palettes
existantes, les vues orthographiques et les exports de cartes guident son �valuation.
Les sorties SVG/Canvas conservent actuellement les �tiquettes et la composition
finale non reprises ici. Ce projet ne g�n�re aucun relief et ne modifie ni les hauteurs
source, ni les volumes urbains natifs, ni leurs identifiants de mat�riaux.

## Installer et lancer

Versions épinglées : **Godot 4.7.2 stable**, **Terrain3D 1.0.2 stable**. Le bootstrap
Windows vérifie le SHA-256 de l'archive Terrain3D et installe l'extension hors Git.
Le moteur doit être installé séparément. Forward+ est le backend par défaut ; il
permet les Decals de routes. Compatibility est un repli avec des capacités différentes.

```powershell
$env:GODOT = 'C:/tools/Godot_v4.7.2-stable_win64_console.exe'
./viewer-local/bootstrap.ps1 -Godot $env:GODOT
node web/scripts/surface_viewer.mjs --check
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json
```

Le lanceur accepte `--godot <exécutable>` et `--renderer forward_plus|mobile|gl_compatibility`.
Les chemins relatifs sont résolus depuis le répertoire courant. Il importe le
projet au premier lancement. `--check` vérifie les scripts, le contrat de shader
Terrain3D et les versions ; un test GPU reste nécessaire pour qualifier un backend.
Sur Linux/macOS, décompresser le zip épinglé dans `viewer-local/` et importer avec
`godot --headless --path viewer-local --editor --import --quit`. Ces plateformes
ne sont pas qualifiées par les mesures Windows.

Le lecteur accepte JSON `magna-surface-packet` v1, `SurfaceWorld` JSON, et le
transport binaire **MUFSURF1**. Ce dernier conserve les colonnes typées, les doubles
précisions urbaines et les sentinelles ; il évite les chaînes JSON géantes des
grilles 1024². Les colonnes urbaines et de population sont lues sans matérialiser
un million d'objets JavaScript/Godot. Les schémas canoniques restent sous
`web/src/surface/`.

`resolved.json` provient de `web/scripts/surface_assets.mjs`. Ses cartes sont
locales : aucun téléchargement n'a lieu pendant le rendu hors ligne. Le catalogue
actuel contient quinze jeux PBR CC0 ; `recipeIds` est prioritaire sur le repli par
famille. Sans catalogue, le matériau analytique de repli est explicite. Une carte
de hauteur absente devient un relief de texture plat, avec avertissement.
`SurfaceMaterialLibrary.asset_version` et `asset_digest` identifient les assets
r�ellement charg�s, leurs affectations, tailles physiques, amplitudes et SHA-256
d�clar�s et constat�s. Les chemins absolus et l�ordre des cl�s ne participent pas
au digest. `loaded_asset_bindings` expose les couches et leurs moyennes lin�aires.
Cette provenance de rendu reste distincte de `World.versions.materialLibrary`,
qui d�crit les recettes du mod�le canonique.

## Vues et styles de carte

```powershell
node web/scripts/surface_viewer.mjs --world C:/data/city.surfacebin --presentation cartographic --style blueprint --top
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json --presentation aerial
```

Le paquet transporte `presentation`, une copie de la palette commune et de son
origine. Le lanceur fournit aussi `surface/presentation/palettes.json`, exporté des
styles existants, pour les overrides `--style`. Le profil conserve l'identité des
quinze styles terrain, leurs palettes et métadonnées d'eau. Godot prévisualise la
palette, la hiérarchie des masses urbaines, les groupes de matériaux natifs et la
vue orthographique. Les brosses fantasy, la composition, les étiquettes et la mise
en page finale restent assurées par les renderers web existants.

La vue cartographique emploie une exposition linéaire, une lumière ambiante blanche
et aucun soleil direct. Les routes projetées peuvent ainsi conserver leurs
couleurs CSS. La vue aérienne emploie les matières PBR et les teintes de prévisualisation
associées aux motifs natifs (`tile`, `wood`, `stone`, etc.). Ces teintes ne réécrivent
pas le catalogue architectural source. Le cache de matériaux est borné et distingue
les palettes, les affectations de slots et les identifiants source.

L'interface de diagnostic est masquée par défaut ; `--hud` ou `H` l'affiche.
Molette : zoom ; glisser gauche : déplacement ; `O` : dessus/oblique ; `1` à `7` :
40 km à 10 m ; `D` : diagnostics ; `F` : inspection JSON du centre ; `S` : capture ;
Échap : profil et fermeture. La largeur orthographique et le pas en m/px sont
exacts. En perspective, le pas annoncé concerne le plan du centre visé.

## Captures, profils et contrôles GPU

```powershell
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json --width 10 --top --frames 180 --capture C:/data/close.png --metrics C:/data/close.json
node web/scripts/surface_viewer.mjs --world C:/data/world.surfacebin --assets C:/data/surface-assets/resolved.json --top --tour C:/data/tour --metrics C:/data/tour.json
```

`--x` et `--z` fixent le centre canonique. `--frames` et `--tour` désactivent les
entrées pour rendre la capture reproductible. Une étape de tour attend la
préparation et la réponse live appliquée, ou l'erreur explicite de cette requête,
puis stabilise les images. Les profils séparent préparation CPU, import des
régions/objets, durée de navigation, rendu CPU/GPU mesuré par le viewport et mémoire
graphique déclarée. Les quantiles d'image incluent la synchronisation verticale ;
les timestamps GPU ne mesurent pas tout le coût CPU et restent absents si le
backend ne fournit aucun échantillon positif.

Contrôles indépendants, avec le même exécutable Godot et le répertoire `viewer-local` :

```powershell
& $env:GODOT --path viewer-local --rendering-method forward_plus --script diagnostics/material_mean_probe.gd -- C:/data/surface-assets/resolved.json C:/data/material-mean.json
& $env:GODOT --path viewer-local --rendering-method forward_plus --script diagnostics/normal_frame_probe.gd
& $env:GODOT --path viewer-local --rendering-method forward_plus --script diagnostics/cartographic_decal_probe.gd -- C:/data/decal-probe
& $env:GODOT --headless --path viewer-local --script diagnostics/presentation_probe.gd -- surface/presentation/palettes.json
& $env:GODOT --headless --path viewer-local --script diagnostics/asset_provenance_probe.gd
```

`material_mean_probe` emploie le sampler de production et trois empreintes par
matériau, puis compare une origine déplacée de 64 m à travers 4096 m. Sur RTX 4090
Forward+, quinze jeux PBR et le repli ont donné une erreur maximale de moyenne
linéaire de **0,154 %**, et une différence de rebase de **1 niveau 8 bits**.
La rotation de normales 0/90/180/270° a donné zéro écart encodé dans le probe GPU.
Le probe Decal donne la couleur route CSS exacte, avec zéro pixel différent après
une déformation du sol de ±2 m ; le sol diffère de sa cible de moins d'un niveau
8 bits. Ces contrôles isolés ne constituent pas une qualification visuelle complète.

## Source, précision et alimentation à la demande

La caméra conserve les coordonnées canoniques en doubles précisions. La
soustraction de l'origine précède les coordonnées GPU. Les fenêtres Terrain3D
sont reconstruites depuis la source et remplacées ensemble ; le nœud n'est pas
simplement translaté. Le pas et les origines d'affichage suivent la grille source.
Terrain3D limite son espacement à 0,25–100 m : toute interpolation d'affichage reste
distincte de `sourceLOD`, `nativeSpacingM` et `sourceLODKnown`.

Les shaders reconstruisent les poids des deux matériaux de chacun des quatre
voisins du contexte. Les moyennes de couleur sont linéaires. Les cartes PBR utilisent
une couleur/hauteur RGBA16F linéaire et une normale/rugosité, en tableaux 1024² avec
mips. Les transformations et poids stochastiques sont communs aux cartes ; les
normales OpenGL tournent dans le même repère. La variation de couleur est centrée
sur la moyenne et bornée sans amplification des cibles sombres. Les dérivées sont
calculées avant les branches ; le bruit macro est filtré selon l'empreinte.

`--live-url http://127.0.0.1:PORT/surface-live/terrain` utilise le navigateur Terrain
Bench actif et son moteur réel. `--session-id` sélectionne facultativement sa
session, pas un monde. Les demandes indiquent une origine minimale, une étendue
et une résolution, et restent dans l'emprise retenue du contexte. Les identités
`knownContextId` et `knownSceneContextId` évitent de retransmettre le contexte et
la ville inchangés. Les parents restent visibles pendant le chargement ; une
erreur du fournisseur conserve le dernier monde valide et sa provenance. Le
lecteur ne remplace jamais une erreur de décodeur par un bruit de relief.

`--stream-dir <répertoire>` permet également des demandes/réponses par fichiers ;
le fournisseur doit publier ses réponses atomiquement. Un export hors ligne ne
prouve pas que le raffinement source a été généré à la demande.

## Limites de cette prévisualisation

Le transfert des régions peut dépasser 16,7 ms ; les profils l'indiquent. Les
arbres, buissons et débris sont des représentants géométriques simples. Le couvert
lointain utilise l'atlas des couronnes candidates et leur transmittance ; cela ne
constitue pas une forêt photographique. Il n'y a pas de microgéométrie centimétrique
certifiée. Un zoom à 1 cm/px n'ajoute aucune information à un DEM grossier.
L'eau conserve les classes/niveaux fournis ; les rives dépendent de leur support.
Les volumes urbains natifs sont conservés ; les proxies cartographiques restent
identifiés comme tels et sont masqués par défaut. Les routes projetées ne terrassent
pas le terrain. Le rendu Godot actuel ne remplace pas encore les styles cartographiques
finis de Magna Urbis.

Références : [Terrain3D 1.0.2](https://github.com/TokisanGames/Terrain3D/releases/tag/v1.0.2-stable),
[régions Terrain3D](https://terrain3d.readthedocs.io/en/stable/api/class_terrain3ddata.html),
[environnement et tonemapping Godot](https://docs.godotengine.org/en/stable/tutorials/3d/environment_and_post_processing.html).
La licence MIT du shader Terrain3D reste dans l'archive installée par le bootstrap.
