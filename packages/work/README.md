# @leanprint/work

Workflow tools and the `leanprint` executable. This package depends on `leanprint` and owns config discovery, direct file formatting, leandir creation/status/sync/cleanup, human formatter invocation, deterministic prompts, SHA-256 workspace metadata, conflict detection, and tiktoken statistics.

The source transformation library is published separately as [`leanprint`](https://www.npmjs.com/package/leanprint).

```sh
npm install --global @leanprint/work
leanprint --help
```

`leanprint update [path]` pushes source-project changes into an active leandir. `leanprint sync [path]` pulls AI changes back; both accept either project path. Both are preflighted, and any path changed on both sides prevents all ordinary writes. Unsupported files are copied byte-for-byte and receive the same conflict protection as supported source.

Workspace metadata is stored in the generated config and protected by an integrity hash. A separate resolved-configuration hash covers defaults, absolute paths, loaded ignore rules, language and formatter settings, and retained extension properties. Source config changes require `update` before sync. Formatter-only updates preserve AI edits, enabling the recovery sequence `leanprint update` followed by `leanprint sync`.

Entries are replaced atomically one at a time. Before writes, update records `updating` and sync records `applying`; interruption leaves that state in place and refuses unsafe retries. Successful update returns to `active`; successful sync seals the workspace as `synchronized`.

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

The human formatter protocol is stdin to stdout. LeanPrint invokes `command` directly with `shell:false`, in the source root, and replaces `{file}` in every argument with the absolute destination path. Spawn errors, nonzero exits, or output that cannot be parsed and leanified abort the operation before ordinary source files are written.
