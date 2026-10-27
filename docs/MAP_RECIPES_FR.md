# Recettes de partage

[English translation](MAP_RECIPES.md).

Dans les ateliers Rust (terrain, settlements, urbanisme et maisons), **Exporter code** ouvre une recette `MU.…`. On peut copier ce texte ou télécharger un fichier **.murecipe**. **Importer code** accepte le texte collé, y compris avec des retours à la ligne, ou ce même fichier. L’import ouvre automatiquement le bon atelier.

La recette conserve les paramètres appliqués, les graines, les pins et notes lorsqu’ils existent, la caméra et les réglages d’affichage sérialisés par l’atelier. Les brouillons de génération ne remplacent pas l’état appliqué. Aucun service de raccourcissement ni compte n’est nécessaire.

Les nouveaux exports procéduraux conservent la recette du terrain et la liste des découpes alignées sur ses cellules. À l’import, le terrain est régénéré par le même atelier, puis les découpes sont rejouées et les étapes suivantes recalculées avec leurs paramètres. Les données sans recette de reconstruction (anciens fichiers .decor, par exemple) sont embarquées directement. Une heightmap locale est intégrée : aucun identifiant de stockage local n’est laissé comme seule source du relief. Ces cas peuvent donc produire des codes plus longs ; le fichier est alors plus pratique.

Le format est du JSON compacté, compressé en zlib avec un dictionnaire des réglages courants, puis encodé en base64url. Le checksum détecte les codes endommagés. Le fichier contient exactement le même code, suivi d’un retour à la ligne. Il n’y a pas de garantie de compatibilité entre révisions du générateur.

Le codec est dans `web/src/ui/recipe.ts` (`encodeRecipe` / `decodeRecipe`). L’interface et la reconstruction sont dans `recipeSharing.ts`. `recipeDictionary.json` contient seulement le vocabulaire et des valeurs courantes, pas un catalogue de cartes. Le script développeur `node scripts/recipe_dictionary.mjs` le régénère depuis Vite ; cela invalide volontairement les anciens codes.

Vérification depuis `web/` :

```powershell
npx vitest run tests/ui.recipe.test.ts
node scripts/recipe_ui_check.mjs http://127.0.0.1:5173
```
