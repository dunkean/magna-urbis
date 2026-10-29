# Apparence de la carte

Le bouton **Apparence** utilise le même composant dans V2, Terrainbench et Citybench, y compris leurs ouvertures depuis Rustbench et le lanceur local. Les contrôles des bancs sont déplacés avec leurs gestionnaires existants ; les champs de génération restent dans leurs étapes.

Les réglages sont classés dans six familles :

- **Relief et ombres** : ombrage, direction et hauteur du soleil, intensité, exagération ; raffinement et exagération verticale de la vue 3D.
- **Sol : couleurs et style** : style cartographique ou matériaux, fond du terrain, hypsométrie, couleurs basse et haute altitude, fond de carte.
- **Couverture du sol et courbes** : occupation vectorielle, végétation, textures peintes, courbes de niveau, pinceaux fantasy, saison satellite, canopée, densité et clairières.
- **Routes et rues** : visibilité indépendante des routes régionales et des rues urbaines, intégration au sol, styles et épaisseurs disponibles dans chaque banc, couleurs des chaussées, bords et chemins.
- **Rivières, lacs et mer** : visibilité de l’eau, lacs et anciens chenaux, couleurs de l’eau peu profonde, profonde et des rivières.
- **Bâtiments et plan de ville** : visibilité des bâtiments, styles de toiture, matériaux et ombres, palettes et couches du plan urbain, couleurs des toits/emprises et des contours. Masquer les bâtiments conserve rues, parcelles et jardins.

La présentation générale (toponymes, cadre, légende, cartouche) et les diagnostics possèdent leurs propres sections. Les contrôles dépendant d’un moteur restent conditionnels. Le panneau se ferme avec Échap ou un clic extérieur et reste dans la fenêtre sur ordinateur et mobile.

Un **astérisque à côté du nom du style** signale des réglages de rendu personnalisés : `Parchemin *`, par exemple. Il suit les couleurs, l’éclairage, les couches, la végétation, les routes et les bâtiments. Revenir aux valeurs du style retire l’astérisque. Le marqueur reste correct après changement de langue, rechargement d’un projet ou ouverture d’un lien personnalisé ; l’identifiant du style sauvegardé ne contient jamais cette étoile.

## Couleurs et compatibilité

Chaque couleur possède un sélecteur et un bouton **Rétablir**, qui supprime sa surcharge et retrouve la valeur du style courant. Changer de style conserve les couleurs personnalisées. Les palettes enregistrées ne sont jamais modifiées globalement.

Les couleurs des matériaux satellite et des échelles de diagnostic restent contrôlées par leur rendu : les champs incompatibles sont désactivés et expliqués. Les couleurs de végétation vectorielle sont distinctes des matériaux de la canopée satellite. Dans Citybench, un fond déjà calculé sous forme d’image ne peut pas être recoloré par ses seuls paramètres d’affichage.

Les toits natifs conservent leur géométrie et leur ombrage par facettes lors d’un changement de couleur. Les caches de bâtiments incluent les couleurs, afin de ne pas conserver des tuiles d’une ancienne palette. Une couleur explicite de chaussée s’applique aussi lorsque des textures ou une intégration au sol sont sélectionnées.

Les styles Render, Render3D et Render v2 utilisent WebGL2, y compris pour composer leurs images SVG/PNG. Dans V2, le compositeur et les exports réutilisent le contexte de la carte, y compris un contexte logiciel. Un framebuffer RGBA séparé conserve l’image, les dimensions et l’état graphique de la carte. Sans contexte partagé, le compositeur essaie `OffscreenCanvas`, puis un canvas classique dans la page. Un contexte perdu est recréé. Si le worker ne peut pas composer l’image, il transmet tout de même les altitudes calculées à la page. En l’absence totale de WebGL2, un changement d’apparence conserve la carte précédente et affiche une indication persistante ; les styles cartographiques restent disponibles.

Les tuiles 2D gardent leurs marges pour le filtrage, mais chaque pixel affiché appartient à une seule tuile. Cela évite que les couches de sol transparentes deviennent plus opaques aux raccords. Le canevas de composition est effacé entre deux images pour empêcher l’accumulation d’opacité.

## Persistance et données conservées

V2 sauvegarde `appearance.colors`, `appearance.roads`, `appearance.buildings` et les éventuelles surcharges `appearance.forest`. Les couleurs sont des valeurs `#RRGGBB` validées à l’import. Les exports utilisent les mêmes préférences que la carte. Les liens des bancs conservent les couleurs sous `color_<nom>` ; leurs autres réglages d’affichage gardent leur format existant.

La canopée personnalisée est recalculée à partir des altitudes et de l’eau conservées, avec un cache séparé. Aucun changement d’apparence ne lance les générateurs de relief, d’hydrologie, d’implantation ou de bâtiments.

## Implémentation et vérification

- `web/src/ui/renderSettingsPanel.ts` : structure commune, catégories, sélecteurs et réinitialisation des couleurs.
- `web/src/ui/benchRenderSettings.ts` : adaptation des contrôles existants de Terrainbench et Citybench.
- `web/src/v2/renderControls.ts` : adaptation des préférences V2 et des traductions français/anglais.
- `web/src/render/customColors.ts` : surcharges de palette isolées et capacités des rendus.
- `web/src/v2/displayForest.ts` : adaptation de la forêt sur les données conservées.

Les tests ciblés couvrent validation, conservation des données, indépendance des couches, export, restauration des palettes, caches et éclairage des toits. `scripts/render_settings_panel_check.mjs` vérifie les trois interfaces et les dimensions mobiles. `scripts/render_custom_colors_browser_check.mjs` importe une carte native conservée, vérifie les pixels personnalisés dans la carte et le PNG exporté, puis contrôle l’identité des altitudes et des villes après sauvegarde du projet. Ces scripts se lancent depuis `web`, avec `V2_CHECK_URL` et `BENCH_CHECK_URL` pour choisir les serveurs.

`scripts/render_material_canvas_check.mjs` refuse volontairement WebGL2 sur `OffscreenCanvas`. Il compare les pixels des shaders d’origine et satellite avec leur composition sur un canvas classique, recharge une carte native dans V2 avec **Render · Neural Earth** et vérifie son export PNG sans appel de génération.

`scripts/render_style_customization_check.mjs` vérifie les astérisques des trois interfaces : modification, retour aux valeurs d’origine, changement de style/langue et restauration des liens.

`scripts/render_material_shared_check.mjs` vérifie les pixels RGBA et la restauration de l’état d’un contexte opaque partagé, puis les trois matériaux et un export PNG avec un seul contexte WebGL autorisé. Il vérifie aussi la conservation de la carte quand aucun contexte n’est disponible. `scripts/render_tile_seams_check.mjs` compare 180 images tuilées à leur rendu direct : cinq palettes, trois densités de pixels, fond opaque ou transparent, déplacements fractionnaires et réutilisation du cache.
