# Assemblage : lecteur Std scoped V6 livré, exécution root attendue

Gel : [README et commandes](../web/out/houses-native-assembly-std-workspace-v6/README.md), `implementation-freeze-std-v6.json`, SHA `a4afa52a1c8d4d03dc44b1bd9329c3da0d8cac262153ad124c8539f0fc121295`. 743 fichiers, 370 runtime, 145 includes présents. Aucun produit/build/test/natif/serveur/browser par l'auteur. V4/V5 intacts.

Le blocage V4 est conservé : 0/2 groupes au vrai wrapper, 25 feuilles de l'incumbent arrondies d'un ULP. V6 ne répare aucune coordonnée : les trois nouvelles routes prennent les **octets bruts** avant tout décodeur historique. Les lecteurs Std construisent les doubles des tokens décimaux puis désérialisent les types habituels ; anciennes routes, constructeur physique, gardes, archives et features Cargo inchangés.

Entiers i64/u64 exacts ; lexèmes au-delà de 64 bits lus en f64 et refusés par les schémas entiers. Grammaire JSON des nombres vérifiée, non-finis/overflow refusés. Les arbres de structure utilisent zéro/marqueurs : aucun vrai token flottant ne passe par l'ancien arrondi. Un Visitor unique-key refuse les doublons, même `id`/`i\u0064`, avant qu'un Value puisse les effacer. Chaînes/Unicode/objets ressemblant aux marqueurs et compact `$f64` restent intacts.

Bornes administratives : 32 MiB bruts, 64 MiB de longueur réécrite et 262144 slots flottants avant croissance/push ; aucun résultat tronqué. Ce sont des limites de transport et de complexité, pas une borne de heap ni de temps GEOS. Buffers, arbres, slots et décodage typé impliquent des copies réelles. Les budgets V4 et toutes les gardes physiques restent en place.

Capabilities : listes existantes `/status.capabilities` et `architecture_capabilities_json` annoncent `houses.native-assembly-std-json-v1` **et** `houses.native-assembly-pair-1`. Getter pair inchangé, aucune méthode getter supplémentaire. `parameters_ui` a confirmé ce gate avant lecture/essai. Schémas des payloads/archives/membres inchangés ; codec d'entrée distinct de toute certification.

Preuves préparées :

- Six nouveaux tests Std, dont signature native complète avant JSON, archive compact opaque byte-exacte, tokens témoins V4, bornes f64/subnormal/-0, grands entiers et erreurs typées, chaînes/échappements/Unicode/marqueurs, grammaire/overflow/budgets et doublons dans chacun des trois lecteurs.
- Douze tests Houses assemblage au total, un local et un Wasm-native ; contrôle explicitant que l'ancien decode garde son comportement, donc aucune feature globale cachée.
- Driver strict du **vrai dispatch local**, sans serveur : signatures complètes reçues comparées aux références natives émises avant parsing ; deux phases JSON natif et JS→JSON ; exige **2/2 Assembled**, archive native entière identique, unpack et deux intérieurs. Échec non nul après conservation du rapport si un fallback ou un écart demeure.
- Même driver compatible avec une **vraie instance Wasm nodejs** produite par root, comparant l'archive native entière et les deux intérieurs ; aucun mock. Signature interne non exposée comme nouvelle API produit. Les tests host/compile ne sont pas présentés comme preuve guest.

Le positif attendu est un site synthétique clairement identifié avec sources/constructeurs natifs réels, pas une mesure Java. Root doit exécuter avant tout constat public positif. JSON.stringify peut perdre -0 ; Std ne retrouve pas des bits déjà effacés. Les archives groupe restent seules autorités après construction ; aucune migration générale d'anciens Single n'est certifiée.

Résultat V5 séparé communiqué par root : 22 cas fixes, **un ajout réel B15** index3691/batch0057, +82,159908 m², détail deux membres réussi ; pas une ville cumulative. V6 ne modifie ni ce gel ni ses résultats, et n'extrapole aucun gain. Réservation auteur relâchée après handoff ; corrections éventuelles dans une nouvelle copie uniquement.
