import * as stats from './stats/stats.js'
import type { TiktokenStatsOptions, TokenStats } from './stats/types.js'
export const getTiktokenStats = (options: TiktokenStatsOptions): Promise<TokenStats> => stats.tiktoken(options)
