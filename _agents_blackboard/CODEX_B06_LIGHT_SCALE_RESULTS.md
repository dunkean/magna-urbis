# B06 léger — auditeur et coût de transport/maillage C

23 octobre 2026. Audit hors ligne des sorties figées ; aucun natif, Cargo,
serveur ou navigateur exécuté. Aucun fichier produit modifié.

**La hausse porte surtout sur les features monde, pas sur l'archive native. Les
pièces sont également maillées en 3D lointaine.** Les 6 225 admissions sont
communes aux deux phases, sans gain ni perte ; 1 689 refus et 7 espaces ouverts
restent présents. Cette preuve de taille n'est pas un audit de faisabilité.

## Auditeur réutilisable

Nouveau fichier : `web/scripts/b06_light_scale_audit.mjs`. Depuis `web/` :

```powershell
node --import tsx scripts/b06_light_scale_audit.mjs --self-test
node --import tsx scripts/b06_light_scale_audit.mjs --before out/java-c-lintel-production-proof --after out/java-c-b06-light-proof --out out/b06-light-scale-comparison-proof
```

Le dossier de sortie doit être neuf. `--after` peut être omis pour inventorier une
référence ; `--skip-archives` et `--skip-triangles` omettent explicitement ces deux
mesures. Les quantiles sont de rang supérieur : p50, p95, max, avec somme et
effectif. Les recettes et bâtiments communs/gagnés/perdus restent séparés.

Le script vérifie les SHA des 124 payloads et sorties, l'ordre/exhaustivité des
7 921 sites, leur identité de corpus/header/bridge et le compte des voisins.
Il lit un lot à la fois et ne conserve ensuite que des lignes scalaires.
`before.json` / `after.json` contiennent les métriques par lot et par recette,
`*-buildings.json` les scalaires par bâtiment, `comparison.json` les cohortes et
deltas. Le manifeste gèle les fichiers de code utilisés et décrit chaque unité.

Les octets natifs proviennent des spans du JSON original : aucune réécriture
des nombres pour cette mesure. L'archivage est reconstruit avec le vrai
`archivePlanBatch`, puisque le runner CLI ne l'effectue pas. Les triangles sont
ceux de `compactBuilding` puis `eachBuildingTriangle`, en overview et en rendu
plein. Ce dernier est le **toit d'affichage compact**, pas un extérieur natif
réalisé. L'autocontrôle couvre octets/échappements, quantiles, triangles des
features en overview, séparation communs/gains/pertes. Il passe, ainsi que
l'inventaire complet de référence et la comparaison complète.

## Résultats exacts

Preuve : `web/out/b06-light-scale-comparison-proof/`.
Avant : `web/out/java-c-lintel-production-proof/` ; après :
`web/out/java-c-b06-light-proof/`. Les manifestes de ces sources restent intacts.

| Mesure, ensemble du corpus | Avant | Après | Écart |
|---|---:|---:|---:|
| Octets natifs des sorties complètes | 70 968 686 | 85 394 653 | +14 425 967 |
| Octets des bâtiments, hors valeur `resolved` | 35 826 836 | 49 567 417 | +13 740 581 |
| Octets des valeurs `structural_features` | 12 450 | 12 035 284 | +12 022 834 |
| Octets des valeurs `resolved` | 33 220 167 | 33 905 553 | +685 386 |
| Gzip des archives reconstruites | 2 054 510 | 2 125 745 | +71 235 |
| Deltas après archivage, JSON réencodé | 41 305 761 | 55 141 360 | +13 835 599 |
| Entrées d'occupation conservées par le bridge | 12 450 | 20 692 | +8 242 |
| Références dans ses cellules d'index | 15 330 | 24 430 | +9 100 |
| Références de voisins réellement retransmises | 442 | 615 | +173 |
| Octets des valeurs `neighbors` dans les payloads | 192 403 | 315 021 | +122 618 |
| Triangles 3D overview, tous bâtiments comptés | 186 984 | 519 890 | +332 906 |
| Triangles 3D plein compact, tous bâtiments comptés | 155 742 | 488 646 | +332 904 |

`resolved.features` reste vide partout. Les 8 242 nouvelles features se
répartissent sur **1 317 B06 parmi 2 207** : 5 268 posts, 1 317 frames,
1 487 enclosures (murs) et 170 portal_lintels. Elles comprennent 99 346 sommets
2D et 89 556 sommets 3D, comptés comme occurrences sérialisées. Aucun B14/B15 ne
reçoit de feature. Pour tous les B06, features p50/p95/max = **6/8/8** ; octets
visibles hors valeur resolved = **15 392 / 16 535 / 17 442** ; triangles overview
= **238 / 307 / 345**, contre **32 / 32 / 32** auparavant pour ces quantiles.

Les features seules produisent **332 902 triangles** dans chacun des deux LOD.
L'écart total de buffers potentiels est d'environ **23,97 Mo** selon le format
actuel de 72 octets par triangle, si tous ces bâtiments sont préparés. Ce n'est
ni la mémoire GPU réellement visible à une caméra donnée, ni le heap JS. Le
nombre de lots reste 124 ; delta réencodé p95 677 580 octets, max 756 884 ; sortie
native max 1 049 283 octets. Aucun seuil de transport n'est approché sur ce C.

Les 2 244 bâtiments bruts différents comprennent les 2 207 B06 et 37 autres
maisons. Pour ces dernières, les translations d'origine atteignent au plus
5,3533e−8 m et les altitudes 5,1969e−9 m ; angles, recettes/variantes, nombres de
corps et d'étages sont inchangés. Elles sont conservées explicitement dans
`non-b06-changes.json`, sans les appeler byte-identiques. Les petites différences
de maillage hors features restent comptées, pas normalisées.

## Limites et suite

Les sommes natives enregistrées sont 11 104 → 13 617 ms, soit +2 513 ms sur ces
passes uniques. Ce ne sont pas des mesures isolées ni un résultat de vitesse UI.
Le temps d'archivage Node est aussi fourni, mais utilise la voie asynchrone Node,
pas le gzip synchrone du worker navigateur : il ne compare pas la génération.

Le runner actuel suffit aux métriques de volume ; aucune modification requise.
Pour attribuer plus tard le coût natif, il faudrait des compteurs internes ou
des alternances dédiées, décidées séparément. Les mesures de FPS, heap, première
image, picking et résidence GPU demanderaient une preuve UI distincte.

La hausse 3D justifie de garder ce point visible dans le handoff rendu. Aucun
changement de LOD n'est implémenté ici et aucune pièce n'est retirée des droits,
des appuis ou de l'occupation. Voir également `CODEX_B06_LIGHT_SCALE_REVIEW.md`.
