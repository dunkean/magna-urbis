# Procédural Phasor compact — validation du 29 octobre 2026

Une troisième source `procedural-phasor` est disponible dans Magna Urbis V2,
Terrainbench et Rustbench → Terrain. Elle réutilise les noyaux existants avec
une simulation régionale réduite et un détail Phasor fusionné dans la sortie.
La [note de méthode](../../methods/compact-terrain-phasor.md) décrit les
équations, les unités, les paramètres et les limites.

## Préservation

L’état de départ est conservé localement dans
`.local-archive/procedural-phasor-baseline-20261029-021649/` :

- `sources.zip` : copie des sources concernées, y compris les fichiers V2 non
  suivis par Git ;
- `manifest.json` : commit de départ et empreintes SHA-256 ;
- `working-tree.patch` : modifications suivies présentes avant ce travail.

Pour examiner une ancienne version, extraire le ZIP dans un autre répertoire.
Une restauration doit être sélective : des travaux indépendants sont présents
dans cet espace de travail. Les fichiers `terrainErosion.ts`,
`terrainErosion.wgsl`, `terrainNoise.wgsl` et `terrainFinite.wgsl` sont identiques
octet pour octet à leur sauvegarde. Le procédural original conserve ses choix
CPU et GPU, et les sources neuronales restent disponibles.

## Mesures

Exécution réelle dans Chrome headless 156 sous Windows, WebGPU sur adaptateur
NVIDIA Lovelace, sans adaptateur logiciel. Ce sont des mesures locales, pas une
garantie sur GPU intégré ou mobile. Le chronomètre commence après l’import des
modules ; le premier appel inclut l’initialisation WASM et les pipelines, mais
pas le lancement du navigateur, le téléchargement des modules ou un nettoyage
du cache disque du pilote. Le rendu de l’interface est exclu.

Profil équilibré, montagnes, érosion 1, échelle de relief 3 km, source 1024²,
aperçu 512², nouvelle génération à chaque cas. La graine est identique entre
climats pour une largeur donnée.

| Carte | Premier cas du processus, tempéré | Autres climats, moteur chargé | Buffers propres au générateur |
| --- | --- | --- | --- |
| 5 × 5 km | 1,854 s | 0,086–0,090 s | 27,31 Mo |
| 10 × 10 km | 0,093 s, moteur déjà chargé | 0,091–0,095 s | 32,13 Mo |

Le premier 10 km de cette série utilise les pipelines déjà chargés au 5 km.
Un [essai supplémentaire dans un nouveau processus navigateur](10km-first-call.json)
commence directement à 10 km : 0,728 s au total, dont 0,190 s de préparation.
Le cache disque du pilote reste conservé ; ce n’est pas un démarrage après
nettoyage de tous les caches. Les
temps varient entre exécutions ; une première exécution précédente du 5 km
avait pris 3,64 s. Les chiffres détaillés de la dernière exécution sont dans
[benchmark.json](benchmark.json), avec les étapes GPU et les paramètres.

Les cas supplémentaires en qualité rapide ont réussi : plaine 2,27 s, vallée
2,65 s, canyon 0,134 s et île 0,113 s. Les changements de famille peuvent
compiler d’autres pipelines. L’île utilise réellement l’érosion côtière GPU et
contient des altitudes négatives. La référence CPU, collines à 5 km, prend
5,09 s ; la cible de rapidité concerne le GPU.

## Eau et détail

Hydrologie Rust CPU à 512², `condMode=none`, sur des terrains fraîchement
générés après chargement du moteur :

| Carte | Relief + hydrologie + échantillonnage | Hydrologie seule | Rivières / lacs | Correction RMS / maximale |
| --- | --- | --- | --- | --- |
| 5 km | 0,447 s | 0,294 s | 14 / 5 | 0,36 m / 11,46 m |
| 10 km | 0,891 s | 0,556 s | 59 / 24 | 0,51 m / 19,23 m |

Les sorties sont finies. Le traitement des dépressions et l’ajustement du
modèle hydrologique restent actifs même avec `condMode=none`. Ces corrections
montrent qu’on ne peut pas déclarer le terrain naturellement drainé ni retirer
le traitement hydrologique. Les nombres de cours d’eau et de lacs sont des
contrôles de fonctionnement, pas une validation géomorphologique.

Sur la même érosion régionale à 5 km, le passage d’intensité Phasor 0 à 1
modifie les altitudes de 1,166 m RMS, avec un maximum de 3,038 m. Deux
générations GPU identiques donnent exactement la même sortie sur cet
adaptateur. L’écart maximal aux 64 points de référence scalaire CPU est
0,000130 m. La comparaison visuelle est intégrée à la note de méthode.

## Contrôles d’intégration

- TypeScript : compilation sans erreur.
- Vitest : 35 tests ciblés réussis dans six fichiers, couvrant politique de
  résolution, paramètres, continuité, conservation des surfaces constantes,
  sérialisation, cache, démarrage et compatibilité V2.
- Builds V2, Terrainbench et Rustbench réussis.
- Navigateur : sélection de la méthode et de ses paramètres dans les trois
  interfaces, ouverture de la note, retour au procédural CPU et génération
  effective via le pont V2 ; générations achevées dans les deux benches.
- Pour les benches, le contrôle d’interface utilise le rendu SVG. Le démarrage
  WebGL headless n’avait pas terminé en 60 secondes sur cette machine ; il
  reste hors de cette validation. Les calculs WebGPU et leurs shaders sont
  exécutés réellement par le benchmark et les générations d’intégration.

Un [contrôle après nettoyage de la gestion mémoire](memory-check.json) reproduit
exactement les mêmes métriques de détail et de déterminisme. La file de
sérialisation ne retient plus la heightmap résolue et aucun rappel par
génération n’est conservé jusqu’à la perte du périphérique.

Les profils climatiques sont des variations globales de morphologie. Les zones
peintes et les formes finies restent réservées aux méthodes existantes. La
sortie fixe de 1024² limite les petits détails sur les grandes cartes ; 50 km
n’a pas fait l’objet d’une mesure de performance dans cette validation.

## Reproduire

Depuis `web/`, sous PowerShell :

```powershell
$env:MAGNA_BROWSER_CHANNEL='chrome'
node scripts/benchmark_compact_terrain.mjs --water --extra
node scripts/benchmark_compact_terrain.mjs --quick --width 10000 --out out/compact-terrain-10km-first
npx vite build --mode terrainbench
npx vite build --mode rustbench
node scripts/check_compact_terrain_ui.mjs
```

Les fichiers bruts et captures complètes restent dans `web/out/compact-terrain/`
et `web/out/compact-terrain-ui/`. Les empreintes des sources utilisées sont
dans [source-hashes.json](source-hashes.json) ; le rapport d’interface est dans
[ui-check.json](ui-check.json).
