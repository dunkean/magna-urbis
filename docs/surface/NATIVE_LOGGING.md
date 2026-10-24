# Native JSON logging modes

`--native-log-mode synchronous` remains the native viewer default. The fresh
source driver forwards `--viewer-native-log-mode synchronous|threaded` to each
native phase and records the requested mode. No source, rendering or gate option
changes with this flag.

The optional `threaded` mode serializes each event on the main thread, after
capturing its event clocks, and enqueues the completed immutable string. A single
writer uses FIFO order and the existing stdout file descriptor. Startup, capture,
interactive events and metrics share that sink. Godot engine headers, warnings
and errors are outside this application JSON ordering contract.

The queue admits at most 16 MiB of UTF-8 bytes including newlines and 8192 pending
messages, including the message currently being written. This is a transport
budget, not a claim about total resident String memory. It never waits for I/O
while holding the queue mutex. Overflow stops admission, records a rejection and
fails the native process; already accepted messages are drained, not silently
dropped. The test-only injected sink is never configured by the runtime CLI.

Main-thread `native-log-timing-1` keeps `serializeMs` and `printMs` in synchronous
mode. `native-log-timing-2` records `serializeMs`, `enqueueMs` and `mainWallMs` in
threaded mode. Writer statistics separately record actual `printWallMs`,
queued-to-print `queueWaitMs`, pending counts/bytes, high-water marks and rejected
messages. No enqueue duration is labelled as print time. Event timing history is
bounded to 512 entries; writer event buckets are bounded to 64.

`_write_metrics` flushes only when no input is pressed and the interactive
preview interval has expired. The writer snapshot precedes serialization of the
metrics event itself and therefore excludes that later line. `_exit_tree` closes,
flushes and joins before the native process finishes. These final waits can still
wait on OS output and are not promised to have bounded latency. Metrics-file I/O
and JSON serialization also remain on the main thread.

CPU validation exercises real stdout UTF-8 over inherited file descriptors,
message order, byte and message pressure, closed-state rejection, repeated
flushes, accepted-message drain after overflow, bounded statistics and clean
join/resource release. This is not evidence of improved navigation, a cause for
the historical stalls, or a global real-time performance qualification. A/B
navigation on the same retained source/session is a separate required proof.
## Diagnostic A/B V13 : deux phases strictement échouées

Le [rapport compact](evidence/native-log-modes-v13.json) conserve le diagnostic
exécuté sur `cf760322364c5efa94ad58bebecbfa2aeb40234b`, avec **613 hashes runtime
identiques** et des snapshots propres avant/après. Les deux processus natifs
sortent à zéro et leurs critères temporels/source passent, mais les deux phases
restent **FAILED** : chacune contient le vrai `SCRIPT ERROR` dans
`SurfaceGroundResponse.expected_wire_dtype`, comparant un indice de tableau JSON
float à une String. Le correctif ultérieur `e75e54a` et son décodage CPU réussi
ne changent pas rétroactivement ces verdicts. Le statut `diagnostic-complete`
et l'exit zéro du superviseur signifient seulement que la collecte a fini.

Une seule génération fraîche fournit le même paquet de 91 626 097 octets aux
deux modes, dans le même navigateur, contexte et session. L'ordre est fixé :
synchrone, puis threaded. Les caches peuvent donc être plus chauds dans le
second passage. Les requêtes et mondes affichés diffèrent légèrement selon
le calendrier d'input ; ce n'est pas une comparaison causale à requêtes égales.
Les deux utilisent Forward+ sur RTX 5090, audio Dummy et le même manifeste PBR.
Aucun flag expérimental d'assets d'arbres ou d'herbes n'est activé.

| Mesure de ce diagnostic | Synchrone | Threaded |
| --- | ---: | ---: |
| Mouvement nominal / réel | 20 / 20,006 s | 20 / 20,015 s |
| Écart d'input maximal | 0,302 s | 0,429 s |
| Mondes live distincts affichés pendant les 20 s | 2 | 2 |
| Premier / second affichage nouveau | 11,436 / 16,583 s | 11,653 / 16,921 s |
| Maximum `printMs` du thread principal | 33,700 ms | absent, mesure déplacée |
| Maximum `enqueueMs` du thread principal | absent | 0,033 ms |
| Maximum writer `printWallMs` | absent | 45,415 ms |
| Maximum writer `queueWaitMs` | absent | 42,743 ms |

Les deux premières réponses affichées sont des previews : un support natif de
30 m avec `decoderUsed=false`, puis 0,9375 m avec `decoderUsed=true`. Le support
final natif à 0,46875 m arrive pendant le drain. Ces progrès temporels/source
ne dispensent jamais du contrôle des erreurs runtime.

Le snapshot du writer threaded indique **64 acceptés et écrits, 0 rejet,
0 pending et aucune failure**, après le flush hors input. Les 64 numéros de
séquence et noms d'événement correspondent exactement aux 64 premières lignes
JSON applicatives. La ligne `metrics` suivante est sa propre émission exclue
du snapshot : **64 + 1 = 65 lignes applicatives**. Le `navigation-proof` du
script diagnostic, hors FIFO du viewer, porte le total à 66. Le mode synchrone
produit aussi 65 + 1 lignes. Les champs `closed:false` et `joined:false` du
snapshot sont pré-exit ; ils ne sont pas réétiquetés en preuve de join terminé.
La vérification ultérieure des noms exacts et PIDs propres ne trouve aucun
survivant ; elle n'arrête ni ne détaille les processus tiers.

`navigationFrameWallMs` provient de `all_frame_times`, qui couvre l'échauffement,
le mouvement et le drain après `_ready`, pas seulement les 20 secondes d'input.
Ses maxima de 3 630,672 / 741,844 ms ne sont donc pas une mesure de gels pendant
le mouvement ni une preuve de 60 FPS. Réduire le span d'enqueue ne prouve pas
que l'I/O physique est plus rapide. L'ordre fixe, les caches partagés, les
requêtes différentes et le défaut runtime empêchent toute conclusion causale,
qualification artistique ou validation d'une campagne fraîche complète.
