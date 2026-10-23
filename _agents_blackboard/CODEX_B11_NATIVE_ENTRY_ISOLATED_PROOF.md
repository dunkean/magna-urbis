# B11 — preuve isolée, non promue

État : seuls les fichiers de proposition ont été appliqués par le parent dans `web/out/houses-next-proposal-workspace/rust`. **Le workspace Houses et le moteur 44999 remis à Opus restent inchangés.** Cet agent n'a lancé aucun Cargo, serveur ou navigateur.

## Exécution et provenance

Le parent a exécuté les trois tests B11 puis les 50 tests `plans::` de la copie : tous passent. Les trois archives cbfa conservent leur vrai portail à travers les murs, leurs escaliers et les redents natifs. Deux poses sur trois passent le raccord public : ancien 120 m² et dernier retrait 132,477 m². Le modèle intermédiaire 80,271 m² conserve son proxy faute de raccord public ; aucun autre portail ni aucune pose ne sont essayés.

CLI isolé figé : `web/out/b11-native-entry-isolated-proof/plan_replay.exe`, SHA-256 `c786a95f5e995a0e3ce2529f0733e0dbbe9566b2de9737b1e51b3da6e554268e`. Vérifié avant exécution et par le runner après chaque appel. Baseline : `web/out/source-aspect-setback-cli-proof/replay`, CLI historique SHA-256 `44999adab6a61cc8420e2cb587ba1dfca3fe132b5595212155757085e17f8fac`.

Commande unique exécutée après GO :

```powershell
python web/scripts/native_entry_stage_proof.py --cli web/out/b11-native-entry-isolated-proof/plan_replay.exe --before web/out/source-aspect-setback-cli-proof/replay --output web/out/b11-native-entry-isolated-proof/replay
```

Le runner a lancé exactement trois processus natifs terminés : primaire 128 demandes, secondaire 128 demandes, huit témoins avec détail. Aucune répétition de mesure ni nouvelle ville.

## Résultats

| Corpus figé | Admis/refus avant → après | B11 | Entrées B11 avant → après | Reports B11 | Temps natif avant → après |
|---|---:|---:|---:|---:|---:|
| Primaire | 125/3 → 125/3 | 7 | 0 → 3 | 4 | 402 → 372 ms |
| Secondaire | 111/17 → 111/17 | 11 | 0 → 4 | 7 | 436 → 418 ms |

Les sept entrées sont obtenues à la **pose initiale uniquement** ; 18 préparations/18 validations de pose au total, aucune porte alternative. Les onze reports ont tous la raison `No unobstructed connection from the retained native portal to declared frontage.` Leur maison antérieure est identique hors diagnostic. Aucun défaut de préparation n'est masqué par un report de raccord.

Aucun admis perdu ou ajouté ; refus identiques ; aucun changement de source, variante, pose, aire utile ou architecture locale hors entrée/diagnostic. Les **218 bâtiments non B11 sont exactement identiques en JSON**. Les nouveaux passages sont tous contenus dans l'occupation exportée (plus grand résidu GEOS : `1,53e-9 m²`, sous le garde existant `1e-4 m²`).

Les huit témoins de détail passent 8/8 extérieurs et 8/8 intérieurs. **Ils ne contiennent aucun B11** : c'est une non-régression générale. La preuve des trois cbfa est complétée ci-dessous par un unique rejeu ciblé des six autres gains B11 : les sept entrées récupérées disposent désormais d'une preuve extérieure et intérieure native. Aucune capacité ménage n'en est déduite.

Les temps sont un seul relevé par version, avec cache/concurrence machine non contrôlés. Ils ne démontrent pas une accélération. Le changement ajoute un travail réel final aux 18 B11 et ne modifie pas les budgets de recherche.

## Circulations et occupations

Les nouveaux raccords peuvent être plus longs que les proxies précédents. Corps, cours et pose ne changent pas.

| Parcelle (suffixe) | Corpus | Circulation avant → après (m²) | Delta occupation totale (m²) |
|---|---|---:|---:|
| cbfa2d85b3057462 | primaire | 5,048 → 16,957 | +11,456 |
| 785bb2c6763d757f | primaire | 0,561 → 8,056 | +6,950 |
| 8cc9724878309b44 | primaire | 1,015 → 3,486 | +1,966 |
| a116cb0bb65d9de1 | secondaire | 0,561 → 1,123 | +0,010 |
| a875591dc3a1e16f | secondaire | 0,308 → 0,844 | +0,010 |
| 72189fa0df557518 | secondaire | 0,341 → 0,836 | +0,010 |
| bf2436397906ff13 | secondaire | 0,472 → 19,970 | +18,982 |

Delta d'occupation : +20,371 m² primaire et +19,012 m² secondaire. Ces deltas incluent le remplacement du chemin antérieur ; le rapport conserve séparément les surfaces nouvellement occupées et libérées. Les droits réels, réserves, voisins déclarés et terrain passent l'audit indépendant avec ses seuils numériques documentés. Il ne s'agit pas d'un « zéro résidu exact » : les maxima d'aire hors droits sont `1,06e-6` et `5,27e-5 m²`, tous deux sous `1e-4 m²`.

### Contrôle indépendant de toutes les paires

`audit_occupation_pairs.py` reconstruit pour chaque bâtiment la même occupation exportée que le bridge : union **corps + cours + circulation + features structurelles**. Il utilise STRtree pour éliminer uniquement les boîtes disjointes, puis GEOS sur les vraies unions, avant et après ; aucun index natif ordonné ni garde cadastral par lot n'est réutilisé. Seuil : `1e-4 m²`.

