## Roadmap

consider and research and propose solutions for these feedback items i have identified. most should be simple enough or documentation. do tell me if it changes the domain significantly.

- fix test failures

- fix eslint failures : Formatter.ts, Leandir.ts, Prompt.ts, Stats.ts. All fake classes with no state. Flatten, public methods into named exports, private into regular functions, moved below exports, rename the file to lowercase, adapt imports into namespace imports. Like i did with configs.

- per-source savings breakdown table in stats

- consider: opt-in git integration. separate branch/worktree? probably no raw .git copying. (large item)
