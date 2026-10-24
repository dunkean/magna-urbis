# Assemblage natif explicite : livraison isolée

Aucun produit, Core, serveur ou navigateur modifié par l'auteur ; aucun build/test/natif exécuté par l'auteur. Root centralise toutes les exécutions. [ADR](CODEX_NATIVE_ASSEMBLY_ADR.md) et types réels sous `rust/crates/houses/src/native_assembly*.rs` dans les copies ci-dessous.

| Tranche | État exact |
|---|---|
| V1 | Compile ; 1/5 tests. Quatre échecs dépendaient du validateur final du positif ; conservée. |
| V2 diagnostic connexion | Géométrie native rejetée exportée en bits, explicitement **NON archive**. Point attendu seul différent de 1 ULP ; passage/contenance/connexion valides. |
| V3 connexion | **Root : 5/5 ciblés et 444/444 bibliothèque**. Aucun changement de la géométrie native V2 entière. Vrai archive→unpack→deux réalisations extérieures et intérieures. |
| V4 budgets/wrappers | Gel livré ; tests root en cours/à vérifier dans sa preuve. Aucun résultat anticipé ici. |
| V5 mêmes 22 cas | Gel livré, non exécuté par l'auteur ; aucune réussite/gain annoncé. |

La faute V1 était locale au validateur : `geometry::point()` re-snappait le midpoint mondial. Le connecteur natif produit un `Point` brut. V3 partage son calcul exact ; le témoin exige `4056da3d70a3d70b`, sans déplacer un membre/point stocké ni ajouter d'EPS. Les landings de vérification de même cause utilisent également des points bruts.

Le parent porte une seule fois programme/besoin/bilan ; ses deux membres sont de vrais plans natifs distincts avec source, variante, seed/config, archive, pose, ground et entrée conservés. Aucun parent union n'est un faux Single. La circulation de site appartient au parent : branche publique réelle et branche interne vers un cap réel de la première. Le contexte partagé commence vide ; une reconstruction de contexte non prise en charge refuse, plutôt que le supprimer. Les chemins restent des réservations natives au sol ; aucune rampe/assise/aptitude fonctionnelle n'est inventée.

`Assembled` fournit atomiquement vue d'assemblage, archive native lossless et rapport. `Retained` conserve l'ancien PlanBuilding entier. `unpack_assembly` et `realize_assembly` partent de la seule archive opaque ; la réalisation renvoie deux HouseBatch avec identités/fondations séparées et échoue atomiquement si un membre échoue. Brut mesuré par unions de vrais niveaux à altitude mondiale exacte ; utile réel et ménages logés inconnus. Sources, cibles et population inchangées.

V3 preuve : [root-verification.json](../web/out/native-assembly-connection-proof-v3/root-verification.json), [bibliothèque](../web/out/native-assembly-connection-proof-v3/root-full-library.json). Fixture positive native : `unit/plans__assembly__tests__native_assembly_positive_internal_archive_realize_fixture/positive-native-consumer-fixture.json`, SHA `12877052298c5d7d2d939b5b99d9b122dd28370916432ed214f03de9e07f5255`. Son **site est synthétique**, ses deux membres/archives/réalisations proviennent bien du natif exécuté par root ; ce n'est pas un gain Java observé.

Gels suivants et commandes reproductibles :

- [V4 README](../web/out/houses-native-assembly-wrappers-workspace-v4/README.md), manifeste `implementation-freeze-wrappers-v4.json`, SHA `cf9ca02ac500c1f524a0f759a64f8f6e33e80f185ccc16bfd78bece559ddce67` : 737 fichiers, 368 runtime, zéro dérive du snapshot produit. Six tests Houses, un local, un Wasm et contrôle wasm32 préparés. HTTP 32 MiB avant lecture complète ; Wasm avant parse ; Rust 24 MiB/4096 surfaces et polygones/262144 sommets avant unions, sans troncature. Limites administratives, aucune borne heap/temps GEOS revendiquée ; copies assemblage/archive/réalisation documentées. Chrono absent sur Wasm, pas de faux zéro.
- [V5 README](../web/out/houses-native-assembly-contract-workspace/README.md), manifeste `implementation-freeze-contract-v5.json`, SHA `efa54b59405814aea849edcb762e85bc56146626e921a2556c74fa699fd86c2e` : 894 fichiers ; runtime V4 figé identique, seul hook de test supplémentaire. Les 22 identités restent fixes ; 132 sorties et 20 requêtes complètes originales (~103 Mo) permettent le vrai voisinage antérieur, toits compris. Site/neighbours d'origine inchangés, aucun voisin synthétique/futur. Revalidation actuelle d'incumbents historiques, **pas un nouveau générateur ni une ville cumulative**.

Les anciens champs monde Single sont décimaux malgré leur compact local lossless : ils peuvent déjà perdre 1 ULP. Les 22 résultats enregistreront les bits reçus, la cohérence source-monde et les écarts/refus sans normaliser. Le driver JSON JS→vrai wrapper local, par binaire de test figé et sans serveur, garde tout fallback visible. Un positif natif direct ne prouve pas cette migration legacy.

Core/eager courant copié sans delta Core ; rebase du seul snapshot `programme.rs` tracée. Les locks isolés sont identifiés séparément de leur normalisation par Cargo. **Pas de promotion autorisée par cette note** : harness, données, driver et hook des 22 restent seulement en preuve, exclus du produit. parameters_ui possède le contrat consommateur/projection/cold/selection ; lod_finish sa matrice indépendante. Réservation auteur relâchée, disponible pour correction en nouvelle copie après verdict root.
