# B11 à pignons à redents — entrée native finale

Statut : audit de sources et des trois archives cbfa, sans modification de production, Cargo, génération native, serveur ni navigateur. Le moteur Houses 44999 reste figé pour Opus. **Le blocage observé est un périmètre de code, pas une impossibilité topologique démontrée.** Une extension littérale du Single final semble suffisante pour tenter le portail réel ; sa connexion à la rue à pose inchangée reste à valider.

## Témoin exact et cause

ID : `layout-f9dab5910f08a8a2/block-356ad6992b3b5b75/parcel-cbfa2d85b3057462/building`. Demande d'origine : `web/out/strip-initial-budget-proof/requests.json`, index 4. Automatique inspired/domestic, recette/variante/niveaux non imposés par l'utilisateur ; cible 313,9 m². L'archive résolue contient ensuite recette et tirages fixés : ces valeurs internes ne sont pas des pins utilisateur.

| Archive sous `web/out/` | Corps local réel | Aire | Niveaux |
|---|---:|---:|---:|
| `native-entry-existing-door-cli-proof/replay/primary-plans.json` | 5 × 24 m | 120 m² | 3 |
| `single-entry-terrain-cli-proof/replay/primary-plans.json` | ≈6,715 × 11,954 m | 80,27111 m² | 3 |
| `source-aspect-setback-cli-proof/replay/primary-plans.json` | 7,43 × 17,83 m | 132,47690 m² | 3 |

Les trois archives retiennent exactement EUR-MED-B11/default, RF-STEEP-STEP, un corps Ground/Walled/Single/FP-RECT à z=0 ; aucun vide, cellule, cour, chemin, feature ou contexte. Les trois niveaux ont la même empreinte. Épaisseur du vrai corps : 0,333 m ; débord : 0,464 m ; pente de toit : 25,801°. `entrance` est absent. Le modèle intermédiaire a encore des paramètres nominaux 9 × 12 : il faut donc consommer son `BodySpec`, jamais reconstruire une maison depuis ces dimensions nominales. L'ancien 5 × 24 reste un témoin historique de proportions corrigées, pas une forme à réintroduire.

`engine::single_native_entry_parameters` (`engine.rs:1128`) refuse **deux conditions** : toit limité à RF-GABLE/RF-HIP, détails limités à `masonry_joints`/`shopfront`. B11 porte `stepped_gable` et `party_walls`. Les autres conditions de ce témoin correspondent au périmètre Single existant. Ce même prédicat sert au préfiltre catalogue de `plans::retain_final_native_entry`, puis aux paramètres résolus et à chaque corps dans `prepare_foundation`. Il n'y a donc ni appel de préparation ni échec d'accès mesuré pour B11 aujourd'hui.

Le log `web/out/source-aspect-setback-plans-tests.log` confirme l'extérieur natif du dernier cbfa et un refus intérieur **après** la construction native : `Native interior entrance differs from the retained planning connection`. `realize_plan` a déjà exécuté l'enrichissement, sa validation et la vérification du toit avant cette comparaison. Les escaliers du modèle librement généré fonctionnent donc sur ce témoin ; la compatibilité du portail retenu avec la subdivision future reste un autre contrôle, encore absent.

## Ce que les pignons et les murs changent réellement

- `roofs::build` (`roofs.rs:2979`) utilise le même opérateur de pans pour RF-GABLE et RF-STEEP-STEP. `stepped_gables` (`:2325`) ajoute les faces verticales des redents et deux features `SteppedGable` à la cote du toit ; leur bande projetée mesure 0,16 m, centrée sur le bout d'armature (0,08 m de part et d'autre). Il n'ajoute ni palier, ni mur au rez-de-chaussée, ni route d'accès. Les paramètres natifs de toit et ces redents doivent rester présents au rejeu.
- Le trait `stepped_gable` appelle `features::roof_trait` (`features.rs:1892`), qui vérifie la compatibilité RF sans générer une seconde géométrie. `party_walls` (`:3400`) cherche un vrai mur/feature mitoyen ; sans côté déclaré, il diagnostique son absence. Il ne crée pas une mitoyenneté à partir du seul souhait urbain. Les features réelles restent interdites par les gardes Single actuels.
- `structural_unit` (`engine.rs:1401`) réutilise les corps/niveaux/épaisseurs exacts, puis supports et circulation native. Pour ce rectangle nu, il ne matérialise pas les murs de façade ou les pièces. `structural_access` (`access.rs:28`) emploie le vrai domaine intérieur érodé par l'épaisseur de mur et le constructeur commun de portails. Il ne dépend pas de la famille de pignon.
- Les murs explicites et les escaliers sont construits plus tard par `build_body` et `build_access_with_entry`. En particulier, `add_vertical` itère les pièces : une préparation sans pièces ne certifie pas les trois niveaux habitables ni leur escalier. Le rejeu intérieur doit retrouver le portail conservé dans les vrais murs découpés ; aucun proxy ne doit se substituer à cette preuve.

