# Cultures urbaines du City Bench

[English](CITY_CULTURES.md)

Le catalogue natif `rust/crates/core/src/urban/catalogue.json` décrit **79 cultures** :
les 53 d’origine et 26 ajoutées le 22 octobre 2026 pour couvrir un monde médiéval et
fantastique inspiré du réel. Chaque culture est une recette de **forme urbaine** (trame,
enceinte, noyau, densités, lots, phases) rattachée à un **pack de maisons existant** par
`urban/culture.rs::MAPPINGS`. Aucune recette de maison n’est inventée côté ville : les
packs appartiennent au moteur `houses`.

Les valeurs numériques sont des **plages artistiques** de génération, pas des relevés.
Les références `XX-YY-Snn` renvoient à l’atlas
[`styles_architecturaux_mondiaux_city_mapper.md`](styles_architecturaux_mondiaux_city_mapper.md).

## Comment une culture est construite

| Élément | Où | Rôle |
|---|---|---|
| `plan` | `cultures[id].plan` | trame (`organic`, `grid`, `terraces`, `linear`, `radial`, `dispersed`), forme d’enceinte, fortification, portes, orientation, escaliers, front d’eau |
| `nucleus` | `cultures[id].nucleus` | monument central (`kind` → rôle de `services.json::nucleus`), forme, surface ; donne le rôle du quartier central |
| `phaseCount`, `faubShare`, `ring` | `cultures[id]` | nombre de couronnes selon la population ; part de faubourgs (enceinte / sans enceinte) ; `ring: null` = une seule phase (camps) |
| recettes `core/ring/faubourg/village/hamlet` | `presets[id/recette].params` | rues (`streets`, `streetOp`, `closeOp`), lots (`plotOp`, `frontage`, `plotDepth`, `houseArea`, `coverage`), densité par zone (hab/ha), largeurs par rang |
| `growth` | `cultures[id].growth` | un camp qui devient ville au-delà de `minPop` (recettes `grown-*`) |
| `MAPPINGS` | `urban/culture.rs` | famille foncière, pack, emprunt déclaré (fantasy), profil fonctionnel, famille architecturale |
| `PREFERRED` | `urban/culture.rs` | recette native par défaut quand l’heuristique « plus petite enveloppe » du pack choisirait une maison moins typique |
| famille de services | `urban/services.json::cultures` | équipements (culte, marché, entrepôts…), libellés et occupation des ménages |

Les nouvelles cultures sont produites par un générateur reproductible,
[`docs/methods/city_cultures_generator.mjs`](methods/city_cultures_generator.mjs) (base = préréglage
existant + surcharges, comme les `extensions` de `rust/scripts/export-urban-catalogue.ts`) :
`node docs/methods/city_cultures_generator.mjs rust/crates/core/src/urban/catalogue.json`
remplace uniquement ses 26 entrées et laisse le reste du catalogue intact.
Relancer l’ancien export TypeScript **effacerait** ces entrées : reporter d’abord ces
spécifications dans ses `extensions`.

## Les 26 cultures ajoutées

