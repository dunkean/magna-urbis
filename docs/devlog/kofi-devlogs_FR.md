# Magna Urbis — devlogs Ko-fi #00–#06

Traduction française de `kofi-devlogs.md` (la version anglaise fait référence).
Emplacements à remplir : `[LIEN]`, `[IMAGE : …]`, `[TODO : …]`.

---

## Devlog #00 — 925 commits en six semaines, et je n'en ai presque tapé aucun

Salut, je suis dunkean. Le jour, je suis chercheur en IA et systèmes complexes. La nuit, je fais un générateur procédural de mondes pour le jeu de rôle sur table : Magna Urbis.

Ce devlog parle de comment il est construit, de ce qui a cassé et de ce qui m'a surpris. Pas de promesses de roadmap.

### Ce qu'il fait

Un seul pipeline, du sol vers le haut :

terrain → hydrologie → routes régionales → placement des établissements → quartiers et rues → parcelles → programme (qui habite et travaille où) → emprises bâties → volumes des bâtiments → styles de carte 2D et vue 3D.

115 cultures architecturales, du médiéval européen à la médina, au hutong, au nain, à l'elfique, au moderne et à quelques extraterrestres.

### La stack

- **Cœur en Rust** : environ 258 000 lignes. Le module urbain fait à lui seul environ 108 000 lignes, et c'est un seul bloc fortement connexe. J'ai essayé de le découper en crates. Le plan a conclu que ça n'en valait pas la peine : tout appelle tout.
- Compilé deux fois : en **natif**, comme moteur HTTP local pour l'application desktop, et en **WASM** pour le navigateur.
- **Front en TypeScript** : environ 180 000 lignes, avec des moteurs de rendu WebGL2 et WebGPU.
- Le premier jour (30 septembre), c'était un prototype Python. Il a été supprimé le 12 octobre.

### Comment il est construit

J'écris très peu de code à la main. Je fais tourner des agents de code IA (surtout Claude, un peu de Codex), plusieurs à la fois, et je joue l'architecte et le relecteur : je décide quoi construire, je regarde les images, je rejette.

Ça marche. Ça casse aussi de façons que je n'avais pas prévues :

- **Les compilations en parallèle.** Plusieurs agents, chacun avec son propre répertoire de build Cargo, chacun recompilant de zéro une crate de 100 000 lignes. Des heures de CPU pour rien. La règle maintenant : les agents écrivent le code et s'arrêtent, puis un superviseur compile une fois et teste une fois.
- **L'antivirus** a mis `rustc.exe` 1.99 en quarantaine. La toolchain est désormais figée en 1.98.
- **Un GPU bloqué.** Des scripts de captures lançaient Chrome headless, et un `timeout` du shell les a tués. Ça a laissé 19 processus GPU orphelins coincés dans le pilote : `taskkill /F` ne pouvait pas les tuer, aucun navigateur ne pouvait créer de contexte WebGL, et j'ai dû redémarrer. Maintenant, chaque script navigateur a sa propre limite de temps, ferme le navigateur dans un `finally` et tourne sur un GPU dédié.
- **Les corrections locales sans fin.** Laissé seul, un agent ajoutera volontiers le 40e cas particulier pour qu'une rivière ait l'air juste. On en reparle au #02.

La bonne surprise, c'est la vitesse. En six semaines, je suis passé d'un squelette SVG à 115 cultures, du relief neuronal et une vue 3D. Les agents sont aussi très bons pour écrire des outils de mesure, et la plupart des gains ci-dessous viennent de ces outils.

### Pourquoi Ko-fi

Le code est sous AGPL v3 et reste gratuit. Pas d'offre premium.

Les agents IA, eux, ne sont pas gratuits. Si le projet vous plaît, le bouton Ko-fi aide à les payer. Un rapport de bug avec un code de partage vaut tout autant pour moi.

- Magna Urbis : [LIEN]
- GitHub : [LIEN]

[IMAGE : une ville générée, 2D et 3D côte à côte]

---

## Devlog #01 — Porter un modèle de diffusion de terrain en Rust pur

