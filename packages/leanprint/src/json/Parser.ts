import { parse } from '@humanwhocodes/momoa'
import { ParseError } from '../errors.js'
import type { Parser as Contract } from '../types.js'
import type { JsonDocument, JsonParserConfig } from './types.js'

export default class Parser implements Contract<JsonDocument, JsonParserConfig> {
    parse(source: string, config: JsonParserConfig): JsonDocument {
        const filepath = config.filepath ?? 'input.json'
        try {
            return {
                document: parse(source, { mode: 'json', allowTrailingCommas: false, ranges: true }),
                source,
            }
        } catch (error) {
            const e = error as Error & { line?: number; column?: number }
            const location =
                e.line === undefined || e.column === undefined ? '' : `:${String(e.line)}:${String(e.column)}`
            throw new ParseError(`Could not parse ${filepath}${location}: ${e.message}`, { cause: error })
        }
    }
}
