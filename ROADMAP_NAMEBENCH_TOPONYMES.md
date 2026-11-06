# Roadmap — toponymes Namebench embarqués dans Magna Urbis web

6 novembre 2026 — **Première intégration livrée et contrôlée sur le périmètre du nommage.** Le [design des régions habitées](docs/DESIGN_REGIONS_HABITEES_FR.md) reste conservé ; cette roadmap en isole le premier chantier. Le contrôle TypeScript global et les vérifications ciblées passent ; voir le bilan et son périmètre ci-dessous.

## Bilan de réalisation

**Révision de qualité et traduction partielle — 6 novembre :** les deux modes **Culture intégrale** et **Traduction partielle** sont implémentés dans le panneau de nommage. La langue d’affichage des génériques peut être française, anglaise, japonaise, arabe, espagnole, portugaise ou chinoise ; le nom propre culturel demeure identique. La forme culturelle complète est conservée en parallèle et restaurée au retour au mode culturel. Les noms opaques ne sont pas découpés arbitrairement. Les réglages et les formes sont sauvegardés avec le projet. Cette extension ne traduit pas l’interface globale.

Le vocabulaire urbain des profils fins ne reprend plus silencieusement celui de sa famille générale. Les politiques de source distinguent pays modernes, générateurs fantasy et 55 palettes fictionnelles originales ; les anciens et autochtones n’utilisent plus indistinctement de grands corpus nationaux modernes. Les tests de cette révision comptent **42 cas passants** ; le navigateur hors ligne couvre **80 cultures**, les **7 langues** et les **2 modes**. Le build V2 passe dans le dossier isolé de validation. Voir le [guide actualisé](docs/NAMEBENCH_TOPONYMS_FR.md).

| Lot | Réalisé | Limite explicite |
|---|---|---|
| 0 — Profils | Registre couvrant les cultures actives des catalogues web et natif, surcharges et métadonnées de rejeu | Les pays sources ne garantissent pas une langue ou une époque ; les rapprochements sont déclarés |
| 1 — Extrait | 549 469 noms, 253 codes pays, 51 générateurs ; 7,815 Mio brut / 2,899 Mio gzip ; extraction reproductible | Les tableaux source vides des générateurs romain et viking sont exclus |
| 2 — Composition | Contractions françaises, connecteurs dédiés notamment persan/turc/coréen/grec, conservation des 13 vocabulaires urbains existants | Pas de morphologie historique exhaustive ; les formes non définies restent simples |
| 3 — Intégration | Noms des établissements et éléments naturels, nom régional, destinations liées, corrections utilisateur, renommage sans nouvelle géométrie | Le sélecteur explicite conserve les 13 familles existantes ; les profils plus fins suivent la culture |
| 4 — Distribution | Données intégrées au bundle web, manifeste et documentation, contrôle navigateur hors ligne | Rendu, placement du texte et extension des contrôles d’interface restent au chantier graphique |

Code et documentation : [guide d’intégration](docs/NAMEBENCH_TOPONYMS_FR.md), [exporteur](tools/namebench/export.py), [manifeste](web/src/gen/names/data/names-manifest.json).

**Vérifications actuelles :** 42 tests ciblés passent ; le contrôle TypeScript global (`npm run typecheck`) passe après correction du contrat de vocabulaire ; le build V2 passe dans `web/out/namebench-v2-validation` sans remplacer la sortie de Claude ni reconstruire Rust. Le navigateur hors ligne vérifie 80 cultures, sept langues et les deux modes ; le bundle dédié occupe 8 428 823 octets. La reconstruction de l’extrait Namebench et du manifeste a été vérifiée octet pour octet lors du premier lot ; ce paquet n’a pas changé depuis.

**Périmètre de validation :** aucune suite exhaustive de rendu ou de cultures urbaines n’a été lancée. Trois tests V2 d’étendue/cache avaient échoué dans le premier lot, hors fonctions de nommage ; ils n’ont pas été rejoués dans cette révision. Le test V2 du renommage et de sa sauvegarde avait passé, et les nouveaux tests couvrent les deux modes et leur persistance.

Les cases ci-dessous suivent la réalisation ; les extensions de morphologie et la validation des glyphes restent explicitement à faire.

## Objectif et choix de départ

**Embarquer une petite bibliothèque culturelle de noms et un moteur de composition TypeScript.** Namebench sert à préparer les ressources ; Magna Urbis génère les noms dans le navigateur, sans serveur, Python, SQLite, compte ni téléchargement de la base mondiale. Chronos et Lineage Lab ne sont pas nécessaires à ce chantier.