Le terrain à base de bruit est rapide, mais il ne sait pas à quoi ressemble une chaîne de montagnes vue de 40 km. Les modèles de diffusion, si. Le modèle dont je suis parti est **Terrain Diffusion** de Goslin, celui derrière InfiniteDiffusion (Infinite Generation). Tout le crédit à ce travail : sans lui, rien de tout ça n'existe.

Le problème : c'est une stack PyTorch. Je le voulais dans le générateur, sans Python à l'exécution et sans serveur.

### Le portage

J'ai réimplémenté la chaîne d'inférence en Rust avec **Burn**, avec des convolutions FP16 sur Vulkan :

- un bruit portable, pour que la même graine donne le même relief sur toutes les machines ;
- les UNet EDM2, les pas de l'échantillonneur grossier (DPM-Solver++), le décodeur distillé et la reconstruction laplacienne ;
- une commande `neural export` qui convertit directement les checkpoints PyTorch / safetensors en poids FP16 ;
- un mode `neural serve` qui garde les poids en mémoire derrière un service HTTP local.

### Bonne surprise n°1 : moins d'évaluations

Le pipeline d'origine découpe un monde infini en tuiles. Moi, je n'ai besoin que d'une carte finie, donc je planifie les fenêtres pour cette carte. Une carte de 40 km demande maintenant 4 / 64 / 16 évaluations du modèle par étape au lieu de 16 / 100 / 25. Ça fait environ **une seconde sur une RTX 3090**.

### Bonne surprise n°2 : la précision

J'ai comparé le portage à la même chaîne exécutée entièrement en FP32 en Python. Écart moyen : **3,95 m**. Le chemin BF16 de production de l'original s'écarte de cette référence FP32 de **19,8 m**. Le portage Rust en FP16 est donc plus proche du résultat FP32 que le réglage de production de l'original.

### L'échec

La première version WebGPU/WASM était **trop lente, et fausse après l'autotune**. Elle est sortie non branchée le premier jour, avec une note dans le commit qui le disait exactement.

La raison : sans autotune, la convolution WebGPU portable de Burn est un noyau direct naïf. Deux jours plus tard, le navigateur a donc cessé d'utiliser Burn. J'ai écrit un petit moteur dédié en WGSL :

- des convolutions en GEMM implicite sur des activations NHWC, en FP16 quand le GPU gère `shader-f16`, toujours avec une accumulation FP32 ;
- les petites opérations fusionnées dans les noyaux (activation, modulation, normalisations, biais, résidus, concaténations des sauts) ;
- une seule soumission de file par relecture ;
- un ordre d'accumulation fixe, pour que la sortie ne dépende pas de la tuile GEMM. Le chemin FP32 colle à Burn FP32 à 0,002 m près.

Le modèle de base a aussi dû maigrir pour être téléchargeable : il est passé en poids 4 bits (NF4), avec un modèle entraîné pour vivre avec cette quantification, et à deux pas d'échantillonnage.

Chrome, RTX 3090, une tuile de 30 m sans cache : **104 s → 2,0–2,2 s**. Première tuile grossière : 6,8 s → 0,3 s. Le WASM d'inférence : **67 Mo → 0,7 Mo**.

### Ce qui se passe après

Le relief neuronal entre dans le générateur de terrain comme une surface fixe, sans découpe ni érosion supplémentaire. Ensuite, les étapes habituelles tournent dessus : hydrologie, routes, villes. La couche Outreterre fonctionne pareil : elle creuse des grottes dans n'importe quel relief, procédural ou neuronal.

Les poids distillés sont dans Git LFS.

- Neural Earth : [LIEN]
- Terrain Diffusion / InfiniteDiffusion : [LIEN]

[IMAGE : même esquisse, relief procédural contre relief neuronal]

---

## Devlog #02 — Corriger la règle, pas le cas

La leçon la plus chère de la V2 jusqu'ici : **une correction qui ne traite que le cas sous vos yeux est une dette.**

### Rivières : le moteur que j'ai jeté

Mi-octobre, j'avais un moteur de rivières « vectoriel » en TypeScript, avec méandres, bras morts, confluences, hauts-fonds de lacs et styles de chenaux. Chaque tour de relecture trouvait quelque chose de nouveau : lacs en escalier, largeurs uniformes, rivières qui se déconnectaient. Chaque tour avait sa correction locale, et le tour suivant en trouvait trois de plus.

