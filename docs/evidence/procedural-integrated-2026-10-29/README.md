# Pipeline procédural intégré — 29 octobre 2026

Le panneau de 18 étapes fait partie de Terrainbench/Rustbench. Il utilise le même
TerrainWorker et la même recette que Générer tout, avec application automatique
du résultat final et affichage des aperçus dans la carte principale. Le worker
séparé et le canvas privé ont été supprimés.

Le CPU Rust/WASM et Rust natif conservent une TerrainPipeline entre les étapes ;
le GPU conserve ses buffers. Le mode hybride calcule ses bruits sur GPU puis
utilise les phases Rust. La génération normale garde son exécution sans copies
d’aperçus. Les réglages CPU régionaux utilisent la nouvelle API, également
employée en pas à pas ; le cache est versionné v3. Les appels historiques sans
recette gardent leur chemin monolithique.

Vérifications : 50 tests ciblés, TypeScript, paquet WASM release et builds des
benches/V2 réussis. Les quatre parcours CPU, GPU, hybride et natif ont été
exercés dans le navigateur : pause, étape suivante, édition, rejeu jusqu’à
Phasor, reprise, application sur la carte, paramètres conservés et Générer tout.
Le mode reste généré, sans conversion automatique en heightmap.

La comparaison groupé/pas à pas donne un écart nul pour les deux préréglages GPU
et pour le champ CPU testé. Le parcours CPU fonctionne aussi sans API WebGPU.
Les chaînes hydrologiques Rust et vectorielle restent testées après le relief.
Le service natif a passé les huit phases de construction, avec sorties finies.

Reproduction depuis web/ :
- node scripts/check_procedural_stages.mjs
- node scripts/check_procedural_inspector_ui.mjs
- node --import tsx scripts/check_native_terrain_pipeline.ts

MAGNA_NATIVE_STAGE_URL permet d’inclure le backend natif dans le test UI ; il
nécessite un service récent exposant /terrain/stage. MAGNA_BENCH_ORIGIN permet de
tester directement le serveur lancé plutôt qu’un serveur temporaire.
Les captures sont dans web/out/procedural-stages/integrated-*.png ; la figure de
la note de méthode montre la nouvelle interface. Les versions avant correction
restent dans .local-archive/procedural-before-integrated-pipeline-20261029/.
