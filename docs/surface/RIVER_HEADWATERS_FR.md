# Départs des rivières dans la vue texturée

Les lignes vectorielles conservées commencent au seuil d'aire contributive.
La largeur hydraulique à ce premier point vaut déjà couramment 19 à 31 m.
Le rendu des berges ajoutait un cap circulaire de cette largeur : la rivière
apparaissait immédiatement en gros tube ou en pastille sur le terrain.

`ground_water_masks.mjs` construit maintenant une empreinte d'apparence avec
une émergence progressive aux vraies petites têtes de réseau. La largeur
initiale est plafonnée à 0,60 m, puis rejoint la largeur conservée par un
profil smoothstep. La transition s'étend sur dix largeurs initiales, bornées
entre 100 et 420 m, et au plus 60 % de la longueur d'une ligne courte.
Les segments du départ sont subdivisés pour que la transition ne dépende
pas d'un premier segment exceptionnellement long.

Ce traitement exclut les entrants par les bords de carte, les sorties de
lacs/mer, les connexions à d'autres lignes et les gros débits initiaux
(aire dépassant deux fois le seuil). Les bras, distributaires et méandres
abandonnés gardent leurs largeurs. La topologie, les niveaux d'eau, les
positions retenues, les sections aval et les sources hydrologiques restent
inchangés. Ce profil est une règle d'apparence au seuil d'affichage, pas
une mesure de la largeur réelle d'une source. Aucune mare n'est inventée.

Le masque local `surface-river-footprint.png` est utilisé par la vue texturée
et par les informations N1–N4 qui en dépendent. Les cartes et SVG historiques
du Render de référence restent inchangés. Le descripteur voisin `.json`
enregistre le profil, le hash du réseau et de l'image et les têtes traitées.
La préparation réutilise les fonctions de largeur et de berges du worktree
Render original conservé ; elle ne modifie pas cette référence.

```powershell
node --test godot-render/tools/test_river_headwaters.mjs
node godot-render/tools/ground_water_masks.mjs
python godot-render/tools/ground_surface.py --workers 8
node godot-render/tools/validate_river_headwaters.mjs
python godot-render/tools/validate_ground_surface.py
```

Le préparateur accepte `--tile mountains--temperate`. Les tests couvrent la
progression de largeur, la conservation des sorties de lacs et connexions,
les entrants par les bords et le retour à la largeur aval des lignes courtes.
Le validateur contrôle les 42 masques et leur cohérence avec N1–N4.
