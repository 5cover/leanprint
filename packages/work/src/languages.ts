import { format, getLanguageForFilepath } from 'leanprint'
import type { ResolvedSourceConfig } from './types.js'

export interface ConfiguredLanguage {
    readonly id: string
    leanify(source: string, filepath: string): string
}

export function configuredLanguage(filepath: string, config: ResolvedSourceConfig): ConfiguredLanguage | undefined {
    const language = getLanguageForFilepath(filepath)
    if (!language) return undefined
    const languageConfig = config.languages[language.id]
    if (!languageConfig) return undefined
    return {
        id: language.id,
        leanify(source, resolvedFilepath) {
            return format(source, {
                filepath: resolvedFilepath,
                language,
                parser: languageConfig.parser,
                tokens: languageConfig.tokens,
                source: languageConfig.source,
            })
        },
    }
}
