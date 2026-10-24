# Compounds — carte bridge/archive/UI, diagnostic initial

Statut : lecture seule du produit ; aucune interface native inventée. Round6 définit le contrat natif Houses. Root compile et teste. Les SHA observés sont dans `web/out/compound-bridge-audit-v1/observed-bases.json` ; ce relevé ne vaut pas gel cohérent d'implémentation ni allowlist de promotion.

## Contradiction à résoudre

Aujourd'hui `PlacementBatch.buildings` est simultanément la liste des résultats admis par requête, la liste des objets dessinés, l'index de stockage, et l'entrée de réalisation Single. `PlanBuilding` natif a un `CompactArchitecture` unique. Un assemblage multi-membres aplati dans cette liste casserait le compte de requêtes et recopierait le programme parent. Le remplacer par une silhouette union ferait perdre les vrais membres et leur source. Aucun de ces raccourcis n'est proposé.

## Adaptateur borné proposé (noms à confirmer avec Round6)

- Une enveloppe versionnée contient des résultats parents distincts des membres. Un parent = une requête / un résultat de programme ; Single reste inchangé sur son ancien chemin. Un group possède son identité, la liste ordonnée des vrais membres, le contexte collectif natif et le seul programme_outcome agrégé. Aucune déduction de ménages depuis le nombre de membres/corps.
- Les rendus utilisent les géométries natives de chaque membre. Leur projection reçoit des références scalaires explicites `parentId`/`memberId` ; elle reste un DTO non réalisable. Parent et membre sont sélectionnables séparément, sans changer la demande lors de la navigation entre membres.
- La projection parent garde les seuls rapports attestés ; les projections membres ne portent aucun clone de besoin/ménages parent. Comptes explicites et séparés : parents admis, membres natifs, corps retenus. Tous les totaux stream/ACK se calculent par résultats parents.
- L'archive conserve le vrai groupe/contextes natifs ; aucune fabrication d'un `resolved` Single. Réaliser un membre nécessite l'archive native de son groupe et son identifiant réel ; aucune source extraite d'un DTO. La réalisation de groupe/membre doit être exposée par le contrat natif Round6.
- Ancien import Single toujours lisible, aucune migration autoritaire. Nouveau contrat nécessite une capability native explicite vérifiée local/WASM avant génération et réalisation ; ancien moteur => erreur claire avant appel, jamais fallback Single silencieux.
- Parent/membres restent dans la même unité atomique de transport/stockage. Limites parents ET membres/octets vérifiées ; groupe trop gros refusé explicitement, pas coupé en requêtes indépendantes. Rien ne construit ou clone toute une ville.

## Points d'intégration réels

