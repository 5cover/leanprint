# @leanprint/work

Workflow tools and the `leanprint` executable. This package depends on `leanprint` and owns config discovery, direct file formatting, leandir creation/status/sync/cleanup, human formatter invocation, deterministic prompts, SHA-256 workspace metadata, conflict detection, and tiktoken statistics.

```sh
npm install --global @leanprint/work
leanprint --help
```

Synchronization is preflighted: metadata, conflicts, AI source, and human formatter output are validated before source-project writes begin. Workspace metadata is stored in the generated config file and protected by an integrity hash. A successful sync seals the workspace as `synchronized`; create a new leandir for another session.

Source entries are replaced atomically one at a time. LeanPrint deliberately does not promise project-wide rollback after an operating-system I/O failure: before applying entries it records the workspace as `applying`, and a workspace left in that state refuses another sync. This makes partial application explicit without pretending that a multi-file filesystem update is transactional. Git remains useful recovery protection, but is not required and is not inspected by LeanPrint.

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
