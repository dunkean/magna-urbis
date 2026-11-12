# Magna Urbis V2 · web et application installable

Cette application Tauri est indépendante du lanceur V1 dans `rust/desktop`.
Elle ouvre la nouvelle interface V2 et démarre son moteur Rust natif sur un port
loopback libre. Son identifiant d’application et sa distribution sont distincts.

La [préparation de la release desktop](../../docs/V2_RELEASE_FR.md) précise le
périmètre Windows/Linux, les installations IA facultatives et la diffusion des
poids originaux et distillés sur Hugging Face. Cette préparation reste évolutive
pendant le chantier V2 et ne fige pas les interfaces des moteurs.

## Utiliser la version Windows

Deux formats x64 sont prévus : l'installateur NSIS `.exe`, ou une archive
portable `.zip`. Pour l'archive, extraire **tout son contenu** dans un dossier,
puis lancer `magna-urbis-v2-desktop.exe` depuis ce dossier. Conserver les fichiers
et le dossier `resources` ensemble ; ne pas lancer le programme directement
depuis l'aperçu du ZIP. Le ZIP évite l'installation, mais les réglages,
environnements et caches restent dans les dossiers utilisateur Windows
(`%LOCALAPPDATA%\MagnaUrbis`), partagés avec la version installée ; ils ne sont
pas automatiquement conservés sur une clé USB. Windows et le runtime WebView2
sont nécessaires. Les paquets sont non signés et Windows peut afficher un
avertissement.

Le moteur procédural est inclus ; Python, CUDA, les poids neuronaux et les
dépendances d'illustration sont facultatifs et ne sont pas inclus. Ils peuvent
être configurés ou installés séparément depuis les réglages. Consulter les
sommes SHA-256 fournies avec chaque distribution.

Depuis `web/` :

```sh
npm ci
npm run prepare:v2                  # Terrain + maisons Rust/WASM release
node scripts/v2.mjs dev             # Web complet, http://127.0.0.1:5174/v2.html
node scripts/v2.mjs build           # Distribution statique dans web/dist-v2
node scripts/v2.mjs local           # Web V2 + Rust natif + Python optionnel
npm run app:v2:dev                  # Application de bureau en développement
npm run app:v2:build                # Application et installateur pour cet OS
```

Les noms npm sont définis dans `web/package.json`. `--no-build` réutilise le binaire
Rust release existant; `--no-neural` ignore Python pour le lanceur navigateur.
Les services déjà ouverts sont réutilisés sans être arrêtés par le lanceur.

## Mises à jour de l’application

Au démarrage, la version desktop vérifie les releases publiques GitHub de
`dunkean/magna-urbis`, y compris les préversions portant un tag `desktop-vX.Y.Z`.
Si une version supérieure possède un installeur pour la plateforme courante,
un lien **Télécharger l’installeur** apparaît dans l’en-tête et dans
**Réglages & moteurs → Mises à jour de l’application**. Ce panneau indique aussi
la version installée et permet de relancer la vérification. Hors connexion ou
si GitHub est indisponible, l’application reste utilisable.

Le lien ouvre le téléchargement dans le navigateur système. Fermer Magna Urbis,
puis lancer le nouvel installeur : il remplace l’installation existante.
Windows utilise le `.exe` NSIS ; Linux propose le `.deb` ou, à défaut, l’AppImage.
Une AppImage téléchargée doit remplacer manuellement l’ancienne. Le ZIP portable
reste disponible dans les releases ; le lien de mise à jour propose l’installeur.
Aucun contrôle de compatibilité des projets, moteurs ou modules, ni migration
des données n’est effectué. Les données utilisateur restent dans leur dossier
existant. L’édition web n’effectue pas cette vérification.

Pour diffuser une mise à jour, aligner les versions de `Cargo.toml` et
`tauri.conf.json`, puis publier le tag `desktop-v<version>` via le workflow
desktop existant. La release publiée avec ses installeurs suffit ; aucun
manifeste de mise à jour ni signature d’updater n’est nécessaire.

Contrôles ciblés depuis `web/` :

```sh
npx vitest run tests/v2DesktopUpdates.test.ts tests/v2Platform.test.ts
node scripts/v2_updates_check.mjs
```

Le second contrôle utilise Edge headless et des releases simulées, sans télécharger
ni lancer d’installeur. Pour vérifier les commandes natives, depuis `rust/` :
`cargo test --manifest-path desktop-v2/Cargo.toml updates::tests`.

## Préparer un checkout neuf

`rust/pkg` est volontairement ignoré par Git. Installer Node/npm, Rust/rustup
et `wasm-pack` (`cargo install wasm-pack --locked`), puis exécuter `npm ci` et
`npm run prepare:v2` depuis `web/`. La toolchain et la cible WASM sont définies
dans `rust/rust-toolchain.toml`; rustup les installe à la première compilation.
La préparation compile **uniquement** le terrain et les maisons en release,
sans reconstruire ni déplacer l’interface ou les bancs V1. `build:v2` explique
la commande de préparation si un package WASM manque.

Le terrain Python utilise aussi un petit module WASM de conditionnement CPU.
Les commandes desktop le compilent automatiquement si `../infinite_map` contient
`native/neural-earth` et `tools/wasm`. On peut aussi le préparer explicitement
avec `node scripts/neural_wasm.mjs --conditioning-only` depuis `web/` : aucun
poids navigateur n’est nécessaire. Le workflow de release récupère ces sources
à la révision `20fd8543b50da1d6ae839c01e0230cb8ee59ee8a`.

Le relief neuronal du navigateur reste facultatif. Pour l’embarquer :

