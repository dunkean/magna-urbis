# Des régions nommées, habitées et historiques

5 novembre 2026 — Proposition de design, non implémentée. Périmètre : Magna Urbis, Chronos, Lineage Lab et Namebench.

## 1. Architecture : faire de Chronos la mémoire sociale du monde

**Je recommande une refonte ciblée du noyau de Chronos : un graphe temporel de groupes sociaux et d’événements, dont la généalogie est une composante.** L’étude v3 décrit déjà cette direction ; le prototype reste une boucle annuelle sur des sites, avec des institutions plates. Il importe déjà Namebench et Lineage Lab, mais sa démographie évolue séparément de celle des personnes importées. Ajouter des connecteurs ne résoudrait pas cette incohérence.

| Brique | Responsabilité proposée | À reprendre ou compléter |
|---|---|---|
| Magna Urbis | Lieux, géométrie, routes, architecture et exploration | Clés de sites et nommage existants ; ajouter la couche sociale datée |
| Chronos | Groupes, affiliations, pouvoirs, événements, causalité et noms dans le temps | Conserver hasard adressé, provenance, rejeu et validateurs ; remplacer le modèle social plat |
| Lineage Lab | Naissances, décès, unions, parentés, résidences et effectifs | Commencer en `full` ; adapter ensuite l’hybride et le pilotage temporel |
| Namebench | Corpus onomastiques et générateurs de candidats | Exporter des paquets figés, typés et versionnés |

**Le graphe possède quatre objets simples :**

- `Place` : région, établissement, quartier ou bâtiment ; ancrage spatial indépendant des habitants.
- `SocialEntity` : personne, ménage, maison, guilde, communauté, pouvoir politique ; identité persistante et attributs typés.
- `Relation` datée : appartient à, réside à, gouverne, possède, s’allie à, descend de. Une personne peut appartenir simultanément à plusieurs groupes.
- `Event` : intervalle, acteurs, portée, préconditions, effets et causes ; `NameUsage` conserve les noms, langues et périodes d’usage d’une identité.

Les groupes portent activités, ressources, objectifs et règles de décision ; leurs créations, scissions et dissolutions sont des événements. Les fonctions et mandats sont datés, y compris lorsque l’autorité est collective.

Les vues monde → région → communauté → ménage → personne sont des projections de ce graphe. **Territoire, communauté et autorité restent distincts** : une guilde traverse plusieurs villes ; une région accueille plusieurs communautés. La composition n’est donc pas un arbre unique. Les causes forment un graphe sans cycles ; décomposer une guerre en campagnes n’est pas établir sa causalité.

Le temps est lui aussi multiéchelle : siècle → période → année, puis détail ponctuel. Chronos référence les identités géographiques existantes, notamment celles de Neural Earth lorsqu’elles sont disponibles ; il ne construit pas un second découpage spatial concurrent.

## 2. Génération : une seule démographie, des noms et un passé cohérents

**Entrées :** carte, graine, période, populations initiales, profils culturels et événements d’auteur éventuels. Pour la première version, les effectifs Magna Urbis deviennent explicitement ceux de l’année initiale ; le présent affiché résulte de l’évolution. Reconstituer un passé qui aboutit exactement à un présent imposé sera un chantier distinct.

**1 — Ancrer les identités.** Attribuer un `RegionId` persistant et des `PlaceId` fondés sur les clés de sites, jamais leur position dans une liste. Une modification de terrain ou de placement invalide les dépendances concernées ; un renommage conserve l’identité. Les changements d’auteur créent une nouvelle révision du monde.

**2 — Installer les communautés.** Créer populations résidentes, ménages, quelques groupes et autorités. Un `CultureProfile` relie explicitement traditions de noms, pratiques sociales et recettes architecturales. Il autorise plusieurs communautés et langues par site : la culture urbaine de Magna Urbis ne détermine pas automatiquement l’identité de tous ses habitants.

**3 — Nommer à partir de Namebench.** Son API actuelle n’offre pas de rejeu déterministe ; exporter des corpus normalisés, triés et empreintés, puis sélectionner par clé stable `(monde, entité, usage)`. Le profil précise ordre des éléments, patronymes éventuels, transmission, écriture et translittération. Ne pas imposer « prénom + nom héréditaire » à toutes les cultures. Distinguer noms de personnes, établissements, régions et éléments naturels : un réservoir de villes ne suffit pas à nommer un fleuve. Ajouter les règles manquantes, avec replis déclarés. Conserver exonymes et anciens noms ; un homonyme n’est pas un doublon d’identité. Les noms d’auteur sont prioritaires.

