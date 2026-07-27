# Opt-in Plain and Git Workspace Modes

## Summary

Introduce `"mode": "plain" | "git"` in `leanprint.json`, defaulting to `"plain"`.

- **Plain mode** keeps the current materialized leandir, lock file, `push`, and `pull`.
- **Git mode** creates a linked worktree on a generated branch. Git stores human-formatted source while clean/smudge filters make only the AI worktree lean.
- Git mode starts from a completely clean repository, the AI commits normally, and the user integrates work with an ordinary Git merge.
- Use `simple-git` behind an internal typed adapter. It preserves native Git worktree/filter behavior while keeping subprocess details out of application code. `isomorphic-git` lacks the necessary native worktree/filter coverage, while NodeGit adds native ABI risk and marks worktree creation experimental. [simple-git](https://www.npmjs.com/package/simple-git), [isomorphic-git](https://isomorphic-git.org/docs/en/alphabetic), [NodeGit](https://www.nodegit.org/api/worktree/)

## Configuration and Formatter Contracts

### Workspace mode

Extend `SourceConfig`:

```json
{
  "mode": "git",
  "leandir": "/tmp/project.lean"
}
```

- Schema default: `"plain"`.
- `leandir` remains required only for workspace commands.
- Mode is resolved once when opening a source project.
- A workspace discovered from its leandir records its mode independently, then LeanPrint reloads the source configuration and verifies that its current mode still matches.
- Changing mode or any projection/formatter setting during an active Git workspace invalidates that workspace and requires recreation.

### Human formatter types

Change the formatter discriminator to:

```ts
type HumanFormatterType = 'one' | 'all' | 'all-in-place'
```

#### `one`

Existing streaming behavior:

- Exactly one standalone `"{file}"` argument.
- Raw source on stdin.
- Formatted source on stdout.
- One process per file.

#### `all`

New safe batch-streaming behavior:

- No `"{file}"` or `"{files}"` placeholders.
- Formatter runs in the source root.
- stdin is a UTF-8 JSON array:

```json
[
  {
    "file": "/absolute/source/path/src/a.ts",
    "source": "const a=1"
  }
]
```

- stdout must be a UTF-8 JSON array of formatted strings in the same order:

```json
["const a = 1\n"]
```

- stderr is available for diagnostics but ignored on success.
- LeanPrint rejects malformed JSON, non-string elements, extra/missing results, or nonzero exit status.
- Plain pull sends every changed transformed file in one invocation.
- Git’s filter protocol requests clean results sequentially, so Git mode invokes this formatter with one-element arrays.
- Documentation includes a Node/Prettier example that uses `prettier.resolveConfig(file)` and `prettier.format(source, { ...config, filepath: file })`, then emits `JSON.stringify(results)`.

#### `all-in-place`

Rename the current `all` behavior:

- Exactly one standalone `"{files}"` argument.
- It expands to separate argv entries.
- Formatter edits those paths in place.
- Supported by plain pull only.
- Git mode rejects it because a Git clean filter must transform the supplied blob, not reread or rewrite a possibly stale worktree path. Git explicitly requires this content-filter behavior. [Git attributes/filter documentation](https://git-scm.dev/docs/gitattributes)

### Common formatter service

Create one semantic API used by both modes:

```ts
interface FormatInput {
    file: string
    source: string
}

interface HumanFormatter {
    format(inputs: readonly FormatInput[]): Promise<readonly string[]>
}
```

Provide `OneFormatter`, `AllFormatter`, and `AllInPlaceFormatter` adapters. Mode implementations never spawn formatter commands directly.

After formatting a lean file:

1. Validate the lean input.
2. Validate the human formatter output.
3. Leanify the human output again.
4. Require it to equal the normalized lean input, ensuring the formatter did not change program meaning.

## Workspace Architecture

### Mode-independent application layer

Replace the monolithic leandir module with a workspace service composed from capabilities:

```ts
interface WorkspaceDriver {
    readonly mode: 'plain' | 'git'
    readonly locator: WorkspaceLocator
    readonly lifecycle: WorkspaceLifecycle
    readonly inspection: WorkspaceInspection
    readonly transfer?: WorkspaceTransfer
}

interface WorkspaceLifecycle {
    create(project: SourceProject, options: CreateOptions): Promise<WorkspaceHandle>
    open(descriptor: WorkspaceDescriptor): Promise<WorkspaceHandle>
    clean(handle: WorkspaceHandle, options: CleanOptions): Promise<void>
}

interface WorkspaceInspection {
    status(handle: WorkspaceHandle): Promise<WorkspaceStatus>
}

interface WorkspaceTransfer {
    push(handle: WorkspaceHandle): Promise<PlainWorkspaceStatus>
    pull(handle: WorkspaceHandle): Promise<PlainWorkspaceStatus>
}
```

- `PlainWorkspaceDriver` supplies lifecycle, inspection, and transfer.
- `GitWorkspaceDriver` supplies lifecycle and inspection but no transfer capability.
- A `WorkspaceDriverRegistry` is the only component that switches on `config.mode`.
- `push` and `pull` request the transfer capability through one shared `requireCapability()` helper. Git mode returns a clear explanation to commit and merge instead.
- CLI rendering switches only on the discriminated status result; workflow internals contain no repeated mode checks.

### Shared semantic services

Both drivers depend on the same:

- `SourceProjectResolver`: source root, config discovery, resolved config, and included-path policy.
- `ProjectionService`: language lookup, leanification, validation, and humanization.
- `HumanFormatter`: normalized formatter interface described above.
- `WorkspaceDriverRegistry`: source-context selection and leandir-context discovery.

Do not use abstract base classes. Use narrow interfaces and composition so the existing plain implementation can be moved with minimal semantic change.

### Workspace discovery

Each driver owns a locator:

- Plain locator walks upward for `leandir-lock.json`.
- Git locator asks `GitClient` for the worktree root and worktree-local `leanprint.*` metadata.
- Discovery runs both locators and requires zero or one match.
- A Git worktree does not contain `leandir-lock.json`.
- Commands invoked inside either workspace recover the source root and config filename from the corresponding metadata, then reload configuration from the source project.

### Public results

Make status a discriminated union:

```ts
type WorkspaceStatus = PlainWorkspaceStatus | GitWorkspaceStatus
```

Common fields include mode, context, source root, and leandir.

Plain status retains pending push/pull changes and conflicts.

Git status includes:

- generated branch name;
- original source branch and starting commit;
- current branch tip;
- staged, unstaged, and untracked paths;
- commits ahead of the starting commit;
- whether the generated branch is merged into the recorded source branch;
- whether configuration still matches the creation hash.

## Native Git Adapter

### Library boundary

Install `simple-git` in `@leanprint/work` using pnpm without specifying a guessed version.

Create an internal `GitClient` interface covering only:

- repository discovery and top-level path;
- current branch and commit;
- porcelain-v2 status;
- linked-worktree creation/list/removal;
- branch creation/deletion;
- worktree-local configuration;
- sparse-checkout configuration;
- attribute inspection;
- revision and ancestry queries.

Implement it as `SimpleGitClient`.

- Use typed `simple-git` methods where available.
- Use `simpleGit.raw([...])` only inside this adapter for unsupported commands.
- Always pass arguments as arrays.
- No workflow code imports `simple-git`.
- No generic shell execution API is exposed.
- Parse machine-readable `-z` or fixed-format output into project-owned types before returning it.

Native Git remains required because Git itself must apply filters during later user commands. `simple-git` is therefore a typed subprocess boundary, not a replacement Git implementation.

### Git prerequisites

Git mode creation requires:

- Git at least 2.34.
- Source root equals the repository top level for the first implementation.
- A named current branch and valid `HEAD`.
- Entire source index and worktree clean; ignored files are allowed.
- No non-ignored untracked files.
- The source config is committed.
- A human formatter of type `one` or `all`.
- No existing effective clean/smudge filter on a supported path; reject LFS or other filter collisions rather than silently overriding them.
- `leandir` is outside the source repository and any existing worktree.
- No repository configuration that would be made unsafe by enabling worktree-specific config.

Use `git sparse-checkout`, which configures sparse settings per worktree and enables `extensions.worktreeConfig`; never edit `.git` internals directly. [Git worktree configuration](https://git-scm.com/docs/git-worktree.html), [Git sparse checkout](https://git-scm.com/docs/git-sparse-checkout)

## Git Workspace Lifecycle

### Creation

`GitWorkspaceDriver.create()` performs a preflight before any writes, then:

1. Resolve repository top level, source branch, and source `HEAD`.
2. Generate a collision-resistant branch such as `leanprint/<source-branch>-<short-id>`.
3. Create the branch and linked worktree with no initial checkout.
4. Store worktree-local metadata:
   - mode;
   - source root;
   - leandir;
   - source branch;
   - generated branch;
   - starting commit;
   - config filename;
   - resolved config hash;
   - LeanPrint version;
   - creation time.
5. Configure worktree-local sparse-checkout rules derived from LeanPrint’s effective ignore policy:
   - omit ignored tracked paths;
   - omit the source configuration;
   - retain tracked unsupported files unchanged;
   - retain enabled-language files for filtering.
6. Generate a worktree-local attributes file assigning `filter=leanprint` only to enabled language extensions.
7. Configure `filter.leanprint.required=true` and its process command in worktree-local Git configuration.
8. Checkout/reset the generated branch so Git’s smudge filter creates the lean representation.
9. Run Git status and require the worktree to be clean immediately after checkout.
10. If filtering, formatter round trips, sparse setup, or checkout fails, remove the newly created worktree and branch transactionally.

The linked worktree contains Git’s normal small gitfile; LeanPrint never copies a `.git` directory.

### Filter process

Add an internal `git-filter-process` entrypoint implementing Git filter protocol v2:

- Advertise `clean` and `smudge`; do not advertise delayed responses.
- Parse pkt-line input incrementally from byte streams.
- Reject absolute paths and traversal.
- Load and validate worktree-local metadata.
- Reload source configuration and require its resolved hash to match creation metadata.
- `smudge`: transform a human Git blob into lean source.
- `clean`: validate lean source, call the common formatter with one input, validate and re-leanify the result, and return human source.
- Return protocol errors so `filter.leanprint.required=true` causes Git operations to fail rather than store lean source accidentally.
- Keep one LeanPrint process alive for the lifetime of each Git command.

Generate a launcher under Git’s worktree-specific administrative area and point the worktree-local filter configuration at it. The launcher uses the current Node executable and installed LeanPrint module. It contains no project-controlled arguments. Shell-command quoting is isolated in one platform-aware helper with spaces, quotes, and Unicode path tests, because Git stores filter commands as command strings rather than argv arrays.

### Normal use

Inside the leandir:

- Files appear lean after checkout, merge, reset, or switch.
- `git diff` and `git status` compare the cleaned human representation against human blobs.
- `git add` converts changed lean files to human source before staging.
- Commits contain only human-formatted source.
- New files with supported extensions receive the same filter through worktree-local attributes.
- Unsupported files remain byte-for-byte ordinary Git content.
- The prompt tells the AI to edit, inspect `git diff`, and commit normally.

There is no Git-mode `push`:

- To bring later source-branch commits into the AI workspace, use ordinary `git merge <source-branch>` or `git rebase`.
- Git checks merged human blobs out through the smudge filter.

There is no Git-mode `pull`:

- To retrieve AI work, return to the source worktree and merge the generated branch.
- Both branches contain human blobs, so Git performs ordinary textual merge and conflict detection.
- Source files remain human-formatted because the source worktree has no LeanPrint filter attributes.

### Status and cleanup

Git status uses porcelain-v2 and ancestry queries, never filesystem hash comparisons.

`leanprint clean`:

- Refuses when the Git worktree has staged, unstaged, or untracked changes unless `--force`.
- Removes the linked worktree through `git worktree remove`.
- Preserves the generated branch by default.
- Adds `--delete-branch`, which deletes only when Git proves the branch is merged into the recorded source branch.
- Requires an additional force option to delete an unmerged branch.
- Removes only generated worktree metadata and never copies or recursively manipulates repository Git data.

## Plain Mode Refactor

- Preserve current creation, file baselines, conflict semantics, formatter rollback, and `push`/`pull` behavior.
- Add `"mode": "plain"` to the next lock schema version.
- Move existing implementation behind `PlainWorkspaceDriver`.
- Replace direct language and formatter calls with `ProjectionService` and `HumanFormatter`.
- Rename formatter type `all` to `all-in-place`; existing configurations using `all` receive a schema error explaining the replacement instead of silently changing behavior.
- Existing pre-new-schema leandirs must be recreated; no implicit metadata migration.

## Tests and Acceptance Criteria

### Formatter tests

- `one`, streaming `all`, and `all-in-place`.
- JSON batch ordering, empty batches, Unicode, malformed JSON, wrong result count/type, stderr, and process failure.
- Node/Prettier fixture resolving different configs and parsers by filepath.
- Humanization semantic round-trip rejection.
- Standalone placeholder validation for each formatter type.

### Driver architecture tests

- Registry selects plain by default and Git only when explicitly configured.
- Leandir-side discovery selects the recorded driver without source-directory guessing.
- `push`/`pull` capability errors occur centrally in Git mode.
- Plain regression suite passes through the new capability layer unchanged.

### Git integration tests

Use temporary real repositories with local test-only identity configuration:

- Clean linked-worktree creation with generated branch and no copied `.git` directory.
- Human blobs in `HEAD`, lean files in the Git worktree.
- Clean status immediately after checkout.
- AI modification, `git add`, commit, and source-branch merge yielding human-formatted code.
- Source-branch changes merged into the AI branch and smudged back to lean form.
- Git-native same-line and delete/modify conflicts.
- Staged, unstaged, untracked, executable, symlink, rename, addition, and deletion behavior.
- JSON and ECMAScript filtering; unsupported files unchanged.
- Existing attribute/filter collisions.
- Source config and ignored tracked files omitted without appearing deleted.
- Configuration-hash mismatch failure.
- Filter protocol fragmentation, multiple blobs per process, invalid packets, formatter failure, and required-filter enforcement.
- Transactional rollback after failures at every creation phase.
- Cleanup preservation, merged deletion, unmerged refusal, and forced dirty-worktree removal.

Run `pnpm generate`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build`, then add a major synchronized-package changeset.

## Assumptions

- `"plain"` remains fully supported and is the default.
- Git mode deliberately requires a clean, committed starting point.
- AI agents must commit their Git-mode work.
- Branch integration is user-run Git, not a LeanPrint merge command.
- Git mode initially supports only source roots at the repository top level.
- Git mode supports formatter types `one` and streaming `all`, but not `all-in-place`.
- Batch `all` is primarily a plain-mode performance feature; Git clean requests use one-element batches.
- Generated Git branches are preserved by default to prevent data loss.
