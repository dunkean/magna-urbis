# B06 C1358 — essai borné sans gain

Root a exécuté la copie V2 isolée : cinq tests verts, zéro échec/ignoré, sortie0. Preuves : [pilot.json](../web/out/b06-source-tail-v2-proof/pilot.json), [tests.log](../web/out/b06-source-tail-v2-proof/tests.log), [result.json](../web/out/b06-source-tail-v2-proof/result.json). Aucun test natif exécuté par l’auteur ; aucune promotion de ce pilote.

Le journal réel conserve la palette initiale B15 → B06 → B14 et choisit une seule source jusque-là non tentée, B14. Cinq admissions additionnelles refusent cette proposition : marche requise **1.439 m**, maximum **0.750 m** ; pente raster **11.756°**, sous le maximum **12°**. L’échec porte donc sur la marche, pas sur un dépassement de pente. Aucun finaliseur additionnel n’a été engagé.

Le résultat ancien finalisé est intégralement conservé : les objets `old_building` et `new_building` exportés sont égaux. Emprise réelle **4.060225002401684 m²** pour **617.9 m²** demandés ; déficit **613.8397749975983 m²**. Le programme reste nettement partiel, avec composition non préférée, entrée native non certifiée et trois ménages demandés sans capacité logée évaluée.

Cet essai négatif ne prouve pas l’impossibilité de toutes les poses. Il montre que simplement démasquer B14 ne répare pas ce cas ; les plafonds actuels B14/B15 de330/416m² seraient de toute façon insuffisants pour556.11m² nécessaires à90 % de cible. La prochaine correction doit traiter l’articulation programme, terrain, dimensions constructibles et éventuelle composition explicitement autorisée, en préservant les admissions valides. Aucun minimum historique arbitraire, assouplissement d’assise ou crédit de ménages n’est justifié par ce résultat.

La copie V2 et son gel restent intacts. Seul `Cargo.lock` a été normalisé par le build central : `33fbd15d54cc1c86dfbbcecd375db481cf88e4a6ae2e3da33d1898b3c808878c` → `e039ed141736c98b7bee28db13742d245a6b1920dfdf0558cc0048169956cfcf`. Les224 entrées et cette variation sont suivies dans la preuve root. Les champs de synthèse `verification.json` relatifs au pilote sont nuls ; les valeurs ci-dessus proviennent du véritable `pilot.json.route`.
