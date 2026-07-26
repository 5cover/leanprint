export interface TiktokenStatsOptions {
    root: string
    modelOrEncoding?: string
    configFilename?: string
}
export interface TokenStats {
    backend: 'tiktoken'
    requested: string
    encoding: string
    files: number
    originalTokens: number
    leanTokens: number
    tokensSaved: number
    reductionPercentage: number
}
