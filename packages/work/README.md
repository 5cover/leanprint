# @leanprint/work

Workflow tools and the `leanprint` executable. This package depends on `leanprint` and owns config discovery, direct file formatting, leandir creation/status/push/pull/cleanup, human formatter invocation, deterministic prompts, SHA-256 workspace metadata, conflict detection, and tiktoken statistics.

The source transformation library is published separately as [`leanprint`](https://www.npmjs.com/package/leanprint).

```sh
npm install --global @leanprint/work
leanprint --help
```

`leanprint push [path]` sends source-project changes into an active leandir. `leanprint pull [path]` retrieves AI changes; both accept either project path. Both are preflighted, and any path changed on both sides prevents all ordinary writes. Source-only changes do not block a pull and remain untouched. Unsupported files are copied byte-for-byte and receive the same conflict protection as supported source.

Workspace metadata is stored in the generated config and protected by an integrity hash. A separate resolved-configuration hash covers defaults, absolute paths, loaded ignore rules, language and formatter settings, and retained extension properties. Source config changes require `push` before pull. Formatter-only changes preserve AI edits when pushed before pulling.

Entries are replaced atomically one at a time. Before writes, push records `updating` and pull records `applying`; interruption leaves that state in place and refuses unsafe retries. Successful push returns to `active`; successful pull seals the workspace as `synchronized`.

Project configuration is optional. When upward discovery finds no file, LeanPrint uses an in-memory empty configuration rooted at the requested project path. Configuration files are validated against [SourceConfig.json](https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json); add that URL as `$schema` for editor validation.

An absent or empty `languages` map enables every registered language with defaults. A non-empty map enables only its listed domains and scopes each domain's `parser`, `tokens`, and `source` settings. ECMAScript-family and strict JSON files are built in.

```json
{
  "$schema": "https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json",
  "leandir": "/tmp/example.lean",
  "languages": {
    "ecmascript": {}
  }
}
```

`leandir` is optional for formatting, prompts, and statistics. Workspace commands report a clear configuration error when they need a leandir and none is configured.

`ignoreFile` accepts a string or ordered array of gitignore-compatible files resolved from the config directory. Inline `ignore` rules apply afterward, so they can negate file rules. Defaults for `.git`, `node_modules`, `dist`, and `coverage` apply only when neither option is present, including configless operation.

LeanPrint invokes human formatters directly with `shell:false` in the source root. The default `type: "one"` protocol sends one lean file over stdin, reads human source from stdout, and replaces one standalone `"{file}"` argument with its absolute human destination path. With `type: "all"`, one standalone `"{files}"` argument expands into separate absolute leandir paths; the formatter runs once and edits those files in place. LeanPrint validates their results and always restores the lean originals before writing human source. Spawn errors, nonzero exits, invalid output, or source races abort before ordinary source writes.

For Prettier batch formatting, use `{ "type": "all", "command": "pnpm", "args": ["exec", "prettier", "--write", "{files}"] }`. Formatter configuration and plugins used for path-based discovery must be present in the leandir.