| Id | Libellé | Trame · enceinte | Noyau | Densité cœur/milieu/bord (hab./ha, préréglage cœur) | Lot cœur (front × prof., m) | Pack → maison par défaut | Services |
|---|---|---|---|---|---|---|---|
| <a id="al-andalus"></a>`al-andalus` | Al-Andalus · médina ibérique à patios | organique, muraille, pente | grande mosquée | 300/220/140 | souk 4,8–7 × 7–12 ; patios 7–12 × 14–24 | AF-MAG → B02 (cour), B01 en échoppe | islamic |
| <a id="italian-comune"></a>`italian-comune` | Italie · commune à piazza et tours | organique, cerchie successives | piazza | 364/252/154 | 7,5–10 × 17–28 | EUR-MED → B02 rangée étroite au cœur, B09 portique en mixte, B04 dans les borghi | european |
| <a id="flemish-cloth-town"></a>`flemish-cloth-town` | Flandre · ville drapière à beffroi | organique, canaux, enceintes | beffroi + Grand-Place | 210/160/110 | 6–8 × 26–44 | EUR-MED → B11 pignons à redents, B05 halle en mixte | european |
| <a id="rynek-town"></a>`rynek-town` | Europe centrale · ville à rynek | damier, enceinte ovale | grande place 0,8–3 ha | 170/140/100 | 7–10 × 28–40 | EUR-MED → B03 pans de bois | european |
| <a id="slavic-gord"></a>`slavic-gord` | Slaves · gród palissadé et podgrodzie | radiale, palissade | gród (château) | 80/60/45 | 12–18 × 26–40 (cours) | EUR-EAST → B01 isba | european |
| <a id="caucasian-highland"></a>`caucasian-highland` | Caucase · bourg fortifié géorgien et arménien | terrasses, muraille | église en enceinte | 195/150/103 | 6–10 × 12–20 | EUR-EAST → B03 maison caucasienne | european |
| <a id="ethiopian-highland"></a>`ethiopian-highland` | Éthiopie · cité d’altitude | organique, ouverte | enclos d’église circulaire | 130/105/85 | concessions 12–20 × 18–30 | AF-EAST → B04 maison des hauts plateaux | african |
| <a id="great-zimbabwe"></a>`great-zimbabwe` | Zimbabwe · enclos de pierre sèche | organique, ovale | enclos royal (`royal-enclosure` → palais) | 60/45/35 | concessions 28–38 × 30–42 | AF-SOUTH → B05 concession de cases | african |
| <a id="hausa-kano"></a>`hausa-kano` | Hausa · cité-État à enceinte de terre | organique, muraille de terre | grande mosquée | 140/110/80 | cours 19–26 × 20–30 | AF-SAHEL → B05 maison hausa à cour, B04 en échoppe | islamic |
| <a id="hadhrami-tower"></a>`hadhrami-tower` | Hadramaout · cité verticale (Shibam) | compacte, rectangulaire, murée, une seule phase | mosquée | 450/380/300 | 7–11 × 9–15 | AS-MIDE → B13 maison-tour hadramie (4–7 niveaux) | islamic |
| <a id="rajput-fort"></a>`rajput-fort` | Rajputana · ville au pied du fort | organique, muraille, pente | fort (garnison) | 260/190/120 | bazar 5–8 × 12–20 ; havelis 13–25 × 22–32 | AS-IND → B10 maison à balcon (cour), B01 en échoppe | indian |
| <a id="dravidian-temple"></a>`dravidian-temple` | Inde du Sud · ville-temple concentrique | damier + anneaux carrés, portes cardinales | temple 2–8 ha | 200/160/110 | 5,5–8 × 24–40 | AS-IND → B01 maison rectangulaire | indian |
| <a id="bagan"></a>`bagan` | Birmanie · cité royale de Pagan | damier, enceinte carrée, fleuve | temple | 90/70/50 | enclos 14–22 × 20–32 | AS-SEA → B01 pilotis (plateforme) | indian |
| <a id="vietnamese-citadel"></a>`vietnamese-citadel` | Viêt · citadelle et quartier marchand | citadelle carrée ; extension organique | citadelle 4–12 ha | 140/120/90 | citadelle 25–34 × 36–48 ; maisons-tubes 6–9 × 26–46 | AS-SEA → B04 maison à cour, B02 en lot étroit | chinese |
| <a id="tibetan-monastery"></a>`tibetan-monastery` | Tibet · bourg monastique de pente | terrasses, escaliers | monastère | 300/220/160 | 12–17 × 14–21 (famille `compound`) | AS-HIM → B04 maison à galerie, B03 sur lot étroit | indian |
| <a id="mongol-ordu"></a>`mongol-ordu` | Mongols · ordu de yourtes ; capitale murée ≥ 8 000 hab. | radiale, portes cardinales ; puis damier muré | tente du khan (famille steppe) | 105/90/75 | 10–16 × 12–20 | AS-STEP → B01 yourte | steppe |
| <a id="maori-pa"></a>`maori-pa` | Māori · pā fortifié en terrasses | terrasses, palissade | — (place commune du clan) | 420/350/280 | 7–12 × 10–16 | OC-PAC → B03 whare | clan |
| <a id="pnw-plank-village"></a>`pnw-plank-village` | Côte Nord-Ouest · maisons de planches | linéaire face au rivage | — | 90/80/70 | 13–20 × 28–38 | AM-PNW → B01 longue maison de planches | clan |
| <a id="inuit-camp"></a>`inuit-camp` | Arctique · camp inuit d’hiver | dispersée, rivage | — | 260/228/195 | 8–13 × 9–14 | AM-ARC → B05 igloo | clan |
| <a id="siberian-camp"></a>`siberian-camp` | Sibérie · campement de chums | radiale | — | 210/192/168 | 9–14 × 10–15 | AS-SIB → B01 chum | clan |
| <a id="guarani-village"></a>`guarani-village` | Guaraní · village de grandes maisons | radiale, palissade | — (place de danse du clan) | 105/90/83 | 12–20 × 26–38 | AM-SOUTH → B03 longhouse guaraní | clan |
| <a id="budj-bim"></a>`budj-bim` | Australie · village de pierre du Budj Bim | dispersée, chenaux | — | 200/180/160 | 8–13 × 10–16 | OC-AUS → B03 cabane de pierre | clan |
| <a id="lizardfolk-swamp"></a>`lizardfolk-swamp` | Hommes-lézards · cité lacustre sur pilotis* | dispersée, passerelles | bassin sacré | 131/116/102 | 9–14 × 14–22 | AM-TROP → B05 pilotis (plateforme) | fantasy |
| <a id="merfolk-tidal"></a>`merfolk-tidal` | Ondins · grève et grottes marines* | organique, escaliers, front d’eau | sanctuaire de marée | 176/152/128 | 8–13 × 12–20 | OC-PAC → B08 pilotis de lagune | fantasy |
| <a id="giant-hold"></a>`giant-hold` | Géants · bourg mégalithique* | radiale, enceinte cyclopéenne, voies ×2 | salle du jarl | 25/22/18 | 20–32 × 40–60 | EUR-NOR → B01 maison longue | fantasy |
| <a id="goblin-warren"></a>`goblin-warren` | Gobelins · terrier à flanc de colline* | organique, impasses (0,95), palissade | — | 320/260/200 | 17–24 × 15–22 | AS-SIB → B08 maison semi-souterraine | fantasy |