La première livraison couvre les établissements, puis régions, cours d’eau, lacs, reliefs, forêts, routes et lieux urbains déjà nommés par Magna Urbis. Elle conserve les noms saisis par l’utilisateur et ne modifie aucune géométrie.

Deux composants restent distincts : **le corpus fournit les noms et racines ; la grammaire fournit articles, particules, contractions, accords, ordre et graphie.** On ne découpe pas arbitrairement un nom complet pour en fabriquer une racine.

## Point de départ vérifié

- `web/src/gen/names/{index,grammar,types}.ts` : 13 familles, vocabulaire et composition déjà présents ; réutiliser les points d’entrée et l’ancrage des étiquettes.
- Le catalogue urbain natif contient 79 cultures. `CULTURE_FAMILY` n’en couvre qu’une partie et assimile notamment persan/turc à arabe, coréen à chinois ; les inconnues reviennent au français/anglais.
- `web/src/v2/mapNaming.ts` permet déjà de renommer sans régénérer le terrain ; il applique les corrections utilisateur.
- Namebench fournit des styles, des lieux GeoNames et des générateurs par tableaux/patrons. Son API de tirage n’est pas déterministe. Son Markov expérimental entraîne actuellement `place` sur des prénoms : ne pas le reprendre pour les toponymes.
- Base reçue dans `../namebench/data/names.db` : **1 205 948 416 octets**, 10 170 527 lieux, 731 générateurs et 4 708 tableaux. Les lieux couvrent établissements (`P`), hydrographie (`H`), reliefs (`T`) et divisions administratives (`A`). La classe végétation (`V`) est absente : les forêts nécessiteront générateurs ou ressources éditoriales.
- Mesure exploratoire en mémoire : les **35 générateurs** `towns_and_cities.*` et `places.{city_districts,forests,mountains,rivers}`, avec tous leurs tableaux et patrons, occupent **224 649 octets de JSON UTF-8 et 79 226 octets gzip**. Mesure sur un objet trié `style → {pattern, arrays}`, JSON compact, gzip Python par défaut. Ce n’est pas encore un paquet web validé : ni glue, ni corpus culturels fins, ni notices ne sont inclus ; certaines entrées seront exclues du périmètre final.
- La table `places` ne contient ni langue, ni genre grammatical, ni variantes de translittération : ces informations devront venir des profils, d’une préparation dédiée ou d’annotations, sans les prétendre importées.

## Lot 0 — Fixer le contrat et la couverture

- [x] Créer un registre **culture Magna Urbis → profil toponymique**, distinct de la langue de l’interface.
- [x] Inventorier toutes les cultures réellement proposées par les interfaces TypeScript et natives ; contrôler leur union, pas uniquement les 79 entrées du catalogue actuel.
- [x] Définir `ToponymProfile` : identifiant, sources Namebench, corpus par type, grammaire, système d’écriture et emprunts déclarés. Plusieurs cultures peuvent partager un profil lorsque cela est pertinent.
- [x] Résolution : choix explicite pour le site → choix global explicite → profil de sa culture. Le profil régional est explicite ; à défaut, prendre celui de l’établissement principal, et documenter cette convention.
- [x] Enregistrer versions du corpus et de l’algorithme. Actualiser directement le contrat de nommage et les options, sans couche de compatibilité pour les anciennes recettes.

**Pilote et sources identifiées :** `bastide` → `style.french` ; `hanseatic` → `style.german_de_at` ; `italian-comune` → `style.italian` ; `medina` → `macro.arabic` ; `persian` → `style.persian` ; `japanese-jokamachi` → `style.japanese` ; `elven` → `towns_and_cities.elven_citys` ; `dwarven` → `towns_and_cities.dwarven_citys`. Les six premières références sont définies par le code Namebench ; des établissements sont présents notamment en France, Allemagne, Italie, Maroc, Iran et Japon. Les deux générateurs fantasy sont présents avec respectivement 259 et 332 éléments de tableaux. La qualité linguistique des sélections reste à contrôler.

**Livrable :** registre et schéma validables. Une culture connue n’est jamais silencieusement traitée comme française ou anglaise. Si les données manquent, utiliser un profil procédural explicitement choisi pour elle, sans prétendre disposer d’un corpus authentique.

## Lot 1 — Produire l’extrait compact hors ligne

