# MED-ANT : pourquoi les huit centres P2 refusent

Audit sans modification Rust, 22 octobre 2026. Entrées et résultats figés : `web/out/p2-native-plan-proof/04-mountain-{requests,plans}.json`. Extraction indépendante : `roman-native-p2-facts.json` dans ce dossier. Un contre-factuel de huit demandes est isolé sous `04-mountain-role-counterfactual-*` : sept compositions de boutiques deviennent row, le tenement demande3–5 niveaux ; tous les autres champs sont conservés. Ce n’est pas un réexport Round5. Le code urbain évolue en parallèle.

## Diagnostic traçable

Les huit demandes sont automatiques, MED-ANT, inspired, taille1, sans pin ni typologie dure : **sept dwelling.shop/mixed, un dwelling.tenement/domestic, tous courtyard et 1–2 niveaux souhaités**. Parcelles constructibles de187,7 à682,6m² ; cibles bâties de79,1 à496,4m². Leur limite d’assise est0,75m.

1. **Les quatre essais excluent la seule petite maison.** `programme.rs:49/159` classe par composition puis étages ; `style_index.rs:432` épuise chaque classe avant la suivante. B02/B03/B05/B08 ont le rang(0,0) et occupent exactement les quatre essais. B04 a(0,1), B01(1,0). B11 a poids0. Ce classement suffit à expliquer pourquoi B01 n’est jamais essayé, indépendamment des graines. Le rôle dwelling.shop n’intervient pas dans ce classement.
2. **Row seul ne résout pas la sélection.** MED-ANT n’a aucun Layout::Strip : pour Row, toutes ses recettes ont le même rang de composition1. B01 revient dans le tirage, sans priorité garantie. B05 grec et B08 punique restent aussi possibles : aucun tradition_id romain ni mapping roman-core n’existe dans `cultural_palettes.rs`. Cela décrit le catalogue actuel, sans jugement sur tout emprunt antique.
3. **Défaut distinct des témoins/détails : une marge de présentation devient enceinte physique.** `layouts.rs:2087` construit plan.lot sur la bbox utile +6m de chaque côté ; `features.rs:90–122` place l’enceinte périphérique sur offset(unit.lot,-0,25). L’enceinte ajoute donc11,5m à chaque dimension du noyau, avant les autres structures/passage. Exemple exact : B02 nominal16×16 → témoin27,5×28,55 ; B04 nominal22×26 →33,5×38,55. **Cela ne cause pas directement les0/8 plans compacts** : `plans.rs:119` contrôle corps/cour/paths/plan.features, pas plan.lot ; les enceintes ne sont ajoutées qu’ensuite par structural_unit → add_structural_circulation (`engine.rs:1113`). Cette marge affecte les témoins, l’admission qui les consomme et le détail natif. Elle ne doit pas être confondue avec les minima des ailes/escaliers/cour des refus actuels.
4. **L’assise reste un vrai obstacle distinct.** Quatre messages finaux signalent des minima de composition trop grands ; trois une composition sans opérateur ; le dernier une assise excessive. Deux demandes conservent également la trace d’un candidat contenu qui échoue au terrain :1,030m et2,409m requis contre0,750m. Le cas tenement finit à2,611m. Aucune promesse de8/8 après changement du programme ou du lot.

**Contre-factuel exécuté :0/8 →6/8 plans,29ms.** Seuls sept souhaits courtyard→row et le souhait d’étages du tenement1–2→3–5 changent ; égalité complète des autres champs vérifiée. Les six acceptés sont B01 : deux default, deux flat_earth, un brick_walls, un adobe_walls, avec1–2 niveaux. Le shop suffixe58f7bf18 et le tenement91e3cc67 restent refusés ; le diagnostic final ne donne pas toute la shortlist et ne permet pas d’attribuer le premier refus à une absence de B01 avec certitude. **Les six budgets restent non satisfaits** : emprises35,662/108/41,486/108/108/108m² pour cibles289,1/183/79,1/496,4/361,4/392,4m². Aucun détail réalisé, aucune capacité déclarée. Résumé et provenance exacts : `04-mountain-role-counterfactual-{summary,provenance}.json`.

## Capacités natives existantes

