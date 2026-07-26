import { extname } from 'node:path'
import { InvalidConfigError, UnsupportedLanguageError } from './errors.js'
import { ecmascript } from './ecmascript/index.js'
import type { FormatOptions, Language } from './types.js'
type AnyLanguage = Language<any, any, any, any, any>
const languages = new Map<string, AnyLanguage>([[ecmascript.id, ecmascript]])
export const defineLanguage = <L extends AnyLanguage>(language: L): L => language
export function registerLanguage(language: AnyLanguage): void {
    if (languages.has(language.id)) throw new Error(`Language "${language.id}" is already registered.`)
    languages.set(language.id, language)
}
export function getLanguage(id: string): AnyLanguage | undefined {
    return languages.get(id)
}
function validate(source: Record<string, unknown>): void {
    if (source.indent !== undefined && (!Number.isInteger(source.indent) || Number(source.indent) < 0))
        throw new InvalidConfigError('source.indent must be a non-negative integer.')
    if (
        source.maxEmptyLines !== undefined &&
        (!Number.isInteger(source.maxEmptyLines) || Number(source.maxEmptyLines) < 0)
    )
        throw new InvalidConfigError('source.maxEmptyLines must be a non-negative integer.')
}
/** Leanify valid source into deterministic compact source. */
export function format(source: string, options: FormatOptions = {}): string {
    let language: AnyLanguage | undefined
    if (options.language) language = languages.get(options.language)
    else if (options.filepath) {
        const extension = extname(options.filepath).toLowerCase()
        language = [...languages.values()].find(item => item.extensions.includes(extension))
        if (!language)
            throw new UnsupportedLanguageError(
                `Unsupported file extension "${extension || '(none)'}" for ${options.filepath}.`
            )
    } else throw new UnsupportedLanguageError('Specify options.language or options.filepath to determine a language.')
    if (!language) throw new UnsupportedLanguageError(`Unsupported language "${options.language}".`)
    validate(options.source ?? {})
    const parser = {
            ...language.defaults.parser,
            ...options.parser,
            ...(options.filepath ? { filepath: options.filepath } : {}),
        },
        tokens = {
            ...language.defaults.tokens,
            ...options.tokens,
            ...(options.filepath ? { filepath: options.filepath } : {}),
        },
        sourceConfig = {
            ...language.defaults.source,
            ...options.source,
            semicolons: (options.tokens?.semicolons ?? language.defaults.tokens.semicolons) as boolean,
        }
    const ast = language.parser.parse(source, parser),
        stream = language.tokenPrinter.print(ast, tokens)
    return language.sourcePrinter.print(stream, sourceConfig)
}
