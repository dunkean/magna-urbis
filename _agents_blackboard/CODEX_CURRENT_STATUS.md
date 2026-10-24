# État de référence — pack livré

Dernière instruction utilisateur : livrer vite un pack et laisser l’utilisateur commencer ses essais. Périmètre de livraison figé ; aucune nouvelle fonctionnalité à ajouter pendant cette réception. Banc visuel annulé ; aucun test du million.

## Livraison

- ZIP : `web/out/CityBench-preview-2026-10-24-Windows.zip`, 263977142 octets.
- SHA256 : `b3f74b47a1b0d137dbcf75ca246a7195973dddd93c7f6b05a3eb9cd02aa35cd0`.
- Décompresser puis `DEMARRER.cmd`. Accueil5187, moteur8797 : indépendants des serveurs de développement5173/8791.
- Trois cartes : plaine100k, baie romaine5000, île javanaise5000. Aucun calcul au démarrage ; l’utilisateur choisit la carte puis lance la génération.
- Node portable et moteur natif inclus, sources exactes et licences incluses ; aucune compilation nécessaire côté utilisateur.

## Version et validation

Code poussé sur `main/origin` : `f229884`. Le pack a été construit depuis une copie isolée : base0148f79 + les25 sources Core PURES testées, sans contributions externes encore en développement. La seule différence de source avec le commit final est une ligne blanche terminale d’un fichier test supprimée à l’index pour le contrôle de whitespace.

- Maisons :501tests produit verts,493anciens conservés+8nouveaux ; vrai protocole Web64demandes/33parents/40membres/7groupes, archives exactes, ACK/retry/release, extérieurs/intérieurs groupe ET SingleB15 natif corrigé.
- Core pur :332tests natifs verts ;79chaînes Web complètes et79recoupes, deux audits GEOS0défaut. Kraal35,669s et Mongol12,746s dans le cas fixe300habitants ; aucune preuve de capacité résidentielle déduite de ces temps.
- Assets DU PACK : Core29ca41a3… et Housescd085a12… ; voir composition.json pour hashes complets. Les assets du workspace partagé peuvent différer, ne pas confondre.
- Native pack :release réellement compilée depuis la copie,447sources stables, artefactCargo fresh=false, SHAexe f210fed50addcee76f2cd2a5937fbd5aaca3038312fd90a56c81cbbd564faf13.
- BundleCityBench compilé ; lanceur syntaxiquement valide ; transferts HTML/Wasm entiers vérifiés avec req.close simulé, sans serveur lancé. ZIP intègre et CRC vérifiés.
- Le démarrage natif HTTP et le rendu navigateur du pack restent à confirmer pendant les essais utilisateur. Aucun navigateur ni serveur lancé par Codex pour cette livraison.

## Limites et travaux laissés de côté

Déficit de logements encore ouvert : sur l’ancien cas Java100k,537000m²bruts pour1126000m²utiles demandés aux parents admis ; aucune mesure fiable d’habitants effectivement logés. Ne pas déclarer Java incompatible du seul fait de ce déficit.

Nouvelle politique de portée des profils : catalogue éditorial de7intentions préparé, UI isolée INACHEVÉE/non livrée. Trois profils locaux (maori-pa/inuit-camp/siberian-camp), quatre alternatives de tissu urbain déclarées ; aucun plafond historique ni garantie de capacité. Population conservée, choix utilisateur explicite. Prototype B06 hétérogène suspendu, aucune mutation produit.

## Workspace partagé ≠ pack livré

Des modifications externes actives restent dans Core (smooth_growth/dry_main, camp need/on_land, ports/fortification/réseaux/occupation/catalogue…). Elles ont été préservées et EXCLUES du pack. La suite du produit fusionné a donné326PASS/6FAIL/6ignored avec dérives de sources pendant compilation : `web/out/core25-merged-product-root-proof-v1/root-verification.json`. PNW300vide et témoins camp échoués ; pas de validation générale de ce workspace. Aucun test/golden n’a été supprimé pour masquer ces échecs.

Tous les correctifs purs validés ont été commités via l’index sans écraser les contributions externes. Ne pas reset/stash/clean ces changements ni les documents utilisateur MATERIALS_REVIEW.md et RENDER_SURFACE_DESIGN.md.

Preuves et composition : `web/out/citybench-preview-20261024/proof/`, `composition.json`, `manifest.json`. Historique antérieur : CODEX_CONTINUATION_LATEST.md et notes de lots.

## Correctif limité de portabilité Windows

Le moteur initial importe VCRUNTIME140.dll. Correctif optionnel livré : `web/out/CityBench-correctif-runtime-Windows.zip`, exe2bc9ceaa… recompilé avec CRT statique, mêmes447sources. Inspection PE confirme uniquement5DLL Windows natives, aucuneVCRUNTIME/MSVCP/UCRT externe. Source/fonctions/cartes inchangées ; ZIPinitial strictement préservé. Remplacer seulement bin/magna-urbis-local.exe après Ctrl+C ; aucune installation nécessaire. Aucun serveur ni nouvelle génération lancé pour ce correctif.

## Dernier état — passe optimisation livrée

Voir CODEX_OPTIMIZATION_PASS.md : a05e5c4 poussé,63+502testsverts,transport64×42microbench/Native0à11%petitscas,plans etarchivesconservés. Accueil5187→versionoptimisée /optimized/ etNative8801 ;ancien8800préservé. La suite attend explicitement la dernière passe Opus. Pas de nouveau chantier ni demillion/captures.


## Dernier correctif — ville conservée, recherche explicite

0d52387 poussé,5chemins seulement (gridsettlements/UI/helper/tests/fixture). CityBench conserve les coordonnées de la carte ou de l’URL lors de changements pop/culture/terrainReady/fallback ; seul bouton explicite recherche/revalide, aucun centre fabriqué. Les anciens scores/rayon/archétype sont marqués nonréévalués ; routes retenues à ouverture inchangée. Invalidationid immédiate avantdebounce évite une génération surancienne metadata/réponsepérimée.

32testsUI+TSC verts danscopieisolée ;3tests natifsbit-exacts +7settlements/roads verts ; ancien/nouveauWAsm égaux surpetitcas avecpinexact. deck_height256 :51,28→1,36ms surmicrobenchcomposant, pas tempsdeplacementcomplet. VitefinaletHTTPpages/JS/index200 vérifiés.

UIactiveà5187accueil→/fixed-position/citybench.html, moteur EXISTANT8801. Nouveau CoreWAsm4b391cdc… est dansbundle (profilsWeb), House6c7préservé. Nativeoptimisé01656d25… compiléCRTstatique mais sa commande de démarrage/mise enligne a été REFUSÉE par contrôleautomatique «blocked by policy», sans motifplusprécis. Aucune tentative de contournement ; aucun nouveau serveur8802 créé. Le correctif de déclenchement UI est bien actif avec8801, mais ce moteur local n’a pas la nouvelle propagation. Exécutableprêt sousplacement-r1/bin pourintégrationaprèsOpus. ZIPinitialpréservé, changementsCoreurbanexternesintacts.
