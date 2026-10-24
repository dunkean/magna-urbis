# Maisons — activation Single isolée, livraison V1

Gel : `web/out/houses-single-incumbent-growth-activation-workspace/implementation-freeze-activation-v1.json`, SHA256 `7fd4fd6cb4b0737ef5b4493a5aa0d8e1b976859aeb519ea4dc0e3a284b33f072`.

233 inputs, 6 deltas dont 5 fichiers promouvables, 109 inclusions littérales présentes. Aucune mutation produit, aucun Cargo/build/test/natif/serveur/browser exécuté par l’auteur. Les 229 entrées sources courantes correspondent exactement au snapshot ; catalogue/registres/contrats et ajouts Opus/fonctions préservés. Le lock courant33fbd15… pourra être normalisé par root, à tracer séparément.

`finish` est strictement inchangé par rapport au pilote validé (SHA5566ac316994f84871bb89eb61313c418cd6a2fc6e0190e64cb6b9057e91c6a4). Seuls le chargement du module et l’appel de fin deviennent non-test ; `enabled()` vaut true en bibliothèque/CLI. Les contrôles Mode A/B et compteurs de tests restent disponibles ; défaut de tests legacy false explicite. Le véritable chemin release exige donc sa comparaison complète, pas seulement les tests unitaires.

Fichiers : `plans.rs`, `single_incumbent_growth.rs`, `single_incumbent_growth_tests.rs` et les deux fixtures C1358/cohorte. Dans la cohorte, seules42 chaînes inertes input_path/output_path sont supprimées textuellement et conservées en preuve : aucun jeton numérique/native/requête changé. Tests source exacts. Aucun harness complet/manifest de chemins web/out dans le delta produit. Le Cargo.toml réduit de copie n’est jamais promouvable.

Livraison : `PROPOSAL.md` contient les commandes absolues et les limites ; `source-freeze.json`, `before-manifest.json`, `base-originals/`, `activation-copy.patch`, `promotable.patch`, `function-identity.json`, `compilation-dependencies.json`. `proof/` conserve le harness complet/manifeste original, les42 chemins inertes, l’agrégation des non-gains et le script release.

## Validation root à centraliser

Depuis le rust de la copie :

```powershell
cargo test -p magna-urbis-houses --lib incumbent_growth_ -- --nocapture
cargo test -p magna-urbis-houses --lib
cargo build -p magna-urbis-houses --example plan_replay --release
```

Six tests normaux hérités : gardes/masse suffisante, minima natifs, ancrage/angle, C1358, cohorte21, batch cumulatif15. Le manifeste donne les noms complets. Puis root copie l’exe release hors target, relève son SHA et lance `proof/compare_release.py --cli ... --cli-sha256 ... --input-dir ... --audited-proof ... --out ...` dans un dossier neuf. Paramètres exacts dans PROPOSAL.

Le script vérifie les empreintes des124 requêtes, 124 new.json et résultats d’audit gelés avant exécution, conserve toutes les sorties release/stdout/stderr et exige identité totale. Il recontrôle les sources, références et exe après. Un mismatch interdit de réutiliser l’audit géométrique ou de promouvoir ; si124/124 sont exacts, les mêmes archives/géométries/portes/rapports bénéficient des audits C déjà passés. Aucun grand audit natif nouveau n’est annoncé ni exécuté ici.

## Lecture des non-gains existants

La preuve C complète existante donne7921 demandes, 6225 admis conservés, 87 remplacements et +2564,4496m² (+0,584345 %), entrées3395→3482, zéro collision/échec d’assise/perte,92 changements réellement réadmis. Le nouveau total441423,063m² couvre26,860 % du souhait de masse archivé1643406,5m² ; ce souhait n’est pas une capacité démographique requise.

Sur1015 éligibles,973 reconstructions/967 admissions produisent87 gains (8,57 %). Les928 éligibles sans remplacement :880 refus de connexion portail→frontage,27 sans rectangle plus grand testé à l’ancrage fixe,10 sans gain strict,6 préparations natives refusées,5 ancrages non certifiés par les contrôles nécessaires. Hors éligibilité :2502 déjà à90 % ou plus,2425 sans capacité existante d’axes sous-nominaux,283 hors scope. Le dernier refus rapide observé n’est pas une preuve globale et ne remplace pas le motif final natif.

C1358 reste12,475/617,9m², contre4,060 avant ; défaut largement ouvert. Ménages logés inconnus, aucune capacité attribuée, seuils physiques/cibles/population inchangés. Le prochain sujet utile est l’accès/composition réalisable sur vrais cas ; aucun nouveau refactoring lancé dans cette tranche. Pas de promesse de vitesse issue des timings A/B.