Sept recettes, quatorze couples recette/variante. Toutes sont classées A et stylized ; les bornes ci-dessous sont des paramètres du générateur, pas des relevés archéologiques. La colonne témoin désigne **un minimum natif figé**, pas une preuve universelle pour chaque pose/grainage ou opérateur adaptatif.

| Recette | Corps / composition / niveaux | Bornes nominales largeur × profondeur | Témoin défaut complet | Adaptation existante |
|---|---|---|---|---|
| B01 maison maçonnée | 1 rectangle, Single,1–2 | 5–9 ×7–12m | 5,5×7,7m | Rectangle ; variantes brique/adobe/terrasse |
| B02 domus atrium | 4 ailes, Atrium,1–2 | 16–24 ×16–24m | 27,5×28,55m | Template natif seulement |
| B03 domus péristyle | 4 ailes + galerie, Peristyle,1–2 | 22–32 ×24–36m | 33,5×36,55m | Template natif seulement |
| B04 insula | 4 ailes, Courtyard,3–5 | 22–34 ×26–38m | 33,5×38,55m | Cour bornée, corps/escaliers conservés |
| B05 maison grecque | 4 ailes + galerie, Courtyard,1–2 | 16–24 ×16–24m | 27,661×28,711m | Template natif seulement |
| B08 maison punique | 4 ailes, Courtyard,1–2 | 16–24 ×16–24m | 29,62×30,67m | Cour bornée |
| B11 villa | 3 ailes en U + galerie,1–2 | 22–32 ×24–36m | 33,5×31,55m | Explicite, poids0 ; template natif |

Source déclarative : mapper lignes241–251 ; profils `house-recipes.py:49,74–79,151`. Les stoa/B06, basilique/B07, halle/B09 et rotonde/B10 du mapper sont marquées non résidentielles et **absentes des recettes Houses**. B01 ne possède pas de shopfront natif ; B04 déclare boutiques en RDC, ménages et escaliers, mais impose quatre ailes. Il n’existe donc ni petite taberna autonome ni petit tenement rectangulaire3–5 niveaux dans ce pack. Six des sept cibles de boutique dépassent108m², maximum nominal de B01 à taille1 : l’utiliser ne certifierait ni ces budgets ni leurs ménages. Les adaptations inspired restent à tracer explicitement.

## Contrat à transmettre à Opus

### Pourquoi108m² revient, et ce que cela autorise vraiment

Pour B01 à taille1, **108m² =9×12 est la borne nominale déclarée, pas la limite de toutes les adaptations inspired**. `plans.rs::initial_ground_programme_dimensions` (1128–1199) borne actuellement la première demande dimensionnelle à ces plages : quatre des six plans conservent exactement108m². Le moteur autorise déjà, en parcel_fit inspired, jusqu’à×2 par axe (`engine.rs:699–719`). La recherche après admission emploie bien cette permission (`plans.rs:1993–2006`) : pour B01 sans passage ni cour, plafond théorique18×24=**432m²**, et non108. Dans le contre-factuel, aucun nouveau candidat de budget n’a passé les gardes ; le premier plan admis a été conservé. Ce constat distingue un plafond initial trop prudent d’une impossibilité géométrique après pose ; le rapport ne permet pas d’attribuer les échecs de chaque proposition à un seul garde.

Les cibles183–392,4m² restent donc dans cette permission artistique inspired, sans garantie de pose, de terrain, de fonction boutique ni de ménages. La cible496,4m² dépasse même432m² : au mieux87,0%, elle ne peut atteindre la tolérance actuelle de±10% (minimum446,76m²). En strict, la permission×2 ne s’applique pas ; en pin/exact, les choix explicites restent prioritaires. La taille utilisateur ne doit pas être augmentée silencieusement.

B01 déclare un seul corps : aucun opérateur n’autorise à en fabriquer plusieurs pour annoncer une insula. B04 conserve ses quatre ailes et3–5 niveaux ; il peut répondre à un véritable programme d’insula si le site convient, mais ne devient pas une petite boutique. B02/B03 demeurent des programmes de domus. Une allocation de plusieurs maisons indépendantes demanderait plusieurs sites/programmes urbains autorisés, pas une multiplication cachée dans Houses. Le préfiltrage proposé est détaillé dans `CODEX_DIRECT_STYLE_SELECTION.md` ; il distingue impossibilité prouvée et opérateur non encore couvert.

