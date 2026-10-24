# Opus 5.5 review

Model: claude-opus-5-5; requested effort: high; read-only tools.

# Revue indépendante V10 : blocage de navigation

## Verdict technique

La campagne V10 reste en **échec**. Les artefacts mettent en cause deux mécanismes indépendants. Ni l'un ni l'autre ne vient de la compilation, de l'upload, du décodage ou de la validation.

1. **Les deux gels de Godot (10,53 s et 8,82 s) se produisent à l'intérieur d'un `print()` synchrone sur le thread principal.** Pendant exactement ces fenêtres, le driver Node, qui lit le pipe stdout de Godot, n'a traité aucun événement. Les délais « worker→upload » de 11,059 s et 9,777 s sont donc des **retards d'observation du driver**. L'upload réel avait déjà fini.
2. **Godot n'a qu'un seul emplacement de préparation, sans préemption.** Des re-préparations du parent, déclenchées par la seule caméra, occupent cet emplacement : 7,9 s, reproductible en V9 (7 948,651 ms). Une preview acceptée doit attendre, et un parent obsolète est quand même appliqué après l'acceptance d'un monde plus récent.

Vos nombres sont tous retrouvés dans les artefacts, sauf deux valeurs V9 (13,928 s et 0,618 s) que je n'ai pas vérifiées. En revanche, l'interprétation « l'upload prend 11 s » est **contredite** par les données.

---

## 1. Séquence prouvée

### Faits, sur l'horloge native seule (stdout.log, metrics.json, navigation-report.json)

| tick natif | événement | source |
|---|---|---|
| 105262 | début du mouvement | `motionStartTickMs` |
| 106498 | gen4 appliquée ; gen5 démarre : parent, largeur 31200 m, `displaySamples` 128 | `preparationSnapshots`, `main.gd:708` |
| 109773 | dernier échantillon d'entrée avant le trou (4,511 s) | `inputSamples` |
| **109795** | `live-http-completed` #37 (9 347 316 o, `requestElapsedMs` 1685) | `main.gd:834` |
| ≈120322 | début implicite du décodage #37, soit 121222 − `decodeElapsedMs` 900 | `main.gd:855` |
| 120322 | reprise des entrées (15,06 s) ; trame max 10 549,7 ms | `navigationFrameWallMs.max` |
| 121131 | gen5 appliquée (`prepareMs` 7925,9, parent, `liveSerial` 0) ; gen6 démarre, encore sur le parent | `main.gd:413`, `:708` |
| 121222 | #37 décodée **et acceptée dans la même ms** | `main.gd:696`, `:942` |
| 122729 / ≈122735 | HTTP #90 terminé (1115 ms) ; décodage démarré (650 ms) | |
| 123353 | dernier échantillon d'entrée (18,091 s) | |
| **123385** | `live-packet-decoded` #90 (tick calculé avant le `print`) | `main.gd:696` |
| **132206** | acceptance de #90, soit +8821 ms | `main.gd:942` |
| 132277 | sortie réelle de la boucle de mouvement (27,015 s) | sonde |
| 132815 | gen6 (**parent**) appliquée après l'acceptance de #90 | |
| 134791 / 134792 | #129 décodée, puis acceptée 1 ms plus tard | |
| 136864 | preview 90 enfin rendue (gen7, 3448,6 ms) | |
| 140552 | final #129 rendu (gen8, 3190 ms) | |

**Localisation du gel n°1.** Entre `main.gd:834`, où `tickMs` vaut 109795, et `main.gd:855`, où `decodeStartedTickMs` vaut environ 120322, il ne s'exécute que :
- `print(JSON.stringify(http_event))` (`:837`) ;
- `_source_scene_lineage()` sur une petite structure (`:840`, `:1256-1258`) ;
- une copie de petit dictionnaire (`:854`).

**Localisation du gel n°2.** Le chemin `:696`→`:942` a pris 0 ms pour #37 et 1 ms pour #129, contre 8821 ms pour #90. Dans les deux cas, le `print` est le seul appel susceptible de bloquer. Cette localisation ne repose que sur l'horloge Godot.

### Faits, côté driver (report.json)

