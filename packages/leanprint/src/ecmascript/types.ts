import type { EcmascriptConfig } from './EcmascriptConfig.generated.js'
export type EcmascriptParserOptions = NonNullable<EcmascriptConfig['parser']>
export type EcmascriptTokenOptions = NonNullable<EcmascriptConfig['tokens']>
export type EcmascriptSourceOptions = NonNullable<EcmascriptConfig['source']>
export interface EcmascriptParserConfig extends EcmascriptParserOptions {
    sourceType: NonNullable<EcmascriptParserOptions['sourceType']>
    plugins?: string[]
    filepath?: string
}
export interface EcmascriptTokenConfig extends EcmascriptTokenOptions {
    semicolons: boolean
    collapseSingleStatementBlocks: boolean
    filepath?: string
}
export interface EcmascriptSourceConfig extends EcmascriptSourceOptions {
    indent: number
    spaceAroundOperators: boolean
    spaceAfterControlKeywords: boolean
    lineEnding: 'lf' | 'crlf'
    semicolons?: boolean
}
export interface ResolvedEcmascriptConfig {
    parser: EcmascriptParserOptions & {
        sourceType: NonNullable<EcmascriptParserOptions['sourceType']>
        plugins: string[]
    }
    tokens: EcmascriptTokenOptions & {
        semicolons: boolean
        collapseSingleStatementBlocks: boolean
    }
    source: EcmascriptSourceOptions & {
        indent: number
        spaceAroundOperators: boolean
        spaceAfterControlKeywords: boolean
        lineEnding: 'lf' | 'crlf'
    }
}
export type { EcmascriptConfig } from './EcmascriptConfig.generated.js'