- [x] Ajouter `tools/namebench/export.py` dans Magna Urbis ; lire la source en lecture seule, sans modifier Namebench ni reconstruire sa base. S’inspirer de `../chronos/tools/namebench/export_names.py`.
- [x] Sélectionner uniquement les profils utilisés, avec quotas par type et diversité de longueur, graphie et provenance ; éviter un extrait composé seulement de capitales ou des premières lignes alphabétiques.
- [x] Pour les établissements, filtrer les catégories de lieux habités. Pour les éléments naturels, interroger les classes/codes correspondants : le `place` public de Namebench cible par défaut les lieux peuplés.
- [x] Normaliser en NFC, nettoyer et dédoublonner sans supprimer les diacritiques ; conserver l’écriture source et une forme latine lorsqu’elle est disponible. Un pays moderne n’établit pas à lui seul une langue ou une authenticité historique : documenter les approximations.
- [x] Échantillonner par classement stable et clé de hachage, jamais `ORDER BY RANDOM()`. Produire JSON canonique, manifeste, compteurs, empreintes et attributions des sources retenues.
- [x] Retenir les générateurs Namebench utiles sous forme de tableaux et patrons figés. La première livraison les évalue directement dans le navigateur ; elle ne prépare pas de longues listes de leurs résultats. Les éventuels futurs compléments générés hors ligne devront être triés et figés : un simple `random.seed` ne garantit pas la stabilité d’un résultat dépendant de l’ordre d’un ensemble Python.
- [x] **Privilégier tableaux + patrons pour les petits générateurs**, notamment elfique et nain : porter uniquement leurs opérations nécessaires en TypeScript et les alimenter avec les forks Magna Urbis. Garder les corpus de noms complets pour les styles réels et les générateurs dont les patrons ne sont pas fiables. Ne pas embarquer les 731 générateurs ni supposer que leurs métadonnées reproduisent toutes les subtilités des sources.

**Budget révisé le 6 novembre : priorité à la diversité ; quelques Mo sont acceptés.** Viser environ **3–8 Mio de JSON UTF-8**, avec une limite de préparation de **12 Mio**, et mesurer séparément le poids gzip et le poids réel du build. Prévoir jusqu’à 2 048 noms d’établissements, 512 cours d’eau, 256 lacs, 512 reliefs et 256 régions par pays source, sans remplir artificiellement les corpus pauvres ; pour les profils génératifs, conserver les tableaux et patrons utiles. Mutualiser les données partagées. La cible initiale de 300 Kio gzip est abandonnée ; ne pas sacrifier les routes, paysages ou cultures pour la respecter. Aucun jeu de données de l’ordre de 100 Mo n’est embarqué.

**Livrable :** extrait versionné dans `web/src/gen/names/data/`, reconstructible sur une machine possédant la source. Les builds web ordinaires consomment cet extrait suivi dans Git ; ils n’exécutent pas l’exporteur.

## Lot 2 — Ajouter la « glue » syntaxique

- [x] Séparer **noms complets opaques**, **bases annotées**, **termes génériques** et **références à un autre lieu**. Un nom complet déjà composé n’est pas redécoré automatiquement.
- [x] Prévoir les opérations nécessaires : nom simple ; générique + nom ; nom + générique ; composé ; destination ; localisation ; qualification. Les profils n’activent que leurs opérations définies.
- [ ] Étendre ultérieurement les annotations aux genres, nombres et formes fléchies des noms et qualificatifs. La première livraison traite les articles lexicaux et une élision H explicitement annotée ; sans autre métadonnée elle utilise des formes simples, sans inventer un accord.
- [x] Réutiliser les petites grammaires existantes, en corrigeant les généralisations : toutes les langues n’ont pas d’articles ni les mêmes espaces, et tous les `H` français ne permettent pas l’élision.
- [x] Exemples de référence français : `Route d’Avignon`, `Route du Havre`, `Route des Ormes`, `Porte de la Rochelle`. L’article fait partie du nom référencé ; les contractions ne sont pas des remplacements globaux de chaînes.
- [x] Respecter les conditions géographiques : un nom en « sur-… » doit référencer une rivière pertinente ; une route et une porte utilisent leur destination réelle. Réserver les dédicaces aux profils qui les définissent.

**Implémentation :** petits patrons typés et fonctions TypeScript par profil, sans interpréteur général ni `eval`. Une composition conserve ses références par identifiant jusqu’au rendu. Prévoir `generateToponym(context)` avec type de lieu, clé stable, profil et relations géographiques.

