# Publication Web

Les sources des deux versions restent dans `dunkean/magna-urbis`.

| Version | Adresse | Dépôt de publication | Branche |
| --- | --- | --- | --- |
| V2 | https://magna-urbis.org/ | `dunkean/magna-urbis` | `gh-pages` |
| V1 | https://v1.magna-urbis.org/ | `dunkean/magna-urbis-v1` | `gh-pages` |

`www.magna-urbis.org` redirige vers le domaine principal. Les domaines sont
configurés dans Settings → Pages de chaque dépôt, avec HTTPS imposé.
Les DNS restent chez Namecheap.

Depuis `web/`, après avoir committé les modifications à publier :

```sh
node scripts/deploy_site.mjs v2
node scripts/deploy_site.mjs v1
```

Les lanceurs Bash `scripts/deploy_pages.sh` et `scripts/deploy_v1.sh` sont
également disponibles. Chaque commande construit `HEAD` dans un worktree
temporaire, installe les dépendances avec `npm ci`, puis publie tout le dossier
de sortie. Les modifications non committées sont préservées et ne sont pas
utilisées pour la construction.

Les interfaces actuelles demandent Rust, la cible WASM et `wasm-pack` :
`prepare:v2` compile les moteurs procéduraux et les maisons avant le build.
Pour la V2, le contrôle navigateur
`test:v2:static` doit passer avant la publication ; Microsoft Edge est utilisé
par défaut, ou le canal Playwright indiqué par `MAGNA_BROWSER_CHANNEL`.
Les services Python/CUDA et leurs modèles restent des composants locaux
facultatifs, distincts de l'hébergement statique.
La publication standard inclut le moteur procédural CPU/WebGPU, sans les
poids et le runtime neuronaux optionnels du navigateur (`prepare:v2 -- --neural`).

Les identifiants Git doivent permettre de pousser vers le dépôt concerné.
Le fichier `CNAME`, `.nojekyll`, les licences et la révision de source sont
inclus dans la publication. La galerie et la documentation déjà publiées
sont conservées ; les fichiers générés de l'application sont remplacés.
Les publications ne réécrivent pas l'historique de la branche `gh-pages`.

Le script `deploy_gallery.sh` continue de publier la galerie sur
https://magna-urbis.org/gallery/v2/.
