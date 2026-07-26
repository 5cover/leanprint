import Stats from './stats/Stats.js'
import type { TiktokenStatsOptions, TokenStats } from './stats/types.js'
export const getTiktokenStats = (options: TiktokenStatsOptions): Promise<TokenStats> => Stats.tiktoken(options)