Le 12 octobre, je me suis arrêté et je l'ai tué. Il était moche, il était lent, et il ne convergerait jamais.

Ce qui l'a remplacé :

- l'**ancien graphe de rivières en Rust** (les lacs sont des nœuds avec une entrée et une sortie). Ses rivières étaient déjà bonnes, mais il n'avait pas de lacs ;
- **des lacs issus d'un bilan hydrique climatique** : Fill–Spill–Merge (d'après Barnes et al.), avec lacs ouverts et fermés ;
- **une seule définition des lacs**, partagée par le routage, le graphe et le dessin. Le même champ de rive alimente les polygones Rust et le shader GPU, donc la carte ne peut pas contredire la simulation ;
- les corrections passent par des **invariants** (`hydrology_invariants.rs`) : quand une image a l'air fausse, j'écris la propriété qu'elle viole, puis je corrige la règle qui la casse. Les passes géométriques gardent fixes les extrémités des arêtes, et quand elles échouent, elles reviennent à la géométrie précédente.

### Des villes sans maisons

Une planche de relecture montrait des villes sans aucune maison : une ville portuaire sur un débarcadère sans rues, une ville alpine de 10 000 habitants sans site valide, des pentes raides que rien ne pouvait découper en lots.

Première tentative : une échelle de repli. Garder le port seulement s'il loge autant de ménages que le site d'origine. Se replier sur les routes régionales. Se replier sur le meilleur terrain libre. Réessayer l'emprise à la pente d'escalier, puis à 0,75. Si tout échoue, afficher un avertissement « Aucune habitation ».

Ça marchait, et c'était quand même le mauvais cadrage. Les villages népalais et les temples du Bhoutan sont posés sur des pentes. **Un terrain raide est un site normal, pas un cas d'erreur.** Désormais, le générateur arpente d'abord le terrain. Il choisit de combien relâcher ses règles de pente avant la première mise en place, au lieu d'échouer, puis de relâcher et de refaire toute la ville. Résultat : une ville de halfelins à flanc de montagne est passée de 4 plans complets à 2.

### Routes : polir, pas reconstruire

Les tracés de routes sont la meilleure partie du générateur. Les lacets de montagne sont vraiment crédibles. Les défauts étaient aux raccords : extrémités rondes qui se chevauchaient, routes qui dépassaient d'autres routes de 2 à 3 m, classes de largeur qui se rejoignaient sans logique, trop de doublons presque parallèles.

La tentation était de réécrire le routage. Je ne l'ai pas fait. Les artefacts de jonction se corrigent dans la géométrie de rendu. Les changements structurels sont réservés aux vrais dépassements, aux largeurs et aux doublons. Et il y a un budget strict : l'étape des routes ne doit pas devenir nettement plus lente.

### La méta-leçon

Un agent IA à qui on demande de « corriger cette image » corrigera cette image. Il faut lui demander l'invariant.

[IMAGE : lacs avant/après, ou la ville alpine vide et sa version corrigée]

---

## Devlog #03 — La taxe du navigateur

Le générateur tourne en natif pour l'application desktop, et en WASM + WebGPU dans le navigateur. La version navigateur est la plus difficile. Quelques choses apprises à la dure.

### Shaders : le compilateur inline tout

Sous Windows, Chrome fait passer WebGPU par Dawn → Direct3D 12 → **DXC**. DXC inline chaque appel de fonction. Le temps de compilation ne suit donc pas la taille du source. Il suit la taille du code vivant *après inlining*.

Mon shader de carte satellite avait une fonction `surfaceNoise` à 8 coins déroulés, appelée depuis environ **160 endroits**. Chaque site d'appel est une copie complète. Le shader de carte vivant, une fois inliné, faisait environ **4,67 millions de caractères**.

Deuxième piège : des interrupteurs WGSL `override` mélangés à des valeurs d'exécution dans le même `if`. Le compilateur ne peut pas supprimer la branche morte, donc les deux sont compilées.

La correction est ennuyeuse. Transformer les appels répétés en boucles, avec les mêmes arguments dans le même ordre pour que l'arithmétique ne change pas. Garder les tests de variante purs. Faire de « l'eau naturelle » un uniform d'exécution, pour que deux rendus partagent un seul pipeline.

