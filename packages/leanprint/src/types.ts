export interface Parser<Ast, Config = undefined> {
    parse(source: string, config: Config): Ast
}
export interface TokenPrinter<Ast, Token, Config = undefined> {
    print(ast: Ast, config: Config): Iterable<Token>
}
export interface SourcePrinter<Token, Config = undefined> {
    print(tokens: Iterable<Token>, config: Config): string
}
export interface LanguageConfig {
    parser?: object
    tokens?: object
    source?: object
}
export interface ResolvedLanguageConfig {
    parser: object
    tokens: object
    source: object
}
export interface Language<
    Ast,
    Token,
    InputConfig extends LanguageConfig,
    ResolvedConfig extends ResolvedLanguageConfig,
    SourcePrinterConfig extends object = ResolvedConfig['source'],
> {
    readonly id: string
    readonly extensions: readonly string[]
    readonly parser: Parser<Ast, ResolvedConfig['parser'] & { filepath?: string }>
    readonly tokenPrinter: TokenPrinter<Ast, Token, ResolvedConfig['tokens'] & { filepath?: string }>
    readonly sourcePrinter: SourcePrinter<Token, SourcePrinterConfig>
    readonly defaults: ResolvedConfig
    resolveConfig(config?: InputConfig): ResolvedConfig
    sourceConfig(config: ResolvedConfig): SourcePrinterConfig
}
export type AnyLanguage = Language<unknown, unknown, LanguageConfig, ResolvedLanguageConfig, object>
export type Defined<T> = Exclude<T, undefined>
export type LanguageConfigOf<L> = L extends Language<infer _Ast, infer _Token, infer Config, infer _Resolved, infer _Source>
    ? Config
    : never
export type ResolvedConfigOf<L> = L extends Language<infer _Ast, infer _Token, infer _Config, infer Resolved, infer _Source>
    ? Resolved
    : never
export type ParserConfigOf<L> = Defined<LanguageConfigOf<L>['parser']>
export type TokenConfigOf<L> = Defined<LanguageConfigOf<L>['tokens']>
export type SourceConfigOf<L> = Defined<LanguageConfigOf<L>['source']>
export interface FormatOptions<L extends AnyLanguage> {
    filepath?: string
    language?: L
    parser?: ParserConfigOf<L>
    tokens?: TokenConfigOf<L>
    source?: SourceConfigOf<L>
}