```sh
npm run prepare:v2 -- --neural
npm run build:v2
```

Le préparateur neuronal existant attend le checkout `../infinite_map` à côté
de ce dépôt, avec `native/neural-earth`, `terrain-diffusion` et les sous-modules
initialisés, ainsi que ses dépendances et accès aux poids Terrain Diffusion.
Il construit le runtime et copie les modèles dans `rust/pkg/neural-web`.
Ces modèles externes ne sont pas nécessaires à l’application procédurale.
Le neuronal Python utilise un environnement séparé, décrit plus bas; les
deux préparations ne se substituent pas l’une à l’autre.

## Distribution Web

Publier **le contenu de `web/dist-v2`** sous le chemin `/magna-urbis/v2/` sur
GitHub Pages conserve les liens relatifs, les workers, les binaires WASM et la
documentation scientifique sous `scientific/`. `index.html` et `v2.html` ouvrent
la même application. Aucune API locale n’est contactée en profil Web.

`web/dist-v2` constitue l’artifact statique prêt à héberger; une publication
GitHub Pages par artifact doit déposer son contenu sous `v2/` à côté de la V1.
La construction ne publie rien. Le contrôle `node scripts/v2_static_check.mjs`
sert exactement cet artifact sous `/magna-urbis/v2/` et vérifie les workers,
une génération réelle et les ressources illustrées de la documentation.

Le CPU reste disponible sans GPU. WebGPU n’est proposé qu’après création réussie
d’un périphérique; le moteur restitue son backend réellement utilisé. Un choix
GPU forcé échoue explicitement si le périphérique n’est plus utilisable. Les
moteurs neuronaux existants utilisent **WebGPU** ou **Python/CUDA** : ils ne
fournissent pas actuellement d’inférence CPU. Le procédural offre le chemin CPU.

## Modules Python facultatifs

Le paquet inclut le service Rust, les scripts Python et `uv` 0.13.6 ; il ne
contient ni interpréteur Python, ni pilote CUDA, ni poids externes. La construction
télécharge l’archive `uv` propre à la plateforme et vérifie son SHA-256. Le
procédural fonctionne sans installer Python. Dans l’application installée, ouvrir
**Réglages & moteurs → Modules facultatifs pour ordinateur** pour configurer un
interpréteur existant, installer séparément les dépendances du terrain ou de
l’illustration, vérifier leur environnement et démarrer le service. Un chemin
Python vide sélectionne l’environnement géré ; le chemin Neural Earth est facultatif.

L’installation assistée télécharge Python et des dépendances pouvant représenter
plusieurs Go ; pour le terrain, elle récupère aussi des archives de sources Neural
Earth à des révisions fixées si aucun chemin n’est fourni. Elle ne télécharge pas
les poids. Les boutons de téléchargement des modèles sont distincts : les
originaux utilisent la révision indiquée dans l’inventaire ; les champs distillés
proposent le dépôt Hugging Face publié et son commit, modifiables. Aucun poids n’est téléchargé
au démarrage. Après le démarrage d’un service, le bouton de rechargement relance la
détection dans l’interface. Les journaux et dossiers de données/cache sont indiqués
dans le panneau. La disponibilité de CUDA et des modèles dépend de la machine.

La [procédure manuelle Python](../../python_runtime/README.md) décrit aussi les
commandes `uv`, les chemins et les variables d’environnement. Les opérations sur
les modèles et leur éventuelle publication sont détaillées dans le
[guide Hugging Face](../../docs/models-release/README.md). Les environnements
optionnels restent indépendants et leur absence ne bloque pas le moteur procédural.
Un service compatible déjà démarré peut être réutilisé même si aucun interpréteur
local n'est configuré. Le panneau distingue son état de celui de l'environnement ;
la détection est actualisée pendant le démarrage. Un test ciblé couvre aussi le
passage du relief procédural à Python.

Les prérequis système et les limites des paquets restent ceux de
[Tauri 2](https://v2.tauri.app/start/prerequisites/). Construire chaque installateur
sur son OS cible. Les sorties sont dans le répertoire Cargo indiqué par Tauri,
sous `release/bundle/`. Les modèles navigateur facultatifs sont copiés seulement
s’ils existent dans `rust/pkg/neural-web`, sans copier les caches neuronaux locaux.
Le workflow [desktop V2](../../.github/workflows/desktop-v2-release.yml) prépare
des paquets Windows x64 et Linux x64 non signés ; son lancement manuel ne publie
pas de release. Sous WSL2 Ubuntu 22.04, le `.deb` extrait de la dernière
construction et l'AppImage extrait d'une construction précédente ont affiché
l'interface sous WSLg et fermé leur service Rust normalement ; un
calcul procédural Rust a produit 4 096 hauteurs finies. La construction AppImage
a nécessité le préchargement des outils aux URL officielles de Tauri après un
timeout de son téléchargement interne. Les essais sur machines propres restent
à effectuer ; voir les détails et les limites GPU dans la
[préparation de release](../../docs/V2_RELEASE_FR.md).
L'icône du paquet est générée depuis [`app-icon-v2.png`](assets/app-icon-v2.png).

Sous Windows, l'archive portable ZIP est une alternative à l'installateur :
extraire tout le dossier puis lancer `magna-urbis-v2-desktop.exe`, en conservant
`resources` à côté. L'application ne nécessite pas d'installation ni de droits
administrateur pour fonctionner ; le runtime Microsoft Edge WebView2 est requis.
Les réglages, environnements Python optionnels et caches restent dans les données
de l'utilisateur, partagés avec l'édition installée ; ils ne sont pas portables
avec le dossier extrait.
