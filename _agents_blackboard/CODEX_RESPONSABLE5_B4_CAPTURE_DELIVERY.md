# Responsable 5 — barrière de capture B4, proposition gelée

Livraison isolée : `web/out/responsable5-b4-capture-proposal/`, avec `manifest.json`, `proposal.patch`, README et configurations de tests. **Trois fichiers proposés, 13 tests purs préparés, aucun exécuté par cet agent.** Aucun produit, manifeste 52, contrôle, navigateur, serveur, fetch, préflight ou native/Cargo modifié ou lancé. La source du runner reste à son SHA de base ; les deux URL exactes et les anciennes comparaisons/provenances sont conservées.

Contrat consommé : evidence B4 v1, copie de référence incluse. SHA du gel B4 : `4317d26df999fddd4dd984bf688283acf234223c5f1016f9b9308c36f3ca0bc1`. Root rapporte 105 tests sur 11 fichiers et TypeScript réussis pour cette proposition B4, pas une validation navigateur. La réparation des anciens stores reste dans un autre lot ; B4 n’est pas promu.

Le helper pur commun sert à la fois au polling et à `assessCapture` :

- Compte peint `unknown`, absent ou mal formé : null et warning explicite, sans conversion en zéro ou en total global.
- Fenêtre exacte locale : source active, bornes du cadre courant, lecture terminée et troncature explicitement fausse. Elle peut devenir prête pendant que l’overview global reconstruit encore. Son calme dépend du cadre local stable, pas des changements de texte dus à la progression globale.
- Overview complet : statut prêt, fingerprint et cache connus, style/fond cohérents et transformation monde/canvas réellement observée. Un préfixe résident tronqué peut accompagner cette image complète ; il n’autorise ni picking exact ni conclusion « pas de maison ».
- Source, fingerprints, génération et cadre doivent rester stables pendant 900 ms ; transport, détail ou réception active réinitialisent la barrière. Vérification supplémentaire juste avant et après l’unique image primaire. Une capture partielle peut rester dans le rapport, mais jamais avec une fausse complétude.
- Le hook universel seul ne prouve pas une scène froide. La vue effective, l’entrée et sa génération de plans déterminent ce qui est attendu. Parcelles, Rôles, Usages, Tissu, silhouettes et pages sans plans restent des cas non froids légitimes. Une ouverture/réparation B4 sans viewport dans un cadre de bâtiments natifs attendu échoue explicitement ; une vraie ancienne page sans hook ni marqueur garde sa règle legacy.

Le snapshot observe uniquement l’API synchrone sans I/O, la vue active réelle, le style et le fond. Les totaux du manifeste et les enregistrements résidents restent distincts du compte local peint. Aucune capacité, matrice absente, identité de runtime ou classification des pixels n’est fabriquée.

Tests préparés : comptes inconnus, première vue locale avant overview, coarse complet avec préfixe tronqué, attente/inactivité, identité style/fond/cadre, générations et caméras périmées, reprise de travail réseau/détails, cas non froids positifs et absence froide négative. Ce sont des fixtures scalaires de contrat, pas de faux bâtiments natifs.

Root centralise les tests et la revue, puis décidera d’une éventuelle promotion après la réparation B4. La matrice de recette réelle reste `CODEX_RESPONSABLE5_FINAL_UI_MATRIX.md` ; tous les gestes UI y sont toujours non exécutés. CUA reste indisponible, sans contournement autorisé. Réservation de préparation rendue.

Mise à jour — root a validé les 13 tests purs, le typecheck strict hérité et les deux contrôles de syntaxe, puis revu les sélecteurs réels. Les seuls trois fichiers d’outillage sont maintenant promus aux SHA exacts après relecture des bases. Traces avant/proposé/après et patch : `web/out/responsable5-b4-capture-proposal/delivery/`. Manifestes 50/52, deux URL et gel B4 inchangés. Aucun test ni navigateur par le promoteur ; aucune source B4/B5 promue par ce lot. Les gestes UI et la campagne restent non exécutés. Réservation rendue.
