import type { DocumentNode } from '@humanwhocodes/momoa'
import type { JsonConfig } from './JsonConfig.generated.js'

export interface JsonDocument {
    document: DocumentNode
    source: string
}

export type JsonParserOptions = NonNullable<JsonConfig['parser']>
export type JsonTokenOptions = NonNullable<JsonConfig['tokens']>
export type JsonSourceOptions = NonNullable<JsonConfig['source']>

export interface JsonParserConfig extends JsonParserOptions {
    filepath?: string
}

export interface JsonTokenConfig extends JsonTokenOptions {
    filepath?: string
}

export interface JsonSourceConfig extends JsonSourceOptions {
    indent: number
    inlineComplexity: number
    lineEnding: 'lf' | 'crlf'
}

export interface ResolvedJsonConfig {
    parser: JsonParserOptions
    tokens: JsonTokenOptions
    source: JsonSourceOptions & {
        indent: number
        inlineComplexity: number
        lineEnding: 'lf' | 'crlf'
    }
}

export type { JsonConfig } from './JsonConfig.generated.js'
