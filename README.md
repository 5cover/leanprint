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
import { format } from 'leanprint'

const output = format(source, { filepath: 'example.ts' })
```

LeanPrint detects JavaScript, JSX, TypeScript, and TSX from `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`. An explicit `language:"ecmascript"` may be used instead. Unsupported syntax produces an `UnsupportedNodeError`; LeanPrint never silently emits a partial file.

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

A leandir is a materialized AI-oriented working copy, not a mount, cache, Git worktree, or live mirror. `create` leanifies supported files and copies other files. The generated config file records SHA-256 file state and integrity-protected workspace metadata. `sync` plans all changes first; any concurrent source-project conflict prevents every write. Supported AI source is parsed, passed to the configured human formatter through stdin/stdout, parsed again, and atomically written to the source project.

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
  "leandir": "/tmp/example-project.lean",
  "ignore": [".git/**", "node_modules/**", "dist/**", "coverage/**"],
  "tokens": {
    "semicolons": false,
    "trailingCommas": false,
    "collapseSingleStatementBlocks": true,
    "parentheses": "required-only"
  },
  "source": {
    "indent": 2,
    "lineWrapping": false,
    "maxEmptyLines": 1,
    "spaceAroundOperators": false,
    "spaceAfterControlKeywords": false,
    "lineEnding": "lf"
  },
  "humanFormatter": { "command": "pnpm", "args": ["exec", "prettier", "--stdin-filepath", "{file}"] }
}
```

## Current status and syntax

The ECMAScript domain covers every standardized, TypeScript, and JSX node exposed by the installed Babel AST version for the parser plugins LeanPrint enables. This includes complete statement and control-flow forms, modules and import attributes, explicit resource management, decorators, classes and fields, JSX/TSX, and TypeScript declarations and type syntax.

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