- Shader de carte inliné : 4,67 M → 1,40 M de caractères.
- Première vue Satellite : **47,8 s → 13,2 s** avec ce seul changement.
- En ajoutant le préchauffage au repos, les produits conservés et la préparation dans des workers, la première vue Satellite à froid prend maintenant **3,8 s**.

Pour comparer, le même chargement à froid sur ANGLE/D3D11 prenait 56 s, contre 1 à 6 s sur Vulkan. Si vous êtes sous Windows et que le premier chargement est atrocement lent, le backend graphique est le premier suspect.

### `hypot` a mangé un quart de mon CPU

En profilant la version WASM de l'étape urbaine, `f64::hypot` représentait **25 à 30 % du temps**, dans chaque thread worker.

La cause : wasm32 n'a pas de libm, donc `hypot` se compile vers l'implémentation *logicielle* de compiler-builtins, avec un FMA logiciel. En natif, c'est quelques instructions. En WASM, c'est une routine de bibliothèque lente et prudente, appelée des millions de fois sur des distances 2D.

La correction : remplacer le symbole faible `hypot` par `sqrt(x² + y²)`. C'est à moins d'1 ulp, et ça change très légèrement les villes. Je prends.

### Le WASM n'est pas automatiquement plus rapide

Du WASM mono-thread sur le thread principal n'est souvent pas plus rapide que l'ancien TypeScript. Donc la règle : l'application desktop utilise le Rust natif, et le profil web n'utilise la version WASM du Rust que là où elle mesure plus vite que le TS qu'elle remplace. Sinon, le web garde le TS.

Piège de profilage : les DevTools de Chrome ne savent pas brider le CPU des web workers. Pour simuler un portable, il faut épingler le navigateur sur N cœurs.

### Du JSON partout, jusqu'au jour où plus du tout

Le pack de noms de villes faisait 7,6 Mo de JSON, embarqué trois fois. Les étapes se passaient des arbres JSON. La nouvelle règle : les produits restent en mémoire native/WASM et ne passent côté JS que sous forme de tableaux typés binaires. Le JSON est réservé aux petits messages de contrôle.

Cette règle a été écrite avant qu'une ville d'un million d'habitants essaie de m'envoyer 557 Mo de JSON. C'est le #04.

[IMAGE : chronologie de compilation des shaders avant/après, ou capture du profileur avec hypot en tête]

---

## Devlog #04 — Une ville d'un million

L'objectif du jour : générer une ville de 1 000 000 d'habitants en quelques minutes, pas en quelques heures, et l'afficher dans le navigateur.

### Le point de départ

La chaîne urbaine (quartiers → parcelles → programme → emprises bâties) est presque linéaire jusqu'à 50 000 habitants, puis croît en N^1,4 :

- 10 000 : 2,3 s
- 100 000 : 33 s
- 250 000 : 2 min
- 1 000 000 : environ **9 minutes** pour le premier passage complet

### Pourquoi c'était lent

Le diagnostic : la chaîne est **en boucle ouverte**. Elle dimensionne la ville par la surface, génère *tout*, mesure le résultat avec les étapes aval complètes, puis corrige en rognant ou en générant à nouveau.

- La boucle de rognage pose une seule question : quels îlots ne reçoivent aucun bâtiment ? Pour y répondre, elle fait tourner le programme, le cadastre et l'allocation sur **toute la ville**, 7 à 8 fois. À 100 000, dessiner le plan prend 4 s et ces vérifications 24 s.
- Chaque ville est sur-générée. 20 à 25 % de ses quartiers sont découpés, parcellisés et alloués, puis rendus aux champs.
- Une ville est essentiellement séquentielle. 8 à 16 threads ne sont que 2,2 fois plus rapides qu'un seul.

### Ce qui a changé (en une journée, avec plusieurs vagues d'agents)

- **Une seule passe de mesure** au lieu de plusieurs. Le rognage utilise un cadastre de sondage léger, et le second rognage ne tourne que si les remparts ont réellement changé les îlots.
- **Chaque passe sur toute la ville rendue locale**, avec des index spatiaux, et parallélisée là où les éléments sont indépendants, avec une **sortie identique à l'octet près** :
  - nettoyage des terrains vacants : 30 s → 0,03 s à 1M ;
  - sources : 27 s → 0,2 s ;
  - ajustement des enceintes : 46 + 55 s → 5 + 5 s ;
  - contour de l'emprise : 26 s → 4,7 s.
