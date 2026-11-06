# Toponymes embarqués depuis Namebench

Le nommage utilise un extrait local de Namebench et des profils reliant les cultures de Magna Urbis à des corpus et à des règles de composition. Le navigateur ne contacte ni Namebench, ni une API externe. La langue de l’interface reste indépendante du style des noms.

## Ressources

Le [paquet](../web/src/gen/names/data/names-pack.json) contient **549 469 noms**, répartis entre établissements, cours d’eau, lacs, reliefs et régions, ainsi que les tableaux et patrons de **51 générateurs**. Il occupe **8 194 380 octets de JSON UTF-8**, soit **3 040 090 octets gzip** lors de la préparation. Les 253 codes pays sont ceux de la source, y compris quelques codes obsolètes sans lieux habités.

Le [manifeste](../web/src/gen/names/data/names-manifest.json) indique les empreintes, quantités par pays, filtres, quotas et sources. Le quota maximal par pays est de 2 048 établissements, 512 cours d’eau, 256 lacs, 512 reliefs et 256 régions. Les petites sources ne sont pas artificiellement complétées. Les corpus sont des sélections géographiques modernes ; ils ne prouvent ni la langue exacte ni l’authenticité historique d’un nom. Les approximations des profils sont déclarées dans le registre.

Les générateurs romain et viking dont les tableaux source référencés étaient vides ont été exclus de l’extrait. La base source ne contient pas de classe végétation : les forêts utilisent les ressources procédurales ou la composition disponible. L’extrait ne contient pas de généalogies, de personnes ou de descriptions.

## Usage et règles

### Culture intégrale ou traduction partielle

Dans **Carte → Nommage**, le réglage **Présentation des toponymes** propose deux modes :

- **Culture intégrale**, par défaut : conserver la forme culturelle complète.
- **Traduction partielle** : adapter uniquement les termes génériques à la langue d’affichage choisie : français, anglais, japonais, arabe, espagnol, portugais ou chinois.

Exemple de nom propre : `Tsing Tao` donne `Fleuve Tsing Tao` en français ou `Tsing Tao River` en anglais. Le nom propre, la forme culturelle et le texte affiché sont enregistrés séparément. Revenir au mode culturel restaure sa forme complète ; la langue d’affichage ne participe jamais au tirage des noms. Les choix sont conservés dans le projet. Ces sept langues concernent les noms de lieux ; l’interface globale reste en français et anglais.

Les noms opaques, dont les éléments ne peuvent être séparés avec certitude, restent intacts. Les noms nus identifiés par leur type peuvent recevoir un générique localisé ; les noms complets contenant déjà leur descripteur ne sont pas découpés par un remplacement de texte global. Le rendu arabe isole le nom propre pour préserver l’ordre bidirectionnel.

### Profils et vocabulaire

- Le choix automatique suit la culture de chaque établissement. Les choix explicites de langue disponibles dans les réglages restent prioritaires.
- Les éléments naturels suivent le profil de la région, qui utilise actuellement la culture de l’établissement principal.
- Les noms complets importés sont opaques : ils ne reçoivent pas arbitrairement un second article ou un suffixe. Les petits générateurs évaluent seulement leurs tableaux et patrons de concaténation.
- Les relations de destination sont conservées dans les étiquettes dérivées. Les corrections utilisateur sont appliquées avant leur composition, sans remplacement global de texte.
- Les contractions françaises prennent en compte les articles lexicaux ; les autres profils définissent leurs propres connecteurs. Une morphologie non définie reste simple, sans déclinaison inventée.
- Un renommage détache les métadonnées modifiables et conserve les tableaux physiques, chemins, rues et bâtiments. Il n’exécute pas le générateur de terrain ou d’urbanisme.

Les profils et générateurs sont dans [profiles.ts](../web/src/gen/names/profiles.ts), [toponyms.ts](../web/src/gen/names/toponyms.ts) et [syntax.ts](../web/src/gen/names/syntax.ts). L’identité de rejeu comprend la graine, les versions, l’empreinte du corpus, le profil et la clé du lieu. Les homonymes sont permis entre identités distinctes. Les noms de quartiers et rues conservent aussi les petits vocabulaires urbains existants ; toutes les grammaires ne sont pas des modèles linguistiques complets.

La révision de qualité du 6 novembre ajoute un vocabulaire urbain propre à chaque profil fin et **55 palettes phonotactiques originales**, pour éviter notamment de tirer des noms coloniaux américains pour un village pueblo ou des villes italiennes modernes pour un site romain. Ces palettes sont des conventions fictionnelles cohérentes, pas des reconstructions historiques attestées. Le [choix des sources](NAMEBENCH_CULTURAL_SOURCES.md) et les [règles grammaticales et leurs références](NAMEBENCH_GRAMMAR_SOURCES.md) détaillent cette distinction. Les deux corpus participent à l’empreinte de rejeu de l’algorithme 2.

Les tests vérifient notamment les contractions et particules, les descripteurs déjà présents, le vocabulaire des sites minoritaires, les changements de langue, les références après correction manuelle et la restauration de la forme culturelle. Le paquet Namebench brut reste inchangé ; les palettes supplémentaires occupent environ 90 Kio de JSON.

## Refaire l’extraction

Depuis la racine de Magna Urbis, avec Python et `../namebench/data/names.db` :

```powershell
python tools/namebench/export.py
python tools/namebench/export.py --check
```

L’exporteur ouvre la source SQLite en lecture seule et immuable. Il sélectionne les noms normalisés NFC par classement de hachage stable, sans tirage SQL aléatoire. Le contrôle recalcule les sorties et compare les octets. La base de 1,2 Go reste locale ; les builds web utilisent directement les fichiers JSON suivis avec le code. Aucun environnement Python Namebench n’est nécessaire à l’exécution web.

Depuis `web/`, le contrôle navigateur dédié est `node scripts/namebench_browser_check.mjs`. Il construit un bundle à partir du véritable moteur de nommage et de ses contrôles, le charge dans Edge sans interface visible, coupe le réseau et vérifie le rejeu sur tous les profils culturels, les sept traductions génériques et les deux modes du panneau. Son rapport est écrit dans `web/out/namebench-browser-check.json`. Il ne teste pas le placement graphique des étiquettes.
