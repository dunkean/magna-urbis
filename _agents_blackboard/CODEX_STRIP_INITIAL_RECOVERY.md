# Régression après dimensionnement initial Strip — diagnostic ciblé

Deux pertes du même échantillon figé de128, étudiées sans nouveau rejeu natif. Artefact : `web/out/strip-initial-budget-proof/strip-regression-analysis.json`. Les deux nouveaux succès sont conservés dans la fixture de régression, avec les deux pertes : `rust/crates/houses/tests/fixtures/strip_initial_recovery.json` (indices source1586,3537,10334,11015, demandes strictement identiques).

| Ancienne admission |3537, B02/default|11015, B02/stone_walls|
|---|---:|---:|
|Dimensions nominales avant adaptation|12 ×24,11484m|11,89332 ×12,44631m|
|Corps réellement retenu|5,659 ×15,652m|3,570 ×4,830m|
|Aire bâtie/cible|88,57467 /257,9m²|17,24310 /90,8m²|
|Domaine de fondation retenu|136,43893m²|31,95660m²|
|Dénivelé du domaine complet|0,737280m|0,391362m|
|Dénivelé du corps seul, informatif|0,581536m|0,256363m|
|Pente raster maximale domaine complet|2,28083°|4,53438°|

Le calcul hors runtime reproduit les intersections cellules/polygones et les extrema bilinéaires sur leurs arêtes. Les cotes hautes concordent avec les plans natifs sauvegardés à moins de4×10⁻¹⁰m. Le domaine contrôlé par `visual_with_front_access` est l'union des niveaux de corps, cours, chemins internes et features. Ce n'est ni la parcelle entière ni le toit. Ne pas réduire ce domaine pour sauver une admission ;3537 est réellement très proche de sa limite0,75m.

Les deux admissions étaient issues de **Constrained morphology**, et non d'une pose native directe.3537 conservait sa pose adaptée après épuisement de2 poses de front supplémentaires ;11015 avait retrouvé le front à0,41m par déplacement rigide du plan adapté. Les deux passes de budget suivantes avaient0 candidats admis et conservaient donc ces plans partiels.

## Cause et raccord minimal

`resolve_architecture_for_site` écrase `parameters.width_m/depth_m` avec le résultat de `strip_programme_budget::solve`. `morphology::synthesize` réutilise ces dimensions comme objectif de ses candidats. Les mêmes seeds produisent donc d'autres dimensions et positions. La synthèse s'arrête au premier candidat géométriquement contenu ; le contrôle de terrain arrive ensuite dans `visual`. Un rejet de terrain ne reprend pas la recherche morphologique suivante. L'ancien chemin de réussite a ainsi disparu, malgré la conservation du RNG.

Les refus finaux enregistrent0,959m et0,845m de fondation. Ce sont les **premiers échecs terrain globaux de la shortlist**, sans recette/dimensions/pose enregistrées. Le dernier diagnostic « authored layout unsupported » appartient aussi au dernier candidat. Ne pas les attribuer au B02 précédent ni déclarer toute la parcelle impossible.

Raccord retenu par root : après échec total de la nouvelle initialisation, un seul second passage du parcours historique, avec cible Strip initiale absente et mêmes requête, seed, style order, voisins et gardes. Les succès nouveaux retournent avant cette reprise. Le passage historique doit inclure l'adaptation et ses poses de front, pas uniquement trois poses du modèle natif. Il ne doit ni supprimer le programme de la demande, ni relancer récursivement le chemin avec budget. Le résultat reste un budget partiel si sa cible n'est pas atteinte.

Une optimisation ultérieure peut sauver les deux scalaires avant `solve` et reconstruire uniquement après l'échec ; Java Sources confirme qu'aucun nouveau tirage n'est nécessaire. La reprise complète est plus simple pour conserver exactement l'ordre historique de la shortlist. Le rétablissement effectif des deux pertes, et le maintien des gains, restent à établir par la fixture ; ce diagnostic n'affirme pas encore120 admissions.

Indicateur causal proposé : compter `initial_strip_applied`, `historical_recovery_invoked`, `historical_recovery_accepted`, et les poses physiques réellement exécutées pendant **cette reprise** séparément du budget après admission. Le temps global seul ne permet pas d'attribuer un gain. Sur le chemin qui réussit d'emblée : zéro construction et zéro pose de reprise. Sur un échec : au plus un parcours historique complet, pas une reprise à chaque pose ou variante.
