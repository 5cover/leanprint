export interface TiktokenStatsOptions {
    root: string
    modelOrEncoding?: string
    configFilename?: string
}
export interface TokenCountStats {
    files: number
    originalTokens: number
    leanTokens: number
    tokensSaved: number
    reductionPercentage: number
}
export interface TokenStats extends TokenCountStats {
    backend: 'tiktoken'
    requested: string
    encoding: string
    languages: Record<string, TokenCountStats>
}
