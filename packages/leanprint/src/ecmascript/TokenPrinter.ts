import type * as t from '@babel/types'
import { UnsupportedNodeError } from '../errors.js'
import { needsParentheses, type ExpressionPosition } from './parentheses.js'
import type { EcmascriptTokenConfig } from './types.js'
import type { FixedTokenType, Token } from './tokens.js'
type Ctx = { parent?: t.Node; position?: ExpressionPosition }
export default class TokenPrinter {
    private config!: EcmascriptTokenConfig;
    *print(file: t.File, config: EcmascriptTokenConfig): Iterable<Token> {
        this.config = config
        if (file.program.interpreter) yield { type: 'shebang', value: file.program.interpreter.value }
        yield* this.node(file.program, {})
    }
    private fixed(value: string): Token {
        return { type: value as FixedTokenType }
    }
    private *list(nodes: readonly (t.Node | null)[], separator = ','): Iterable<Token> {
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i]
            if (n) yield* this.node(n, {})
            if (i < nodes.length - 1) yield this.fixed(separator)
        }
    }
    private *comments(node: t.Node): Iterable<Token> {
        for (const c of node.leadingComments ?? [])
            yield { type: 'comment', kind: c.type === 'CommentLine' ? 'line' : 'block', value: c.value }
    }
    private *expr(node: t.Expression, parent: t.Node, position: ExpressionPosition): Iterable<Token> {
        const parens = needsParentheses(node, parent, position)
        if (parens) yield this.fixed('(')
        yield* this.node(node, { parent, position })
        if (parens) yield this.fixed(')')
    }
    private *block(node: t.BlockStatement): Iterable<Token> {
        yield this.fixed('{')
        if (node.body.length) {
            yield { type: 'line', kind: 'hard' }
            yield { type: 'indent' }
            for (const s of node.body) yield* this.node(s, {})
            yield { type: 'dedent' }
        }
        yield this.fixed('}')
    }
    private canCollapse(node: t.Statement): boolean {
        return (
            this.config.collapseSingleStatementBlocks &&
            node.type === 'BlockStatement' &&
            node.body.length === 1 &&
            !['VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'IfStatement'].includes(
                node.body[0]!.type
            ) &&
            !node.body[0]!.leadingComments?.length
        )
    }
    private *body(node: t.Statement): Iterable<Token> {
        if (this.canCollapse(node)) yield* this.node((node as t.BlockStatement).body[0]!, {})
        else yield* this.node(node, {})
    }
    private *node(node: t.Node, _ctx: Ctx): Iterable<Token> {
        yield* this.comments(node)
        switch (node.type) {
            case 'Program':
                for (const s of node.body) yield* this.node(s, {})
                return
            case 'Identifier':
                yield { type: 'ident', value: node.name }
                if (node.optional) yield this.fixed('?')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'PrivateName':
                yield { type: 'private-ident', value: (node.id as t.Identifier).name }
                return
            case 'StringLiteral':
                yield { type: 'string-literal', value: JSON.stringify(node.value) }
                return
            case 'NumericLiteral':
                yield { type: 'number-literal', value: String(node.value) }
                return
            case 'BigIntLiteral':
                yield { type: 'bigint-literal', value: `${node.value}n` }
                return
            case 'BooleanLiteral':
                yield this.fixed(String(node.value))
                return
            case 'NullLiteral':
                yield this.fixed('null')
                return
            case 'RegExpLiteral':
                yield { type: 'regex', pattern: node.pattern, flags: node.flags }
                return
            case 'ExpressionStatement':
                yield* this.expr(node.expression, node, 'other')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'BlockStatement':
                yield* this.block(node)
                return
            case 'EmptyStatement':
                yield { type: 'statement-boundary', mode: 'required' }
                return
            case 'VariableDeclaration':
                yield this.fixed(node.kind)
                for (let i = 0; i < node.declarations.length; i++) {
                    if (i) yield this.fixed(',')
                    yield* this.node(node.declarations[i]!, {})
                }
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'VariableDeclarator':
                yield* this.node(node.id, {})
                if (node.init) {
                    yield this.fixed('=')
                    yield* this.expr(node.init, node, 'right')
                }
                return
            case 'ReturnStatement':
                yield this.fixed('return')
                if (node.argument) yield* this.expr(node.argument, node, 'argument')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ThrowStatement':
                yield this.fixed('throw')
                yield* this.expr(node.argument, node, 'argument')
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'BreakStatement':
                yield this.fixed('break')
                if (node.label) yield* this.node(node.label, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ContinueStatement':
                yield this.fixed('continue')
                if (node.label) yield* this.node(node.label, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'IfStatement':
                yield this.fixed('if')
                yield this.fixed('(')
                yield* this.expr(node.test, node, 'test')
                yield this.fixed(')')
                yield* this.body(node.consequent)
                if (node.alternate) {
                    yield this.fixed('else')
                    yield* this.body(node.alternate)
                }
                if (node.consequent.type === 'BlockStatement' && !node.alternate) yield { type: 'line', kind: 'hard' }
                return
            case 'WhileStatement':
                yield this.fixed('while')
                yield this.fixed('(')
                yield* this.expr(node.test, node, 'test')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'DoWhileStatement':
                yield this.fixed('do')
                yield* this.body(node.body)
                yield this.fixed('while')
                yield this.fixed('(')
                yield* this.expr(node.test, node, 'test')
                yield this.fixed(')')
                yield { type: 'statement-boundary', mode: 'required' }
                return
            case 'ForStatement':
                yield this.fixed('for')
                yield this.fixed('(')
                if (node.init) yield* this.node(node.init, {})
                if (node.init?.type !== 'VariableDeclaration') yield this.fixed(';')
                if (node.test) yield* this.expr(node.test, node, 'test')
                yield this.fixed(';')
                if (node.update) yield* this.expr(node.update, node, 'right')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'ForInStatement':
            case 'ForOfStatement':
                yield this.fixed(node.type === 'ForOfStatement' && node.await ? 'await' : 'for')
                yield this.fixed('(')
                yield* this.node(node.left, {})
                yield this.fixed(node.type === 'ForOfStatement' ? 'of' : 'in')
                yield* this.expr(node.right, node, 'right')
                yield this.fixed(')')
                yield* this.body(node.body)
                yield { type: 'line', kind: 'hard' }
                return
            case 'FunctionDeclaration':
            case 'FunctionExpression':
                if (node.async) yield this.fixed('async')
                yield this.fixed('function')
                if (node.generator) yield this.fixed('*')
                if (node.id) yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                yield* this.block(node.body)
                if (node.type === 'FunctionDeclaration') yield { type: 'line', kind: 'hard' }
                return
            case 'ArrowFunctionExpression':
                if (node.async) yield this.fixed('async')
                if (node.params.length === 1 && node.params[0]?.type === 'Identifier' && !node.params[0].typeAnnotation)
                    yield* this.node(node.params[0], {})
                else {
                    yield this.fixed('(')
                    yield* this.list(node.params)
                    yield this.fixed(')')
                }
                if (node.returnType) yield* this.node(node.returnType, {})
                yield this.fixed('=>')
                if (node.body.type === 'ObjectExpression') {
                    yield this.fixed('(')
                    yield* this.node(node.body, {})
                    yield this.fixed(')')
                } else yield* this.node(node.body, {})
                return
            case 'CallExpression':
            case 'OptionalCallExpression':
                yield* this.expr(node.callee as t.Expression, node, 'callee')
                if (node.type === 'OptionalCallExpression' && node.optional) yield this.fixed('?.')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.arguments as t.Node[])
                yield this.fixed(')')
                return
            case 'NewExpression':
                yield this.fixed('new')
                yield* this.expr(node.callee as t.Expression, node, 'callee')
                yield this.fixed('(')
                yield* this.list(node.arguments as t.Node[])
                yield this.fixed(')')
                return
            case 'MemberExpression':
            case 'OptionalMemberExpression':
                yield* this.expr(node.object as t.Expression, node, 'object')
                if (node.computed) {
                    if (node.optional) yield this.fixed('?.')
                    yield this.fixed('[')
                    yield* this.node(node.property, {})
                    yield this.fixed(']')
                } else {
                    yield this.fixed(node.optional ? '?.' : '.')
                    yield* this.node(node.property, {})
                }
                return
            case 'BinaryExpression':
            case 'LogicalExpression':
                yield* this.expr(node.left as t.Expression, node, 'left')
                yield this.fixed(node.operator)
                yield* this.expr(node.right, node, 'right')
                return
            case 'AssignmentExpression':
                yield* this.node(node.left, {})
                yield this.fixed(node.operator)
                yield* this.expr(node.right, node, 'right')
                return
            case 'UnaryExpression':
                yield this.fixed(node.operator)
                yield* this.expr(node.argument, node, 'argument')
                return
            case 'UpdateExpression':
                if (node.prefix) yield this.fixed(node.operator)
                yield* this.node(node.argument, {})
                if (!node.prefix) yield this.fixed(node.operator)
                return
            case 'ConditionalExpression':
                yield* this.expr(node.test, node, 'test')
                yield this.fixed('?')
                yield* this.expr(node.consequent, node, 'right')
                yield this.fixed(':')
                yield* this.expr(node.alternate, node, 'right')
                return
            case 'SequenceExpression':
                yield* this.list(node.expressions)
                return
            case 'AwaitExpression':
                yield this.fixed('await')
                yield* this.expr(node.argument, node, 'argument')
                return
            case 'YieldExpression':
                yield this.fixed('yield')
                if (node.delegate) yield this.fixed('*')
                if (node.argument) yield* this.expr(node.argument, node, 'argument')
                return
            case 'ThisExpression':
                yield this.fixed('this')
                return
            case 'Super':
                yield this.fixed('super')
                return
            case 'ArrayExpression':
                yield this.fixed('[')
                yield* this.list(node.elements)
                yield this.fixed(']')
                return
            case 'ObjectExpression':
                yield this.fixed('{')
                yield* this.list(node.properties)
                yield this.fixed('}')
                return
            case 'ObjectProperty':
                if (node.computed) {
                    yield this.fixed('[')
                    yield* this.node(node.key, {})
                    yield this.fixed(']')
                } else yield* this.node(node.key, {})
                if (node.shorthand) return
                yield this.fixed(':')
                yield* this.node(node.value, {})
                return
            case 'ObjectMethod':
                if (node.async) yield this.fixed('async')
                if (node.kind !== 'method') yield this.fixed(node.kind)
                if (node.generator) yield this.fixed('*')
                yield* this.node(node.key, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                yield* this.block(node.body)
                return
            case 'ClassDeclaration':
            case 'ClassExpression':
                if ('abstract' in node && node.abstract) yield this.fixed('abstract')
                yield this.fixed('class')
                if (node.id) yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                if (node.superClass) {
                    yield this.fixed('extends')
                    yield* this.node(node.superClass, {})
                }
                if (node.implements?.length) {
                    yield this.fixed('implements')
                    yield* this.list(node.implements)
                }
                yield* this.node(node.body, {})
                if (node.type === 'ClassDeclaration') yield { type: 'line', kind: 'hard' }
                return
            case 'ClassBody':
                yield this.fixed('{')
                if (node.body.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const member of node.body) {
                        yield* this.node(member, {})
                        if (!['ClassMethod', 'ClassPrivateMethod'].includes(member.type))
                            yield { type: 'statement-boundary', mode: 'normal' }
                    }
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                return
            case 'ClassMethod':
            case 'ClassPrivateMethod':
                if (node.accessibility) yield this.fixed(node.accessibility)
                if (node.static) yield this.fixed('static')
                if (node.abstract) yield this.fixed('abstract')
                if (node.async) yield this.fixed('async')
                if (node.kind !== 'method' && node.kind !== 'constructor') yield this.fixed(node.kind)
                if (node.generator) yield this.fixed('*')
                yield* this.node(node.key, {})
                if (node.optional) yield this.fixed('?')
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('(')
                yield* this.list(node.params)
                yield this.fixed(')')
                if (node.returnType) yield* this.node(node.returnType, {})
                yield* this.block(node.body)
                return
            case 'ClassProperty':
            case 'ClassPrivateProperty':
                if ('accessibility' in node && node.accessibility) yield this.fixed(node.accessibility)
                if (node.static) yield this.fixed('static')
                if (node.readonly) yield this.fixed('readonly')
                if ('declare' in node && node.declare) yield this.fixed('declare')
                yield* this.node(node.key, {})
                if (node.optional) yield this.fixed('?')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                if (node.value) {
                    yield this.fixed('=')
                    yield* this.node(node.value, {})
                }
                return
            case 'SpreadElement':
            case 'RestElement':
                yield this.fixed('...')
                yield* this.node(node.argument, {})
                return
            case 'AssignmentPattern':
                yield* this.node(node.left, {})
                yield this.fixed('=')
                yield* this.node(node.right, {})
                return
            case 'TemplateLiteral':
                yield this.fixed('`')
                for (let i = 0; i < node.quasis.length; i++) {
                    yield { type: 'template-chunk', value: node.quasis[i]!.value.raw }
                    if (i < node.expressions.length) {
                        yield this.fixed('${')
                        yield* this.node(node.expressions[i]!, {})
                        yield this.fixed('}')
                    }
                }
                yield this.fixed('`')
                return
            case 'TaggedTemplateExpression':
                yield* this.node(node.tag, {})
                yield* this.node(node.quasi, {})
                return
            case 'JSXIdentifier':
                yield { type: 'ident', value: node.name }
                return
            case 'JSXMemberExpression':
                yield* this.node(node.object, {})
                yield this.fixed('.')
                yield* this.node(node.property, {})
                return
            case 'JSXNamespacedName':
                yield* this.node(node.namespace, {})
                yield this.fixed(':')
                yield* this.node(node.name, {})
                return
            case 'JSXElement':
                yield* this.node(node.openingElement, {})
                for (const child of node.children) yield* this.node(child, {})
                if (node.closingElement) yield* this.node(node.closingElement, {})
                return
            case 'JSXOpeningElement':
                yield this.fixed('<')
                yield* this.node(node.name, {})
                for (const attribute of node.attributes) yield* this.node(attribute, {})
                if (node.selfClosing) yield this.fixed('/')
                yield this.fixed('>')
                return
            case 'JSXClosingElement':
                yield this.fixed('<')
                yield this.fixed('/')
                yield* this.node(node.name, {})
                yield this.fixed('>')
                return
            case 'JSXFragment':
                yield this.fixed('<')
                yield this.fixed('>')
                for (const child of node.children) yield* this.node(child, {})
                yield this.fixed('<')
                yield this.fixed('/')
                yield this.fixed('>')
                return
            case 'JSXAttribute':
                yield* this.node(node.name, {})
                if (node.value) {
                    yield this.fixed('=')
                    yield* this.node(node.value, {})
                }
                return
            case 'JSXSpreadAttribute':
                yield this.fixed('{')
                yield this.fixed('...')
                yield* this.node(node.argument, {})
                yield this.fixed('}')
                return
            case 'JSXExpressionContainer':
                yield this.fixed('{')
                if (node.expression.type !== 'JSXEmptyExpression') yield* this.node(node.expression, {})
                yield this.fixed('}')
                return
            case 'JSXSpreadChild':
                yield this.fixed('{')
                yield this.fixed('...')
                yield* this.node(node.expression, {})
                yield this.fixed('}')
                return
            case 'JSXText': {
                const value = node.value.replace(/\s+/gu, ' ').trim()
                if (value) yield { type: 'jsx-text', value }
                return
            }
            case 'ImportDeclaration':
                yield this.fixed('import')
                if (node.importKind === 'type') yield this.fixed('type')
                if (node.specifiers.length) {
                    if (node.specifiers[0]?.type === 'ImportDefaultSpecifier') {
                        yield* this.node(node.specifiers[0].local, {})
                        if (node.specifiers.length > 1) yield this.fixed(',')
                    }
                    const named = node.specifiers.filter(s => s.type === 'ImportSpecifier')
                    const ns = node.specifiers.find(s => s.type === 'ImportNamespaceSpecifier')
                    if (ns) {
                        yield this.fixed('*')
                        yield this.fixed('as')
                        yield* this.node(ns.local, {})
                    }
                    if (named.length) {
                        yield this.fixed('{')
                        yield* this.list(named)
                        yield this.fixed('}')
                    }
                    yield this.fixed('from')
                }
                yield* this.node(node.source, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ImportSpecifier':
                yield* this.node(node.imported, {})
                if (node.local.name !== (node.imported as t.Identifier).name) {
                    yield this.fixed('as')
                    yield* this.node(node.local, {})
                }
                return
            case 'ExportNamedDeclaration':
                yield this.fixed('export')
                if (node.exportKind === 'type') yield this.fixed('type')
                if (node.declaration) {
                    yield* this.node(node.declaration, {})
                } else {
                    yield this.fixed('{')
                    yield* this.list(node.specifiers)
                    yield this.fixed('}')
                    if (node.source) {
                        yield this.fixed('from')
                        yield* this.node(node.source, {})
                    }
                    yield { type: 'statement-boundary', mode: 'normal' }
                }
                return
            case 'ExportDefaultDeclaration':
                yield this.fixed('export')
                yield this.fixed('default')
                yield* this.node(node.declaration, {})
                if (!['FunctionDeclaration', 'ClassDeclaration'].includes(node.declaration.type))
                    yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'ExportSpecifier':
                yield* this.node(node.local, {})
                if ((node.exported as t.Identifier).name !== (node.local as t.Identifier).name) {
                    yield this.fixed('as')
                    yield* this.node(node.exported, {})
                }
                return
            case 'TSAsExpression':
            case 'TSSatisfiesExpression':
                yield* this.expr(node.expression, node, 'left')
                yield this.fixed(node.type === 'TSAsExpression' ? 'as' : 'satisfies')
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSNonNullExpression':
                yield* this.node(node.expression, {})
                yield this.fixed('!')
                return
            case 'TSTypeAnnotation':
                yield this.fixed(':')
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSStringKeyword':
                yield this.fixed('string')
                return
            case 'TSNumberKeyword':
                yield this.fixed('number')
                return
            case 'TSBooleanKeyword':
                yield this.fixed('boolean')
                return
            case 'TSAnyKeyword':
                yield this.fixed('any')
                return
            case 'TSUnknownKeyword':
                yield this.fixed('unknown')
                return
            case 'TSNeverKeyword':
                yield this.fixed('never')
                return
            case 'TSVoidKeyword':
                yield this.fixed('void')
                return
            case 'TSUndefinedKeyword':
                yield this.fixed('undefined')
                return
            case 'TSNullKeyword':
                yield this.fixed('null')
                return
            case 'TSTypeReference':
                yield* this.node(node.typeName, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSTypeParameterInstantiation':
            case 'TSTypeParameterDeclaration':
                yield this.fixed('<')
                yield* this.list(node.params)
                yield this.fixed('>')
                return
            case 'TSArrayType':
                yield* this.node(node.elementType, {})
                yield this.fixed('[')
                yield this.fixed(']')
                return
            case 'TSTypeOperator':
                yield this.fixed(node.operator)
                yield* this.node(node.typeAnnotation, {})
                return
            case 'TSParenthesizedType':
                yield this.fixed('(')
                yield* this.node(node.typeAnnotation, {})
                yield this.fixed(')')
                return
            case 'TSLiteralType':
                yield* this.node(node.literal, {})
                return
            case 'TSTypeAliasDeclaration':
                yield this.fixed('type')
                yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                yield this.fixed('=')
                yield* this.node(node.typeAnnotation, {})
                yield { type: 'statement-boundary', mode: 'normal' }
                return
            case 'TSInterfaceDeclaration':
                yield this.fixed('interface')
                yield* this.node(node.id, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                if (node.extends?.length) {
                    yield this.fixed('extends')
                    yield* this.list(node.extends)
                }
                yield* this.node(node.body, {})
                yield { type: 'line', kind: 'hard' }
                return
            case 'TSInterfaceBody':
            case 'TSTypeLiteral': {
                const members = node.type === 'TSInterfaceBody' ? node.body : node.members
                yield this.fixed('{')
                if (members.length) {
                    yield { type: 'line', kind: 'hard' }
                    yield { type: 'indent' }
                    for (const member of members) {
                        yield* this.node(member, {})
                        yield { type: 'statement-boundary', mode: 'normal' }
                    }
                    yield { type: 'dedent' }
                }
                yield this.fixed('}')
                return
            }
            case 'TSPropertySignature':
                if (node.readonly) yield this.fixed('readonly')
                yield* this.node(node.key, {})
                if (node.optional) yield this.fixed('?')
                if (node.typeAnnotation) yield* this.node(node.typeAnnotation, {})
                return
            case 'TSExpressionWithTypeArguments':
                yield* this.node(node.expression, {})
                if (node.typeParameters) yield* this.node(node.typeParameters, {})
                return
            case 'TSUnionType':
            case 'TSIntersectionType':
                for (let i = 0; i < node.types.length; i++) {
                    if (i) yield this.fixed(node.type === 'TSUnionType' ? '|' : '&')
                    yield* this.node(node.types[i]!, {})
                }
                return
            case 'ParenthesizedExpression':
                yield this.fixed('(')
                yield* this.node(node.expression, {})
                yield this.fixed(')')
                return
            default:
                throw new UnsupportedNodeError(
                    `Unsupported Babel AST node ${node.type}${this.config.filepath ? ` in ${this.config.filepath}` : ''}${node.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : ''}`
                )
        }
    }
}
