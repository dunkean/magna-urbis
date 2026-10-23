# Review #18 — palette compatibility, 2026-10-22

Corpus exact Opus : `web/out/city-replay/r2-01s/city-01-river-plain-s-placement-requests.json`,
642 sites. Aucun serveur partagé redémarré ou modifié ; aucune édition UI.

## Mesures bornées

| Mesure | Avant | Après cache |
|---|---:|---:|
| Sélection compatible, mêmes 642 sites | 126,02 ms | 3,57 ms |
| Planification native release, lot complet | 1 607,96 ms | 1 309,39 ms |
| Sérialisation native du résultat | non isolée | 61,09 ms |
| Résultat | 564 maisons / 74 refus / 4 libres | identique |
| Recettes::variantes réalisées | 12 | 12 |

Le replay HTTP **avant correctif**, sur :8795, donne **1 583,68 ms** :
1 536,38 ms avant en-têtes, 21,34 ms lecture, 25,96 ms parse, 6 435 857 octets.
Les 7 secondes de REVIEW #18 ne se reproduisent pas ici. Plusieurs compilations
et travaux natifs ont coexisté pendant ces mesures : la charge est une hypothèse
pour cet écart, pas une cause prouvée. La baisse globale 1,61→1,31 s ne peut donc
pas être attribuée intégralement au cache ; le coût de shortlist isolé baisse
d’environ 35×. Il représentait environ 8 % du lot avant correction.

Le résultat JSON natif complet et toutes les shortlists sont exactement égaux :
`2d107f16ff26d7f93a0f43d6e78357d6383f3d4d79fbf72ca9d2ae1e84d58e6e`.
Aucun candidat retiré, réordonné ou remplacé pour accélérer le benchmark.

## Modification

`style_index.rs` garde au plus **64 palettes compatibles**, clés limitées à
4 KiB, sous un mutex associé à l’index immuable (partagé entre requêtes natives).
La clé contient toute la configuration et toutes les facettes, excepté le texte
d’une graine valide. Les entrées ne retiennent que des indices de catalogue et
la requête effective. Aucun paramètre résolu, site, résultat géométrique ou
tirage pondéré n’est caché. Le corpus contient seulement 12 configurations
distinctes hors graine, donc ce cache se réutilise à l’échelle des quartiers.

Sur défaut de cache, la validation canonique et les contraintes de composants
restent inchangées. Les nombres non finis et graines invalides passent toujours
par cette validation ; en particulier `NaN`, sérialisé comme `null`, ne peut pas
réutiliser la palette d’un override absent. Les tirages des recettes/variantes
sont refaits avec chaque graine, dans leur ordre existant. Les pins utilisateur
gardent leur branche explicite dans `plans.rs`, qui n’a pas été modifié.

Un test ciblé passe : comparaison cache/voie sans cache sur 100 graines, changement
du nombre d’étages, refus de graine vide et NaN, éviction au plafond de 64.
Le replay intégral vérifie les valeurs de géométrie et les refus, pas seulement
les compteurs. L’exemple `city_plan_profile` permet de reproduire ces mesures.

## Coût restant et limites

La compatibilité de catalogue n’explique pas une régression stable 10×. Le reste
est essentiellement la résolution/adaptation, les essais de placement et leurs
contrôles géométriques, plus le stockage compact ; aucun profilage de pile ne
permet ici de séparer précisément ces sous-postes. Sur le passage individuel
après correctif, les 74 refus coûtent ~390 ms cumulés ; p50 1,80 ms, p95 7,71 ms.
Ces passages individuels n’incluent pas les voisins des autres sites du lot :
ils servent au diagnostic, pas à remplacer le replay de référence.

Attention : les timings **individuels avant** incluaient par erreur une copie du
corpus complet par appel ; ils ne sont pas utilisés dans les conclusions. La
mesure du lot entier, les shortlists et les SHA restent valides. L’exemple a été
corrigé pour le passage après.

Artefacts : `CODEX_PLAN_PROFILE_BEFORE_642.json`, `CODEX_PLAN_PROFILE_AFTER_642.json`,
`CODEX_PLAN_PROFILE_HTTP.json`. Le cache est dans les sources et l’exemple release ;
il sera disponible dans le serveur lors du prochain build coordonné par root.
Ce gain ne certifie pas encore la latence complète d’une ville de 100k ou 1M.
