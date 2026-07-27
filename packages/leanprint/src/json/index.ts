import Parser from './Parser.js'
import SourcePrinter from './SourcePrinter.js'
import TokenPrinter from './TokenPrinter.js'
import { resolveJsonConfig } from './config.js'

const defaults = resolveJsonConfig()

export const json = {
    id: 'json',
    extensions: Object.freeze(['.json']),
    parser: new Parser(),
    tokenPrinter: new TokenPrinter(),
    sourcePrinter: new SourcePrinter(),
    defaults,
    resolveConfig: resolveJsonConfig,
    sourceConfig(config: typeof defaults) {
        return config.source
    },
}

export * from './tokens.js'
export * from './types.js'
export { jsonConfigSchema, resolveJsonConfig } from './config.js'
