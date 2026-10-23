# cbfa : recul géométrique constructif, proposition hors production

Le recul de `parcel-cbfa2d85b3057462` de **120 à 80,271110 m²** après respect des proportions n'est pas une perte géométrique nécessaire. Un témoin analytique conservant l'angle historique accueille **7,072 × 16,970 = 120,011840 m²**, dans les vrais droits et avec un chemin jusqu'à la rue. **Aucune admission ni génération native effectuée** : la porte réelle, les structures et le détail restent à certifier.

## Preuve limitée et reproductible

- Source `EUR-MED-B11`, variante `default`, trois niveaux conservés comme intention ; rapport autorisé `[5/12, 9/7]`. Le rapport proposé ≈0,416735 est conforme. Dimensions dans l'extension inspired existante `[5,18] × [7,24]`, sans étendre cet intervalle.
- Angle **−26,837093872975906°**, inchangé par rapport à l'ancien corps admis. Translation dans ce repère : **(−2,044280051 ; +3,594194485) m**. Origine monde proposée : **(7165,440881074023 ; 7955,047514969167)**.
- Le lot de 472,298906 m² est concave près de la rue. On intersecte ses droits exacts avec le demi-plan situé derrière l'ancienne façade. Le résultat est un **pentagone réellement convexe**, de 467,335059 m² ; tous ses produits vectoriels consécutifs sont positifs (minimum5,43788). Aucun contour convexe englobant ne remplace les droits.
- Pour ces dimensions fixes, cinq contraintes linéaires expriment l'inclusion du rectangle de toiture dans ce sous-domaine. Dix intersections de droites au maximum donnent le domaine des translations ; le point qui demande le moins de retrait est choisi. **Une seule proposition géométrique**, aucun balayage d'angles, dimensions ou poses natives.
- Toiture proposée avec débord **0,465 m**, observé sur l'ancien plan natif (débord déclaré0,464 + grille0,001). Sa validité pour le nouveau corps RF-STEEP-STEP reste à confirmer par la construction native.
- Chemin rectiligne de largeur **0,8 m**, conforme au connecteur actuel du plan : caps entièrement sur le vrai segment de rue et sur la façade proposée. Contact rue local **(1,318888374 ; −0,638924040)** ; les extrémités du cap occupent les paramètres **[0,235768 ; 0,369336]** du segment public. Aire du chemin3,389316 m².
- GEOS mesure **zéro** débord du corps/toit/chemin hors leurs droits, zéro intersection chemin-corps et zéro recouvrement avec l'occupation des requêtes précédentes de ce même corpus. Réserves vides dans cette requête.
- Audit raster indépendant : dénivelé **0,230104674 m**, pente maximale **1,521043761°**, sous les limites existantes0,75 m/12°. Pas de marge terrain ni de garde assouplie.

## Cause et contrat utile pour Opus R6

La façade publique principale ne fait que **5,989419 m** ; le lot s'élargit vers l'arrière. Le couple plus compact devient large au droit de la rue, alors qu'il tient après un retrait de3,59 m. Le parcours budgétaire actuel guide ses dimensions près de la façade et finit ici à **0 couple / 0 pose** après projection du rapport ; cet échec ne certifie donc pas l'impossibilité d'un bâtiment plus grand.

Le contrat de parcelle utile doit conserver séparément **droits du corps, droits de toiture, réserves/occupation et vrai segment d'accès**. La longueur de façade ne doit pas devenir une largeur maximale implicite du bâtiment dès qu'un retrait est permis. Le producteur peut proposer une translation calculée dans un sous-domaine convexe **certifié inclus dans les droits**, joindre le segment public et un corridor entièrement contenu, puis laisser Houses effectuer son contrôle natif exact. Le besoin de continuité sur rue reste une préférence explicite : ce retrait n'en est pas un certificat.

Pour un futur raccord, remplacer un créneau existant par cette proposition construite suffit à tester l'idée ; aucune multiplication de bâtiments d'essai n'est démontrée nécessaire. En cas de concavité restante ou d'absence de sous-domaine certifié, le calcul doit retourner *Unknown*, pas employer le hull ni conclure à l'impossibilité globale.

