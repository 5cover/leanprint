export interface Parser<Ast, Config = undefined> {
    parse(source: string, config: Config): Ast
}
export interface TokenPrinter<Ast, Token, Config = undefined> {
    print(ast: Ast, config: Config): Iterable<Token>
}
export interface SourcePrinter<Token, Config = undefined> {
    print(tokens: Iterable<Token>, config: Config): string
}
export interface Language<Ast, Token, ParserConfig, TokenConfig, SourceConfig> {
    readonly id: string
    readonly extensions: readonly string[]
    readonly parser: Parser<Ast, ParserConfig>
    readonly tokenPrinter: TokenPrinter<Ast, Token, TokenConfig>
    readonly sourcePrinter: SourcePrinter<Token, SourceConfig>
    readonly defaults: { parser: ParserConfig; tokens: TokenConfig; source: SourceConfig }
}
export interface FormatOptions {
    filepath?: string
    language?: string
    parser?: Record<string, unknown>
    tokens?: Record<string, unknown>
    source?: Record<string, unknown>
}
