# Pagination native des sites — préparation après handoff A3

## Implémentation core livrée après A3 LANDED

`building_sites.rs` et le wrapper `Terrain::urban_building_sites_page` implémentent maintenant l'index numérique décrit ci-dessous. Les tissus sont résolus **au premier site demandé**, puis conservés par partition/bloc/culture ; les index de contacts sont partagés par layout. `prepare` vérifie les références des allocations, sans géométrie copiée, preview, grille terrain ou payload construit. Le collect legacy utilise le même `request_one`.

API finale (les signatures de principe plus bas sont remplacées par celle-ci) :

```rust
pub const MAX_SITE_PAGE_SIZE: usize = 64;
pub const MAX_SITE_PAGE_BYTES: usize = 24 * 1024 * 1024;
pub struct SitePage {
    pub total: usize, pub offset: usize, pub next: usize,
    pub requests: Vec<serde_json::Value>, pub required_bytes: Option<usize>,
}
impl BuildingSiteIndex {
    pub fn prepare(layouts: &[Layout], partitions: &[Partition],
        selected_partition_indices: &[usize]) -> Result<Self, String>;
    pub fn total(&self) -> usize;
    pub fn page(&mut self, seed: &str, layouts: &[Layout], partitions: &[Partition],
        surface: Surface<'_>, water_level: &[f32], architecture_culture: Option<&str>,
        offset: usize, limit: usize, max_bytes: usize) -> Result<SitePage, String>;
}
```

Le budget porte exactement sur **le tableau JSON `requests` UTF-8, crochets et virgules inclus**. Le comptage utilise un writer sans allouer une seconde copie sérialisée. `next == offset + requests.len()`. Un candidat hors budget laisse `next` sur ce candidat et renseigne `required_bytes` avec la taille de `[candidat]` ; un candidat seul au-delà de 24 MiB est une erreur explicite avec son ID. Aucun payload candidat n'est conservé entre lectures : un rejeu ou une reprise après budget court recalcule au plus ce candidat. Les entrées physiques restent immuables pendant la vie de l'index ; le runtime lie celui-ci au handle, seed, culture et sélection.

Validation ciblée : `cargo test -p magna-urbis-core urban::building_sites::tests --lib --no-default-features`. La fixture non vide comporte deux partitions, 12 sites émissibles, jardins omis, espaces ouverts conservés, adjacences hors page, fallback frontage, programme A3 et terrain. Pages de 1/7/64 identiques au JSON collecté, budget court/rejeu/offset terminal, sélection et seed/culture changés, validation anticipée des références ; un compteur de test vérifie zéro construction à l'ouverture et aucun suffixe au-delà de la limite. Cela vérifie le transport et ses invariants, **pas un gain chronométré sur 100k ni la qualité visuelle A3**.

**Constat par lecture, aucune mesure ni validation A3.** Les handles de `local/src/urban_session.rs` conservent déjà les `Arc<Vec<Layout/Partition>>` et invalident les révisions avant remplacement. Ils évitent le renvoi des gros objets depuis le navigateur. Mais la branche `buildingSites` de `local/src/main.rs` appelle toujours `urban_building_sites_with_culture`, puis `building_sites::requests`, qui fabrique **tout le `Vec<Value>`** avant de répondre. Une simple découpe de ce résultat ne réduirait ni le délai initial ni son pic mémoire.

## Découpe proposée

Extraire le corps actuel de la boucle d'allocation en `request_one`, sans réécrire sa géométrie. Créer un index léger une fois par snapshot et sélection de partitions ; il contient des **indices**, jamais des clones de polygones ni des références auto-référentes. Le runtime garde les Arc existants. La préparation fait un passage sur allocations, parcelles et adjacences, plus le coût de construction des index, sans `occupation_preview`, recherche d'enveloppe, échantillonnage terrain ou JSON de requête. Ne pas appeler `requests(...).skip(offset)` ni reconstruire les index complets à chaque page.

L'ordre émissible est une liste `(partition_index, allocation_index, parcel_index)`, construite dans l'ordre natif actuel : partitions retenues, puis `pr.allocations`, en omettant seulement les programmes absents et `role == "open.garden"`. Les espaces ouverts restent inclus. Une sélection `keys` filtre cet ordre ; elle ne le trie pas suivant l'ordre des clés reçues. `total` est la longueur de cette liste, pas le nombre de parcelles.

Interface de principe à intégrer dans `core::urban::building_sites` :

```rust
pub struct BuildingSiteIndex { /* ordre + index numériques + caches */ }
pub struct SiteWindow { pub offset: usize, pub limit: usize, pub max_bytes: usize }
pub struct SitePage {
    pub total: usize, pub start: usize, pub next: usize,
    pub requests: Vec<serde_json::Value>,
    pub request_bytes: usize, pub required_bytes: Option<usize>,
}

impl BuildingSiteIndex {
    pub fn prepare(layouts: &[Layout], partitions: &[Partition],
        selected_partition_indices: &[usize]) -> Result<Self, String>;
    pub fn page(&mut self, seed: &str, layouts: &[Layout], partitions: &[Partition],
        surface: Surface<'_>, water_level: &[f32], architecture_culture: Option<&str>,
        window: SiteWindow) -> Result<SitePage, String>;
}
```

