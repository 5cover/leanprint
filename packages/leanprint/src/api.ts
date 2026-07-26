import { extname } from 'node:path'
import { UnsupportedLanguageError } from './errors.js'
import { ecmascript } from './ecmascript/index.js'
import type { EcmascriptConfig } from './ecmascript/types.js'
import type { AnyLanguage, FormatOptions } from './types.js'

type EcmascriptFormatOptions = {
    filepath: string
    language?: typeof ecmascript
    parser?: NonNullable<EcmascriptConfig['parser']>
    tokens?: NonNullable<EcmascriptConfig['tokens']>
    source?: NonNullable<EcmascriptConfig['source']>
}

const languages = new Map<string, AnyLanguage>([[ecmascript.id, ecmascript]])

export const defineLanguage = <L extends AnyLanguage>(language: L): L => language

export function registerLanguage<L extends AnyLanguage>(language: L): void {
    if (languages.has(language.id)) throw new Error(`Language "${language.id}" is already registered.`)
    languages.set(language.id, language)
}

export function getLanguage(id: string): AnyLanguage | undefined {
    return languages.get(id)
}

export function getLanguages(): readonly AnyLanguage[] {
    return [...languages.values()]
}

export function getLanguageForFilepath(filepath: string): AnyLanguage | undefined {
    const extension = extname(filepath).toLowerCase()
    return [...languages.values()].find(language => language.extensions.includes(extension))
}

export function format<L extends AnyLanguage>(
    source: string,
    options: FormatOptions<L> & { language: L }
): string
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
