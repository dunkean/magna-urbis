# City parent stream — contrat de consommation et de stockage, ADR v1

Statut : proposition d'intégration réelle CityBench, aucune mutation produit. Le standalone sélectionné est déjà livré et ne satisfait pas ce chantier. Root seul compile/teste. Round6 possède backend/archives/admissions ; parameters_ui possède les consommateurs. Les types frontend ne seront écrits qu'après les signatures Rust annoncées stables.

## Contrat backend arrêté avec Round6

Capacité additionnelle `houses.native-parent-batch-1`, avec les capacités pair et Std existantes et getterpair cohérent. Les anciens plans/placements Single restent inchangés.

`POST /houses/plan-parent-batch` et `plan_parent_batch_json` prennent `{schema_version:'native-parent-batch-1',batch:PlanBatchRequest,prior_occupation:{land_parts:Surface[],roof_parts:Surface[]}}`. Les deux listes sont requises et complètes pour les droits réellement tentés. Réponse : même version, generator_version, parents `[ {plan,archive,attempt} ]`, refusals, open_spaces, materials et counts `{requests,admitted_parents,single_parents,assembly_parents,physical_members,refusals,open_spaces}`. `plan` est discriminé : `single{programme:ArchitectureProgramme|null,building:PlanBuilding}` ou `assembly{assembly:RetainedNativeAssembly}`. Les membres ne portent ni programme parent copié ni utile/ménages fictifs.

Archive parent native `{format:'native-parent-archive-1',sha256,payload}` : autorité lossless du MONDE Single aussi bien que du groupe. Aucune union/projection n'est un Single. `unpack-parent` retourne le plan discriminé ; `realize-parent` retourne `single{building_id,ground_z_m,architecture:HouseBatch}` ou `assembly{assembly:RealizedNativeAssembly}`. Nouvelle API bulk convenue : `unpack-parent-batch`, input `{schema_version,archives:[...]}` <=64/24MiB ; output `{schema_version,plans,counts}`. Strict unpack atomique, aucun constructeur/choix de source. Les quatre nouvelles routes et homologues Wasm prennent le lecteur Std. Pas de codec natif réimplémenté en JS.

Maxima natifs :64 demandes/128 membres,24MiB entrée/64MiB réponse,4096parties/262144sommets avant unions. La partition canonique fait partie de l'identité du générateur : phase1 finalise les Singles, phase2 tente les groupes en conservant tous les autres occupants finalisés. **Aucun retry output_budget qui replanifie un plus petit préfixe** : erreur entière, ancienne scène appliquée conservée. Préfixe canonique choisi AVANT appel selon demandes+contexte complets/octets ; jamais selon timing de réponse.

## Occupation entre pages, invariants d'admission

Index worker des feuilles exactes seulement : land = vrais corps/cours/circulation/features/contextes, roof = vrais roof_footprint, avec identités propriétaire/partie et ordre natif stable. Ni graphe résolu, archive ni maison complète ne survit pour le seul voisinage. L'index reste **O(feuilles de la ville déjà produites)**, pas O(viewport). Déduplication d'identité, jamais coordonnées ou préfixe de chaîne.

Query séparée pour chaque demande sur ses droits cadastre/buildable/roof_domain et accès, y compris hors caméra ; union des résultats d'index, pas grand AABB de64sites éloignés. Land et roof transmis séparément, pas de toit déguisé en land. Protection prior-group roof contre nouveau land DOIT agir dans les admissions de phase1 Single et leur recherche normale aussi, pas en rejet terminal seul. Tous membres et contextes réels des groupes deviennent voisins de la page suivante.

Le worker n'avance qu'après ACK ; le récepteur n'ACK qu'après source+index parent/membres durables. Une mutation d'index worker avant ACK n'autorise jamais la page suivante en cas d'erreur ; l'index est abandonné avec le run. Aucun redraw/RNG ajouté, ni abaissement de recherche/qualité.

## Stockage parent : version nouvelle, une autorité par scène

Proposé : manifeste `urban-native-parent-chunks-1`, distinct des anciens `urban-building-chunks-1`. Source durable = archives parentes uniquement + attempt/identité/comptes nécessaires ; la vue `plan` reçue sert à produire les enfants initiaux puis est libérée. Ni plan entier dupliqué ni proxy utile=0. Le groupe entier reste dans un record/chunk atomique, avec son programme une seule fois dans son archive.

`ParentIndex(parentId,parcelId,chunkIndex,parentRecordIndex,bounds)` et `MemberIndex(memberId,parentId,memberKey,chunkIndex,parentRecordIndex,memberOrdinal,visualRecordIndex,bounds,tiles)` sont des tables distinctes. Le premier membre peut avoir le même ID natif que le parent : la sélection est discriminée parent/membre et ne confond jamais les tables. Unicité des identités natives entre parents contrôlée, pas remappée silencieusement. Parent + tous membres/index sont écrits dans la même transaction que le chunk. CAS de génération active avant publication finale. Le progrès reste en demandes, indépendamment des membres.

