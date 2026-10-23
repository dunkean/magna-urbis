# Contrôle de l’export d’admission B12

23 octobre 2026. **Candidat natif asymétrique vérifié et copié dans l'export canonique avec autorisation root.** Aucun Cargo ni génération native par cet agent. Baseline exacte conservée dans `roman-b12-admission-check/before.json`, SHA256 `4027e31b2f574d4a71020c4401755f7d96b08f0d7ebc4cf19f19424d16c11108`. Export canonique : **1 885 495 octets**, SHA256 `5d9e96fd6a6d5b91adabde61d073c60f0ac36df8259372f41322126e6eea25cc`, identique à `candidate-asymmetric-v3.json`.

L’exemple `rust/crates/houses/examples/admission.rs` émet les profils résidentiels par recette et la faisabilité par recette×variante, avec les registres fonctionnels/culturels. B12 ajoute exactement :

- `profiles` : `MED-ANT-B12` ; **223 → 224**.
- `feasibility.profiles` : `MED-ANT-B12::default` ; **417 → 418**.

Le mode **`strict-b12`**, toujours actif par défaut, exige que tous les anciens enregistrements et leur ordre restent identiques, sans epsilon ; aucun statut, refus, dimension, accès, capacité, contrainte ou graine n'est masqué. Versions et registres restent identiques. Seul `/source_sha256` peut changer de `6ccfa6c5bf8e88dc45dd24a0a3db15e6d636d5a76cc4027e934234c917182157` à `d40912165c2d1b55fb0196de804df404d8e546409e963d125d7afcf876719393`. Les hashes des 264 anciennes recettes justifient indépendamment cette transition.

Le nouveau mode **`access-v3`** est une exception nommée et bornée à **ces deux checksums exacts** baseline/candidat, pas une autorisation générale de modifier des enveloppes. Il exige en plus les chemins exacts de réduction d'une seule coordonnée positive de `min_envelope_m` / `minimum_native.envelope_m`, les nombres de changements revus (122 / 223) et uniquement `generator_version: houses-2→houses-3` en métadonnée supplémentaire. Toute autre valeur, statut, ordre, registre ou nouveau candidat est refusé. Le checker reste en lecture seule.

| Comparaison | Minima | Variantes | Autres écarts |
|---|---|---|---|
| Baseline → asymétrique | 122 anciennes enveloppes réduites, 101 exactes ; B12 ajouté | 223 anciennes enveloppes réduites, 194 exactes ; B12/default ajouté | Hash source et générateur seulement |
| Opposed-v3 → asymétrique | 122 enveloppes réduites, 102 exactes | 223 enveloppes réduites, 195 exactes | Aucun |

**Aucune suppression, aucune transition supported→refused, aucun changement de largeur d'accès, de refus, de graine ou de contrainte.** Les réductions par rapport à la baseline vont de 0,12 à 1,05 m ; par rapport à opposed-v3, de 0,12 à 0,88107915021606 m. Les décimaux exacts figurent dans `asymmetric-native-deltas.json`, sans tolérance. L'ensemble final compte 197 minimums supported / 27 refused et 345 variantes supported / 73 refused ; le gain d'un supported par table correspond uniquement à B12.

Justification native : `access.rs::candidate_filtered` utilise les paliers opposés réels puis un passage à profondeurs indépendantes (0,2 m côté source, écart + 0,2 m côté cible), au lieu d'étendre symétriquement l'épaisseur traversée vers l'extérieur. Il conserve les contrôles de paliers, murs/supports/interdits et le repli symétrique validé pour les formes qui le nécessitent. La comparaison confirme que seules les bornes du témoin d'accès changent dans cet export ; elle ne certifie pas tous les placements urbains ni tous les intérieurs.

Le nouveau profil doit annoncer B12/default, MED-ANT/roman_urban, inspired_only, Single, deux niveaux et les plages nominales source ; son témoin natif doit réussir avec dimensions/accès positifs, identiques dans les deux tables, graine `urban-admission-v1:MED-ANT-B12`. `household_range=null` et `placement_certified=false` sont obligatoires. Cela ne certifie pas son placement sur une parcelle ni son raccord intérieur urbain.

Commandes de contrôle, exécutées en lecture seule :

```powershell
python _agents_blackboard/check_roman_b12_admission_export.py compare _agents_blackboard/roman-b12-admission-check/candidate-asymmetric-v3.json --mode access-v3 --report _agents_blackboard/roman-b12-admission-check/comparison-asymmetric-v3.json
```

Résultat **PASS**, puis copie des octets du candidat et checksum relu : `canonical-copy-asymmetric-v3.json`. Le contrôle `strict-b12` du même candidat échoue toujours, comme prévu. Deux contre-tests échouent aussi en migration : modification d'une enveloppe non revue et supported→refused ; rapport `access-v3-checker-guards.json`. Aucun profil historique n'a été relabellisé manuellement et aucun catalogue B13 émis.
