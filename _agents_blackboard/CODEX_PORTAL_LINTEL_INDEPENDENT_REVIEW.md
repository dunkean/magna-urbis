# Revue indépendante — matière du PortalLintel

Lecture seule le 2026-10-23. Aucun Cargo, aucune modification des sources de
production ou de copie. Proposition relue :
`proposals/b06_entry_feature_rights/constructor.patch.proposed`, SHA-256
`3a762bc86fd984b6969cc29ef41dcbfafa423c493ca40431ceeee335b3bde9f2`.
Le probe associé a l'empreinte
`983bc53973d8157c2fb5a31854792a675ff6daadbc689a516fd4f8ec85a5b3bc`.

Pas de blocage concret restant dans ce delta de constructeur après la correction
des clôtures basses. Ce verdict de lecture ne remplace pas les tests natifs et
ne valide pas encore une voie de préparation légère pour B06.

## Défaut causal et domaine corrigé

`access::portal_with_profile` conservait déjà les fragments supérieurs réels des
murs, mais ajoutait en plus un `PortalLintel` sur **tout le passage piéton**,
paliers compris. Le débord de 0,17 m² du témoin B06 n'était donc pas déduit d'un
appui architectural. `placement::native_site_features` exporte légitimement cette
pièce ; la supprimer seulement des droits aurait caché une géométrie native.

La proposition corrige le constructeur commun : les domaines viennent uniquement
des fragments supérieurs réellement conservés après intersection mur/passage.
Plusieurs pans produisent une union de matière ; le vide intermédiaire reste vide.
L'axe, les paliers, la largeur et le passage d'accès ne sont pas modifiés.
La hauteur du feature est bornée par 0,25 m, le top original et la hauteur du
fragment quantifiée. Le dernier cap après `feature()` empêche son propre arrondi
de dépasser le top réel ; ce constructeur ne crée aucun mesh à reconstruire après
la correction de hauteur. Les IDs, murs découpés et portails restent dans leur chemin natif.

Réserve initiale corrigée avant application : la première version faisait échouer
tout portail quand un mur était plus bas que la tête de porte. Or une clôture de
1,4 ou 2 m peut avoir une ouverture sans linteau. La version relue crée désormais
le portail sans inventer de pièce supérieure ; le mélange clôture basse + mur
haut conserve le linteau du seul mur haut. Les tests couvrent ces deux cas et
le voisinage du seuil de quantification.

## Autres constructeurs et usages

- **Profils et murs solides** : leurs branches `cut_profile_wall` restent
  distinctes ; elles ne reçoivent pas le feature ordinaire. La proposition
  conserve leurs découpes, seuils et volumes.
- **Coquilles** : un `shell_reference` conserve explicitement l'ancien chemin
  passage/hauteur0,25. Une coquille n'est pas un prisme ordinaire : cette exclusion
  évite une fausse preuve de matière. Un portail traversant une coquille et un
  mur ordinaire reste donc lui aussi hors correction. Le défaut historique n'est
  pas prétendu résolu pour ce périmètre.
- **Portails successifs** : chaque appel lit l'état réel des murs encore présents.
  Les fragments élevés d'une porte précédente ne deviennent pas des murs bas à
  redécouper puisque leur altitude ne rencontre pas celle du passage. Aucune
  union globale des passages ne remplit les espaces entre ouvertures.
- **`corbel_roofs`** : le garde conserve les sections réelles des murs d'appui et
  la comparaison tête + hauteur du linteau. La nouvelle hauteur correspond à
  la matière disponible. Sans feature, le fallback0,25 existant demeure
  conservateur ; aucun allègement de ce garde n'est proposé ici.
- **`access/public_roof_vigas`** : avant même le test du `PortalLintel`, une
  ouverture est interdite si le vrai `passage` ou `opening_surface` du portail
  traverse la zone. Réduire le domaine du feature ne supprime donc pas cette
  protection. Les portails et les fenêtres restent également contrôlés.

## Portée exacte de la preuve B06

Le probe conserve une source, une variante, un plan local et une pose déjà admis.
Il utilise l'unique portail canonique déjà construit par `enrich_architecture`,
récupère murs découpés, poteaux, frames et linteaux, puis passe par l'admission
complète : droits, toit, terrain, voisins, solides et raccord public. Toute
structure reste dans l'occupation exportée ; seules les pièces touchant le sol
entrent dans l'assise physique de cet oracle. Les succès extérieur/intérieur et
leurs différences de structures sont consignés séparément. Leur présence doit
être lue dans les résultats, pas déduite du seul succès du test de linteau.

Ce probe est un **oracle enrichi**, pas un préparateur de production. Le
`structural_unit` actuel exécute supports, circulation et enceintes, mais pas
les détails B06 `four_master_posts` et `open_sides`. Ces derniers ajoutent les
poteaux et modifient les vrais murs/headers avant l'accès dans le chemin détaillé.
Une simple whitelist B06 ferait donc manquer des solides et pourrait conserver
un autre portail. La suite minimale doit partager ces opérations structurelles
avec le chemin natif, une seule fois, puis établir l'entrée après elles. Il faut
toujours séparer assise au sol et droits de toutes les pièces élevées ; ni leur
suppression ni l'emploi du seul corps ne constitue une correction sûre.

Les preuves de non-régression prioritaires restent les tests de portes basses,
multi-murs, profils/solides/coquilles, puis les trois témoins B06 et les usages
corbel/vigas. Aucun résultat natif nouveau n'est revendiqué par cette note.
