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
leanprint push # Push human/source-project changes into the leandir.
leanprint pull
```

A leandir is a materialized AI-oriented working copy, not a mount, cache, Git worktree, or live mirror. `create` leanifies supported files and copies unsupported files byte-for-byte. During an active session, `push` sends source additions, edits, deletions, modes, symlinks, ignore changes, and language-setting changes into the leandir while preserving unrelated AI edits. `pull` retrieves AI changes. A path changed on both sides is a conflict; source-only changes do not block a pull and remain untouched. Both operations discover all conflicts before writing. A successful pull seals the workspace session.

The generated config records a canonical SHA-256 hash of the fully resolved session configuration, including defaults, the absolute leandir, loaded ignore-file rules, language settings, formatter settings, and extension properties. JSON formatting is irrelevant. If source configuration changes, `pull` asks you to run `push`; generated settings and workspace metadata remain integrity-protected against edits.

Each destination entry is replaced atomically, but the MVP does not claim project-wide rollback after an operating-system I/O failure partway through application. The workspace is first marked `applying`; if application fails, it remains in that state and refuses another pull so partial application cannot be mistaken for a clean session.

## Commands

```txt
leanprint [-c filename] format <file> [--write] [--language ecmascript|json]
leanprint [-c filename] create [root] [--force]
leanprint [-c filename] push [path]
leanprint [-c filename] prompt [path]
leanprint [-c filename] status [path]
leanprint [-c filename] pull [path]
leanprint [-c filename] clean [path] [--force]
leanprint [-c filename] stats tiktoken [model-or-encoding] [--json]
```

The default config filename is `leanprint.json`. `-c` accepts a repository-relative filename and discovery tests that full filename while walking upward. If none is found, commands use an in-memory empty configuration rooted at the requested path. `ignoreFile` accepts one filename or an ordered array, resolved relative to the config file; patterns use gitignore semantics against source-root-relative forward-slash paths. Inline `ignore` rules apply last. Built-in defaults apply only when neither setting is supplied.

```json
{
  "$schema": "https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json",
  "leandir": "/tmp/example-project.lean",
  "ignoreFile": [".gitignore", ".leanprintignore"],
  "ignore": ["!vendor/kept.js"],
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
  "humanFormatter": {
    "type": "all",
    "command": "pnpm",
    "args": ["exec", "prettier", "--write", "{files}"]
  }
}
```

The human formatter is started directly with `shell:false` in the source root. Batch mode (`type: "all"`) expands the standalone `"{files}"` argument into absolute leandir paths and expects the formatter to edit them in place. LeanPrint invokes it once, reads and validates every result, and restores the lean files in a `finally` block before writing human source. Successful stdout such as package-manager progress is ignored. Single-file mode (`type: "one"`, the default) writes lean source to stdin, reads human source from stdout, and replaces a standalone `"{file}"` argument with the absolute human destination path. Spawn failures, nonzero exits, invalid output, and source races abort pull before ordinary source writes.

Workspace states are `active`, `updating`, `applying`, and `synchronized`. Only `active` workspaces accept push or pull. An interrupted write remains in its transitional state and refuses unsafe retries. Unsupported files participate in the same baselines and conflicts as supported source, but are copied unchanged in both directions.

Every top-level source configuration property is optional. An absent or empty `languages` object enables every registered domain; a non-empty object enables only its keys. `leandir` is required only by workspace commands, while formatting, prompts, and statistics work without it. Parser, token, source, and ignore defaults are applied during resolution. Additional properties are retained for forward compatibility. The canonical [source-project configuration schema](https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json) can be assigned to `$schema` for editor validation.

## Current status and syntax

The ECMAScript printer has explicit dispatch for every standardized, TypeScript, and JSX node exposed by the installed Babel AST version for the parser plugins LeanPrint enables. This includes statement and control-flow forms, modules and import attributes, explicit resource management, decorators, classes and fields, JSX/TSX, and TypeScript declarations and type syntax. Representative behavioral fixtures verify reparsing and AST equivalence; the complete dispatch inventory is structural coverage rather than a claim that every combination of syntax has an independent semantic fixture.

The JSON domain parses strict JSON, preserves member order, duplicate keys, and numeric spelling, and uses a recursive complexity budget rather than a column limit. Values at or below the default budget of eight remain minified on one line; larger containers expand recursively. It does not accept JSONC or JSON5 syntax.

Flow syntax and experimental proposal families that are not enabled in the parser—such as pipeline, record/tuple, bind, module-expression, and do-expression proposals—are outside the current language domain. If an enabled parser or a future Babel release produces an unknown node, LeanPrint fails explicitly with `UnsupportedNodeError` rather than emitting partial source.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

The repository uses pnpm workspaces, strict TypeScript, ESM, ESLint, tsdown, node:test, Changesets, and GitHub Actions.

## Package and release lifecycle

LeanPrint uses **Changesets** to record release intent and **tsdown** to turn the TypeScript sources into npm-ready files.

1. **Develop and verify a change.** Work in `packages/leanprint` or `packages/work`, then run `pnpm ci` and `pnpm lint`.
2. **Add a changeset.** Run `pnpm changeset`, select the affected package and whether the release is a patch, minor, or major, then write a short user-facing summary. This creates a small Markdown file under `.changeset`; commit it with the code. Because the two packages are configured as a fixed group, Changesets keeps their published versions synchronized.
3. **Apply release versions.** A release maintainer runs `pnpm version-packages`. Changesets consumes pending changeset files, updates package versions and changelogs, and updates internal dependency ranges. Review and commit those generated changes.
4. **Build packages.** Run `pnpm build`. Each package invokes tsdown, which bundles its ESM entry points into `dist/*.js` and generates matching `dist/*.d.ts` TypeScript declarations. The package manifests publish `dist`, not the original implementation files.
5. **Publish to npm.** After authenticating with npm and verifying the version commit, run `pnpm release`. This rebuilds both packages and asks Changesets to publish package versions that are not already on the configured npm registry.

In short, a changeset says **what version should change and why**, `version-packages` materializes that decision, tsdown creates the distributable files, and `release` publishes them. The root package is private and is never published.
