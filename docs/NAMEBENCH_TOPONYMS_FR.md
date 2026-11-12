# Toponymes embarqués depuis Namebench

Le nommage utilise un extrait local de Namebench et des profils reliant les cultures de Magna Urbis à des corpus et à des règles de composition. Le navigateur ne contacte ni Namebench, ni une API externe. La langue de l’interface reste indépendante du style des noms.

## Ressources

Le [paquet](../web/src/gen/names/data/names-pack.json) contient **549 469 noms**, répartis entre établissements, cours d’eau, lacs, reliefs et régions, ainsi que les tableaux et patrons de **51 générateurs**. Il occupe **8 194 380 octets de JSON UTF-8**, soit **3 040 090 octets gzip** lors de la préparation. Les 253 codes pays sont ceux de la source, y compris quelques codes obsolètes sans lieux habités.

Le [manifeste](../web/src/gen/names/data/names-manifest.json) indique les empreintes, quantités par pays, filtres, quotas et sources. Le quota maximal par pays est de 2 048 établissements, 512 cours d’eau, 256 lacs, 512 reliefs et 256 régions. Les petites sources ne sont pas artificiellement complétées. Les corpus sont des sélections géographiques modernes ; ils ne prouvent ni la langue exacte ni l’authenticité historique d’un nom. Les approximations des profils sont déclarées dans le registre.

Les générateurs romain et viking dont les tableaux source référencés étaient vides ont été exclus de l’extrait. La base source ne contient pas de classe végétation : les forêts utilisent les ressources procédurales ou la composition disponible. L’extrait ne contient pas de généalogies, de personnes ou de descriptions.

## Usage et règles

### Présentation, profils et sources

Dans **Carte → Nommage**, la présentation par défaut traduit les éléments génériques dans la langue de l’interface (français, anglais, espagnol, portugais, chinois, arabe, russe et japonais). Le mode **Culture intégrale** conserve la forme culturelle. Une langue de carte indépendante peut être choisie pour une carte destinée à une autre langue, sans changer l’interface.

Les réglages de profil et de source portent au choix sur les réglages communs, le paysage régional ou une ville. L’éditeur de noms permet aussi une surcharge par objet ou quartier. L’héritage suit objet → quartier → ville → réglages communs ; le paysage régional possède sa propre surcharge. Les rues et objets natifs suivent la culture locale des phases/quartiers, sauf profil linguistique explicitement choisi.

Tous les profils du registre sont accessibles, y compris les profils fins. Le profil européen automatique est stable (français), indépendamment de la graine. Les alias natifs `west` et `mongol` sont normalisés. Une culture inconnue possède un repli anglais diagnostiqué ; elle ne reçoit pas silencieusement un nom français.

Les sources sont **selon le profil**, **géographique**, **inventée** ou **mixte**. Les sources géographiques sont des sélections de pays modernes, sans garantie de langue ou d’époque historique. Un profil sans corpus géographique garde sa palette inventée et fournit un diagnostic. Les palettes inventées sont des conventions fictionnelles, sans prétention de reconstruction historique.

La lecture latine conserve les noms déjà latins et applique les correspondances explicites disponibles pour les sources grecques et cyrilliques. Une écriture sans lecture disponible reste intacte ; le système n’invente pas de transcription ni d’écriture originale à partir d’une palette latine.

### Modèle commun et références

Les noms propres, formes culturelles et textes affichés sont séparés. Les descriptions connues (marché, vieux quartier, direction, métier) sont conservées comme concepts multilingues au moment de la composition. Les vocabulaires historiques fournissent eux aussi ces métadonnées. Un nom importé complet reste opaque lorsqu’aucune décomposition fiable n’est disponible.

Les quartiers, rues, portes, édifices et monuments natifs sont convertis en enregistrements de noms avec identité, culture et rôle. Leurs anciens libellés français de diagnostic ne servent plus de toponymes. Les étiquettes natives et classiques partagent la présentation de la carte, de la 3D et des exports. Les textes arabes et les séquences combinées sont façonnés en un seul segment, pour préserver les ligatures et l’ordre bidirectionnel.

