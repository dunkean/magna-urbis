# Préférence d’emprise nominale — sources rectangulaires

23 octobre 2026. Implémentation dans `style_index.rs`, validation native/intégration en attente root. Aucun changement de catalogue ni de géométrie.

Le programme de 99,3 m² pouvait choisir B12 en premier, alors que le dimensionnement initial borne cette recette à 71,5 m² nominaux ; B01 peut atteindre 108 m². La préférence compare uniquement les sources Single/RECT dont le corps simple est connu, **à rang de composition et d’étages identique**. L’intervalle nominal `largeur × profondeur × size²` est comparé à `[0,9×cible ; 1,1×cible]`. Ce calcul n’utilise pas l’extension inspired ×2 et ne prouve ni la capacité finale ni un placement.

Le groupe complet est tiré une fois par le RNG natif. Seules les positions des candidats simples sont permutées : compatibles d’abord, puis autres, avec ordre relatif stable. Les formes complexes/Unknown conservent leurs positions et les variantes déjà tirées restent exactes. La limite de quatre s’applique ensuite ; tous les candidats restent accessibles en repli dans l’ordre complet. B12 garde son ordre naturel pour une petite cible comme 50 m².

Activation limitée au chemin automatique inspired sans recette, variante, workshop ou quelconque override explicite, et sans contexte expérimental d’aire disponible. Sans cible, en strict/fantasy, avec contrôle explicite ou dans la voie expérimentale, cette permutation ne s’applique pas. Minima de pièces/escaliers, toit, fondations, accès et droits restent validés par le moteur natif.

Deux tests ciblés ajoutés : 32 graines pour ordre/prefixe quatre/variantes/positions complexes et sélection possible de B12 sur petite cible ; gardes strict/fantasy/pins/override/sans cible/contexte. `rustfmt` exécuté, aucun Cargo par cet agent. L’augmentation d’admissions ou d’emprise n’est pas encore annoncée ; root raccorde la preuve de plan existante.
