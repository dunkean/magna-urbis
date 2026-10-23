# Budget domestique : galerie native et lots obliques

22 octobre 2026. Suite ciblée de `CODEX_DOMESTIC_BUDGET.md`. Trois demandes inchangées du corpus bastide : labels 01/05/08, indices 0/4/7. Aucun serveur, ville supplémentaire ou build release. Les demandes, sortie avant, peintre et caméras figées sont dans `web/out/frontage-bastide-proof/complex-budget/`.

## Défauts établis

- Sur les sources avant cette passe, 01 = 25,433 / 129,4 m² ; 05 = 305,550 / 60,6 m² ; 08 = 76,669 / 116 m². Les trois sont admis.
- 05 est un Strip/RECT à un corps, passage et cour arrière, avec arcade native de 0,85 m, couverture et espacement des appuis déclarés. L'exclusion générale des galeries empêchait toute correction du budget. La réalisation détaillée ajoutait aussi les couvertures après le plan compact : le garde de toit révélait 12,937 m² absents de l'enveloppe retenue sur la proposition réduite. Ce garde reste intact.
- 01 : le rectangle aligné exactement à la rue est plafonné à environ 27,806 m² dans le modèle testé. Le grand côté du lot, décalé de 6,537°, permet une proposition proche de 79 m². C'est une piste géométrique, pas une admission ni une preuve d'impossibilité globale. 08 possède un petit décroché concave et deux segments distincts au même ID ; un calcul limité aux polygones convexes l'ignorait.
- Le raccord rectangulaire initial pénétrait toute façade oblique : avec 0,8 m de largeur et 6,537°, le triangle vaut 0,009167 m², supérieur au garde inchangé de 0,002 m². La correction aligne les extrémités du raccord sur la façade et le segment de rue, avec 0,8 m de largeur libre. Les extrémités doivent rester sur les segments et les deux côtés progresser sans croisement. Les coordonnées restent brutes ; les arrondir au millimètre déplacerait le raccord hors de sa ligne.
- Le contrôle de reprise de la galerie a révélé un registre `HouseUnit.levels` vide dans le chemin extérieur. Les IDs des corps étaient déjà identiques au détail. Les agrégats `UnitLevel` sont désormais reconstruits depuis les niveaux réels des corps ; cela permet au validateur inchangé de retrouver le niveau propriétaire de la couverture.
- Le contrôle des intérieurs a ensuite révélé un portail proxy différent de l'entrée native. Pour cette galerie reconstruite, `structural_access` fournit désormais le certificat d'entrée réel avant la pose, sans pièces ni mesh. Le raccord conserve exactement son ouverture ; la seule pénétration du corps autorisée est celle du passage natif retenu. Réserves, voisins et appuis restent interdits. L'enrichissement reçoit le même certificat et son garde d'identité reste intact. Les autres plans à entrée proxy n'acquièrent pas automatiquement cette garantie.
- La trace ciblée de 05 précise le second défaut d'accès : ouverture à y=14,339 sur le bord externe du lot natif, corps jusqu'à14,001 et passage jusqu'à15,127. La pose ignorait ce passage et en laissait0,58557m² hors site. L'enveloppe de pose inclut maintenant tout le passage certifié et déplace la maison entière ; ni l'ouverture ni le palier ne sont tronqués.

La cible01 possède aussi une limite démontrable dans la topologie conservée : lot156,1505m², fraction de cour0,2731989. Un corps de129,4m² exigerait178,0405m² avec sa cour, avant passage/toits ; même la borne basse de tolérance116,46m² exigerait160,2364m². Le plafond nécessaire est113,4904m² **avant** passage et droits de toit. Cela exclut la cible±10% pour cette topologie seulement ; cela ne démontre ni l'optimalité du résultat79,1245m² ni l'impossibilité avec une autre source. Calcul figé : `complex-budget/site01-area-bound.json`.

## Contrat restreint

L'opérateur garde les exclusions recette/variante/workshop imposés, strict, exact, emprise imposée, adaptation désactivée et fonctions non domestiques. Il conserve la recette, la variante, le seed, tous les corps, niveaux, matériaux, fraction de cour et largeur du passage.

Pour la galerie, seule la capacité native Strip/RECT arrière avec largeur 0,85 m, enveloppe fermée au sol, un corps et aucun autre programme structurel est ajoutée. Les corps et murs mitoyens sont reconstruits ; galeries, couvertures et appuis sont recréés par `add_structural_circulation` et `cover_galleries`, puis retenus **avant** les gardes du site. Aucun mesh, intérieur ou tirage supplémentaire n'est généré à ce stade. Une cour découverte d'au moins 1,8 m est réservée au-delà des bandes de galerie. Les autres galeries/cours composées restent hors capacité.