`*` emprunt fantastique déclaré (`borrowed = true` dans `MAPPINGS`) : la culture repose
sur des morphologies réelles citées, le mode strict la refuse comme tradition documentée.

Profil fonctionnel (`MAPPINGS`, 5ᵉ champ) : `communal` = un ménage par lot (tentes,
igloos, cases familiales, pilotis) ; `town` laisse un lot accueillir plusieurs ménages selon la
surface utile (`services.json::occupancy`). Sont `town` : les concessions lignagères de
`great-zimbabwe`, l’ordu (`mongol-ordu`, qui devient capitale murée), les maisons de
planches multifamiliales (`pnw-plank-village`) et le terrier gobelin.

Les six packs maisons qui n’avaient aucune ville sont maintenant utilisés :
AM-ARC, AM-PNW, AM-SOUTH, AS-SIB, OC-AUS, OC-PAC (32 packs sur 32).

### Famille de services `clan`

Nouvelle famille pour les villages lignagers sans ville-temple (Māori, Côte Nord-Ouest,
Inuit, Sibérie, Guaraní, Budj Bim) : maison commune (repère), place des rassemblements,
caches/greniers sur poteaux, abris à canots au bord de l’eau, séchoirs-ateliers, petits
sanctuaires en hauteur. Occupation : 8 personnes par ménage, 40 m² par ménage, 6 ménages
par lot au plus (grandes maisons de clan).

## Cohérence foncière (vérification du 22 octobre)

Chaque culture est rejouée sur une carte du City Bench (`city_replay.mjs --sites`, quartiers →
parcelles → sites de construction) et jugée sur l’équilibre lots / ménages, pas sur des
comptes seuls : un lot bâtissable laissé en jardin signale une recette de maison que les
lots ne contiennent pas ; des ménages sans lot signalent une densité ou un profil faux.
Corrections apportées par cette vérification :

| Culture | Symptôme (avant) | Correction | Après |
|---|---|---|---|
| `italian-comune` | 53 % des lots en jardin : la parcelle est taillée pour la maison compacte du pack (B04), le programme exigeait le portique B09 (7 × 13,2 m) | lots 7,5–10 × 17–28 ; B02 au cœur, B09 en mixte, B04 hors les murs ; densité ×1,4 au lieu de ×1,8 | 1 % de jardins, 1 111 ménages logés |
| `tibetan-monastery` | 47 % de jardins (même écart B04 / B03) | lots 12–17 × 14–21 ; famille `compound` (choix par lot entre B04 et B03) | 2 % de jardins |
| `ethiopian-highland` | 0 logement sur 04 (pente médiane 0,27 > 0,21 admise par AF-EAST-B04) ; 27 % de jardins sur 13 | carte de vérification 13 ; densité 130/105/85 | 1 % de jardins, 588 logements |
| `great-zimbabwe`, `mongol-ordu` (12 000), `goblin-warren` | ménages sans lot (un ménage par lot imposé) | profil `town` | 1,5 / 1,9 / 3,7 ménages par lot, tous logés |