Le runtime lie l'index et tout cache de requête au **handle complet + sélection + seed + architectureCulture** ; pas de cache réutilisé après remplacement ou entre deux cultures. Les anciens appels `requests(...)` restent disponibles et collectent le même générateur unitaire pour les chemins legacy/WASM. Le nouveau chemin ne doit jamais appeler ce collecteur.

## Index et coûts actuellement cachés

| Point du code | Correction conservant le calcul actuel |
|---|---|
| `requests` : recherche du layout, maps parcelles/cultures, adjacency, `district_programmes` | Préparer une fois par snapshot/partition ; conserver tous les voisins, même hors page. Ne pas recopier une partition amputée. |
| `access_segments` → `block_contacts` | Ce secours reconstruit actuellement **tout `FrontageIndex::new(layout)` par parcelle concernée**. Conserver un index par layout et appeler l'existant `block_contacts_indexed`, avec le même tri des contacts. |
| `tissues[(block, allocation.culture)]` → `parcel_morph` | Le cache existe déjà pendant un appel ; le garder entre pages, avec la partition dans sa clé. Résoudre les morphologies paresseusement pour ne pas calculer tous les blocs avant la première page. |
| `parcel_mapping`, branche `compact_fallback`, puis calcul de `hint` | Plusieurs recherches d'enveloppe peuvent viser le même lot et les mêmes dimensions. Cache local par triplet exact `(min_frontage, min_depth, min_access_width)` ; conserver les résultats `None` et le témoin stocké, sans approximation. |
| `shared_boundaries` | Boucle sur les arêtes de chaque paire adjacente, O(Va×Vb). Cache **dirigé** optionnel `(a,b)` ; conserver ordre des adjacences, doublons et orientation. Inverser un résultat `(b,a)` peut modifier segments/arrondis. |
| `ground_patch` et JSON final | La grille parcourt la bounding box raster du lot, même pour les espaces ouverts ; un grand lot peut coûter beaucoup. Le polygone est répliqué dans cadastral/buildable/roof_domain/réserves. Ne construire/sérialiser que les requêtes de la page ; aucun rééchantillonnage silencieux pour tenir le budget. |
| `serde_json::to_value(allocation)` deux fois | `Allocation.role` et `landmark` sont désormais des champs typés publics : lecture directe, mêmes valeurs de repli ; éviter de sérialiser aussi reasons/score/etc pour ces deux accès. |

Les caches catalogue `mapping_for/contextual_mapping` existent déjà : ne pas ajouter un cache culturel global non borné de géométrie. Pour les districts, attention : `district_programmes` garde le **dernier** district inscrit pour un quartier, tandis que `parcel_morph` utilise le **premier** correspondant. Une table commune qui uniformiserait ces deux règles changerait le résultat actuel.

## Contrat de page et invariants

- `offset` indexe les requêtes émissibles ; lecture répétée du même offset/révision = mêmes objets, sans avancer un curseur destructif. `limit ≤ 64`, budget au plus 24 MiB, avec contrôle séparé de l'enveloppe HTTP. Le client transmet déjà le budget d'octets restant via `ArchitectureRequestSource.read(offset, limit, maxBytes)`.
- Sérialiser chaque candidat une seule fois pour compter ses octets UTF-8, arrêter avant dépassement et garder au plus **un candidat suivant** borné pour la prochaine lecture. Si ce candidat ne tient pas dans le budget restant, renvoyer un préfixe ou `requests:[]` + `required_bytes`, sans le perdre ; le client publie alors son lot déjà chargé. S'il dépasse le budget maximal même seul, erreur explicite avec son ID, sans réduction de terrain/géométrie. Les snapshots restent bornés ; pas de cache de toutes les pages générées.
- IDs inchangés : `parcel.id + "/building"` ; graines `seed + "/" + parcel.id`, y compris `config.seed` et l'occupation (`fork("occupation")`). Ni offset ni numéro de page n'entrent dans un tirage.
- Ne pas confondre `allocation.culture` (tissu) et `architectureCulture` résolue (pack/admission) : la différence est intentionnelle. Conserver mode/ère, recette `null` des domestic/mixed, floors, programme, trous et ordres des segments.
- `neighbors:[]` reste la sortie des sites. Les occupations des maisons déjà acceptées appartiennent à **l'unique contexte de `placeArchitectureSource`** qui traverse les pages ; elles ne doivent pas être recréées ou oubliées à chaque lecture.
- Valider les références/IDs/cultures manquants pendant l'indexation légère. Une erreur géométrique tardive reste une erreur de flux partiel explicite : ne pas redémarrer en eager ni annoncer un succès complet après un préfixe publié.

## Vérification après handoff

Comparer l'ancienne génération et la concaténation de pages de tailles 1/7/64 sur de **vraies allocations non vides**, avec jardins exclus, plusieurs partitions, culture imposée, voisins hors page, patio et terrain échantillonné. Vérifier mêmes JSON/ordre/graines, relecture d'offset, budget court, révision périmée et absence de génération des suffixes non demandés. Mesurer séparément indexation, première page, sérialisation, mémoire native et client ; ne pas déduire le gain du seul transport réduit.

Les sources A3 actuelles ajoutent des contrôles de simplicité/épaisseur dans `occupation::finish`. Cela peut aussi éliminer des pièces : **zéro aiguille avec zéro silhouette n'est pas une réussite**. Le prochain audit doit conserver comptes d'allocations non ouvertes, previews non vides/vides et motifs, surfaces/couvertures, exemples du corpus et captures 01-l/04. Aucun résultat A3 n'est certifié par cette relecture.
