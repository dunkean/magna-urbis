# Pose directe d'un témoin natif — contrat v1

Le raccord Rust/TypeScript est optionnel dans `PlacementRequest.native_minimum_candidates`. Il évite le tirage de recette, le redimensionnement et la recherche de poses pour une construction native canonique déjà choisie. Il ne remplace pas toutes les maisons par une maison minimale.

```json
{
  "native_minimum_candidates": [{
    "identity": {
      "version": "native-admission-witness-1",
      "catalogue_version": "<export>",
      "generator_version": "<export>",
      "style_index_version": "<export>",
      "source_sha256": "<export>",
      "style_id": "<export>",
      "recipe_id": "<export>",
      "variant_id": "<export>",
      "seed": "<export>"
    },
    "transform": {"origin": {"x": 0, "y": 0}, "orientation_deg": 0},
    "access_id": "<declared access>",
    "contact": {"x": 0, "y": 0}
  }]
}
```

Les valeurs ci-dessus décrivent le schéma, pas un exemple admissible. La ville doit employer l'identité et les géométries exportées (voir `CODEX_NATIVE_WITNESS_EXPORT.md`), puis produire le transform métrique et le contact sur un accès déclaré. Au plus quatre candidats, dans l'ordre du producteur. Le contact dispose de la demi-largeur native de chaque côté sur le segment. La graine du témoin reste celle du témoin ; la graine du site ne retire pas de nouvelles dimensions ni une nouvelle porte.

La première version couvre les demandes domestiques/mixed automatiques inspired, taille1, contrôles usuels inchangés. Un modèle ou override explicite, une emprise imposée ou le fitting désactivé reste sur la voie existante. Un conflit explicite pack/mode est refusé. La palette et la tradition exactes, l'époque, la typologie, les étages réels du principal et la composition demandée restent contraignants. Une cible bâtie différente de plus de10% de l'emprise réelle exclut le minimum : il faut un autre candidat dimensionné, pas une substitution sous-dimensionnée.

Chaque pose vérifie les corps et niveaux natifs, les enceintes réellement percées, les supports, les cours, les toits, la fondation sur le raster, les réserves/trous/voisins et le graphe d'accès natif connecté au contact public. Le toit et la porte sont ceux de la construction native précalculée. Les échecs d'un contrat éligible sont rapportés sans passer ensuite à une recherche cachée.

Le plan compact conserve la résolution exacte pour le détail à la demande. `cartographic.validation="native_site"` signifie structure extérieure et site contrôlés, **pas intérieur ni capacité habitante**. `domestic_units=0` reste inconnu ; l'inspecteur actuel conserve son statut prudent de plan architectural.

État de validation : trois tests ciblés passent, dont une maison simple tournée27° et le complexe B07/flat_stone tourné−37°, translatés, toits détaillés identiques et seed canonique conservée. Refus vérifiés pour droits de toit, terrain, accès, réserve, voisin, identité, étages, budget et conflit pack/mode. Trois tests de cache passent également. Le cache conserve au plus16 témoins et32MiB de contenu sérialisé complet ; cette borne n'est pas une mesure de heap. Contenu complet actuel : B14=29451octets, B07=66265octets. Les échecs connus sont mémorisés ; un mauvais hash est rejeté avant construction. Le compact et les unions sont préparés une seule fois par témoin.

L'export léger des deux témoins est vérifié dans `web/out/native-admission-witness-proof` :56951octets, sans resolved/packed/structural_unit/site_features. Ce DTO contient les domaines et entrées exacts requis côté producteur. Le moteur local et le WASM déclarent `houses.native-minimum-candidates-v1` ; le bridge refuse l'envoi à un ancien moteur qui ignorerait ce nouveau contrat. Trois tests de transport/annulation et TypeScript passent. Aucun nouveau serveur n'a été démarré pour cette preuve.

Suite requise : raccord effectif du producteur urbain, candidats dimensionnés non minimaux, réemploi mesuré sur vrais sites et reprise01-s/04/Java. Le seuil global de refus<3%, le million et les50captures ne sont pas validés par ces tests.
