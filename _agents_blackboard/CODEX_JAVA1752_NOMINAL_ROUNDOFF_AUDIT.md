# Java1752 — audit indépendant final 0406

2026-10-23. Lecture des archives uniquement ; aucune nouvelle génération native,
aucun serveur, aucune modification des sources de production ou de la copie.

Le delta est admissible pour la promotion proposée : aucun blocage physique ou
régression des anciens succès B11 trouvé sur ce corpus. Ce verdict ne clôt pas
le déficit de surface/capacité ni la validation détaillée de chaque nouvelle maison.

## Sources et commande

- Final : `web/out/nominal-first-roundoff-isolated-proof/java-full`, CLI
  `0406b1f3fbee178951cfd9773249fae2d1c0cc86d4ab0068dbeaa212eed3f75e`.
- Référence intermédiaire : `web/out/nominal-first-terrain-v3-isolated-proof/java-full`, CLI
  `38889dfb63da51fa5c94b80b2fcdf9e2da634c79dd63de319c1e47b6bec0842a`.
- Référence production B11 : `web/out/b11-native-entry-production-proof/java-full`, CLI
  `a1ec113e0fde4a6e8275fce6937fbc2a8ae2a4fd9fccc01750ca1df0f780d001`.
- Exécution : `python web/scripts/java_roundoff_full_audit.py`.
- Preuve : `web/out/nominal-first-roundoff-isolated-proof/java-full/independent-audit/`.
  `report.json` conserve les empreintes des données, CLI, bridge, catalogue,
  résumés et script ; les comparaisons détaillées sont dans `sites-vs-B11.json`
  et `sites-vs-38889.json`.

Les 1 752 demandes d'origine et le catalogue sont identiques par SHA dans les
trois phases. Chaque payload/résultat des 28 lots est vérifié contre son SHA,
les sorties agrégées contre la concaténation exacte, et les demandes restent
identiques hors voisins ajoutés par le bridge. Chaque phase utilise son propre
contexte d'occupation, pas celui de la référence.

## Résultats comparés

| Mesure | B11 → final | 38889 → final |
|---|---:|---:|
| Admis | 1 010 → 1 338 | 1 298 → 1 338 |
| Refusés | 735 → 407 | 447 → 407 |
| Espaces ouverts | 7 → 7 | 7 → 7 |
| Admissions gagnées / perdues | 328 / 0 | 40 / 0 |
| Anciennes cibles améliorées / dégradées | 18 / 0 | 0 / 0 |
| Anciennes entrées natives perdues | 0 | 0 |
| Changements recette/variante/niveaux parmi anciens admis | 0 | 0 |
| Anciens objets strictement identiques | 865 / 1 010 | 1 227 / 1 298 |
| Demandes avec voisins enrichis différents | 49 | 6 |

Les 328 gains B11 sont tous AS-ISL-B14, pour **16 720,52 m²** de corps ajoutés.
244 retiennent une vraie entrée native, 84 restent sans ce marqueur. Les 40 gains
du seul dernier delta ajoutent **1 867,73 m²**, dont 32 avec entrée retenue et
8 sans marqueur. Une entrée archivée n'est pas une nouvelle preuve de réalisation
de l'intérieur : aucun détail supplémentaire n'a été exécuté par cet audit.

Les 18 améliorations anciennes ajoutent 955,75 m² sur le même groupe de cibles
B11. Les aires/cibles des 1 298 anciens admis de 38889 sont identiques.
L'absence de perte est mesurée sur cette séquence complète ; elle n'est pas
déduite d'une hypothèse d'indépendance entre lots.

## Contrôles physiques indépendants

- GEOS vérifie **1 338 bâtiments** contre leurs vrais droits : corps/buildable,
  toit/droits de toiture, occupation/cadastre, réserves et voisins enrichis plus
  occupations précédentes du même lot. **Zéro dépassement > 1e-4 m².**
- STRtree vérifie l'union **corps + cours + circulation + toutes les structures
  exportées** entre toutes les maisons, y compris entre lots. **Zéro collision
  > 1e-4 m² dans chacune des trois phases.**
- L'audit des fondations marquées couvre 890 maisons. Un second audit fondé sur
  les corps réellement archivés couvre **1 335 Ground Single à un niveau sans
  structure porteuse extérieure**, indépendamment du marqueur. **Les 328 gains
  B11 et les 40 gains intermédiaires sont tous couverts**, y compris les 84/8
  sans marqueur. Aucun défaut de sol/eau/pente/ressaut ; tolérance de mesure
  1e-6 m/degré, sans changer les gardes natives.
- Sur ces appuis simples : ressaut maximal mesuré 0,74998234 m ; pente maximale
  10,91603°. Les trois autres architectures restent hors de ce certificat simple,
  mais ne sont pas de nouvelles admissions et leurs droits sont contrôlés.
- Seize alertes de source restent visibles : quatorze ratios et deux comparaisons
  de minimum. Toutes sont **strictement héritées de B11**, dimensions et contrôles
  identiques. Les deux minima diffèrent de 1,01 et 1,46 nanomètre du minimum
  millimétrique (bruit booléen). Aucun nouveau gain n'a d'alerte source.
  Les ratios historiques ne sont pas déclarés corrigés par cette promotion.

## Budgets et limites

Les diagnostics respectent les bornes : dimensions ordinaires ≤ 8, admissions
ordinaires ≤ 24 ; guide terrain de correction ≤ 8 ; récupération initiale
≤ 8 évaluations puis ≤ 1 construction/admission. Final : 526 traces de récupération,
328 succès, 4 130 évaluations, 328 constructions. Les compteurs ordinaires restent
2 944 dimensions / 9 597 admissions, identiques à 38889. Ces phases sont distinctes
et ne représentent pas tous les contrôles internes du moteur.

Temps natifs déclarés par les replays uniques : B11 2 890 ms, 38889 3 164 ms,
final 3 292 ms. Aucun gain de vitesse n'est revendiqué à partir de ces mesures.

Le corpus est l'ancienne capture Java1752, pas la ville R5 C7921 ni une nouvelle
capture utilisateur. L'admission ne signifie pas satisfaction du programme :
les nouveaux gains B11 à cible connue restent entre 3,65 % et 96,04 % de la cible.
Le nombre d'occupants n'est pas certifié. Voir aussi la revue de fichiers à promouvoir
dans `CODEX_HOUSES_NOMINAL_TERRAIN_PROMOTION.md` ; les probes B06 sont exclus.
