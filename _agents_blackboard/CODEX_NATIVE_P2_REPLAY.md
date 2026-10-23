# Petits rejeux natifs sur les parcelles P2

22 octobre, source Houses courante compilée avec Round4 et début Round5. CLI sans serveur. Les entrées sont figées dans `web/out/p2-native-plan-proof`, avec hash de la capture et règle de sélection. Huit demandes domestic/mixed les plus proches du centre utilisateur, par moyenne des sommets cadastraux puis ID ; ce choix ciblé ne mesure pas le taux de réussite d'une ville.

`plan_replay INPUT OUTPUT --details REPORT` enregistre séparément les extérieurs et les intérieurs, sans conserver les meshes. Cette option refuse plus de16 requêtes pour éviter une réalisation globale accidentelle.

| Capture P2 | Plans | Temps plans | Extérieurs natifs | Intérieurs |
|---|---:|---:|---:|---:|
| 01-l, centre100k | 8/8 | 58ms | 8/8 | 0/8 |
| 04, centre romain5k | 0/8 | 32ms | aucun plan à détailler | aucun |

Sur01, les huit demandes sont des boutiques résidentielles, composition row, 2–3 niveaux. Sept intérieurs refusent la concordance entre l'entrée approximative du plan et le vrai portail ; le huitième ajoute une couverture native de galerie hors enveloppe. Les extérieurs affichés par le mode détaillé passent tous. Cette limite des pièces internes est distincte d'un échec d'affichage extérieur. Morphology traite actuellement la conservation de galerie/entrée sur le témoin bastide05 ; aucune généralisation à tous les intérieurs n'est déclarée.

Sur04, les huit demandes imposent encore courtyard/1–2 niveaux (sept boutiques et un tenement). Les échecs indiquent des minima de compositions autour de30–40m pour des domaines de12–27m, une composition sans opérateur ou une assise excessive. Ces résultats renforcent la nécessité du travail Round5/R sur les typologies et de la pré-admission native ; une silhouette qui rentre n'établit pas que le programme architectural demandé rentre. Les contraintes terrain n'ont pas été relâchées. Ce n'est pas encore un rejeu des futures typologies romaines corrigées.

Fichiers par cas : `*-requests.json`, `*-selection.json`, `*-plans.json`, `*-details.json`. Le prochain rejeu doit reprendre les mêmes sites si la source urbaine est identique, ou conserver explicitement les nouvelles entrées si Round5 change leur programme.
