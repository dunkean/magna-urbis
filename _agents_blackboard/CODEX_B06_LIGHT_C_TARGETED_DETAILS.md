# B06 léger V1 — preuve ciblée des détails du corpus C

État : prototype isolé, non promu. Cette preuve ferme le rejeu natif de douze
plans précis. Elle ne valide pas la sélection globale V1 : l'audit complet
signale séparément 96 cibles dégradées et environ 7 068 m² perdus par le repli
nominal nouvellement activable. Une correction typée V2 est en préparation.

## Sources figées et résultat

Corpus : `web/out/java-c-b06-light-proof`, comparé à
`web/out/java-c-lintel-production-proof`. Exécutable utilisé :
`web/out/b06-light-native-proof-full/plan_replay.exe`, SHA-256
`30be517bcd3c7649496c86e970b8792e19b91f97fe3cf9a69ad6ec991cc5eb0f`.

Les douze `PlanBuilding` rejoués sont **exactement égaux** aux objets du corpus
C expérimental, archives, source, pose, géométrie, structures, circulation et
diagnostics compris. Les douze extérieurs et les douze intérieurs natifs
réussissent. Aucun témoin n'a été remplacé après résultat et aucun portail
d'oracle n'a été injecté. Un seul appel CLI a été effectué par témoin.

Preuves : `web/out/java-c-b06-light-proof/C-targeted-details/{selection,report,audit-summary}.json`.
Chaque dossier de témoin contient les demandes source et contextuelle, le plan
de référence, les prédécesseurs, le résultat et la vérification d'égalité.
Le script est `web/scripts/b06_light_targeted_details.py` (SHA-256
`e9405e784f6a82f011724d66b3772fa8b98e5bd03e1c21b9cb07c433787b2e3e`).

## Échantillon déterministe et contexte

Les 7 921 demandes du corpus donnent 6 225 admissions, 1 689 refus et 7 espaces
ouverts. Sur 2 207 B06 admis, 1 317 acquièrent une entrée native, soit 59,67 %.
Ces 1 317 gains portent tous sur B06 ; aucune entrée antérieure n'est perdue.
Parmi eux, 1 173 conservent corps/toit et 144 les changent. Ces nombres concernent
les nouvelles entrées seulement, pas l'ensemble des changements du corpus.

Six témoins sont pris dans chaque groupe « corps/toit stables » et « changés ».
Les critères successifs sont : plus petite aire, plus grande aire, ratio le
plus proche de la cible, plus faible ratio, plus forte pente du raster sur le
corps, puis plus grand nombre de structures. Les égalités sont départagées par
l'indice source, et un témoin déjà choisi est retiré avant le critère suivant.
Les 29 gains sans cible d'aire positive restent comptés mais ne participent pas
aux deux critères de ratio. La sélection a été figée avant tout rejeu natif.

Indices retenus : 270, 292, 1262, 3465, 4497, 5154, 5723, 6733, 6859, 6946,
7426 et 7603. Aires : 6,995 à 686,472 m² ; pentes descriptives du corps :
2,270 à 11,953° ; dénivelés : 0,346 à 0,743 m. Tous portent quatre poteaux et
un Frame, avec ou sans linteau selon le portail réellement construit.

La demande originale conserve ses tokens JSON et ses voisins des lots
précédents. Une copie contextuelle y ajoute seulement les parties d'occupation
des prédécesseurs admis du même lot expérimental et pertinents spatialement :
corps, cours, circulation et toutes les structures. Les prédécesseurs complets
sont également archivés. Les douze demandes comportent au total cinq voisins
inter-lots originaux et dix-huit parties ajoutées du même lot. L'égalité exacte
du résultat avec C prouve ici que cette extraction a conservé le contexte
utile ; elle ne repose pas sur une tolérance géométrique.

## Limites

Le succès d'un intérieur certifie le rejeu des contrats natifs de ces plans,
pas leur adéquation au programme ni une capacité en ménages. Par exemple,
6,995 m² pour une cible de 48,3 m² reste une sous-occupation. Cette sélection
stratifiée ne permet pas d'extrapoler « 100 % des B06 détaillables » aux 1 317
gains. Les timings singleton sont descriptifs : médianes extérieur 0,577 ms,
intérieur 1,913 ms, hors lancement du processus ; ils ne sont pas un benchmark
de ville. L'audit indépendant global des droits et collisions demeure séparé.

La V2 doit donc conserver la géométrie gagnante de la préparation structurelle,
sans remplacer un meilleur budget par un petit nominal pour obtenir une porte.
Les preuves V1 sont conservées comme telles ; aucun résultat V2 n'est revendiqué
dans cette note.
