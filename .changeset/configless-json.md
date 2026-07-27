---
'@leanprint/work': major
'leanprint': major
---

Add configless workflows, enable all registered languages by default, and add strict complexity-aware JSON leanification.

Harden synchronization by identifying invalid human-formatter output, checking the source snapshot captured during planning, and refreshing workspace baselines after successful writes.

Add batch human formatters with safe standalone argument expansion, one-process in-place formatting, and in-process restoration of lean files before synchronized source writes.

Rename the directional workflow commands to `push` and `pull`, and allow pulls to proceed when unrelated source-only changes are pending.
