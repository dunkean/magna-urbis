# Ciblage des preuves CPU et transport

Ces rapports mesurent le transport des plans natifs conservés et la préparation
CPU. Ils ne qualifient ni le rendu de toute la ville, ni ses FPS, ni une navigation
live. Les fichiers source ont été lus sans modifier les dépôts principaux.

## Ville native complète : 6 683 bâtiments

[native-city-6683-transport.json](native-city-6683-transport.json) porte sur les
6 683 plans architecturaux existants, 236 140 triangles et 39 matériaux. Le cache
source a conservé son SHA-256
`78b9a0eb1d19bb9c553dcf632af113f8e16c0cd32347e1bec93a889f78facd92`.
Le roundtrip a été comparé sur le DTO urbain complet, les identifiants, les niveaux
natifs et le catalogue de matériaux, avec égalité exacte.

| Cas de transport | Manifeste JSON | Payload typé | Binaire total |
|---|---:|---:|---:|
| Ville seule | 13 567 344 octets | 30 957 152 octets | 44 524 512 octets |
| Ville + 100 000 candidats de stress | 16 557 231 octets | 35 157 152 octets | 51 714 400 octets |

La limite du manifeste est **16 MiB = 16 777 216 octets**. Le second cas passe avec
une marge de seulement **219 985 octets**. Les 100 000 candidats sont un input
synthétique de transport ; ils ne constituent pas une preuve de population
physique générée. Il s'agit d'une enveloppe **urban-only** : un monde terrain
complet, davantage de métadonnées ou des identifiants de candidats plus longs
peuvent dépasser la limite. La qualification d'un paquet full city-world ne peut
pas être déduite de ce résultat.

Le test avec toutes les comparaisons a pris 14,319 s. Le pic RSS observé est de
**1 488 461 824 octets, soit environ 1,49 GB** ; ce nombre décrit le processus de
validation avec plusieurs représentations en mémoire, pas la taille du paquet ni
une garantie de budget mémoire en production. Les métadonnées de bâtiments et
d'occupation représentent respectivement 7 476 773 et 6 081 024 octets ; ce sont des
pistes pour une future réduction réversible du manifeste, sans changement du
transport dans cette livraison.

## Noyau cubique et préparation CPU

[cpu-packed-sampling.json](cpu-packed-sampling.json) compare l'ancien noyau avec
la branche PackedFloat32 optimisée, sur un paquet réel de raffinement teacher :
64 échantillons par côté, espacement source 0,625 m, sourceLOD -6. La préparation
settled reste **512 x 512, quatre régions Terrain3D**, avec son alignement 256.
La mesure donne 2 667,258 ms avant et 2 437,241 ms après, soit 1,094x sur ce run.
Les images height et control complètes ont des octets identiques. L'espacement
d'affichage 0,3125 m reste une interpolation, pas une amélioration de la
résolution source. Aucun GPU n'a été exécuté pour ce benchmark.

La parité du noyau a aussi été vérifiée sur 4 048 points, coutures et combinaisons
bilinéaire/cubique, et 4 030 comparaisons PackedFloat32 contre le chemin Array,
avec NaN et infinis : erreur double nulle et résultats Float32 identiques.
La représentation garde le clamp natif Terrain3D 1.0.2 de 0,25 à 100 m.

L'ancien résultat MIN256/une région est **retiré** : le test d'octets CPU ne prouvait
pas l'alignement de `import_images`. Il ne doit pas être présenté comme une
optimisation valide. Le correctif d'alignement est `7b0785a` ; l'optimisation exacte
PackedFloat32 est `dc11d36`.

Les empreintes des copies de rapports et leurs empreintes LF normalisées, stables
entre checkouts Windows/Linux, figurent dans [SHA256.json](SHA256.json).

## Prochaine étape de transport, sans implémentation dans V4

Une archive UTF-8 typée et réversible **par record** pourrait déplacer les grandes
métadonnées hors du manifeste. Les identifiants, la représentation native/proxy et
les bornes resteraient accessibles ; les autres champs seraient décodés à la
demande après le culling. Archiver toute la ville dans un seul bloc imposerait de
la parser entièrement avant de sélectionner les bâtiments visibles.

La déduplication des niveaux ou métadonnées devrait exiger une **égalité exacte**,
et non un identifiant commun : l'occupation acceptée et un overlay visuel peuvent
porter des états différents. Des colonnes UTF-8 avec offsets Uint32 pour les IDs
de candidats constitueraient une autre option pour réduire les quelque 3 MB du
manifeste de stress. Chaque évolution demanderait un format versionné, des bornes
mémoire explicites et des tests de roundtrip conservant niveaux, matériaux,
styles, clés opaques et identités source. Le transport de ce lot reste inchangé.