- **Les emprises bâties envoyées en lignes typées en flux** au lieu d'arbres JSON : 125 s → 11,5 s à 1M, avec les mêmes octets.

### Les échecs

- **L'arrêt anticipé de la boucle de rognage.** C'est un gain évident, et je l'ai rejeté : sur une ville, il laissait une ruelle en cul-de-sac. Le rognage doit atteindre son point fixe exact, donc les passes sont devenues moins chères plutôt que moins nombreuses.
- **Découper les opérations sur les polygones.** Faire les superpositions de polygones contre un sous-ensemble des opérandes change la représentation des anneaux en aval. Ça a cassé des villes deux fois.
- **Plus de threads, plus lent.** La chaîne 1M prenait 294 s avec 22 threads et 161 s avec 8 threads épinglés. J'ai longtemps soupçonné mon code. C'était Windows : un processus sans fenêtre compte comme une tâche de fond (EcoQoS) et part sur les cœurs efficaces à basse fréquence. Le moteur désactive maintenant lui-même ce bridage. La chaîne 1M prend **104 s** sur tous les cœurs.

### Résultats

Suite de rejeu, 8 threads sur les cœurs performance :

- 100 000 : 32,5 s → 13,5 s
- 250 000 : 117 s → 33 s
- 1 000 000 : environ 9 min → 138 s (104 s sur tous les cœurs)

18 des 20 villes de test sont identiques à l'octet près à avant. Les 2 qui diffèrent sont des sites en pente que j'ai changés exprès.

### Puis le navigateur a dit non

Le moteur savait construire une ville d'un million, mais aucune page ne pouvait la recevoir. La réponse parcelles + programme faisait **557 Mo de JSON**. Un navigateur ne peut pas tenir une chaîne beaucoup plus grosse que 537 Mo, donc la page affichait simplement « Calcul refusé ». Et même sous la limite, les objets parsés n'auraient pas tenu dans les 4 Go d'un onglet.

Les parcelles ont donc eu un format binaire : 536 Mo de JSON → 151 Mo. Au-delà de 60 000 bâtiments, le détail des bâtiments (toits, neige, ombres) n'est préparé que pour la zone visible.

L'état ce soir : une ville d'un million se génère en moins de 2 minutes. Elle s'affiche dans la V2 environ **6 minutes après le clic**. La vue 3D meurt toujours.

### Pas fait

- **La croissance par accrétion** : ouvrir des quartiers jusqu'à ce que tout le monde soit logé, puis s'arrêter. La prévision de capacité qui devrait décider quand s'arrêter se trompe d'un facteur 3 à 4 (83 000 ménages prévus pour 25 000 nécessaires à 100 000 habitants). S'arrêter dessus couperait les villes au tiers de leur taille.
- Mon objectif était 15 à 30 s pour 1M. J'en suis à 104–138 s. Pas encore.

