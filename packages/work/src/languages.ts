import { format, getLanguageForFilepath, type AnyLanguage, type ResolvedLanguageConfig } from 'leanprint'
import type { ResolvedSourceConfig } from './types.js'

export interface ConfiguredLanguage {
    language: AnyLanguage
    config: ResolvedLanguageConfig
}

export function configuredLanguage(filepath: string, config: ResolvedSourceConfig): ConfiguredLanguage | undefined {
    const language = getLanguageForFilepath(filepath)
    if (!language) return undefined
    const languageConfig = config.languages[language.id]
    return languageConfig ? { language, config: languageConfig } : undefined
}

export function leanify(source: string, filepath: string, configured: ConfiguredLanguage): string {
    return format(source, {
        filepath,
        language: configured.language,
        parser: configured.config.parser,
        tokens: configured.config.tokens,
        source: configured.config.source,
    })
}
