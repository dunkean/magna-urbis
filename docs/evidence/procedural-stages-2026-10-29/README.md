# Validation du pipeline procédural unifié — 29 octobre 2026

Une seule entrée Procédural dans V2, Terrainbench et Rustbench. Un ordonnanceur
GPU partagé ; Classique et Compact sont deux préréglages. Phasor est une étape
indépendante. L’ancien module compact ne contient que les exports compatibles.
Les deux états précédents restent archivés dans `.local-archive/`.

## Résultats

- 45 tests ciblés réussis, vérification TypeScript et builds Terrainbench,
  Rustbench et V2 réussis.
- Pas à pas contre calcul groupé : mêmes altitudes, écart maximal nul sur les
  deux préréglages testés ; aperçus intermédiaires finis.
- Comparaison à l’archive avant fusion : écart nul sur Classique et Compact
  (5 km, montagnes, climat tempéré, recette avec profils de biome activés).
- Comparaison classique sans recette à l’archive avant inspecteur : écart nul.
- Variantes : opérations désactivées, bicubique/B-spline, Phasor sur Classique,
  détail ridgé et érosion de surface sur Compact.
- Le climat change effectivement le champ érodé ; le vent change le relief
  CPU et GPU, conserve la somme des épaisseurs à l’arrondi flottant et répond
  à sa direction. Phasor fonctionne aussi sur la génération CPU classique.
- Les chaînes hydrologiques Rust (256² CPU) et vectorielle (512²) produisent
  un réseau et des hauteurs finies après le traitement a posteriori testé.
- Interface : 18 étapes, pauses/reprise, pluie aride personnalisée, édition
  invalidant la session, exécution jusqu’à Phasor, arrêt sur le vent actif,
  conservation de la heightmap, restauration des contrôles, iframe Rustbench.
- V2 : une source procédurale, préréglage compact, qualité et intensité,
  Phasor activable sur Classique, aide intégrée, ancien lien Phasor accepté.

## Durées indicatives

Mesure unique, Chrome/WebGPU D3D11, après initialisation ; GPU puissants sur
cette machine. Ces durées ne prédisent pas celles d’un navigateur quelconque
ou de la génération d’une région complète avec ville et végétation. Le calcul
direct porte sur un champ 1024² de 5 km, montagnes, graine `stages-parity`.
Les aperçus ajoutent des soumissions et lectures GPU, sans compter l’attente
humaine. La génération ordinaire reste groupée.

| Préréglage / ancien nom | Groupé | Inspecté | Écart maximal |
| --- | --- | --- | --- |
| procedural | 1114.0 ms | 1215.3 ms | 0 m |
| procedural-phasor | 46.9 ms | 141.8 ms | 0 m |

Les traitements fluvial/éolien supplémentaires coûtent du temps lorsqu’ils sont
activés. Le conditionnement fluvial réutilise le CPU à 512² maximum ; le vent
est un stencil d’érosion/dépôt, sans simulation atmosphérique ou glaciaire.
Le pas à pas porte sur les reliefs régionaux GPU ; le solveur CPU reste groupé.
Les noyaux numériques historiques d’érosion/bruit n’ont pas été réécrits.

## Reproduction et fichiers

Depuis `web/` : `node scripts/check_procedural_stages.mjs`,
`node scripts/check_procedural_inspector_ui.mjs` et
`node scripts/check_compact_terrain_ui.mjs` (benches construits auparavant).
Les rapports JSON ci-joints distinguent les contrôles GPU, UI, fusion et
baseline historique. Les comparaisons aux archives ont été faites avec des
copies temporaires des anciens ordonnanceurs, supprimées après contrôle.
Les captures brutes sont dans `web/out/procedural-stages/` ; la figure compacte
est dans `docs/methods/images/procedural-generation-stages.webp`.
Le détail des 18 étapes et des coefficients climatiques figure dans
`docs/methods/procedural-generation-stages.md`.
