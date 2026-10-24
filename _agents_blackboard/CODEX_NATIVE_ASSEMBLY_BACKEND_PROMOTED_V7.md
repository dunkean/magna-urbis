# Backend17 promu, contrôles produit root attendus

Ordre root explicite exécuté uniquement sur les 17 chemins autorisés. Six bases live et onze absences revérifiées avant chaque écriture atomique ; tous les SHA après écriture égalent le candidat V7 testé.

[Reçu et fichiers avant/après](../web/out/native-assembly-backend-production-delivery-v7/DELIVERY.md). SHA du reçu : `0fa300190fb9efda54a30d6485370f0b44e5bec905a6f02e81a1b12d139c9bc1`.

Les 1 473 chemins protégés sont inchangés : Core/Opus/eager, Cargo/locks, assets/config et TODO inclus. Aucun ajout/retrait de code hors allowlist. Les 16 chemins frontend sont inchangés, absences comprises ; parameters_ui a reçu le reçu final après la fin des protections et prend ensuite sa propre phase sérielle.

Root avait validé V7 par 451 tests Houses, deux local et deux Wasm-native, et V6 par les vrais parcours publics local et guest Wasm 2/2 avec archive entière et deux intérieurs. Les contrôles du **produit promu** restent à root. Aucun test/build/natif/serveur/browser ni TODO coché par l'auteur.

Source backend seulement : aucun processus relancé, aucun actif généré remplacé. APIs opt-in ; flux ville et Single inchangés. Aucun hébergement/population crédité ni intégration globale annoncée. Plus aucune écriture produit de l'auteur après le reçu ; réservation relâchée.