### Rejeu de vérification (serveur natif, arbre du 22 octobre)

Requêtes de quartiers figées du City Bench, culture et population remplacées
(`web/out/p5-cultures-final/<culture>-<carte>-<hab>/`, images `.png` à côté de chaque requête).
« logements » = sites de construction domestiques ou mixtes ; « warn » exclut les résidus
cadastraux < 0,02 m². `european-organic` et `medina` servent de référence.

| culture | carte | hab. | îlots | rues | lots (plot) | jardins | résid. | requêtes | logements | logts/plot | warn | ms |
| european-organic | 01-river-plain-s | 5000 | 162 | 145 | 863 | 98 | 38 | 872 | 846 | 0.98 | 3 | 3432 |
| medina | 05-arid-plateau-s | 5000 | 171 | 271 | 423 | 69 | 53 | 436 | 410 | 0.97 | 3 | 3770 |
| al-andalus | 07-arid-shore-s | 5000 | 206 | 272 | 724 | 160 | 51 | 735 | 710 | 0.98 | 3 | 4237 |
| italian-comune | 03-aegean-hills-s | 5000 | 131 | 128 | 417 | 109 | 32 | 422 | 397 | 0.95 | 4 | 5245 |
| flemish-cloth-town | 01-river-plain-s | 5000 | 95 | 88 | 651 | 41 | 48 | 660 | 634 | 0.97 | 3 | 3379 |
| rynek-town | 13-temperate-valley-s | 5000 | 139 | 131 | 710 | 105 | 34 | 718 | 693 | 0.98 | 3 | 4710 |
| slavic-gord | 09-boreal-river-s | 5000 | 187 | 158 | 1175 | 105 | 17 | 1146 | 1112 | 0.95 | 12 | 4441 |
| caucasian-highland | 04-mountain-bay-s | 5000 | 227 | 214 | 658 | 184 | 77 | 652 | 619 | 0.94 | 8 | 11129 |
| ethiopian-highland | 13-temperate-valley-s | 5000 | 95 | 124 | 611 | 51 | 3 | 619 | 589 | 0.96 | 2 | 6094 |
| great-zimbabwe | 05-arid-plateau-s | 5000 | 202 | 177 | 467 | 261 | 16 | 483 | 453 | 0.97 | 3 | 4386 |
| hausa-kano | 05-arid-plateau-s | 5000 | 137 | 441 | 651 | 315 | 47 | 662 | 639 | 0.98 | 5 | 11965 |
| hadhrami-tower | 07-arid-shore-s | 5000 | 147 | 149 | 426 | 191 | 97 | 436 | 414 | 0.97 | 4 | 10877 |
| rajput-fort | 05-arid-plateau-s | 5000 | 138 | 255 | 512 | 159 | 40 | 505 | 486 | 0.95 | 5 | 6356 |
| dravidian-temple | 01-river-plain-s | 5000 | 119 | 102 | 761 | 108 | 54 | 734 | 716 | 0.94 | 2 | 3398 |
| bagan | 01-river-plain-s | 5000 | 75 | 106 | 695 | 51 | 3 | 701 | 683 | 0.98 | 1 | 2427 |
| vietnamese-citadel | 13-temperate-valley-s | 5000 | 54 | 60 | 306 | 72 | 24 | 316 | 301 | 0.98 | 4 | 7707 |
| tibetan-monastery | 04-mountain-bay-s | 3000 | 107 | 95 | 294 | 22 | 16 | 294 | 279 | 0.95 | 2 | 5668 |
| mongol-ordu | 05-arid-plateau-s | 3000 | 85 | 127 | 627 | 77 | 2 | 564 | 546 | 0.87 | 3 | 4086 |
| mongol-ordu | 01-river-plain-s | 12000 | 119 | 206 | 1153 | 97 | 3 | 1176 | 1137 | 0.99 | 1 | 2828 |
| maori-pa | 02-atlantic-coast-s | 800 | 46 | 40 | 97 | 3 | 16 | 101 | 91 | 0.94 | 5 | 4568 |
| pnw-plank-village | 02-atlantic-coast-s | 600 | 14 | 26 | 61 | 40 | 1 | 64 | 57 | 0.93 | 0 | 6965 |
| inuit-camp | 09-boreal-river-s | 150 | 7 | 16 | 22 | 0 | 1 | 25 | 18 | 0.82 | 2 | 3614 |
| siberian-camp | 09-boreal-river-s | 200 | 6 | 15 | 31 | 2 | 1 | 34 | 25 | 0.81 | 2 | 2455 |
| guarani-village | 13-temperate-valley-s | 500 | 46 | 36 | 66 | 3 | 17 | 71 | 62 | 0.94 | 12 | 3532 |
| budj-bim | 02-atlantic-coast-s | 300 | 6 | 20 | 73 | 0 | 0 | 46 | 38 | 0.52 | 1 | 9714 |
| lizardfolk-swamp | 01-river-plain-s | 1500 | 102 | 93 | 318 | 18 | 33 | 312 | 300 | 0.94 | 1 | 4303 |
| merfolk-tidal | 07-arid-shore-s | 1500 | 83 | 83 | 303 | 13 | 14 | 310 | 299 | 0.99 | 1 | 4193 |
| giant-hold | 09-boreal-river-s | 800 | 55 | 55 | 146 | 88 | 3 | 145 | 138 | 0.95 | 3 | 3489 |
| goblin-warren | 03-aegean-hills-s | 2000 | 74 | 88 | 114 | 0 | 16 | 115 | 106 | 0.93 | 2 | 11309 |

