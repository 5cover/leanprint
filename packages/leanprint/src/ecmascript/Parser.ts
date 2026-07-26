import { parse, type ParseResult, type ParserOptions } from '@babel/parser'
import type { File } from '@babel/types'
import { ParseError } from '../errors.js'
import type { Parser as ParserContract } from '../types.js'
import type { EcmascriptParserConfig } from './types.js'
export default class Parser implements ParserContract<ParseResult<File>, EcmascriptParserConfig> {
    parse(source: string, config: EcmascriptParserConfig): ParseResult<File> {
        const path = config.filepath ?? 'input.js',
            lower = path.toLowerCase(),
            ts = /\.(?:ts|tsx|mts|cts)$/.test(lower),
            jsx = /\.(?:jsx|tsx)$/.test(lower)
        const plugins = [
            ...(ts ? ['typescript'] : []),
            ...(jsx ? ['jsx'] : []),
            'decorators-legacy',
            'importAttributes',
            'explicitResourceManagement',
        ] as NonNullable<ParserOptions['plugins']>
        try {
            return parse(source, {
                sourceType: config.sourceType,
                sourceFilename: path,
                plugins,
                allowAwaitOutsideFunction: true,
                allowReturnOutsideFunction: config.sourceType !== 'module',
                attachComment: true,
            })
        } catch (error) {
            const e = error as Error & { loc?: { line: number; column: number } }
            throw new ParseError(
                `Could not parse ${path}${e.loc ? `:${e.loc.line}:${e.loc.column + 1}` : ''}: ${e.message}`,
                { cause: error }
            )
        }
    }
}
