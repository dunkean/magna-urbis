# Round 5 — revue indépendante des preuves conservées

23 octobre 2026. Lecture des JSON, code et images existantes seulement : aucun
serveur, navigateur, moteur natif ou Cargo lancé ; aucun fichier produit modifié.

**Le merge R5 est identifié, mais le cas romain exact et sa capture finale ne
sont pas encore validés par les artefacts du merge.** Les preuves R/P démontrent
des améliorations partielles ; elles ne doivent pas être présentées comme un
rejeu du merge commun avec les dernières maisons.

## Identité des situations

SHA256 du binaire lu sur disque, conforme à l'annonce :
`D:/opus-target/release/magna-urbis-local.exe` =
`fb8c41582bacaa1c62c7aaf7430f8e86474f63155a49458f2f605750eaf76966`.
Les 170 tests core + 12 intégration sont annoncés dans `OPUS_CITY.md` ; ils
n'ont pas été réexécutés ici. Ce binaire contient les maisons de 03:56 selon
la même annonce, pas la dernière livraison Houses.

| Archive | Centre de génération lu dans le JSON | Îlots / parcelles / quais | Portée réelle |
|---|---|---:|---|
| `web/out/r5-merge/04/` | 2000 / 2000 | 2 / 2 / 0 | Autre site, témoin de terrain défavorable ; ne valide pas le cas utilisateur. |
| `web/out/r5-merge/04real/` | **2640 / 2669** | 118 / 559 / 4 | Smoke du merge au centre arrondi. |
| `web/out/r5-roman/after/` | 2639,9315590685324 / 2668,943391372494 | 115 / 545 / 3 | Ancien stream R au centre fractionnaire, avec demandes et plans. |
| `web/out/roman-port-p/roman-after/` | même centre fractionnaire | 158 / 593 / 6 | Ancien stream P, avant/après port ; pas le merge final. |

La source utilisateur reste `_agents_blackboard/roman-user-options.json` :
`(2639.9315590685324, 2668.9433913724934)`, 5000 habitants, `roman-core`,
Parchemin/silhouettes. La dernière décimale du Y des anciens résultats diffère
d'environ 4,5e-13 m à la sérialisation. L'arrondi 2640/2669, lui, déplace réellement
l'ancrage de **0,088818 m**. Ce n'est pas seulement une caméra : la génération
peut bifurquer aux limites géométriques ; aucune équivalence n'est démontrée.

`04real` ne contient que layout, partition, SVG et PNG : **pas de demandes de
maisons, plans ou détails natifs**. Son enceinte compte bien 49 tours et
19 châtelets. Les 920/920 concernent `domestic.parcelCapacity/requested` ;
`builtCapacity` vaut 0 dans ce programme. Ce n'est pas une capacité habitante
prouvée par les maisons construites.

## Quais et rôle horreum

Le stream P documente réellement le déplacement des deux rôles vers des îlots
desservis par quai : 0/2 → 2/2, horreum 3961 → 2224 m². Ses JSON et planches
avant/après existent. Dans le merge arrondi, contrôle hors ligne du critère
`roles::quay_contacts` : horreum bloc9, parcelle **2602,85 m²**, contact **13,52 m** ;
emporium bloc11, **721,90 m²**, contact **7,73 m**. Les deux portent district `port`
et dépassent le seuil urbain de 4 m. Les quatre quais ont tous une largeur
déclarée de 4,5 m, longueur totale **116,71 m**. Cela confirme la desserte selon
le critère du producteur ; ce contrôle ne certifie pas tout le ruban sec ou
le futur bâtiment. L'ancien audit `roman-port-proof/shore-safe` certifiait huit
autres quais : sa preuve physique ne se transfère pas aux quatre du merge.

**Un rôle affecté ne prouve pas un horreum natif.** Les demandes anciennes R/P
épinglent encore `MED-ANT-B02` (Domus à atrium, rôle catalogue `dwelling`) pour
`storage.horreum`, tandis que l'emporium est `open_space`. Le horreum du stream R
est effectivement refusé : assise requise 1,123 m contre 0,750 m, pente 3,712°.
L'archive R entière donne 271 plans / 113 refus / 6 ouverts, version
`architectural-plans-1`. Il n'existe pas ici de résultat Houses du merge permettant
de déclarer le rôle portuaire construit ni de quantifier ses refus actuels.

## Images et prochaine preuve minimale

Trois images ont été ouvertes : `r5-merge/04real/city-04-mountain-bay-s.png`
est un dessin parcellaire SVG sans silhouettes ni fond de terrain ;
`roman-port-p/roman-after.png` est une planche analytique des rôles/quais ;
`r5-roman/roman-04-core-after.png` montre les previews et les anciens refus
rouges. Aucune des trois n'est une capture City Bench du merge final au centre
exact. La première ne peut valider angles des corps, cours ou rendu détaillé.

Pour fermer les TODO romains : rejouer **les options fractionnaires conservées**
sur un moteur commun identifié, conserver demandes/plans/refus avec occupation
continue, puis mêmes vues overview + cœur + port dans City Bench. Séparer
desserte du quai, allocation du rôle, bâtiment natif et capacité. Les TODO port,
typologie, équilibre et silhouettes doivent rester ouverts jusque-là. Les
preuves 01-l et Java100k du même merge ne figurent pas dans `r5-merge/` non plus
(seul 01-s y accompagne les trois essais04) ; les sweeps de capacité constituent
une autre preuve, pas ces captures.

Repères SHA256 : layout `04real` `10268b42…00532e39`, partition
`d9cffbbc…641508`, PNG `a133d1ad…53eb8` ; plans R
`24d85319…3fe6de19` ; layouts P `0419f7fa…dcfde81` ; options utilisateur
`85b5dcda…7453ea`. Les chiffres de cette note proviennent de ces fichiers,
pas de l'arbre core/UI en cours de Round6.
