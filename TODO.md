# TODO

## Bâtiments isolés et campagne

- [ ] **Compléter l’identité culturelle des bâtiments isolés.** Les fermes et sites d’activité portent déjà une culture ; les sites d’activité utilisent le générateur de maisons en architecture compacte ou détaillée. Vérifier et compléter la couverture des modèles propres à chaque culture, la variété et l’identification des bâtiments. Le choix d’un pack de secours dans `web/src/v2/activitySites.ts` reste notamment à examiner.
- [ ] **Compléter les sentiers de campagne.** Vérifier la continuité des accès aux bâtiments isolés et compléter le maillage rural là où il manque.

## Génération et architecture

- [ ] **Contrôler le rapport population / logements.** Expliquer et vérifier le nombre de bâtiments, de ménages et d’habitants accueillis, en distinguant maisons individuelles et logements collectifs. Les améliorations récentes des petits peuplements ne suffisent pas à clore le signalement général.
- [ ] **Enrichir les formes et monuments culturels.** Compléter les maisons en L, T et U et les toitures segmentées à plusieurs niveaux, notamment à la campagne ; ajouter des monuments culturels, notamment de type Great Zimbabwe pour les cultures arides.
- [ ] **Repenser le relief d’Outreterre.** Étudier un relief inversé délimitant les cavités, les routes, les villes, les champignonnières et les fleuves ; faire suivre le relief aux tunnels et représenter le volume en transparence en 3D. Le moteur V2 ramène encore `underdark-caverns` à `underdark`. C'est autant un relief qu'un biome, il faut trouver une solution de génération intéressante pour produire le réseau de cavité de l'outreterre.
- [ ] **Extend the assembly grammar beyond the context-free Single pair.** `#assemblies` — The first contract keeps refusals and covers neither all Javanese compounds nor complex manors. On 22 fixed historical contexts, 1 B15 gained 82.16 m² with two real detailed members — not a cumulative or representative city gain. Qualify the other refusals (access front, old reading, context, dimensions); share native context/circulation and member functions with no needle clipping, context removal or invented household credit. **Progress 28/10: fixed-22 replay gives 6 assemblies and 28 members with no refusal, but no gain yet. Member-function grammar still open.**
- [ ] **Room geometry in detailed plans.** `#houses` — Independent A3 audit on 01-l (`_agents_blackboard/CODEX_A3_INDEPENDENT_AUDIT.md`): invalid previews 166 → 0, closed central courtyards 119 → 3, but 25 sharp rooms, 11 thin rooms and 96 unbalanced close-front pairs remain.
Reference: [CITY_VARIATION_VARIABLES.md](docs/CITY_VARIATION_VARIABLES.md).
- [ ] **Modern cities.** Ajouter un petit nombre de cultures "modernes" avec des architectures, des plans et du fonctionnement (batiments remarquables) de cités modernes/futuristes/cyberpunk

## Rendu, performances et interface

- [x] **Ajouter les unités impériales.** V2 : préférence indépendante de la langue pour mètres/kilomètres, pieds/miles ou yards/miles ; conversion des réglages physiques, coordonnées d’étiquettes, distances, surfaces et échelles des exports. Les recettes et géométries restent en mètres. Vérifié par les tests de localisation et `npm run test:v2:localization`.
- [ ] **Alléger les textes de l’interface V2.** Retirer les explications d’accueil et les textes redondants pour privilégier une interface concise.
