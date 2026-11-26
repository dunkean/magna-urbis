# Qualification web du 15 novembre 2026

Snapshot applicatif : `fe8e8ee8` (corrections dans `8e9a77cc`).
Machine : Windows, Microsoft Edge, RTX 5090. WebGPU identifie `blackwell` ;
le rendu WebGL identifie également la RTX 5090. Ces résultats ne certifient
pas les autres navigateurs ou matériels.

## Défauts reproduits sur la publication précédente

Sur `5217ceec`, le parcours neuronal → ouvrir la 3D → génération complète
échoue avec `Cannot read properties of undefined (reading 'toDataURL')`.
Le fond GPU pouvait être demandé pendant sa préparation ; le rendu 3D reste
désormais en attente d'une image disponible.

Le changement du toit du bâtiment civique `main/spring/0/building` était
refusé avec une demande de mise à jour du moteur. Les sorties anticipées des
sites civiques et des constructions informelles ignoraient les modifications
de toiture et d'étages. Elles appliquent maintenant la même hiérarchie locale
que les autres sites, en conservant l'emprise. Le cache urbain change de version.

Une demande neuronale en mode CPU téléchargeait les modèles avant de refuser
ce mode. Le contrôle intervient maintenant avant consentement, réseau ou stockage.

## Provenance des noms

Région et Peuplements exposent les réglages communs avant génération : profil
des noms propres, source réelle/inventée et langue de la carte. L'inspecteur
de chaque peuplement expose son remplacement local du profil et de la source.
Ces réglages utilisent la politique du même éditeur de noms avancé et sont
enregistrés dans la recette. L'architecture conserve sa propre culture.

Le parcours réel choisit un profil anglais et une carte anglaise, puis remplace
le profil du peuplement principal par un profil français. Le profil régional
reste anglais ; relief et bâtiments restent identiques. Les tests de syntaxe
vérifient aussi `Grahams Gate` / `Porte de Grahams`.

## Validation du candidat

- TypeScript et 91 tests sélectionnés : succès dans le checkout isolé du snapshot.
- Test Rust ciblé du site civique : succès ; suite `urban::` : 683 succès,
  25 tests déjà ignorés, aucun échec.
- Première génération neuronale réelle avec un profil navigateur vierge : succès.
- Parcours complet [`v2_live_check.mjs`](../../../web/scripts/v2_live_check.mjs) : succès.
  La région par défaut mesure 6 km et demande 2 500 habitants pour le lieu principal.
  La génération complète depuis la 3D affiche 860 bâtiments dans ce scénario.
- Toit civique `hip` → `flat`, sélection rouge, emprise et relief inchangés : succès.
- Export et réouverture du projet avec hauteurs et bâtiments identiques : succès.
- Vue 3D, styles satellite/parchemin, changement anglais/français : succès.
- Annulation d'une inférence GPU commencée puis relance : succès.
- Nouvelle inférence avec les adresses `/neural/**` bloquées : succès via les
  modèles/runtime déjà vérifiés en cache. Cela ne certifie pas toute l'application hors connexion.

Les scénarios utilisent les contrôles ordinaires, les exports et les imports.
`?test=1` désactive la restauration automatique ; aucun hook ne remplace le moteur.
L'erreur d'aliasing Rust initialement signalée n'a pas été reproduite dans ces parcours.

## Contrôle après publication

Publication `gh-pages` : `fd50b706a27aed103e3de9e5c47066a5672f9ba2`.
Le [déploiement GitHub Pages 43735403018](https://github.com/dunkean/magna-urbis/actions/runs/43735403018)
est terminé avec succès. `https://magna-urbis.org/version.json` identifie bien
`fe8e8ee880bc2d32fc9ffe7cfd8bc8bcba04950d`.

Le parcours complet sur le domaine public, avec un nouveau profil Edge vierge,
est **PASS**, le 15 novembre 2026 à 16:28 UTC :

- Les six morceaux coarse/base/decoder répondent HTTP 200. Le chargeur vérifie
  les 162 265 105 octets des modèles et le runtime avant l'inférence.
- Première génération neuronale : 44,8 s, téléchargement initial compris.
- Génération complète depuis la 3D : 21,0 s ; 860 bâtiments affichés.
- Profil global anglais puis profil français du seul peuplement principal :
  succès, région anglaise et géométrie conservées.
- Toit du site civique `hip` → `flat` : 3,1 s ; bâtiment présent,
  sélection rouge, emprise et relief identiques.
- Sauvegarde et réouverture : hauteurs et bâtiments exactement identiques.
- Annulation GPU puis relance : succès, 7,3 s pour la relance.
- Nouvelle génération avec les URL neuronales bloquées : succès, 3,3 s.
- Aucune exception de page ni erreur d'aliasing Rust dans ce parcours.

Les deux erreurs réseau de console correspondent aux sondes des services locaux
Rust/Python, traités comme indisponibles dans le profil web ; elles n'interrompent
pas la génération.

Les captures, les exports de projet et `report.json` sont conservés localement
dans `.tmp/web-live-public-published/`. La commande reproductible est
`npm run test:v2:live` depuis `web/` ; voir le [guide de publication](../../WEB_PUBLICATION_FR.md).
