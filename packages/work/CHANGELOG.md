# @leanprint/work

## 2.0.0

### Major Changes

- c69c7ec: Add configless workflows, enable all registered languages by default, and add strict complexity-aware JSON leanification.

  Harden synchronization by identifying invalid human-formatter output, checking the source snapshot captured during planning, and refreshing workspace baselines after successful writes.

  Add batch human formatters with safe standalone argument expansion, one-process in-place formatting, and in-process restoration of lean files before synchronized source writes.

  Rename the directional workflow commands to `push` and `pull`, and allow pulls to proceed when unrelated source-only changes are pending.

  Replace the duplicated generated leandir configuration with a flat, integrity-protected `leandir-lock.json`; leandir commands now always load current settings from the source root.

- Stabilization

  Sync/update subcommands renamed to Push/pull
  Batching human formatting through "all" humanFormatter

### Minor Changes

- 7daf85d: Add refreshable leandir sessions, gitignore-file configuration, resolved configuration integrity, symmetric sync discovery, lowercase workflow namespaces, printer regression fixes, and expanded documentation.

### Patch Changes

- Updated dependencies [c69c7ec]
- Updated dependencies [7daf85d]
- Updated dependencies
  - leanprint@2.0.0

## 1.0.0

### Major Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - leanprint@1.0.0