## Lacunes connues

- `pnw-plank-village` : une bourgade de 600 habitants n’a que des îlots « village », où
  le programme impose un ménage par lot (`programme.rs`) : 57 maisons pour 75 ménages
  (rejeu final).
  Les grandes maisons de planches (30–50 personnes) demanderaient la capacité multi-ménages
  aussi en zone village.
- Écart général entre étapes (hors fichiers culture) : la parcelle témoigne d’abord la maison
  compacte du pack (`parcels/admission.rs::compact_fallback`) tandis que le programme exige la
  recette principale pour les familles `frontage`/`compact` ; seules les familles
  `courtyard`/`compound` reprennent la maison compacte lot par lot. Toute recette
  principale de plus de 1,5 × l’aire de la maison compacte du pack laisse des lots vides.
- `ethiopian-highland` et les autres packs à une seule maison de plain-pied refusent les
  pentes > 0,21 : sur une carte de montagne, la ville se vide.
- `guarani-village`, `maori-pa` : des îlots du cercle palissadé n’ont pas de contact
  continu avec une rue et restent en espace ouvert (avertissements du découpage).

- Les maisons restent celles des packs : pas de maison de géant, de terrier gobelin ni de
  grotte d’ondins ; pas de gopuram, de stupa, de beffroi, de tour hadramie isolée comme
  monument spécifique (les monuments sont des réserves de programme).
- Les ponts : `footprint/crossings.rs::spans` ne connaît pas les nouvelles cultures (valeur
  par défaut 1,0) ; les camps (`inuit-camp`, `siberian-camp`, `mongol-ordu`…) devraient
  y être traités comme bâtisseurs de gués.
- Les variantes contextuelles (`culture.rs::contextual_uncached`) ne couvrent que les lots
  étroits ; les élites (maisons-tours toscanes EUR-MED-B08, tours svanes EUR-EAST-B04)
  ne sont pas encore choisies par rang social.
- Les villes `hadhrami-tower` déclarent une seule phase (`phaseCount [[0, 1]]`, `ring: null`) :
  Shibam est un rectangle muré unique. Le rejeu du 22 octobre (arbre partagé, étapes de
  composition en cours de refonte) produit pourtant 3 époques et 2 enceintes sur 07 :
  le nombre de phases de la culture n’est plus respecté par la composition.
- Les comptes varient d’un rejeu à l’autre tant que les étapes parcelles/composition
  évoluent (ex. `budj-bim` : 41 lots puis 73 lots dont 40 % de jardins).
