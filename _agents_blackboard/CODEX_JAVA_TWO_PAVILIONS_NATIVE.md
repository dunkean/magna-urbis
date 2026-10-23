# Pilote natif javanais — deux pavillons sur le lot C4792

23 octobre 2026. **Deux corps sont admis, mais la composition n’est pas validée : les portails ne sont pas conservés et les raccords verticaux au chemin commun restent à construire.** Aucun autre lot ni ajustement opportuniste testé.

CLI production figé `web/out/houses-nominal-terrain-production-proof/plan_replay.exe`, SHA `ad10d1f7f41dcf407d4832039da147586d460b1d4e8cf201b3379cfb35e23077`. Sorties distinctes dans `web/out/java-two-pavilions-native-proof/`. Fixture dérivée décrite dans `CODEX_JAVA_COMPOUND_CONTRACT_PILOT.md` ; cour et chemin sont des **propositions privées internes au lot**, jamais présentés comme des droits communs déjà fournis par la source.

## Résultat du seul lot

| Demande | Source retenue | Cible d’emprise | Corps admis | Sol bâti |
|---|---|---:|---:|---:|
| Parent original | B06 Joglo/default | 236,8 m² | 236,7960 m² | 174,04699 m |
| Part0 | B06 Joglo/default | 179,3 m² | 196,0000 m² | 174,04549 m |
| Part1 | B14 Kampung/default | 57,5 m² | 56,0121 m² | 175,08557 m |

Les deux parts totalisent **252,0121 m²**, soit +15,2161 m² par rapport au parent, pour une cible totale inchangée236,8 m². Le B06 reste à son minimum nominal14×14 m (+9,3 % de sa cible) ; le B14 mesure6,397×8,756 m (−2,6 %). Un niveau et un corps par requête ; palette javanaise conservée, toits HIP/GABLE respectifs. Ce dépassement d’emprise n’est pas un gain de capacité démontré.

Le parent a été rejoué avec son contexte exact : zéro voisin enrichi et zéro occupation antérieure intersectant sa bbox dans le lot natif074/position56. Son objet résultat est **identique au JSON archivé**, champs et nombres compris. Les enfants reprennent les51 occupations antérieures sous forme de voisins ; `plan_batch` accumule en plus la première part avant la seconde. Le parent remplacé n’est jamais un voisin. Les seeds dérivées et les sous-droits sont ceux de la fixture publiée, inchangés.

## Droits, appuis et entrées

GEOS ne trouve aucune sortie des droits corps/toit/occupation, aucune collision entre les deux parts ou avec le contexte, aucun empiètement des toits/occupations sur la cour de47,6043 m² ou le chemin de40,3653 m².

Contrôle indépendant sur les corps réels Ground, un niveau, sans feature d’appui extérieure exportée :

| Corps | Dénivelé sous le corps | Pente maximale | Borne de dénivelé |
|---|---:|---:|---:|
| Parent B06 | 0,73897 m | 5,2344° | 0,75 m |
| Part0 B06 | 0,68322 m | 5,1433° | 0,75 m |
| Part1 B14 | 0,73111 m | 5,4662° | 0,75 m |

Les altitudes calculées concordent avec `ground_z_m` à moins de10⁻⁹ m. Aucune assise marquée « prepared » n’est exportée ici ; ce contrôle de corps n’est pas une certification d’éléments structurels invisibles. Les **trois réalisations extérieures passent** séparément. Les **trois réalisations intérieures refusent** : `Native interior entrance differs from the retained planning connection. City plan preserved; detailed site admission is required.` Aucun portail natif conservé dans les archives. B14 précise également l’échec de connexion du portail natif au terminus collectif ; ses pose/source/dimensions restent inchangées.

Au contact du connecteur de planification avec chaque segment collectif (projection exacte sur le segment, raster bilinéaire source) :

| Part | Terrain naturel au contact | Sol bâti au-dessus du terrain |
|---|---:|---:|
| B06, terminal0 | 173,38334 m | **0,66215 m** |
| B14, terminal1 | 174,89626 m | **0,18931 m** |

Les sols bâtis diffèrent de **1,04008 m** entre pavillons. Le chemin proposé suit un terrain de173,17886 à175,17251 m ; aucune surface marchable 3D, rampe ou marche reliant les portes n’est fournie. Ces écarts caractérisent le raccord manquant, sans inventer sa solution ni supposer que le connecteur proxy est une porte réelle. Le parent avait déjà un raccord routier non certifié, avec0,27925 m d’écart terrain/sol au contact.

## Conclusion de raccord

Le contrat existant permet bien **deux maisons indépendantes avec deux fondations**, une cour et un chemin préservés en2D par subdivision des droits. Il ne suffit pas à livrer un Compound praticable : il manque les portails réels et la circulation commune raccordée en altitude. Opus doit conserver le groupe, les budgets répartis et les surfaces communes ; la prochaine preuve doit traiter ces raccords sur **ce même témoin**. Ni deux ménages, ni capacité habitante, ni intérieur fonctionnel ne sont déduits de ces deux admissions.

Preuves : `audit.json`, `parent-/two-pavilions-{requests,plans,details}.json`, stdout/stderr et `manifest.json`. Rejeu : `web/scripts/java_two_pavilions_native_proof.py` ; audit hors natif : `web/scripts/java_two_pavilions_audit.py`. Tolérances indépendantes de rapport : aire10⁻⁴ m², terrain10⁻⁶ m/degré ; aucun garde natif modifié. Pas de conclusion de coût sur ces deux appels isolés. Diagnostic et fichiers exacts transmis à morphology pour sa revue du repli d’entrée, sans nouveau calcul.
