# Préparer la release desktop V2

Périmètre retenu le 2 novembre 2026 : projet loisir open source, Windows x64 et
Linux x64, moteur Rust inclus et IA facultative. macOS est reporté. Préparer la
distribution pendant le chantier V2 sans figer les API, les formats de projet ou
les interfaces des moteurs. Ce document distingue les fonctions préparées des
essais et publications encore nécessaires.

## Installation et budget

L'installation de base vise la génération procédurale avec Rust, sans Python,
Node, Cargo ni modèles à installer chez l'utilisateur. Le workflow Tauri prépare
un installateur Windows NSIS et des paquets Linux `.deb` et AppImage. Annoncer
seulement les OS réellement testés : l'installation sur machine propre reste à
valider.

Pour Windows x64, un ZIP portable accompagne l'installateur NSIS : extraire
l'intégralité de l'archive avant de lancer `magna-urbis-v2-desktop.exe` et garder
le dossier `resources` à côté. L'exécution exige WebView2 ; elle évite une
installation système mais conserve données, réglages et caches dans le profil
Windows (`%LOCALAPPDATA%\MagnaUrbis`), comme la version installée. Python, CUDA,
les modèles IA et les dépendances d'illustration restent facultatifs et séparés.

Le panneau **Modules facultatifs pour ordinateur** permet de configurer un Python
existant ou de demander une installation assistée séparée pour le terrain et
l'illustration, puis de vérifier et démarrer les services. `uv` 0.13.6 est intégré ;
son archive est téléchargée à la construction et vérifiée par SHA-256. Les
installations explicites peuvent télécharger plusieurs Go ; celle du terrain
récupère aussi les sources Neural Earth épinglées si aucun chemin n'est configuré.
Les poids sont un téléchargement distinct et ne sont pas téléchargés au démarrage.
Un service compatible déjà actif est réutilisable sans interpréteur configuré ;
le panneau affiche séparément l'état du service et celui de l'environnement. Un
test ciblé couvre la sélection de Python après le mode procédural.
Le pilote NVIDIA/CUDA est un prérequis du profil local. Un passage réel du modèle
`decoder16` a été vérifié sur le GPU Windows avec PyTorch 2.11 ; sous WSL, un
environnement PyTorch 2.7 existant a réussi un calcul de tenseur CUDA. Ces essais
ne valident ni l'installation complète d'un nouvel environnement ni une génération
de terrain neuronal complète. Voir la [procédure manuelle](../python_runtime/README.md).

Pas de serveur GPU à financer. Les calculs restent sur la machine de l'utilisateur ;
une API externe éventuelle utilise sa propre clé. Le Hub public Hugging Face offre
du stockage gratuit en best effort, sous limites et politique d'usage : les exports
distillés actuels représentent environ 100 Mo, un bon point de départ sans offre
payante. Ne pas y conserver tous les checkpoints d'entraînement. Le coût principal
à maîtriser est le temps de maintenance, particulièrement pour les installations GPU.