Le centre de façade utilisé ici est un **point de raccord géométrique**, pas une porte inventée. Il faut encore reconstruire la même source/variante/floors, vérifier son vrai toit, ses murs/appuis, sélectionner une entrée native cohérente et rejouer extérieur/intérieur. Le candidat récupère environ39,74 m² sur l'incumbent ; il ne démontre ni l'atteignabilité de la cible313,9 m², ni un optimum, ni une capacité de ménages.

## Contexte historique et voie généralisable

Le script de preuve emploie **le repère et la façade de l'ancien plan** pour établir la cause. Ce résultat historique n'est pas disponible au générateur courant et ne doit pas devenir une dépendance de production.

Deux contrôles hors ligne permettent toutefois de préparer une heuristique sans ID de lot ni ancien plan :

1. Le plus long bord des droits actuels mesure43,827767 m. Sa normale fournit l'angle **−26,837093872975366°**, égal à l'angle historique à≈5,4e−13° près. Son signe peut être fixé par le centre du domaine situé derrière le segment public sélectionné.
2. À cet angle, couper derrière le plus profond des endpoints des fragments déclarés du **même accès public** donne ici `y≥−0,561654689` dans le repère de comparaison. L'intersection réelle est convexe (six sommets, dont un collinéaire), de471,500114 m², et contient intégralement le toit du témoin ci-dessus. Cette ligne se déduit des entrées courantes ; elle n'emploie pas l'ancienne façade `y=0`.

Ces deux contrôles identifient un opérateur possible, **pas une politique universelle de découpe**. La sélection de l'accès doit conserver ses fragments distincts et certifier le contact sur un segment réel ; un simple ID partagé ne garantit pas leur continuité. L'intersection obtenue doit être explicitement testée pour convexité, trous et inclusion dans les droits. Le cas non convexe reste *Unknown*.

## Points de raccord existants (aucune modification)

- `rust/crates/houses/src/direct_convex_fit.rs` : `RectangleModel`, `Margins`, `solve_rectangle` fournissent déjà les demi-plans, contraintes rectangulaires et résultats avec vérifications natives encore requises. **`FixedFrontSite.front_y` fixe actuellement le retrait** : l'API ne résout pas telle quelle la translation libre en y démontrée ici. Une variante ciblée à dimensions fixes pourrait résoudre le petit domaine de translations, ou fournir un retrait construit avant ce solveur.
- `native_single_fit.rs` : `prepare`/`NativeSingleRectangle::solve` incarnent une solution numérique en une construction native. Leur scope et leur retournement du +y natif imposent une vérification avant réutilisation pour ce B11 déjà adapté ; ne pas remplacer son corps réel par ses dimensions nominales.
- `plans.rs` : `budget_front_rectangle` fixe une ligne proche de la rue et commence par borner le déplacement latéral selon la longueur de façade ; il ne propose pas le retrait nécessaire. `improve_domestic_budget` et `SourceAspectBudget` portent les bornes de dimensions/rapports. La réallocation d'un créneau devrait garder ces gardes et la limite globale, puis appeler le visual natif ordinaire.
- `frontage_contact.rs::solve`, `plans.rs::edge_capped_corridor` et les préparations d'entrée native fournissent les vrais contrôles de contact/caps. Le couloir proxy de cette note ne remplace aucun de ces certificats.

**Précision toiture : ce témoin est RF-STEEP-STEP, pas gable/hip.** Son rectangle de toiture est une hypothèse issue de la projection observée sur l'ancienne incarnation de cette même source. Le guide terrain en production reste limité à RF-GABLE/RF-HIP et ne prend pas B11 en charge. Aucun élargissement de ce garde n'est proposé par la présente preuve.

Artefacts : `cbfa_setback_probe.py.proposed` et `CODEX_CBFA_SETBACK_SCALAR.json` dans ce dossier, avec hash du script et des trois entrées figées. Aucun Rust, catalogue, serveur ou appel natif modifié/exécuté.
