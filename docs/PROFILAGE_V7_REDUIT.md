# Profilage réduit de la planche V7

Le lanceur Windows `web/scripts/v7_profile.py` lit un manifeste de campagne figé. Appelé avec le seul chemin du manifeste, il vérifie les empreintes du moteur, de ses symboles, de la page V2 et des trois décors, puis affiche l’affinité CPU et la disponibilité de la collecte matérielle avancée. Cette vérification ouvre uniquement des fichiers. L’option `--run` lance la campagne dans un nouveau dossier de sortie.

Le lancement démarre un service Rust de session sur un port temporaire, un Chrome sans profil persistant, puis une seule page V2. Les trois lignes passent dans l’ordre 500, 2 500 et 10 000 habitants, avec un appel V2 de génération par ligne et deux vues par ville. Seule la première ligne bénéficie d’un démarrage à froid du service et du navigateur. Les décors de la planche fournissent le terrain et l’hydrographie. La première génération mesurée commence à leur lecture dans V2. L’affinité retient un processeur logique par cœur physique sur douze cœurs de la plage 9–23, avec douze workers Rayon. Le parcours vérifie l’adaptateur WebGL RTX 4090 avant la première ville et surveille l’affinité des processus. Un écart arrête la campagne avec les résultats déjà recueillis.

| Fichier | Contenu |
| --- | --- |
| `run.json` | Manifeste, graines, styles, saisons, provenance, empreintes, affinité et mode de collecte |
| `browser.json` | Bornes des phases, appels réseau, statuts et tailles, marques de l’interface, journal V2 et diagnostic GPU |
| `timings.json` | Temps mural par phase et requête, temps CPU et cycles accumulés dans les échantillons observés |
| `cpu.ndjson` | Compteurs Windows cumulés par PID avec heure de prélèvement, identité du processus et affinité |
| `engine.ndjson` | Lignes et sondes Rust `URBAN_PROFILE`, avec leur heure de réception et la ville en cours |
| `chrome-trace.json` | Trace Chromium avec échantillons V8, tâches, marqueurs User Timing et événements du rendu |
| `*.png` | Une vue à plat et une vue inclinée par ville |
| `<ville>-<produit>.json` | Géométrie, cadastre, programme et bâtiments de la V2, avec les empreintes associées dans `browser.json` |
| `cycles.etl` | Trace noyau optionnelle avec échantillons de cycles PMU et piles échantillonnées en temps CPU via `--pmu`, depuis un terminal élevé |

Les fenêtres CPU et réseau peuvent se chevaucher. Les cycles de `timings.json` correspondent à la différence entre le premier et le dernier relevé dans la fenêtre, par processus. `observedPids` mesure la couverture et `maxEdgeGapMs` indique les bords exclus. Les fenêtres trop courtes se lisent via les sondes murales. Les sondes Rust cumulent parfois depuis le début d’un appel et parfois depuis la sonde précédente. Pour interpréter une série imbriquée, suivre les lignes originales dans l’ordre. Les compteurs de processus sont disponibles sans élévation. L’attribution native fine par pile s’appuie sur les symboles PDB et la trace optionnelle.

`python web/scripts/v7_profile_report.py <sortie>` écrit le rapport Markdown et le CSV des temps. Avec `--reference <sortie-de-référence>`, il compare aussi les produits de génération, les pixels décodés des captures et les temps de la même série de cas.

Pour vérifier uniquement les deux villages après un écart de capture, partir d’un manifeste gelé, garder ses deux premiers cas et ajouter `"stableCaptures": true`. Cette vérification attend trois captures consécutives identiques et conserve leurs empreintes dans `browser.json`. Garder les temps du passage complet pour la comparaison de performance.

Le manifeste peut activer `"captureNativeRequests": true`. Le dossier `native-http/` conserve alors les corps des POST du service local et leurs empreintes, dans leur ordre de soumission. Cette copie intervient après la fenêtre chronométrée.