Une signature commerciale Windows et la mise à jour automatique peuvent attendre :
documenter les avertissements d'un paquet non signé et proposer d'abord le
téléchargement manuel des nouvelles releases. La version desktop vérifie désormais
les releases GitHub au démarrage et affiche un lien vers le nouvel installeur dans
l’en-tête et les réglages. Le téléchargement s’ouvre dans le navigateur ; fermer
l’application puis lancer l’installeur remplace l’installation, sans contrôle de
compatibilité ni migration. Le panneau permet aussi de relancer la vérification.
Les préversions `desktop-v<version>` sont incluses. Voir le
[fonctionnement des mises à jour](../rust/desktop-v2/README.md#mises-à-jour-de-lapplication).
Une seule plateforme IA qualifiée
(NVIDIA/CUDA) suffit au départ.

Sources : [stockage Hugging Face](https://huggingface.co/docs/hub/storage-limits),
[Python géré par uv](https://docs.astral.sh/uv/guides/install-python/),
[distribution Tauri](https://v2.tauri.app/distribute/).

## Relief original et poids distillés

Réutiliser les fichiers existants
[`catalog.json`](../rust/models/neural-earth/catalog.json) et
[`model-inventory.json`](../rust/models/neural-earth/model-inventory.json), sans
introduire une nouvelle couche de contrats. Garder distincts les exports Python,
Rust natif et navigateur : ils ne sont pas automatiquement interchangeables.

- [x] Préparer le téléchargement des poids **originaux** depuis
  [`xandergos/terrain-diffusion-30m`](https://huggingface.co/xandergos/terrain-diffusion-30m).
  Utiliser la révision fixée dans l'inventaire et télécharger aussi les
  configurations nécessaires au chargement.
  Ne pas republier une copie des originaux dans le dépôt des distillations.
- [ ] Afficher les fichiers nécessaires, leur taille et leur état ; réutiliser le
  cache Hugging Face quand possible. Autoriser un dossier de poids déjà téléchargés.
  Prévoir reprise après interruption et vérification de l'intégrité avant usage.
- [x] Publier les exports d'inférence distillés, configurations, inventaire et
  licences dans [dunkean/neural-earth-distilled](https://huggingface.co/dunkean/neural-earth-distilled),
  tag `v0.1.0`, commit `b1782a3f80f5001de5ac701c1ff37128f128b9d7` (MIT).
  Les huit poids ont été téléchargés anonymement et vérifiés par SHA-256.
- [x] Préparer une première model card avec les origines, licences et limites.
- [ ] Compléter la model card avec les exemples de chargement et le matériel
  réellement essayé.
- [ ] Distinguer les modèles continus Infinite Generation du modèle résiduel à
  fenêtre finie : ce dernier ne remplace pas la base originale dans le pipeline
  continu. Ne proposer au téléchargement comme utilisables que les combinaisons
  prises en charge par le moteur sélectionné.
- [x] Reporter le dépôt et le commit de la première sélection dans le catalogue.
  Aucun jeton d'écriture dans l'application distribuée.
- [ ] Tester une génération réelle avec les poids téléchargés avant d'annoncer le
  profil GPU disponible.

Le [guide des modèles](models-release/README.md) décrit la vérification et les
commandes de téléchargement et de publication explicites. Le panneau propose le
dépôt publié et son commit immuable, qui restent modifiables. Le profil navigateur
possède déjà son téléchargement/cache ; le relier aux exports publics appropriés
au moment de la release, sans supprimer les poids suivis dans Git prématurément.

## Illustration des vues 3D

Réutiliser le service `illustration/` et la capture couleur/profondeur/contours de
la V2. L'objectif initial est une image synthétisée à partir d'une vue 3D ; une
géométrie générée ou des vues parfaitement cohérentes demanderaient un autre travail.

- [ ] Brancher l'action d'illustration dans la V2 et démarrer le service Python
  configuré à la demande. Vérifier la génération, le retour d'erreur et l'export.
- [x] Fournir la procédure Python manuelle et préparer l'installation assistée ;
  la validation sur machine propre reste à faire.
- [ ] ComfyUI reste une alternative pour un utilisateur qui le possède déjà.
  Son connecteur et un workflow exemple seraient à ajouter si ce chemin est retenu ;
  ne pas installer ni maintenir automatiquement ComfyUI et ses extensions.
  ComfyUI ne remplace pas directement le runtime de relief.

## Minimum à terminer pour publier

- [x] Préparer les ressources du paquet neuronal : catalogues, configurations et
  scripts Python ; les sources Neural Earth externes sont récupérées à la demande
  ou configurées par chemin. Vérifier le fonctionnement du paquet installé.
- [ ] Vérifier le lancement de l'application installée, le moteur Rust réellement
  utilisé, la fermeture des services et une erreur compréhensible si un module manque.
- [x] Préparer une automatisation simple sur tag.
- [ ] Produire et vérifier les paquets d'une version candidate depuis un checkout
  propre sur chaque OS cible.
- [ ] Essayer sur machine sans outils de développement : installation, génération,
  sauvegarde/réouverture, module IA absent et cache de modèles vide. Puis tester un
  profil IA disponible et son réemploi hors ligne après téléchargement complet.
- [ ] Publier paquets, sommes SHA-256, prérequis et limites connues. Une installation
  manuelle documentée de l'IA est acceptable pour cette première release ; son
  installeur assisté ne doit pas bloquer la livraison de la V2 avec Rust.

## Workflow des paquets

Le workflow [Desktop V2 release](../.github/workflows/desktop-v2-release.yml)
construit sur Windows 2022 et Ubuntu 22.04 x64. Linux utilise glibc 2.35 comme
base de construction ; la compatibilité dépend aussi des bibliothèques de la
distribution. Un lancement manuel conserve les artifacts CI sans publier. Un
tag `desktop-v<version>` correspondant à la version Tauri déclenche, après les
deux constructions, une prérelease GitHub avec installateurs, sommes SHA-256 et
métadonnées. Ces paquets sont non signés et sans mise à jour automatique ; Windows
peut afficher un avertissement. Le téléchargement des versions suivantes est manuel.
Le workflow est préparé : aucune publication ni validation sur machine propre
ne découle de sa seule présence. Sur la machine Windows de développement, le
binaire a été lancé avec un profil isolé : le service Rust a produit 4 096 hauteurs
finies et s'est arrêté à la fermeture. Ce contrôle ne valide ni une installation
sur machine propre ni une génération neuronale complète. Sous WSL2 Ubuntu 22.04,
le `.deb` extrait de la dernière construction et l'AppImage extrait d'une
construction précédente ont ouvert l'interface complète sous WSLg ;
le service Rust a calculé 4 096 hauteurs finies et s'est arrêté à la fermeture
normale de la fenêtre. Ce n'est pas un test d'installation globale ni sur une
machine Linux propre. Les deux paquets ont été construits et leurs SHA-256 générés.

Lors de cet essai WSL, le téléchargement interne Tauri d'AppRun a expiré. Les
outils ont été récupérés séparément aux URL officielles indiquées par Tauri
2.11.4, placés dans son cache puis la construction AppImage a réussi. Ce
contournement ne prouve pas que le téléchargement CI fonctionnera partout.
Les paquets courants utilisent l'icône `app-icon-v2.png` ; la dernière version
de l'AppImage a été construite et vérifiée par somme, sans nouveau test graphique.

Le module WASM de conditionnement seul a été compilé sur Windows sans télécharger
les poids navigateur. Son export `conditioning_json` a produit 20 480 valeurs
finies pour une grille de taille 64. Ce contrôle ne valide pas une génération
neuronale complète ni une construction CI sur machine propre.
