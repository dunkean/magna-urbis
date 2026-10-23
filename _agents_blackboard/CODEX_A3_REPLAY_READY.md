# Audit A3 avant/après prêt — aucune exécution native

Le script existant `web/scripts/city_visual_audit.mjs` possède maintenant `--reference`. Cette option reprend **les requêtes quartiers, toutes les caméras et le snapshot du peintre** de `city-visual-audit/`, puis génère les nouvelles données dans un dossier distinct. Elle ne recompile pas le peintre et refuse d'écraser le dossier de référence. Les quartiers sont recalculés avec les sites/routes figés ; parcelles et buildingSites sont recalculés avec la même graine, comme lors de l'audit initial. Aucun résultat urbain ancien n'est injecté à la place d'une nouvelle génération.

Vérifié sans runtime : Node 24.10, Python 3.13.9, Shapely 2.1.2, imports Playwright/tsx/esbuild depuis `web/`, Edge présent, `node --check` réussi. Les requêtes originales et leurs copies frozen ont les mêmes SHA-256 : `28567de5…7b3d7ab` (01-l), `25dedb26…1e8694` (04). Les deux décors, snapshots et outils Python sont présents. Aucun navigateur, appel natif ni build lancé pendant cette préparation.

## Une commande après A3 LANDED et désignation du runtime

Depuis la racine du dépôt, sous PowerShell 7 ; remplacer seulement l'URL si le runtime A3 coordonné utilise un autre port. Ce bloc n'installe rien et ne gère aucun serveur. Le dossier de sortie doit être neuf.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $auditRepo = (Get-Location).Path
    $auditReference = Join-Path $auditRepo '_agents_blackboard/city-visual-audit'
    $auditAfter = Join-Path $auditRepo '_agents_blackboard/city-visual-audit-a3'
    $auditRuntime = 'http://127.0.0.1:8810'
    if (Test-Path -LiteralPath $auditAfter) { throw 'Choisir un dossier après neuf ; conserver les résultats existants.' }
    Push-Location (Join-Path $auditRepo 'web')
    try {
        node scripts/city_visual_audit.mjs --server $auditRuntime --reference $auditReference --out $auditAfter
        if ($LASTEXITCODE -ne 0) { throw 'Replay natif ou capture en échec ; ne pas publier de verdict.' }
    } finally {
        Pop-Location
    }
    foreach ($auditTool in @('measure.py', 'shapes.py')) {
        $auditToolCopy = Join-Path $auditAfter $auditTool
        Copy-Item -LiteralPath (Join-Path $auditReference $auditTool) -Destination $auditToolCopy
        python $auditToolCopy
        if ($LASTEXITCODE -ne 0) { throw "Métriques en échec : $auditTool" }
    }
}
```

Comparer ensuite les `metrics.json`, `shape-metrics.json` et **9 PNG** des deux dossiers : 01-l au centre `(8000,8000)` à 0,5 m/px, paire disproportionnée `(7290,718;7857,328)` à 0,15, cour fine `(8803,639;8132,234)` à 0,12 ; 04 au centre `(2640,2669)` à 0,5. Les deux overviews reprennent désormais leurs caméras anciennes exactes, sans nouveau fit. Le snapshot du peintre reste identique ; son hash, celui de la requête et le statut natif sont enregistrés dans chaque `source.json`. Les trois nouvelles images auxiliaires UI de cour sont à **0,125**, plafond réel de CityBench, et ne doivent pas être confondues avec cet audit canvas historique à 0,12.

`measure.py` calcule les quantiles surface/front/profondeur/aspect, résiduels, couverture et validité, par zone et distance au centre ; `shapes.py` relève les paires de fronts similaires avec aire disproportionnée, angles aigus et distances minimales entre bord extérieur et patios. Ces heuristiques doivent être examinées avec les captures et les capacités des styles ; elles ne certifient ni toutes les largeurs locales, ni pente/accessibilité, ni fluidité UI. **Le pipeline ne réalise aucune maison détaillée** : il mesure quartiers, parcelles et silhouettes natives, sur fond uni avec le peintre CityBench figé. Le parcours architecture progressif/détaillé 100k reste une validation distincte.

## Premier contrôle moins coûteux : portée limitée

Les deux blocs témoins conservés sont **540 et 1505**, dans `01-l/focused-cases.json`. La source Opus contient déjà le probe ignoré `urban::parcels::tests::probe_block` (`A3_LAYOUT`, `A3_BLOCK`) ; aucun nouveau test ni build n'a été lancé. Ce probe peut illustrer localement les nouvelles coupes et leurs minima, **pas prouver un replay exact de la ville** : réduire `layout.blocks` renumérote les indices du programme et change la surface totale utilisée par `parcels/pressure.rs::for_layout`, donc potentiellement la pression d'occupation. Le seed local dépend bien de l'identité géométrique du bloc, mais cela ne suffit pas à conserver tout son contexte.

Pour vérifier seulement la correction des silhouettes sur les lots anciens, on peut conserver le layout/partition complets et filtrer les allocations de programme sur les parcelles témoins avant `buildingSites` (sans recalculer le programme). Cela évite quartiers/parcelles et la plupart des silhouettes, mais ne teste ni la nouvelle coupe cadastrale, ni l'équilibre global, ni les changements du programme. Aucun raccourci n'a été ajouté : la commande complète ci-dessus reste la référence d'acceptation, et attend A3 LANDED.