**Livrable :** noms culturellement cohérents et lisibles, avec cas de référence relus pour chaque grammaire. Les profils fantasy sont des conventions artistiques explicites.

## Lot 3 — Intégrer le pilote dans Magna Urbis

- [x] Brancher le nouveau fournisseur dans `generateNames`, `settlementNames` et `renameMap`, en conservant positions, priorités et chemins des étiquettes.
- [x] Résoudre les noms de base et corrections manuelles **avant** les noms dérivés : une porte référencera le nom corrigé de sa destination, sans recherche/remplacement dans tous les textes.
- [x] Clé de génération : `(seed, algorithmVersion, corpusFingerprint, profileId, featureKind, stableKey, slot)`. Utiliser les forks existants ; éviter index de tableau et compteur global. Pour les objets sans identité stable, définir leur clé dans le contrat avant intégration.
- [x] Supprimer la dépendance du choix d’un nom à l’ordre du `Set` des noms déjà utilisés. Accepter les homonymes entre lieux distincts ; les variantes locales éventuelles sont choisies par clé stable, sans suffixe numérique lié à l’index.
- [x] Raccorder les réglages de nommage existants : automatique par culture, choix explicite parmi les 13 familles et surcharge locale. Garder langue de l’interface et langue des noms indépendantes. Les profils fins suivent la culture ; un sélecteur explicite plus étendu pourra être ajouté au chantier d’interface.
- [x] Vérifier génération initiale, renommage seul, sauvegarde/rechargement et exports. Changer un style ne doit pas recalculer relief, routes ou urbanisme.

**Livrable :** huit cultures pilotes utilisables entièrement dans le web, y compris une région multiculturelle.

## Lot 4 — Étendre et livrer l’ensemble embarqué

- [x] Compléter les profils de toutes les cultures actives, puis régions, hydrographie, paysages et lieux urbains. Distinguer notamment grec/italien, persan/arabe/turc, coréen/chinois et traditions africaines ou américaines au lieu de reconduire les regroupements actuels.
- [x] Pour chaque couple profil/type, déclarer corpus, composition ou règle procédurale disponible ; répertorier les approximations et lacunes.
- [x] Embarquer tous les profils sélectionnés dans la distribution web, sans chargement depuis Namebench ni CDN à la génération et sans ajouter de police mondiale volumineuse.
- [ ] Valider visuellement les glyphes non latins avec le chantier de texte/rendu ; aucune nouvelle translittération n’est ajoutée au corpus initial.
- [x] Mesurer le poids brut, compressé et celui du bundle de nommage. Ajouter un contrôle automatique du budget de données et conserver les notices de provenance nécessaires.
- [ ] Publier des mesures de latence et de mémoire sur des scénarios de régions représentatifs ; le contrôle fonctionnel navigateur ne constitue pas un benchmark.

**Livrable :** bibliothèque complète pour les cultures Magna Urbis, compacte et autonome ; aucune promesse de couverture de tout Namebench.

## Validation et ordre d’exécution

**Ordre :** lot 0 → lots 1 et 2 → lot 3 → lot 4. Commencer par les établissements pilotes avant d’élargir les types de lieux. Les travaux sont répartis entre extraction, profils/grammaires et intégration ; les validations sont centralisées après raccordement. Les budgets du paquet final restent des objectifs tant que les mesures ne sont pas publiées.

**Coexistence avec le chantier de rendu :** limiter les changements au moteur de nommage, à ses données, à son raccordement et à ses tests. Les couches graphiques, le placement du texte, les styles d’étiquettes et les fichiers d’interface en cours de modification par Claude ne font pas partie de ce chantier.

Contrôles ciblés : couverture du registre ; contractions et noms opaques ; mêmes entrées → mêmes noms ; ordre des établissements et des requêtes sans effet ; ajout d’un lieu sans renommage des autres ; corrections manuelles et références dérivées ; géométrie identique après renommage ; génération sans réseau une fois l’application chargée. Deux extractions identiques doivent donner les mêmes octets.

Depuis `web/`, exécuter les tests de nommage concernés, puis `npm run typecheck`, `npm run test:fast` et le build du parcours modifié (`npm run build:v2` pour V2). Vérifier dans le navigateur une carte multiculturelle et ses exports. Aucun build Rust n’est requis si ce chantier reste limité au nommage TypeScript et aux données.
