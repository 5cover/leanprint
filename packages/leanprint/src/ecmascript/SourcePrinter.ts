import type { SourcePrinter as Contract } from '../types.js'
import type { EcmascriptSourceConfig } from './types.js'
import { requiredSeparator, tokenText } from './lexical.js'
import type { ConcreteToken, Token } from './tokens.js'
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
    '<<=',
    '>>=',
    '>>>=',
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
const hazardousStarts = new Set(['(', '[', '`', 'regex', '+', '-', '*'])
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
                const lineStartIndex = Math.max(out.lastIndexOf('\n'), out.lastIndexOf('\r')) + 1
                let separator = requiredSeparator(previous, concrete, out.slice(lineStartIndex))
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
            write(tokenText(concrete))
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
