# Panneau Ville : une règle, un tableau, des maisons mélangées

Date : 2026-10-25. Remplace l'organisation de `81b3a41` (« Génération de la ville » + « Options avancées »).

## Intention

L'utilisateur doit **comprendre et agir sur sa ville** sans se demander qui l'emporte sur qui. Aujourd'hui la culture se règle à cinq endroits, certains réglages globaux écrasent les choix par phase (recette, préréglage, zone) et d'autres non (maillage, opérateur), les maisons suivent la culture de la phase sans mélange ni logique, et les villages ignorent les phases sans le dire.

## Règle unique (moteur et interface)

**Le plus précis gagne : culture du lieu → Ville → Phase → Quartier → Lot.** Une valeur non choisie hérite du niveau au-dessus ; l'interface montre toujours la valeur effective et d'où elle vient.

Conséquences moteur (petites, avec serde par défaut pour garder les anciens liens) :

1. Une phase surchargée (`phaseOverrides[zone]` avec culture ou recette) **ignore** les globaux `recipe`, `preset` (≠ `culture`) et `zone` (≠ `auto`) de `LayoutConfig` **et** de `ParcelConfig` pour ses phases. Les phases non surchargées gardent le comportement actuel. (Aujourd'hui `composition::phase_morph` prend `cfg.recipe` dès qu'il n'est pas `auto`, et `resolve` prend `cfg.preset` dès qu'il n'est pas `culture` : c'est l'inversion à corriger, dans `quarters.rs` et `parcels.rs`.)
2. Le maillage et l'opérateur suivent déjà la règle (quartier > phase > global > recette) : ne pas les changer.

## Maisons : mélange de styles

Nouveau réglage des bâtiments (dans les réglages de la scène bâtie, transmis jusqu'au moteur là où passe aujourd'hui `architectureCulture` / `architecture_culture` dans `building_sites.rs`) :

```
houses: {
  city?:     HouseMix,                 // ligne « Toute la ville »
  zones?:    { [zone]: HouseMix },     // core, middle, edge, faubourg, village
  quarters?: { [quarterIndex]: HouseMix } // inspecteur de quartier
}
HouseMix = { styles: [{ culture: string, weight: number }], spread: 'lot' | 'block' | 'quarter' }
```

- Résolution par lot : quartier → zone de l'îlot → ville → culture actuelle du lot (`allocation.culture`, donc la culture de la phase). Un mix vide ou absent = hériter.
- Tirage **déterministe** pondéré : graine de la scène + clé selon `spread` (id du lot, id de l'îlot, ou index du quartier). `block`/`quarter` donnent des groupes cohérents (une communauté par îlot ou par quartier) ; `lot` mélange maison par maison.
- La culture tirée remplace `building_culture` dans `building_sites.rs` (même chemin que la surcharge actuelle, donc `parcel_mapping`, admissibilité, pack d'architecture et volumes de `massing.rs` suivent sans autre changement). Si le pack tiré refuse le lot, retomber sur la culture du lot (pas de refus ajouté par le mélange).
- L'ancien « Profil culturel des bâtiments · surcharge » devient `houses.city` avec un seul style à 100 % (migration à la lecture des anciens liens).
- Un test Rust : même graine → même tirage ; poids 0/100 ; `block` donne une seule culture par îlot ; ancien réglage lu comme `city`.

## Interface (CityBench et Settlements, même composant)

Un seul panneau **« Ville »**, de haut en bas, toujours compact :

1. **Barre d'action** (collante en haut du panneau) : portée `All · tous les settlements | <ville>` (masquée dans CityBench) · `⟳ Auto` (une seule bascule, qui couvre aussi l'auto-refresh settlements & routes) · bouton **Générer** · trois pastilles d'étape **Plan · Parcelles · Maisons** : état (à jour / à refaire / en cours / erreur) ; un clic sur une pastille relance cette étape et les suivantes.
2. **Ville** : Culture (défaut « Culture du lieu (x) ») · Type de ville (`Auto → <type résolu>` ou forcé) · Influence d'une autre culture (culture, part, par phases/secteurs ; replié tant qu'il est vide). Pour un village ou plus petit : une ligne « Forme simplifiée : les phases ne s'appliquent pas, seule la ligne Toute la ville compte ».
3. **Squelette** (une ligne repliable, résumé visible : « Enceinte selon culture · 3 routes · axes régionaux ») : enceinte/fortification, style d'enceinte, axes, sorties, rocade, faubourgs. C'est ce qui vient de la culture et des routes, distinct du maillage des quartiers.
4. **Tableau des phases** — lignes : **Toute la ville**, Cœur, Extension, Périphérie, Faubourgs (Village pour les petits types) ; colonnes : **Plan** (culture/recette), **Rues** (maillage), **Lots** (découpe), **Maisons** (mélange).
   - Cellule héritée : texte gris « ↳ organique » (source au survol : « de Toute la ville » / « de la culture »). Cellule choisie : texte normal + `↺`.
   - La ligne Toute la ville porte les anciens globaux : `tissue`, `operator`, surcharge des bâtiments → `houses.city`.
   - Cellule Maisons : résumé « Européen 70 % · Hanséatique 30 % · par îlot » ; un clic ouvre un petit éditeur en place (liste de styles avec poids, ajouter/retirer, répartition lot/îlot/quartier).
   - Phases absentes de la ville affichée : grisées, non masquées.
   - Le style des maisons n'est donc plus en avancé ; le mode d'affichage des bâtiments (Volumes / compact / détaillé) est un sélecteur à côté de la pastille Maisons.
5. **Quartier sélectionné** (apparaît quand on clique un quartier sur la carte, utilise l'inspecteur existant) : mêmes quatre colonnes pour ce quartier (`overrides.quarters` existant pour culture/maillage ; `houses.quarters` pour les maisons) avec ↺.
6. **Détails** (un bouton) : tout le reste, regroupé par étape, sans rien supprimer. Les globaux recette / préréglage / zone / paramètres JSON y restent, libellés « pour les phases non choisies dans le tableau ».

Le panneau d'affichage (vues Tissu/Usages/Parcelles/Bâtiments/Rôles, calques) reste séparé : ce n'est pas un paramètre de génération.

## Non-objectifs

- Pas de nouvelle typologie de maison (rangée/cour/indépendante) dans le mélange : seulement des styles (cultures). La typologie existante reste dans Détails.
- Pas de refonte des étapes Terrain/Settlements/Routes hors de la bascule Auto partagée.
- Pas de changement de géométrie pour les liens qui n'utilisent aucun nouveau champ.

## Laissé au constructeur

Disposition fine, CSS, libellés exacts dans l'esprit ci-dessus ; découpage en modules (`urbanMainPanel.ts` peut être réécrit) ; tout ce qui sert la règle unique sans l'élargir.
