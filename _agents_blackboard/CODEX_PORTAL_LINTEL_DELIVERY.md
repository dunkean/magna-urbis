# Linteaux ordinaires — livraison vérifiée

**Livré en production, 07:07 Paris.** CLI figé `web/out/portal-lintel-production-proof/plan_replay.exe`, SHA256 `39fccd69b11c7af484b70b12114e0724f736543df77db5852a51253420d0fd84`. Ce binaire inclut la livraison nominal/terrain précédente. Aucun serveur relancé.

Le constructeur utilisait le passage piéton, paliers compris, comme surface de linteau. Sur le témoin Joglo modéré, cela créait 0,17 m² de débord extérieur sans appui natif. Le linteau suit maintenant les fragments supérieurs des murs réellement traversés et ne dépasse plus leur hauteur. Les espaces entre murs restent vides ; une clôture basse garde son ouverture sans recevoir de poutre fictive. Les profils, solides et coquilles conservent leurs chemins distincts ; la correction ne prétend pas couvrir les coquilles.

Deux fichiers seulement : `src/access.rs` et `src/access/portal_lintel_domain_tests.rs`. Aucun catalogue, format, seuil de droits ou voie d'entrée B06 ajouté. Les passages, portes et découpes de murs gardent leur géométrie native.

**Validation : 403 tests release et 406 debug**, aucun ignoré. Les 128 sorties de plans des corpus Europe, Java1752 et C7921 restent identiques à la livraison précédente ; les 16 détails européens sont identiques hors durée. L'export natif neuf est également identique octet par octet : 225 profils, 421 styles, même empreinte source. Preuves : `web/out/portal-lintel-production-proof/build-proof.json` et `web/out/b06-feature-rights-isolated-proof-v2/admission-export/comparison.json`.

L'oracle détaillé isolé contrôle trois Joglo à leur pose existante : admission et intérieur **3/3**, toutes pièces et accès dans leurs droits, aucun chevauchement avec les solides. Deux cas ont de vrais linteaux ; le troisième ouvre sur un pan déjà retiré, avec son Frame conservé au-dessus. Le test vérifie ces deux constructions distinctes. Ce résultat ne vaut pas activation de la préparation rapide : elle doit reconstruire ses propres murs/poteaux et faire rejouer son vrai portail. Cette suite reste dans `houses-b06-light-workspace`, hors production.

Les gains de la livraison précédente restent inchangés : C7921 **6225/1689/7**, 146 admissions récupérées ; Java1752 **1338/407/7**, 328 récupérées. La capacité globale, les entrées B06 en ville, les raccords des pavillons et les 50 captures restent ouverts.
