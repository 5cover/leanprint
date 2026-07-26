# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm TypeScript monorepo with two publishable packages:

- `packages/leanprint/src`: synchronous source-to-source library. The `ecmascript/` language domain owns parsing, typed tokens, AST printing, parentheses, lexical spacing, and source rendering.
- `packages/work/src`: CLI and workflow package for config discovery, leandir creation, synchronization, prompts, formatters, and statistics.
- `packages/*/test`: Node test files. Core equivalence fixtures live in `packages/leanprint/test`.
- `.changeset/`: release intent consumed by Changesets.

Keep the dependency direction `@leanprint/work -> leanprint`; core code must not import workflow code. Generated `*.generated.*` files come from JSON Schemas and must not be edited manually.

## Build, Test, and Development Commands

Use Node.js 24+ and pnpm:

- `pnpm install`: install all workspace dependencies.
- `pnpm generate`: regenerate schema-derived TypeScript files.
- `pnpm typecheck`: run strict TypeScript checks.
- `pnpm test`: run all `node:test` suites.
- `pnpm lint`: check sources and tests with ESLint.
- `pnpm build`: use tsup to create ESM bundles and declarations in `dist/`.
- `pnpm ci`: generate, typecheck, test, and build.

Run a package command with `pnpm --filter leanprint test` or `pnpm --filter @leanprint/work test`.

## Coding Style & Naming Conventions

Use ESM and strict TypeScript. Prettier defines four-space indentation for TypeScript and two spaces elsewhere, no semicolons, and single quotes. Run ESLint before submitting changes. PascalCase implementation files default-export their main class (`Parser.ts`, `Leandir.ts`); lowercase files contain helpers, types, and constants. Preserve glossary terms such as **leanify**, **leandir**, **human source**, and **workspace metadata**.

Avoid raw syntax fragments, locale-dependent sorting, silent fallbacks, and duplicated language logic. Unsupported AST nodes must fail explicitly.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict` and filenames ending in `.test.ts`. Add focused regression tests for fixes. Printer changes should verify valid reparsing, AST equivalence, determinism, idempotence, comments, lexical separation, and ASI safety where relevant. Workflow tests should use temporary directories and assert conflict handling and no partial writes during preflight failures.

## Commits, Pull Requests & Releases

History uses short, direct commit subjects; describe the outcome rather than implementation activity. Pull requests should explain behavior changes, notable safety implications, and verification commands. Link relevant issues and include CLI output when user-visible behavior changes; screenshots are normally unnecessary.

For publishable changes, run `pnpm changeset` and commit the generated Markdown file. Do not manually version packages; the fixed Changesets group keeps both package versions synchronized.
