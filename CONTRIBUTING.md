# Contributing

Magna Urbis V2 is an alpha. Interfaces, recipes and saved formats may change between versions. Start with the [project README](README.md) and the [documentation index](docs/README.md).

## Feedback

- Questions, ideas and generated maps: [Discord](https://discord.gg/3yFq8t8Q2W) or [Discussions](https://github.com/dunkean/magna-urbis/discussions).
- Translations: community locales are plain JSON in `web/src/locales/` (see its [README](web/src/locales/README.md)); fixes from native speakers are welcome.
- Bugs: open an [issue](https://github.com/dunkean/magna-urbis/issues) with the version, the share code or recipe, the browser or desktop edition, and a screenshot if possible.

## Setup

Use Node.js 22 and npm (the CI baseline), Rust through rustup with the toolchain pinned in `rust/rust-toolchain.toml`, and `wasm-pack` 0.13.1. Install `wasm-pack` with `cargo install wasm-pack --version 0.13.1 --locked` from `rust/`. Windows also needs the Visual Studio C++ build tools. From `web/`:

```sh
npm ci
npm run prepare:v2
npm run dev:v2
```

The [V2 launch and packaging guide](rust/desktop-v2/README.md) covers the native engine, neural relief and optional Python modules. Engine details are in the [Rust README](rust/README.md).

The [repository map](docs/REPOSITORY_LAYOUT.md) identifies the V2 product, shared code, optional modules and experiments. Start with the procedural web application above; optional neural sources, models and Python environments have their own setup and are not prerequisites for that path.

## Changes and verification

Keep changes focused and explain the behavior they affect. Include reproduction steps and relevant check results with a pull request. Use screenshots when changing visible output; distinguish measured behavior from proposed improvements.

From `web/`, run `npm run typecheck` and the tests relevant to the change (`npm run test:v2` for V2, or `npx vitest run <test-file>` for a focused suite). For Rust, run the affected crate's tests from `rust/`; consult its README for build requirements. Avoid concurrent Rust builds sharing `rust/target`.

V2 and the benches must share generation and rendering decisions. Update shared modules rather than applying the same behavior separately in each page. Document new generation methods, sources and limitations in `docs/methods/`.

## Pull request CI

The [PR CI workflow](.github/workflows/pr-ci.yml) runs on pull requests to `main`, pushes to `main`, merge queue checks and manual dispatch. It uses hosted Linux runners and read-only repository permissions; it needs no repository secrets or local services.

- Web: formatting, freshly built procedural/house WASM with locked dependencies, TypeScript, `npm run test:fast` (including V2 and bench parity), and the V2 static build.
- Rust: library, integration and documentation tests for random, terrain, core, houses and the native procedural service in one Cargo invocation.
- Tooling: desktop version alignment, model manifest handling, public asset names/checksums, portable packaging and optional Python runtime management using fixtures.

Configure branch protection or a ruleset to require the stable **CI** check after its first successful run. It fails if any of the three jobs fails, is cancelled or is skipped. There are no path filters, so documentation-only pull requests also report this check. Fork pull requests use `pull_request`; they do not run with a privileged `pull_request_target` token.

This baseline does not qualify hardware rendering or inference, the threaded WASM package, the exhaustive `npm run test:slow` city matrix, Godot experiments, or installed desktop applications. Keep the real GPU display gate and packaged-app qualification before publication; desktop releases continue to use the existing release workflow. Rust formatting and Clippy are not enforced yet: establish their baseline in a separate change rather than reformatting unrelated Rust in a CI change.

For local web checks, first run `npm ci` and `npm run prepare:v2 -- --no-threads` from `web/`, then `npm run format:check`, `npm run typecheck`, `npm run test:fast` and `npm run build:v2`. Coordinate WASM/Rust builds with other sessions before preparing packages. A fresh checkout's fallback WASM declarations are not a substitute for generated bindings when checking types.

## Repository contents

- Keep public documentation in `docs/`, component instructions beside their code, and durable interface specifications in `docs/design/`.
- Write new and updated documentation in English. Preserve a French-only reference until its complete content has an English replacement. The bilingual application, the illustrated atlas and the project README (`README_FR.md`) keep their French versions.
- Commit source, tests, reproducible fixtures, designs, references, licenses and asset provenance. Keep required documentation figures and metadata with their publication.
- Keep AI session instructions (`AGENTS.md`, `CLAUDE.md`), conversations, prompts, reviews, task diaries, machine settings and generated validation captures local. Use `.local-archive/`, `.codex/`, `.claude/` or the existing ignored output directories. `.gitignore` records these boundaries.
- Check `git status` and the diff before submitting. Do not commit secrets, downloaded models, build products or another contributor's unrelated changes.

Code and distributed assets must respect the [license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Preserve attribution when updating assets.
