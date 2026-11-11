# Contributing

Magna Urbis is an experimental project. Interfaces, recipes and saved formats may change during development. Start with the [project README](README.md) and [documentation index](docs/README.md).

## Setup

For the TypeScript application, install a recent Node.js LTS release and npm:

```sh
cd web
npm ci
npm run dev
```

For V2, follow the [launch and packaging guide](rust/desktop-v2/README.md), including Rust and WASM preparation. Run `npm run dev:v2` from `web/` after preparation. Native engine details are in the [Rust README](rust/README.md).

## Changes and verification

Keep changes focused and explain the behavior they affect. Include reproduction steps and relevant check results with a pull request. Use screenshots when changing visible output; distinguish measured behavior from proposed improvements.

From `web/`, use `npm run typecheck` and the tests relevant to the change (`npm run test:v2` for V2, or `npm test -- <test-file>` for a focused suite). For Rust, run the affected crate's tests from `rust/`; consult its README for build requirements. Avoid concurrent Rust builds sharing `rust/target`.

V2 and the benches must share generation and rendering decisions. Update shared modules rather than applying the same behavior separately in each page. Document new generation methods, sources and limitations in `docs/methods/`.

## Repository contents

- Keep public documentation in `docs/`, component instructions beside their code, and durable interface specifications in `docs/design/`.
- Write new and updated documentation in English. Preserve a French-only reference until its complete content has an English replacement. The bilingual application and illustrated atlas retain their localization resources.
- Commit source, tests, reproducible fixtures, designs, references, licenses and asset provenance. Keep required documentation figures and metadata with their publication.
- Keep AI session instructions (`AGENTS.md`, `CLAUDE.md`), conversations, prompts, reviews, task diaries, machine settings and generated validation captures local. Use `.local-archive/`, `.codex/`, `.claude/` or the existing ignored output directories. `.gitignore` records these boundaries.
- Check `git status` and the diff before submitting. Do not commit secrets, downloaded models, build products or another contributor's unrelated changes.

Code and distributed assets must respect the [license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Preserve attribution when updating assets.
