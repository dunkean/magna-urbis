# Programme → maisons : contrat minimal

22 octobre 2026. Accord proposé sur le container **`programme` existant**, conforme à OPUS_CITY. Les trois étapes ci-dessous distinguent contrat, sélection résidentielle et futurs programmes civiques ; elles ne confondent pas capacités présentes et intention.

## JSON et sens des champs

`PlacementRequest.programme` est optionnel ; chaque champ est optionnel. Absence/null conserve le comportement antérieur. Les métadonnées existantes restent admises : `role`, `label`, `landmark`, `district_role`, `wealth`, `households`, `state`. `preview` / `preview_parts` restent à leur emplacement actuel sur la requête, **pas déplacés** dans le programme et jamais imposés au plan.

```ts
programme?: {
  role?: string; label?: string; landmark?: boolean;
  district_role?: string; wealth?: number; households?: number; state?: string;
  composition?: 'row' | 'detached' | 'courtyard' | 'farm' | 'compound'
              | 'hall' | 'religious' | 'civic' | 'defence' | 'inn';
  floors?: [number, number];
  built_area_m2?: number;
  frontage_continuity?: number;
  party_walls?: boolean;
}
```

- `composition` : **souhait**, ni contrainte cadastrale ni preuve de capacité historique. Le moteur le traduit en familles réellement supportées par le pack, la période et l’opérateur. `farm` signifie plusieurs corps cohérents autour d’un espace libre ; ce mot ne certifie pas une grange ou une exploitation fonctionnelle.
- `floors` : intervalle inclusif d’entiers positifs, min ≤ max, préféré pour le corps principal/habité ; les tours et annexes conservent leurs plages propres. Un intervalle incompatible n’élimine pas tout le pack : repli documenté sur une source valide.
- `built_area_m2` : nombre fini > 0, cible d’**emprise projetée des corps** (union native `footprint`), sans cours ouvertes, chemins ni débords de toiture. Ni surface utile cumulée sur les niveaux, ni surface foncière réservée. Le catalogue `services.json.area` est documenté en **m² utiles** (`roles.rs:177`, `Demand.unit=usefulAreaM2`) : aucune copie directe vers ce champ. Le core doit établir une conversion explicite selon le programme/niveaux, ou omettre la cible.
- `frontage_continuity` : nombre fini dans [0,1], souhait de continuité sur le frontage accessible ; `party_walls` : préférence d’attachement. Aucun des deux ne crée de droits hors `party_boundaries`, `buildable`, `roof_domain`, accès ou réserves. Ils ne sont appliqués que par un opérateur qui les contrôle réellement.
- Type JSON invalide (composition inconnue, floors non entiers, mauvais booléen) : erreur de désérialisation du batch, comme les autres champs typés. Valeur typée hors domaine (intervalle inversé, aire négative) : refus par ID. Champs supplémentaires : tolérés pour compatibilité des métadonnées. Composition connue mais non prise en charge : repli explicite, sans fabrication d’un programme.

## Priorités et compatibilité

1. Géométrie autoritative du site, voisinage, terrain, source/époque/mode : toujours contraignants.
2. Modèle `house_config`, recette/variante, typologie et overrides explicitement choisis : gardent leurs règles actuelles et priment sur `programme`. Les conflits entre contrôles explicites restent des conflits, jamais arbitrés par le programme. Une édition ciblée fournit les sites et réglages effectifs avant appel ; le moteur n’invente pas une nouvelle hiérarchie quartier/parcelle/maison.
3. Souhaits `programme` : ordonnent les candidats compatibles ; aucune substitution d’un modèle explicitement choisi. Les floors automatiques du core **quittent `config.overrides.floors` lorsque `programme.floors` est émis**. Les floors saisis par l’utilisateur restent durs. Le moteur ne peut pas deviner leur origine à partir du nombre.
4. Defaults actuels et témoin d’admission : repli conservé. Sans nouveau souhait exploitable, même graine → même résultat qu’avant.

