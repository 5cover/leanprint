export interface EcmascriptParserConfig {
    sourceType: 'unambiguous' | 'module' | 'script'
    filepath?: string
    plugins?: string[]
}
export interface EcmascriptTokenConfig {
    semicolons: boolean
    trailingCommas: boolean
    collapseSingleStatementBlocks: boolean
    parentheses: 'required-only'
    filepath?: string
}
export interface EcmascriptSourceConfig {
    indent: number
    lineWrapping: boolean
    maxEmptyLines: number
    spaceAroundOperators: boolean
    spaceAfterControlKeywords: boolean
    lineEnding: 'lf' | 'crlf'
    semicolons?: boolean
}
export const parserDefaults: EcmascriptParserConfig = { sourceType: 'unambiguous' }
export const tokenDefaults: EcmascriptTokenConfig = {
    semicolons: false,
    trailingCommas: false,
    collapseSingleStatementBlocks: true,
    parentheses: 'required-only',
}
export const sourceDefaults: EcmascriptSourceConfig = {
    indent: 2,
    lineWrapping: false,
    maxEmptyLines: 1,
    spaceAroundOperators: false,
    spaceAfterControlKeywords: false,
    lineEnding: 'lf',
    semicolons: false,
}
