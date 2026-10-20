# Parcours des benches Rust

Le conteneur `/rustbench.html` propose des sessions séparées et successives :

Les adresses HTTP directes des ateliers (`/terrainbench.html`, `/urbanbench.html`,
`/housebench.html`) rejoignent ce conteneur en conservant leurs paramètres,
y compris la caméra 3D et les zones dessinées. La barre d’onglets reste disponible
en 2D comme en 3D. « Ouvrir ↗ » utilise `standalone=1` pour ouvrir volontairement
un atelier isolé. Les fichiers HTML ouverts hors serveur restent autonomes.

1. **Terrain** (`#terrain`, `/terrainbench.html`) : relief, côtes et eau, étapes 1–3.
   « Envoyer aux settlements » conserve la carte affichée, entière ou découpée.
   La portion est carrée, avec saisie X/Y/côté ou placement sur la carte.
2. **Settlements** (`#settlements`, `/terrainbench.html?stage=settlements`) :
   implantations, routes régionales et quartiers/îlots. Les parcelles sont désactivées
   par défaut. Le relief et l’eau proviennent exclusivement de l’export chargé.
   Sélectionner une ville dans la liste, sur la carte ou dans « Quartiers et îlots »,
   puis utiliser « Ouvrir la ville dans l’atelier ».
3. **Urbanisme** (`#urban`, `/urbanbench.html`) contient uniquement l’atelier.
   Une ville transmise ouvre son plan calculé avec une portion locale du relief,
   de l’eau et des routes régionales. La découpe conserve les cellules FP32 et
   translate ensemble les géométries ; les axes restent des vecteurs unitaires.
   Les parcelles utilisent les mêmes îlots. « Renvoyer aux settlements » retrouve
   la carte complète et ses autres villes, avec les réglages et le plan modifiés.
   Les options partagées se synchronisent dans les sessions ouvertes de cette
   même ville ; les brouillons synchronisés attendent leur application explicite.
4. **Maisons** conserve son fonctionnement indépendant.

Chaque atelier reste ouvert pendant la navigation : carte, caméra, sélection,
panneaux et réglages en attente sont conservés en revenant par les onglets,
l’accueil ou les boutons Précédent/Suivant du navigateur. Un nouvel envoi vers
une étape charge explicitement le nouvel export dans cette étape.

Après rechargement du conteneur, chaque atelier reprend ses derniers réglages
appliqués et sa vue lors de sa réouverture, dans le même onglet. Les champs en
attente, panneaux ouverts, positions de défilement et zones peintes non appliquées
sont restaurés ensuite, sans lancer leur application à la carte.
Un lien fourni avec des paramètres explicites reste prioritaire sur ce contexte
de session. L’historique des exports ci-dessous reste indépendant de la session.

« Conserver cet export » ajoute un instantané à l’historique IndexedDB du navigateur.
Le catalogue serveur et l’import de terrains existants se trouvent dans le menu Terrain de Settlements ; l’occupation du territoire et ses couches y sont également disponibles. Fermer un onglet ou recharger
le conteneur ne supprime pas les exports. Ils ne sont pas synchronisés entre
navigateurs, machines ou origines HTTP. Les liens nomment l’export ; pour partager
son contenu entre machines, joindre le fichier **`.decor`**, puis l’importer dans
l’historique de la page destinataire. Le téléchargement depuis Terrain/Settlements
conserve aussi un nouvel instantané. Dans l’atelier, « Conserver et partager .decor »
ajoute le résultat à l’historique et télécharge son fichier.

## Contrat temporaire de transfert

### Zones de génération et heightmaps

Le panneau **Zones de génération** choisit le relief automatique de fond et
permet de dessiner des masques **Mer, Plaine, Collines, Montagnes, Hautes
montagnes** dans la vue principale. La gomme retire une opération ; les zones
non peintes retrouvent le générateur automatique. **Exemple : côte et massifs**
prépare des régions éditables. Le rayon et la transition règlent les limites
spatiales, sans peindre d'altitude.

Les masques pilotent le soulèvement, les crêtes, la distribution montagneuse et
les détails du générateur procédural **avant érosion**. L'érosion physique raccorde
les régions. Pour WASM et Python neuronaux, les mêmes profils Rust génèrent les
champs d'entrée et une contrainte locale de relief donnée au réseau base. Les
réseaux produisent leurs vallons et leurs sommets. Le masque marin applique
également l'opération littorale au résultat, pour conserver la mer dessinée.

