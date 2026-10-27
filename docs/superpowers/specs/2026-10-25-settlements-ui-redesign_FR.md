# Settlements & City Bench : carte à gauche, ville à droite

Date : 2026-10-25. Remplace la disposition de `2026-10-25-city-panel-design.md` (la règle « le plus précis gagne » et le mélange de maisons restent).

## Intention

L'utilisateur change sa ville **en direct, sans ouvrir 15 menus**. Ce qui change le visuel est à **1 clic** ; le reste est dans un **⚙ Avancé**. Interface **compacte** : pas de titres qui prennent de la place, des **icônes** quand c'est évident, des lignes denses. On distingue nettement **la carte** (vaut pour tous les settlements) et **la ville** (vaut pour le settlement sélectionné).

## Disposition (Settlements et City Bench, même code)

```
[ barre carte : affichage, vues, calques ]
[ Carte (gauche ~230px) | carte | Inspecteur Ville (droite ~340px) ]
```

### Panneau Carte (gauche) : réglages de toute la carte

Groupes compacts (une icône + une ligne, pas de titre de section ; un ⚙ à droite ouvre le détail en place) :

- ⛰ **Terrain** : terrain chargé (City Bench : le catalogue + charger).
- 🏘 **Settlements** : nombres par classe en pastilles numériques (ville / bourg / village / hameau / ferme), culture par défaut. ⚙ : mode, distribution, population, espacement, poids géographiques, types de site.
- 🛣 **Routes** : sorties (0–16), réseau (level), densité. ⚙ : surfaces, culture des routes, routage, rendu.
- 🌾 **Occupation des sols** : case « auto » **décochée par défaut** (pas de génération automatique) ; tout le reste derrière ⚙.
- **Liste** des settlements en pastilles (icône de classe, nom, population) ; clic = sélection (même effet qu'un clic sur la carte) ; ＋ placer.
- City Bench : seulement Terrain et Routes (une ville au centre, éditée dans l'inspecteur).

### Inspecteur Ville (droite) : le settlement sélectionné

1. **En-tête** : icône de classe, nom, population (éditable), type de ville (Auto → résolu, ou forcé) ; pastilles d'étape **Plan · Lots · Maisons** (état, clic = relancer cette étape et les suivantes) ; **⟳ Auto** ; **▶ Générer**. Lien « Appliquer à tous les settlements » (remplace le sélecteur de portée « All »).
2. **Ligne générale** : 🎨 culture (défaut « du lieu »), 🧱 enceinte ; « + influence » (autre culture, part, répartition) replié tant qu'il est vide.
3. **Grille des phases** : lignes = aspects 🎨 Plan · ╬ Rues · ▦ Îlots · ▤ Lots · ⌂ Maisons ; colonnes = Toute · ◉ Cœur · ◎ Ext. · ○ Pér. · ⋯ Faub. (Village pour les petits types, phases absentes grisées).
   - Cellule héritée : gris italique « ↳ » (source au survol). Cellule choisie : orange, ↺ au survol.
   - Clic sur une cellule = petite liste de choix en place (popover), un clic pour choisir.
   - Maisons : ouvre l'éditeur de mélange existant.
   - Îlots : forme des quartiers/îlots (recette / recipe de la phase si elle existe ; sinon colonne retirée, au choix du constructeur selon ce que le moteur expose déjà).
4. **Quartier sélectionné** (clic sur un quartier) : une ligne « Quartier n » ajoutée sous la grille, mêmes colonnes.
5. **⚙ Avancé** : un tiroir unique, rangé par étape, avec tout le reste : composition et emprise (cachées par défaut), squelette détaillé (axes, sorties, rocade, faubourgs), pentes et escaliers, recettes, préréglages, paramètres JSON, graines, programme, détail bâtiments.

L'affichage (vues Tissu/Usages/Parcelles/Bâtiments/Rôles, couches) reste dans la barre au-dessus de la carte : ce n'est pas de la génération.

## Routes régionales : plus de 4 sorties

- Les sorties ne sont plus « une par bord » : N sorties (0–16) réparties par **secteurs d'angle** autour de la ville principale, chacune visant le point du bord dans son secteur (le moins coûteux / le plus proche), avec un espacement minimal sur le bord.
- Deux sorties proches peuvent **se rejoindre** : le partage de tronc existant (sharing / réutilisation A*) les fusionne naturellement.
- **Gabarits différents** : la classe vient du trafic comme aujourd'hui ; les sorties ont un poids décroissant (la première = grande route, les suivantes secondaires), pour que toutes n'aient pas la même taille.
- Les anciens liens (exits ≤ 4) restent valides ; la géométrie peut changer.

## Non-objectifs

- Pas de changement de la génération urbaine (plan, parcelles, maisons).
- Pas de suppression de réglages : tout ce qui n'est pas en 1 clic reste accessible dans un ⚙.