Le mode strict conserve les familles, dimensions et assemblages déclarés ; une composition « civic » ne rend pas une maison historiquement civique. Le mode inspired peut utiliser les adaptations natives explicitement supportées, avec diagnostic. Le pin non domestique reste en place tant que le moteur ne sait pas sélectionner et construire le programme demandé. Une superposition de `preview` doit être étiquetée **« volume urbain indicatif »** ; elle ne remplace pas le plan natif dans l’inspection ou les exports.

## Trois étapes vérifiables

**A — transmettre sans modifier le legacy.** Maisons : type Rust/TS optionnel, validation des souhaits et conservation des métadonnées. Core/Opus : émission du programme après A3, retrait du seul floor automatique, conversion utile → emprise explicite si disponible. Vérification : absence/programme uniquement descriptif donne les mêmes plans ; un override floors=3 reste dur malgré un souhait [1,2].

**B — sélectionner la forme avant la génération.** Maisons : filtrage canonique source/config inchangé, puis classement déterministe par composition et proximité des niveaux ; un maximum de quatre couples recette/variante distincts, sans quatre générations systématiques. Priorité aux familles admissibles cour/assemblage pour une demande correspondante ; essai suivant seulement après échec natif. Si aucune famille demandée n’existe, repli source valide et diagnostic. Les hints restent des témoins. Surface/frontage restent informatifs tant qu’un opérateur ne garantit pas leur application ; publier souhait → famille retenue → raison du repli sans dupliquer tout le programme dans chaque archive.

**C — traiter réellement les programmes civiques.** Ajouter des capacités fonctionnelles déclarées, avec graphe de corps, dimensions/budgets et provenance, puis adapter `resolve_urban_architecture` pour conserver ces composants au lieu de les simplifier. Retirer le pin seulement pour ces capacités. Vérifier une mairie sur un grand lot : taille guidée par son budget bâti, espace ouvert préservé, aucune extension arbitraire ×surface de parcelle ; tant que la capacité manque, annoncer le repli. Aucun manoir ou intérieur historique inventé dans A/B.

Quatre fragments de requêtes pour tests de contrat (valeurs synthétiques, **pas des fiches historiques**) ; les géométries autoritatives restent celles des petites fixtures :

```json
[
  {"id":"narrow-row","function":"domestic","programme":{"role":"dwelling.row","composition":"row","floors":[2,3],"frontage_continuity":1,"party_walls":true}},
  {"id":"roomy-wealthy","function":"domestic","programme":{"role":"dwelling.house","wealth":0.9,"composition":"compound","floors":[1,2],"built_area_m2":180}},
  {"id":"court","function":"domestic","programme":{"role":"dwelling.courtyard","composition":"courtyard","floors":[1,2],"built_area_m2":160}},
  {"id":"townhall","function":"collective","programme":{"role":"civic.townhall","landmark":true,"composition":"civic","floors":[1,2],"built_area_m2":600}}
]
```

Mesurer les topologies/aires réelles et la raison des replis, pas seulement les IDs de recettes. Quatre fixtures fixes suffisent avant une comparaison visuelle existante ; aucun nouveau grand benchmark requis pour A/B.

Mise en œuvre A/B maisons : `/houses/plans` utilise ces préférences ; la route détaillée historique `/houses/place` conserve sa sélection antérieure et ne les applique pas. Le plafond est plus strict que quatre couples : **quatre recettes distinctes**, une variante cohérente par recette. Un plan retenu conserve les paramètres exacts choisis pour sa réalisation détaillée ultérieure.

**Livré côté maisons** : types Rust/TS, classement après le cache de compatibilité canonique, étages préférés uniquement dans les plages déclarées du corps principal, trace des replis. Quatre tests natifs passent (dont B07 maison + tour et B06 cour), ainsi que les 10 tests d’index, les 7 tests de plans existants et `npx tsc --noEmit`. Aucun build release, serveur ou nouveau benchmark visuel lancé. Le core A3 a depuis émis le contrat ; la validation visuelle de l’ensemble reste à faire.
