export { format, defineLanguage, getLanguage, getLanguageForFilepath, getLanguages, registerLanguage } from './api.js'
export { ecmascript, ecmascriptConfigSchema, resolveEcmascriptConfig } from './ecmascript/index.js'
export type {
    EcmascriptConfig,
    ResolvedEcmascriptConfig,
    EcmascriptParserOptions,
    EcmascriptTokenOptions,
    EcmascriptSourceOptions,
} from './ecmascript/types.js'
export * from './types.js'
export * from './errors.js'
