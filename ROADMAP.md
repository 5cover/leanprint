## Roadmap

consider and research and propose solutions for these feedback items i have identified. most should be simple enough or documentation. do tell me if it changes the domain significantly.

- leanprint seems to be way too strict in its "conflict" detection. why would files unchanged by the AI trigger a conflict on sync if they have been changed by the user. this makes it really rigid. we should adopt uniformly the appraoch that a conflict occurs when the same file has changed in both sources. only then. if one has changed, it updates the other.

- configuration shouldn't be duplicated. currently, the leandir contains its own copy of the source root config file, which means if the source root config files, it still uses the leandir config? which command reads what config? doesn't matter. the leandir leanprint.json should only contain the workspace  root key, and nothing else. meanwhile, it reads  the source root key for config. this might even eliminate  the need for config hashes. if the AI accidentally modifies leandir.json... that could happen. so actually i have another idea; No more leandir.json in the leandir. instead, we add leandir-lock.json, which contains information for the current workspace (not nested in a top level workspace key). authors recommended to add it to their gitignore. leanprint keeps it updated, 2-space formatted.

- per-source savings breakdown table in stats

- consider: opt-in git integration. separate branch/worktree? probably no raw .git copying. (large item)

- test on the hypothesis that indentation structure is useful to a model's understanding of code (reading/writing) (see if standard eval methods exist)
this a foundational reason why Leanprint exists. however, if it is disproven, @leanprint/work is still useful for exposing minified code to AI while keeping the canonical source prettiered

- test actual token savings. devise another eval that counts input/output tokens consumed in repeatable tasks on a codebase. not greenfield creation, because token usage would vary too wildly between runs.

