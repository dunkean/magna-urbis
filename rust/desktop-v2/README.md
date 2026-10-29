# Magna Urbis V2 · web et application installable

Cette application Tauri est indépendante du lanceur V1 dans `rust/desktop`.
Elle ouvre la nouvelle interface V2 et démarre son moteur Rust natif sur un port
loopback libre. Son identifiant d’application et sa distribution sont distincts.

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

## Préparer un checkout neuf

`rust/pkg` est volontairement ignoré par Git. Installer Node/npm, Rust/rustup
et `wasm-pack` (`cargo install wasm-pack --locked`), puis exécuter `npm ci` et
`npm run prepare:v2` depuis `web/`. La toolchain et la cible WASM sont définies
dans `rust/rust-toolchain.toml`; rustup les installe à la première compilation.
La préparation compile **uniquement** le terrain et les maisons en release,
sans reconstruire ni déplacer l’interface ou les bancs V1. `build:v2` explique
la commande de préparation si un package WASM manque.

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

Le paquet installable inclut le service Rust et les scripts de liaison Python,
mais ni Python, ni CUDA, ni les poids externes. Pour le neuronal local, configurer
`MAGNA_NEURAL_PYTHON` (interpréteur déjà installé) et `MAGNA_NEURAL_EARTH` (checkout
Neural Earth et dépendances installées). Le premier calcul charge les poids sur
GPU; l’interface interroge `/status` et affiche cet état. Le lancement de Python
est optionnel et son absence ne bloque pas l’application.

Les prérequis système et les limites des paquets restent ceux de
[Tauri 2](https://v2.tauri.app/start/prerequisites/). Construire chaque installateur
sur son OS cible. Les sorties sont dans le répertoire Cargo indiqué par Tauri,
sous `release/bundle/`. Les modèles navigateur facultatifs sont copiés seulement
s’ils existent dans `rust/pkg/neural-web`, sans copier les caches neuronaux locaux.
