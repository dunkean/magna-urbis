# Frontière WASM maisons

Bindings groupés du [moteur de maisons](../houses/README.md), sans dépendance au
terrain ou au rendu. Le paquet généré est dans `rust/pkg/houses/`. Le guide du
banc, ses modes, les replays et les exports sont dans le README du moteur.

Trois exports renvoient une chaîne JSON avec une enveloppe
`{ok:true,data}` ou `{ok:false,error:{code,field,message}}` :

- `catalogue_json()` fournit le catalogue et l'inventaire des sources.
- `preflight_json(config_json)` valide les réglages, filtre les recettes et
  estime les budgets avant la géométrie.
- `generate_houses_json(config_json)` effectue ce préflight puis génère un lot.

La configuration et la scène utilisent `schema_version: "2"` ; l'inventaire
des sources a son propre format versionné. Une erreur attendue utilise une
catégorie explicite dans l'enveloppe. Un piège WASM reste une erreur fatale
distincte. L'entrée est limitée à 32 Kio et la réponse à 64 Mio. La validation
et les règles géométriques appartiennent au moteur natif, pas aux bindings.

`HouseConfig.workshop`, absent pour l'Atlas, identifie un preset libre et ses
dimensions/matériaux/supports optionnels. L'atelier utilise les mêmes appels et
enveloppes. `catalogue.workshop_presets` reste séparé de ses 32 packs culturels.

Depuis `web/` :

```sh
npm run wasm:houses    # Paquet WASM de développement uniquement
npm run dev:houses     # Compile, surveille Rust et ouvre Vite
npm run build:houses   # WASM release et HTML autonome
npm run check:houses   # Vérifications natives, WASM et contrat
```

La page de développement est `/housebench.html`. Le build est
`rust/out/houses/housebench.html`, avec le WASM embarqué et sans requête réseau
nécessaire pour générer hors ligne. L'interface transfère une configuration
au Worker et reçoit un lot complet ; des tickets écartent les réponses
obsolètes. Un Worker fatal est recréé avant une nouvelle tentative.

`rust/bridge/housesContract.ts` fournit les types manuels et le validateur de
scène. `rust/bridge/houseRender.ts` est un adaptateur SVG temporaire. Les
commandes ordinaires de développement, de typecheck et de build de `web/` ne
compilent pas Rust et n'exigent pas le paquet ignoré.

Contrat : [modèle natif](../houses/src/model.rs) et
[validateur TypeScript](../../bridge/housesContract.ts).
