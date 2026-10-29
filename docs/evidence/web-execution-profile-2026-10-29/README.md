# Bascule Web — 29 octobre 2026

Défaut reproduit : la sérialisation omettait source=procedural. Après une
bascule Local → Web, la carte était relancée avec le neuronal navigateur par
défaut. Les choix CPU/GPU étaient aussi supprimés par le changement de profil.
Les captures avant correction montrent un calcul neuronal pour les deux cas
qui avaient initialement demandé le procédural.

Correction : source toujours enregistrée, anciens liens procéduraux reconnus,
choix CPU/GPU conservés, génération native traduite en CPU navigateur pour Web.
Aucun changement du solveur de relief.

Validation sur le serveur 5175, Chrome avec ses options graphiques ordinaires
(sans enable-unsafe-webgpu ni backend forcé) : CPU→Web, GPU→Web, GPU indisponible
simulé dans la page et ses workers, natif→Web. Les quatre cartes terminent leur
génération, gardent source=procedural et ne chargent aucun modèle neuronal.
Le cas sans GPU utilise le CPU avec la raison du repli dans les mesures.
54 tests ciblés, TypeScript et reconstruction des benches réussis.

Reproduction depuis web/ : MAGNA_ASSERT_WEB_FIX=1 et
node scripts/check_web_execution_profile.mjs (variable d’environnement à définir
avec la syntaxe du shell). Les captures restent dans web/out/web-execution/.