- Primaire : 125 maisons, 7 750 paires possibles ; zéro paire de boîtes candidates avant/après, donc zéro chevauchement.
- Secondaire : 111 maisons, 6 105 paires possibles ; quatre paires de boîtes candidates avant/après, toutes géométriquement disjointes.
- Aucun contact ou chevauchement préexistant, nouveau ou aggravé dans ces deux corpus.

La couverture des voisinages serrés est donc limitée : ce sont des échantillons espacés, pas un îlot dense complet. Le contrôle ne contient ni les maisons non sélectionnées ni les paires entre les deux échantillons ; il ne permet pas d'affirmer l'absence de conflits dans une ville entière.

## Complément : les six autres B11, sans nouvelle tentative

Après autorisation du parent, un seul appel du même CLI figé a pris les six demandes d'origine, dans leur ordre, avec `--details`. Le CLI ne sait pas consommer directement un `PlanBuilding` archivé : le script a donc conservé les six plans attendus et exigé **l'égalité exacte de tous leurs champs JSON avec la sortie**, avant d'accepter la preuve. Cette assertion passe pour les six ; l'absence des occupations précédentes du grand batch n'a donc changé ni la maison, ni son entrée, ni sa circulation. Aucune demande, voisin, droit ou seed n'a été modifié.

| Parcelle | Extérieur | Intérieur |
|---|---|---|
| 785bb2c6763d757f | PASS | PASS |
| 8cc9724878309b44 | PASS | PASS |
| a116cb0bb65d9de1 | PASS | PASS |
| a875591dc3a1e16f | PASS | PASS |
| 72189fa0df557518 | PASS | PASS |
| bf2436397906ff13 | PASS | PASS |

Planification des six : 35 ms, mesure unique. Réalisation extérieure : 0,36–0,64 ms par maison ; intérieure : 1,79–6,49 ms. Aucun refus, repli ou deuxième appel natif. Les contrôles indépendants droits/terrain restent verts.

`realize_plan` et l'enrichissement natif vérifient empreintes/niveaux, toiture, conservation du portail et validité du graphe d'accès. Le CLI n'exporte pas les meshes ni les identifiants de murs : ce résultat est une validation native, **pas** une nouvelle inspection visuelle ou indépendante des murs des six cas. Le test cbfa précédent fournit séparément ce contrôle explicite mur/portail/escaliers/redents.

## Audit final du bundle

L'audit utilise les hashes du `build-proof.json` figé, sans supposer que la copie isolée restera inchangée pour les propositions suivantes. La reconstruction du `engine.rs` de build à partir du fichier 44999 inchangé et du seul gate proposé retrouve exactement son SHA ; idem pour `plans.rs` avec le seul enregistrement du module `cfg(test)`. Les deux nouveaux fichiers sont le test et sa fixture. Aucune autre source n'a changé ; les fichiers actifs `engine.rs`/`plans.rs` correspondent toujours au manifeste avant proposition.

Le `Cargo.lock` isolé est réduit de 725 à 54 packages : aucune nouvelle version ni nouveau package, mêmes sources/checksums des 54 conservés. Onze enregistrements changent, dont sept seulement par désambiguïsation des noms de dépendances ; les quatre autres perdent des dépendances liées aux fonctionnalités du workspace plus large (`rand_core`, `subtle`, `chacha20/getrandom`, `serde`). Cela ne constitue pas une preuve d'identité de toutes les fonctionnalités de compilation avec le workspace complet. Les égalités de sorties mesurées et les tests sont les preuves fonctionnelles ; les temps ne servent toujours pas de promesse de performance en production.

Risques restants : onze raccords publics demeurent refusés, voisinages denses non couverts par l'échantillon, garde étroite à conserver sur les futures sources/traits, et intégration au workspace complet à valider avant promotion. Aucun obstacle supplémentaire n'est apparu sur les sept gains natifs. Les assertions physiques et les règles d'accès n'ont pas été relâchées.

## Artefacts

- `web/out/b11-native-entry-isolated-proof/replay/report.json` : trois exécutions, hashes, compteurs, audits droits/terrain, comparaison générale.
- `.../replay/b11-quality.json` : 18 B11 par ID, sept gains/zéro perte, raisons de report, circulations/occupations, fidélité des autres bâtiments.
- `.../replay/all-pairs-occupation-audit.json` : audit avant/après indépendant de toutes les paires, détails du broad phase et seuil.
- `.../analyse_b11.py` et `.../audit_occupation_pairs.py` : analyses reproductibles, lectures seules, sans appel natif.
- `.../replay_six_details.py`, `.../six-details/{selection,archive-identity,details,report,rights-terrain-audit}.json` : six demandes exactes, un appel figé, identité complète puis 6/6 extérieurs et 6/6 intérieurs.
- `.../six-details/bundle-audit.json` et `engine-gate.diff` : reconstruction vérifiée des sources figées et comparaison du lockfile isolé.
- `web/out/houses-next-proposal-workspace/b11-tests.log` et `web/out/b11-native-entry-isolated-proof/plans-tests.log` : preuve native ciblée et 50/50 tests du parent.

La proposition reste isolée et non promue. Elle démontre sept portails retenus supplémentaires sans modifier les maisons de ces échantillons ; elle ne résout pas les onze raccords refusés et ne certifie pas la capacité d'accueil.
