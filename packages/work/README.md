# @leanprint/work

Workflow tools and the `leanprint` executable. This package depends on `leanprint` and owns config discovery, direct file formatting, leandir creation/status/sync/cleanup, human formatter invocation, deterministic prompts, SHA-256 workspace metadata, conflict detection, and tiktoken statistics.

```sh
npm install --global @leanprint/work
leanprint --help
```

Synchronization is preflighted: metadata, conflicts, AI source, and human formatter output are validated before source-project writes begin. Workspace metadata is stored in the generated config file and protected by an integrity hash.

Project configuration is validated against [SourceConfig.json](https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json). Add that URL as the config file's `$schema` value for editor validation. The required `languages` map enables language domains independently and scopes each domain's `parser`, `tokens`, and `source` settings.

```json
{
  "$schema": "https://raw.githubusercontent.com/5cover/leanprint/main/packages/work/src/schemas/SourceConfig.json",
  "leandir": "/tmp/example.lean",
  "languages": {
    "ecmascript": {}
  }
}
```