La recherche réalloue les mêmes quatre couples par front : deux largeurs dans l'axe de rue, deux dans l'axe du grand côté réel du lot. Les dimensions proviennent d'intervalles de demi-plans et de bissections scalaires bornées. Le hull d'un polygone simple sert uniquement de guide ; le plan entier est toujours admis contre le polygone original, ses réserves, voisins, terrain, accès et droits de toit. Les domaines avec trous gardent le chemin existant. Au plus huit couples et **24 validations physiques au total** ; aucun balayage de 80 modèles imbriqué. Le raccord oblique est activé uniquement pour cette passe automatique ; le chemin historique des autres placements est préservé.

## Vérification

Test ciblé `plans::tests::complex_budget_preserves_real_bastide_courts_and_native_gallery` **vert** sur compilation coordonnée. Il vérifie les angles droits, la conservation cour/passage/source/seed/niveaux, les droits du site/toit, les intérieurs et extérieurs de la galerie, la stabilité déterministe et l'identité des succès **ou refus** sous pin/strict/exact. Le garde d'entrée et le garde de toit restent actifs.

L'unique replay CLI final des trois demandes est terminé : **3 admis/0 refus**, mêmes recettes/variantes,31ms pour les plans seuls (mesure ponctuelle, aucun benchmark de ville). Planche après ouverte et comparée à l'avant, peintre et caméras identiques : les01/08 gagnent des rectangles plus larges sans biseau ;05 respecte son budget avec galerie couverte et cour encore ouverte.

| Témoin | Avant → après, corps m² | Cible m² | Cour découverte après m² | Recul après m | Extérieur / intérieur natif |
|---|---:|---:|---:|---:|---|
|01, B02 stone_walls|25,433 →79,125|129,4|27,568|0,718|OK / refus d'entrée proxy|
|05, B09 default|305,550 →60,601|60,6|9,578|1,226|OK / OK|
|08, B02 brick_walls|76,669 →116,001|116|41,560|0,562|OK / refus d'entrée proxy|

Les mesures donnent **zéro excès** des corps hors constructible, toits hors droits, intersection des réserves, et zéro sommet non orthogonal ; erreur angulaire maximale<3×10⁻¹²degré. Le recul05 augmente volontairement pour contenir le palier natif entier. Les IDs d'accès dupliqués ont été vérifiés par segments dans `frontage-segments.json` ; le segment le plus proche donne ici les mêmes distances que la première occurrence du rapport. La continuité bâtie et les droits de mitoyenneté ne sont toujours pas certifiés.

Les intérieurs01/08 refusent explicitement «Native interior entrance differs from the retained planning connection». Ce défaut préexistant des plans à entrée proxy n'est pas masqué par la réussite extérieure et n'est pas corrigé globalement dans cette passe. Le certificat natif livré ici couvre uniquement la galerie reconstruite. Les exemples ne prouvent aucune capacité de ménages ni qualité de ville entière ; les voisins source sont conservés, les maisons non sélectionnées ne sont pas régénérées.

Preuves : `web/out/frontage-bastide-proof/complex-budget/before/` et `after/` (`plans.json`, `metrics.json`, `contact-sheet.png`, après : `details.json`, `runtime.json`). Le runtime consigne SHA256 demande/peintre/exécutable/sources. `portal-diagnostic.json` et `web/out/complex-budget-diagnostic.log` sont des états intermédiaires distincts, pas le résultat final.

Commandes (exécutable DEV construit par le parent, aucun serveur) :

```text
# depuis rust/
target/debug/examples/plan_replay.exe ../web/out/frontage-bastide-proof/complex-budget/requests.json ../web/out/frontage-bastide-proof/complex-budget/after/plans.json --details ../web/out/frontage-bastide-proof/complex-budget/after/details.json
# depuis web/
node scripts/frontage-bastide-proof/run.mjs --out out/frontage-bastide-proof/complex-budget --phase after --render-only
```

Fichiers concernés : `houses/src/plans.rs`, `morphology.rs`, factorisation de `engine.rs` (le chemin extérieur gagne le registre natif des niveaux, géométrie et identités conservées), visibilité `pub(crate)` de `features::cover_galleries`, fixture `tests/fixtures/complex-budget-bastide.json`. Relecture indépendante : signe des demi-plans/pose, garde de 24 poses, absence de duplication des galeries ; le triangle du raccord oblique et la sémantique du certificat d'entrée ont été confirmés par l'agent java_sources.

**Livré, fichiers libérés.** Le petit défaut de cap d'accès oblique est corrigé et couvert par le témoin01 : ancien raccord refusé, raccord aligné au vrai bord admis avec pénétration<10⁻⁶m² et garde global inchangé. Aucune nouvelle feature ni modification urbaine dans cette livraison.