L’éditeur distingue **nom propre et références**, **texte libre complet**, et les modifications de placement/typographie. Modifier uniquement le style ou la position ne fige pas la langue de l’étiquette. Les noms d’établissements modifiés mettent à jour les routes, portes et châteaux qui les référencent.

### Conservation et régénération

Les identifiants sont attachés aux objets, sans dépendance à l’ordre des étiquettes. Les métadonnées d’identité des rues, rivières, routes et quartiers sont conservées lors des déplacements et dans le projet. Les anciennes modifications `n0`, `n1`, etc. sont migrées grâce au type et à l’ancre de leur objet dans la carte enregistrée, jamais à leur nouvelle position dans la liste.

Un registre de noms générés (`NamesLayer.bank`) est enregistré avec le monde. À profil et politique inchangés, les noms sont réutilisés après mise à jour du corpus. **Générer d’autres noms** change explicitement la variation de la portée choisie (carte, région, ville ou objet) ; les autres portées sont conservées. Les corrections de l’auteur sont réappliquées après composition. Changer de langue, de style ou de quantité visible ne régénère pas les noms.

L’algorithme 3 garde les empreintes de corpus comme provenance, sans les injecter dans la graine de tous les objets. Les corpus, générateurs et palettes restent locaux, sans appel réseau. Le titre de carte peut être personnalisé indépendamment du nom de la ville.

### Quantité visible par importance

Dans **Affichage → Textes**, neuf curseurs indépendants règlent les lieux habités, rivières, autres eaux, paysages, quartiers, rues, bâtiments, monuments et repères. **0** masque la catégorie, **1** conserve son élément principal, **100** autorise tous les candidats. Les étapes intermédiaires ajoutent progressivement les objets selon leur importance, puis leur étendue et leur identité stable. Les noms de petites rivières, des rues secondaires et des objets natifs sont produits même lorsqu’ils sont masqués.

Le zoom, les groupes visibles, les collisions et le budget global d’étiquettes continuent de protéger la lisibilité. Le maximum du curseur autorise tous les noms ; il ne force pas leur superposition. Les anciennes compositions sans curseurs conservent leur comportement de visibilité antérieur. Les réglages sont enregistrés dans la composition et utilisés par les rendus 2D, 3D et les exports vectoriels/raster.

Les principaux modules sont `gen/names/{profiles,toponyms,culturalVocabulary,meanings,identity,policy,displayNames}.ts`, `v2/{mapNaming,nativeNames,mapLabels}.ts` et `render/{textLayer,mapLabels,svgLabels}.ts`. Les tests `namingSystem.test.ts` couvrent l’intégration des profils, sources, références, noms conservés, éditions, objets natifs, curseurs et écritures.

## Refaire l’extraction

Depuis la racine de Magna Urbis, avec Python et `../namebench/data/names.db` :

```powershell
python tools/namebench/export.py
python tools/namebench/export.py --check
```

L’exporteur ouvre la source SQLite en lecture seule et immuable. Il sélectionne les noms normalisés NFC par classement de hachage stable, sans tirage SQL aléatoire. Le contrôle recalcule les sorties et compare les octets. La base de 1,2 Go reste locale ; les builds web utilisent directement les fichiers JSON suivis avec le code. Aucun environnement Python Namebench n’est nécessaire à l’exécution web.

Depuis `web/`, le contrôle navigateur dédié est `node scripts/namebench_browser_check.mjs`. Il construit un bundle à partir du véritable moteur de nommage et de ses contrôles, le charge dans Edge sans interface visible, coupe le réseau et vérifie le rejeu sur tous les profils culturels, les huit traductions génériques et les deux modes du panneau. Son rapport est écrit dans `web/out/namebench-browser-check.json`. Il ne teste pas le placement graphique des étiquettes.
