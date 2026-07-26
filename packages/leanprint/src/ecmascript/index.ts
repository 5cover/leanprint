import Parser from './Parser.js'
import TokenPrinter from './TokenPrinter.js'
import SourcePrinter from './SourcePrinter.js'
import { parserDefaults, sourceDefaults, tokenDefaults } from './types.js'
export const ecmascript = {
    id: 'ecmascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    parser: new Parser(),
    tokenPrinter: new TokenPrinter(),
    sourcePrinter: new SourcePrinter(),
    defaults: { parser: parserDefaults, tokens: tokenDefaults, source: sourceDefaults },
}
export * from './tokens.js'
export * from './types.js'
export * from './parentheses.js'
