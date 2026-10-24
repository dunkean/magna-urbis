# Runner parent V4 — correctif TypeScript minimal

`web/out/responsable5-parent-capture-proposal-v4/DELIVERY.md` : seul l’import multiligne du test est remis sur une ligne pour sa directive existante. V3 intacte ; runner, politique, gardes, gates, deux fixtures et 36 cas inchangés.

Root a réellement passé les 36 tests V3 depuis `candidate/web` et les deux checks syntaxe ; échec initial de sélection et deux diagnostics TypeScript V3 conservés. V4 n’a pas été exécutée par l’auteur. Les commandes documentent maintenant le bon cwd, sans `--root` depuis le dépôt.

Promotion autorisée ensuite par root, après réception UI67 : les trois seuls fichiers capture sont maintenant appliqués byte-exacts à V4. Reçu `web/out/responsable5-parent-capture-promotion-v4/after.json` : 1 470 fichiers protégés sans dérive, deux fixtures UI vérifiées sans recopie. Trace avant/proposé/après et patch conservés. Root V4 : 36 tests, TypeScript et syntaxe verts ; UI67 produit séparément 145 tests/TypeScript/bundle verts. Aucun test, build, requête, serveur, native, navigateur ou capture exécuté par l’auteur pendant la promotion. Créneau libéré.