[IMAGE : la ville d'un million, vue entière + un quartier zoomé]

---

## Devlog #05 — La vue satellite, ou : tous les effets que j'ai ajoutés puis supprimés

De tous les styles de carte, la vue satellite est celle qui m'obsède. L'objectif est simple à énoncer : un monde médiéval qui ressemble à Google Earth. Pas de filtre peinture, pas de look carte de jeu.

S'en approcher a surtout consisté à supprimer des choses.

### De quoi elle est faite

C'est une seule pile de shaders, partagée par la 2D et la 3D. La couleur du sol vient de la pente, de la roche, de la zone climatique et du sol. Par-dessus viennent l'occlusion du ciel précalculée et la lumière d'horizon solaire sur le relief, l'occupation du sol (champs, vergers, terrasses), les forêts dessinées comme des couronnes volumétriques dans le shader, l'eau selon son régime, et un calendrier des saisons par zone climatique.

L'hiver a une seule source de vérité : la neige au sol pilote la glace des rivières, des lacs et de la mer. Avant ça, chaque type d'eau avait sa propre idée de l'hiver, et on obtenait des rivières gelées à côté de champs verts.

### La boucle de relecture

Pour juger les changements pendant que d'autres sessions continuaient de modifier le même arbre, j'ai figé un build par état. Un script photographie ensuite la même région procédurale de 12 km dans chaque zone climatique, avec des vues ciblées (ville, falaise, plaine, forêt, champ, rivière, côte, sommet) à des échelles et saisons fixes, plus quelques vues 3D. Un script de comparaison met l'avant et l'après côte à côte. Un passage sur 12 mondes prend environ 14 minutes.

La relecture du 13 novembre comptait 15 points. Voici ce qui en est sorti.

### Rejeté

- **Les champs.** Je les avais rendus colorés et variés : couleurs plus fortes, grilles déformées, vagues, bandes de cultures. Ma propre note de relecture : des caricatures. On est dans un monde médiéval. Les anciens champs, plus calmes, sont revenus.
- **Les effets de rivière.** Eaux blanches, barres de cascade et glace d'été sur les torrents. Tout a été retiré. Ce que je voulais vraiment, c'était du détail sur les berges : un peu de bruit, des plantes, des rochers, et de l'écume seulement là où un torrent heurte des rochers émergents.
- **Des cailloux au sol.** Partout, sauf peut-être dans les déserts. Retirés.
- **Des arbustes faits de trois sphères.** Hideux. Disparus.
- **Les motifs.** Tout motif de bruit reconnaissable à un zoom donné est un bug, jusqu'à l'échelle battlemap (environ 1 cm par pixel).
- **Les toits brillants.** Un fort contraste entre les pans de toit se lit comme du métal. Sous la neige, les faîtages doivent à peine se voir et la neige doit tenir par plaques.
- **Les villes vues de loin** ressemblaient à un plan de rues collé sur une photo. La correction : un rendu lointain dédié au bâti dans les presets satellite.

La règle que j'en ai tirée : **un effet qui se lit comme un effet est pire que pas d'effet.** D'abord restaurer l'ancien rendu, puis ajouter de petites variations. Et quand un effet est douteux, le supprimer plutôt que le régler.

### L'heureux accident

À un moment, j'ai demandé que le style parchemin reçoive le même soin que le satellite. Ce qui est revenu, c'était le rendu satellite repeint dans des tons de papier. Ce n'était pas ce que je voulais : le parchemin est une carte vectorielle, et son identité, c'est son médium. Mais c'était beau.

Il est donc resté, comme preset à part (Satellite-2), et le parchemin est redevenu une carte vectorielle.

### Ce qui n'était pas un problème de shader

Les rivières de montagne coulaient dans des canyons uniformes, comme tracées à la règle le long d'une crête. J'ai essayé de corriger ça dans le shader pendant un moment. La cause était en amont : l'hydrologie Rust incise le terrain à largeur constante. On ne rattrape pas une mauvaise géométrie à coups d'ombrage.

### L'addition

Tout ça, c'est du code de shader, et le #03 a montré ce que ça coûte à compiler. Chaque « petit effet », c'est plus de code inliné pour DXC. Une raison de plus pour supprimer.

[IMAGE : la même ville en satellite, avant/après la relecture du 13 novembre ; ou l'accident Satellite-2 à côté du parchemin]

---

## Devlog #06 — Pourquoi j'ai mis Neural Earth en veilleuse : les rivières multi-échelles, c'est l'enfer

Magna Urbis a un projet jumeau, Neural Earth : une planète entière à partir de relief neuronal, avec des niveaux d'affichage d'environ 60 km par pixel jusqu'à moins d'un mètre. Les modèles neuronaux produisent le terrain à trois résolutions : 7 680 m (grossier), 240 m (latent) et 30 m (décodé).

Le terrain, c'était la partie facile. Les rivières sont la raison pour laquelle Magna Urbis a eu l'essentiel de mon temps.

### Pourquoi les rivières cassent entre les échelles

Une rivière est un objet global. Son débit dépend de tout ce qui est en amont, parfois à des milliers de kilomètres. Un monde multi-échelle est paresseux : il ne calcule que les tuiles que vous regardez, dans l'ordre où la caméra les demande. Ces deux faits ne s'entendent pas.

- Le relief neuronal ne connaît pas le drainage. Rien ne garantit une vallée là où l'eau veut aller, ni une côte là où se trouve l'embouchure.
- Les tableaux de drainage d'une étape d'érosion intermédiaire ne peuvent pas devenir les rivières finales : le terrain change après eux.
- Les régions polaires utilisent une carte neuronale tournée, avec un autre bruit. La même graine donne un détail différent de chaque côté du 60e parallèle. La couture en longitude n'est pas périodique non plus.
- Et le résultat ne doit dépendre ni de l'ordre dans lequel les tuiles ont été demandées, ni de ce qu'il y a dans le cache.

### La conception qui en est sortie

- **Une autorité globale à l'échelle grossière.** Drainage, bassins et niveaux des lacs sont décidés une fois, à partir de la source grossière finale.
- **Un raffinement à 240 m avec des « portails » partagés.** Là où deux morceaux raffinés d'une même rivière se rejoignent, ils lisent le même point de passage figé : position, niveau d'eau, tangente. Aucun des deux côtés ne peut le décider seul.
- **La topologie s'arrête à 240 m.** À 30 m, plus de nouveau routage, seulement de la géométrie dans les corridors visibles. Les chenaux sous 240 m sont du détail, pas des bassins versants nouvellement découverts.
- **Un lac, un niveau, un champ de rive** à travers tous les morceaux. Un lac n'est jamais coupé parce qu'une tuile s'arrête.
- **Une comptabilité de l'eau** qui tombe juste : les bassins enfants s'additionnent au parent, et n'afficher que certaines régions ne peut pas changer le débit à l'exutoire.

### Ce que le vrai terrain neuronal a cassé

Les cas de test synthétiques passaient tous. Le premier vrai cas neuronal, avec 14 456 tronçons de rivière, non :

- Des niveaux de portail choisis indépendamment faisaient **remonter un fleuve de 33 m**.
- Un lac choisissait un exutoire dont l'aval revenait dans le même lac : **des cycles dans le graphe de drainage**.
- Un lac vers 595 m surélevait une autre unité dont la rivière était vers 113 m.
- Le masquage par cœur de tuile jetait **308 pixels mouillés sur 364** dans une tuile.
- En zoom lointain, la vue d'ensemble abandonnait les rivières raffinées et affichait l'aperçu grossier, décalé jusqu'à **12 km**.
- Sur une vraie tuile, garder la rivière en eau demandait des entailles jusqu'à **99,9 m** de profondeur. 8 cellules latérales dépassaient encore l'entaille permise et sont restées sèches, signalées explicitement.

Chacun de ces défauts a été corrigé. Des profils d'eau grossiers partagés ont remplacé les niveaux locaux, les exutoires sont choisis par rang topologique, et les absorbeurs ont une marge de niveau bornée. La performance a aussi demandé du travail : le raffinement du réseau est passé de 92 s à 21,7 s, et les noyaux d'un ancien paquet de 267,6 s à 22,5 s, avec une sortie identique au bit près.

Ça marche sur ce cas. Les lacs ne sont pas encore rendus. Les bancs, bras morts et défluents sont toujours sur la liste. Aucune campagne visuelle à l'échelle de la planète n'a jamais été faite.

### Pourquoi Magna Urbis a gagné

Magna Urbis travaille sur une région finie à la fois, de 500 m à 200 km, sur une seule grille. Un graphe de drainage, un bilan hydrique, Fill–Spill–Merge pour les lacs, des invariants pour les défauts (#02). C'est rapide, et on peut vraiment le vérifier.

Neural Earth demande que chacune de ces décisions reste cohérente à travers 18 niveaux d'affichage et deux cartes neuronales, quoi que fasse la caméra. C'est un projet de recherche à part entière. Je préfère livrer des villes posées sur des rivières crédibles qu'une planète dont les rivières sont presque justes.

Neural Earth n'est pas mort. Il réutilise déjà le rendu satellite de Magna Urbis, et le relief neuronal alimente les régions de Magna Urbis (#01). Mais pour l'instant, les rivières qui comptent sont celles qui traversent une ville.

[IMAGE : le cours de rivière de 66,9 km de Neural Earth à travers les niveaux de détail, ou une vue de debug des portails entre tuiles]
