import type { SourcePrinter as Contract } from '../types.js'
import type { EcmascriptSourceConfig } from './types.js'
import { isSymbolToken, isWordToken, type ConcreteToken, type Token } from './tokens.js'
const operatorTypes = new Set([
    '+',
    '-',
    '*',
    '/',
    '%',
    '**',
    '=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '==',
    '!=',
    '===',
    '!==',
    '<',
    '>',
    '<=',
    '>=',
    '<<',
    '>>',
    '>>>',
    '&',
    '|',
    '^',
    '&&',
    '||',
    '??',
    '=>',
    'in',
    'of',
    'instanceof',
    'as',
    'satisfies',
])
const hazardousStarts = new Set(['(', '[', '`', 'regex', '+', '-'])
const unsafePairs = new Set([
    '++',
    '--',
    '//',
    '/*',
    '<<',
    '>>',
    '?.',
    '**',
    '&&',
    '||',
    '??',
    '=>',
    '==',
    '!=',
    '<=',
    '>=',
    '${',
    '+++',
    '---',
])
function text(token: ConcreteToken): string {
    switch (token.type) {
        case 'ident':
        case 'private-ident':
        case 'number-literal':
        case 'bigint-literal':
        case 'string-literal':
        case 'template-chunk':
        case 'jsx-text':
            return token.type === 'private-ident' ? `#${token.value}` : token.value
        case 'regex':
            return `/${token.pattern}/${token.flags}`
        case 'comment':
            return token.kind === 'line' ? `//${token.value}` : `/*${token.value}*/`
        case 'shebang':
            return `#!${token.value}`
        default:
            return token.type
    }
}
export function requiredSeparator(previous: ConcreteToken, next: ConcreteToken): '' | ' ' {
    if (previous.type === 'comment' || previous.type === 'shebang') return ''
    if (isWordToken(previous) && isWordToken(next)) return ' '
    if (['return', 'throw', 'yield', 'await', 'new', 'delete', 'void', 'typeof'].includes(previous.type)) return ' '
    const a = text(previous),
        b = text(next)
    if (
        isSymbolToken(previous) &&
        isSymbolToken(next) &&
        (unsafePairs.has(a + b) || (/[+\-<>&|=?*/]/.test(a.at(-1) ?? '') && a.at(-1) === b[0]))
    )
        return ' '
    if (
        (previous.type === 'number-literal' && next.type === '.') ||
        (previous.type === '/' && (next.type === '/' || next.type === '*'))
    )
        return ' '
    return ''
}
export default class SourcePrinter implements Contract<Token, EcmascriptSourceConfig> {
    print(input: Iterable<Token>, config: EcmascriptSourceConfig): string {
        const tokens = [...input],
            eol = config.lineEnding === 'crlf' ? '\r\n' : '\n'
        let out = '',
            indent = 0,
            lineStart = true,
            previous: ConcreteToken | undefined,
            pendingLine = false,
            pendingBoundary: undefined | 'normal' | 'required'
        const newline = () => {
            out = out.replace(/[ \t]+$/u, '')
            if (!out.endsWith(eol)) out += eol
            lineStart = true
            previous = undefined
        }
        const write = (value: string) => {
            if (lineStart) {
                out += ' '.repeat(indent * config.indent)
                lineStart = false
            }
            out += value
        }
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]!
            if (token.type === 'indent') {
                indent++
                continue
            }
            if (token.type === 'dedent') {
                indent = Math.max(0, indent - 1)
                if (!lineStart) newline()
                continue
            }
            if (token.type === 'line') {
                pendingLine = true
                continue
            }
            if (token.type === 'statement-boundary') {
                pendingBoundary = token.mode
                continue
            }
            const concrete = token as ConcreteToken
            if (pendingBoundary) {
                const defensive =
                    pendingBoundary === 'required' || config.semicolons === true || hazardousStarts.has(concrete.type)
                if (defensive) write(';')
                newline()
                pendingBoundary = undefined
                pendingLine = false
            } else if (pendingLine) {
                newline()
                pendingLine = false
            }
            if (previous) {
                let separator = requiredSeparator(previous, concrete)
                if (
                    config.spaceAroundOperators &&
                    (operatorTypes.has(previous.type) || operatorTypes.has(concrete.type))
                )
                    separator = ' '
                if (
                    config.spaceAfterControlKeywords &&
                    ['if', 'for', 'while', 'switch', 'catch'].includes(previous.type) &&
                    concrete.type === '('
                )
                    separator = ' '
                if (separator) write(separator)
            }
            write(text(concrete))
            if ((concrete.type === 'comment' && concrete.kind === 'line') || concrete.type === 'shebang') newline()
            else previous = concrete
        }
        if (pendingBoundary) {
            if (pendingBoundary === 'required' || config.semicolons === true) write(';')
            newline()
        } else if (pendingLine) newline()
        return out.replace(/[ \t]+(?:\r?\n)/gu, eol).replace(/(?:\r?\n)+$/u, '') + eol
    }
}