Conserver les champs existants, sans pin automatique ni override dur d’étages :

| Programme émis | Choix source Houses proposé, à implémenter |
|---|---|
| dwelling.shop ou commerce.shop / mixed / row / floors[1,2] | B01 : enveloppe de maison sur rue, diagnostic « usage mixte demandé, boutique complète non certifiée » |
| dwelling.house / domestic / row ou detached / floors[1,2] | B01 et ses variantes cohérentes |
| dwelling.tenement ou dwelling.insula / domestic / courtyard / floors[3,5] | B04 seulement si admis ; aucun remplacement silencieux par une petite maison |
| dwelling.courtyard / domestic / courtyard / floors[1,2] | B02/B03 ; conserver les cours voulues |

Ce serait une liaison de rôles exacts vers les sources existantes, exportée pour l’admission core ; pas un remap EUR-MED, ni un filtrage culturel implicite déduit des mots des labels. Pin/variante/house_config/strict/ère restent prioritaires. Les choix explicites grecs/puniques demeurent accessibles. Pour un petit tenement sans cour, le manque de recette reste explicite tant qu’aucun programme sourcé n’est ajouté.

## Prochaine tranche Houses : trois actions bornées

**A — Correctif d’enceinte à préparer séparément, pas traitement prouvé des0/8.** Nouveau helper possible `urban_enclosure_lot` ; raccord après résolution et avant certification structurelle native, avec ajout des vraies structures au domaine contrôlé. Un changement isolé de plan.lot avant visual ne suffirait pas. Scope : automatique inspired, enceinte périphérique simple, aucun programme de cour compartimentée/enceinte centrale/shell/structure spéciale. Proposer une seule variante du lot, sans toucher paramètres, corps, niveaux, cour, galerie, matériaux ni seed. Calculer le rectangle contenant l’espace architectural utile réel — corps/niveaux, cour, chemin, structures, projection de toit — puis la garde nécessaire à l’épaisseur de l’enceinte, son inset et au passage, au lieu du +6m. Conserver le portail réel, recalculer son attache et invalider toute entrée mémorisée de l’ancien lot. Les gardes natives complètes et le rejeu extérieur/intérieur doivent certifier le résultat ; si la circulation ne raccorde plus les portes, refuser. Ne pas utiliser le polygone parcellaire comme dessin d’enceinte ni supprimer la structure pour faire rentrer. Aucun code préparé tant que le raccord de certification n’est pas convenu.

Cette adaptation est locale au plan urbain : strict/pins/exact et les417témoins d’admission restent inchangés. Les domaines du cache natif ne doivent pas être discrètement réinterprétés ; une future variante de témoin urbain demanderait sa propre identité/version/export. Aucun changement global layouts/features proposé dans cette tranche.

**B — Liaison exacte rôle→sources et présélection utile.** Ajouter les liaisons du tableau dans un registre partagé/exporté ; filtrer les contraintes canoniques, puis classer selon le budget réellement atteignable avant de construire. Une B01 plafonnée à432m² ne constitue pas une solution à496,4m² ; une cour sans certificat paramétrique ne devient pas impossible pour autant. La voie directe couverte et la recherche bornée existante doivent être comparées, avec conservation du meilleur plan réellement admis et de la diversité compatible. Une enveloppe de petite maison peut répondre partiellement à un usage mixte, pas être annoncée équivalente à une insula. Budget et ménages non satisfaits restent visibles. Voir `CODEX_DIRECT_STYLE_SELECTION.md`.

**C — Preuve ciblée après raccord.** Le contre-factuel initial est livré ci-dessus ; reprendre ensuite les huit sites avec leurs programmes Round5 réellement réémis, et distinguer gain de sélection, gain d’enceinte et refus d’assise. Deux fixtures supplémentaires suffisent : cour inchangée avec enceinte rapprochée et accès/rejeu conservés ; même source pinned/strict inchangée. Aucun besoin d’une ville entière pour valider A/B.