Un batch logique déjà calculé peut être FRAGMENTÉ EN STOCKAGE sans replanification, par intervalles d'issues originales, pour respecter les bornes de relecture/bulk. Aucun parent ne traverse une frontière. Tous ses fragments sont durables avant l'ACK logique ; erreur ultérieure annule le stage entier, pas l'ancienne génération. Un parent trop gros pour la relecture native est refusé explicitement, jamais tronqué. Réponse native et découpe stockage ont des identités distinctes.

IndexedDB proposé : nouveaux stores parentScenes/parentChunks/parentIndex/memberIndex et cache enfant versionné ; méta active commune discriminée par format. Anciennes données/stores non réécrits. Le lecteur Single refuse le format parent explicitement ; le contrôleur CityBench choisit le lecteur par le manifeste. Aucun second "active" alternatif pour la même ville. Changement global DB seulement après tests du vieux format et nouveau CAS.

## Cache enfant / froid / rendu / détail

Projection membre dédiée compatible au renderer LOD générique, explicitement non réalisable : géométrie/cartographie/matériaux/sourceID/parentID/memberKey, sans resolved ni utile/domestic fictif. Rapports et programme conservés dans un résumé parent séparé, pas sur chaque membre. Circulation/contextes communs sont des enfants parent séparés, affichés/exclus des forêts une seule fois ; pas copiés dans les membres.

Dérivé jetable lié au SHA du chunk source et à chaque archive parente. Reconstruction/import : bulk unpack natif d'un chunk borné, index/projections dérivés de ces vrais plans, libération avant chunk suivant. Une absence de cache n'ouvre jamais l'ancien accumulateur global. Réparation série explicite ; fenêtre hit lit uniquement enfants/metadata et respecte budgets membres/sommets/octets/chunks. Source decode et plans natifs seulement pour sélection/détail ou import/réparation explicites. Coverage partielle/pending ne signifie jamais vide.

Picking carte renvoie aucun hit/pending ou parentID + membre natif explicites ; circulation/contexte peut s�lectionner le parent uniquement sur un vrai hit. Le fallback hors g�om�trie de la modale standalone n�est jamais r�utilis�. Détail charge l'archive autoritaire d'un parent, réalise Single ou groupe réel ; tout groupe est validé entier avant installation du détail des membres. Adapter les vrais volumes/meshes en géométrie de rendu dédiée, jamais construire un faux PlacedBuilding pour réutiliser nativeExteriorDetail. Export/import source stream garde l'archive exacte et les comptes parents/membres distincts ; import invalide ne remplace pas la génération active.

## Vrai raccord UI et compatibilité

Le bouton existant "Implanter les bâtiments" appelle automatiquement le nouveau chemin pour la génération native quand la capacité est présente ; backend tente les demandes compound réellement couvertes. Les Singles retenus en fallback gardent un statut/raison native distinct d'un groupe obtenu. Worker paginé ET fallback utilisent le même pipeline borné, puis vrai stage avant ACK et vrai retour d'état CityBench. Aucun second démonstrateur/modal.

État appliqué discriminé scène Single héritée ou scène parent ; aucune duplication des deux pour une ville. Compteurs UI : demandes terminées, parents admis, Singles/groupes, membres physiques, refus et issues ouvertes. Capacité habitante inconnue ; aucun ménage déduit des membres ou des m². Moteur ancien : lecture Single toujours disponible, génération héritée explicitement qualifiée sans prétendre résoudre les compounds ; aucune fausse réussite nouveau contrat ni downgrade silencieux d'une scène parent.

Comparaison,3D,édition/HouseBench et transferts globaux sont adaptés ou bloqués VISIBLEMENT pour une scène parent, avant tout appel au consommateur Single. Rien n'est perdu dans un cast/filtre. Decor/export/import et réglages URL/MU doivent conserver/qualifier le nouveau format : tant qu'un chemin n'est pas raccordé il refuse clairement, ne sauvegarde pas une ville sans ses groupes.

## Tranches de test root, sans clôture partielle du chantier

A. Contrats + client réel du batch + contexte land/roof + store parent atomique/bulk/import + protocoles. Cas4demandes = Single+Assembly(2membres)+refus+open : completed4, parents2, membres3. ACK bloqué/quota/annulation/CAS, output oversize sans retry. Rien n'est présenté comme raccord ville fini à cette étape.
B. Worker+fallback et bouton réel, nouveau state, froid/cache/index/2D/picking/détail/export-import, refus explicites des consommateurs non adaptés. Test API réelle -> ACK durable -> cold reload -> sélection/réalisation des vrais membres ; preuve navigateur/bench quand root l'autorise. Anciennes scènes et Core/eager conservés.
C. Matrix indépendante `_agents_blackboard/CODEX_CITY_PARENT_STREAM_REVIEW_SCENARIOS.md`, revue feasibility ; root seul tests/build/natif/serveur/browser. Pas de produit avant revue, chaque tranche isolée et gelée, patches trois voies frais, aucun Cargo/assets/locks remplacé par nous.