Ainsi, utiliser un modèle retenu est suffisant ; utiliser une unité native « déjà construite » ne l'est pas : `CompactArchitecture` conserve `BodySpec`, paramètres et surfaces, **pas** `HouseUnit`, murs, pièces ou graphe d'accès. Le raccord existant construit une seule unité structurelle pour le final. Construire tous les intérieurs pour récupérer les murs avant chaque admission ajouterait un coût systématique sans résoudre le contrat de raccord public.

## Plus petit changement proposé, non activé

Étendre uniquement le prédicat du **Single final avec entrée** : autoriser RF-STEEP-STEP et, dans cette branche de toit seulement, les littéraux `stepped_gable`/`party_walls`, en conservant toutes les autres conditions et le contrôle du plan retenu. Le catalogue actuel ne possède qu'une recette Single avec ce RF : B11. Ne pas élargir tous les détails ou toutes les features. Le wrapper `prepare_foundation_domains` sans entrée doit toujours refuser Single.

Le raccord reste celui déjà livré : une préparation structurelle depuis le même `ResolvedArchitecture`, une admission complète à la pose existante, archivage du vrai portail si elle passe. Aucun nouveau tirage, corps, dimension, angle, déplacement, alternative de porte ou slot de budget. Si préparation ou admission échoue, garder l'ancien admis, avec une raison explicite. Pins, variantes/overrides explicites, strict, exact, empreinte imposée et `parcel_fit=false` gardent l'ancien parcours.

Les droits du passage et du raccord public, les voisins, réserves, terrain, limites de fondation et toit restent autorités. Le portail canonique est choisi côté y local maximal par `structural_access` ; cela peut être le côté opposé à la rue dans une pose existante. Le raccord droit/coudé déjà borné peut encore refuser. **L'ajout de B11 au prédicat ne garantit donc pas le succès du cbfa et ne justifie ni déplacer la maison ni essayer d'autres portes dans cette tranche.**

Le coût additionnel est limité aux finals B11 éligibles : une unité structurelle, un graphe et une full visual, comme B15/B12 ; aucune nouvelle recherche parmi les modèles ni reconstruction de toit détaillé pour la préparation. Le coût réel reste non mesuré.

## Preuve minimale à préparer après accord

1. Consommer les trois `Resolved` ci-dessus sans les relabeller ; au minimum le dernier cbfa doit être essayé. Vérifier préparation supportée avec `native_features` vide et body/site entry identiques, puis visual à **transform identique**. Si le public raccord échoue, le conserver comme résultat physique, pas comme succès de whitelist. Comparer archive/source/seed/paramètres/corps/niveaux/pose exactement hors champ `entrance` ; traiter séparément la précision des anciennes projections mondiales comme dans les tests Single existants.
2. Pour chaque succès : archive → extérieur **et** intérieur, même portail réel et passage réservé, mêmes redents/armatures, mêmes trois niveaux ; identifier le mur réellement traversé et les paliers/escaliers. Contrôler aussi les bandes `SteppedGable` dans les droits/enveloppe du toit : leurs faces verticales ont une projection d'aire nulle, le garde des pans seul ne démontre pas leur couverture. Sur cbfa, le débord 0,464 dépasse leur extension 0,08, mais il faut vérifier la géométrie native.
3. Négatif ciblé : une réserve sur le palier natif externe doit faire conserver l'incumbent, même si le corps reste admis. Un vrai feature PartyWall/Post/context obstacle, une galerie, un étage décalé ou un toit non reconnu doit rester hors périmètre. Les limites de pente/fondation et les exclusions de pins/modes ne changent pas.

Aucun succès intérieur nouveau, capacité ménage, optimalité d'emprise ni taux de ville n'est revendiqué par cet audit.

### Empreintes des trois archives lues

Format retenu `compact-plan-1`, générateur `houses-3`, catalogue `atlas-houses-3`, sans conversion.

```
avant       e7ec261aee98582ab584f281a38274640a940eaa6c549930779866d6bb94ccfa
proportions 900398d7343b4e21957a834f83e030b8e35c687b9145a53f7b14b971c06e1da5
retrait     9f56b99d508f495065b6aed1dcfd896a524eb016af2f41ceb34dba90d588b232
```

La planche à caméra identique et son manifeste sont dans `web/out/cbfa-three-stage-geometry-proof/`, déjà relus par le parent. Le présent audit n'en modifie aucun artefact.