| requête | broker-terrain | compilé | ACK enregistrés | durée totale vue par Godot |
|---|---|---|---|---|
| #37 | 227271 | 228540 | 228766, **239483**, **239599** | 1685 ms |
| #90 | 240789 | 241627 | **251382**, **251404** | 1115 ms |
| #129 | 251693 | 252809 | 253134, 253160 | 1356 ms |

Le broker n'écrit la réponse à Godot qu'**après** le dernier bloc, et n'envoie l'ACK final au navigateur qu'ensuite (`surface_live_plugin.ts:92-107`). Pour #37, toute la chaîne (SSE, NN, compilation, 3 blocs, téléchargement Godot) a donc tenu en 1,685 s, alors que le driver l'a vue durer 12,3 s. Cet argument ne dépend d'aucune comparaison d'horloges.

Le driver horodate les ACK quand Node traite l'événement Playwright `response` (`generate_surface_source.mjs:395-399`). Le report ne contient **aucun** événement entre 228766 et 239483, ni entre 241627 et 251382.

### Liaison des horloges (par événements, pas par hypothèse)

L'offset se calcule sur la même requête : début de la requête Godot (tick − `requestElapsedMs`) contre l'observation `broker-terrain` par le driver.
- Valeurs obtenues : 119161 (#37), 119175 (#90), 119163 (#129), soit un écart de 14 ms entre elles.
- Reprise de Godot n°1 : 120322 natif ≈ 239483–239497 driver. L'ACK enregistré tombe à 239483.
- Reprise de Godot n°2 : 132206 natif ≈ 251367–251381 driver. Les ACK enregistrés tombent à 251382.

**Le driver et Godot redeviennent actifs au même instant, à environ 15 ms près, deux fois de suite.**

### Ce qui reste hypothétique

- **Mécanisme le plus probable : contre-pression du pipe stdout.** Godot écrit dans un pipe drainé par `viewerProcess.stdout.on('data')` (`generate_surface_source.mjs:208-210`). Si la boucle d'événements Node ne lit plus, `print` bloque. Ce mécanisme explique les deux observations, mais la durée de chaque `print` n'est pas instrumentée. Les règles exactes de remplissage du pipe sous Windows (quota du buffer) ne sont pas mesurées.
- **Cause du blocage du driver lui-même : inconnue.** Candidats, à départager par la mesure :
  - H1 : `console.log` du driver (`:420`) bloque sur son propre stdout. Sous Windows, les écritures de `process.stdout` vers un pipe sont synchrones ; il suffit que le processus parent draine mal.
  - H2 : pause du garbage collector V8 (tas gonflé par l'upload de 140 Mo).
  - H3 : traitement CDP/Playwright de très gros messages réseau.
  - H4 : ordonnancement de l'OS.
- Une pause de toute la machine est peu compatible avec une localisation du gel deux fois exactement dans un `print`.

### « Préparation du parent alors qu'une preview est acceptée » : confirmé

- gen6, une re-préparation caméra du parent, démarre à 121131, **91 ms avant** l'acceptance de #37.
- `_accept_packet` → `_begin_prepare` (`main.gd:956`) ne fait rien parce que `worker != null` (`:266`).
- #37 n'est jamais préparée : #90 l'a remplacée avant que l'emplacement se libère.
- Dans la trame 132206, #90 est acceptée (`:697`) **avant** que gen6 soit récupérée (`:698-702`). gen6 passe ensuite le bake d'eau et l'application à 132815. `_apply_prepared` ne rejette que les préparations plus anciennes que ce qui est **affiché** (`:301`), pas que ce qui est **accepté**.
- gen5 (parent, 31200 m, image de hauteur 2048→1024) occupe l'emplacement environ 106,5k→114,6k : 7,9 s. C'est identique en V9 (7948,651 ms), donc ce n'est pas un artefact du gel.

**Estimation, non mesurée :** sans les gels, #37 aurait été acceptée vers 110,7k, aurait attendu la fin de gen5 vers 114,6k plus le bake, et aurait été affichée vers 118–119k, soit avant 125262. C'est passable, mais fragile.

---

## 2. Appels du thread principal capables de bloquer

**Entrées : blocage confirmé.**
- `print` à `main.gd:837` et `:696`.
- Même exposition pour :
  - `main.gd:413` : `terrain-replaced` avec le snapshot complet et les chaînes de provenance de plusieurs Ko, répétées ;
  - `main.gd:1339` (`view-satisfied`) et `main.gd:944` ;
  - `push_warning`/`push_error` sur le pipe stderr (`:846`, `:971`…).

**Entrées : coûts bornés, non bloquants ici.**
- `_accept_packet` (`unpack_world`, `LiveBinding.rejection`, `_resolve_*`) : ≤1 ms mesuré sur #37 et #129. Ceci **contredit** l'hypothèse d'une validation synchrone dans Godot.
- `_apply_prepared` (`import_images`, textures, MultiMesh) : `uploadAndObjectsMs` entre 26 et 127 ms.
- `Thread.wait_to_finish` n'est appelé que quand le thread est terminé (`:692`, `:698`) : pas d'attente.
- Bake d'eau : SubViewport 2048² en MSAA 2×, 3 trames plus `frame_post_draw`, puis **readbacks synchrones** `get_image()` (`surface_water_projection.gd:92-95`, `surface_water_symbols.gd:55-57`). On observe environ 0,5–0,8 s entre la reprise et l'application, réparties sur plusieurs trames. Ce n'est pas instrumenté. Comme `water_projection_busy` bloque `_begin_prepare` (`main.gd:263`, `:707`), le bake retarde la préparation suivante.

**ACK : aucun code Godot ni du driver n'est sur leur chemin réel.** Le chemin est navigateur ↔ Vite (`surfaceLiveUpload.ts:13-26`). Le driver ne fait qu'**observer** les ACK. Côté page, seul le script d'init (`generate_surface_source.mjs:376-381`, `summarizeBinary` : `JSON.parse` du manifeste et copie des hauteurs du parent) passe avant le listener de l'application. C'est un risque plausible pour les gros paquets, mais il n'est pas en cause en V10 : la chaîne réelle a tenu en moins de 1,7 s.

---

## 3. Mesures minimales, puis correctif borné

### Reproduction courte instrumentée

Uniquement la phase navigation-first : pas de tournée, pas de sonde de couches. Même runtime figé, même export et même session réelle, durée nominale de 20 s inchangée.

- **Godot :**
  - mesurer avant/après chaque `print` (µs, octets, nom de l'événement) et stocker le maximum par type dans les metrics, pas dans stdout ;
  - mesurer chaque section de `_process` pour toute trame de plus de 100 ms ;
  - chronométrer chaque étape de `ScenePrepare.prepare` (Data, Detail, Population, roads, buffers, hydrologie, urbain), car `surface_scene_prepare.gd:26`/`:91` ne donne qu'un total ;
  - chronométrer le bake d'eau (trames attendues, ms de chaque `get_image`) ;
  - ajouter `Time.get_unix_time_from_system()` à côté des ticks pour lier les horloges.
- **Driver :**
  - `monitorEventLoopDelay` et un heartbeat toutes les 50 ms écrits par `fs.writeSync` dans un fichier séparé ;
  - un `PerformanceObserver` sur le GC ;
  - l'horodatage et la taille de chaque bloc `data` reçu de Godot ;
  - la durée des `console.log`.
- **Navigateur :** horodater dans la page la réception de `compiled` et l'envoi et l'ACK de chaque bloc, avec émission après coup.
- **Broker :** horodater la réception de chaque bloc et la fin d'écriture de la réponse à Godot.
- **A/B sur une seule variable :** (A) comme V10 ; (B) stdout et stderr de Godot redirigés vers des **descripteurs de fichier** (`fs.openSync`), sans passer par la boucle Node. Le mécanisme est confirmé si A montre plus de 8 s passées dans `print` et que B supprime ces trames.

### Correctif A : couplage stdout (à faire d'abord)

- **A1, harnais.** C'est un environnement de mesure, le critère ne change pas. Lancer Godot avec `stdio:['ignore',fd,fd]` en navigation et pour la sonde de couches : ces deux phases relisent déjà les fichiers après coup (`:210`, `:278`). La tournée peut parser le fichier à la sortie.
- **A2, produit.** Sur le chemin interactif, n'émettre que des événements compacts (ids, serials, ticks, `prepareMs`). Le snapshot complet existe déjà dans `render_events`/metrics. Garder intacts les événements `capture`, émis hors mouvement. Une console Windows en Quick Edit bloque aussi `print` en usage réel.

### Correctif B : préemption bornée de l'emplacement de préparation

- Un jeton d'annulation coopératif, testé entre les étapes de `ScenePrepare`. L'annulation n'est autorisée **que** pour une re-préparation caméra du monde déjà affiché (`worldRevision == rendered_revision`) quand une révision plus récente vient d'être acceptée.
- Même règle dans `_complete_prepared` avant le bake d'eau.
- Enchaîner immédiatement `_begin_prepare` sur le monde le plus récent.

**Invariants à préserver :**
- ne jamais annuler la préparation d'un monde accepté et pas encore affiché, ce qui évite un livelock face à un flot de previews ;
- le snapshot affiché reste intact en cas d'annulation ;
- le monde le plus récent est préparé **avec ses hauteurs** ;
- les contrôles de lignée restent inchangés ;
- l'inventaire et les densités ne bougent pas ;
- les compteurs `cancelledSuperseded` et `skippedCameraRefresh` ne s'incrémentent qu'à un point de contrôle effectivement atteint ;
- `render_events` n'est alimenté que par `_apply_prepared`.

Ensuite seulement, mesurer pourquoi gen5 prend 7,9 s, à partir des temps par étape. Je ne propose pas d'optimisation à l'aveugle.

### Correctif C : honnêteté de la preuve (sans allonger le test)

- `navigation_probe.gd:105` calcule `duration − dernier échantillon`, ce qui **masque le second trou de 8,924 s** (18,091→27,015). Ajouter `actualMotionEndTickMs` et un trou mesuré sur le temps réel, en gardant `motionEndTickMs` nominal, que vérifie `generate_surface_source.mjs:219`.
- `liveAppliedSerial` et `motionLiveApplicationCount` (`navigation_probe.gd:35`, `:79`) comptent les **acceptances** (`main.gd:939`). Exemple : `motionEnd.liveAppliedSerial` vaut 90 alors que `rendered.liveSerial` vaut 0. Il faut les renommer « accepted ».
- `cpuScriptMs` exclut les 30 trames qui suivent chaque application (`main.gd:711`, `:753`), donc précisément les trames coûteuses.
- Le délai « worker→upload » doit être calculé avec les horodatages du navigateur ou du broker, pas avec ceux de Playwright.

---

## 4. Classement

**Défauts confirmés**
- Gels de 10,53 s et 8,82 s localisés dans `main.gd:835-854` et sur le chemin `:696→:942`, autour d'un `print` synchrone.
- « Upload 11,059 s / 9,777 s » : c'est un artefact d'observation du driver, contredit par `requestElapsedMs` (1685 et 1115 ms) et par l'ordre des écritures du broker.
- Emplacement de préparation unique sans préemption : parent gen6 appliqué après l'acceptance de #90, #37 jamais préparée, re-préparation caméra du parent de 7,9 s reproductible (V9 et V10).
- Le second trou de 8,924 s est masqué par la sonde.
- Des compteurs d'« application » comptent en réalité des acceptances.

**Risques plausibles**
- Readbacks synchrones du bake d'eau, et `water_projection_busy` qui retarde la préparation suivante.
- `_physical_lineage` → `city_identity(packet)` → `hash(packet.urban)` sur le thread principal à chaque appel : `_cityIdentity` est posé sur `world`, pas sur `packet` (`main.gd:1269`, `surface_geometry.gd:32-34`). Coût non mesuré ; le p99 de 51 ms le borne.
- `summarizeBinary` du harnais placé sur le chemin critique de la page.

**Hypothèses non mesurées**
- La cause interne du blocage de la boucle Node (H1–H4).
- La mécanique exacte du quota du pipe.
- La répartition des 7,9 s de gen5 entre les étapes.
- L'estimation d'un affichage de #37 vers 118–119k sans les gels.
