import type { IdentifierNode, ValueNode } from '@humanwhocodes/momoa'
import { UnsupportedNodeError } from '../errors.js'
import type { TokenPrinter as Contract } from '../types.js'
import type { JsonToken } from './tokens.js'
import type { JsonDocument, JsonTokenConfig } from './types.js'

export default class TokenPrinter implements Contract<JsonDocument, JsonToken, JsonTokenConfig> {
    *print(ast: JsonDocument, _config: JsonTokenConfig): Iterable<JsonToken> {
        yield* this.value(ast.document.body, ast.source)
    }

    private complexity(node: ValueNode): number {
        switch (node.type) {
            case 'Array':
                return node.elements.reduce((total, element) => total + this.complexity(element.value), 0)
            case 'Object':
                return node.members.reduce((total, member) => total + 1 + this.complexity(member.value), 0)
            case 'Boolean':
            case 'Null':
            case 'Number':
            case 'String':
                return 1
            default:
                throw new UnsupportedNodeError(`Unsupported JSON node "${node.type}".`)
        }
    }

    private *value(node: ValueNode, source: string): Iterable<JsonToken> {
        switch (node.type) {
            case 'Array':
                yield { type: 'container-start', kind: 'array', complexity: this.complexity(node) }
                for (const [index, element] of node.elements.entries()) {
                    if (index) yield { type: 'comma' }
                    yield* this.value(element.value, source)
                }
                yield { type: 'container-end', kind: 'array' }
                return
            case 'Object':
                yield { type: 'container-start', kind: 'object', complexity: this.complexity(node) }
                for (const [index, member] of node.members.entries()) {
                    if (index) yield { type: 'comma' }
                    if (member.name.type !== 'String') this.unsupportedIdentifier(member.name)
                    yield { type: 'string', value: member.name.value }
                    yield { type: 'colon' }
                    yield* this.value(member.value, source)
                }
                yield { type: 'container-end', kind: 'object' }
                return
            case 'String':
                yield { type: 'string', value: node.value }
                return
            case 'Number':
                yield { type: 'number', value: source.slice(node.loc.start.offset, node.loc.end.offset) }
                return
            case 'Boolean':
                yield { type: 'boolean', value: node.value }
                return
            case 'Null':
                yield { type: 'null' }
                return
            default:
                throw new UnsupportedNodeError(`Unsupported JSON node "${node.type}".`)
        }
    }

    private unsupportedIdentifier(node: IdentifierNode): never {
        throw new UnsupportedNodeError(`Unsupported JSON object key "${node.name}".`)
    }
}
