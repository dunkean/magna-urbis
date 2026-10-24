# Tester les sols retenus

Double-cliquer sur `Test-Sols.cmd` lance les mêmes paramètres par défaut,
avec PowerShell local, sans téléchargement. Pour choisir les paramètres,
depuis la racine de ce worktree, dans PowerShell :

```powershell
.\Test-Sols.ps1 -Check
.\Test-Sols.ps1
.\Test-Sols.ps1 -Width 160 -Focus '20000,20000'
.\Test-Sols.ps1 -Style blueprint
```

Le défaut est une vue TOP aérienne de 40 m, centrée sur 20000/20000.
`-Check` valide les fichiers locaux sans ouvrir Godot ni utiliser le GPU.
`-Style` accepte `aerial` et les neuf palettes du catalogue
partagé `surface/presentation/palettes.json`. Un style de carte active le mode
cartographique ; il ne transforme pas la recette physique du sol. L'expérience
R4 reste explicitement distincte du Render de production et artistiquement
non acceptée.

- F1 : répartition R4 / ancien mélange uniforme.
- F2 : afficher ou masquer le couvert bas.
- F3 : afficher la moyenne physique inchangée.
- Menu en haut ou flèches gauche/droite : comparer les dix modes au même endroit.
- S ou bouton Capture : enregistrer une image PNG et sa fiche JSON (style,
  centre, largeur, couches et source) dans `web/out/demo-sols/captures/`.
- Molette : zoom ; glisser gauche : déplacement ; 1–7 : échelles ; Échap : quitter.

Après `7` (vue de 10 m), continuer avec la molette pour examiner les textures
de plus près. Les boutons F1/F2/F3 sont aussi disponibles dans le panneau.

Le wrapper masque les arbres, les objets et les ombres du moteur. Le lanceur
omet les manifestes `--tree-assets` et `--vegetation-assets` ; il conserve les
textures PBR nécessaires au sol. Les chemins par défaut sont ceux du superviseur
local R4 ; `-Godot`, `-World`, `-Assets` et `-HeightBatch` permettent de fournir
explicitement d'autres fichiers locaux. Les fichiers manquants sont signalés,
sans téléchargement ni installation automatique.

Le paquet par défaut est
`web/out/surface/ground-cover-quality/retained-pages/packet.surfacebin`.
Il représente **un seul site source retenu**. Zoomer ou déplacer la caméra ne
génère pas un nouveau monde et n'apporte aucun sol fin observé : la répartition
multiscalaire est procédurale, contrainte par les champs physiques conservés.
La démo V15 n'est ni relancée ni modifiée par ce lanceur. Le centre est transmis
à `main.gd` avec `--x/--z` (le paramètre `--focus` du quality probe n'est pas utilisé).

Voir [la loi et ses limites](SURFACE_DETAIL_DISTRIBUTION.md).

Le [contrôle natif final de la démo](evidence/soil-demo-v2.json) passe sur le runtime
`a25881b` avec Godot 4.7.2 / RTX 4090 Forward+ : dix modes, neuf palettes
effectivement distinctes dans les uniforms, bascules R4/couvert/moyenne physique,
douze captures PNG + JSON, dont les vues de 40 m, 10 m et 1 m. Aucun changement
du paquet source ou des sept fichiers contrôlés, aucune erreur de script/shader.
Les appels des contrôles sont automatisés ; cela ne qualifie ni une fréquence
d'images interactive ni la qualité artistique. Les nappes de R4 restent trop
proches du camouflage. Un premier essai du wrapper avait révélé une erreur de
type du centre ; il est conservé séparément sous
`web/out/surface/ground-cover-quality/interactive-smoke/` et ne constitue pas
une réussite malgré son code de sortie 0.

Les effets de pinceau, d'encre et la mise en page finale du rendu web ne sont
pas reproduits par ces aperçus natifs. Render3D et Render3DBrush ne sont pas
présentés comme des styles supplémentaires de cette démo.

Dans cette démo, les palettes peuvent aussi afficher la distribution R4 du
sol et du couvert bas : F1 permet de comparer avec les aplats précédents.
Cette option reste désactivée dans les autres vues cartographiques. Le premier
contrôle technique passait déjà, mais ses cartes proches étaient presque
uniformes ; le contrôle final vérifie aussi des variations de pixels dans le
terrain, hors panneau, pour Parchment et Blueprint.

Palettes disponibles : `parchment`, `atlas`, `watabou`, `engraving`, `cadastre`,
`blueprint`, `illuminated`, `topographic`, `night`. Le wrapper peut proposer
leur cycle interactif ; ses boutons et son HUD décrivent les contrôles actuels.
Noter les observations dans [RETOURS_DEMO_SOLS.md](../../RETOURS_DEMO_SOLS.md).
