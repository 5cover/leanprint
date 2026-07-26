# @leanprint/work

Workflow tools and the `leanprint` executable. This package depends on `leanprint` and owns config discovery, direct file formatting, leandir creation/status/sync/cleanup, human formatter invocation, deterministic prompts, SHA-256 workspace metadata, conflict detection, and tiktoken statistics.

```sh
npm install --global @leanprint/work
leanprint --help
```

Synchronization is preflighted: metadata, conflicts, AI source, and human formatter output are validated before source-project writes begin. Workspace metadata is stored in the generated config file and protected by an integrity hash.