Auto génère en fin de trait ; sinon utiliser **Générer le relief**. Annuler/rétablir
et Ctrl+Z/Ctrl+Maj+Z portent sur les masques. Échap quitte les zones et rend le
panoramique disponible ; la molette conserve le zoom. Le lien partage les masques
appliqués, pas les retouches encore en attente. Les zones s'importent et
s'exportent en JSON, séparément des heightmaps : version 1, grille 8–128²,
`weights` intercalant cinq poids entiers 0–255 par cellule, mer/plaine/collines/
montagnes/hautes montagnes, somme au plus 255. Le complément utilise le relief
automatique. Aucune altitude n'est stockée dans les zones.

Les masques NN doivent former de grandes régions : le coarse lit des cellules
natives de 7,7 km sur 40 km. Le passage aux zones avec une source NN sélectionne
**Scale** pour utiliser la carte entière ; **Crop** reste disponible. Le service
Python doit être relancé après la mise à jour, car le conditionnement du relief
local évolue. Un ancien service ne doit pas ignorer silencieusement ces données.

**Heightmap · import / export** échange un raster déjà généré ou importé, jusqu'à
1024². **Conserver** utilise ses altitudes ; **Éroder** lui applique l'érosion Rust.
L'export distingue le terrain affiché après traitement de la heightmap importée
avant traitement. Pour observer/exporter un relief procédural avant érosion, le
générer à 0 %. Les PNG gris 8/16 bits non entrelacés s'importent ; l'export PNG
16 bits conserve sa plage d'altitude et la largeur physique. Un PNG externe
utilise les champs **Noir = m** et **Blanc = m**. Le JSON conserve les altitudes
en mètres, mer à zéro, origine nord-ouest, cellules centrées. Les anciennes
esquisses d'altitude restent lisibles en compatibilité, sans devenir des zones.

Les masques sont compressés dans le fragment du lien, sans longue requête HTTP.
Les grosses heightmaps (plus de 100 000 caractères compressés) restent dans
IndexedDB avec une référence locale ; partager leur JSON/PNG ou le `.decor` pour
une autre machine. Une référence absente bloque la génération au lieu de produire
une autre carte. Les cavernes n'utilisent pas les opérations de surface.

### Transfert vers les étapes suivantes

Le conteneur `.decor` existant reste `magna-decor`, version 1 : en-tête JSON UTF-8,
raster binaire compressé gzip, octets FP32 regroupés par importance pour améliorer
la compression. Les anciennes cartes restent lisibles. Les nouveaux champs
optionnels de `meta.pipeline` décrivent l’étape, le parent, la découpe, la ville
sélectionnée et l’état de l’atelier : paramètres appliqués, graines, plans et
partitions déjà calculés. Cela étend l’adaptateur du bench ; aucun contrat permanent
du moteur Rust n’est imposé.

- Coordonnées locales en mètres, origine nord-ouest ; cellules centrées.
- Altitudes, niveaux d’eau et largeurs de rivière en FP32 ; masques d’eau en
  octets, identifiants de rivière en Int32. Aucun passage par un raster PNG.
- Les exports Terrain utilisent le raster physique adapté, jusqu’à 1024².
  Une découpe copie les cellules sans rééchantillonnage et conserve leur taille
  physique. X/Y/côté sont arrondis aux frontières des cellules, puis affichés
  dans les métadonnées de provenance. Les eaux et terres vectorielles sont
  découpées et translatées en coordonnées locales, avec trous conservés.
- Les routes et plans urbains restent des géométries vectorielles. Le transfert
  d’une ville découpe son raster local et conserve les routes d’approche, son plan
  et ses partitions pour l’atelier. Un instantané régional complet est conservé
  séparément pour le retour vers Settlements.
- Chaque nouvel instantané reçoit un identifiant indépendant. Une importation
  identique réutilise son entrée ; un fichier différent portant le même identifiant
  reçoit une nouvelle entrée. Les exports précédents restent accessibles.
- Une génération incomplète ou en échec bloque le transfert. L’absence d’un export
  local demande sa réimportation ; elle ne déclenche pas une régénération implicite.

Le batch `web/scripts/export_decors.mjs` utilise explicitement `pipeline=legacy`
pour conserver son ancien parcours automatique terrain → implantations → routes.
Les commandes de build TypeScript restent indépendantes de toute compilation Rust.

Le contrôle navigateur du parcours complet se lance depuis `web/` avec
`node scripts/rust_pipeline_ui_check.mjs http://127.0.0.1:5173`, après démarrage
de `npm run dev:benches`. Il vérifie la portion de terrain, la sélection d’une
autre ville, le plan transmis, les parcelles, la réimportation dans un stockage
vierge, le rechargement et la compatibilité du batch historique.
`node scripts/bench_context_ui_check.mjs http://127.0.0.1:5173` vérifie les quatre
onglets, les retours dans l’historique, les brouillons, la caméra, la sélection,
la reprise des réglages appliqués et des brouillons après rechargement et un nouvel envoi.
