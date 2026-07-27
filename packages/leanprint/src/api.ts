import { extname } from 'node:path'
import { UnsupportedLanguageError } from './errors.js'
import { ecmascript } from './ecmascript/index.js'
import { json } from './json/index.js'
import type { AnyLanguage, FormatOptions } from './types.js'

type EcmascriptFormatOptions = {
    filepath: string
    language?: never
    parser?: never
    tokens?: never
    source?: never
}

const languages = new Map<string, AnyLanguage>()
const languagesByExtension = new Map<string, AnyLanguage>()

function addLanguage(language: AnyLanguage): void {
    if (languages.has(language.id)) throw new Error(`Language "${language.id}" is already registered.`)
    for (const extension of language.extensions) {
        const normalized = extension.toLowerCase()
        const owner = languagesByExtension.get(normalized)
        if (owner)
            throw new Error(
                `Extension "${normalized}" is already registered by language "${owner.id}" and cannot also belong to "${language.id}".`
            )
    }
    languages.set(language.id, language)
    for (const extension of language.extensions) languagesByExtension.set(extension.toLowerCase(), language)
}

addLanguage(ecmascript)
addLanguage(json)

export const defineLanguage = <L extends AnyLanguage>(language: L): L => language

export function registerLanguage(language: AnyLanguage): void {
    addLanguage(language)
}

export function getLanguage(id: string): AnyLanguage | undefined {
    return languages.get(id)
}

export function getLanguages(): readonly AnyLanguage[] {
    return [...languages.values()]
}

export function getLanguageForFilepath(filepath: string): AnyLanguage | undefined {
    const extension = extname(filepath).toLowerCase()
    return languagesByExtension.get(extension)
}

export function format<L extends AnyLanguage>(source: string, options: FormatOptions<L> & { language: L }): string
export function format(source: string, options: EcmascriptFormatOptions): string
export function format(
    source: string,
    options: {
        filepath?: string
        language?: AnyLanguage
        parser?: object
        tokens?: object
        source?: object
    }
): string {
    let language: AnyLanguage | undefined = options.language
    if (!language && options.filepath) language = getLanguageForFilepath(options.filepath)
    if (!language) {
        if (options.filepath) {
            const extension = extname(options.filepath).toLowerCase()
            throw new UnsupportedLanguageError(
                `Unsupported file extension "${extension || '(none)'}" for ${options.filepath}.`
            )
        }
        throw new UnsupportedLanguageError('Specify options.language or options.filepath to determine a language.')
    }
    const resolved = language.resolveConfig({
        ...(options.parser ? { parser: options.parser } : {}),
        ...(options.tokens ? { tokens: options.tokens } : {}),
        ...(options.source ? { source: options.source } : {}),
    })
    const filepath = options.filepath
    const ast = language.parser.parse(source, { ...resolved.parser, ...(filepath ? { filepath } : {}) })
    const stream = language.tokenPrinter.print(ast, { ...resolved.tokens, ...(filepath ? { filepath } : {}) })
    return language.sourcePrinter.print(stream, language.sourceConfig(resolved))
}
