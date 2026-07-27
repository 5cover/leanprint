import type { SourcePrinter as Contract } from '../types.js'
import type { JsonToken } from './tokens.js'
import type { JsonSourceConfig } from './types.js'

const unsafeLiteral = /[\p{C}\p{Zl}\p{Zp}]/u

function unicodeEscape(value: string): string {
    let result = ''
    for (let index = 0; index < value.length; index++)
        result += `\\u${value.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
    return result
}

function quote(value: string): string {
    let result = '"'
    for (const character of value) {
        switch (character) {
            case '"':
                result += '\\"'
                break
            case '\\':
                result += '\\\\'
                break
            case '\b':
                result += '\\b'
                break
            case '\f':
                result += '\\f'
                break
            case '\n':
                result += '\\n'
                break
            case '\r':
                result += '\\r'
                break
            case '\t':
                result += '\\t'
                break
            default:
                result += unsafeLiteral.test(character) ? unicodeEscape(character) : character
        }
    }
    return `${result}"`
}

export default class SourcePrinter implements Contract<JsonToken, JsonSourceConfig> {
    print(input: Iterable<JsonToken>, config: JsonSourceConfig): string {
        const eol = config.lineEnding === 'crlf' ? '\r\n' : '\n'
        const containers: { kind: 'object' | 'array'; expanded: boolean }[] = []
        let output = '',
            indent = 0,
            lineStart = true as boolean // assertion prevents false-positive control-flow narrowing across helpers

        const write = (value: string) => {
            if (lineStart) {
                output += ' '.repeat(indent * config.indent)
                lineStart = false
            }
            output += value
        }
        const newline = () => {
            output += eol
            lineStart = true
        }

        for (const token of input) {
            switch (token.type) {
                case 'container-start': {
                    const expanded = token.complexity > config.inlineComplexity
                    write(token.kind === 'object' ? '{' : '[')
                    containers.push({ kind: token.kind, expanded })
                    if (expanded) {
                        indent++
                        newline()
                    }
                    break
                }
                case 'container-end': {
                    const container = containers.pop()
                    if (!container || container.kind !== token.kind)
                        throw new Error(`Unbalanced JSON ${token.kind} token stream.`)
                    if (container.expanded) {
                        indent--
                        if (!lineStart) newline()
                    }
                    write(token.kind === 'object' ? '}' : ']')
                    break
                }
                case 'comma':
                    write(',')
                    if (containers.at(-1)?.expanded) newline()
                    break
                case 'colon':
                    write(':')
                    break
                case 'string':
                    write(quote(token.value))
                    break
                case 'number':
                    write(token.value)
                    break
                case 'boolean':
                    write(token.value ? 'true' : 'false')
                    break
                case 'null':
                    write('null')
                    break
            }
        }
        if (containers.length) throw new Error('Unbalanced JSON token stream.')
        if (!lineStart) newline()
        return output
    }
}