| Chemin | Contrat actuel / action nécessaire |
|---|---|
| `rust/bridge/urbanArchitecture.ts` | DTO Single seulement ; ajouter types séparés après signature Round6. Éviter union permissive ou cast DTO vers PlacedBuilding. |
| `rust/bridge/architecture.ts` | `/status` capability actuellement cachée ; nouvelle demande explicite doit être vérifiée sans ancien résultat emprunté. WASM inspecté avant méthode. `realizeUrbanBuilding` résout un seul compact puis `realize-plan` : ajouter route vraie groupe, pas appel enrich Single. |
| `rust/bridge/architectureBatch.ts` | 64 requêtes/24MiB, ACK backpressure, clone d'un seul delta ; voisins des lots suivants issus des membres + contexte collectif exact une seule fois. `summary.buildings += batch.buildings.length` devient compte parent explicite pour nouveau chemin. |
| `compactPlanArchive.ts` | Archive 64 résolus Single `compact-plan-1`, 32MiB brut et cache 8MiB/2archives. Nouveau codec/référence groupe distinct, préserver l'ancien ; aucune décompression ville entière. |
| `urbanSceneProtocol.ts`, `urbanSceneProgress.ts`, `urbanScene.ts` | Worker/progress/accumulateur/commit doivent transmettre compte parents et membres et la version ; cold stage avant ACK inchangé. |
| `urbanBuildingChunkStore.ts` | `buildings+refusals+openSpaces == progress delta` et `recordIndex` visent Single. Nouveau parent record unique, index spatial membre avec parentRecord/memberIndex ; lecture sélection renvoie contexte groupe authentifié borné. Native chunks/export anciens non réécrits. |
| `urbanBuildingChunkIndexedDb.ts` | Index durable id/recordIndex ; version du schéma/adaptateur distincte nécessaire pour id membre et parent, sans invalider DB ancienne. |
| `urbanBuildingProjection.ts`, `urbanBuildingDerivedCache.ts` | Enfants immuables sans resolved/volumes/archives. Aujourd'hui `metrics.buildings == projection.buildings.length == parents`. Séparer parents/membres et lier les rapports aux parents ; version dérivée nouvelle et réparation série depuis parent natif exact. |
| `urbanColdVisualWindow.ts`, `urbanColdWindowLod.ts`, `urbanColdCityViewport.ts` | `recordIndex` doit chercher un membre réel, budgets compter tous membres/vertices/octets ; pending/truncated ne signifie jamais vide. DTO sélectionné conserve identité parent/membre ; pin d'un contexte groupe borné. |
| `urbanColdCitySession.ts`, `urbanBuildingReadController.ts` | `readBuilding`/pin renvoie actuellement un Single+archive ; ajouter résultat typé groupe/membre, annulation/revision et bornes intactes. |
| `urbanBuildingDetails.ts`, `city3d.ts`, `city3dMeshes.ts` | Réalisation/detail identity compare membre réel + groupe/source/version ; aucune conversion globale et aucun faux `PlacedBuilding` parent pour réutiliser un renderer. Les vrais membres utilisent renderer Single si native fournit réellement ce contrat. |
| `cityCanvas.ts`, `terrainUrban.ts`, `urbanBuildingsPanel.ts`, `cityInspector.ts` | Picking membre + sélection parent ; UI demande/résultat/composition attestée distincte, besoin parent une seule fois ; inconnu pour anciennes données sans preuve. |
| `decorFile.ts`, `urbanColdDownloads.ts`, `urbanSnapshot.ts` | Export/import stream exact et traduction preview seulement ; préserver bytes/groupes, pas clone ville complète ni perte de contexte. |
| `architectureEdits.ts`, `urbanColdCityEdit.ts` | Édition actuelle impose remplacement Single. Dans tranche initiale, refuser clairement édition partielle d'un group tant que remplacement transactionnel complet non implémenté ; ne jamais éditer un membre isolé en oubliant circulation/voisins communs. |

## Tests à préparer dès contrat natif reçu

1. Ancien Single archive/stream/import/export/réalisation inchangé ; demande groupe sur ancien local/WASM refuse avant zéro appel générateur.
2. Deux parents (Single + compound3membres), un refus et un espace libre : progress4, parents2, membres4, programme parent jamais multiplié. Ordre/seed/identités conservés. Groupe trop gros => erreur avant ACK, ancien committed intact.
3. Archive groupe roundtrip exacte (incluant -0) et mismatch parent/membre/archive/seed/source refusés ; vrai member realize utilise contexte groupe, pas DTO.
4. Durable stage->cold cache->window : trois membres visibles, parent outcome unique ; budget incomplet => pending, pas vide. Lecture/pick membre et montée au parent, détail natif vérifié.
5. Export/import du nouveau format intègre group+sources exactes ; anciennes archives lisibles. Mauvaise version => erreur explicite sans mutation. Cache dérivé ancien réparé sériellement ; annulation n'active pas une scène partielle.
6. UI choisie : parents/membres/corps distincts, utile/brut au parent attesté seulement, capacité inconnue ; sélection membre ne déplace pas son programme et n'infère pas la grammaire depuis N corps.

Aucune fixture fabriquée comme preuve native. Fixtures structurelles de protocole doivent être nommées synthétiques ; preuve admission/source/archive nécessite sortie réelle produite par root depuis le futur harness natif Round6.
