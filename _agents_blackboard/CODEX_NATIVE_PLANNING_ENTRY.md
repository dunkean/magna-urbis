# Entrées natives des plans ordinaires — contact oblique validé, deux détours ouverts

**Preuve ciblée figée, clôture générale en attente.** Sur les mêmes 128 demandes : **125 admissions / 3 refus**, aucune perte ni changement de recette, variante ou aire. Parmi les 101 bandes éligibles à la préparation native, **79 entrées retenues dès la première pose**, 22 différées ; 24 autres plans restent hors périmètre. Le détail réduit donne **8/8 extérieurs et 6/8 intérieurs**, contre 0/8 intérieurs avant la correction des entrées. Aucune capacité d'habitants n'est déduite de ces résultats.

## Deux défauts natifs corrigés

`candidate_filtered` parcourait aussi le contour externe du lot puis préférait les coordonnées y les plus hautes. Son rectangle pouvait toucher l'extérieur et l'intérieur alors que ces deux domaines étaient du même côté de l'axe. Exemple 2471 : corps terminé à y=10,001, mais `opening` sur lot.max_y=10,328. La bande découpait bien le mur plus loin ; l'axe publié ne désignait pas la porte physique. La garde commune exige maintenant deux paliers sur des côtés opposés de l'ouverture, avec le seuil d'aire existant.

Une fois l'axe ramené au mur, le passage symétrique réservait encore `gap + 0,2 m` à l'extérieur, alors que le gap était l'épaisseur du mur vers l'intérieur. Le constructeur natif forme désormais un palier de 0,2 m côté source et `gap + 0,2 m` côté cible. Le sens provient des paliers réels. Aire, interdits, contraintes du candidat et côtés opposés sont contrôlés sur le passage final. Le symétrique reste un repli uniquement s'il satisfait lui-même tous ces contrôles. Aucun passage n'est clippé au cadastre.

La réduction de largeur des portes profilées conserve les profondeurs signées. Le même helper `profiled_passage` sert à filtrer les candidats et à matérialiser la porte, avec garde finale défensive. Cela concerne aussi les portes supplémentaires et les portes de palier d'escalier. Tests causaux : faux bord de lot, trois gaps résiduels, enceinte de 0,8 m, sens inversés, obstacle interdit, profil évasé et rejeu détaillé de B02.

## Contrat de planification et limites

L'amélioration intervient **après** le choix final du programme : même source, dimensions, étages et géométrie. Une unité structurelle prépare les entrées corps/site et les murs réellement découpés, sans pièces ni maillage de toit. Le plan archive l'entrée du corps ; le raccord public consomme l'entrée du site. Les passages restent soumis au cadastre, réserves, voisinage et structures ; ils ne deviennent pas une assise nivelée. L'échec conserve le plan précédent et un diagnostic explicite. Le garde de rejeu intérieur demeure actif.

Intérieurs récupérés : indices 1491, 2471, 2665, **3537**, 11307 et 12272. Le contact oblique est corrigé ; deux cas restent différés :

- **3537 / `61ca50ea7c5550ac`, corrigé** : l'ancien contact à 0,400 m du bout de rue demandait un cap oblique de 0,402014735 m ; le rectangle alternatif dépassait de 0,00802850 m². Le solveur scalaire retient un contact à 0,402197863736 m de cette extrémité, puis vérifie le cap réel en coordonnées monde. Aucun seuil élargi ; ancien raccord conservé d'abord s'il fonctionne.
- **11111 / `e099cf700f812cc3`** : porte arrière et rue devant ; le raccord direct traverse des corps.
- **11976 / `53c6fbc1ac486b3b`** : porte arrière et rues latérale/devant ; choix de porte et raccord à segment unique limitants. Aucune impossibilité d'un chemin avec détour n'est démontrée.

Le probe isolé des autres portails déjà coupés donne **deux portails par cas, aucun des quatre raccords directs admis**, à source et pose inchangées (`web/out/native-entry-alternatives-probe.log`). Cette voie n'est pas activée. Pour 11976, un chemin à un coude de largeur 0,8 m a une preuve géométrique hors ligne sans débord de droits, corps ou poteaux/murs mitoyens ; cela ne constitue pas une certification native ni un rejeu intérieur réussi. Un second prototype uniquement `cfg(test)` construit maintenant un coude unique depuis les vraies porte/rue et la droite d'appui des obstacles, avec joint pleine largeur ; son exécution reste en attente. Pour 11111, le détour examiné intersecte encore un poteau de galerie sur 0,03065475 m².

## Preuves et versions

Phase finale contact `web/out/strip-initial-budget-proof/after-native-entry-contact/` : comparaison d'entrées, fondations, plans et métriques. Audit indépendant : zéro dépassement de droits sur les 125 plans, zéro violation du terrain sur les 101 assises natives. Les 79 améliorations d'entrée réussissent à la première pose de leur plan final courant. Mesure répétée du corpus initial : médiane **345 → 475 ms**, aucun gain de vitesse revendiqué.

Lot détaillé : `web/out/native-entry-contact-cli-proof/eight-{plans,details}.json`. Binaire figé SHA256 `73e1656a05f573fa56f9a08f82c1479ec43ac5109930e76f2d8cb7148cc7760a`. Requêtes SHA256 `4fb8c3e55cf52edfcbca524a98854429b152e3151cbbc60197a13941b77c253d`.

Corpus secondaire Rynek : **111/128 admissions inchangées**, mêmes recettes et aires, **65/83 entrées natives** (64 à la première pose, une à la deuxième), 18 différées. Cinq alternances donnent une médiane **392 → 478 ms** ; replis inchangés (trois Strip et deux famille simple). Droits 111/111 et assises 83/83 conformes. Six poses changent ; trois pools de surfaces locales présentent seulement des écarts numériques de 3,41e−13 à 1,41e−10 m, donc aucune identité octet globale des architectures locales n'est revendiquée. Chaque phase est déterministe octet sur ses cinq exécutions. Voir `CODEX_NATIVE_ENTRY_SECONDARY.md` et `web/out/native-entry-secondary-proof/replay/`. Aucun intérieur exécuté sur ce second corpus.

Nouvelles identités : **`houses-3`**, **`architectural-plans-2`**. Les anciennes archives/certifications ne doivent pas être présentées comme celles de ce constructeur corrigé. Une optimisation équivalente de l'ordre d'évaluation des portes est en cours ailleurs et devra être validée séparément ; aucun TODO général fermé, aucun serveur lancé.
