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
persistant (`../_worktrees/publish-v2`, `publish-v1`), remis exactement au
commit publié à chaque fois, puis publie tout le dossier de sortie. Les
modifications non committées du checkout principal sont préservées et ne sont
pas utilisées pour la construction.

Le worktree garde `node_modules`, `rust/target` et les paquets WASM entre deux
publications. `npm ci` n’est relancé que si `package-lock.json` a changé ;
`prepare:v2` n’est relancé que si `rust/`, `web/scripts/` ou le lockfile ont
changé (comparaison des identifiants d’objets Git du commit), et cargo
recompile alors de façon incrémentale. Une publication qui ne touche que le
TypeScript prend donc quelques minutes. `node scripts/deploy_site.mjs v2 --fresh`
supprime le worktree et reconstruit tout, pour une vérification complète
occasionnelle. L’installeur de bureau reste publié séparément, par tag, via
GitHub Actions (`DESKTOP_RELEASE.md`).

Une page ouverte avant une publication charge encore à la demande les fichiers
de son propre build. Les fichiers hachés de `assets/` qui ne font plus partie du
build restent donc publiés 3 jours après leur retrait (`ASSET_RETENTION_DAYS`) ;
`assets-retained.json`, sur `gh-pages`, note la date de retrait de chacun.

Les interfaces actuelles demandent Rust, la cible WASM et `wasm-pack` :
`prepare:v2` compile les moteurs procéduraux et les maisons avant le build.
Il compile aussi toujours le paquet multithread `rust/pkg/wasm-threads`
(mémoire partagée, pool rayon ; composant `rust-src` de la toolchain épinglée,
`-Z build-std`). Le site publie les deux moteurs : le navigateur charge le
multithread quand la page est isolée (`coi-serviceworker.js` sur GitHub Pages),
sinon le paquet monothread. Le déploiement échoue si le paquet multithread
manque dans `dist-v2/assets`. `--no-threads` (CI bureau) l'omet.
Pour la V2, le contrôle navigateur
`test:v2:static` doit passer avant la publication ; Microsoft Edge est utilisé
par défaut, ou le canal Playwright indiqué par `MAGNA_BROWSER_CHANNEL`.
Les services Python/CUDA et leurs modèles restent des composants locaux
facultatifs, distincts de l'hébergement statique.
La publication V2 inclut également le runtime neuronal JS/WASM et le manifeste
`neural/models/manifest.json`. Avant publication, préparez le profil navigateur
dans le checkout principal avec `npm run prepare:v2 -- --neural` (checkout
`../infinite_map` complet nécessaire uniquement pour cette préparation).
Le déploiement reprend `rust/pkg/neural-web` du checkout principal dans le
worktree temporaire : il ne cherche pas `../infinite_map` depuis ce worktree.
Il refuse de publier si le SHA-256 du WASM diffère de `runtimeSha256` ou si
la taille ou le SHA-256 d’un poids diffère du manifeste. Les fichiers générés
doivent donc être préparés depuis les sources neuronales épinglées avant de
publier le snapshot committé. Aucun build Rust neuronal n’est lancé à cette étape.

Les poids sont hébergés **sur la même origine**, en morceaux de 40 000 000 octets
maximum (`neural/models/base.nf4.part0`, etc., également pour coarse et decoder).
Le manifeste publié conserve le hash du fichier complet et ajoute une liste
`chunks` avec nom, taille et SHA-256 de chaque morceau. Aucun fichier `base.nf4`
de 150 Mo n’est ajouté à `gh-pages`. Le JS reçoit aussi `runtimeJsSha256`.
Les licences des poids préparés et du professeur sont incluses sous `neural/`.
Les fichiers de poids bruts du checkout principal restent inchangés.

Choix vérifié le 15 novembre 2026 :
`curl -sI -H "Origin: https://magna-urbis.org" -L https://github.com/dunkean/magna-urbis/releases/download/desktop-v0.3.1/base.nf4`
renvoie `302 Found`, puis `200 OK` (`Content-Length: 149638301`), sans
`Access-Control-Allow-Origin`, y compris sur l’URL finale
`release-assets.githubusercontent.com`. Ces assets ne conviennent donc pas à
un `fetch` navigateur depuis le site ; les morceaux évitent cette dépendance CORS
et restent sous les limites de taille GitHub.

