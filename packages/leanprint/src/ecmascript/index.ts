import Parser from './Parser.js'
import TokenPrinter from './TokenPrinter.js'
import SourcePrinter from './SourcePrinter.js'
import { resolveEcmascriptConfig } from './config.js'
const defaults = resolveEcmascriptConfig()
export const ecmascript = {
    id: 'ecmascript',
    extensions: Object.freeze(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']),
    parser: new Parser(),
    tokenPrinter: new TokenPrinter(),
    sourcePrinter: new SourcePrinter(),
    defaults,
    resolveConfig: resolveEcmascriptConfig,
    sourceConfig(config: typeof defaults) {
        return { ...config.source, semicolons: config.tokens.semicolons }
    },
}
export * from './tokens.js'
export * from './types.js'
export * from './parentheses.js'
export * from './lexical.js'
export { ecmascriptConfigSchema, resolveEcmascriptConfig } from './config.js'
