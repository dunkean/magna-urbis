# Bord du terrain : diagnostic des trous aux sommets

La sonde autonome `viewer-local/diagnostics/terrain_boundary_holes_probe.gd`
utilise le shader minimum natif Terrain3D, en remplaçant uniquement la couleur
du fragment pour mesurer la couverture et l'erreur de hauteur. Aucun fichier de
production n'est modifié. Le contrôle est une **fixture synthétique plane à
1 000 m**, pas un replay du terrain Magna V5.

Le shader natif transforme un sommet en NaN lorsque son contrôle porte le bit
« trou ». Tout triangle incident peut alors disparaître. Un rectangle de source
qui tombe juste avant une ligne de sommets grossiers peut perdre une bande
entière de triangles à l'intérieur de ses bornes.

## Résultats Forward+ / RTX 4090

Vue verticale 40 km, 2048² pixels ; même image de hauteur 1024², pas
77,972412109375 m, origine d'import −39 921,875 m, régions 256, maillage 32,
10 niveaux. Cinq lignes de pixels réparties dans le terrain sont sondées.

| Demi-largeur source | Masque | Sondes attendues absentes / 10 220 | Retrait de chaque bord |
| --- | --- | ---: | ---: |
| 19 960 m | Trous aux sommets hors domaine | 318 | 31–32 px |
| 19 960 m | Contrôles sans trous + discard fragment au rectangle exact | 0 | 0 px |
| 19 960,9375 m | Trous aux sommets hors domaine | 0 | 0 px |
| 19 960,9375 m | Contrôles sans trous + discard fragment exact | 0 | 0 px |

Les octets de hauteur importés sont identiques dans les quatre cas. L'erreur de
hauteur encodée sur les fragments présents reste nulle. Le retrait observé de
31–32 pixels vaut environ 605–625 m ; il correspond à l'ordre de grandeur de la
bande de ciel signalée dans V5. Mais le cas exactement aligné à
`256 * spacing` n'a aucune perte : le phénomène dépend de la phase des bornes.

## Comparaison aux paramètres réels V5 et limites

[v5-frame-phase.json](v5-frame-phase.json) extrait en lecture seule le monde
`72041dc7…` de `native-tour/stdout.log` et ses bornes enregistrées. Son origine
de rendu X/Z vaut 20 038,9862060547 m, son image de hauteur vaut **2048²** et son
pas vaut 77,972412109375 m. Les bornes source sont 39,0625–39 960,9375 m ; dans
ce repère local elles correspondent approximativement à −256,5 et +255,5 pas,
avec caméra à −0,5 pas. La phase est donc différente du contrôle aligné.

Le diagnostic prouve le mécanisme natif et son amplitude possible. Il **ne
prouve pas encore** la cause de l'asymétrie est ≈33 px / ouest ≈5 px dans V5,
ni une correction de production. Une éventuelle évolution doit conserver le
contrat des limites source, considérer l'union des parents et vérifier le
relief non linéaire au bord ; ce contrôle plan ne garantit pas que toutes les
interpolations frontalières restent identiques. Aucun décalage de source,
nouveau relief, changement de contrôle ou shader de production n'est livré ici.
