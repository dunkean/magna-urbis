# B12 : preuve de recette et limite d'entrée urbaine

23 octobre 2026. B12 seule est émise :265 recettes/418 styles ; les264 anciennes recettes sont identiques après sérialisation, B13 absente, urban-admission non réexporté. Sources et paramètres inchangés pendant cette correction de tests.

**Résultat du premier passage natif root :** les refus strict malgré pin, trois niveaux durs et site trop étroit passent. Les deux témoins positifs — minimum4,5×7m, et modèle exact deux niveaux malgré souhait soft quatre niveaux — passent le plan compact et l'extérieur natif. Ils échouent ensuite au garde explicite : `Native interior entrance differs from the retained planning connection. City plan preserved; detailed site admission is required.` L'enrichissement intérieur arrive donc jusqu'au contrôle de raccord de l'entrée ; il ne faut pas présenter la chaîne urbaine complète comme validée.

## Test corrigé, en attente de nouvelle exécution root

`tests/roman_data.rs` sépare désormais quatre faits, sans re-générer la recette :

1. Sérialiser/restaurer le bâtiment conserve le compact exact ; le rejeu extérieur conserve le corps et les deux niveaux, produit la toiture native et satisfait son contrôle de projection.
2. Décompacter ce même plan et appeler `enrich_architecture(&resolved)` doit réellement construire l'intérieur natif : première pièce RDC Shop, pièces supérieures Living, feature Stair présente et toutes les pièces reliées au root dans le graphe d'accès. Le Resolved initial reste identique. Ces usages génériques ne sont pas une restitution de taberna ni une capacité habitants.
3. Mesurer les vrais portails extérieurs de cet intérieur, transformés dans le monde, doit montrer qu'aucun n'est à moins de1mm de l'entrée conservée. `--nocapture` imprime le plus petit écart pour chaque témoin.
4. `realize_plan(interiors=true)` doit conserver **ce message précis de refus**, pas réussir ni échouer pour une autre raison. Ce test documente un blocage à réparer ; il ne l'ignore pas et ne relâche aucune tolérance. Les plans conservent domestic_units=0.

Commande root inchangée : `cargo test -p magna-urbis-houses --test roman_data -- --nocapture`. Aucun Cargo/serveur exécuté par l'agent. Aucun export admission avant le verdict de cette preuve.

## Portée d'une réussite

Une réussite de ces tests autoriserait à dire : **recette native compacte à deux niveaux, intérieur autonome constructible et extérieur urbain rejouable ; raccord intérieur urbain encore refusé**. Elle ne valide ni accès commercial indépendant, appartements, population ni entrée urbaine finale. La correction d'entrée automatique Strip de java_sources est un chantier voisin ; elle ne doit pas être annoncée applicable à B12 Single/pinnée/exacte sans preuve.

Le vérificateur CLI `prepare_roman_native_validation.py check` conserve volontairement son exigence extérieure ET intérieure urbaine réussies. Il restera rouge pour ces deux témoins tant que le raccord n'est pas corrigé. Ce seuil de livraison complète est distinct du nouveau test causal de recette ; il ne faut pas compter un refus connu comme une réussite complète. Les fixtures B13 deux/trois/quatre niveaux restent proposées, non exécutées et non émises.