**4 — Faire évoluer histoire et habitants.** Chronos choisit les événements sociaux et leurs conditions ; Lineage Lab applique les processus démographiques et retourne les faits effectivement réalisés. Une épidémie paramètre un risque ; son bilan publié provient des décès observés. Une perte exacte imposée exigerait un mécanisme de quota supplémentaire. Chronos ne rajoute aucune croissance ni mortalité parallèle.

Pour le premier livrable, utiliser le contrat batch existant de Lineage Lab : scénario de crises fixé, simulation, puis attribution des rôles et événements compatibles avec les vies obtenues. Les successions utilisent les décès réels. La coévolution complète demandera une nouvelle interface publique par pas temporel : état → décisions Chronos → transition Lineage Lab → effets validés. Elle n’existe pas aujourd’hui ; éviter deux simulations qui tentent de se corriger après coup.

**5 — Détailler sans réécrire.** À terme, les faits globaux réservent leurs bilans avant les zooms. Un événement entre deux régions appartient à leur portée commune ; sa migration est comptée une fois, avec sortie et entrée correspondantes. Le détail local respecte ces réservations et peut ajouter des faits sans effet macro. Toute nouvelle conséquence macro exige une nouvelle révision.

L’hybride de Lineage Lab apporte déjà noyau simulé et cohortes à familles projetées ; ce n’est pas encore un moteur de raffinement historique sous contraintes. Il faut préserver ses limites : deux générations ascendantes et cinq descendantes pour l’arrière-plan, migrations individuelles omises dans ces cohortes. Un résident projeté ne devient pas rétroactivement un personnage causal. Les acteurs historiques sont réservés dans le noyau ; les autres restent des projections explicitement signalées.

## 3. Expérience utilisateur et réalisation progressive

Dans Magna Urbis, ajouter une action **« Peupler et écrire l’histoire »**, avec date initiale, durée, profils culturels et intensité des crises. La carte affiche les noms et effectifs à la date choisie. Sélectionner une région ouvre sa population, ses communautés, ses pouvoirs et sa frise ; sélectionner un lieu mène aux groupes et habitants ; sélectionner une personne montre parenté, résidences et événements communs.

**Exemple fictif :** une crise entraîne le départ de familles d’un bourg vers une ville voisine ; leur communauté fonde ensuite une confrérie. À la date actuelle, son nom, ses membres et sa présence locale renvoient aux mêmes événements. Une maison ne reçoit des occupants précis qu’au zoom urbain, sous contrainte de capacité. Les traces bâties et la transformation historique des plans viendront après la première couche cartographique.

Les résumés sont d’abord produits par gabarits à partir des faits. Des récits partiaux peuvent ensuite les interpréter ; ils ne modifient pas le canon.

**Trois livrables, chacun utilisable :**

1. **Noms et habitants.** Une région, quelques milliers d’habitants en `full`, corpus Namebench, identités stables, ménages, résidences et sauvegarde. Brancher le nommage existant de Magna Urbis ; conserver les corrections manuelles.
2. **Histoire sociale.** Graphe Chronos, environ un siècle sur des sites fixes, affiliations datées, successions, crises et causalité ; effectifs issus exclusivement de Lineage Lab. Commencer avec quelques types de groupes, sans dépendre d’un catalogue institutionnel complet.
3. **Changement d’échelle.** Pilotage temporel couplé, hybride réconcilié, réservations des effets, voisinages régionaux et détail à la demande ; ensuite fondations, ruines et phases urbaines.

Garder les projets indépendants et leurs échanges versionnés. Un orchestrateur local appelle les outils Python et le cœur Rust, puis produit une archive contenant manifeste, empreintes, graphe et données démographiques. Le navigateur explore l’archive sans Python ; régénérer exige le moteur local. Le graphe logique peut être stocké en tables et index : aucune base de graphes spécialisée n’est nécessaire au départ.

**Critères d’acceptation :** mêmes entrées et versions → même canon ; mêmes personnes après export/import ; résidents tous vivants à la date affichée ; effectif total égal aux personnes simulées, puis au noyau + cohortes sans double compte ; effets démographiques enregistrés égaux aux transitions ; noms stables et corrections conservées ; zooms A→B et B→A identiques lorsque le raffinement sera introduit. Les performances restent à mesurer sur les scénarios retenus.

**Sources locales examinées :** [Chronos implémenté](../../chronos/docs/methods/chronology.md), [vision sociale](../../chronos/docs/reviews/vision-entites-sociales.md), [étude v3](../../chronos/conception_generateur_histoire_multiechelle_v3.md), [contrat hybride](../../lineage-lab/docs/genealogy-hybrid.md), [Namebench](../../namebench/README.md), [nommage Magna Urbis](../web/src/v2/mapNaming.ts).
