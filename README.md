# LeanPrint

> LeanPrint transforms source code into a compact, deterministic representation for AI agents while preserving syntax, structure, indentation, comments, and general human readability.

LeanPrint occupies the space between a conventional formatter and a minifier. It removes formatting noise without renaming identifiers, deleting code, or discarding useful structure. Leanification is intentionally one-way: it does not retain wrapping, alignment, optional punctuation, or optional grouping, and there is no decode operation. A configured human formatter produces human source after synchronization.

## Packages

- [`leanprint`](packages/leanprint) is the synchronous source-to-source library. It has no filesystem or CLI concerns.
- [`@leanprint/work`](packages/work) provides the `leanprint` executable, project discovery, leandirs, synchronization, prompts, and statistics.

Both packages require Node.js 24 or newer and are versioned together.

## Library

```sh
npm install leanprint
```

```ts
import { ecmascript, format } from 'leanprint'

const output = format(source, {
  language: ecmascript,
  filepath: 'example.ts',
  tokens: { semicolons: false },
})
```

LeanPrint detects JavaScript, JSX, TypeScript, and TSX from `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`. Pass `language:ecmascript` for strongly typed explicit selection, including sources without a useful filepath. Unsupported syntax produces an `UnsupportedNodeError`; LeanPrint never silently emits a partial file.

## Leandir workflow

```sh
npm install --global @leanprint/work

cd ~/project
leanprint create

cd /tmp/project.lean
leanprint prompt
# Start the AI agent in this directory.

leanprint status
leanprint sync
```

A leandir is a materialized AI-oriented working copy, not a mount, cache, Git worktree, or live mirror. `create` leanifies supported files and copies other files. The generated config file records SHA-256 file state and integrity-protected workspace metadata. `sync` plans all changes first; any concurrent source-project conflict prevents every write. Supported AI source is parsed, passed to the configured human formatter through stdin/stdout, parsed again, and atomically written to the source project. A successful sync seals that workspace session; create a new leandir for further AI work.

Each destination entry is replaced atomically, but the MVP does not claim project-wide rollback after an operating-system I/O failure partway through application. The workspace is first marked `applying`; if application fails, it remains in that state and refuses another sync so partial application cannot be mistaken for a clean session.

## Commands

```txt
leanprint [-c filename] format <file> [--write] [--language ecmascript]
leanprint [-c filename] create [root] [--force]
leanprint [-c filename] prompt [path]
leanprint [-c filename] status [path]
leanprint [-c filename] sync [path]
leanprint [-c filename] clean [path] [--force]
leanprint [-c filename] stats tiktoken [model-or-encoding] [--json]
```

The default config filename is `leanprint.json`. `-c` accepts a repository-relative filename and discovery tests that full filename while walking upward. Ignore globs are source-root-relative and do not read `.gitignore`.

```json
{
  "$schema": "https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json",
  "leandir": "/tmp/example-project.lean",
  "ignore": [".git/**", "node_modules/**", "dist/**", "coverage/**"],
  "languages": {
    "ecmascript": {
      "parser": {},
      "tokens": {
        "semicolons": false
      },
      "source": {
        "indent": 2
      }
    }
  },
  "humanFormatter": { "command": "pnpm", "args": ["exec", "prettier", "--stdin-filepath", "{file}"] }
}
```

`languages` is required; its keys are the language domains enabled for the project. An empty object enables none. Parser, token, source, and ignore defaults are declared in the schemas and applied during AJV validation. Additional properties are retained for forward compatibility. The canonical [source-project configuration schema](https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json) can be assigned to `$schema` for editor validation.

## Current status and syntax

The ECMAScript printer has explicit dispatch for every standardized, TypeScript, and JSX node exposed by the installed Babel AST version for the parser plugins LeanPrint enables. This includes statement and control-flow forms, modules and import attributes, explicit resource management, decorators, classes and fields, JSX/TSX, and TypeScript declarations and type syntax. Representative behavioral fixtures verify reparsing and AST equivalence; the complete dispatch inventory is structural coverage rather than a claim that every combination of syntax has an independent semantic fixture.

Flow syntax and experimental proposal families that are not enabled in the parser—such as pipeline, record/tuple, bind, module-expression, and do-expression proposals—are outside the current language domain. If an enabled parser or a future Babel release produces an unknown node, LeanPrint fails explicitly with `UnsupportedNodeError` rather than emitting partial source.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

The repository uses pnpm workspaces, strict TypeScript, ESM, ESLint, tsup, node:test, Changesets, and GitHub Actions.

## Package and release lifecycle

LeanPrint uses **Changesets** to record release intent and **tsup** to turn the TypeScript sources into npm-ready files.

1. **Develop and verify a change.** Work in `packages/leanprint` or `packages/work`, then run `pnpm ci` and `pnpm lint`.
2. **Add a changeset.** Run `pnpm changeset`, select the affected package and whether the release is a patch, minor, or major, then write a short user-facing summary. This creates a small Markdown file under `.changeset`; commit it with the code. Because the two packages are configured as a fixed group, Changesets keeps their published versions synchronized.
3. **Apply release versions.** A release maintainer runs `pnpm version-packages`. Changesets consumes pending changeset files, updates package versions and changelogs, and updates internal dependency ranges. Review and commit those generated changes.
4. **Build packages.** Run `pnpm build`. Each package invokes tsup, which bundles its ESM entry points into `dist/*.js` and generates matching `dist/*.d.ts` TypeScript declarations. The package manifests publish `dist`, not the original implementation files.
5. **Publish to npm.** After authenticating with npm and verifying the version commit, run `pnpm release`. This rebuilds both packages and asks Changesets to publish package versions that are not already on the configured npm registry.

In short, a changeset says **what version should change and why**, `version-packages` materializes that decision, tsup creates the distributable files, and `release` publishes them. The root package is private and is never published.
