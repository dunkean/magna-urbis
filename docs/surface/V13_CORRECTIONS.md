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
mesures de temps CPU. Aucun résultat V13 de navigation ou de rendu n'est annoncé.

## Chantiers séparés en cours

- Herbes CC0 légères puis arbres avec LOD et masque de canopée cohérent :
  [préparation artistique](VEGETATION_ASSET_NEXT.md).
- Sol : diagnostiquer les réponses des paramètres physiques continus avant une
  éventuelle révision du contexte ; aucune texture floutée pour cacher les 78 m.
- Eau : distinguer support alluvial et composite d'eau dans les diagnostics.
- Bord du domaine : corriger la couverture des triangles de représentation,
  conserver le domaine réel et les requêtes de hauteur hors source invalides.

Ces lignes décrivent le travail actif, pas des capacités déjà qualifiées.