Le téléchargement est déclenché uniquement par une génération neuronale ou un
bouton de téléchargement explicite dans les réglages, jamais au chargement de
la page. Sans WebGPU utilisable, aucun poids n’est téléchargé. Le premier usage
affiche un avertissement mémorisé avec Continuer / Annuler et un lien vers
l’application de bureau (environ 163 Mo, GPU performant conseillé). La carte de
progression existante affiche Mo, pourcentage et annulation. Chaque morceau puis
le fichier réassemblé sont vérifiés avant enregistrement dans le cache navigateur
`magna-urbis-neural-models-v1`, distinct des fichiers natifs et Python.
Le runtime vérifié utilise `magna-urbis-neural-runtime-v1`. Une demande de
stockage persistant est effectuée ; le navigateur peut la refuser ou l’utilisateur
effacer les données. Les poids valides sont réutilisés hors connexion, sans
retéléchargement lors d’une nouvelle visite ; le manifeste sauvegardé et le
runtime sont réutilisables lorsque le serveur est inaccessible. Cela ne rend pas
toute l’application disponible hors connexion. Un nouveau hash télécharge les
nouveaux fichiers ; un cache corrompu est réparé. L’annulation conserve uniquement
les modèles complets déjà vérifiés. Le mode développement accepte toujours les
fichiers complets sous `./neural/` sans découpage.

Choisir **Neural** vérifie la présence du jeu de modèles dans le stockage local.
S’il manque un fichier, **Réglages → Télécharger les modèles** s’ouvre directement,
y compris lorsqu’on reclique sur Neural déjà sélectionné. Ce clic ne télécharge
aucun poids ; le bouton de téléchargement reste une action explicite. Les modèles
du navigateur et ceux de l’application native sont vérifiés séparément. Si les
modèles sont présents mais que le GPU est indisponible, les réglages d’exécution
s’ouvrent pour consulter le diagnostic. La détection essaie le GPU haute performance,
puis le choix par défaut du navigateur ; elle ne contourne pas les blocages du navigateur.

Les identifiants Git doivent permettre de pousser vers le dépôt concerné.
Le fichier `CNAME`, `.nojekyll`, les licences et la révision de source sont
inclus dans la publication. La galerie et la documentation déjà publiées
sont conservées ; les fichiers générés de l'application sont remplacés.
Les publications ne réécrivent pas l'historique de la branche `gh-pages`.

Le script `deploy_gallery.sh` continue de publier la galerie sur
https://magna-urbis.org/gallery/v2/.

## Contrôle réel après publication

Depuis `web/`, `npm run test:v2:live` ouvre le site public dans un profil Edge
de test et utilise les contrôles ordinaires de l’atelier. Il vérifie le refus
du neuronal CPU avant téléchargement, le téléchargement vérifié, une génération
neuronale WebGPU réelle, la chaîne complète avec les villes depuis la vue 3D, la sélection d’une
maison et le passage à un toit différent sans modifier son emprise, l’export et
la réouverture du projet, la 3D, les styles et la langue. Il annule également une
inférence GPU commencée, relance la génération, puis génère avec les adresses de
modèles bloquées pour vérifier le cache hors connexion. Aucun moteur n’est simulé.
Le parcours règle aussi le profil des noms avant génération, puis remplace celui
du peuplement principal en vérifiant que le relief, les bâtiments et la provenance
des noms régionaux restent inchangés.
`?test=1` désactive seulement la restauration automatique de la recette précédente ;
le test n’utilise pas les hooks de génération réservés aux captures.

Le rapport, les projets et les captures sont dans `web/out/v2-live/`. La machine
doit disposer d’un vrai périphérique WebGPU. Le rapport identifie la version du
site et l’architecture du GPU ; il ne certifie pas les autres matériels.
`MAGNA_V2_URL` sélectionne une instance candidate, `MAGNA_V2_RECIPE` fournit un
fichier de recette ou projet à reproduire, et `MAGNA_V2_LIVE_PROFILE` permet de
réutiliser un profil de test. Sous Windows, `MAGNA_TEST_ADAPTER_LUID` peut imposer
le GPU des tests sans modifier les préférences du navigateur de l’utilisateur.

Dernière qualification : [15 novembre 2026](WEB_QUALIFICATION_2026-11-15.md).
