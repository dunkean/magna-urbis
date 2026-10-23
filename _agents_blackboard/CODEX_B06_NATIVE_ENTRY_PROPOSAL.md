# Entrée B06 : verrou de portée et structure à préparer

État : lecture de code et proposition cfg(test) seulement. Aucun fichier produit/copie active ni Cargo modifié/lancé par l'auteur. Les trois témoins proviennent de `web/out/b06-adapted-minima-isolated-proof/` :22,784m²,219,781m²,465,300m². Leurs extérieurs passent ; leur détail intérieur est construit mais `realize_plan` refuse ensuite le raccord proxy.

## Cause précise

`engine::single_native_entry_parameters` exclut B06 à deux endroits : `elevation_family != "ground"`, puis les détails `four_master_posts`, `high_central_pyramid`, `open_sides` hors whitelist. Pourtant le support exécuté est **Ground, hauteur0** et le plan Single/RECT à un niveau. Le préfiltre dans `retain_final_native_entry` retourne donc le plan proxy avant toute préparation : aucun échec de passage ou de terrain n'a encore été constaté par cette voie.

Le garde ne doit cependant pas être élargi par les seuls libellés. `structural_unit` construit corps/niveaux/supports/circulation structurelle ; il ne construit ni les quatre poteaux de ce tag, ni ses pans ouverts. `generate_unit_from_plan` appelle `features::add_details` avant l'accès :

- `four_master_posts` appelle `posts` : quatre positions25/75 % du vrai plancher, ellipses0,14m, exclusions de passage ; ces solides doivent être conservés.
- `open_sides` coupe les murs extérieurs aux côtés locaux+y et+x, puis ajoute un linteau `Frame` en tête. Ce n'est pas une décoration neutre pour l'accès.
- `high_central_pyramid` appelle `roof_trait` : contrôle du RF existant, sans nouvelle géométrie par cette branche.

De plus, la préparation Single actuelle refuse toute structure supplémentaire. La preuve d'entrée doit donc porter les vrais poteaux/pans/linteau avant d'élargir ce contrat.

## Test diagnostic borné prêt

`_agents_blackboard/proposals/b06_native_entry/canonical_detailed_entry_probe.rs.proposed` est un enfant cfg(test) de `plans`. Il consomme les trois JSON natifs copiés et hashés à côté, sans résoudre une nouvelle recette ni redimensionner.

Pour chaque témoin : un enrichissement complet sert **uniquement d'oracle de test** ; sélectionner son seul portail racine canonique max-Y déjà construit ; conserver murs réellement coupés, poteaux et linteaux ; former assise/occupation/solides réels ; appeler le `visual_with_front_access_prepared` ordinaire à la pose inchangée. Aucun autre portail, aucun déplacement et aucune recherche de dimensions ne suivent. Le résultat extérieur/intérieur est rapporté séparément. Un zéro succès reste un résultat utile, pas une raison de changer les gardes.

La seule injection contourne le préfiltre d'éligibilité dans la préparation éphémère du test. Droits buildable/cadastre/toit, réserves, voisins/occupation, passage complet, assise et pente restent contrôlés. Les structures doivent rester dans le corps retenu ; un élément inattendu fait échouer le probe. La circulation/les features exportées doivent couvrir toutes les parties d'occupation contrôlées.

Registration proposée dans la copie autorisée :

```rust
#[cfg(test)]
#[path = "D:/workspace/self/magna-urbis/_agents_blackboard/proposals/b06_native_entry/canonical_detailed_entry_probe.rs.proposed"]
mod b06_canonical_detailed_entry_probe;
```

Filtre `plans::b06_canonical_detailed_entry_probe`. `MAGNA_B06_ENTRY_PROOF_DIR` peut désigner un dossier neuf pour exporter les plans/rapports, sans écrasement.

## Proposition de production à décider après cette preuve

Une seule finalisation à pose constante, avec conservation du plan admis après tout refus. Scope structurel étroit : Single/RECT, un corps/un niveau, Ground0, sans cour/route verticale/enclos/programme spécial ; aucun pin/strict/exact élargi. `platform` serait accepté uniquement comme métadonnée dans ce tuple concret, jamais comme preuve de support.

La voie légère doit partager avec le détail les primitives du mur extérieur, des quatre poteaux et de `open_sides`, sans construire de pièces ou toit mesh. L'extraction du mur extérieur devra reprendre exactement `build_body` (domaine moins retrait mural), puis appliquer le même opérateur de pans ouverts. Les murs restent dans `site_solids`; leurs surfaces déjà incluses dans le corps ne doivent pas être omises physiquement ou confondues avec un enclos extérieur. Poteaux et linteau doivent apparaître dans les structures contrôlées/exportées, à leurs vraies hauteurs. Le replay détaillé conservant la porte devra prouver l'accord exact.

Cette préparation toucherait aussi les témoins de squelette si elle est branchée dans `structural_unit` : comparer/exporter explicitement les profils/cache concernés, sans promettre une identité inchangée. Aucun appel à l'enrichissement complet ne doit entrer dans la planification produit. Coût attendu borné à un corps, quatre poteaux et deux pans, mais aucun coût en millisecondes n'est encore mesuré.
