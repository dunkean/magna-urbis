# Corrections après la revue V12

24 octobre 2026. La [revue Opus V12](reviews/phase06-followup-v12.md)
accepte la campagne technique sur `bc6579f`, mais refuse la qualité artistique
et la mise en production. Les changements suivants ne sont pas validés par cette
campagne et nécessitent leurs propres preuves. Les résultats V12 restent figés.

## Distinguer les délais du producteur

`surface_page_timing.mjs` version 2 ajoute les jalons sur l'horloge de la page :
réception SSE de la requête native, début/headers/fin du vrai téléchargement
Infinite Generation, puis les jalons Worker et upload existants. Les coordonnées
numériques et identifiants bornés permettent de joindre les étapes sans conserver
les hauteurs ou les gros corps de registration dans les diagnostics.

Le wrapper ne lit aucun corps avant son consommateur et renvoie son buffer
original. Il conserve les événements, arguments, réponses, erreurs et ownership
des transferts. Les flux sans instrumentation gardent leur chemin ordinaire.
Les cinq tests de l'instrumentation et les contrôles de logs/rétention passent.

Cette instrumentation vise le délai encore non attribué de la preview V12 ;
elle ne démontre pas sa cause et n'accélère pas à elle seule la génération.
`processorTiming.synchronousMs` et les jalons restent des durées murales, pas des
mesures de temps CPU.

Le [diagnostic de trois parcours](evidence/navigation-repeat-v13.json) sur
`d195068` garde une source fraîche et une session commune. Chaque fenêtre
nominale de 20 s affiche deux nouveaux mondes : le parent natif 30 m après
11,720 / 11,727 / 12,290 s, puis un raffinement neuronal de
0,9375 / 1,875 / 0,9375 m après 17,111 / 16,899 / 17,334 s. Les trois
vérifications temporelles/source passent. **Les trois phases strictes restent
échouées** : deux erreurs WASAPI d'initialisation audio sont présentes à chaque
démarrage. Le collecteur sort à zéro pour avoir collecté ses trois résultats ;
ce n'est pas une qualification globale réussie.

Les nouveaux jalons mesurent réception SSE → upload accepté en 914–1 039 ms
pour les premiers mondes et 429–452 ms pour les raffinements affichés. Ce sont
les durées de ces parcours, pas une explication rétrospective des 8,28 s HTTP
de V12. L'ordre et les caches sont partagés, la charge de l'hôte diffère, et des
gels de frame de 1,12–3,20 s persistent. Aucun gain causal ou 60 FPS n'est déduit.

Le lanceur cartographique utilise désormais explicitement `--audio-driver Dummy` :
aucune scène audio n'existe ici, donc le rendu ne doit pas dépendre d'un
périphérique Windows, notamment en session distante. Les erreurs des anciennes
mesures sont conservées ; cette configuration nécessite sa propre exécution.
Le driver transmet aussi le manifeste de végétation par
`--viewer-vegetation-assets` à chaque phase, avec hash initial/final séparé.

## Intégration et suite ciblée

- Herbes CC0 légères : ingestion et rendu intégrés, 52 assertions natives et
  [six A/B GPU](evidence/vegetation-grass-v13/README.md) passent sous leurs limites.
  Le [consommateur arbre](evidence/vegetation-tree-v13/GPU.md) est intégré en option,
  avec ses contrôles TOP, son rendu urbain oblique et ses limites déclarées.
- Sol : la [réponse physique continue](GROUND_RESPONSE.md) est intégrée et contrôlée
  numériquement/GPU ; les champs physiques restent ceux du contexte canonique.
  Aucune texture floutée ne remplace des observations fines absentes.
- Eau : les [six canaux isolés et l'A/B de teinte](HYDROLOGY_V13_DIAGNOSTIC.md)
  distinguent support alluvial et composite. L'option uniforme passe ses contrôles
  GPU sans modifier l'alpha, les classes ou la géométrie ; le défaut reste inchangé.
- Bord : la [capture 40 km](evidence/source-edge-v13/40000m.png) vérifie une bande
  de ciel de deux pixels conforme au domaine réel, sans étendre les hauteurs source.

La [campagne V13 complète](evidence/NATIVE_V13.md) qualifie techniquement ces
changements réunis sur `6ef8d3c` : 624 fichiers identiques, source fraîche,
navigation nominale 20 s, sept niveaux de zoom, deux probes de couches et
restauration stricte des archives. La revue artistique reste séparée. Les
[vues des 419 bâtiments](NATIVE_CITY419_V13.md) utilisent une source retenue
legacy, sans GR ni nouvelle génération.

La planification oblique commune (atlas/résident/enveloppe des mêmes hauteurs)
et la sélection haute LOD par support plutôt que centre sont préparées dans
d'autres worktrees. Le contre-exemple oblique à phase 0 et le tour 10 m sans
haute géométrie restent conservés ; aucun correctif futur n'est crédité à V13.
