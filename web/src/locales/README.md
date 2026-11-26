# Translations

The interface ships in **English and French** (authored), plus Spanish, Portuguese, Chinese, Arabic, Russian, Japanese, German, Italian, Polish and Korean.

- `de.json`, `it.json`, `pl.json`, `ko.json` are *community locales*: plain JSON, no TypeScript needed.
  They were bootstrapped with machine translation and **need native-speaker review**. Corrections are very welcome.
- The other languages still live in `src/v2/locale*.ts` and `src/render/cityRolesLocale.ts`; they will move to this format.

## File layout

```json
{
  "ui":    { "English source text": "translation", "{count} settlements": "{count} Siedlungen" },
  "roles": { "bld": { "Bakery": "…" }, "districts": { "market": "…" }, "streets": { "main": "…" }, "state": { ".ruin": " …" } },
  "names": { "terms": { "river": "Fluss" }, "worship": { "church": "…" }, "rows": { "north": "…" }, "roleRows": { "castle": "…" } }
}
```

Rules:
- keep every `{placeholder}` unchanged;
- keep leading/trailing spaces (state suffixes such as `" in Ruinen"` are appended to a role);
- a missing key falls back to English, so partial files are fine;
- `names.*` are map toponym generics: short, capitalised like a sign on a map.

## Adding a language

1. Copy `de.json` to `<code>.json` and translate the values.
2. Register it in `index.ts` (`COMMUNITY_LOCALES`) and in `src/v2/languages.ts`, then add the code to `NameDisplayLanguage` (`src/gen/names/types.ts`) and to the project enum check (`src/v2/project.ts`).
3. Run `npx vitest run tests/v2/localization.test.ts tests/v2/urbanParameterHelpLocale.test.ts tests/toponymIntegration.test.ts`.

Word order of map names (e.g. `Aubeville-Straße`, `Castello di …`) is handled in `src/gen/names/displayNames.ts`.
