# Assemblage : proposition de codec d'entrée limité aux nouvelles routes

Lecture seule du blocage V4 ; aucun code de moteur/codec ni gel modifié. Preuve : `web/out/native-assembly-wrappers-proof-v4/wrapper/result.json` et ses deux requêtes brutes.

## Écart exact observé

Les deux phases, JSON natif initial et JSON.parse/stringify JS, sont Retained. Pose et ground reçus ont les bons bits. En revanche, **25 feuilles numériques sur 136** du PlanBuilding reçu diffèrent d'un ULP de leur image décimale native originale. Exemples :

| Champ incumbent | Token natif | Bits du token, arrondi IEEE correct | Bits reçus par le wrapper V4 |
|---|---|---|---|
| footprint/0/outer/0/y | 100.00000000119209 | 40590000000147ae | 40590000000147ad |
| footprint/0/outer/1/x | 103.92499999850989 | 4059fb333331999a | 4059fb3333319999 |
| entrance/x | 100.98100000000001 | 40593ec8b4395811 | 40593ec8b4395810 |
| roof_footprint/0/outer/0/x | 99.64899999518997 | 4058e98937469c7c | 4058e98937469c7b |

Les volumes/niveaux/fondations recopient les mêmes écarts. Le diagnostic natif constate body_exact=false, roof_exact=false, entry_exact=false, ground_bits_exact=true, circulation_set_equivalent=true ; maxima corps et toit = un ULP. Aucun correctif de géométrie n'est nécessaire : le parseur historique `serde_json::from_slice` ne restitue pas ici les doubles natifs dont ces tokens sont l'image roundtrip. Ce problème est distinct du re-snap du validateur corrigé en V3.

## Voie recommandée, à approuver avant code

Réutiliser le **principe** du lecteur Std déjà éprouvé sous `java100k-single-need-global-audit-workspace-v1/candidate/rust/crates/houses/src/access/fixture_json_exact.rs`, avec erreurs et bornes de production, sans ses unwrap/assert de fixture :

1. Valider la syntaxe JSON et conserver les entiers par le parseur existant. Scanner les tokens numériques uniquement hors chaînes/échappements. Lire les tokens fractionnaires/exposants et -0 par `str::parse::<f64>()`, refuser les non-finis.
2. Remplacer temporairement ces seules positions numériques par des marqueurs internes, puis rétablir les Number depuis les bits Std. L'arbre de types original distingue les nombres des vrais objets ayant la même clé : aucune collision de marqueur ni réinterprétation des chaînes.
3. Désérialiser cet arbre exact vers les types natifs habituels. Aucune coordonnée, pose, dimension ou entrée n'est recalculée/corrigée. Tous les contrôles de source/config, revalidation et admission restent identiques.

Implémentation proposée : module `plans::assembly::transport` avec trois points d'entrée typés `parse_pair_request`, `parse_archive` et `parse_realize_request`. Seules `/houses/assemble-pair`, `/houses/unpack-assembly`, `/houses/realize-assembly` et leurs fonctions Wasm appellent ce codec. Les anciens `/houses/plans`, `/houses/realize-plan`, Core et helpers decode/from_str restent strictement inchangés. **Aucune feature float_roundtrip globale.**

Annoncer une capability supplémentaire `houses.native-assembly-std-json-v1` ; le client exige cette capacité avec `houses.native-assembly-pair-1`. L'archive groupe garde son format lossless : ce nouveau lecteur d'entrée n'est **ni une archive ni un certificat**. Il préserve les valeurs fournies, sans authentifier leur provenance. Le constructeur conserve son droit de refus complet ; le frontend n'envoie jamais une projection comme incumbent.

Les limites de corps HTTP/Wasm précèdent ce lecteur. Les budgets Rust et les gardes physiques ne bougent pas. Le schéma à deux arbres et buffer réécrit implique des copies transitoires supplémentaires : elles doivent être documentées, pas présentées comme un gain CPU/heap. Refus explicite sur dépassement, syntaxe incorrecte, overflow ou marqueur incohérent.

## Preuves requises dans une nouvelle copie

- Tokens ci-dessus, 2.8000000000000003, Unicode/échappements, vrais objets ressemblant aux marqueurs, grands entiers exacts, exposants, -0, erreur/non-fini et bornes. Signature complète des bits de l'entrée native avant transport contre les bits typés après le nouveau lecteur.
- Le **vrai** wrapper local puis Wasm, requête synthétique native inchangée, phases JSON initial et JS→JSON : obtenir Assembled, archive native inchangée, unpack et deux réalisations intérieures. Les deux anciens résultats V4 0/2 restent intacts.
- Contrôles anciens decode inchangés ; tests Single/API historiques conservés ; aucun succès attribué à un fallback. Les 22 anciens cas restent une mesure séparée, sans normaliser leurs archives ni leur ancienne sortie.

Limite explicite : JSON.stringify transforme -0 en 0. Le lecteur Std conserve -0 si le token le porte, mais ne peut pas retrouver un signe ou des bits déjà perdus en amont. Les archives groupe $f64 conservent ces bits ; les anciennes données abîmées restent refusables. Ne pas annoncer la migration de tous les anciens Single.

Alternative plus large, non recommandée pour ce blocage précis : enveloppe de **transport** f64 tagué distincte de l'archive/certification, produite depuis de vrais records natifs, jamais une projection. Elle demanderait un contrat de producteur et de sérialisation des champs f64/entiers ; aucune nouvelle enveloppe Single/globale n'est proposée ici.
