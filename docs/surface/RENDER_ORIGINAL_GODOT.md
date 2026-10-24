# Render original : fenêtre Godot 2D

Ce projet isolé affiche la sortie du renderer `RenderOriginalRD`. Il ne charge
ni Terrain3D, ni atlas/PBR, ni arbre, ni pipeline SurfaceWorld 3D. Les calculs du
Render original et ses quatre pipelines appartiennent au renderer ; `main.gd`
ne fait que charger la scène exportée, afficher sa texture et déplacer la vue.
La texture plein écran est retournée verticalement (`flip_v=true`) pour conserver
la convention du FBO WebGL original ; le filtrage d'affichage est nearest.

```powershell
.\Test-Render.ps1 -Scene 'CHEMIN/fixture.json' -Check
.\Test-Render.ps1 -Scene 'CHEMIN/fixture.json'
.\Test-Render.ps1 -Scene 'CHEMIN/fixture.json' -Width 160 -Focus '20000,20000'
.\Test-Render.ps1 -Scene 'CHEMIN/fixture.json' -Resolution 1024x640 -Frames 4 -Capture './capture.png'
```

`Test-Render.cmd` transmet les mêmes arguments à PowerShell local. Aucun fichier
n'est installé ou téléchargé. `-Check` vérifie les entrées, shaders et références
locales de la fixture sans lancer Godot/GPU. Il ne certifie pas à lui seul leur
identité avec l'original : les hashes et comparaisons du renderer restent la
preuve séparée. Le chemin de scène est explicite ; aucune scène de substitution
n'est fabriquée lorsqu'il manque.

Défauts : largeur 40000 m, centre 20000/20000, fenêtre fixe 1280×800. `-Resolution`
fixe la taille au démarrage ; aucune réallocation par redimensionnement de fenêtre
n'est demandée dans cette première version. `-Width` et `-Focus` sont des paramètres
de caméra, pas une génération ou un déplacement des données source.

- Glisser gauche : déplacement.
- Molette : zoom autour du curseur.
- H : masquer/afficher l'aide.
- S : capture du renderer dans le dossier utilisateur Godot `captures`.
- Échap : quitter et nettoyer les ressources du renderer.

La caméra logique garde centre/largeur en scalaires float64. Elle transmet le
coin supérieur gauche `[x,y]` et les mètres par pixel ; aucune position mondiale
n'est convertie en `Vector2` float32 dans l'enveloppe. Une requête de vue est envoyée
seulement lors d'une modification, sans worker ScenePrepare ni calcul de scène 3D.
Le paramètre CLI historique `--z` porte la seconde coordonnée plane Y du Render.

Contrat requis : `configure(scene_path, size)->bool`, `set_view(origin, mpp)`,
`output_texture`, `ready`, `failed`, `stats()`, `capture_png(path)` asynchrone et
`cleanup()`. Une configuration/erreur du renderer provoque un échec explicite.
`--frames 0` laisse la fenêtre interactive ; un nombre positif termine après les
frames prêtes. Avec capture, le défaut est deux frames prêtes. Le PNG vient du
renderer sans HUD, distinct d'une capture écran de la fenêtre.

Cette enveloppe n'ajoute aucun motif, recette, relief ou preuve de sol observé.
La source reste celle de la fixture exportée. La parité visuelle GPU avec le
Render web original doit être mesurée séparément ; la vérification de syntaxe ou
le précontrôle du lanceur ne constituent pas une telle qualification.
